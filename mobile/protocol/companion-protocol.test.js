'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../../cloud/src/config');
const { createCloudApp } = require('../../cloud/src/server');
const { AthenaCompanionClient, CompanionError } = require('./companion-client');

async function withServer(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-android-protocol-'));
  const config = loadConfig({
    port: 0,
    dbPath: path.join(root, 'cloud.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
  });
  const app = createCloudApp(config);
  const address = await app.listen();
  const client = new AthenaCompanionClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    platform: 'android',
  });
  try {
    await run(client, app);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Android companion protocol covers auth, three modes, sync, search, privacy and fail-closed Execute', async () => {
  await withServer(async (client) => {
    const health = await client.health();
    assert.equal(health.live.status, 'live');
    assert.equal(health.ready.status, 'ready');

    const account = await client.register({
      tenantName: 'Android Companion',
      email: 'android-owner@example.test',
      password: 'correct horse battery staple android',
      deviceName: 'Pixel fixture',
    });
    assert.ok(account.accessToken);
    assert.equal(account.device.platform, 'android');

    await assert.rejects(() => client.infer({ prompt: 'hello', mode: 'companion' }),
      (error) => error instanceof CompanionError && error.code === 'consent-required');
    client.networkConsent.remoteModel = true;
    client.networkConsent.webSearch = true;

    await assert.rejects(() => client.infer({ prompt: 'delete files', mode: 'execute' }),
      (error) => error instanceof CompanionError && error.code === 'invalid-mode');

    const companion = await client.infer({ prompt: 'Keep me company.', mode: 'companion' });
    const create = await client.infer({ prompt: 'Write a tiny caption.', mode: 'create', history: [{ role: 'user', content: 'Earlier idea.' }] });
    const reason = await client.infer({ prompt: 'Check this plan.', mode: 'reason' });
    assert.match(companion.text, /\[companion/);
    assert.match(create.text, /history=1/);
    assert.match(reason.text, /\[reason/);

    const search = await client.search({ query: 'current weather fixture', maxResults: 2 });
    assert.equal(search.untrustedExternalEvidence, true);
    assert.equal(search.provider, 'local-fixture');
    assert.equal(search.retained.query, false);

    const accepted = await client.putRecord({
      resourceId: 'conversation.android-1',
      resourceType: 'conversation',
      schemaVersion: 1,
      baseVector: {},
      payload: { title: 'First Android chat', mode: 'companion' },
      deleted: false,
    });
    assert.equal(accepted.outcome, 'accepted');
    const memory = await client.putRecord({
      resourceId: 'memory.android-note',
      resourceType: 'memory',
      schemaVersion: 1,
      baseVector: {},
      payload: { kind: 'note', text: 'Prefers short replies.' },
      deleted: false,
    });
    const conflict = await client.putRecord({
      resourceId: 'memory.android-note',
      resourceType: 'memory',
      schemaVersion: 1,
      baseVector: {},
      payload: { kind: 'note', text: 'stale' },
      deleted: false,
    });
    assert.equal(conflict.outcome, 'conflict');
    const resolved = await client.putRecord({
      resourceId: 'memory.android-note',
      resourceType: 'memory',
      schemaVersion: 1,
      baseVector: memory.record.vector,
      payload: { kind: 'note', text: 'Prefers short replies and tea.' },
      deleted: false,
    });
    assert.equal(resolved.outcome, 'accepted');

    const changes = await client.listChanges();
    assert.ok(changes.records.some((item) => item.resourceId === 'conversation.android-1'));
    const devices = await client.listDevices();
    assert.ok(Array.isArray(devices.devices) && devices.devices.length >= 1);
    const entitlements = await client.entitlements();
    assert.equal(entitlements.billingEnabled, false);

    const exported = await client.exportData();
    assert.ok(exported.jobId);
    const deleted = await client.deleteAccount();
    assert.equal(deleted.status, 'complete');
    assert.equal(deleted.cryptographicErase, true);
  });
});

test('production flavor refuses empty or non-loopback cleartext Cloud URLs', () => {
  const missing = new AthenaCompanionClient({ baseUrl: '', platform: 'android' });
  assert.throws(() => missing.requireBaseUrl(), (error) => error.code === 'base-url-missing');
  const remoteHttp = new AthenaCompanionClient({ baseUrl: 'http://example.test', platform: 'android' });
  assert.throws(() => remoteHttp.requireBaseUrl(), (error) => error.code === 'cleartext-forbidden');
  const loopback = new AthenaCompanionClient({ baseUrl: 'http://10.0.2.2:8787', platform: 'android' });
  loopback.requireBaseUrl();
});
