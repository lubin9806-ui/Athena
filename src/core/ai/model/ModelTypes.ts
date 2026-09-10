import type { ConversationMode, ModelProvider } from '../../../shared/types';

export type JsonSchema = Record<string, unknown>;
export type ModelMessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type ModelToolChoice = 'auto' | 'none' | 'required' | { name: string };
export type ModelFinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | 'unknown';
export type ModelImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ModelImageInput {
  id: string;
  name?: string;
  mimeType: ModelImageMimeType;
  filePath: string;
  sha256: string;
  bytes: number;
  detail?: 'auto' | 'low' | 'high';
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  strict?: boolean;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
}

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
  images?: ModelImageInput[];
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ModelGenerationOptions {
  temperature: number;
  topP: number;
  maxTokens: number;
  contextWindow: number;
}

export type ModelResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: JsonSchema; strict: boolean };

export interface ModelRequest {
  messages: ModelMessage[];
  generation: ModelGenerationOptions;
  tools?: ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
  responseFormat?: ModelResponseFormat;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface ModelResponse {
  provider: ModelProvider;
  model: string;
  responseId: string | null;
  content: string;
  toolCalls: ModelToolCall[];
  finishReason: ModelFinishReason;
  usage: ModelUsage;
}

export type ModelStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_delta'; index: number; id?: string; nameDelta?: string; argumentsDelta?: string }
  | { type: 'completed'; response: ModelResponse };

export interface ModelAdapterCapabilities {
  imageInputs: boolean;
  imageInputFormats: ModelImageMimeType[];
  imageInputSource: 'static' | 'probe' | 'unsupported';
  nativeToolCalls: boolean;
  parallelToolCalls: boolean;
  streamingToolCalls: boolean;
  strictToolSchemas: boolean;
  toolChoiceModes: Array<'auto' | 'none' | 'required' | 'specific'>;
  jsonObjectOutput: boolean;
  jsonSchemaOutput: boolean;
  toolResultUsesCallId: boolean;
  toolResultUsesName: boolean;
}

export interface ModelGenerationRequest {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
  responseFormat?: ModelResponseFormat;
  mode?: ConversationMode;
  stream?: boolean;
  signal?: AbortSignal;
  overrides?: {
    numCtx?: number;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  onEvent?: (event: ModelStreamEvent) => void;
}

export class ModelProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelProtocolError';
  }
}

export class ModelCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

/**
 * The provider went silent for longer than the budget allows.
 *
 * This carries its own type because the platform's own timeout says "The
 * operation was aborted due to timeout", and anything matching on the word
 * "aborted" reads that as the user having pressed stop.
 */
export class ModelTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelTimeoutError';
  }
}
