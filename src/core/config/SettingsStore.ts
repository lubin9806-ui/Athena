import * as fs from 'fs';
import * as path from 'path';
import { resolveConfigFile, resolveLocalConfigOverlayPath, resolveWritableConfigFile } from '../runtime/Paths';
import { resolvePersonaCardWithSource, summarizePersonaCard } from '../ai/Personality';
import { applySteamSettingsPolicy, capSteamToolSettings, isSteamSku } from '../steam/SteamSkuPolicy';
import { isMicrosoftStoreSku } from '../store/MicrosoftStoreSku';
import type {
  AnimationLevel,
  AppSettings,
  DataSettings,
  GeneralSettings,
  ImageCloudFallback,
  ImageCloudProvider,
  ImageGenerationSettings,
  ImageProviderId,
  LocalImageBackend,
  LocalImageProfile,
  InitiativeLevel,
  MemorySettings,
  MemoryImportContentMode,
  ModelProvider,
  ModelSettings,
  AppearanceSettings,
  ConversationSettings,
  ConversationMode,
  PersonalizationSettings,
  PersonalizationTone,
  PrivacySettings,
  ReplyLength,
  RemoteModelProvider,
  SettingsBundle,
  SettingsPatch,
  SttEngine,
  SttLanguage,
  ThemeMode,
  ToolModePermissions,
  ToolPermissionLevel,
  ToolSettings,
  UiSettings,
  VoiceSettings,
  WebSearchMode,
  WebSearchSettings,
  CloudAccountSettings,
} from '../../shared/types';
import { ensureSufficientDiskSpace } from '../runtime/DiskSpaceGuard';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 2,
  profile: 'default',
  developerMode: false,
  general: {
    launchAtStartup: false,
    closeToTray: false,
    desktopNotifications: true,
    autoConnectModel: true,
  },
  appearance: {
    theme: 'system',
    animationLevel: 'balanced',
    glassEffects: true,
  },
  conversation: {
    activeMode: 'companion',
    enterToSend: true,
    streamResponses: true,
    showTimestamps: false,
    saveHistory: true,
    semanticRouting: false,
  },
  tools: {
    permissionLevel: 'off',
    modePermissions: {
      create: 'off',
      companion: 'off',
      reason: 'off',
      execute: 'off',
    },
    maxToolRounds: 4,
    commandTimeoutSeconds: 60,
  },
  webSearch: {
    enabled: true,
    mode: 'auto',
    maxResults: 5,
    deepRead: true,
    secondarySearch: true,
    maxPages: 3,
  },
  personalization: {
    userName: '',
    preferredAddress: '',
    tone: 'balanced',
    replyLength: 'balanced',
    initiative: 'balanced',
    proactiveCare: true,
    initiativeMessages: false,
    useMemoryInSmallTalk: true,
    creatorModeHints: true,
    customNotes: '',
  },
  memory: {
    enabled: true,
    autoExtract: true,
    retrieveProfile: true,
    retrieveEvents: true,
    retrieveProjects: true,
    retrievalDepth: 8,
    minImportanceForAutoExtract: 5,
    importContentMode: 'normal',
  },
  voice: {
    sttEnabled: false,
    ttsEnabled: true,
    autoPlayAssistant: false,
    sttEngine: 'local_whisper',
    sttLanguage: 'auto',
    ttsVoice: '',
    ttsRate: 0,
    ttsVolume: 100,
    ttsPitch: 0,
    silenceAutoStop: true,
    bargeIn: false,
    autoSendDictation: false,
    handsFree: false,
  },
  imageGeneration: {
    provider: 'local',
    cloudFallback: 'never',
    local: {
      engine: 'auto',
      autoDiscover: true,
      runtimePath: '',
      modelPath: '',
      comfyuiBaseUrl: 'http://127.0.0.1:8188',
      comfyuiCheckpoint: '',
      backend: 'auto',
      profile: 'fast',
      steps: 4,
      cfgScale: 1,
    },
    remote: {
      openai: { baseUrl: 'https://api.openai.com/v1/images', model: 'gpt-image-2' },
      google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/interactions', model: 'gemini-3.1-flash-lite-image' },
      stability: { baseUrl: 'https://api.stability.ai/v2beta/stable-image/generate/core', model: 'stable-image-core' },
      bfl: { baseUrl: 'https://api.bfl.ai/v1', model: 'flux-2-klein-4b' },
      volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', model: 'doubao-seedream-4-0-250828' },
      dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', model: 'wanx-v1' },
      replicate: { baseUrl: 'https://api.replicate.com/v1/models', model: 'black-forest-labs/flux-schnell' },
      fal: { baseUrl: 'https://queue.fal.run', model: 'fal-ai/flux/schnell' },
      custom: { baseUrl: '', model: '' },
    },
  },
  data: {
    confirmBeforeDelete: true,
    historyRetentionDays: 0,
    voiceCacheRetentionHours: 24,
    exportFormat: 'json',
  },
  privacy: {
    networkConsent: {
      remoteModel: false,
      webSearch: false,
      imageGeneration: false,
      onlineSpeechToText: false,
      onlineTextToSpeech: false,
      externalToolNetwork: false,
      cloudSync: false,
    },
  },
  cloud: {
    syncEnabled: false,
    baseUrl: '',
    email: '',
    tenantId: '',
    deviceName: 'Athena Desktop',
  },
  ui: {
    startupIntro: true,
    compactMode: false,
  },
};

