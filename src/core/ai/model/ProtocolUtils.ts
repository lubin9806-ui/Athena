import { randomUUID } from 'crypto';
import type { ModelFinishReason, ModelToolCall, ModelToolDefinition, ModelUsage } from './ModelTypes';
import { ModelProtocolError } from './ModelTypes';

export const EMPTY_USAGE: ModelUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

export function normalizeToolCall(
  value: { id?: unknown; name?: unknown; arguments?: unknown },
  fallbackPrefix: string,
): ModelToolCall {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || !/^[A-Za-z0-9_-]{1,128}$/.test(name)) {
    throw new ModelProtocolError(`Model returned an invalid tool name: ${name || '<empty>'}`);
  }
  const rawArguments = typeof value.arguments === 'string'
    ? value.arguments
    : JSON.stringify(value.arguments ?? {});
  let parsed: unknown;
  try {
    parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch (error) {
    throw new ModelProtocolError(`Tool ${name} returned invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ModelProtocolError(`Tool ${name} arguments must be a JSON object`);
  }
  const suppliedId = typeof value.id === 'string' ? value.id.trim().slice(0, 240) : '';
  return {
    id: suppliedId || `${fallbackPrefix}-${randomUUID()}`,
    name,
    arguments: parsed as Record<string, unknown>,
    rawArguments,
  };
}

export function normalizeFinishReason(value: unknown, hasToolCalls: boolean): ModelFinishReason {
  if (hasToolCalls || value === 'tool_calls') return 'tool_calls';
  if (value === 'stop') return 'stop';
  if (value === 'length') return 'length';
  if (value === 'content_filter') return 'content_filter';
  if (value === 'error') return 'error';
  return 'unknown';
}

export function normalizeUsage(value: unknown): ModelUsage {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    inputTokens: numberOrNull(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: numberOrNull(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: numberOrNull(usage.total_tokens),
  };
}

export function assertToolCallsAllowed(calls: ModelToolCall[], tools: ModelToolDefinition[] | undefined): void {
  if (calls.length === 0) return;
  const allowed = new Set((tools || []).map(tool => tool.name.trim()));
  const ids = new Set<string>();
  for (const call of calls) {
    if (!allowed.has(call.name)) throw new ModelProtocolError(`Model called a tool that was not exposed: ${call.name}`);
    if (ids.has(call.id)) throw new ModelProtocolError(`Model returned a duplicate tool call id: ${call.id}`);
    ids.add(call.id);
  }
}

export async function ensureResponseOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 800); } catch {}
  throw new Error(`${label} request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
}

export function normalizeModelIds(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length > 0 && value.length <= 160)))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 500);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
