export type PersonalizationTone = 'balanced' | 'soft' | 'playful' | 'direct';
export type ReplyLength = 'short' | 'balanced' | 'detailed';
export type InitiativeLevel = 'low' | 'balanced' | 'high';
export type AnimationLevel = 'low' | 'balanced' | 'high';
export type ThemeMode = 'day' | 'night' | 'system';
export type SttEngine = 'local_whisper';
export type ConversationMode = 'create' | 'companion' | 'reason' | 'execute';

import type { WebSearchSettings } from './search';
import type { ToolModePermissions, ToolSettings } from './tools';

export interface PersonalizationSettings {
  userName: string;
  preferredAddress: string;
  tone: PersonalizationTone;
  replyLength: ReplyLength;
  initiative: InitiativeLevel;
  proactiveCare: boolean;
  useMemoryInSmallTalk: boolean;
  creatorModeHints: boolean;
  customNotes: string;
}

export interface UiSettings {
  startupIntro: boolean;
  compactMode: boolean;
}

export interface GeneralSettings {
  launchAtStartup: boolean;
  closeToTray: boolean;
  desktopNotifications: boolean;
  autoConnectModel: boolean;
}

export interface AppearanceSettings {
  theme: ThemeMode;
  animationLevel: AnimationLevel;
  glassEffects: boolean;
}

export interface ConversationSettings {
  activeMode: ConversationMode;
  enterToSend: boolean;
  streamResponses: boolean;
  showTimestamps: boolean;
  saveHistory: boolean;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  retrieveProfile: boolean;
  retrieveEvents: boolean;
  retrieveProjects: boolean;
  retrievalDepth: number;
  minImportanceForAutoExtract: number;
}

export interface VoiceSettings {
  sttEnabled: boolean;
  ttsEnabled: boolean;
  autoPlayAssistant: boolean;
  sttEngine: SttEngine;
  ttsVoice: string;
  silenceAutoStop: boolean;
}

export interface DataSettings {
  confirmBeforeDelete: boolean;
  historyRetentionDays: number;
  voiceCacheRetentionHours: number;
  exportFormat: 'json' | 'markdown';
}

export interface NetworkConsentSettings {
  webSearch: boolean;
  onlineSpeechToText: boolean;
  onlineTextToSpeech: boolean;
  externalToolNetwork: boolean;
}

export interface PrivacySettings {
  networkConsent: NetworkConsentSettings;
  firstRunPrivacySeenAt?: string;
}

export interface AppSettings {
  version: number;
  profile: string;
  developerMode: boolean;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  conversation: ConversationSettings;
  tools: ToolSettings;
  webSearch: WebSearchSettings;
  personalization: PersonalizationSettings;
  memory: MemorySettings;
  voice: VoiceSettings;
  data: DataSettings;
  privacy: PrivacySettings;
  ui: UiSettings;
}

export interface ModelSettings {
  provider: string;
  ollama: {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    numCtx: number;
  };
  deepseek: {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  fallback: {
    enabled: boolean;
    timeoutMs: number;
  };
}

export interface SettingsBundle {
  settings: AppSettings;
  model: ModelSettings;
  sku: 'desktop-direct' | 'steam' | 'microsoft-store';
}

export interface SettingsPatch {
  settings?: Omit<Partial<AppSettings>, 'general' | 'appearance' | 'conversation' | 'tools' | 'webSearch' | 'personalization' | 'memory' | 'voice' | 'data' | 'privacy' | 'ui'> & {
    general?: Partial<GeneralSettings>;
    appearance?: Partial<AppearanceSettings>;
    conversation?: Partial<ConversationSettings>;
    tools?: Omit<Partial<ToolSettings>, 'modePermissions'> & {
      modePermissions?: Partial<ToolModePermissions>;
    };
    webSearch?: Partial<WebSearchSettings>;
    personalization?: Partial<PersonalizationSettings>;
    memory?: Partial<MemorySettings>;
    voice?: Partial<VoiceSettings>;
    data?: Partial<DataSettings>;
    privacy?: Omit<Partial<PrivacySettings>, 'networkConsent'> & {
      networkConsent?: Partial<NetworkConsentSettings>;
    };
    ui?: Partial<UiSettings>;
  };
  model?: Omit<Partial<ModelSettings>, 'ollama' | 'fallback'> & {
    ollama?: Partial<ModelSettings['ollama']>;
    fallback?: Partial<ModelSettings['fallback']>;
  };
}
