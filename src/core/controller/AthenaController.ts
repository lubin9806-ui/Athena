import { LLMClient } from '../ai/Client';
import { canRouteModelRequest } from '../ai/ModelNetworkPolicy';
import { Conversation } from '../ai/Conversation';
import { EmotionEngine } from '../ai/Emotion';
import { getAppSettings, resolveToolSettingsForMode, shouldSaveHistory } from '../config/SettingsStore';
import { WebSearchService } from '../web/WebSearchService';
import { evaluateSteamAiContent, steamAiGuardrailRefusal } from '../steam/SteamAiGuardrails';
import { isSteamSku } from '../steam/SteamSkuPolicy';
import {
  applyDataRetention,
  canUseNetworkCapability,
  consentRequiredMessage,
  recordDataActivity,
} from '../privacy/PrivacyDataService';
import { Reminder } from '../scheduler/Reminder';
import { WorkflowManager } from '../workflow/WorkflowManager';
import {
  applyMemoryRetentionPolicy,
  cleanupTemporaryChatWindows,
  ensureDefaultChatWindow,
  getChatWindow,
  getChatWindowMessages,
  closeDatabase,
  extractMemoryFromUserMessage,
  getDatabase,
  getStats,
  queueExtractedMemory,
  rebuildMemoryIndex,
  retrieveContext,
  saveChatMessage,
  saveMessage,
} from '../../memory';
import { globalEventBus } from '../../engine/EventBus';
import { createLogger } from '../../engine/Logger';
import type {
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
} from '../../shared/types';

const logger = createLogger('AthenaController');

interface ProcessMessageOptions {
  forceWebSearch?: boolean;
  onWebSearchStatus?: (status: WebSearchStatus) => void;
  onToolStatus?: (status: ToolStatusEvent) => void;
  onToolConfirm?: (request: ToolConfirmationRequest) => Promise<boolean>;
  chatWindowId?: number;
}

