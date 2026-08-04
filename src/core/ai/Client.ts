/** Provider-routed LLM client for local Ollama and OpenAI-compatible APIs. */

import * as fs from 'fs';
import { resolveConfigFile } from '../runtime/Paths';
import { resolveModelCredential } from './CredentialStore';
import type {
  ConversationMode,
  ModelProvider,
  RemoteModelProvider,
  RemoteModelSettings,
} from '../../shared/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
}

export interface ModeGenerationOptions {
  temperature: number;
  topP: number;
}

export interface ChatGenerationOverrides {
  numCtx?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

interface ModelConfig {
  provider?: ModelProvider;
  ollama?: Partial<RemoteModelSettings>;
  remote?: Partial<Record<RemoteModelProvider, Partial<RemoteModelSettings>>>;
  fallback?: { timeoutMs?: number };
}

type CredentialResolver = (provider: RemoteModelProvider) => string | null;

const REMOTE_DEFAULTS: Record<RemoteModelProvider, RemoteModelSettings> = {
  openai: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  deepseek: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  'athena-cloud': { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
  custom: { baseUrl: '', model: '', temperature: 0.7, maxTokens: 2048, numCtx: 32768 },
};

export function resolveModeGenerationOptions(mode: ConversationMode, baseTemperature: number): ModeGenerationOptions {
  if (mode === 'create') return { temperature: clamp(baseTemperature + 0.2, 0.2, 1.25), topP: 0.95 };
  if (mode === 'reason') return { temperature: clamp(baseTemperature - 0.25, 0.15, 0.9), topP: 0.78 };
  if (mode === 'execute') return { temperature: clamp(baseTemperature - 0.3, 0.1, 0.75), topP: 0.72 };
  return { temperature: clamp(baseTemperature, 0.15, 1.1), topP: 0.9 };
}

export class LLMClient {
  private readonly provider: ModelProvider;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly numCtx: number;
  private readonly requestTimeoutMs: number;
  private readonly credentialResolver: CredentialResolver;

  constructor(config: ModelConfig = loadModelConfig(), credentialResolver: CredentialResolver = resolveModelCredential) {
    this.provider = config.provider ?? 'ollama';
    const selected = this.provider === 'ollama'
      ? { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:14b', temperature: 0.7, maxTokens: 2048, numCtx: 4096, ...config.ollama }
      : { ...REMOTE_DEFAULTS[this.provider], ...config.remote?.[this.provider] };
    this.baseUrl = String(selected.baseUrl || '').replace(/\/$/, '');
    this.model = String(selected.model || '');
    this.temperature = selected.temperature ?? 0.7;
    this.maxTokens = selected.maxTokens ?? 2048;
    this.numCtx = selected.numCtx ?? 32768;
    this.requestTimeoutMs = clamp(Math.round(config.fallback?.timeoutMs ?? 30000), 250, 120000);
    this.credentialResolver = credentialResolver;
  }

  get providerName(): ModelProvider { return this.provider; }
  get modelName(): string { return this.model; }
  get endpoint(): string { return this.baseUrl; }
  get contextWindow(): number { return this.numCtx; }

  async listModels(): Promise<string[]> {
    if (this.provider === 'ollama') {
      const response = await this.fetchFromOllama('/api/tags');
      if (!response) throw new Error(`Ollama connection failed at ${this.baseUrl}`);
      await ensureOk(response, 'Ollama');
      const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      return normalizeModelIds(data.models?.map(item => item.name ?? item.model) ?? []);
    }
    if (!this.baseUrl) throw new Error(`${providerLabel(this.provider)} 尚未配置 API 地址。`);
    const response = await this.fetchFromRemote('/models');
    await ensureOk(response, providerLabel(this.provider));
    const data = await response.json() as { data?: Array<{ id?: string }> };
    return normalizeModelIds(data.data?.map(item => item.id) ?? []);
  }

  async checkConnection(): Promise<boolean> {
    try {
      if (this.provider === 'ollama') {
        const models = await this.listModels();
        return Boolean(this.model) && models.some(model => model === this.model || model === `${this.model}:latest`);
      }
      if (!this.baseUrl || !this.model) return false;
      const response = await this.fetchFromRemote('/models');
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(
    messages: ChatMessage[],
    onStream?: (chunk: string) => void,
    mode: ConversationMode = 'companion',
    overrides?: ChatGenerationOverrides,
  ): Promise<string> {
    return this.provider === 'ollama'
      ? this.chatOllama(messages, onStream, mode, overrides)
      : this.chatRemote(messages, onStream, mode, overrides);
  }

  async chatJson(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    mode: ConversationMode = 'reason',
    overrides?: ChatGenerationOverrides,
  ): Promise<string> {
    if (this.provider === 'ollama') return this.chatJsonOllama(messages, schema, mode, overrides);
    const schemaInstruction: ChatMessage = {
      role: 'system',
      content: `Return one JSON object only. It must match this JSON Schema: ${JSON.stringify(schema)}`,
    };
    return this.chatRemote([schemaInstruction, ...messages], undefined, mode, overrides, true);
  }

  private async chatOllama(messages: ChatMessage[], onStream?: (chunk: string) => void, mode: ConversationMode = 'companion', overrides?: ChatGenerationOverrides): Promise<string> {
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    const response = await this.fetchFromOllama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: Boolean(onStream),
        options: ollamaOptions(generation, this.maxTokens, this.numCtx, overrides),
      }),
    });
    if (!response) throw new Error(`Ollama connection failed at ${this.baseUrl}`);
    await ensureOk(response, 'Ollama');
    if (!onStream) return readOllamaResponse(response);
    return readLineStream(response, parseOllamaStreamLine, onStream);
  }

  private async chatJsonOllama(messages: ChatMessage[], schema: Record<string, unknown>, mode: ConversationMode, overrides?: ChatGenerationOverrides): Promise<string> {
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    const response = await this.fetchFromOllama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: schema,
        options: ollamaOptions(generation, this.maxTokens, this.numCtx, { ...overrides, temperature: overrides?.temperature ?? 0.1, maxTokens: overrides?.maxTokens ?? 1536 }),
      }),
    });
    if (!response) throw new Error(`Ollama connection failed at ${this.baseUrl}`);
    await ensureOk(response, 'Ollama');
    return readOllamaResponse(response);
  }

  private async chatRemote(messages: ChatMessage[], onStream: ((chunk: string) => void) | undefined, mode: ConversationMode, overrides?: ChatGenerationOverrides, jsonMode = false): Promise<string> {
    if (!this.baseUrl || !this.model) throw new Error(`${providerLabel(this.provider)} 尚未配置 API 地址或模型。`);
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    const maxTokens = clamp(Math.round(overrides?.maxTokens ?? this.maxTokens), 128, 32768);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: Boolean(onStream),
      temperature: clamp(overrides?.temperature ?? generation.temperature, 0, 2),
      top_p: clamp(overrides?.topP ?? generation.topP, 0.05, 1),
      ...(this.provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    };
    if (this.provider === 'openai' && /^gpt-5\.6(?:-|$)/i.test(this.model)) body.reasoning_effort = 'none';
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await this.fetchFromRemote('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await ensureOk(response, providerLabel(this.provider));
    if (!onStream) {
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? '';
    }
    return readLineStream(response, parseOpenAiStreamLine, onStream);
  }

  private async fetchFromOllama(pathname: string, init?: RequestInit): Promise<Response | null> {
    let lastError: unknown;
    for (const endpoint of this.candidateOllamaEndpoints()) {
      try {
        return await fetch(`${endpoint}${pathname}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs) });
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw new Error(`${lastError.message} (${this.candidateOllamaEndpoints().join(', ')})`);
    return null;
  }

  private async fetchFromRemote(pathname: string, init?: RequestInit): Promise<Response> {
    const provider = this.provider as RemoteModelProvider;
    const apiKey = this.credentialResolver(provider);
    if (!apiKey && provider !== 'custom') throw new Error(`${providerLabel(provider)} API Key 尚未配置。`);
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
    return fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  private candidateOllamaEndpoints(): string[] {
    const endpoints = [this.baseUrl];
    if (this.baseUrl.includes('localhost')) endpoints.push(this.baseUrl.replace('localhost', '127.0.0.1'));
    else if (this.baseUrl.includes('127.0.0.1')) endpoints.push(this.baseUrl.replace('127.0.0.1', 'localhost'));
    return Array.from(new Set(endpoints));
  }
}

function ollamaOptions(generation: ModeGenerationOptions, defaultMaxTokens: number, defaultNumCtx: number, overrides?: ChatGenerationOverrides): Record<string, number> {
  return {
    temperature: clamp(overrides?.temperature ?? generation.temperature, 0, 2),
    top_p: clamp(overrides?.topP ?? generation.topP, 0.05, 1),
    num_predict: clamp(Math.round(overrides?.maxTokens ?? defaultMaxTokens), 128, 8192),
    num_ctx: clamp(Math.round(overrides?.numCtx ?? defaultNumCtx), 1024, 32768),
  };
}

function loadModelConfig(): ModelConfig {
  const configPath = resolveConfigFile('model.json');
  if (!configPath) return {};
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ModelConfig; }
  catch { return {}; }
}

async function ensureOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const detail = (await safeReadText(response)).replace(/\s+/g, ' ').slice(0, 500);
  throw new Error(`${label} request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
}

async function readOllamaResponse(response: Response): Promise<string> {
  const data = await response.json() as { message?: { content?: string }; response?: string };
  return data.message?.content ?? data.response ?? '';
}

async function readLineStream(response: Response, parser: (line: string) => string, onStream: (chunk: string) => void): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const chunk = parser(line);
      if (!chunk) continue;
      fullResponse += chunk;
      onStream(chunk);
    }
  }
  const finalChunk = parser(buffer);
  if (finalChunk) { fullResponse += finalChunk; onStream(finalChunk); }
  return fullResponse;
}

function parseOllamaStreamLine(line: string): string {
  try {
    const data = JSON.parse(line.trim()) as { message?: { content?: string }; response?: string };
    return data.message?.content ?? data.response ?? '';
  } catch { return ''; }
}

function parseOpenAiStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return '';
  try {
    const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
    return data.choices?.[0]?.delta?.content ?? '';
  } catch { return ''; }
}

function providerLabel(provider: ModelProvider): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'athena-cloud') return 'Athena Cloud';
  if (provider === 'custom') return '自定义 Provider';
  return 'Ollama';
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
async function safeReadText(response: Response): Promise<string> { try { return await response.text(); } catch { return ''; } }
function normalizeModelIds(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length > 0 && value.length <= 160)))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 500);
}
