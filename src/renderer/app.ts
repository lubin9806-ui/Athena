/** Renderer entry: Athena workspace UI, chat, voice, settings, and IPC wiring. */

import './style.css';
import { ChatPanel, type ChatAttachmentSnapshot, type ChatMessageSnapshot, type ChatSource, type ChatToolExecution } from './ui/ChatPanel';
import { InputBar } from './ui/InputBar';
import { LiveGlass } from './ui/LiveGlass';
import { LiquidGlassRenderer } from './ui/LiquidGlassRenderer';
import { MotionSystem, type AthenaSpace } from './ui/MotionSystem';
import { SelectControlManager } from './ui/SelectControl';
import { ThemeController } from './ui/ThemeController';
import { MicrophoneRecorder } from './voice/MicrophoneRecorder';
import type { AvatarLayoutMode } from '../shared/types/avatar';
import type { AthenaAvatarEvent } from './avatar/AvatarRuntime';
import type { EmotionType } from '../shared/types/emotion';
import { RELEASE_FEATURES } from '../shared/releaseFeatures';

interface DisabledLive2DPreferences {
  enabled: false;
  layout: AvatarLayoutMode;
  scale: number;
  opacity: number;
  outfitId: string;
}

class DisabledLive2DCompanion {
  private readonly preferences: DisabledLive2DPreferences = {
    enabled: false,
    layout: 'chat_right',
    scale: 1,
    opacity: 1,
    outfitId: 'disabled',
  };

  constructor(options: { root: HTMLElement; canvas: HTMLCanvasElement }) {
    options.root.dataset.enabled = 'false';
    options.root.dataset.state = 'disabled';
    options.root.hidden = true;
    options.canvas.hidden = true;
  }

  get isEnabled(): boolean { return false; }
  get settings(): DisabledLive2DPreferences { return { ...this.preferences }; }
  async load(): Promise<void> {}
  async dispatch(_event: AthenaAvatarEvent): Promise<void> {}
  async setEmotionLabel(_label?: string, _intensity = 1): Promise<void> {}
  async attachAudio(_audio: HTMLAudioElement): Promise<void> {}
  async stopAudioTracking(): Promise<void> {}
  async updatePreferences(_patch: Partial<{ enabled: boolean; layout: AvatarLayoutMode; scale: number; opacity: number; outfitId: string }>): Promise<void> {}
  async destroy(): Promise<void> {}
}

function emotionFromLabel(label?: string): EmotionType {
  const value = label?.trim().toLowerCase() ?? '';
  if (/开心|高兴|愉快|happy/.test(value)) return 'happy';
  if (/思考|沉思|认真|thought/.test(value)) return 'thoughtful';
  if (/害羞|腆腆|shy/.test(value)) return 'shy';
  if (/疑惑|困惑|不解|confus/.test(value)) return 'confused';
  if (/期待|兴奋|惊喜|excited/.test(value)) return 'excited';
  if (/困|疲惫|疲倦|tired|sleep/.test(value)) return 'tired';
  if (/调皮|俏皮|playful/.test(value)) return 'playful';
  if (/温柔|柔和|安慰|soft/.test(value)) return 'soft';
  return 'peaceful';
}

type DesktopPetEvent = AthenaAvatarEvent
  | { type: 'lipSync.update'; value: number }
  | { type: 'preferences.update'; scale: number; opacity: number; outfitId: string };

declare global {
  interface Window {
    athenaAPI: {
      routeMessage: (text: string, mode: AthenaMode, forceWebSearch?: boolean, chatWindowId?: number, attachmentIds?: string[]) => Promise<AgentMessageRouteDecision | null>;
      sendMessage: (text: string, mode: AthenaMode, forceWebSearch?: boolean, chatWindowId?: number, attachmentIds?: string[]) => Promise<{
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
        agentExecution?: { taskId: string; runId: string; status: AgentRunStatus };
        routing?: AgentMessageRouteDecision;
      } | null>;
      chooseChatImages: (chatWindowId: number) => Promise<ChatAttachmentSnapshot[]>;
      chooseChatFiles: (chatWindowId: number, maxFiles?: number) => Promise<ChatAttachmentSnapshot[]>;
      getChatAttachmentPreview: (chatWindowId: number, attachmentId: string) => Promise<string | null>;
      removePendingChatAttachment: (chatWindowId: number, attachmentId: string) => Promise<boolean>;
      chooseProjectDocuments: (chatWindowId: number) => Promise<ProjectDocumentRecord[]>;
      chooseScannedProjectPdfs: (chatWindowId: number) => Promise<ProjectDocumentRecord[]>;
      cancelProjectDocumentOcr: () => Promise<boolean>;
      listProjectDocuments: (projectId: number) => Promise<ProjectDocumentRecord[]>;
      deleteProjectDocument: (projectId: number, documentId: number) => Promise<boolean>;
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
      getAgentWorkspace: (projectId: number, taskId?: string) => Promise<AgentProjectWorkspaceSnapshot | null>;
      openAgentArtifact: (projectId: number, artifactId: string) => Promise<boolean>;
      updateAgentWorkspace: (projectId: number, value: {
        revision: number;
        roots?: string[];
        goals?: Array<{ id?: string; title: string; status: AgentWorkspaceGoal['status'] }>;
      }) => Promise<AgentWorkspaceMetadata | null>;
      resolveAgentApproval: (projectId: number, runId: string, approvalId: string, decision: 'approved' | 'denied') => Promise<AgentRunnerResult | null>;
      resumeAgentRun: (projectId: number, runId: string) => Promise<AgentRunnerResult | null>;
      cancelAgentRun: (projectId: number, runId: string) => Promise<AgentRunnerResult | null>;
      onAgentWorkspaceChanged: (callback: (event: { projectId: number; taskId?: string; runId?: string }) => void) => () => void;
      getSkillLibrary: () => Promise<AgentSkillLibrarySnapshot | null>;
      installSkillFromDirectory: (replace?: boolean) => Promise<AgentSkillSummary | null>;
      setSkillTrust: (name: string, packageHash: string, trust: 'approved' | 'untrusted' | 'quarantined') => Promise<AgentSkillSummary | null>;
      setSkillEnabled: (name: string, packageHash: string, enabled: boolean) => Promise<AgentSkillSummary | null>;
      uninstallSkill: (name: string, packageHash: string) => Promise<boolean | null>;
      getMcpIntegrations: () => Promise<McpIntegrationSnapshot | null>;
      upsertMcpServer: (input: McpServerInput) => Promise<McpServerConfig | null>;
      approveMcpServer: (id: string, fingerprint: string, approved: boolean) => Promise<McpServerConfig | null>;
      setMcpServerEnabled: (id: string, fingerprint: string, enabled: boolean) => Promise<McpServerConfig | null>;
      connectMcpServer: (id: string) => Promise<McpIntegrationSnapshot | null>;
      disconnectMcpServer: (id: string) => Promise<McpIntegrationSnapshot | null>;
      removeMcpServer: (id: string, fingerprint: string) => Promise<boolean | null>;
      getToolCatalog: (mode?: AthenaMode) => Promise<ToolCatalog | null>;
      onChatStream: (callback: (data: { content: string; done: boolean }) => void) => () => void;
      onChatError: (callback: (error: string) => void) => () => void;
      onWebSearchStatus: (callback: (status: WebSearchStatus) => void) => () => void;
      onToolStatus: (callback: (status: ToolStatusEvent) => void) => () => void;
      onReminderDue: (callback: (job: { title: string; dueAt: string }) => void) => () => void;
      getSystemInfo: () => Promise<{ modelConnected: boolean; modelConnectionChecked?: boolean; modelProvider: ModelProvider; modelName: string; modelEndpoint: string; ollamaConnected: boolean; hour: number; ollamaModel: string; ollamaEndpoint: string } | null>;
      getFastSystemInfo: () => Promise<{ modelConnected: boolean; modelConnectionChecked?: boolean; modelProvider: ModelProvider; modelName: string; modelEndpoint: string; ollamaConnected: boolean; hour: number; ollamaModel: string; ollamaEndpoint: string } | null>;
      getStartupSystemInfo: () => Promise<{ modelConnected: boolean; modelConnectionChecked?: boolean; modelProvider: ModelProvider; modelName: string; modelEndpoint: string; ollamaConnected: boolean; hour: number; ollamaModel: string; ollamaEndpoint: string } | null>;
      getSettings: () => Promise<SettingsBundle>;
      saveSettings: (patch: SettingsPatch) => Promise<SettingsBundle>;
      getPersona: (profileId?: string) => Promise<PersonaEditorState | null>;
      savePersona: (profileId: string, patch: PersonaCardPatch) => Promise<PersonaEditorState | null>;
      choosePersonaImportFile: () => Promise<string | null>;
      importPersonaFile: (profileId: string, sourcePath: string) => Promise<PersonaEditorState | null>;
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
      listMemoryReviewQueue: (status?: MemoryReviewStatus | 'all', limit?: number) => Promise<MemoryReviewItem[]>;
      approveMemoryReview: (id: number) => Promise<MemoryReviewItem | null>;
      approveMemoryReviews: (ids: number[]) => Promise<MemoryReviewItem[]>;
      rejectMemoryReview: (id: number) => Promise<MemoryReviewItem | null>;
      rejectMemoryReviews: (ids: number[]) => Promise<MemoryReviewItem[]>;
      chooseMemoryImportFile: () => Promise<string | null>;
      previewMemoryImport: (sourcePath: string) => Promise<MemoryImportPreview>;
      commitMemoryImport: (sourcePath: string, candidateIds: number[]) => Promise<MemoryImportCommitResult>;
      getPrivacyCenter: () => Promise<PrivacyCenterState | null>;
      exportPrivacyData: (format?: 'json' | 'markdown') => Promise<{ path: string; bytes: number } | null>;
      clearLocalData: () => Promise<{ deletedTables: string[]; voiceCacheFilesDeleted: number; skillInvocationsDeleted: number } | null>;
      getDiagnosticHealth: () => Promise<DiagnosticHealthSnapshot | null>;
      exportDiagnosticSupport: () => Promise<DiagnosticBundleResult | null>;
      clearDiagnostics: () => Promise<{ filesDeleted: number } | null>;
      speakText: (text: string) => Promise<VoiceResult>;
      playAudioFile: (sourcePath: string) => Promise<VoiceResult>;
      chooseAudioFile: () => Promise<string | null>;
      transcribeAudioFile: (sourcePath: string) => Promise<VoiceResult>;
      transcribeRecording: (audioBytes: Uint8Array) => Promise<VoiceResult>;
      requestMicrophoneAccess: () => Promise<boolean>;
      getVoiceCapabilities: () => Promise<VoiceCapabilities | null>;
      setDesktopPetWindowVisible: (visible: boolean) => Promise<boolean>;
      sendDesktopPetEvent: (event: DesktopPetEvent) => void;
      onDesktopPetInteraction: (callback: (interaction: { prompt: string; hotZoneId: string }) => void) => () => void;
      minimize: () => void;
      close: () => void;
    };
  }
}

type MemoryKind = 'profile' | 'procedure' | 'fact' | 'event' | 'daily' | 'project' | 'message';
type MemoryReviewKind = 'profile' | 'event' | 'project' | 'procedure' | 'fact';
type MemoryReviewStatus = 'pending' | 'applied' | 'rejected';
type AthenaMode = 'create' | 'companion' | 'reason' | 'execute';

interface AgentMessageRouteDecision {
  route: 'conversation' | 'web_research' | 'durable_execution';
  effectiveMode: AthenaMode;
  confidence: 'high' | 'medium';
  reason: string;
  autoSwitch: boolean;
  query?: string;
}
type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
type AppStatusState = 'ready' | 'working' | 'offline' | 'error';
type ToolPermissionLevel = 'off' | 'read' | 'files' | 'full';
type ModelProvider = 'ollama' | 'openai' | 'deepseek' | 'athena-cloud' | 'custom';
type RemoteModelProvider = Exclude<ModelProvider, 'ollama'>;

interface ToolCatalogItem {
  name: string;
  label: string;
  minimumLevel: Exclude<ToolPermissionLevel, 'off'>;
  signature: string;
  description: string;
  available: boolean;
  blockedReason?: 'permission' | 'sku';
}

interface ToolCatalog {
  mode: AthenaMode;
  permissionLevel: ToolPermissionLevel;
  tools: ToolCatalogItem[];
}

const MAX_RECORDING_MS = 60_000;
const WORK_MODES: readonly AthenaMode[] = ['create', 'reason', 'execute'];
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

interface MemoryReviewItem {
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
  evidence?: Array<{
    memoryTable: string;
    memoryId: number;
    sourceTable: string;
    sourceId?: number;
    chatWindowId?: number;
    projectId?: number;
    origin: string;
  }>;
}

