'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { loadConfig } = require('../src/config');
const { CloudDatabase, SCHEMA_VERSION } = require('../src/database');
const { createCloudApp } = require('../src/server');
const { totp } = require('../src/crypto');
const { RateLimiter, UnavailableModelProvider } = require('../src/services');
const { LocalDeploymentAdapter } = require('../src/ports');

function fixture(overrides = {}, adapters = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-test-'));
  const config = loadConfig({
    port: 0,
    dbPath: path.join(root, 'cloud.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
    accessTtlMs: 60000,
    refreshTtlMs: 60000,
    ...overrides,
  });
  const app = createCloudApp(config, adapters);
  return { root, config, app, services: app.services, async close() { await app.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

/** The whole on-disk database, WAL included, after a checkpoint. */
function databaseBytes(fx) {
  fx.services.store.db.pragma('wal_checkpoint(TRUNCATE)');
  return [fx.config.dbPath, `${fx.config.dbPath}-wal`]
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file).toString('latin1'))
    .join('');
}

function register(services, suffix = 'a') {
  return services.auth.registerTenant({
    tenantName: `Tenant ${suffix}`,
    email: `owner-${suffix}@example.test`,
    password: `correct horse battery staple ${suffix}`,
    deviceName: `Device ${suffix}`,
    platform: 'test',
  });
}

test('schema v2 backup catalogs migrate with conservative unknown tenant membership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-migration-'));
  const dbPath = path.join(root, 'cloud.db');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE backup_catalog (
      id TEXT PRIMARY KEY, region TEXT NOT NULL, file_path TEXT NOT NULL, sha256 TEXT NOT NULL,
      key_version INTEGER NOT NULL, created_at TEXT NOT NULL, restored_at TEXT,
      deleted_tenants_json TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO backup_catalog VALUES ('bak_legacy','local-1','legacy.db.aes','digest',1,'2026-01-01T00:00:00.000Z',NULL,'[]');
    PRAGMA user_version = 2;
  `);
  legacy.close();
  const config = loadConfig({
    port: 0,
    dbPath,
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
  });
  const migrated = new CloudDatabase(config);
  try {
    assert.equal(migrated.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(migrated.db.prepare('SELECT tenant_ids_json FROM backup_catalog WHERE id=?').get('bak_legacy').tenant_ids_json, null);
  } finally {
    migrated.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production configuration fails closed while local adapters remain zero-cost', () => {
  assert.throws(() => loadConfig({ environment: 'production' }), /Production Cloud configuration blocked/);
  assert.throws(() => loadConfig({
    environment: 'production',
    tlsTerminated: true,
    masterKey: crypto.randomBytes(32),
    region: 'cn-prod-1',
    cloudProvider: 'reviewed-cloud',
    billingAdapter: 'reviewed-billing',
    modelProvider: 'reviewed-model',
    searchProvider: 'reviewed-search',
  }), /account recovery delivery decision/);
  const config = loadConfig({ environment: 'local', port: 0 });
  assert.equal(config.billingAdapter, 'local-no-charge');
  assert.equal(config.cloudProvider, 'local');
  assert.equal(config.recoveryDeliveryAdapter, 'local-return-token');
  assert.equal(config.promptRetention, 'none');
  assert.equal(config.voiceRetention, 'none');
});

test('runtime adapters must exactly match reviewed configuration and implement their ports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-bindings-'));
  const config = (overrides = {}) => loadConfig({
    port: 0,
    dbPath: path.join(root, 'must-not-be-created.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
    ...overrides,
  });
  try {
    assert.throws(() => createCloudApp(config({ billingAdapter: 'reviewed-billing' })), /Billing adapter mismatch/);
    assert.throws(() => createCloudApp(config({ cloudProvider: 'reviewed-cloud' })), /Unsupported Cloud provider adapter/);
    assert.throws(() => createCloudApp(config({ recoveryDeliveryAdapter: 'reviewed-mail' })), /Recovery delivery adapter mismatch/);
    assert.throws(() => createCloudApp(config(), { modelProvider: { id: 'wrong-model', infer() {} } }), /Model provider mismatch/);
    assert.throws(() => createCloudApp(config(), { searchProvider: { id: 'wrong-search', search() {} } }), /Search provider mismatch/);
    assert.throws(() => createCloudApp(config(), { billingAdapter: { id: 'local-no-charge' } }), /must implement transition/);
    assert.equal(fs.existsSync(path.join(root, 'must-not-be-created.db')), false, 'binding failures must happen before opening the database');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readiness reports the adapter identities that are actually bound', async () => {
  const fx = fixture({
    cloudProvider: 'reviewed-cloud-sandbox',
    billingAdapter: 'reviewed-billing-sandbox',
    recoveryDeliveryAdapter: 'reviewed-mail-sandbox',
  }, {
    deploymentAdapter: {
      id: 'reviewed-cloud-sandbox',
      activeRegion: () => ({ region: 'sandbox-1', degraded: false }),
      markUnavailable: () => ({ region: 'sandbox-1', degraded: false }),
    },
    billingAdapter: {
      id: 'reviewed-billing-sandbox',
      transition: ({ nextState }) => ({ state: nextState, externalReference: null, charged: false }),
    },
    recoveryDelivery: {
      id: 'reviewed-mail-sandbox',
      deliver: () => ({ delivered: true }),
    },
  });
  try {
    const address = await fx.app.listen();
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.deepEqual(health.runtimeBindings, {
      cloudProvider: 'reviewed-cloud-sandbox',
      billingAdapter: 'reviewed-billing-sandbox',
      recoveryDeliveryAdapter: 'reviewed-mail-sandbox',
      modelProvider: 'local-fixture',
      searchProvider: 'local-fixture',
    });
  } finally { await fx.close(); }
});

test('authentication, MFA recovery, sessions and device revocation are enforced', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'auth');
    const context = fx.services.auth.authenticate(account.accessToken);
    const setup = fx.services.auth.beginMfa(context);
    fx.services.auth.confirmMfa(context, totp(setup.secret));

    assert.throws(() => fx.services.auth.login({
      tenantId: account.tenantId, email: 'owner-auth@example.test', password: 'correct horse battery staple auth',
      deviceName: 'No MFA', platform: 'test',
    }), (error) => error.code === 'mfa-required');

    const mfaLogin = fx.services.auth.login({
      tenantId: account.tenantId, email: 'owner-auth@example.test', password: 'correct horse battery staple auth',
      mfaCode: totp(setup.secret), deviceName: 'MFA device', platform: 'test',
    });
    assert.equal(fx.services.auth.authenticate(mfaLogin.accessToken).tenantId, account.tenantId);

    const recoveryLogin = fx.services.auth.login({
      tenantId: account.tenantId, email: 'owner-auth@example.test', password: 'correct horse battery staple auth',
      recoveryCode: setup.recoveryCodes[0], deviceName: 'Recovery device', platform: 'test',
    });
    assert.ok(recoveryLogin.refreshToken);
    assert.throws(() => fx.services.auth.login({
      tenantId: account.tenantId, email: 'owner-auth@example.test', password: 'correct horse battery staple auth',
      recoveryCode: setup.recoveryCodes[0], deviceName: 'Replay', platform: 'test',
    }), (error) => error.code === 'mfa-required');

    fx.services.auth.revokeDevice(context, account.device.id);
    assert.throws(() => fx.services.auth.authenticate(account.accessToken), (error) => error.code === 'session-expired');
    assert.equal(fx.services.auth.authenticate(mfaLogin.accessToken).userId, account.userId);
    const databaseText = databaseBytes(fx);
    // WAL mode keeps new rows in -wal until a checkpoint; this scan read only the
    // main file, a 4 KB header, and could not have found anything. The tenant id
    // is stored in the clear on purpose, so finding it proves the scan sees rows.
    assert.equal(databaseText.includes(account.tenantId), true, 'the plaintext scan is not reading stored rows');
    assert.equal(databaseText.includes(account.accessToken), false);
    assert.equal(databaseText.includes('owner-auth@example.test'), false);
  } finally { await fx.close(); }
});

test('managed platform port and persistent storage paths are configurable', () => {
  const previous = {
    PORT: process.env.PORT,
    ATHENA_CLOUD_BACKUP_DIR: process.env.ATHENA_CLOUD_BACKUP_DIR,
    ATHENA_CLOUD_EXPORT_DIR: process.env.ATHENA_CLOUD_EXPORT_DIR,
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-platform-config-'));
  try {
    process.env.PORT = '10000';
    process.env.ATHENA_CLOUD_BACKUP_DIR = path.join(root, 'persistent-backups');
    process.env.ATHENA_CLOUD_EXPORT_DIR = path.join(root, 'persistent-exports');
    const config = loadConfig({ masterKey: crypto.randomBytes(32) });
    assert.equal(config.port, 10000);
    assert.equal(config.backupDir, path.join(root, 'persistent-backups'));
    assert.equal(config.exportDir, path.join(root, 'persistent-exports'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Render staging binds a truthful single-region deployment adapter', async () => {
  const fx = fixture({ cloudProvider: 'render', region: 'singapore' });
  try {
    assert.equal(fx.services.runtimeBindings.cloudProvider, 'render');
    assert.deepEqual(fx.services.deployment.activeRegion(), { region: 'singapore', degraded: false });
    assert.deepEqual(fx.services.deployment.markUnavailable('singapore'), { region: null, degraded: true });
  } finally {
    await fx.close();
  }
});

test('a person logs in with email and password without knowing a tenant id', () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'email-only');
    const session = fx.services.auth.login({
      email: 'owner-email-only@example.test',
      password: 'correct horse battery staple email-only',
      deviceName: 'Phone',
      platform: 'android',
    });
    assert.equal(session.tenantId, account.tenantId);
    assert.equal(fx.services.auth.authenticate(session.accessToken).userId, account.userId);
    assert.throws(() => fx.services.auth.registerTenant({
      tenantName: 'Duplicate',
      email: 'owner-email-only@example.test',
      password: 'another correct horse battery staple',
      deviceName: 'Other',
      platform: 'test',
    }), (error) => error.code === 'email-in-use');
  } finally { fx.close(); }
});

test('tenant and user scopes prevent cross-tenant record access', async () => {
  const fx = fixture();
  try {
    const first = register(fx.services, 'one');
    const second = register(fx.services, 'two');
    const firstContext = fx.services.auth.authenticate(first.accessToken);
    const secondContext = fx.services.auth.authenticate(second.accessToken);
    const accepted = fx.services.sync.put(firstContext, {
      resourceId: 'memory.private-1', resourceType: 'memory', schemaVersion: 1, baseVector: {},
      payload: { text: 'tenant-one-secret' }, deleted: false,
    });
    assert.equal(accepted.outcome, 'accepted');
    assert.throws(() => fx.services.sync.get(secondContext, 'memory.private-1'), (error) => error.code === 'record-not-found');
    const tenantCount = fx.services.store.db.prepare('SELECT count(*) AS count FROM sync_records WHERE tenant_id=?').get(second.tenantId).count;
    assert.equal(tenantCount, 0);
  } finally { await fx.close(); }
});

test('account recovery is enumeration-safe, one-time and revokes every active session', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'recovery');
    const unknown = fx.services.auth.requestRecovery({ tenantId: account.tenantId, email: 'missing@example.test' });
    assert.deepEqual(unknown, { accepted: true, expiresInSeconds: 900 });
    const request = fx.services.auth.requestRecovery({ tenantId: account.tenantId, email: 'owner-recovery@example.test' });
    assert.ok(request.localToken);
    const complete = fx.services.auth.completeRecovery({
      tenantId: account.tenantId, token: request.localToken, newPassword: 'new correct horse battery staple recovery',
    });
    assert.equal(complete.sessionsRevoked, true);
    assert.throws(() => fx.services.auth.authenticate(account.accessToken), (error) => error.code === 'session-expired');
    assert.throws(() => fx.services.auth.completeRecovery({
      tenantId: account.tenantId, token: request.localToken, newPassword: 'another correct horse battery staple',
    }), (error) => error.code === 'invalid-recovery');
    const login = fx.services.auth.login({
      tenantId: account.tenantId, email: 'owner-recovery@example.test', password: 'new correct horse battery staple recovery',
      deviceName: 'Recovered', platform: 'test',
    });
    assert.ok(login.accessToken);
  } finally { await fx.close(); }
});

test('sync v1 provides idempotency, bounded encrypted records, tombstones and explicit conflicts', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'sync');
    const context = fx.services.auth.authenticate(account.accessToken);
    const request = {
      resourceId: 'memory.42', resourceType: 'memory', schemaVersion: 1, baseVector: {},
      payload: { text: 'never-store-this-in-plaintext' }, deleted: false,
    };
    const first = fx.services.idempotency.execute(account.tenantId, 'PUT:/v1/sync/records/memory.42', 'idem-sync-0001', request,
      () => fx.services.sync.put(context, request));
    const replay = fx.services.idempotency.execute(account.tenantId, 'PUT:/v1/sync/records/memory.42', 'idem-sync-0001', request,
      () => { throw new Error('must not execute'); });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.throws(() => fx.services.idempotency.execute(account.tenantId, 'PUT:/v1/sync/records/memory.42', 'idem-sync-0001', { ...request, deleted: true }, () => null),
      (error) => error.code === 'idempotency-mismatch');

    const stale = fx.services.sync.put(context, { ...request, payload: { text: 'stale write' } });
    assert.equal(stale.outcome, 'conflict');
    assert.equal(stale.reason, 'server-ahead');
    const vector = first.body.record.vector;
    const tombstone = fx.services.sync.put(context, { ...request, baseVector: vector, payload: null, deleted: true });
    assert.equal(tombstone.record.deleted, true);
    assert.equal(tombstone.record.payload, null);
    const raw = fx.services.store.db.prepare('SELECT payload_enc FROM sync_records WHERE tenant_id=? AND resource_id=?').get(account.tenantId, 'memory.42');
    assert.equal(raw.payload_enc, null);
    const usage = fx.services.store.db.prepare('SELECT sync_bytes FROM usage_monthly WHERE tenant_id=?').get(account.tenantId).sync_bytes;
    fx.services.store.db.prepare('UPDATE tenants SET quota_json=? WHERE id=?').run(JSON.stringify({ modelTokens: 100000, syncBytes: usage + 1 }), account.tenantId);
    assert.throws(() => fx.services.sync.put(context, {
      resourceId: 'memory.over-quota', resourceType: 'memory', schemaVersion: 1, baseVector: {}, payload: { text: 'quota' }, deleted: false,
    }), (error) => error.code === 'quota-exhausted');
  } finally { await fx.close(); }
});

test('sync cursor does not skip records sharing the same modification timestamp', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'cursor');
    const context = fx.services.auth.authenticate(account.accessToken);
    const fixedTime = '2026-07-16T12:00:00.000Z';
    fx.services.store.now = () => fixedTime;
    for (const resourceId of ['memory.cursor-a', 'memory.cursor-b']) {
      fx.services.sync.put(context, { resourceId, resourceType: 'memory', schemaVersion: 1, baseVector: {}, payload: { resourceId }, deleted: false });
    }
    const first = fx.services.sync.list(context, null, 1);
    const second = fx.services.sync.list(context, first.nextCursor, 1);
    assert.equal(first.records.length, 1);
    assert.equal(second.records.length, 1);
    assert.notEqual(first.records[0].resourceId, second.records[0].resourceId);
  } finally { await fx.close(); }
});

test('tenant key rotation re-encrypts live data and preserves audit chain validity', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'rotate');
    const context = fx.services.auth.authenticate(account.accessToken);
    fx.services.store.now = () => '2026-07-16T12:30:00.000Z';
    fx.services.sync.put(context, {
      resourceId: 'preference.theme', resourceType: 'preference', schemaVersion: 1, baseVector: {},
      payload: { theme: 'night' }, deleted: false,
    });
    assert.equal(fx.services.store.verifyAudit(account.tenantId).valid, true);
    fx.services.store.appendAudit(account.tenantId, account.userId, 'test.same-time.one', 'one', 'success');
    fx.services.store.appendAudit(account.tenantId, account.userId, 'test.same-time.two', 'two', 'success');
    assert.equal(fx.services.store.verifyAudit(account.tenantId).valid, true);
    const version = fx.services.store.rotateTenantKey(account.tenantId);
    assert.equal(version, 2);
    assert.deepEqual(fx.services.sync.get(context, 'preference.theme').payload, { theme: 'night' });
    assert.equal(fx.services.store.verifyAudit(account.tenantId).valid, true);
    const row = fx.services.store.db.prepare('SELECT key_version FROM sync_records WHERE tenant_id=?').get(account.tenantId);
    assert.equal(row.key_version, 2);
  } finally { await fx.close(); }
});

test('model gateway minimizes retention, meters quota, blocks abuse and supports appeal', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'model');
    const context = fx.services.auth.authenticate(account.accessToken);
    const prompt = 'A unique prompt marker 7f8c2d for a short poem.';
    const result = await fx.services.model.infer(context, { prompt, mode: 'create' });
    assert.equal(result.retained.prompt, false);
    assert.equal(result.retained.voice, false);
    const searchable = JSON.stringify(fx.services.store.db.prepare('SELECT * FROM audit_events WHERE tenant_id=?').all(account.tenantId));
    assert.equal(searchable.includes(prompt), false);
    await assert.rejects(() => fx.services.model.infer(context, { prompt: 'Please deploy ransomware and hide it.', mode: 'reason' }),
      (error) => error.code === 'content-blocked' && error.extras.appealAllowed === true);
    const abuse = fx.services.store.db.prepare('SELECT id FROM abuse_cases WHERE tenant_id=?').get(account.tenantId);
    const appeal = fx.services.model.appeal(context, abuse.id, 'This was a controlled security research false positive.');
    assert.equal(appeal.state, 'appealed');
    assert.equal(appeal.escalation, 'manual-review-required');
    await assert.rejects(() => fx.services.model.infer(context, { prompt: 'touch the local filesystem', mode: 'execute' }),
      (error) => error.code === 'invalid-mode');
    const withHistory = await fx.services.model.infer(context, {
      prompt: 'Continue the poem.',
      mode: 'companion',
      history: [{ role: 'user', content: 'Write a short poem.' }, { role: 'assistant', content: 'A fixture stanza.' }],
    });
    assert.match(withHistory.text, /history=2/);
    await assert.rejects(() => fx.services.model.infer(context, {
      prompt: 'Please continue.',
      mode: 'reason',
      history: [{ role: 'user', content: 'Please deploy ransomware and hide it.' }],
    }), (error) => error.code === 'content-blocked', 'user-authored history must not bypass the outbound policy');
    const quotedByAssistant = await fx.services.model.infer(context, {
      prompt: 'Explain why that answer was refused.',
      mode: 'reason',
      history: [{ role: 'assistant', content: 'I cannot help deploy ransomware.' }],
    });
    assert.match(quotedByAssistant.text, /history=1/, 'assistant history must not be treated as a new user request');
  } finally { await fx.close(); }
});

test('search proxy is first-party, untrusted, query-minimized and Execute-free', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'search');
    const context = fx.services.auth.authenticate(account.accessToken);
    const query = 'unique-search-marker-9c2e';
    const result = await fx.services.search.query(context, { query, maxResults: 2 });
    assert.equal(result.provider, 'local-fixture');
    assert.equal(result.untrustedExternalEvidence, true);
    assert.equal(result.retained.query, false);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].url.startsWith('https://example.test/'), true);
    const audit = JSON.stringify(fx.services.store.db.prepare('SELECT * FROM audit_events WHERE tenant_id=?').all(account.tenantId));
    assert.equal(audit.includes(query), false);
    await assert.rejects(() => fx.services.search.query(context, { query: 'x', maxResults: 2 }),
      (error) => error.code === 'invalid-query');
  } finally { await fx.close(); }
});

test('exports are encrypted at rest and backups restore only through verified staging', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'lifecycle');
    const context = fx.services.auth.authenticate(account.accessToken);
    fx.services.sync.put(context, {
      resourceId: 'memory.export', resourceType: 'memory', schemaVersion: 1, baseVector: {}, payload: { text: 'export-me' }, deleted: false,
    });
    const job = fx.services.dataRights.createExport(context);
    const jobRow = fx.services.store.db.prepare('SELECT * FROM data_jobs WHERE id=?').get(job.jobId);
    assert.equal(fs.readFileSync(jobRow.artifact_path, 'utf8').includes('export-me'), false);
    fx.services.store.rotateTenantKey(account.tenantId);
    const exported = JSON.parse(fx.services.dataRights.downloadExport(context, job.jobId).toString('utf8'));
    assert.equal(exported.syncRecords[0].payload.text, 'export-me');

    const backup = await fx.services.backup.create();
    const restoredPath = path.join(fx.root, 'restore', 'cloud.db');
    const restored = fx.services.backup.restoreTo(backup.id, restoredPath);
    assert.equal(restored.integrity, 'ok');
    const restoredDb = new Database(restoredPath, { readonly: true });
    assert.equal(restoredDb.prepare('SELECT count(*) AS count FROM tenants').get().count, 1);
    restoredDb.close();

    const backupRow = fx.services.store.db.prepare('SELECT * FROM backup_catalog WHERE id=?').get(backup.id);
    fs.appendFileSync(backupRow.file_path, 'tampered');
    assert.throws(() => fx.services.backup.restoreTo(backup.id, path.join(fx.root, 'restore-2.db')), (error) => error.code === 'backup-corrupt');
  } finally { await fx.close(); }
});

test('account deletion purges only backups containing the tenant, writes a signed deny-restore ledger and removes tenant data', async () => {
  const fx = fixture();
  try {
    const retainedBackup = await fx.services.backup.create();
    const account = register(fx.services, 'delete');
    const context = fx.services.auth.authenticate(account.accessToken);
    const purgedBackup = await fx.services.backup.create();
    const retainedRow = fx.services.store.db.prepare('SELECT * FROM backup_catalog WHERE id=?').get(retainedBackup.id);
    const purgedRow = fx.services.store.db.prepare('SELECT * FROM backup_catalog WHERE id=?').get(purgedBackup.id);
    assert.deepEqual(
      JSON.parse(retainedRow.tenant_ids_json),
      [],
    );
    assert.deepEqual(
      JSON.parse(purgedRow.tenant_ids_json),
      [account.tenantId],
    );
    const receipt = fx.services.dataRights.deleteAccount(context, `DELETE ${account.tenantId}`);
    assert.equal(receipt.status, 'complete');
    assert.equal(receipt.cryptographicErase, true);
    assert.equal(receipt.purgedBackups, 1);
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM tenants WHERE id=?').get(account.tenantId).count, 0);
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM backup_catalog WHERE id=?').get(retainedBackup.id).count, 1);
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM backup_catalog WHERE id=?').get(purgedBackup.id).count, 0);
    assert.equal(fs.existsSync(retainedRow.file_path), true);
    assert.equal(fs.existsSync(purgedRow.file_path), false);
    const ledger = fs.readFileSync(path.join(fx.config.backupDir, 'deletion-ledger.json'), 'utf8');
    assert.match(ledger, new RegExp(account.tenantId));
    assert.equal(fs.readdirSync(fx.config.backupDir).filter((name) => name.endsWith('.db.aes')).length, 1);
  } finally { await fx.close(); }
});

test('rate limits, no-charge entitlement state and local regional failover are deterministic', async () => {
  const limiter = new RateLimiter(loadConfig({ port: 0 }));
  limiter.consume('subject', 2, 0);
  limiter.consume('subject', 2, 0);
  assert.throws(() => limiter.consume('subject', 2, 0), (error) => error.code === 'rate-limit');
  const deployment = new LocalDeploymentAdapter('local-a', 'local-b');
  assert.equal(deployment.markUnavailable('local-a').region, 'local-b');
  assert.equal(deployment.markUnavailable('local-b').region, null);

  const fx = fixture();
  try {
    const account = register(fx.services, 'billing');
    const context = fx.services.auth.authenticate(account.accessToken);
    fx.services.entitlements.transition(context, 'active');
    const state = fx.services.entitlements.transition(context, 'past_due');
    assert.equal(state.state, 'past_due');
    assert.equal(state.billingEnabled, false);
    assert.equal(state.chargesCreated, 0);
    fx.services.entitlements.transition(context, 'active');
    const refunded = fx.services.entitlements.transition(context, 'refunded');
    assert.equal(refunded.state, 'refunded');
    assert.equal(refunded.chargesCreated, 0);
  } finally { await fx.close(); }
});

test('provider outage is bounded and does not persist the prompt', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'outage');
    const context = fx.services.auth.authenticate(account.accessToken);
    fx.services.model.provider = new UnavailableModelProvider();
    const prompt = 'provider-outage-private-prompt-91a7';
    await assert.rejects(() => fx.services.model.infer(context, { prompt, mode: 'companion' }), (error) => error.code === 'model-unavailable');
    const rows = fx.services.store.db.prepare('SELECT details_enc FROM audit_events WHERE tenant_id=?').all(account.tenantId);
    assert.equal(JSON.stringify(rows).includes(prompt), false);
  } finally { await fx.close(); }
});

test('HTTP API v1 uses problem details, strict inputs and exposes no desktop computer-tool boundary', async () => {
  const fx = fixture();
  try {
    const address = await fx.app.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const post = (url, body, headers = {}) => fetch(`${base}${url}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const registration = await post('/v1/auth/register', {
      tenantName: 'HTTP Tenant', email: 'http@example.test', password: 'correct horse battery staple http', deviceName: 'HTTP Device', platform: 'test',
    });
    assert.equal(registration.status, 201);
    const account = await registration.json();
    const auth = { authorization: `Bearer ${account.accessToken}`, 'content-type': 'application/json' };
    const request = {
      resourceId: 'memory.http', resourceType: 'memory', schemaVersion: 1, baseVector: {}, payload: { value: 7 }, deleted: false,
    };
    const put = await fetch(`${base}/v1/sync/records/memory.http`, {
      method: 'PUT', headers: { ...auth, 'idempotency-key': 'http-idem-0001' }, body: JSON.stringify(request),
    });
    assert.equal(put.status, 200);
    assert.equal(put.headers.get('athena-api-version'), '1');
    const replay = await fetch(`${base}/v1/sync/records/memory.http`, {
      method: 'PUT', headers: { ...auth, 'idempotency-key': 'http-idem-0001' }, body: JSON.stringify(request),
    });
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    const crossBoundary = await fetch(`${base}/v1/computer/tools`, { headers: auth });
    assert.equal(crossBoundary.status, 404);
    assert.equal(crossBoundary.headers.get('content-type'), 'application/problem+json');
    const badInput = await post('/v1/model/responses', { prompt: 'hello', mode: 'create', execute: true }, {
      authorization: auth.authorization, 'idempotency-key': 'http-idem-0002',
    });
    assert.equal(badInput.status, 400);
    assert.equal((await badInput.json()).title, 'unknown-properties');
  } finally { await fx.close(); }
});

