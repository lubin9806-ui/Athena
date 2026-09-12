/** 对话管理 */

import { LLMClient } from './Client';
import { buildChatPromptWithSnapshot } from './PromptBuilder';
import type { ContextSnapshotPayload } from './ContextManager';
import { EmotionEngine } from './Emotion';
import { ToolRuntime, type ChatImageRequest, type ToolRuntimeInput } from '../tools/ToolRuntime';
import { toolPermissionPrompt } from '../tools/ComputerTools';
import { settingsLocationPrompt } from '../config/SettingsLocations';
import { saveContextSnapshot } from '../../memory';
import { shouldSaveHistory } from '../config/SettingsStore';
import { createLogger } from '../../engine/Logger';
import type {
  ConversationMode,
  Message,
  ChatResponse,
  RetrievedContext,
  ToolPermissionLevel,
  ToolSettings,
  ToolStatusEvent,
  ToolConfirmationRequest,
  ToolCatalogItem,
  WebSearchContext,
  WebSearchSummary,
  ContextSnapshotRecord,
} from '../../shared/types';
import type { ModelImageInput } from './model';

interface ContextSnapshotOptions {
  projectId?: number;
  chatWindowId?: number;
  userMessageId?: number;
}

/** A reply, or - when the model chose to draw - the picture it asked for. */
export interface ConversationResponse extends ChatResponse {
  imageRequest?: ChatImageRequest;
}

const logger = createLogger('Conversation');

export class Conversation {
  private llm: LLMClient;
  private emotion: EmotionEngine;
  private tools: ToolRuntime;

  constructor(llm: LLMClient) {
    this.llm = llm;
    this.emotion = new EmotionEngine();
    this.tools = new ToolRuntime(llm);
  }

  get emotionState() {
    return this.emotion.emotion;
  }

  setToolPermissionLevel(level: ToolPermissionLevel): void {
    this.tools.setPermissionLevel(level);
  }

  cancelCurrentExecution(): number {
    return this.tools.cancelCurrent();
  }

  getToolCatalog(settings: ToolSettings): ToolCatalogItem[] {
    return this.tools.getCatalog(settings);
  }