const DEFAULT_MODEL: ModelSettings = {
  provider: 'ollama',
  setupComplete: false,
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:14b',
    temperature: 0.7,
    maxTokens: 2048,
    numCtx: 4096,
  },
  remote: {
    openai: {
      baseUrl: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      numCtx: 32768,
    },
    deepseek: {
      baseUrl: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      numCtx: 32768,
    },
    'athena-cloud': {
      baseUrl: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      numCtx: 32768,
    },
    custom: {
      baseUrl: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      numCtx: 32768,
    },
  },
  fallback: {
    enabled: false,
    timeoutMs: 30000,
  },
};

const TONES = new Set<PersonalizationTone>(['balanced', 'soft', 'playful', 'direct']);
const REPLY_LENGTHS = new Set<ReplyLength>(['short', 'balanced', 'detailed']);
const INITIATIVE_LEVELS = new Set<InitiativeLevel>(['low', 'balanced', 'high']);
const ANIMATION_LEVELS = new Set<AnimationLevel>(['low', 'balanced', 'high']);
const THEME_MODES = new Set<ThemeMode>(['day', 'night', 'system']);
const STT_ENGINES = new Set<SttEngine>(['local_whisper']);
const STT_LANGUAGES = new Set<SttLanguage>(['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'it', 'pt']);
const CONVERSATION_MODES = new Set<ConversationMode>(['create', 'companion', 'reason', 'execute']);
const WEB_SEARCH_MODES = new Set<WebSearchMode>(['auto', 'manual']);
const TOOL_PERMISSION_LEVELS = new Set<ToolPermissionLevel>(['off', 'read', 'files', 'full']);
const MODEL_PROVIDERS = new Set<ModelProvider>(['ollama', 'openai', 'deepseek', 'athena-cloud', 'custom']);
const MEMORY_IMPORT_CONTENT_MODES = new Set<MemoryImportContentMode>(['normal', 'adult']);
const IMAGE_PROVIDERS = new Set<ImageProviderId>(['local', 'openai', 'google', 'stability', 'bfl', 'volcengine', 'dashscope', 'replicate', 'fal', 'custom']);
const IMAGE_CLOUD_PROVIDERS: ImageCloudProvider[] = ['openai', 'google', 'stability', 'bfl', 'volcengine', 'dashscope', 'replicate', 'fal', 'custom'];
const IMAGE_LOCAL_BACKENDS = new Set<LocalImageBackend>(['auto', 'cuda', 'vulkan', 'cpu']);
const IMAGE_LOCAL_ENGINES = new Set<ImageGenerationSettings['local']['engine']>(['auto', 'athena', 'comfyui']);
const IMAGE_LOCAL_PROFILES = new Set<LocalImageProfile>(['fast', 'balanced', 'quality', 'custom']);
const IMAGE_CLOUD_FALLBACKS = new Set<ImageCloudFallback>(['never', 'ask']);
export const TOOL_PERMISSION_RANK: Record<ToolPermissionLevel, number> = { off: 0, read: 1, files: 2, full: 3 };

export function getSettingsBundle(): SettingsBundle {
  const settings = loadAppSettings();
  const persona = resolvePersonaCardWithSource(settings.profile);
  return {
    settings,
    model: loadModelSettings(),
    persona: summarizePersonaCard(persona.card, persona.source, persona.sourcePath),
    sku: isSteamSku() ? 'steam' : isMicrosoftStoreSku() ? 'microsoft-store' : 'desktop-direct',
  };
}

export function saveSettingsBundle(patch: SettingsPatch): SettingsBundle {
  const current = getSettingsBundle();
  const nextSettings = applySteamSettingsPolicy(sanitizeAppSettings(mergeAppSettings(current.settings, patch.settings)));
  const persona = resolvePersonaCardWithSource(nextSettings.profile);
  const next: SettingsBundle = {
    settings: nextSettings,
    model: sanitizeModelSettings(mergeModelSettings(current.model, patch.model)),
    persona: summarizePersonaCard(persona.card, persona.source, persona.sourcePath),
    sku: current.sku,
  };

  // Unpackaged Electron writes overlays so tracked config stays at shipping
  // defaults. Isolated tests and packaged userData still write the plain files.
  writeJson(resolveLocalConfigOverlayPath('settings.json') || configPath('settings.json'), next.settings);
  writeJson(resolveLocalConfigOverlayPath('model.json') || configPath('model.json'), next.model);
  return next;
}

export function getPersonalizationSettings(): PersonalizationSettings {
  return loadAppSettings().personalization;
}

export function getAppSettings(): AppSettings {
  return loadAppSettings();
}

export function getModelSettings(): ModelSettings {
  return loadModelSettings();
}

export function resolveToolSettingsForMode(settings: ToolSettings, mode: ConversationMode): ToolSettings {
  return capSteamToolSettings({
    ...settings,
    permissionLevel: mode === 'execute'
      ? settings.modePermissions.execute ?? settings.permissionLevel
      : 'off',
  });
}

export function hasNetworkConsent(capability: keyof PrivacySettings['networkConsent']): boolean {
  return loadAppSettings().privacy.networkConsent[capability] === true;
}

export function buildPersonalizationPrompt(): string {
  const settings = getPersonalizationSettings();
  const lines: string[] = [];

  if (settings.userName) lines.push(`- 用户名字：${settings.userName}`);
  if (settings.preferredAddress) lines.push(`- 对用户的称呼：${settings.preferredAddress}`);
  lines.push(`- 互动风格：${toneLabel(settings.tone)}`);
  lines.push(`- 回复长度：${replyLengthLabel(settings.replyLength)}`);
  lines.push(`- 主动性：${initiativeLabel(settings.initiative)}`);
  lines.push(settings.proactiveCare
    ? '- 可以在合适时自然关心用户的休息、创作节奏和当前状态。'
    : '- 不主动催促或关心日常状态，除非用户先提到。');
  lines.push(settings.useMemoryInSmallTalk
    ? '- 日常聊天可以自然使用相关记忆。'
    : '- 日常闲聊尽量少引用长期记忆，除非用户明确需要连续上下文。');
  lines.push(settings.creatorModeHints
    ? '- 创作或绘画话题里可以给出具体画面、节奏、参考方向和下一步。'
    : '- 创作话题少主动展开建议，优先接住用户当前表达。');
  if (settings.customNotes) lines.push(`- 用户补充设定：${settings.customNotes}`);

  return ['## 用户个性化设置', ...lines].join('\n');
}

export function shouldSaveHistory(): boolean {
  return loadAppSettings().conversation.saveHistory;
}

function loadAppSettings(): AppSettings {
  const tracked = sanitizeAppSettings(readJson(resolveConfigFile('settings.json'), DEFAULT_SETTINGS));
  const overlayPath = resolveLocalConfigOverlayPath('settings.json');
  // Overlay is opt-in for unpackaged Electron only. Node tests keep seeing the
  // tracked file, which is how ATH-SEC-003/ATH-PRIV-001 regressions are caught.
  if (!overlayPath || !fs.existsSync(overlayPath)) {
    return applySteamSettingsPolicy(tracked);
  }
  const overlay = sanitizeAppSettings(readJson(overlayPath, tracked));
  return applySteamSettingsPolicy(mergeAppSettings(tracked, overlay));
}

function loadModelSettings(): ModelSettings {
  const tracked = sanitizeModelSettings(readJson(resolveConfigFile('model.json'), DEFAULT_MODEL));
  const overlayPath = resolveLocalConfigOverlayPath('model.json');
  if (!overlayPath || !fs.existsSync(overlayPath)) return tracked;
  const overlay = readJson(overlayPath, tracked);
  return sanitizeModelSettings(mergeModelSettings(tracked, isRecord(overlay) ? overlay : undefined));
}

function mergeAppSettings(current: AppSettings, patch?: SettingsPatch['settings']): AppSettings {
  if (!patch) return current;
  return {
    ...current,
    ...patch,
    general: {
      ...current.general,
      ...patch.general,
    },
    appearance: {
      ...current.appearance,
      ...patch.appearance,
    },
    conversation: {
      ...current.conversation,
      ...patch.conversation,
    },
    tools: {
      ...current.tools,
      ...patch.tools,
      modePermissions: {
        ...current.tools.modePermissions,
        ...patch.tools?.modePermissions,
      },
    },
    webSearch: {
      ...current.webSearch,
      ...patch.webSearch,
    },
    personalization: {
      ...current.personalization,
      ...patch.personalization,
    },
    memory: {
      ...current.memory,
      ...patch.memory,
    },
    voice: {
      ...current.voice,
      ...patch.voice,
    },
    imageGeneration: {
      ...current.imageGeneration,
      ...patch.imageGeneration,
      local: {
        ...current.imageGeneration.local,
        ...patch.imageGeneration?.local,
      },
      remote: Object.fromEntries(IMAGE_CLOUD_PROVIDERS.map(provider => [provider, {
        ...current.imageGeneration.remote[provider],
        ...patch.imageGeneration?.remote?.[provider],
      }])) as ImageGenerationSettings['remote'],
    },
    data: {
      ...current.data,
      ...patch.data,
    },
    privacy: {
      ...current.privacy,
      ...patch.privacy,
      networkConsent: {
        ...current.privacy.networkConsent,
        ...patch.privacy?.networkConsent,
      },
    },
    ui: {
      ...current.ui,
      ...patch.ui,
    },
    cloud: {
      ...DEFAULT_SETTINGS.cloud,
      ...current.cloud,
      ...patch.cloud,
    },
  };
}

function mergeModelSettings(current: ModelSettings, patch?: SettingsPatch['model']): ModelSettings {
  if (!patch) return current;
  return {
    ...current,
    ...patch,
    ollama: {
      ...current.ollama,
      ...patch.ollama,
    },
    remote: {
      openai: { ...current.remote.openai, ...patch.remote?.openai },
      deepseek: { ...current.remote.deepseek, ...patch.remote?.deepseek },
      'athena-cloud': { ...current.remote['athena-cloud'], ...patch.remote?.['athena-cloud'] },
      custom: { ...current.remote.custom, ...patch.remote?.custom },
    },
    fallback: {
      ...current.fallback,
      ...patch.fallback,
    },
  };
}

function sanitizeAppSettings(value: unknown): AppSettings {
  const source = isRecord(value) ? value : {};
  const sourceVersion = clampInteger(source.version, 1, 99, 1);
  const general = sanitizeGeneral(source.general);
  const appearance = sanitizeAppearance(source.appearance);
  const conversation = sanitizeConversation(source.conversation);
  const normalizedTools = normalizeToolSettings(source.tools);
  const tools: ToolSettings = sourceVersion < 2
    ? {
      ...normalizedTools,
      permissionLevel: 'off',
      modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'off' },
    }
    : normalizedTools;
  const webSearch = sanitizeWebSearch(source.webSearch);
  const personalization = sanitizePersonalization(source.personalization);
  const memory = sanitizeMemory(source.memory);
  const voice = sanitizeVoice(source.voice);
  const imageGeneration = sanitizeImageGeneration(source.imageGeneration);
  const data = sanitizeData(source.data);
  const privacy = sanitizePrivacy(source.privacy);
  const ui = sanitizeUi(source.ui);
  const cloud = sanitizeCloud(source.cloud);
  return {
    version: DEFAULT_SETTINGS.version,
    profile: cleanString(source.profile, 80, DEFAULT_SETTINGS.profile),
    developerMode: cleanBoolean(source.developerMode, DEFAULT_SETTINGS.developerMode),
    general,
    appearance,
    conversation,
    tools,
    webSearch,
    personalization,
    memory,
    voice,
    imageGeneration,
    data,
    privacy,
    ui,
    cloud,
  };
}

function sanitizeGeneral(value: unknown): GeneralSettings {
  const source = isRecord(value) ? value : {};
  return {
    launchAtStartup: cleanBoolean(source.launchAtStartup, DEFAULT_SETTINGS.general.launchAtStartup),
    closeToTray: cleanBoolean(source.closeToTray, DEFAULT_SETTINGS.general.closeToTray),
    desktopNotifications: cleanBoolean(source.desktopNotifications, DEFAULT_SETTINGS.general.desktopNotifications),
    autoConnectModel: cleanBoolean(source.autoConnectModel, DEFAULT_SETTINGS.general.autoConnectModel),
  };
}

function sanitizeAppearance(value: unknown): AppearanceSettings {
  const source = isRecord(value) ? value : {};
  const legacyTheme = source.theme === 'dark' ? 'night' : source.theme;
  return {
    theme: cleanEnum(legacyTheme, THEME_MODES, DEFAULT_SETTINGS.appearance.theme),
    animationLevel: cleanEnum(source.animationLevel, ANIMATION_LEVELS, DEFAULT_SETTINGS.appearance.animationLevel),
    glassEffects: cleanBoolean(source.glassEffects, DEFAULT_SETTINGS.appearance.glassEffects),
  };
}

function sanitizeConversation(value: unknown): ConversationSettings {
  const source = isRecord(value) ? value : {};
  return {
    activeMode: cleanEnum(source.activeMode, CONVERSATION_MODES, DEFAULT_SETTINGS.conversation.activeMode),
    enterToSend: cleanBoolean(source.enterToSend, DEFAULT_SETTINGS.conversation.enterToSend),
    streamResponses: cleanBoolean(source.streamResponses, DEFAULT_SETTINGS.conversation.streamResponses),
    showTimestamps: cleanBoolean(source.showTimestamps, DEFAULT_SETTINGS.conversation.showTimestamps),
    saveHistory: cleanBoolean(source.saveHistory, DEFAULT_SETTINGS.conversation.saveHistory),
    semanticRouting: cleanBoolean(source.semanticRouting, DEFAULT_SETTINGS.conversation.semanticRouting),
  };
}

export function normalizeToolSettings(value: unknown): ToolSettings {
  const source = isRecord(value) ? value : {};
  const permissionLevel = cleanEnum(source.permissionLevel, TOOL_PERMISSION_LEVELS, DEFAULT_SETTINGS.tools.permissionLevel);
  return {
    permissionLevel,
    modePermissions: sanitizeToolModePermissions(source.modePermissions, permissionLevel),
    maxToolRounds: clampInteger(source.maxToolRounds, 1, 8, DEFAULT_SETTINGS.tools.maxToolRounds),
    commandTimeoutSeconds: clampInteger(source.commandTimeoutSeconds, 5, 300, DEFAULT_SETTINGS.tools.commandTimeoutSeconds),
    allowExternalNetwork: cleanBoolean(source.allowExternalNetwork, false),
  };
}

function sanitizeToolModePermissions(value: unknown, legacyFallback: ToolPermissionLevel): ToolModePermissions {
  const source = isRecord(value) ? value : {};
  const explicitExecutionLevel = cleanOptionalToolPermission(source.execute);
  const migratedExecutionLevel = explicitExecutionLevel ?? [source.create, source.companion, source.reason]
    .map(cleanOptionalToolPermission)
    .filter((level): level is ToolPermissionLevel => Boolean(level))
    .reduce(
      (highest, level) => TOOL_PERMISSION_RANK[level] > TOOL_PERMISSION_RANK[highest] ? level : highest,
      legacyFallback,
    );
  return {
    create: 'off',
    companion: 'off',
    reason: 'off',
    execute: migratedExecutionLevel,
  };
}

function cleanOptionalToolPermission(value: unknown): ToolPermissionLevel | undefined {
  return typeof value === 'string' && TOOL_PERMISSION_LEVELS.has(value as ToolPermissionLevel)
    ? value as ToolPermissionLevel
    : undefined;
}

function sanitizeWebSearch(value: unknown): WebSearchSettings {
  const source = isRecord(value) ? value : {};
  return {
    enabled: cleanBoolean(source.enabled, DEFAULT_SETTINGS.webSearch.enabled),
    mode: cleanEnum(source.mode, WEB_SEARCH_MODES, DEFAULT_SETTINGS.webSearch.mode),
    maxResults: clampInteger(source.maxResults, 3, 8, DEFAULT_SETTINGS.webSearch.maxResults),
    deepRead: cleanBoolean(source.deepRead, DEFAULT_SETTINGS.webSearch.deepRead),
    secondarySearch: cleanBoolean(source.secondarySearch, DEFAULT_SETTINGS.webSearch.secondarySearch),
    maxPages: clampInteger(source.maxPages, 1, 4, DEFAULT_SETTINGS.webSearch.maxPages),
  };
}

function sanitizePersonalization(value: unknown): PersonalizationSettings {
  const source = isRecord(value) ? value : {};
  return {
    userName: cleanString(source.userName, 80, DEFAULT_SETTINGS.personalization.userName),
    preferredAddress: cleanString(source.preferredAddress, 80, DEFAULT_SETTINGS.personalization.preferredAddress),
    tone: cleanEnum(source.tone, TONES, DEFAULT_SETTINGS.personalization.tone),
    replyLength: cleanEnum(source.replyLength, REPLY_LENGTHS, DEFAULT_SETTINGS.personalization.replyLength),
    initiative: cleanEnum(source.initiative, INITIATIVE_LEVELS, DEFAULT_SETTINGS.personalization.initiative),
    proactiveCare: cleanBoolean(source.proactiveCare, DEFAULT_SETTINGS.personalization.proactiveCare),
    initiativeMessages: cleanBoolean(source.initiativeMessages, DEFAULT_SETTINGS.personalization.initiativeMessages),
    useMemoryInSmallTalk: cleanBoolean(source.useMemoryInSmallTalk, DEFAULT_SETTINGS.personalization.useMemoryInSmallTalk),
    creatorModeHints: cleanBoolean(source.creatorModeHints, DEFAULT_SETTINGS.personalization.creatorModeHints),
    customNotes: cleanString(source.customNotes, 1200, DEFAULT_SETTINGS.personalization.customNotes),
  };
}

function sanitizeMemory(value: unknown): MemorySettings {
  const source = isRecord(value) ? value : {};
  return {
    enabled: cleanBoolean(source.enabled, DEFAULT_SETTINGS.memory.enabled),
    autoExtract: cleanBoolean(source.autoExtract, DEFAULT_SETTINGS.memory.autoExtract),
    retrieveProfile: cleanBoolean(source.retrieveProfile, DEFAULT_SETTINGS.memory.retrieveProfile),
    retrieveEvents: cleanBoolean(source.retrieveEvents, DEFAULT_SETTINGS.memory.retrieveEvents),
    retrieveProjects: cleanBoolean(source.retrieveProjects, DEFAULT_SETTINGS.memory.retrieveProjects),
    retrievalDepth: clampInteger(source.retrievalDepth, 0, 20, DEFAULT_SETTINGS.memory.retrievalDepth),
    minImportanceForAutoExtract: clampInteger(source.minImportanceForAutoExtract, 1, 10, DEFAULT_SETTINGS.memory.minImportanceForAutoExtract),
    importContentMode: cleanEnum(source.importContentMode, MEMORY_IMPORT_CONTENT_MODES, DEFAULT_SETTINGS.memory.importContentMode),
  };
}

function sanitizeVoice(value: unknown): VoiceSettings {
  const source = isRecord(value) ? value : {};
  const configuredVoice = cleanString(source.ttsVoice, 120, DEFAULT_SETTINGS.voice.ttsVoice);
  const ttsVoice = /Neural$/i.test(configuredVoice) ? '' : configuredVoice;
  return {
    sttEnabled: cleanBoolean(source.sttEnabled, DEFAULT_SETTINGS.voice.sttEnabled),
    ttsEnabled: cleanBoolean(source.ttsEnabled, DEFAULT_SETTINGS.voice.ttsEnabled),
    autoPlayAssistant: cleanBoolean(source.autoPlayAssistant, DEFAULT_SETTINGS.voice.autoPlayAssistant),
    // Window 05 deliberately removes the old implicit online fallback. Legacy
    // auto/speech_recognition/whisper values migrate to the only 1.0 engine.
    sttEngine: cleanEnum(source.sttEngine, STT_ENGINES, DEFAULT_SETTINGS.voice.sttEngine),
    // Settings written before ATH-VOICE-003 have no language and were decoded as
    // Chinese regardless of what was spoken; they migrate to detection.
    sttLanguage: cleanEnum(source.sttLanguage, STT_LANGUAGES, DEFAULT_SETTINGS.voice.sttLanguage),
    ttsVoice,
    // Ranges are SAPI's own; tts-local.ps1 refuses anything outside them.
    ttsRate: clampInteger(source.ttsRate, -10, 10, DEFAULT_SETTINGS.voice.ttsRate),
    ttsVolume: clampInteger(source.ttsVolume, 0, 100, DEFAULT_SETTINGS.voice.ttsVolume),
    ttsPitch: clampInteger(source.ttsPitch, -50, 50, DEFAULT_SETTINGS.voice.ttsPitch),
    silenceAutoStop: cleanBoolean(source.silenceAutoStop, DEFAULT_SETTINGS.voice.silenceAutoStop),
    bargeIn: cleanBoolean(source.bargeIn, DEFAULT_SETTINGS.voice.bargeIn),
    autoSendDictation: cleanBoolean(source.autoSendDictation, DEFAULT_SETTINGS.voice.autoSendDictation),
    handsFree: cleanBoolean(source.handsFree, DEFAULT_SETTINGS.voice.handsFree),
  };
}

function sanitizeImageGeneration(value: unknown): ImageGenerationSettings {
  const source = isRecord(value) ? value : {};
  const local = isRecord(source.local) ? source.local : {};
  const remote = isRecord(source.remote) ? source.remote : {};
  const remoteSettings = Object.fromEntries(IMAGE_CLOUD_PROVIDERS.map(provider => {
    const item = isRecord(remote[provider]) ? remote[provider] : {};
    const fallback = DEFAULT_SETTINGS.imageGeneration.remote[provider];
    return [provider, {
      baseUrl: cleanString(item.baseUrl, 500, fallback.baseUrl).replace(/\/$/, ''),
      model: cleanString(item.model, 180, fallback.model),
    }];
  })) as ImageGenerationSettings['remote'];
  return {
    provider: cleanEnum(source.provider, IMAGE_PROVIDERS, DEFAULT_SETTINGS.imageGeneration.provider),
    cloudFallback: cleanEnum(source.cloudFallback, IMAGE_CLOUD_FALLBACKS, DEFAULT_SETTINGS.imageGeneration.cloudFallback),
    local: {
      engine: cleanEnum(local.engine, IMAGE_LOCAL_ENGINES, DEFAULT_SETTINGS.imageGeneration.local.engine),
      autoDiscover: cleanBoolean(local.autoDiscover, DEFAULT_SETTINGS.imageGeneration.local.autoDiscover),
      runtimePath: cleanString(local.runtimePath, 2048, DEFAULT_SETTINGS.imageGeneration.local.runtimePath),
      modelPath: cleanString(local.modelPath, 2048, DEFAULT_SETTINGS.imageGeneration.local.modelPath),
      comfyuiBaseUrl: sanitizeLocalComfyUrl(local.comfyuiBaseUrl, DEFAULT_SETTINGS.imageGeneration.local.comfyuiBaseUrl),
      comfyuiCheckpoint: cleanString(local.comfyuiCheckpoint, 500, DEFAULT_SETTINGS.imageGeneration.local.comfyuiCheckpoint),
      backend: cleanEnum(local.backend, IMAGE_LOCAL_BACKENDS, DEFAULT_SETTINGS.imageGeneration.local.backend),
      profile: cleanEnum(local.profile, IMAGE_LOCAL_PROFILES, DEFAULT_SETTINGS.imageGeneration.local.profile),
      steps: clampInteger(local.steps, 1, 100, DEFAULT_SETTINGS.imageGeneration.local.steps),
      cfgScale: clampNumber(local.cfgScale, 0, 30, DEFAULT_SETTINGS.imageGeneration.local.cfgScale),
    },
    remote: remoteSettings,
  };
}

function sanitizeLocalComfyUrl(value: unknown, fallback: string): string {
  const candidate = cleanString(value, 500, fallback).replace(/\/$/, '');
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase())) return fallback;
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function sanitizeData(value: unknown): DataSettings {
  const source = isRecord(value) ? value : {};
  return {
    confirmBeforeDelete: cleanBoolean(source.confirmBeforeDelete, DEFAULT_SETTINGS.data.confirmBeforeDelete),
    historyRetentionDays: clampInteger(source.historyRetentionDays, 0, 3650, DEFAULT_SETTINGS.data.historyRetentionDays),
    voiceCacheRetentionHours: clampInteger(source.voiceCacheRetentionHours, 1, 720, DEFAULT_SETTINGS.data.voiceCacheRetentionHours),
    exportFormat: source.exportFormat === 'markdown' ? 'markdown' : DEFAULT_SETTINGS.data.exportFormat,
  };
}

