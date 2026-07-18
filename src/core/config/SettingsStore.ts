import * as fs from 'fs';
import * as path from 'path';
import { resolveConfigFile, resolveWritableConfigFile } from '../runtime/Paths';
import { applySteamSettingsPolicy, capSteamToolSettings, isSteamSku } from '../steam/SteamSkuPolicy';
import { isMicrosoftStoreSku } from '../store/MicrosoftStoreSku';
import type {
  AnimationLevel,
  AppSettings,
  DataSettings,
  GeneralSettings,
  InitiativeLevel,
  MemorySettings,
  ModelSettings,
  AppearanceSettings,
  ConversationSettings,
  ConversationMode,
  PersonalizationSettings,
  PersonalizationTone,
  PrivacySettings,
  ReplyLength,
  SettingsBundle,
  SettingsPatch,
  SttEngine,
  ThemeMode,
  ToolModePermissions,
  ToolPermissionLevel,
  ToolSettings,
  UiSettings,
  VoiceSettings,
  WebSearchMode,
  WebSearchSettings,
} from '../../shared/types';
import { ensureSufficientDiskSpace } from '../runtime/DiskSpaceGuard';

const DEFAULT_SETTINGS: AppSettings = {
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
  },
  voice: {
    sttEnabled: true,
    ttsEnabled: true,
    autoPlayAssistant: false,
    sttEngine: 'local_whisper',
    ttsVoice: '',
    silenceAutoStop: true,
  },
  data: {
    confirmBeforeDelete: true,
    historyRetentionDays: 0,
    voiceCacheRetentionHours: 24,
    exportFormat: 'json',
  },
  privacy: {
    networkConsent: {
      webSearch: false,
      onlineSpeechToText: false,
      onlineTextToSpeech: false,
      externalToolNetwork: false,
    },
  },
  ui: {
    startupIntro: true,
    compactMode: false,
  },
};

const DEFAULT_MODEL: ModelSettings = {
  provider: 'ollama',
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:14b',
    temperature: 0.7,
    maxTokens: 2048,
    numCtx: 4096,
  },
  deepseek: {
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxTokens: 4096,
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
const CONVERSATION_MODES = new Set<ConversationMode>(['create', 'companion', 'reason', 'execute']);
const WEB_SEARCH_MODES = new Set<WebSearchMode>(['auto', 'manual']);
const TOOL_PERMISSION_LEVELS = new Set<ToolPermissionLevel>(['off', 'read', 'files', 'full']);
const TOOL_PERMISSION_RANK: Record<ToolPermissionLevel, number> = { off: 0, read: 1, files: 2, full: 3 };

export function getSettingsBundle(): SettingsBundle {
  return {
    settings: loadAppSettings(),
    model: loadModelSettings(),
    sku: isSteamSku() ? 'steam' : isMicrosoftStoreSku() ? 'microsoft-store' : 'desktop-direct',
  };
}

export function saveSettingsBundle(patch: SettingsPatch): SettingsBundle {
  const current = getSettingsBundle();
  const next: SettingsBundle = {
    settings: applySteamSettingsPolicy(sanitizeAppSettings(mergeAppSettings(current.settings, patch.settings))),
    model: sanitizeModelSettings(mergeModelSettings(current.model, patch.model)),
    sku: current.sku,
  };

  writeJson(configPath('settings.json'), next.settings);
  writeJson(configPath('model.json'), next.model);
  return next;
}

export function getPersonalizationSettings(): PersonalizationSettings {
  return loadAppSettings().personalization;
}

export function getAppSettings(): AppSettings {
  return loadAppSettings();
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
  return applySteamSettingsPolicy(sanitizeAppSettings(readJson(resolveConfigFile('settings.json'), DEFAULT_SETTINGS)));
}

function loadModelSettings(): ModelSettings {
  return sanitizeModelSettings(readJson(resolveConfigFile('model.json'), DEFAULT_MODEL));
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
  const data = sanitizeData(source.data);
  const privacy = sanitizePrivacy(source.privacy);
  const ui = sanitizeUi(source.ui);
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
    data,
    privacy,
    ui,
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
  };
}

function sanitizeVoice(value: unknown): VoiceSettings {
  const source = isRecord(value) ? value : {};
  return {
    sttEnabled: cleanBoolean(source.sttEnabled, DEFAULT_SETTINGS.voice.sttEnabled),
    ttsEnabled: cleanBoolean(source.ttsEnabled, DEFAULT_SETTINGS.voice.ttsEnabled),
    autoPlayAssistant: cleanBoolean(source.autoPlayAssistant, DEFAULT_SETTINGS.voice.autoPlayAssistant),
    // Window 05 deliberately removes the old implicit online fallback. Legacy
    // auto/speech_recognition/whisper values migrate to the only 1.0 engine.
    sttEngine: cleanEnum(source.sttEngine, STT_ENGINES, DEFAULT_SETTINGS.voice.sttEngine),
    ttsVoice: cleanString(source.ttsVoice, 120, DEFAULT_SETTINGS.voice.ttsVoice),
    silenceAutoStop: cleanBoolean(source.silenceAutoStop, DEFAULT_SETTINGS.voice.silenceAutoStop),
  };
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
      webSearch: cleanBoolean(consent.webSearch, DEFAULT_SETTINGS.privacy.networkConsent.webSearch),
      onlineSpeechToText: cleanBoolean(consent.onlineSpeechToText, DEFAULT_SETTINGS.privacy.networkConsent.onlineSpeechToText),
      onlineTextToSpeech: cleanBoolean(consent.onlineTextToSpeech, DEFAULT_SETTINGS.privacy.networkConsent.onlineTextToSpeech),
      externalToolNetwork: cleanBoolean(consent.externalToolNetwork, DEFAULT_SETTINGS.privacy.networkConsent.externalToolNetwork),
    },
    ...(firstRunPrivacySeenAt ? { firstRunPrivacySeenAt } : {}),
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
  const fallback = isRecord(source.fallback) ? source.fallback : {};
  return {
    provider: cleanString(source.provider, 40, DEFAULT_MODEL.provider),
    ollama: {
      baseUrl: cleanString(ollama.baseUrl, 200, DEFAULT_MODEL.ollama.baseUrl).replace(/\/$/, ''),
      model: cleanString(ollama.model, 120, DEFAULT_MODEL.ollama.model),
      temperature: clampNumber(ollama.temperature, 0, 2, DEFAULT_MODEL.ollama.temperature),
      maxTokens: clampInteger(ollama.maxTokens, 128, 8192, DEFAULT_MODEL.ollama.maxTokens),
      numCtx: clampInteger(ollama.numCtx, 1024, 32768, DEFAULT_MODEL.ollama.numCtx),
    },
    deepseek: sanitizeDeepseek(source.deepseek),
    fallback: {
      enabled: cleanBoolean(fallback.enabled, DEFAULT_MODEL.fallback.enabled),
      timeoutMs: clampInteger(fallback.timeoutMs, 5000, 120000, DEFAULT_MODEL.fallback.timeoutMs),
    },
  };
}

function sanitizeDeepseek(value: unknown): ModelSettings['deepseek'] {
  const source = isRecord(value) ? value : {};
  return {
    apiKey: cleanString(source.apiKey, 500, DEFAULT_MODEL.deepseek.apiKey),
    model: cleanString(source.model, 120, DEFAULT_MODEL.deepseek.model),
    temperature: clampNumber(source.temperature, 0, 2, DEFAULT_MODEL.deepseek.temperature),
    maxTokens: clampInteger(source.maxTokens, 128, 32768, DEFAULT_MODEL.deepseek.maxTokens),
  };
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
