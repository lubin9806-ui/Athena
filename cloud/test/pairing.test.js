'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createCloudApp } = require('../src/server');
const { PairingService } = require('../src/pairing');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-pairing-test-'));
  const config = loadConfig({
    port: 0,
    dbPath: path.join(root, 'cloud.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
    ...overrides,
  });
  const app = createCloudApp(config);
  return {
    services: app.services,
    async close() { await app.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('a code offered on the host can be claimed from the local network', async () => {
  const it = fixture();
  try {
    const offer = it.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    assert.match(offer.code, /^\d{6}$/);
    assert.equal(offer.expiresInSeconds, 90);

    const session = it.services.pairing.claim({
      remoteAddress: '192.168.1.42',
      code: offer.code,
      deviceName: 'Pixel',
      platform: 'android',
    });
    assert.ok(session.accessToken && session.refreshToken);
    assert.equal(session.device.platform, 'android');

    // The session is ordinary: it authenticates, and it is listed and revocable
    // like any other device rather than being an invisible back door.
    const context = it.services.auth.authenticate(session.accessToken);
    assert.equal(context.tenantId, session.tenantId);
    const devices = it.services.auth.listDevices(context);
    assert.ok(devices.some((device) => device.id === session.device.id));
  } finally {
    await it.close();
  }
});

test('only the host may offer a code', async () => {
  const it = fixture();
  try {
    // Otherwise any device on the network could ask for a code and immediately
    // claim it, which is the whole attack this split exists to prevent.
    for (const address of ['192.168.1.42', '10.0.0.9', '203.0.113.7', '::ffff:192.168.1.42']) {
      assert.throws(
        () => it.services.pairing.offer({ remoteAddress: address }),
        (error) => error.code === 'pairing-host-only' && error.status === 403,
        `offer accepted from ${address}`,
      );
    }
    // IPv4 mapped into IPv6 still counts as the host.
    assert.ok(it.services.pairing.offer({ remoteAddress: '::ffff:127.0.0.1' }).code);
    assert.ok(it.services.pairing.offer({ remoteAddress: '::1' }).code);
  } finally {
    await it.close();
  }
});

test('claiming is refused from outside the local network', async () => {
  const it = fixture();
  try {
    const offer = it.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    assert.throws(
      () => it.services.pairing.claim({ remoteAddress: '203.0.113.7', code: offer.code, deviceName: 'X', platform: 'android' }),
      (error) => error.code === 'pairing-network-only' && error.status === 403,
    );
    // 172.15 and 172.32 sit just outside the private block.
    for (const address of ['172.15.0.1', '172.32.0.1', '8.8.8.8']) {
      assert.throws(
        () => it.services.pairing.claim({ remoteAddress: address, code: offer.code, deviceName: 'X', platform: 'android' }),
        (error) => error.code === 'pairing-network-only',
        `claim accepted from ${address}`,
      );
    }
    assert.ok(it.services.pairing.claim({ remoteAddress: '172.16.0.5', code: offer.code, deviceName: 'X', platform: 'android' }).accessToken);
  } finally {
    await it.close();
  }
});

test('a code works once', async () => {
  const it = fixture();
  try {
    const offer = it.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    it.services.pairing.claim({ remoteAddress: '192.168.1.5', code: offer.code, deviceName: 'first', platform: 'android' });
    assert.throws(
      () => it.services.pairing.claim({ remoteAddress: '192.168.1.6', code: offer.code, deviceName: 'second', platform: 'android' }),
      (error) => error.code === 'invalid-code',
    );
  } finally {
    await it.close();
  }
});

test('a code expires', async () => {
  const it = fixture();
  try {
    const offer = it.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    // Reach into the pending entry rather than sleeping ninety seconds.
    it.services.pairing.pending.get(offer.code).expiresAt = Date.now() - 1;
    assert.throws(
      () => it.services.pairing.claim({ remoteAddress: '192.168.1.5', code: offer.code, deviceName: 'late', platform: 'android' }),
      (error) => error.code === 'invalid-code',
    );
  } finally {
    await it.close();
  }
});

test('guessing pauses after three wrong codes', async () => {
  const it = fixture();
  try {
    it.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.throws(
        () => it.services.pairing.claim({ remoteAddress: '192.168.1.5', code: '000000', deviceName: 'x', platform: 'android' }),
        (error) => error.code === 'invalid-code',
      );
    }
    assert.throws(
      () => it.services.pairing.claim({ remoteAddress: '192.168.1.5', code: '111111', deviceName: 'x', platform: 'android' }),
      (error) => error.code === 'pairing-locked' && error.status === 429,
    );
  } finally {
    await it.close();
  }
});

test('a second phone joins the same account rather than a parallel one', async () => {
  const it = fixture();
  try {
    const first = it.services.pairing.claim({
      remoteAddress: '192.168.1.5',
      code: it.services.pairing.offer({ remoteAddress: '127.0.0.1' }).code,
      deviceName: 'phone one',
      platform: 'android',
    });
    const second = it.services.pairing.claim({
      remoteAddress: '192.168.1.6',
      code: it.services.pairing.offer({ remoteAddress: '127.0.0.1' }).code,
      deviceName: 'phone two',
      platform: 'android',
    });
    // Same tenant and user: otherwise the two phones would sync into separate
    // worlds and neither would see the other's conversations.
    assert.equal(second.tenantId, first.tenantId);
    assert.equal(second.userId, first.userId);
    assert.notEqual(second.device.id, first.device.id);
  } finally {
    await it.close();
  }
});

test('a signed-in caller pairs the phone into that account', async () => {
  const it = fixture();
  try {
    const owner = it.services.auth.registerTenant({
      tenantName: 'Real Account',
      email: 'owner@example.test',
      password: 'correct horse battery staple',
      deviceName: 'Desktop',
      platform: 'desktop',
    });
    const context = it.services.auth.authenticate(owner.accessToken);
    const offer = it.services.pairing.offer({ remoteAddress: '127.0.0.1', context });
    const session = it.services.pairing.claim({
      remoteAddress: '192.168.1.5',
      code: offer.code,
      deviceName: 'Pixel',
      platform: 'android',
    });
    assert.equal(session.tenantId, owner.tenantId);
    assert.equal(session.userId, owner.userId);
  } finally {
    await it.close();
  }
});

test('pairing does not exist outside the local environment', async () => {
  // Production must not carry a route that hands out sessions for a six digit
  // code; it should not even reveal that the path exists.
  const it = fixture({ environment: 'staging' });
  try {
    assert.throws(
      () => it.services.pairing.offer({ remoteAddress: '127.0.0.1' }),
      (error) => error.status === 404,
    );
    assert.throws(
      () => it.services.pairing.claim({ remoteAddress: '192.168.1.5', code: '123456', deviceName: 'x', platform: 'android' }),
      (error) => error.status === 404,
    );
  } finally {
    await it.close();
  }
});

test('codes are six digits and drawn without modulo bias', () => {
  const seen = new Set();
  for (let index = 0; index < 500; index += 1) {
    const code = PairingService.generateCode();
    assert.match(code, /^\d{6}$/);
    seen.add(code);
  }
  // Five hundred draws from a million should essentially never repeat.
  assert.ok(seen.size > 490, `codes repeated too often: ${seen.size}/500`);
});
