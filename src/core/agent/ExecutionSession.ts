import type { ModelMessage, ModelToolCall } from '../ai/model';

/**
 * One chat window is one execute session.
 *
 * Each message used to start a new task whose context was the last 24 chat
 * messages of the window - final texts only. When Athena stopped to ask for an
 * API key, the reply that carried the key reached a model that had never seen
 * its own tool calls, the 401 it got back, or the question it had asked, so it
 * treated the key as a brand-new request (2026-09-15, windows 19/30/31).
 *
 * A new turn now starts from the previous run's own transcript: tool calls,
 * their results, and what was said around them. This module keeps that
 * transcript valid for the providers and bounded in size.
 */

export interface CarriedTranscript {
  messages: ModelMessage[];
  /** Whole user turns left out, oldest first, to stay inside the budget. */
  droppedTurns: number;
}

export interface CarryTranscriptOptions {
  maxChars?: number;
  maxMessages?: number;
  /** The most recent turns keep their tool output and arguments nearly whole. */
  recentTurns?: number;
}

interface TurnLimits {
  userChars: number;
  assistantChars: number;
  argumentChars: number;
  toolOutputChars: number;
}

const DEFAULT_MAX_CHARS = 60_000;
const DEFAULT_MAX_MESSAGES = 96;
const DEFAULT_RECENT_TURNS = 2;
const RECENT_LIMITS: TurnLimits = { userChars: 20_000, assistantChars: 12_000, argumentChars: 8_000, toolOutputChars: 6_000 };
const OLDER_LIMITS: TurnLimits = { userChars: 4_000, assistantChars: 2_000, argumentChars: 400, toolOutputChars: 600 };
const TIGHT_LIMITS: TurnLimits = { userChars: 2_000, assistantChars: 1_000, argumentChars: 200, toolOutputChars: 300 };

/** What the model is told about a call that never produced a result of its own. */
export const UNANSWERED_TOOL_RESULT = JSON.stringify({
  status: 'cancelled',
  summary: '这一步没有执行：任务在它执行之前就停下了',
  output: '',
});

const LEGACY_MODE_LABEL = /^\[(?:创作|推理|执行|陪伴)模式 · 消息 #\d+\]\n/;
const LEGACY_GOAL_PREFIX = /^Execute this confirmed goal now: /;

export function carryTranscript(messages: ModelMessage[], options: CarryTranscriptOptions = {}): CarriedTranscript {
  const maxChars = positive(options.maxChars, DEFAULT_MAX_CHARS);
  const maxMessages = positive(options.maxMessages, DEFAULT_MAX_MESSAGES);
  const recentTurns = positive(options.recentTurns, DEFAULT_RECENT_TURNS);
  const conversational = dedupeAdjacentUserMessages(
    messages.filter(message => message.role !== 'system').map(normalizeLegacyMessage).map(withoutImages),
  );
  const turns = splitTurns(pairToolResults(conversational));
  let compacted = turns.map((turn, index) => compactTurn(turn, index >= turns.length - recentTurns ? RECENT_LIMITS : OLDER_LIMITS));
  let droppedTurns = 0;
  while (compacted.length > 1 && exceeds(compacted, maxChars, maxMessages)) {
    compacted = compacted.slice(1);
    droppedTurns += 1;
  }
  if (exceeds(compacted, maxChars, maxMessages)) {
    compacted = compacted.map(turn => compactTurn(turn, TIGHT_LIMITS));
  }
  let flat = compacted.flat();
  if (flat.length > maxMessages) flat = pairToolResults(dropLeadingToFit(flat, maxMessages - 1));
  if (charsOf(flat) > maxChars) {
    const perMessage = Math.max(200, Math.floor(maxChars / Math.max(1, flat.length)));
    flat = flat.map(message => shrinkMessage(message, {
      userChars: perMessage,
      assistantChars: perMessage,
      argumentChars: Math.min(perMessage, TIGHT_LIMITS.argumentChars),
      toolOutputChars: perMessage,
    }));
  }
  // A transcript that has lost its opening turn still starts with the person speaking.
  if (flat.length > 0 && flat[0].role !== 'user') {
    flat = [{ role: 'user', content: '（更早的对话已省略）' }, ...flat];
  }
  return { messages: flat, droppedTurns };
}

/**
 * Every tool call gets exactly one result directly after it, and no result is
 * left without its call. A run that was stopped mid-batch leaves calls with no
 * result, which providers reject as an invalid transcript.
 */
export function pairToolResults(messages: ModelMessage[]): ModelMessage[] {
  const output: ModelMessage[] = [];
  let pending: ModelToolCall[] = [];
  const flush = () => {
    for (const call of pending) {
      output.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: UNANSWERED_TOOL_RESULT });
    }
    pending = [];
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      const index = pending.findIndex(call => call.id === message.toolCallId);
      if (index < 0) continue;
      // Results keep the order of the calls they answer.
      for (const skipped of pending.slice(0, index)) {
        output.push({ role: 'tool', toolCallId: skipped.id, toolName: skipped.name, content: UNANSWERED_TOOL_RESULT });
      }
      output.push(message);
      pending = pending.slice(index + 1);
      continue;
    }
    flush();
    output.push(message);
    if (message.role === 'assistant' && message.toolCalls?.length) pending = [...message.toolCalls];
  }
  flush();
  return output;
}

