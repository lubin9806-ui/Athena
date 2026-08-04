/** Renderer entry: Su Shixia workspace UI, chat, voice, settings, and Athena IPC wiring. */

import './style.css';
import { ChatPanel, type ChatMessageSnapshot, type ChatSource, type ChatToolExecution } from './ui/ChatPanel';
import { InputBar } from './ui/InputBar';
import { LiveGlass } from './ui/LiveGlass';
import { ThemeController } from './ui/ThemeController';
import { MicrophoneRecorder } from './voice/MicrophoneRecorder';

declare global {
  interface Window {
    athenaAPI: {
      sendMessage: (text: string, mode: AthenaMode, forceWebSearch?: boolean, chatWindowId?: number) => Promise<{
        content: string;
        emotion?: { label: string };
        webSearch?: {
          query: string;
          sources: ChatSource[];
          readPageCount: number;
          searchRounds: number;
          providers: Array<'sogou' | 'bing' | 'duckduckgo' | 'none'>;
          error?: string;
        };
        toolExecutions?: ChatToolExecution[];
      } | null>;
      listProjects: (includeArchived?: boolean) => Promise<AthenaProjectRecord[]>;
      createProject: (title?: string, instructions?: string) => Promise<AthenaProjectRecord | null>;
      updateProject: (id: number, patch: { title?: string; instructions?: string }) => Promise<AthenaProjectRecord | null>;
      listChatWindows: (includeArchived?: boolean, projectId?: number) => Promise<ChatWindowRecord[]>;
      createChatWindow: (title?: string, projectId?: number) => Promise<ChatWindowRecord | null>;
      createTemporaryChatWindow: (projectId?: number) => Promise<ChatWindowRecord | null>;
      activateChatWindow: (id: number) => Promise<ChatWindowRecord | null>;
      renameChatWindow: (id: number, title: string) => Promise<ChatWindowRecord | null>;
      archiveChatWindow: (id: number, archived?: boolean) => Promise<ChatWindowRecord | null>;
      deleteChatWindow: (id: number) => Promise<boolean>;
      getChatWindowMessages: (id: number, limit?: number) => Promise<ChatMessageSnapshot[]>;
      pinChatWindowFact: (id: number, text: string) => Promise<ChatWindowRecord | null>;
      unpinChatWindowFact: (id: number, factId: string) => Promise<ChatWindowRecord | null>;
      getChatWindowContextSnapshots: (id: number, limit?: number) => Promise<ContextSnapshotRecord[]>;
      cancelExecution: () => Promise<boolean>;
      onChatStream: (callback: (data: { content: string; done: boolean }) => void) => () => void;
      onChatError: (callback: (error: string) => void) => () => void;
      onWebSearchStatus: (callback: (status: WebSearchStatus) => void) => () => void;
      onToolStatus: (callback: (status: ToolStatusEvent) => void) => () => void;
      onReminderDue: (callback: (job: { title: string; dueAt: string }) => void) => () => void;
      getSystemInfo: () => Promise<{ modelConnected: boolean; modelProvider: ModelProvider; modelName: string; modelEndpoint: string; ollamaConnected: boolean; hour: number; ollamaModel: string; ollamaEndpoint: string }>;
      getSettings: () => Promise<SettingsBundle>;
      saveSettings: (patch: SettingsPatch) => Promise<SettingsBundle>;
      getModelCredentialStatus: (provider: RemoteModelProvider) => Promise<ModelCredentialStatus | null>;
      setModelCredential: (provider: RemoteModelProvider, apiKey: string) => Promise<ModelCredentialStatus | null>;
      clearModelCredential: (provider: RemoteModelProvider) => Promise<ModelCredentialStatus | null>;
      listModelOptions: () => Promise<{ provider: ModelProvider; models: string[] } | null>;
      testModelConnection: () => Promise<ModelConnectionStatus | null>;
      getOllamaSetupStatus: () => Promise<OllamaSetupStatus | null>;
      openOllamaDownload: () => Promise<boolean>;
      installBundledOllama: () => Promise<{ started: boolean; error?: string }>;
      pullOllamaModel: (model: string) => Promise<{ started: boolean; error?: string }>;
      listMemories: (options: MemoryListOptions) => Promise<MemoryListResult>;
      deleteMemory: (kind: MemoryKind, id: number) => Promise<boolean>;
      updateMemory: (kind: MemoryKind, id: number, patch: MemoryUpdatePatch) => Promise<boolean>;
      debugMemory: (query: string) => Promise<MemoryDebugResult>;
      chooseMemoryImportFile: () => Promise<string | null>;
      previewMemoryImport: (sourcePath: string) => Promise<MemoryImportPreview>;
      commitMemoryImport: (sourcePath: string, candidateIds: number[]) => Promise<MemoryImportCommitResult>;
      getPrivacyCenter: () => Promise<PrivacyCenterState | null>;
      exportPrivacyData: (format?: 'json' | 'markdown') => Promise<{ path: string; bytes: number } | null>;
      clearLocalData: () => Promise<{ deletedTables: string[]; voiceCacheFilesDeleted: number } | null>;
      speakText: (text: string) => Promise<VoiceResult>;
      playAudioFile: (sourcePath: string) => Promise<VoiceResult>;
      chooseAudioFile: () => Promise<string | null>;
      transcribeAudioFile: (sourcePath: string) => Promise<VoiceResult>;
      transcribeRecording: (audioBytes: Uint8Array) => Promise<VoiceResult>;
      requestMicrophoneAccess: () => Promise<boolean>;
      getVoiceCapabilities: () => Promise<VoiceCapabilities | null>;
      minimize: () => void;
      close: () => void;
    };
  }
}

type MemoryKind = 'profile' | 'event' | 'project' | 'message';
type AthenaMode = 'create' | 'companion' | 'reason' | 'execute';
type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
type AppStatusState = 'ready' | 'working' | 'offline' | 'error';
type ToolPermissionLevel = 'off' | 'read' | 'files' | 'full';
type ModelProvider = 'ollama' | 'openai' | 'deepseek' | 'athena-cloud' | 'custom';
type RemoteModelProvider = Exclude<ModelProvider, 'ollama'>;

const MAX_RECORDING_MS = 60_000;
const ATHENA_MODES: readonly AthenaMode[] = ['create', 'companion', 'reason', 'execute'];
const MIN_RECORDING_MS = 350;
const VOICE_ACTIVITY_THRESHOLD = 0.008;
const VOICE_MIN_SIGNAL_LEVEL = 0.001;
const VOICE_SILENCE_STOP_MS = 1_600;

interface MemoryListOptions {
  kind?: MemoryKind | 'all';
  query?: string;
  limit?: number;
}

interface MemoryListItem {
  id: number;
  kind: MemoryKind;
  title: string;
  content: string;
  meta: string;
  importance?: number;
  confidence?: number;
}

interface MemoryListResult {
  items: MemoryListItem[];
  totals: Record<MemoryKind, number>;
}

interface ChatWindowRecord {
  id: number;
  title: string;
  summary: string;
  mode: AthenaMode;
  working_state: string;
  working_state_json?: string;
  project_id?: number;
  projectTitle?: string;
  projectInstructions?: string;
  projectInstructionsSnapshot?: string;
  archived_at?: string;
  deleted_at?: string;
  is_temporary?: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  messageCount?: number;
  lastMessagePreview?: string;
}

