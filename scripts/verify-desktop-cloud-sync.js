'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.resolve(__dirname, '..');
  const mapperPath = path.join(root, 'dist', 'core', 'cloud', 'CloudSyncMapper.js');
  const protocolPath = path.join(root, 'dist', 'core', 'cloud', 'CloudProtocol.js');
  if (!fs.existsSync(mapperPath) || !fs.existsSync(protocolPath)) {
    throw new Error('dist/core/cloud is missing. Run tsc first.');
  }
  const mapper = require(mapperPath);
  const { CloudProtocol, CloudProtocolError } = require(protocolPath);

  assert.equal(mapper.shouldSyncWindow({ mode: 'companion', is_temporary: false }), true);
  assert.equal(mapper.shouldSyncWindow({ mode: 'execute', is_temporary: false }), false);
  assert.equal(mapper.shouldSyncWindow({ mode: 'companion', is_temporary: true }), false);
  assert.equal(mapper.conversationResourceId(12), 'conversation.desktop-12');

  const payload = mapper.toConversationPayload(
    { title: 'Night chat', mode: 'companion' },
    [{ role: 'user', content: 'hello', created_at: '2026-09-02T00:00:00.000Z' }],
  );
  assert.equal(payload.origin, 'desktop');
  assert.equal(payload.turns.length, 1);

  assert.throws(() => CloudProtocol.assertBaseUrl(''), /基址为空/);
  assert.throws(() => CloudProtocol.assertBaseUrl('http://example.test', true), /HTTPS/);
  assert.equal(CloudProtocol.assertBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');

  const { loadConfig } = require(path.join(root, 'cloud', 'src', 'config'));
  const { createCloudApp } = require(path.join(root, 'cloud', 'src', 'server'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-desktop-cloud-'));
  const app = createCloudApp(loadConfig({
    port: 0,
    dbPath: path.join(temp, 'cloud.db'),
    backupDir: path.join(temp, 'backups'),
    exportDir: path.join(temp, 'exports'),
    masterKey: crypto.randomBytes(32),
  }));
  try {
    const address = await app.listen();
    const client = new CloudProtocol(`http://127.0.0.1:${address.port}`, 'desktop');
    const account = await client.register({
      tenantName: 'Desktop Sync',
      email: 'desktop-sync@example.test',
      password: 'correct horse battery staple desktop',
      deviceName: 'Athena Desktop',
    });
    assert.ok(account.accessToken);
    const pushed = await client.putRecord({
      resourceId: 'conversation.desktop-1',
      resourceType: 'conversation',
      schemaVersion: 1,
      baseVector: {},
      payload,
      deleted: false,
    });
    assert.equal(pushed.outcome, 'accepted');
    const changes = await client.listChanges();
    assert.ok(changes.records.some((item) => item.resourceId === 'conversation.desktop-1'));
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('ATHENA_DESKTOP_CLOUD_SYNC_OK execute=excluded temporary=excluded protocol=v1 production=no-go');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
