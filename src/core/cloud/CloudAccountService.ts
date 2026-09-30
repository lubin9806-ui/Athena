import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { networkInterfaces } from 'os';
import { getAppSettings, getCloudSyncSettingsRevision, saveSettingsBundle } from '../config/SettingsStore';
import { canUseNetworkCapability } from '../privacy/PrivacyDataService';
import { createChatWindow, deleteChatWindow, getChatWindow, getChatWindowMessages, listChatWindows, saveChatMessage } from '../../memory';
import { deleteMemory, listMemories, upsertSyncedMemory, type MemoryKind } from '../../memory/admin';
import { adoptSyncedReminder, deleteSyncedReminder } from '../scheduler/Reminder';
import { listSyncableReminders } from '../scheduler/ScheduledJobStore';
import { resolvePersonaCard, savePersonaCard, type PersonaCardPatch } from '../ai/Personality';
import type { CloudAccountSettings, CloudSessionStatus, CloudSyncCategories } from '../../shared/types/cloud';
import { CloudProtocol, CloudProtocolError, isSessionEnded } from './CloudProtocol';
import { applyCloudBackground, BACKGROUND_RESOURCE_ID, desktopBackgroundPayload } from './BackgroundSync';
import { resolveAccountServiceBaseUrl } from './AccountServiceConfig';
import {
  conversationResourceId,
  desktopMemoryRefFromResourceId,
  desktopReminderJobIdFromResourceId,
  desktopWindowIdFromResourceId,
  incomingConversationTitle,
  memoryResourceId,
  parseReminderPayload,
  reminderResourceId,
  shouldSyncWindow,
  toConversationPayload,
  toMemoryPayload,
  toReminderPayload,
  turnsToAppend,
} from './CloudSyncMapper';

interface StoredSession {
  version: 1;
  /** Tokens stay bound to the service that issued them, even if settings later change. */
  baseUrl?: string;
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  deviceId: string | null;
  email: string;
  lastSyncAt: string | null;
  cursor: string | null;
  imported: Record<string, number>;
  /** Kind is stored separately so a remote memory tombstone can remove the right local table row. */
  importedMemoryKinds?: Record<string, MemoryKind>;
  role?: string | null;
  mfaEnabled?: boolean | null;
  devices?: CloudSessionStatus['devices'];
  /** Last server vector seen for each synced resource. Older sessions omit it. */
  vectors?: Record<string, Record<string, number>>;
  /** A category change replays the feed so newly enabled kinds are not skipped behind the old cursor. */
  syncCategoriesKey?: string;
}

let lastError: string | null = null;
let sessionGeneration = 0;

export function getCloudAccountStatus(): CloudSessionStatus {
  const appSettings = getAppSettings();
  const settings = appSettings.cloud;
  const session = readSession();
  const sessionAccount = normalizeAccountEmail(session?.email || settings.email);
  return {
    signedIn: Boolean(session?.accessToken),
    syncEnabled: Boolean(session?.accessToken)
      && settings.syncEnabled
      && Boolean(sessionAccount)
      && settings.mergeReviewedAccount === sessionAccount,
    baseUrl: session?.baseUrl || resolveAccountServiceBaseUrl(appSettings.developerMode, settings.baseUrl),
    email: session?.email || settings.email,
    tenantId: session?.tenantId || settings.tenantId || null,
    deviceId: session?.deviceId || null,
    userId: session?.userId || null,
    role: session?.role ?? null,
    mfaEnabled: session?.mfaEnabled ?? null,
    devices: session?.devices || [],
    lastSyncAt: session?.lastSyncAt || null,
    lastError,
  };
}

