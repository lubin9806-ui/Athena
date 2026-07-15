/** 对话管理 */

import { LLMClient } from './Client';
import { buildChatPrompt } from './PromptBuilder';
import { EmotionEngine } from './Emotion';
import { ToolRuntime } from '../tools/ToolRuntime';
import { toolPermissionPrompt } from '../tools/ComputerTools';
import type {
  ConversationMode,
  Message,
  ChatResponse,
  RetrievedContext,
  ToolPermissionLevel,
  ToolSettings,
  ToolStatusEvent,
  WebSearchContext,
  WebSearchSummary,
} from '../../shared/types';

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

  async process(
    userMessage: string,
    recentMessages: Message[],
    retrievedContext: RetrievedContext,
    mode: ConversationMode,
    onStream?: (chunk: string) => void,
    webSearchContext?: WebSearchContext,
    toolSettings: ToolSettings = {
      permissionLevel: 'off',
      modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'full' },
      maxToolRounds: 4,
      commandTimeoutSeconds: 60,
    },
    onToolStatus?: (status: ToolStatusEvent) => void,
  ): Promise<ChatResponse> {
    // 更新情绪基调
    this.emotion.setBaseEmotion(new Date().getHours());

    // 构建 Prompt
    const messages = buildChatPrompt({
      userMessage,
      recentMessages,
      retrievedContext,
      webSearchContext,
      toolContext: toolPermissionPrompt(toolSettings),
      mode,
    });

    // 调用 LLM
    const webContextWindow = webSearchContext
      ? Math.max(this.llm.contextWindow, (webSearchContext.pages?.length ?? 0) > 0 ? 8192 : 6144)
      : undefined;
    const toolResult = await this.tools.process({
      messages,
      userMessage,
      mode,
      settings: toolSettings,
      numCtx: webContextWindow,
      onStream,
      onStatus: onToolStatus,
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
      toolExecutions: toolResult.executions.length > 0 ? toolResult.executions : undefined,
    };
  }

  shutdown(): void {
    this.tools.shutdown();
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
