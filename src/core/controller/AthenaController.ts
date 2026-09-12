import { createAssistModelClient, LLMClient } from '../ai/Client';
import { nativeImage } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canRouteModelRequest } from '../ai/ModelNetworkPolicy';
import { TOOL_PERMISSION_RANK } from '../config/SettingsStore';
import { SETTINGS_LOCATIONS } from '../config/SettingsLocations';
import {
  ModelCreativeSectionExtractor,
  buildCreativePrompt,
  creativeStateSummary,
  describeCreativeChange,
  formatCreativeStateForDisplay,
  formatCreativeProposal,
  hasCreativeContent,
  isCreativeCandidate,
  localCreativeExtraction,
  mergeCreativeState,
  needsCreativeConfirmation,
  parseCreativeWorkspace,
  parseLabeledCreativeSpec,
  readCreativeReply,
  serializeCreativeWorkspace,
  type CreativeExtraction,
  type CreativePendingProposal,
  type CreativeSection,
  type CreativeState,
  type CreativeWorkspace,
} from '../creative';
import { classifyModelFailure } from '../ai/ModelFailure';
import { resolvePersonaCard } from '../ai/Personality';
import {
  DEFAULT_INITIATIVE_POLICY,
  InitiativeEngine,
  ModelInitiativeDecider,
  type InitiativeContext,
} from '../initiative';
import { Conversation } from '../ai/Conversation';
import { EmotionEngine } from '../ai/Emotion';
import { buildChatPrompt } from '../ai/PromptBuilder';
import { getAppSettings, resolveToolSettingsForMode, shouldSaveHistory } from '../config/SettingsStore';
import { WebSearchService } from '../web/WebSearchService';
import { WebResearchAgent } from '../web/WebResearchAgent';
import { SearchApiClient } from '../web/SearchApiClient';
import { trustedClock } from '../runtime/TrustedClock';
import { resolveSearchCredential } from '../ai/CredentialStore';
import {
  AgentRunner,
  AgentStore,
  ProjectWorkspaceService,
  ToolRegistry,
  type AgentRunnerResult,
  type UpdateAgentWorkspaceInput,
} from '../agent';
import { ComputerAgentToolBridge } from '../tools/AgentComputerTools';
import { SkillAgentToolBridge, SkillLibrary } from '../skills';
import { McpIntegrationHost, ResearchAgentToolBridge } from '../integrations';
import {
  ArtifactAgentToolBridge,
  ArtifactWorkspaceService,
  DocumentArtifactService,
  ElectronPdfRenderer,
  ImageGenerationRouter,
  isContextualImageCommand,
  resolveDirectImageGenerationIntent,
  type DirectImageGenerationIntent,
} from '../artifacts';
import {
  AttachmentService,
  downloadDroppedImage,
  expandDroppedPaths,
  resolveAttachmentRoot,
  sniffImageExtension,
  withChatAttachmentContext,
  writeDroppedText,
  type PreparedChatAttachment,
} from '../attachments';
import { extractChatDocument, ProjectDocumentService } from '../documents';
import { LocalOcrService, OcrAgentToolBridge } from '../ocr';
import { AgentMessageRouter, ModelSemanticRoutingClassifier } from '../routing';
import { evaluateSteamAiContent, steamAiGuardrailRefusal } from '../steam/SteamAiGuardrails';
import { isSteamSku } from '../steam/SteamSkuPolicy';
import {
  applyDataRetention,
  canUseNetworkCapability,
  consentRequiredMessage,
  recordDataActivity,
} from '../privacy/PrivacyDataService';
import { Reminder, setLiveReminder, type DueReminder } from '../scheduler/Reminder';
import { WorkflowManager } from '../workflow/WorkflowManager';
import {
  applyMemoryRetentionPolicy,
  applyMemoryRetentionPolicyWithRefiner,
  cleanupTemporaryChatWindows,
  deleteChatWindow,
  ensureDefaultChatWindow,
  ensureDefaultProject,
  getActiveChatWindow,
  getChatWindow,
  getChatWindowCreativeState,
  getChatWindowMessages,
  saveChatWindowCreativeState,
  closeDatabase,
  extractMemoryFromUserMessage,
  getDatabase,
  getStats,
  purgeEphemeralChatMessages,
  queueExtractedMemory,
  rebuildMemoryIndex,
  retrieveContext,
  saveChatMessage,
  saveMessage,
} from '../../memory';
import type { ModelImageInput } from '../ai/model';
import { globalEventBus } from '../../engine/EventBus';
import { createLogger } from '../../engine/Logger';
import { TurnProfile, isAbort } from '../runtime/TurnProfile';
import type { DailyMemoryRefinement, DailyMemoryRefinementInput, MemoryRetentionPolicyResult } from '../../memory';
import type {
  AgentCapabilityAccess,
  AgentProjectWorkspaceSnapshot,
  AgentRunSnapshot,
  AgentWorkspaceMetadata,
  AgentSkillLibrarySnapshot,
  AgentSkillSummary,
  AgentTaskRecord,
  AgentMessageRouteDecision,
  McpIntegrationSnapshot,
  McpServerConfig,
  McpServerInput,
  ChatResponse,
  ConversationMode,
  MemorySettings,
  RetrievedContext,
  SystemInfo,
  ToolSettings,
  ToolStatusEvent,
  ToolConfirmationRequest,
  WebSearchContext,
  WebSearchStatus,
  ToolCatalog,
  ChatAttachment,
  ChatWindow,
  DroppedImportOutcome,
  ProactiveDelivery,
  ProactiveSource,
} from '../../shared/types';

const logger = createLogger('AthenaController');

// Below this a message is chat, not a description worth reading for sections.
const CREATIVE_SCAN_MIN_CHARS = 300;

// Mirrors the attachment store's per-message ceiling; a drop is trimmed to it
// rather than rejected wholesale.
const MAX_DROPPED_FILES = 5;

/**
 * Where a drop is staged before import. It sits beside managed attachment
 * storage rather than inside it, because everything under the managed root has
 * to be a file the store itself wrote.
 */
function droppedStagingRoot(): string {
  return path.join(path.dirname(resolveAttachmentRoot()), 'dropped-staging');
}

/**
 * How long the creative extraction may hold the turn before the reply proceeds
 * without it. This step sits in series ahead of the answer the user is waiting
 * for, so it fails fast and degrades to leaving the description alone - which is
 * the same thing an unreadable reply already does (ATH-PERF-001).
 */
const CREATIVE_EXTRACTION_TIMEOUT_MS = 6_000;

/** What a creative turn did, so the caller knows whether to draw, ask, or carry on. */
type CreativeTurnOutcome =
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'proposed'; message: string }
  | {
    kind: 'applied';
    state: CreativeState;
    changed: CreativeSection[];
    refused: CreativeSection[];
    understanding: string;
  };
const STARTUP_MAINTENANCE_DELAY_MS = 5_000;

interface ProcessMessageOptions {
  forceWebSearch?: boolean;
  onWebSearchStatus?: (status: WebSearchStatus) => void;
  onToolStatus?: (status: ToolStatusEvent) => void;
  onToolConfirm?: (request: ToolConfirmationRequest) => Promise<boolean>;
  chatWindowId?: number;
  attachmentIds?: string[];
  routingStage?: { durationMs: number; outcome: string };
}

interface RouteMessageOptions {
  forceWebSearch?: boolean;
  chatWindowId?: number;
  routingTicket?: string;
}

interface PendingRoute {
  expiresAt: number;
  message: string;
  requestedMode: ConversationMode;
  forceWebSearch: boolean;
  chatWindowId?: number;
  decision: AgentMessageRouteDecision;
}

export class AthenaController {
  private llm: LLMClient;
  private conversation: Conversation;
  private emotion: EmotionEngine;
  private reminder: Reminder;
  private initiative: InitiativeEngine;
  private creativeExtractor: ModelCreativeSectionExtractor;
  /** In-flight foreground requests, so background work can stand aside (ATH-PERF-001). */
  private foregroundRequests = 0;
  private readonly pendingRoutes = new Map<string, PendingRoute>();
  private workflows: WorkflowManager;
  private webSearch: WebSearchService;
  private webResearch: WebResearchAgent;
  private readonly agentStore: AgentStore;
  private readonly agentTools: ToolRegistry;
  private readonly agentComputerTools: ComputerAgentToolBridge;
  private readonly projectWorkspace: ProjectWorkspaceService;
  private readonly skillLibrary: SkillLibrary;
  private readonly skillTools: SkillAgentToolBridge;
  private readonly mcpIntegrations: McpIntegrationHost;
  private readonly researchTools: ResearchAgentToolBridge;
  private readonly artifactTools: ArtifactAgentToolBridge;
  private readonly imageRouter: ImageGenerationRouter;
  private readonly ocr: LocalOcrService;
  private readonly ocrTools: OcrAgentToolBridge;
  private readonly attachments: AttachmentService;
  private readonly documents: ProjectDocumentService;
  private messageRouter: AgentMessageRouter;
  private agentRunner: AgentRunner;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private memoryMaintenanceTimer: ReturnType<typeof setTimeout> | null = null;
  private memoryMaintenanceRunning = false;