export async function refreshCloudAccountStatus(): Promise<CloudSessionStatus> {
  const client = createClientFromSession();
  const session = readSession();
  if (!client || !session) return getCloudAccountStatus();
  const generation = sessionGeneration;
  try {
    // Sequential on purpose: if the access token expired, the first call rotates
    // the one-time refresh token before the second call starts.
    const account = await client.account();
    if (!sameCurrentSession(session, generation)) return getCloudAccountStatus();
    const deviceBody = await client.listDevices();
    if (!sameCurrentSession(session, generation)) return getCloudAccountStatus();
    const devices = Array.isArray(deviceBody.devices)
      ? deviceBody.devices.filter(isRecord).map(device => ({
        id: String(device.id || ''),
        name: String(device.name || '未命名设备'),
        platform: String(device.platform || 'unknown'),
        active: device.status === 'active',
      })).filter(device => device.id)
      : [];
    writeSession({
      ...session,
      accessToken: client.session.accessToken || session.accessToken,
      refreshToken: client.session.refreshToken || session.refreshToken,
      tenantId: String(account.tenantId || session.tenantId),
      userId: String(account.userId || session.userId),
      deviceId: client.session.deviceId || session.deviceId,
      email: String(account.email || session.email),
      role: typeof account.role === 'string' ? account.role : null,
      mfaEnabled: typeof account.mfaEnabled === 'boolean' ? account.mfaEnabled : null,
      devices,
    });
    lastError = null;
  } catch (error) {
    if (sameCurrentSession(session, generation)) {
      if (isSessionEnded(error)) writeSession(null);
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return getCloudAccountStatus();
}

export async function registerCloudAccount(input: { tenantName: string; email: string; password: string }): Promise<CloudSessionStatus> {
  const generation = ++sessionGeneration;
  const client = createClient();
  const settings = getAppSettings().cloud;
  const body = await client.register({
    tenantName: input.tenantName.trim() || 'Athena',
    email: input.email.trim(),
    password: input.password,
    deviceName: settings.deviceName || 'Athena Desktop',
  });
  if (generation !== sessionGeneration) return getCloudAccountStatus();
  persistSession(client, input.email, body);
  saveSettingsBundle({
    settings: {
      cloud: {
        ...settings,
        syncEnabled: false,
        email: input.email.trim(),
        tenantId: String(body.tenantId || ''),
      },
    },
  });
  lastError = null;
  return refreshCloudAccountStatus();
}

export async function loginCloudAccount(input: {
  email: string;
  password: string;
  mfaCode?: string | null;
  recoveryCode?: string | null;
}): Promise<CloudSessionStatus> {
  const generation = ++sessionGeneration;
  const client = createClient();
  const settings = getAppSettings().cloud;
  const body = await client.login({
    email: input.email.trim(),
    password: input.password,
    mfaCode: input.mfaCode || null,
    recoveryCode: input.recoveryCode || null,
    deviceName: settings.deviceName || 'Athena Desktop',
  });
  if (generation !== sessionGeneration) return getCloudAccountStatus();
  persistSession(client, input.email, body);
  saveSettingsBundle({
    settings: {
      cloud: {
        ...settings,
        syncEnabled: false,
        email: input.email.trim(),
        tenantId: String(body.tenantId || client.session.tenantId || ''),
      },
    },
  });
  lastError = null;
  return refreshCloudAccountStatus();
}

export async function logoutCloudAccount(): Promise<CloudSessionStatus> {
  const client = createClientFromSession();
  const generation = ++sessionGeneration;
  saveSettingsBundle({ settings: { cloud: { syncEnabled: false } } });
  if (client) {
    try { await client.logout(); } catch { /* still clear local session */ }
  }
  if (generation !== sessionGeneration) return getCloudAccountStatus();
  writeSession(null);
  lastError = null;
  return getCloudAccountStatus();
}

export async function deleteCloudAccount(): Promise<CloudSessionStatus> {
  const client = createClientFromSession();
  if (!client) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
  const generation = ++sessionGeneration;
  await client.deleteAccount();
  if (generation !== sessionGeneration) return getCloudAccountStatus();
  const settings = getAppSettings().cloud;
  writeSession(null);
  saveSettingsBundle({
    settings: {
      cloud: {
        ...settings,
        syncEnabled: false,
        mergeReviewedAccount: '',
        tenantId: '',
      },
    },
  });
  lastError = null;
  return getCloudAccountStatus();
}

export interface CloudPairingOffer {
  code: string;
  expiresInSeconds: number;
  expiresAt: string;
  /** A short-lived hand-off, never an access or refresh token. */
  pairingUri: string;
}

export async function createCloudPairingOffer(): Promise<CloudPairingOffer> {
  // Pairing is a computer-connection capability, not account login. The local
  // service deliberately creates a separate, revocable device session without
  // reading or changing the Desktop's Athena account session.
  const settings = getAppSettings().cloud;
  const localBaseUrl = CloudProtocol.assertBaseUrl(settings.pairingBaseUrl);
  const client = new CloudProtocol(localBaseUrl, 'desktop');
  const body = await client.offerPairing(settings.deviceName || 'Athena Desktop', false);
  const code = String(body.code || '');
  const mobileBaseUrl = mobilePairingBaseUrl(localBaseUrl);
  return {
    code,
    expiresInSeconds: Number(body.expiresInSeconds || 0),
    expiresAt: String(body.expiresAt || ''),
    pairingUri: buildMobilePairingUri(mobileBaseUrl, code),
  };
}

/**
 * This is data for a native phone app link, not an authentication URL. The
 * phone still has to exchange its one-time code with the configured server.
 */
export function buildMobilePairingUri(baseUrl: string, code: string): string {
  const normalized = assertMobilePairingBaseUrl(baseUrl);
  if (!/^\d{6}$/.test(code)) throw new CloudProtocolError(0, 'invalid-code', '手机配对码格式无效。');
  const uri = new URL('athena://pair');
  uri.searchParams.set('version', '1');
  uri.searchParams.set('server', normalized);
  uri.searchParams.set('code', code);
  return uri.toString();
}

/**
 * Desktop talks to the local service through loopback. A physical phone cannot:
 * for a local engineering Cloud, hand it the preferred private IPv4 instead.
 */
export function mobilePairingBaseUrl(baseUrl: string, privateAddress = preferredPrivateIpv4()): string {
  const normalized = CloudProtocol.assertBaseUrl(baseUrl);
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname) || !privateAddress || !isPrivateIpv4(privateAddress)) {
    return normalized;
  }
  parsed.hostname = privateAddress;
  return parsed.toString().replace(/\/$/, '');
}

function assertMobilePairingBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CloudProtocolError(0, 'base-url-invalid', '手机配对地址无效。');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CloudProtocolError(0, 'base-url-invalid', '手机配对地址无效。');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname) && !isPrivateIpv4(parsed.hostname)) {
    throw new CloudProtocolError(0, 'cleartext-forbidden', '手机配对的 HTTP 地址必须位于本机或私有局域网。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CloudProtocolError(0, 'base-url-invalid', '手机配对地址协议无效。');
  }
  return trimmed;
}

function preferredPrivateIpv4(): string | null {
  const candidates: Array<{ address: string; score: number }> = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    const label = name.toLowerCase();
    const virtual = /(vethernet|virtual|vmware|vbox|hyper-v|tailscale|vpn|wsl|docker)/.test(label);
    const preferred = /(wi-?fi|wlan|wireless)/.test(label) ? 100 : /(ethernet|以太网)/.test(label) ? 80 : 20;
    for (const entry of addresses || []) {
      if (entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4(entry.address)) continue;
      candidates.push({ address: entry.address, score: preferred - (virtual ? 200 : 0) });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.address.localeCompare(right.address));
  return candidates[0]?.address || null;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost';
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(value => Number(value));
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export async function syncCloudAccountNow(
  mergeConflictChoice?: 'local' | 'cloud',
): Promise<CloudSessionStatus> {
  if (!canUseNetworkCapability('cloudSync')) {
    throw new CloudProtocolError(403, 'consent-required', '跨设备同步需要先在隐私中心同意。');
  }
  const client = createClientFromSession();
  if (!client) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
  const session = readSession();
  if (!session) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
  const cloudSettings = getAppSettings().cloud;
  if (cloudSettings.mergeReviewedAccount !== normalizeAccountEmail(session.email)) {
    throw new CloudProtocolError(409, 'merge-decision-required', '请先决定是否合并这台电脑的本机内容。');
  }
  if (!cloudSettings.syncEnabled) {
    throw new CloudProtocolError(403, 'sync-disabled', '尚未打开 Athena 账号同步。');
  }
  const categories = cloudSettings.syncCategories;
  const categoriesKey = JSON.stringify(categories);
  const settingsRevision = getCloudSyncSettingsRevision();
  const generation = sessionGeneration;
  const assertSyncCurrent = (): void => {
    if (!sameCurrentSession(session, generation)) {
      throw new CloudProtocolError(409, 'sync-session-changed', '账号会话已改变，本轮同步已停止；本机数据仍保留。');
    }
    const current = getAppSettings().cloud;
    if (getCloudSyncSettingsRevision() !== settingsRevision
      || !current.syncEnabled || !canUseNetworkCapability('cloudSync')
      || current.mergeReviewedAccount !== normalizeAccountEmail(session.email)
      || JSON.stringify(current.syncCategories) !== categoriesKey) {
      throw new CloudProtocolError(409, 'sync-settings-changed', '同步选择已改变，本轮同步已停止；请按当前选择重新同步。');
    }
  };

  const imported = { ...session.imported };
  const importedMemoryKinds = { ...(session.importedMemoryKinds || {}) };
  const vectors = { ...(session.vectors || {}) };
  const pulled = await pullAllChanges(client, session.syncCategoriesKey === categoriesKey ? session.cursor : null, assertSyncCurrent);
  assertSyncCurrent();
  // Preference records are whole-value settings, not append-only histories.
  // Without a durable local dirty marker, a difference can never be assumed
  // safe to overwrite in either direction, even after the first sync.
  const preferenceConflicts = findPreferenceConflicts(pulled.records, categories);
  if (preferenceConflicts.size > 0 && !mergeConflictChoice) {
    const labels = [...preferenceConflicts].map(resourceId => {
      if (resourceId === 'preference.persona') return '人格卡';
      if (resourceId === BACKGROUND_RESOURCE_ID) return '背景图';
      if (resourceId === 'preference.settings') return '互动偏好';
      return '成年模式状态';
    });
    throw new CloudProtocolError(
      409,
      'merge-conflict',
      `账号与本机的${labels.join('、')}版本不同，请明确选择保留哪一边。`,
    );
  }
  // A preference that arrived in this pull is already the account version. If
  // we apply it and immediately push the local representation back, receivers
  // that deliberately decode/re-encode data (background images in particular)
  // manufacture a new byte-level version and make the other device ask about a
  // conflict again. Only an explicit "use local" decision may write one of the
  // pulled conflicting preferences back during this sync.
  const skipPreferencePush = new Set<string>();
  for (const record of pulled.records) {
    if (!isRecord(record)) continue;
    const resourceId = String(record.resourceId || '');
    if (!isPreferenceResource(resourceId) || !shouldSyncResource(resourceId, categories)) continue;
    if (!preferenceConflicts.has(resourceId) || mergeConflictChoice === 'cloud') {
      skipPreferencePush.add(resourceId);
    }
  }
  for (const record of pulled.records) {
    if (!isRecord(record)) continue;
    const resourceId = String(record.resourceId || '');
    if (!shouldSyncResource(resourceId, categories)) continue;
    const vector = syncVector(record.vector);
    if (resourceId && Object.keys(vector).length) vectors[resourceId] = vector;
    if (record.deleted === true) {
      applyCloudTombstone(resourceId, imported, importedMemoryKinds);
      continue;
    }
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) continue;

    if (resourceId === 'preference.persona') {
      if (preferenceConflicts.has(resourceId) && mergeConflictChoice === 'local') continue;
      applyPersonaPreference(payload);
      continue;
    }
    if (resourceId === 'preference.adult-mode') {
      if (preferenceConflicts.has(resourceId) && mergeConflictChoice === 'local') continue;
      applyAdultModePreference(payload);
      continue;
    }
    if (resourceId === 'preference.settings') {
      if (preferenceConflicts.has(resourceId) && mergeConflictChoice === 'local') continue;
      applySettingsPreference(payload);
      continue;
    }
    if (resourceId === BACKGROUND_RESOURCE_ID) {
      if (preferenceConflicts.has(resourceId) && mergeConflictChoice === 'local') continue;
      applyCloudBackground(payload);
      continue;
    }

    // Memories written elsewhere become real memories here. Until now the loop
    // skipped every record that was not a conversation, so a memory noted on
    // the phone reached the account and stopped there.
    if (resourceId.startsWith('memory.')) {
      const own = desktopMemoryRefFromResourceId(resourceId);
      const existingId = own?.id || imported[resourceId];
      const applied = upsertSyncedMemory(
        {
          kind: own?.kind || String(payload.kind || ''),
          title: String(payload.title || ''),
          content: String(payload.content || ''),
          importance: typeof payload.importance === 'number' ? payload.importance : undefined,
        },
        existingId,
      );
      // The local row id is remembered, so a later edit of the same record
      // updates that memory instead of adding a second copy of it.
      if (applied && !own) {
        imported[resourceId] = applied.id;
        importedMemoryKinds[resourceId] = applied.kind;
      }
      continue;
    }

    // A reminder set on the phone becomes a real reminder here, with a timer,
    // and one finished on the phone calls the timer off. Without this the
    // account carried reminders that only one device ever acted on.
    if (resourceId.startsWith('reminder.')) {
      const reminder = parseReminderPayload(payload);
      if (reminder) {
        adoptSyncedReminder({
          id: desktopReminderJobIdFromResourceId(resourceId) || resourceId,
          title: reminder.title,
          dueAt: reminder.dueAt,
          status: reminder.status,
        });
      }
      continue;
    }

    if (!resourceId.startsWith('conversation.')) continue;

    // A conversation is one thing both clients edit, not a copy each keeps. A
    // record already adopted here is merged into the window it belongs to;
    // skipping it, as this did, meant a chat continued on the phone never
    // reached the desktop again after the first import.
    const ownWindowId = desktopWindowIdFromResourceId(resourceId);
    if (ownWindowId && getChatWindow(ownWindowId)) {
      mergeConversation(ownWindowId, payload);
      continue;
    }
    const adopted = imported[resourceId];
    if (adopted) {
      if (getChatWindow(adopted)) mergeConversation(adopted, payload);
      continue;
    }
    const windowId = adoptConversation(payload);
    if (windowId) imported[resourceId] = windowId;
  }
  const updatedSession: StoredSession = {
    ...session,
    accessToken: client.session.accessToken || session.accessToken,
    refreshToken: client.session.refreshToken || session.refreshToken,
    // The pull can finish while a later upload fails or is withdrawn. Only a
    // fully completed round advances the visible last-success timestamp.
    lastSyncAt: session.lastSyncAt,
    cursor: pulled.nextCursor,
    imported,
    importedMemoryKinds,
    vectors,
    syncCategoriesKey: categoriesKey,
  };
  // Preserve the pulled vectors even if a device races this one during the
  // following push. Without this, the next sync repeats an empty-base write.
  writeSession(updatedSession);
  await pushLocalState(client, imported, importedMemoryKinds, vectors, skipPreferencePush, assertSyncCurrent);
  assertSyncCurrent();
  writeSession({
    ...updatedSession,
    accessToken: client.session.accessToken || updatedSession.accessToken,
    refreshToken: client.session.refreshToken || updatedSession.refreshToken,
    lastSyncAt: new Date().toISOString(),
    vectors,
  });
  lastError = null;
  return getCloudAccountStatus();
}

