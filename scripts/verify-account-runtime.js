'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeImage, safeStorage } = require('electron');

const baseUrl = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_URL || '').trim().replace(/\/+$/, '');
const email = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_PASSWORD || '');
const expectedAdultMode = process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'true'
  ? true
  : process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'false'
    ? false
    : null;

if (!baseUrl || !email || !password) {
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

(async () => {
  let exitCode = 0;
  try {
    await app.whenReady();
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

    console.log(`ATHENA_ACCOUNT_RUNTIME_OK backgroundBytes=${bytes.length} dimensions=${size.width}x${size.height} adultMode=${getAppSettings().conversation.adultModeEnabled} firstLogin=blocked conflict=explicit logout=local-preserved`);
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
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