export class AthenaController {
  private llm: LLMClient;
  private conversation: Conversation;
  private emotion: EmotionEngine;
  private reminder: Reminder;
  private workflows: WorkflowManager;
  private webSearch: WebSearchService;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor() {
    this.llm = new LLMClient();
    this.conversation = new Conversation(this.llm);
    this.emotion = new EmotionEngine();
    this.reminder = new Reminder();
    this.workflows = new WorkflowManager();
    this.webSearch = new WebSearchService();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = this.runInitialize().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  private async runInitialize(): Promise<void> {
    logger.info('Initializing Athena...');
    getDatabase();
    const temporaryWindowsDeleted = cleanupTemporaryChatWindows();
    if (temporaryWindowsDeleted > 0) {
      logger.info(`Cleaned up ${temporaryWindowsDeleted} temporary chat windows.`);
    }
    const retention = applyDataRetention();
    if (retention.messagesDeleted > 0 || retention.activityDeleted > 0) {
      logger.info(`Data retention applied: messages=${retention.messagesDeleted}, activity=${retention.activityDeleted}`);
    }
    const memoryRetention = applyMemoryRetentionPolicy();
    if (memoryRetention.dailySummariesGenerated > 0 || memoryRetention.rawEventsPruned > 0) {
      logger.info(`Memory retention applied: daily_summaries=${memoryRetention.dailySummariesGenerated}, raw_events_pruned=${memoryRetention.rawEventsPruned}`);
    }
    const indexStats = rebuildMemoryIndex();
    logger.info(`Memory index ready: messages=${indexStats.messages}, profile=${indexStats.profile}, events=${indexStats.events}, daily_memory_summaries=${indexStats.daily_memory_summaries}, procedural_memories=${indexStats.procedural_memories}, memory_facts=${indexStats.memory_facts}, project_notes=${indexStats.project_notes}`);
    this.emotion.setBaseEmotion(new Date().getHours());
    const settings = getAppSettings();
    this.applyToolPermission(settings.tools, settings.conversation.activeMode);
    this.initialized = true;
    logger.info('Athena initialized.');
    globalEventBus.emit('athena:ready');
  }

  async processMessage(
    userMessage: string,
    requestedMode?: ConversationMode,
    onStream?: (chunk: string) => void,
    options?: ProcessMessageOptions,
  ): Promise<ChatResponse> {
    if (!this.initialized) await this.initialize();

    const settings = getAppSettings();
    const mode = requestedMode ?? settings.conversation.activeMode;
    const requestedChatWindowId = options?.chatWindowId && options.chatWindowId > 0 ? options.chatWindowId : undefined;
    const chatWindow = (requestedChatWindowId ? getChatWindow(requestedChatWindowId) : null)
      ?? ensureDefaultChatWindow();
    const chatWindowId = chatWindow.id;
    const isTemporaryChat = chatWindow.is_temporary === true;
    const effectiveSaveHistory = settings.conversation.saveHistory && !isTemporaryChat;
    const modeToolSettings = this.applyToolPermission(settings.tools, mode);
    modeToolSettings.allowExternalNetwork = settings.privacy.networkConsent.externalToolNetwork;
    logger.info(`User message received [mode=${mode}, tools=${modeToolSettings.permissionLevel}, chars=${userMessage.length}]`);
    const inputGuardrail = evaluateSteamAiContent(userMessage);
    if (!inputGuardrail.allowed) {
      const content = steamAiGuardrailRefusal();
      logger.warn(`Steam AI input blocked [category=${inputGuardrail.category}]`);
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }
    const savedUser = this.saveConversationMessage('user', userMessage, undefined, mode, chatWindowId);

    const localCommand = this.processLocalCommand(userMessage, mode, chatWindowId);
    if (localCommand) return localCommand;

    if (!canRouteModelRequest(this.llm.providerName, canUseNetworkCapability('remoteModel'))) {
      const content = consentRequiredMessage('remoteModel');
      this.saveConversationMessage('assistant', content, this.emotion.analyzeResponse(content).type, mode, chatWindowId);
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }

    const webPlan = this.webSearch.plan({
      message: userMessage,
      force: options?.forceWebSearch,
      settings: settings.webSearch,
    });
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
        webSearchContext = await this.webSearch.research(
          webPlan.query,
          settings.webSearch,
          options?.onWebSearchStatus,
        );
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
    const response = await this.conversation.process(
      userMessage,
      retrieved.recentMessages,
      retrieved,
      mode,
      isSteamSku() ? undefined : onStream,
      webSearchContext,
      modeToolSettings,
      options?.onToolStatus,
      options?.onToolConfirm,
      { chatWindowId, userMessageId: savedUser.chatMessageId },
    );

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

  async getSystemInfo(): Promise<SystemInfo> {
    const stats = getStats();
    const modelConnected = await this.llm.checkConnection();
    const now = new Date();
    return {
      time: now.toLocaleString('zh-CN'),
      hour: now.getHours(),
      platform: process.platform,
      modelConnected,
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
    const settings = getAppSettings();
    this.applyToolPermission(settings.tools, settings.conversation.activeMode);
  }

  applyToolPermission(settings: ToolSettings, mode: ConversationMode): ToolSettings {
    const resolved = resolveToolSettingsForMode(settings, mode);
    resolved.allowExternalNetwork = canUseNetworkCapability('externalToolNetwork');
    this.conversation.setToolPermissionLevel(resolved.permissionLevel);
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

  cancelCurrentExecution(): number {
    return this.conversation.cancelCurrentExecution();
  }

  shutdown(): void {
    this.conversation.shutdown();
    closeDatabase();
    this.initialized = false;
    logger.info('Athena shutdown complete.');
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
      const job = this.reminder.schedule(reminderRequest, (dueJob) => {
        globalEventBus.emit('reminder:due', dueJob);
      });
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
    const saved = saveChatMessage(chatWindowId, role, content, emotion, mode);
    const isTemporaryChat = getChatWindow(chatWindowId)?.is_temporary === true;
    const globalMessage = !isTemporaryChat && shouldSaveHistory()
      ? saveMessage(role, content, emotion, mode)
      : undefined;
    return { chatMessageId: saved?.id, messageId: globalMessage?.id };
  }
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

  const context = retrieveContext({
    query,
    maxProfileFacts: settings.retrieveProfile ? depth * 2 : 0,
    maxProceduralMemories: settings.retrieveProfile ? Math.max(4, Math.ceil(depth / 2)) : 0,
    maxTemporalFacts: settings.retrieveProfile ? depth : 0,
    maxEvents: settings.retrieveEvents ? depth : 0,
    maxDailySummaries: settings.retrieveEvents ? depth : 0,
    maxProjectNotes: settings.retrieveProjects ? depth : 0,
    recentMessageCount: chatWindowId ? recentMessageCount + 1 : (saveHistory ? recentMessageCount : 0),
    conversationMode: mode,
    chatWindowId,
  });
  if (excludeChatMessageId) {
    context.recentMessages = context.recentMessages
      .filter(message => message.id !== excludeChatMessageId)
      .slice(-recentMessageCount);
  }
  return context;
}

function emptyRetrievedContext(): RetrievedContext {
  return {
    profileFacts: [],
    proceduralMemories: [],
    temporalFacts: [],
    relatedEvents: [],
    dailySummaries: [],
    projectNotes: [],
    recentMessages: [],
    chatWindow: undefined,
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
