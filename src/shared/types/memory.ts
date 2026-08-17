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

export interface DailyMemorySummary {
  id: number;
  date: string;
  summary: string;
  highlights: string[];
  source_event_count: number;
  source_message_count: number;
  max_importance: number;
  importance: number;
  decay_stage: 'fresh' | 'year_one' | 'decay_5' | 'decay_6' | 'decay_7' | 'decay_8' | 'expired';
  summary_method?: 'heuristic' | 'llm-refined';
  generated_at?: string;
  updated_at?: string;
}

export interface ProceduralMemory {
  id: number;
  scope: 'global' | 'project' | 'mode' | 'tool' | 'persona';
  project_id?: number;
  key: string;
  instruction: string;
  evidence?: string;
  confidence: number;
  importance: number;
  status: 'active' | 'archived';
  created_at?: string;
  updated_at?: string;
  last_recalled_at?: string;
}

export interface TemporalMemoryFact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  summary: string;
  confidence: number;
  importance: number;
  valid_from?: string;
  valid_to?: string;
  status: 'active' | 'superseded' | 'archived';
  created_at?: string;
  updated_at?: string;
}

export type MemoryReviewKind = 'profile' | 'event' | 'project' | 'procedure' | 'fact';
export type MemoryReviewStatus = 'pending' | 'applied' | 'rejected';

export interface MemoryReviewItem {
  id: number;
  kind: MemoryReviewKind;
  status: MemoryReviewStatus;
  title: string;
  content: string;
  payload: Record<string, unknown>;
  reason: string;
  group_key?: string;
  confidence: number;
  importance: number;
  source_table?: string;
  source_id?: number;
  chat_window_id?: number;
  applied_table?: string;
  applied_id?: number;
  created_at: string;
  reviewed_at?: string;
}

export interface ProjectNote {
  id: number;
  project_id?: number;
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

export interface MemoryRetrievalEvidence {
  memoryTable: string;
  memoryId: number;
  memoryKind: 'profile' | 'procedure' | 'fact' | 'event' | 'daily' | 'project' | 'message';
  projectId?: number;
  sourceTable: string;
  sourceId?: number;
  chatWindowId?: number;
  origin: 'record' | 'review' | 'fact_source' | 'legacy';
  excerpt?: string;
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
  proceduralMemories: ProceduralMemory[];
  temporalFacts: TemporalMemoryFact[];
  relatedEvents: MemoryEvent[];
  dailySummaries: DailyMemorySummary[];
  projectNotes: ProjectNote[];
  recentMessages: Message[];
  chatWindow?: ChatWindowContext;
  evidence: MemoryRetrievalEvidence[];
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
  evidence?: MemoryRetrievalEvidence[];
}

export interface ContextSnapshotRecord {
  id: number;
  project_id?: number;
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
