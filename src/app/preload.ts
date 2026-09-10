import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ChatErrorPayload } from '../shared/types/system';

contextBridge.exposeInMainWorld('athenaAPI', {
  routeMessage: (text: string, mode: 'create' | 'companion' | 'reason' | 'execute', forceWebSearch = false, chatWindowId?: number, attachmentIds: string[] = []) => ipcRenderer.invoke('chat:route', { text, mode, forceWebSearch, chatWindowId, attachmentIds }),
  sendMessage: (text: string, mode: 'create' | 'companion' | 'reason' | 'execute', forceWebSearch = false, chatWindowId?: number, attachmentIds: string[] = [], routingTicket?: string) => ipcRenderer.invoke('chat:send', { text, mode, forceWebSearch, chatWindowId, attachmentIds, routingTicket }),
  chooseChatImages: (chatWindowId: number) => ipcRenderer.invoke('attachment:chooseImages', chatWindowId),
  chooseChatFiles: (chatWindowId: number, maxFiles = 5) => ipcRenderer.invoke('attachment:chooseFiles', { chatWindowId, maxFiles }),
  // Electron removed File.path, so the only way from a dropped File to a path a
  // main-process import can open is this bridge call.
  resolveDroppedFilePath: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  importDroppedFiles: (chatWindowId: number, paths: string[], maxFiles = 5) => ipcRenderer.invoke('attachment:importDropped', { chatWindowId, paths, maxFiles }),
  importDroppedText: (chatWindowId: number, text: string) => ipcRenderer.invoke('attachment:importDroppedText', { chatWindowId, text }),
  importDroppedImageUrl: (chatWindowId: number, url: string) => ipcRenderer.invoke('attachment:importDroppedImageUrl', { chatWindowId, url }),
  pasteChatImage: (chatWindowId: number) => ipcRenderer.invoke('attachment:pasteImage', chatWindowId),
  getChatAttachmentPreview: (chatWindowId: number, attachmentId: string) => ipcRenderer.invoke('attachment:preview', { chatWindowId, attachmentId }),
  removePendingChatAttachment: (chatWindowId: number, attachmentId: string) => ipcRenderer.invoke('attachment:removePending', { chatWindowId, attachmentId }),
  chooseProjectDocuments: (chatWindowId: number) => ipcRenderer.invoke('document:choose', chatWindowId),
  chooseScannedProjectPdfs: (chatWindowId: number) => ipcRenderer.invoke('document:chooseOcr', chatWindowId),
  cancelProjectDocumentOcr: () => ipcRenderer.invoke('document:cancelOcr'),
  listProjectDocuments: (projectId: number) => ipcRenderer.invoke('document:list', projectId),
  deleteProjectDocument: (projectId: number, documentId: number) => ipcRenderer.invoke('document:delete', { projectId, documentId }),
  listProjects: (includeArchived = false) => ipcRenderer.invoke('project:list', includeArchived),
  createProject: (title?: string, instructions?: string) => ipcRenderer.invoke('project:create', { title, instructions }),
  updateProject: (id: number, patch: { title?: string; instructions?: string }) => ipcRenderer.invoke('project:update', id, patch),
  listChatWindows: (includeArchived = false, projectId?: number) => ipcRenderer.invoke('chatWindow:list', includeArchived, projectId),
  createChatWindow: (title?: string, projectId?: number) => ipcRenderer.invoke('chatWindow:create', title, projectId),
  createTemporaryChatWindow: (projectId?: number) => ipcRenderer.invoke('chatWindow:createTemporary', projectId),
  activateChatWindow: (id: number) => ipcRenderer.invoke('chatWindow:activate', id),
  renameChatWindow: (id: number, title: string) => ipcRenderer.invoke('chatWindow:rename', id, title),
  archiveChatWindow: (id: number, archived = true) => ipcRenderer.invoke('chatWindow:archive', id, archived),
  deleteChatWindow: (id: number) => ipcRenderer.invoke('chatWindow:delete', id),
  getChatWindowMessages: (id: number, limit = 200) => ipcRenderer.invoke('chatWindow:messages', id, limit),
  pinChatWindowFact: (id: number, text: string) => ipcRenderer.invoke('chatWindow:pinFact', id, text),
  unpinChatWindowFact: (id: number, factId: string) => ipcRenderer.invoke('chatWindow:unpinFact', id, factId),
  getChatWindowContextSnapshots: (id: number, limit = 5) => ipcRenderer.invoke('chatWindow:contextSnapshots', id, limit),
  cancelExecution: () => ipcRenderer.invoke('execution:cancel'),
  getAgentWorkspace: (projectId: number, taskId?: string) => ipcRenderer.invoke('agentWorkspace:get', projectId, taskId),
  openAgentArtifact: (projectId: number, artifactId: string) => ipcRenderer.invoke('agentArtifact:open', { projectId, artifactId }),
  updateAgentWorkspace: (projectId: number, value: unknown) => ipcRenderer.invoke('agentWorkspace:update', projectId, value),
  resolveAgentApproval: (projectId: number, runId: string, approvalId: string, decision: 'approved' | 'denied') => ipcRenderer.invoke('agentRun:resolveApproval', { projectId, runId, approvalId, decision }),
  resumeAgentRun: (projectId: number, runId: string) => ipcRenderer.invoke('agentRun:resume', { projectId, runId }),
  cancelAgentRun: (projectId: number, runId: string) => ipcRenderer.invoke('agentRun:cancel', { projectId, runId }),
  onAgentWorkspaceChanged: (callback: (event: { projectId: number; taskId?: string; runId?: string }) => void) => {
    const handler = (_: any, event: { projectId: number; taskId?: string; runId?: string }) => callback(event);
    ipcRenderer.on('agent:workspace-changed', handler);
    return () => ipcRenderer.removeListener('agent:workspace-changed', handler);
  },
  getSkillLibrary: () => ipcRenderer.invoke('skill:list'),
  installSkillFromDirectory: (replace = false) => ipcRenderer.invoke('skill:installFromDirectory', replace),
  setSkillTrust: (name: string, packageHash: string, trust: 'approved' | 'untrusted' | 'quarantined') => ipcRenderer.invoke('skill:setTrust', { name, packageHash, trust }),
  setSkillEnabled: (name: string, packageHash: string, enabled: boolean) => ipcRenderer.invoke('skill:setEnabled', { name, packageHash, enabled }),
  uninstallSkill: (name: string, packageHash: string) => ipcRenderer.invoke('skill:uninstall', { name, packageHash }),
  getMcpIntegrations: () => ipcRenderer.invoke('mcp:list'),
  upsertMcpServer: (input: unknown) => ipcRenderer.invoke('mcp:upsert', input),
  approveMcpServer: (id: string, fingerprint: string, approved: boolean) => ipcRenderer.invoke('mcp:approve', { id, fingerprint, approved }),
  setMcpServerEnabled: (id: string, fingerprint: string, enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', { id, fingerprint, enabled }),
  connectMcpServer: (id: string) => ipcRenderer.invoke('mcp:connect', id),
  disconnectMcpServer: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
  removeMcpServer: (id: string, fingerprint: string) => ipcRenderer.invoke('mcp:remove', { id, fingerprint }),
  getToolCatalog: (mode?: 'create' | 'companion' | 'reason' | 'execute') => ipcRenderer.invoke('tools:catalog', mode),
  onChatStream: (callback: (data: { content: string; done: boolean }) => void) => {
    const handler = (_: any, data: { content: string; done: boolean }) => callback(data);
    ipcRenderer.on('chat:stream', handler);
    return () => ipcRenderer.removeListener('chat:stream', handler);
  },
  onChatError: (callback: (failure: ChatErrorPayload) => void) => {
    const handler = (_: any, failure: ChatErrorPayload | string) => callback(
      typeof failure === 'string'
        ? { message: failure, kind: 'passthrough', retryable: false }
        : failure,
    );
    ipcRenderer.on('chat:error', handler);
    return () => ipcRenderer.removeListener('chat:error', handler);
  },
  onWebSearchStatus: (callback: (status: { phase: 'searching' | 'reading' | 'refining' | 'done' | 'failed'; query: string; resultCount?: number; pageCount?: number; searchRound?: number; provider?: 'zhipu' | 'sogou' | 'bing' | 'duckduckgo' | 'none'; message?: string }) => void) => {
    const handler = (_: any, status: { phase: 'searching' | 'reading' | 'refining' | 'done' | 'failed'; query: string; resultCount?: number; pageCount?: number; searchRound?: number; provider?: 'zhipu' | 'sogou' | 'bing' | 'duckduckgo' | 'none'; message?: string }) => callback(status);
    ipcRenderer.on('chat:web-search-status', handler);
    return () => ipcRenderer.removeListener('chat:web-search-status', handler);
  },
  onToolStatus: (callback: (status: { phase: 'planning' | 'confirming' | 'running' | 'completed' | 'failed' | 'cancelled' | 'done'; message: string; toolName?: string; toolLabel?: string; callId?: string }) => void) => {
    const handler = (_: any, status: { phase: 'planning' | 'confirming' | 'running' | 'completed' | 'failed' | 'cancelled' | 'done'; message: string; toolName?: string; toolLabel?: string; callId?: string }) => callback(status);
    ipcRenderer.on('chat:tool-status', handler);
    return () => ipcRenderer.removeListener('chat:tool-status', handler);
  },
  onReminderDue: (callback: (job: any) => void) => {
    const handler = (_: any, job: any) => callback(job);
    ipcRenderer.on('reminder:due', handler);
    return () => ipcRenderer.removeListener('reminder:due', handler);
  },
  onProactiveDelivered: (callback: (delivered: any) => void) => {
    const handler = (_: any, delivered: any) => callback(delivered);
    ipcRenderer.on('proactive:delivered', handler);
    return () => ipcRenderer.removeListener('proactive:delivered', handler);
  },
  getCreativeState: (chatWindowId: number) => ipcRenderer.invoke('creative:state', chatWindowId),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getFastSystemInfo: () => ipcRenderer.invoke('system:infoFast'),
  getStartupSystemInfo: () => ipcRenderer.invoke('system:infoStartup'),
  getSettings: () => ipcRenderer.invoke('config:get'),
  saveSettings: (patch: any) => ipcRenderer.invoke('config:set', patch),
  getPersona: (profileId?: string) => ipcRenderer.invoke('persona:get', profileId),
  savePersona: (profileId: string, patch: any) => ipcRenderer.invoke('persona:save', profileId, patch),
  choosePersonaImportFile: () => ipcRenderer.invoke('persona:chooseImportFile'),
  importPersonaFile: (profileId: string, sourcePath: string) => ipcRenderer.invoke('persona:importFile', profileId, sourcePath),
  getModelCredentialStatus: (provider: string) => ipcRenderer.invoke('model:credentialStatus', provider),
  setModelCredential: (provider: string, apiKey: string) => ipcRenderer.invoke('model:setCredential', provider, apiKey),
  clearModelCredential: (provider: string) => ipcRenderer.invoke('model:clearCredential', provider),
  listModelOptions: () => ipcRenderer.invoke('model:listOptions'),
  testModelConnection: () => ipcRenderer.invoke('model:testConnection'),
  getOllamaSetupStatus: () => ipcRenderer.invoke('model:ollamaStatus'),
  openOllamaDownload: () => ipcRenderer.invoke('model:openOllamaDownload'),
  installBundledOllama: () => ipcRenderer.invoke('model:installBundledOllama'),
  pullOllamaModel: (model: string) => ipcRenderer.invoke('model:pullOllamaModel', model),
  listImageProviders: () => ipcRenderer.invoke('image:listProviders'),
  getLocalImageRuntimeStatus: () => ipcRenderer.invoke('image:runtimeStatus'),
  listLocalImageRuntimeVariants: () => ipcRenderer.invoke('image:runtimeVariants'),
  installLocalImageRuntime: (variant: string) => ipcRenderer.invoke('image:installRuntime', variant),
  onLocalImageRuntimeInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_: any, progress: any) => callback(progress);
    ipcRenderer.on('image:runtimeInstallProgress', handler);
    return () => ipcRenderer.removeListener('image:runtimeInstallProgress', handler);
  },
  discoverLocalImageResources: () => ipcRenderer.invoke('image:discoverLocal'),
  startComfyUI: () => ipcRenderer.invoke('image:startComfyUI'),
  chooseLocalImageRuntime: () => ipcRenderer.invoke('image:chooseRuntime'),
  chooseLocalImageModel: () => ipcRenderer.invoke('image:chooseModel'),
  getImageCredentialStatus: (provider: string) => ipcRenderer.invoke('image:credentialStatus', provider),
  setImageCredential: (provider: string, apiKey: string) => ipcRenderer.invoke('image:setCredential', provider, apiKey),
  clearImageCredential: (provider: string) => ipcRenderer.invoke('image:clearCredential', provider),
  listMemories: (options: any) => ipcRenderer.invoke('memory:list', options),
  deleteMemory: (kind: string, id: number) => ipcRenderer.invoke('memory:delete', kind, id),
  updateMemory: (kind: string, id: number, patch: any) => ipcRenderer.invoke('memory:update', kind, id, patch),
  debugMemory: (query: string) => ipcRenderer.invoke('memory:debug', query),
  listMemoryReviewQueue: (status?: string, limit?: number) => ipcRenderer.invoke('memoryReview:list', status, limit),
  approveMemoryReview: (id: number) => ipcRenderer.invoke('memoryReview:approve', id),
  approveMemoryReviews: (ids: number[]) => ipcRenderer.invoke('memoryReview:approveMany', ids),
  rejectMemoryReview: (id: number) => ipcRenderer.invoke('memoryReview:reject', id),
  rejectMemoryReviews: (ids: number[]) => ipcRenderer.invoke('memoryReview:rejectMany', ids),
  chooseMemoryImportFile: () => ipcRenderer.invoke('memory:chooseImportFile'),
  previewMemoryImport: (sourcePath: string) => ipcRenderer.invoke('memory:previewImport', sourcePath),
  commitMemoryImport: (sourcePath: string, candidateIds: number[]) => ipcRenderer.invoke('memory:commitImport', sourcePath, candidateIds),
  getPrivacyCenter: () => ipcRenderer.invoke('privacy:get'),
  getCloudAccount: () => ipcRenderer.invoke('cloud:status'),
  registerCloudAccount: (payload: { tenantName: string; email: string; password: string }) => ipcRenderer.invoke('cloud:register', payload),
  loginCloudAccount: (payload: { tenantId: string; email: string; password: string }) => ipcRenderer.invoke('cloud:login', payload),
  logoutCloudAccount: () => ipcRenderer.invoke('cloud:logout'),
  syncCloudAccount: () => ipcRenderer.invoke('cloud:syncNow'),
  exportPrivacyData: (format?: 'json' | 'markdown') => ipcRenderer.invoke('privacy:export', format),
  clearLocalData: () => ipcRenderer.invoke('privacy:clearLocalData'),
  getDiagnosticHealth: () => ipcRenderer.invoke('diagnostics:getHealth'),
  exportDiagnosticSupport: () => ipcRenderer.invoke('diagnostics:exportSupport'),
  clearDiagnostics: () => ipcRenderer.invoke('diagnostics:clear'),
  speakText: (text: string) => ipcRenderer.invoke('voice:speak', text),
  playAudioFile: (sourcePath: string) => ipcRenderer.invoke('voice:play', sourcePath),
  chooseAudioFile: () => ipcRenderer.invoke('voice:chooseAudioFile'),
  transcribeAudioFile: (sourcePath: string) => ipcRenderer.invoke('voice:transcribeFile', sourcePath),
  transcribeRecording: (audioBytes: Uint8Array) => ipcRenderer.invoke('voice:transcribeRecording', audioBytes),
  requestMicrophoneAccess: () => ipcRenderer.invoke('voice:requestMicrophoneAccess'),
  getVoiceCapabilities: () => ipcRenderer.invoke('voice:capabilities'),
  cancelVoice: () => ipcRenderer.invoke('voice:cancel'),
  setDesktopPetWindowVisible: (visible: boolean) => ipcRenderer.invoke('avatar:desktop:setVisible', visible),
  sendDesktopPetEvent: (event: unknown) => ipcRenderer.send('avatar:desktop:event', event),
  onDesktopPetInteraction: (callback: (interaction: { prompt: string; hotZoneId: string }) => void) => {
    const handler = (_: unknown, interaction: { prompt: string; hotZoneId: string }) => callback(interaction);
    ipcRenderer.on('avatar:desktop:interaction:renderer', handler);
    return () => ipcRenderer.removeListener('avatar:desktop:interaction:renderer', handler);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
});
