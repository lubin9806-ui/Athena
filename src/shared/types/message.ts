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
