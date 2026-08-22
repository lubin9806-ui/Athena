import type {
  AgentMessageRouteDecision,
  AgentMessageRoute,
  ConversationMode,
  MessageRole,
} from '../../shared/types';
import {
  extractSearchQuery,
  isExplicitSearchRequest,
  shouldAutoSearch,
} from '../web/WebSearchService';
import { requiresComputerAction } from '../tools/ToolRuntime';

export interface RoutingHistoryItem {
  role: MessageRole;
  content: string;
}

export interface AgentMessageRoutingInput {
  message: string;
  mode: ConversationMode;
  forceWebSearch?: boolean;
  webSearchEnabled: boolean;
  canStartDurableExecution: boolean;
  recentMessages?: RoutingHistoryItem[];
  semanticRoutingAllowed?: boolean;
}

export interface SemanticRoutingPrediction {
  route: AgentMessageRoute;
  confidence: 'high' | 'medium' | 'low';
  explicitActionConsent: boolean;
  referencesPriorContext: boolean;
  query?: string;
}

export interface SemanticRoutingClassifier {
  classify(input: AgentMessageRoutingInput, signal: AbortSignal): Promise<SemanticRoutingPrediction>;
}

interface AgentMessageRouterOptions {
  semanticClassifier?: SemanticRoutingClassifier;
  semanticTimeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

interface CachedRoute {
  expiresAt: number;
  decision: AgentMessageRouteDecision;
}

export class AgentMessageRouter {
  private readonly semanticClassifier?: SemanticRoutingClassifier;
  private readonly semanticTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedRoute>();

  constructor(options: AgentMessageRouterOptions = {}) {
    this.semanticClassifier = options.semanticClassifier;
    this.semanticTimeoutMs = clampInteger(options.semanticTimeoutMs ?? 8_000, 500, 30_000);
    this.cacheTtlMs = clampInteger(options.cacheTtlMs ?? 15_000, 1_000, 60_000);
    this.now = options.now ?? Date.now;
  }

  route(input: AgentMessageRoutingInput): AgentMessageRouteDecision {
    const message = input.message.trim();
    if (input.mode === 'execute') {
      return decision('durable_execution', 'execute', 'high', 'selected-execution-mode', false);
    }

    if (input.forceWebSearch && input.webSearchEnabled) {
      return decision('web_research', input.mode, 'high', 'forced-web-search', false, extractSearchQuery(message));
    }

    if (isDiscussionOnly(message)) {
      if (input.webSearchEnabled && isResearchRequest(message)) {
        return decision('web_research', input.mode, 'high', 'explicit-web-research', false, extractSearchQuery(message));
      }
      return decision('conversation', input.mode, 'high', 'discussion-only', false);
    }

    const handoff = isExecutionHandoff(message);
    const hasContext = hasActionableContext(input.recentMessages || []);
    if (handoff && requiresPriorContext(message) && !hasContext) {
      return decision('conversation', input.mode, 'high', 'execution-context-required', false);
    }

    if (handoff || isDirectBuildRequest(message) || requiresComputerAction(message)) {
      if (!input.canStartDurableExecution) {
        return decision('conversation', input.mode, 'high', 'execution-unavailable', false);
      }
      return decision(
        'durable_execution',
        'execute',
        'high',
        handoff ? 'explicit-execution-handoff' : 'direct-computer-action',
        true,
      );
    }

    if (input.webSearchEnabled && isResearchRequest(message)) {
      const reason = isExplicitSearchRequest(message) || isBroadResearchRequest(message)
        ? 'explicit-web-research'
        : 'fresh-information';
      return decision('web_research', input.mode, reason === 'explicit-web-research' ? 'high' : 'medium', reason, false, extractSearchQuery(message));
    }

    return decision('conversation', input.mode, 'medium', 'ordinary-conversation', false);
  }

  async routeAdaptive(input: AgentMessageRoutingInput): Promise<AgentMessageRouteDecision> {
    const rulesDecision = this.route(input);
    if (!this.semanticClassifier || !shouldRequestSemanticReview(input, rulesDecision)) return rulesDecision;

    const cacheKey = routingCacheKey(input);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.decision);
    if (cached) this.cache.delete(cacheKey);

