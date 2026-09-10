export interface CloudAccountSettings {
  syncEnabled: boolean;
  baseUrl: string;
  email: string;
  tenantId: string;
  deviceName: string;
}

export interface CloudSessionStatus {
  signedIn: boolean;
  syncEnabled: boolean;
  baseUrl: string;
  email: string;
  tenantId: string | null;
  deviceId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface CloudConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  mode?: string;
  createdAt?: string;
}

export interface CloudConversationPayload {
  origin: 'desktop' | 'android';
  title: string;
  mode: string;
  turns: CloudConversationTurn[];
}

export interface CloudMemoryPayload {
  origin: 'desktop' | 'android';
  kind: string;
  title: string;
  content: string;
  importance?: number;
}

/**
 * A reminder as it crosses the account. Deliberately the same four fields the
 * desktop's own ScheduledJob already has, so neither client needs a translation
 * layer to read what the other wrote.
 */
export interface CloudReminderPayload {
  origin: 'desktop' | 'android';
  title: string;
  dueAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}