interface AthenaProjectRecord {
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

interface ChatWindowPinnedFact {
  id: string;
  text: string;
  createdAt: string;
}

interface ChatWindowWorkingState {
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  lastUserSelection?: string;
  currentGoal?: string;
  goal?: string;
  objective?: string;
  confirmedConclusions?: string[];
  conclusions?: string[];
  todos?: string[];
  pendingTodos?: string[];
  pinnedFacts?: ChatWindowPinnedFact[];
  messageCount?: number;
}

interface ContextSnapshotDebugItem {
  kind: string;
  label: string;
  included: boolean;
  chars: number;
  estimatedTokens: number;
}

interface ContextSnapshotRecord {
  id: number;
  window_id?: number;
  budget: {
    maxPromptTokens?: number;
    estimatedPromptTokens?: number;
    promptChars?: number;
    promptMessageCount?: number;
  };
  included: ContextSnapshotDebugItem[];
  omitted: ContextSnapshotDebugItem[];
  prompt_message_count: number;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  created_at: string;
}

interface MemoryUpdatePatch {
  title?: string;
  content?: string;
  importance?: number;
  confidence?: number;
}

interface MemoryDebugResult {
  query: string;
  keywords: string[];
  relevanceScore: number;
  profileFacts: MemoryListItem[];
  relatedEvents: MemoryListItem[];
  projectNotes: MemoryListItem[];
  recentMessages: MemoryListItem[];
}

interface MemoryImportCandidate {
  id: number;
  content: string;
  status: 'accepted' | 'rejected';
  reason: string;
  importance: number;
}

interface MemoryImportPreview {
  sourcePath: string;
  totalRecords: number;
  assistantMessages: number;
  extractedAddMemories: number;
  accepted: MemoryImportCandidate[];
  rejected: MemoryImportCandidate[];
}

interface MemoryImportCommitResult {
  imported: number;
  skipped: number;
}

interface VoiceResult {
  ok: boolean;
  text?: string;
  audioPath?: string;
  error?: string;
}

interface VoiceCapabilities {
  architecture: 'desktop-local-1.0';
  stt: { mode: 'local'; ready: boolean; reason?: string };
  tts: {
    mode: 'local';
    ready: boolean;
    provider: 'windows-sapi';
    voices: Array<{ name: string; culture: string }>;
    reason?: string;
  };
  runtimeDownloadsAllowed: false;
}

type PersonalizationTone = 'balanced' | 'soft' | 'playful' | 'direct';
type ReplyLength = 'short' | 'balanced' | 'detailed';
type InitiativeLevel = 'low' | 'balanced' | 'high';
type AnimationLevel = 'low' | 'balanced' | 'high';
type ThemeMode = 'day' | 'night' | 'system';
type SttEngine = 'local_whisper';
type WebSearchMode = 'auto' | 'manual';

interface WebSearchStatus {
  phase: 'searching' | 'reading' | 'refining' | 'done' | 'failed';
  query: string;
  resultCount?: number;
  pageCount?: number;
  searchRound?: number;
  provider?: 'sogou' | 'bing' | 'duckduckgo' | 'none';
  message?: string;
}

interface ToolStatusEvent {
  phase: 'planning' | 'confirming' | 'running' | 'completed' | 'failed' | 'cancelled' | 'done';
  message: string;
  toolName?: string;
  toolLabel?: string;
  callId?: string;
}

type ExecutionTaskState = 'planning' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'not-run';

interface ExecutionTimelineEvent extends ToolStatusEvent {
  occurredAt: string;
}

interface ExecutionTask {
  id: string;
  goal: string;
  mode: AthenaMode;
  state: ExecutionTaskState;
  startedAt: string;
  completedAt?: string;
  events: ExecutionTimelineEvent[];
  executions: ChatToolExecution[];
  finalResponse?: string;
}

interface PersonalizationSettings {
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

interface UiSettings {
  startupIntro: boolean;
  compactMode: boolean;
}

interface GeneralSettings {
  launchAtStartup: boolean;
  closeToTray: boolean;
  desktopNotifications: boolean;
  autoConnectModel: boolean;
}

interface AppearanceSettings {
  theme: ThemeMode;
  animationLevel: AnimationLevel;
  glassEffects: boolean;
}

interface ConversationSettings {
  activeMode: AthenaMode;
  enterToSend: boolean;
  streamResponses: boolean;
  showTimestamps: boolean;
  saveHistory: boolean;
}

interface ToolModePermissions {
  create: ToolPermissionLevel;
  companion: ToolPermissionLevel;
  reason: ToolPermissionLevel;
  execute: ToolPermissionLevel;
}

interface ToolSettings {
  permissionLevel: ToolPermissionLevel;
  modePermissions: ToolModePermissions;
  maxToolRounds: number;
  commandTimeoutSeconds: number;
}

interface WebSearchSettings {
  enabled: boolean;
  mode: WebSearchMode;
  maxResults: number;
  deepRead: boolean;
  secondarySearch: boolean;
  maxPages: number;
}

interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  retrieveProfile: boolean;
  retrieveEvents: boolean;
  retrieveProjects: boolean;
  retrievalDepth: number;
  minImportanceForAutoExtract: number;
}

interface VoiceSettings {
  sttEnabled: boolean;
  ttsEnabled: boolean;
  autoPlayAssistant: boolean;
  sttEngine: SttEngine;
  ttsVoice: string;
  silenceAutoStop: boolean;
}

interface DataSettings {
  confirmBeforeDelete: boolean;
  historyRetentionDays: number;
  voiceCacheRetentionHours: number;
  exportFormat: 'json' | 'markdown';
}

interface NetworkConsentSettings {
  remoteModel: boolean;
  webSearch: boolean;
  onlineSpeechToText: boolean;
  onlineTextToSpeech: boolean;
  externalToolNetwork: boolean;
}

interface PrivacySettings {
  networkConsent: NetworkConsentSettings;
  firstRunPrivacySeenAt?: string;
}

interface AppSettings {
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

interface ModelSettings {
  provider: ModelProvider;
  setupComplete: boolean;
  ollama: {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    numCtx: number;
  };
  remote: Record<RemoteModelProvider, {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    numCtx: number;
  }>;
  fallback: {
    enabled: boolean;
    timeoutMs: number;
  };
}

interface SettingsBundle {
  settings: AppSettings;
  model: ModelSettings;
  sku: 'desktop-direct' | 'steam' | 'microsoft-store';
}

interface SettingsPatch {
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
  model?: Omit<Partial<ModelSettings>, 'ollama' | 'remote' | 'fallback'> & {
    ollama?: Partial<ModelSettings['ollama']>;
    remote?: Partial<Record<RemoteModelProvider, Partial<ModelSettings['remote'][RemoteModelProvider]>>>;
    fallback?: Partial<ModelSettings['fallback']>;
  };
}

interface ModelCredentialStatus {
  provider: RemoteModelProvider;
  configured: boolean;
  source: 'environment' | 'windows-safe-storage' | 'none';
  encryptionAvailable: boolean;
}

interface ModelConnectionStatus {
  connected: boolean;
  provider: ModelProvider;
  model: string;
  endpoint: string;
}

interface OllamaSetupStatus {
  installed: boolean;
  bundledInstallerAvailable: boolean;
  executablePath: string;
}

interface DataMapItem {
  id: string;
  label: string;
  stored: string;
  locations: string[];
  leavesDevice: string;
  retention: string;
  controls: string[];
}

interface NetworkCapabilityNotice {
  id: keyof NetworkConsentSettings;
  label: string;
  sends: string;
  destinations: string;
  consented: boolean;
}

interface StaticProtectionDecision {
  status: string;
  claim: string;
  threatAssessment: string[];
  decision: string;
  verification: string[];
}

interface PrivacyCenterState {
  generatedAt: string;
  dataMap: DataMapItem[];
  networkCapabilities: NetworkCapabilityNotice[];
  staticProtection: StaticProtectionDecision;
  stats: unknown;
  paths: Record<string, string>;
}

const appShell = mustGet<HTMLElement>('app-shell');
const themeController = new ThemeController(document.documentElement, appShell);
const titlebar = mustGet<HTMLElement>('titlebar');
const modeSwitch = mustGet<HTMLElement>('mode-switch');
const modeExecuteButton = mustGet<HTMLButtonElement>('mode-execute-button');
const projectSelect = mustGet<HTMLSelectElement>('project-select');
const projectNew = mustGet<HTMLButtonElement>('project-new');
const projectInstructions = mustGet<HTMLButtonElement>('project-instructions');
const chatWindowSelect = mustGet<HTMLSelectElement>('chat-window-select');
const chatWindowNew = mustGet<HTMLButtonElement>('chat-window-new');
const chatWindowTemporary = mustGet<HTMLButtonElement>('chat-window-temporary');
const chatWindowRename = mustGet<HTMLButtonElement>('chat-window-rename');
const chatWindowArchive = mustGet<HTMLButtonElement>('chat-window-archive');
const chatWindowDelete = mustGet<HTMLButtonElement>('chat-window-delete');
const temporaryChatBadge = mustGet<HTMLElement>('temporary-chat-badge');
const stage = mustGet<HTMLElement>('stage');
const chatPanel = new ChatPanel(mustGet<HTMLElement>('chat-container'));
const inputForm = mustGet<HTMLFormElement>('input-form');
const inputBox = mustGet<HTMLTextAreaElement>('input-box');
const inputBar = new InputBar(
  inputForm,
  inputBox,
  mustGet<HTMLButtonElement>('send-btn'),
);

const statusDot = mustGet<HTMLElement>('status-dot');
const statusText = mustGet<HTMLElement>('status-text');
const btnSettings = mustGet<HTMLButtonElement>('btn-settings');
const btnMemory = mustGet<HTMLButtonElement>('btn-memory');
const btnMinimize = mustGet<HTMLButtonElement>('btn-minimize');
const btnClose = mustGet<HTMLButtonElement>('btn-close');
const voiceSttBtn = mustGet<HTMLButtonElement>('voice-stt-btn');
const voiceSttLabel = mustGet<HTMLElement>('voice-stt-label');
const voiceFileBtn = mustGet<HTMLButtonElement>('voice-file-btn');
const voiceTtsBtn = mustGet<HTMLButtonElement>('voice-tts-btn');
const voiceFeedback = mustGet<HTMLElement>('voice-feedback');
const composerMoreBtn = mustGet<HTMLButtonElement>('composer-more-btn');
const composerSecondaryTools = mustGet<HTMLElement>('composer-secondary-tools');
const webSearchBtn = mustGet<HTMLButtonElement>('web-search-btn');
const webSearchLabel = mustGet<HTMLElement>('web-search-label');
const modeHint = mustGet<HTMLElement>('mode-hint');
const toolAccessHint = mustGet<HTMLElement>('tool-access-hint');
const panelScrim = mustGet<HTMLElement>('panel-scrim');
const executionPanel = mustGet<HTMLElement>('execution-panel');
const executionCurrentCard = mustGet<HTMLElement>('execution-current-card');
const executionStateLabel = mustGet<HTMLElement>('execution-state-label');
const executionCurrentGoal = mustGet<HTMLElement>('execution-current-goal');
const executionCurrentMeta = mustGet<HTMLElement>('execution-current-meta');
const executionCurrentResult = mustGet<HTMLElement>('execution-current-result');
const executionLiveLog = mustGet<HTMLOListElement>('execution-live-log');
const executionHistory = mustGet<HTMLElement>('execution-history');
const executionStop = mustGet<HTMLButtonElement>('execution-stop');
const executionClear = mustGet<HTMLButtonElement>('execution-clear');
const executionSettingsForm = mustGet<HTMLFormElement>('execution-settings-form');
const executionSettingsFeedback = mustGet<HTMLElement>('execution-settings-feedback');
const executionCurrentPermission = mustGet<HTMLElement>('execution-current-permission');
const settingsOpenExecution = mustGet<HTMLButtonElement>('settings-open-execution');
const memoryPanel = mustGet<HTMLElement>('memory-panel');
const btnMemoryClose = mustGet<HTMLButtonElement>('btn-memory-close');
const memoryTabs = mustGet<HTMLElement>('memory-tabs');
const memoryKind = mustGet<HTMLSelectElement>('memory-kind');
const memorySearch = mustGet<HTMLInputElement>('memory-search');
const memoryTotalRow = mustGet<HTMLElement>('memory-total-row');
const memoryList = mustGet<HTMLElement>('memory-list');
const memoryDebugForm = mustGet<HTMLFormElement>('memory-debug-form');
const memoryDebugQuery = mustGet<HTMLInputElement>('memory-debug-query');
const memoryDebugSummary = mustGet<HTMLElement>('memory-debug-summary');
const memoryDebugList = mustGet<HTMLElement>('memory-debug-list');
const memoryImportPath = mustGet<HTMLInputElement>('memory-import-path');
const memoryImportBrowse = mustGet<HTMLButtonElement>('memory-import-browse');
const memoryImportPreview = mustGet<HTMLButtonElement>('memory-import-preview');
const memoryImportCommit = mustGet<HTMLButtonElement>('memory-import-commit');
const memoryImportSummary = mustGet<HTMLElement>('memory-import-summary');
const memoryImportList = mustGet<HTMLElement>('memory-import-list');
const windowContextTitle = mustGet<HTMLElement>('window-context-title');
const windowContextMeta = mustGet<HTMLElement>('window-context-meta');
const windowPinForm = mustGet<HTMLFormElement>('window-pin-form');
const windowPinInput = mustGet<HTMLInputElement>('window-pin-input');
const windowContextGoal = mustGet<HTMLElement>('window-context-goal');
const windowContextConclusions = mustGet<HTMLUListElement>('window-context-conclusions');
const windowContextTodos = mustGet<HTMLUListElement>('window-context-todos');
const windowPinnedFacts = mustGet<HTMLElement>('window-pinned-facts');
const windowContextSummary = mustGet<HTMLElement>('window-context-summary');
const windowContextBudget = mustGet<HTMLElement>('window-context-budget');
const settingsPanel = mustGet<HTMLElement>('settings-panel');
const btnSettingsClose = mustGet<HTMLButtonElement>('btn-settings-close');
const settingsForm = mustGet<HTMLFormElement>('settings-form');
const settingLaunchStartup = mustGet<HTMLInputElement>('setting-launch-startup');
const settingCloseTray = mustGet<HTMLInputElement>('setting-close-tray');
const settingNotifications = mustGet<HTMLInputElement>('setting-notifications');
const settingAutoConnectModel = mustGet<HTMLInputElement>('setting-auto-connect-model');
const settingUserName = mustGet<HTMLInputElement>('setting-user-name');
const settingPreferredAddress = mustGet<HTMLInputElement>('setting-preferred-address');
const settingTone = mustGet<HTMLSelectElement>('setting-tone');
const settingReplyLength = mustGet<HTMLSelectElement>('setting-reply-length');
const settingInitiative = mustGet<HTMLSelectElement>('setting-initiative');
const settingProactiveCare = mustGet<HTMLInputElement>('setting-proactive-care');
const settingMemorySmalltalk = mustGet<HTMLInputElement>('setting-memory-smalltalk');
const settingCreatorHints = mustGet<HTMLInputElement>('setting-creator-hints');
const settingCustomNotes = mustGet<HTMLTextAreaElement>('setting-custom-notes');
const settingEnterSend = mustGet<HTMLInputElement>('setting-enter-send');
const settingStreamResponses = mustGet<HTMLInputElement>('setting-stream-responses');
const settingShowTimestamps = mustGet<HTMLInputElement>('setting-show-timestamps');
const settingSaveHistory = mustGet<HTMLInputElement>('setting-save-history');
const settingToolPermissionExecute = mustGet<HTMLSelectElement>('setting-tool-permission-execute');
const settingToolMaxRounds = mustGet<HTMLInputElement>('setting-tool-max-rounds');
const settingToolCommandTimeout = mustGet<HTMLInputElement>('setting-tool-command-timeout');
const settingWebSearchEnabled = mustGet<HTMLInputElement>('setting-web-search-enabled');
const settingWebSearchMode = mustGet<HTMLSelectElement>('setting-web-search-mode');
const settingWebSearchMaxResults = mustGet<HTMLInputElement>('setting-web-search-max-results');
const settingWebSearchDeepRead = mustGet<HTMLInputElement>('setting-web-search-deep-read');
const settingWebSearchSecondary = mustGet<HTMLInputElement>('setting-web-search-secondary');
const settingWebSearchMaxPages = mustGet<HTMLInputElement>('setting-web-search-max-pages');
const settingStartupIntro = mustGet<HTMLInputElement>('setting-startup-intro');
const settingCompactMode = mustGet<HTMLInputElement>('setting-compact-mode');
const settingGlassEffects = mustGet<HTMLInputElement>('setting-glass-effects');
const settingAnimationLevel = mustGet<HTMLSelectElement>('setting-animation-level');
const settingTheme = mustGet<HTMLSelectElement>('setting-theme');
const modelSettingsSection = mustGet<HTMLDetailsElement>('model-settings-section');
const modelFirstRunChoice = mustGet<HTMLElement>('model-first-run-choice');
const settingModelProvider = mustGet<HTMLSelectElement>('setting-model-provider');
const modelOllamaFields = mustGet<HTMLElement>('model-ollama-fields');
const modelRemoteFields = mustGet<HTMLElement>('model-remote-fields');
const settingOllamaUrl = mustGet<HTMLInputElement>('setting-ollama-url');
const settingOllamaModel = mustGet<HTMLInputElement>('setting-ollama-model');
const settingRemoteUrl = mustGet<HTMLInputElement>('setting-remote-url');
const settingRemoteModel = mustGet<HTMLInputElement>('setting-remote-model');
const remoteModelOptions = mustGet<HTMLDataListElement>('remote-model-options');
const settingModelApiKey = mustGet<HTMLInputElement>('setting-model-api-key');
const settingConsentRemoteModel = mustGet<HTMLInputElement>('setting-consent-remote-model');
const modelSaveApiKey = mustGet<HTMLButtonElement>('model-save-api-key');
const modelLoadOptions = mustGet<HTMLButtonElement>('model-load-options');
const modelClearApiKey = mustGet<HTMLButtonElement>('model-clear-api-key');
const modelCredentialStatus = mustGet<HTMLElement>('model-credential-status');
const modelTestConnection = mustGet<HTMLButtonElement>('model-test-connection');
const modelConnectionStatus = mustGet<HTMLElement>('model-connection-status');
const modelInstallOllama = mustGet<HTMLButtonElement>('model-install-ollama');
const modelPullOllama = mustGet<HTMLButtonElement>('model-pull-ollama');
const settingTemperature = mustGet<HTMLInputElement>('setting-temperature');
const settingMaxTokens = mustGet<HTMLInputElement>('setting-max-tokens');
const settingNumCtx = mustGet<HTMLInputElement>('setting-num-ctx');
const settingMemoryEnabled = mustGet<HTMLInputElement>('setting-memory-enabled');
const settingMemoryAutoExtract = mustGet<HTMLInputElement>('setting-memory-auto-extract');
const settingMemoryProfile = mustGet<HTMLInputElement>('setting-memory-profile');
const settingMemoryEvents = mustGet<HTMLInputElement>('setting-memory-events');
const settingMemoryProjects = mustGet<HTMLInputElement>('setting-memory-projects');
const settingMemoryDepth = mustGet<HTMLInputElement>('setting-memory-depth');
const settingMemoryMinImportance = mustGet<HTMLInputElement>('setting-memory-min-importance');
const settingSttEnabled = mustGet<HTMLInputElement>('setting-stt-enabled');
const settingTtsEnabled = mustGet<HTMLInputElement>('setting-tts-enabled');
const settingAutoPlayAssistant = mustGet<HTMLInputElement>('setting-auto-play-assistant');
const settingSilenceAutoStop = mustGet<HTMLInputElement>('setting-silence-auto-stop');
const settingTtsVoice = mustGet<HTMLInputElement>('setting-tts-voice');
const settingTtsVoiceOptions = mustGet<HTMLDataListElement>('setting-tts-voice-options');
const voiceCapabilityStatus = mustGet<HTMLElement>('voice-capability-status');
const voiceCapabilityRefresh = mustGet<HTMLButtonElement>('voice-capability-refresh');
const settingConfirmDelete = mustGet<HTMLInputElement>('setting-confirm-delete');
const settingHistoryRetention = mustGet<HTMLInputElement>('setting-history-retention');
const settingVoiceCacheRetention = mustGet<HTMLInputElement>('setting-voice-cache-retention');
const settingExportFormat = mustGet<HTMLSelectElement>('setting-export-format');
const settingConsentWebSearch = mustGet<HTMLInputElement>('setting-consent-web-search');
const settingConsentExternalToolNetwork = mustGet<HTMLInputElement>('setting-consent-external-tool-network');
const privacyDataMap = mustGet<HTMLElement>('privacy-data-map');
const privacyStaticDecision = mustGet<HTMLElement>('privacy-static-decision');
const privacyExport = mustGet<HTMLButtonElement>('privacy-export');
const privacyClear = mustGet<HTMLButtonElement>('privacy-clear');
const settingsFeedback = mustGet<HTMLElement>('settings-feedback');

const liveGlass = new LiveGlass([titlebar, modeSwitch, inputForm]);

const TEMPORARY_CHAT_LABEL = '临时聊天';
const TEMPORARY_CHAT_BADGE = '临时聊天：只在本窗口保留，关闭后清除';
const TEMPORARY_CHAT_META = '临时聊天：不写入长期记忆';

let isStreaming = false;
let currentContent = '';
let currentImportPreview: MemoryImportPreview | null = null;
let currentSettingsBundle: SettingsBundle | null = null;
let currentMode: AthenaMode = 'companion';
let projects: AthenaProjectRecord[] = [];
let currentProjectId: number | null = null;
let chatWindows: ChatWindowRecord[] = [];
let currentChatWindowId: number | null = null;
let currentChatWindowMessages: ChatMessageSnapshot[] = [];
let activeRequestMode: AthenaMode | null = null;
let pendingExecutionGoal = '';
let pendingExecutionMode: AthenaMode = 'companion';
let currentExecutionTask: ExecutionTask | null = null;
let executionTasks: ExecutionTask[] = [];
let executionTaskSequence = 0;
let currentAudio: HTMLAudioElement | null = null;
let voiceInputState: VoiceInputState = 'idle';
let voiceFeedbackTimer: number | undefined;
let voiceErrorResetTimer: number | undefined;
let recordingDeadlineTimer: number | undefined;
let recordingTicker: number | undefined;
let recordingStartedAt = 0;
let recordingPeakLevel = 0;
let recordingLastSpeechAt = 0;
let recordingSpeechFrames = 0;
let recordingSpeechDetected = false;
let currentMicrophoneLabel = '默认麦克风';
let voiceOperationId = 0;
let autoStopRequested = false;
let isVoiceOutputBusy = false;
let modelConnected: boolean | null = null;
let currentVoiceCapabilities: VoiceCapabilities | null = null;
let forceWebSearchForNextMessage = false;

const microphoneRecorder = new MicrophoneRecorder({
  onVolume: updateMicrophoneMeter,
  onError: handleMicrophoneRecorderError,
});

function setStatus(text: string, state: AppStatusState): void {
  statusText.textContent = text;
  statusDot.dataset.state = state;
  appShell.dataset.state = state === 'working' ? 'thinking' : 'idle';
}

function setMode(mode: AthenaMode): void {
  currentMode = mode;
  appShell.dataset.mode = mode;
  chatPanel.setActiveMode(mode);
  stage.setAttribute('aria-hidden', String(mode === 'execute'));
  executionPanel.setAttribute('aria-hidden', String(mode !== 'execute'));
  modeHint.textContent = modeHintText(mode);
  inputBox.placeholder = modePlaceholder(mode);
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  syncToolAccessHint();
}

function setModeSwitchDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((button) => {
    button.disabled = disabled;
  });
}

function handleModeSwitchKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();

  const currentIndex = Math.max(0, ATHENA_MODES.indexOf(currentMode));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? ATHENA_MODES.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + ATHENA_MODES.length) % ATHENA_MODES.length;
  const nextMode = ATHENA_MODES[nextIndex];
  const nextButton = modeSwitch.querySelector<HTMLButtonElement>(`.mode-btn[data-mode="${nextMode}"]`);
  nextButton?.focus({ preventScroll: true });
  void selectMode(nextMode);
}

async function selectMode(mode: AthenaMode): Promise<void> {
  if (mode === currentMode || isStreaming) return;
  setMode(mode);
  toggleComposerTools(false);
  if (currentSettingsBundle) {
    currentSettingsBundle.settings.conversation.activeMode = mode;
  }

  try {
    const bundle = await window.athenaAPI.saveSettings({
      settings: { conversation: { activeMode: mode } },
    });
    if (currentMode === mode) currentSettingsBundle = bundle;
  } catch (error) {
    console.error('Failed to persist conversation mode', error);
  }
}

function startStartupIntro(): void {
  appShell.dataset.intro = 'starting';
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      appShell.dataset.intro = 'entered';
    });
  });
  window.setTimeout(() => {
    appShell.dataset.intro = 'entered';
    inputBar.focus();
  }, 180);
}

function skipStartupIntro(): void {
  appShell.dataset.intro = 'entered';
}

