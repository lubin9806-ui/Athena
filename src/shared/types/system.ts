export interface SystemInfo {
  time: string;
  hour: number;
  platform: string;
  modelConnected: boolean;
  modelProvider: string;
  modelName: string;
  modelEndpoint: string;
  /** Backward-compatible aliases for the original renderer. */
  ollamaConnected: boolean;
  ollamaModel: string;
  ollamaEndpoint: string;
  memoryStats: {
    messageCount: number;
    profileCount: number;
    eventCount: number;
    projectNoteCount: number;
    indexCount: number;
    dbSize: string;
  };
}

export const IPC_CHANNELS = {
  CHAT_SEND: 'chat:send',
  CHAT_STREAM: 'chat:stream',
  CHAT_ERROR: 'chat:error',
  SYSTEM_INFO: 'system:info',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
} as const;
