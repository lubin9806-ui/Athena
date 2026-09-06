import {
  emptyCreativeState,
  parseCreativeState,
  type CreativePatch,
  type CreativeState,
} from './CreativeState';

/** A change Athena understood but has not applied, waiting for a yes. */
export interface CreativePendingProposal {
  patch: CreativePatch;
  understanding: string;
  gaps: string[];
  plannedExtensions: string[];
  createdAt: string;
}

export interface CreativeWorkspace {
  state: CreativeState;
  pending: CreativePendingProposal | null;
}

export type CreativeReply = 'confirm' | 'cancel' | 'revise';

const MAX_AFFIRMATIVE_CHARS = 12;
const AFFIRMATIVE = /^(?:好|好的|好呀|可以|行|确认|同意|没问题|就这样|就这么办|按你说的|开始吧?|生成吧?|画吧|来吧|ok|okay|yes|go)[。.!！~\s]*$/i;
const NEGATIVE = /^(?:取消|算了|不用了?|先不(?:要|用)?|停|等等|再想想|no|cancel)[。.!！~\s]*$/i;

/**
 * Reads a reply to a confirmation question.
 *
 * Deliberately narrow: only a message that is *nothing but* an affirmative counts
 * as a yes. "好，不过把场景换成书店" is a revision, and treating it as consent
 * would apply a proposal the user was in the middle of changing (ATH-CHAT-004).
 * Anything that is not a clear yes or no is handled as a revision, so an unrelated
 * message simply leaves the proposal standing.
 */
export function readCreativeReply(message: string): CreativeReply {
  const text = message.trim();
  if (!text || text.length > MAX_AFFIRMATIVE_CHARS) return 'revise';
  if (AFFIRMATIVE.test(text)) return 'confirm';
  if (NEGATIVE.test(text)) return 'cancel';
  return 'revise';
}

/**
 * The message Athena sends instead of acting: what she understood, what she would
 * fill in on her own, and what she still needs. Nothing is applied until the user
 * answers, which is the whole point of the exchange.
 */
export function formatCreativeProposal(proposal: CreativePendingProposal): string {
  const lines: string[] = [];
  lines.push(`我理解的是：${proposal.understanding || '按你这次说的更新画面描述'}`);
  if (proposal.plannedExtensions.length > 0) {
    lines.push(`我打算自己补上：${proposal.plannedExtensions.join('、')}（这些是技术细节，角色特征我不会动）`);
  }
  if (proposal.gaps.length > 0) {
    lines.push(`还需要你定：${proposal.gaps.join('、')}`);
  }
  lines.push(proposal.gaps.length > 0
    ? '你可以直接补充这几点，或者说"就这样"让我按现有理解开始。'
    : '没问题的话说一声，我就按这个来；要改直接说。');
  return lines.join('\n');
}

export function emptyCreativeWorkspace(now: Date = new Date()): CreativeWorkspace {
  return { state: emptyCreativeState(now), pending: null };
}

export function parseCreativeWorkspace(raw: string | null | undefined, now: Date = new Date()): CreativeWorkspace {
  if (!raw) return emptyCreativeWorkspace(now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyCreativeWorkspace(now);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyCreativeWorkspace(now);
  const value = parsed as Record<string, unknown>;
  // Blobs written before the pending proposal existed hold a bare state.
  const stateSource = value.state !== undefined ? value.state : value;
  return {
    state: parseCreativeState(JSON.stringify(stateSource), now),
    pending: readPending(value.pending),
  };
}

export function serializeCreativeWorkspace(workspace: CreativeWorkspace): string {
  return JSON.stringify(workspace);
}

function readPending(value: unknown): CreativePendingProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const patch = source.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const sections = (patch as Record<string, unknown>).sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return null;
  return {
    patch: patch as CreativePatch,
    understanding: typeof source.understanding === 'string' ? source.understanding : '',
    gaps: readList(source.gaps),
    plannedExtensions: readList(source.plannedExtensions),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
  };
}

function readList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
}
