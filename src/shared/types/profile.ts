export interface ProfileEntry {
  fact: string;
  confidence: number;
  source?: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export type ProfileCategory = 'identity' | 'preference' | 'habit' | 'project' | 'health';

export interface UserProfile {
  identity: ProfileEntry[];
  preferences: ProfileEntry[];
  habits: ProfileEntry[];
  projects: ProfileEntry[];
  health: ProfileEntry[];
}