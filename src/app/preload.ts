import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('athenaAPI', {
  sendMessage: (text: string, mode: 'create' | 'companion' | 'reason' | 'execute', forceWebSearch = false) => ipcRenderer.invoke('chat:send', { text, mode, forceWebSearch }),
  cancelExecution: () => ipcRenderer.invoke('execution:cancel'),
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
  listMemories: (options: any) => ipcRenderer.invoke('memory:list', options),
  deleteMemory: (kind: string, id: number) => ipcRenderer.invoke('memory:delete', kind, id),
  updateMemory: (kind: string, id: number, patch: any) => ipcRenderer.invoke('memory:update', kind, id, patch),
  debugMemory: (query: string) => ipcRenderer.invoke('memory:debug', query),
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
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
});