async function sendMessage(text: string): Promise<void> {
  if (!text || isStreaming || isVoiceInputBusy()) return;
  if (!currentChatWindowId) await initializeChatWindows();

  const forceWebSearch = forceWebSearchForNextMessage;
  const requestMode = currentMode;
  forceWebSearchForNextMessage = false;
  toggleComposerTools(false);
  resizeInputBox();
  activeRequestMode = requestMode;
  if (requestMode === 'execute') beginExecutionRequest(text);
  else chatPanel.addMessage(text, 'user');
  setStatus(modeThinkingText(requestMode), 'working');
  isStreaming = true;
  renderChatWindowPicker();
  setModeSwitchDisabled(true);
  inputBar.setDisabled(true);
  syncVoiceControls();
  syncWebSearchControl();
  currentContent = '';
  pendingExecutionGoal = text;
  pendingExecutionMode = requestMode;

  try {
    const response = await window.athenaAPI.sendMessage(text, requestMode, forceWebSearch, currentChatWindowId ?? undefined);
    if (response) modelConnected = true;
    if (requestMode === 'execute') {
      finishExecutionTask(response?.toolExecutions ?? [], response?.content || currentContent);
    } else {
      if (!currentContent && response?.content) {
        chatPanel.addMessage(response.content, 'assistant', response.emotion?.label);
      } else if (response?.emotion?.label) {
        chatPanel.setLastAssistantEmotion(response.emotion.label);
      }
      if (response?.webSearch?.sources?.length) {
        chatPanel.setLastAssistantSources(response.webSearch.sources, {
          readPageCount: response.webSearch.readPageCount,
          searchRounds: response.webSearch.searchRounds,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    if (requestMode === 'execute') failActiveExecutionTask(message);
    else chatPanel.addMessage(`出错了：${message}`, 'assistant', '需要检查');
  } finally {
    pendingExecutionGoal = '';
    activeRequestMode = null;
    isStreaming = false;
    setModeSwitchDisabled(false);
    inputBar.setDisabled(false);
    syncVoiceControls();
    syncWebSearchControl();
    inputBar.focus();
    restoreIdleStatus();
    if (requestMode !== 'execute' && currentSettingsBundle?.settings.voice.autoPlayAssistant) {
      void speakLastAssistantMessage();
    }
    await refreshChatWindows();
    await refreshWindowMemoryPanel();
  }
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return;

  const enterToSend = currentSettingsBundle?.settings.conversation.enterToSend ?? true;
  if (enterToSend && !event.shiftKey) {
    event.preventDefault();
    inputForm.requestSubmit();
    return;
  }

  if (!enterToSend && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    inputForm.requestSubmit();
  }
}

function init(): void {
  themeController.apply('system');
  setMode('companion');
  renderExecutionCenter();
  inputForm.dataset.voiceState = 'idle';
  voiceFeedback.dataset.visible = 'false';
  void initializeSettings();
  inputBar.onSubmit(sendMessage);
  projectSelect.addEventListener('change', () => {
    const id = Number(projectSelect.value);
    if (Number.isInteger(id) && id > 0) void switchProject(id);
  });
  projectNew.addEventListener('click', () => void createNewProject());
  projectInstructions.addEventListener('click', () => void editCurrentProjectInstructions());
  chatWindowSelect.addEventListener('change', () => {
    const id = Number(chatWindowSelect.value);
    if (Number.isInteger(id) && id > 0) void switchChatWindow(id);
  });
  chatWindowNew.addEventListener('click', () => void createNewChatWindow());
  chatWindowTemporary.addEventListener('click', () => void createTemporaryChatWindow());
  chatWindowRename.addEventListener('click', () => void renameCurrentChatWindow());
  chatWindowArchive.addEventListener('click', () => void archiveCurrentChatWindow());
  chatWindowDelete.addEventListener('click', () => void deleteCurrentChatWindow());

  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.mode as AthenaMode | undefined;
      if (nextMode) void selectMode(nextMode);
    });
  });
  modeSwitch.addEventListener('keydown', handleModeSwitchKeydown);

  executionStop.addEventListener('click', cancelActiveExecution);
  executionClear.addEventListener('click', clearExecutionHistory);
  executionSettingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveExecutionSettings();
  });
  settingsOpenExecution.addEventListener('click', () => {
    void toggleSettingsPanel(false);
    void selectMode('execute');
  });
  btnSettings.addEventListener('click', () => toggleSettingsPanel());
  btnSettingsClose.addEventListener('click', () => toggleSettingsPanel(false));
  panelScrim.addEventListener('click', () => {
    void toggleMemoryPanel(false);
    void toggleSettingsPanel(false);
  });
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsForm();
  });
  settingModelProvider.addEventListener('change', () => {
    populateSelectedModelProvider();
    void refreshModelCredentialStatus();
  });
  modelFirstRunChoice.querySelectorAll<HTMLButtonElement>('[data-model-path]').forEach(button => {
    button.addEventListener('click', () => {
      const path = button.dataset.modelPath;
      settingModelProvider.value = path === 'local' ? 'ollama' : 'choose-api';
      populateSelectedModelProvider();
      void refreshModelCredentialStatus();
      if (path === 'local') settingOllamaModel.focus();
      else settingModelProvider.focus();
    });
  });
  modelSaveApiKey.addEventListener('click', () => void saveModelCredential());
  modelLoadOptions.addEventListener('click', () => void loadAvailableModels());
  modelClearApiKey.addEventListener('click', () => void clearModelCredential());
  modelTestConnection.addEventListener('click', () => void testModelConnection());
  modelInstallOllama.addEventListener('click', () => void beginOllamaInstall());
  modelPullOllama.addEventListener('click', () => void beginOllamaModelPull());
  privacyExport.addEventListener('click', () => {
    void exportPrivacyData();
  });
  privacyClear.addEventListener('click', () => {
    void clearLocalData();
  });
  inputBox.addEventListener('keydown', handleInputKeydown);
  inputBox.addEventListener('input', resizeInputBox);
  composerMoreBtn.addEventListener('click', () => toggleComposerTools());
  webSearchBtn.addEventListener('click', () => {
    if (webSearchBtn.disabled) return;
    forceWebSearchForNextMessage = !forceWebSearchForNextMessage;
    syncWebSearchControl();
    toggleComposerTools(false);
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (
      composerSecondaryTools.dataset.open === 'true'
      && target instanceof Node
      && !composerSecondaryTools.contains(target)
      && !composerMoreBtn.contains(target)
    ) {
      toggleComposerTools(false);
    }
  });
  btnMemory.addEventListener('click', () => toggleMemoryPanel());
  btnMemoryClose.addEventListener('click', () => toggleMemoryPanel(false));
  windowPinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void pinCurrentWindowFact();
  });
  memoryKind.addEventListener('change', () => loadMemoryList());
  memorySearch.addEventListener('input', debounce(() => loadMemoryList(), 180));
  memoryDebugForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runMemoryDebug();
  });
  memoryImportBrowse.addEventListener('click', chooseImportFile);
  memoryImportPreview.addEventListener('click', previewMemoryImport);
  memoryImportCommit.addEventListener('click', commitMemoryImport);
  document.querySelectorAll<HTMLButtonElement>('.memory-tab').forEach((tab) => {
    tab.addEventListener('click', () => void selectMemoryTab(tab.dataset.tab || 'window'));
  });
  btnMinimize.addEventListener('click', () => window.athenaAPI.minimize());
  btnClose.addEventListener('click', () => window.athenaAPI.close());
  voiceSttBtn.addEventListener('click', toggleMicrophoneRecording);
  voiceFileBtn.addEventListener('click', () => {
    toggleComposerTools(false);
    void transcribeAudioFile();
  });
  voiceTtsBtn.addEventListener('click', () => {
    toggleComposerTools(false);
    void speakLastAssistantMessage();
  });
  voiceCapabilityRefresh.addEventListener('click', () => void refreshVoiceCapabilities());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (voiceInputState === 'recording' || voiceInputState === 'requesting')) {
      event.preventDefault();
      void cancelMicrophoneRecording();
      return;
    }
    if (event.key === 'Escape' && (memoryPanel.dataset.open === 'true' || settingsPanel.dataset.open === 'true')) {
      event.preventDefault();
      void toggleMemoryPanel(false);
      void toggleSettingsPanel(false);
      return;
    }
    if (event.key === 'Escape' && composerSecondaryTools.dataset.open === 'true') {
      event.preventDefault();
      toggleComposerTools(false);
    }
  });
  window.addEventListener('beforeunload', () => {
    voiceOperationId += 1;
    clearRecordingTimers();
    void microphoneRecorder.cancel();
    currentAudio?.pause();
    liveGlass.dispose();
    themeController.dispose();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (voiceInputState === 'recording' || voiceInputState === 'requesting')) {
      void cancelMicrophoneRecording();
    }
  });

  window.athenaAPI.onChatStream((data) => {
    if (data.done) {
      if (activeRequestMode !== 'execute') chatPanel.finalizeStreaming();
      return;
    }

    currentContent += data.content;
    if (activeRequestMode === 'execute') {
      if (currentExecutionTask) currentExecutionTask.finalResponse = currentContent;
      executionCurrentResult.textContent = currentContent;
      executionCurrentResult.dataset.visible = 'true';
    } else {
      chatPanel.updateStreamingMessage(currentContent);
    }
  });

  window.athenaAPI.onChatError((error) => {
    modelConnected = false;
    isStreaming = false;
    inputBar.setDisabled(false);
    syncVoiceControls();
    setStatus('模型离线', 'offline');
    if (activeRequestMode === 'execute') failActiveExecutionTask(error);
    else chatPanel.addMessage(`我暂时连不上本地模型：${error}`, 'assistant', '离线');
  });

  window.athenaAPI.onWebSearchStatus((status) => {
    if (status.phase === 'searching') {
      setStatus('正在搜索网页', 'working');
      return;
    }
    if (status.phase === 'done') {
      const readLabel = status.pageCount ? `，深读 ${status.pageCount} 页` : '';
      setStatus(`${webSearchProviderLabel(status.provider)}找到 ${status.resultCount ?? 0} 个来源${readLabel}，正在整理`, 'working');
      return;
    }
    if (status.phase === 'reading') {
      setStatus(`正在逐页深读 ${status.pageCount ?? 0} 个网页`, 'working');
      return;
    }
    if (status.phase === 'refining') {
      setStatus(`正在进行第 ${status.searchRound ?? 2} 轮搜索`, 'working');
      return;
    }
    setStatus('联网搜索未取得结果，正在继续', 'working');
  });

  window.athenaAPI.onToolStatus((status) => {
    handleExecutionStatus(status);
    if (status.phase === 'planning') {
      setStatus('正在规划电脑操作', 'working');
      return;
    }
    if (status.phase === 'confirming') {
      setStatus('等待你确认高风险操作', 'working');
      return;
    }
    if (status.phase === 'running') {
      setStatus(status.toolLabel ? `正在${status.toolLabel}` : status.message, 'working');
      return;
    }
    if (status.phase === 'completed') {
      setStatus(`${status.message}，正在继续`, 'working');
      return;
    }
    if (status.phase === 'failed') {
      setStatus('有一项电脑操作未完成，正在整理结果', 'working');
      return;
    }
    if (status.phase === 'cancelled') {
      setStatus('电脑操作已停止', 'ready');
      return;
    }
    setStatus('电脑操作完成，正在整理回复', 'working');
  });

  window.athenaAPI.onReminderDue((job) => {
    chatPanel.addMessage(`提醒时间到了：${job.title}`, 'assistant', '提醒');
    setStatus('提醒', 'ready');
  });

  inputBar.focus();
  resizeInputBox();
}

function webSearchProviderLabel(provider?: WebSearchStatus['provider']): string {
  if (provider === 'sogou') return '搜狗 · ';
  if (provider === 'bing') return '必应 · ';
  if (provider === 'duckduckgo') return 'DuckDuckGo · ';
  return '';
}

function beginExecutionRequest(goal: string): void {
  executionTaskSequence += 1;
  const now = new Date().toISOString();
  currentExecutionTask = {
    id: `execution-${Date.now().toString(36)}-${executionTaskSequence.toString(36)}`,
    goal,
    mode: 'execute',
    state: 'planning',
    startedAt: now,
    events: [{ phase: 'planning', message: '已收到目标，正在准备工具规划', occurredAt: now }],
    executions: [],
  };
  renderExecutionCenter();
}

function handleExecutionStatus(status: ToolStatusEvent): void {
  const task = ensureExecutionTask();
  task.events.push({ ...status, occurredAt: new Date().toISOString() });

  if (status.phase === 'planning') task.state = 'planning';
  else if (status.phase === 'cancelled') {
    task.state = 'cancelled';
    task.completedAt = new Date().toISOString();
  } else if (status.phase === 'done') {
    if (task.state !== 'cancelled') task.state = 'running';
  } else {
    task.state = 'running';
  }

  modeExecuteButton.dataset.active = String(isExecutionTaskActive(task));
  renderExecutionCenter();
}

function ensureExecutionTask(): ExecutionTask {
  if (currentExecutionTask && isExecutionTaskActive(currentExecutionTask)) return currentExecutionTask;
  executionTaskSequence += 1;
  currentExecutionTask = {
    id: `execution-${Date.now().toString(36)}-${executionTaskSequence.toString(36)}`,
    goal: pendingExecutionGoal || '未命名电脑任务',
    mode: pendingExecutionMode,
    state: 'planning',
    startedAt: new Date().toISOString(),
    events: [],
    executions: [],
  };
  return currentExecutionTask;
}

function finishExecutionTask(executions: ChatToolExecution[], finalResponse = ''): void {
  if (!currentExecutionTask && executions.length === 0) return;
  const task = currentExecutionTask ?? ensureExecutionTask();
  task.executions = executions.map(item => ({ ...item }));
  task.finalResponse = finalResponse.trim() || task.finalResponse;
  if (task.state !== 'cancelled' && task.state !== 'failed') {
    task.state = executions.some(item => item.status !== 'completed')
      ? 'failed'
      : executions.length > 0
        ? 'completed'
        : 'not-run';
  }
  task.completedAt = task.completedAt ?? new Date().toISOString();
  rememberExecutionTask(task);
  modeExecuteButton.dataset.active = 'false';
  modeExecuteButton.dataset.hasRecords = 'true';
  renderExecutionCenter();
}

function failActiveExecutionTask(message: string): void {
  const task = currentExecutionTask;
  if (!task || !isExecutionTaskActive(task)) return;
  task.state = 'failed';
  task.finalResponse = `执行失败：${message}`;
  task.completedAt = new Date().toISOString();
  task.events.push({ phase: 'failed', message, occurredAt: task.completedAt });
  rememberExecutionTask(task);
  modeExecuteButton.dataset.active = 'false';
  modeExecuteButton.dataset.hasRecords = 'true';
  renderExecutionCenter();
}

function rememberExecutionTask(task: ExecutionTask): void {
  executionTasks = [
    {
      ...task,
      events: task.events.map(item => ({ ...item })),
      executions: task.executions.map(item => ({ ...item })),
    },
    ...executionTasks.filter(item => item.id !== task.id),
  ].slice(0, 20);
}

function clearExecutionHistory(): void {
  executionTasks = [];
  if (!currentExecutionTask || !isExecutionTaskActive(currentExecutionTask)) currentExecutionTask = null;
  modeExecuteButton.dataset.hasRecords = 'false';
  renderExecutionCenter();
}

async function cancelActiveExecution(): Promise<void> {
  const task = currentExecutionTask;
  if (!task || !isExecutionTaskActive(task) || task.state === 'stopping') return;
  const previousState = task.state;
  task.state = 'stopping';
  task.events.push({ phase: 'running', message: '正在请求停止后续步骤', occurredAt: new Date().toISOString() });
  renderExecutionCenter();
  try {
    const accepted = await window.athenaAPI.cancelExecution();
    if (accepted) return;
    task.state = previousState;
    task.events.push({ phase: 'failed', message: '当前没有可停止的执行任务', occurredAt: new Date().toISOString() });
  } catch (error) {
    task.state = previousState;
    task.events.push({
      phase: 'failed',
      message: `停止请求失败：${error instanceof Error ? error.message : String(error)}`,
      occurredAt: new Date().toISOString(),
    });
  }
  renderExecutionCenter();
}

