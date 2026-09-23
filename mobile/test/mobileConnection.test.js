'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AthenaMobileConnectionClient, MobileCloudConnectionError, parseMobilePairingUri } = require('../dist');
const { loadConfig } = require('../../cloud/src/config');
const { createCloudApp } = require('../../cloud/src/server');

class MemorySessionStore {
  value = null;
  async read() { return this.value; }
  async write(value) { this.value = structuredClone(value); }
  async clear() { this.value = null; }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mobile-connection-'));
  const config = loadConfig({
    host: '127.0.0.1', port: 0, dbPath: path.join(root, 'cloud.db'),
    backupDir: path.join(root, 'backups'), exportDir: path.join(root, 'exports'), masterKey: crypto.randomBytes(32),
  });
  const app = createCloudApp(config);
  return { root, app, async close() { await app.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('a mobile client consumes the Desktop pairing hand-off and appears as a revocable device', async () => {
  const fx = fixture();
  try {
    const address = await fx.app.listen();
    const desktop = fx.app.services.auth.registerTenant({
      tenantName: 'Phone pairing', email: 'phone-pairing@example.test',
      password: 'correct horse battery staple pairing', deviceName: 'Athena Desktop', platform: 'desktop',
    });
    const principal = fx.app.services.auth.authenticate(desktop.accessToken);
    const offer = fx.app.services.pairing.offer({ remoteAddress: '127.0.0.1', context: principal });
    const pairingUri = `athena://pair?version=1&server=${encodeURIComponent(`http://127.0.0.1:${address.port}`)}&code=${offer.code}`;
    const store = new MemorySessionStore();
    const client = new AthenaMobileConnectionClient(store, 'Pixel integration test', 'android', true);

    const status = await client.pairFromUri(pairingUri);
    assert.equal(status.email, 'phone-pairing@example.test');
    assert.equal(status.tenantId, desktop.tenantId);
    assert.ok(status.devices.some(device => device.name === 'Pixel integration test' && device.platform === 'android' && device.status === 'active'));
    assert.ok((await store.read()).refreshToken, 'the injected secure store receives the mobile session');

    await client.disconnect();
    assert.equal(await store.read(), null, 'disconnect clears the secure session store');
    const devices = fx.app.services.auth.listDevices(principal);
    assert.equal(devices.find(device => device.name === 'Pixel integration test').status, 'revoked');
  } finally {
    await fx.close();
  }
});

test('release mobile clients refuse cleartext or malformed Desktop hand-offs', () => {
  assert.throws(
    () => parseMobilePairingUri('athena://pair?version=1&server=http%3A%2F%2F192.168.1.3%3A8787&code=123456'),
    error => error instanceof MobileCloudConnectionError && error.code === 'cleartext-forbidden',
  );
  assert.throws(
    () => parseMobilePairingUri('athena://pair?version=2&server=https%3A%2F%2Fcloud.example.test&code=123456'),
    error => error instanceof MobileCloudConnectionError && error.code === 'pairing-version-unsupported',
  );
  assert.throws(
    () => parseMobilePairingUri('athena://pair?version=1&server=https%3A%2F%2Fcloud.example.test&code=bad'),
    error => error instanceof MobileCloudConnectionError && error.code === 'invalid-code',
  );
});
