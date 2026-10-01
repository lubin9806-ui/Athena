import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { nativeImage, safeStorage } from 'electron';
import { getAppSettings, saveSettingsBundle } from '../config/SettingsStore';
import {
  getCloudAccountStatus,
  loginCloudAccount,
  logoutCloudAccount,
  syncCloudAccountNow,
} from './CloudAccountService';
import { desktopBackgroundDataUrl } from './BackgroundSync';
import { CloudProtocolError } from './CloudProtocol';

type JsonRecord = Record<string, unknown>;

export interface AccountRuntimeAcceptanceOptions {
  baseUrl: string;
  credentialsDirectory: string;
  endpointSource: 'developer-override' | 'packaged-resource';
  selfSeed?: boolean;
  email?: string;
  password?: string;
  expectedAdultMode?: boolean | null;
}

export interface AccountRuntimeAcceptanceResult {
  endpoint: string;
  endpointSource: AccountRuntimeAcceptanceOptions['endpointSource'];
  backgroundBytes: number;
  width: number;
  height: number;
  adultMode: boolean;
  cleanup: 'cryptographic-erase' | 'not-requested';
}

interface DisposableAccount {
  accessToken: string;
  tenantId: string;
  seedDeviceId: string;
  email: string;
  password: string;
  deleted?: boolean;
}

interface StoredSession {
  baseUrl?: string;
  accessToken: string;
  deviceId: string | null;
}

interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: JsonRecord;
}

/**
 * Runs the real desktop account/sync path against an isolated disposable
 * account. The caller owns the isolated filesystem paths and Electron app
 * lifetime; this function owns remote account cleanup.
 */
