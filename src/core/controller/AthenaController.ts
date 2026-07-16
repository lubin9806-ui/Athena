import { LLMClient } from '../ai/Client';
import { Conversation } from '../ai/Conversation';
import { EmotionEngine } from '../ai/Emotion';
import { detectDesktopAction } from '../ai/ToolCall';
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
  addMemoryEvent,
  addProfileFacts,
  addProjectNote,
  closeDatabase,
  extractMemoryFromUserMessage,
  getDatabase,
  getStats,
  initializeDefaultProfile,
  rebuildMemoryIndex,
  retrieveContext,
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
} from '../../shared/types';

const logger = createLogger('AthenaController');

interface ProcessMessageOptions {
  forceWebSearch?: boolean;
  onWebSearchStatus?: (status: WebSearchStatus) => void;
  onToolStatus?: (status: ToolStatusEvent) => void;
  onToolConfirm?: (request: ToolConfirmationRequest) => Promise<boolean>;
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
    initializeDefaultProfile();
    const retention = applyDataRetention();
    if (retention.messagesDeleted > 0 || retention.activityDeleted > 0) {
      logger.info(`Data retention applied: messages=${retention.messagesDeleted}, activity=${retention.activityDeleted}`);
    }
    const indexStats = rebuildMemoryIndex();
    logger.info(`Memory index ready: messages=${indexStats.messages}, profile=${indexStats.profile}, events=${indexStats.events}, project_notes=${indexStats.project_notes}`);
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
    const modeToolSettings = this.applyToolPermission(settings.tools, mode);
    modeToolSettings.allowExternalNetwork = settings.privacy.networkConsent.externalToolNetwork;
    logger.info(`User message received [mode=${mode}, tools=${modeToolSettings.permissionLevel}, chars=${userMessage.length}]`);
    const inputGuardrail = evaluateSteamAiContent(userMessage);
    if (!inputGuardrail.allowed) {
      const content = steamAiGuardrailRefusal();
      logger.warn(`Steam AI input blocked [category=${inputGuardrail.category}]`);
      return { content, emotion: this.emotion.analyzeResponse(content) };
    }
    this.saveMessageIfAllowed('user', userMessage, undefined, mode);

    const localCommand = this.processLocalCommand(userMessage, mode);
    if (localCommand) return localCommand;

    const action = detectDesktopAction(userMessage);
    const webPlan = this.webSearch.plan({
      message: userMessage,
      force: options?.forceWebSearch,
      settings: settings.webSearch,
      detectedAction: action,
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

    const retrieved = buildRetrievedContext(userMessage, settings.memory, settings.conversation.saveHistory, mode);
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
    );

    const outputGuardrail = evaluateSteamAiContent(response.content);
    if (!outputGuardrail.allowed) {
      response.content = steamAiGuardrailRefusal();
      response.emotion = this.emotion.analyzeResponse(response.content);
      logger.warn(`Steam AI output blocked [category=${outputGuardrail.category}]`);
    }
    this.saveMessageIfAllowed('assistant', response.content, response.emotion.type, mode);
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
    if (settings.conversation.saveHistory) this.persistExtractedMemory(userMessage);

    logger.info(`Athena response completed [chars=${response.content.length}]`);
    return response;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const stats = getStats();
    const ollamaConnected = await this.llm.checkConnection();
    const now = new Date();
    return {
      time: now.toLocaleString('zh-CN'),
      hour: now.getHours(),
      platform: process.platform,
      ollamaConnected,
      ollamaModel: this.llm.modelName,
      ollamaEndpoint: this.llm.endpoint,
      memoryStats: stats,
    };
  }