export function queueCloudWindowSync(windowId: number): void {
  const settings = getAppSettings();
  if (!settings.cloud.syncEnabled || !settings.cloud.syncCategories.conversations || !canUseNetworkCapability('cloudSync')) return;
  void syncCloudAccountNow().catch(error => {
    lastError = error instanceof Error ? error.message : String(error);
  });
  void windowId;
}

async function pullAllChanges(
  client: CloudProtocol,
  initialCursor: string | null,
  assertSyncCurrent: () => void,
): Promise<{ records: Record<string, unknown>[]; nextCursor: string | null }> {
  const records: Record<string, unknown>[] = [];
  let cursor = initialCursor;
  while (true) {
    assertSyncCurrent();
    const page = await client.listChanges(cursor, 100);
    assertSyncCurrent();
    const pageRecords = Array.isArray(page.records) ? page.records.filter(isRecord) : [];
    records.push(...pageRecords);
    const next = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : cursor;
    if (pageRecords.length < 100 || !next || next === cursor) return { records, nextCursor: next || cursor };
    cursor = next;
  }
}

function applyCloudTombstone(
  resourceId: string,
  imported: Record<string, number>,
  importedMemoryKinds: Record<string, MemoryKind>,
): void {
  if (resourceId.startsWith('memory.')) {
    const own = desktopMemoryRefFromResourceId(resourceId);
    const kind = own?.kind || importedMemoryKinds[resourceId];
    const id = own?.id || imported[resourceId];
    if (id && isMemoryKind(kind)) deleteMemory(kind, id);
    delete imported[resourceId];
    delete importedMemoryKinds[resourceId];
    return;
  }
  if (resourceId.startsWith('reminder.')) {
    deleteSyncedReminder(desktopReminderJobIdFromResourceId(resourceId) || resourceId);
    return;
  }
  if (!resourceId.startsWith('conversation.')) return;
  const windowId = desktopWindowIdFromResourceId(resourceId) || imported[resourceId];
  if (windowId) deleteChatWindow(windowId);
  delete imported[resourceId];
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return value === 'profile' || value === 'procedure' || value === 'fact' || value === 'event'
    || value === 'daily' || value === 'project' || value === 'message';
}