  constructor() {
    this.llm = new LLMClient();
    this.conversation = new Conversation(this.llm);
    this.emotion = new EmotionEngine();
    this.reminder = new Reminder();
    this.initiative = this.buildInitiativeEngine();
    this.creativeExtractor = new ModelCreativeSectionExtractor(createAssistModelClient(this.llm));
    this.workflows = new WorkflowManager();
    // The contracted API leads only when a key is actually resolvable; without one
    // the service keeps the scraped providers exactly as before.
    // Prompts state today's date from network time whenever a host the user already
    // consented to answers: the remote model's endpoint first, since every turn talks
    // to it anyway, then the search providers while search is on. Nothing else.
    trustedClock.configure({
      resolveOrigins: () => [
        ...(this.llm.providerName !== 'ollama' && canUseNetworkCapability('remoteModel') ? [this.llm.endpoint] : []),
        ...(canUseNetworkCapability('webSearch') && getAppSettings().webSearch.enabled ? ['https://cn.bing.com', 'https://m.sogou.com'] : []),
      ],
    });
    this.webSearch = new WebSearchService(undefined, undefined, new SearchApiClient(() => {
      const apiKey = resolveSearchCredential('zhipu');
      return apiKey ? { provider: 'zhipu', apiKey } : null;
    }));
    // The planner runs on the assist client so its extra round trips stay off the
    // main model's latency budget; a blank assist model keeps the main one.
    this.webResearch = new WebResearchAgent(createAssistModelClient(this.llm), this.webSearch);
    this.attachments = new AttachmentService();
    this.ocr = new LocalOcrService();
    this.documents = new ProjectDocumentService({ ocr: this.ocr });
    this.messageRouter = this.createMessageRouter();
    this.agentStore = new AgentStore();
    this.agentTools = new ToolRegistry();
    this.agentComputerTools = new ComputerAgentToolBridge({
      registry: this.agentTools,
      getSettings: runId => this.resolveAgentToolSettings(runId),
    });
    this.projectWorkspace = new ProjectWorkspaceService(this.agentStore);
    this.skillLibrary = new SkillLibrary();
    this.skillTools = new SkillAgentToolBridge(this.agentTools, this.skillLibrary);
    this.mcpIntegrations = new McpIntegrationHost(this.agentTools, {
      allowExternalNetwork: () => canUseNetworkCapability('externalToolNetwork'),
    });
    this.researchTools = new ResearchAgentToolBridge({
      registry: this.agentTools,
      webSearch: this.webSearch,
      getWebSearchSettings: () => getAppSettings().webSearch,
      canUseWebSearch: () => canUseNetworkCapability('webSearch'),
      canInspectProject: () => this.resolveAgentToolSettings().permissionLevel !== 'off',
      resolveProjectRoots: runId => this.resolveProjectRootsForRun(runId),
    });
    this.imageRouter = new ImageGenerationRouter({
      settingsResolver: () => getAppSettings().imageGeneration,
      decodeValidator: bytes => {
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error('Generated image could not be decoded by Electron');
        return image.getSize();
      },
    });
    this.artifactTools = new ArtifactAgentToolBridge({
      registry: this.agentTools,
      workspace: new ArtifactWorkspaceService({
        store: this.agentStore,
        resolveProjectRoots: runId => this.resolveProjectRootsForRun(runId),
      }),
      documents: new DocumentArtifactService(new ElectronPdfRenderer()),
      images: this.imageRouter,
      canWriteArtifacts: () => ['files', 'full'].includes(this.resolveAgentToolSettings().permissionLevel),
      canGenerateImages: () => !isSteamSku() && (!this.imageRouter.isNetworkProvider() || canUseNetworkCapability('imageGeneration')),
      hasImageCredential: () => this.imageRouter.isAvailable(),
      resolveReferenceImages: (runId, attachmentIds) => {
        const run = this.agentStore.getRun(runId);
        const task = run ? this.agentStore.getTask(run.taskId) : null;
        if (!task?.chatWindowId) throw new Error('Image edit run has no active chat window.');
        return this.attachments.resolveModelImages(task.chatWindowId, attachmentIds);
      },
    });
    this.ocrTools = new OcrAgentToolBridge({
      registry: this.agentTools,
      ocr: this.ocr,
      resolveImages: (runId, attachmentIds) => {
        const run = this.agentStore.getRun(runId);
        const task = run ? this.agentStore.getTask(run.taskId) : null;
        if (!task?.chatWindowId) throw new Error('OCR run has no active chat window.');
        return this.attachments.resolveModelImages(task.chatWindowId, attachmentIds);
      },
    });
    this.agentRunner = new AgentRunner(this.llm, this.agentTools, undefined, this.agentStore);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;
    // Fire and forget: prompts read this machine's clock until a consented host answers.
    void trustedClock.sync();

    this.initializePromise = this.runInitialize().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  private async runInitialize(): Promise<void> {
    logger.info('Initializing Athena...');
    getDatabase();
    const temporaryAttachmentsDeleted = this.attachments.cleanupTemporaryWindowFiles();
    const temporaryWindowsDeleted = cleanupTemporaryChatWindows();
    if (temporaryWindowsDeleted > 0) {
      logger.info(`Cleaned up ${temporaryWindowsDeleted} temporary chat windows and ${temporaryAttachmentsDeleted} attachment files.`);
    }
    this.purgeUnsavedChatSegment();
    this.reminder.setDueHandler(reminder => this.handleReminderDue(reminder));
    // Cloud sync arms what it adopts through this, so a reminder set on the
    // phone rings here today rather than after the next restart.
    setLiveReminder(this.reminder);
    const reminders = this.reminder.restorePending();
    if (reminders.restored > 0) {
      logger.info(`Restored ${reminders.restored} pending reminders (${reminders.overdue} already due).`);
    }
    this.initiative.start();
    this.emotion.setBaseEmotion(new Date().getHours());
    const settings = getAppSettings();
    this.applyToolPermission(settings.tools, settings.conversation.activeMode);
    if (settings.imageGeneration.provider === 'local' && settings.imageGeneration.local.autoDiscover) {
      void this.imageRouter.refreshLocalDiscovery().then(() => this.artifactTools.refresh()).catch(error => {
        logger.warn(`Local image discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    this.initialized = true;
    this.scheduleDailyMemoryMaintenance();
    this.scheduleStartupMaintenance();
    logger.info('Athena initialized.');
    globalEventBus.emit('athena:ready');
  }

  /**
   * One turn, with its stages timed and a foreground marker held for the duration.
   * The marker is what lets an initiative wake stand aside rather than compete for
   * the same provider; the timings are what make a serial pile-up visible in the
   * log instead of showing up only as "it felt slow" (ATH-PERF-001).
   */
  async processMessage(
    userMessage: string,
    requestedMode?: ConversationMode,
    onStream?: (chunk: string) => void,
    options?: ProcessMessageOptions,
  ): Promise<ChatResponse> {
    const profile = new TurnProfile();
    if (options?.routingStage) {
      profile.record('routing', options.routingStage.durationMs, options.routingStage.outcome);
    }
    this.foregroundRequests += 1;
    try {
      return await this.runMessage(userMessage, requestedMode, onStream, options, profile);
    } finally {
      this.foregroundRequests = Math.max(0, this.foregroundRequests - 1);
      logger.info(`Turn profile: ${profile.format()}`);
    }
  }

  private async runMessage(
    userMessage: string,
    requestedMode: ConversationMode | undefined,
    onStream: ((chunk: string) => void) | undefined,
    options: ProcessMessageOptions | undefined,
    profile: TurnProfile,
  ): Promise<ChatResponse> {
    if (!this.initialized) await this.initialize();

    const settings = getAppSettings();
    const mode = requestedMode ?? settings.conversation.activeMode;
    const requestedChatWindowId = options?.chatWindowId && options.chatWindowId > 0 ? options.chatWindowId : undefined;
    const chatWindow = (requestedChatWindowId ? getChatWindow(requestedChatWindowId) : null)
      ?? ensureDefaultChatWindow();
    const chatWindowId = chatWindow.id;
    const isTemporaryChat = chatWindow.is_temporary === true;
    const attachmentIds = options?.attachmentIds || [];
    const modelImages = await this.prepareModelImages(chatWindowId, attachmentIds);
    const attachmentText = this.attachments.resolveTextContext(chatWindowId, attachmentIds);
    const promptUserMessage = withChatAttachmentContext(userMessage, attachmentText);
    const effectiveSaveHistory = settings.conversation.saveHistory && !isTemporaryChat;
    const modeToolSettings = this.applyToolPermission(settings.tools, mode);
    modeToolSettings.allowExternalNetwork = settings.privacy.networkConsent.externalToolNetwork;
    logger.info(`User message received [mode=${mode}, tools=${modeToolSettings.permissionLevel}, chars=${userMessage.length}]`);
    // Notices a reconnect or a dropped network since the last turn; never delays this one.
    void trustedClock.syncIfStale();
    const inputGuardrail = evaluateSteamAiContent(userMessage);
    if (!inputGuardrail.allowed) {
      const content = steamAiGuardrailRefusal();
      logger.warn(`Steam AI input blocked [category=${inputGuardrail.category}]`);
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }
    // Read before this message is saved, so it holds the turns this one is
    // answering. Both the image intent and the web search resolve what a
    // subject-less command ("再画一张", "你查一下") is pointing at from here.
    const recentTurns = getChatWindowMessages(chatWindowId, 24).map(message => ({
      role: message.role,
      content: message.content,
    }));
    const savedUser = this.saveConversationMessage('user', userMessage, undefined, mode, chatWindowId);
    if (savedUser.chatMessageId && attachmentIds.length > 0) {
      this.attachments.attachToMessage(chatWindowId, savedUser.chatMessageId, attachmentIds);
    }

    // In the creative workspace, and whenever this window already holds a
    // description, the message is read for what it changes before anything is
    // drawn. Elsewhere the state is left alone so ordinary chat costs nothing.
    const creativeWorkspace = parseCreativeWorkspace(getChatWindowCreativeState(chatWindowId));
    // The reported case was a visual brief pasted in Companion mode, so this cannot
    // be limited to Create. The length gate is about cost - reading every short
    // message used to mean a model round trip per turn - so a brief that carries its
    // own headings is admitted regardless of length, because reading it is free
    // (ATH-CHAT-004, ATH-IMG-004).
    // Length alone admitted every long discussion, and the extraction it paid for
    // sits in series ahead of the reply. A message now has to look like it is about
    // a picture as well as being long enough to be one (ATH-PERF-001).
    const creativeContext = mode === 'create'
      || Boolean(creativeWorkspace.pending)
      || hasCreativeContent(creativeWorkspace.state)
      || (mode !== 'execute' && (
        parseLabeledCreativeSpec(userMessage) !== null
        || (userMessage.trim().length >= CREATIVE_SCAN_MIN_CHARS && isCreativeCandidate(userMessage))));
    let creative: CreativeTurnOutcome = { kind: 'none' };
    if (creativeContext && !isTemporaryChat) {
      creative = await this.updateCreativeState(chatWindowId, userMessage, profile);
    } else {
      profile.record('creative', 0, 'skipped');
    }

    // Understanding is delivered before acting: the proposal is the reply, and
    // nothing is drawn until the user answers it (ATH-CHAT-004).
    if (creative.kind === 'proposed') {
      const emotion = this.emotion.analyzeResponse(creative.message);
      this.saveConversationMessage('assistant', creative.message, emotion.type, mode, chatWindowId);
      if (effectiveSaveHistory) this.persistExtractedMemory(userMessage, savedUser.messageId, chatWindowId);
      return { content: creative.message, emotion };
    }
    if (creative.kind === 'cancelled') {
      const content = '好，那这次的改动就不动了。要改哪一部分随时说。';
      const emotion = this.emotion.analyzeResponse(content);
      this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      return { content, emotion };
    }
    const creativeUpdate = creative.kind === 'applied' ? creative : null;

    const merged = parseCreativeWorkspace(getChatWindowCreativeState(chatWindowId)).state;
    // "生成图片" on its own carries no subject, but the window may already hold the
    // description it refers to. Without this the command has nothing to draw.
    const imageIntent = resolveDirectImageGenerationIntent(userMessage, recentTurns)
      ?? (isContextualImageCommand(userMessage) && hasCreativeContent(merged)
        ? { prompt: buildCreativePrompt(merged), size: '1024x1024' as const, quality: 'low' as const }
        : null);
    if (imageIntent) {
      // The accumulated description wins: it carries the sections this message did
      // not mention, which is the whole point of keeping it (ATH-IMG-002).
      if (hasCreativeContent(merged)) imageIntent.prompt = buildCreativePrompt(merged);
      // A short request - "画一张雪山日出" - is too thin to be worth a model call, but
      // it is still the description this window is now about. Keeping it verbatim is
      // what gives the next message ("把天空换成傍晚") something to edit.
      else if (!isTemporaryChat) this.seedCreativeState(chatWindowId, imageIntent.prompt);
      const directImage = await this.processDirectImageRequest(
        imageIntent,
        mode,
        chatWindowId,
        options,
        creativeUpdate ? describeCreativeChange(creativeUpdate.changed, creativeUpdate.refused) : '',
      );
      if (effectiveSaveHistory) this.persistExtractedMemory(userMessage, savedUser.messageId, chatWindowId);
      return directImage;
    }

    const localCommand = attachmentIds.length === 0 ? this.processLocalCommand(userMessage, mode, chatWindowId) : null;
    if (localCommand) return localCommand;

    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint)) {
      const content = consentRequiredMessage('remoteModel');
      this.saveConversationMessage('assistant', content, this.emotion.analyzeResponse(content).type, mode, chatWindowId);
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }

    const webPlan = this.webSearch.plan({
      message: userMessage,
      force: options?.forceWebSearch,
      settings: settings.webSearch,
      recentMessages: recentTurns,
    });
    if (webPlan.inheritedTopic) {
      logger.info(`Web search subject taken from the previous turn: queryChars=${webPlan.query.length}`);
    }
    let webSearchContext: WebSearchContext | undefined;

    if (webPlan.shouldSearch && !canUseNetworkCapability('webSearch')) {
      webSearchContext = {
        query: webPlan.query,
        provider: 'none',
        searchedAt: new Date().toISOString(),
        sources: [],
        error: consentRequiredMessage('webSearch'),
      };
      options?.onWebSearchStatus?.({
        phase: 'failed',
        query: webPlan.query,
        provider: 'none',
        message: webSearchContext.error,
      });
    } else if (webPlan.shouldSearch) {
      try {
        webSearchContext = await this.webResearch.research({
          question: userMessage,
          query: webPlan.query,
          settings: settings.webSearch,
          recentMessages: recentTurns,
          onStatus: options?.onWebSearchStatus,
        });
        recordDataActivity('search', 'web-research', {
          query: webPlan.query,
          provider: webSearchContext.provider,
          providers: webSearchContext.providers || [webSearchContext.provider],
          sourceCount: webSearchContext.sources.length,
          pageCount: webSearchContext.pages?.length ?? 0,
          searchRounds: webSearchContext.searchRounds ?? 1,
        });
        logger.info(`Web research ready: queryChars=${webPlan.query.length}, sources=${webSearchContext.sources.length}, pages=${webSearchContext.pages?.length ?? 0}, rounds=${webSearchContext.searchRounds ?? 1}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : '联网搜索失败。';
        webSearchContext = {
          query: webPlan.query,
          provider: 'none',
          searchedAt: new Date().toISOString(),
          sources: [],
          error: message,
        };
        logger.warn(`Web search failed: ${message}`);
      }
    }

    const retrieved = buildRetrievedContext(
      userMessage,
      settings.memory,
      effectiveSaveHistory,
      mode,
      chatWindowId,
      savedUser.chatMessageId,
      isTemporaryChat,
    );
    const response = await profile.measure(
      'reply',
      () => this.conversation.process(
        promptUserMessage,
        retrieved.recentMessages,
        retrieved,
        mode,
        isSteamSku() ? undefined : onStream,
        webSearchContext,
        modeToolSettings,
        options?.onToolStatus,
        options?.onToolConfirm,
        { chatWindowId, userMessageId: savedUser.chatMessageId },
        modelImages,
        { imageGeneration: !isSteamSku() },
      ),
      value => (value.toolExecutions?.length ? `tools:${value.toolExecutions.length}` : 'ok'),
    );

    if (response.imageRequest) {
      const imageResponse = await this.processDirectImageRequest(
        response.imageRequest,
        mode,
        chatWindowId,
        options,
      );
      if (effectiveSaveHistory) this.persistExtractedMemory(userMessage, savedUser.messageId, chatWindowId);
      return imageResponse;
    }

    const outputGuardrail = evaluateSteamAiContent(response.content);
    if (!outputGuardrail.allowed) {
      response.content = steamAiGuardrailRefusal();
      response.emotion = this.emotion.analyzeResponse(response.content);
      logger.warn(`Steam AI output blocked [category=${outputGuardrail.category}]`);
    }
    this.saveConversationMessage('assistant', response.content, response.emotion.type, mode, chatWindowId);
    if (response.toolExecutions?.length) {
      recordDataActivity('tool', 'execute-mode-tools', {
        mode,
        count: response.toolExecutions.length,
        tools: response.toolExecutions.map(item => ({
          name: item.name,
          status: item.status,
          durationMs: item.durationMs,
        })),
      });
    }
    if (effectiveSaveHistory) this.persistExtractedMemory(userMessage, savedUser.messageId, chatWindowId);

    logger.info(`Athena response completed [chars=${response.content.length}]`);
    return response;
  }

  private async processDirectImageRequest(
    intent: DirectImageGenerationIntent,
    mode: ConversationMode,
    chatWindowId: number,
    options?: ProcessMessageOptions,
    creativeNote = '',
  ): Promise<ChatResponse> {
    const descriptor = this.imageRouter.selectedDescriptor();
    const emotionFor = (content: string) => this.emotion.analyzeResponse(content);
    const reply = (content: string): ChatResponse => {
      const emotion = emotionFor(content);
      this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      return { content, emotion };
    };
    if (isSteamSku()) return reply('当前 Steam 版本没有开放生图能力。');
    if (this.imageRouter.isNetworkProvider() && !canUseNetworkCapability('imageGeneration')) {
      return reply(consentRequiredMessage('imageGeneration'));
    }
    if (!this.imageRouter.isNetworkProvider()) {
      await this.imageRouter.refreshLocalDiscovery().catch(() => null);
    }
    if (!this.imageRouter.isAvailable()) {
      return reply(this.imageRouter.isNetworkProvider()
        ? `“${descriptor.label}”还没有连接好。打开${SETTINGS_LOCATIONS.imageGeneration}，粘贴该平台的 API Key 后保存即可。`
        : `本地生图还差一步。打开${SETTINGS_LOCATIONS.imageGeneration}，先点“自动检测”；Athena 会告诉你是直接可用，还是需要安装引擎或选择模型。`);
    }
    if (this.imageRouter.isNetworkProvider()) {
      options?.onToolStatus?.({ phase: 'confirming', message: `等待确认：${descriptor.label} 生图`, toolName: 'generate_image', toolLabel: descriptor.label });
      const approved = options?.onToolConfirm ? await options.onToolConfirm({
        toolName: 'generate_image',
        toolLabel: `${descriptor.label} 生图`,
        risk: 'external-network',
        explanation: '本次提示词将发送给当前选择的云端生图服务，并可能产生费用。Athena 不会自动切换到其他服务。',
        inputPreview: `Provider: ${descriptor.label}\n尺寸: ${intent.size}\n质量: ${intent.quality}\n提示词字符数: ${intent.prompt.length}`,
      }) : false;
      if (!approved) {
        options?.onToolStatus?.({ phase: 'cancelled', message: '云端生图已取消', toolName: 'generate_image', toolLabel: descriptor.label });
        return reply('已取消这次云端生图，没有发送提示词，也不会产生本次调用费用。');
      }
    }
    options?.onToolStatus?.({ phase: 'running', message: `正在通过 ${descriptor.label} 生图`, toolName: 'generate_image', toolLabel: descriptor.label });
    const startedAt = Date.now();
    try {
      const generated = await this.imageRouter.generate({
        prompt: intent.prompt,
        size: intent.size,
        quality: intent.quality,
        outputFormat: 'png',
      }, AbortSignal.timeout(10 * 60_000));
      // Saying which sections moved is how the user notices a drift immediately,
      // rather than after staring at the picture (ATH-IMG-002).
      const content = creativeNote
        ? `已通过 ${descriptor.label} 生成 ${generated.width}×${generated.height} 图片。本次${creativeNote}。`
        : `已通过 ${descriptor.label} 生成 ${generated.width}×${generated.height} 图片。`;
      const emotion = emotionFor(content);
      const saved = this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      if (!saved.chatMessageId) throw new Error('生成图片无法绑定到聊天消息。');
      const extension = generated.format === 'jpeg' ? 'jpg' : generated.format;
      const attachment = await this.attachments.createGeneratedImage(
        chatWindowId,
        saved.chatMessageId,
        generated.bytes,
        `athena-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
      );
      recordDataActivity('tool', 'conversation-image-generation', {
        mode,
        provider: generated.provider,
        model: generated.model,
        width: generated.width,
        height: generated.height,
        durationMs: Date.now() - startedAt,
      });
      options?.onToolStatus?.({ phase: 'completed', message: '图片已生成并保存到当前聊天', toolName: 'generate_image', toolLabel: descriptor.label });
      options?.onToolStatus?.({ phase: 'done', message: '生图完成' });
      return { content, emotion, attachments: [attachment] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options?.onToolStatus?.({ phase: 'failed', message: `生图失败：${message}`, toolName: 'generate_image', toolLabel: descriptor.label });
      return reply(`这次生图没有完成：${message}`);
    }
  }

  async routeMessage(
    userMessage: string,
    requestedMode: ConversationMode,
    options: RouteMessageOptions = {},
  ): Promise<AgentMessageRouteDecision> {
    if (!this.initialized) await this.initialize();
    const settings = getAppSettings();
    const chatWindow = (options.chatWindowId ? getChatWindow(options.chatWindowId) : null)
      ?? ensureDefaultChatWindow();
    const recentMessages = getChatWindowMessages(chatWindow.id, 12).map(message => ({
      role: message.role,
      content: message.content,
    }));
    const canStartDurableExecution = this.llm.capabilities.nativeToolCalls
      && chatWindow.is_temporary !== true
      && Boolean(chatWindow.project_id);
    const routingStartedAt = Date.now();
    const route = await this.messageRouter.routeAdaptive({
      message: userMessage,
      mode: requestedMode,
      forceWebSearch: options.forceWebSearch,
      webSearchEnabled: settings.webSearch.enabled,
      canStartDurableExecution,
      recentMessages,
      // Measured at roughly 3.5s on top of the provider's base round trip even for a
      // short message, ahead of the reply the user is waiting for, so it is opt-in
      // rather than something every ordinary turn pays for (ATH-PERF-001).
      semanticRoutingAllowed: settings.conversation.semanticRouting
        && evaluateSteamAiContent(userMessage).allowed
        && canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint),
    });
    // Routing starts in its own IPC preflight so the renderer can switch modes
    // before drawing the message. Its duration travels with the one-use ticket and
    // is inserted into the same turn profile when chat:send consumes it.
    const routingDurationMs = Date.now() - routingStartedAt;
    const routingTicket = crypto.randomUUID();
    const routed = { ...route, routingDurationMs, routingTicket };
    this.rememberPendingRoute(routingTicket, {
      expiresAt: Date.now() + 30_000,
      message: userMessage,
      requestedMode,
      forceWebSearch: options.forceWebSearch === true,
      chatWindowId: options.chatWindowId,
      decision: routed,
    });
    logger.info(`Message routed in ${routingDurationMs}ms [route=${route.route}, reason=${route.reason}, method=${route.routingMethod}, confidence=${route.confidence}, autoSwitch=${route.autoSwitch}]`);
    return routed;
  }

  /**
   * Consumes the renderer preflight instead of routing the same turn twice. The
   * opaque ticket is bound to the exact message/window/options and remains valid
   * when an approved auto-switch changes the UI to the decision's effective mode.
   */
  async consumeRouteMessage(
    userMessage: string,
    requestedMode: ConversationMode,
    options: RouteMessageOptions = {},
  ): Promise<AgentMessageRouteDecision> {
    const ticket = options.routingTicket;
    const pending = ticket ? this.pendingRoutes.get(ticket) : undefined;
    if (ticket) this.pendingRoutes.delete(ticket);
    if (pending
      && pending.expiresAt >= Date.now()
      && pending.message === userMessage
      && (pending.requestedMode === requestedMode || pending.decision.effectiveMode === requestedMode)
      && (pending.forceWebSearch === (options.forceWebSearch === true)
        || (pending.decision.route === 'web_research' && options.forceWebSearch === true))
      && pending.chatWindowId === options.chatWindowId) {
      return { ...pending.decision };
    }
    return this.routeMessage(userMessage, requestedMode, options);
  }

  private rememberPendingRoute(ticket: string, pending: PendingRoute): void {
    const now = Date.now();
    for (const [candidate, value] of this.pendingRoutes) {
      if (value.expiresAt < now) this.pendingRoutes.delete(candidate);
    }
    while (this.pendingRoutes.size >= 8) {
      const oldest = this.pendingRoutes.keys().next().value as string | undefined;
      if (!oldest) break;
      this.pendingRoutes.delete(oldest);
    }
    this.pendingRoutes.set(ticket, pending);
  }

  async getSystemInfo(options: { checkModel?: boolean; timeoutMs?: number } = {}): Promise<SystemInfo> {
    const stats = getStats();
    const modelConnectionChecked = options.checkModel !== false;
    const modelConnected = modelConnectionChecked
      ? await withOptionalTimeout(this.llm.checkConnection(), options.timeoutMs, false)
      : false;
    const now = new Date();
    return {
      time: now.toLocaleString('zh-CN'),
      hour: now.getHours(),
      platform: process.platform,
      modelConnected,
      modelConnectionChecked,
      modelProvider: this.llm.providerName,
      modelName: this.llm.modelName,
      modelEndpoint: this.llm.endpoint,
      ollamaConnected: modelConnected,
      ollamaModel: this.llm.modelName,
      ollamaEndpoint: this.llm.endpoint,
      memoryStats: stats,
    };
  }

  reloadModel(): void {
    this.conversation.shutdown();
    this.llm = new LLMClient();
    this.conversation = new Conversation(this.llm);
    this.agentRunner = new AgentRunner(this.llm, this.agentTools, undefined, this.agentStore);
    this.messageRouter = this.createMessageRouter();
    // The initiative engine holds a model client, so it has to be rebuilt too or it
    // would keep calling the provider the user just switched away from.
    this.initiative.stop();
    this.initiative = this.buildInitiativeEngine();
    this.creativeExtractor = new ModelCreativeSectionExtractor(createAssistModelClient(this.llm));
    const settings = getAppSettings();
    this.applyToolPermission(settings.tools, settings.conversation.activeMode);
    if (this.initialized) this.syncInitiativeLoop();
  }

  private createMessageRouter(): AgentMessageRouter {
    return new AgentMessageRouter({
      semanticClassifier: new ModelSemanticRoutingClassifier(this.llm),
    });
  }

  applyToolPermission(settings: ToolSettings, mode: ConversationMode): ToolSettings {
    const resolved = resolveToolSettingsForMode(settings, mode);
    resolved.allowExternalNetwork = canUseNetworkCapability('externalToolNetwork');
    this.conversation.setToolPermissionLevel(resolved.permissionLevel);
    // Revoking a permission has to reach runs that are queued or paused as well,
    // or resuming one would hand back what the user just took away (ATH-SEC-005).
    const executeLevel = resolveToolSettingsForMode(settings, 'execute').permissionLevel;
    const lowered = this.agentStore.lowerActiveRunPermissionCeilings(executeLevel);
    if (lowered > 0) logger.info(`Lowered the permission ceiling of ${lowered} unfinished agent runs to ${executeLevel}.`);
    return resolved;
  }

  getToolCatalog(requestedMode?: ConversationMode): ToolCatalog {
    const settings = getAppSettings();
    const mode = requestedMode ?? settings.conversation.activeMode;
    const resolved = resolveToolSettingsForMode(settings.tools, mode);
    return {
      mode,
      permissionLevel: resolved.permissionLevel,
      tools: this.conversation.getToolCatalog(resolved),
    };
  }

  async discoverLocalImageResources() {
    return this.imageRouter.refreshLocalDiscovery();
  }

  cancelCurrentExecution(): number {
    return this.conversation.cancelCurrentExecution();
  }

  getAgentWorkspace(projectId: number, selectedTaskId?: string): AgentProjectWorkspaceSnapshot {
    return this.projectWorkspace.getSnapshot(projectId, selectedTaskId);
  }

  updateAgentWorkspace(
    projectId: number,
    input: UpdateAgentWorkspaceInput,
    expectedRevision: number,
  ): AgentWorkspaceMetadata {
    return this.projectWorkspace.updateMetadata(projectId, input, expectedRevision);
  }

  resolveOpenableAgentArtifact(projectId: number, artifactId: string): string {
    const artifact = this.agentStore.getArtifact(artifactId);
    if (!artifact?.uri) throw new Error('Artifact file is not available');
    const task = this.agentStore.getTask(artifact.taskId);
    if (!task || task.projectId !== projectId) throw new Error('Artifact does not belong to the active Project');
    const roots = this.projectWorkspace.getSnapshot(projectId, task.id).metadata.roots;
    const stat = fs.lstatSync(artifact.uri);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact path is not a regular file');
    const realArtifact = fs.realpathSync.native(artifact.uri);
    const allowed = roots.some(root => {
      try {
        const realRoot = fs.realpathSync.native(path.resolve(root));
        const relative = path.relative(realRoot, realArtifact);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
      } catch {
        return false;
      }
    });
    if (!allowed) throw new Error('Artifact path is outside the active Project workspace');
    return realArtifact;
  }

  async executeAgentMessage(
    goal: string,
    requestedChatWindowId?: number,
    onState?: (snapshot: AgentRunSnapshot) => void,
    attachmentIds: string[] = [],
  ): Promise<ChatResponse> {
    if (!this.initialized) await this.initialize();
    if (!this.llm.capabilities.nativeToolCalls) {
      throw new Error('当前模型不支持原生工具调用，不能启动可靠执行任务。');
    }
    const inputGuardrail = evaluateSteamAiContent(goal);
    if (!inputGuardrail.allowed) {
      const content = steamAiGuardrailRefusal();
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }
    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint)) {
      throw new Error(consentRequiredMessage('remoteModel'));
    }
    const chatWindow = (requestedChatWindowId ? getChatWindow(requestedChatWindowId) : null)
      ?? ensureDefaultChatWindow();
    if (chatWindow.is_temporary) {
      throw new Error('临时聊天不会创建持久化任务，请切换到 Project 内的普通聊天窗口后再执行。');
    }
    const projectId = chatWindow.project_id || ensureDefaultProject().id;
    if (chatWindow.project_id !== projectId) {
      throw new Error('当前聊天窗口尚未归属可执行的 Project。');
    }
    const modelImages = await this.prepareModelImages(chatWindow.id, attachmentIds);
    const attachmentText = this.attachments.resolveTextContext(chatWindow.id, attachmentIds);
    const toolNames = this.agentComputerTools.refresh();
    this.skillTools.refresh();
    const researchToolNames = this.researchTools.refresh();
    const artifactToolNames = this.artifactTools.refresh();
    const ocrToolNames = this.ocrTools.refresh();
    const mcp = await this.mcpIntegrations.refreshEnabled();
    const trustedSkills = this.skillLibrary.snapshot().skills.filter(skill => skill.enabled && (
      skill.trust === 'approved' || skill.trust === 'builtin'
    ));
    if (toolNames.length === 0 && researchToolNames.length === 0 && artifactToolNames.length === 0 && ocrToolNames.length === 0 && trustedSkills.length === 0 && mcp.registeredToolCount === 0) {
      throw new Error('执行模式没有可用工具。请开启所需权限、联网搜索，或批准可信 Skill/MCP Server。');
    }
    const savedUser = this.saveConversationMessage('user', goal, undefined, 'execute', chatWindow.id);
    if (savedUser.chatMessageId && attachmentIds.length > 0) {
      this.attachments.attachToMessage(chatWindow.id, savedUser.chatMessageId, attachmentIds);
    }
    this.persistExtractedMemory(goal, savedUser.messageId, chatWindow.id);
    const settings = getAppSettings();
    // Execute mode used to answer the first message with a confirmation card and
    // wait for a yes. The card claimed more than it delivered: "我理解的目标是"
    // was the user's own sentence echoed back verbatim, the plan under it was one
    // hardcoded English step, and "会用到的能力" listed every capability the tier
    // grants rather than the ones the task needs. A gate that asks about nothing
    // still costs a turn, and reads as consideration that did not happen.
    //
    // What keeps this mode safe is per-call approval, which is unchanged:
    // deleting, moving, overwriting, replacing in a file, running any command,
    // launching a program and reaching an external address all carry
    // `approval: 'always'` and stop for an explicit yes whatever the tier is, and
    // a running turn can be stopped (ATH-CHAT-007).
    const staleDraft = this.projectWorkspace.findPendingDraftTask(chatWindow.id);
    // A draft left by the old flow would otherwise sit in the window forever.
    if (staleDraft) this.agentStore.transitionTask(staleDraft.id, 'cancelled', staleDraft.revision);
    const task = this.startExecutionTask(projectId, chatWindow.id, goal);
    const retrievedForExecution = buildRetrievedContext(
      task.spec.goal,
      settings.memory,
      settings.conversation.saveHistory,
      'execute',
      chatWindow.id,
      savedUser.chatMessageId,
      false,
    );
    const executionRuntimePrompt = buildChatPrompt({
      userMessage: task.spec.goal,
      recentMessages: [],
      retrievedContext: { ...retrievedForExecution, recentMessages: [] },
      mode: 'execute',
    }).find(message => message.role === 'system')?.content || '';
    const executionMessages = this.projectWorkspace.buildExecutionMessages(task.id, executionRuntimePrompt);
    const current = executionMessages[executionMessages.length - 1];
    if (attachmentText.length > 0) current.content = withChatAttachmentContext(current.content, attachmentText);
    if (modelImages.length > 0) {
      current.images = modelImages.map(image => ({ ...image }));
      current.content = `${current.content}\n\nManaged image attachments available to OCR and image-edit tools:\n${modelImages.map(image => `- ${image.id}: ${image.name || 'image'}`).join('\n')}`;
    }
    const handle = this.agentRunner.start({
      taskId: task.id,
      messages: executionMessages,
      allowedCapabilities: task.spec.requiredCapabilities.map(item => item.id),
      approvalMode: 'risk_based',
      scene: 'project-workspace',
      strategy: 'native-tools',
    });
    // The ceiling is the permission the run was granted at the moment it started.
    this.agentStore.initializeRunPermissionCeiling(
      handle.run.id,
      resolveToolSettingsForMode(getAppSettings().tools, 'execute').permissionLevel,
    );
    onState?.(this.agentStore.getRunSnapshot(handle.run.id));
    const result = this.materializeAgentResultArtifact(await handle.result);
    onState?.(result.snapshot);
    recordDataActivity('tool', 'durable-agent-run', {
      projectId,
      taskId: result.snapshot.task.id,
      runId: result.runId,
      status: result.status,
      stepCount: result.snapshot.steps.length,
      artifactCount: result.snapshot.artifacts.length,
    });
    return this.agentResultToChatResponse(result, true);
  }

  getSkillLibrary(): AgentSkillLibrarySnapshot {
    this.skillLibrary.discover();
    return this.skillLibrary.snapshot();
  }

  async importChatImages(chatWindowId: number, sourcePaths: string[]): Promise<ChatAttachment[]> {
    return this.attachments.importImages(chatWindowId, sourcePaths);
  }

  async importChatFiles(
    chatWindowId: number,
    sourcePaths: string[],
    transcribeAudio: (sourcePath: string) => Promise<{ ok: boolean; text?: string; error?: string }>,
  ): Promise<ChatAttachment[]> {
    const prepared: PreparedChatAttachment[] = [];
    for (const sourcePath of sourcePaths) {
      const extension = path.extname(sourcePath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension)) {
        prepared.push({ sourcePath, kind: 'image' });
        continue;
      }
      if (!['.wav', '.aiff', '.aif', '.flac'].includes(extension)) {
        // Everything that is not an image or an audio container gets offered to
        // the document reader, which admits a file on whether its bytes are
        // readable rather than on whether its extension is on a list.
        const extracted = await extractChatDocument(sourcePath);
        prepared.push({
          sourcePath,
          kind: 'document',
          mimeType: extracted.mimeType,
          contentText: extracted.text,
          sourceSha256: extracted.sha256,
        });
        continue;
      }
      const sourceStat = fs.lstatSync(sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('音频附件必须是普通文件。');
      if (sourceStat.size <= 0 || sourceStat.size > 25 * 1024 * 1024) throw new Error('音频附件必须在 1 字节到 25 MB 之间。');
      const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
      const result = await transcribeAudio(sourcePath);
      const transcript = result.text?.trim() || '';
      if (!result.ok || !transcript) throw new Error(result.error || '音频中没有识别到可用文字。');
      prepared.push({ sourcePath, kind: 'audio', contentText: transcript, sourceSha256 });
    }
    return this.attachments.importPreparedFiles(chatWindowId, prepared);
  }

  /**
   * A drop is not a file picker: it can carry a folder, a file the reader cannot
   * open, and more files than a message may hold. Each file is imported on its
   * own so one unreadable item costs only itself, and everything left out comes
   * back named rather than silently missing.
   */
  async importDroppedFiles(
    chatWindowId: number,
    sourcePaths: string[],
    maxFiles: number,
    transcribeAudio: (sourcePath: string) => Promise<{ ok: boolean; text?: string; error?: string }>,
  ): Promise<DroppedImportOutcome> {
    const expanded = expandDroppedPaths(sourcePaths, Math.max(1, Math.min(MAX_DROPPED_FILES, maxFiles)));
    const attachments: ChatAttachment[] = [];
    const failed: string[] = [];
    for (const file of expanded.files) {
      try {
        const [attachment] = await this.importChatFiles(chatWindowId, [file], transcribeAudio);
        if (attachment) attachments.push(attachment);
      } catch (error) {
        failed.push(`${path.basename(file)}（${error instanceof Error ? error.message : String(error)}）`);
      }
    }
    return { attachments, skipped: [...expanded.skipped, ...failed], overflow: expanded.overflow };
  }

  /** Long dropped text becomes a .txt attachment; the staging copy never outlives the import. */
  async importDroppedText(chatWindowId: number, text: string): Promise<DroppedImportOutcome> {
    const staged = writeDroppedText(text, droppedStagingRoot());
    try {
      const attachments = await this.importChatFiles(chatWindowId, [staged], async () => ({ ok: false, error: '不支持的内容。' }));
      return { attachments, skipped: [], overflow: false };
    } finally {
      try { fs.rmSync(staged, { force: true }); } catch { /* the staging copy is disposable */ }
    }
  }

  /**
   * An image dragged out of a web page is a URL, so accepting it means making a
   * network request on the person's behalf — that runs behind the same consent
   * they granted for external tool network access, not silently.
   */
  async importDroppedImageUrl(chatWindowId: number, url: string): Promise<DroppedImportOutcome> {
    if (!canUseNetworkCapability('externalToolNetwork')) {
      return { attachments: [], skipped: [], overflow: false, error: consentRequiredMessage('externalToolNetwork') };
    }
    const staged = await downloadDroppedImage(url, droppedStagingRoot());
    try {
      const attachments = await this.importChatFiles(chatWindowId, [staged], async () => ({ ok: false, error: '不支持的内容。' }));
      recordDataActivity('tool', 'dropped-image-download', { host: new URL(url).host });
      return { attachments, skipped: [], overflow: false };
    } finally {
      try { fs.rmSync(staged, { force: true }); } catch { /* the staging copy is disposable */ }
    }
  }

  /** Pasted screenshots arrive as bytes with no path, so they are staged like a download. */
  async importPastedImage(chatWindowId: number, bytes: Buffer): Promise<DroppedImportOutcome> {
    const extension = sniffImageExtension(bytes);
    if (!extension) return { attachments: [], skipped: [], overflow: false, error: '剪贴板里没有可识别的图片。' };
    const staging = droppedStagingRoot();
    fs.mkdirSync(staging, { recursive: true });
    const staged = path.join(staging, `粘贴的图片-${Date.now().toString(36)}.${extension}`);
    fs.writeFileSync(staged, bytes, { flag: 'wx' });
    try {
      const attachments = await this.importChatFiles(chatWindowId, [staged], async () => ({ ok: false, error: '不支持的内容。' }));
      return { attachments, skipped: [], overflow: false };
    } finally {
      try { fs.rmSync(staged, { force: true }); } catch { /* the staging copy is disposable */ }
    }
  }

  async assertImageInputAvailable(): Promise<void> {
    const capabilities = await this.llm.refreshCapabilities();
    if (!capabilities.imageInputs) {
      throw new Error(capabilities.imageInputSource === 'probe'
        ? '当前 Ollama 模型没有报告 vision 能力，请先切换视觉模型。'
        : '当前 Provider/模型没有经过验证的图片输入能力，请先切换视觉模型。');
    }
  }

  async getChatAttachmentPreview(chatWindowId: number, attachmentId: string): Promise<string | null> {
    return this.attachments.getPreview(chatWindowId, attachmentId);
  }

  removePendingChatAttachment(chatWindowId: number, attachmentId: string): boolean {
    return this.attachments.removePending(chatWindowId, attachmentId);
  }

  deleteChatWindow(chatWindowId: number): boolean {
    const window = getChatWindow(chatWindowId);
    if (window?.is_temporary) this.attachments.cleanupWindowFiles(chatWindowId);
    return deleteChatWindow(chatWindowId);
  }

  clearAttachmentFiles(): number {
    return this.attachments.clearAllFiles();
  }

  async importProjectDocuments(chatWindowId: number, sourcePaths: string[]) {
    const chatWindow = getChatWindow(chatWindowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('Document chat window is unavailable.');
    if (chatWindow.is_temporary) throw new Error('Temporary Chat cannot create persistent Project documents.');
    return this.documents.importDocuments(chatWindow.project_id, sourcePaths);
  }

  async importScannedProjectPdfs(chatWindowId: number, sourcePaths: string[], signal?: AbortSignal) {
    const chatWindow = getChatWindow(chatWindowId);
    if (!chatWindow?.project_id || chatWindow.deleted_at) throw new Error('OCR chat window is unavailable.');
    if (chatWindow.is_temporary) throw new Error('Temporary Chat cannot create persistent OCR documents.');
    return this.documents.importScannedPdfs(chatWindow.project_id, sourcePaths, signal);
  }

  listProjectDocuments(projectId: number) {
    return this.documents.list(projectId);
  }

  deleteProjectDocument(projectId: number, documentId: number): boolean {
    return this.documents.delete(projectId, documentId);
  }

  clearProjectDocumentFiles(): number {
    return this.documents.clearAllFiles();
  }

  getSkillPrivacyData(): ReturnType<SkillLibrary['getPrivacyData']> {
    return this.skillLibrary.getPrivacyData();
  }

  clearSkillInvocationHistory(): number {
    return this.skillLibrary.clearInvocationHistory();
  }

  installSkillFromDirectory(sourceDirectory: string, replace = false): AgentSkillSummary {
    const installed = this.skillLibrary.installFromDirectory(sourceDirectory, replace);
    this.skillTools.refresh();
    return installed;
  }

  setSkillTrust(name: string, packageHash: string, trust: 'approved' | 'untrusted' | 'quarantined'): AgentSkillSummary {
    const skill = this.skillLibrary.setTrust(name, packageHash, trust);
    this.skillTools.refresh();
    return skill;
  }

  setSkillEnabled(name: string, packageHash: string, enabled: boolean): AgentSkillSummary {
    const skill = this.skillLibrary.setEnabled(name, packageHash, enabled);
    this.skillTools.refresh();
    return skill;
  }

  uninstallSkill(name: string, packageHash: string): boolean {
    const removed = this.skillLibrary.uninstall(name, packageHash);
    this.skillTools.refresh();
    return removed;
  }

  getMcpIntegrations(): McpIntegrationSnapshot {
    return this.mcpIntegrations.snapshot();
  }

  getMcpPrivacyData(): ReturnType<McpIntegrationHost['getPrivacyData']> {
    return this.mcpIntegrations.getPrivacyData();
  }

  upsertMcpServer(input: McpServerInput): Promise<McpServerConfig> {
    return this.mcpIntegrations.upsert(input);
  }

  approveMcpServer(id: string, fingerprint: string, approved: boolean): Promise<McpServerConfig> {
    return this.mcpIntegrations.approve(id, fingerprint, approved);
  }

  setMcpServerEnabled(id: string, fingerprint: string, enabled: boolean): Promise<McpServerConfig> {
    return this.mcpIntegrations.setEnabled(id, fingerprint, enabled);
  }

  async connectMcpServer(id: string): Promise<McpIntegrationSnapshot> {
    await this.mcpIntegrations.connect(id);
    return this.mcpIntegrations.snapshot();
  }

  async disconnectMcpServer(id: string): Promise<McpIntegrationSnapshot> {
    await this.mcpIntegrations.disconnect(id);
    return this.mcpIntegrations.snapshot();
  }

  removeMcpServer(id: string, fingerprint: string): Promise<boolean> {
    return this.mcpIntegrations.remove(id, fingerprint);
  }

  async resolveAgentApprovalGroup(
    projectId: number,
    runId: string,
    approvalId: string,
    decision: 'approved' | 'denied',
    onState?: (snapshot: AgentRunSnapshot) => void,
  ): Promise<AgentRunnerResult> {
    const snapshot = this.requireAgentRunProject(runId, projectId);
    const approval = snapshot.approvals.find(item => item.id === approvalId);
    if (!approval || approval.status !== 'pending') throw new Error('待审批项不存在或已处理。');
    if (approval.groupId !== snapshot.run.approvalGroupId) throw new Error('审批项不属于当前运行检查点。');
    for (const item of snapshot.approvals.filter(candidate => (
      candidate.groupId === approval.groupId && candidate.status === 'pending'
    ))) {
      this.agentStore.resolveApproval(item.id, decision, {
        actor: 'user',
        scope: 'approval-group',
      }, item.revision);
    }
    this.assertAgentRunMayContinue();
    this.agentComputerTools.refresh();
    this.researchTools.refresh();
    this.artifactTools.refresh();
    await this.mcpIntegrations.refreshEnabled();
    onState?.(this.agentStore.getRunSnapshot(runId));
    const result = this.materializeAgentResultArtifact(await this.agentRunner.resume(runId));
    onState?.(result.snapshot);
    this.persistTerminalAgentResponse(result);
    return result;
  }

  async resumeAgentRun(
    projectId: number,
    runId: string,
    onState?: (snapshot: AgentRunSnapshot) => void,
  ): Promise<AgentRunnerResult> {
    const snapshot = this.requireAgentRunProject(runId, projectId);
    if (['completed', 'failed', 'cancelled'].includes(snapshot.run.status)) {
      throw new Error('已结束的运行不能继续。');
    }
    if (snapshot.approvals.some(item => item.status === 'pending')) {
      throw new Error('当前运行仍有待审批操作，不能直接继续。');
    }
    this.assertAgentRunMayContinue();
    this.agentComputerTools.refresh();
    this.researchTools.refresh();
    this.artifactTools.refresh();
    await this.mcpIntegrations.refreshEnabled();
    const result = this.materializeAgentResultArtifact(await this.agentRunner.resume(runId));
    onState?.(result.snapshot);
    this.persistTerminalAgentResponse(result);
    return result;
  }

  /**
   * Only the start path checked remote-model consent, so revoking it left paused
   * runs able to keep calling the provider the moment they were resumed or an
   * approval was granted. Consent is re-checked at every entry that continues a run
   * (AC-08, ATH-SEC-007).
   */
  /**
   * The capability list is the run's grant, not a prediction.
   *
   * It is handed to the policy engine as `allowedCapabilities`, so narrowing it
   * to what the goal appears to need would leave the agent unable to reach for a
   * tool the goal turned out to require. Everything the tier already allows is
   * granted here, and the per-call approvals are what actually hold the line.
   */
  private startExecutionTask(projectId: number, chatWindowId: number, goal: string): AgentTaskRecord {
    return this.projectWorkspace.createTask({
      projectId,
      chatWindowId,
      goal,
      capabilities: this.agentTools.list().map(tool => ({
        id: tool.capability,
        access: capabilityAccess(tool.capability),
        reason: `${tool.label} is available under the current execute-mode permission tier`,
      })),
    });
  }

  private assertAgentRunMayContinue(): void {
    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint)) {
      throw new Error(consentRequiredMessage('remoteModel'));
    }
  }

  async cancelAgentRun(projectId: number, runId: string, onState?: (snapshot: AgentRunSnapshot) => void): Promise<AgentRunnerResult> {
    this.requireAgentRunProject(runId, projectId);
    const result = await this.agentRunner.cancel(runId);
    onState?.(result.snapshot);
    return result;
  }

  async shutdown(): Promise<void> {
    if (this.memoryMaintenanceTimer) {
      clearTimeout(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    this.conversation.shutdown();
    this.agentComputerTools.shutdown();
    this.skillTools.shutdown();
    this.researchTools.shutdown();
    this.artifactTools.shutdown();
    this.ocrTools.shutdown();
    await this.ocr.shutdown();
    await this.mcpIntegrations.shutdown();
    closeDatabase();
    this.initialized = false;
    logger.info('Athena shutdown complete.');
  }

  /**
   * Writes a message Athena produced on her own into a real chat window, so it is
   * part of the conversation rather than a transient banner. Returns null when
   * nothing was delivered, which callers must treat as "stay silent".
   *
   * The whole initiative surface is off while chat history is off: waking up to
   * read context and then writing a message is precisely what that switch refuses
   * (ATH-DATA-002, ATH-INIT-001).
   */
  deliverProactiveMessage(input: {
    content: string;
    source: ProactiveSource;
    preferredChatWindowId?: number | null;
  }): ProactiveDelivery | null {
    const content = input.content.trim();
    if (!content) return null;
    if (!shouldSaveHistory()) {
      logger.info(`Proactive message from ${input.source} suppressed because chat history is off.`);
      return null;
    }
    const target = this.resolveProactiveChatWindow(input.preferredChatWindowId);
    if (!target) {
      logger.warn(`Proactive message from ${input.source} had no eligible chat window.`);
      return null;
    }
    const emotion = this.emotion.analyzeResponse(content);
    const saved = this.saveConversationMessage('assistant', content, emotion.type, target.mode, target.id);
    return {
      chatWindowId: target.id,
      chatMessageId: saved.chatMessageId,
      content,
      emotion: emotion.type,
      source: input.source,
    };
  }

  // Proactive messages belong to the window the user was last in. Temporary,
  // archived and deleted windows are never eligible.
  /**
   * Keeps the window's accumulated image description in step with what the user
   * just said. Returns null when the message changes nothing, which is the common
   * case and must not be treated as a failure.
   *
   * The model decides which sections a message touches; the merge decides what may
   * be overwritten. That split is why asking to change the scene can no longer
   * redraw the face (ATH-IMG-002).
   */
  private async updateCreativeState(
    chatWindowId: number,
    message: string,
    profile?: TurnProfile,
  ): Promise<CreativeTurnOutcome> {
    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint)) {
      profile?.record('creative', 0, 'skipped');
      return { kind: 'none' };
    }
    const workspace = parseCreativeWorkspace(getChatWindowCreativeState(chatWindowId));

    // A standing proposal is answered before anything else is read: a bare "好" is
    // consent to that proposal, not a new creative message.
    if (workspace.pending) {
      const reply = readCreativeReply(message);
      if (reply === 'confirm') return this.applyCreativeProposal(chatWindowId, workspace);
      if (reply === 'cancel') {
        saveChatWindowCreativeState(chatWindowId, serializeCreativeWorkspace({ ...workspace, pending: null }));
        return { kind: 'cancelled' };
      }
    }

    // A brief that carries its own headings is read off the page. That is the case
    // that used to cost the longest model call of the turn, and the one where the
    // model was most likely to come back with nothing (ATH-IMG-004).
    const labelled = parseLabeledCreativeSpec(message);
    let extraction: CreativeExtraction;
    if (labelled) {
      extraction = localCreativeExtraction(labelled);
      profile?.record('creative', 0, 'local');
      logger.info(`Creative brief read locally [sections=${labelled.explicitSections.join(',')}, coverage=${labelled.coverage.toFixed(2)}]`);
    } else {
      const started = Date.now();
      try {
        extraction = await this.creativeExtractor.extract({
          message,
          state: workspace.state,
          // Its own budget, rather than the adapter's general 30s. This runs ahead
          // of the reply, so overrunning it costs the user the wait twice over.
          signal: AbortSignal.timeout(CREATIVE_EXTRACTION_TIMEOUT_MS),
        });
      } catch (error) {
        const failure = classifyModelFailure(error);
        const elapsed = Date.now() - started;
        const timedOut = isAbort(error);
        profile?.record('creative', elapsed, timedOut ? 'timeout' : 'failed');
        logger.warn(`Creative extraction ${timedOut ? 'timed out' : 'failed'} after ${elapsed}ms [code=${failure.code}]: ${failure.detail}`);
        return { kind: 'none' };
      }
      const elapsed = Date.now() - started;
      profile?.record('creative', elapsed, extraction.issues.length > 0 ? `issues:${extraction.issues[0]}` : extraction.kind);
      logger.info(`Creative extraction via model in ${elapsed}ms [kind=${extraction.kind}, issues=${extraction.issues.join('|') || 'none'}]`);
    }
    if (extraction.kind === 'not_creative') return { kind: 'none' };

    // Understanding first, acting second. Replacing a description that already
    // exists, or a request with a genuine gap, gets a sentence back rather than a
    // picture. A first request into an empty window just runs (ATH-CHAT-004).
    if (needsCreativeConfirmation(extraction, { hasExistingContent: hasCreativeContent(workspace.state) })) {
      const proposal: CreativePendingProposal = {
        patch: extraction.patch,
        understanding: extraction.understanding,
        gaps: extraction.gaps,
        plannedExtensions: extraction.plannedExtensions,
        createdAt: new Date().toISOString(),
      };
      saveChatWindowCreativeState(chatWindowId, serializeCreativeWorkspace({ ...workspace, pending: proposal }));
      logger.info(`Creative proposal awaiting confirmation [gaps=${proposal.gaps.length}, extensions=${proposal.plannedExtensions.length}]`);
      return { kind: 'proposed', message: formatCreativeProposal(proposal) };
    }

    return this.applyCreativeProposal(chatWindowId, {
      state: workspace.state,
      pending: {
        patch: extraction.patch,
        understanding: extraction.understanding,
        gaps: extraction.gaps,
        plannedExtensions: extraction.plannedExtensions,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Records a plain image request as the window's description, so the next message
   * can edit it. Free of a model call on purpose: nothing here is interpreted, the
   * text is kept as written under `notes` until someone says what it should become.
   */
  private seedCreativeState(chatWindowId: number, prompt: string): void {
    const text = prompt.trim();
    if (!text) return;
    const workspace = parseCreativeWorkspace(getChatWindowCreativeState(chatWindowId));
    if (hasCreativeContent(workspace.state)) return;
    const merged = mergeCreativeState(workspace.state, { sections: { notes: text } });
    if (merged.changed.length === 0) return;
    saveChatWindowCreativeState(chatWindowId, serializeCreativeWorkspace({ state: merged.state, pending: null }));
    logger.info(`Creative state seeded from image request [chars=${text.length}]`);
  }

  private applyCreativeProposal(chatWindowId: number, workspace: CreativeWorkspace): CreativeTurnOutcome {
    if (!workspace.pending) return { kind: 'none' };
    const merged = mergeCreativeState(workspace.state, workspace.pending.patch);
    saveChatWindowCreativeState(chatWindowId, serializeCreativeWorkspace({ state: merged.state, pending: null }));
    logger.info(`Creative state v${merged.state.version} [changed=${merged.changed.join(',') || 'none'}, refused=${merged.refused.join(',') || 'none'}]`);
    if (merged.changed.length === 0 && merged.refused.length === 0) return { kind: 'none' };
    return {
      kind: 'applied',
      state: merged.state,
      changed: merged.changed,
      refused: merged.refused,
      understanding: workspace.pending.understanding,
    };
  }

  /** The merged description a person reads and copies. */
  getCreativeState(chatWindowId: number): {
    text: string;
    summary: string;
    version: number;
    pending: string | null;
  } {
    const workspace = parseCreativeWorkspace(getChatWindowCreativeState(chatWindowId));
    return {
      text: formatCreativeStateForDisplay(workspace.state),
      summary: creativeStateSummary(workspace.state),
      version: workspace.state.version,
      pending: workspace.pending ? formatCreativeProposal(workspace.pending) : null,
    };
  }

  private resolveProactiveChatWindow(preferred?: number | null): ChatWindow | null {
    if (preferred) {
      const window = getChatWindow(preferred);
      if (window && !window.deleted_at && !window.archived_at && window.is_temporary !== true) return window;
    }
    return getActiveChatWindow();
  }

  /**
   * Turns the initiative loop on or off to match the current setting. Called after
   * settings are saved so switching it off stops the loop immediately rather than
   * at the next restart.
   */
  syncInitiativeLoop(): void {
    if (getAppSettings().personalization.initiativeMessages && shouldSaveHistory()) this.initiative.start();
    else this.initiative.stop();
  }

  private buildInitiativeEngine(): InitiativeEngine {
    return new InitiativeEngine({
      client: new ModelInitiativeDecider(
        this.llm,
        DEFAULT_INITIATIVE_POLICY,
        () => resolvePersonaCard().displayName || 'Athena',
      ),
      readGate: () => ({
        enabled: getAppSettings().personalization.initiativeMessages,
        saveHistory: shouldSaveHistory(),
      }),
      readContext: () => this.readInitiativeContext(),
      isForegroundBusy: () => this.foregroundRequests > 0,
      speak: (message) => {
        const delivered = this.deliverProactiveMessage({ content: message, source: 'initiative' });
        if (delivered) globalEventBus.emit('proactive:delivered', delivered);
        return delivered;
      },
    });
  }

  private readInitiativeContext(): InitiativeContext {
    const window = getActiveChatWindow();
    const messages = window ? getChatWindowMessages(window.id, 12) : [];
    const lastUser = [...messages].reverse().find(message => message.role === 'user');
    return {
      minutesSinceLastUserMessage: lastUser
        ? Math.max(0, Math.round((Date.now() - new Date(lastUser.created_at).getTime()) / 60_000))
        : null,
      recentTurns: messages.map(message => ({ role: message.role, content: message.content })),
      proactiveMessagesToday: this.initiative.countMessagesToday(),
    };
  }

  private handleReminderDue(reminder: DueReminder): void {
    const content = reminder.overdue
      ? `提醒时间到了：${reminder.title}（原定 ${new Date(reminder.dueAt).toLocaleString('zh-CN')}，Athena 当时没有运行）`
      : `提醒时间到了：${reminder.title}`;
    const delivered = this.deliverProactiveMessage({
      content,
      source: 'reminder',
      preferredChatWindowId: reminder.chatWindowId,
    });
    globalEventBus.emit('reminder:due', {
      id: reminder.id,
      title: reminder.title,
      dueAt: reminder.dueAt,
      overdue: reminder.overdue,
      delivered,
    });
  }

  // Drops the turns recorded while "save chat history" was off. Called at startup
  // and again the moment history is switched back on, so the unsaved segment cannot
  // be pulled into the context snapshots of the durable turns that follow it.
  // Attachment files go first: their rows cascade away with the messages.
  /**
   * Applies the retention window, sweeping the managed attachment files whose rows
   * are about to cascade away. Callers must use this rather than the bare service
   * function, or expired attachments are orphaned on disk.
   */
  applyRetention(now: Date = new Date()) {
    return applyDataRetention(now, {
      clearExpiredAttachmentFiles: cutoff => this.attachments.cleanupExpiredMessageFiles(cutoff),
    });
  }

  purgeUnsavedChatSegment(): { messages: number; attachments: number } {
    const attachments = this.attachments.cleanupEphemeralMessageFiles();
    const messages = purgeEphemeralChatMessages();
    if (messages > 0) {
      logger.info(`Purged ${messages} chat messages and ${attachments} attachments written while history was off.`);
    }
    return { messages, attachments };
  }

  private persistExtractedMemory(userMessage: string, sourceMessageId?: number, chatWindowId?: number): void {
    const settings = getAppSettings();
    if (!settings.conversation.saveHistory) return;
    const memorySettings = settings.memory;
    if (!memorySettings.enabled || !memorySettings.autoExtract) return;

    const extracted = extractMemoryFromUserMessage(userMessage);
    const result = queueExtractedMemory(extracted, {
      sourceMessageId,
      chatWindowId,
      minImportance: memorySettings.minImportanceForAutoExtract,
    });
    if (result.queued > 0 || result.applied > 0) {
      logger.debug(`Memory extraction reviewed: queued=${result.queued}, applied=${result.applied}, rejected=${result.rejected}.`);
    }
  }

  private async applyMemoryRetentionMaintenance(): Promise<MemoryRetentionPolicyResult> {
    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'), this.llm.endpoint)) {
      return applyMemoryRetentionPolicy();
    }
    const connected = await this.llm.checkConnection();
    if (!connected) return applyMemoryRetentionPolicy();

    try {
      return await applyMemoryRetentionPolicyWithRefiner(
        input => this.refineDailyMemorySummary(input),
      );
    } catch (error) {
      logger.warn(`LLM daily memory refinement failed; falling back to heuristic retention: ${error instanceof Error ? error.message : String(error)}`);
      return applyMemoryRetentionPolicy();
    }
  }

  private scheduleDailyMemoryMaintenance(now: Date = new Date()): void {
    if (this.memoryMaintenanceTimer) clearTimeout(this.memoryMaintenanceTimer);
    const delayMs = msUntilNextLocalMaintenance(now);
    this.memoryMaintenanceTimer = setTimeout(() => {
      void this.runScheduledMemoryMaintenance();
    }, delayMs);
    const timer = this.memoryMaintenanceTimer as unknown as { unref?: () => void };
    timer.unref?.();
    logger.info(`Daily memory maintenance scheduled in ${Math.round(delayMs / 60000)} minutes.`);
  }

  private scheduleStartupMaintenance(): void {
    const timer = setTimeout(() => {
      void this.runStartupMaintenance();
    }, STARTUP_MAINTENANCE_DELAY_MS);
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  }

  private async runStartupMaintenance(): Promise<void> {
    if (this.memoryMaintenanceRunning) return;
    this.memoryMaintenanceRunning = true;
    try {
      const staleAttachmentsDeleted = this.attachments.cleanupStalePending();
      if (staleAttachmentsDeleted > 0) logger.info(`Cleaned up ${staleAttachmentsDeleted} stale pending attachments.`);
      const retention = this.applyRetention();
      if (retention.messagesDeleted > 0 || retention.activityDeleted > 0) {
        logger.info(`Data retention applied: messages=${retention.messagesDeleted}, activity=${retention.activityDeleted}`);
      }
      const memoryRetention = await this.applyMemoryRetentionMaintenance();
      if (memoryRetention.dailySummariesGenerated > 0 || memoryRetention.rawEventsPruned > 0 || (memoryRetention.llmRefinedSummaries ?? 0) > 0) {
        logger.info(`Memory retention applied: daily_summaries=${memoryRetention.dailySummariesGenerated}, llm_refined=${memoryRetention.llmRefinedSummaries ?? 0}, raw_events_pruned=${memoryRetention.rawEventsPruned}`);
      }
      const indexStats = rebuildMemoryIndex();
      logger.info(`Memory index ready: messages=${indexStats.messages}, profile=${indexStats.profile}, events=${indexStats.events}, daily_memory_summaries=${indexStats.daily_memory_summaries}, procedural_memories=${indexStats.procedural_memories}, memory_facts=${indexStats.memory_facts}, project_notes=${indexStats.project_notes}, project_document_chunks=${indexStats.project_document_chunks}`);
    } catch (error) {
      logger.warn(`Startup maintenance failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.memoryMaintenanceRunning = false;
    }
  }

  private async runScheduledMemoryMaintenance(): Promise<void> {
    if (this.memoryMaintenanceRunning) return;
    this.memoryMaintenanceRunning = true;
    try {
      const result = await this.applyMemoryRetentionMaintenance();
      if (result.dailySummariesGenerated > 0 || result.rawEventsPruned > 0 || (result.llmRefinedSummaries ?? 0) > 0) {
        logger.info(`Scheduled memory maintenance applied: daily_summaries=${result.dailySummariesGenerated}, llm_refined=${result.llmRefinedSummaries ?? 0}, raw_events_pruned=${result.rawEventsPruned}`);
      }
      recordDataActivity('maintenance', 'scheduled-memory-retention', {
        dailySummariesGenerated: result.dailySummariesGenerated,
        llmRefinedSummaries: result.llmRefinedSummaries ?? 0,
        rawEventsPruned: result.rawEventsPruned,
        decayCandidates: result.decayCandidates,
      });
      const staleAttachmentsDeleted = this.attachments.cleanupStalePending();
      if (staleAttachmentsDeleted > 0) logger.info(`Scheduled attachment cleanup removed ${staleAttachmentsDeleted} stale pending files.`);
      const indexStats = rebuildMemoryIndex();
      logger.info(`Scheduled memory index refreshed: messages=${indexStats.messages}, profile=${indexStats.profile}, events=${indexStats.events}, daily_memory_summaries=${indexStats.daily_memory_summaries}, procedural_memories=${indexStats.procedural_memories}, memory_facts=${indexStats.memory_facts}, project_notes=${indexStats.project_notes}`);
    } catch (error) {
      logger.warn(`Scheduled memory maintenance failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.memoryMaintenanceRunning = false;
      if (this.initialized) this.scheduleDailyMemoryMaintenance();
    }
  }

  private async refineDailyMemorySummary(input: DailyMemoryRefinementInput): Promise<DailyMemoryRefinement | null> {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        highlights: {
          type: 'array',
          maxItems: 12,
          items: { type: 'string' },
        },
        importance: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['summary', 'highlights'],
    };

    const response = await this.llm.chatJson([
      {
        role: 'system',
        content: [
          'You refine local assistant memory into a compact daily summary.',
          'Keep durable preferences, project state, decisions, emotional context, and concrete next actions.',
          'Avoid inventing facts. Do not include secrets, credentials, or private raw transcripts.',
          'Return JSON only.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(input),
      },
    ], schema, 'reason', { temperature: 0.1, maxTokens: 1200 });
    const parsed = safeParseJsonObject(response);
    if (!parsed) return null;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter(item => typeof item === 'string') : undefined,
      importance: typeof parsed.importance === 'number' ? parsed.importance : undefined,
    };
  }

  private processLocalCommand(userMessage: string, mode: ConversationMode, chatWindowId: number): ChatResponse | null {
    const isTemporaryChat = getChatWindow(chatWindowId)?.is_temporary === true;
    const reminders = this.reminder.list();
    if (/提醒列表/.test(userMessage) || /^(列出|查看|我的)提醒/.test(userMessage)) {
      const active = reminders.filter(item => item.status === 'scheduled');
      const content = active.length === 0
        ? '现在没有待触发的提醒。'
        : active.map(item => `- ${item.title}：${new Date(item.dueAt).toLocaleString('zh-CN')}（${item.id}）`).join('\n');
      const emotion = this.emotion.analyzeResponse(content);
      this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      return { content, emotion };
    }

    const reminderRequest = parseReminderRequest(userMessage);
    if (reminderRequest) {
      const job = this.reminder.schedule({ ...reminderRequest, chatWindowId });
      const content = `好，记下了：${job.title}。我会在 ${new Date(job.dueAt).toLocaleString('zh-CN')} 提醒你。`;
      const emotion = this.emotion.analyzeResponse(content);
      this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      if (!isTemporaryChat) this.persistExtractedMemory(userMessage, undefined, chatWindowId);
      return { content, emotion };
    }

    if (/工作流列表|有哪些工作流/.test(userMessage)) {
      const content = this.workflows.listWorkflows()
        .map(item => `- ${item.label}：${item.description}`)
        .join('\n');
      const emotion = this.emotion.analyzeResponse(content);
      this.saveConversationMessage('assistant', content, emotion.type, mode, chatWindowId);
      return { content, emotion };
    }

    if (/取消工作流/.test(userMessage)) {
      const run = this.workflows.cancelWorkflow();
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveConversationMessage('assistant', run.message, emotion.type, mode, chatWindowId);
      return { content: run.message, emotion };
    }

    if (/工作流下一步|下一步工作流|继续工作流/.test(userMessage)) {
      const run = this.workflows.advanceWorkflow();
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveConversationMessage('assistant', run.message, emotion.type, mode, chatWindowId);
      return { content: run.message, emotion };
    }

    const workflowId = detectWorkflowId(userMessage);
    if (workflowId) {
      const run = this.workflows.runWorkflow(workflowId);
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveConversationMessage('assistant', run.message, emotion.type, mode, chatWindowId);
      if (!isTemporaryChat) this.persistExtractedMemory(userMessage, undefined, chatWindowId);
      return { content: run.message, emotion };
    }

    return null;
  }

  private saveConversationMessage(
    role: 'user' | 'assistant',
    content: string,
    emotion: string | undefined,
    mode: ConversationMode,
    chatWindowId: number,
  ): { chatMessageId?: number; messageId?: number } {
    // With chat history off the turn still has to work, so it is written and read
    // back for this session only, then purged at the next startup. It never enters
    // the window summary/working state, the global messages table, long-term
    // memory, or cloud sync (ATH-DATA-002).
    const ephemeral = !shouldSaveHistory();
    const saved = saveChatMessage(chatWindowId, role, content, emotion, mode, ephemeral);
    const isTemporaryChat = getChatWindow(chatWindowId)?.is_temporary === true;
    if (!isTemporaryChat && !ephemeral && mode !== 'execute') {
      try {
        const { queueCloudWindowSync } = require('../cloud/CloudAccountService') as typeof import('../cloud/CloudAccountService');
        queueCloudWindowSync(chatWindowId);
      } catch {
        // Cloud sync is opt-in and must not break local chat.
      }
    }
    const globalMessage = !isTemporaryChat && shouldSaveHistory()
      ? saveMessage(role, content, emotion, mode)
      : undefined;
    return { chatMessageId: saved?.id, messageId: globalMessage?.id };
  }

  private async prepareModelImages(chatWindowId: number, attachmentIds: string[]): Promise<ModelImageInput[]> {
    if (attachmentIds.length === 0) return [];
    const images = this.attachments.resolveModelImages(chatWindowId, attachmentIds);
    if (images.length === 0) return [];
    const capabilities = await this.llm.refreshCapabilities();
    if (!capabilities.imageInputs) {
      const source = capabilities.imageInputSource === 'probe'
        ? '当前 Ollama 模型没有报告 vision 能力'
        : '当前 Provider/模型没有经过验证的图片输入能力';
      throw new Error(`${source}，请切换到支持图片理解的模型后再发送。`);
    }
    return images;
  }

  /**
   * Agent tools always run under the Execute permission, capped by the ceiling the
   * run was granted. The ceiling only ratchets down, so raising the setting during a
   * run cannot restore access the user revoked (AC-06, ATH-SEC-005).
   */
  private resolveAgentToolSettings(runId?: string): ToolSettings {
    const settings = getAppSettings();
    const resolved = resolveToolSettingsForMode(settings.tools, 'execute');
    resolved.allowExternalNetwork = canUseNetworkCapability('externalToolNetwork');
    if (!runId) return resolved;
    const ceiling = this.agentStore.getRunPermissionCeiling(runId);
    if (ceiling && TOOL_PERMISSION_RANK[ceiling] < TOOL_PERMISSION_RANK[resolved.permissionLevel]) {
      resolved.permissionLevel = ceiling;
    }
    return resolved;
  }

  private agentResultToChatResponse(result: AgentRunnerResult, persist: boolean): ChatResponse {
    let content = result.status === 'paused'
      ? '任务已暂停，执行工作区中有一组操作等待你审批。'
      : result.content.trim()
        || (result.status === 'cancelled'
          ? '任务已停止。'
          : result.status === 'failed'
            ? `任务执行失败：${result.error ? classifyModelFailure(new Error(result.error)).message : '未返回具体错误'}`
            : result.verification === 'unverified'
              ? '任务已执行结束。'
              : '任务已完成。');
    // Run termination is not acceptance: say so rather than letting the model's
    // own closing claim stand in for evidence.
    if (result.verification === 'unverified') {
      content += '\n\n注意：这次任务没有声明可核对的验收项，以上结果未经自动验证，请自行确认是否达到目标。';
    }
    const outputGuardrail = evaluateSteamAiContent(content);
    if (!outputGuardrail.allowed) content = steamAiGuardrailRefusal();
    const emotion = this.emotion.analyzeResponse(content);
    if (persist) {
      const chatWindowId = result.snapshot.task.chatWindowId;
      if (chatWindowId) this.saveConversationMessage('assistant', content, emotion.type, 'execute', chatWindowId);
    }
    return {
      content,
      emotion,
      agentExecution: {
        taskId: result.snapshot.task.id,
        runId: result.runId,
        status: result.status,
      },
    };
  }

  private persistTerminalAgentResponse(result: AgentRunnerResult): void {
    if (result.status === 'paused') return;
    this.agentResultToChatResponse(result, true);
  }

  private resolveProjectRootsForRun(runId: string): string[] {
    const run = this.agentStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);
    const task = this.agentStore.getTask(run.taskId);
    if (!task?.projectId) throw new Error(`Agent run ${runId} has no active Project`);
    return this.projectWorkspace.getSnapshot(task.projectId, task.id).metadata.roots;
  }

  private requireAgentRunProject(runId: string, projectId: number): AgentRunSnapshot {
    const snapshot = this.agentStore.getRunSnapshot(runId);
    if (snapshot.task.projectId !== projectId) {
      throw new Error(`Run ${runId} does not belong to project ${projectId}`);
    }
    return snapshot;
  }

  private materializeAgentResultArtifact(result: AgentRunnerResult): AgentRunnerResult {
    if (result.status !== 'completed' || !result.content.trim()) return result;
    const exists = result.snapshot.artifacts.some(artifact => artifact.kind === 'final_response');
    if (!exists) {
      this.agentStore.addArtifact({
        taskId: result.snapshot.task.id,
        runId: result.runId,
        kind: 'final_response',
        name: `${result.snapshot.task.title} - final response`,
        metadata: { content: result.content.slice(0, 20_000) },
        validationStatus: 'not_applicable',
      });
    }
    return { ...result, snapshot: this.agentStore.getRunSnapshot(result.runId) };
  }
}

function capabilityAccess(capability: string): AgentCapabilityAccess {
  if (capability.endsWith('.read')) return 'read';
  if (capability.endsWith('.files')) return 'write';
  if (capability.endsWith('.network')) return 'network';
  if (capability.endsWith('.account')) return 'account';
  return 'execute';
}

function msUntilNextLocalMaintenance(now: Date): number {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 5, 0, 0);
  return Math.max(60_000, next.getTime() - now.getTime());
}

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

async function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, fallback: T): Promise<T> {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<T>(resolve => {
      const timer = setTimeout(() => resolve(fallback), Math.round(timeoutMs));
      const handle = timer as unknown as { unref?: () => void };
      handle.unref?.();
    }),
  ]);
}

function buildRetrievedContext(
  query: string,
  settings: MemorySettings,
  saveHistory: boolean,
  mode: ConversationMode,
  chatWindowId?: number,
  excludeChatMessageId?: number,
  temporaryChat = false,
): RetrievedContext {
  const depth = settings.retrievalDepth;
  const recentMessageCount = Math.max(10, Math.min(20, depth > 0 ? depth * 2 : 10));
  if (!settings.enabled || temporaryChat) {
    return buildWindowOnlyRetrievedContext(chatWindowId, recentMessageCount, excludeChatMessageId);
  }

  let context: RetrievedContext;
  try {
    context = retrieveContext({
      query,
      maxProfileFacts: settings.retrieveProfile ? depth * 2 : 0,
      maxProceduralMemories: settings.retrieveProfile ? Math.max(4, Math.ceil(depth / 2)) : 0,
      maxTemporalFacts: settings.retrieveProfile ? depth : 0,
      maxEvents: settings.retrieveEvents ? depth : 0,
      maxDailySummaries: settings.retrieveEvents ? depth : 0,
      maxProjectNotes: settings.retrieveProjects ? depth : 0,
      maxDocumentChunks: settings.retrieveProjects ? Math.max(4, depth) : 0,
      recentMessageCount: chatWindowId ? recentMessageCount + 1 : (saveHistory ? recentMessageCount : 0),
      conversationMode: mode,
      chatWindowId,
    });
  } catch (error) {
    logger.warn(`Memory retrieval failed; continuing with current-window context only: ${error instanceof Error ? error.message : String(error)}`);
    return buildWindowOnlyRetrievedContext(chatWindowId, recentMessageCount, excludeChatMessageId);
  }
  if (excludeChatMessageId) {
    context.recentMessages = context.recentMessages
      .filter(message => message.id !== excludeChatMessageId)
      .slice(-recentMessageCount);
  }
  return context;
}

function buildWindowOnlyRetrievedContext(
  chatWindowId: number | undefined,
  recentMessageCount: number,
  excludeChatMessageId?: number,
): RetrievedContext {
  const chatWindow = chatWindowId ? getChatWindow(chatWindowId) : null;
  return {
    ...emptyRetrievedContext(),
    recentMessages: chatWindowId
      ? getChatWindowMessages(chatWindowId, recentMessageCount + 1)
        .filter(message => message.id !== excludeChatMessageId)
        .slice(-recentMessageCount)
      : [],
    chatWindow: chatWindow ? {
      id: chatWindow.id,
      title: chatWindow.title,
      summary: chatWindow.summary,
      workingStateJson: chatWindow.working_state_json || chatWindow.working_state || '{}',
      messageCount: chatWindow.messageCount ?? 0,
      updatedAt: chatWindow.updated_at,
      isTemporary: chatWindow.is_temporary === true,
      projectId: chatWindow.project_id,
      projectTitle: chatWindow.projectTitle,
      projectInstructions: chatWindow.projectInstructions,
      projectInstructionsSnapshot: chatWindow.projectInstructionsSnapshot,
    } : undefined,
  };
}

function emptyRetrievedContext(): RetrievedContext {
  return {
    profileFacts: [],
    proceduralMemories: [],
    temporalFacts: [],
    relatedEvents: [],
    dailySummaries: [],
    projectNotes: [],
    documentChunks: [],
    recentMessages: [],
    chatWindow: undefined,
    evidence: [],
    relevanceScore: 0,
  };
}

function parseReminderRequest(message: string): { title: string; dueAt: Date } | null {
  const patterns = [
    /(\d+)\s*(秒|分钟|小时|天)后.*提醒我(.+)/,
    /提醒我\s*(\d+)\s*(秒|分钟|小时|天)后(.+)/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const amount = Number(match[1]);
    const unit = match[2];
    const title = (match[3] || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !title) return null;
    return { title, dueAt: new Date(Date.now() + durationMs(amount, unit)) };
  }

  return null;
}

function durationMs(amount: number, unit: string): number {
  if (unit === '秒') return amount * 1000;
  if (unit === '分钟') return amount * 60 * 1000;
  if (unit === '小时') return amount * 60 * 60 * 1000;
  if (unit === '天') return amount * 24 * 60 * 60 * 1000;
  return amount * 60 * 1000;
}

function detectWorkflowId(message: string): string | null {
  if (!/(工作流|流程|开始|启动)/.test(message)) return null;
  if (/代码|编程|开发|bug|修复/.test(message)) return 'coding';
  if (/画|绘画|插画|草图|创作/.test(message)) return 'drawing';
  if (/学习|读书|复习|知识/.test(message)) return 'study';
  if (/日常|整理|计划|待办/.test(message)) return 'daily';
  return null;
}
