/** Ollama-backed LLM client. */

import * as fs from 'fs';
import { resolveConfigFile } from '../runtime/Paths';
import type { ConversationMode } from '../../shared/types';

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

export function resolveModeGenerationOptions(
  mode: ConversationMode,
  baseTemperature: number
): ModeGenerationOptions {
  if (mode === 'create') {
    return {
      temperature: clamp(baseTemperature + 0.2, 0.2, 1.25),
      topP: 0.95,
    };
  }
  if (mode === 'reason') {
    return {
      temperature: clamp(baseTemperature - 0.25, 0.15, 0.9),
      topP: 0.78,
    };
  }
  if (mode === 'execute') {
    return {
      temperature: clamp(baseTemperature - 0.3, 0.1, 0.75),
      topP: 0.72,
    };
  }
  return {
    temperature: clamp(baseTemperature, 0.15, 1.1),
    topP: 0.9,
  };
}

interface ModelConfig {
  ollama?: {
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    numCtx?: number;
  };
  fallback?: {
    timeoutMs?: number;
  };
}

export class LLMClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly numCtx: number;
  private readonly requestTimeoutMs: number;

  constructor(config: ModelConfig = loadModelConfig()) {
    const ollama = config.ollama ?? {};
    this.baseUrl = (ollama.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = ollama.model ?? 'qwen2.5:14b';
    this.temperature = ollama.temperature ?? 0.7;
    this.maxTokens = ollama.maxTokens ?? 2048;
    this.numCtx = ollama.numCtx ?? 4096;
    this.requestTimeoutMs = clamp(Math.round(config.fallback?.timeoutMs ?? 15000), 250, 120000);
  }

  get modelName(): string {
    return this.model;
  }

  get endpoint(): string {
    return this.baseUrl;
  }

  get contextWindow(): number {
    return this.numCtx;
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.fetchFromOllama('/api/tags');
      return response?.ok ?? false;
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
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    const response = await this.fetchFromOllama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: Boolean(onStream),
        options: {
          temperature: clamp(overrides?.temperature ?? generation.temperature, 0, 2),
          top_p: clamp(overrides?.topP ?? generation.topP, 0.05, 1),
          num_predict: clamp(Math.round(overrides?.maxTokens ?? this.maxTokens), 128, 8192),
          num_ctx: clamp(Math.round(overrides?.numCtx ?? this.numCtx), 1024, 32768),
        },
      }),
    });

    if (!response) {
      throw new Error(`Ollama connection failed at ${this.baseUrl}`);
    }

    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    if (!onStream) {
      const data = await response.json() as { message?: { content?: string }; response?: string };
      return data.message?.content ?? data.response ?? '';
    }

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
        const chunk = parseStreamLine(line);
        if (!chunk) continue;
        fullResponse += chunk;
        onStream(chunk);
      }
    }

    const finalChunk = parseStreamLine(buffer);
    if (finalChunk) {
      fullResponse += finalChunk;
      onStream(finalChunk);
    }

    return fullResponse;
  }

  async chatJson(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    mode: ConversationMode = 'reason',
    overrides?: ChatGenerationOverrides,
  ): Promise<string> {
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    const response = await this.fetchFromOllama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: schema,
        options: {
          temperature: clamp(overrides?.temperature ?? 0.1, 0, 2),
          top_p: clamp(overrides?.topP ?? Math.min(generation.topP, 0.82), 0.05, 1),
          num_predict: clamp(Math.round(overrides?.maxTokens ?? 1536), 128, 8192),
          num_ctx: clamp(Math.round(overrides?.numCtx ?? Math.max(this.numCtx, 8192)), 1024, 32768),
        },
      }),
    });

    if (!response) throw new Error(`Ollama connection failed at ${this.baseUrl}`);
    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    const data = await response.json() as { message?: { content?: string }; response?: string };
    return data.message?.content ?? data.response ?? '';
  }

  private async fetchFromOllama(pathname: string, init?: RequestInit): Promise<Response | null> {
    let lastError: unknown;

    for (const endpoint of this.candidateEndpoints()) {
      try {
        return await fetch(`${endpoint}${pathname}`, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw new Error(`${lastError.message} (${this.candidateEndpoints().join(', ')})`);
    }
    return null;
  }

  private candidateEndpoints(): string[] {
    const endpoints = [this.baseUrl];
    if (this.baseUrl.includes('localhost')) {
      endpoints.push(this.baseUrl.replace('localhost', '127.0.0.1'));
    } else if (this.baseUrl.includes('127.0.0.1')) {
      endpoints.push(this.baseUrl.replace('127.0.0.1', 'localhost'));
    }
    return Array.from(new Set(endpoints));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadModelConfig(): ModelConfig {
  const configPath = resolveConfigFile('model.json');
  if (!configPath) return {};

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ModelConfig;
  } catch {
    return {};
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  try {
    const data = JSON.parse(trimmed) as { message?: { content?: string }; response?: string };
    return data.message?.content ?? data.response ?? '';
  } catch {
    return '';
  }
}
