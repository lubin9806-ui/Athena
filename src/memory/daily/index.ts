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

export interface DailyMemoryRefinementInput {
  date: string;
  heuristicSummary: string;
  highlights: string[];
  source_event_count: number;
  source_message_count: number;
  max_importance: number;
}

export interface DailyMemoryRefinement {
  summary?: string;
  highlights?: string[];
  importance?: number;
}

export type DailyMemoryRefiner = (input: DailyMemoryRefinementInput) => Promise<DailyMemoryRefinement | null>;

export interface MemoryRetentionPolicyResult {
  dailySummariesGenerated: number;
  rawEventsPruned: number;
  decayCandidates: number;
  llmRefinedSummaries?: number;
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

  const existing = getDailyMemorySummary(day);
  if (existing && !options.force) return existing;

  const draft = buildDailyMemoryDraft(day, options.now || new Date());
  if (!draft) return null;
  return saveDailyMemorySummary(day, draft, existing?.id);
}

export async function summarizeDailyMemoryWithRefiner(
  date: string,
  refiner: DailyMemoryRefiner,
  options: DailySummaryOptions = {},
): Promise<DailyMemorySummary | null> {
  const day = normalizeDateKey(date);
  if (!day) return null;

  const existing = getDailyMemorySummary(day);
  if (existing && !options.force && existing.summary_method === 'llm-refined') return existing;
  if (existing && !options.force) return existing;

  const draft = buildDailyMemoryDraft(day, options.now || new Date());
  if (!draft) return null;

  let refined: DailyMemoryRefinement | null = null;
  try {
    refined = await refiner({
      date: day,
      heuristicSummary: draft.summary,
      highlights: draft.highlights,
      source_event_count: draft.source_event_count,
      source_message_count: draft.source_message_count,
      max_importance: draft.max_importance,
    });
  } catch {
    refined = null;
  }

  const next = refined ? {
    ...draft,
    summary: cleanRefinedSummary(refined.summary) || draft.summary,
    highlights: cleanRefinedHighlights(refined.highlights, draft.highlights),
    importance: refined.importance === undefined ? draft.importance : clampImportance(refined.importance),
    summary_method: 'llm-refined' as const,
  } : draft;
  return saveDailyMemorySummary(day, next, existing?.id);
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

export async function generateDueDailyMemorySummariesWithRefiner(
  refiner: DailyMemoryRefiner,
  now: Date = new Date(),
  lookbackDays = 14,
): Promise<{ generated: number; llmRefined: number }> {
  let generated = 0;
  let llmRefined = 0;
  const safeLookback = Math.max(1, Math.min(60, Math.round(lookbackDays)));
  for (let offset = 1; offset <= safeLookback; offset += 1) {
    const day = dateKeyFromDaysAgo(now, offset);
    const existing = getDailyMemorySummary(day);
    if (existing?.summary_method === 'llm-refined') continue;
    const summary = await summarizeDailyMemoryWithRefiner(day, refiner, { now, force: existing?.summary_method === 'heuristic' });
    if (!summary) continue;
    if (!existing) generated += 1;
    if (summary.summary_method === 'llm-refined') llmRefined += 1;
  }
  return { generated, llmRefined };
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

export async function applyMemoryRetentionPolicyWithRefiner(refiner: DailyMemoryRefiner, now: Date = new Date()): Promise<MemoryRetentionPolicyResult> {
  const generated = await generateDueDailyMemorySummariesWithRefiner(refiner, now);
  const result = applyMemoryRetentionPolicyWithoutSummaryGeneration(now);
  return {
    ...result,
    dailySummariesGenerated: generated.generated,
    llmRefinedSummaries: generated.llmRefined,
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
    summary_method: row.summary_method === 'llm-refined' ? 'llm-refined' : 'heuristic',
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
    summary_method,
    generated_at,
    updated_at
  `;
}

interface DailyMemoryDraft {
  summary: string;
  highlights: string[];
  source_event_count: number;
  source_message_count: number;
  max_importance: number;
  importance: number;
  decay_stage: DailyMemorySummary['decay_stage'];
  summary_method: 'heuristic' | 'llm-refined';
}

function buildDailyMemoryDraft(day: string, now: Date): DailyMemoryDraft | null {
  const { events, messages } = loadDailySources(day);
  if (events.length === 0 && messages.length === 0) return null;
  const highlights = buildHighlights(events, messages);
  const maxImportance = Math.max(1, ...events.map(event => clampImportance(event.importance)));
  return {
    summary: buildSummaryText(day, events, messages, highlights),
    highlights,
    source_event_count: events.length,
    source_message_count: messages.length,
    max_importance: maxImportance,
    importance: clampImportance(Math.max(5, maxImportance, messages.length >= 16 ? 6 : 5)),
    decay_stage: decayStageForAgeDays(ageInDays(day, now)),
    summary_method: 'heuristic',
  };
}

function loadDailySources(day: string): { events: DailySourceEvent[]; messages: DailySourceMessage[] } {
  const db = getDatabase();
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
  return { events, messages };
}

function saveDailyMemorySummary(day: string, draft: DailyMemoryDraft, existingId?: number): DailyMemorySummary | null {
  const result = getDatabase().prepare(`
    INSERT INTO daily_memory_summaries (
      date,
      summary,
      highlights,
      source_event_count,
      source_message_count,
      max_importance,
      importance,
      decay_stage,
      summary_method
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date)
    DO UPDATE SET summary = excluded.summary,
                  highlights = excluded.highlights,
                  source_event_count = excluded.source_event_count,
                  source_message_count = excluded.source_message_count,
                  max_importance = excluded.max_importance,
                  importance = excluded.importance,
                  decay_stage = excluded.decay_stage,
                  summary_method = excluded.summary_method,
                  updated_at = datetime('now', 'localtime')
  `).run(
    day,
    draft.summary,
    JSON.stringify(draft.highlights),
    draft.source_event_count,
    draft.source_message_count,
    draft.max_importance,
    draft.importance,
    draft.decay_stage,
    draft.summary_method,
  );

  const id = existingId || result.lastInsertRowid as number;
  upsertMemoryIndex('daily_memory_summaries', id, `${day} ${draft.summary} ${draft.highlights.join(' ')} ${draft.summary_method}`);
  return getDailyMemorySummary(day);
}

function applyMemoryRetentionPolicyWithoutSummaryGeneration(now: Date): MemoryRetentionPolicyResult {
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
    dailySummariesGenerated: 0,
    rawEventsPruned: prune.length,
    decayCandidates: rows.filter(row => ageInDays(row.date, now) > RAW_MEMORY_FULL_RECALL_DAYS).length,
  };
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

function cleanRefinedSummary(value: string | undefined): string {
  if (!value) return '';
  return truncateText(value, 3_000);
}

function cleanRefinedHighlights(values: string[] | undefined, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  const cleaned = unique(values
    .filter(item => typeof item === 'string')
    .map(item => truncateText(item, 220)))
    .slice(0, 12);
  return cleaned.length > 0 ? cleaned : fallback;
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
