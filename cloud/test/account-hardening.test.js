'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createCloudApp } = require('../src/server');
const { totp } = require('../src/crypto');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-account-'));
  const config = loadConfig({
    port: 0,
    dbPath: path.join(root, 'cloud.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
    authRateLimitPerMinute: 1000,
    rateLimitPerMinute: 1000,
    ...overrides,
  });
  let app = createCloudApp(config);
  return {
    root,
    config,
    get app() { return app; },
    get services() { return app.services; },
    async listen() {
      const address = await app.listen();
      return `http://127.0.0.1:${address.port}`;
    },
    async reopen() {
      await app.close();
      app = createCloudApp(config);
      return app;
    },
    async close() {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function client(base) {
  return async (method, route, body, token, headers = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: response.status, json, headers: response.headers };
  };
}

const PASSWORD = 'correct horse battery staple';

function loginBody(tenantId, email, extra = {}) {
  return { tenantId, email, password: PASSWORD, mfaCode: null, recoveryCode: null, deviceName: 'Desktop', platform: 'desktop', ...extra };
}

/**
 * Everything the database holds on disk, WAL included.
 *
 * The store runs in WAL mode, so a freshly written row lives in `-wal` until a
 * checkpoint. A scan of the main file alone reads a 4 KB header and passes no
 * matter what was written in plaintext. The caller also has to prove the scan
 * sees data at all, with a value that is stored in the clear on purpose.
 */
function databaseBytes(fx) {
  fx.services.store.db.pragma('wal_checkpoint(TRUNCATE)');
  const files = [fx.config.dbPath, `${fx.config.dbPath}-wal`].filter((file) => fs.existsSync(file));
  return Buffer.concat(files.map((file) => fs.readFileSync(file))).toString('latin1');
}

function utf8Needle(value) {
  return Buffer.from(value, 'utf8').toString('latin1');
}

test('a weak password is refused as a client error, before any tenant exists', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    const response = await call('POST', '/v1/auth/register', {
      tenantName: 'Weak', email: 'weak@example.test', password: 'short', deviceName: 'Desktop', platform: 'desktop',
    });
    // It used to escape as a plain Error and come back as 500 "An internal
    // error occurred", which tells a person nothing about their password.
    assert.equal(response.status, 400);
    assert.equal(response.json.title, 'invalid-password');
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM tenants').get().count, 0);

    const account = fx.services.auth.registerTenant({
      tenantName: 'Recover', email: 'recover@example.test', password: PASSWORD, deviceName: 'Desktop', platform: 'desktop',
    });
    const request = fx.services.auth.requestRecovery({ tenantId: account.tenantId, email: 'recover@example.test' });
    const completion = await call('POST', '/v1/auth/recovery/complete', {
      tenantId: account.tenantId, token: request.localToken, newPassword: 'short',
    });
    assert.equal(completion.status, 400);
    assert.equal(completion.json.title, 'invalid-password');
    // A refused new password must not burn the one-time token.
    const retry = await call('POST', '/v1/auth/recovery/complete', {
      tenantId: account.tenantId, token: request.localToken, newPassword: 'a much longer new password',
    });
    assert.equal(retry.status, 200);
  } finally { await fx.close(); }
});

test('signing out gives the device slot back', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Cycles', email: 'cycles@example.test', password: PASSWORD, deviceName: 'Desktop', platform: 'desktop',
    });
    assert.equal(registered.status, 201);
    const { tenantId } = registered.json;
    assert.equal((await call('POST', '/v1/auth/logout', null, registered.json.accessToken)).status, 204);

    // maxDevicesPerUser is 8. Before, every login made a device and logout left
    // it active, so the ninth sign-in on the same computer was refused for good.
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const login = await call('POST', '/v1/auth/login', loginBody(tenantId, 'cycles@example.test'));
      assert.equal(login.status, 200, `sign-in ${cycle + 2} was refused: ${JSON.stringify(login.json)}`);
      assert.equal((await call('POST', '/v1/auth/logout', null, login.json.accessToken)).status, 204);
      assert.equal((await call('GET', '/v1/devices', null, login.json.accessToken)).status, 401, 'a signed-out session must stop working');
    }
    const active = fx.services.store.db.prepare("SELECT count(*) AS count FROM devices WHERE tenant_id=? AND status='active'").get(tenantId).count;
    assert.equal(active, 0);
  } finally { await fx.close(); }
});