export async function runAccountRuntimeAcceptance(
  options: AccountRuntimeAcceptanceOptions,
): Promise<AccountRuntimeAcceptanceResult> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const selfSeed = options.selfSeed === true;
  let email = String(options.email || '').trim().toLowerCase();
  let password = String(options.password || '');
  const expectedAdultMode = options.expectedAdultMode === undefined
    ? selfSeed ? true : null
    : options.expectedAdultMode;

  assert.ok(baseUrl, 'account acceptance endpoint is missing');
  assert.ok(selfSeed || (email && password), 'account acceptance credentials are missing');

  let disposable: DisposableAccount | null = null;
  let accountDeleted = false;
  let primaryFailure: unknown = null;
  try {
    if (selfSeed) {
      disposable = await seedDisposableAccount(baseUrl);
      email = disposable.email;
      password = disposable.password;
    }

    saveSettingsBundle({
      settings: {
        developerMode: options.endpointSource === 'developer-override',
        privacy: { networkConsent: { cloudSync: true } },
        cloud: {
          baseUrl: options.endpointSource === 'developer-override' ? baseUrl : '',
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

    const configured = getAppSettings();
    assert.equal(configured.cloud.syncCategories.conversations, false);
    assert.equal(configured.cloud.syncCategories.memories, false);
    assert.equal(configured.cloud.syncCategories.persona, false);
    assert.equal(configured.cloud.syncCategories.preferences, false);
    assert.equal(configured.cloud.syncCategories.reminders, false);
    assert.equal(configured.cloud.syncCategories.backgroundImage, true);
    assert.equal(configured.cloud.syncCategories.adultMode, true);

    const signedIn = await loginCloudAccount({ email, password });
    assert.equal(signedIn.signedIn, true, 'desktop runtime did not establish an account session');
    assert.equal(signedIn.syncEnabled, false, 'login enabled sync before the merge decision');
    assert.equal(signedIn.baseUrl, baseUrl, 'desktop login did not use the expected account endpoint');

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
    if (!dataUrl?.startsWith('data:image/jpeg;base64,')) {
      throw new Error('desktop did not apply the account background');
    }
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    assert.ok(bytes.length > 0 && bytes.length <= 180 * 1024, 'desktop background copy exceeded the safe size bound');
    const size = nativeImage.createFromBuffer(bytes).getSize();
    assert.ok(size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= 1600, 'desktop background dimensions are invalid');

    const session = storedSession(options.credentialsDirectory);
    assert.equal(session.baseUrl, baseUrl, 'desktop session was not bound to its issuing account endpoint');
    if (disposable) {
      const devices = await jsonRequest(baseUrl, '/v1/devices', { headers: bearer(disposable.accessToken) });
      assert.equal(devices.response.status, 200, `device list returned HTTP ${devices.response.status}`);
      const listed = arrayValue(devices.body.devices);
      assert.ok(listed.some(device => isDevice(device, session.deviceId, 'active')));
      assert.ok(listed.some(device => isDevice(device, disposable?.seedDeviceId || null, 'active')));
    }

    const record = await accountBackground(baseUrl, session.accessToken);
    assert.equal(record.payload.origin, 'android', 'using the account version bounced a desktop re-encode back into Cloud');
    assert.equal(record.payload.mimeType, 'image/jpeg');
    assert.equal(record.payload.enabled, true);
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

    if (disposable) {
      const devices = await jsonRequest(baseUrl, '/v1/devices', { headers: bearer(disposable.accessToken) });
      assert.equal(devices.response.status, 200, `post-logout device list returned HTTP ${devices.response.status}`);
      assert.ok(arrayValue(devices.body.devices).some(device => isDevice(device, session.deviceId, 'revoked')));
      await deleteDisposableAccount(baseUrl, disposable);
      accountDeleted = true;
    }

    return {
      endpoint: baseUrl,
      endpointSource: options.endpointSource,
      backgroundBytes: bytes.length,
      width: size.width,
      height: size.height,
      adultMode: getAppSettings().conversation.adultModeEnabled,
      cleanup: disposable ? 'cryptographic-erase' : 'not-requested',
    };
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    if (disposable && !accountDeleted) {
      try {
        await deleteDisposableAccount(baseUrl, disposable);
        console.log('ATHENA_ACCOUNT_RUNTIME_CLEANUP_OK cleanup=cryptographic-erase');
      } catch (error) {
        console.error('Disposable staging account cleanup failed.', error);
        // Cleanup diagnostics must not replace the failed acceptance assertion.
        if (!primaryFailure) throw error;
      }
    }
  }
}

async function seedDisposableAccount(baseUrl: string): Promise<DisposableAccount> {
  const healthResult = await jsonRequest(baseUrl, '/health/ready');
  assert.equal(healthResult.response.status, 200, `staging health returned HTTP ${healthResult.response.status}`);
  assert.equal(healthResult.body.status, 'ready');
  assert.equal(healthResult.body.database, true);
  const deployment = recordValue(healthResult.body.deployment);
  const bindings = recordValue(healthResult.body.runtimeBindings);
  assert.equal(deployment.region, 'singapore');
  assert.equal(bindings.cloudProvider, 'render');
  assert.equal(bindings.billingAdapter, 'local-no-charge');
  assert.equal(bindings.recoveryDeliveryAdapter, 'local-return-token');
  assert.equal(bindings.modelProvider, 'local-fixture');
  assert.equal(bindings.searchProvider, 'local-fixture');

  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const email = `athena-staging-${suffix}@example.test`;
  const password = `Athena-staging-${crypto.randomBytes(18).toString('base64url')}!9`;
  let disposable: DisposableAccount | null = null;
  try {
    const registration = await jsonRequest(baseUrl, '/v1/auth/register', {
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
    const accessToken = String(registration.body.accessToken || '');
    const tenantId = String(registration.body.tenantId || '');
    const registrationDevice = recordValue(registration.body.device);
    const seedDeviceId = String(registrationDevice.id || '');
    assert.ok(accessToken, 'account registration did not return an access token');
    assert.match(tenantId, /^ten_[a-f0-9]{32}$/);
    assert.match(seedDeviceId, /^dev_[a-f0-9]{32}$/);
    disposable = { accessToken, tenantId, seedDeviceId, email, password };

    const bitmap = nativeImage.createFromBitmap(Buffer.from([
      0x26, 0x5f, 0xa8, 0xff, 0xf2, 0xc1, 0x4e, 0xff,
      0xd9, 0x63, 0x73, 0xff, 0x43, 0xaa, 0x8b, 0xff,
    ]), { width: 2, height: 2, scaleFactor: 1 });
    assert.equal(bitmap.isEmpty(), false, 'staging fixture bitmap could not be created');
    const jpeg = bitmap.toJPEG(82);
    const size = nativeImage.createFromBuffer(jpeg).getSize();
    await putSeedRecord(baseUrl, accessToken, {
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
    await putSeedRecord(baseUrl, accessToken, {
      resourceId: 'preference.adult-mode',
      resourceType: 'preference',
      schemaVersion: 1,
      baseVector: {},
      payload: { origin: 'android', schemaVersion: 1, enabled: true },
      deleted: false,
    });

    const probeLogin = await jsonRequest(baseUrl, '/v1/auth/login', {
      method: 'POST',
      body: {
        tenantId,
        email,
        password,
        mfaCode: null,
        recoveryCode: null,
        deviceName: 'Athena revocation probe',
        platform: 'staging-probe',
      },
    });
    assert.equal(probeLogin.response.status, 200, `probe login returned HTTP ${probeLogin.response.status}`);
    const probeDeviceId = String(recordValue(probeLogin.body.device).id || '');
    assert.match(probeDeviceId, /^dev_[a-f0-9]{32}$/);
    const revoked = await jsonRequest(baseUrl, `/v1/devices/${probeDeviceId}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    assert.equal(revoked.response.status, 204, `device revocation returned HTTP ${revoked.response.status}`);
    const rejectedProbe = await jsonRequest(baseUrl, '/v1/account', {
      headers: bearer(String(probeLogin.body.accessToken || '')),
    });
    assert.equal(rejectedProbe.response.status, 401, 'revoked device session remained usable');

    const recovery = await jsonRequest(baseUrl, '/v1/auth/recovery/request', {
      method: 'POST',
      body: { tenantId, email },
    });
    assert.equal(recovery.response.status, 202, `recovery request returned HTTP ${recovery.response.status}`);
    assert.equal('localToken' in recovery.body, false, 'staging exposed a local recovery token over HTTPS');

    const computerBoundary = await jsonRequest(baseUrl, '/v1/computer/tools', { headers: bearer(accessToken) });
    assert.equal(computerBoundary.response.status, 404, 'cloud exposed the desktop computer-tool boundary');
    return disposable;
  } catch (error) {
    if (disposable) {
      try {
        await deleteDisposableAccount(baseUrl, disposable);
        console.log('ATHENA_ACCOUNT_RUNTIME_SEED_CLEANUP_OK cleanup=cryptographic-erase');
      } catch (cleanupError) {
        console.error('Disposable staging seed cleanup failed.', cleanupError);
      }
    }
    throw error;
  }
}

async function putSeedRecord(baseUrl: string, accessToken: string, record: JsonRecord): Promise<void> {
  const resourceId = String(record.resourceId || '');
  const result = await jsonRequest(baseUrl, `/v1/sync/records/${encodeURIComponent(resourceId)}`, {
    method: 'PUT',
    headers: bearer(accessToken, { 'idempotency-key': crypto.randomBytes(16).toString('hex') }),
    body: record,
  });
  assert.equal(result.response.status, 200, `${resourceId} seed returned HTTP ${result.response.status}`);
  assert.equal(result.body.outcome, 'accepted', `${resourceId} seed was not accepted`);
}

async function deleteDisposableAccount(baseUrl: string, disposable: DisposableAccount): Promise<void> {
  // Once the server confirmed cryptographic erasure, its old session is invalid.
  // Do not submit DELETE again if the following negative-session probe fails.
  if (disposable.deleted) return;
  const deletion = await jsonRequest(baseUrl, '/v1/account', {
    method: 'DELETE',
    headers: bearer(disposable.accessToken),
    body: { confirmation: `DELETE ${disposable.tenantId}` },
  });
  assert.equal(deletion.response.status, 200,
    `disposable account deletion returned HTTP ${deletion.response.status} (${String(deletion.body.title || 'unknown')})`);
  assert.equal(deletion.body.status, 'complete');
  assert.equal(deletion.body.cryptographicErase, true);
  disposable.deleted = true;
  console.log('ATHENA_ACCOUNT_RUNTIME_ERASE_OK cleanup=cryptographic-erase');
  const rejected = await jsonRequest(baseUrl, '/v1/account', {
    headers: bearer(disposable.accessToken),
  });
  assert.equal(rejected.response.status, 401, 'deleted account session remained usable');
}

async function accountBackground(baseUrl: string, accessToken: string): Promise<{ payload: JsonRecord }> {
  const result = await jsonRequest(baseUrl, '/v1/sync/records/preference.background', {
    headers: bearer(accessToken),
  });
  assert.equal(result.response.status, 200, `background record returned HTTP ${result.response.status}`);
  return { payload: recordValue(result.body.payload) };
}

async function jsonRequest(
  baseUrl: string,
  pathname: string,
  options: JsonRequestOptions = {},
): Promise<{ response: Response; body: JsonRecord }> {
  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body: JsonRecord = {};
  try {
    body = text ? recordValue(JSON.parse(text) as unknown) : {};
  } catch {
    body = { detail: text };
  }
  return { response, body };
}

function storedSession(credentialsDirectory: string): StoredSession {
  const filePath = path.join(credentialsDirectory, 'cloud-session.enc.json');
  const envelope = recordValue(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
  const blob = String(envelope.blob || '');
  return JSON.parse(safeStorage.decryptString(Buffer.from(blob, 'base64'))) as StoredSession;
}

function bearer(accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isDevice(value: unknown, deviceId: string | null, status: string): boolean {
  const device = recordValue(value);
  return Boolean(deviceId) && device.id === deviceId && device.status === status;
}
