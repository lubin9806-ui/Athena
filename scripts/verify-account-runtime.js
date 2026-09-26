'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeImage, safeStorage } = require('electron');

const stagingMode = process.argv.includes('--staging');
const selfSeed = stagingMode || process.env.ATHENA_ACCOUNT_ACCEPTANCE_SELF_SEED === 'true';
const baseUrl = String(
  process.env.ATHENA_ACCOUNT_ACCEPTANCE_URL
  || (stagingMode ? 'https://staging-api.elanastra.com' : ''),
).trim().replace(/\/+$/, '');
let email = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_EMAIL || '').trim().toLowerCase();
let password = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_PASSWORD || '');
const expectedAdultMode = process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'true'
  ? true
  : process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'false'
    ? false
    : selfSeed ? true : null;

if (!baseUrl || (!selfSeed && (!email || !password))) {
  console.error('Set ATHENA_ACCOUNT_ACCEPTANCE_URL, ATHENA_ACCOUNT_ACCEPTANCE_EMAIL, and ATHENA_ACCOUNT_ACCEPTANCE_PASSWORD.');
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-account-runtime-'));
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_CREDENTIALS_DIR = path.join(scratch, 'credentials');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_EXPORT_DIR = path.join(scratch, 'exports');
app.setPath('userData', path.join(scratch, 'user-data'));

function storedSession() {
  const filePath = path.join(process.env.ATHENA_CREDENTIALS_DIR, 'cloud-session.enc.json');
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.blob, 'base64')));
}

async function accountBackground(accessToken) {
  const response = await fetch(`${baseUrl}/v1/sync/records/preference.background`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  assert.equal(response.status, 200, `background record returned HTTP ${response.status}`);
  return response.json();
}

async function jsonRequest(pathname, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { detail: text }; }
  return { response, body };
}

