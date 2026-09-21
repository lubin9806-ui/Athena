import type { ModelAdapter } from './ModelAdapter';
import type {
  ModelAdapterCapabilities,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ModelToolDefinition,
} from './ModelTypes';
import { ModelCapabilityError, ModelProtocolError } from './ModelTypes';
import { RequestDeadline } from './RequestDeadline';
import { loadModelImageBase64 } from './ModelImageLoader';
import {
  EMPTY_USAGE,
  assertToolCallsAllowed,
  ensureResponseOk,
  normalizeFinishReason,
  normalizeModelIds,
  normalizeToolCall,
  parseToolCallsBeforeLimit,
} from './ProtocolUtils';

export interface OllamaAdapterConfig {
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
}

interface OllamaStreamToolAccumulator {
  id: string;
  name: string;
  argumentsText: string;
  argumentsObject: Record<string, unknown>;
}

export class OllamaAdapter implements ModelAdapter {
  readonly providerName = 'ollama';
  readonly modelName: string;
  readonly endpoint: string;
  readonly capabilities: ModelAdapterCapabilities = {
    imageInputs: false,
    imageInputFormats: ['image/png', 'image/jpeg', 'image/webp'],
    imageInputSource: 'probe',
    nativeToolCalls: true,
    parallelToolCalls: true,
    streamingToolCalls: true,
    strictToolSchemas: false,
    toolChoiceModes: ['auto', 'none'],
    jsonObjectOutput: true,
    jsonSchemaOutput: true,
    toolResultUsesCallId: false,
    toolResultUsesName: true,
  };
  private readonly requestTimeoutMs: number;

  constructor(config: OllamaAdapterConfig) {
    this.endpoint = config.baseUrl.replace(/\/$/, '');
    this.modelName = config.model.trim();
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  async listModels(): Promise<string[]> {
    const deadline = RequestDeadline.forMetadata(this.requestTimeoutMs);
    try {
      const response = await this.fetchWithFallback('/api/tags', {}, deadline);
      await ensureResponseOk(response, 'Ollama');
      const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      return normalizeModelIds(data.models?.map(item => item.name ?? item.model) ?? []);
    } finally {
      deadline.dispose();
    }
  }

  async refreshCapabilities(): Promise<ModelAdapterCapabilities> {
    this.capabilities.imageInputs = false;
    const deadline = RequestDeadline.forMetadata(this.requestTimeoutMs);
    try {
      const response = await this.fetchWithFallback('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelName, verbose: false }),
      }, deadline);
      await ensureResponseOk(response, 'Ollama');
      const data = await response.json() as { capabilities?: unknown };
      this.capabilities.imageInputs = Array.isArray(data.capabilities)
        && data.capabilities.some(capability => capability === 'vision');
    } catch {
      this.capabilities.imageInputs = false;
    } finally {
      deadline.dispose();
    }
    return cloneCapabilities(this.capabilities);
  }

  async checkConnection(): Promise<boolean> {
    try {
      const models = await this.listModels();
      return Boolean(this.modelName) && models.some(model => model === this.modelName || model === `${this.modelName}:latest`);
    } catch {
      return false;
    }
  }

  async generate(request: ModelRequest, onEvent?: (event: ModelStreamEvent) => void): Promise<ModelResponse> {
    if (!this.modelName) throw new Error('Ollama model is not configured.');
    validateRequest(request, this.capabilities);
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: request.messages.map(serializeMessage),
      stream: request.stream === true,
      options: {
        temperature: clamp(request.generation.temperature, 0, 2),
        top_p: clamp(request.generation.topP, 0.05, 1),
        num_predict: clampInteger(request.generation.maxTokens, 128, 8192),
        num_ctx: clampInteger(request.generation.contextWindow, 1024, 131072),
      },
    };
    if (request.tools?.length && request.toolChoice !== 'none') body.tools = request.tools.map(serializeTool);
    if (request.responseFormat?.type === 'json_object') body.format = 'json';
    if (request.responseFormat?.type === 'json_schema') body.format = request.responseFormat.schema;

    // One deadline spans the whole exchange, including the body read: a stream is
    // only cut off once the provider actually goes quiet, never for talking long.
    const deadline = new RequestDeadline(this.requestTimeoutMs, request.signal);
    try {
      const response = await this.fetchWithFallback('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, deadline);
      await ensureResponseOk(response, 'Ollama');
      const result = request.stream
        ? await this.readStream(response, onEvent, deadline)
        : await this.readResponse(response);
      assertToolCallsAllowed(result.toolCalls, request.tools);
      if (request.stream) onEvent?.({ type: 'completed', response: result });
      return result;
    } finally {
      deadline.dispose();
    }
  }