test('the local pairing account does not keep a device nobody holds', async () => {
  const fx = fixture();
  try {
    const offer = fx.services.pairing.offer({ remoteAddress: '127.0.0.1' });
    const phone = fx.services.pairing.claim({ remoteAddress: '192.168.1.20', code: offer.code, deviceName: 'Pixel', platform: 'android' });
    const devices = fx.services.auth.listDevices(fx.services.auth.authenticate(phone.accessToken));
    // registerTenant opens a session for a device called "Athena Desktop" that
    // is thrown away. Left active it shows up in the phone's device list as a
    // computer that was never connected.
    assert.deepEqual(devices.filter((device) => device.status === 'active').map((device) => device.name), ['Pixel']);
  } finally { await fx.close(); }
});

test('ordinary account reads do not consume the authentication budget or block logout', async () => {
  const fx = fixture({ authRateLimitPerMinute: 10, rateLimitPerMinute: 120 });
  const fixedNow = Date.now();
  const consume = fx.services.rate.consume.bind(fx.services.rate);
  fx.services.rate.consume = (key, limit) => consume(key, limit, fixedNow);
  try {
    const call = client(await fx.listen());
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Rate separation', email: 'rate-separation@example.test', password: PASSWORD,
      deviceName: 'Desktop', platform: 'desktop',
    });
    assert.equal(registered.status, 201);
    for (let read = 0; read < 12; read += 1) {
      assert.equal((await call('GET', '/v1/account', null, registered.json.accessToken)).status, 200);
    }
    const logout = await call('POST', '/v1/auth/logout', null, registered.json.accessToken);
    assert.equal(logout.status, 204, 'normal sync/status traffic must not spend the smaller authentication allowance');
    const device = fx.services.store.db.prepare('SELECT status FROM devices WHERE id=?').get(registered.json.device.id);
    assert.equal(device.status, 'revoked');
    assert.equal((await call('GET', '/v1/account', null, registered.json.accessToken)).status, 401);
  } finally { await fx.close(); }
});

test('authentication throttling remains enforced independently of the API budget', async () => {
  const fx = fixture({ authRateLimitPerMinute: 3, rateLimitPerMinute: 3 });
  const fixedNow = Date.now();
  const consume = fx.services.rate.consume.bind(fx.services.rate);
  fx.services.rate.consume = (key, limit) => consume(key, limit, fixedNow);
  try {
    const call = client(await fx.listen());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await call('POST', '/v1/auth/login', loginBody(null, 'missing@example.test'));
      assert.equal(response.status, 401);
    }
    const limited = await call('POST', '/v1/auth/login', loginBody(null, 'missing@example.test'));
    assert.equal(limited.status, 429);
    assert.equal(limited.json.title, 'rate-limit');
    assert.equal((await call('GET', '/health/ready')).status, 200, 'authentication failures must not exhaust ordinary API traffic');
  } finally { await fx.close(); }
});

test('ordinary IP throttling remains enforced without consuming authentication allowance', async () => {
  const fx = fixture({ authRateLimitPerMinute: 3, rateLimitPerMinute: 3 });
  const fixedNow = Date.now();
  const consume = fx.services.rate.consume.bind(fx.services.rate);
  fx.services.rate.consume = (key, limit) => consume(key, limit, fixedNow);
  try {
    const call = client(await fx.listen());
    for (let read = 0; read < 3; read += 1) assert.equal((await call('GET', '/health/ready')).status, 200);
    const limited = await call('GET', '/health/ready');
    assert.equal(limited.status, 429);
    assert.equal(limited.json.title, 'rate-limit');
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Independent auth', email: 'independent-auth@example.test', password: PASSWORD,
      deviceName: 'Desktop', platform: 'desktop',
    });
    assert.equal(registered.status, 201);
  } finally { await fx.close(); }
});

