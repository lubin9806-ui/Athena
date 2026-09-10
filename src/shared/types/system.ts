export interface SystemInfo {
  time: string;
  hour: number;
  platform: string;
  modelConnected: boolean;
  modelConnectionChecked?: boolean;
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
    dailySummaryCount: number;
    proceduralMemoryCount: number;
    temporalFactCount: number;
    reviewQueuePendingCount: number;
    projectNoteCount: number;
    attachmentCount: number;
    indexCount: number;
    dbSize: string;
  };
}

/**
 * What went wrong with a chat turn. The kind travels with the message because the
 * renderer has to tell "the service is unreachable" apart from "this one turn timed
 * out or was stopped" — reporting the latter as offline sends people looking for a
 * connection problem that is not there.
 */
export interface ChatErrorPayload {
  message: string;
  kind: 'protocol' | 'timeout' | 'cancelled' | 'connection' | 'auth' | 'rate_limit' | 'capability' | 'passthrough';
  retryable: boolean;
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