function renderExecutionCenter(): void {
  const task = currentExecutionTask;
  const active = Boolean(task && isExecutionTaskActive(task));
  modeExecuteButton.dataset.active = String(active);
  modeExecuteButton.dataset.hasRecords = String(executionTasks.length > 0 || Boolean(task && !active));
  executionStop.disabled = !active || task?.state === 'stopping';

  if (!task) {
    executionCurrentCard.dataset.state = 'idle';
    executionStateLabel.dataset.state = 'idle';
    executionStateLabel.textContent = '待命';
    executionCurrentGoal.textContent = '还没有正在执行的电脑任务。';
    executionCurrentMeta.textContent = '只有真实触发工具后，这里才会出现操作记录。';
    executionLiveLog.replaceChildren();
    executionCurrentResult.textContent = '';
    executionCurrentResult.dataset.visible = 'false';
  } else {
    executionCurrentCard.dataset.state = task.state;
    executionStateLabel.dataset.state = task.state;
    executionStateLabel.textContent = executionStateText(task.state);
    executionCurrentGoal.textContent = task.goal;
    const level = currentSettingsBundle?.settings.tools.modePermissions[task.mode]
      ?? currentSettingsBundle?.settings.tools.permissionLevel
      ?? 'off';
    const completed = task.executions.filter(item => item.status === 'completed').length;
    const resultMeta = task.executions.length > 0 ? ` · ${completed}/${task.executions.length} 项完成` : '';
    executionCurrentMeta.textContent = `${modeLabel(task.mode)}模式 · ${toolPermissionShortLabel(level)} · ${formatExecutionTime(task.startedAt)}${resultMeta}`;
    const timeline = task.events.slice(-14).map(event => {
      const item = document.createElement('li');
      item.className = 'execution-live-step';
      item.dataset.phase = event.phase;
      item.textContent = `${formatExecutionTime(event.occurredAt)} · ${event.message}`;
      return item;
    });
    executionLiveLog.replaceChildren(...timeline);
    executionCurrentResult.textContent = task.finalResponse || '';
    executionCurrentResult.dataset.visible = String(Boolean(task.finalResponse));
  }

  renderExecutionHistory();
}

function renderExecutionHistory(): void {
  if (executionTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'execution-empty';
    empty.textContent = '真实执行完成后，会在这里保留参数、结果与耗时。';
    executionHistory.replaceChildren(empty);
    return;
  }
  executionHistory.replaceChildren(...executionTasks.map(createExecutionTaskNode));
}

function createExecutionTaskNode(task: ExecutionTask): HTMLElement {
  const details = document.createElement('details');
  details.className = 'execution-task';
  details.dataset.state = task.state;

  const summary = document.createElement('summary');
  const goal = document.createElement('span');
  goal.className = 'execution-task-goal';
  goal.textContent = task.goal;
  const meta = document.createElement('span');
  meta.className = 'execution-task-meta';
  const completed = task.executions.filter(item => item.status === 'completed').length;
  meta.textContent = `${executionStateText(task.state)} · ${completed}/${task.executions.length} 项完成 · ${formatExecutionTime(task.startedAt)}`;
  summary.append(goal, meta);

  const body = document.createElement('div');
  body.className = 'execution-task-body';
  if (task.finalResponse) {
    const finalResponse = document.createElement('div');
    finalResponse.className = 'execution-task-response';
    finalResponse.textContent = task.finalResponse;
    body.appendChild(finalResponse);
  }
  if (task.executions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'execution-empty';
    empty.textContent = task.state === 'cancelled'
      ? '任务在完成工具步骤前被停止。'
      : '本轮没有产生真实工具调用，也没有改动电脑内容。';
    body.appendChild(empty);
  } else {
    body.append(...task.executions.map(createExecutionRecordCard));
  }
  details.append(summary, body);
  return details;
}

function createExecutionRecordCard(execution: ChatToolExecution): HTMLElement {
  const card = document.createElement('details');
  card.className = 'message-tool-card';
  card.dataset.status = execution.status;

  const title = document.createElement('summary');
  title.className = 'message-tool-title';
  const status = execution.status === 'completed' ? '完成' : execution.status === 'denied' ? '已拒绝' : '失败';
  const duration = execution.durationMs >= 1000 ? `${(execution.durationMs / 1000).toFixed(1)}s` : `${execution.durationMs}ms`;
  title.textContent = `${execution.label} · ${status} · ${duration}`;

  const body = document.createElement('div');
  body.className = 'message-tool-body';
  const summary = document.createElement('div');
  summary.className = 'message-tool-summary';
  summary.textContent = execution.summary;
  body.appendChild(summary);
  appendExecutionPreview(body, '调用参数', execution.inputPreview);
  appendExecutionPreview(body, '执行结果', execution.outputPreview);
  card.append(title, body);
  return card;
}

function appendExecutionPreview(container: HTMLElement, label: string, value: string): void {
  if (!value) return;
  const heading = document.createElement('div');
  heading.className = 'message-tool-meta-label';
  heading.textContent = label;
  const preview = document.createElement('pre');
  preview.textContent = value;
  container.append(heading, preview);
}

function isExecutionTaskActive(task: ExecutionTask): boolean {
  return task.state === 'planning' || task.state === 'running' || task.state === 'stopping';
}

function executionStateText(state: ExecutionTaskState): string {
  if (state === 'planning') return '正在规划';
  if (state === 'running') return '正在执行';
  if (state === 'stopping') return '正在停止';
  if (state === 'completed') return '已完成';
  if (state === 'failed') return '有失败项';
  if (state === 'cancelled') return '已停止';
  return '未执行';
}

function formatExecutionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function initializeChatWindows(): Promise<void> {
  await initializeProjects();
  const windows = await window.athenaAPI.listChatWindows(false, currentProjectId ?? undefined);
  chatWindows = windows;
  currentChatWindowId = windows[0]?.id ?? null;
  renderChatWindowPicker();
  if (currentChatWindowId) {
    await window.athenaAPI.activateChatWindow(currentChatWindowId);
    const active = chatWindows.find(window => window.id === currentChatWindowId);
    if (active) setMode(active.mode);
    await loadCurrentChatWindowMessages();
    await refreshWindowMemoryPanel();
  }
}

async function initializeProjects(): Promise<void> {
  const loaded = await window.athenaAPI.listProjects(false);
  projects = loaded;
  currentProjectId = currentProjectId && loaded.some(project => project.id === currentProjectId)
    ? currentProjectId
    : loaded[0]?.id ?? null;
  renderProjectPicker();
}

async function refreshProjects(): Promise<void> {
  try {
    const loaded = await window.athenaAPI.listProjects(false);
    projects = loaded;
    if (!currentProjectId || !loaded.some(project => project.id === currentProjectId)) {
      currentProjectId = loaded[0]?.id ?? null;
    }
    renderProjectPicker();
  } catch (error) {
    console.error('Failed to refresh projects', error);
  }
}

async function refreshChatWindows(): Promise<void> {
  try {
    if (!currentProjectId) await refreshProjects();
    const persistentWindows = await window.athenaAPI.listChatWindows(false, currentProjectId ?? undefined);
    chatWindows = await mergeCurrentTemporaryWindow(persistentWindows);
    if (!currentChatWindowId || !chatWindows.some(window => window.id === currentChatWindowId)) {
      currentChatWindowId = chatWindows[0]?.id ?? null;
    }
    renderChatWindowPicker();
  } catch (error) {
    console.error('Failed to refresh chat windows', error);
  }
}

async function mergeCurrentTemporaryWindow(persistentWindows: ChatWindowRecord[]): Promise<ChatWindowRecord[]> {
  const current = getCurrentChatWindow();
  if (current?.is_temporary !== true || !currentChatWindowId) return persistentWindows;
  const refreshed = await window.athenaAPI.activateChatWindow(currentChatWindowId);
  if (!refreshed?.is_temporary) return persistentWindows;
  return [refreshed, ...persistentWindows.filter(window => window.id !== refreshed.id)];
}

function getCurrentChatWindow(): ChatWindowRecord | undefined {
  return currentChatWindowId
    ? chatWindows.find(window => window.id === currentChatWindowId)
    : undefined;
}

function getCurrentProject(): AthenaProjectRecord | undefined {
  return currentProjectId
    ? projects.find(project => project.id === currentProjectId)
    : undefined;
}

function renderProjectPicker(): void {
  projectSelect.replaceChildren();
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = String(project.id);
    const count = project.windowCount ?? 0;
    option.textContent = count > 0 ? `${project.title} (${count})` : project.title;
    projectSelect.appendChild(option);
  }
  if (currentProjectId) projectSelect.value = String(currentProjectId);
  const disabled = isStreaming || projects.length === 0;
  projectSelect.disabled = disabled;
  projectInstructions.disabled = disabled || !currentProjectId;
  projectNew.disabled = isStreaming;
}

function renderChatWindowPicker(): void {
  const current = getCurrentChatWindow();
  renderProjectPicker();
  const temporary = current?.is_temporary === true;
  appShell.dataset.temporaryChat = String(temporary);
  temporaryChatBadge.hidden = !temporary;
  temporaryChatBadge.textContent = temporary ? TEMPORARY_CHAT_BADGE : '';
  chatWindowSelect.replaceChildren();
  for (const windowRecord of chatWindows) {
    const option = document.createElement('option');
    option.value = String(windowRecord.id);
    const count = windowRecord.messageCount ?? 0;
    const title = windowRecord.is_temporary ? `[${TEMPORARY_CHAT_LABEL}] ${windowRecord.title}` : windowRecord.title;
    option.textContent = count > 0 ? `${title} (${count})` : title;
    chatWindowSelect.appendChild(option);
  }
  if (currentChatWindowId) chatWindowSelect.value = String(currentChatWindowId);
  const disabled = isStreaming || chatWindows.length === 0;
  chatWindowSelect.disabled = disabled;
  chatWindowRename.disabled = disabled || !currentChatWindowId;
  chatWindowArchive.disabled = disabled || !currentChatWindowId || temporary;
  chatWindowDelete.disabled = disabled || !currentChatWindowId;
  chatWindowNew.disabled = isStreaming;
  chatWindowTemporary.disabled = isStreaming;
  chatWindowDelete.textContent = temporary ? '关闭' : '删除';
}

async function loadCurrentChatWindowMessages(): Promise<void> {
  if (!currentChatWindowId) {
    currentChatWindowMessages = [];
    chatPanel.clear();
    await refreshWindowMemoryPanel();
    return;
  }
  const messages = await window.athenaAPI.getChatWindowMessages(currentChatWindowId, 300);
  currentChatWindowMessages = messages;
  chatPanel.renderMessages(messages);
}