function sanitizePrivacy(value: unknown): PrivacySettings {
  const source = isRecord(value) ? value : {};
  const consent = isRecord(source.networkConsent) ? source.networkConsent : {};
  const firstRunPrivacySeenAt = typeof source.firstRunPrivacySeenAt === 'string'
    ? source.firstRunPrivacySeenAt.slice(0, 80)
    : undefined;
  return {
    networkConsent: {
      remoteModel: cleanBoolean(consent.remoteModel, DEFAULT_SETTINGS.privacy.networkConsent.remoteModel),
      webSearch: cleanBoolean(consent.webSearch, DEFAULT_SETTINGS.privacy.networkConsent.webSearch),
      imageGeneration: cleanBoolean(consent.imageGeneration, DEFAULT_SETTINGS.privacy.networkConsent.imageGeneration),
      onlineSpeechToText: cleanBoolean(consent.onlineSpeechToText, DEFAULT_SETTINGS.privacy.networkConsent.onlineSpeechToText),
      onlineTextToSpeech: cleanBoolean(consent.onlineTextToSpeech, DEFAULT_SETTINGS.privacy.networkConsent.onlineTextToSpeech),
      externalToolNetwork: cleanBoolean(consent.externalToolNetwork, DEFAULT_SETTINGS.privacy.networkConsent.externalToolNetwork),
      cloudSync: cleanBoolean(consent.cloudSync, DEFAULT_SETTINGS.privacy.networkConsent.cloudSync),
    },
    ...(firstRunPrivacySeenAt ? { firstRunPrivacySeenAt } : {}),
  };
}