    let resolved: AgentMessageRouteDecision;
    try {
      const signal = AbortSignal.timeout(this.semanticTimeoutMs);
      const prediction = await this.semanticClassifier.classify(input, signal);
      resolved = adjudicateSemanticPrediction(input, rulesDecision, prediction);
    } catch {
      resolved = { ...rulesDecision, routingMethod: 'rules_fallback' };
    }

    this.remember(cacheKey, resolved);
    return structuredClone(resolved);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private remember(key: string, route: AgentMessageRouteDecision): void {
    const now = this.now();
    for (const [candidate, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(candidate);
    }
    while (this.cache.size >= 64) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, decision: structuredClone(route) });
  }
}

function decision(
  route: AgentMessageRouteDecision['route'],
  effectiveMode: ConversationMode,
  confidence: AgentMessageRouteDecision['confidence'],
  reason: AgentMessageRouteDecision['reason'],
  autoSwitch: boolean,
  query?: string,
): AgentMessageRouteDecision {
  return {
    route,
    effectiveMode,
    confidence,
    reason,
    routingMethod: 'rules',
    autoSwitch,
    ...(query ? { query } : {}),
  };
}

function shouldRequestSemanticReview(
  input: AgentMessageRoutingInput,
  rulesDecision: AgentMessageRouteDecision,
): boolean {
  if (input.semanticRoutingAllowed === false) return false;
  if (rulesDecision.reason !== 'ordinary-conversation' || rulesDecision.confidence !== 'medium') return false;
  const message = input.message.trim();
  if (message.length < 4 || isClearlyCasualConversation(message)) return false;
  return true;
}

function adjudicateSemanticPrediction(
  input: AgentMessageRoutingInput,
  rulesDecision: AgentMessageRouteDecision,
  prediction: SemanticRoutingPrediction,
): AgentMessageRouteDecision {
  if (prediction.route === 'conversation') {
    return {
      ...decision('conversation', input.mode, prediction.confidence === 'high' ? 'high' : 'medium', 'semantic-conversation', false),
      routingMethod: 'model',
    };
  }

  if (prediction.route === 'web_research') {
    if (!input.webSearchEnabled || prediction.confidence === 'low') return rulesDecision;
    const query = normalizeSemanticQuery(prediction.query) || extractSearchQuery(input.message.trim());
    return {
      ...decision('web_research', input.mode, prediction.confidence === 'high' ? 'high' : 'medium', 'semantic-web-research', false, query),
      routingMethod: 'model',
    };
  }

  if (!input.canStartDurableExecution) {
    return decision('conversation', input.mode, 'high', 'execution-unavailable', false);
  }
  if (prediction.confidence !== 'high' || !prediction.explicitActionConsent) return rulesDecision;
  if (prediction.referencesPriorContext && !hasActionableContext(input.recentMessages || [])) {
    return decision('conversation', input.mode, 'high', 'execution-context-required', false);
  }
  return {
    ...decision('durable_execution', 'execute', 'high', 'semantic-durable-execution', true),
    routingMethod: 'model',
  };
}

