import type { EmotionType } from './emotion';
import type { Message } from './message';
import type { ProfileEntry } from './profile';
import type { ConversationMode } from './settings';

export interface MemoryEvent {
  id: number;
  date: string;
  summary: string;
  detail?: string;
  tags: string[];
  emotion?: EmotionType;
  importance: number;
  recalled_count: number;
  created_at?: string;
}

export interface ProjectNote {
  id: number;
  project: string;
  title: string;
  note: string;
  status: 'active' | 'paused' | 'done' | 'archived';
  tags: string[];
  importance: number;
  created_at: string;
  updated_at: string;
  last_recalled_at?: string;
}

export interface ChatWindowContext {
  id: number;
  title: string;
  summary: string;
  workingStateJson: string;
  messageCount: number;
  updatedAt: string;
  isTemporary?: boolean;
  projectId?: number;
  projectTitle?: string;
  projectInstructions?: string;
  projectInstructionsSnapshot?: string;
}

export interface RetrievedContext {
  profileFacts: ProfileEntry[];
  relatedEvents: MemoryEvent[];
  projectNotes: ProjectNote[];
  recentMessages: Message[];
  chatWindow?: ChatWindowContext;
  relevanceScore: number;
}

export interface ContextSnapshotDebugItem {
  kind: string;
  id?: string;
  label: string;
  priority: number;
  chars: number;
  estimatedTokens: number;
  included: boolean;
  reason: string;
  preview?: string;
  truncated?: boolean;
  originalChars?: number;
}

export interface ContextSnapshotRecord {
  id: number;
  window_id?: number;
  user_message_id?: number;
  mode?: ConversationMode;
  budget: Record<string, unknown>;
  included: ContextSnapshotDebugItem[];
  omitted: ContextSnapshotDebugItem[];
  prompt_message_count: number;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  created_at: string;
}

export interface ChatWindowPinnedFact {
  id: string;
  text: string;
  createdAt: string;
}

export interface AthenaProject {
  id: number;
  title: string;
  instructions: string;
  memory_state_json: string;
  archived_at?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  windowCount?: number;
}