async function switchProject(id: number): Promise<void> {
  if (isStreaming || id === currentProjectId) return;
  const target = projects.find(project => project.id === id);
  if (!target) {
    await refreshProjects();
    return;
  }
  currentProjectId = target.id;
  currentChatWindowId = null;
  chatPanel.clear();
  await refreshChatWindows();
  if (currentChatWindowId) {
    await window.athenaAPI.activateChatWindow(currentChatWindowId);
    const active = chatWindows.find(window => window.id === currentChatWindowId);
    if (active) setMode(active.mode || currentMode);
    await loadCurrentChatWindowMessages();
  }
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function switchChatWindow(id: number): Promise<void> {
  if (isStreaming || id === currentChatWindowId) return;
  const active = await window.athenaAPI.activateChatWindow(id);
  if (!active) {
    await refreshChatWindows();
    return;
  }
  currentChatWindowId = active.id;
  const mode = active.mode || currentMode;
  setMode(mode);
  if (currentSettingsBundle) currentSettingsBundle.settings.conversation.activeMode = mode;
  await loadCurrentChatWindowMessages();
  await refreshChatWindows();
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function createNewChatWindow(): Promise<void> {
  if (isStreaming) return;
  const title = window.prompt('新聊天窗口名称', `聊天 ${chatWindows.length + 1}`) || '';
  const created = await window.athenaAPI.createChatWindow(title, currentProjectId ?? undefined);
  if (!created) return;
  currentChatWindowId = created.id;
  setMode(created.mode);
  await refreshChatWindows();
  await loadCurrentChatWindowMessages();
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function createTemporaryChatWindow(): Promise<void> {
  if (isStreaming) return;
  const created = await window.athenaAPI.createTemporaryChatWindow(currentProjectId ?? undefined);
  if (!created) return;
  currentChatWindowId = created.id;
  setMode(created.mode);
  chatWindows = [created, ...chatWindows.filter(window => window.id !== created.id)];
  renderChatWindowPicker();
  await loadCurrentChatWindowMessages();
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function createNewProject(): Promise<void> {
  if (isStreaming) return;
  const title = window.prompt('Project name', `Project ${projects.length + 1}`) || '';
  if (!title.trim()) return;
  const instructions = window.prompt('Project instructions', '') || '';
  const created = await window.athenaAPI.createProject(title, instructions);
  if (!created) return;
  currentProjectId = created.id;
  currentChatWindowId = null;
  chatPanel.clear();
  await refreshProjects();
  await refreshChatWindows();
  if (currentChatWindowId) {
    await window.athenaAPI.activateChatWindow(currentChatWindowId);
    await loadCurrentChatWindowMessages();
  }
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function editCurrentProjectInstructions(): Promise<void> {
  if (isStreaming || !currentProjectId) return;
  const current = getCurrentProject();
  if (!current) return;
  const next = window.prompt('Project instructions', current.instructions || '');
  if (next === null) return;
  const updated = await window.athenaAPI.updateProject(currentProjectId, {
    title: current.title,
    instructions: next,
  });
  if (!updated) return;
  projects = projects.map(project => project.id === updated.id ? updated : project);
  await refreshProjects();
  await refreshChatWindows();
  await refreshWindowMemoryPanel();
}

async function renameCurrentChatWindow(): Promise<void> {
  if (!currentChatWindowId || isStreaming) return;
  const current = chatWindows.find(window => window.id === currentChatWindowId);
  const title = window.prompt('重命名聊天窗口', current?.title || '');
  if (!title || !title.trim()) return;
  await window.athenaAPI.renameChatWindow(currentChatWindowId, title);
  await refreshChatWindows();
  await refreshWindowMemoryPanel();
}

async function archiveCurrentChatWindow(): Promise<void> {
  if (!currentChatWindowId || isStreaming) return;
  const current = chatWindows.find(window => window.id === currentChatWindowId);
  if (!window.confirm(`归档“${current?.title || '当前窗口'}”？`)) return;
  await window.athenaAPI.archiveChatWindow(currentChatWindowId, true);
  currentChatWindowId = null;
  chatPanel.clear();
  await refreshChatWindows();
  if (currentChatWindowId) {
    await window.athenaAPI.activateChatWindow(currentChatWindowId);
    await loadCurrentChatWindowMessages();
  }
  await refreshWindowMemoryPanel();
}

async function deleteCurrentChatWindow(): Promise<void> {
  if (!currentChatWindowId || isStreaming) return;
  const current = getCurrentChatWindow();
  const temporary = current?.is_temporary === true;
  const confirmMessage = temporary
    ? '关闭这个临时聊天？它的消息和上下文快照会被清除。'
    : `删除“${current?.title || '当前窗口'}”？窗口消息会被软删除隐藏。`;
  if (!window.confirm(confirmMessage)) return;
  await window.athenaAPI.deleteChatWindow(currentChatWindowId);
  currentChatWindowId = null;
  chatPanel.clear();
  await refreshChatWindows();
  if (currentChatWindowId) {
    await window.athenaAPI.activateChatWindow(currentChatWindowId);
    await loadCurrentChatWindowMessages();
  }
  await refreshWindowMemoryPanel();
}

async function refreshWindowMemoryPanel(): Promise<void> {
  const current = getCurrentChatWindow();
  if (!current) {
    renderEmptyWindowMemoryPanel();
    return;
  }

  let snapshots: ContextSnapshotRecord[] = [];
  try {
    snapshots = await window.athenaAPI.getChatWindowContextSnapshots(current.id, 1);
  } catch (error) {
    console.error('Failed to load chat window context snapshot', error);
  }
  renderWindowMemoryPanel(current, currentChatWindowMessages, snapshots[0]);
}

function renderEmptyWindowMemoryPanel(): void {
  windowContextTitle.textContent = '当前窗口';
  windowContextMeta.textContent = '没有可用聊天窗口';
  windowContextGoal.textContent = '暂无明确目标';
  renderTextList(windowContextConclusions, []);
  renderTextList(windowContextTodos, []);
  renderPinnedFacts([]);
  windowContextSummary.textContent = '暂无摘要';
  renderContextBudget(null, 0);
}

function renderWindowMemoryPanel(
  windowRecord: ChatWindowRecord,
  messages: ChatMessageSnapshot[],
  snapshot?: ContextSnapshotRecord,
): void {
  const workingState = parseWindowWorkingState(windowRecord.working_state_json || windowRecord.working_state);
  const insights = deriveWindowInsights(windowRecord, workingState, messages);
  windowContextTitle.textContent = windowRecord.title;
  windowContextMeta.textContent = [
    windowRecord.projectTitle ? `Project: ${windowRecord.projectTitle}` : '',
    windowRecord.is_temporary ? TEMPORARY_CHAT_META : '',
    `${windowRecord.messageCount ?? messages.length} 条消息`,
    modeLabel(windowRecord.mode),
    formatPanelTime(windowRecord.updated_at || windowRecord.last_active_at),
  ].filter(Boolean).join(' · ');
  windowContextGoal.textContent = insights.goal || '暂无明确目标';
  renderTextList(windowContextConclusions, insights.conclusions);
  renderTextList(windowContextTodos, insights.todos);
  renderPinnedFacts(insights.pinnedFacts);
  windowContextSummary.textContent = windowRecord.summary?.trim() || '暂无摘要';
  renderContextBudget(snapshot || null, messages.length);
}

function renderTextList(container: HTMLUListElement, items: string[]): void {
  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'window-context-empty';
    empty.textContent = '暂无记录';
    container.appendChild(empty);
    return;
  }
  for (const item of items.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = item;
    container.appendChild(li);
  }
}

function renderPinnedFacts(facts: ChatWindowPinnedFact[]): void {
  windowPinnedFacts.replaceChildren();
  if (facts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'window-context-empty';
    empty.textContent = '还没有固定事实';
    windowPinnedFacts.appendChild(empty);
    return;
  }

  for (const fact of facts) {
    const item = document.createElement('div');
    item.className = 'window-pinned-fact';
    const text = document.createElement('div');
    text.className = 'window-pinned-fact-text';
    text.textContent = fact.text;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = '取消固定';
    remove.setAttribute('aria-label', '取消固定');
    remove.innerHTML = '<svg class="icon"><use href="#icon-close"></use></svg>';
    remove.addEventListener('click', () => void unpinCurrentWindowFact(fact.id));
    item.append(text, remove);
    windowPinnedFacts.appendChild(item);
  }
}

function renderContextBudget(snapshot: ContextSnapshotRecord | null, visibleMessageCount: number): void {
  windowContextBudget.replaceChildren();
  if (!snapshot) {
    appendContextStat('最近消息', String(visibleMessageCount));
    appendContextStat('上下文快照', '暂无');
    appendContextStat('记忆', '0 项');
    appendContextStat('预算', '暂无');
    return;
  }

  const included = snapshot.included || [];
  const omitted = snapshot.omitted || [];
  const recentCount = included.filter(item => item.kind === 'recent_message').length;
  const summaryState = included.some(item => item.kind === 'window_summary')
    ? '已使用'
    : omitted.some(item => item.kind === 'window_summary')
      ? '已省略'
      : '暂无';
  const memoryCount = included.filter(item => (
    item.kind === 'pinned_fact'
    || item.kind === 'project_memory'
    || item.kind === 'global_memory'
  )).length;
  const estimatedTokens = snapshot.budget?.estimatedPromptTokens ?? snapshot.estimated_prompt_tokens;
  const maxTokens = snapshot.budget?.maxPromptTokens;
  const chars = snapshot.budget?.promptChars ?? snapshot.prompt_chars;
  appendContextStat('最近消息', `${recentCount}/${visibleMessageCount}`);
  appendContextStat('摘要', summaryState);
  appendContextStat('记忆', `${memoryCount} 项`);
  appendContextStat('Token', maxTokens ? `${estimatedTokens}/${maxTokens}` : String(estimatedTokens));
  appendContextStat('字符', String(chars));
  appendContextStat('消息组', String(snapshot.budget?.promptMessageCount ?? snapshot.prompt_message_count));
}

function appendContextStat(label: string, value: string): void {
  const item = document.createElement('div');
  item.className = 'window-context-stat';
  const labelEl = document.createElement('div');
  labelEl.className = 'window-context-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('div');
  valueEl.className = 'window-context-stat-value';
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  windowContextBudget.appendChild(item);
}

async function pinCurrentWindowFact(): Promise<void> {
  if (!currentChatWindowId) return;
  const text = windowPinInput.value.trim();
  if (!text) return;
  const updated = await window.athenaAPI.pinChatWindowFact(currentChatWindowId, text);
  windowPinInput.value = '';
  if (updated) {
    chatWindows = chatWindows.map(item => item.id === updated.id ? updated : item);
    await refreshWindowMemoryPanel();
  }
}

async function unpinCurrentWindowFact(factId: string): Promise<void> {
  if (!currentChatWindowId) return;
  const updated = await window.athenaAPI.unpinChatWindowFact(currentChatWindowId, factId);
  if (updated) {
    chatWindows = chatWindows.map(item => item.id === updated.id ? updated : item);
    await refreshWindowMemoryPanel();
  }
}

function parseWindowWorkingState(value: string): ChatWindowWorkingState {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ChatWindowWorkingState : {};
  } catch {
    return {};
  }
}

function deriveWindowInsights(
  windowRecord: ChatWindowRecord,
  workingState: ChatWindowWorkingState,
  messages: ChatMessageSnapshot[],
): {
  goal: string;
  conclusions: string[];
  todos: string[];
  pinnedFacts: ChatWindowPinnedFact[];
} {
  const pinnedFacts = normalizePinnedFacts(workingState.pinnedFacts);
  const userMessages = messages.filter(message => message.role === 'user').map(message => message.content);
  const assistantMessages = messages.filter(message => message.role === 'assistant').map(message => message.content);
  return {
    goal: firstNonEmpty(
      workingState.currentGoal,
      workingState.goal,
      workingState.objective,
      extractLabeledValue([...userMessages].reverse(), ['任务', '目标']),
      windowRecord.title !== '新聊天' ? windowRecord.title : '',
      workingState.lastUserSelection ? `已选择 ${workingState.lastUserSelection}` : '',
    ),
    conclusions: uniqueTexts([
      ...arrayStrings(workingState.confirmedConclusions),
      ...arrayStrings(workingState.conclusions),
      ...extractLabeledList([...assistantMessages, ...userMessages], ['已确认', '确认', '结论']),
    ]).slice(0, 6),
    todos: uniqueTexts([
      ...arrayStrings(workingState.todos),
      ...arrayStrings(workingState.pendingTodos),
      ...extractTodoList(userMessages),
    ]).slice(0, 8),
    pinnedFacts,
  };
}

function normalizePinnedFacts(value: unknown): ChatWindowPinnedFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ChatWindowPinnedFact | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
      return text && id ? { id, text, createdAt } : null;
    })
    .filter((item): item is ChatWindowPinnedFact => Boolean(item));
}

function extractLabeledValue(messages: string[], labels: string[]): string {
  for (const message of messages) {
    for (const line of message.split(/\r?\n/)) {
      const match = line.match(/^(.{0,8}?)(任务|目标)[:：]\s*(.+)$/);
      if (match && labels.includes(match[2])) return cleanPanelText(match[3], 120);
    }
  }
  return '';
}

function extractLabeledList(messages: string[], labels: string[]): string[] {
  const items: string[] = [];
  for (const message of messages.slice(-12)) {
    for (const line of message.split(/\r?\n/)) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(?:[-*]\s*)?(已确认|确认|结论)[:：]\s*(.+)$/);
      if (match && labels.includes(match[1])) items.push(cleanPanelText(match[2], 120));
    }
  }
  return items.filter(Boolean);
}

function extractTodoList(messages: string[]): string[] {
  const items: string[] = [];
  for (const message of messages.slice(-8)) {
    for (const line of message.split(/\r?\n/)) {
      const trimmed = line.trim();
      const checkbox = trimmed.match(/^[-*]\s*\[\s?\]\s*(.+)$/);
      const numbered = trimmed.match(/^\d+[.、]\s*(.+)$/);
      if (checkbox?.[1]) items.push(cleanPanelText(checkbox[1], 120));
      else if (numbered?.[1]) items.push(cleanPanelText(numbered[1], 120));
    }
  }
  return items.filter(Boolean);
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? cleanPanelText(item, 120) : '').filter(Boolean)
    : [];
}

function uniqueTexts(items: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of items.map(text => cleanPanelText(text, 120)).filter(Boolean)) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  return unique;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.map(value => cleanPanelText(value || '', 140)).find(Boolean) || '';
}

function cleanPanelText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}...`;
}

function formatPanelTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function initializeSettings(): Promise<void> {
  try {
    const bundle = await window.athenaAPI.getSettings();
    currentSettingsBundle = bundle;
    populateSettingsForm(bundle);
    applyRuntimeSettings(bundle.settings);
    await initializeChatWindows();
    void loadPrivacyCenter();
    if (bundle.settings.ui.startupIntro) startStartupIntro();
    else skipStartupIntro();
    void refreshStartupModelStatus(bundle.settings.general.autoConnectModel);
    if (!bundle.model.setupComplete) window.setTimeout(() => void openFirstRunModelSetup(), 260);
  } catch {
    startStartupIntro();
    void refreshStartupModelStatus(true);
  }
}

async function openFirstRunModelSetup(): Promise<void> {
  await toggleSettingsPanel(true);
  modelSettingsSection.open = true;
  modelSettingsSection.scrollIntoView({ block: 'start' });
  const firstChoice = modelFirstRunChoice.querySelector<HTMLButtonElement>('[data-model-path]');
  firstChoice?.focus({ preventScroll: true });
}

async function refreshStartupModelStatus(autoConnect: boolean): Promise<void> {
  if (!autoConnect) {
    modelConnected = null;
    if (chatPanel.hasMessages()) {
      setStatus('寰呭懡', 'ready');
      return;
    }
    chatPanel.addMessage('时夏在。模型自动连接先关着，需要聊天时再叫醒本地模型就好。', 'assistant', '待命');
    setStatus('待命', 'ready');
    return;
  }

  try {
    const info = await window.athenaAPI.getSystemInfo();
    modelConnected = info.modelConnected;
    if (info.modelConnected) {
      if (chatPanel.hasMessages()) {
        setStatus('灏辩华', 'ready');
        return;
      }
      chatPanel.addMessage(`${greetingForHour(info.hour)}，时夏在。今天想先聊两句，还是把手头的事往前推一点？`, 'assistant', '温柔');
      setStatus('就绪', 'ready');
    } else {
      if (chatPanel.hasMessages()) {
        setStatus(`${modelProviderLabel(info.modelProvider)} 绂荤嚎`, 'offline');
        return;
      }
      chatPanel.addMessage(`我已经醒着，但还没连上 ${modelProviderLabel(info.modelProvider)}。请检查 ${info.modelEndpoint || '模型地址'} 和 ${info.modelName || '模型名称'}。`, 'assistant', '等待模型');
      setStatus(`${modelProviderLabel(info.modelProvider)} 离线`, 'offline');
    }
  } catch {
    modelConnected = null;
    if (chatPanel.hasMessages()) {
      setStatus('check failed', 'error');
      return;
    }
    chatPanel.addMessage('初始化状态检查失败，但窗口已经准备好了。', 'assistant', '需要检查');
    setStatus('检查失败', 'error');
  }
}

async function toggleMemoryPanel(force?: boolean): Promise<void> {
  const next = force ?? memoryPanel.dataset.open !== 'true';
  memoryPanel.dataset.open = String(next);
  if (next) settingsPanel.dataset.open = 'false';
  toggleComposerTools(false);
  syncPanelState();
  if (next) {
    await refreshWindowMemoryPanel();
    if (memoryTabs.dataset.active === 'manage') await loadMemoryList();
    if (memoryTabs.dataset.active === 'manage') memorySearch.focus({ preventScroll: true });
    else windowPinInput.focus({ preventScroll: true });
    appShell.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }
}

async function toggleSettingsPanel(force?: boolean): Promise<void> {
  const next = force ?? settingsPanel.dataset.open !== 'true';
  settingsPanel.dataset.open = String(next);
  if (next) {
    memoryPanel.dataset.open = 'false';
    toggleComposerTools(false);
    syncPanelState();
    await loadSettingsPanel();
    await loadPrivacyCenter();
    settingUserName.focus({ preventScroll: true });
    appShell.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }
  if (!next) syncPanelState();
}

function syncPanelState(): void {
  const memoryOpen = memoryPanel.dataset.open === 'true';
  const settingsOpen = settingsPanel.dataset.open === 'true';
  const anyOpen = memoryOpen || settingsOpen;
  panelScrim.dataset.visible = String(anyOpen);
  panelScrim.setAttribute('aria-hidden', String(!anyOpen));
  memoryPanel.setAttribute('aria-hidden', String(!memoryOpen));
  settingsPanel.setAttribute('aria-hidden', String(!settingsOpen));
  btnMemory.setAttribute('aria-expanded', String(memoryOpen));
  btnSettings.setAttribute('aria-expanded', String(settingsOpen));
}

function toggleComposerTools(force?: boolean): void {
  const next = force ?? composerSecondaryTools.dataset.open !== 'true';
  composerSecondaryTools.dataset.open = String(next);
  composerMoreBtn.setAttribute('aria-expanded', String(next));
}

function resizeInputBox(): void {
  inputBox.style.height = 'auto';
  inputBox.style.height = `${Math.min(inputBox.scrollHeight, 116)}px`;
}

async function loadSettingsPanel(): Promise<void> {
  setSettingsFeedback('读取设置中...');
  try {
    const bundle = await window.athenaAPI.getSettings();
    currentSettingsBundle = bundle;
    populateSettingsForm(bundle);
    applyRuntimeSettings(bundle.settings);
    setSettingsFeedback('');
  } catch (error) {
    setSettingsFeedback(`读取失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function selectedModelProvider(): ModelProvider | null {
  const value = settingModelProvider.value;
  if (value === 'ollama' || value === 'openai' || value === 'deepseek' || value === 'athena-cloud' || value === 'custom') return value;
  return null;
}

function selectedRemoteModelProvider(): RemoteModelProvider | null {
  const provider = selectedModelProvider();
  return provider && provider !== 'ollama' ? provider : null;
}

function populateSelectedModelProvider(): void {
  const provider = selectedModelProvider();
  const remoteProvider = selectedRemoteModelProvider();
  modelOllamaFields.hidden = provider !== 'ollama';
  modelRemoteFields.hidden = !remoteProvider;
  remoteModelOptions.replaceChildren();
  if (!provider) {
    modelConnectionStatus.textContent = '请选择 OpenAI、DeepSeek、Athena Cloud 或其他 API。';
    return;
  }
  if (!currentSettingsBundle) return;
  const selected = provider === 'ollama'
    ? currentSettingsBundle.model.ollama
    : currentSettingsBundle.model.remote[remoteProvider!];
  if (remoteProvider) {
    settingRemoteUrl.value = selected.baseUrl;
    settingRemoteModel.value = selected.model;
  }
  settingTemperature.value = String(selected.temperature);
  settingMaxTokens.value = String(selected.maxTokens);
  settingNumCtx.value = String(selected.numCtx);
  modelConnectionStatus.textContent = provider === 'ollama'
    ? '安装 Ollama 后，可把所选模型下载到本机。'
    : `${modelProviderLabel(provider)} 使用你填写的 API 地址、模型名和凭据。`;
}

async function refreshModelCredentialStatus(): Promise<void> {
  const provider = selectedRemoteModelProvider();
  if (!provider) {
    modelCredentialStatus.textContent = selectedModelProvider() === 'ollama' ? '本机 Ollama 不需要 API Key。' : '选择 API 平台后填写凭据。';
    return;
  }
  const status = await window.athenaAPI.getModelCredentialStatus(provider);
  if (!status) {
    modelCredentialStatus.textContent = '无法读取凭据状态。';
    return;
  }
  modelCredentialStatus.textContent = status.configured
    ? `API Key 已配置（${status.source === 'environment' ? '临时环境变量' : 'Windows 加密存储'}）。`
    : status.encryptionAvailable
      ? '尚未保存 API Key。'
      : 'Windows 安全凭据加密不可用，Key 不会保存。';
}