test('enrolling MFA again cannot switch MFA off', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Mfa', email: 'mfa@example.test', password: PASSWORD, deviceName: 'Phone', platform: 'android',
    });
    const token = registered.json.accessToken;
    const { tenantId } = registered.json;
    const setup = await call('POST', '/v1/auth/mfa/setup', null, token);
    assert.equal((await call('POST', '/v1/auth/mfa/confirm', { code: totp(setup.json.secret) }, token)).status, 200);

    // Any bearer session used to be able to call setup again, which replaced
    // the secret and cleared mfa_enabled: MFA quietly turned off.
    const again = await call('POST', '/v1/auth/mfa/setup', null, token);
    assert.equal(again.status, 409);
    assert.equal(again.json.title, 'mfa-already-enabled');
    const withoutCode = await call('POST', '/v1/auth/login', loginBody(tenantId, 'mfa@example.test'));
    assert.equal(withoutCode.status, 401);
    assert.equal(withoutCode.json.title, 'mfa-required');

    // Turning it off takes proof from the authenticator, not just a session.
    const wrong = await call('POST', '/v1/auth/mfa/disable', { code: '000000' }, token);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.title, 'invalid-mfa');
    const disabled = await call('POST', '/v1/auth/mfa/disable', { code: totp(setup.json.secret) }, token);
    assert.equal(disabled.status, 200);
    assert.equal(disabled.json.enabled, false);
    assert.equal((await call('POST', '/v1/auth/login', loginBody(tenantId, 'mfa@example.test'))).status, 200);
    assert.equal((await call('POST', '/v1/auth/mfa/setup', null, token)).status, 200, 'enrolling again after an explicit disable works');
  } finally { await fx.close(); }
});

test('wrong MFA codes count toward the lockout, a missing code does not', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Guess', email: 'guess@example.test', password: PASSWORD, deviceName: 'Phone', platform: 'android',
    });
    const token = registered.json.accessToken;
    const { tenantId } = registered.json;
    const setup = await call('POST', '/v1/auth/mfa/setup', null, token);
    await call('POST', '/v1/auth/mfa/confirm', { code: totp(setup.json.secret) }, token);

    // A client that does not know yet whether MFA is on sends no code first.
    for (let probe = 0; probe < 6; probe += 1) {
      assert.equal((await call('POST', '/v1/auth/login', loginBody(tenantId, 'guess@example.test'))).json.title, 'mfa-required');
    }
    assert.equal(fx.services.store.db.prepare('SELECT failed_logins FROM users WHERE tenant_id=?').get(tenantId).failed_logins, 0);

    // With the password known, the six digits were the only barrier and
    // guessing them never counted.
    for (let guess = 0; guess < 5; guess += 1) {
      await call('POST', '/v1/auth/login', loginBody(tenantId, 'guess@example.test', { mfaCode: String(guess).padStart(6, '0') }));
    }
    const locked = await call('POST', '/v1/auth/login', loginBody(tenantId, 'guess@example.test', { mfaCode: totp(setup.json.secret) }));
    assert.equal(locked.status, 429);
    assert.equal(locked.json.title, 'account-locked');
  } finally { await fx.close(); }
});

