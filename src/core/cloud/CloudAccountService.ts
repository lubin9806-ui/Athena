import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getAppSettings, saveSettingsBundle } from '../config/SettingsStore';
import { canUseNetworkCapability } from '../privacy/PrivacyDataService';
import { createChatWindow, getChatWindow, getChatWindowMessages, listChatWindows, saveChatMessage } from '../../memory';
import { listMemories } from '../../memory/admin';
import type { CloudAccountSettings, CloudSessionStatus } from '../../shared/types/cloud';
import { CloudProtocol, CloudProtocolError } from './CloudProtocol';
import {
  conversationResourceId,
  incomingConversationTitle,
  memoryResourceId,
  shouldSyncWindow,
  toConversationPayload,
  toMemoryPayload,
} from './CloudSyncMapper';

interface StoredSession {
  version: 1;
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  deviceId: string | null;
  email: string;
  lastSyncAt: string | null;
  cursor: string | null;
  imported: Record<string, number>;
}

let lastError: string | null = null;

export function getCloudAccountStatus(): CloudSessionStatus {
  const settings = getAppSettings().cloud;
  const session = readSession();
  return {
    signedIn: Boolean(session?.accessToken),
    syncEnabled: settings.syncEnabled,
    baseUrl: settings.baseUrl,
    email: session?.email || settings.email,
    tenantId: session?.tenantId || settings.tenantId || null,
    deviceId: session?.deviceId || null,
    lastSyncAt: session?.lastSyncAt || null,
    lastError,
  };
}

export async function registerCloudAccount(input: { tenantName: string; email: string; password: string }): Promise<CloudSessionStatus> {
  const client = createClient();
  const settings = getAppSettings().cloud;
  const body = await client.register({
    tenantName: input.tenantName.trim() || 'Athena',
    email: input.email.trim(),
    password: input.password,
    deviceName: settings.deviceName || 'Athena Desktop',
  });
  persistSession(client, input.email, body);
  saveSettingsBundle({
    settings: {
      cloud: {
        ...settings,
        email: input.email.trim(),
        tenantId: String(body.tenantId || ''),
      },
    },
  });
  lastError = null;
  return getCloudAccountStatus();
}

export async function loginCloudAccount(input: { tenantId: string; email: string; password: string }): Promise<CloudSessionStatus> {
  const client = createClient();
  const settings = getAppSettings().cloud;
  const body = await client.login({
    tenantId: input.tenantId.trim(),
    email: input.email.trim(),
    password: input.password,
    deviceName: settings.deviceName || 'Athena Desktop',
  });
  persistSession(client, input.email, body);
  saveSettingsBundle({
    settings: {
      cloud: {
        ...settings,
        email: input.email.trim(),
        tenantId: input.tenantId.trim(),
      },
    },
  });
  lastError = null;
  return getCloudAccountStatus();
}

export async function logoutCloudAccount(): Promise<CloudSessionStatus> {
  const client = createClientFromSession();
  if (client) {
    try { await client.logout(); } catch { /* still clear local session */ }
  }
  writeSession(null);
  lastError = null;
  return getCloudAccountStatus();
}

export async function syncCloudAccountNow(): Promise<CloudSessionStatus> {
  if (!canUseNetworkCapability('cloudSync')) {
    throw new CloudProtocolError(403, 'consent-required', '跨设备同步需要先在隐私中心同意。');
  }
  if (!getAppSettings().cloud.syncEnabled) {
    throw new CloudProtocolError(403, 'sync-disabled', '尚未打开 Athena 账号同步。');
  }
  const client = createClientFromSession();
  if (!client) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
  const session = readSession();
  if (!session) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');

  await pushLocalState(client);
  const imported = { ...session.imported };
  const changes = await client.listChanges(session.cursor) as { records?: unknown[]; nextCursor?: string };
  for (const record of Array.isArray(changes.records) ? changes.records : []) {
    if (!isRecord(record) || record.deleted === true) continue;
    const resourceId = String(record.resourceId || '');
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload || imported[resourceId]) continue;
    if (resourceId.startsWith('conversation.') && payload.origin === 'android') {
      const windowId = importAndroidConversation(payload);
      if (windowId) imported[resourceId] = windowId;
    }
  }
  writeSession({
    ...session,
    accessToken: client.session.accessToken || session.accessToken,
    refreshToken: client.session.refreshToken || session.refreshToken,
    lastSyncAt: new Date().toISOString(),
    cursor: typeof changes.nextCursor === 'string' ? changes.nextCursor : session.cursor,
    imported,
  });
  lastError = null;
  return getCloudAccountStatus();
}