  private async readResponse(response: Response): Promise<ModelResponse> {
    const data = await response.json() as Record<string, any>;
    if (!data.message) throw new ModelProtocolError('Ollama response did not contain a message');
    const toolCalls = parseToolCallsBeforeLimit(data.done_reason, () => parseOllamaToolCalls(data.message.tool_calls, 'ollama-call'));
    return {
      provider: 'ollama',
      model: typeof data.model === 'string' ? data.model : this.modelName,
      responseId: null,
      content: typeof data.message.content === 'string' ? data.message.content : '',
      toolCalls,
      finishReason: normalizeFinishReason(data.done_reason, toolCalls.length > 0),
      usage: {
        inputTokens: finiteNumber(data.prompt_eval_count),
        outputTokens: finiteNumber(data.eval_count),
        totalTokens: sumNullable(data.prompt_eval_count, data.eval_count),
      },
    };
  }

  private async readStream(
    response: Response,
    onEvent?: (event: ModelStreamEvent) => void,
    deadline?: RequestDeadline,
  ): Promise<ModelResponse> {
    if (!response.body) throw new ModelProtocolError('Ollama returned a streaming response without a body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCallsByIndex = new Map<number, OllamaStreamToolAccumulator>();
    let buffer = '';
    let content = '';
    let responseModel = this.modelName;
    let finishReason: unknown;
    let usage = EMPTY_USAGE;

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let data: Record<string, any>;
      try { data = JSON.parse(trimmed); }
      catch (error) { throw new ModelProtocolError(`Invalid Ollama stream JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (typeof data.model === 'string') responseModel = data.model;
      if (data.done_reason) finishReason = data.done_reason;
      if (data.done) {
        usage = {
          inputTokens: finiteNumber(data.prompt_eval_count),
          outputTokens: finiteNumber(data.eval_count),
          totalTokens: sumNullable(data.prompt_eval_count, data.eval_count),
        };
      }
      const delta = typeof data.message?.content === 'string' ? data.message.content : '';
      if (delta) {
        content += delta;
        onEvent?.({ type: 'text_delta', delta });
      }
      const calls = Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : [];
      calls.forEach((call: any, fallbackIndex: number) => {
        const index = Number.isInteger(call?.function?.index) && call.function.index >= 0
          ? call.function.index
          : fallbackIndex;
        const current = toolCallsByIndex.get(index) || { id: '', name: '', argumentsText: '', argumentsObject: {} };
        const id = typeof call?.id === 'string' ? call.id : '';
        const nameDelta = typeof call?.function?.name === 'string' ? call.function.name : '';
        const argumentValue = call?.function?.arguments;
        const argumentsDelta = typeof argumentValue === 'string'
          ? argumentValue
          : argumentValue && typeof argumentValue === 'object' && !Array.isArray(argumentValue)
            ? JSON.stringify(argumentValue)
            : '';
        if (id) current.id = id;
        current.name = accumulateString(current.name, nameDelta);
        if (typeof argumentValue === 'string') current.argumentsText += argumentValue;
        else if (argumentValue && typeof argumentValue === 'object' && !Array.isArray(argumentValue)) {
          Object.assign(current.argumentsObject, argumentValue as Record<string, unknown>);
        }
        toolCallsByIndex.set(index, current);
        onEvent?.({
          type: 'tool_call_delta',
          index,
          ...(id ? { id } : {}),
          ...(nameDelta ? { nameDelta } : {}),
          ...(argumentsDelta ? { argumentsDelta } : {}),
        });
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      deadline?.touch();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
    const toolCalls = parseToolCallsBeforeLimit(finishReason, () => Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => normalizeToolCall({
        id: call.id,
        name: call.name,
        arguments: call.argumentsText || call.argumentsObject,
      }, `ollama-stream-${index}`)));
    const result: ModelResponse = {
      provider: 'ollama',
      model: responseModel,
      responseId: null,
      content,
      toolCalls,
      finishReason: normalizeFinishReason(finishReason, toolCalls.length > 0),
      usage,
    };
    return result;
  }

  /** Callers own the deadline so that it also covers reading the response body. */
  private async fetchWithFallback(
    pathname: string,
    init: RequestInit,
    deadline: RequestDeadline,
  ): Promise<Response> {
    let lastError: unknown;
    for (const endpoint of this.candidateEndpoints()) {
      try {
        return await fetch(`${endpoint}${pathname}`, { ...init, signal: deadline.signal });
      } catch (error) {
        // A spent deadline means we stopped waiting, not that this host was
        // wrong. Trying the next spelling of localhost would only replace the
        // real reason with a connection error against an aborted signal.
        if (deadline.signal.aborted) throw error;
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw new Error(`${lastError.message} (${this.candidateEndpoints().join(', ')})`);
    throw new Error(`Ollama connection failed at ${this.endpoint}`);
  }

  private candidateEndpoints(): string[] {
    const endpoints = [this.endpoint];
    if (this.endpoint.includes('localhost')) endpoints.push(this.endpoint.replace('localhost', '127.0.0.1'));
    else if (this.endpoint.includes('127.0.0.1')) endpoints.push(this.endpoint.replace('127.0.0.1', 'localhost'));
    return Array.from(new Set(endpoints));
  }
}

function serializeMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call, index) => ({
        type: 'function',
        function: { index, name: call.name, arguments: call.arguments },
      })),
    };
  }
  if (message.role === 'tool') {
    if (!message.toolName) throw new ModelProtocolError('Ollama tool result requires toolName');
    return { role: 'tool', content: message.content, tool_name: message.toolName };
  }
  return {
    role: message.role,
    content: message.content,
    ...(message.images?.length ? { images: message.images.map(loadModelImageBase64) } : {}),
  };
}

function serializeTool(tool: ModelToolDefinition): Record<string, unknown> {
  const name = tool.name.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new ModelProtocolError(`Invalid tool definition name: ${name || '<empty>'}`);
  return {
    type: 'function',
    function: {
      name,
      description: tool.description.trim().slice(0, 2_000),
      parameters: tool.parameters,
    },
  };
}

function validateRequest(request: ModelRequest, capabilities: ModelAdapterCapabilities): void {
  validateToolDefinitions(request.tools);
  validateImageInputs(request.messages, capabilities);
  const choice = request.toolChoice ?? 'auto';
  const mode = typeof choice === 'string' ? choice : 'specific';
  if (!capabilities.toolChoiceModes.includes(mode)) {
    throw new ModelCapabilityError(`Ollama does not support tool choice mode: ${mode}`);
  }
  if (!request.tools?.length && choice === 'required') {
    throw new ModelCapabilityError('Required tool choice needs at least one tool definition');
  }
}

function validateImageInputs(messages: ModelMessage[], capabilities: ModelAdapterCapabilities): void {
  const withImages = messages.filter(message => (message.images?.length ?? 0) > 0);
  if (withImages.length === 0) return;
  if (!capabilities.imageInputs) throw new ModelCapabilityError('The selected Ollama model does not report the vision capability');
  for (const message of withImages) {
    if (message.role !== 'user') throw new ModelCapabilityError('Ollama image inputs are only supported on user messages');
    if ((message.images?.length ?? 0) > 5) throw new ModelCapabilityError('A model message cannot contain more than 5 images');
    for (const image of message.images || []) {
      if (!capabilities.imageInputFormats.includes(image.mimeType)) {
        throw new ModelCapabilityError(`Ollama image format is not supported: ${image.mimeType}`);
      }
    }
  }
}

function cloneCapabilities(capabilities: ModelAdapterCapabilities): ModelAdapterCapabilities {
  return {
    ...capabilities,
    imageInputFormats: [...capabilities.imageInputFormats],
    toolChoiceModes: [...capabilities.toolChoiceModes],
  };
}

function validateToolDefinitions(tools: ModelToolDefinition[] | undefined): void {
  if (!tools) return;
  if (tools.length > 128) throw new ModelCapabilityError('An Ollama request cannot expose more than 128 tools');
  const names = new Set<string>();
  for (const tool of tools) {
    const name = tool.name.trim();
    if (names.has(name)) throw new ModelProtocolError(`Duplicate tool definition: ${name}`);
    names.add(name);
  }
}

function parseOllamaToolCalls(value: unknown, fallbackPrefix: string): ModelToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ModelProtocolError('Ollama tool_calls must be an array');
  return value.slice(0, 128).map((call, index) => normalizeToolCall({
    id: call?.id,
    name: call?.function?.name,
    arguments: call?.function?.arguments,
  }, `${fallbackPrefix}-${index}`));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function sumNullable(left: unknown, right: unknown): number | null {
  const normalizedLeft = finiteNumber(left);
  const normalizedRight = finiteNumber(right);
  return normalizedLeft === null && normalizedRight === null ? null : (normalizedLeft || 0) + (normalizedRight || 0);
}

function accumulateString(current: string, next: string): string {
  if (!next || next === current) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  return current.endsWith(next) ? current : `${current}${next}`;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function clampInteger(value: number, min: number, max: number): number { return Math.round(clamp(value, min, max)); }