interface ContextSnapshotRecord {
  id: number;
  project_id?: number;
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

interface ProjectDocumentRecord {
  id: number;
  project_id: number;
  name: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  parser: string;
  ocr_engine?: 'tesseract.js';
  ocr_languages: string[];
  needs_ocr: boolean;
  page_count?: number;
  char_count: number;
  chunk_count: number;
  status: 'ready' | 'error';
  error?: string;
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
  proceduralMemories: MemoryListItem[];
  temporalFacts: MemoryListItem[];
  relatedEvents: MemoryListItem[];
  dailySummaries: MemoryListItem[];
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
  contentMode: MemoryImportContentMode;
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
type MemoryImportContentMode = 'normal' | 'adult';

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

type AgentTaskStatus = 'draft' | 'ready' | 'active' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'archived';
type AgentRunStatus = 'completed' | 'paused' | 'failed' | 'cancelled';

interface AgentWorkspaceGoal {
  id: string;
  title: string;
  status: 'active' | 'achieved' | 'paused';
  createdAt: string;
  updatedAt: string;
}

interface AgentWorkspaceMetadata {
  version: 1;
  revision: number;
  roots: string[];
  goals: AgentWorkspaceGoal[];
  updatedAt: string;
}

interface AgentTaskRecord {
  id: string;
  projectId: number | null;
  chatWindowId: number | null;
  title: string;
  status: AgentTaskStatus;
  spec: {
    goal: string;
    plan: Array<{ id: string; title: string; successCriteria: string[] }>;
  };
  revision: number;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRunRecord {
  id: string;
  taskId: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  state: Record<string, unknown>;
  approvalGroupId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

interface AgentRunSnapshot {
  task: AgentTaskRecord;
  run: AgentRunRecord;
  steps: Array<{ id: string; sequence: number; title: string; kind: string; status: string; error: string | null }>;
  approvals: Array<{
    id: string;
    groupId: string;
    status: 'pending' | 'approved' | 'denied' | 'cancelled';
    capability: string;
    riskLevel: string;
    request: Record<string, unknown>;
  }>;
  artifacts: Array<{ id: string; name: string; kind: string; uri: string | null; validationStatus: string }>;
  events: Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: string }>;
}

interface AgentProjectWorkspaceSnapshot {
  project: { id: number; title: string; instructions: string };
  metadata: AgentWorkspaceMetadata;
  board: Record<AgentTaskStatus, AgentTaskRecord[]>;
  tasks: AgentTaskRecord[];
  selectedTask: AgentTaskRecord | null;
  runs: AgentRunRecord[];
  selectedRun: AgentRunSnapshot | null;
  recoverableRunIds: string[];
}

interface AgentRunnerResult {
  runId: string;
  status: AgentRunStatus;
  content: string;
  error: string | null;
  snapshot: AgentRunSnapshot;
}

interface AgentSkillSummary {
  name: string;
  description: string;
  version: string | null;
  source: 'builtin' | 'project' | 'user' | 'external';
  packageHash: string;
  trust: 'builtin' | 'approved' | 'untrusted' | 'quarantined';
  enabled: boolean;
  hasScripts: boolean;
  resourceCount: number;
  warnings: string[];
}

interface AgentSkillLibrarySnapshot {
  skills: AgentSkillSummary[];
  invocations: Array<{ skillName: string; runId: string; resourcePath: string; loadedAt: string }>;
  roots: Array<{ source: string; path: string }>;
  diagnostics: Array<{ source: string; path: string; error: string }>;
}

type McpTransportKind = 'stdio' | 'streamable-http';
type McpProtocolMode = 'legacy' | 'auto' | '2026-07-28';

interface McpServerInput {
  id?: string;
  name: string;
  transport: McpTransportKind;
  protocolMode: McpProtocolMode;
  stdio?: { command: string; args: string[]; cwd: string | null; envKeys: string[] };
  http?: { url: string; bearerTokenEnv: string | null };
}

interface McpServerConfig extends McpServerInput {
  id: string;
  configFingerprint: string;
  approvedFingerprint: string | null;
  enabled: boolean;
}

interface McpServerSnapshot extends McpServerConfig {
  status: 'disabled' | 'approval-required' | 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  instructions: string | null;
  tools: Array<{
    name: string;
    registeredName: string;
    title: string | null;
    description: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  }>;
  diagnostics: string[];
  connectedAt: string | null;
}

interface McpIntegrationSnapshot {
  servers: McpServerSnapshot[];
  connectedCount: number;
  registeredToolCount: number;
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
  importContentMode: MemoryImportContentMode;
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
  imageGeneration: boolean;
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

interface PersonaSummarySettings {
  id: string;
  displayName: string;
  nickname: string;
  visibility: 'public' | 'private';
  role: 'assistant' | 'companion' | 'character';
  description: string;
  source: 'builtin' | 'local' | 'fallback';
  sourcePath?: string;
}

interface PersonaCard {
  id: string;
  displayName: string;
  nickname: string;
  visibility: 'public' | 'private';
  role: 'assistant' | 'companion' | 'character';
  description: string;
  identity: string;
  relationshipFrame: string;
  prompt: {
    traits: string[];
    speakingStyle: string[];
    roleplayNotes: string[];
    boundaries: string[];
    selfIntroductionExample: string;
  };
}

interface PersonaEditorState {
  card: PersonaCard;
  source: 'builtin' | 'local' | 'fallback';
  sourcePath?: string;
  editable: boolean;
}

interface PersonaCardPatch {
  displayName: string;
  nickname: string;
  description: string;
  identity: string;
  relationshipFrame: string;
  traits: string[];
  speakingStyle: string[];
  roleplayNotes: string[];
  boundaries: string[];
  selfIntroductionExample: string;
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
  persona: PersonaSummarySettings;
  sku: 'desktop-direct' | 'steam' | 'microsoft-store';
}

const REMOTE_PROVIDER_BASE_URLS: Partial<Record<RemoteModelProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
};

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
  serviceReachable?: boolean;
  modelAvailable?: boolean;
  chatSucceeded?: boolean;
  durationMs?: number;
  error?: string;
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

interface DiagnosticHealthSnapshot {
  storage: { database: { quickCheck: 'ok' | 'failed' }; diagnostics: { files: number; bytes: number } };
  agent: { runsByStatus: Record<string, number> };
}

interface DiagnosticBundleResult {
  path: string;
  bytes: number;
  sha256: string;
  privacy: 'no-chat-content';
}

const appShell = mustGet<HTMLElement>('app-shell');
const themeController = new ThemeController(document.documentElement, appShell);
const selectControls = new SelectControlManager(appShell);
const titlebar = mustGet<HTMLElement>('titlebar');
const btnSidebar = mustGet<HTMLButtonElement>('btn-sidebar');
const activeChatTitle = mustGet<HTMLElement>('active-chat-title');
const activeProjectTitle = mustGet<HTMLElement>('active-project-title');
const modeSwitch = mustGet<HTMLElement>('mode-switch');
const workModeSwitch = mustGet<HTMLElement>('work-mode-switch');
const lifeCore = mustGet<HTMLElement>('life-core');
const chatWindowBar = mustGet<HTMLElement>('chat-window-bar');
const modeExecuteButton = mustGet<HTMLButtonElement>('mode-execute-button');
const projectSelect = mustGet<HTMLSelectElement>('project-select');
const projectNew = mustGet<HTMLButtonElement>('project-new');
const projectInstructions = mustGet<HTMLButtonElement>('project-instructions');
const chatWindowSelect = mustGet<HTMLSelectElement>('chat-window-select');
const chatWindowList = mustGet<HTMLElement>('chat-window-list');
const chatWindowNew = mustGet<HTMLButtonElement>('chat-window-new');
const chatWindowTemporary = mustGet<HTMLButtonElement>('chat-window-temporary');
const chatWindowRename = mustGet<HTMLButtonElement>('chat-window-rename');
const chatWindowArchive = mustGet<HTMLButtonElement>('chat-window-archive');
const chatWindowDelete = mustGet<HTMLButtonElement>('chat-window-delete');
const temporaryChatBadge = mustGet<HTMLElement>('temporary-chat-badge');
const stage = mustGet<HTMLElement>('stage');
const presenceActions = mustGet<HTMLElement>('presence-actions');
const chatPanel = new ChatPanel(
  mustGet<HTMLElement>('chat-container'),
  attachment => window.athenaAPI.getChatAttachmentPreview(attachment.window_id, attachment.id),
);
const live2dCompanion = new DisabledLive2DCompanion({
  root: mustGet<HTMLElement>('live2d-companion'),
  canvas: mustGet<HTMLCanvasElement>('live2d-companion-canvas'),
});
const inputForm = mustGet<HTMLFormElement>('input-form');
const inputBox = mustGet<HTMLTextAreaElement>('input-box');
const inputBar = new InputBar(
  inputForm,
  inputBox,
  mustGet<HTMLButtonElement>('send-btn'),
);

const statusDot = mustGet<HTMLElement>('status-dot');
const statusText = mustGet<HTMLElement>('status-text');
const modelStatusButton = mustGet<HTMLButtonElement>('model-status-button');
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
const availableToolsBtn = mustGet<HTMLButtonElement>('available-tools-btn');
const chatFileBtn = mustGet<HTMLButtonElement>('chat-file-btn');
const projectDocumentBtn = mustGet<HTMLButtonElement>('project-document-btn');
const projectDocumentOcrBtn = mustGet<HTMLButtonElement>('project-document-ocr-btn');
const composerAttachments = mustGet<HTMLElement>('composer-attachments');
const webSearchLabel = mustGet<HTMLElement>('web-search-label');
const modeHint = mustGet<HTMLElement>('mode-hint');
const toolAccessHint = mustGet<HTMLElement>('tool-access-hint');
const panelScrim = mustGet<HTMLElement>('panel-scrim');
const toolsPanel = mustGet<HTMLElement>('tools-panel');
const btnToolsClose = mustGet<HTMLButtonElement>('btn-tools-close');
const toolsPanelSummary = mustGet<HTMLElement>('tools-panel-summary');
const toolsPanelFilter = mustGet<HTMLElement>('tools-panel-filter');
const toolsPanelList = mustGet<HTMLElement>('tools-panel-list');
const executionPanel = mustGet<HTMLElement>('execution-panel');
const agentExecutionFeedback = mustGet<HTMLElement>('agent-execution-feedback');
const executionCurrentCard = mustGet<HTMLElement>('execution-current-card');
const executionStateLabel = mustGet<HTMLElement>('execution-state-label');
const executionCurrentGoal = mustGet<HTMLElement>('execution-current-goal');
const executionCurrentMeta = mustGet<HTMLElement>('execution-current-meta');
const executionCurrentResult = mustGet<HTMLElement>('execution-current-result');
const executionLiveLog = mustGet<HTMLOListElement>('execution-live-log');
const executionHistory = mustGet<HTMLElement>('execution-history');
const executionStop = mustGet<HTMLButtonElement>('execution-stop');
const agentRunResume = mustGet<HTMLButtonElement>('agent-run-resume');
const executionClear = mustGet<HTMLButtonElement>('execution-clear');
const executionSettingsForm = mustGet<HTMLFormElement>('execution-settings-form');
const executionSettingsFeedback = mustGet<HTMLElement>('execution-settings-feedback');
const executionCurrentPermission = mustGet<HTMLElement>('execution-current-permission');
const agentProjectTitle = mustGet<HTMLElement>('agent-project-title');
const agentWorkspaceRevision = mustGet<HTMLElement>('agent-workspace-revision');
const agentRootList = mustGet<HTMLElement>('agent-root-list');
const agentRootForm = mustGet<HTMLFormElement>('agent-root-form');
const agentRootInput = mustGet<HTMLInputElement>('agent-root-input');
const agentGoalList = mustGet<HTMLElement>('agent-goal-list');
const agentGoalForm = mustGet<HTMLFormElement>('agent-goal-form');
const agentGoalInput = mustGet<HTMLInputElement>('agent-goal-input');
const agentWorkspaceRefresh = mustGet<HTMLButtonElement>('agent-workspace-refresh');
const agentTaskBoard = mustGet<HTMLElement>('agent-task-board');
const agentApprovalSection = mustGet<HTMLElement>('agent-approval-section');
const agentApprovalList = mustGet<HTMLElement>('agent-approval-list');
const agentPlanList = mustGet<HTMLElement>('agent-plan-list');
const agentArtifactList = mustGet<HTMLElement>('agent-artifact-list');
const skillInstall = mustGet<HTMLButtonElement>('skill-install');
const skillLibrarySummary = mustGet<HTMLElement>('skill-library-summary');
const skillLibraryList = mustGet<HTMLElement>('skill-library-list');
const mcpAddToggle = mustGet<HTMLButtonElement>('mcp-add-toggle');
const mcpIntegrationSummary = mustGet<HTMLElement>('mcp-integration-summary');
const mcpIntegrationList = mustGet<HTMLElement>('mcp-integration-list');
const mcpServerForm = mustGet<HTMLFormElement>('mcp-server-form');
const mcpServerId = mustGet<HTMLInputElement>('mcp-server-id');
const mcpServerName = mustGet<HTMLInputElement>('mcp-server-name');
const mcpServerTransport = mustGet<HTMLSelectElement>('mcp-server-transport');
const mcpServerProtocol = mustGet<HTMLSelectElement>('mcp-server-protocol');
const mcpStdioFields = mustGet<HTMLElement>('mcp-stdio-fields');
const mcpHttpFields = mustGet<HTMLElement>('mcp-http-fields');
const mcpServerCommand = mustGet<HTMLInputElement>('mcp-server-command');
const mcpServerCwd = mustGet<HTMLInputElement>('mcp-server-cwd');
const mcpServerArgs = mustGet<HTMLTextAreaElement>('mcp-server-args');
const mcpServerEnv = mustGet<HTMLTextAreaElement>('mcp-server-env');
const mcpServerUrl = mustGet<HTMLInputElement>('mcp-server-url');
const mcpServerTokenEnv = mustGet<HTMLInputElement>('mcp-server-token-env');
const mcpFormCancel = mustGet<HTMLButtonElement>('mcp-form-cancel');
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
const memoryReviewStatus = mustGet<HTMLSelectElement>('memory-review-status');
const memoryReviewRefresh = mustGet<HTMLButtonElement>('memory-review-refresh');
const memoryReviewApproveVisible = mustGet<HTMLButtonElement>('memory-review-approve-visible');
const memoryReviewRejectVisible = mustGet<HTMLButtonElement>('memory-review-reject-visible');
const memoryReviewSummary = mustGet<HTMLElement>('memory-review-summary');
const memoryReviewList = mustGet<HTMLElement>('memory-review-list');
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
const windowProjectDocuments = mustGet<HTMLElement>('window-project-documents');
const windowContextSummary = mustGet<HTMLElement>('window-context-summary');
const windowContextBudget = mustGet<HTMLElement>('window-context-budget');
const settingsPanel = mustGet<HTMLElement>('settings-panel');
const btnSettingsClose = mustGet<HTMLButtonElement>('btn-settings-close');
const settingsForm = mustGet<HTMLFormElement>('settings-form');
const settingLaunchStartup = mustGet<HTMLInputElement>('setting-launch-startup');
const settingCloseTray = mustGet<HTMLInputElement>('setting-close-tray');
const settingNotifications = mustGet<HTMLInputElement>('setting-notifications');
const settingAutoConnectModel = mustGet<HTMLInputElement>('setting-auto-connect-model');
const settingPersonaProfile = mustGet<HTMLInputElement>('setting-persona-profile');
const personaImportJson = createPersonaImportJsonButton();
const personaCardSummary = mustGet<HTMLElement>('persona-card-summary');
const personaDisplayName = mustGet<HTMLInputElement>('persona-display-name');
const personaNickname = mustGet<HTMLInputElement>('persona-nickname');
const personaIdentity = mustGet<HTMLTextAreaElement>('persona-identity');
const personaRelationship = mustGet<HTMLTextAreaElement>('persona-relationship');
const personaTraits = mustGet<HTMLTextAreaElement>('persona-traits');
const personaSpeakingStyle = mustGet<HTMLTextAreaElement>('persona-speaking-style');
const personaRoleplayNotes = mustGet<HTMLTextAreaElement>('persona-roleplay-notes');
const personaBoundaries = mustGet<HTMLTextAreaElement>('persona-boundaries');
const personaSelfIntro = mustGet<HTMLTextAreaElement>('persona-self-intro');
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
const settingLive2dEnabled = mustGet<HTMLInputElement>('setting-live2d-enabled');
const settingLive2dLayout = mustGet<HTMLSelectElement>('setting-live2d-layout');
const settingLive2dScale = mustGet<HTMLInputElement>('setting-live2d-scale');
const settingLive2dOpacity = mustGet<HTMLInputElement>('setting-live2d-opacity');
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
const modelDiagnostics = mustGet<HTMLElement>('model-diagnostics');
const modelDiagnosticService = mustGet<HTMLElement>('model-diagnostic-service');
const modelDiagnosticModel = mustGet<HTMLElement>('model-diagnostic-model');
const modelDiagnosticChat = mustGet<HTMLElement>('model-diagnostic-chat');
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
const settingOpenMemoryReview = mustGet<HTMLButtonElement>('setting-open-memory-review');
const settingOpenMemoryManage = mustGet<HTMLButtonElement>('setting-open-memory-manage');
const settingMemoryReviewSummary = mustGet<HTMLElement>('setting-memory-review-summary');
const settingMemoryImportMode = createMemoryImportModeControl();
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
const settingConsentImageGeneration = mustGet<HTMLInputElement>('setting-consent-image-generation');
const settingConsentExternalToolNetwork = mustGet<HTMLInputElement>('setting-consent-external-tool-network');
const privacyDataMap = mustGet<HTMLElement>('privacy-data-map');
const privacyStaticDecision = mustGet<HTMLElement>('privacy-static-decision');
const privacyExport = mustGet<HTMLButtonElement>('privacy-export');
const privacyClear = mustGet<HTMLButtonElement>('privacy-clear');
const diagnosticsExport = mustGet<HTMLButtonElement>('diagnostics-export');
const diagnosticsClear = mustGet<HTMLButtonElement>('diagnostics-clear');
const diagnosticsSummary = mustGet<HTMLElement>('diagnostics-summary');
const settingsFeedback = mustGet<HTMLElement>('settings-feedback');

relaxPersonaEditorInputLimits();

const liquidGlassRenderer = new LiquidGlassRenderer([modeSwitch, workModeSwitch, inputForm], appShell);
const liveGlass = new LiveGlass(
  [titlebar, modeSwitch, workModeSwitch, chatWindowBar, inputForm, memoryPanel, settingsPanel, toolsPanel],
  appShell,
  lifeCore,
  [modeSwitch, workModeSwitch, inputForm],
  motion => liquidGlassRenderer.update(motion),
);
const motionSystem = new MotionSystem(appShell, inputForm);
appShell.appendChild(composerSecondaryTools);

const TEMPORARY_CHAT_LABEL = '临时聊天';
const TEMPORARY_CHAT_BADGE = '临时聊天：只在本窗口保留，关闭后清除';
const TEMPORARY_CHAT_META = '临时聊天：不写入长期记忆';
const NEW_CHAT_TITLE = '新对话';

let isStreaming = false;
let isOcrImporting = false;
let currentContent = '';
let live2dStreamingStarted = false;
let currentImportPreview: MemoryImportPreview | null = null;
let currentMemoryReviewItems: MemoryReviewItem[] = [];
let currentSettingsBundle: SettingsBundle | null = null;
let currentPersonaEditorState: PersonaEditorState | null = null;
let currentMode: AthenaMode = 'companion';
let currentWorkMode: AthenaMode = 'create';
let projects: AthenaProjectRecord[] = [];
let currentProjectId: number | null = null;
let chatWindows: ChatWindowRecord[] = [];
let currentChatWindowId: number | null = null;
let currentChatWindowMessages: ChatMessageSnapshot[] = [];
const pendingChatAttachments = new Map<number, ChatAttachmentSnapshot[]>();
let activeRequestMode: AthenaMode | null = null;
let pendingExecutionGoal = '';
let pendingExecutionMode: AthenaMode = 'companion';
let currentExecutionTask: ExecutionTask | null = null;
let executionTasks: ExecutionTask[] = [];
let executionTaskSequence = 0;
let agentWorkspace: AgentProjectWorkspaceSnapshot | null = null;
let selectedAgentTaskId: string | undefined;
let agentWorkspaceLoading = false;
let skillLibrarySnapshot: AgentSkillLibrarySnapshot | null = null;
let mcpIntegrationSnapshot: McpIntegrationSnapshot | null = null;
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
let currentToolCatalog: ToolCatalog | null = null;
let toolCatalogFilter: 'all' | 'available' | 'locked' = 'all';
let lastModelConnectionStatus: ModelConnectionStatus | null = null;

const microphoneRecorder = new MicrophoneRecorder({
  onVolume: updateMicrophoneMeter,
  onError: handleMicrophoneRecorderError,
});

function setStatus(text: string, state: AppStatusState): void {
  statusText.textContent = text;
  statusDot.dataset.state = state;
  appShell.dataset.state = state === 'working' ? 'thinking' : 'idle';
}

function currentPersonaLabel(): string {
  return currentSettingsBundle?.persona.nickname
    || currentSettingsBundle?.persona.displayName
    || 'Athena';
}

function setMode(mode: AthenaMode): void {
  const previousSpace = spaceForMode(currentMode);
  const nextSpace = spaceForMode(mode);
  motionSystem.beginSpaceTransition(previousSpace, nextSpace);
  currentMode = mode;
  if (mode !== 'companion') currentWorkMode = mode;
  appShell.dataset.mode = mode;
  appShell.dataset.space = nextSpace;
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
  document.querySelectorAll<HTMLButtonElement>('.space-btn').forEach((button) => {
    const active = button.dataset.space === nextSpace;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  workModeSwitch.setAttribute('aria-hidden', String(nextSpace !== 'work'));
  syncToolAccessHint();
  if (toolsPanel.dataset.open === 'true') void loadToolCatalog();
  if (mode === 'execute') {
    void refreshAgentWorkspace();
    void refreshSkillLibrary();
    void refreshMcpIntegrations();
  }
}

function setModeSwitchDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.mode-btn, .space-btn').forEach((button) => {
    button.disabled = disabled;
  });
}

function handleModeSwitchKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const spaces: readonly AthenaSpace[] = ['companion', 'work'];
  const currentSpace = spaceForMode(currentMode);
  const currentIndex = spaces.indexOf(currentSpace);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - currentIndex;
  const nextSpace = spaces[nextIndex];
  const nextButton = modeSwitch.querySelector<HTMLButtonElement>(`.space-btn[data-space="${nextSpace}"]`);
  nextButton?.focus({ preventScroll: true });
  void selectMode(nextSpace === 'companion' ? 'companion' : currentWorkMode);
}

function handleWorkModeSwitchKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, WORK_MODES.indexOf(currentMode));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? WORK_MODES.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + WORK_MODES.length) % WORK_MODES.length;
  const nextMode = WORK_MODES[nextIndex];
  workModeSwitch.querySelector<HTMLButtonElement>(`.mode-btn[data-mode="${nextMode}"]`)?.focus({ preventScroll: true });
  void selectMode(nextMode);
}

