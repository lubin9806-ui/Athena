import * as crypto from 'crypto';
import type { SteamCloudApi } from './SteamPlatform';

export interface SteamCloudEncryptedPayload {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
  sha256: string;
}

export interface SteamCloudRecord {
  schemaVersion: 1;
  logicalKey: string;
  vector: Record<string, number>;
  modifiedAt: string;
  modifiedBy: string;
  deleted: boolean;
  deletedAt: string | null;
  payload: SteamCloudEncryptedPayload | null;
}

export type SteamCloudMergeResult =
  | { outcome: 'equal' | 'local' | 'remote'; selected: SteamCloudRecord }
  | { outcome: 'conflict'; local: SteamCloudRecord; remote: SteamCloudRecord; reason: string };

export type SteamCloudSyncResult = SteamCloudMergeResult & { uploaded: boolean };

export function createSteamCloudRecord(input: {
  logicalKey: string;
  deviceId: string;
  plaintext: Buffer | null;
  encryptionKey: Buffer;
  previous?: SteamCloudRecord;
  now?: Date;
}): SteamCloudRecord {
  validateLogicalKey(input.logicalKey);
  validateDeviceId(input.deviceId);
  validateEncryptionKey(input.encryptionKey);
  if (input.previous && input.previous.logicalKey !== input.logicalKey) {
    throw new Error('Steam Cloud record key cannot change across revisions.');
  }
  const now = (input.now || new Date()).toISOString();
  const vector = { ...(input.previous?.vector || {}) };
  vector[input.deviceId] = (vector[input.deviceId] || 0) + 1;
  const deleted = input.plaintext === null;
  return {
    schemaVersion: 1,
    logicalKey: input.logicalKey,
    vector,
    modifiedAt: now,
    modifiedBy: input.deviceId,
    deleted,
    deletedAt: deleted ? now : null,
    payload: input.plaintext === null ? null : encryptPayload(input.plaintext, input.encryptionKey),
  };
}

export function decryptSteamCloudRecord(record: SteamCloudRecord, encryptionKey: Buffer): Buffer | null {
  validateSteamCloudRecord(record);
  validateEncryptionKey(encryptionKey);
  if (record.deleted) return null;
  if (!record.payload) throw new Error('Non-deleted Steam Cloud record is missing its payload.');
  const iv = Buffer.from(record.payload.iv, 'base64');
  const authTag = Buffer.from(record.payload.authTag, 'base64');
  const ciphertext = Buffer.from(record.payload.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (sha256(plaintext) !== record.payload.sha256) throw new Error('Steam Cloud payload checksum mismatch.');
  return plaintext;
}

export function mergeSteamCloudRecords(local: SteamCloudRecord, remote: SteamCloudRecord): SteamCloudMergeResult {
  validateSteamCloudRecord(local);
  validateSteamCloudRecord(remote);
  if (local.logicalKey !== remote.logicalKey) throw new Error('Cannot merge different Steam Cloud logical keys.');
  const relation = compareVectors(local.vector, remote.vector);
  if (relation === 'local') return { outcome: 'local', selected: local };
  if (relation === 'remote') return { outcome: 'remote', selected: remote };
  if (relation === 'equal' && stableRecordHash(local) === stableRecordHash(remote)) {
    return { outcome: 'equal', selected: local };
  }
  return {
    outcome: 'conflict',
    local,
    remote,
    reason: relation === 'concurrent'
      ? 'Concurrent device revisions require explicit user resolution.'
      : 'Equal revision vectors contain different content and cannot be overwritten silently.',
  };
}

export async function syncSteamCloudRecord(
  cloud: SteamCloudApi,
  remoteName: string,
  local: SteamCloudRecord,
  maxBytes: number,
): Promise<SteamCloudSyncResult> {
  validateRemoteName(remoteName);
  validateSteamCloudRecord(local);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Steam Cloud maxBytes must be positive.');
  if (!cloud.fileExists(remoteName)) {
    const serialized = serializeBounded(local, maxBytes);
    if (!cloud.writeFile(remoteName, serialized)) throw new Error('Steam Cloud initial write failed.');
    return { outcome: 'local', selected: local, uploaded: true };
  }

  const raw = cloud.readFile(remoteName);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new Error('Steam Cloud remote record exceeds its whitelist limit.');
  const remote = JSON.parse(raw) as SteamCloudRecord;
  const merged = mergeSteamCloudRecords(local, remote);
  if (merged.outcome === 'local') {
    const serialized = serializeBounded(local, maxBytes);
    if (!cloud.writeFile(remoteName, serialized)) throw new Error('Steam Cloud update write failed.');
    return { ...merged, uploaded: true };
  }
  return { ...merged, uploaded: false };
}

export function serializeBounded(record: SteamCloudRecord, maxBytes: number): string {
  validateSteamCloudRecord(record);
  const value = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('Steam Cloud record exceeds its whitelist limit.');
  return value;
}

export function validateSteamCloudRecord(record: SteamCloudRecord): void {
  if (!record || record.schemaVersion !== 1) throw new Error('Unsupported Steam Cloud record schema.');
  validateLogicalKey(record.logicalKey);
  validateDeviceId(record.modifiedBy);
  if (!record.vector || Object.keys(record.vector).length === 0) throw new Error('Steam Cloud vector is empty.');
  for (const [device, revision] of Object.entries(record.vector)) {
    validateDeviceId(device);
    if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error('Steam Cloud vector revision is invalid.');
  }
  if (Number.isNaN(Date.parse(record.modifiedAt))) throw new Error('Steam Cloud modifiedAt is invalid.');
  if (record.deleted) {
    if (!record.deletedAt || Number.isNaN(Date.parse(record.deletedAt)) || record.payload !== null) {
      throw new Error('Steam Cloud tombstone is invalid.');
    }
  } else if (record.deletedAt !== null || !record.payload || record.payload.algorithm !== 'aes-256-gcm') {
    throw new Error('Steam Cloud live record is invalid.');
  }
}

function encryptPayload(plaintext: Buffer, key: Buffer): SteamCloudEncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    sha256: sha256(plaintext),
  };
}

function compareVectors(local: Record<string, number>, remote: Record<string, number>): 'local' | 'remote' | 'equal' | 'concurrent' {
  const devices = new Set([...Object.keys(local), ...Object.keys(remote)]);
  let localAhead = false;
  let remoteAhead = false;
  for (const device of devices) {
    const left = local[device] || 0;
    const right = remote[device] || 0;
    if (left > right) localAhead = true;
    if (right > left) remoteAhead = true;
  }
  if (localAhead && remoteAhead) return 'concurrent';
  if (localAhead) return 'local';
  if (remoteAhead) return 'remote';
  return 'equal';
}

function stableRecordHash(record: SteamCloudRecord): string {
  return sha256(Buffer.from(JSON.stringify(record), 'utf8'));
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validateEncryptionKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Steam Cloud encryption key must be 32 bytes.');
}

function validateLogicalKey(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) throw new Error('Invalid Steam Cloud logical key.');
}

function validateDeviceId(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) throw new Error('Invalid Steam Cloud device ID.');
}

function validateRemoteName(value: string): void {
  if (!/^athena-v1\/[a-z0-9._-]{1,80}\.json$/i.test(value)) throw new Error('Remote name is outside the Steam Cloud whitelist namespace.');
}
