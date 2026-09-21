import { classifyModelEndpoint } from './ModelNetworkPolicy';
import type { AsyncMemoryEmbeddingProvider } from '../../memory';
import type { MemoryEmbeddingStatus } from '../../shared/types';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_EMBED_INPUTS = 25;
const MAX_EMBED_CHARS = 2_400;

export class OllamaMemoryEmbeddingProvider implements AsyncMemoryEmbeddingProvider {
  readonly id: string;
  readonly minimumSimilarity: number;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(input: { endpoint: string; model: string; timeoutMs?: number }) {
    this.endpoint = input.endpoint.replace(/\/$/, '');
    this.model = input.model.trim();
    this.timeoutMs = Math.max(1_000, Math.min(30_000, Math.round(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
    this.id = `ollama:${this.model || 'unconfigured'}`;
    this.minimumSimilarity = isEmbeddingGemma(this.model) ? 0.28 : 0.5;
  }

  async status(enabled = true): Promise<MemoryEmbeddingStatus> {
    if (!enabled) return this.describe('disabled', false, '本地语义记忆已关闭。关键词记忆仍然可用。');
    if (classifyModelEndpoint(this.endpoint) !== 'loopback') {
      return this.describe('blocked-endpoint', true, '语义记忆只允许使用本机 Ollama 地址，不会把聊天摘要发送到局域网或云端。');
    }
    if (!this.model) return this.describe('model-missing', true, '尚未配置本地 Embedding 模型。');

    try {
      const response = await this.fetch('/api/tags', { method: 'GET' });
      if (!response.ok) return this.describe('ollama-unavailable', true, `Ollama 状态检查失败（HTTP ${response.status}）。`);
      const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      const names = (payload.models || []).map(item => item.name || item.model || '').filter(Boolean);
      if (!names.some(name => sameModel(name, this.model))) {
        return this.describe('model-missing', true, `本机 Ollama 中没有 ${this.model}。Athena 不会自动下载模型。`);
      }
      return this.describe('ready', true, `本地语义记忆已就绪，使用 ${this.model}。`);
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? '连接本机 Ollama 超时。'
        : `无法连接本机 Ollama：${error instanceof Error ? error.message : String(error)}`;
      return this.describe('ollama-unavailable', true, message);
    }
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (classifyModelEndpoint(this.endpoint) !== 'loopback') throw new Error('Memory embeddings require a loopback Ollama endpoint.');
    if (!this.model) throw new Error('Memory embedding model is not configured.');
    const cleaned = inputs
      .slice(0, MAX_EMBED_INPUTS)
      .map(input => input.replace(/\s+/g, ' ').trim().slice(0, MAX_EMBED_CHARS));
    if (cleaned.length !== inputs.length || cleaned.some(input => !input)) throw new Error('Memory embedding input is invalid.');

    const response = await this.fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: cleaned, truncate: true }),
    });
    if (!response.ok) throw new Error(`Ollama embedding request failed with HTTP ${response.status}.`);
    const payload = await response.json() as { embeddings?: unknown };
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== cleaned.length) {
      throw new Error('Ollama embedding response count did not match the request.');
    }
    const vectors = payload.embeddings.map(vector => validateVector(vector));
    const dimensions = vectors[0]?.length || 0;
    if (dimensions === 0 || vectors.some(vector => vector.length !== dimensions)) {
      throw new Error('Ollama embedding vectors have inconsistent dimensions.');
    }
    return vectors;
  }

  async embedRetrieval(query: string, documents: Array<{ title: string; text: string }>): Promise<number[][]> {
    if (!isEmbeddingGemma(this.model)) return this.embed([query, ...documents.map(document => `${document.title}\n${document.text}`)]);
    return this.embed([
      `task: search result | query: ${query}`,
      ...documents.map(document => `title: ${document.title.trim() || 'none'} | text: ${document.text}`),
    ]);
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.endpoint}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private describe(state: MemoryEmbeddingStatus['state'], enabled: boolean, message: string): MemoryEmbeddingStatus {
    return { enabled, state, model: this.model, endpoint: this.endpoint, message };
  }
}

function validateVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 8 || value.length > 8_192) throw new Error('Ollama returned an invalid embedding vector.');
  const vector = value.map(item => Number(item));
  if (vector.some(item => !Number.isFinite(item))) throw new Error('Ollama embedding vector contains non-finite values.');
  return vector;
}

function sameModel(candidate: string, configured: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/:latest$/, '');
  return normalize(candidate) === normalize(configured);
}

function isEmbeddingGemma(model: string): boolean {
  return model.trim().toLowerCase().split(':', 1)[0] === 'embeddinggemma';
}