test('the replay cache never holds conversation or model text in plaintext', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Replay', email: 'replay@example.test', password: PASSWORD, deviceName: 'Desktop', platform: 'desktop',
    });
    const token = registered.json.accessToken;
    const { tenantId } = registered.json;
    const turn = `replay-canary-对话-${crypto.randomBytes(6).toString('hex')}`;
    const prompt = `prompt-canary-${crypto.randomBytes(6).toString('hex')}`;
    const record = {
      resourceId: 'conversation.desktop-1', resourceType: 'conversation', schemaVersion: 1, baseVector: {},
      payload: { origin: 'desktop', title: 'Replay', mode: 'companion', turns: [{ role: 'user', content: turn }] }, deleted: false,
    };
    const put = await call('PUT', '/v1/sync/records/conversation.desktop-1', record, token, { 'idempotency-key': 'replay-sync-0001' });
    assert.equal(put.status, 200);
    const model = await call('POST', '/v1/model/responses', { prompt, mode: 'companion', history: [] }, token, { 'idempotency-key': 'replay-model-0001' });
    assert.equal(model.status, 200);
    assert.ok(model.json.text.includes(prompt), 'the local fixture echoes the prompt, so the response carries the canary');

    const bytes = databaseBytes(fx);
    assert.ok(bytes.includes(tenantId), 'the scan must see stored rows, or its negative results mean nothing');
    assert.equal(bytes.includes(utf8Needle(turn)), false, 'a synced turn was written to the replay cache in plaintext');
    assert.equal(bytes.includes(prompt), false, 'a model answer was written to the replay cache in plaintext');

    // Replays still return the original result, including after a key rotation.
    const replay = await call('PUT', '/v1/sync/records/conversation.desktop-1', record, token, { 'idempotency-key': 'replay-sync-0001' });
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    assert.equal(replay.json.record.payload.turns[0].content, turn);
    fx.services.store.rotateTenantKey(tenantId);
    const afterRotation = await call('POST', '/v1/model/responses', { prompt, mode: 'companion', history: [] }, token, { 'idempotency-key': 'replay-model-0001' });
    assert.equal(afterRotation.headers.get('idempotency-replayed'), 'true');
    assert.equal(afterRotation.json.text, model.json.text);
    assert.equal(databaseBytes(fx).includes(prompt), false, 'rotation must not leave a plaintext copy behind');

    // Expired entries go away instead of accumulating forever.
    fx.services.store.db.prepare('UPDATE idempotency SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    fx.services.idempotency.purgeExpired(0);
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM idempotency').get().count, 0);
  } finally { await fx.close(); }
});

test('replay entries written before encryption are removed at startup', async () => {
  const fx = fixture();
  try {
    const account = fx.services.auth.registerTenant({
      tenantName: 'Legacy', email: 'legacy@example.test', password: PASSWORD, deviceName: 'Desktop', platform: 'desktop',
    });
    const legacyText = `legacy-plaintext-${crypto.randomBytes(6).toString('hex')}`;
    fx.services.store.db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?,?,?,?)').run(
      account.tenantId, 'PUT:/v1/sync/records/memory.legacy', 'legacy-key-0001', 'hash', 200,
      JSON.stringify({ outcome: 'accepted', record: { payload: { text: legacyText } } }),
      new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString(),
    );
    await fx.reopen();
    assert.equal(fx.services.store.db.prepare('SELECT count(*) AS count FROM idempotency').get().count, 0);
    assert.equal(databaseBytes(fx).includes(legacyText), false);
  } finally { await fx.close(); }
});

test('GET /v1/account tells a client who it is signed in as', async () => {
  const fx = fixture();
  try {
    const call = client(await fx.listen());
    assert.equal((await call('GET', '/v1/account')).status, 401);
    const registered = await call('POST', '/v1/auth/register', {
      tenantName: 'Who', email: 'Who@Example.test', password: PASSWORD, deviceName: 'Athena Desktop', platform: 'desktop',
    });
    const token = registered.json.accessToken;
    const before = await call('GET', '/v1/account', null, token);
    assert.equal(before.status, 200);
    assert.deepEqual(before.json, {
      tenantId: registered.json.tenantId,
      userId: registered.json.userId,
      email: 'who@example.test',
      role: 'owner',
      mfaEnabled: false,
      device: { id: registered.json.device.id, name: 'Athena Desktop', platform: 'desktop' },
    });
    const setup = await call('POST', '/v1/auth/mfa/setup', null, token);
    assert.equal((await call('GET', '/v1/account', null, token)).json.mfaEnabled, false, 'an unconfirmed enrolment is not MFA');
    await call('POST', '/v1/auth/mfa/confirm', { code: totp(setup.json.secret) }, token);
    assert.equal((await call('GET', '/v1/account', null, token)).json.mfaEnabled, true);
  } finally { await fx.close(); }
});
