/** IPC handler registration. */

import { ipcMain, BrowserWindow, dialog, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { AthenaController } from '../../core/controller/AthenaController';
import { getAppSettings, getSettingsBundle, saveSettingsBundle } from '../../core/config/SettingsStore';
import {
  applyDataRetention,
  canUseNetworkCapability,
  cleanupVoiceCache,
  clearAllLocalData,
  exportAllData,
  getPrivacyCenterState,
  recordDataActivity,
} from '../../core/privacy/PrivacyDataService';
import { VoiceService } from '../../core/voice/VoiceService';
import { LLMClient } from '../../core/ai/Client';
import { canRouteModelRequest } from '../../core/ai/ModelNetworkPolicy';
import { getPersonaEditorState, importPersonaCardFromFile, savePersonaCard, type PersonaCardPatch, type ResolvedPersonaCard } from '../../core/ai/Personality';
import {
  clearModelCredential,
  getModelCredentialStatus,
  setModelCredential,
} from '../../core/ai/CredentialStore';
import {
  getOllamaSetupStatus,
  installBundledOllama,
  openOllamaDownload,
  pullOllamaModel,
} from '../../core/ai/OllamaSetupService';
import { globalEventBus } from '../../engine/EventBus';
import {
  commitChatRecordImport,
  activateChatWindow,
  createProject,
  archiveChatWindow,
  createChatWindow,
  createTemporaryChatWindow,
  deleteMemory,
  deleteChatWindow,
  debugRetrieveMemory,
  ensureDefaultChatWindow,
  ensureDefaultProject,
  getRecentContextSnapshots,
  getChatWindowMessages,
  listProjects,
  listMemories,
  listMemoryReviewQueue,
  listChatWindows,
  pinChatWindowFact,
  previewChatRecordImport,
  renameChatWindow,
  approveMemoryReviewItem,
  approveMemoryReviewItems,
  rejectMemoryReviewItem,
  rejectMemoryReviewItems,
  unpinChatWindowFact,
  updateProject,
  updateMemory,
} from '../../memory';
import type { MemoryKind, MemoryListOptions, MemoryReviewListOptions, MemoryUpdatePatch } from '../../memory';
import type { RemoteModelProvider, SettingsBundle, SettingsPatch, ToolConfirmationRequest, ToolStatusEvent, WebSearchStatus } from '../../shared/types';
import { armMicrophoneGrant, revokeMicrophoneGrant } from '../security/PermissionGate';
import { applyDesktopSettings, showReminderNotification } from '../DesktopSettings';
import { cleanChatPayload, cleanExistingFilePath, isTrustedIpcSender } from './validation';

const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_TO_SPEAK_CHARS = 8_000;
const MAX_PATH_CHARS = 2_048;

const INVOKE_CHANNELS = [
  'chat:send',
  'project:list',
  'project:create',
  'project:update',
  'chatWindow:list',
  'chatWindow:create',
  'chatWindow:createTemporary',
  'chatWindow:activate',
  'chatWindow:rename',
  'chatWindow:archive',
  'chatWindow:delete',
  'chatWindow:messages',
  'chatWindow:pinFact',
  'chatWindow:unpinFact',
  'chatWindow:contextSnapshots',
  'execution:cancel',
  'agentWorkspace:get',
  'agentWorkspace:update',
  'agentRun:resolveApproval',
  'agentRun:resume',
  'agentRun:cancel',
  'skill:list',
  'skill:installFromDirectory',
  'skill:setTrust',
  'skill:setEnabled',
  'skill:uninstall',
  'tools:catalog',
  'system:info',
  'config:get',
  'config:set',
  'persona:get',
  'persona:save',
  'persona:chooseImportFile',
  'persona:importFile',
  'model:credentialStatus',
  'model:setCredential',
  'model:clearCredential',
  'model:listOptions',
  'model:testConnection',
  'model:ollamaStatus',
  'model:openOllamaDownload',
  'model:installBundledOllama',
  'model:pullOllamaModel',
  'memory:list',
  'memory:delete',
  'memory:update',
  'memory:debug',
  'memoryReview:list',
  'memoryReview:approve',
  'memoryReview:approveMany',
  'memoryReview:reject',
  'memoryReview:rejectMany',
  'memory:chooseImportFile',
  'memory:previewImport',
  'memory:commitImport',
  'privacy:get',
  'privacy:export',
  'privacy:clearLocalData',
  'voice:requestMicrophoneAccess',
  'voice:speak',
  'voice:play',
  'voice:chooseAudioFile',
  'voice:transcribeFile',
  'voice:transcribeRecording',
  'voice:capabilities',
] as const;

const EVENT_CHANNELS = ['window:minimize', 'window:close'] as const;
const MEMORY_KINDS = new Set<MemoryKind>(['profile', 'procedure', 'fact', 'event', 'daily', 'project', 'message']);

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  clearIpcHandlers();

  const controller = new AthenaController();
  const voice = new VoiceService();
  const removeReminderListener = globalEventBus.on('reminder:due', (job) => {
    const settings = getAppSettings();
    showReminderNotification(job.title, settings.general.desktopNotifications);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('reminder:due', job);
  });

  const isTrustedSender = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    return isTrustedIpcSender(event, mainWindow);
  };

  void controller.initialize().catch((error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:error', error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle('chat:send', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;

    const settings = getAppSettings();
    const payload = cleanChatPayload(value, settings.conversation.activeMode);
    if (!payload) return null;
    const { text: userMessage, mode, forceWebSearch, chatWindowId } = payload;

    try {
      const response = mode === 'execute'
        ? await controller.executeAgentMessage(
          userMessage,
          chatWindowId,
          snapshot => notifyAgentWorkspaceChanged(mainWindow, snapshot.task.projectId, snapshot.task.id, snapshot.run.id),
        )
        : await controller.processMessage(
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
          chatWindowId,
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
          onToolConfirm: (request: ToolConfirmationRequest) => confirmToolExecution(mainWindow, request),
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

  ipcMain.handle('chatWindow:list', async (event, includeArchived: unknown, projectValue?: unknown) => {
    if (!isTrustedSender(event)) return [];
    const projectId = cleanPositiveInteger(projectValue);
    const windows = listChatWindows(includeArchived === true, false, projectId || undefined);
    return windows.length > 0 ? windows : [ensureDefaultChatWindow(projectId || undefined)];
  });

  ipcMain.handle('project:list', async (event, includeArchived: unknown) => {
    if (!isTrustedSender(event)) return [];
    const projects = listProjects(includeArchived === true);
    return projects.length > 0 ? projects : [ensureDefaultProject()];
  });

  ipcMain.handle('project:create', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const input = isRecord(value) ? value : { title: value };
    return createProject({
      title: cleanString(input.title, 80),
      instructions: cleanString(input.instructions, 4_000),
    });
  });

  ipcMain.handle('project:update', async (event, id: unknown, patch: unknown) => {
    if (!isTrustedSender(event)) return null;
    const projectId = cleanPositiveInteger(id);
    if (!projectId || !isRecord(patch)) return null;
    return updateProject(projectId, {
      title: cleanString(patch.title, 80),
      instructions: typeof patch.instructions === 'string'
        ? cleanString(patch.instructions, 4_000)
        : undefined,
    });
  });

  ipcMain.handle('chatWindow:create', async (event, value: unknown, projectValue?: unknown) => {
    if (!isTrustedSender(event)) return null;
    return createChatWindow({
      title: cleanString(value, 80),
      mode: getAppSettings().conversation.activeMode,
      projectId: cleanPositiveInteger(projectValue) || undefined,
    });
  });

  ipcMain.handle('chatWindow:createTemporary', async (event, projectValue?: unknown) => {
    if (!isTrustedSender(event)) return null;
    return createTemporaryChatWindow({
      title: 'Temporary Chat',
      mode: getAppSettings().conversation.activeMode,
      projectId: cleanPositiveInteger(projectValue) || undefined,
    });
  });

  ipcMain.handle('chatWindow:activate', async (event, id: unknown) => {
    if (!isTrustedSender(event)) return null;
    const windowId = cleanPositiveInteger(id);
    return windowId ? activateChatWindow(windowId) : null;
  });

  ipcMain.handle('chatWindow:rename', async (event, id: unknown, title: unknown) => {
    if (!isTrustedSender(event)) return null;
    const windowId = cleanPositiveInteger(id);
    return windowId ? renameChatWindow(windowId, cleanString(title, 80)) : null;
  });

  ipcMain.handle('chatWindow:archive', async (event, id: unknown, archived: unknown) => {
    if (!isTrustedSender(event)) return null;
    const windowId = cleanPositiveInteger(id);
    return windowId ? archiveChatWindow(windowId, archived !== false) : null;
  });

  ipcMain.handle('chatWindow:delete', async (event, id: unknown) => {
    if (!isTrustedSender(event)) return false;
    const windowId = cleanPositiveInteger(id);
    return windowId ? deleteChatWindow(windowId) : false;
  });

  ipcMain.handle('chatWindow:messages', async (event, id: unknown, limit: unknown) => {
    if (!isTrustedSender(event)) return [];
    const windowId = cleanPositiveInteger(id);
    const safeLimit = typeof limit === 'number' ? Math.max(1, Math.min(500, Math.round(limit))) : 200;
    return windowId ? getChatWindowMessages(windowId, safeLimit) : [];
  });

  ipcMain.handle('chatWindow:pinFact', async (event, id: unknown, text: unknown) => {
    if (!isTrustedSender(event)) return null;
    const windowId = cleanPositiveInteger(id);
    const fact = cleanString(text, 240);
    return windowId && fact ? pinChatWindowFact(windowId, fact) : null;
  });

  ipcMain.handle('chatWindow:unpinFact', async (event, id: unknown, factId: unknown) => {
    if (!isTrustedSender(event)) return null;
    const windowId = cleanPositiveInteger(id);
    const cleanFactId = cleanString(factId, 80);
    return windowId && cleanFactId ? unpinChatWindowFact(windowId, cleanFactId) : null;
  });

  ipcMain.handle('chatWindow:contextSnapshots', async (event, id: unknown, limit: unknown) => {
    if (!isTrustedSender(event)) return [];
    const windowId = cleanPositiveInteger(id);
    const safeLimit = typeof limit === 'number' ? Math.max(1, Math.min(20, Math.round(limit))) : 5;
    return windowId ? getRecentContextSnapshots(windowId, safeLimit) : [];
  });

  ipcMain.handle('system:info', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getSystemInfo();
  });

  ipcMain.handle('execution:cancel', async (event) => {
    if (!isTrustedSender(event)) return false;
    return controller.cancelCurrentExecution() > 0;
  });

  ipcMain.handle('agentWorkspace:get', async (event, projectValue: unknown, taskValue?: unknown) => {
    if (!isTrustedSender(event)) return null;
    const projectId = cleanPositiveInteger(projectValue);
    const taskId = cleanAgentId(taskValue);
    return projectId ? controller.getAgentWorkspace(projectId, taskId || undefined) : null;
  });

  ipcMain.handle('agentWorkspace:update', async (event, projectValue: unknown, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const projectId = cleanPositiveInteger(projectValue);
    if (!projectId || !isRecord(value)) return null;
    const revision = cleanNonNegativeInteger(value.revision);
    if (revision === null) return null;
    const roots = value.roots === undefined ? undefined : cleanStringList(value.roots, 12, MAX_PATH_CHARS);
    const goals = value.goals === undefined ? undefined : cleanWorkspaceGoals(value.goals);
    const metadata = controller.updateAgentWorkspace(projectId, { roots, goals }, revision);
    notifyAgentWorkspaceChanged(mainWindow, projectId);
    return metadata;
  });

  ipcMain.handle('agentRun:resolveApproval', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const runId = cleanAgentId(value.runId);
    const approvalId = cleanAgentId(value.approvalId);
    const projectId = cleanPositiveInteger(value.projectId);
    const decision = value.decision === 'approved' || value.decision === 'denied' ? value.decision : null;
    if (!projectId || !runId || !approvalId || !decision) return null;
    return controller.resolveAgentApprovalGroup(projectId, runId, approvalId, decision, snapshot => {
      notifyAgentWorkspaceChanged(mainWindow, snapshot.task.projectId, snapshot.task.id, snapshot.run.id);
    });
  });

  ipcMain.handle('agentRun:resume', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const projectId = cleanPositiveInteger(value.projectId);
    const runId = cleanAgentId(value.runId);
    if (!projectId || !runId) return null;
    return controller.resumeAgentRun(projectId, runId, snapshot => {
      notifyAgentWorkspaceChanged(mainWindow, snapshot.task.projectId, snapshot.task.id, snapshot.run.id);
    });
  });

  ipcMain.handle('agentRun:cancel', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const projectId = cleanPositiveInteger(value.projectId);
    const runId = cleanAgentId(value.runId);
    if (!projectId || !runId) return null;
    return controller.cancelAgentRun(projectId, runId, snapshot => {
      notifyAgentWorkspaceChanged(mainWindow, snapshot.task.projectId, snapshot.task.id, snapshot.run.id);
    });
  });

  ipcMain.handle('skill:list', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getSkillLibrary();
  });

  ipcMain.handle('skill:installFromDirectory', async (event, replaceValue: unknown) => {
    if (!isTrustedSender(event)) return null;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择包含 SKILL.md 的 Skill 文件夹',
      properties: ['openDirectory'],
    });
    const source = selection.canceled ? null : selection.filePaths[0];
    return source ? controller.installSkillFromDirectory(source, replaceValue === true) : null;
  });

  ipcMain.handle('skill:setTrust', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const name = cleanSkillName(value.name);
    const packageHash = cleanSha256(value.packageHash);
    const trust = value.trust === 'approved' || value.trust === 'untrusted' || value.trust === 'quarantined'
      ? value.trust
      : null;
    return name && packageHash && trust ? controller.setSkillTrust(name, packageHash, trust) : null;
  });

  ipcMain.handle('skill:setEnabled', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const name = cleanSkillName(value.name);
    const packageHash = cleanSha256(value.packageHash);
    return name && packageHash && typeof value.enabled === 'boolean'
      ? controller.setSkillEnabled(name, packageHash, value.enabled)
      : null;
  });

  ipcMain.handle('skill:uninstall', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const name = cleanSkillName(value.name);
    const packageHash = cleanSha256(value.packageHash);
    return name && packageHash ? controller.uninstallSkill(name, packageHash) : null;
  });

  ipcMain.handle('tools:catalog', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const mode = value === 'create' || value === 'companion' || value === 'reason' || value === 'execute'
      ? value
      : undefined;
    return controller.getToolCatalog(mode);
  });

  ipcMain.handle('config:get', async (event) => {
    if (!isTrustedSender(event)) return null;
    return toRendererSettingsBundle(getSettingsBundle());
  });

  ipcMain.handle('config:set', async (event, patch: unknown) => {
    if (!isTrustedSender(event)) return null;
    const bundle = saveSettingsBundle(cleanSettingsPatch(patch));
    controller.reloadModel();
    const desktop = applyDesktopSettings(bundle.settings.general);
    controller.applyToolPermission(bundle.settings.tools, bundle.settings.conversation.activeMode);
    const retention = applyDataRetention();
    const voiceRemoved = cleanupVoiceCache(bundle.settings.data.voiceCacheRetentionHours);
    recordDataActivity('settings', 'config-set', {
      historyRetentionDays: bundle.settings.data.historyRetentionDays,
      saveHistory: bundle.settings.conversation.saveHistory,
      memoryAutoExtractEffective: bundle.settings.conversation.saveHistory && bundle.settings.memory.autoExtract,
      retention,
      voiceRemoved,
      desktop,
    });
    return toRendererSettingsBundle(bundle);
  });

  ipcMain.handle('persona:get', async (event, profileId: unknown) => {
    if (!isTrustedSender(event)) return null;
    const resolved = getPersonaEditorState(cleanString(profileId, 80) || getAppSettings().profile);
    return toRendererPersonaState(resolved);
  });

  ipcMain.handle('persona:save', async (event, profileId: unknown, patch: unknown) => {
    if (!isTrustedSender(event)) return null;
    const resolved = savePersonaCard(cleanString(profileId, 80) || getAppSettings().profile, cleanPersonaCardPatch(patch));
    return toRendererPersonaState(resolved);
  });

  ipcMain.handle('persona:chooseImportFile', async (event) => {
    if (!isTrustedSender(event)) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择人格 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('persona:importFile', async (event, profileId: unknown, sourcePath: unknown) => {
    if (!isTrustedSender(event)) return null;
    const safePath = cleanExistingFilePath(sourcePath, ['json'], MAX_PATH_CHARS);
    if (!safePath) throw new Error('Persona import path must be an existing JSON file.');
    const resolved = importPersonaCardFromFile(cleanString(profileId, 80) || getAppSettings().profile, safePath);
    return toRendererPersonaState(resolved);
  });

  ipcMain.handle('model:credentialStatus', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanRemoteModelProvider(value);
    return provider ? getModelCredentialStatus(provider) : null;
  });

  ipcMain.handle('model:setCredential', async (event, providerValue: unknown, apiKeyValue: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanRemoteModelProvider(providerValue);
    const apiKey = typeof apiKeyValue === 'string' ? apiKeyValue : '';
    if (!provider) return null;
    const status = setModelCredential(provider, apiKey);
    controller.reloadModel();
    return status;
  });

  ipcMain.handle('model:clearCredential', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanRemoteModelProvider(value);
    if (!provider) return null;
    const status = clearModelCredential(provider);
    controller.reloadModel();
    return status;
  });

  ipcMain.handle('model:testConnection', async (event) => {
    if (!isTrustedSender(event)) return null;
    const client = new LLMClient();
    if (!canRouteModelRequest(client.providerName, canUseNetworkCapability('remoteModel'))) {
      throw new Error('请先明确同意将请求发送给所选远程模型服务。');
    }
    const startedAt = Date.now();
    let serviceReachable = false;
    let modelAvailable = false;
    let chatSucceeded = false;
    let error = '';
    try {
      serviceReachable = await client.checkConnection();
      if (serviceReachable) {
        const models = await client.listModels();
        modelAvailable = client.providerName === 'ollama'
          ? models.some(model => model === client.modelName || model === `${client.modelName}:latest`)
          : Boolean(client.modelName);
      }
      if (serviceReachable && modelAvailable) {
        const reply = await client.chat(
          [{ role: 'user', content: 'Reply with OK only.' }],
          undefined,
          'reason',
          { maxTokens: 16, temperature: 0.1 },
        );
        chatSucceeded = reply.trim().length > 0;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      connected: serviceReachable && modelAvailable && chatSucceeded,
      serviceReachable,
      modelAvailable,
      chatSucceeded,
      durationMs: Date.now() - startedAt,
      error,
      provider: client.providerName,
      model: client.modelName,
      endpoint: client.endpoint,
    };
  });

  ipcMain.handle('model:listOptions', async (event) => {
    if (!isTrustedSender(event)) return null;
    const client = new LLMClient();
    if (!canRouteModelRequest(client.providerName, canUseNetworkCapability('remoteModel'))) {
      throw new Error('请先明确同意将请求发送给所选远程模型服务。');
    }
    return {
      provider: client.providerName,
      models: await client.listModels(),
    };
  });

  ipcMain.handle('model:ollamaStatus', async (event) => {
    if (!isTrustedSender(event)) return null;
    return getOllamaSetupStatus();
  });

  ipcMain.handle('model:openOllamaDownload', async (event) => {
    if (!isTrustedSender(event)) return false;
    return openOllamaDownload();
  });

  ipcMain.handle('model:installBundledOllama', async (event) => {
    if (!isTrustedSender(event)) return { started: false, error: 'IPC sender rejected.' };
    return installBundledOllama(mainWindow);
  });

  ipcMain.handle('model:pullOllamaModel', async (event, model: unknown) => {
    if (!isTrustedSender(event)) return { started: false, error: 'IPC sender rejected.' };
    return pullOllamaModel(mainWindow, typeof model === 'string' ? model : '');
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

  ipcMain.handle('memoryReview:list', async (event, status: unknown, limit: unknown) => {
    if (!isTrustedSender(event)) return [];
    return listMemoryReviewQueue(cleanMemoryReviewListOptions(status, limit));
  });

  ipcMain.handle('memoryReview:approve', async (event, id: unknown) => {
    if (!isTrustedSender(event)) return null;
    const memoryId = cleanPositiveInteger(id);
    return memoryId ? approveMemoryReviewItem(memoryId) : null;
  });

  ipcMain.handle('memoryReview:approveMany', async (event, ids: unknown) => {
    if (!isTrustedSender(event)) return [];
    return approveMemoryReviewItems(cleanPositiveIds(ids));
  });

  ipcMain.handle('memoryReview:reject', async (event, id: unknown) => {
    if (!isTrustedSender(event)) return null;
    const memoryId = cleanPositiveInteger(id);
    return memoryId ? rejectMemoryReviewItem(memoryId) : null;
  });

  ipcMain.handle('memoryReview:rejectMany', async (event, ids: unknown) => {
    if (!isTrustedSender(event)) return [];
    return rejectMemoryReviewItems(cleanPositiveIds(ids));
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
    const safePath = cleanExistingFilePath(sourcePath, ['json'], MAX_PATH_CHARS);
    if (!safePath) throw new Error('Memory import path must be an existing JSON file.');
    return previewChatRecordImport(safePath, getAppSettings().memory.importContentMode);
  });

  ipcMain.handle('memory:commitImport', async (event, sourcePath: unknown, candidateIds?: unknown) => {
    if (!isTrustedSender(event)) throw new Error('IPC sender rejected.');
    const safePath = cleanExistingFilePath(sourcePath, ['json'], MAX_PATH_CHARS);
    if (!safePath) throw new Error('Memory import path must be an existing JSON file.');
    return commitChatRecordImport(safePath, cleanCandidateIds(candidateIds), getAppSettings().memory.importContentMode);
  });

  ipcMain.handle('privacy:get', async (event) => {
    if (!isTrustedSender(event)) return null;
    return getPrivacyCenterState();
  });

  ipcMain.handle('privacy:export', async (event, format: unknown) => {
    if (!isTrustedSender(event)) return null;
    return exportAllData(format === 'markdown' ? 'markdown' : 'json', {
      agentSkills: controller.getSkillPrivacyData(),
    });
  });

  ipcMain.handle('privacy:clearLocalData', async (event) => {
    if (!isTrustedSender(event)) return null;
    return clearAllLocalData({
      clearSkillInvocationHistory: () => controller.clearSkillInvocationHistory(),
    });
  });

  ipcMain.handle('voice:speak', async (event, text: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'IPC sender rejected.' };
    if (!getAppSettings().voice.ttsEnabled) return { ok: false, error: 'TTS is disabled in settings.' };
    const result = await voice.synthesize(cleanString(text, MAX_TEXT_TO_SPEAK_CHARS));
    if (result.ok) recordDataActivity('voice', 'local-tts', { chars: cleanString(text, MAX_TEXT_TO_SPEAK_CHARS).length });
    return result;
  });

  ipcMain.handle('voice:play', async (event, sourcePath: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'IPC sender rejected.' };
    const safePath = cleanExistingFilePath(sourcePath, ['wav', 'mp3', 'm4a', 'ogg'], MAX_PATH_CHARS);
    return safePath ? voice.play(safePath) : { ok: false, error: 'Audio path rejected.' };
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
    const safePath = cleanExistingFilePath(sourcePath, ['wav', 'aiff', 'aif', 'flac'], MAX_PATH_CHARS);
    const result = safePath ? await voice.transcribe(safePath) : { ok: false, error: 'Audio path rejected.' };
    if (result.ok) recordDataActivity('voice', 'local-stt-file', { sourceExtension: safePath ? safePath.split('.').pop() : '' });
    return result;
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
    const result = await voice.transcribeRecording(audioBytes);
    if (result.ok) recordDataActivity('voice', 'local-stt-recording', { bytes: audioBytes.byteLength });
    return result;
  });

  ipcMain.handle('voice:requestMicrophoneAccess', async (event) => {
    if (!isTrustedSender(event)) return false;
    const settings = getAppSettings();
    if (!settings.voice.sttEnabled) {
      revokeMicrophoneGrant();
      return false;
    }
    armMicrophoneGrant();
    return true;
  });

  ipcMain.handle('voice:capabilities', async (event) => {
    if (!isTrustedSender(event)) return null;
    return voice.getCapabilities();
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

async function confirmToolExecution(mainWindow: BrowserWindow, request: ToolConfirmationRequest): Promise<boolean> {
  if (mainWindow.isDestroyed()) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: `确认高风险操作：${request.toolLabel}`,
    message: request.explanation,
    detail: request.inputPreview,
    buttons: ['取消', '确认执行'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
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

function cleanPositiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map(cleanPositiveInteger)
    .filter((id): id is number => Boolean(id))))
    .slice(0, 200);
}

function cleanMemoryKind(value: unknown): MemoryKind | null {
  return typeof value === 'string' && MEMORY_KINDS.has(value as MemoryKind)
    ? value as MemoryKind
    : null;
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

function cleanMemoryReviewListOptions(status: unknown, limit: unknown): MemoryReviewListOptions {
  const cleanStatus = status === 'pending' || status === 'applied' || status === 'rejected' || status === 'all'
    ? status
    : 'pending';
  const cleanLimit = typeof limit === 'number'
    ? Math.max(1, Math.min(200, Math.round(limit)))
    : undefined;
  return { status: cleanStatus, limit: cleanLimit };
}

function cleanSettingsPatch(value: unknown): SettingsPatch {
  return isRecord(value) ? value as SettingsPatch : {};
}

function cleanPersonaCardPatch(value: unknown): PersonaCardPatch {
  if (!isRecord(value)) return {};
  return {
    displayName: cleanString(value.displayName, 120),
    nickname: cleanString(value.nickname, 120),
    description: cleanString(value.description, 2_000),
    identity: cleanString(value.identity, 4_000),
    relationshipFrame: cleanString(value.relationshipFrame, 4_000),
    traits: cleanStringList(value.traits, 80, 1_000),
    speakingStyle: cleanStringList(value.speakingStyle, 80, 1_000),
    roleplayNotes: cleanStringList(value.roleplayNotes, 80, 1_000),
    boundaries: cleanStringList(value.boundaries, 80, 1_000),
    selfIntroductionExample: cleanString(value.selfIntroductionExample, 2_000),
  };
}

function cleanStringList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
  return items.length > 0 ? items : [];
}

function cleanWorkspaceGoals(value: unknown): Array<{ id?: string; title: string; status: 'active' | 'achieved' | 'paused' }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 30).flatMap(item => {
    if (!isRecord(item)) return [];
    const title = cleanString(item.title, 500);
    if (!title) return [];
    const id = cleanAgentId(item.id);
    return [{
      ...(id ? { id } : {}),
      title,
      status: item.status === 'achieved' || item.status === 'paused' ? item.status : 'active',
    }];
  });
}

