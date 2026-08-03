import type { ChatMessage } from './Client';
import type { ConversationMode, Message, RetrievedContext } from '../../shared/types';

export type ContextSnapshotItemKind =
  | 'system'
  | 'current_input'
  | 'recent_message'
  | 'pinned_fact'
  | 'working_state'
  | 'window_summary'
  | 'project_memory'
  | 'global_memory'
  | 'old_history'
  | 'web_context';

export interface ContextSnapshotItem {
  kind: ContextSnapshotItemKind;
  id?: string;
  label: string;
  priority: number;
  chars: number;
  estimatedTokens: number;
  included: boolean;
  reason: string;
  preview: string;
  truncated?: boolean;
  originalChars?: number;
}

export interface ContextSnapshotBudget {
  maxPromptTokens: number;
  mandatoryTokens: number;
  optionalBudgetTokens: number;
  estimatedPromptTokens: number;
  promptChars: number;
  promptMessageCount: number;
}

export interface ContextSnapshotPayload {
  mode: ConversationMode;
  createdAt: string;
  budget: ContextSnapshotBudget;
  included: ContextSnapshotItem[];
  omitted: ContextSnapshotItem[];
}

export interface ManagedContextInput {
  userMessage: string;
  recentMessages: Message[];
  retrievedContext: RetrievedContext;
  mode: ConversationMode;
  systemContext: string;
  webSearchContext?: string;
  maxPromptTokens?: number;
}

export interface ManagedContextResult {
  messages: ChatMessage[];
  snapshot: ContextSnapshotPayload;
}

interface ContextCandidate {
  kind: ContextSnapshotItemKind;
  id?: string;
  label: string;
  priority: number;
  content: string;
  placement: 'system' | 'history';
  role?: 'user' | 'assistant' | 'system';
  order: number;
  minTokens?: number;
}

interface SelectedCandidate extends ContextCandidate {
  content: string;
  truncated: boolean;
  originalChars: number;
}

const DEFAULT_MAX_PROMPT_TOKENS = 4096;
const RECENT_ORIGINAL_MESSAGE_COUNT = 8;
const MIN_CONTEXT_ITEM_TOKENS = 48;

export function buildManagedContext(input: ManagedContextInput): ManagedContextResult {
  const maxPromptTokens = Math.max(1024, Math.round(input.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS));
  const candidates = buildCandidates(input);
  const mandatoryTokens = estimateTokens(input.systemContext) + estimateTokens(input.userMessage);
  const selected: SelectedCandidate[] = [];
  const included: ContextSnapshotItem[] = [
    snapshotItem('system', 'system/persona', 100, input.systemContext, true, 'required'),
    snapshotItem('current_input', 'current user input', 95, input.userMessage, true, 'required'),
  ];
  const omitted: ContextSnapshotItem[] = [];
  let usedTokens = mandatoryTokens;

  for (const candidate of candidates.sort(compareCandidatePriority)) {
    const normalized = normalizeContextText(candidate.content);
    if (!normalized) continue;

    const candidateTokens = estimateTokens(normalized);
    const remainingTokens = maxPromptTokens - usedTokens;
    if (remainingTokens >= candidateTokens) {
      selected.push({ ...candidate, content: normalized, truncated: false, originalChars: normalized.length });
      usedTokens += candidateTokens;
      included.push(snapshotItem(candidate.kind, candidate.label, candidate.priority, normalized, true, 'included', candidate.id));
      continue;
    }

    const minTokens = candidate.minTokens ?? MIN_CONTEXT_ITEM_TOKENS;
    if (remainingTokens >= minTokens) {
      const trimmed = trimToTokenBudget(normalized, remainingTokens);
      selected.push({ ...candidate, content: trimmed, truncated: true, originalChars: normalized.length });
      usedTokens += estimateTokens(trimmed);
      included.push({
        ...snapshotItem(candidate.kind, candidate.label, candidate.priority, trimmed, true, 'trimmed to fit remaining budget', candidate.id),
        truncated: true,
        originalChars: normalized.length,
      });
      continue;
    }

    omitted.push(snapshotItem(candidate.kind, candidate.label, candidate.priority, normalized, false, 'lower priority than retained context or no budget remained', candidate.id));
  }

  const systemSections = [
    input.systemContext,
    ...selected
      .filter(item => item.placement === 'system')
      .sort((left, right) => left.order - right.order)
      .map(item => item.content),
  ];
  const messages: ChatMessage[] = [{ role: 'system', content: systemSections.filter(Boolean).join('\n\n') }];
  for (const item of selected.filter(item => item.placement === 'history').sort((left, right) => left.order - right.order)) {
    messages.push({ role: item.role || 'user', content: item.content });
  }
  messages.push({ role: 'user', content: input.userMessage });

  const promptText = messages.map(message => message.content).join('\n');
  const snapshot: ContextSnapshotPayload = {
    mode: input.mode,
    createdAt: new Date().toISOString(),
    budget: {
      maxPromptTokens,
      mandatoryTokens,
      optionalBudgetTokens: Math.max(0, maxPromptTokens - mandatoryTokens),
      estimatedPromptTokens: estimateTokens(promptText),
      promptChars: promptText.length,
      promptMessageCount: messages.length,
    },
    included,
    omitted,
  };

  return { messages, snapshot };
}

