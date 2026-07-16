'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { randomId, sha256, hmacSha256, constantEqual, encryptBytes, decryptBytes } = require('./crypto');
const { CloudError, assert } = require('./errors');

class IdempotencyService {
  constructor(store) { this.store = store; this.db = store.db; }

  execute(tenantId, route, key, request, operation) {
    assert(typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key), 400, 'idempotency-key-required', 'A valid Idempotency-Key is required.');
    const requestHash = sha256(JSON.stringify(request));
    const existing = this.db.prepare('SELECT * FROM idempotency WHERE tenant_id=? AND route=? AND idem_key=?').get(tenantId, route, key);
    if (existing) {
      if (Date.parse(existing.expires_at) <= Date.now()) {
        this.db.prepare('DELETE FROM idempotency WHERE tenant_id=? AND route=? AND idem_key=?').run(tenantId, route, key);
      } else {
        assert(existing.request_hash === requestHash, 409, 'idempotency-mismatch', 'Idempotency key was already used with a different request.');
        return { replayed: true, statusCode: existing.status_code, body: JSON.parse(existing.response_json) };
      }
    }
    const result = operation();
    if (result && typeof result.then === 'function') {
      return result.then((value) => this.remember(tenantId, route, key, requestHash, value));
    }
    return this.remember(tenantId, route, key, requestHash, result);
  }

  remember(tenantId, route, key, requestHash, value) {
    const statusCode = value?.outcome === 'conflict' ? 409 : 200;
    const createdAt = this.store.now();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?,?,?,?)').run(
      tenantId, route, key, requestHash, statusCode, JSON.stringify(value), createdAt, expiresAt,
    );
    return { replayed: false, statusCode, body: value };
  }
}