function sanitizeCloud(value: unknown): CloudAccountSettings {
  const source = isRecord(value) ? value : {};
  return {
    syncEnabled: cleanBoolean(source.syncEnabled, DEFAULT_SETTINGS.cloud.syncEnabled),
    baseUrl: cleanString(source.baseUrl, 200, DEFAULT_SETTINGS.cloud.baseUrl),
    email: cleanString(source.email, 254, DEFAULT_SETTINGS.cloud.email),
    tenantId: cleanString(source.tenantId, 80, DEFAULT_SETTINGS.cloud.tenantId),
    deviceName: cleanString(source.deviceName, 100, DEFAULT_SETTINGS.cloud.deviceName) || 'Athena Desktop',
  };
}

function sanitizeUi(value: unknown): UiSettings {
  const source = isRecord(value) ? value : {};
  return {
    startupIntro: cleanBoolean(source.startupIntro, DEFAULT_SETTINGS.ui.startupIntro),
    compactMode: cleanBoolean(source.compactMode, DEFAULT_SETTINGS.ui.compactMode),
  };
}

function sanitizeModelSettings(value: unknown): ModelSettings {
  const source = isRecord(value) ? value : {};
  const ollama = isRecord(source.ollama) ? source.ollama : {};
  const remote = isRecord(source.remote) ? source.remote : {};
  const fallback = isRecord(source.fallback) ? source.fallback : {};
  return {
    provider: cleanEnum(source.provider, MODEL_PROVIDERS, DEFAULT_MODEL.provider),
    setupComplete: cleanBoolean(source.setupComplete, DEFAULT_MODEL.setupComplete),
    ollama: {
      baseUrl: cleanString(ollama.baseUrl, 200, DEFAULT_MODEL.ollama.baseUrl).replace(/\/$/, ''),
      model: cleanString(ollama.model, 120, DEFAULT_MODEL.ollama.model),
      temperature: clampNumber(ollama.temperature, 0, 2, DEFAULT_MODEL.ollama.temperature),
      maxTokens: clampInteger(ollama.maxTokens, 128, 8192, DEFAULT_MODEL.ollama.maxTokens),
      numCtx: clampInteger(ollama.numCtx, 1024, 32768, DEFAULT_MODEL.ollama.numCtx),
    },
    remote: {
      openai: sanitizeRemoteModelSettings('openai', remote.openai, DEFAULT_MODEL.remote.openai),
      deepseek: sanitizeRemoteModelSettings('deepseek', remote.deepseek, DEFAULT_MODEL.remote.deepseek),
      'athena-cloud': sanitizeRemoteModelSettings('athena-cloud', remote['athena-cloud'], DEFAULT_MODEL.remote['athena-cloud']),
      custom: sanitizeRemoteModelSettings('custom', remote.custom, DEFAULT_MODEL.remote.custom),
    },
    fallback: {
      enabled: cleanBoolean(fallback.enabled, DEFAULT_MODEL.fallback.enabled),
      timeoutMs: clampInteger(fallback.timeoutMs, 5000, 120000, DEFAULT_MODEL.fallback.timeoutMs),
    },
  };
}

