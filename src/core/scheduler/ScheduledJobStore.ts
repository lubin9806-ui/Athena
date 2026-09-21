import { getDatabase } from '../../memory/database';

export type ScheduledJobKind = 'reminder' | 'initiative';
export type ScheduledJobStatus = 'scheduled' | 'completed' | 'cancelled';

export interface ScheduledJobRecord {
  id: string;
  kind: ScheduledJobKind;
  title: string;
  dueAt: string;
  status: ScheduledJobStatus;
  chatWindowId: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateScheduledJobInput {
  id: string;
  kind: ScheduledJobKind;
  title: string;
  dueAt: Date;
  chatWindowId?: number | null;
  payload?: Record<string, unknown>;
}

const MAX_TITLE_CHARS = 200;
const MAX_PAYLOAD_CHARS = 8_000;
// A finished reminder stays syncable for a week: long enough for a phone that
// was off to learn it was done, short enough that the account does not
// accumulate every reminder ever set.
const SYNC_FINISHED_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_SYNCED_REMINDERS = 100;

export function createScheduledJob(input: CreateScheduledJobInput): ScheduledJobRecord {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  if (!title) throw new Error('Scheduled job title is required');
  const payload = JSON.stringify(input.payload ?? {});
  if (payload.length > MAX_PAYLOAD_CHARS) throw new Error('Scheduled job payload is too large');
  getDatabase().prepare(`
    INSERT INTO scheduled_jobs (id, kind, title, due_at, status, chat_window_id, payload_json)
    VALUES (?, ?, ?, ?, 'scheduled', ?, ?)
  `).run(input.id, input.kind, title, input.dueAt.toISOString(), input.chatWindowId ?? null, payload);
  const created = getScheduledJob(input.id);
  if (!created) throw new Error(`Scheduled job was not persisted: ${input.id}`);
  return created;
}

export function getScheduledJob(id: string): ScheduledJobRecord | null {
  const row = getDatabase().prepare(`
    SELECT id, kind, title, due_at, status, chat_window_id, payload_json, created_at, completed_at
    FROM scheduled_jobs WHERE id = ?
  `).get(id);
  return row ? toRecord(row) : null;
}

export function listPendingScheduledJobs(): ScheduledJobRecord[] {
  const rows = getDatabase().prepare(`
    SELECT id, kind, title, due_at, status, chat_window_id, payload_json, created_at, completed_at
    FROM scheduled_jobs WHERE status = 'scheduled' ORDER BY due_at ASC
  `).all() as unknown[];
  return rows.map(toRecord);
}

/**
 * The reminders worth putting in the account: everything still pending, plus
 * the ones finished recently.
 *
 * The finished ones matter as much as the pending. Sending only what is still
 * scheduled would let a reminder the user completed here go on showing itself
 * on their phone, because nothing would ever tell the phone it was done.
 */
export function listSyncableReminders(now: Date = new Date()): ScheduledJobRecord[] {
  const since = new Date(now.getTime() - SYNC_FINISHED_WINDOW_MS).toISOString();
  const rows = getDatabase().prepare(`
    SELECT id, kind, title, due_at, status, chat_window_id, payload_json, created_at, completed_at
    FROM scheduled_jobs
    WHERE kind = 'reminder'
      AND (status = 'scheduled' OR COALESCE(completed_at, created_at) >= ?)
    ORDER BY due_at ASC
    LIMIT ?
  `).all(since, MAX_SYNCED_REMINDERS) as unknown[];
  return rows.map(toRecord);
}

/**
 * Writes a reminder that came from another device, keyed on the id that device
 * gave it so a later sync updates this row instead of adding a second one.
 * Returns what happened, so the caller can arm a timer only for a new row.
 */
export function upsertSyncedReminder(input: {
  id: string;
  title: string;
  dueAt: string;
  status: ScheduledJobStatus;
}): { record: ScheduledJobRecord; created: boolean } | null {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  if (!title) return null;
  const existing = getScheduledJob(input.id);
  if (existing) {
    // The due time and status are the other device's to change; the row is
    // updated in place so a reminder is never scheduled twice.
    getDatabase().prepare(`
      UPDATE scheduled_jobs SET title = ?, due_at = ?, status = ? WHERE id = ?
    `).run(title, input.dueAt, input.status, input.id);
    const updated = getScheduledJob(input.id);
    return updated ? { record: updated, created: false } : null;
  }
  getDatabase().prepare(`
    INSERT INTO scheduled_jobs (id, kind, title, due_at, status, chat_window_id, payload_json)
    VALUES (?, 'reminder', ?, ?, ?, NULL, '{}')
  `).run(input.id, title, input.dueAt, input.status);
  const created = getScheduledJob(input.id);
  return created ? { record: created, created: true } : null;
}

// Terminal transitions only apply to a job that is still scheduled, so a restore
// racing with a live timer cannot complete the same job twice.
export function markScheduledJobCompleted(id: string): boolean {
  return getDatabase().prepare(`
    UPDATE scheduled_jobs
    SET status = 'completed', completed_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'scheduled'
  `).run(id).changes > 0;
}

export function markScheduledJobCancelled(id: string): boolean {
  return getDatabase().prepare(`
    UPDATE scheduled_jobs
    SET status = 'cancelled', completed_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'scheduled'
  `).run(id).changes > 0;
}

export function deleteScheduledJob(id: string): boolean {
  return getDatabase().prepare('DELETE FROM scheduled_jobs WHERE id = ? AND kind = \'reminder\'').run(id).changes > 0;
}

/**
 * Records whether an initiative wake actually said something. The daily budget is
 * counted from these rows rather than from chat messages, so a message the user
 * later deletes cannot buy Athena another slot.
 */
export function recordInitiativeOutcome(id: string, spoke: boolean): void {
  getDatabase().prepare(`
    UPDATE scheduled_jobs SET payload_json = ? WHERE id = ? AND kind = 'initiative'
  `).run(JSON.stringify({ spoke }), id);
}

export function countInitiativeMessagesSince(since: Date): number {
  return (getDatabase().prepare(`
    SELECT COUNT(*) AS c FROM scheduled_jobs
    WHERE kind = 'initiative'
      AND status = 'completed'
      AND payload_json LIKE '%"spoke":true%'
      AND COALESCE(completed_at, created_at) >= ?
  `).get(since.toISOString()) as { c: number }).c;
}

export function deleteScheduledJobsForWindow(windowId: number): number {
  return getDatabase().prepare('DELETE FROM scheduled_jobs WHERE chat_window_id = ?').run(windowId).changes;
}

function toRecord(row: unknown): ScheduledJobRecord {
  const value = row as {
    id: string; kind: string; title: string; due_at: string; status: string;
    chat_window_id: number | null; payload_json: string; created_at: string; completed_at: string | null;
  };
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value.payload_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    // A malformed payload must not stop the job from being restored or cancelled.
  }
  return {
    id: value.id,
    kind: value.kind as ScheduledJobKind,
    title: value.title,
    dueAt: value.due_at,
    status: value.status as ScheduledJobStatus,
    chatWindowId: value.chat_window_id,
    payload,
    createdAt: value.created_at,
    completedAt: value.completed_at,
  };
}
