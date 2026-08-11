import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('athenaAPI', {
  sendMessage: (text: string, mode: 'create' | 'companion' | 'reason' | 'execute', forceWebSearch = false, chatWindowId?: number) => ipcRenderer.invoke('chat:send', { text, mode, forceWebSearch, chatWindowId }),
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
  updateAgentWorkspace: (projectId: number, value: unknown) => ipcRenderer.invoke('agentWorkspace:update', projectId, value),
  resolveAgentApproval: (projectId: number, runId: string, approvalId: string, decision: 'approved' | 'denied') => ipcRenderer.invoke('agentRun:resolveApproval', { projectId, runId, approvalId, decision }),
  resumeAgentRun: (projectId: number, runId: string) => ipcRenderer.invoke('agentRun:resume', { projectId, runId }),
  cancelAgentRun: (projectId: number, runId: string) => ipcRenderer.invoke('agentRun:cancel', { projectId, runId }),
  onAgentWorkspaceChanged: (callback: (event: { projectId: number; taskId?: string; runId?: string }) => void) => {
    const handler = (_: any, event: { projectId: number; taskId?: string; runId?: string }) => callback(event);
    ipcRenderer.on('agent:workspace-changed', handler);
    return () => ipcRenderer.removeListener('agent:workspace-changed', handler);
  },
  getToolCatalog: (mode?: 'create' | 'companion' | 'reason' | 'execute') => ipcRenderer.invoke('tools:catalog', mode),
  onChatStream: (callback: (data: { content: string; done: boolean }) => void) => {
    const handler = (_: any, data: { content: string; done: boolean }) => callback(data);
    ipcRenderer.on('chat:stream', handler);
    return () => ipcRenderer.removeListener('chat:stream', handler);
  },
  onChatError: (callback: (error: string) => void) => {
    const handler = (_: any, error: string) => callback(error);
    ipcRenderer.on('chat:error', handler);
    return () => ipcRenderer.removeListener('chat:error', handler);
  },
  onWebSearchStatus: (callback: (status: { phase: 'searching' | 'reading' | 'refining' | 'done' | 'failed'; query: string; resultCount?: number; pageCount?: number; searchRound?: number; provider?: 'sogou' | 'bing' | 'duckduckgo' | 'none'; message?: string }) => void) => {
    const handler = (_: any, status: { phase: 'searching' | 'reading' | 'refining' | 'done' | 'failed'; query: string; resultCount?: number; pageCount?: number; searchRound?: number; provider?: 'sogou' | 'bing' | 'duckduckgo' | 'none'; message?: string }) => callback(status);
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
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
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
  exportPrivacyData: (format?: 'json' | 'markdown') => ipcRenderer.invoke('privacy:export', format),
  clearLocalData: () => ipcRenderer.invoke('privacy:clearLocalData'),
  speakText: (text: string) => ipcRenderer.invoke('voice:speak', text),
  playAudioFile: (sourcePath: string) => ipcRenderer.invoke('voice:play', sourcePath),
  chooseAudioFile: () => ipcRenderer.invoke('voice:chooseAudioFile'),
  transcribeAudioFile: (sourcePath: string) => ipcRenderer.invoke('voice:transcribeFile', sourcePath),
  transcribeRecording: (audioBytes: Uint8Array) => ipcRenderer.invoke('voice:transcribeRecording', audioBytes),
  requestMicrophoneAccess: () => ipcRenderer.invoke('voice:requestMicrophoneAccess'),
  getVoiceCapabilities: () => ipcRenderer.invoke('voice:capabilities'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
});
