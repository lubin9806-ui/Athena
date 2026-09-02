import type { ModelProvider } from '../../shared/types';
import type { LLMClient } from './Client';

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
}

type DiagnosticClient = Pick<LLMClient, 'providerName' | 'modelName' | 'endpoint' | 'listModels' | 'chat'>;

export async function diagnoseModelConnection(client: DiagnosticClient): Promise<ModelConnectionStatus> {
  const startedAt = Date.now();
  let serviceReachable = false;
  let modelAvailable = false;
  let chatSucceeded = false;
  let error = '';

  try {
    if (!client.endpoint.trim()) throw new Error('请先填写模型服务地址。');

    const models = await client.listModels();
    serviceReachable = true;

    const model = client.modelName.trim();
    if (!model) {
      error = '服务已连接，但尚未选择模型。请先读取模型列表并选择一个模型。';
    } else {
      modelAvailable = client.providerName === 'ollama'
        ? models.some(item => item === model || item === `${model}:latest`)
        : models.length === 0 || models.includes(model);
      if (!modelAvailable) {
        error = `服务已连接，但模型 ${model} 不在服务返回的可用列表中。`;
      }
    }

    if (modelAvailable) {
      const reply = await client.chat(
        [{ role: 'user', content: 'Reply with OK only.' }],
        undefined,
        'reason',
        { maxTokens: 16, temperature: 0.1 },
      );
      chatSucceeded = reply.trim().length > 0;
      if (!chatSucceeded) error = '模型服务返回了空响应。';
    }
  } catch (caught) {
    error = friendlyModelConnectionError(caught);
  }

  return {
    connected: serviceReachable && modelAvailable && chatSucceeded,
    serviceReachable,
    modelAvailable,
    chatSucceeded,
    durationMs: Date.now() - startedAt,
    error,
    provider: client.providerName,
    model: client.modelName,
    endpoint: client.endpoint,
  };
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
