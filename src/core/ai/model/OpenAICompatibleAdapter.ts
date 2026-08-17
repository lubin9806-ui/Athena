import type { ModelProvider, RemoteModelProvider } from '../../../shared/types';
import type { ModelAdapter } from './ModelAdapter';
import type {
  ModelAdapterCapabilities,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ModelToolChoice,
  ModelToolDefinition,
} from './ModelTypes';
import { ModelCapabilityError, ModelProtocolError } from './ModelTypes';
import { loadModelImageBase64 } from './ModelImageLoader';
import {
  EMPTY_USAGE,
  assertToolCallsAllowed,
  ensureResponseOk,
  normalizeFinishReason,
  normalizeModelIds,
  normalizeToolCall,
  normalizeUsage,
} from './ProtocolUtils';

export interface OpenAICompatibleAdapterConfig {
  provider: RemoteModelProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  requestTimeoutMs: number;
}

interface StreamToolAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly providerName: ModelProvider;
  readonly modelName: string;
  readonly endpoint: string;
  readonly capabilities: ModelAdapterCapabilities;
  private readonly apiKey: string | null;
  private readonly requestTimeoutMs: number;

  constructor(config: OpenAICompatibleAdapterConfig) {
    this.providerName = config.provider;
    this.modelName = config.model.trim();
    this.endpoint = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.capabilities = capabilitiesFor(config.provider, this.endpoint, this.modelName);
  }

  async listModels(): Promise<string[]> {
    this.assertConfigured(false);
    const response = await this.fetch('/models');
    await ensureResponseOk(response, providerLabel(this.providerName));
    const data = await response.json() as { data?: Array<{ id?: string }> };
    return normalizeModelIds(data.data?.map(item => item.id) ?? []);
  }

  async checkConnection(): Promise<boolean> {
    try {
      if (!this.endpoint || !this.modelName) return false;
      const response = await this.fetch('/models');
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(request: ModelRequest, onEvent?: (event: ModelStreamEvent) => void): Promise<ModelResponse> {
    this.assertConfigured(true);
    validateToolRequest(request, this.capabilities);
    const body = this.buildBody(request);
    const response = await this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: request.signal,
    });
    await ensureResponseOk(response, providerLabel(this.providerName));
    const result = request.stream
      ? this.readStream(response, onEvent)
      : this.readResponse(response);
    const normalized = await result;
    assertToolCallsAllowed(normalized.toolCalls, request.tools);
    if (request.stream) onEvent?.({ type: 'completed', response: normalized });
    return normalized;
  }

  private buildBody(request: ModelRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: request.messages.map(message => serializeMessage(message)),
      stream: request.stream === true,
      temperature: clamp(request.generation.temperature, 0, 2),
      top_p: clamp(request.generation.topP, 0.05, 1),
      ...(this.providerName === 'openai'
        ? { max_completion_tokens: clampInteger(request.generation.maxTokens, 128, 32768) }
        : { max_tokens: clampInteger(request.generation.maxTokens, 128, 32768) }),
    };
    if (this.providerName === 'openai' && /^gpt-5\.6(?:-|$)/i.test(this.modelName)) body.reasoning_effort = 'none';
    if (request.tools?.length) {
      body.tools = request.tools.map(tool => serializeTool(tool, this.capabilities.strictToolSchemas));
      body.tool_choice = serializeToolChoice(request.toolChoice ?? 'auto');
    }
    if (request.responseFormat && request.responseFormat.type !== 'text') {
      if (request.responseFormat.type === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name,
            strict: request.responseFormat.strict,
            schema: request.responseFormat.schema,
          },
        };
      }
    }
    return body;
  }

  private async readResponse(response: Response): Promise<ModelResponse> {
    const data = await response.json() as Record<string, any>;
    const choice = data.choices?.[0];
    if (!choice?.message) throw new ModelProtocolError('Provider response did not contain choices[0].message');
    const toolCalls = parseOpenAIToolCalls(choice.message.tool_calls, `${this.providerName}-call`);
    return {
      provider: this.providerName,
      model: typeof data.model === 'string' ? data.model : this.modelName,
      responseId: typeof data.id === 'string' ? data.id : null,
      content: typeof choice.message.content === 'string' ? choice.message.content : '',
      toolCalls,
      finishReason: normalizeFinishReason(choice.finish_reason, toolCalls.length > 0),
      usage: normalizeUsage(data.usage),
    };
  }

  private async readStream(response: Response, onEvent?: (event: ModelStreamEvent) => void): Promise<ModelResponse> {
    if (!response.body) throw new ModelProtocolError('Provider returned a streaming response without a body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolDeltas = new Map<number, StreamToolAccumulator>();
    let buffer = '';
    let content = '';
    let finishReason: unknown;
    let responseId: string | null = null;
    let responseModel = this.modelName;
    let usage = EMPTY_USAGE;

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) return;
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let data: Record<string, any>;
      try { data = JSON.parse(payload); }
      catch (error) { throw new ModelProtocolError(`Invalid provider SSE JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (typeof data.id === 'string') responseId = data.id;
      if (typeof data.model === 'string') responseModel = data.model;
      if (data.usage) usage = normalizeUsage(data.usage);
      const choice = data.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
      const textDelta = typeof choice.delta?.content === 'string' ? choice.delta.content : '';
      if (textDelta) {
        content += textDelta;
        onEvent?.({ type: 'text_delta', delta: textDelta });
      }
      const calls = Array.isArray(choice.delta?.tool_calls) ? choice.delta.tool_calls : [];
      for (const call of calls) {
        const index = Number.isInteger(call.index) && call.index >= 0 ? call.index : 0;
        const current = toolDeltas.get(index) || { id: '', name: '', arguments: '' };
        const id = typeof call.id === 'string' ? call.id : '';
        const nameDelta = typeof call.function?.name === 'string' ? call.function.name : '';
        const argumentsDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
        if (id) current.id = id;
        current.name += nameDelta;
        current.arguments += argumentsDelta;
        toolDeltas.set(index, current);
        onEvent?.({
          type: 'tool_call_delta',
          index,
          ...(id ? { id } : {}),
          ...(nameDelta ? { nameDelta } : {}),
          ...(argumentsDelta ? { argumentsDelta } : {}),
        });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);

    const toolCalls = Array.from(toolDeltas.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, value]) => normalizeToolCall({
        id: value.id,
        name: value.name,
        arguments: value.arguments,
      }, `${this.providerName}-stream-${index}`));
    const result: ModelResponse = {
      provider: this.providerName,
      model: responseModel,
      responseId,
      content,
      toolCalls,
      finishReason: normalizeFinishReason(finishReason, toolCalls.length > 0),
      usage,
    };
    return result;
  }

  private async fetch(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    if (!this.apiKey && this.providerName !== 'custom') {
      throw new Error(`${providerLabel(this.providerName)} API Key is not configured.`);
    }
    return fetch(`${this.endpoint}${pathname}`, {
      ...init,
      headers,
      signal: boundedSignal(init.signal, this.requestTimeoutMs),
    });
  }

  private assertConfigured(requireModel: boolean): void {
    if (!this.endpoint || (requireModel && !this.modelName)) {
      throw new Error(`${providerLabel(this.providerName)} endpoint or model is not configured.`);
    }
  }
}

function serializeMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.rawArguments || JSON.stringify(call.arguments) },
      })),
    };
  }
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new ModelProtocolError('OpenAI-compatible tool result requires toolCallId');
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.images?.length) {
    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        ...message.images.map(image => ({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${loadModelImageBase64(image)}`,
            detail: image.detail || 'auto',
          },
        })),
      ],
    };
  }
  return { role: message.role, content: message.content };
}

