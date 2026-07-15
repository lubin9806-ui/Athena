/** IPC handler registration. */

import { ipcMain, BrowserWindow, dialog, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { AthenaController } from '../../core/controller/AthenaController';
import { getAppSettings, getSettingsBundle, saveSettingsBundle } from '../../core/config/SettingsStore';
import { VoiceService } from '../../core/voice/VoiceService';
import { globalEventBus } from '../../engine/EventBus';
import {
  commitChatRecordImport,
  deleteMemory,
  debugRetrieveMemory,
  listMemories,
  previewChatRecordImport,
  updateMemory,
} from '../../memory';
import type { MemoryKind, MemoryListOptions, MemoryUpdatePatch } from '../../memory';
import type { ConversationMode, SettingsBundle, SettingsPatch, ToolStatusEvent, WebSearchStatus } from '../../shared/types';

const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const MAX_CHAT_CHARS = 20_000;
const MAX_TEXT_TO_SPEAK_CHARS = 8_000;
const MAX_PATH_CHARS = 2_048;

const INVOKE_CHANNELS = [
  'chat:send',
  'execution:cancel',
  'system:info',
  'config:get',
  'config:set',
  'memory:list',
  'memory:delete',
  'memory:update',
  'memory:debug',
  'memory:chooseImportFile',
  'memory:previewImport',
  'memory:commitImport',
  'voice:speak',
  'voice:play',
  'voice:chooseAudioFile',
  'voice:transcribeFile',
  'voice:transcribeRecording',
] as const;

const EVENT_CHANNELS = ['window:minimize', 'window:close'] as const;
const MEMORY_KINDS = new Set<MemoryKind>(['profile', 'event', 'project', 'message']);

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  clearIpcHandlers();

  const controller = new AthenaController();
  const voice = new VoiceService();
  const removeReminderListener = globalEventBus.on('reminder:due', (job) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('reminder:due', job);
  });

  const isTrustedSender = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    return !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
  };

  void controller.initialize().catch((error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:error', error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle('chat:send', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;

    const settings = getAppSettings();
    const payload = isRecord(value) ? value : null;
    const userMessage = cleanString(payload?.text ?? value, MAX_CHAT_CHARS).trim();
    if (!userMessage) return null;
    const mode = cleanConversationMode(payload?.mode, settings.conversation.activeMode);
    const forceWebSearch = payload?.forceWebSearch === true;

    try {
      const response = await controller.processMessage(
        userMessage,
        mode,
        (chunk) => {
          if (!settings.conversation.streamResponses) return;
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream', { content: chunk, done: false });
          }
        },
        {
          forceWebSearch,
          onWebSearchStatus: (status: WebSearchStatus) => {
            if (!mainWindow.isDestroyed()) {
              mainWindow.webContents.send('chat:web-search-status', status);
            }
          },
          onToolStatus: (status: ToolStatusEvent) => {
            if (!mainWindow.isDestroyed()) {
              mainWindow.webContents.send('chat:tool-status', status);
            }
          },
        },
      );
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream', { content: '', done: true });
      }
      return response;
    } catch (error) {
      if (!mainWindow.isDestroyed()) {
        const message = error instanceof Error ? error.message : '未知错误';
        mainWindow.webContents.send('chat:error', message);
      }
      return null;
    }
  });

  ipcMain.handle('system:info', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getSystemInfo();
  });

  ipcMain.handle('execution:cancel', async (event) => {
    if (!isTrustedSender(event)) return false;
    return controller.cancelCurrentExecution() > 0;
  });

  ipcMain.handle('config:get', async (event) => {
    if (!isTrustedSender(event)) return null;
    return toRendererSettingsBundle(getSettingsBundle());
  });

  ipcMain.handle('config:set', async (event, patch: unknown) => {
    if (!isTrustedSender(event)) return null;
    const bundle = saveSettingsBundle(cleanSettingsPatch(patch));
    controller.applyToolPermission(bundle.settings.tools, bundle.settings.conversation.activeMode);
    return toRendererSettingsBundle(bundle);
  });

  ipcMain.handle('memory:list', async (event, options: unknown) => {
    if (!isTrustedSender(event)) return { items: [], totals: emptyMemoryTotals() };
    return listMemories(cleanMemoryListOptions(options));
  });

  ipcMain.handle('memory:delete', async (event, kind: unknown, id: unknown) => {
    if (!isTrustedSender(event)) return false;
    const memoryKind = cleanMemoryKind(kind);
    const memoryId = cleanPositiveInteger(id);
    return memoryKind && memoryId ? deleteMemory(memoryKind, memoryId) : false;
  });

  ipcMain.handle('memory:update', async (event, kind: unknown, id: unknown, patch: unknown) => {
    if (!isTrustedSender(event)) return false;
    const memoryKind = cleanMemoryKind(kind);
    const memoryId = cleanPositiveInteger(id);
    return memoryKind && memoryId ? updateMemory(memoryKind, memoryId, cleanMemoryPatch(patch)) : false;
  });

  ipcMain.handle('memory:debug', async (event, query: unknown) => {
    if (!isTrustedSender(event)) return emptyMemoryDebug();
    return debugRetrieveMemory(cleanString(query, 1_000));
  });

  ipcMain.handle('memory:chooseImportFile', async (event) => {
    if (!isTrustedSender(event)) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择聊天记录 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('memory:previewImport', async (event, sourcePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('IPC sender rejected.');
    return previewChatRecordImport(cleanString(sourcePath, MAX_PATH_CHARS));
  });

  ipcMain.handle('memory:commitImport', async (event, sourcePath: unknown, candidateIds?: unknown) => {
    if (!isTrustedSender(event)) throw new Error('IPC sender rejected.');
    return commitChatRecordImport(cleanString(sourcePath, MAX_PATH_CHARS), cleanCandidateIds(candidateIds));
  });

  ipcMain.handle('voice:speak', async (event, text: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'IPC sender rejected.' };
    if (!getAppSettings().voice.ttsEnabled) return { ok: false, error: 'TTS is disabled in settings.' };
    return voice.synthesize(cleanString(text, MAX_TEXT_TO_SPEAK_CHARS));
  });

  ipcMain.handle('voice:play', async (event, sourcePath: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'IPC sender rejected.' };
    return voice.play(cleanString(sourcePath, MAX_PATH_CHARS));
  });

  ipcMain.handle('voice:chooseAudioFile', async (event) => {
    if (!isTrustedSender(event)) return null;
    if (!getAppSettings().voice.sttEnabled) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择音频文件',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('voice:transcribeFile', async (event, sourcePath: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'IPC sender rejected.' };
    if (!getAppSettings().voice.sttEnabled) return { ok: false, error: 'STT is disabled in settings.' };
    return voice.transcribe(cleanString(sourcePath, MAX_PATH_CHARS));
  });

  ipcMain.handle('voice:transcribeRecording', async (event, audioBytes: unknown) => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: 'Recording request was rejected.' };
    }
    if (!(audioBytes instanceof Uint8Array)) {
      return { ok: false, error: 'Recording payload must be audio bytes.' };
    }
    if (!getAppSettings().voice.sttEnabled) {
      return { ok: false, error: 'STT is disabled in settings.' };
    }
    if (audioBytes.byteLength === 0) {
      return { ok: false, error: 'Recording is empty.' };
    }
    if (audioBytes.byteLength > MAX_RECORDING_BYTES) {
      return { ok: false, error: 'Recording is too large (maximum 12 MB).' };
    }
    return voice.transcribeRecording(audioBytes);
  });

  ipcMain.on('window:minimize', (event) => {
    if (isTrustedSender(event)) mainWindow.minimize();
  });
  ipcMain.on('window:close', (event) => {
    if (isTrustedSender(event)) mainWindow.close();
  });

  mainWindow.once('closed', () => {
    clearIpcHandlers();
    removeReminderListener();
    controller.shutdown();
  });
}

