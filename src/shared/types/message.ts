export type MessageRole = 'user' | 'assistant' | 'system';

import type { Emotion } from './emotion';
import type { ContextSnapshotRecord, MemoryEvent, ProjectNote } from './memory';
import type { ConversationMode } from './settings';
import type { WebSearchSummary } from './search';
import type { ToolExecutionRecord } from './tools';
import type { AgentExecutionSummary } from './agent';

export type ChatAttachmentMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ChatAttachment {
  id: string;
  window_id: number;
  message_id?: number;
  kind: 'image';
  mime_type: ChatAttachmentMimeType;
  original_name: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  status: 'pending' | 'attached';
  created_at: string;
  preview_data_url?: string;
}

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
  project_id?: number;
  projectTitle?: string;
  projectInstructions?: string;
  projectInstructionsSnapshot?: string;
  archived_at?: string;
  deleted_at?: string;
  is_temporary?: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  messageCount?: number;
  lastMessagePreview?: string;
}

export interface ChatWindowMessage extends Message {
  window_id: number;
  attachments?: ChatAttachment[];
}

export interface ChatRequest {
  message: string;
}

export type AgentMessageRoute = 'conversation' | 'web_research' | 'durable_execution';
export type AgentMessageRouteConfidence = 'high' | 'medium';
export type AgentMessageRouteReason =
  | 'selected-execution-mode'
  | 'forced-web-search'
  | 'explicit-web-research'
  | 'fresh-information'
  | 'explicit-execution-handoff'
  | 'direct-computer-action'
  | 'execution-context-required'
  | 'execution-unavailable'
  | 'discussion-only'
  | 'ordinary-conversation';

export interface AgentMessageRouteDecision {
  route: AgentMessageRoute;
  effectiveMode: ConversationMode;
  confidence: AgentMessageRouteConfidence;
  reason: AgentMessageRouteReason;
  autoSwitch: boolean;
  query?: string;
}

export interface ChatResponse {
  content: string;
  emotion: Emotion;
  webSearch?: WebSearchSummary;
  memoryContext?: {
    recalledEvents: MemoryEvent[];
    projectNotes: ProjectNote[];
  };
  contextSnapshot?: ContextSnapshotRecord;
  toolExecutions?: ToolExecutionRecord[];
  agentExecution?: AgentExecutionSummary;
  routing?: AgentMessageRouteDecision;
}

export interface ChatStreamChunk {
  content: string;
  done: boolean;
}
