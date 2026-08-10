import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { DailyMemorySummary } from '../../shared/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RAW_MEMORY_FULL_RECALL_DAYS = 365;
const RAW_MEMORY_MAX_RECALL_DAYS = 730;

interface DailySummaryOptions {
  force?: boolean;
  now?: Date;
}

export interface MemoryRetentionPolicyResult {
  dailySummariesGenerated: number;
  rawEventsPruned: number;
  decayCandidates: number;
}

interface DailySourceEvent {
  summary: string;
  detail?: string;
  tags?: string;
  importance: number;
}

interface DailySourceMessage {
  role: string;
  content: string;
}

export function summarizeDailyMemory(date: string, options: DailySummaryOptions = {}): DailyMemorySummary | null {
  const day = normalizeDateKey(date);
  if (!day) return null;

  const db = getDatabase();
  const existing = getDailyMemorySummary(day);
  if (existing && !options.force) return existing;

  const events = db.prepare(`
    SELECT summary, detail, tags, importance
    FROM events
    WHERE date = ?
    ORDER BY importance DESC, id ASC
    LIMIT 32
  `).all(day) as DailySourceEvent[];
  const messages = db.prepare(`
    SELECT role, content
    FROM messages
    WHERE substr(created_at, 1, 10) = ?
    ORDER BY id ASC
    LIMIT 80
  `).all(day) as DailySourceMessage[];

  if (events.length === 0 && messages.length === 0) return null;

  const highlights = buildHighlights(events, messages);
  const maxImportance = Math.max(1, ...events.map(event => clampImportance(event.importance)));
  const importance = clampImportance(Math.max(5, maxImportance, messages.length >= 16 ? 6 : 5));
  const decayStage = decayStageForAgeDays(ageInDays(day, options.now || new Date()));
  const summary = buildSummaryText(day, events, messages, highlights);

  const result = db.prepare(`
    INSERT INTO daily_memory_summaries (
      date,
      summary,
      highlights,
      source_event_count,
      source_message_count,
      max_importance,
      importance,
      decay_stage
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date)
    DO UPDATE SET summary = excluded.summary,
                  highlights = excluded.highlights,
                  source_event_count = excluded.source_event_count,
                  source_message_count = excluded.source_message_count,
                  max_importance = excluded.max_importance,
                  importance = excluded.importance,
                  decay_stage = excluded.decay_stage,
                  updated_at = datetime('now', 'localtime')
  `).run(
    day,
    summary,
    JSON.stringify(highlights),
    events.length,
    messages.length,
    maxImportance,
    importance,
    decayStage,
  );

  const id = existing?.id || result.lastInsertRowid as number;
  upsertMemoryIndex('daily_memory_summaries', id, `${day} ${summary} ${highlights.join(' ')}`);
  return getDailyMemorySummary(day);
}

export function generateDueDailyMemorySummaries(now: Date = new Date(), lookbackDays = 14): number {
  let generated = 0;
  const safeLookback = Math.max(1, Math.min(60, Math.round(lookbackDays)));
  for (let offset = 1; offset <= safeLookback; offset += 1) {
    const day = dateKeyFromDaysAgo(now, offset);
    if (getDailyMemorySummary(day)) continue;
    if (summarizeDailyMemory(day, { now })) generated += 1;
  }
  return generated;
}

export function applyMemoryRetentionPolicy(now: Date = new Date()): MemoryRetentionPolicyResult {
  const dailySummariesGenerated = generateDueDailyMemorySummaries(now);
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT e.id, e.date, e.importance
    FROM events e
    WHERE EXISTS (
      SELECT 1
      FROM daily_memory_summaries d
      WHERE d.date = e.date
    )
  `).all() as Array<{ id: number; date: string; importance: number }>;

  const prune = rows.filter(row => {
    const age = ageInDays(row.date, now);
    return age > RAW_MEMORY_FULL_RECALL_DAYS && !isRawEventRetrievable(row.date, row.importance, now);
  });

  const deleteMany = db.transaction((items: Array<{ id: number }>) => {
    for (const row of items) {
      db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
      deleteMemoryIndex('events', row.id);
    }
  });
  deleteMany(prune);

  return {
    dailySummariesGenerated,
    rawEventsPruned: prune.length,
    decayCandidates: rows.filter(row => ageInDays(row.date, now) > RAW_MEMORY_FULL_RECALL_DAYS).length,
  };
}

export function searchDailyMemorySummaries(keyword: MemorySearchTerms, limit = 10, now: Date = new Date()): DailyMemorySummary[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('daily_memory_summaries', terms, safeLimit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT ${dailySummaryFields()}
        FROM daily_memory_summaries
        WHERE id IN (${placeholders(indexedIds)})
        ORDER BY importance DESC, date DESC, id DESC
        LIMIT ?
      `).all(...indexedIds, safeLimit) as any[]
    : db.prepare(`
        SELECT ${dailySummaryFields()}
        FROM daily_memory_summaries
        WHERE ${likeClauses(['summary', 'highlights'], terms)} OR date IN (${placeholders(terms)})
        ORDER BY importance DESC, date DESC, id DESC
        LIMIT ?
      `).all(...likeValues(['summary', 'highlights'], terms), ...terms, safeLimit) as any[];

  return rows
    .map(rowToDailyMemorySummary)
    .filter(summary => isDailySummaryRetrievable(summary.date, now));
}

