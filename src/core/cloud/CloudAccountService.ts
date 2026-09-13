import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getAppSettings, saveSettingsBundle } from '../config/SettingsStore';
import { canUseNetworkCapability } from '../privacy/PrivacyDataService';
import { createChatWindow, getChatWindow, getChatWindowMessages, listChatWindows, saveChatMessage } from '../../memory';
import { listMemories, upsertSyncedMemory } from '../../memory/admin';
import { adoptSyncedReminder } from '../scheduler/Reminder';
import { listSyncableReminders } from '../scheduler/ScheduledJobStore';
import type { CloudAccountSettings, CloudSessionStatus } from '../../shared/types/cloud';
import { CloudProtocol, CloudProtocolError } from './CloudProtocol';
import { pushTrackedRecord } from './CloudSyncPush';
import { CloudSyncVectorState, type CloudSyncVector } from './CloudSyncVectorState';
import {
  conversationResourceId,
  desktopWindowIdFromResourceId,
  incomingConversationTitle,
  memoryResourceId,
  ownsReminderResource,
  parseReminderPayload,
  reminderResourceId,
  shouldSyncWindow,
  toConversationPayload,
  toMemoryPayload,
  toReminderPayload,
  turnsToAppend,
} from './CloudSyncMapper';

interface StoredSession {
  version: 1 | 2;
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  deviceId: string | null;
  email: string;
  lastSyncAt: string | null;
  cursor: string | null;
  imported: Record<string, number>;
  resourceVectors?: Record<string, CloudSyncVector>;
}

interface SyncConflict {
  resourceId: string;
  label: string;
  reason: string;
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