  async process(
    userMessage: string,
    recentMessages: Message[],
    retrievedContext: RetrievedContext,
    mode: ConversationMode,
    onStream?: (chunk: string) => void,
    webSearchContext?: WebSearchContext,
    // Fail closed: callers must pass real settings. A missing argument must not
    // grant Execute Full, which previously happened on this default object.
    toolSettings: ToolSettings = {
      permissionLevel: 'off',
      modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'off' },
      maxToolRounds: 4,
      commandTimeoutSeconds: 60,
    },
    onToolStatus?: (status: ToolStatusEvent) => void,
    onToolConfirm?: (request: ToolConfirmationRequest) => Promise<boolean>,
    contextSnapshotOptions?: ContextSnapshotOptions,
    images: ModelImageInput[] = [],
    chatCapabilities?: ToolRuntimeInput['chatCapabilities'],
  ): Promise<ConversationResponse> {
    // 更新情绪基调
    this.emotion.setBaseEmotion(new Date().getHours());

    const webContextWindow = webSearchContext
      ? Math.max(this.llm.contextWindow, (webSearchContext.pages?.length ?? 0) > 0 ? 8192 : 6144)
      : undefined;
    const maxPromptTokens = resolvePromptBudgetTokens(webContextWindow ?? this.llm.contextWindow);
    const offersImages = mode !== 'execute' && chatCapabilities?.imageGeneration === true;
    const prompt = buildChatPromptWithSnapshot({
      userMessage,
      recentMessages,
      retrievedContext,
      webSearchContext,
      // The settings map rides with the tool section because that is the one
      // that makes Athena talk about switches at all; without it she names a
      // setting and leaves the user to hunt for it (ATH-CHAT-006).
      toolContext: [
        toolPermissionPrompt(toolSettings),
        ...(offersImages ? [imageCapabilityPrompt()] : []),
        settingsLocationPrompt(),
      ].join('\n\n'),
      mode,
      maxPromptTokens,
    });
    const messages = prompt.messages;
    if (images.length > 0) {
      const userMessage = [...messages].reverse().find(message => message.role === 'user');
      if (!userMessage) throw new Error('Cannot attach images without a user message');
      userMessage.images = images.map(image => ({ ...image }));
    }
    const contextSnapshot = persistContextSnapshot(prompt.snapshot, {
      projectId: retrievedContext.chatWindow?.projectId,
      chatWindowId: contextSnapshotOptions?.chatWindowId ?? retrievedContext.chatWindow?.id,
      userMessageId: contextSnapshotOptions?.userMessageId,
    });

    // 调用 LLM
    const toolResult = await this.tools.process({
      messages,
      userMessage,
      mode,
      settings: toolSettings,
      numCtx: webContextWindow,
      onStream,
      onStatus: onToolStatus,
      onConfirm: onToolConfirm,
      chatCapabilities,
    });
    const fullResponse = toolResult.content;

    // 分析回复情绪
    const emotion = this.emotion.analyzeResponse(fullResponse);

    return {
      content: fullResponse,
      emotion,
      webSearch: summarizeWebSearch(webSearchContext),
      memoryContext: {
        recalledEvents: retrievedContext.relatedEvents,
        projectNotes: retrievedContext.projectNotes,
      },
      contextSnapshot,
      toolExecutions: toolResult.executions.length > 0 ? toolResult.executions : undefined,
      suggestedAction: toolResult.suggestedAction,
      imageRequest: toolResult.imageRequest,
    };
  }

  shutdown(): void {
    this.tools.shutdown();
  }
}

/**
 * Said outright because every mode prompt also says "本模式不调用本机工具", and a
 * model reading both has to know which side a picture falls on (ATH-IMG-005).
 */
function imageCapabilityPrompt(): string {
  return [
    '## 生图',
    '- 生图在任何模式都能用，它不经过本机工具权限，也不需要切到执行模式。用户要图时直接调用 generate_image。',
  ].join('\n');
}

function resolvePromptBudgetTokens(contextWindow: number): number {
  const safeWindow = Math.max(1024, Math.min(32768, Math.round(contextWindow || 4096)));
  const responseReserve = Math.max(512, Math.min(4096, Math.floor(safeWindow * 0.25)));
  return Math.max(1024, safeWindow - responseReserve - 256);
}

function persistContextSnapshot(
  snapshot: ContextSnapshotPayload,
  options: ContextSnapshotOptions,
): ContextSnapshotRecord | undefined {
  // included/omitted carry previews of the recent messages and retrieved memory
  // that went into the prompt, so this table is chat history by another name
  // (ATH-DATA-002).
  if (!shouldSaveHistory()) return undefined;
  try {
    return saveContextSnapshot({
      projectId: options.projectId,
      windowId: options.chatWindowId,
      userMessageId: options.userMessageId,
      mode: snapshot.mode,
      budget: snapshot.budget as unknown as Record<string, unknown>,
      included: snapshot.included,
      omitted: snapshot.omitted,
      promptMessageCount: snapshot.budget.promptMessageCount,
      promptChars: snapshot.budget.promptChars,
      estimatedPromptTokens: snapshot.budget.estimatedPromptTokens,
    });
  } catch (error) {
    logger.warn(`Context snapshot persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function summarizeWebSearch(context?: WebSearchContext): WebSearchSummary | undefined {
  if (!context) return undefined;
  return {
    query: context.query,
    provider: context.provider,
    searchedAt: context.searchedAt,
    sources: context.sources,
    readPageCount: context.pages?.length ?? 0,
    searchRounds: context.searchRounds ?? 1,
    providers: context.providers ?? [context.provider],
    error: context.error,
  };
}