function clearIpcHandlers(): void {
  for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel);
  for (const channel of EVENT_CHANNELS) ipcMain.removeAllListeners(channel);
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function cleanPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanMemoryKind(value: unknown): MemoryKind | null {
  return typeof value === 'string' && MEMORY_KINDS.has(value as MemoryKind)
    ? value as MemoryKind
    : null;
}

function cleanConversationMode(value: unknown, fallback: ConversationMode): ConversationMode {
  return value === 'create' || value === 'companion' || value === 'reason' || value === 'execute'
    ? value
    : fallback;
}

function cleanMemoryListOptions(value: unknown): MemoryListOptions {
  if (!isRecord(value)) return {};
  const kind = value.kind === 'all' ? 'all' : cleanMemoryKind(value.kind);
  const limit = typeof value.limit === 'number' ? Math.max(1, Math.min(200, Math.round(value.limit))) : undefined;
  return {
    kind: kind || 'all',
    query: cleanString(value.query, 500),
    limit,
  };
}

function cleanMemoryPatch(value: unknown): MemoryUpdatePatch {
  if (!isRecord(value)) return {};
  return {
    title: cleanString(value.title, 300),
    content: cleanString(value.content, 10_000),
    importance: cleanOptionalNumber(value.importance, 1, 10),
    confidence: cleanOptionalNumber(value.confidence, 0, 1),
  };
}

function cleanSettingsPatch(value: unknown): SettingsPatch {
  return isRecord(value) ? value as SettingsPatch : {};
}

function toRendererSettingsBundle(bundle: SettingsBundle): SettingsBundle {
  return {
    settings: bundle.settings,
    model: {
      ...bundle.model,
      ollama: { ...bundle.model.ollama },
      deepseek: {
        ...bundle.model.deepseek,
        // The renderer does not edit this credential, so it never needs the plaintext value.
        apiKey: '',
      },
      fallback: { ...bundle.model.fallback },
    },
  };
}

function cleanOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, parsed));
}

function cleanCandidateIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map(cleanNonNegativeInteger)
    .filter((id): id is number => id !== null)
    .slice(0, 500);
  return ids.length > 0 ? ids : undefined;
}

function cleanNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function emptyMemoryTotals(): Record<MemoryKind, number> {
  return { profile: 0, event: 0, project: 0, message: 0 };
}

function emptyMemoryDebug() {
  return {
    query: '',
    keywords: [],
    relevanceScore: 0,
    profileFacts: [],
    relatedEvents: [],
    projectNotes: [],
    recentMessages: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
