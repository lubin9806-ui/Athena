export type MessageRole = 'user' | 'assistant' | 'system';

import type { Emotion } from './emotion';
import type { MemoryEvent, ProjectNote } from './memory';
import type { ConversationMode } from './settings';
import type { WebSearchSummary } from './search';
import type { ToolExecutionRecord } from './tools';

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
  emotion?: string;
  mode?: ConversationMode;
  created_at: string;
}

export interface ChatWindow {
  id: number;
  title: string;
  summary: string;
  mode: ConversationMode;
  working_state: string;
  working_state_json: string;
  archived_at?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  messageCount?: number;
  lastMessagePreview?: string;
}

export interface ChatWindowMessage extends Message {
  window_id: number;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  content: string;
  emotion: Emotion;
  webSearch?: WebSearchSummary;
  memoryContext?: {
    recalledEvents: MemoryEvent[];
    projectNotes: ProjectNote[];
  };
  toolExecutions?: ToolExecutionRecord[];
}

export interface ChatStreamChunk {
  content: string;
  done: boolean;
}