function normalizeSemanticQuery(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function routingCacheKey(input: AgentMessageRoutingInput): string {
  return JSON.stringify({
    message: input.message.trim(),
    mode: input.mode,
    forceWebSearch: input.forceWebSearch === true,
    webSearchEnabled: input.webSearchEnabled,
    canStartDurableExecution: input.canStartDurableExecution,
    semanticRoutingAllowed: input.semanticRoutingAllowed !== false,
    recentMessages: (input.recentMessages || []).slice(-12).map(item => ({
      role: item.role,
      content: item.content.slice(0, 2_000),
    })),
  });
}

function isClearlyCasualConversation(message: string): boolean {
  return /^(?:你好|您好|嗨|哈喽|早上好|早安|午安|晚上好|晚安|谢谢|多谢|再见|拜拜|在吗|hello|hi|hey|thanks|thank you|good(?: morning| afternoon| evening| night)|bye)[。！!,.?？\s]*$/i.test(message);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function isDiscussionOnly(message: string): boolean {
  return /(?:先不(?:执行|做|改)|暂时不(?:执行|做|改)|不要(?:执行|动代码|改代码|操作)|不动代码|只(?:聊|讨论|分析|给建议)|先(?:聊聊|讨论|分析|想想)|别(?:执行|动手|修改)|do not (?:execute|change|edit)|discussion only|just discuss|no code changes)/i.test(message);
}

function isResearchRequest(message: string): boolean {
  if (/(?:今天|今日).{0,8}(?:心情|过得|感觉)|\bhow are you today\b/i.test(message)) return false;
  if (shouldAutoSearch(message)) return true;
  return isBroadResearchRequest(message);
}

function isBroadResearchRequest(message: string): boolean {
  const onlineSource = /(?:GitHub|GitLab|开源|仓库|项目推荐|官网|网页|互联网|网上|新闻|资讯|论文|文献|资料|版本|价格|榜单|竞品|market|repository|repositories|open[ -]?source|documentation|release notes)/i;
  const lookupAction = /(?:帮我|请|给我|替我|能否|可以)?\s*(?:查|查找|查询|搜|搜索|检索|调查|找找|找一下|推荐|看看|核实|验证|research|search|find|look up|browse|recommend)/i;
  return onlineSource.test(message) && lookupAction.test(message);
}

function isExecutionHandoff(message: string): boolean {
  const planReference = /(?:按|照|就按|根据|依照).{0,24}(?:这个|刚才|上面|前面|聊好(?:的)?|讨论(?:的)?|确认(?:的)?|现有)?\s*(?:方案|计划|步骤|结论|设计).{0,20}(?:开始|执行|实施|落地|动手|做|修改|改动|开发|实现|继续)/i;
  const directHandoff = /(?:现在|直接|马上|可以)?\s*(?:开始执行|开始实施|开始落地|开始动手|开始改(?:代码|动)?|继续执行|继续实施|照着做|动手做|落地执行)|\b(?:go ahead|proceed|start implementing|implement (?:it|the plan)|execute the plan)\b/i;
  return planReference.test(message) || directHandoff.test(message);
}

function requiresPriorContext(message: string): boolean {
  if (/^(?:现在|直接)?\s*(?:开始执行|开始实施|开始落地|继续执行)[。！!]?$/i.test(message.trim())) return true;
  return /(?:这个|刚才|上面|前面|聊好|讨论|确认|照着|the plan|it\b)/i.test(message)
    && !isDirectBuildRequest(message);
}

function isDirectBuildRequest(message: string): boolean {
  const request = /(?:帮我|请(?:你)?|麻烦|替我|给我|现在|直接|我要你|需要你|can you|please)\s*.{0,20}(?:做|开发|实现|搭建|创建|新建|编写|写|修改|修复|重构|接入|生成|build|create|implement|develop|code|fix|refactor|edit)/i;
  const artifact = /(?:网站|网页|游戏|应用|软件|项目|代码|功能|页面|接口|API|脚本|组件|数据库|测试|website|web ?app|game|app|software|project|code|feature|page|api|script|component|database|test)/i;
  const advisory = /(?:怎么|如何|建议|方案|想法|思路|可行吗|应该|要不要|先分析|先讨论)|\b(?:how should|how to|advice|approach|plan only|explain|teach me|show me how)\b/i;
  const directEnglish = /\b(?:can|could|would) you\s+(?:build|create|implement|develop|code|fix|refactor|edit)\b.{0,100}\b(?:website|web ?app|game|app|software|project|code|feature|page|api|script|component|database|test)s?\b|\bplease\s+(?:build|create|implement|develop|code|fix|refactor|edit)\b.{0,100}\b(?:website|web ?app|game|app|software|project|code|feature|page|api|script|component|database|test)s?\b/i;
  return (request.test(message) && artifact.test(message) && !advisory.test(message))
    || (directEnglish.test(message) && !advisory.test(message));
}

function hasActionableContext(messages: RoutingHistoryItem[]): boolean {
  const recent = messages.slice(-12);
  if (!recent.some(item => item.role === 'assistant')) return false;
  return recent.some(item => /(?:方案|计划|步骤|实现|架构|修改|开发|文件|代码|验证|交付|plan|steps|implementation|architecture|code|files|validation)/i.test(item.content));
}