function serializeTool(tool: ModelToolDefinition, supportsStrict: boolean): Record<string, unknown> {
  const name = tool.name.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new ModelProtocolError(`Invalid tool definition name: ${name || '<empty>'}`);
  return {
    type: 'function',
    function: {
      name,
      description: tool.description.trim().slice(0, 2_000),
      parameters: tool.parameters,
      ...(supportsStrict && tool.strict === true ? { strict: true } : {}),
    },
  };
}

function serializeToolChoice(choice: ModelToolChoice): unknown {
  if (typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

function validateToolRequest(request: ModelRequest, capabilities: ModelAdapterCapabilities): void {
  validateToolDefinitions(request.tools);
  validateImageInputs(request.messages, capabilities);
  if (!request.tools?.length) {
    if (request.toolChoice && request.toolChoice !== 'none' && request.toolChoice !== 'auto') {
      throw new ModelCapabilityError('A required or specific tool choice needs at least one tool definition');
    }
  } else if (!capabilities.nativeToolCalls) {
    throw new ModelCapabilityError('The selected provider does not support native tool calls');
  }
  const choice = request.toolChoice ?? 'auto';
  const mode = typeof choice === 'string' ? choice : 'specific';
  if (!capabilities.toolChoiceModes.includes(mode)) {
    throw new ModelCapabilityError(`The selected provider does not support tool choice mode: ${mode}`);
  }
  if (typeof choice === 'object' && !request.tools?.some(tool => tool.name === choice.name)) {
    throw new ModelCapabilityError(`Specific tool choice is not present in the tool definitions: ${choice.name}`);
  }
  if (request.responseFormat?.type === 'json_object' && !capabilities.jsonObjectOutput) {
    throw new ModelCapabilityError('The selected provider does not support JSON object output');
  }
  if (request.responseFormat?.type === 'json_schema' && !capabilities.jsonSchemaOutput) {
    throw new ModelCapabilityError('The selected provider does not support JSON schema output');
  }
}

function validateImageInputs(messages: ModelMessage[], capabilities: ModelAdapterCapabilities): void {
  const withImages = messages.filter(message => (message.images?.length ?? 0) > 0);
  if (withImages.length === 0) return;
  if (!capabilities.imageInputs) throw new ModelCapabilityError('The selected provider/model has no verified image-input capability');
  for (const message of withImages) {
    if (message.role !== 'user') throw new ModelCapabilityError('Image inputs are only supported on user messages');
    if ((message.images?.length ?? 0) > 5) throw new ModelCapabilityError('A model message cannot contain more than 5 images');
    for (const image of message.images || []) {
      if (!capabilities.imageInputFormats.includes(image.mimeType)) {
        throw new ModelCapabilityError(`Image format is not supported: ${image.mimeType}`);
      }
    }
  }
}

function validateToolDefinitions(tools: ModelToolDefinition[] | undefined): void {
  if (!tools) return;
  if (tools.length > 128) throw new ModelCapabilityError('A model request cannot expose more than 128 tools');
  const names = new Set<string>();
  for (const tool of tools) {
    const name = tool.name.trim();
    if (names.has(name)) throw new ModelProtocolError(`Duplicate tool definition: ${name}`);
    names.add(name);
  }
}

function parseOpenAIToolCalls(value: unknown, fallbackPrefix: string): ModelToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ModelProtocolError('Provider tool_calls must be an array');
  return value.slice(0, 128).map((call, index) => normalizeToolCall({
    id: call?.id,
    name: call?.function?.name,
    arguments: call?.function?.arguments,
  }, `${fallbackPrefix}-${index}`));
}

function capabilitiesFor(provider: RemoteModelProvider, endpoint: string, model: string): ModelAdapterCapabilities {
  const isOpenAI = provider === 'openai';
  let isDeepSeekStrict = false;
  try { isDeepSeekStrict = provider === 'deepseek' && /\/beta(?:\/|$)/i.test(new URL(endpoint).pathname); }
  catch { isDeepSeekStrict = false; }
  const knownTools = provider !== 'custom';
  return {
    imageInputs: isOpenAI && supportsOpenAIImageInput(model),
    imageInputFormats: ['image/png', 'image/jpeg', 'image/webp'],
    imageInputSource: isOpenAI ? 'static' : 'unsupported',
    nativeToolCalls: true,
    parallelToolCalls: knownTools,
    streamingToolCalls: true,
    strictToolSchemas: isOpenAI || isDeepSeekStrict,
    toolChoiceModes: provider === 'custom' ? ['auto', 'none'] : ['auto', 'none', 'required', 'specific'],
    jsonObjectOutput: true,
    jsonSchemaOutput: isOpenAI && supportsOpenAIJsonSchema(model),
    toolResultUsesCallId: true,
    toolResultUsesName: false,
  };
}

function supportsOpenAIImageInput(model: string): boolean {
  return /^(?:gpt-4o|gpt-4\.1|gpt-5|chatgpt|chat-latest)(?:[-.]|$)/i.test(model);
}

function supportsOpenAIJsonSchema(model: string): boolean {
  return /^(?:gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4)(?:-|$)/i.test(model);
}

function boundedSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function providerLabel(provider: ModelProvider): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'athena-cloud') return 'Athena Cloud';
  if (provider === 'custom') return 'Custom Provider';
  return 'Ollama';
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function clampInteger(value: number, min: number, max: number): number { return Math.round(clamp(value, min, max)); }
