export type PersonalizationTone = 'balanced' | 'soft' | 'playful' | 'direct';
export type ReplyLength = 'short' | 'balanced' | 'detailed';
export type InitiativeLevel = 'low' | 'balanced' | 'high';
export type AnimationLevel = 'low' | 'balanced' | 'high';
export type ThemeMode = 'day' | 'night' | 'system';
export type SttEngine = 'local_whisper';
export type ConversationMode = 'create' | 'companion' | 'reason' | 'execute';
export type ModelProvider = 'ollama' | 'openai' | 'deepseek' | 'athena-cloud' | 'custom';
export type RemoteModelProvider = Exclude<ModelProvider, 'ollama'>;
export type MemoryImportContentMode = 'normal' | 'adult';

import type { WebSearchSettings } from './search';
import type { ToolModePermissions, ToolSettings } from './tools';
import type { ImageGenerationSettings } from './images';
import type { CloudAccountSettings } from './cloud';

export interface PersonalizationSettings {
  userName: string;
  preferredAddress: string;
  tone: PersonalizationTone;
  replyLength: ReplyLength;
  initiative: InitiativeLevel;
  proactiveCare: boolean;
  /**
   * Lets Athena decide on her own when to look again and whether to say something.
   * Off by default: it makes unattended model calls and can interrupt.
   */
  initiativeMessages: boolean;
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
  importContentMode: MemoryImportContentMode;
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
  remoteModel: boolean;
  webSearch: boolean;
  imageGeneration: boolean;
  onlineSpeechToText: boolean;
  onlineTextToSpeech: boolean;
  externalToolNetwork: boolean;
  cloudSync: boolean;
}

export interface PrivacySettings {
  networkConsent: NetworkConsentSettings;
  firstRunPrivacySeenAt?: string;
}

export interface PersonaSummarySettings {
  id: string;
  displayName: string;
  nickname: string;
  visibility: 'public' | 'private';
  role: 'assistant' | 'companion' | 'character';
  description: string;
  source: 'builtin' | 'local' | 'fallback';
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
  imageGeneration: ImageGenerationSettings;
  data: DataSettings;
  privacy: PrivacySettings;
  ui: UiSettings;
  cloud: CloudAccountSettings;
}

export interface RemoteModelSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  numCtx: number;
}

export interface ModelSettings {
  provider: ModelProvider;
  setupComplete: boolean;
  ollama: {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    numCtx: number;
  };
  remote: Record<RemoteModelProvider, RemoteModelSettings>;
  fallback: {
    enabled: boolean;
    timeoutMs: number;
  };
}

export interface SettingsBundle {
  settings: AppSettings;
  model: ModelSettings;
  persona: PersonaSummarySettings;
  sku: 'desktop-direct' | 'steam' | 'microsoft-store';
}

export interface SettingsPatch {
  settings?: Omit<Partial<AppSettings>, 'general' | 'appearance' | 'conversation' | 'tools' | 'webSearch' | 'personalization' | 'memory' | 'voice' | 'imageGeneration' | 'data' | 'privacy' | 'ui' | 'cloud'> & {
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
    imageGeneration?: Omit<Partial<ImageGenerationSettings>, 'local' | 'remote'> & {
      local?: Partial<ImageGenerationSettings['local']>;
      remote?: Partial<{ [K in keyof ImageGenerationSettings['remote']]: Partial<ImageGenerationSettings['remote'][K]> }>;
    };
    data?: Partial<DataSettings>;
    privacy?: Omit<Partial<PrivacySettings>, 'networkConsent'> & {
      networkConsent?: Partial<NetworkConsentSettings>;
    };
    ui?: Partial<UiSettings>;
    cloud?: Partial<CloudAccountSettings>;
  };
  model?: Omit<Partial<ModelSettings>, 'ollama' | 'remote' | 'fallback'> & {
    ollama?: Partial<ModelSettings['ollama']>;
    remote?: Partial<Record<RemoteModelProvider, Partial<RemoteModelSettings>>>;
    fallback?: Partial<ModelSettings['fallback']>;
  };
}
