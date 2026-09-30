'use strict';

// Run with Electron after tsc and building/installing the Android test APK.
// Test-only debug state, one disposable staging account, and an isolated PC profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { app, safeStorage, nativeImage } = require('electron');
const root = path.resolve(__dirname, '../..');
const endpoint = 'https://staging-api.elanastra.com';
assert(process.argv.includes('--staging'), 'Explicit --staging is required');
assert(process.argv.includes('--reset-debug-test-state'), 'Explicit permission to reset the debug test profile is required');
const adb = process.env.ATHENA_TEST_ADB || path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
assert(fs.existsSync(adb), 'Android SDK adb is required');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cross-staging-'));
for (const [key, directory] of Object.entries({
  ATHENA_CONFIG_DIR: 'config', ATHENA_CREDENTIALS_DIR: 'credentials', ATHENA_DB_DIR: 'database',
  ATHENA_DIAGNOSTICS_DIR: 'diagnostics', ATHENA_EXPORT_DIR: 'exports', ATHENA_ATTACHMENT_DIR: 'attachments',
  ATHENA_VOICE_TEMP_DIR: 'voice',
})) process.env[key] = path.join(scratch, directory);
process.env.ATHENA_USE_LOCAL_SETTINGS = '0';
app.setPath('userData', path.join(scratch, 'user-data'));
app.disableHardwareAcceleration();
const id = crypto.randomBytes(16).toString('hex');
const email = `athena-cross-${id}@example.test`;
const password = `Athena-${crypto.randomBytes(24).toString('hex')}!9a`;
const fixtureName = `athena-cross-${id}.json`;
const remoteFixture = `/data/local/tmp/${fixtureName}`;
const packageName = 'com.elanastra.athena.debug';
const sentinelTitle = 'Private cross-device desktop conversation';
let created = false;
let fixtureCopied = false;
let controller;
let service;
let settings;
let background;

