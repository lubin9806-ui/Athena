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
