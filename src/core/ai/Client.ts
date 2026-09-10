/** Provider-neutral LLM facade backed by protocol-specific model adapters. */

import { getModelSettings } from '../config/SettingsStore';
import { resolveModelCredential } from './CredentialStore';
import type { ConversationMode, ModelProvider } from '../../shared/types';
import {
  createModelRuntime,
  type ModelAdapter,
  type ModelAdapterCapabilities,
  type ModelClientConfig,
  type ModelGenerationRequest,
  type ModelMessage,
  type ModelResponse,
  type ModelStreamEvent,
  type ModelToolChoice,
  type ModelToolDefinition,
  type ModelCredentialResolver,
} from './model';

export type ChatMessage = ModelMessage;

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

export interface ToolChatOptions {
  toolChoice?: ModelToolChoice;
  mode?: ConversationMode;
  stream?: boolean;
  signal?: AbortSignal;
  overrides?: ChatGenerationOverrides;
  onEvent?: (event: ModelStreamEvent) => void;
}

export function resolveModeGenerationOptions(mode: ConversationMode, baseTemperature: number): ModeGenerationOptions {
  if (mode === 'create') return { temperature: clamp(baseTemperature + 0.2, 0.2, 1.25), topP: 0.95 };
  if (mode === 'reason') return { temperature: clamp(baseTemperature - 0.25, 0.15, 0.9), topP: 0.78 };
  if (mode === 'execute') return { temperature: clamp(baseTemperature - 0.3, 0.1, 0.75), topP: 0.72 };
  return { temperature: clamp(baseTemperature, 0.15, 1.1), topP: 0.9 };
}

export class LLMClient {
  private readonly provider: ModelProvider;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly numCtx: number;
  private readonly adapter: ModelAdapter;

  constructor(
    config: ModelClientConfig = loadModelConfig(),
    credentialResolver: ModelCredentialResolver = resolveModelCredential,
  ) {
    const runtime = createModelRuntime(config, credentialResolver);
    this.provider = runtime.provider;
    this.model = runtime.settings.model;
    this.baseUrl = runtime.settings.baseUrl;
    this.temperature = runtime.settings.temperature;
    this.maxTokens = runtime.settings.maxTokens;
    this.numCtx = runtime.settings.numCtx;
    this.adapter = runtime.adapter;
  }

  get providerName(): ModelProvider { return this.provider; }
  get modelName(): string { return this.model; }
  get endpoint(): string { return this.baseUrl; }
  get contextWindow(): number { return this.numCtx; }
  get capabilities(): ModelAdapterCapabilities { return cloneCapabilities(this.adapter.capabilities); }

  async refreshCapabilities(): Promise<ModelAdapterCapabilities> {
    const capabilities = this.adapter.refreshCapabilities
      ? await this.adapter.refreshCapabilities()
      : this.adapter.capabilities;
    return cloneCapabilities(capabilities);
  }

  async listModels(): Promise<string[]> {
    return this.adapter.listModels();
  }

  async checkConnection(): Promise<boolean> {
    return this.adapter.checkConnection();
  }

  async generate(request: ModelGenerationRequest): Promise<ModelResponse> {
    const mode = request.mode ?? 'companion';
    const generation = resolveModeGenerationOptions(mode, this.temperature);
    return this.adapter.generate({
      messages: request.messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
      responseFormat: request.responseFormat,
      stream: request.stream === true,
      signal: request.signal,
      generation: {
        temperature: clamp(request.overrides?.temperature ?? generation.temperature, 0, 2),
        topP: clamp(request.overrides?.topP ?? generation.topP, 0.05, 1),
        maxTokens: clampInteger(request.overrides?.maxTokens ?? this.maxTokens, 128, 32768),
        contextWindow: clampInteger(request.overrides?.numCtx ?? this.numCtx, 1024, 131072),
      },
    }, request.onEvent);
  }

  async chat(
    messages: ChatMessage[],
    onStream?: (chunk: string) => void,
    mode: ConversationMode = 'companion',
    overrides?: ChatGenerationOverrides,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.generate({
      messages,
      mode,
      overrides,
      signal,
      stream: Boolean(onStream),
      onEvent: onStream
        ? event => { if (event.type === 'text_delta') onStream(event.delta); }
        : undefined,
    });
    return response.content;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ModelToolDefinition[],
    options: ToolChatOptions = {},
  ): Promise<ModelResponse> {
    return this.generate({
      messages,
      tools,
      toolChoice: options.toolChoice ?? 'auto',
      mode: options.mode ?? 'reason',
      stream: options.stream,
      signal: options.signal,
      overrides: options.overrides,
      onEvent: options.onEvent,
    });
  }

  async chatJson(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    mode: ConversationMode = 'reason',
    overrides?: ChatGenerationOverrides,
    signal?: AbortSignal,
  ): Promise<string> {
    const schemaInstruction: ChatMessage = {
      role: 'system',
      content: `Return one JSON object only. It must match this JSON Schema: ${JSON.stringify(schema)}`,
    };
    const responseFormat = this.capabilities.jsonSchemaOutput
      ? { type: 'json_schema' as const, name: 'athena_response', schema, strict: true }
      : { type: 'json_object' as const };
    const response = await this.generate({
      messages: [schemaInstruction, ...messages],
      responseFormat,
      mode,
      signal,
      overrides: { ...overrides, temperature: overrides?.temperature ?? 0.1, maxTokens: overrides?.maxTokens ?? 1536 },
    });
    return response.content;
  }
}

/**
 * Builds the cheap/fast client used by bounded helper calls. A blank setting is
 * deliberately the main client: no provider, credential, or privacy boundary is
 * changed implicitly. When configured, only the model id changes and the selected
 * provider's endpoint and credential remain exactly the same (ATH-PERF-001).
 */
export function createAssistModelClient(mainClient: LLMClient): LLMClient {
  const config = getModelSettings();
  const assistModel = config.assistModel.trim();
  if (!assistModel) return mainClient;
  if (config.provider === 'ollama') {
    return new LLMClient({
      ...config,
      ollama: { ...config.ollama, model: assistModel },
    });
  }
  const provider = config.provider;
  return new LLMClient({
    ...config,
    remote: {
      ...config.remote,
      [provider]: { ...config.remote[provider], model: assistModel },
    },
  });
}

function loadModelConfig(): ModelClientConfig {
  // Unpackaged Electron persists the user's provider in gitignored overlays.
  // Reading tracked config/model.json here would keep chat and connection tests
  // on the shipping Ollama default even after DeepSeek/OpenAI was saved.
  return getModelSettings();
}

function cloneCapabilities(capabilities: ModelAdapterCapabilities): ModelAdapterCapabilities {
  return {
    ...capabilities,
    imageInputFormats: [...capabilities.imageInputFormats],
    toolChoiceModes: [...capabilities.toolChoiceModes],
  };
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function clampInteger(value: number, min: number, max: number): number { return Math.round(clamp(value, min, max)); }