function scrub(text) {
  return String(text).replaceAll(password, '[synthetic-password]').replaceAll(email, '[synthetic-email]');
}
function device(args, timeout = 30_000) {
  const result = spawnSync(adb, ['-d', ...args], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw new Error(`adb operation failed: ${result.error.code || 'execution-error'}`);
  const missingPid = args[0] === 'shell' && args[1] === 'pidof' && result.status === 1 && !result.stdout.trim();
  assert(result.status === 0 || missingPid, scrub(result.stderr || 'adb operation failed'));
  return scrub(result.stdout || '');
}
function instrument(phase) {
  const transcript = device(['shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.elanastra.athena.CrossDeviceStagingAcceptanceTest#desktopPhoneRoundTripPhase',
    '-e', 'athenaCrossDeviceAcceptance', 'true', '-e', 'athenaCrossDeviceFixture', fixtureName,
    '-e', 'athenaCrossDevicePhase', phase,
    `${packageName}.test/androidx.test.runner.AndroidJUnitRunner`], 240_000);
  for (const line of transcript.split(/\r?\n/)) {
    if (line.includes('ATHENA_CROSS_') || /^Time:|^OK \(/.test(line)) console.log(line);
  }
  assert.match(transcript, /OK \(1 test\)/, `${phase} instrumentation failed: ${transcript}`);
  const marker = { publish: 'ATHENA_CROSS_PHONE_PUBLISH_OK', restore: 'ATHENA_CROSS_PHONE_RESTORE_OK', cleanup: 'ATHENA_CROSS_PHONE_CLEANUP_OK' }[phase];
  assert(transcript.includes(marker), `${phase} did not emit its proof marker`);
}
function patch(cloud) { settings.saveSettingsBundle({ settings: { cloud } }); }
function setImage(r, g, b) {
  const pixels = Buffer.alloc(48 * 32 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = b; pixels[offset + 1] = g; pixels[offset + 2] = r; pixels[offset + 3] = 255;
  }
  const source = path.join(scratch, 'synthetic-background.png');
  fs.writeFileSync(source, nativeImage.createFromBitmap(pixels, { width: 48, height: 32 }).toPNG());
  background.saveDesktopBackgroundFromFile(source);
}
function assertImage(r, g, b) {
  const dataUrl = background.desktopBackgroundDataUrl();
  assert(dataUrl?.startsWith('data:image/jpeg;base64,'));
  const image = nativeImage.createFromDataURL(dataUrl);
  assert.deepEqual(image.getSize(), { width: 48, height: 32 });
  const pixels = image.toBitmap();
  const offset = (16 * 48 + 24) * 4;
  assert(Math.abs(pixels[offset] - b) <= 3 && Math.abs(pixels[offset + 1] - g) <= 3 && Math.abs(pixels[offset + 2] - r) <= 3);
}
function currentSession() {
  const envelope = JSON.parse(fs.readFileSync(path.join(process.env.ATHENA_CREDENTIALS_DIR, 'cloud-session.enc.json'), 'utf8'));
  return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.blob, 'base64')));
}
async function record(id) {
  const response = await fetch(`${endpoint}/v1/sync/records/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${controller.session.accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function assertOnlySelectedRecords() {
  const feed = await controller.listChanges();
  assert.deepEqual(feed.records.map(item => item.resourceId).sort(), ['preference.adult-mode', 'preference.background']);
}

(async () => {
  let failure = null;
  try {
    await app.whenReady();
    assert(safeStorage.isEncryptionAvailable(), 'Real Windows encrypted session store is required');
    assert.equal(device(['get-state']).trim(), 'device');
    assert.equal(device(['shell', 'getprop', 'ro.product.model']).trim(), 'PKT110', 'This evidence harness targets the OPPO test phone');
    assert.equal(device(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(), '0', '5G acceptance requires Wi-Fi disabled');
    assert.equal(device(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).trim(), '0');
    assert(device(['shell', 'dumpsys', 'connectivity']).includes('MOBILE[NR]'), 'Mobile NR must be reported; full connectivity logs are never printed');
    assert.match(device(['shell', 'pm', 'path', packageName]), /package:/);
    assert.match(device(['shell', 'pm', 'path', `${packageName}.test`]), /package:/);
    const { CloudProtocol } = require(path.join(root, 'dist/core/cloud/CloudProtocol.js'));
    settings = require(path.join(root, 'dist/core/config/SettingsStore.js'));
    service = require(path.join(root, 'dist/core/cloud/CloudAccountService.js'));
    background = require(path.join(root, 'dist/core/cloud/BackgroundSync.js'));
    const memory = require(path.join(root, 'dist/memory/index.js'));
    settings.saveSettingsBundle({ settings: {
      developerMode: true, conversation: { adultModeEnabled: true },
      privacy: { networkConsent: { cloudSync: true } },
      cloud: { baseUrl: endpoint, pairingBaseUrl: 'http://127.0.0.1:8787', deviceName: 'Cross-device Desktop',
        syncEnabled: false, mergeReviewedAccount: '', syncCategories: {
          conversations: false, memories: false, persona: false, preferences: false,
          reminders: false, backgroundImage: true, adultMode: true,
        } },
    } });
    const sentinel = memory.createChatWindow({ title: sentinelTitle, mode: 'companion' });
    setImage(176, 92, 68);
    const registered = await service.registerCloudAccount({ tenantName: 'Disposable cross-device staging', email, password });
    created = true;
    assert(registered.signedIn);
    assert.equal(registered.syncEnabled, false);
    controller = new CloudProtocol(endpoint);
    const session = currentSession();
    controller.session = { accessToken: session.accessToken, refreshToken: session.refreshToken,
      tenantId: session.tenantId, userId: session.userId, deviceId: session.deviceId };
    await assert.rejects(service.syncCloudAccountNow(), error => error.code === 'merge-decision-required');
    patch({ mergeReviewedAccount: email, syncEnabled: true });
    await service.syncCloudAccountNow('local');
    await assertOnlySelectedRecords();
    assert.equal((await record('preference.background')).payload.origin, 'desktop');
    console.log('ATHENA_CROSS_DESKTOP_PUBLISH_OK firstLogin=explicit categories=background-adult-only');

    fs.writeFileSync(path.join(scratch, fixtureName), JSON.stringify({ disposable: true, endpoint, email, password }), { mode: 0o600 });
    device(['push', path.join(scratch, fixtureName), remoteFixture]);
    device(['shell', 'run-as', packageName, 'mkdir', '-p', 'files']);
    device(['shell', 'run-as', packageName, 'cp', remoteFixture, `files/${fixtureName}`]);
    fixtureCopied = true;
    device(['shell', 'rm', remoteFixture]);
    instrument('publish');
    await assert.rejects(service.syncCloudAccountNow(), error => error.code === 'merge-conflict');
    assertImage(176, 92, 68);
    assert.equal(settings.getAppSettings().conversation.adultModeEnabled, true);
    await service.syncCloudAccountNow('cloud');
    assertImage(66, 114, 90);
    assert.equal(settings.getAppSettings().conversation.adultModeEnabled, false);
    assert.equal((await record('preference.background')).payload.origin, 'android', 'receiving must not bounce an image re-encode back to Cloud');
    assert.equal(memory.getChatWindow(sentinel.id).title, sentinelTitle);
    await assertOnlySelectedRecords();
    console.log('ATHENA_CROSS_DESKTOP_RECEIVE_OK phoneToDesktop=verified conflict=explicit local=preserved imageEcho=absent');

    setImage(74, 96, 176);
    settings.saveSettingsBundle({ settings: { conversation: { adultModeEnabled: true } } });
    await service.syncCloudAccountNow('local');
    assert.equal((await record('preference.background')).payload.origin, 'desktop');
    device(['shell', 'am', 'force-stop', packageName]);
    assert.equal(device(['shell', 'pidof', packageName]).trim(), '');
    instrument('restore');
    await assertOnlySelectedRecords();
    assert.equal(settings.getAppSettings().cloud.pairingBaseUrl, 'http://127.0.0.1:8787');
    console.log('ATHENA_CROSS_DEVICE_STAGING_OK desktop=Electron phone=OPPO-5G roundTrip=verified restart=force-stop-restored background=verified adultMode=verified categories=independent');
  } catch (error) { failure = error; }
  finally {
    if (fixtureCopied) {
      try { instrument('cleanup'); } catch (error) { failure ||= error; }
      try { device(['shell', 'run-as', packageName, 'rm', '-f', `files/${fixtureName}`]); } catch (error) { failure ||= error; }
      try { device(['shell', 'am', 'force-stop', packageName]); } catch (error) { failure ||= error; }
    }
    try { device(['shell', 'rm', '-f', remoteFixture]); } catch (error) { failure ||= error; }
    if (created) {
      try {
        if (!controller) {
          const { CloudProtocol } = require(path.join(root, 'dist/core/cloud/CloudProtocol.js'));
          controller = new CloudProtocol(endpoint);
          await controller.login({ email, password, deviceName: 'Cross-device cleanup' });
        }
        const deleted = await controller.deleteAccount();
        assert.equal(deleted.status, 'complete');
        assert.equal(deleted.cryptographicErase, true);
        console.log('ATHENA_CROSS_ACCOUNT_CLEANUP_OK account=deleted cryptographicErase=true');
      } catch (error) { failure ||= error; console.error(`ATHENA_CROSS_ACCOUNT_CLEANUP_FAILED code=${error.code || 'unknown'}`); }
    }
    try { require(path.join(root, 'dist/memory/database/index.js')).closeDatabase(); } catch { }
    assert(path.dirname(scratch) === os.tmpdir() && path.basename(scratch).startsWith('athena-cross-staging-'));
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log('ATHENA_CROSS_PROFILE_CLEANUP_OK credentials=removed profile=removed');
    if (failure) console.error(scrub(failure.stack || failure.message));
    app.exit(failure ? 1 : 0);
  }
})();
