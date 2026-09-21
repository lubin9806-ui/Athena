'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { randomId, sha256, hmacSha256, encryptBytes, decryptBytes, encryptJson, decryptJson } = require('./crypto');
const { sealReplay, openReplay } = require('./lifecycle');

const SCHEMA_VERSION = 2;

class CloudDatabase {
  constructor(config) {
    this.config = config;
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    this.db = new Database(config.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    // Deleted rows are zeroed rather than left readable in free pages, so a
    // purge or an account deletion does not leave its content on disk.
    this.db.pragma('secure_delete = ON');
    this.migrate();
  }

  migrate() {
    const version = this.db.pragma('user_version', { simple: true });
    if (version > SCHEMA_VERSION) throw new Error(`Cloud database schema ${version} is newer than supported ${SCHEMA_VERSION}.`);
    if (version === 0) {
      this.db.exec(`
        CREATE TABLE tenants (
          id TEXT PRIMARY KEY, name_enc TEXT NOT NULL, name_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','suspended','deleting','deleted')),
          plan TEXT NOT NULL, quota_json TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE TABLE tenant_keys (
          tenant_id TEXT NOT NULL, version INTEGER NOT NULL, wrapped_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','retired')), created_at TEXT NOT NULL, retired_at TEXT,
          PRIMARY KEY (tenant_id, version), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX one_active_tenant_key ON tenant_keys(tenant_id) WHERE status='active';
        CREATE TABLE users (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email_hash TEXT NOT NULL, login_hash TEXT NOT NULL, email_enc TEXT NOT NULL,
          email_key_version INTEGER NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
          status TEXT NOT NULL CHECK(status IN ('active','locked','deleted')), mfa_secret_enc TEXT, mfa_key_version INTEGER,
          mfa_enabled INTEGER NOT NULL DEFAULT 0, recovery_hashes_json TEXT NOT NULL DEFAULT '[]',
          failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL, deleted_at TEXT,
          UNIQUE(tenant_id, email_hash), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE INDEX users_tenant ON users(tenant_id, id);
        CREATE TABLE devices (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
          platform TEXT NOT NULL, public_key TEXT, status TEXT NOT NULL CHECK(status IN ('active','revoked')),
          created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX devices_tenant_user ON devices(tenant_id, user_id);
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
          access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
          access_expires_at TEXT NOT NULL, refresh_expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        CREATE INDEX sessions_access ON sessions(access_hash);
        CREATE TABLE recovery_requests (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE sync_records (
          tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, resource_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL, vector_json TEXT NOT NULL, payload_enc TEXT, key_version INTEGER,
          deleted INTEGER NOT NULL, modified_at TEXT NOT NULL, modified_by_device TEXT NOT NULL, etag TEXT NOT NULL,
          PRIMARY KEY(tenant_id, resource_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE INDEX sync_changes ON sync_records(tenant_id, modified_at, resource_id);
        CREATE TABLE idempotency (
          tenant_id TEXT NOT NULL, route TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          PRIMARY KEY(tenant_id, route, idem_key), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
          outcome TEXT NOT NULL, details_enc TEXT NOT NULL, key_version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
          previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE INDEX audit_tenant_time ON audit_events(tenant_id, occurred_at, id);
        CREATE TABLE usage_monthly (
          tenant_id TEXT NOT NULL, month TEXT NOT NULL, model_tokens INTEGER NOT NULL DEFAULT 0,
          sync_bytes INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(tenant_id, month), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE entitlements (
          tenant_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('trial','active','past_due','suspended','cancelled','refunded')),
          plan TEXT NOT NULL, source TEXT NOT NULL, external_reference TEXT, updated_at TEXT NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE abuse_cases (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, category TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('flagged','blocked','appealed','review','resolved')),
          appeal_enc TEXT, key_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE data_jobs (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('export','delete')),
          status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')), artifact_path TEXT,
          created_at TEXT NOT NULL, completed_at TEXT, details_json TEXT NOT NULL,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );
        CREATE TABLE backup_catalog (
          id TEXT PRIMARY KEY, region TEXT NOT NULL, file_path TEXT NOT NULL, sha256 TEXT NOT NULL,
          key_version INTEGER NOT NULL, created_at TEXT NOT NULL, restored_at TEXT, deleted_tenants_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX users_login_hash ON users(login_hash);
        PRAGMA user_version = 2;
      `);
      return;
    }
    if (version === 1) {
      this.db.exec('ALTER TABLE users ADD COLUMN login_hash TEXT;');
      const rows = this.db.prepare('SELECT id,tenant_id,email_enc,email_key_version FROM users').all();
      const update = this.db.prepare('UPDATE users SET login_hash=? WHERE tenant_id=? AND id=?');
      this.db.transaction(() => {
        for (const row of rows) {
          const key = this.getTenantKey(row.tenant_id, row.email_key_version).key;
          const email = decryptBytes(row.email_enc, key, `user-email:${row.tenant_id}:${row.id}`).toString('utf8');
          update.run(hmacSha256(this.config.masterKey, `login:${email}`), row.tenant_id, row.id);
        }
        this.db.exec('CREATE INDEX users_login_hash ON users(login_hash); PRAGMA user_version = 2;');
      })();
    }
  }

  close() {
    this.db.close();
  }

  now() {
    return new Date().toISOString();
  }

  createTenant(name, plan = 'local-test') {
    const now = this.now();
    const tenantId = randomId('ten');
    const dataKey = crypto.randomBytes(32);
    const wrapped = encryptBytes(dataKey, this.config.masterKey, `tenant-key:${tenantId}:1`);
    const nameEnc = encryptBytes(Buffer.from(name, 'utf8'), dataKey, `tenant-name:${tenantId}`);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?,?,?,NULL)').run(
        tenantId, nameEnc, hmacSha256(this.config.masterKey, name.toLowerCase()), 'active', plan,
        JSON.stringify({ modelTokens: this.config.monthlyModelTokenQuota, syncBytes: 50 * 1024 * 1024 }), now,
      );
      this.db.prepare('INSERT INTO tenant_keys VALUES (?,?,?,?,?,NULL)').run(tenantId, 1, wrapped, 'active', now);
      this.db.prepare('INSERT INTO entitlements VALUES (?,?,?,?,?,?)').run(tenantId, 'trial', plan, 'local-no-charge', null, now);
    })();
    return tenantId;
  }

  getTenant(tenantId) {
    return this.db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
  }

  getTenantKey(tenantId, version) {
    const row = version
      ? this.db.prepare('SELECT * FROM tenant_keys WHERE tenant_id=? AND version=?').get(tenantId, version)
      : this.db.prepare("SELECT * FROM tenant_keys WHERE tenant_id=? AND status='active'").get(tenantId);
    if (!row) throw new Error('Tenant encryption key not found.');
    return {
      version: row.version,
      key: decryptBytes(row.wrapped_key, this.config.masterKey, `tenant-key:${tenantId}:${row.version}`),
    };
  }

  rotateTenantKey(tenantId) {
    const active = this.getTenantKey(tenantId);
    const nextVersion = active.version + 1;
    const nextKey = crypto.randomBytes(32);
    const now = this.now();
    const wrapped = encryptBytes(nextKey, this.config.masterKey, `tenant-key:${tenantId}:${nextVersion}`);
    this.db.transaction(() => {
      this.db.prepare("UPDATE tenant_keys SET status='retired', retired_at=? WHERE tenant_id=? AND status='active'").run(now, tenantId);
      this.db.prepare('INSERT INTO tenant_keys VALUES (?,?,?,?,?,NULL)').run(tenantId, nextVersion, wrapped, 'active', now);
      for (const user of this.db.prepare('SELECT * FROM users WHERE tenant_id=?').all(tenantId)) {
        const oldEmailKey = this.getTenantKey(tenantId, user.email_key_version).key;
        const email = decryptBytes(user.email_enc, oldEmailKey, `user-email:${tenantId}:${user.id}`);
        let mfa = user.mfa_secret_enc;
        let mfaVersion = user.mfa_key_version;
        if (mfa) {
          const oldMfaKey = this.getTenantKey(tenantId, user.mfa_key_version).key;
          const secret = decryptBytes(mfa, oldMfaKey, `user-mfa:${tenantId}:${user.id}`);
          mfa = encryptBytes(secret, nextKey, `user-mfa:${tenantId}:${user.id}`);
          mfaVersion = nextVersion;
        }
        this.db.prepare('UPDATE users SET email_enc=?, email_key_version=?, mfa_secret_enc=?, mfa_key_version=? WHERE tenant_id=? AND id=?')
          .run(encryptBytes(email, nextKey, `user-email:${tenantId}:${user.id}`), nextVersion, mfa, mfaVersion, tenantId, user.id);
      }
      for (const record of this.db.prepare('SELECT * FROM sync_records WHERE tenant_id=? AND payload_enc IS NOT NULL').all(tenantId)) {
        const oldKey = this.getTenantKey(tenantId, record.key_version).key;
        const plain = decryptBytes(record.payload_enc, oldKey, `sync:${tenantId}:${record.resource_id}`);
        this.db.prepare('UPDATE sync_records SET payload_enc=?, key_version=? WHERE tenant_id=? AND resource_id=?')
          .run(encryptBytes(plain, nextKey, `sync:${tenantId}:${record.resource_id}`), nextVersion, tenantId, record.resource_id);
      }
      // Replay entries carry the same content as the records they answered.
      for (const entry of this.db.prepare('SELECT * FROM idempotency WHERE tenant_id=?').all(tenantId)) {
        let resealed = null;
        try {
          resealed = sealReplay(this, tenantId, entry.route, entry.idem_key, openReplay(this, entry), { key: nextKey, version: nextVersion });
        } catch {
          // An entry that cannot be opened cannot be replayed either.
        }
        if (resealed) {
          this.db.prepare('UPDATE idempotency SET response_json=? WHERE tenant_id=? AND route=? AND idem_key=?')
            .run(resealed, tenantId, entry.route, entry.idem_key);
        } else {
          this.db.prepare('DELETE FROM idempotency WHERE tenant_id=? AND route=? AND idem_key=?').run(tenantId, entry.route, entry.idem_key);
        }
      }
      let previousHash = 'GENESIS';
      for (const event of this.db.prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY rowid').all(tenantId)) {
        const oldKey = this.getTenantKey(tenantId, event.key_version).key;
        const details = decryptBytes(event.details_enc, oldKey, `audit:${tenantId}:${event.id}`);
        const encrypted = encryptBytes(details, nextKey, `audit:${tenantId}:${event.id}`);
        const material = JSON.stringify({
          id: event.id, tenantId, actorId: event.actor_id, action: event.action, target: event.target,
          outcome: event.outcome, detailsEnc: encrypted, occurredAt: event.occurred_at, previousHash,
        });
        const eventHash = hmacSha256(this.config.masterKey, material);
        this.db.prepare('UPDATE audit_events SET details_enc=?, key_version=?, previous_hash=?, event_hash=? WHERE tenant_id=? AND id=?')
          .run(encrypted, nextVersion, previousHash, eventHash, tenantId, event.id);
        previousHash = eventHash;
      }
    })();
    return nextVersion;
  }

  appendAudit(tenantId, actorId, action, target, outcome, details = {}) {
    const key = this.getTenantKey(tenantId);
    const id = randomId('aud');
    const occurredAt = this.now();
    const previous = this.db.prepare('SELECT event_hash FROM audit_events WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1').get(tenantId);
    const previousHash = previous?.event_hash || 'GENESIS';
    const detailsEnc = encryptJson(redact(details), key.key, `audit:${tenantId}:${id}`);
    const material = JSON.stringify({ id, tenantId, actorId, action, target, outcome, detailsEnc, occurredAt, previousHash });
    const eventHash = hmacSha256(this.config.masterKey, material);
    this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      id, tenantId, actorId, action, target, outcome, detailsEnc, key.version, occurredAt, previousHash, eventHash,
    );
    return id;
  }

  verifyAudit(tenantId) {
    let previousHash = 'GENESIS';
    for (const row of this.db.prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY rowid').all(tenantId)) {
      if (row.previous_hash !== previousHash) return { valid: false, id: row.id, reason: 'chain-link' };
      const material = JSON.stringify({
        id: row.id, tenantId: row.tenant_id, actorId: row.actor_id, action: row.action, target: row.target,
        outcome: row.outcome, detailsEnc: row.details_enc, occurredAt: row.occurred_at, previousHash: row.previous_hash,
      });
      if (hmacSha256(this.config.masterKey, material) !== row.event_hash) return { valid: false, id: row.id, reason: 'event-hash' };
      previousHash = row.event_hash;
    }
    return { valid: true };
  }

  listAudit(tenantId, limit = 100) {
    return this.db.prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY rowid DESC LIMIT ?').all(tenantId, limit).map((row) => ({
      id: row.id, actorId: row.actor_id, action: row.action, target: row.target, outcome: row.outcome,
      occurredAt: row.occurred_at,
      details: decryptJson(row.details_enc, this.getTenantKey(tenantId, row.key_version).key, `audit:${tenantId}:${row.id}`),
    }));
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /password|token|secret|prompt|audio|voice|authorization/i.test(key) ? '[REDACTED]' : redact(item);
  }
  return output;
}

module.exports = { CloudDatabase, redact, SCHEMA_VERSION };
