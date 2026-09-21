import type { ChatWindow, ChatWindowMessage } from '../../shared/types';
import type {
  CloudConversationPayload,
  CloudConversationTurn,
  CloudMemoryPayload,
  CloudReminderPayload,
} from '../../shared/types/cloud';

const MAX_SYNC_TURNS = 40;
const MAX_TURN_CHARS = 4_000;
// The same cap the scheduler applies when it writes a job title, and the same
// one the phone applies before it sends: a title that survives one end and is
// cut by the other would make the two records differ forever.
const MAX_REMINDER_TITLE = 200;

export function conversationResourceId(windowId: number): string {
  return `conversation.desktop-${windowId}`;
}

export function memoryResourceId(kind: string, id: number): string {
  return `memory.desktop-${kind}-${id}`;
}

export function desktopMemoryRefFromResourceId(resourceId: string): { kind: string; id: number } | null {
  const match = /^memory\.desktop-([a-z]+)-(\d+)$/.exec(resourceId);
  const id = match ? Number(match[2]) : 0;
  return match && id > 0 ? { kind: match[1], id } : null;
}

/**
 * A reminder adopted from another client keeps that client's id as its job id,
 * so it writes back to the same record rather than opening a second one for the
 * same reminder. Only reminders this desktop created get a desktop id.
 */
export function reminderResourceId(jobId: string): string {
  return jobId.startsWith('reminder.') ? jobId : `reminder.desktop-${jobId}`;
}

export function desktopReminderJobIdFromResourceId(resourceId: string): string | null {
  const prefix = 'reminder.desktop-';
  return resourceId.startsWith(prefix) && resourceId.length > prefix.length ? resourceId.slice(prefix.length) : null;
}

/** Records this desktop wrote for its own reminders come back on the feed. */
export function ownsReminderResource(resourceId: string): boolean {
  return resourceId.startsWith('reminder.desktop-');
}

export function toReminderPayload(job: { title: string; dueAt: string; status: string }): CloudReminderPayload {
  return {
    origin: 'desktop',
    title: job.title.slice(0, MAX_REMINDER_TITLE),
    dueAt: job.dueAt,
    status: reminderStatus(job.status),
  };
}

/**
 * A reminder written by another client, or null when it cannot be trusted to
 * fire correctly. A reminder with no time cannot fire and one with no words
 * says nothing when it does; both are refused rather than guessed at, because
 * the failure mode here is interrupting someone about nothing.
 */
export function parseReminderPayload(payload: Record<string, unknown>): CloudReminderPayload | null {
  const title = String(payload.title || '').trim().slice(0, MAX_REMINDER_TITLE);
  const dueAt = String(payload.dueAt || '').trim();
  if (!title || Number.isNaN(Date.parse(dueAt))) return null;
  return {
    origin: payload.origin === 'desktop' ? 'desktop' : 'android',
    title,
    dueAt,
    status: reminderStatus(payload.status),
  };
}

/**
 * An unknown status is read as still scheduled. Refusing to ring because a
 * later client invented a status would lose the reminder, and showing one that
 * is already dealt with is the cheaper mistake.
 */
function reminderStatus(value: unknown): CloudReminderPayload['status'] {
  return value === 'completed' || value === 'cancelled' ? value : 'scheduled';
}

export function shouldSyncWindow(window: Pick<ChatWindow, 'mode' | 'is_temporary'>): boolean {
  return window.is_temporary !== true && window.mode !== 'execute';
}

/**
 * Whether a single turn may leave the device.
 *
 * The window label is not a classification of its contents: a window that is in
 * Companion mode now can still hold the Execute turns from earlier, and those
 * carry computer operations and their results. Each message is judged on its own
 * recorded mode (ATH-CLOUD-004).
 */
export function shouldSyncMessage(message: Pick<ChatWindowMessage, 'role' | 'mode'>): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  return message.mode !== 'execute';
}

export function toConversationPayload(
  window: Pick<ChatWindow, 'title' | 'mode'>,
  messages: ChatWindowMessage[],
): CloudConversationPayload {
  const turns: CloudConversationTurn[] = messages
    .filter((message): message is ChatWindowMessage & { role: 'user' | 'assistant' } => shouldSyncMessage(message))
    .slice(-MAX_SYNC_TURNS)
    .map(message => ({
      role: message.role,
      content: message.content.slice(0, MAX_TURN_CHARS),
      mode: message.mode,
      createdAt: message.created_at,
    }));
  return {
    origin: 'desktop',
    title: window.title,
    mode: window.mode,
    turns,
  };
}

export function toMemoryPayload(item: { kind: string; title: string; content: string; importance?: number }): CloudMemoryPayload {
  return {
    origin: 'desktop',
    kind: item.kind,
    title: item.title.slice(0, 200),
    content: item.content.slice(0, 4_000),
    importance: item.importance,
  };
}

/**
 * The window a `conversation.desktop-N` record belongs to, or null when the id
 * was written by another client. Records this desktop writes for its own
 * windows come back on the change feed, and adopting them would clone every
 * window on every sync.
 */
export function desktopWindowIdFromResourceId(resourceId: string): number | null {
  const match = /^conversation\.desktop-(\d+)$/.exec(resourceId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Which turns from a record are not already in the window.
 *
 * Matched on role and text: saveChatMessage stamps its own created_at, so a
 * turn re-read on a later sync could never be matched by time. The cost is that
 * the identical sentence sent twice in one conversation is stored once. An
 * execute turn arriving here means another client sent what it should not have,
 * and it is refused rather than written to the local history.
 */
export function turnsToAppend(
  existing: Pick<ChatWindowMessage, 'role' | 'content'>[],
  turns: unknown,
): CloudConversationTurn[] {
  const seen = new Set(existing.map(message => `${message.role} ${message.content}`));
  const out: CloudConversationTurn[] = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || typeof turn !== 'object') continue;
    const candidate = turn as Record<string, unknown>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') continue;
    if (candidate.mode === 'execute') continue;
    const content = typeof candidate.content === 'string' ? candidate.content : '';
    if (!content) continue;
    const key = `${candidate.role} ${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      role: candidate.role,
      content,
      mode: typeof candidate.mode === 'string' ? candidate.mode : 'companion',
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    } as CloudConversationTurn);
  }
  return out;
}

export function incomingConversationTitle(payload: CloudConversationPayload): string {
  const title = payload.title?.trim();
  if (title) return title.slice(0, 80);
  return payload.origin === 'android' ? '来自手机的对话' : '同步对话';
}
