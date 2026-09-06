import { getDatabase } from '../../memory/database';

export type ScheduledJobKind = 'reminder';
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