function splitTurns(messages: ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(message);
  }
  return turns;
}

function compactTurn(turn: ModelMessage[], limits: TurnLimits): ModelMessage[] {
  return turn.map(message => shrinkMessage(message, limits));
}

function shrinkMessage(message: ModelMessage, limits: TurnLimits): ModelMessage {
  if (message.role === 'user') return { ...message, content: clip(message.content, limits.userChars) };
  if (message.role === 'tool') return { ...message, content: shrinkToolResult(message.content, limits.toolOutputChars) };
  if (message.role !== 'assistant') return message;
  const shrunk: ModelMessage = { ...message, content: clip(message.content, limits.assistantChars) };
  if (message.toolCalls?.length) {
    shrunk.toolCalls = message.toolCalls.map(call => {
      const args = shrinkArguments(call.arguments, limits.argumentChars) as Record<string, unknown>;
      return { ...call, arguments: args, rawArguments: JSON.stringify(args) };
    });
  }
  return shrunk;
}

function shrinkToolResult(content: string, maxChars: number): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const next: Record<string, unknown> = { ...record };
      if (typeof record.output === 'string') next.output = clip(record.output, maxChars);
      if (typeof record.summary === 'string') next.summary = clip(record.summary, 600);
      const serialized = JSON.stringify(next);
      if (serialized.length <= maxChars + 1_200) return serialized;
      return JSON.stringify({ status: record.status, summary: next.summary, output: clip(String(next.output ?? ''), Math.floor(maxChars / 2)) });
    }
  } catch {
    // A plain-text result is clipped as text.
  }
  return clip(content, maxChars);
}

function shrinkArguments(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') return clip(value, maxChars);
  if (Array.isArray(value)) return value.map(item => shrinkArguments(item, maxChars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shrinkArguments(item, maxChars)]));
  }
  return value;
}

function normalizeLegacyMessage(message: ModelMessage): ModelMessage {
  if (message.role !== 'user' && message.role !== 'assistant') return message;
  const content = message.content.replace(LEGACY_MODE_LABEL, '').replace(LEGACY_GOAL_PREFIX, '');
  return content === message.content ? message : { ...message, content };
}

/**
 * Images are referenced by file path and may have been cleaned up since; the
 * words around them carry what the model needs from an earlier turn.
 */
function withoutImages(message: ModelMessage): ModelMessage {
  if (!message.images?.length) return message;
  const names = message.images.map(image => image.name || image.id).join('、');
  const { images: _images, ...rest } = message;
  return { ...rest, content: `${message.content}\n（这条消息当时附带了图片：${names}）` };
}

function dedupeAdjacentUserMessages(messages: ModelMessage[]): ModelMessage[] {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    const previous = output[output.length - 1];
    if (message.role === 'user' && previous?.role === 'user' && previous.content.trim() === message.content.trim()) continue;
    output.push(message);
  }
  return output;
}

function dropLeadingToFit(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  let start = Math.max(0, messages.length - maxMessages);
  // Never start on a tool result: its call would be gone.
  while (start < messages.length && messages[start].role === 'tool') start += 1;
  return messages.slice(start);
}

function exceeds(turns: ModelMessage[][], maxChars: number, maxMessages: number): boolean {
  const flat = turns.flat();
  return flat.length > maxMessages || charsOf(flat) > maxChars;
}

function charsOf(messages: ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += message.content.length;
    for (const call of message.toolCalls || []) total += call.rawArguments.length;
  }
  return total;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…（后面还有 ${value.length - maxChars} 字，已省略）`;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