  applyToolPermission(settings: ToolSettings, mode: ConversationMode): ToolSettings {
    const resolved = resolveToolSettingsForMode(settings, mode);
    resolved.allowExternalNetwork = canUseNetworkCapability('externalToolNetwork');
    this.conversation.setToolPermissionLevel(resolved.permissionLevel);
    return resolved;
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

  private persistExtractedMemory(userMessage: string): void {
    const settings = getAppSettings();
    if (!settings.conversation.saveHistory) return;
    const memorySettings = settings.memory;
    if (!memorySettings.enabled || !memorySettings.autoExtract) return;

    const extracted = extractMemoryFromUserMessage(userMessage);
    extracted.profileFacts = extracted.profileFacts.filter(fact => (fact.importance ?? 0) >= memorySettings.minImportanceForAutoExtract);
    if (extracted.event && (extracted.event.importance ?? 0) < memorySettings.minImportanceForAutoExtract) {
      extracted.event = undefined;
    }
    if (extracted.projectNote && (extracted.projectNote.importance ?? 0) < memorySettings.minImportanceForAutoExtract) {
      extracted.projectNote = undefined;
    }

    if (extracted.profileFacts.length > 0) {
      addProfileFacts(extracted.profileFacts);
      logger.debug(`Stored ${extracted.profileFacts.length} profile memories.`);
    }

    if (extracted.projectNote) {
      addProjectNote(extracted.projectNote);
      logger.debug('Stored one project memory item.');
    }

    if (extracted.event) {
      addMemoryEvent(extracted.event);
      logger.debug('Stored one episodic memory item.');
    }
  }

  private processLocalCommand(userMessage: string, mode: ConversationMode): ChatResponse | null {
    const reminders = this.reminder.list();
    if (/提醒列表/.test(userMessage) || /^(列出|查看|我的)提醒/.test(userMessage)) {
      const active = reminders.filter(item => item.status === 'scheduled');
      const content = active.length === 0
        ? '现在没有待触发的提醒。'
        : active.map(item => `- ${item.title}：${new Date(item.dueAt).toLocaleString('zh-CN')}（${item.id}）`).join('\n');
      const emotion = this.emotion.analyzeResponse(content);
      this.saveMessageIfAllowed('assistant', content, emotion.type, mode);
      return { content, emotion };
    }

    const reminderRequest = parseReminderRequest(userMessage);
    if (reminderRequest) {
      const job = this.reminder.schedule(reminderRequest, (dueJob) => {
        globalEventBus.emit('reminder:due', dueJob);
      });
      const content = `好，记下了：${job.title}。我会在 ${new Date(job.dueAt).toLocaleString('zh-CN')} 提醒你。`;
      const emotion = this.emotion.analyzeResponse(content);
      this.saveMessageIfAllowed('assistant', content, emotion.type, mode);
      this.persistExtractedMemory(userMessage);
      return { content, emotion };
    }

    if (/工作流列表|有哪些工作流/.test(userMessage)) {
      const content = this.workflows.listWorkflows()
        .map(item => `- ${item.label}：${item.description}`)
        .join('\n');
      const emotion = this.emotion.analyzeResponse(content);
      this.saveMessageIfAllowed('assistant', content, emotion.type, mode);
      return { content, emotion };
    }

    if (/取消工作流/.test(userMessage)) {
      const run = this.workflows.cancelWorkflow();
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveMessageIfAllowed('assistant', run.message, emotion.type, mode);
      return { content: run.message, emotion };
    }

    if (/工作流下一步|下一步工作流|继续工作流/.test(userMessage)) {
      const run = this.workflows.advanceWorkflow();
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveMessageIfAllowed('assistant', run.message, emotion.type, mode);
      return { content: run.message, emotion };
    }

    const workflowId = detectWorkflowId(userMessage);
    if (workflowId) {
      const run = this.workflows.runWorkflow(workflowId);
      if (!run) return null;
      const emotion = this.emotion.analyzeResponse(run.message);
      this.saveMessageIfAllowed('assistant', run.message, emotion.type, mode);
      this.persistExtractedMemory(userMessage);
      return { content: run.message, emotion };
    }

    return null;
  }

  private saveMessageIfAllowed(role: 'user' | 'assistant', content: string, emotion?: string, mode?: ConversationMode): void {
    if (!shouldSaveHistory()) return;
    saveMessage(role, content, emotion, mode);
  }
}

function buildRetrievedContext(
  query: string,
  settings: MemorySettings,
  saveHistory: boolean,
  mode: ConversationMode,
): RetrievedContext {
  if (!settings.enabled) return emptyRetrievedContext();

  const depth = settings.retrievalDepth;
  return retrieveContext({
    query,
    maxProfileFacts: settings.retrieveProfile ? depth * 2 : 0,
    maxEvents: settings.retrieveEvents ? depth : 0,
    maxProjectNotes: settings.retrieveProjects ? depth : 0,
    recentMessageCount: saveHistory ? Math.max(0, Math.min(20, depth * 2)) : 0,
    conversationMode: mode,
  });
}

function emptyRetrievedContext(): RetrievedContext {
  return {
    profileFacts: [],
    relatedEvents: [],
    projectNotes: [],
    recentMessages: [],
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
