/** IPC handler registration. */

import { ipcMain, BrowserWindow, dialog, IpcMainEvent, IpcMainInvokeEvent, shell } from 'electron';
import { AthenaController } from '../../core/controller/AthenaController';
import { DiagnosticsService } from '../../core/diagnostics';
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
import {
  getCloudAccountStatus,
  loginCloudAccount,
  logoutCloudAccount,
  registerCloudAccount,
  syncCloudAccountNow,
} from '../../core/cloud/CloudAccountService';
import { LLMClient } from '../../core/ai/Client';
import { diagnoseModelConnection } from '../../core/ai/ModelConnectionDiagnostics';
import { canRouteModelRequest } from '../../core/ai/ModelNetworkPolicy';
import { getPersonaEditorState, importPersonaCardFromFile, savePersonaCard, type PersonaCardPatch, type ResolvedPersonaCard } from '../../core/ai/Personality';
import {
  clearModelCredential,
  clearImageCredential,
  getImageCredentialStatus,
  getModelCredentialStatus,
  setImageCredential,
  setModelCredential,
} from '../../core/ai/CredentialStore';
import {
  IMAGE_PROVIDER_DESCRIPTORS,
  LocalImageRuntimeManager,
  findComfyUILaunchTarget,
  getLocalImageRuntimeStatus,
  waitForComfyUIConnection,
} from '../../core/artifacts';
import {
  getOllamaSetupStatus,
  installBundledOllama,
  openOllamaDownload,
  pullOllamaModel,
} from '../../core/ai/OllamaSetupService';
import { globalEventBus } from '../../engine/EventBus';
import { createLogger } from '../../engine/Logger';
import { classifyModelFailure } from '../../core/ai/ModelFailure';
import {
  commitChatRecordImport,
  activateChatWindow,
  createProject,
  archiveChatWindow,
  createChatWindow,
  createTemporaryChatWindow,
  deleteMemory,
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
import type { ImageCloudProvider, LocalImageRuntimeVariantId, McpServerInput, RemoteModelProvider, SettingsBundle, SettingsPatch, ToolConfirmationRequest, ToolStatusEvent, WebSearchStatus } from '../../shared/types';
import { armMicrophoneGrant, revokeMicrophoneGrant } from '../security/PermissionGate';
import { applyDesktopSettings, showReminderNotification } from '../DesktopSettings';
import { cleanAttachmentIds, cleanChatPayload, cleanExistingFilePath, isTrustedIpcSender } from './validation';

const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_TO_SPEAK_CHARS = 8_000;
const MAX_PATH_CHARS = 2_048;
const CONTROLLER_WARMUP_DELAY_MS = 1_500;

const INVOKE_CHANNELS = [
  'chat:route',
  'chat:send',
  'attachment:chooseImages',
  'attachment:chooseFiles',
  'attachment:preview',
  'attachment:removePending',
  'document:choose',
  'document:chooseOcr',
  'document:cancelOcr',
  'document:list',
  'document:delete',
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
  'agentArtifact:open',
  'agentWorkspace:update',
  'agentRun:resolveApproval',
  'agentRun:resume',
  'agentRun:cancel',
  'skill:list',
  'skill:installFromDirectory',
  'skill:setTrust',
  'skill:setEnabled',
  'skill:uninstall',
  'mcp:list',
  'mcp:upsert',
  'mcp:approve',
  'mcp:setEnabled',
  'mcp:connect',
  'mcp:disconnect',
  'mcp:remove',
  'tools:catalog',
  'system:info',
  'system:infoFast',
  'system:infoStartup',
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
  'image:listProviders',
  'image:runtimeStatus',
  'image:runtimeVariants',
  'image:installRuntime',
  'image:discoverLocal',
  'image:startComfyUI',
  'image:chooseRuntime',
  'image:chooseModel',
  'image:credentialStatus',
  'image:setCredential',
  'image:clearCredential',
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
  'cloud:status',
  'cloud:register',
  'cloud:login',
  'cloud:logout',
  'cloud:syncNow',
  'diagnostics:getHealth',
  'diagnostics:exportSupport',
  'diagnostics:clear',
  'voice:requestMicrophoneAccess',
  'voice:speak',
  'voice:play',
  'voice:chooseAudioFile',
  'voice:transcribeFile',
  'voice:transcribeRecording',
  'voice:capabilities',
  'voice:cancel',
] as const;

const logger = createLogger('Ipc');
const EVENT_CHANNELS = ['window:minimize', 'window:close'] as const;
const MEMORY_KINDS = new Set<MemoryKind>(['profile', 'procedure', 'fact', 'event', 'daily', 'project', 'message']);

export function registerIpcHandlers(mainWindow: BrowserWindow): () => Promise<void> {
  clearIpcHandlers();

  const controller = new AthenaController();
  const imageRuntimeManager = new LocalImageRuntimeManager();
  const diagnostics = new DiagnosticsService();
  const voice = new VoiceService();
  let documentOcrAbort: AbortController | null = null;
  let documentOcrBusy = false;
  let shuttingDown = false;
  const removeReminderListener = globalEventBus.on('reminder:due', (event) => {
    const settings = getAppSettings();
    showReminderNotification(event.title, settings.general.desktopNotifications);
    // `delivered` carries the window the message was actually written to, so the
    // renderer can place it instead of inventing a transient bubble.
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('reminder:due', event);
  });

  const isTrustedSender = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    return isTrustedIpcSender(event, mainWindow);
  };

  const reportControllerWarmupError = (error: unknown): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:error', error instanceof Error ? error.message : String(error));
    }
  };

  const scheduleControllerWarmup = (): void => {
    if (shuttingDown) return;
    const timer = setTimeout(() => {
      void controller.initialize().catch(reportControllerWarmupError);
    }, CONTROLLER_WARMUP_DELAY_MS);
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  };

  if (mainWindow.isVisible()) scheduleControllerWarmup();
  else mainWindow.once('ready-to-show', scheduleControllerWarmup);

  ipcMain.handle('chat:route', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const settings = getAppSettings();
    const payload = cleanChatPayload(value, settings.conversation.activeMode);
    if (!payload) return null;
    return controller.routeMessage(payload.text, payload.mode, {
      forceWebSearch: payload.forceWebSearch,
      chatWindowId: payload.chatWindowId,
    });
  });

  ipcMain.handle('chat:send', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;

    const settings = getAppSettings();
    const payload = cleanChatPayload(value, settings.conversation.activeMode);
    if (!payload) return null;
    const { text: userMessage, mode, forceWebSearch, chatWindowId, attachmentIds } = payload;

    try {
      const routing = await controller.routeMessage(userMessage, mode, { forceWebSearch, chatWindowId });
      const effectiveMode = routing.effectiveMode;
      const response = routing.route === 'durable_execution'
        ? await controller.executeAgentMessage(
          userMessage,
          chatWindowId,
          snapshot => notifyAgentWorkspaceChanged(mainWindow, snapshot.task.projectId, snapshot.task.id, snapshot.run.id),
          attachmentIds,
        )
        : await controller.processMessage(
        userMessage,
        effectiveMode,
        (chunk) => {
          if (!settings.conversation.streamResponses) return;
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream', { content: chunk, done: false });
          }
        },
        {
          forceWebSearch: forceWebSearch || routing.route === 'web_research',
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
          attachmentIds,
        },
        );
      response.routing = routing;
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream', { content: '', done: true });
      }
      return response;
    } catch (error) {
      // Raw parser text ("Unterminated string in JSON at position 412") used to be
      // forwarded verbatim, which reads as a refusal rather than a broken response
      // (ATH-CHAT-003). The redacted original stays in the log.
      const failure = classifyModelFailure(error);
      logger.warn(`Chat request failed [code=${failure.code}, retryable=${failure.retryable}]: ${failure.detail}`);
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('chat:error', failure.message);
      return null;
    }
  });

  ipcMain.handle('attachment:chooseImages', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return [];
    const chatWindowId = cleanPositiveInteger(value);
    if (!chatWindowId) return [];
    await controller.assertImageInputAvailable();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return controller.importChatImages(chatWindowId, result.filePaths.slice(0, 5));
  });

  ipcMain.handle('attachment:chooseFiles', async (event, value: unknown) => {
    // Keep the trusted-sender check on its own line. Combining it with payload
    // validation hid this handler from the Window 02 IPC gate.
    if (!isTrustedSender(event)) return [];
    if (!isRecord(value)) return [];
    const chatWindowId = cleanPositiveInteger(value.chatWindowId);
    const maxFiles = Math.max(1, Math.min(5, cleanPositiveInteger(value.maxFiles) || 5));
    if (!chatWindowId) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加到聊天',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'markdown', 'pdf', 'docx', 'wav', 'aiff', 'aif', 'flac'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: '文档', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx'] },
        { name: '音频', extensions: ['wav', 'aiff', 'aif', 'flac'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const selected = result.filePaths.slice(0, maxFiles);
    const attachments = await controller.importChatFiles(chatWindowId, selected, async sourcePath => {
      if (!getAppSettings().voice.sttEnabled) return { ok: false, error: '请先在设置中开启本地语音识别，再添加音频。' };
      return voice.transcribe(sourcePath);
    });
    return attachments;
  });

  ipcMain.handle('attachment:preview', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const chatWindowId = cleanPositiveInteger(value.chatWindowId);
    const attachmentId = cleanAttachmentIds([value.attachmentId])[0];
    return chatWindowId && attachmentId
      ? controller.getChatAttachmentPreview(chatWindowId, attachmentId)
      : null;
  });

  ipcMain.handle('attachment:removePending', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return false;
    if (!isRecord(value)) return false;
    const chatWindowId = cleanPositiveInteger(value.chatWindowId);
    const attachmentId = cleanAttachmentIds([value.attachmentId])[0];
    return Boolean(chatWindowId && attachmentId && controller.removePendingChatAttachment(chatWindowId, attachmentId));
  });

  ipcMain.handle('document:choose', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return [];
    const chatWindowId = cleanPositiveInteger(value);
    if (!chatWindowId) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Project 文档',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文档', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return controller.importProjectDocuments(chatWindowId, result.filePaths.slice(0, 5));
  });

  ipcMain.handle('document:chooseOcr', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return [];
    const chatWindowId = cleanPositiveInteger(value);
    if (!chatWindowId) return [];
    if (documentOcrBusy || shuttingDown) throw new Error('A local PDF OCR import is already running or Athena is shutting down.');
    documentOcrBusy = true;
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择扫描 PDF（本地 OCR）',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '扫描 PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      if (shuttingDown) throw new Error('Athena is shutting down.');
      documentOcrAbort = new AbortController();
      return await controller.importScannedProjectPdfs(chatWindowId, result.filePaths.slice(0, 3), documentOcrAbort.signal);
    } finally {
      documentOcrAbort = null;
      documentOcrBusy = false;
    }
  });

  ipcMain.handle('document:cancelOcr', async (event) => {
    if (!isTrustedSender(event)) return false;
    if (!documentOcrAbort) return false;
    documentOcrAbort.abort(new Error('Local PDF OCR was cancelled.'));
    return true;
  });

  ipcMain.handle('document:list', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return [];
    const projectId = cleanPositiveInteger(value);
    return projectId ? controller.listProjectDocuments(projectId) : [];
  });

  ipcMain.handle('document:delete', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return false;
    if (!isRecord(value)) return false;
    const projectId = cleanPositiveInteger(value.projectId);
    const documentId = cleanPositiveInteger(value.documentId);
    return Boolean(projectId && documentId && controller.deleteProjectDocument(projectId, documentId));
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
    return windowId ? controller.deleteChatWindow(windowId) : false;
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

  ipcMain.handle('system:infoFast', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getSystemInfo({ checkModel: false });
  });

  ipcMain.handle('system:infoStartup', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getSystemInfo({ checkModel: true, timeoutMs: 2_000 });
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

  ipcMain.handle('agentArtifact:open', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return false;
    if (!isRecord(value)) return false;
    const projectId = cleanPositiveInteger(value.projectId);
    const artifactId = cleanAgentId(value.artifactId);
    if (!projectId || !artifactId) return false;
    const error = await shell.openPath(controller.resolveOpenableAgentArtifact(projectId, artifactId));
    if (error) throw new Error(`Unable to open artifact: ${error}`);
    return true;
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

  ipcMain.handle('mcp:list', async (event) => {
    if (!isTrustedSender(event)) return null;
    return controller.getMcpIntegrations();
  });

  ipcMain.handle('mcp:upsert', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const input = cleanMcpServerInput(value);
    return input ? controller.upsertMcpServer(input) : null;
  });

  ipcMain.handle('mcp:approve', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const id = cleanMcpId(value.id);
    const fingerprint = cleanSha256(value.fingerprint);
    return id && fingerprint && typeof value.approved === 'boolean'
      ? controller.approveMcpServer(id, fingerprint, value.approved)
      : null;
  });

  ipcMain.handle('mcp:setEnabled', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const id = cleanMcpId(value.id);
    const fingerprint = cleanSha256(value.fingerprint);
    return id && fingerprint && typeof value.enabled === 'boolean'
      ? controller.setMcpServerEnabled(id, fingerprint, value.enabled)
      : null;
  });

  ipcMain.handle('mcp:connect', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const id = cleanMcpId(value);
    return id ? controller.connectMcpServer(id) : null;
  });

  ipcMain.handle('mcp:disconnect', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const id = cleanMcpId(value);
    return id ? controller.disconnectMcpServer(id) : null;
  });

  ipcMain.handle('mcp:remove', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    if (!isRecord(value)) return null;
    const id = cleanMcpId(value.id);
    const fingerprint = cleanSha256(value.fingerprint);
    return id && fingerprint ? controller.removeMcpServer(id, fingerprint) : null;
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
    const historyWasOff = !getAppSettings().conversation.saveHistory;
    const bundle = saveSettingsBundle(cleanSettingsPatch(patch));
    // Switching history back on ends the unsaved segment. Drop it now instead of at
    // the next startup, so the durable turns that follow cannot pull its text into
    // their context snapshots (ATH-DATA-002).
    if (historyWasOff && bundle.settings.conversation.saveHistory) controller.purgeUnsavedChatSegment();
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

  ipcMain.handle('image:listProviders', async event => {
    if (!isTrustedSender(event)) return null;
    return IMAGE_PROVIDER_DESCRIPTORS.map(item => ({ ...item }));
  });

  ipcMain.handle('image:runtimeStatus', async event => {
    if (!isTrustedSender(event)) return null;
    return getLocalImageRuntimeStatus(getAppSettings().imageGeneration);
  });

  ipcMain.handle('image:runtimeVariants', async event => {
    if (!isTrustedSender(event)) return null;
    return imageRuntimeManager.variants();
  });

  ipcMain.handle('image:installRuntime', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const variant = cleanLocalImageRuntimeVariant(value);
    if (!variant) return null;
    const result = await imageRuntimeManager.install(variant, progress => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('image:runtimeInstallProgress', progress);
    });
    saveSettingsBundle({ settings: { imageGeneration: { provider: 'local', local: {
      engine: 'athena',
      runtimePath: result.runtimePath,
      backend: result.backend,
    } } } });
    return result;
  });

  ipcMain.handle('image:discoverLocal', async event => {
    if (!isTrustedSender(event)) return null;
    return controller.discoverLocalImageResources();
  });

  ipcMain.handle('image:startComfyUI', async event => {
    if (!isTrustedSender(event)) return null;
    const launcher = findComfyUILaunchTarget();
    if (!launcher) return { started: false, connected: false, message: '没有找到可启动的 ComfyUI 应用，请先手动启动后再检测。' };
    const launchError = await shell.openPath(launcher.path);
    if (launchError) return { started: false, connected: false, message: `启动 ${launcher.label} 失败：${launchError}` };
    const settings = getAppSettings();
    const baseUrl = await waitForComfyUIConnection(settings.imageGeneration.local.comfyuiBaseUrl);
    if (!baseUrl) {
      return { started: true, connected: false, message: `${launcher.label} 已打开，但服务尚未在 90 秒内就绪。可以稍后再点“自动检测”。` };
    }
    saveSettingsBundle({ settings: { imageGeneration: { provider: 'local', local: {
      engine: 'comfyui',
      comfyuiBaseUrl: baseUrl,
    } } } });
    const snapshot = await controller.discoverLocalImageResources();
    return { started: true, connected: true, baseUrl, message: `已连接 ${launcher.label}。`, snapshot };
  });

  ipcMain.handle('image:chooseRuntime', async event => {
    if (!isTrustedSender(event)) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Athena 本地生图引擎',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'stable-diffusion.cpp', extensions: ['exe'] }] : [{ name: 'Executable', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('image:chooseModel', async event => {
    if (!isTrustedSender(event)) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地生图模型',
      properties: ['openFile'],
      filters: [{ name: 'Image model', extensions: ['safetensors', 'gguf', 'ckpt', 'pth', 'pt'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('image:credentialStatus', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanImageCloudProvider(value);
    return provider ? getImageCredentialStatus(provider) : null;
  });

  ipcMain.handle('image:setCredential', async (event, providerValue: unknown, apiKeyValue: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanImageCloudProvider(providerValue);
    const apiKey = typeof apiKeyValue === 'string' ? apiKeyValue : '';
    if (!provider) return null;
    const status = setImageCredential(provider, apiKey);
    controller.reloadModel();
    return status;
  });

  ipcMain.handle('image:clearCredential', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const provider = cleanImageCloudProvider(value);
    if (!provider) return null;
    const status = clearImageCredential(provider);
    controller.reloadModel();
    return status;
  });

  ipcMain.handle('model:testConnection', async (event) => {
    if (!isTrustedSender(event)) return null;
    const client = new LLMClient();
    if (!canRouteModelRequest(client.providerName, canUseNetworkCapability('remoteModel'))) {
      throw new Error('请先明确同意将请求发送给所选远程模型服务。');
    }
    return diagnoseModelConnection(client);
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

  ipcMain.handle('cloud:status', async (event) => {
    if (!isTrustedSender(event)) return null;
    return getCloudAccountStatus();
  });

  ipcMain.handle('cloud:register', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const payload = isRecord(value) ? value : {};
    return registerCloudAccount({
      tenantName: cleanString(payload.tenantName, 100) || 'Athena',
      email: cleanString(payload.email, 254),
      password: typeof payload.password === 'string' ? payload.password : '',
    });
  });

  ipcMain.handle('cloud:login', async (event, value: unknown) => {
    if (!isTrustedSender(event)) return null;
    const payload = isRecord(value) ? value : {};
    return loginCloudAccount({
      tenantId: cleanString(payload.tenantId, 80),
      email: cleanString(payload.email, 254),
      password: typeof payload.password === 'string' ? payload.password : '',
    });
  });

  ipcMain.handle('cloud:logout', async (event) => {
    if (!isTrustedSender(event)) return null;
    return logoutCloudAccount();
  });

  ipcMain.handle('cloud:syncNow', async (event) => {
    if (!isTrustedSender(event)) return null;
    return syncCloudAccountNow();
  });

  ipcMain.handle('privacy:export', async (event, format: unknown) => {
    if (!isTrustedSender(event)) return null;
    return exportAllData(format === 'markdown' ? 'markdown' : 'json', {
      agentSkills: controller.getSkillPrivacyData(),
      integrations: controller.getMcpPrivacyData(),
    });
  });

  ipcMain.handle('privacy:clearLocalData', async (event) => {
    if (!isTrustedSender(event)) return null;
    return clearAllLocalData({
      clearSkillInvocationHistory: () => controller.clearSkillInvocationHistory(),
      clearAttachmentFiles: () => controller.clearAttachmentFiles(),
      clearProjectDocumentFiles: () => controller.clearProjectDocumentFiles(),
    });
  });

  const diagnosticSupplemental = () => ({
    skills: controller.getSkillPrivacyData(),
    integrations: controller.getMcpPrivacyData(),
  });

  ipcMain.handle('diagnostics:getHealth', async (event) => {
    if (!isTrustedSender(event)) return null;
    return diagnostics.getHealthSnapshot(diagnosticSupplemental());
  });

  ipcMain.handle('diagnostics:exportSupport', async (event) => {
    if (!isTrustedSender(event)) return null;
    return diagnostics.exportSupportBundle(diagnosticSupplemental());
  });

  ipcMain.handle('diagnostics:clear', async (event) => {
    if (!isTrustedSender(event)) return null;
    return diagnostics.clear();
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

  ipcMain.handle('voice:cancel', (event) => {
    if (!isTrustedSender(event)) return 0;
    return voice.cancelAll();
  });

  ipcMain.on('window:minimize', (event) => {
    if (isTrustedSender(event)) mainWindow.minimize();
  });
  ipcMain.on('window:close', (event) => {
    if (isTrustedSender(event)) mainWindow.close();
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shutdownPromise ||= (async () => {
      shuttingDown = true;
      documentOcrAbort?.abort(new Error('Athena is shutting down.'));
      clearIpcHandlers();
      removeReminderListener();
      await controller.shutdown();
    })();
    return shutdownPromise;
  };
  mainWindow.once('closed', () => { void shutdown(); });
  return shutdown;
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

function cleanMcpArgumentList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map(item => item.slice(0, maxLength))
    .slice(0, maxItems);
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

function cleanMcpId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 48
    ? value
    : null;
}

function cleanMcpServerInput(value: unknown): McpServerInput | null {
  if (!isRecord(value)) return null;
  const transport = value.transport === 'stdio' || value.transport === 'streamable-http' ? value.transport : null;
  const name = cleanString(value.name, 120).trim();
  if (!transport || !name) return null;
  const id = value.id === undefined ? undefined : cleanMcpId(value.id) || undefined;
  const protocolMode = value.protocolMode === 'legacy' || value.protocolMode === 'auto' || value.protocolMode === '2026-07-28'
    ? value.protocolMode
    : 'auto';
  if (transport === 'stdio') {
    const stdio = isRecord(value.stdio) ? value.stdio : {};
    return {
      id,
      name,
      transport,
      protocolMode,
      stdio: {
        command: cleanString(stdio.command, 1_024),
        args: cleanMcpArgumentList(stdio.args, 64, 2_000) || [],
        cwd: cleanString(stdio.cwd, 2_048) || null,
        envKeys: cleanStringList(stdio.envKeys, 64, 128) || [],
      },
    };
  }
  const http = isRecord(value.http) ? value.http : {};
  return {
    id,
    name,
    transport,
    protocolMode,
    http: {
      url: cleanString(http.url, 2_048),
      bearerTokenEnv: cleanString(http.bearerTokenEnv, 128) || null,
    },
  };
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

function cleanImageCloudProvider(value: unknown): ImageCloudProvider | null {
  return value === 'openai' || value === 'google' || value === 'stability' || value === 'bfl'
    || value === 'volcengine' || value === 'dashscope' || value === 'replicate' || value === 'fal' || value === 'custom'
    ? value
    : null;
}

function cleanLocalImageRuntimeVariant(value: unknown): LocalImageRuntimeVariantId | null {
  return value === 'cuda12' || value === 'vulkan' || value === 'cpu' ? value : null;
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