test('HTTP responses expose byte-accurate origin body sizes while 204 responses omit them', async () => {
  const fx = fixture();
  try {
    const account = register(fx.services, 'framing');
    const context = fx.services.auth.authenticate(account.accessToken);
    fx.services.sync.put(context, {
      resourceId: 'memory.framing', resourceType: 'memory', schemaVersion: 1, baseVector: {},
      payload: { text: '中文响应长度' }, deleted: false,
    });
    const job = fx.services.dataRights.createExport(context);
    const address = await fx.app.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${account.accessToken}` };

    const jsonResponse = await fetch(`${base}/v1/sync/records/memory.framing`, { headers });
    const jsonBytes = Buffer.from(await jsonResponse.arrayBuffer());
    const jsonText = jsonBytes.toString('utf8');
    assert.equal(jsonResponse.status, 200);
    assert.equal(jsonResponse.headers.get('athena-body-bytes'), String(Buffer.byteLength(jsonText, 'utf8')));
    assert.equal(JSON.parse(jsonText).payload.text, '中文响应长度');
    assert.equal(jsonBytes.length > jsonText.length, true, 'the fixture must distinguish UTF-8 bytes from JavaScript string length');

    const bufferResponse = await fetch(`${base}/v1/data/exports/${job.jobId}`, { headers });
    const bufferBytes = Buffer.from(await bufferResponse.arrayBuffer());
    const bufferText = bufferBytes.toString('utf8');
    assert.equal(bufferResponse.status, 200);
    assert.equal(bufferResponse.headers.get('athena-body-bytes'), String(bufferBytes.length));
    assert.equal(bufferResponse.headers.get('content-type'), 'application/json');
    assert.match(bufferResponse.headers.get('content-disposition'), /^attachment; filename="athena-export-/);
    assert.equal(JSON.parse(bufferText).syncRecords[0].payload.text, '中文响应长度');

    const noContentResponse = await fetch(`${base}/v1/auth/logout`, { method: 'POST', headers });
    assert.equal(noContentResponse.status, 204);
    assert.equal(noContentResponse.headers.get('athena-body-bytes'), null);
    assert.equal((await noContentResponse.arrayBuffer()).byteLength, 0);
  } finally { await fx.close(); }
});