  const imported = { ...session.imported };
  const vectorState = new CloudSyncVectorState(session.resourceVectors);
  let cursor = session.cursor;
  try {
    const conflicts = await pushLocalState(client, imported, vectorState);
    const conflictedIds = new Set(conflicts.map(conflict => conflict.resourceId));
    const changes = await client.listChanges(session.cursor) as { records?: unknown[]; nextCursor?: string };
    for (const record of Array.isArray(changes.records) ? changes.records : []) {
      if (!isRecord(record)) continue;
      const resourceId = String(record.resourceId || '');
      // A 409 means the local and server payloads still need an explicit
      // resolution. Do not merge or adopt the server side merely because it
      // also appears in the change feed.
      if (conflictedIds.has(resourceId)) continue;
      if (record.deleted === true) {
        // Local deletion semantics are not implemented yet. Advancing to the
        // tombstone vector would let the next local push resurrect the record,
        // so hold the old vector and make the unresolved deletion visible.
        if (!conflictedIds.has(resourceId)) {
          conflicts.push({ resourceId, label: resourceId, reason: 'remote-delete' });
          conflictedIds.add(resourceId);
        }
        continue;
      }
      const payload = isRecord(record.payload) ? record.payload : null;
      if (!payload) continue;

      // Memories written elsewhere become real memories here. Until now the loop
      // skipped every record that was not a conversation, so a memory noted on
      // the phone reached the account and stopped there.
      if (resourceId.startsWith('memory.')) {
        if (!ownsMemoryResource(resourceId)) {
          const applied = upsertSyncedMemory(
            {
              kind: String(payload.kind || ''),
              title: String(payload.title || ''),
              content: String(payload.content || ''),
              importance: typeof payload.importance === 'number' ? payload.importance : undefined,
            },
            imported[resourceId],
          );
          // The local row id is remembered, so a later edit of the same record
          // updates that memory instead of adding a second copy of it.
          if (applied) imported[resourceId] = applied.id;
        }
        observeRecordVector(vectorState, resourceId, record, conflictedIds);
        continue;
      }

      // A reminder set on the phone becomes a real reminder here, with a timer,
      // and one finished on the phone calls the timer off. Without this the
      // account carried reminders that only one device ever acted on.
      if (resourceId.startsWith('reminder.')) {
        if (!ownsReminderResource(resourceId)) {
          const reminder = parseReminderPayload(payload);
          if (reminder) {
            adoptSyncedReminder({
              id: resourceId,
              title: reminder.title,
              dueAt: reminder.dueAt,
              status: reminder.status,
            });
          }
        }
        observeRecordVector(vectorState, resourceId, record, conflictedIds);
        continue;
      }

      if (!resourceId.startsWith('conversation.')) {
        observeRecordVector(vectorState, resourceId, record, conflictedIds);
        continue;
      }

      // A conversation is one thing both clients edit, not a copy each keeps. A
      // record already adopted here is merged into the window it belongs to;
      // skipping it, as this did, meant a chat continued on the phone never
      // reached the desktop again after the first import.
      const adopted = imported[resourceId];
      if (adopted) {
        if (getChatWindow(adopted)) mergeConversation(adopted, payload);
      } else if (!ownsResource(resourceId)) {
        // Records this desktop writes for its own windows come back on the feed;
        // adopting them would clone every window on every sync.
        const windowId = adoptConversation(payload);
        if (windowId) imported[resourceId] = windowId;
      }
      observeRecordVector(vectorState, resourceId, record, conflictedIds);
    }
    cursor = typeof changes.nextCursor === 'string' ? changes.nextCursor : session.cursor;
    persistSyncProgress(session, client, imported, vectorState, cursor, new Date().toISOString());
    if (conflicts.length) {
      throw new CloudProtocolError(
        409,
        'sync-conflict',
        `这些云端项目也在别的设备上改过，已停止覆盖：${conflicts.slice(0, 3).map(item => item.label).join('、')}`,
        { conflicts },
      );
    }
    lastError = null;
    return getCloudAccountStatus();
  } catch (error) {
    // Preserve every accepted vector even when a later resource or the pull
    // fails. Otherwise the next run retries successful writes from `{}` and
    // turns a partial network failure into permanent conflicts.
    persistSyncProgress(session, client, imported, vectorState, cursor, session.lastSyncAt);
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function observeRecordVector(
  vectorState: CloudSyncVectorState,
  resourceId: string,
  record: Record<string, unknown>,
  conflictedIds: Set<string>,
): void {
  if (conflictedIds.has(resourceId)) return;
  if (!vectorState.observe(resourceId, record.vector)) {
    throw new CloudProtocolError(502, 'invalid-sync-vector', 'Athena Cloud 返回了无效的同步版本。');
  }
}

function persistSyncProgress(
  session: StoredSession,
  client: CloudProtocol,
  imported: Record<string, number>,
  vectorState: CloudSyncVectorState,
  cursor: string | null,
  lastSyncAt: string | null,
): void {
  writeSession({
    ...session,
    version: 2,
    accessToken: client.session.accessToken || session.accessToken,
    refreshToken: client.session.refreshToken || session.refreshToken,
    lastSyncAt,
    cursor,
    imported,
    resourceVectors: vectorState.snapshot(),
  });
}

export function queueCloudWindowSync(windowId: number): void {
  const settings = getAppSettings();
  if (!settings.cloud.syncEnabled || !canUseNetworkCapability('cloudSync')) return;
  void syncCloudAccountNow().catch(error => {
    lastError = error instanceof Error ? error.message : String(error);
  });
  void windowId;
}

async function pushLocalState(
  client: CloudProtocol,
  imported: Record<string, number>,
  vectorState: CloudSyncVectorState,
): Promise<SyncConflict[]> {
  // windowId -> the record it belongs to. A window adopted from another client
  // keeps writing to that client's record; pushing it under a desktop id would
  // put two records in the account for one conversation, and the phone would
  // list the same chat twice.
  const adopted = new Map<number, string>();
  for (const [resourceId, windowId] of Object.entries(imported)) adopted.set(windowId, resourceId);

  // Named so the account panel can say which conversations are waiting, rather
  // than the sync appearing to have succeeded.
  const conflicts: SyncConflict[] = [];

  const windows = listChatWindows(false, false);
  for (const window of windows) {
    if (!shouldSyncWindow(window)) continue;
    const messages = getChatWindowMessages(window.id, 80);
    const payload = toConversationPayload(window, messages);
    // A window whose syncable turns were all filtered out has nothing to send;
    // pushing an empty conversation would only create a record of its existence.
    if (payload.turns.length === 0) continue;
    const resourceId = adopted.get(window.id) || conversationResourceId(window.id);
    const first = await pushTrackedRecord(client, vectorState, {
      resourceId,
      resourceType: 'conversation',
      schemaVersion: 1,
      payload,
      deleted: false,
    });
    if (first.outcome === 'conflict') {
      // Nothing is rewritten here. Retrying against the server's vector, which
      // is what this did, is a silent overwrite wearing a retry's clothes: the
      // turns the other client had added went away without anyone being told.
      // The server refuses to pick a side and the client may not either, so the
      // conflict is reported and the window is left alone until it is settled.
      conflicts.push({ resourceId, label: window.title || resourceId, reason: String(first.reason || 'conflict') });
    }
  }

  // Reminders finished here are pushed alongside the pending ones: a phone that
  // is never told a reminder was done goes on showing it forever.
  for (const job of listSyncableReminders()) {
    const resourceId = reminderResourceId(job.id);
    const result = await pushTrackedRecord(client, vectorState, {
      resourceId,
      resourceType: 'reminder',
      schemaVersion: 1,
      payload: toReminderPayload(job),
      deleted: false,
    });
    if (result.outcome === 'conflict') conflicts.push({ resourceId, label: job.title || resourceId, reason: String(result.reason || 'conflict') });
  }

  const memories = listMemories({ kind: 'profile', limit: 40 });
  for (const item of memories.items) {
    const resourceId = memoryResourceId(item.kind, item.id);
    const result = await pushTrackedRecord(client, vectorState, {
      resourceId,
      resourceType: 'memory',
      schemaVersion: 1,
      payload: toMemoryPayload(item),
      deleted: false,
    });
    if (result.outcome === 'conflict') conflicts.push({ resourceId, label: item.title || resourceId, reason: String(result.reason || 'conflict') });
  }

  return conflicts;
}

/**
 * Records this desktop writes for its own memories come back on the feed.
 * Applying them would import a copy of every local memory on every sync.
 */
function ownsMemoryResource(resourceId: string): boolean {
  return /^memory\.desktop-/.test(resourceId);
}

/** Whether this resource is one this desktop writes for a window of its own. */
function ownsResource(resourceId: string): boolean {
  const windowId = desktopWindowIdFromResourceId(resourceId);
  return windowId !== null && Boolean(getChatWindow(windowId));
}

function conversationMode(payload: Record<string, unknown>): 'create' | 'reason' | 'companion' {
  return payload.mode === 'create' || payload.mode === 'reason' ? payload.mode : 'companion';
}

/**
 * Turns written elsewhere that this window does not have yet.
 *
 * Matched on role and text because that is the only key both clients can agree
 * on: saveChatMessage stamps its own created_at, so a turn re-read on the next
 * sync would never match by time. The cost is that sending the identical
 * sentence twice in one conversation syncs once.
 */
function mergeConversation(windowId: number, payload: Record<string, unknown>): number {
  const fallback = conversationMode(payload);
  for (const turn of turnsToAppend(getChatWindowMessages(windowId, 500), payload.turns)) {
    const mode = turn.mode ? conversationMode({ mode: turn.mode }) : fallback;
    saveChatMessage(windowId, turn.role, turn.content, undefined, mode);
  }
  return windowId;
}

/** First sight of a conversation written by another client: give it a window. */
function adoptConversation(payload: Record<string, unknown>): number | null {
  const title = incomingConversationTitle({
    origin: payload.origin === 'android' ? 'android' : 'desktop',
    title: String(payload.title || ''),
    mode: conversationMode(payload),
    turns: [],
  });
  const window = createChatWindow({ title, mode: conversationMode(payload) });
  mergeConversation(window.id, payload);
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
    version: 2,
    accessToken: String(body.accessToken || client.session.accessToken || ''),
    refreshToken: String(body.refreshToken || client.session.refreshToken || ''),
    tenantId: String(body.tenantId || client.session.tenantId || ''),
    userId: String(body.userId || client.session.userId || ''),
    deviceId: client.session.deviceId,
    email: email.trim(),
    lastSyncAt: null,
    cursor: null,
    imported: {},
    resourceVectors: {},
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