export function getImportantDailyMemorySummaries(minImportance = 6, limit = 10, now: Date = new Date()): DailyMemorySummary[] {
  const rows = getDatabase().prepare(`
    SELECT ${dailySummaryFields()}
    FROM daily_memory_summaries
    WHERE importance >= ?
    ORDER BY importance DESC, date DESC, id DESC
    LIMIT ?
  `).all(clampImportance(minImportance), Math.max(1, Math.min(50, Math.round(limit)))) as any[];

  return rows
    .map(rowToDailyMemorySummary)
    .filter(summary => isDailySummaryRetrievable(summary.date, now));
}

export function getDailyMemorySummary(date: string): DailyMemorySummary | null {
  const day = normalizeDateKey(date);
  if (!day) return null;
  const row = getDatabase().prepare(`
    SELECT ${dailySummaryFields()}
    FROM daily_memory_summaries
    WHERE date = ?
    LIMIT 1
  `).get(day);
  return row ? rowToDailyMemorySummary(row) : null;
}

export function isRawEventRetrievable(date: string, importance: number, now: Date = new Date()): boolean {
  const age = ageInDays(date, now);
  if (age <= RAW_MEMORY_FULL_RECALL_DAYS) return true;
  if (age > RAW_MEMORY_MAX_RECALL_DAYS) return false;
  return clampImportance(importance) >= minimumRawImportanceForAgeDays(age);
}

export function minimumRawImportanceForAgeDays(age: number): number {
  if (age <= RAW_MEMORY_FULL_RECALL_DAYS) return 1;
  if (age <= 455) return 5;
  if (age <= 546) return 6;
  if (age <= 637) return 7;
  if (age <= RAW_MEMORY_MAX_RECALL_DAYS) return 8;
  return 11;
}

export function decayStageForAgeDays(age: number): DailyMemorySummary['decay_stage'] {
  if (age < 0) return 'fresh';
  if (age <= RAW_MEMORY_FULL_RECALL_DAYS) return 'year_one';
  const threshold = minimumRawImportanceForAgeDays(age);
  if (threshold === 5) return 'decay_5';
  if (threshold === 6) return 'decay_6';
  if (threshold === 7) return 'decay_7';
  if (threshold === 8) return 'decay_8';
  return 'expired';
}

function isDailySummaryRetrievable(date: string, now: Date): boolean {
  const age = ageInDays(date, now);
  return age >= 0 && age <= RAW_MEMORY_MAX_RECALL_DAYS;
}

function buildSummaryText(
  date: string,
  events: DailySourceEvent[],
  messages: DailySourceMessage[],
  highlights: string[],
): string {
  const lines = [
    `Daily memory summary for ${date}.`,
    `Sources: ${events.length} extracted memories and ${messages.length} saved chat messages.`,
  ];
  if (highlights.length > 0) {
    lines.push('Highlights:');
    lines.push(...highlights.slice(0, 12).map(item => `- ${item}`));
  }
  return truncateText(lines.join('\n'), 3_000);
}

function buildHighlights(events: DailySourceEvent[], messages: DailySourceMessage[]): string[] {
  const eventHighlights = events
    .slice(0, 8)
    .map(event => truncateText(`${event.summary}${event.detail ? `: ${event.detail}` : ''}`, 220));
  const userMessages = messages
    .filter(message => message.role === 'user')
    .slice(0, 8)
    .map(message => truncateText(message.content, 180));
  return unique([...eventHighlights, ...userMessages]).slice(0, 12);
}

function rowToDailyMemorySummary(row: any): DailyMemorySummary {
  return {
    id: row.id,
    date: row.date,
    summary: row.summary,
    highlights: safeParseStringArray(row.highlights),
    source_event_count: Number(row.source_event_count || 0),
    source_message_count: Number(row.source_message_count || 0),
    max_importance: Number(row.max_importance || 1),
    importance: Number(row.importance || 5),
    decay_stage: cleanDecayStage(row.decay_stage),
    generated_at: row.generated_at || undefined,
    updated_at: row.updated_at || undefined,
  };
}

function dailySummaryFields(): string {
  return `
    id,
    date,
    summary,
    highlights,
    source_event_count,
    source_message_count,
    max_importance,
    importance,
    decay_stage,
    generated_at,
    updated_at
  `;
}

function ageInDays(date: string, now: Date): number {
  const day = normalizeDateKey(date);
  if (!day) return Number.POSITIVE_INFINITY;
  const current = Date.parse(`${dateKey(now)}T00:00:00.000Z`);
  const target = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.floor((current - target) / MS_PER_DAY);
}

function dateKeyFromDaysAgo(now: Date, offset: number): string {
  const time = Date.parse(`${dateKey(now)}T00:00:00.000Z`) - offset * MS_PER_DAY;
  return dateKey(new Date(time));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDateKey(value: string): string {
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function cleanDecayStage(value: string): DailyMemorySummary['decay_stage'] {
  if (value === 'fresh' || value === 'year_one' || value === 'decay_5' || value === 'decay_6' || value === 'decay_7' || value === 'decay_8' || value === 'expired') {
    return value;
  }
  return 'fresh';
}

function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(Number.isFinite(value) ? value : 5)));
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
