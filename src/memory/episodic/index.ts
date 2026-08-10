import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { EmotionType, MemoryEvent } from '../../shared/types';

export interface MemoryEventInput {
  date?: string;
  summary: string;
  detail?: string;
  tags?: string[];
  emotion?: EmotionType;
  importance?: number;
}

export function addEvent(
  date: string,
  summary: string,
  detail?: string,
  tags: string[] = [],
  emotion?: EmotionType,
  importance: number = 5
): MemoryEvent {
  return addMemoryEvent({ date, summary, detail, tags, emotion, importance });
}

export function addMemoryEvent(input: MemoryEventInput): MemoryEvent {
  const db = getDatabase();
  const date = input.date || new Date().toISOString().slice(0, 10);
  const summary = normalizeText(input.summary);
  const detail = input.detail ? normalizeText(input.detail) : undefined;
  const tags = input.tags || [];
  const importance = clampImportance(input.importance ?? 5);

  const result = db.prepare(`
    INSERT INTO events (date, summary, detail, tags, emotion, importance)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(date, summary, detail || null, JSON.stringify(tags), input.emotion || null, importance);
  const id = result.lastInsertRowid as number;
  upsertMemoryIndex('events', id, `${summary} ${detail || ''} ${tags.join(' ')} ${input.emotion || ''}`);

  return {
    id,
    date,
    summary,
    detail,
    tags,
    emotion: input.emotion,
    importance,
    recalled_count: 0,
  };
}

export function searchEvents(keyword: MemorySearchTerms, limit: number = 10): MemoryEvent[] {
  const db = getDatabase();
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('events', terms, limit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT id, date, summary, detail, tags, emotion, importance, recalled_count, created_at
        FROM events
        WHERE id IN (${placeholders(indexedIds)})
        ORDER BY importance DESC, date DESC, id DESC
        LIMIT ?
      `).all(...indexedIds, limit) as any[]
    : db.prepare(`
        SELECT id, date, summary, detail, tags, emotion, importance, recalled_count, created_at
        FROM events
        WHERE ${likeClauses(['summary', 'detail', 'tags'], terms)}
        ORDER BY importance DESC, date DESC, id DESC
        LIMIT ?
      `).all(...likeValues(['summary', 'detail', 'tags'], terms), limit) as any[];

  const events = rows.map(rowToMemoryEvent);
  markEventsRecalled(events.map(event => event.id));
  return events;
}

export function getImportantEvents(minImportance: number = 7, limit: number = 20): MemoryEvent[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, date, summary, detail, tags, emotion, importance, recalled_count, created_at
    FROM events
    WHERE importance >= ?
    ORDER BY importance DESC, date DESC, id DESC
    LIMIT ?
  `).all(minImportance, limit) as any[];
  return rows.map(rowToMemoryEvent);
}

export function getRecentEvents(limit: number = 10): MemoryEvent[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, date, summary, detail, tags, emotion, importance, recalled_count, created_at
    FROM events
    ORDER BY date DESC, id DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.map(rowToMemoryEvent);
}

export function deleteEvent(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  if (result.changes > 0) deleteMemoryIndex('events', id);
  return result.changes > 0;
}

function markEventsRecalled(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare('UPDATE events SET recalled_count = recalled_count + 1 WHERE id = ?');
  const updateMany = db.transaction((eventIds: number[]) => {
    for (const id of eventIds) stmt.run(id);
  });
  updateMany(ids);
}

function rowToMemoryEvent(row: any): MemoryEvent {
  return {
    id: row.id,
    date: row.date,
    summary: row.summary,
    detail: row.detail || undefined,
    tags: safeParseTags(row.tags),
    emotion: row.emotion || undefined,
    importance: row.importance,
    recalled_count: row.recalled_count,
    created_at: row.created_at,
  };
}

function safeParseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function likeClauses(columns: string[], terms: string[]): string {
  return terms
    .map(() => `(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`)
    .join(' OR ');
}

function likeValues(columns: string[], terms: string[]): string[] {
  return terms.flatMap(term => columns.map(() => `%${term}%`));
}