export function estimateTokens(value: string): number {
  const normalized = normalizeContextText(value);
  if (!normalized) return 0;
  const cjk = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const nonCjk = normalized.length - cjk;
  return Math.max(1, Math.ceil(cjk + nonCjk / 4));
}

function buildCandidates(input: ManagedContextInput): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  let order = 0;
  const chatWindow = input.retrievedContext.chatWindow;

  if (input.webSearchContext) {
    candidates.push({
      kind: 'web_context',
      label: 'current web/search context',
      priority: 88,
      content: input.webSearchContext,
      placement: 'system',
      order: order += 1,
      minTokens: 96,
    });
  }

  const recentOriginal = input.recentMessages.slice(-RECENT_ORIGINAL_MESSAGE_COUNT);
  const oldHistory = input.recentMessages.slice(0, Math.max(0, input.recentMessages.length - RECENT_ORIGINAL_MESSAGE_COUNT));
  recentOriginal.forEach((message, index) => {
    candidates.push({
      kind: 'recent_message',
      id: String(message.id),
      label: `${message.role} message #${message.id}`,
      priority: 80 + index / 100,
      content: message.content,
      placement: 'history',
      role: message.role === 'assistant' ? 'assistant' : 'user',
      order: order += 1,
      minTokens: 32,
    });
  });

  const pinnedFacts = input.retrievedContext.profileFacts
    .filter(fact => fact.confidence >= 0.7 || fact.importance >= 8)
    .slice(0, 8);
  if (pinnedFacts.length > 0) {
    candidates.push({
      kind: 'pinned_fact',
      label: 'high confidence profile facts',
      priority: 70,
      content: ['## Pinned facts', ...pinnedFacts.map(fact => `- ${fact.fact}`)].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  if (chatWindow?.workingStateJson && chatWindow.workingStateJson.trim() !== '{}') {
    candidates.push({
      kind: 'working_state',
      label: `working state for window #${chatWindow.id}`,
      priority: 60,
      content: [
        '## Current chat window working state',
        `Window: ${chatWindow.title} (#${chatWindow.id})`,
        'working_state_json:',
        chatWindow.workingStateJson,
      ].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  if (chatWindow?.summary?.trim()) {
    candidates.push({
      kind: 'window_summary',
      label: `rolling summary for window #${chatWindow.id}`,
      priority: 50,
      content: [
        '## Current chat window summary',
        '窗口 rolling summary:',
        '绐楀彛 rolling summary:',
        `Window: ${chatWindow.title} (#${chatWindow.id}); messages: ${chatWindow.messageCount}`,
        chatWindow.summary,
      ].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  const projectMemory = input.retrievedContext.projectNotes.slice(0, 6);
  if (projectMemory.length > 0) {
    candidates.push({
      kind: 'project_memory',
      label: 'project memory notes',
      priority: 40,
      content: [
        '## Project memory',
        ...projectMemory.map(note => `- [${note.project}/${note.status}] ${note.title}: ${note.note}`),
      ].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  const globalFacts = input.retrievedContext.profileFacts
    .filter(fact => !pinnedFacts.some(pinned => pinned.fact === fact.fact))
    .filter(fact => fact.confidence >= 0.45)
    .slice(0, 8);
  const globalEvents = input.retrievedContext.relatedEvents.slice(0, 6);
  if (globalFacts.length > 0 || globalEvents.length > 0) {
    candidates.push({
      kind: 'global_memory',
      label: 'global memory facts and events',
      priority: 30,
      content: [
        '## Global memory',
        ...globalFacts.map(fact => `- ${fact.fact}`),
        ...globalEvents.map(event => `- [${event.date}] ${event.summary}`),
      ].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  if (oldHistory.length > 0) {
    candidates.push({
      kind: 'old_history',
      label: `${oldHistory.length} older history snippets`,
      priority: 20,
      content: [
        '## Older history snippets',
        ...oldHistory.map(message => `- #${message.id} ${message.role}: ${truncateForSnippet(message.content, 220)}`),
      ].join('\n'),
      placement: 'system',
      order: order += 1,
    });
  }

  return candidates;
}

function compareCandidatePriority(left: ContextCandidate, right: ContextCandidate): number {
  if (right.priority !== left.priority) return right.priority - left.priority;
  return left.order - right.order;
}

function snapshotItem(
  kind: ContextSnapshotItemKind,
  label: string,
  priority: number,
  content: string,
  included: boolean,
  reason: string,
  id?: string,
): ContextSnapshotItem {
  const normalized = normalizeContextText(content);
  return {
    kind,
    id,
    label,
    priority,
    chars: normalized.length,
    estimatedTokens: estimateTokens(normalized),
    included,
    reason,
    preview: buildPreview(normalized),
  };
}

function trimToTokenBudget(value: string, maxTokens: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(value.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  const trimmed = value.slice(0, low).trimEnd();
  return trimmed.length < value.length ? `${trimmed}\n[trimmed by ContextManager]` : trimmed;
}

function truncateForSnippet(value: string, maxChars: number): string {
  const normalized = normalizeContextText(value);
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildPreview(value: string): string {
  return truncateForSnippet(value, 180);
}

function normalizeContextText(value: string): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
