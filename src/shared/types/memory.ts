import type { EmotionType } from './emotion';
import type { Message } from './message';
import type { ProfileEntry } from './profile';

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
}

export interface RetrievedContext {
  profileFacts: ProfileEntry[];
  relatedEvents: MemoryEvent[];
  projectNotes: ProjectNote[];
  recentMessages: Message[];
  chatWindow?: ChatWindowContext;
  relevanceScore: number;
}