function sanitizeRemoteModelSettings(provider: RemoteModelProvider, value: unknown, fallback: ModelSettings['remote']['openai']): ModelSettings['remote']['openai'] {
  const source = isRecord(value) ? value : {};
  return {
    baseUrl: sanitizeRemoteBaseUrl(provider, source.baseUrl, fallback.baseUrl),
    model: cleanString(source.model, 160, fallback.model),
    temperature: clampNumber(source.temperature, 0, 2, fallback.temperature),
    maxTokens: clampInteger(source.maxTokens, 128, 32768, fallback.maxTokens),
    numCtx: clampInteger(source.numCtx, 1024, 1048576, fallback.numCtx),
  };
}

function sanitizeRemoteBaseUrl(provider: RemoteModelProvider, value: unknown, fallback: string): string {
  const cleaned = normalizeRemoteBaseUrl(provider, cleanString(value, 500, fallback));
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))
      ? cleaned
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRemoteBaseUrl(provider: RemoteModelProvider, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (provider === 'openai' && hostname === 'api.openai.com') {
      parsed.pathname = '/v1';
      return parsed.toString().replace(/\/$/, '');
    }
    if (provider === 'deepseek' && hostname === 'api.deepseek.com') {
      parsed.pathname = pathname === '/v1' || pathname === '/anthropic'
        ? ''
        : pathname === '/beta'
          ? '/beta'
          : parsed.pathname;
      return parsed.toString().replace(/\/$/, '');
    }
    if (pathname.endsWith('/models')) parsed.pathname = parsed.pathname.slice(0, -'/models'.length) || '';
    if (pathname.endsWith('/chat/completions')) parsed.pathname = parsed.pathname.slice(0, -'/chat/completions'.length) || '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

function configPath(fileName: string): string {
  return resolveWritableConfigFile(fileName);
}

function readJson<T>(filePath: string | null, fallback: T): unknown {
  if (!filePath) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  ensureSufficientDiskSpace(filePath, 2 * 1024 * 1024);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, filePath);
}

function cleanString(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toneLabel(tone: PersonalizationTone): string {
  if (tone === 'soft') return '更柔软、更陪伴，少锋利吐槽';
  if (tone === 'playful') return '更活泼、更会开玩笑，但不刷屏';
  if (tone === 'direct') return '更直接、更干练，少绕弯';
  return '自然平衡，聊天轻松，做事可靠';
}

function replyLengthLabel(length: ReplyLength): string {
  if (length === 'short') return '偏短，像即时消息，除非任务需要展开';
  if (length === 'detailed') return '可以更完整地解释、拆步骤和补上下文';
  return '跟随用户长度，短问短答，复杂任务适度展开';
}

function initiativeLabel(level: InitiativeLevel): string {
  if (level === 'low') return '低，只回应用户明确提出的内容';
  if (level === 'high') return '高，可以主动提醒下一步、补充风险和建议';
  return '中，必要时主动推进，但不打断用户节奏';
}