async function saveModelCredential(): Promise<void> {
  const provider = selectedRemoteModelProvider();
  if (!provider) {
    modelCredentialStatus.textContent = '请先选择 API 平台。';
    return;
  }
  const apiKey = settingModelApiKey.value.trim();
  if (!apiKey) {
    modelCredentialStatus.textContent = '请输入 API Key。';
    return;
  }
  try {
    const status = await window.athenaAPI.setModelCredential(provider, apiKey);
    settingModelApiKey.value = '';
    modelCredentialStatus.textContent = status?.configured ? 'API Key 已安全保存，不会回显。' : 'API Key 保存失败。';
    if (status?.configured) {
      await saveModelConfiguration(false);
      if (settingConsentRemoteModel.checked) await loadAvailableModels();
    }
  } catch (error) {
    modelCredentialStatus.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadAvailableModels(): Promise<void> {
  const provider = selectedModelProvider();
  if (!provider) {
    modelConnectionStatus.textContent = '请先选择 API 平台。';
    return;
  }
  modelConnectionStatus.textContent = provider === 'ollama' ? '正在读取本机模型...' : '正在读取可用模型...';
  try {
    await saveModelConfiguration(false);
    const result = await window.athenaAPI.listModelOptions();
    const models = result?.models ?? [];
    remoteModelOptions.replaceChildren(...models.map(model => {
      const option = document.createElement('option');
      option.value = model;
      return option;
    }));
    if (models.length === 1) settingRemoteModel.value = models[0];
    modelConnectionStatus.textContent = models.length > 0
      ? `已读取 ${models.length} 个模型，可输入或从列表选择。`
      : '接口可访问，但没有返回可选模型；你仍可以手动填写模型名。';
  } catch (error) {
    modelConnectionStatus.textContent = `读取模型失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function clearModelCredential(): Promise<void> {
  const provider = selectedRemoteModelProvider();
  if (!provider || !window.confirm(`清除 ${modelProviderLabel(provider)} 的本机 API Key？`)) return;
  await window.athenaAPI.clearModelCredential(provider);
  settingModelApiKey.value = '';
  await refreshModelCredentialStatus();
}

function modelPatchFromForm(setupComplete: boolean): SettingsPatch['model'] {
  const provider = selectedModelProvider();
  if (!provider) throw new Error('请先选择 API 平台。');
  const generation = {
    temperature: Number(settingTemperature.value),
    maxTokens: Number(settingMaxTokens.value),
    numCtx: Number(settingNumCtx.value),
  };
  if (provider === 'ollama') {
    return {
      provider,
      setupComplete,
      ollama: { baseUrl: settingOllamaUrl.value, model: settingOllamaModel.value, ...generation },
    };
  }
  return {
    provider,
    setupComplete,
    remote: {
      [provider]: { baseUrl: settingRemoteUrl.value, model: settingRemoteModel.value, ...generation },
    },
  };
}

async function saveModelConfiguration(setupComplete = true): Promise<SettingsBundle> {
  const bundle = await window.athenaAPI.saveSettings({
    settings: {
      privacy: {
        networkConsent: { remoteModel: settingConsentRemoteModel.checked },
      },
    },
    model: modelPatchFromForm(setupComplete),
  });
  currentSettingsBundle = bundle;
  populateSettingsForm(bundle);
  return bundle;
}

async function testModelConnection(): Promise<void> {
  modelConnectionStatus.textContent = '正在保存配置并测试连接...';
  try {
    await saveModelConfiguration(true);
    const status = await window.athenaAPI.testModelConnection();
    modelConnectionStatus.textContent = status?.connected
      ? `${modelProviderLabel(status.provider)} 已连接：${status.model}`
      : `${status ? modelProviderLabel(status.provider) : '模型'} 连接失败，请检查地址、模型和凭据。`;
  } catch (error) {
    modelConnectionStatus.textContent = `连接测试失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function beginOllamaInstall(): Promise<void> {
  const status = await window.athenaAPI.getOllamaSetupStatus();
  if (status?.installed) {
    modelConnectionStatus.textContent = `已检测到 Ollama：${status.executablePath}`;
    return;
  }
  if (status?.bundledInstallerAvailable) {
    const result = await window.athenaAPI.installBundledOllama();
    modelConnectionStatus.textContent = result.started ? 'Ollama 安装器已启动。' : result.error || '已取消安装。';
    return;
  }
  await window.athenaAPI.openOllamaDownload();
  modelConnectionStatus.textContent = '已打开 Ollama 官方下载页。安装完成后返回测试连接。';
}

async function beginOllamaModelPull(): Promise<void> {
  const result = await window.athenaAPI.pullOllamaModel(settingOllamaModel.value);
  modelConnectionStatus.textContent = result.started ? 'Ollama 模型下载已启动。' : result.error || '已取消下载。';
}

function modelProviderLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'athena-cloud') return 'Athena Cloud';
  if (provider === 'custom') return '自定义 API';
  return 'Ollama';
}

async function saveExecutionSettings(): Promise<void> {
  setExecutionSettingsFeedback('保存中...');
  const previous = currentSettingsBundle?.settings.tools.modePermissions.execute ?? 'off';
  const next = settingToolPermissionExecute.value as ToolPermissionLevel;
  if (permissionRank(next) > permissionRank(previous)) {
    const approved = window.confirm(`${toolPermissionShortLabel(next)}会扩大 Athena 对本机的访问范围。高危文件、命令、程序和外网操作仍会逐次确认。是否明确升权？`);
    if (!approved) {
      settingToolPermissionExecute.value = previous;
      setExecutionSettingsFeedback('已取消升权，现有权限保持不变。');
      return;
    }
  }
  try {
    const bundle = await window.athenaAPI.saveSettings({
      settings: {
        tools: {
          modePermissions: {
            execute: settingToolPermissionExecute.value as ToolPermissionLevel,
          },
          maxToolRounds: Number(settingToolMaxRounds.value),
          commandTimeoutSeconds: Number(settingToolCommandTimeout.value),
        },
      },
    });
    currentSettingsBundle = bundle;
    populateSettingsForm(bundle);
    applyRuntimeSettings(bundle.settings);
    setExecutionSettingsFeedback('执行权限已保存，并已立即生效。', 'success');
  } catch (error) {
    setExecutionSettingsFeedback(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function populateSettingsForm(bundle: SettingsBundle): void {
  const { appearance, conversation, data, general, memory, personalization, privacy, tools, ui, voice, webSearch } = bundle.settings;
  settingLaunchStartup.checked = general.launchAtStartup;
  settingCloseTray.checked = general.closeToTray;
  settingNotifications.checked = general.desktopNotifications;
  settingAutoConnectModel.checked = general.autoConnectModel;
  settingUserName.value = personalization.userName;
  settingPreferredAddress.value = personalization.preferredAddress;
  settingTone.value = personalization.tone;
  settingReplyLength.value = personalization.replyLength;
  settingInitiative.value = personalization.initiative;
  settingProactiveCare.checked = personalization.proactiveCare;
  settingMemorySmalltalk.checked = personalization.useMemoryInSmallTalk;
  settingCreatorHints.checked = personalization.creatorModeHints;
  settingCustomNotes.value = personalization.customNotes;
  settingEnterSend.checked = conversation.enterToSend;
  settingStreamResponses.checked = conversation.streamResponses;
  settingShowTimestamps.checked = conversation.showTimestamps;
  settingSaveHistory.checked = conversation.saveHistory;
  settingToolPermissionExecute.value = tools.modePermissions.execute;
  settingToolMaxRounds.value = String(tools.maxToolRounds);
  settingToolCommandTimeout.value = String(tools.commandTimeoutSeconds);
  settingWebSearchEnabled.checked = webSearch.enabled;
  settingWebSearchMode.value = webSearch.mode;
  settingWebSearchMaxResults.value = String(webSearch.maxResults);
  settingWebSearchDeepRead.checked = webSearch.deepRead;
  settingWebSearchSecondary.checked = webSearch.secondarySearch;
  settingWebSearchMaxPages.value = String(webSearch.maxPages);
  settingStartupIntro.checked = ui.startupIntro;
  settingCompactMode.checked = ui.compactMode;
  settingGlassEffects.checked = appearance.glassEffects;
  settingAnimationLevel.value = appearance.animationLevel;
  settingTheme.value = appearance.theme;
  settingModelProvider.value = bundle.model.provider;
  modelFirstRunChoice.hidden = bundle.model.setupComplete;
  settingOllamaUrl.value = bundle.model.ollama.baseUrl;
  settingOllamaModel.value = bundle.model.ollama.model;
  populateSelectedModelProvider();
  void refreshModelCredentialStatus();
  settingMemoryEnabled.checked = memory.enabled;
  settingMemoryAutoExtract.checked = memory.autoExtract;
  settingMemoryProfile.checked = memory.retrieveProfile;
  settingMemoryEvents.checked = memory.retrieveEvents;
  settingMemoryProjects.checked = memory.retrieveProjects;
  settingMemoryDepth.value = String(memory.retrievalDepth);
  settingMemoryMinImportance.value = String(memory.minImportanceForAutoExtract);
  settingSttEnabled.checked = voice.sttEnabled;
  settingTtsEnabled.checked = voice.ttsEnabled;
  settingAutoPlayAssistant.checked = voice.autoPlayAssistant;
  settingSilenceAutoStop.checked = voice.silenceAutoStop;
  settingTtsVoice.value = voice.ttsVoice;
  settingConfirmDelete.checked = data.confirmBeforeDelete;
  settingHistoryRetention.value = String(data.historyRetentionDays);
  settingVoiceCacheRetention.value = String(data.voiceCacheRetentionHours);
  settingExportFormat.value = data.exportFormat;
  settingConsentWebSearch.checked = privacy.networkConsent.webSearch;
  settingConsentRemoteModel.checked = privacy.networkConsent.remoteModel;
  settingConsentExternalToolNetwork.checked = privacy.networkConsent.externalToolNetwork;
  applySkuRuntimeProfile(bundle.sku);
  void refreshVoiceCapabilities();
}

function applySkuRuntimeProfile(sku: SettingsBundle['sku']): void {
  const steam = sku === 'steam';
  appShell.dataset.sku = sku;
  const fullOption = settingToolPermissionExecute.querySelector<HTMLOptionElement>('option[value="full"]');
  if (fullOption) {
    fullOption.disabled = steam;
    fullOption.hidden = steam;
  }
  settingLaunchStartup.disabled = steam;
  settingCloseTray.disabled = steam;
  settingStreamResponses.disabled = steam;
  for (const control of [
    settingWebSearchEnabled,
    settingWebSearchMode,
    settingWebSearchMaxResults,
    settingWebSearchDeepRead,
    settingWebSearchSecondary,
    settingWebSearchMaxPages,
    settingConsentWebSearch,
    settingConsentRemoteModel,
    settingConsentExternalToolNetwork,
  ]) {
    control.disabled = steam;
    control.title = steam ? 'Steam 1.0 首发构建排除此联网能力。' : '';
  }
  if (steam) {
    webSearchBtn.disabled = true;
    webSearchBtn.title = 'Steam 1.0 首发构建不包含联网搜索或任意 HTTP。';
    toolAccessHint.title = 'Steam 1.0 最高只允许文件档；Full、终端和任意 HTTP 在主进程中强制拒绝。';
  }
}

async function refreshVoiceCapabilities(): Promise<void> {
  voiceCapabilityRefresh.disabled = true;
  voiceCapabilityStatus.textContent = '正在检查本地语音组件…';
  try {
    const capabilities = await window.athenaAPI.getVoiceCapabilities();
    if (!capabilities) throw new Error('语音状态不可用');
    currentVoiceCapabilities = capabilities;
    const stt = capabilities.stt.ready ? '本地识别已就绪' : `本地识别未就绪：${capabilities.stt.reason || '组件缺失'}`;
    const tts = capabilities.tts.ready ? '本地朗读已就绪' : `本地朗读未就绪：${capabilities.tts.reason || '系统不支持'}`;
    voiceCapabilityStatus.textContent = `${stt}；${tts}。`;
    settingTtsVoiceOptions.replaceChildren(...capabilities.tts.voices.map((voice) => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.label = voice.culture;
      return option;
    }));
    settingSttEnabled.disabled = !capabilities.stt.ready;
    settingTtsEnabled.disabled = !capabilities.tts.ready;
    settingAutoPlayAssistant.disabled = !capabilities.tts.ready;
    syncVoiceControls();
  } catch {
    currentVoiceCapabilities = null;
    voiceCapabilityStatus.textContent = '无法检查本地语音组件；语音功能保持关闭更安全。';
    settingSttEnabled.checked = false;
    settingSttEnabled.disabled = true;
    syncVoiceControls();
  } finally {
    voiceCapabilityRefresh.disabled = false;
  }
}

async function saveSettingsForm(): Promise<void> {
  setSettingsFeedback('保存中...');
  const previousModel = currentSettingsBundle ? JSON.stringify(currentSettingsBundle.model) : '';
  const previousPermission = currentSettingsBundle?.settings.tools.modePermissions.execute ?? 'off';
  const nextPermission = settingToolPermissionExecute.value as ToolPermissionLevel;
  if (permissionRank(nextPermission) > permissionRank(previousPermission)) {
    const approved = window.confirm(`${toolPermissionShortLabel(nextPermission)}会扩大 Athena 对本机的访问范围。高危操作仍会逐次确认。是否明确升权？`);
    if (!approved) {
      settingToolPermissionExecute.value = previousPermission;
      setSettingsFeedback('已取消升权，其他设置尚未保存。');
      return;
    }
  }

  try {
    const bundle = await window.athenaAPI.saveSettings({
      settings: {
        general: {
          launchAtStartup: settingLaunchStartup.checked,
          closeToTray: settingCloseTray.checked,
          desktopNotifications: settingNotifications.checked,
          autoConnectModel: settingAutoConnectModel.checked,
        },
        appearance: {
          theme: settingTheme.value as ThemeMode,
          animationLevel: settingAnimationLevel.value as AnimationLevel,
          glassEffects: settingGlassEffects.checked,
        },
        conversation: {
          activeMode: currentMode,
          enterToSend: settingEnterSend.checked,
          streamResponses: settingStreamResponses.checked,
          showTimestamps: settingShowTimestamps.checked,
          saveHistory: settingSaveHistory.checked,
        },
        tools: {
          modePermissions: {
            execute: settingToolPermissionExecute.value as ToolPermissionLevel,
          },
          maxToolRounds: Number(settingToolMaxRounds.value),
          commandTimeoutSeconds: Number(settingToolCommandTimeout.value),
        },
        webSearch: {
          enabled: settingWebSearchEnabled.checked,
          mode: settingWebSearchMode.value as WebSearchMode,
          maxResults: Number(settingWebSearchMaxResults.value),
          deepRead: settingWebSearchDeepRead.checked,
          secondarySearch: settingWebSearchSecondary.checked,
          maxPages: Number(settingWebSearchMaxPages.value),
        },
        personalization: {
          userName: settingUserName.value,
          preferredAddress: settingPreferredAddress.value,
          tone: settingTone.value as PersonalizationTone,
          replyLength: settingReplyLength.value as ReplyLength,
          initiative: settingInitiative.value as InitiativeLevel,
          proactiveCare: settingProactiveCare.checked,
          useMemoryInSmallTalk: settingMemorySmalltalk.checked,
          creatorModeHints: settingCreatorHints.checked,
          customNotes: settingCustomNotes.value,
        },
        ui: {
          startupIntro: settingStartupIntro.checked,
          compactMode: settingCompactMode.checked,
        },
        memory: {
          enabled: settingMemoryEnabled.checked,
          autoExtract: settingMemoryAutoExtract.checked,
          retrieveProfile: settingMemoryProfile.checked,
          retrieveEvents: settingMemoryEvents.checked,
          retrieveProjects: settingMemoryProjects.checked,
          retrievalDepth: Number(settingMemoryDepth.value),
          minImportanceForAutoExtract: Number(settingMemoryMinImportance.value),
        },
        voice: {
          sttEnabled: settingSttEnabled.checked,
          ttsEnabled: settingTtsEnabled.checked,
          autoPlayAssistant: settingAutoPlayAssistant.checked,
          silenceAutoStop: settingSilenceAutoStop.checked,
          sttEngine: 'local_whisper',
          ttsVoice: settingTtsVoice.value,
        },
        data: {
          confirmBeforeDelete: settingConfirmDelete.checked,
          historyRetentionDays: Number(settingHistoryRetention.value),
          voiceCacheRetentionHours: Number(settingVoiceCacheRetention.value),
          exportFormat: settingExportFormat.value as 'json' | 'markdown',
        },
        privacy: {
          firstRunPrivacySeenAt: currentSettingsBundle?.settings.privacy.firstRunPrivacySeenAt || new Date().toISOString(),
          networkConsent: {
            remoteModel: settingConsentRemoteModel.checked,
            webSearch: settingConsentWebSearch.checked,
            onlineSpeechToText: currentSettingsBundle?.settings.privacy.networkConsent.onlineSpeechToText ?? false,
            onlineTextToSpeech: currentSettingsBundle?.settings.privacy.networkConsent.onlineTextToSpeech ?? false,
            externalToolNetwork: settingConsentExternalToolNetwork.checked,
          },
        },
      },
      model: modelPatchFromForm(true),
    });

    currentSettingsBundle = bundle;
    populateSettingsForm(bundle);
    applyRuntimeSettings(bundle.settings);
    await loadPrivacyCenter();
    const modelChanged = Boolean(previousModel && previousModel !== JSON.stringify(bundle.model));
    setSettingsFeedback(modelChanged ? '已保存。模型连接已切换并立即生效。' : '已保存。个性化下一轮对话生效。', 'success');
  } catch (error) {
    setSettingsFeedback(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function applyRuntimeSettings(settings: AppSettings): void {
  setMode(settings.conversation.activeMode);
  appShell.dataset.compact = String(settings.ui.compactMode);
  appShell.dataset.animation = settings.appearance.animationLevel;
  appShell.dataset.glass = String(settings.appearance.glassEffects);
  themeController.apply(settings.appearance.theme);
  liveGlass.setMotionReduced(settings.appearance.animationLevel === 'low');
  chatPanel.setShowTimestamps(settings.conversation.showTimestamps);
  syncToolAccessHint();
  syncVoiceControls();
  syncWebSearchControl();
}

function permissionRank(level: ToolPermissionLevel): number {
  return level === 'off' ? 0 : level === 'read' ? 1 : level === 'files' ? 2 : 3;
}

function syncToolAccessHint(): void {
  const tools = currentSettingsBundle?.settings.tools;
  const executeLevel = tools?.modePermissions.execute ?? tools?.permissionLevel ?? 'off';
  const level: ToolPermissionLevel = currentMode === 'execute' ? executeLevel : 'off';
  toolAccessHint.textContent = currentMode === 'execute'
    ? `执行权限 · ${toolPermissionShortLabel(level)}`
    : `${modeLabel(currentMode)} · 纯聊天`;
  toolAccessHint.dataset.level = level;
  toolAccessHint.title = currentMode === 'execute'
    ? `执行模式当前工具权限：${toolPermissionShortLabel(level)}`
    : `${modeLabel(currentMode)}模式不会调用本机工具；需要操作电脑时切换到执行`;
  executionCurrentPermission.textContent = `当前 · ${toolPermissionShortLabel(executeLevel)}`;
  executionCurrentPermission.dataset.level = executeLevel;
}

function syncWebSearchControl(): void {
  const settings = currentSettingsBundle?.settings.webSearch;
  const consented = currentSettingsBundle?.settings.privacy.networkConsent.webSearch ?? false;
  const enabled = (settings?.enabled ?? true) && consented;
  if (!enabled) forceWebSearchForNextMessage = false;

  webSearchBtn.disabled = !enabled || isStreaming || isVoiceInputBusy();
  webSearchBtn.setAttribute('aria-pressed', String(forceWebSearchForNextMessage));
  webSearchBtn.dataset.active = String(forceWebSearchForNextMessage);

  if (!enabled) {
    webSearchLabel.textContent = consented ? '联网搜索已关闭' : '联网搜索待同意';
    webSearchBtn.title = consented ? '请先在设置中启用联网搜索' : '请先在隐私与数据中心同意联网搜索';
    return;
  }
  if (forceWebSearchForNextMessage) {
    webSearchLabel.textContent = '已开启 · 本轮联网';
    webSearchBtn.title = '取消本轮联网搜索';
    return;
  }
  webSearchLabel.textContent = settings?.mode === 'auto' ? '联网搜索 · 自动' : '本轮联网搜索';
  webSearchBtn.title = '强制下一条消息联网搜索';
}

function setSettingsFeedback(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  settingsFeedback.textContent = message;
  settingsFeedback.dataset.kind = kind;
}

function setExecutionSettingsFeedback(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  executionSettingsFeedback.textContent = message;
  executionSettingsFeedback.dataset.kind = kind;
}

async function loadPrivacyCenter(): Promise<void> {
  try {
    const state = await window.athenaAPI.getPrivacyCenter();
    if (!state) return;
    renderPrivacyDataMap(state.dataMap);
    renderStaticProtectionDecision(state.staticProtection);
  } catch (error) {
    privacyDataMap.textContent = `隐私中心加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderPrivacyDataMap(items: DataMapItem[]): void {
  privacyDataMap.replaceChildren();
  for (const item of items) {
    const card = document.createElement('details');
    card.className = 'privacy-map-item';
    const summary = document.createElement('summary');
    summary.textContent = item.label;
    const body = document.createElement('div');
    body.className = 'privacy-map-body';
    const stored = document.createElement('p');
    stored.textContent = `保存：${item.stored}`;
    const leaves = document.createElement('p');
    leaves.textContent = `离开设备：${item.leavesDevice}`;
    const retention = document.createElement('p');
    retention.textContent = `保留：${item.retention}`;
    body.append(stored, leaves, retention);
    card.append(summary, body);
    privacyDataMap.appendChild(card);
  }
}

function renderStaticProtectionDecision(decision: StaticProtectionDecision): void {
  privacyStaticDecision.replaceChildren();
  const status = document.createElement('div');
  status.className = 'privacy-static-status';
  status.textContent = decision.status;
  const claim = document.createElement('p');
  claim.textContent = decision.claim;
  const detail = document.createElement('p');
  detail.textContent = decision.decision;
  privacyStaticDecision.append(status, claim, detail);
}

async function exportPrivacyData(): Promise<void> {
  const format = settingExportFormat.value as 'json' | 'markdown';
  setSettingsFeedback('正在导出数据...');
  try {
    const result = await window.athenaAPI.exportPrivacyData(format);
    if (!result) throw new Error('导出请求被拒绝');
    setSettingsFeedback(`已导出 ${Math.round(result.bytes / 1024)} KB：${result.path}`, 'success');
    await loadPrivacyCenter();
  } catch (error) {
    setSettingsFeedback(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function clearLocalData(): Promise<void> {
  const approved = window.confirm('这会清除本机聊天、长期记忆、搜索/语音/工具活动记录和语音缓存。设置本身会保留。是否继续？');
  if (!approved) return;
  setSettingsFeedback('正在清除本机数据...');
  try {
    const result = await window.athenaAPI.clearLocalData();
    if (!result) throw new Error('清除请求被拒绝');
    setSettingsFeedback(`已清除本机数据，语音缓存删除 ${result.voiceCacheFilesDeleted} 个文件。`, 'success');
    await loadPrivacyCenter();
    await loadMemoryList();
  } catch (error) {
    setSettingsFeedback(`清除失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function selectMemoryTab(tabName: string): Promise<void> {
  memoryTabs.dataset.active = tabName;
  document.querySelectorAll<HTMLButtonElement>('.memory-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll<HTMLElement>('.memory-view').forEach((view) => {
    const targetId = tabName === 'window' ? 'window-memory-view' : `memory-${tabName}-view`;
    view.classList.toggle('active', view.id === targetId);
  });
  if (tabName === 'window') {
    await refreshWindowMemoryPanel();
    windowPinInput.focus();
  }
  if (tabName === 'manage') {
    await loadMemoryList();
    memorySearch.focus();
  }
  if (tabName === 'debug') memoryDebugQuery.focus();
  if (tabName === 'import') memoryImportPath.focus();
}

async function loadMemoryList(): Promise<void> {
  memoryList.textContent = '读取中...';
  try {
    const result = await window.athenaAPI.listMemories({
      kind: memoryKind.value as MemoryKind | 'all',
      query: memorySearch.value,
      limit: 100,
    });
    renderMemoryTotals(result.totals);
    renderMemoryItems(memoryList, result.items, true);
  } catch (error) {
    memoryList.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderMemoryTotals(totals: Record<MemoryKind, number>): void {
  memoryTotalRow.textContent = `画像 ${totals.profile} · 事件 ${totals.event} · 项目 ${totals.project} · 对话 ${totals.message}`;
}

function renderMemoryItems(container: HTMLElement, items: MemoryListItem[], allowDelete: boolean): void {
  container.replaceChildren();
  if (items.length === 0) {
    container.textContent = '没有匹配的记忆';
    return;
  }

  for (const item of items) {
    const row = document.createElement('article');
    row.className = 'memory-item';
    row.dataset.kind = item.kind;

    const head = document.createElement('div');
    head.className = 'memory-item-head';

    const title = document.createElement('div');
    title.className = 'memory-item-title';
    title.textContent = `${kindLabel(item.kind)} · ${item.title}`;

    const actions = document.createElement('div');
    actions.className = 'memory-item-actions';
    if (allowDelete) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.title = '编辑';
      edit.textContent = '✎';
      edit.addEventListener('click', () => showMemoryEditor(row, item));
      actions.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.title = '删除';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        if (currentSettingsBundle?.settings.data.confirmBeforeDelete ?? true) {
          const confirmed = window.confirm(`删除这条${kindLabel(item.kind)}记忆？`);
          if (!confirmed) return;
        }
        const ok = await window.athenaAPI.deleteMemory(item.kind, item.id);
        if (ok) await loadMemoryList();
      });
      actions.appendChild(del);
    }

    const content = document.createElement('div');
    content.className = 'memory-item-content';
    content.textContent = item.content;

    const meta = document.createElement('div');
    meta.className = 'memory-item-meta';
    meta.textContent = `${item.meta}${item.importance ? ` · importance ${item.importance}` : ''}`;

    head.append(title, actions);
    row.append(head, content, meta);
    container.appendChild(row);
  }
}

function showMemoryEditor(row: HTMLElement, item: MemoryListItem): void {
  const existing = row.querySelector('.memory-edit-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'memory-edit-form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = item.title;
  titleInput.placeholder = '标题';

  const contentInput = document.createElement('textarea');
  contentInput.value = item.content;
  contentInput.placeholder = '内容';

  const importanceInput = document.createElement('input');
  importanceInput.type = 'number';
  importanceInput.min = '1';
  importanceInput.max = '10';
  importanceInput.step = '1';
  importanceInput.value = String(item.importance ?? 5);

  const confidenceInput = document.createElement('input');
  confidenceInput.type = 'number';
  confidenceInput.min = '0';
  confidenceInput.max = '1';
  confidenceInput.step = '0.05';
  confidenceInput.value = String(item.confidence ?? 0.7);
  confidenceInput.disabled = item.kind !== 'profile';

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = '保存';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => form.remove());

  form.append(titleInput, contentInput, importanceInput, confidenceInput, save, cancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await window.athenaAPI.updateMemory(item.kind, item.id, {
      title: titleInput.value,
      content: contentInput.value,
      importance: Number(importanceInput.value),
      confidence: Number(confidenceInput.value),
    });
    if (ok) await loadMemoryList();
  });
  row.appendChild(form);
}

async function runMemoryDebug(): Promise<void> {
  const query = memoryDebugQuery.value.trim();
  if (!query) return;

  memoryDebugSummary.textContent = '检索中...';
  memoryDebugList.replaceChildren();

  try {
    const result = await window.athenaAPI.debugMemory(query);
    memoryDebugSummary.textContent = `关键词：${result.keywords.join(' / ') || '无'} · 相关度 ${result.relevanceScore.toFixed(2)}`;
    renderDebugSection('画像', result.profileFacts);
    renderDebugSection('项目', result.projectNotes);
    renderDebugSection('事件', result.relatedEvents);
    renderDebugSection('最近对话', result.recentMessages);
  } catch (error) {
    memoryDebugSummary.textContent = `检索失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderDebugSection(title: string, items: MemoryListItem[]): void {
  const section = document.createElement('section');
  section.className = 'memory-debug-section';
  const heading = document.createElement('div');
  heading.className = 'memory-debug-heading';
  heading.textContent = `${title} ${items.length}`;
  const body = document.createElement('div');
  body.className = 'memory-debug-body';
  renderMemoryItems(body, items, false);
  section.append(heading, body);
  memoryDebugList.appendChild(section);
}

async function chooseImportFile(): Promise<void> {
  const filePath = await window.athenaAPI.chooseMemoryImportFile();
  if (filePath) memoryImportPath.value = filePath;
}

async function previewMemoryImport(): Promise<void> {
  const sourcePath = memoryImportPath.value.trim();
  if (!sourcePath) return;

  memoryImportSummary.textContent = '解析中...';
  memoryImportList.replaceChildren();
  memoryImportCommit.disabled = true;
  currentImportPreview = null;

  try {
    const preview = await window.athenaAPI.previewMemoryImport(sourcePath);
    currentImportPreview = preview;
    memoryImportCommit.disabled = preview.accepted.length === 0;
    memoryImportSummary.textContent = `记录 ${preview.totalRecords} · 助手 ${preview.assistantMessages} · 提取 ${preview.extractedAddMemories} · 可导入 ${preview.accepted.length} · 过滤 ${preview.rejected.length}`;
    renderImportCandidates(preview);
  } catch (error) {
    memoryImportSummary.textContent = `预览失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderImportCandidates(preview: MemoryImportPreview): void {
  memoryImportList.replaceChildren();
  const acceptedHead = document.createElement('div');
  acceptedHead.className = 'memory-debug-heading';
  acceptedHead.textContent = '可导入';
  memoryImportList.appendChild(acceptedHead);
  for (const candidate of preview.accepted) {
    memoryImportList.appendChild(renderImportCandidate(candidate, true));
  }

  const rejectedHead = document.createElement('div');
  rejectedHead.className = 'memory-debug-heading';
  rejectedHead.textContent = '已过滤';
  memoryImportList.appendChild(rejectedHead);
  for (const candidate of preview.rejected.slice(0, 80)) {
    memoryImportList.appendChild(renderImportCandidate(candidate, false));
  }
}

function renderImportCandidate(candidate: MemoryImportCandidate, selectable: boolean): HTMLElement {
  const row = document.createElement('label');
  row.className = 'memory-import-item';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = String(candidate.id);
  checkbox.checked = selectable;
  checkbox.disabled = !selectable;
  checkbox.className = 'memory-import-check';

  const body = document.createElement('span');
  body.className = 'memory-import-body';
  body.textContent = candidate.content;

  const reason = document.createElement('span');
  reason.className = 'memory-import-reason';
  reason.textContent = `${candidate.reason} · importance ${candidate.importance}`;

  row.append(checkbox, body, reason);
  return row;
}

async function commitMemoryImport(): Promise<void> {
  if (!currentImportPreview) return;
  const ids = Array.from(memoryImportList.querySelectorAll<HTMLInputElement>('.memory-import-check'))
    .filter(input => input.checked && !input.disabled)
    .map(input => Number(input.value));
  memoryImportSummary.textContent = '导入中...';
  const result = await window.athenaAPI.commitMemoryImport(currentImportPreview.sourcePath, ids);
  memoryImportSummary.textContent = `已导入 ${result.imported} · 跳过重复 ${result.skipped}`;
  await loadMemoryList();
}

function isVoiceInputBusy(): boolean {
  return voiceInputState === 'requesting'
    || voiceInputState === 'recording'
    || voiceInputState === 'transcribing';
}

function syncVoiceControls(): void {
  const busy = isVoiceInputBusy();
  const voice = currentSettingsBundle?.settings.voice;
  const sttReady = currentVoiceCapabilities?.stt.ready === true;
  const ttsReady = currentVoiceCapabilities?.tts.ready !== false;
  const sttEnabled = (voice?.sttEnabled ?? false) && sttReady;
  const ttsEnabled = (voice?.ttsEnabled ?? true) && ttsReady;
  voiceSttBtn.disabled = isStreaming
    || !sttEnabled
    || isVoiceOutputBusy
    || voiceInputState === 'requesting'
    || voiceInputState === 'transcribing';
  voiceFileBtn.disabled = isStreaming || !sttEnabled || isVoiceOutputBusy || busy;
  voiceTtsBtn.disabled = isStreaming || !ttsEnabled || isVoiceOutputBusy || busy;
  voiceSttBtn.dataset.enabled = String(sttEnabled);
  voiceFileBtn.dataset.enabled = String(sttEnabled);
  voiceTtsBtn.dataset.enabled = String(ttsEnabled);
  inputBar.setSendDisabled(isStreaming || busy);
  syncWebSearchControl();
}

function setVoiceInputState(state: VoiceInputState): void {
  voiceInputState = state;
  inputForm.dataset.voiceState = state;
  const isRecording = state === 'recording';
  voiceSttBtn.setAttribute('aria-pressed', String(isRecording));
  voiceSttBtn.title = isRecording ? '停止录音并识别' : '开始录音';
  voiceSttBtn.setAttribute('aria-label', voiceSttBtn.title);

  if (!isRecording) {
    voiceSttLabel.textContent = '';
    clearMicrophoneMeter();
  } else if (!voiceSttLabel.textContent) {
    voiceSttLabel.textContent = '00:00';
  }

  syncVoiceControls();
}

function showVoiceFeedback(
  message: string,
  kind: 'info' | 'success' | 'error' = 'info',
  autoHideMs = 0,
): void {
  if (voiceFeedbackTimer) window.clearTimeout(voiceFeedbackTimer);
  voiceFeedbackTimer = undefined;
  voiceFeedback.textContent = message;
  voiceFeedback.dataset.kind = kind;
  voiceFeedback.dataset.visible = String(Boolean(message));

  if (message && autoHideMs > 0) {
    voiceFeedbackTimer = window.setTimeout(() => {
      voiceFeedback.textContent = '';
      voiceFeedback.dataset.visible = 'false';
      voiceFeedbackTimer = undefined;
    }, autoHideMs);
  }
}

function restoreIdleStatus(): void {
  if (isStreaming || isVoiceInputBusy() || isVoiceOutputBusy) return;
  if (modelConnected === false) setStatus('模型离线', 'offline');
  else setStatus('就绪', 'ready');
}

async function toggleMicrophoneRecording(): Promise<void> {
  if (voiceInputState === 'recording') {
    await stopAndTranscribeRecording();
    return;
  }

  if (isStreaming || isVoiceInputBusy() || isVoiceOutputBusy) return;
  if (currentVoiceCapabilities?.stt.ready !== true) {
    showVoiceFeedback('本地语音识别组件未安装，无法录音转写。');
    setStatus('语音识别未就绪', 'offline');
    return;
  }

  stopCurrentAudio();
  if (voiceErrorResetTimer) window.clearTimeout(voiceErrorResetTimer);
  const operationId = ++voiceOperationId;
  autoStopRequested = false;
  setVoiceInputState('requesting');
  showVoiceFeedback('正在请求麦克风权限…');
  setStatus('连接麦克风…', 'working');

  try {
    if (!await window.athenaAPI.requestMicrophoneAccess()) {
      throw new Error('麦克风请求未获授权或当前设置已禁用语音输入。');
    }
    await microphoneRecorder.start();
    if (operationId !== voiceOperationId || voiceInputState !== 'requesting') return;
    setVoiceInputState('recording');
    resetRecordingActivity();
    currentMicrophoneLabel = microphoneRecorder.deviceLabel;
    startRecordingTimers();
    updateRecordingDuration(0);
    setStatus('正在聆听', 'working');
  } catch (error) {
    if (operationId !== voiceOperationId) return;
    failVoiceInput(error);
  }
}

async function stopAndTranscribeRecording(): Promise<void> {
  if (voiceInputState !== 'recording') return;

  const operationId = ++voiceOperationId;
  const durationMs = recordingStartedAt > 0
    ? performance.now() - recordingStartedAt
    : microphoneRecorder.durationMs;
  const detectedSpeech = recordingSpeechDetected;
  const peakLevel = recordingPeakLevel;
  const microphoneLabel = currentMicrophoneLabel;
  clearRecordingTimers();
  autoStopRequested = true;
  setVoiceInputState('transcribing');
  showVoiceFeedback('正在识别语音…');
  setStatus('语音识别中…', 'working');

  try {
    const wav = await microphoneRecorder.stop();
    if (operationId !== voiceOperationId) return;
    if (durationMs < MIN_RECORDING_MS) {
      throw new Error('录音时间太短，请再说一次。');
    }
    if (!detectedSpeech && peakLevel < VOICE_MIN_SIGNAL_LEVEL) {
      throw new Error(`没有检测到声音。当前设备：${microphoneLabel}。请靠近麦克风或切换 Windows 默认输入设备。`);
    }

    const result = await window.athenaAPI.transcribeRecording(wav);
    if (operationId !== voiceOperationId) return;
    const text = result.text?.trim() || '';
    if (!result.ok || !text) {
      throw new Error(result.error || '没有识别到清晰的语音。');
    }

    inputBar.insertAtCursor(text);
    inputBar.focus();
    completeVoiceInput('听写完成，已插入输入框');
  } catch (error) {
    if (operationId !== voiceOperationId) return;
    failVoiceInput(error);
  }
}

async function cancelMicrophoneRecording(): Promise<void> {
  if (voiceInputState !== 'recording' && voiceInputState !== 'requesting') return;

  const operationId = ++voiceOperationId;
  clearRecordingTimers();
  resetRecordingActivity();
  autoStopRequested = true;
  setVoiceInputState('idle');
  showVoiceFeedback('已取消录音', 'info', 1800);
  restoreIdleStatus();
  inputBar.focus();

  try {
    await microphoneRecorder.cancel();
  } catch (error) {
    if (operationId === voiceOperationId) failVoiceInput(error);
  }
}

function startRecordingTimers(): void {
  clearRecordingTimers();
  recordingStartedAt = performance.now();
  recordingTicker = window.setInterval(() => {
    updateRecordingDuration(performance.now() - recordingStartedAt);
  }, 250);
  recordingDeadlineTimer = window.setTimeout(() => {
    if (voiceInputState !== 'recording' || autoStopRequested) return;
    autoStopRequested = true;
    void stopAndTranscribeRecording();
  }, MAX_RECORDING_MS);
}

function clearRecordingTimers(): void {
  if (recordingTicker) window.clearInterval(recordingTicker);
  if (recordingDeadlineTimer) window.clearTimeout(recordingDeadlineTimer);
  recordingTicker = undefined;
  recordingDeadlineTimer = undefined;
  recordingStartedAt = 0;
}

function updateRecordingDuration(durationMs: number): void {
  if (voiceInputState !== 'recording') return;

  const elapsed = formatRecordingDuration(durationMs);
  voiceSttLabel.textContent = elapsed;
  showVoiceFeedback(`正在聆听 ${elapsed} · ${currentMicrophoneLabel} · 说完会自动识别`);

  if (
    (currentSettingsBundle?.settings.voice.silenceAutoStop ?? true)
    && recordingSpeechDetected
    && performance.now() - recordingLastSpeechAt >= VOICE_SILENCE_STOP_MS
    && !autoStopRequested
  ) {
    autoStopRequested = true;
    showVoiceFeedback('检测到停顿，正在识别语音…');
    void stopAndTranscribeRecording();
  }
}

function handleMicrophoneRecorderError(error: Error): void {
  if (voiceInputState !== 'recording' && voiceInputState !== 'requesting') return;
  voiceOperationId += 1;
  clearRecordingTimers();
  failVoiceInput(error);
}

function updateMicrophoneMeter(level: number): void {
  if (voiceInputState !== 'recording') return;
  recordingPeakLevel = Math.max(recordingPeakLevel, level);
  if (level >= VOICE_ACTIVITY_THRESHOLD) {
    recordingSpeechFrames += 1;
    if (recordingSpeechFrames >= 2) {
      recordingSpeechDetected = true;
      recordingLastSpeechAt = performance.now();
    }
  } else {
    recordingSpeechFrames = 0;
  }
  const normalized = Math.max(0, Math.min(1, level * 5));
  inputForm.style.setProperty('--voice-glow', `${24 + normalized * 36}px`);
  inputForm.style.setProperty('--voice-button-glow', `${16 + normalized * 28}px`);
  liveGlass.setVoiceLevel(normalized);
}

function resetRecordingActivity(): void {
  recordingPeakLevel = 0;
  recordingLastSpeechAt = 0;
  recordingSpeechFrames = 0;
  recordingSpeechDetected = false;
}

function clearMicrophoneMeter(): void {
  inputForm.style.removeProperty('--voice-glow');
  inputForm.style.removeProperty('--voice-button-glow');
  liveGlass.setVoiceLevel(0);
}

function formatRecordingDuration(durationMs: number): string {
  const totalSeconds = Math.min(99 * 60 + 59, Math.max(0, Math.floor(durationMs / 1_000)));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function completeVoiceInput(message: string): void {
  clearRecordingTimers();
  resetRecordingActivity();
  setVoiceInputState('idle');
  showVoiceFeedback(message, 'success', 3600);
  restoreIdleStatus();
}

function failVoiceInput(error: unknown): void {
  clearRecordingTimers();
  resetRecordingActivity();
  setVoiceInputState('error');
  showVoiceFeedback(describeVoiceError(error), 'error', 6500);
  setStatus('语音输入失败', 'error');

  if (voiceErrorResetTimer) window.clearTimeout(voiceErrorResetTimer);
  voiceErrorResetTimer = window.setTimeout(() => {
    if (voiceInputState !== 'error') return;
    setVoiceInputState('idle');
    restoreIdleStatus();
  }, 2400);
}

function describeVoiceError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  const raw = error instanceof Error ? error.message : String(error);
  const value = `${name} ${raw}`.toLowerCase();

  if (value.includes('notallowederror') || value.includes('permission')) {
    return '麦克风权限被拒绝，请在 Windows 隐私设置中允许 Athena 使用麦克风。';
  }
  if (value.includes('notfounderror') || value.includes('no microphone')) {
    return '没有找到可用麦克风，请连接设备后重试。';
  }
  if (value.includes('notreadableerror') || value.includes('trackstarterror') || value.includes('device in use')) {
    return '麦克风暂时不可用，可能正在被其他应用占用。';
  }
  if (value.includes('service_error') || value.includes('stt_network') || value.includes('requesterror') || value.includes('network')) {
    return '语音识别服务暂时无法连接，请检查网络后重试。';
  }
  if (value.includes('no_speech') || value.includes('unknownvalue') || value.includes('没有识别')) {
    return '没有识别到清晰的语音，请靠近麦克风再说一次。';
  }
  if (value.includes('audio_error')) return '录音格式无法读取，请重新录制后再试。';
  if (value.includes('dependency_error')) return '本机语音识别组件未安装完整，请检查 Python 语音依赖。';
  if (value.includes('timed out') || value.includes('timeout')) {
    return '语音识别超时，请缩短录音后重试。';
  }
  if (name === 'AbortError') return '录音已取消。';
  return raw || '语音输入失败，请重试。';
}

async function transcribeAudioFile(): Promise<void> {
  if (isStreaming || isVoiceInputBusy() || isVoiceOutputBusy) return;
  if (currentVoiceCapabilities?.stt.ready !== true) {
    showVoiceFeedback('本地语音识别组件未安装，无法转写音频。');
    setStatus('语音识别未就绪', 'offline');
    return;
  }

  try {
    const sourcePath = await window.athenaAPI.chooseAudioFile();
    if (!sourcePath) return;

    setVoiceInputState('transcribing');
    showVoiceFeedback('正在识别导入的音频…');
    setStatus('音频识别中…', 'working');
    const result = await window.athenaAPI.transcribeAudioFile(sourcePath);
    const text = result.text?.trim() || '';
    if (!result.ok || !text) {
      throw new Error(result.error || '没有识别到清晰的语音。');
    }

    inputBar.insertAtCursor(text);
    inputBar.focus();
    completeVoiceInput('音频听写完成，已插入输入框');
  } catch (error) {
    failVoiceInput(error);
  }
}

async function speakLastAssistantMessage(): Promise<void> {
  const text = chatPanel.getLastAssistantContent().trim();
  if (!text || isStreaming || isVoiceInputBusy() || isVoiceOutputBusy) return;

  isVoiceOutputBusy = true;
  syncVoiceControls();
  showVoiceFeedback('正在合成朗读…');
  setStatus('合成语音...', 'working');
  try {
    const result = await window.athenaAPI.speakText(text);
    if (!result.ok || !result.audioPath) {
      throw new Error(result.error || '没有生成音频');
    }

    stopCurrentAudio();
    showVoiceFeedback('正在朗读回复 · 系统默认输出设备');
    setStatus('正在朗读', 'working');
    const playback = await window.athenaAPI.playAudioFile(result.audioPath);
    if (!playback.ok) {
      await playAudioInRenderer(result.audioPath);
    } else {
      showVoiceFeedback('朗读完成', 'success', 1800);
    }
  } catch (error) {
    stopCurrentAudio();
    showVoiceFeedback(`朗读失败：${error instanceof Error ? error.message : String(error)}`, 'error', 4800);
  } finally {
    isVoiceOutputBusy = false;
    syncVoiceControls();
    if (!currentAudio) restoreIdleStatus();
  }
}

async function playAudioInRenderer(audioPath: string): Promise<void> {
  const audio = new Audio(toFileUrl(audioPath));
  audio.preload = 'auto';
  audio.muted = false;
  audio.volume = 1;
  currentAudio = audio;
  audio.addEventListener('ended', () => {
    if (currentAudio !== audio) return;
    currentAudio = null;
    showVoiceFeedback('朗读完成', 'success', 1800);
    restoreIdleStatus();
  }, { once: true });
  audio.addEventListener('error', () => {
    if (currentAudio !== audio) return;
    currentAudio = null;
    showVoiceFeedback('朗读失败：无法播放生成的音频', 'error', 4800);
    restoreIdleStatus();
  }, { once: true });
  const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
  if (sinkAudio.setSinkId) {
    try {
      await sinkAudio.setSinkId('default');
    } catch {
      // Default playback still works when explicit sink selection is unavailable.
    }
  }
  await waitForAudioReady(audio);
  await audio.play();
}

function waitForAudioReady(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('音频加载超时')), 8000);
    const onReady = (): void => finish();
    const onError = (): void => finish(new Error('无法读取生成的音频'));
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };

    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}

function stopCurrentAudio(): void {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentAudio = null;
}

function toFileUrl(filePath: string): string {
  return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

function kindLabel(kind: MemoryKind): string {
  const labels: Record<MemoryKind, string> = {
    profile: '画像',
    event: '事件',
    project: '项目',
    message: '对话',
  };
  return labels[kind];
}

function toolPermissionShortLabel(level: ToolPermissionLevel): string {
  if (level === 'read') return '全盘只读';
  if (level === 'files') return '文件读写';
  if (level === 'full') return '完全访问';
  return '关闭';
}

function modeLabel(mode: AthenaMode): string {
  if (mode === 'create') return '创作';
  if (mode === 'reason') return '推理';
  if (mode === 'execute') return '执行';
  return '陪伴';
}

function modeThinkingText(mode: AthenaMode): string {
  if (mode === 'create') return '时夏在构思...';
  if (mode === 'reason') return '时夏在推理...';
  if (mode === 'execute') return '时夏在规划执行...';
  return '时夏在听...';
}

function modeHintText(mode: AthenaMode): string {
  if (mode === 'create') return '创作模式 · 发散并落地';
  if (mode === 'reason') return '推理模式 · 核验后判断';
  if (mode === 'execute') return '执行模式 · 调用工具完成任务';
  return '陪伴模式 · 自然地聊';
}

function modePlaceholder(mode: AthenaMode): string {
  if (mode === 'create') return '描述想做的画面、文字或方案...';
  if (mode === 'reason') return '把问题、条件和目标告诉时夏...';
  if (mode === 'execute') return '用自然语言描述要在电脑上完成的任务...';
  return '和时夏说点什么...';
}

function debounce(fn: () => void, delay: number): () => void {
  let timer: number | undefined;
  return () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(fn, delay);
  };
}

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return '早上好';
  if (hour >= 12 && hour < 18) return '下午好';
  if (hour >= 18 && hour < 23) return '晚上好';
  return '夜深了';
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: #${id}`);
  return element as T;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