function bearer(accessToken, extra = {}) {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

async function putSeedRecord(accessToken, record) {
  const result = await jsonRequest(`/v1/sync/records/${encodeURIComponent(record.resourceId)}`, {
    method: 'PUT',
    headers: bearer(accessToken, { 'idempotency-key': crypto.randomBytes(16).toString('hex') }),
    body: record,
  });
  assert.equal(result.response.status, 200, `${record.resourceId} seed returned HTTP ${result.response.status}`);
  assert.equal(result.body.outcome, 'accepted', `${record.resourceId} seed was not accepted`);
}

async function seedDisposableAccount() {
  const healthResult = await jsonRequest('/health/ready');
  assert.equal(healthResult.response.status, 200, `staging health returned HTTP ${healthResult.response.status}`);
  assert.equal(healthResult.body.status, 'ready');
  assert.equal(healthResult.body.database, true);
  assert.equal(healthResult.body.deployment?.region, 'singapore');
  assert.equal(healthResult.body.runtimeBindings?.cloudProvider, 'render');
  assert.equal(healthResult.body.runtimeBindings?.billingAdapter, 'local-no-charge');
  assert.equal(healthResult.body.runtimeBindings?.recoveryDeliveryAdapter, 'local-return-token');
  assert.equal(healthResult.body.runtimeBindings?.modelProvider, 'local-fixture');
  assert.equal(healthResult.body.runtimeBindings?.searchProvider, 'local-fixture');

  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  email = `athena-staging-${suffix}@example.test`;
  password = `Athena-staging-${crypto.randomBytes(18).toString('base64url')}!9`;
  let cleanupSeed = null;
  try {
    const registration = await jsonRequest('/v1/auth/register', {
      method: 'POST',
      body: {
        tenantName: `Athena staging acceptance ${suffix}`,
        email,
        password,
        deviceName: 'Athena Android staging seed',
        platform: 'android',
      },
    });
    assert.equal(registration.response.status, 201, `account registration returned HTTP ${registration.response.status}`);
    assert.ok(registration.body.accessToken, 'account registration did not return an access token');

    const seedToken = registration.body.accessToken;
    cleanupSeed = {
      accessToken: seedToken,
      tenantId: registration.body.tenantId,
      seedDeviceId: registration.body.device?.id,
    };
    const bitmap = nativeImage.createFromBitmap(Buffer.from([
      0x26, 0x5f, 0xa8, 0xff, 0xf2, 0xc1, 0x4e, 0xff,
      0xd9, 0x63, 0x73, 0xff, 0x43, 0xaa, 0x8b, 0xff,
    ]), { width: 2, height: 2, scaleFactor: 1 });
    assert.equal(bitmap.isEmpty(), false, 'staging fixture bitmap could not be created');
    const jpeg = bitmap.toJPEG(82);
    const size = nativeImage.createFromBuffer(jpeg).getSize();
    await putSeedRecord(seedToken, {
      resourceId: 'preference.background',
      resourceType: 'preference',
      schemaVersion: 1,
      baseVector: {},
      payload: {
        origin: 'android',
        schemaVersion: 1,
        enabled: true,
        mimeType: 'image/jpeg',
        width: size.width,
        height: size.height,
        sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
        dataBase64: jpeg.toString('base64'),
      },
      deleted: false,
    });
    await putSeedRecord(seedToken, {
      resourceId: 'preference.adult-mode',
      resourceType: 'preference',
      schemaVersion: 1,
      baseVector: {},
      payload: { origin: 'android', schemaVersion: 1, enabled: true },
      deleted: false,
    });

    const probeLogin = await jsonRequest('/v1/auth/login', {
      method: 'POST',
      body: {
        tenantId: registration.body.tenantId,
        email,
        password,
        mfaCode: null,
        recoveryCode: null,
        deviceName: 'Athena revocation probe',
        platform: 'staging-probe',
      },
    });
    assert.equal(probeLogin.response.status, 200, `probe login returned HTTP ${probeLogin.response.status}`);
    const probeDeviceId = probeLogin.body.device?.id;
    assert.match(String(probeDeviceId || ''), /^dev_[a-f0-9]{32}$/);
    const revoked = await jsonRequest(`/v1/devices/${probeDeviceId}`, {
      method: 'DELETE',
      headers: bearer(seedToken),
    });
    assert.equal(revoked.response.status, 204, `device revocation returned HTTP ${revoked.response.status}`);
    const rejectedProbe = await jsonRequest('/v1/account', {
      headers: bearer(probeLogin.body.accessToken),
    });
    assert.equal(rejectedProbe.response.status, 401, 'revoked device session remained usable');

    const recovery = await jsonRequest('/v1/auth/recovery/request', {
      method: 'POST',
      body: { tenantId: registration.body.tenantId, email },
    });
    assert.equal(recovery.response.status, 202, `recovery request returned HTTP ${recovery.response.status}`);
    assert.equal('localToken' in recovery.body, false, 'staging exposed a local recovery token over HTTPS');

    const computerBoundary = await jsonRequest('/v1/computer/tools', { headers: bearer(seedToken) });
    assert.equal(computerBoundary.response.status, 404, 'cloud exposed the desktop computer-tool boundary');

    return cleanupSeed;
  } catch (error) {
    if (cleanupSeed) {
      try {
        await deleteDisposableAccount(cleanupSeed);
        console.log('ATHENA_ACCOUNT_RUNTIME_SEED_CLEANUP_OK cleanup=cryptographic-erase');
      } catch (cleanupError) {
        console.error('Disposable staging seed cleanup failed.', cleanupError);
      }
    }
    throw error;
  }
}

async function deleteDisposableAccount(seed) {
  const deletion = await jsonRequest('/v1/account', {
    method: 'DELETE',
    headers: bearer(seed.accessToken),
    body: { confirmation: `DELETE ${seed.tenantId}` },
  });
  assert.equal(deletion.response.status, 200, `disposable account deletion returned HTTP ${deletion.response.status}`);
  assert.equal(deletion.body.status, 'complete');
  assert.equal(deletion.body.cryptographicErase, true);
}

(async () => {
  let exitCode = 0;
  let seed = null;
  let accountDeleted = false;
  try {
    await app.whenReady();
    if (selfSeed) seed = await seedDisposableAccount();
    const { getAppSettings, saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');
    const {
      getCloudAccountStatus,
      loginCloudAccount,
      logoutCloudAccount,
      syncCloudAccountNow,
    } = require('../dist/core/cloud/CloudAccountService.js');
    const { CloudProtocolError } = require('../dist/core/cloud/CloudProtocol.js');
    const { desktopBackgroundDataUrl } = require('../dist/core/cloud/BackgroundSync.js');

    saveSettingsBundle({
      settings: {
        developerMode: true,
        privacy: { networkConsent: { cloudSync: true } },
        cloud: {
          baseUrl,
          pairingBaseUrl: 'http://127.0.0.1:8787',
          email: '',
          tenantId: '',
          deviceName: 'Athena Desktop account acceptance',
          syncEnabled: false,
          mergeReviewedAccount: '',
          syncCategories: {
            conversations: false,
            memories: false,
            persona: false,
            preferences: false,
            reminders: false,
            backgroundImage: true,
            adultMode: true,
          },
        },
      },
    });

    const signedIn = await loginCloudAccount({ email, password });
    assert.equal(signedIn.signedIn, true, 'desktop runtime did not establish an account session');
    assert.equal(signedIn.syncEnabled, false, 'login enabled sync before the merge decision');

    await assert.rejects(
      () => syncCloudAccountNow(),
      error => error instanceof CloudProtocolError && error.code === 'merge-decision-required',
      'sync was not blocked before the first-login merge decision',
    );

    const current = getAppSettings();
    saveSettingsBundle({
      settings: {
        cloud: {
          ...current.cloud,
          syncEnabled: true,
          mergeReviewedAccount: email,
        },
      },
    });

    await assert.rejects(
      () => syncCloudAccountNow(),
      error => error instanceof CloudProtocolError && error.code === 'merge-conflict',
      'different background versions were not presented as an explicit conflict',
    );

    await syncCloudAccountNow('cloud');
    const dataUrl = desktopBackgroundDataUrl();
    assert.ok(dataUrl?.startsWith('data:image/jpeg;base64,'), 'desktop did not apply the account background');
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    assert.ok(bytes.length > 0 && bytes.length <= 180 * 1024, 'desktop background copy exceeded the safe size bound');
    const size = nativeImage.createFromBuffer(bytes).getSize();
    assert.ok(size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= 1600, 'desktop background dimensions are invalid');

    const session = storedSession();
    assert.equal(session.baseUrl, baseUrl, 'desktop session was not bound to its issuing account endpoint');
    if (seed) {
      const devices = await jsonRequest('/v1/devices', { headers: bearer(seed.accessToken) });
      assert.equal(devices.response.status, 200, `device list returned HTTP ${devices.response.status}`);
      assert.ok(devices.body.devices.some((device) => device.id === session.deviceId && device.status === 'active'));
      assert.ok(devices.body.devices.some((device) => device.id === seed.seedDeviceId && device.status === 'active'));
    }
    const record = await accountBackground(session.accessToken);
    assert.equal(record.payload.origin, 'android', 'using the account version bounced a desktop re-encode back into Cloud');
    assert.equal(record.payload.mimeType, 'image/jpeg');
    assert.equal('path' in record.payload, false);
    assert.equal('originalName' in record.payload, false);
    assert.equal('metadata' in record.payload, false);
    if (expectedAdultMode !== null) {
      assert.equal(
        getAppSettings().conversation.adultModeEnabled,
        expectedAdultMode,
        'desktop did not apply the account adult-mode state',
      );
    }

    await logoutCloudAccount();
    assert.equal(getCloudAccountStatus().signedIn, false);
    assert.ok(desktopBackgroundDataUrl(), 'signing out removed the local background');

    if (seed) {
      const devices = await jsonRequest('/v1/devices', { headers: bearer(seed.accessToken) });
      assert.equal(devices.response.status, 200, `post-logout device list returned HTTP ${devices.response.status}`);
      assert.ok(devices.body.devices.some((device) => device.id === session.deviceId && device.status === 'revoked'));
      await deleteDisposableAccount(seed);
      accountDeleted = true;
    }

    console.log(`ATHENA_ACCOUNT_RUNTIME_OK endpoint=${baseUrl} backgroundBytes=${bytes.length} dimensions=${size.width}x${size.height} adultMode=${getAppSettings().conversation.adultModeEnabled} firstLogin=blocked conflict=explicit logout=local-preserved deviceRevoke=${seed ? 'verified' : 'not-tested'} cleanup=${seed ? 'cryptographic-erase' : 'not-requested'}`);
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    if (seed && !accountDeleted) {
      try {
        await deleteDisposableAccount(seed);
        console.log('ATHENA_ACCOUNT_RUNTIME_CLEANUP_OK cleanup=cryptographic-erase');
      } catch (error) {
        exitCode = 1;
        console.error('Disposable staging account cleanup failed.', error);
      }
    }
    try {
      const { closeDatabase } = require('../dist/memory/database/index.js');
      closeDatabase();
    } catch {
      // The database is lazy and may never have opened.
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    app.exit(exitCode);
  }
})();