export function queueCloudWindowSync(windowId: number): void {
  const settings = getAppSettings();
  if (!settings.cloud.syncEnabled || !canUseNetworkCapability('cloudSync')) return;
  void syncCloudAccountNow().catch(error => {
    lastError = error instanceof Error ? error.message : String(error);
  });
  void windowId;
}

async function pushLocalState(client: CloudProtocol): Promise<void> {
  const windows = listChatWindows(false, false);
  for (const window of windows) {
    if (!shouldSyncWindow(window)) continue;
    const messages = getChatWindowMessages(window.id, 80);
    const payload = toConversationPayload(window, messages);
    const first = await client.putRecord({
      resourceId: conversationResourceId(window.id),
      resourceType: 'conversation',
      schemaVersion: 1,
      baseVector: {},
      payload,
      deleted: false,
    });
    if (first.outcome === 'conflict') {
      const server = isRecord(first.server) ? first.server : null;
      const vector = server && isRecord(server.vector) ? server.vector : {};
      await client.putRecord({
        resourceId: conversationResourceId(window.id),
        resourceType: 'conversation',
        schemaVersion: 1,
        baseVector: vector,
        payload,
        deleted: false,
      });
    }
  }

  const memories = listMemories({ kind: 'profile', limit: 40 });
  for (const item of memories.items) {
    await client.putRecord({
      resourceId: memoryResourceId(item.kind, item.id),
      resourceType: 'memory',
      schemaVersion: 1,
      baseVector: {},
      payload: toMemoryPayload(item),
      deleted: false,
    }).catch(() => undefined);
  }
}

function importAndroidConversation(payload: Record<string, unknown>): number | null {
  const title = incomingConversationTitle({
    origin: 'android',
    title: String(payload.title || ''),
    mode: typeof payload.mode === 'string' ? payload.mode : 'companion',
    turns: [],
  });
  const mode = payload.mode === 'create' || payload.mode === 'reason' ? payload.mode : 'companion';
  const window = createChatWindow({ title, mode });
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  for (const turn of turns) {
    if (!isRecord(turn)) continue;
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const content = typeof turn.content === 'string' ? turn.content : '';
    if (!content) continue;
    saveChatMessage(window.id, turn.role, content, undefined, mode);
  }
  return getChatWindow(window.id)?.id || window.id;
}

function createClient(): CloudProtocol {
  const settings = getAppSettings().cloud;
  return new CloudProtocol(CloudProtocol.assertBaseUrl(settings.baseUrl), 'desktop');
}

function createClientFromSession(): CloudProtocol | null {
  const session = readSession();
  if (!session) return null;
  const client = createClient();
  client.session = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tenantId: session.tenantId,
    userId: session.userId,
    deviceId: session.deviceId,
  };
  return client;
}

function persistSession(client: CloudProtocol, email: string, body: Record<string, unknown>): void {
  writeSession({
    version: 1,
    accessToken: String(body.accessToken || client.session.accessToken || ''),
    refreshToken: String(body.refreshToken || client.session.refreshToken || ''),
    tenantId: String(body.tenantId || client.session.tenantId || ''),
    userId: String(body.userId || client.session.userId || ''),
    deviceId: client.session.deviceId,
    email: email.trim(),
    lastSyncAt: null,
    cursor: null,
    imported: {},
  });
}

function sessionPath(): string | null {
  const explicit = process.env.ATHENA_CREDENTIALS_DIR?.trim();
  if (explicit) return path.join(path.resolve(explicit), 'cloud-session.enc.json');
  if (!app?.isReady?.()) return null;
  return path.join(app.getPath('userData'), 'credentials', 'cloud-session.enc.json');
}

function readSession(): StoredSession | null {
  const filePath = sessionPath();
  if (!filePath || !fs.existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { blob?: string };
    if (!parsed.blob) return null;
    return JSON.parse(safeStorage.decryptString(Buffer.from(parsed.blob, 'base64'))) as StoredSession;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  const filePath = sessionPath();
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!session) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全凭据加密当前不可用，账号会话未保存。');
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    blob: safeStorage.encryptString(JSON.stringify(session)).toString('base64'),
  }, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { CloudAccountSettings };