function cleanAgentId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : null;
}

function cleanSkillName(value: unknown): string | null {
  return typeof value === 'string' && /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64
    ? value
    : null;
}

function cleanSha256(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function notifyAgentWorkspaceChanged(
  mainWindow: BrowserWindow,
  projectId: number | null,
  taskId?: string,
  runId?: string,
): void {
  if (mainWindow.isDestroyed() || !projectId) return;
  mainWindow.webContents.send('agent:workspace-changed', { projectId, taskId, runId });
}

function toRendererPersonaState(resolved: ResolvedPersonaCard): ResolvedPersonaCard {
  return {
    card: {
      ...resolved.card,
      tags: [...resolved.card.tags],
      prompt: {
        ...resolved.card.prompt,
        priorityRules: [...resolved.card.prompt.priorityRules],
        traits: [...resolved.card.prompt.traits],
        speakingStyle: [...resolved.card.prompt.speakingStyle],
        roleplayNotes: [...resolved.card.prompt.roleplayNotes],
        selfIntroductionRules: [...resolved.card.prompt.selfIntroductionRules],
        dailyHabits: [...resolved.card.prompt.dailyHabits],
        presenceRules: [...resolved.card.prompt.presenceRules],
        boundaries: [...resolved.card.prompt.boundaries],
        memoryRules: [...resolved.card.prompt.memoryRules],
        workRules: [...resolved.card.prompt.workRules],
      },
      timeMoods: {
        earlyMorning: { ...resolved.card.timeMoods.earlyMorning },
        morning: { ...resolved.card.timeMoods.morning },
        noon: { ...resolved.card.timeMoods.noon },
        afternoon: { ...resolved.card.timeMoods.afternoon },
        evening: { ...resolved.card.timeMoods.evening },
        lateNight: { ...resolved.card.timeMoods.lateNight },
      },
      memoryPolicy: { ...resolved.card.memoryPolicy },
      toolPolicy: {
        ...resolved.card.toolPolicy,
        allowedModes: [...resolved.card.toolPolicy.allowedModes],
      },
    },
    source: resolved.source,
    editable: resolved.editable,
    ...(resolved.sourcePath ? { sourcePath: resolved.sourcePath } : {}),
  };
}

function toRendererSettingsBundle(bundle: SettingsBundle): SettingsBundle {
  return {
    settings: bundle.settings,
    sku: bundle.sku,
    persona: { ...bundle.persona },
    model: {
      ...bundle.model,
      ollama: { ...bundle.model.ollama },
      remote: {
        openai: { ...bundle.model.remote.openai },
        deepseek: { ...bundle.model.remote.deepseek },
        'athena-cloud': { ...bundle.model.remote['athena-cloud'] },
        custom: { ...bundle.model.remote.custom },
      },
      fallback: { ...bundle.model.fallback },
    },
  };
}

function cleanRemoteModelProvider(value: unknown): RemoteModelProvider | null {
  return value === 'openai' || value === 'deepseek' || value === 'athena-cloud' || value === 'custom'
    ? value
    : null;
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
    .slice(0, 5_000);
  return ids.length > 0 ? ids : undefined;
}

function cleanNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function emptyMemoryTotals(): Record<MemoryKind, number> {
  return { profile: 0, procedure: 0, fact: 0, event: 0, daily: 0, project: 0, message: 0 };
}

function emptyMemoryDebug() {
  return {
    query: '',
    keywords: [],
    relevanceScore: 0,
    profileFacts: [],
    proceduralMemories: [],
    temporalFacts: [],
    relatedEvents: [],
    dailySummaries: [],
    projectNotes: [],
    recentMessages: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
