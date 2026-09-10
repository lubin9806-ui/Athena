import type { ModelProvider } from '../../shared/types';
import type { LLMClient } from './Client';

export interface AssistModelDiagnostic {
  model: string;
  modelAvailable: boolean;
  chatSucceeded: boolean;
  error: string;
}

export interface ModelConnectionStatus {
  connected: boolean;
  serviceReachable: boolean;
  modelAvailable: boolean;
  chatSucceeded: boolean;
  durationMs: number;
  error: string;
  provider: ModelProvider;
  model: string;
  endpoint: string;
  /** Present only when a separate assist model is configured. */
  assist: AssistModelDiagnostic | null;
}

type DiagnosticClient = Pick<LLMClient, 'providerName' | 'modelName' | 'endpoint' | 'listModels' | 'chat'>;

/**
 * Enough budget for a reasoning model to reach its first content token.
 *
 * A 16-token probe is not a cheaper version of this test, it is a broken one:
 * reasoning models spend output tokens on reasoning before emitting any
 * characters, so a tight cap comes back `finish=length` with zero content and the
 * probe reports a perfectly working model as "空响应" (ATH-IMG-004, measured on
 * DeepSeek: empty at 1200, never empty at 3000). maxTokens is a ceiling, not a
 * target - a model that answers in two tokens still answers in two.
 */
const PROBE_MAX_TOKENS = 3_000;

export async function diagnoseModelConnection(
  client: DiagnosticClient,
  assistClient?: DiagnosticClient,
): Promise<ModelConnectionStatus> {
  const startedAt = Date.now();
  let serviceReachable = false;
  let modelAvailable = false;
  let chatSucceeded = false;
  let error = '';
  let assist: AssistModelDiagnostic | null = null;

  try {
    if (!client.endpoint.trim()) throw new Error('请先填写模型服务地址。');

    const models = await client.listModels();
    serviceReachable = true;
    const isOllama = client.providerName === 'ollama';

    const model = client.modelName.trim();
    if (!model) {
      error = '服务已连接，但尚未选择模型。请先读取模型列表并选择一个模型。';
    } else {
      modelAvailable = modelIsListed(model, models, isOllama);
      if (!modelAvailable) {
        error = `服务已连接，但模型 ${model} 不在服务返回的可用列表中。`;
      }
    }

    if (modelAvailable) {
      chatSucceeded = (await probeChat(client)).length > 0;
      if (!chatSucceeded) error = '模型服务返回了空响应。';
    }

    // The assist model shares this provider's endpoint and credential, so the one
    // model list already covers it; what it does not cover is whether that id is
    // real. It gets its own leg because a wrong id fails silently at runtime -
    // extraction throws, degrades to "leave the description alone", and nothing
    // in the app looks broken. Reporting the main model's success as the whole
    // answer is exactly what would hide it.
    if (assistClient && serviceReachable) {
      assist = await diagnoseAssistModel(assistClient, models, isOllama);
      if (!assist.chatSucceeded && !error) error = assist.error;
    }
  } catch (caught) {
    error = friendlyModelConnectionError(caught);
  }

  return {
    // A green light has to mean every leg passed. The assist model is a leg.
    connected: serviceReachable && modelAvailable && chatSucceeded && (assist === null || assist.chatSucceeded),
    serviceReachable,
    modelAvailable,
    chatSucceeded,
    durationMs: Date.now() - startedAt,
    error,
    provider: client.providerName,
    model: client.modelName,
    endpoint: client.endpoint,
    assist,
  };
}

async function diagnoseAssistModel(
  assistClient: DiagnosticClient,
  models: string[],
  isOllama: boolean,
): Promise<AssistModelDiagnostic> {
  const model = assistClient.modelName.trim();
  const result: AssistModelDiagnostic = { model, modelAvailable: false, chatSucceeded: false, error: '' };
  if (!model) {
    result.error = '辅助模型没有模型名。';
    return result;
  }
  result.modelAvailable = modelIsListed(model, models, isOllama);
  if (!result.modelAvailable) {
    result.error = `辅助模型 ${model} 不在服务返回的可用列表中。`;
    return result;
  }
  // Its own try/catch: an unreachable assist model must not be reported as the
  // main model's service being down.
  try {
    result.chatSucceeded = (await probeChat(assistClient)).length > 0;
    if (!result.chatSucceeded) result.error = `辅助模型 ${model} 返回了空响应。`;
  } catch (caught) {
    result.error = `辅助模型 ${model}：${friendlyModelConnectionError(caught)}`;
  }
  return result;
}

async function probeChat(client: DiagnosticClient): Promise<string> {
  const reply = await client.chat(
    [{ role: 'user', content: 'Reply with OK only.' }],
    undefined,
    'reason',
    { maxTokens: PROBE_MAX_TOKENS, temperature: 0.1 },
  );
  return reply.trim();
}

/** A provider that returns no list cannot contradict the configured id. */
function modelIsListed(model: string, models: string[], isOllama: boolean): boolean {
  if (isOllama) return models.some(item => item === model || item === `${model}:latest`);
  return models.length === 0 || models.includes(model);
}

export function friendlyModelConnectionError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/API Key is not configured/i.test(message)) return 'API Key 未配置。请填写后点击“安全保存 Key”。';
  if (/\b401\b|authentication fails|unauthorized/i.test(message)) return 'API Key 无效或已失效（HTTP 401）。请重新保存有效 Key。';
  if (/\b402\b|insufficient balance/i.test(message)) return '账户余额不足（HTTP 402）。';
  if (/\b429\b|rate limit/i.test(message)) return '请求过于频繁（HTTP 429），请稍后重试。';
  if (/\b(?:500|503)\b|server overloaded/i.test(message)) return '模型服务暂时不可用，请稍后重试。';
  if (/timeout|timed out|aborted/i.test(message)) return '连接或模型请求超时，请稍后重试。';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(message)) return '网络、DNS 或 TLS 连接失败，请检查服务地址和网络。';
  return message;
}
