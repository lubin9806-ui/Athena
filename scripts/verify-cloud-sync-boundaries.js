'use strict';

// Real Electron settings, encrypted sessions and sync service, with only the
// HTTP endpoint replaced by a deterministic loopback fixture. No user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, safeStorage } = require('electron');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-sync-boundaries-'));
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_CREDENTIALS_DIR = path.join(scratch, 'credentials');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_USE_LOCAL_SETTINGS = '0';
app.setPath('userData', path.join(scratch, 'user-data'));
app.disableHardwareAcceleration();

let held = null;
let writes = [];
let fixtureServer;
let fixtureLogin = 0;
const email = 'sync-boundaries@example.test';
const tenantId = `ten_${'1'.repeat(32)}`;

function deferResponse(prefix, response, statusCode = 200) {
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const released = new Promise(resolve => { releaseResolve = resolve; });
  const gate = { prefix, response, statusCode, enteredResolve, released };
  assert.equal(held, null);
  held = gate;
  return { entered, release: () => releaseResolve() };
}

async function waitForRequest(gate) {
  let timer;
  try {
    await Promise.race([
      gate.entered,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture request did not arrive')), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const feed = {
  records: [{
    resourceId: 'preference.adult-mode', resourceType: 'preference',
    vector: { [`dev_${'2'.repeat(32)}`]: 1 },
    payload: { origin: 'android', schemaVersion: 1, enabled: false },
  }],
  nextCursor: null,
};

async function main() {
  await app.whenReady();
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'Windows encrypted session storage is required');
  fixtureServer = http.createServer(async (req, res) => {
    try {
      for await (const _chunk of req) { /* consume the fixture request */ }
      const route = `${req.method} ${req.url}`;
      let body;
      let statusCode = 200;
      if (route === 'POST /v1/auth/login') {
        fixtureLogin++;
        body = {
          accessToken: 'a'.repeat(64), refreshToken: 'r'.repeat(64), tenantId,
          userId: `usr_${'3'.repeat(32)}`, device: { id: `dev_${String(fixtureLogin).padStart(32, '0')}` },
        };
      } else if (route === 'GET /v1/account') {
        body = { tenantId, userId: `usr_${'3'.repeat(32)}`, email, role: 'owner', mfaEnabled: false };
      } else if (route === 'GET /v1/devices') {
        body = { devices: [] };
      } else if (route.startsWith('GET /v1/sync/changes')) {
        body = { records: [], nextCursor: null };
      } else if (route.startsWith('PUT /v1/sync/records/')) {
        writes.push(decodeURIComponent(req.url.split('/').pop()));
        body = { outcome: 'accepted', record: { vector: { [`dev_${'2'.repeat(32)}`]: 1 } } };
      } else if (route === 'POST /v1/auth/logout') {
        body = { status: 'ok' };
      } else {
        throw new Error(`unexpected fixture route ${route}`);
      }
      if (held && route.startsWith(held.prefix)) {
        const gate = held;
        held = null;
        gate.enteredResolve();
        await gate.released;
        body = gate.response ?? body;
        statusCode = gate.statusCode;
      }
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ title: 'fixture-error', detail: error.message }));
    }
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${fixtureServer.address().port}`;
  const settings = require('../dist/core/config/SettingsStore.js');
  const service = require('../dist/core/cloud/CloudAccountService.js');
  const categories = {
    conversations: false, memories: false, persona: false, preferences: false,
    reminders: false, backgroundImage: false, adultMode: true,
  };
  function patch(cloud = {}, privacy) {
    settings.saveSettingsBundle({ settings: {
      cloud,
      ...(privacy ? { privacy: { networkConsent: { cloudSync: privacy.cloudSync } } } : {}),
    } });
  }
  async function prepare(extra = {}) {
    settings.saveSettingsBundle({ settings: {
      developerMode: true,
      conversation: { adultModeEnabled: true },
      privacy: { networkConsent: { cloudSync: true } },
      cloud: { baseUrl: endpoint, email, syncEnabled: true, mergeReviewedAccount: email, syncCategories: { ...categories, ...extra } },
    } });
    await service.loginCloudAccount({ email, password: 'fixture-only-password' });
    patch({ syncEnabled: true });
    writes = [];
  }
  async function interruptedPull(label, mutate) {
    await prepare();
    const gate = deferResponse('GET /v1/sync/changes', feed);
    const result = service.syncCloudAccountNow('cloud');
    // Attach the rejection expectation before releasing the held response.
    const rejected = assert.rejects(result, error => error.code === 'sync-settings-changed' || error.code === 'sync-session-changed');
    try {
      await waitForRequest(gate);
      await mutate();
    } finally {
      gate.release();
    }
    await rejected;
    assert.equal(settings.getAppSettings().conversation.adultModeEnabled, true, `${label}: a late feed applied disabled data`);
    assert.deepEqual(writes, [], `${label}: a disabled sync uploaded content`);
    console.log(`PASS ${label}`);
  }

  await interruptedPull('master-off-during-pull', () => patch({ syncEnabled: false }));
  await interruptedPull('category-off-during-pull', () => patch({ syncCategories: { adultMode: false } }));
  await interruptedPull('off-on-does-not-revive-old-work', () => {
    patch({ syncEnabled: false });
    patch({ syncEnabled: true });
  });
  await interruptedPull('privacy-consent-revoked-during-pull', () => patch({}, { cloudSync: false }));
  await interruptedPull('logout-during-pull-does-not-resurrect-session', () => service.logoutCloudAccount());
  assert.equal(service.getCloudAccountStatus().signedIn, false);

  await prepare({ preferences: true });
  const pushGate = deferResponse('PUT /v1/sync/records/preference.adult-mode');
  const push = service.syncCloudAccountNow();
  const pushRejected = assert.rejects(push, error => error.code === 'sync-settings-changed');
  try {
    await waitForRequest(pushGate);
    patch({ syncEnabled: false });
  } finally {
    pushGate.release();
  }
  await pushRejected;
  assert.deepEqual(writes, ['preference.adult-mode'], 'already-sent write is allowed, but later preference must not upload');
  console.log('PASS master-off-during-push-stops-later-writes');

  await prepare();
  const statusGate = deferResponse('GET /v1/account');
  const refresh = service.refreshCloudAccountStatus();
  try {
    await waitForRequest(statusGate);
    await service.logoutCloudAccount();
  } finally {
    statusGate.release();
  }
  await refresh;
  assert.equal(service.getCloudAccountStatus().signedIn, false, 'late account refresh resurrected the logged-out session');
  assert.equal(fs.existsSync(path.join(process.env.ATHENA_CREDENTIALS_DIR, 'cloud-session.enc.json')), false);
  console.log('PASS late-account-refresh-keeps-logout');

  await prepare({ preferences: true });
  const failedWrite = deferResponse('PUT /v1/sync/records/preference.adult-mode', { title: 'service-unavailable' }, 503);
  const failedSync = service.syncCloudAccountNow();
  const failedRejected = assert.rejects(failedSync, error => error.status === 503);
  try {
    await waitForRequest(failedWrite);
  } finally {
    failedWrite.release();
  }
  await failedRejected;
  assert.deepEqual(writes, ['preference.adult-mode']);
  assert.equal(service.getCloudAccountStatus().lastSyncAt, null, 'failed uploads must not be labelled as a successful sync');
  console.log('PASS failed-upload-is-not-reported-successful');

  await prepare();
  await service.logoutCloudAccount();
  assert.equal(settings.getAppSettings().cloud.syncEnabled, false, 'logout must disable the persisted sync choice');
  const relogin = await service.loginCloudAccount({ email, password: 'fixture-only-password' });
  assert.equal(relogin.signedIn, true);
  assert.equal(relogin.syncEnabled, false, 'manual login must not turn sync back on');
  console.log('PASS logout-and-manual-login-keep-sync-off');

  await prepare();
  const healthy = await service.syncCloudAccountNow();
  assert.equal(healthy.signedIn, true);
  assert.equal(healthy.syncEnabled, true);
  assert.deepEqual(writes, ['preference.adult-mode']);
  await service.logoutCloudAccount();
  console.log('ATHENA_DESKTOP_SYNC_BOUNDARIES_OK cases=10 encryptedSession=real localData=isolated network=loopback');
}

(async () => {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    if (fixtureServer) {
      fixtureServer.closeAllConnections();
      await new Promise(resolve => fixtureServer.close(resolve));
    }
    try { require('../dist/memory/database/index.js').closeDatabase(); } catch { /* lazy DB may not open */ }
    fs.rmSync(scratch, { recursive: true, force: true });
    app.exit(exitCode);
  }
})();