function spaceForMode(mode: AthenaMode): AthenaSpace {
  return mode === 'companion' ? 'companion' : 'work';
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

function syncLive2dSettingsControls(): void {
  const preferences = live2dCompanion.settings;
  settingLive2dEnabled.checked = RELEASE_FEATURES.live2d && preferences.enabled;
  settingLive2dEnabled.disabled = true;
  settingLive2dLayout.value = preferences.layout;
  settingLive2dLayout.disabled = true;
  settingLive2dScale.value = String(preferences.scale);
  settingLive2dScale.disabled = true;
  settingLive2dOpacity.value = String(preferences.opacity);
  settingLive2dOpacity.disabled = true;
}

async function dispatchLive2dEvent(event: AthenaAvatarEvent): Promise<void> {
  if (!RELEASE_FEATURES.live2d) return;
  window.athenaAPI.sendDesktopPetEvent(event);
  await live2dCompanion.dispatch(event);
}

async function setLive2dEmotion(label?: string, intensity = 1): Promise<void> {
  if (!RELEASE_FEATURES.live2d) return;
  const event: AthenaAvatarEvent = { type: 'emotion.update', emotion: emotionFromLabel(label), intensity };
  window.athenaAPI.sendDesktopPetEvent(event);
  await live2dCompanion.setEmotionLabel(label, intensity);
}

async function syncDesktopPetWindow(): Promise<void> {
  if (!RELEASE_FEATURES.live2d) return;
  const preferences = live2dCompanion.settings;
  window.athenaAPI.sendDesktopPetEvent({
    type: 'preferences.update',
    scale: preferences.scale,
    opacity: preferences.opacity,
    outfitId: preferences.outfitId,
  });
  const visible = preferences.enabled && preferences.layout === 'desktop_pet';
  await window.athenaAPI.setDesktopPetWindowVisible(visible);
}

async function updateLive2dPreferences(
  patch: Partial<{ enabled: boolean; layout: AvatarLayoutMode; scale: number; opacity: number; outfitId: string }>,
): Promise<void> {
  if (!RELEASE_FEATURES.live2d) return;
  await live2dCompanion.updatePreferences(patch);
  await syncDesktopPetWindow();
}

async function sendAvatarInteraction(prompt: string, hotZoneId: string): Promise<void> {
  if (!prompt.trim() || isStreaming || isVoiceInputBusy()) return;
  if (!currentChatWindowId) await initializeChatWindows();

  isStreaming = true;
  live2dStreamingStarted = false;
  activeRequestMode = 'companion';
  currentContent = '';
  setStatus('Athena 正在回应互动', 'working');
  inputBar.setDisabled(true);
  syncVoiceControls();
  await dispatchLive2dEvent({ type: 'chat.thinking.start' });

  try {
    const response = await window.athenaAPI.sendMessage(
      prompt,
      'companion',
      false,
      currentChatWindowId ?? undefined,
    );
    if (response) modelConnected = true;
    if (!currentContent && response?.content) {
      chatPanel.addMessage(response.content, 'assistant', response.emotion?.label);
    } else if (response?.emotion?.label) {
      chatPanel.setLastAssistantEmotion(response.emotion.label);
    }
    await setLive2dEmotion(response?.emotion?.label);
    if (!response) throw new Error(`互动 ${hotZoneId} 暂时没有收到回复`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dispatchLive2dEvent({ type: 'chat.error', message });
  } finally {
    activeRequestMode = null;
    isStreaming = false;
    inputBar.setDisabled(false);
    syncVoiceControls();
    restoreIdleStatus();
    if (currentSettingsBundle?.settings.voice.autoPlayAssistant) void speakLastAssistantMessage();
    else void dispatchLive2dEvent({ type: 'app.ready' });
    await refreshChatWindows();
  }
}

async function sendMessage(text: string): Promise<void> {
  const queuedAttachments = currentPendingAttachments();
  const effectiveText = text.trim() || (queuedAttachments.length > 0 ? '请查看并理解这些附件。' : '');
  if (!effectiveText || isStreaming || isVoiceInputBusy()) return;
  if (!currentChatWindowId) await initializeChatWindows();
  const requestChatWindowId = currentChatWindowId;

  const titleUpdate = autoTitleCurrentChatWindow(effectiveText);
  let forceWebSearch = forceWebSearchForNextMessage;
  let requestMode = currentMode;
  forceWebSearchForNextMessage = false;
  try {
    const routing = await window.athenaAPI.routeMessage(
      effectiveText,
      requestMode,
      forceWebSearch,
      currentChatWindowId ?? undefined,
      queuedAttachments.map(attachment => attachment.id),
    );
    if (routing?.route === 'web_research') forceWebSearch = true;
    if (routing?.route === 'durable_execution' && routing.autoSwitch && requestMode !== 'execute') {
      await selectMode('execute');
      requestMode = 'execute';
    }
  } catch (error) {
    console.error('Message route preflight failed', error);
  }
  toggleComposerTools(false);
  resizeInputBox();
  activeRequestMode = requestMode;
  if (requestMode === 'execute') {
    setAgentExecutionFeedback('');
    beginExecutionRequest(effectiveText);
  }
  else {
    const userMessage = chatPanel.addMessage(effectiveText, 'user', undefined, requestMode, undefined, true, queuedAttachments);
    motionSystem.animateSentMessage(userMessage, effectiveText);
  }
  setStatus(modeThinkingText(requestMode), 'working');
  isStreaming = true;
  live2dStreamingStarted = false;
  void dispatchLive2dEvent({ type: 'chat.thinking.start' });
  renderChatWindowPicker();
  setModeSwitchDisabled(true);
  inputBar.setDisabled(true);
  syncVoiceControls();
  syncWebSearchControl();
  currentContent = '';
  pendingExecutionGoal = effectiveText;
  pendingExecutionMode = requestMode;
  if (currentChatWindowId) {
    pendingChatAttachments.delete(currentChatWindowId);
    renderComposerAttachments();
  }

  try {
    const response = await window.athenaAPI.sendMessage(
      effectiveText,
      requestMode,
      forceWebSearch,
      currentChatWindowId ?? undefined,
      queuedAttachments.map(attachment => attachment.id),
    );
    if (response) modelConnected = true;
    const serverRoutedExecution = requestMode !== 'execute'
      && response?.routing?.route === 'durable_execution'
      && Boolean(response.agentExecution?.taskId);
    if (requestMode === 'execute') {
      if (response?.agentExecution?.taskId) selectedAgentTaskId = response.agentExecution.taskId;
      setAgentExecutionFeedback(response?.agentExecution ? '' : response?.content || '任务未能启动。');
      finishExecutionTask(response?.toolExecutions ?? [], response?.content || currentContent);
      await refreshAgentWorkspace(selectedAgentTaskId);
    } else {
      if (!currentContent && response?.content) {
        chatPanel.addMessage(response.content, 'assistant', response.emotion?.label);
      } else if (response?.emotion?.label) {
        chatPanel.setLastAssistantEmotion(response.emotion.label);
      }
      void setLive2dEmotion(response?.emotion?.label);
      if (response?.webSearch?.sources?.length) {
        chatPanel.setLastAssistantSources(response.webSearch.sources, {
          readPageCount: response.webSearch.readPageCount,
          searchRounds: response.webSearch.searchRounds,
        });
      }
      if (serverRoutedExecution && response?.agentExecution?.taskId) {
        selectedAgentTaskId = response.agentExecution.taskId;
        await selectMode('execute');
        await refreshAgentWorkspace(selectedAgentTaskId);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    if (requestMode === 'execute') {
      setAgentExecutionFeedback(`任务未启动：${message}`);
      failActiveExecutionTask(message);
    }
    else {
      chatPanel.addMessage(`出错了：${message}`, 'assistant', '需要检查');
      void dispatchLive2dEvent({ type: 'chat.error', message });
    }
  } finally {
    if (requestChatWindowId && queuedAttachments.length > 0) {
      await reconcileQueuedAttachments(requestChatWindowId, queuedAttachments);
    }
    await titleUpdate;
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
    } else if (requestMode !== 'execute') {
      void dispatchLive2dEvent({ type: 'app.ready' });
    }
    await refreshChatWindows();
    await refreshWindowMemoryPanel();
  }
}

async function reconcileQueuedAttachments(windowId: number, queued: ChatAttachmentSnapshot[]): Promise<void> {
  try {
    const messages = await window.athenaAPI.getChatWindowMessages(windowId, 300);
    const attachedIds = new Set(messages.flatMap(message => message.attachments || []).map(attachment => attachment.id));
    const stillPending = queued.filter(attachment => !attachedIds.has(attachment.id));
    if (stillPending.length > 0) pendingChatAttachments.set(windowId, stillPending);
    else pendingChatAttachments.delete(windowId);
    if (currentChatWindowId === windowId) renderComposerAttachments();
  } catch {
    pendingChatAttachments.set(windowId, queued);
    if (currentChatWindowId === windowId) renderComposerAttachments();
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
  selectControls.enhance();
  setMode('companion');
  renderExecutionCenter();
  appShell.dataset.sidebar = window.innerWidth <= 860 ? 'closed' : 'open';
  inputForm.dataset.voiceState = 'idle';
  voiceFeedback.dataset.visible = 'false';
  syncLive2dSettingsControls();
  if (RELEASE_FEATURES.live2d) {
    void live2dCompanion.load().then(() => syncDesktopPetWindow());
    window.athenaAPI.onDesktopPetInteraction(({ prompt, hotZoneId }) => {
      void sendAvatarInteraction(prompt, hotZoneId);
    });
  }
  void initializeSettings();
  inputBar.onSubmit(sendMessage, () => currentPendingAttachments().length > 0);
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
  chatWindowList.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-chat-window-id]') : null;
    const id = Number(target?.dataset.chatWindowId);
    if (Number.isInteger(id) && id > 0) void switchChatWindow(id);
  });
  chatWindowNew.addEventListener('click', () => void createNewChatWindow());
  chatWindowTemporary.addEventListener('click', () => void createTemporaryChatWindow());
  chatWindowRename.addEventListener('click', () => void renameCurrentChatWindow());
  chatWindowArchive.addEventListener('click', () => void archiveCurrentChatWindow());
  chatWindowDelete.addEventListener('click', () => void deleteCurrentChatWindow());
  presenceActions.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.presence-action') : null;
    const prompt = button?.dataset.prompt?.trim();
    if (!prompt) return;
    inputBox.value = prompt;
    resizeInputBox();
    inputBox.focus({ preventScroll: true });
    inputBox.setSelectionRange(prompt.length, prompt.length);
  });

  document.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.mode as AthenaMode | undefined;
      if (nextMode) void selectMode(nextMode);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.space-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const nextSpace = button.dataset.space as AthenaSpace | undefined;
      if (nextSpace) void selectMode(nextSpace === 'companion' ? 'companion' : currentWorkMode);
    });
  });
  modeSwitch.addEventListener('keydown', handleModeSwitchKeydown);
  workModeSwitch.addEventListener('keydown', handleWorkModeSwitchKeydown);

  executionStop.addEventListener('click', cancelActiveExecution);
  agentRunResume.addEventListener('click', () => void resumeSelectedAgentRun());
  executionClear.addEventListener('click', () => void refreshAgentWorkspace(selectedAgentTaskId));
  executionHistory.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-agent-task-id]') : null;
    if (button?.dataset.agentTaskId) void refreshAgentWorkspace(button.dataset.agentTaskId);
  });
  agentWorkspaceRefresh.addEventListener('click', () => void refreshAgentWorkspace(selectedAgentTaskId));
  skillInstall.addEventListener('click', () => void installSkillFromDirectory());
  skillLibraryList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-skill-action]') : null;
    const name = button?.dataset.skillName;
    const packageHash = button?.dataset.skillHash;
    if (button && name && packageHash) void handleSkillAction(button.dataset.skillAction || '', name, packageHash);
  });
  mcpAddToggle.addEventListener('click', () => openMcpServerForm());
  mcpFormCancel.addEventListener('click', closeMcpServerForm);
  mcpServerTransport.addEventListener('change', syncMcpTransportFields);
  mcpServerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveMcpServer();
  });
  mcpIntegrationList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-mcp-action]') : null;
    const id = button?.dataset.mcpId;
    if (button && id) void handleMcpAction(button.dataset.mcpAction || '', id, button.dataset.mcpFingerprint || '');
  });
  agentRootForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void addAgentWorkspaceRoot();
  });
  agentGoalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void addAgentWorkspaceGoal();
  });
  agentRootList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-agent-root-index]') : null;
    if (button) void removeAgentWorkspaceRoot(Number(button.dataset.agentRootIndex));
  });
  agentGoalList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-agent-goal-id]') : null;
    if (button?.dataset.agentGoalId) void cycleAgentWorkspaceGoal(button.dataset.agentGoalId);
  });
  agentTaskBoard.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-agent-task-id]') : null;
    if (button?.dataset.agentTaskId) void refreshAgentWorkspace(button.dataset.agentTaskId);
  });
  agentApprovalList.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-agent-approval-id]') : null;
    const decision = button?.dataset.decision;
    if (button?.dataset.agentApprovalId && (decision === 'approved' || decision === 'denied')) {
      void resolveAgentApproval(button.dataset.agentApprovalId, decision);
    }
  });
  executionSettingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveExecutionSettings();
  });
  settingsOpenExecution.addEventListener('click', () => {
    void toggleSettingsPanel(false);
    void selectMode('execute');
  });
  settingOpenMemoryReview.addEventListener('click', () => {
    void openMemoryPanelTab('review');
  });
  settingOpenMemoryManage.addEventListener('click', () => {
    void openMemoryPanelTab('manage');
  });
  btnSettings.addEventListener('click', () => toggleSettingsPanel());
  modelStatusButton.addEventListener('click', () => void openModelSettings());
  btnSettingsClose.addEventListener('click', () => toggleSettingsPanel(false));
  panelScrim.addEventListener('click', () => {
    void toggleMemoryPanel(false);
    void toggleSettingsPanel(false);
    void toggleToolsPanel(false);
  });
  btnSidebar.addEventListener('click', () => toggleSidebar());
  availableToolsBtn.addEventListener('click', () => void toggleToolsPanel(true));
  btnToolsClose.addEventListener('click', () => void toggleToolsPanel(false));
  toolsPanelFilter.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-tool-filter]') : null;
    const filter = button?.dataset.toolFilter;
    if (filter !== 'all' && filter !== 'available' && filter !== 'locked') return;
    toolCatalogFilter = filter;
    toolsPanelFilter.querySelectorAll<HTMLButtonElement>('[data-tool-filter]').forEach(item => {
      const active = item.dataset.toolFilter === filter;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (currentToolCatalog) renderToolCatalog(currentToolCatalog);
  });
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsForm();
  });
  settingPersonaProfile.addEventListener('change', () => {
    void loadPersonaEditorState(settingPersonaProfile.value.trim() || 'default');
  });
  personaImportJson.addEventListener('click', () => void importPersonaJsonFile());
  settingTheme.addEventListener('change', () => {
    themeController.apply(settingTheme.value as ThemeMode, true);
  });
  settingAnimationLevel.addEventListener('change', () => {
    appShell.dataset.animation = settingAnimationLevel.value;
    liveGlass.setMotionReduced(settingAnimationLevel.value === 'low');
    liquidGlassRenderer.setMotionReduced(settingAnimationLevel.value === 'low');
    motionSystem.setMotionReduced(settingAnimationLevel.value === 'low');
  });
  settingGlassEffects.addEventListener('change', () => {
    appShell.dataset.glass = String(settingGlassEffects.checked);
    liquidGlassRenderer.setEnabled(settingGlassEffects.checked);
  });
  settingLive2dEnabled.addEventListener('change', () => {
    void updateLive2dPreferences({ enabled: settingLive2dEnabled.checked });
  });
  settingLive2dLayout.addEventListener('change', () => {
    void updateLive2dPreferences({ layout: settingLive2dLayout.value as AvatarLayoutMode });
  });
  settingLive2dScale.addEventListener('input', () => {
    void updateLive2dPreferences({ scale: Number(settingLive2dScale.value) });
  });
  settingLive2dOpacity.addEventListener('input', () => {
    void updateLive2dPreferences({ opacity: Number(settingLive2dOpacity.value) });
  });
  settingModelProvider.addEventListener('change', () => {
    populateSelectedModelProvider();
    void refreshModelCredentialStatus();
  });
  settingRemoteUrl.addEventListener('blur', () => {
    const provider = selectedRemoteModelProvider();
    if (provider) settingRemoteUrl.value = normalizeRemoteBaseUrl(provider, settingRemoteUrl.value);
  });
  modelFirstRunChoice.querySelectorAll<HTMLButtonElement>('[data-model-path]').forEach(button => {
    button.addEventListener('click', () => {
      const path = button.dataset.modelPath;
      settingModelProvider.value = path === 'local' ? 'ollama' : 'choose-api';
      selectControls.sync();
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
  diagnosticsExport.addEventListener('click', () => void exportDiagnosticSupport());
  diagnosticsClear.addEventListener('click', () => void clearDiagnostics());
  inputBox.addEventListener('keydown', handleInputKeydown);
  inputBox.addEventListener('input', resizeInputBox);
  composerMoreBtn.addEventListener('click', () => toggleComposerTools());
  chatFileBtn.addEventListener('click', () => void chooseChatFiles());
  projectDocumentBtn.addEventListener('click', () => void chooseProjectDocuments());
  projectDocumentOcrBtn.addEventListener('click', () => void chooseScannedProjectPdfs());
  window.addEventListener('resize', () => positionComposerTools());
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
  memoryReviewStatus.addEventListener('change', () => loadMemoryReviewQueue());
  memoryReviewRefresh.addEventListener('click', () => loadMemoryReviewQueue());
  memoryReviewApproveVisible.addEventListener('click', () => void approveVisibleMemoryReviews());
  memoryReviewRejectVisible.addEventListener('click', () => void rejectVisibleMemoryReviews());
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
    if (event.key === 'Escape' && (memoryPanel.dataset.open === 'true' || settingsPanel.dataset.open === 'true' || toolsPanel.dataset.open === 'true')) {
      event.preventDefault();
      void toggleMemoryPanel(false);
      void toggleSettingsPanel(false);
      void toggleToolsPanel(false);
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
    void live2dCompanion.destroy();
    liveGlass.dispose();
    liquidGlassRenderer.dispose();
    motionSystem.dispose();
    selectControls.dispose();
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
      if (!live2dStreamingStarted) {
        live2dStreamingStarted = true;
        void dispatchLive2dEvent({ type: 'chat.streaming.start' });
      }
      chatPanel.updateStreamingMessage(currentContent);
    }
  });

  window.athenaAPI.onChatError((error) => {
    modelConnected = false;
    isStreaming = false;
    inputBar.setDisabled(false);
    syncVoiceControls();
    setStatus('模型离线', 'offline');
    void dispatchLive2dEvent({ type: 'chat.error', message: error });
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

  window.athenaAPI.onAgentWorkspaceChanged((event) => {
    if (event.projectId !== currentProjectId) return;
    if (event.taskId) selectedAgentTaskId = event.taskId;
    void refreshAgentWorkspace(selectedAgentTaskId);
  });

  window.setInterval(() => {
    if (currentMode !== 'execute' || !agentWorkspace?.selectedRun) return;
    const status = agentWorkspace.selectedRun.run.status;
    if (status === 'queued' || status === 'running') void refreshAgentWorkspace(selectedAgentTaskId);
  }, 1_200);

  inputBar.focus();
  resizeInputBox();
}

function webSearchProviderLabel(provider?: WebSearchStatus['provider']): string {
  if (provider === 'sogou') return '搜狗 · ';
  if (provider === 'bing') return '必应 · ';
  if (provider === 'duckduckgo') return 'DuckDuckGo · ';
  return '';
}

function setAgentExecutionFeedback(message: string): void {
  agentExecutionFeedback.textContent = message;
  agentExecutionFeedback.hidden = !message;
}

async function refreshSkillLibrary(): Promise<void> {
  try {
    skillLibrarySnapshot = await window.athenaAPI.getSkillLibrary();
    renderSkillLibrary();
  } catch (error) {
    skillLibrarySummary.textContent = `Skill 库读取失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderSkillLibrary(): void {
  const snapshot = skillLibrarySnapshot;
  if (!snapshot) {
    skillLibrarySummary.textContent = 'Skill 库不可用';
    renderAgentEmpty(skillLibraryList, '没有可显示的 Skill');
    return;
  }
  const trusted = snapshot.skills.filter(skill => skill.enabled && (skill.trust === 'approved' || skill.trust === 'builtin')).length;
  skillLibrarySummary.textContent = `${snapshot.skills.length} 个已发现 · ${trusted} 个可调用 · ${snapshot.invocations.length} 条真实加载记录 · ${snapshot.diagnostics.length} 个无效包`;
  if (snapshot.skills.length === 0) {
    renderAgentEmpty(skillLibraryList, '可安装符合 Agent Skills 规范的 SKILL.md 文件夹');
    return;
  }
  const items = snapshot.skills.map(skill => {
    const item = document.createElement('div');
    item.className = 'skill-library-item';
    const head = document.createElement('div');
    head.className = 'skill-library-item-head';
    const name = document.createElement('div');
    name.className = 'skill-library-name';
    name.textContent = skill.name;
    const trust = document.createElement('div');
    trust.className = 'execution-state-badge';
    trust.textContent = skillTrustLabel(skill.trust, skill.enabled);
    head.append(name, trust);
    const description = document.createElement('div');
    description.className = 'skill-library-description';
    description.textContent = skill.description;
    const meta = document.createElement('div');
    meta.className = 'skill-library-meta';
    meta.textContent = `${skill.source} · ${skill.version || '无版本'} · ${skill.resourceCount} 个资源${skill.hasScripts ? ' · 含脚本' : ''}`;
    const actions = document.createElement('div');
    actions.className = 'skill-library-actions';
    if (skill.trust !== 'builtin') {
      if (skill.trust !== 'approved') actions.append(createSkillAction('approve', '批准', skill));
      if (skill.trust !== 'quarantined') actions.append(createSkillAction('quarantine', '隔离', skill));
      if (skill.trust === 'approved') actions.append(createSkillAction(skill.enabled ? 'disable' : 'enable', skill.enabled ? '停用' : '启用', skill));
      if (skill.source === 'user') actions.append(createSkillAction('uninstall', '卸载', skill));
    }
    item.append(head, description, meta, actions);
    return item;
  });
  for (const diagnostic of snapshot.diagnostics.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'skill-library-item';
    const name = document.createElement('div');
    name.className = 'skill-library-name';
    name.textContent = '无效 Skill 包';
    const meta = document.createElement('div');
    meta.className = 'skill-library-meta';
    meta.textContent = `${diagnostic.source} · ${diagnostic.path}`;
    const description = document.createElement('div');
    description.className = 'skill-library-description';
    description.textContent = diagnostic.error;
    item.append(name, meta, description);
    items.push(item);
  }
  skillLibraryList.replaceChildren(...items);
}

function createSkillAction(action: string, label: string, skill: AgentSkillSummary): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.skillAction = action;
  button.dataset.skillName = skill.name;
  button.dataset.skillHash = skill.packageHash;
  button.textContent = label;
  return button;
}

async function handleSkillAction(action: string, name: string, packageHash: string): Promise<void> {
  try {
    if (action === 'approve') await window.athenaAPI.setSkillTrust(name, packageHash, 'approved');
    else if (action === 'quarantine') await window.athenaAPI.setSkillTrust(name, packageHash, 'quarantined');
    else if (action === 'enable' || action === 'disable') await window.athenaAPI.setSkillEnabled(name, packageHash, action === 'enable');
    else if (action === 'uninstall') await window.athenaAPI.uninstallSkill(name, packageHash);
    await refreshSkillLibrary();
  } catch (error) {
    setAgentExecutionFeedback(`Skill 操作失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function installSkillFromDirectory(): Promise<void> {
  skillInstall.disabled = true;
  try {
    const installed = await window.athenaAPI.installSkillFromDirectory(false);
    if (installed) setAgentExecutionFeedback(`已安装 ${installed.name}，请审查后批准；当前不会自动调用。`);
    await refreshSkillLibrary();
  } catch (error) {
    setAgentExecutionFeedback(`Skill 安装失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    skillInstall.disabled = false;
  }
}

function skillTrustLabel(trust: AgentSkillSummary['trust'], enabled: boolean): string {
  if (trust === 'builtin') return '内置可信';
  if (trust === 'quarantined') return '已隔离';
  if (trust === 'approved') return enabled ? '已启用' : '已批准';
  return '待审查';
}

async function refreshMcpIntegrations(): Promise<void> {
  try {
    mcpIntegrationSnapshot = await window.athenaAPI.getMcpIntegrations();
    renderMcpIntegrations();
  } catch (error) {
    mcpIntegrationSummary.textContent = `MCP 配置读取失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderMcpIntegrations(): void {
  const snapshot = mcpIntegrationSnapshot;
  if (!snapshot) {
    mcpIntegrationSummary.textContent = 'MCP 集成不可用';
    renderAgentEmpty(mcpIntegrationList, '尚未配置 MCP Server');
    return;
  }
  const approvalRequired = snapshot.servers.filter(server => server.status === 'approval-required').length;
  mcpIntegrationSummary.textContent = `${snapshot.servers.length} 个 Server · ${snapshot.connectedCount} 个已连接 · ${snapshot.registeredToolCount} 个已注册工具 · ${approvalRequired} 个待批准`;
  if (snapshot.servers.length === 0) {
    renderAgentEmpty(mcpIntegrationList, '尚未配置 MCP Server');
    return;
  }
  mcpIntegrationList.replaceChildren(...snapshot.servers.map(server => {
    const item = document.createElement('div');
    item.className = 'mcp-integration-item';
    const head = document.createElement('div');
    head.className = 'mcp-integration-head';
    const identity = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'skill-library-name';
    name.textContent = server.name;
    const meta = document.createElement('div');
    meta.className = 'skill-library-meta';
    meta.textContent = `${server.transport} · ${server.protocolMode}${server.serverName ? ` · ${server.serverName} ${server.serverVersion || ''}` : ''}`;
    identity.append(name, meta);
    const status = document.createElement('div');
    status.className = 'execution-state-badge';
    status.dataset.state = server.status === 'connected' ? 'completed' : server.status === 'error' ? 'failed' : 'idle';
    status.textContent = mcpStatusLabel(server.status);
    head.append(identity, status);

    const launch = document.createElement('pre');
    launch.className = 'mcp-launch-command';
    launch.textContent = mcpLaunchText(server);

    const toolMeta = document.createElement('div');
    toolMeta.className = 'skill-library-description';
    const mutating = server.tools.filter(tool => !tool.readOnlyHint).length;
    toolMeta.textContent = `${server.tools.length} 个工具${mutating ? ` · ${mutating} 个写入/高风险工具` : ''}${server.protocolVersion ? ` · ${server.protocolVersion}` : ''}`;

    const diagnostics = document.createElement('div');
    diagnostics.className = 'mcp-diagnostics';
    diagnostics.textContent = server.error || server.diagnostics.slice(0, 3).join('\n');
    diagnostics.hidden = !diagnostics.textContent;

    const actions = document.createElement('div');
    actions.className = 'skill-library-actions';
    actions.append(createMcpAction('edit', '编辑', server));
    if (server.approvedFingerprint !== server.configFingerprint) {
      actions.append(createMcpAction('approve', '审查并批准', server));
    } else {
      actions.append(createMcpAction('revoke', '撤销批准', server));
      actions.append(createMcpAction(server.enabled ? 'disable' : 'enable', server.enabled ? '停用' : '启用', server));
      if (server.enabled) actions.append(createMcpAction(server.status === 'connected' ? 'disconnect' : 'connect', server.status === 'connected' ? '断开' : '连接', server));
    }
    actions.append(createMcpAction('remove', '移除', server));
    item.append(head, launch, toolMeta, diagnostics, actions);
    return item;
  }));
}

function createMcpAction(action: string, label: string, server: McpServerSnapshot): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.mcpAction = action;
  button.dataset.mcpId = server.id;
  button.dataset.mcpFingerprint = server.configFingerprint;
  button.textContent = label;
  return button;
}

async function handleMcpAction(action: string, id: string, fingerprint: string): Promise<void> {
  const server = mcpIntegrationSnapshot?.servers.find(item => item.id === id);
  if (!server) return;
  try {
    if (action === 'edit') {
      openMcpServerForm(server);
      return;
    }
    if (action === 'approve') {
      const warning = server.transport === 'stdio'
        ? `将以 Athena 当前 Windows 用户权限启动以下命令：\n\n${mcpLaunchText(server)}\n\n批准仅绑定当前配置指纹，任何修改都会撤销批准。`
        : `将连接以下 MCP 地址：\n\n${mcpLaunchText(server)}\n\n远程请求仍受外部工具联网同意控制。`;
      if (!window.confirm(warning)) return;
      await window.athenaAPI.approveMcpServer(id, fingerprint, true);
    } else if (action === 'revoke') {
      await window.athenaAPI.approveMcpServer(id, fingerprint, false);
    } else if (action === 'enable' || action === 'disable') {
      await window.athenaAPI.setMcpServerEnabled(id, fingerprint, action === 'enable');
    } else if (action === 'connect') {
      await window.athenaAPI.connectMcpServer(id);
    } else if (action === 'disconnect') {
      await window.athenaAPI.disconnectMcpServer(id);
    } else if (action === 'remove') {
      if (!window.confirm(`移除 MCP Server“${server.name}”？`)) return;
      await window.athenaAPI.removeMcpServer(id, fingerprint);
    }
    await refreshMcpIntegrations();
  } catch (error) {
    setAgentExecutionFeedback(`MCP 操作失败：${error instanceof Error ? error.message : String(error)}`);
    await refreshMcpIntegrations();
  }
}

function openMcpServerForm(server?: McpServerSnapshot): void {
  mcpServerForm.hidden = false;
  mcpServerId.value = server?.id || '';
  mcpServerName.value = server?.name || '';
  mcpServerTransport.value = server?.transport || 'stdio';
  mcpServerProtocol.value = server?.protocolMode || 'auto';
  mcpServerCommand.value = server?.stdio?.command || '';
  mcpServerCwd.value = server?.stdio?.cwd || '';
  mcpServerArgs.value = server?.stdio?.args.join('\n') || '';
  mcpServerEnv.value = server?.stdio?.envKeys.join('\n') || '';
  mcpServerUrl.value = server?.http?.url || '';
  mcpServerTokenEnv.value = server?.http?.bearerTokenEnv || '';
  syncMcpTransportFields();
  mcpServerName.focus();
}

function closeMcpServerForm(): void {
  mcpServerForm.hidden = true;
  mcpServerForm.reset();
  mcpServerId.value = '';
}

function syncMcpTransportFields(): void {
  const stdio = mcpServerTransport.value === 'stdio';
  mcpStdioFields.hidden = !stdio;
  mcpHttpFields.hidden = stdio;
  mcpServerCommand.required = stdio;
  mcpServerUrl.required = !stdio;
}

async function saveMcpServer(): Promise<void> {
  const transport = mcpServerTransport.value as McpTransportKind;
  const argumentLines = (value: string) => value.split(/\r?\n/).filter(item => item.length > 0);
  const normalizedLines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const input: McpServerInput = {
    ...(mcpServerId.value ? { id: mcpServerId.value } : {}),
    name: mcpServerName.value.trim(),
    transport,
    protocolMode: mcpServerProtocol.value as McpProtocolMode,
    ...(transport === 'stdio' ? {
      stdio: {
        command: mcpServerCommand.value.trim(),
        args: argumentLines(mcpServerArgs.value),
        cwd: mcpServerCwd.value.trim() || null,
        envKeys: normalizedLines(mcpServerEnv.value),
      },
    } : {
      http: {
        url: mcpServerUrl.value.trim(),
        bearerTokenEnv: mcpServerTokenEnv.value.trim() || null,
      },
    }),
  };
  try {
    const saved = await window.athenaAPI.upsertMcpServer(input);
    if (!saved) throw new Error('配置被拒绝');
    closeMcpServerForm();
    setAgentExecutionFeedback(`MCP Server“${saved.name}”已保存，当前待审查且不会自动启动。`);
    await refreshMcpIntegrations();
  } catch (error) {
    setAgentExecutionFeedback(`MCP 配置保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function mcpLaunchText(server: McpServerSnapshot): string {
  if (server.transport === 'streamable-http') return server.http?.url || '';
  const quote = (value: string) => /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const command = [server.stdio?.command || '', ...(server.stdio?.args || [])].map(quote).join(' ');
  const details = [command];
  if (server.stdio?.cwd) details.push(`cwd: ${server.stdio.cwd}`);
  if (server.stdio?.envKeys.length) details.push(`env: ${server.stdio.envKeys.join(', ')}`);
  return details.join('\n');
}

function mcpStatusLabel(status: McpServerSnapshot['status']): string {
  if (status === 'connected') return '已连接';
  if (status === 'connecting') return '连接中';
  if (status === 'approval-required') return '待批准';
  if (status === 'disconnected') return '已断开';
  if (status === 'error') return '连接失败';
  return '已停用';
}

async function refreshAgentWorkspace(taskId = selectedAgentTaskId): Promise<void> {
  if (!currentProjectId || agentWorkspaceLoading) return;
  const requestedProjectId = currentProjectId;
  agentWorkspaceLoading = true;
  try {
    const snapshot = await window.athenaAPI.getAgentWorkspace(requestedProjectId, taskId);
    if (currentProjectId !== requestedProjectId || !snapshot) return;
    agentWorkspace = snapshot;
    selectedAgentTaskId = snapshot.selectedTask?.id;
    renderAgentWorkspace();
    renderExecutionCenter();
  } catch (error) {
    console.error('Failed to refresh agent workspace', error);
    if (taskId) {
      selectedAgentTaskId = undefined;
      try {
        agentWorkspace = await window.athenaAPI.getAgentWorkspace(requestedProjectId);
        renderAgentWorkspace();
        renderExecutionCenter();
      } catch (fallbackError) {
        console.error('Failed to load default agent workspace selection', fallbackError);
      }
    }
  } finally {
    agentWorkspaceLoading = false;
  }
}

function renderAgentWorkspace(): void {
  const workspace = agentWorkspace;
  if (!workspace) {
    agentProjectTitle.textContent = '当前 Project';
    agentWorkspaceRevision.textContent = 'rev 0';
    renderAgentEmpty(agentRootList, '尚未设置工作目录');
    renderAgentEmpty(agentGoalList, '尚未设置项目目标');
    renderAgentEmpty(agentTaskBoard, '当前 Project 还没有任务');
    renderAgentEmpty(agentPlanList, '选择任务后查看计划');
    renderAgentEmpty(agentArtifactList, '还没有交付产物');
    agentApprovalSection.hidden = true;
    return;
  }
  agentProjectTitle.textContent = workspace.project.title;
  agentWorkspaceRevision.textContent = `rev ${workspace.metadata.revision}`;
  renderAgentRoots(workspace.metadata.roots);
  renderAgentGoals(workspace.metadata.goals);
  renderAgentTaskBoard(workspace);
  renderAgentApprovals(workspace.selectedRun);
  renderAgentPlan(workspace.selectedTask, workspace.selectedRun);
  renderAgentArtifacts(workspace.selectedRun);
}

function renderAgentRoots(roots: string[]): void {
  if (roots.length === 0) {
    renderAgentEmpty(agentRootList, '尚未设置工作目录');
    return;
  }
  agentRootList.replaceChildren(...roots.map((root, index) => {
    const item = document.createElement('div');
    item.className = 'agent-chip';
    const text = document.createElement('span');
    text.textContent = root;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.agentRootIndex = String(index);
    remove.title = '移除工作目录';
    remove.setAttribute('aria-label', `移除工作目录 ${root}`);
    remove.innerHTML = '<svg class="icon"><use href="#icon-close"></use></svg>';
    item.append(text, remove);
    return item;
  }));
}

function renderAgentGoals(goals: AgentWorkspaceGoal[]): void {
  if (goals.length === 0) {
    renderAgentEmpty(agentGoalList, '尚未设置项目目标');
    return;
  }
  agentGoalList.replaceChildren(...goals.map(goal => {
    const item = document.createElement('div');
    item.className = 'agent-goal';
    item.dataset.status = goal.status;
    const text = document.createElement('span');
    text.textContent = `${agentGoalStatusLabel(goal.status)} · ${goal.title}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.agentGoalId = goal.id;
    toggle.title = '切换目标状态';
    toggle.textContent = '切换';
    item.append(text, toggle);
    return item;
  }));
}

function renderAgentTaskBoard(workspace: AgentProjectWorkspaceSnapshot): void {
  const columns: Array<{ label: string; statuses: AgentTaskStatus[] }> = [
    { label: '待执行', statuses: ['draft', 'ready'] },
    { label: '进行中', statuses: ['active', 'blocked'] },
    { label: '已完成', statuses: ['completed'] },
    { label: '需处理', statuses: ['failed', 'cancelled'] },
  ];
  if (workspace.tasks.filter(task => task.status !== 'archived').length === 0) {
    renderAgentEmpty(agentTaskBoard, '在执行模式发送目标后，任务会出现在这里');
    return;
  }
  agentTaskBoard.replaceChildren(...columns.map(column => {
    const container = document.createElement('div');
    container.className = 'agent-task-column';
    const title = document.createElement('div');
    title.className = 'agent-task-column-title';
    const tasks = column.statuses.flatMap(status => workspace.board[status]);
    title.textContent = `${column.label} · ${tasks.length}`;
    container.appendChild(title);
    for (const task of tasks.slice(0, 20)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'agent-task-button';
      button.dataset.agentTaskId = task.id;
      button.dataset.selected = String(task.id === workspace.selectedTask?.id);
      button.textContent = task.title;
      const meta = document.createElement('span');
      meta.textContent = `${agentTaskStatusLabel(task.status)} · ${formatExecutionTime(task.updatedAt)}`;
      button.appendChild(meta);
      container.appendChild(button);
    }
    return container;
  }));
}

function renderAgentApprovals(snapshot: AgentRunSnapshot | null): void {
  const activeGroup = snapshot?.run.approvalGroupId;
  const approvals = snapshot?.approvals.filter(item => item.status === 'pending' && item.groupId === activeGroup) || [];
  agentApprovalSection.hidden = approvals.length === 0;
  if (approvals.length === 0) {
    agentApprovalList.replaceChildren();
    return;
  }
  const representative = approvals[0];
  const item = document.createElement('div');
  item.className = 'agent-approval-item';
  const content = document.createElement('div');
  const tools = approvals.map(approval => String(approval.request.toolName || approval.capability)).join('、');
  const explanation = approvals.map(approval => String(approval.request.explanation || '')).filter(Boolean).join('；');
  content.textContent = `${approvals.length} 项 · ${tools}${explanation ? `\n${explanation}` : ''}`;
  const actions = document.createElement('div');
  actions.className = 'agent-approval-actions';
  for (const decision of ['denied', 'approved'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.agentApprovalId = representative.id;
    button.dataset.decision = decision;
    button.textContent = decision === 'approved' ? '批准并继续' : '拒绝';
    actions.appendChild(button);
  }
  item.append(content, actions);
  agentApprovalList.replaceChildren(item);
}

function renderAgentPlan(task: AgentTaskRecord | null, snapshot: AgentRunSnapshot | null): void {
  const items: HTMLElement[] = [];
  for (const step of task?.spec.plan || []) {
    items.push(createAgentDetailItem(step.title, step.successCriteria.join(' · ')));
  }
  for (const step of snapshot?.steps || []) {
    items.push(createAgentDetailItem(`${step.sequence}. ${step.title}`, `${step.status}${step.error ? ` · ${step.error}` : ''}`));
  }
  if (items.length === 0) renderAgentEmpty(agentPlanList, '选择任务后查看计划与运行步骤');
  else agentPlanList.replaceChildren(...items.slice(-30));
}

function renderAgentArtifacts(snapshot: AgentRunSnapshot | null): void {
  const artifacts = snapshot?.artifacts || [];
  if (artifacts.length === 0) {
    renderAgentEmpty(agentArtifactList, '还没有登记交付产物');
    return;
  }
  agentArtifactList.replaceChildren(...artifacts.map(artifact => {
    const item = createAgentDetailItem(artifact.name, `${artifact.kind} · ${artifact.validationStatus}${artifact.uri ? ` · ${artifact.uri}` : ''}`);
    if (!artifact.uri) return item;
    const button = document.createElement('button');
    button.className = 'agent-artifact-open icon-button';
    button.type = 'button';
    button.title = '打开产物';
    button.setAttribute('aria-label', `打开 ${artifact.name}`);
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-file"></use></svg>';
    button.addEventListener('click', async () => {
      if (!currentProjectId) return;
      button.disabled = true;
      try {
        await window.athenaAPI.openAgentArtifact(currentProjectId, artifact.id);
      } catch (error) {
        setStatus(`打开产物失败：${error instanceof Error ? error.message : String(error)}`, 'error');
      } finally {
        button.disabled = false;
      }
    });
    item.append(button);
    return item;
  }));
}

function createAgentDetailItem(title: string, meta: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'agent-detail-item';
  const text = document.createElement('span');
  text.textContent = title;
  const status = document.createElement('span');
  status.textContent = meta;
  item.append(text, status);
  return item;
}

function renderAgentEmpty(container: HTMLElement, text: string): void {
  const empty = document.createElement('div');
  empty.className = 'execution-empty';
  empty.textContent = text;
  container.replaceChildren(empty);
}

async function addAgentWorkspaceRoot(): Promise<void> {
  const root = agentRootInput.value.trim();
  if (!root || !agentWorkspace || !currentProjectId) return;
  await updateAgentWorkspaceMetadata({ roots: [...agentWorkspace.metadata.roots, root] });
  agentRootInput.value = '';
}

async function removeAgentWorkspaceRoot(index: number): Promise<void> {
  if (!agentWorkspace || !currentProjectId || !Number.isInteger(index)) return;
  await updateAgentWorkspaceMetadata({ roots: agentWorkspace.metadata.roots.filter((_, itemIndex) => itemIndex !== index) });
}

async function addAgentWorkspaceGoal(): Promise<void> {
  const title = agentGoalInput.value.trim();
  if (!title || !agentWorkspace || !currentProjectId) return;
  await updateAgentWorkspaceMetadata({
    goals: [...agentWorkspace.metadata.goals, {
      title,
      status: 'active',
    }],
  });
  agentGoalInput.value = '';
}

async function cycleAgentWorkspaceGoal(goalId: string): Promise<void> {
  if (!agentWorkspace || !currentProjectId) return;
  const goals = agentWorkspace.metadata.goals.map(goal => goal.id === goalId
    ? { ...goal, status: nextAgentGoalStatus(goal.status) }
    : goal);
  await updateAgentWorkspaceMetadata({ goals });
}

async function updateAgentWorkspaceMetadata(patch: {
  roots?: string[];
  goals?: Array<{ id?: string; title: string; status: AgentWorkspaceGoal['status'] }>;
}): Promise<void> {
  if (!agentWorkspace || !currentProjectId) return;
  try {
    await window.athenaAPI.updateAgentWorkspace(currentProjectId, {
      revision: agentWorkspace.metadata.revision,
      ...patch,
    });
    await refreshAgentWorkspace(selectedAgentTaskId);
  } catch (error) {
    setStatus(`项目工作区更新失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    await refreshAgentWorkspace(selectedAgentTaskId);
  }
}

async function resolveAgentApproval(approvalId: string, decision: 'approved' | 'denied'): Promise<void> {
  const runId = agentWorkspace?.selectedRun?.run.id;
  if (!runId || !currentProjectId) return;
  agentApprovalList.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
  setStatus(decision === 'approved' ? '正在继续已批准的任务' : '正在记录拒绝并继续', 'working');
  try {
    await window.athenaAPI.resolveAgentApproval(currentProjectId, runId, approvalId, decision);
    await refreshAgentWorkspace(selectedAgentTaskId);
  } catch (error) {
    setStatus(`审批处理失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    await refreshAgentWorkspace(selectedAgentTaskId);
  } finally {
    restoreIdleStatus();
  }
}

async function resumeSelectedAgentRun(): Promise<void> {
  const runId = agentWorkspace?.selectedRun?.run.id;
  if (!runId || !currentProjectId) return;
  agentRunResume.disabled = true;
  setStatus('正在从检查点继续任务', 'working');
  try {
    await window.athenaAPI.resumeAgentRun(currentProjectId, runId);
    await refreshAgentWorkspace(selectedAgentTaskId);
  } catch (error) {
    setStatus(`继续任务失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    restoreIdleStatus();
  }
}

function nextAgentGoalStatus(status: AgentWorkspaceGoal['status']): AgentWorkspaceGoal['status'] {
  if (status === 'active') return 'achieved';
  if (status === 'achieved') return 'paused';
  return 'active';
}

function agentGoalStatusLabel(status: AgentWorkspaceGoal['status']): string {
  if (status === 'achieved') return '已达成';
  if (status === 'paused') return '已暂停';
  return '进行中';
}

function agentTaskStatusLabel(status: AgentTaskStatus): string {
  const labels: Record<AgentTaskStatus, string> = {
    draft: '草稿', ready: '待执行', active: '执行中', blocked: '等待确认',
    completed: '已完成', failed: '失败', cancelled: '已停止', archived: '已归档',
  };
  return labels[status];
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
  const durableRun = agentWorkspace?.selectedRun?.run;
  if (durableRun && !['completed', 'failed', 'cancelled'].includes(durableRun.status)) {
    executionStop.disabled = true;
    setStatus('正在停止持久化任务', 'working');
    try {
      if (!currentProjectId) return;
      await window.athenaAPI.cancelAgentRun(currentProjectId, durableRun.id);
      await refreshAgentWorkspace(selectedAgentTaskId);
    } catch (error) {
      setStatus(`停止请求失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      restoreIdleStatus();
    }
    return;
  }
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
  if (agentWorkspace) {
    renderDurableExecutionCenter(agentWorkspace);
    return;
  }
  const task = currentExecutionTask;
  const active = Boolean(task && isExecutionTaskActive(task));
  modeExecuteButton.dataset.active = String(active);
  modeExecuteButton.dataset.hasRecords = String(executionTasks.length > 0 || Boolean(task && !active));
  executionStop.disabled = !active || task?.state === 'stopping';
  agentRunResume.disabled = true;

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

function renderDurableExecutionCenter(workspace: AgentProjectWorkspaceSnapshot): void {
  const task = workspace.selectedTask;
  const snapshot = workspace.selectedRun;
  const run = snapshot?.run;
  const active = Boolean(run && !['completed', 'failed', 'cancelled'].includes(run.status));
  modeExecuteButton.dataset.active = String(active);
  modeExecuteButton.dataset.hasRecords = String(workspace.tasks.length > 0);
  executionStop.disabled = !active;
  const pendingApproval = snapshot?.approvals.some(item => item.status === 'pending') === true;
  agentRunResume.disabled = !run || !workspace.recoverableRunIds.includes(run.id) || pendingApproval;
  if (!task) {
    executionCurrentCard.dataset.state = 'idle';
    executionStateLabel.dataset.state = 'idle';
    executionStateLabel.textContent = '待命';
    executionCurrentGoal.textContent = '当前 Project 还没有执行任务。';
    executionCurrentMeta.textContent = '在输入框描述目标，或切回聊天完善方案后再切到执行。';
    executionLiveLog.replaceChildren();
    executionCurrentResult.textContent = '';
    executionCurrentResult.dataset.visible = 'false';
    renderExecutionHistory();
    return;
  }
  const state = durableExecutionState(task, run);
  executionCurrentCard.dataset.state = state;
  executionStateLabel.dataset.state = state;
  executionStateLabel.textContent = run ? agentRunPhaseLabel(run) : agentTaskStatusLabel(task.status);
  executionCurrentGoal.textContent = task.spec.goal;
  const runMeta = run
    ? `${run.phase} · ${run.status} · ${formatExecutionTime(run.startedAt || run.createdAt)}`
    : `任务已创建 · ${formatExecutionTime(task.createdAt)}`;
  executionCurrentMeta.textContent = `${workspace.project.title} · ${runMeta}`;
  const timeline = (snapshot?.events || []).slice(-16).map(event => {
    const item = document.createElement('li');
    item.className = 'execution-live-step';
    item.dataset.phase = event.type;
    item.textContent = `${formatExecutionTime(event.createdAt)} · ${agentEventLabel(event.type, event.payload)}`;
    return item;
  });
  executionLiveLog.replaceChildren(...timeline);
  const finalContent = run ? readAgentFinalContent(run.state) : '';
  const result = finalContent || run?.error || '';
  executionCurrentResult.textContent = result;
  executionCurrentResult.dataset.visible = String(Boolean(result));
  renderExecutionHistory();
}

function renderExecutionHistory(): void {
  if (agentWorkspace) {
    renderDurableExecutionHistory(agentWorkspace);
    return;
  }
  if (executionTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'execution-empty';
    empty.textContent = '真实执行完成后，会在这里保留参数、结果与耗时。';
    executionHistory.replaceChildren(empty);
    return;
  }
  executionHistory.replaceChildren(...executionTasks.map(createExecutionTaskNode));
}

function renderDurableExecutionHistory(workspace: AgentProjectWorkspaceSnapshot): void {
  if (workspace.tasks.length === 0) {
    renderAgentEmpty(executionHistory, '当前 Project 还没有持久化执行记录。');
    return;
  }
  executionHistory.replaceChildren(...workspace.tasks.slice(0, 50).map(task => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent-task-button';
    button.dataset.agentTaskId = task.id;
    button.dataset.selected = String(task.id === workspace.selectedTask?.id);
    button.textContent = task.title;
    const meta = document.createElement('span');
    meta.textContent = `${agentTaskStatusLabel(task.status)} · ${formatExecutionTime(task.updatedAt)}`;
    button.appendChild(meta);
    return button;
  }));
}

function durableExecutionState(task: AgentTaskRecord, run?: AgentRunRecord): ExecutionTaskState {
  if (!run) return task.status === 'failed' ? 'failed' : task.status === 'cancelled' ? 'cancelled' : 'planning';
  if (run.status === 'completed') return 'completed';
  if (run.status === 'failed') return 'failed';
  if (run.status === 'cancelled') return 'cancelled';
  return 'running';
}

function agentRunPhaseLabel(run: AgentRunRecord): string {
  if (run.phase === 'awaiting_approval') return '等待审批';
  if (run.phase === 'planning') return '正在规划';
  if (run.phase === 'executing') return '正在执行';
  if (run.phase === 'verifying') return '正在验证';
  if (run.phase === 'completed') return '已完成';
  if (run.phase === 'failed') return '执行失败';
  if (run.phase === 'cancelled') return '已停止';
  return '准备中';
}

function agentEventLabel(type: string, payload: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    'run.created': '已创建持久化运行',
    'run.started': '运行已开始',
    'run.phase_changed': `阶段变更为 ${String(payload.to || '')}`,
    'run.checkpointed': '已保存恢复检查点',
    'approval.requested': `请求审批 ${String(payload.capability || '')}`,
    'approval.resolved': `审批已${payload.status === 'approved' ? '批准' : '拒绝'}`,
    'runner.model_requested': '模型正在规划下一步',
    'runner.tool_attempt_started': '工具调用已开始',
    'artifact.created': '已登记交付产物',
  };
  return labels[type] || type;
}

function readAgentFinalContent(state: Record<string, unknown>): string {
  return typeof state.finalContent === 'string' ? state.finalContent : '';
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
  chatWindowList.replaceChildren();
  for (const windowRecord of chatWindows) {
    const option = document.createElement('option');
    option.value = String(windowRecord.id);
    const count = windowRecord.messageCount ?? 0;
    const title = windowRecord.is_temporary ? `[${TEMPORARY_CHAT_LABEL}] ${windowRecord.title}` : windowRecord.title;
    option.textContent = count > 0 ? `${title} (${count})` : title;
    chatWindowSelect.appendChild(option);

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chat-window-list-item';
    item.dataset.chatWindowId = String(windowRecord.id);
    item.dataset.active = String(windowRecord.id === currentChatWindowId);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(windowRecord.id === currentChatWindowId));
    item.disabled = isStreaming;

    const label = document.createElement('span');
    label.className = 'chat-window-list-title';
    label.textContent = windowRecord.is_temporary ? `${TEMPORARY_CHAT_LABEL} · ${windowRecord.title}` : windowRecord.title;
    const meta = document.createElement('span');
    meta.className = 'chat-window-list-meta';
    meta.textContent = count > 0 ? `${count} 条` : '空对话';
    item.append(label, meta);
    chatWindowList.appendChild(item);
  }
  if (currentChatWindowId) chatWindowSelect.value = String(currentChatWindowId);
  const disabled = isStreaming || chatWindows.length === 0;
  chatWindowSelect.disabled = disabled;
  chatWindowRename.disabled = disabled || !currentChatWindowId;
  chatWindowArchive.disabled = disabled || !currentChatWindowId || temporary;
  chatWindowDelete.disabled = disabled || !currentChatWindowId;
  chatWindowNew.disabled = isStreaming;
  chatWindowTemporary.disabled = isStreaming;
  projectDocumentBtn.disabled = disabled || temporary;
  projectDocumentBtn.title = temporary ? '临时对话不保存 Project 文档' : '导入 Project 文档';
  projectDocumentOcrBtn.disabled = (disabled || temporary) && !isOcrImporting;
  projectDocumentOcrBtn.title = temporary
    ? '临时对话不保存 OCR 文档'
    : isOcrImporting ? '停止当前本地 OCR' : '本地 OCR 扫描 PDF';
  const ocrLabel = projectDocumentOcrBtn.querySelector('span');
  if (ocrLabel) ocrLabel.textContent = isOcrImporting ? '停止 OCR' : '扫描 PDF OCR';
  chatWindowDelete.textContent = temporary ? '关闭' : '删除';
  activeChatTitle.textContent = current?.title || '新对话';
  activeProjectTitle.textContent = current?.projectTitle || getCurrentProject()?.title || 'General Project';
}

async function loadCurrentChatWindowMessages(): Promise<void> {
  if (!currentChatWindowId) {
    currentChatWindowMessages = [];
    chatPanel.clear();
    renderComposerAttachments();
    await refreshWindowMemoryPanel();
    return;
  }
  const messages = await window.athenaAPI.getChatWindowMessages(currentChatWindowId, 300);
  currentChatWindowMessages = messages;
  chatPanel.renderMessages(messages);
  renderComposerAttachments();
}

async function switchProject(id: number): Promise<void> {
  if (isStreaming || id === currentProjectId) return;
  const target = projects.find(project => project.id === id);
  if (!target) {
    await refreshProjects();
    return;
  }
  currentProjectId = target.id;
  selectedAgentTaskId = undefined;
  agentWorkspace = null;
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
  if (currentMode === 'execute') await refreshAgentWorkspace();
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
  if (mode === 'execute') await refreshAgentWorkspace(selectedAgentTaskId);
  if (currentSettingsBundle) currentSettingsBundle.settings.conversation.activeMode = mode;
  await loadCurrentChatWindowMessages();
  await refreshChatWindows();
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function createNewChatWindow(): Promise<void> {
  if (isStreaming) return;
  const created = await window.athenaAPI.createChatWindow(NEW_CHAT_TITLE, currentProjectId ?? undefined);
  if (!created) return;
  currentChatWindowId = created.id;
  setMode(created.mode);
  currentChatWindowMessages = [];
  chatPanel.clear();
  chatWindows = [created, ...chatWindows.filter(window => window.id !== created.id)];
  renderChatWindowPicker();
  await refreshProjects();
  await refreshChatWindows();
  await loadCurrentChatWindowMessages();
  await refreshWindowMemoryPanel();
  inputBar.focus();
}

async function autoTitleCurrentChatWindow(text: string): Promise<void> {
  const chatWindowId = currentChatWindowId;
  const current = getCurrentChatWindow();
  if (!chatWindowId || !current || current.is_temporary || (current.messageCount ?? 0) > 0 || !isDefaultChatTitle(current.title)) return;

  const title = titleFromFirstMessage(text);
  if (!title || title === current.title) return;
  try {
    const updated = await window.athenaAPI.renameChatWindow(chatWindowId, title);
    if (!updated || currentChatWindowId !== chatWindowId) return;
    chatWindows = chatWindows.map(item => item.id === updated.id ? updated : item);
    renderChatWindowPicker();
  } catch (error) {
    console.error('Failed to title new chat window', error);
  }
}

function isDefaultChatTitle(title: string): boolean {
  return title === NEW_CHAT_TITLE || title === '新聊天' || /^聊天\s+\d+$/.test(title);
}

function titleFromFirstMessage(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return NEW_CHAT_TITLE;
  const characters = Array.from(normalized);
  return characters.length > 32 ? `${characters.slice(0, 32).join('')}…` : normalized;
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
  await refreshProjects();
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
  await refreshProjects();
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
  let documents: ProjectDocumentRecord[] = [];
  try {
    snapshots = await window.athenaAPI.getChatWindowContextSnapshots(current.id, 1);
    if (current.project_id) documents = await window.athenaAPI.listProjectDocuments(current.project_id);
  } catch (error) {
    console.error('Failed to load chat window context snapshot', error);
  }
  renderWindowMemoryPanel(current, currentChatWindowMessages, snapshots[0], documents);
}

function renderEmptyWindowMemoryPanel(): void {
  windowContextTitle.textContent = '当前窗口';
  windowContextMeta.textContent = '没有可用聊天窗口';
  windowContextGoal.textContent = '暂无明确目标';
  renderTextList(windowContextConclusions, []);
  renderTextList(windowContextTodos, []);
  renderPinnedFacts([]);
  renderProjectDocuments(null, []);
  windowContextSummary.textContent = '暂无摘要';
  renderContextBudget(null, 0);
}

function renderWindowMemoryPanel(
  windowRecord: ChatWindowRecord,
  messages: ChatMessageSnapshot[],
  snapshot?: ContextSnapshotRecord,
  documents: ProjectDocumentRecord[] = [],
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
  renderProjectDocuments(windowRecord, documents);
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

function renderProjectDocuments(windowRecord: ChatWindowRecord | null, documents: ProjectDocumentRecord[]): void {
  windowProjectDocuments.replaceChildren();
  if (documents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'window-context-empty';
    empty.textContent = windowRecord?.is_temporary ? '临时对话不保存文档' : '暂无 Project 文档';
    windowProjectDocuments.appendChild(empty);
    return;
  }
  for (const record of documents) {
    const item = document.createElement('div');
    item.className = 'window-project-document';
    const body = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = record.name;
    const meta = document.createElement('span');
    meta.textContent = [
      record.page_count ? `${record.page_count} 页` : '',
      `${record.chunk_count} 块`,
      record.ocr_engine ? '本地 OCR' : '',
      record.needs_ocr ? '仍有扫描页' : '',
    ].filter(Boolean).join(' · ');
    body.append(name, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.title = `删除 ${record.name}`;
    remove.setAttribute('aria-label', `删除 ${record.name}`);
    remove.innerHTML = '<svg class="icon"><use href="#icon-close"></use></svg>';
    remove.addEventListener('click', () => void deleteCurrentProjectDocument(record.id));
    item.append(body, remove);
    windowProjectDocuments.appendChild(item);
  }
}

async function deleteCurrentProjectDocument(documentId: number): Promise<void> {
  const projectId = getCurrentChatWindow()?.project_id;
  if (!projectId) return;
  if (!window.confirm('删除这份 Project 文档及其本地检索文本？')) return;
  if (await window.athenaAPI.deleteProjectDocument(projectId, documentId)) await refreshWindowMemoryPanel();
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
    || item.kind === 'procedural_memory'
    || item.kind === 'project_memory'
    || item.kind === 'project_document'
    || item.kind === 'global_memory'
  )).length;
  const sourceCount = new Set(included.flatMap(item => item.evidence || []).map(item => (
    `${item.memoryTable}:${item.memoryId}:${item.sourceTable}:${item.sourceId || ''}`
  ))).size;
  const estimatedTokens = snapshot.budget?.estimatedPromptTokens ?? snapshot.estimated_prompt_tokens;
  const maxTokens = snapshot.budget?.maxPromptTokens;
  const chars = snapshot.budget?.promptChars ?? snapshot.prompt_chars;
  if (maxTokens) {
    const usage = Math.max(0, Math.min(100, Math.round((Number(estimatedTokens) / Number(maxTokens)) * 100)));
    const meter = document.createElement('div');
    meter.className = 'window-context-meter';
    meter.dataset.level = usage >= 85 ? 'high' : usage >= 65 ? 'medium' : 'normal';
    const meterHeading = document.createElement('div');
    meterHeading.className = 'window-context-meter-heading';
    const meterLabel = document.createElement('span');
    meterLabel.textContent = '上下文使用';
    const meterValue = document.createElement('strong');
    meterValue.textContent = `${estimatedTokens} / ${maxTokens} tokens · ${usage}%`;
    meterHeading.append(meterLabel, meterValue);
    const track = document.createElement('div');
    track.className = 'window-context-meter-track';
    const fill = document.createElement('span');
    fill.style.width = `${usage}%`;
    track.appendChild(fill);
    meter.append(meterHeading, track);
    windowContextBudget.appendChild(meter);
  }
  appendContextStat('最近消息', `${recentCount}/${visibleMessageCount}`);
  appendContextStat('摘要', summaryState);
  appendContextStat('记忆', `${memoryCount} 项`);
  appendContextStat('Token', maxTokens ? `${estimatedTokens}/${maxTokens}` : String(estimatedTokens));
  appendContextStat('来源', `${sourceCount} 条`);
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
  await openModelSettings();
  const firstChoice = modelFirstRunChoice.querySelector<HTMLButtonElement>('[data-model-path]');
  firstChoice?.focus({ preventScroll: true });
}

async function openModelSettings(): Promise<void> {
  await toggleSettingsPanel(true);
  modelSettingsSection.open = true;
  settingsForm.scrollTo({ top: Math.max(0, modelSettingsSection.offsetTop - 12), behavior: 'smooth' });
  appShell.scrollLeft = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollLeft = 0;
}

async function refreshStartupModelStatus(autoConnect: boolean): Promise<void> {
  if (!autoConnect) {
    modelConnected = null;
    if (chatPanel.hasMessages()) {
      setStatus('待命', 'ready');
      return;
    }
    chatPanel.addMessage(`${currentPersonaLabel()}在。模型自动连接先关着，需要聊天时再叫醒本地模型就好。`, 'assistant', '待命');
    setStatus('待命', 'ready');
    return;
  }

  try {
    let info: Awaited<ReturnType<typeof window.athenaAPI.getSystemInfo>> = null;
    for (let attempt = 0; attempt < 3 && !info; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => window.setTimeout(resolve, 320 * attempt));
      info = await window.athenaAPI.getFastSystemInfo();
    }
    if (!info) throw new Error('主进程没有返回模型状态');
    if (info.modelConnectionChecked === false) {
      modelConnected = null;
      if (!chatPanel.hasMessages()) {
        chatPanel.addMessage(`${greetingForHour(info.hour)}，${currentPersonaLabel()}在。窗口先打开好了，模型连接我在后台短检测。`, 'assistant', '待命');
      }
      setStatus(`${modelProviderLabel(info.modelProvider)} · 检测中`, 'working');
      window.setTimeout(() => void refreshDeferredStartupModelStatus(), 300);
      return;
    }
    modelConnected = info.modelConnected;
    if (info.modelConnected) {
      if (chatPanel.hasMessages()) {
        setStatus(`${modelProviderLabel(info.modelProvider)} · ${info.modelName} · 已连接`, 'ready');
        return;
      }
      chatPanel.addMessage(`${greetingForHour(info.hour)}，${currentPersonaLabel()}在。今天想先聊两句，还是把手头的事往前推一点？`, 'assistant', '温柔');
      setStatus(`${modelProviderLabel(info.modelProvider)} · ${info.modelName} · 已连接`, 'ready');
    } else {
      if (chatPanel.hasMessages()) {
        setStatus(`${modelProviderLabel(info.modelProvider)} · 模型不可用`, 'offline');
        return;
      }
      chatPanel.addMessage(`我已经醒着，但还没连上 ${modelProviderLabel(info.modelProvider)}。请检查 ${info.modelEndpoint || '模型地址'} 和 ${info.modelName || '模型名称'}。`, 'assistant', '等待模型');
      setStatus(`${modelProviderLabel(info.modelProvider)} · 模型不可用`, 'offline');
    }
  } catch (error) {
    console.error('Failed to read startup model status', error);
    modelConnected = null;
    if (chatPanel.hasMessages()) {
      setStatus('模型状态未知', 'error');
      return;
    }
    chatPanel.addMessage('窗口已经准备好了，但模型状态暂时无法读取。请打开模型设置查看诊断结果。', 'assistant', '需要检查');
    setStatus('模型状态未知', 'error');
  }
}

async function refreshDeferredStartupModelStatus(): Promise<void> {
  try {
    const info = await window.athenaAPI.getStartupSystemInfo();
    if (!info) return;
    modelConnected = info.modelConnectionChecked === false ? null : info.modelConnected;
    if (info.modelConnected) {
      setStatus(`${modelProviderLabel(info.modelProvider)} · ${info.modelName} · 已连接`, 'ready');
    } else if (info.modelConnectionChecked === false) {
      setStatus(`${modelProviderLabel(info.modelProvider)} · 待检测`, 'ready');
    } else {
      setStatus(`${modelProviderLabel(info.modelProvider)} · 模型不可用`, 'offline');
    }
  } catch (error) {
    console.error('Failed to refresh deferred startup model status', error);
    modelConnected = null;
    setStatus('模型状态未知', 'error');
  }
}

async function toggleMemoryPanel(force?: boolean): Promise<void> {
  const next = force ?? memoryPanel.dataset.open !== 'true';
  memoryPanel.dataset.open = String(next);
  if (next) {
    settingsPanel.dataset.open = 'false';
    toolsPanel.dataset.open = 'false';
  }
  toggleComposerTools(false);
  syncPanelState();
  if (next) {
    await refreshWindowMemoryPanel();
    if (memoryTabs.dataset.active === 'review') await loadMemoryReviewQueue();
    if (memoryTabs.dataset.active === 'manage') await loadMemoryList();
    if (memoryTabs.dataset.active === 'review') memoryReviewStatus.focus({ preventScroll: true });
    else if (memoryTabs.dataset.active === 'manage') memorySearch.focus({ preventScroll: true });
    else windowPinInput.focus({ preventScroll: true });
    appShell.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }
}

async function openMemoryPanelTab(tabName: string): Promise<void> {
  await toggleSettingsPanel(false);
  await selectMemoryTab(tabName);
  await toggleMemoryPanel(true);
}

async function toggleSettingsPanel(force?: boolean): Promise<void> {
  const next = force ?? settingsPanel.dataset.open !== 'true';
  settingsPanel.dataset.open = String(next);
  if (next) {
    memoryPanel.dataset.open = 'false';
    toolsPanel.dataset.open = 'false';
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

async function toggleToolsPanel(force?: boolean): Promise<void> {
  const next = force ?? toolsPanel.dataset.open !== 'true';
  toolsPanel.dataset.open = String(next);
  if (next) {
    memoryPanel.dataset.open = 'false';
    settingsPanel.dataset.open = 'false';
    toggleComposerTools(false);
  }
  syncPanelState();
  if (next) await loadToolCatalog();
}

function toggleSidebar(force?: boolean): void {
  const next = force ?? appShell.dataset.sidebar !== 'open';
  appShell.dataset.sidebar = next ? 'open' : 'closed';
  btnSidebar.setAttribute('aria-expanded', String(next));
}

async function loadToolCatalog(): Promise<void> {
  toolsPanelSummary.textContent = '正在读取工具权限...';
  toolsPanelList.replaceChildren();
  try {
    const catalog = await window.athenaAPI.getToolCatalog(currentMode);
    if (!catalog) throw new Error('主进程未返回工具目录');
    renderToolCatalog(catalog);
  } catch (error) {
    toolsPanelSummary.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderToolCatalog(catalog: ToolCatalog): void {
  currentToolCatalog = catalog;
  const available = catalog.tools.filter(tool => tool.available).length;
  toolsPanelSummary.textContent = `${modeLabel(catalog.mode)}模式 · ${toolPermissionShortLabel(catalog.permissionLevel)} · ${available}/${catalog.tools.length} 个可调用`;
  toolsPanelList.replaceChildren();

  const visibleTools = catalog.tools.filter(tool => (
    toolCatalogFilter === 'all'
    || (toolCatalogFilter === 'available' && tool.available)
    || (toolCatalogFilter === 'locked' && !tool.available)
  ));
  for (const tool of visibleTools) {
    const card = document.createElement('article');
    card.className = 'tool-catalog-item';
    card.dataset.available = String(tool.available);

    const heading = document.createElement('div');
    heading.className = 'tool-catalog-heading';
    const label = document.createElement('strong');
    label.textContent = tool.label;
    const state = document.createElement('span');
    state.textContent = tool.available ? '可调用' : tool.blockedReason === 'sku' ? '当前版本不可用' : `需要${toolPermissionShortLabel(tool.minimumLevel)}`;
    heading.append(label, state);

    const signature = document.createElement('code');
    signature.textContent = tool.signature;
    const description = document.createElement('p');
    description.textContent = tool.description;
    card.append(heading, signature, description);
    toolsPanelList.appendChild(card);
  }
  if (visibleTools.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tool-catalog-empty';
    empty.textContent = toolCatalogFilter === 'available' ? '当前模式没有可调用工具' : '没有符合条件的工具';
    toolsPanelList.appendChild(empty);
  }
}

function syncPanelState(): void {
  const memoryOpen = memoryPanel.dataset.open === 'true';
  const settingsOpen = settingsPanel.dataset.open === 'true';
  const toolsOpen = toolsPanel.dataset.open === 'true';
  const anyOpen = memoryOpen || settingsOpen || toolsOpen;
  panelScrim.dataset.visible = String(anyOpen);
  panelScrim.setAttribute('aria-hidden', String(!anyOpen));
  memoryPanel.setAttribute('aria-hidden', String(!memoryOpen));
  settingsPanel.setAttribute('aria-hidden', String(!settingsOpen));
  toolsPanel.setAttribute('aria-hidden', String(!toolsOpen));
  btnMemory.setAttribute('aria-expanded', String(memoryOpen));
  btnSettings.setAttribute('aria-expanded', String(settingsOpen));
}

function toggleComposerTools(force?: boolean): void {
  const next = force ?? composerSecondaryTools.dataset.open !== 'true';
  composerSecondaryTools.dataset.open = String(next);
  composerSecondaryTools.classList.toggle('is-open', next);
  composerSecondaryTools.style.setProperty('display', next ? 'grid' : 'none', 'important');
  composerSecondaryTools.style.setProperty('visibility', next ? 'visible' : 'hidden', 'important');
  composerSecondaryTools.style.setProperty('opacity', next ? '1' : '0', 'important');
  composerSecondaryTools.style.setProperty('pointer-events', next ? 'auto' : 'none', 'important');
  composerSecondaryTools.style.setProperty(
    'transform',
    next ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.94)',
    'important',
  );
  if (next) positionComposerTools();
  composerMoreBtn.setAttribute('aria-expanded', String(next));
}

function positionComposerTools(): void {
  const button = composerMoreBtn.getBoundingClientRect();
  const composer = inputForm.getBoundingClientRect();
  const width = composerSecondaryTools.offsetWidth || 176;
  const height = composerSecondaryTools.offsetHeight || 196;
  const margin = 12;
  const gap = 10;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, button.left));
  const top = Math.max(margin, composer.top - height - gap);
  composerSecondaryTools.style.setProperty('--composer-tools-left', `${Math.round(left)}px`);
  composerSecondaryTools.style.setProperty('--composer-tools-top', `${Math.round(top)}px`);
}

function currentPendingAttachments(): ChatAttachmentSnapshot[] {
  return currentChatWindowId ? pendingChatAttachments.get(currentChatWindowId) || [] : [];
}

async function chooseChatFiles(): Promise<void> {
  if (!currentChatWindowId || isStreaming) return;
  const availableSlots = 5 - currentPendingAttachments().length;
  if (availableSlots <= 0) {
    toggleComposerTools(false);
    setStatus('一条消息最多添加 5 个附件', 'error');
    window.setTimeout(restoreIdleStatus, 2400);
    return;
  }
  toggleComposerTools(false);
  try {
    setStatus('选择文件、图片或音频…', 'ready');
    const selected = await window.athenaAPI.chooseChatFiles(currentChatWindowId, availableSlots);
    if (selected.length === 0) {
      restoreIdleStatus();
      return;
    }
    const current = currentPendingAttachments();
    const accepted = [...current, ...selected].slice(0, 5);
    const overflow = selected.filter(item => !accepted.some(candidate => candidate.id === item.id));
    for (const attachment of overflow) {
      await window.athenaAPI.removePendingChatAttachment(currentChatWindowId, attachment.id);
    }
    pendingChatAttachments.set(currentChatWindowId, accepted);
    renderComposerAttachments();
    inputBar.focus();
    setStatus(`已添加 ${selected.length} 个附件`, 'ready');
    window.setTimeout(restoreIdleStatus, 1800);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '附件添加失败', 'error');
    window.setTimeout(restoreIdleStatus, 3200);
  }
}

async function chooseProjectDocuments(): Promise<void> {
  if (!currentChatWindowId || isStreaming) return;
  toggleComposerTools(false);
  try {
    setStatus('正在本地解析文档...', 'working');
    const imported = await window.athenaAPI.chooseProjectDocuments(currentChatWindowId);
    if (imported.length > 0) {
      setStatus(`已加入 Project：${imported.map(item => item.name).join('、')}`, 'ready');
      await refreshWindowMemoryPanel();
      window.setTimeout(restoreIdleStatus, 2400);
    } else {
      restoreIdleStatus();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '文档导入失败', 'error');
    window.setTimeout(restoreIdleStatus, 3200);
  }
}

async function chooseScannedProjectPdfs(): Promise<void> {
  if (!currentChatWindowId) return;
  if (isOcrImporting) {
    if (await window.athenaAPI.cancelProjectDocumentOcr()) setStatus('正在停止本地 OCR...', 'working');
    return;
  }
  if (isStreaming) return;
  const targetChatWindowId = currentChatWindowId;
  toggleComposerTools(false);
  isOcrImporting = true;
  renderChatWindowPicker();
  try {
    setStatus('正在本地识别扫描 PDF...', 'working');
    const imported = await window.athenaAPI.chooseScannedProjectPdfs(targetChatWindowId);
    if (imported.length > 0) {
      const stillViewingTarget = currentChatWindowId === targetChatWindowId;
      setStatus(stillViewingTarget
        ? `本地 OCR 已加入 Project：${imported.map(item => item.name).join('、')}`
        : `本地 OCR 已加入原 Project：${imported.map(item => item.name).join('、')}`, 'ready');
      if (stillViewingTarget) await refreshWindowMemoryPanel();
      window.setTimeout(restoreIdleStatus, 2800);
    } else {
      restoreIdleStatus();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '本地 OCR 导入失败', 'error');
    window.setTimeout(restoreIdleStatus, 3200);
  } finally {
    isOcrImporting = false;
    renderChatWindowPicker();
  }
}

function renderComposerAttachments(): void {
  if (composerAttachments.dataset.smokeLocked === 'true') return;
  composerAttachments.replaceChildren();
  const attachments = currentPendingAttachments();
  composerAttachments.dataset.visible = String(attachments.length > 0);
  for (const attachment of attachments) {
    const item = document.createElement('div');
    item.className = 'composer-attachment';
    item.dataset.kind = attachment.kind;
    let preview: HTMLElement;
    if (attachment.kind === 'image') {
      const image = document.createElement('img');
      image.alt = '';
      image.src = attachment.preview_data_url || '';
      preview = image;
    } else {
      const badge = document.createElement('div');
      badge.className = 'composer-attachment-kind';
      badge.textContent = attachment.kind === 'audio' ? '音频' : composerAttachmentLabel(attachment.mime_type);
      badge.setAttribute('aria-hidden', 'true');
      preview = badge;
    }
    const label = document.createElement('span');
    label.className = 'composer-attachment-name';
    label.textContent = attachment.original_name;
    label.title = `${attachment.original_name} · ${formatAttachmentBytes(attachment.bytes)}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'composer-attachment-remove';
    remove.title = `移除 ${attachment.original_name}`;
    remove.setAttribute('aria-label', `移除 ${attachment.original_name}`);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#icon-close');
    icon.appendChild(use);
    remove.appendChild(icon);
    remove.addEventListener('click', () => void removePendingAttachment(attachment.id));
    item.append(preview, label, remove);
    composerAttachments.appendChild(item);
  }
  resizeInputBox();
}

function composerAttachmentLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('wordprocessingml.document')) return 'DOCX';
  if (mimeType === 'text/markdown') return 'MD';
  return 'TXT';
}

function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function removePendingAttachment(attachmentId: string): Promise<void> {
  if (!currentChatWindowId) return;
  const removed = await window.athenaAPI.removePendingChatAttachment(currentChatWindowId, attachmentId);
  if (!removed) return;
  const remaining = currentPendingAttachments().filter(attachment => attachment.id !== attachmentId);
  if (remaining.length > 0) pendingChatAttachments.set(currentChatWindowId, remaining);
  else pendingChatAttachments.delete(currentChatWindowId);
  renderComposerAttachments();
}

function resizeInputBox(): void {
  inputBox.style.height = 'auto';
  const inputHeight = Math.min(inputBox.scrollHeight, 116);
  inputBox.style.height = `${inputHeight}px`;
  const attachmentHeight = composerAttachments.dataset.visible === 'true'
    ? composerAttachments.scrollHeight + 6
    : 0;
  inputForm.style.setProperty('--composer-height', `${inputHeight + 50 + attachmentHeight}px`);
  if (composerSecondaryTools.dataset.open === 'true') positionComposerTools();
}

async function loadSettingsPanel(): Promise<void> {
  setSettingsFeedback('读取设置中...');
  try {
    const bundle = await window.athenaAPI.getSettings();
    currentSettingsBundle = bundle;
    populateSettingsForm(bundle);
    applyRuntimeSettings(bundle.settings);
    void refreshSettingsMemoryReviewSummary();
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
    settingRemoteUrl.value = normalizeRemoteBaseUrl(remoteProvider, selected.baseUrl || REMOTE_PROVIDER_BASE_URLS[remoteProvider] || '');
    settingRemoteUrl.placeholder = REMOTE_PROVIDER_BASE_URLS[remoteProvider] || 'https://host.example/v1';
    settingRemoteModel.value = selected.model;
  }
  settingTemperature.value = String(selected.temperature);
  settingMaxTokens.value = String(selected.maxTokens);
  settingNumCtx.value = String(selected.numCtx);
  modelConnectionStatus.textContent = provider === 'ollama'
    ? '安装 Ollama 后，可把所选模型下载到本机。'
    : `${modelProviderLabel(provider)} 使用你填写的 API 地址、模型名和凭据。`;
  if (lastModelConnectionStatus?.provider === provider) renderModelDiagnostics(lastModelConnectionStatus);
  else resetModelDiagnostics();
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
      [provider]: { baseUrl: normalizeRemoteBaseUrl(provider, settingRemoteUrl.value), model: settingRemoteModel.value, ...generation },
    },
  };
}

function normalizeRemoteBaseUrl(provider: RemoteModelProvider, value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return REMOTE_PROVIDER_BASE_URLS[provider] || '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (provider === 'openai' && host === 'api.openai.com') {
      parsed.pathname = '/v1';
      return parsed.toString().replace(/\/$/, '');
    }
    if (provider === 'deepseek' && host === 'api.deepseek.com') {
      parsed.pathname = pathname === '/v1' || pathname === '/anthropic' || pathname === '/beta' ? '' : parsed.pathname;
      return parsed.toString().replace(/\/$/, '');
    }
    if (pathname.endsWith('/models')) parsed.pathname = parsed.pathname.slice(0, -'/models'.length) || '';
    if (pathname.endsWith('/chat/completions')) parsed.pathname = parsed.pathname.slice(0, -'/chat/completions'.length) || '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
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
  modelConnectionStatus.textContent = '正在保存配置并测试真实聊天请求...';
  setModelDiagnostic(modelDiagnosticService, 'pending', '检测中');
  setModelDiagnostic(modelDiagnosticModel, 'idle', '等待服务');
  setModelDiagnostic(modelDiagnosticChat, 'idle', '等待模型');
  try {
    await saveModelConfiguration(true);
    const status = await window.athenaAPI.testModelConnection();
    if (!status) throw new Error('主进程没有返回诊断结果');
    lastModelConnectionStatus = status;
    renderModelDiagnostics(status);
    modelConnected = status.connected;
    setStatus(status.connected ? `${modelProviderLabel(status.provider)} · ${status.model} · 已连接` : `${modelProviderLabel(status.provider)} · 模型不可用`, status.connected ? 'ready' : 'offline');
  } catch (error) {
    modelConnectionStatus.textContent = `连接测试失败：${error instanceof Error ? error.message : String(error)}`;
    modelConnectionStatus.dataset.kind = 'error';
    setModelDiagnostic(modelDiagnosticService, 'error', '测试中断');
    setModelDiagnostic(modelDiagnosticModel, 'idle', '未完成');
    setModelDiagnostic(modelDiagnosticChat, 'idle', '未完成');
  }
}

function renderModelDiagnostics(status: ModelConnectionStatus): void {
  setModelDiagnostic(modelDiagnosticService, status.serviceReachable ? 'success' : 'error', status.serviceReachable ? '已连接' : '不可达');
  setModelDiagnostic(modelDiagnosticModel, status.modelAvailable ? 'success' : 'error', status.modelAvailable ? '已安装' : '不可用');
  setModelDiagnostic(modelDiagnosticChat, status.chatSucceeded ? 'success' : 'error', status.chatSucceeded ? '请求成功' : '请求失败');
  const elapsed = typeof status.durationMs === 'number' ? ` · ${(status.durationMs / 1000).toFixed(1)} 秒` : '';
  modelConnectionStatus.textContent = status.connected
    ? `${modelProviderLabel(status.provider)} · ${status.model} 已通过真实聊天测试${elapsed}`
    : `${modelProviderLabel(status.provider)} 测试失败${status.error ? `：${status.error}` : '，请检查地址、模型和凭据。'}`;
  modelConnectionStatus.dataset.kind = status.connected ? 'success' : 'error';
}

function resetModelDiagnostics(): void {
  modelConnectionStatus.dataset.kind = '';
  setModelDiagnostic(modelDiagnosticService, 'idle', '待测试');
  setModelDiagnostic(modelDiagnosticModel, 'idle', '待测试');
  setModelDiagnostic(modelDiagnosticChat, 'idle', '待测试');
}

function setModelDiagnostic(target: HTMLElement, state: 'idle' | 'pending' | 'success' | 'error', text: string): void {
  target.textContent = text;
  const row = target.closest<HTMLElement>('.model-diagnostic-row');
  if (row) row.dataset.state = state;
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
      selectControls.sync();
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
  settingPersonaProfile.value = bundle.settings.profile;
  settingUserName.value = personalization.userName;
  settingPreferredAddress.value = personalization.preferredAddress;
  settingTone.value = personalization.tone;
  settingReplyLength.value = personalization.replyLength;
  settingInitiative.value = personalization.initiative;
  settingProactiveCare.checked = personalization.proactiveCare;
  settingMemorySmalltalk.checked = personalization.useMemoryInSmallTalk;
  settingCreatorHints.checked = personalization.creatorModeHints;
  settingCustomNotes.value = personalization.customNotes;
  inputBox.placeholder = modePlaceholder(currentMode);
  void loadPersonaEditorState(bundle.settings.profile);
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
  settingMemoryImportMode.value = memory.importContentMode || 'normal';
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
  settingConsentImageGeneration.checked = privacy.networkConsent.imageGeneration;
  settingConsentRemoteModel.checked = privacy.networkConsent.remoteModel;
  settingConsentExternalToolNetwork.checked = privacy.networkConsent.externalToolNetwork;
  applySkuRuntimeProfile(bundle.sku);
  selectControls.sync();
  void refreshVoiceCapabilities();
}

async function loadPersonaEditorState(profileId: string): Promise<void> {
  try {
    const state = await window.athenaAPI.getPersona(profileId);
    if (!state) throw new Error('主进程没有返回角色卡');
    currentPersonaEditorState = state;
    populatePersonaCardForm(state);
  } catch (error) {
    personaCardSummary.textContent = `角色卡加载失败：${error instanceof Error ? error.message : String(error)}`;
    currentPersonaEditorState = null;
  }
}

function populatePersonaCardForm(state: PersonaEditorState): void {
  const card = state.card;
  personaDisplayName.value = card.displayName;
  personaNickname.value = card.nickname;
  personaIdentity.value = card.identity;
  personaRelationship.value = card.relationshipFrame;
  personaTraits.value = linesFromList(card.prompt.traits);
  personaSpeakingStyle.value = linesFromList(card.prompt.speakingStyle);
  personaRoleplayNotes.value = linesFromList(card.prompt.roleplayNotes);
  personaBoundaries.value = linesFromList(card.prompt.boundaries);
  personaSelfIntro.value = card.prompt.selfIntroductionExample;
  const sourceLabel = state.source === 'builtin' ? '内置默认卡' : state.card.visibility === 'private' ? '本机私有卡' : '本机角色卡';
  const pathLabel = state.sourcePath ? ` · ${state.sourcePath}` : '';
  personaCardSummary.textContent = `当前角色：${card.displayName}${card.nickname && card.nickname !== card.displayName ? ` / ${card.nickname}` : ''} · ${sourceLabel}${pathLabel}`;
}

function readPersonaCardPatch(): PersonaCardPatch {
  return {
    displayName: personaDisplayName.value.trim() || 'Athena',
    nickname: personaNickname.value.trim(),
    description: currentPersonaEditorState?.card.description || '',
    identity: personaIdentity.value.trim(),
    relationshipFrame: personaRelationship.value.trim(),
    traits: listFromLines(personaTraits.value),
    speakingStyle: listFromLines(personaSpeakingStyle.value),
    roleplayNotes: listFromLines(personaRoleplayNotes.value),
    boundaries: listFromLines(personaBoundaries.value),
    selfIntroductionExample: personaSelfIntro.value.trim(),
  };
}

async function savePersonaCardForm(profileId: string): Promise<PersonaEditorState | null> {
  const state = await window.athenaAPI.savePersona(profileId, readPersonaCardPatch());
  if (!state) throw new Error('角色卡保存失败');
  currentPersonaEditorState = state;
  populatePersonaCardForm(state);
  return state;
}

async function importPersonaJsonFile(): Promise<void> {
  const profileId = settingPersonaProfile.value.trim() || 'default';
  try {
    const sourcePath = await window.athenaAPI.choosePersonaImportFile();
    if (!sourcePath) return;
    personaCardSummary.textContent = '正在导入人格 JSON...';
    const state = await window.athenaAPI.importPersonaFile(profileId, sourcePath);
    if (!state) throw new Error('主进程没有返回角色卡');
    currentPersonaEditorState = state;
    populatePersonaCardForm(state);
    setSettingsFeedback(`已导入人格 JSON：${sourcePath}`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    personaCardSummary.textContent = `人格 JSON 导入失败：${message}`;
    setSettingsFeedback(`人格 JSON 导入失败：${message}`, 'error');
  }
}

function listFromLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[\-*]\s*/, ''))
    .filter(Boolean)
    .slice(0, 80);
}

function linesFromList(value: string[]): string {
  return value.join('\n');
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
    settingConsentImageGeneration,
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
      selectControls.sync();
      setSettingsFeedback('已取消升权，其他设置尚未保存。');
      return;
    }
  }

  try {
    const profileId = settingPersonaProfile.value.trim() || 'default';
    await savePersonaCardForm(profileId);
    const bundle = await window.athenaAPI.saveSettings({
        settings: {
          profile: profileId,
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
          importContentMode: settingMemoryImportMode.value as MemoryImportContentMode,
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
            imageGeneration: settingConsentImageGeneration.checked,
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
  liquidGlassRenderer.setMotionReduced(settings.appearance.animationLevel === 'low');
  liquidGlassRenderer.setEnabled(settings.appearance.glassEffects);
  motionSystem.setMotionReduced(settings.appearance.animationLevel === 'low');
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
    await loadDiagnosticHealth();
  } catch (error) {
    privacyDataMap.textContent = `隐私中心加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadDiagnosticHealth(): Promise<void> {
  try {
    const health = await window.athenaAPI.getDiagnosticHealth();
    if (!health) return;
    const runs = Object.values(health.agent.runsByStatus).reduce((sum, value) => sum + value, 0);
    diagnosticsSummary.textContent = `诊断：数据库 ${health.storage.database.quickCheck === 'ok' ? '正常' : '异常'} · ${health.storage.diagnostics.files} 个崩溃文件 · ${runs} 次 Agent 运行`;
    diagnosticsSummary.dataset.kind = health.storage.database.quickCheck === 'ok' ? 'success' : 'error';
  } catch (error) {
    diagnosticsSummary.textContent = `诊断加载失败：${error instanceof Error ? error.message : String(error)}`;
    diagnosticsSummary.dataset.kind = 'error';
  }
}

async function exportDiagnosticSupport(): Promise<void> {
  setSettingsFeedback('正在生成本地诊断支持包...');
  try {
    const result = await window.athenaAPI.exportDiagnosticSupport();
    if (!result) throw new Error('诊断导出请求被拒绝');
    setSettingsFeedback(`诊断支持包已导出 ${Math.round(result.bytes / 1024)} KB：${result.path}`, 'success');
    await loadDiagnosticHealth();
  } catch (error) {
    setSettingsFeedback(`诊断导出失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function clearDiagnostics(): Promise<void> {
  try {
    const result = await window.athenaAPI.clearDiagnostics();
    if (!result) throw new Error('诊断清除请求被拒绝');
    setSettingsFeedback(`已清除 ${result.filesDeleted} 个本机诊断文件`, 'success');
    await loadDiagnosticHealth();
  } catch (error) {
    setSettingsFeedback(`诊断清除失败：${error instanceof Error ? error.message : String(error)}`, 'error');
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
  if (tabName === 'review') {
    await loadMemoryReviewQueue();
    memoryReviewStatus.focus();
  }
  if (tabName === 'manage') {
    await loadMemoryList();
    memorySearch.focus();
  }
  if (tabName === 'debug') memoryDebugQuery.focus();
  if (tabName === 'import') memoryImportPath.focus();
}

async function refreshSettingsMemoryReviewSummary(): Promise<void> {
  try {
    const pending = await window.athenaAPI.listMemoryReviewQueue('pending', 1);
    settingMemoryReviewSummary.textContent = pending.length > 0
      ? '有待确认记忆。打开队列后可逐条确认或拒绝，确认后才写入长期记忆。'
      : '暂无待确认记忆。自动抽取到的规则和时间事实会先进入这里。';
  } catch {
    settingMemoryReviewSummary.textContent = '暂时无法读取待确认记忆队列。';
  }
}

async function loadMemoryReviewQueue(): Promise<void> {
  memoryReviewSummary.textContent = '读取中...';
  currentMemoryReviewItems = [];
  updateMemoryReviewBulkActions();
  memoryReviewList.replaceChildren();
  try {
    const status = memoryReviewStatus.value as MemoryReviewStatus | 'all';
    const items = await window.athenaAPI.listMemoryReviewQueue(status, 100);
    currentMemoryReviewItems = items;
    const pendingCount = items.filter(item => item.status === 'pending').length;
    memoryReviewSummary.textContent = `${reviewStatusLabel(status)} ${items.length} 条${pendingCount > 0 ? ` · 可批量处理 ${pendingCount} 条` : ''}`;
    updateMemoryReviewBulkActions();
    renderMemoryReviewItems(items);
    void refreshSettingsMemoryReviewSummary();
  } catch (error) {
    memoryReviewSummary.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
    updateMemoryReviewBulkActions();
  }
}

function renderMemoryReviewItems(items: MemoryReviewItem[]): void {
  memoryReviewList.replaceChildren();
  if (items.length === 0) {
    memoryReviewList.textContent = '没有待处理的记忆。';
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
    title.textContent = `${kindLabel(item.kind as MemoryKind)} · ${item.title}`;

    const actions = document.createElement('div');
    actions.className = 'memory-item-actions';
    if (item.status === 'pending') {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.title = '确认写入长期记忆';
      approve.textContent = '✓';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        await window.athenaAPI.approveMemoryReview(item.id);
        await loadMemoryReviewQueue();
      });
      actions.appendChild(approve);

      const reject = document.createElement('button');
      reject.type = 'button';
      reject.title = '拒绝这条候选记忆';
      reject.textContent = '×';
      reject.addEventListener('click', async () => {
        reject.disabled = true;
        await window.athenaAPI.rejectMemoryReview(item.id);
        await loadMemoryReviewQueue();
      });
      actions.appendChild(reject);
    }

    const content = document.createElement('div');
    content.className = 'memory-item-content';
    content.textContent = item.content;

    const meta = document.createElement('div');
    meta.className = 'memory-item-meta';
    const reviewed = item.reviewed_at ? ` · reviewed ${item.reviewed_at}` : '';
    meta.textContent = `${reviewStatusLabel(item.status)} · ${item.reason || 'review required'} · confidence ${item.confidence.toFixed(2)} · importance ${item.importance}${reviewed}`;

    const details = document.createElement('details');
    details.className = 'memory-review-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = '审核细节';
    const detailsBody = document.createElement('div');
    detailsBody.className = 'memory-review-details-body';
    detailsBody.textContent = reviewPayloadSummary(item);
    details.append(detailsSummary, detailsBody);

    head.append(title, actions);
    row.append(head, content, meta, details);
    memoryReviewList.appendChild(row);
  }
}

function reviewSourceLabel(item: MemoryReviewItem): string {
  const source = item.source_table && item.source_id ? `${item.source_table}#${item.source_id}` : 'manual/source unknown';
  const windowLabel = item.chat_window_id ? `window#${item.chat_window_id}` : '';
  const applied = item.applied_table && item.applied_id ? `applied ${item.applied_table}#${item.applied_id}` : '';
  return [source, windowLabel, applied].filter(Boolean).join(' / ');
}

function reviewPayloadSummary(item: MemoryReviewItem): string {
  const lines = [
    `id: ${item.id}`,
    `status: ${item.status}`,
    `kind: ${item.kind}`,
    `group: ${item.group_key || 'none'}`,
    `source: ${reviewSourceLabel(item)}`,
    `created: ${item.created_at}`,
  ];
  if (item.reviewed_at) lines.push(`reviewed: ${item.reviewed_at}`);
  const payload = JSON.stringify(item.payload || {}, null, 2);
  lines.push('payload:', payload.length > 1800 ? `${payload.slice(0, 1800)}...` : payload);
  return lines.join('\n');
}

function pendingVisibleReviewIds(): number[] {
  return currentMemoryReviewItems
    .filter(item => item.status === 'pending')
    .map(item => item.id);
}

function updateMemoryReviewBulkActions(): void {
  const count = pendingVisibleReviewIds().length;
  memoryReviewApproveVisible.disabled = count === 0;
  memoryReviewRejectVisible.disabled = count === 0;
  memoryReviewApproveVisible.textContent = count > 0 ? `批量确认 ${count}` : '批量确认';
  memoryReviewRejectVisible.textContent = count > 0 ? `批量拒绝 ${count}` : '批量拒绝';
}

async function approveVisibleMemoryReviews(): Promise<void> {
  const ids = pendingVisibleReviewIds();
  if (ids.length === 0) return;
  memoryReviewApproveVisible.disabled = true;
  memoryReviewRejectVisible.disabled = true;
  memoryReviewSummary.textContent = `正在确认 ${ids.length} 条...`;
  await window.athenaAPI.approveMemoryReviews(ids);
  await loadMemoryReviewQueue();
}

async function rejectVisibleMemoryReviews(): Promise<void> {
  const ids = pendingVisibleReviewIds();
  if (ids.length === 0) return;
  memoryReviewApproveVisible.disabled = true;
  memoryReviewRejectVisible.disabled = true;
  memoryReviewSummary.textContent = `正在拒绝 ${ids.length} 条...`;
  await window.athenaAPI.rejectMemoryReviews(ids);
  await loadMemoryReviewQueue();
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
  memoryTotalRow.textContent = `画像 ${totals.profile} · 规则 ${totals.procedure} · 事实 ${totals.fact} · 事件 ${totals.event} · 日总结 ${totals.daily} · 项目 ${totals.project} · 对话 ${totals.message}`;
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
    renderDebugSection('工作规则', result.proceduralMemories);
    renderDebugSection('时间事实', result.temporalFacts);
    renderDebugSection('项目', result.projectNotes);
    renderDebugSection('事件', result.relatedEvents);
    renderDebugSection('日总结', result.dailySummaries);
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
    const modeLabel = preview.contentMode === 'adult' ? '18+ mode' : 'normal mode';
    memoryImportSummary.textContent = `${modeLabel} | records ${preview.totalRecords} | assistant ${preview.assistantMessages} | extracted ${preview.extractedAddMemories} | importable ${preview.accepted.length} | filtered ${preview.rejected.length}`;
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
  const wasRecording = voiceInputState === 'recording';
  voiceInputState = state;
  inputForm.dataset.voiceState = state;
  const isRecording = state === 'recording';
  if (!wasRecording && isRecording) void dispatchLive2dEvent({ type: 'voice.listening.start' });
  if (wasRecording && !isRecording) void dispatchLive2dEvent({ type: 'voice.listening.end' });
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
    if (RELEASE_FEATURES.live2d && live2dCompanion.isEnabled) {
      await playAudioInRenderer(result.audioPath);
    } else {
      const playback = await window.athenaAPI.playAudioFile(result.audioPath);
      if (!playback.ok) await playAudioInRenderer(result.audioPath);
      else showVoiceFeedback('朗读完成', 'success', 1800);
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
  await live2dCompanion.attachAudio(audio);
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
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  void live2dCompanion.stopAudioTracking();
}

function toFileUrl(filePath: string): string {
  return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

function kindLabel(kind: MemoryKind): string {
  const labels: Record<MemoryKind, string> = {
    profile: '画像',
    procedure: '工作规则',
    fact: '时间事实',
    event: '事件',
    daily: '日总结',
    project: '项目',
    message: '对话',
  };
  return labels[kind];
}

function reviewStatusLabel(status: MemoryReviewStatus | 'all'): string {
  if (status === 'pending') return '待确认';
  if (status === 'applied') return '已确认';
  if (status === 'rejected') return '已拒绝';
  return '全部';
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
  const persona = currentPersonaLabel();
  if (mode === 'create') return `${persona}在构思...`;
  if (mode === 'reason') return `${persona}在推理...`;
  if (mode === 'execute') return `${persona}在规划执行...`;
  return `${persona}在听...`;
}

function modeHintText(mode: AthenaMode): string {
  if (mode === 'create') return '创作模式 · 开放创作';
  if (mode === 'reason') return '推理模式 · 核验后判断';
  if (mode === 'execute') return '执行模式 · 调用工具完成任务';
  return '陪伴模式 · 自然地聊';
}

function modePlaceholder(mode: AthenaMode): string {
  if (mode === 'create') return '描述想做的画面、文字或方案...';
  if (mode === 'reason') return `把问题、条件和目标告诉${currentPersonaLabel()}...`;
  if (mode === 'execute') return '用自然语言描述要在电脑上完成的任务...';
  return `和${currentPersonaLabel()}说点什么...`;
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

function createPersonaImportJsonButton(): HTMLButtonElement {
  const existing = document.getElementById('persona-import-json');
  if (existing instanceof HTMLButtonElement) return existing;

  const button = document.createElement('button');
  button.id = 'persona-import-json';
  button.type = 'button';
  button.textContent = '导入人格 JSON';
  button.className = 'settings-inline-button';

  const field = document.createElement('label');
  field.className = 'settings-field settings-field-full';
  const label = document.createElement('span');
  label.textContent = '人格文件';
  const note = document.createElement('span');
  note.className = 'settings-note';
  note.textContent = '选择本机 JSON 文件后，会写入当前角色卡 ID 并回填下方表单。';
  field.append(label, button, note);

  const anchor = settingPersonaProfile.closest('.settings-field');
  anchor?.after(field);
  return button;
}

function createMemoryImportModeControl(): HTMLSelectElement {
  const existing = document.getElementById('setting-memory-import-mode');
  if (existing instanceof HTMLSelectElement) return existing;

  const field = document.createElement('label');
  field.className = 'settings-field';

  const label = document.createElement('span');
  label.textContent = '记忆导入模式';

  const select = document.createElement('select');
  select.id = 'setting-memory-import-mode';
  select.append(
    optionForMemoryImportMode('normal', '正常'),
    optionForMemoryImportMode('adult', '18+')
  );

  const note = document.createElement('span');
  note.className = 'settings-note';
  note.textContent = '18+ 模式下，亲密/身份边界内容不会在导入预览中自动过滤；保存设置后生效。';

  field.append(label, select, note);
  personaCardSummary.after(field);
  return select;
}

function optionForMemoryImportMode(value: MemoryImportContentMode, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function relaxPersonaEditorInputLimits(): void {
  const limits: Array<[string, number, number?]> = [
    ['persona-display-name', 120],
    ['persona-nickname', 120],
    ['persona-identity', 4_000, 5],
    ['persona-relationship', 4_000, 5],
    ['persona-traits', 80_000, 6],
    ['persona-speaking-style', 80_000, 6],
    ['persona-roleplay-notes', 80_000, 6],
    ['persona-boundaries', 80_000, 6],
    ['persona-self-intro', 2_000, 4],
  ];
  for (const [id, maxLength, rows] of limits) {
    const element = document.getElementById(id);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.maxLength = maxLength;
      if (rows !== undefined && element instanceof HTMLTextAreaElement) element.rows = rows;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