class DataRightsService {
  constructor(store, config, syncService) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    this.syncService = syncService;
    fs.mkdirSync(config.exportDir, { recursive: true });
    fs.mkdirSync(config.backupDir, { recursive: true });
  }

  createExport(context) {
    const user = this.db.prepare('SELECT * FROM users WHERE tenant_id=? AND id=?').get(context.tenantId, context.userId);
    assert(user && user.status === 'active', 404, 'user-not-found', 'User was not found.');
    const key = this.store.getTenantKey(context.tenantId);
    const email = decryptBytes(user.email_enc, this.store.getTenantKey(context.tenantId, user.email_key_version).key,
      `user-email:${context.tenantId}:${user.id}`).toString('utf8');
    const syncRows = this.db.prepare('SELECT * FROM sync_records WHERE tenant_id=? AND owner_user_id=? ORDER BY resource_id').all(context.tenantId, context.userId);
    const jobId = randomId('job');
    const createdAt = this.store.now();
    const artifactPath = path.join(this.config.exportDir, `${jobId}.json.aes`);
    const document = {
      schemaVersion: 1,
      exportedAt: createdAt,
      tenantId: context.tenantId,
      account: { userId: user.id, email, role: user.role, createdAt: user.created_at },
      devices: this.db.prepare(`SELECT id,name,platform,status,created_at AS createdAt,last_seen_at AS lastSeenAt,revoked_at AS revokedAt
        FROM devices WHERE tenant_id=? AND user_id=?`).all(context.tenantId, context.userId),
      syncRecords: syncRows.map((row) => this.syncService.present(row)),
      usage: this.db.prepare('SELECT month,model_tokens AS modelTokens,sync_bytes AS syncBytes,requests FROM usage_monthly WHERE tenant_id=?').all(context.tenantId),
      audit: this.store.listAudit(context.tenantId, 1000).filter((event) => event.actorId === context.userId),
      exclusions: ['password hashes', 'session tokens', 'tenant encryption keys', 'other users data'],
    };
    const encrypted = encryptBytes(Buffer.from(JSON.stringify(document, null, 2), 'utf8'), key.key, `export:${context.tenantId}:${jobId}`);
    fs.writeFileSync(artifactPath, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    this.db.prepare('INSERT INTO data_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(
      jobId, context.tenantId, context.userId, 'export', 'complete', artifactPath, createdAt, createdAt,
      JSON.stringify({ encrypted: true, format: 'json', keyVersion: key.version, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }),
    );
    this.store.appendAudit(context.tenantId, context.userId, 'data.export', jobId, 'success', { encrypted: true });
    return { jobId, status: 'complete', expiresAt: JSON.parse(this.db.prepare('SELECT details_json FROM data_jobs WHERE id=?').get(jobId).details_json).expiresAt };
  }

  downloadExport(context, jobId) {
    const job = this.db.prepare("SELECT * FROM data_jobs WHERE tenant_id=? AND user_id=? AND id=? AND kind='export'").get(context.tenantId, context.userId, jobId);
    assert(job && job.status === 'complete' && job.artifact_path, 404, 'export-not-found', 'Export was not found.');
    const details = JSON.parse(job.details_json);
    assert(Date.parse(details.expiresAt) > Date.now(), 410, 'export-expired', 'Export has expired.');
    const key = this.store.getTenantKey(context.tenantId, details.keyVersion).key;
    return decryptBytes(fs.readFileSync(job.artifact_path, 'utf8'), key, `export:${context.tenantId}:${jobId}`);
  }

  deleteAccount(context, confirmation) {
    assert(context.role === 'owner', 403, 'owner-required', 'Tenant owner role is required for account deletion.');
    assert(confirmation === `DELETE ${context.tenantId}`, 400, 'confirmation-required', 'Exact deletion confirmation is required.');
    const tenant = this.store.getTenant(context.tenantId);
    assert(tenant && tenant.status === 'active', 409, 'tenant-not-active', 'Tenant is not active.');
    const deletionId = randomId('del');
    const deletedAt = this.store.now();
    this.store.appendAudit(context.tenantId, context.userId, 'data.delete', context.tenantId, 'accepted', {
      deletionId, legalHold: false, backupPolicy: 'purge-all-known-backups-and-deny-restore',
    });
    const finalAudit = this.store.verifyAudit(context.tenantId);
    const purgedBackups = this.purgeTenantBackups(context.tenantId);
    const receipt = {
      deletionId, tenantId: context.tenantId, requestedBy: context.userId, deletedAt,
      legalHold: false, purgedBackups, auditValidBeforeErase: finalAudit.valid,
    };
    this.appendDeletionLedger(receipt);
    this.purgeExportFiles(context.tenantId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE tenants SET status='deleting' WHERE id=?").run(context.tenantId);
      this.db.prepare('DELETE FROM tenants WHERE id=?').run(context.tenantId);
    })();
    return { ...receipt, status: 'complete', cryptographicErase: true };
  }

  purgeTenantBackups(tenantId) {
    const rows = this.db.prepare('SELECT * FROM backup_catalog').all();
    let count = 0;
    for (const row of rows) {
      const tenants = JSON.parse(row.deleted_tenants_json || '[]');
      if (!tenants.includes(tenantId)) {
        tenants.push(tenantId);
        this.db.prepare('UPDATE backup_catalog SET deleted_tenants_json=? WHERE id=?').run(JSON.stringify(tenants), row.id);
      }
      if (fs.existsSync(row.file_path)) {
        fs.rmSync(row.file_path, { force: true });
        count += 1;
      }
      this.db.prepare('DELETE FROM backup_catalog WHERE id=?').run(row.id);
    }
    return count;
  }

  purgeExportFiles(tenantId) {
    for (const job of this.db.prepare('SELECT artifact_path FROM data_jobs WHERE tenant_id=? AND artifact_path IS NOT NULL').all(tenantId)) {
      if (job.artifact_path) fs.rmSync(job.artifact_path, { force: true });
    }
  }

  appendDeletionLedger(receipt) {
    const ledgerPath = path.join(this.config.backupDir, 'deletion-ledger.json');
    const current = readDeletionLedger(ledgerPath, this.config.masterKey);
    current.entries.push(receipt);
    current.signature = signLedger(current.entries, this.config.masterKey);
    const temporary = `${ledgerPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(current, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, ledgerPath);
  }
}

class BackupService {
  constructor(store, config) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    fs.mkdirSync(config.backupDir, { recursive: true });
  }

  async create() {
    const id = randomId('bak');
    const snapshot = path.join(this.config.backupDir, `${id}.snapshot.db`);
    const artifact = path.join(this.config.backupDir, `${id}.db.aes`);
    await this.db.backup(snapshot);
    try {
      const plaintext = fs.readFileSync(snapshot);
      const encrypted = encryptBytes(plaintext, this.config.masterKey, `backup:${id}:${this.config.region}`);
      fs.writeFileSync(artifact, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const digest = sha256(encrypted);
      this.db.prepare('INSERT INTO backup_catalog VALUES (?,?,?,?,?,?,NULL,?)').run(
        id, this.config.region, artifact, digest, 1, this.store.now(), '[]',
      );
      return { id, region: this.config.region, sha256: digest, encrypted: true };
    } finally {
      fs.rmSync(snapshot, { force: true });
    }
  }

  restoreTo(id, targetPath) {
    const row = this.db.prepare('SELECT * FROM backup_catalog WHERE id=?').get(id);
    assert(row && fs.existsSync(row.file_path), 404, 'backup-not-found', 'Backup was not found.');
    const serialized = fs.readFileSync(row.file_path, 'utf8');
    assert(constantEqual(sha256(serialized), row.sha256), 422, 'backup-corrupt', 'Backup checksum verification failed.');
    const plaintext = decryptBytes(serialized, this.config.masterKey, `backup:${id}:${row.region}`);
    const resolved = path.resolve(targetPath);
    assert(resolved !== path.resolve(this.config.dbPath), 400, 'unsafe-restore-target', 'Online in-place restore is forbidden; use a staging target.');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, plaintext, { mode: 0o600, flag: 'wx' });
    const restored = new Database(resolved);
    try {
      restored.pragma('foreign_keys = ON');
      const integrity = restored.pragma('integrity_check', { simple: true });
      assert(integrity === 'ok', 422, 'backup-integrity', 'Restored database failed integrity check.');
      const ledgerPath = path.join(this.config.backupDir, 'deletion-ledger.json');
      const ledger = readDeletionLedger(ledgerPath, this.config.masterKey);
      for (const entry of ledger.entries) restored.prepare('DELETE FROM tenants WHERE id=?').run(entry.tenantId);
      restored.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      restored.close();
    }
    this.db.prepare('UPDATE backup_catalog SET restored_at=? WHERE id=?').run(this.store.now(), id);
    return { id, targetPath: resolved, integrity: 'ok', deletionLedgerApplied: true };
  }
}

class Metrics {
  constructor() { this.startedAt = Date.now(); this.requests = 0; this.errors = 0; this.durations = []; }
  observe(durationMs, status) {
    this.requests += 1;
    if (status >= 500) this.errors += 1;
    this.durations.push(durationMs);
    if (this.durations.length > 10000) this.durations.shift();
  }
  snapshot() {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const percentile = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), requests: this.requests, serverErrors: this.errors,
      availability: this.requests ? 1 - this.errors / this.requests : 1,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    };
  }
}

function readDeletionLedger(filePath, masterKey) {
  if (!fs.existsSync(filePath)) return { schemaVersion: 1, entries: [], signature: signLedger([], masterKey) };
  const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || !constantEqual(ledger.signature, signLedger(ledger.entries, masterKey))) {
    throw new Error('Deletion ledger verification failed.');
  }
  return ledger;
}
function signLedger(entries, masterKey) { return hmacSha256(masterKey, JSON.stringify(entries)); }

module.exports = { IdempotencyService, DataRightsService, BackupService, Metrics, readDeletionLedger };