function findPreferenceConflicts(
  records: Record<string, unknown>[],
  categories: CloudSyncCategories,
): Set<string> {
  const conflicts = new Set<string>();
  for (const record of records) {
    if (record.deleted === true) continue;
    const resourceId = String(record.resourceId || '');
    const remote = isRecord(record.payload) ? record.payload : null;
    if (!remote) continue;
    let local: Record<string, unknown> | null = null;
    if (resourceId === 'preference.persona' && categories.persona) local = personaPreferencePayload();
    if (resourceId === 'preference.adult-mode' && categories.adultMode) local = adultModePreferencePayload();
    if (resourceId === 'preference.settings' && categories.preferences) local = settingsPreferencePayload();
    if (resourceId === BACKGROUND_RESOURCE_ID && categories.backgroundImage) local = desktopBackgroundPayload();
    if (local && stableJson(local) !== stableJson(remote)) conflicts.add(resourceId);
  }
  return conflicts;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).filter(key => key !== 'origin').sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeAccountEmail(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

async function pushLocalState(
  client: CloudProtocol,
  imported: Record<string, number>,
  importedMemoryKinds: Record<string, MemoryKind>,
  vectors: Record<string, Record<string, number>>,
  skipPreferencePush: ReadonlySet<string>,
  assertSyncCurrent: () => void,
): Promise<void> {
  const putCurrentRecord = async (record: Record<string, unknown>): Promise<Record<string, unknown>> => {
    assertSyncCurrent();
    const result = await client.putRecord(record);
    assertSyncCurrent();
    return result;
  };
  const categories = getAppSettings().cloud.syncCategories;
  // windowId -> the record it belongs to. A window adopted from another client
  // keeps writing to that client's record; pushing it under a desktop id would
  // put two records in the account for one conversation, and the phone would
  // list the same chat twice.
  const adopted = new Map<number, string>();
  const adoptedMemories = new Map<string, string>();
  for (const [resourceId, windowId] of Object.entries(imported)) {
    if (resourceId.startsWith('conversation.')) adopted.set(windowId, resourceId);
    const kind = importedMemoryKinds[resourceId];
    if (resourceId.startsWith('memory.') && kind) adoptedMemories.set(`${kind}:${windowId}`, resourceId);
  }

  // Named so the account panel can say which conversations are waiting, rather
  // than the sync appearing to have succeeded.
  const conflicted: string[] = [];

  if (categories.conversations) {
    const windows = listChatWindows(false, false);
    for (const window of windows) {
      if (!shouldSyncWindow(window)) continue;
      const messages = getChatWindowMessages(window.id, 80);
      const payload = toConversationPayload(window, messages);
      // A window whose syncable turns were all filtered out has nothing to send;
      // pushing an empty conversation would only create a record of its existence.
      if (payload.turns.length === 0) continue;
      const resourceId = adopted.get(window.id) || conversationResourceId(window.id);
      const first = await putCurrentRecord({
        resourceId,
        resourceType: 'conversation',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload,
        deleted: false,
      });
      if (first.outcome === 'conflict') {
        // Nothing is rewritten here. Retrying against the server's vector, which
        // is what this did, is a silent overwrite wearing a retry's clothes: the
        // turns the other client had added went away without anyone being told.
        // The server refuses to pick a side and the client may not either, so the
        // conflict is reported and the window is left alone until it is settled.
        conflicted.push(window.title || resourceId);
      } else {
        rememberAcceptedVector(vectors, resourceId, first);
      }
    }
  }

  // Reminders finished here are pushed alongside the pending ones: a phone that
  // is never told a reminder was done goes on showing it forever.
  if (categories.reminders) {
    for (const job of listSyncableReminders()) {
      const resourceId = reminderResourceId(job.id);
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'reminder',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: toReminderPayload(job),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push(job.title || resourceId);
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (categories.memories) {
    const memories = listMemories({ kind: 'all', limit: 200 });
    for (const item of memories.items.filter(item => item.kind !== 'message')) {
      const resourceId = adoptedMemories.get(`${item.kind}:${item.id}`) || memoryResourceId(item.kind, item.id);
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'memory',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: toMemoryPayload(item),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push(item.title || resourceId);
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (categories.persona) {
    const resourceId = 'preference.persona';
    if (!skipPreferencePush.has(resourceId)) {
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'preference',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: personaPreferencePayload(),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push('人格卡');
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (categories.adultMode) {
    const resourceId = 'preference.adult-mode';
    if (!skipPreferencePush.has(resourceId)) {
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'preference',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: adultModePreferencePayload(),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push('成年模式状态');
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (categories.backgroundImage) {
    const resourceId = BACKGROUND_RESOURCE_ID;
    if (!skipPreferencePush.has(resourceId)) {
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'preference',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: desktopBackgroundPayload(),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push('背景图');
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (categories.preferences) {
    const resourceId = 'preference.settings';
    if (!skipPreferencePush.has(resourceId)) {
      const result = await putCurrentRecord({
        resourceId,
        resourceType: 'preference',
        schemaVersion: 1,
        baseVector: vectors[resourceId] || {},
        payload: settingsPreferencePayload(),
        deleted: false,
      });
      if (result?.outcome === 'conflict') conflicted.push('互动偏好');
      else if (result) rememberAcceptedVector(vectors, resourceId, result);
    }
  }

  if (conflicted.length) {
    // Surfaced through the status the account panel already reads, so a sync
    // that left something unsettled does not look like one that finished.
    throw new CloudProtocolError(
      409,
      'sync-conflict',
      `这些内容在别的设备上也改过，需要先确认：${conflicted.slice(0, 3).join('、')}`,
    );
  }
}

function isPreferenceResource(resourceId: string): boolean {
  return resourceId === 'preference.persona'
    || resourceId === 'preference.adult-mode'
    || resourceId === 'preference.settings'
    || resourceId === BACKGROUND_RESOURCE_ID;
}

function shouldSyncResource(resourceId: string, categories: CloudSyncCategories): boolean {
  if (resourceId.startsWith('conversation.')) return categories.conversations;
  if (resourceId.startsWith('memory.')) return categories.memories;
  if (resourceId.startsWith('reminder.')) return categories.reminders;
  if (resourceId === 'preference.persona') return categories.persona;
  if (resourceId === 'preference.settings') return categories.preferences;
  if (resourceId === 'preference.background') return categories.backgroundImage;
  if (resourceId === 'preference.adult-mode') return categories.adultMode;
  return false;
}

function personaPreferencePayload(): Record<string, unknown> {
  const card = resolvePersonaCard(getAppSettings().profile);
  return {
    origin: 'desktop',
    schemaVersion: 1,
    profile: {
      displayName: card.displayName,
      nickname: card.nickname,
      description: card.description,
      identity: card.identity,
      relationshipFrame: card.relationshipFrame,
      traits: card.prompt.traits,
      speakingStyle: card.prompt.speakingStyle,
      roleplayNotes: card.prompt.roleplayNotes,
      boundaries: card.prompt.boundaries,
      selfIntroductionExample: card.prompt.selfIntroductionExample,
      systemPrompt: '',
    },
  };
}

function adultModePreferencePayload(): Record<string, unknown> {
  return {
    origin: 'desktop',
    schemaVersion: 1,
    enabled: getAppSettings().conversation.adultModeEnabled,
  };
}

function settingsPreferencePayload(): Record<string, unknown> {
  const settings = getAppSettings().personalization;
  return {
    origin: 'desktop',
    schemaVersion: 1,
    preferredAddress: settings.preferredAddress,
    tone: settings.tone,
    replyLength: settings.replyLength,
  };
}

function applyPersonaPreference(payload: Record<string, unknown>): void {
  const profile = isRecord(payload.profile) ? payload.profile : null;
  if (!profile) return;
  const displayName = cleanPreferenceText(profile.displayName, 120);
  if (!displayName) return;
  const identity = cleanPreferenceText(profile.identity, 4_000)
    || cleanPreferenceText(profile.systemPrompt, 4_000);
  const patch: PersonaCardPatch = {
    displayName,
    nickname: cleanPreferenceText(profile.nickname, 120),
    description: cleanPreferenceText(profile.description, 4_000),
    identity,
    relationshipFrame: cleanPreferenceText(profile.relationshipFrame, 4_000),
    traits: cleanPreferenceItems(profile.traits),
    speakingStyle: cleanPreferenceItems(profile.speakingStyle),
    roleplayNotes: cleanPreferenceItems(profile.roleplayNotes),
    boundaries: cleanPreferenceItems(profile.boundaries),
    selfIntroductionExample: cleanPreferenceText(profile.selfIntroductionExample, 2_000),
  };
  savePersonaCard(getAppSettings().profile, patch);
}

function applyAdultModePreference(payload: Record<string, unknown>): void {
  if (payload.schemaVersion !== 1 || typeof payload.enabled !== 'boolean') return;
  saveSettingsBundle({ settings: { conversation: { adultModeEnabled: payload.enabled } } });
}

function applySettingsPreference(payload: Record<string, unknown>): void {
  if (payload.schemaVersion !== 1) return;
  const tone = ['balanced', 'soft', 'playful', 'direct'].includes(String(payload.tone))
    ? String(payload.tone) as 'balanced' | 'soft' | 'playful' | 'direct'
    : 'balanced';
  const replyLength = ['short', 'balanced', 'detailed'].includes(String(payload.replyLength))
    ? String(payload.replyLength) as 'short' | 'balanced' | 'detailed'
    : 'balanced';
  saveSettingsBundle({
    settings: {
      personalization: {
        preferredAddress: cleanPreferenceText(payload.preferredAddress, 80),
        tone,
        replyLength,
      },
    },
  });
}

function cleanPreferenceText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanPreferenceItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 1_000))
    .filter(Boolean)
    .slice(0, 80);
}

function rememberAcceptedVector(
  vectors: Record<string, Record<string, number>>,
  resourceId: string,
  response: Record<string, unknown>,
): void {
  const record = isRecord(response.record) ? response.record : null;
  const vector = syncVector(record?.vector);
  if (Object.keys(vector).length) vectors[resourceId] = vector;
}

function syncVector(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const vector: Record<string, number> = {};
  for (const [deviceId, revision] of Object.entries(value)) {
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) vector[deviceId] = revision;
  }
  return vector;
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
  const settings = getAppSettings();
  const baseUrl = resolveAccountServiceBaseUrl(settings.developerMode, settings.cloud.baseUrl);
  return new CloudProtocol(CloudProtocol.assertBaseUrl(baseUrl, settings.developerMode), 'desktop');
}

function createClientFromSession(): CloudProtocol | null {
  const session = readSession();
  if (!session) return null;
  const generation = sessionGeneration;
  // Never move a bearer token just because the current endpoint setting was
  // edited. New sessions remember their issuer; legacy sessions use the
  // current resolved endpoint once and become bound on the next token write.
  const client = session.baseUrl
    ? new CloudProtocol(CloudProtocol.assertBaseUrl(session.baseUrl), 'desktop')
    : createClient();
  if (!session.baseUrl) writeSession({ ...session, baseUrl: client.baseUrl });
  client.session = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tenantId: session.tenantId,
    userId: session.userId,
    deviceId: session.deviceId,
  };
  client.onTokensRotated = rotated => {
    const current = readSession();
    if (!current || !sameCurrentSession(session, generation)) return;
    writeSession({
      ...current,
      accessToken: rotated.accessToken || current.accessToken,
      refreshToken: rotated.refreshToken || current.refreshToken,
      tenantId: rotated.tenantId || current.tenantId,
      userId: rotated.userId || current.userId,
      deviceId: rotated.deviceId || current.deviceId,
    });
  };
  return client;
}

function persistSession(client: CloudProtocol, email: string, body: Record<string, unknown>): void {
  sessionGeneration++;
  writeSession({
    version: 1,
    baseUrl: client.baseUrl,
    accessToken: String(body.accessToken || client.session.accessToken || ''),
    refreshToken: String(body.refreshToken || client.session.refreshToken || ''),
    tenantId: String(body.tenantId || client.session.tenantId || ''),
    userId: String(body.userId || client.session.userId || ''),
    deviceId: client.session.deviceId,
    email: email.trim(),
    lastSyncAt: null,
    cursor: null,
    imported: {},
    importedMemoryKinds: {},
    role: null,
    mfaEnabled: null,
    devices: [],
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
    sessionGeneration++;
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全凭据加密当前不可用，账号会话未保存。');
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    blob: safeStorage.encryptString(JSON.stringify(session)).toString('base64'),
  }, null, 2));
}

function sameCurrentSession(expected: StoredSession, generation: number): boolean {
  const current = readSession();
  return generation === sessionGeneration && Boolean(current)
    && current!.tenantId === expected.tenantId && current!.userId === expected.userId
    && current!.deviceId === expected.deviceId && current!.baseUrl === expected.baseUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { CloudAccountSettings };
