import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { TemporalMemoryFact } from '../../shared/types';

export interface TemporalMemoryFactInput {
  subject: string;
  predicate: string;
  object: string;
  summary?: string;
  confidence?: number;
  importance?: number;
  validFrom?: string;
  sourceTable?: string;
  sourceId?: number;
  sourceQuote?: string;
  supersedeExisting?: boolean;
}

export function addTemporalMemoryFact(input: TemporalMemoryFactInput): TemporalMemoryFact {
  const db = getDatabase();
  const subject = normalizeText(input.subject).slice(0, 200);
  const predicate = normalizeText(input.predicate).slice(0, 120);
  const object = normalizeText(input.object).slice(0, 1_000);
  if (!subject || !predicate || !object) throw new Error('Temporal fact requires subject, predicate, and object.');

  const summary = normalizeText(input.summary || `${subject} ${predicate} ${object}`).slice(0, 1_500);
  const validFrom = normalizeDateTime(input.validFrom) || new Date().toISOString();

  const entityId = ensureMemoryEntity('concept', subject);
  const result = db.transaction(() => {
    if (input.supersedeExisting !== false) {
      db.prepare(`
        UPDATE memory_facts
        SET status = 'superseded',
            valid_to = COALESCE(valid_to, ?),
            updated_at = datetime('now', 'localtime')
        WHERE subject = ? AND predicate = ? AND status = 'active'
      `).run(validFrom, subject, predicate);
    }

    const insert = db.prepare(`
      INSERT INTO memory_facts (
        subject_entity_id,
        subject,
        predicate,
        object,
        summary,
        confidence,
        importance,
        valid_from
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId,
      subject,
      predicate,
      object,
      summary,
      clampConfidence(input.confidence ?? 0.7),
      clampImportance(input.importance ?? 6),
      validFrom,
    );
    const factId = insert.lastInsertRowid as number;
    if (input.sourceTable || input.sourceQuote) {
      db.prepare(`
        INSERT INTO memory_fact_sources (fact_id, source_table, source_id, quote)
        VALUES (?, ?, ?, ?)
      `).run(factId, input.sourceTable || 'manual', input.sourceId || null, input.sourceQuote || null);
    }
    return factId;
  })();

  upsertMemoryIndex('memory_facts', result, `${subject} ${predicate} ${object} ${summary}`);
  return getTemporalMemoryFact(result) as TemporalMemoryFact;
}

export function searchTemporalMemoryFacts(keyword: MemorySearchTerms, limit = 10): TemporalMemoryFact[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('memory_facts', terms, safeLimit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT ${factFields()}
        FROM memory_facts
        WHERE id IN (${placeholders(indexedIds)}) AND status = 'active' AND valid_to IS NULL
        ORDER BY importance DESC, confidence DESC, valid_from DESC
        LIMIT ?
      `).all(...indexedIds, safeLimit) as any[]
    : db.prepare(`
        SELECT ${factFields()}
        FROM memory_facts
        WHERE status = 'active'
          AND valid_to IS NULL
          AND (${likeClauses(['subject', 'predicate', 'object', 'summary'], terms)})
        ORDER BY importance DESC, confidence DESC, valid_from DESC
        LIMIT ?
      `).all(...likeValues(['subject', 'predicate', 'object', 'summary'], terms), safeLimit) as any[];
  return rows.map(rowToTemporalMemoryFact);
}

export function getImportantTemporalMemoryFacts(minImportance = 7, limit = 10): TemporalMemoryFact[] {
  const rows = getDatabase().prepare(`
    SELECT ${factFields()}
    FROM memory_facts
    WHERE status = 'active' AND valid_to IS NULL AND importance >= ?
    ORDER BY importance DESC, confidence DESC, valid_from DESC
    LIMIT ?
  `).all(clampImportance(minImportance), Math.max(1, Math.min(50, Math.round(limit)))) as any[];
  return rows.map(rowToTemporalMemoryFact);
}

export function getTemporalMemoryFact(id: number): TemporalMemoryFact | null {
  const row = getDatabase().prepare(`
    SELECT ${factFields()}
    FROM memory_facts
    WHERE id = ?
    LIMIT 1
  `).get(id);
  return row ? rowToTemporalMemoryFact(row) : null;
}

export function archiveTemporalMemoryFact(id: number): boolean {
  const result = getDatabase().prepare(`
    UPDATE memory_facts
    SET status = 'archived', updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(id);
  if (result.changes > 0) deleteMemoryIndex('memory_facts', id);
  return result.changes > 0;
}

function ensureMemoryEntity(type: string, name: string): number {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO memory_entities (type, name, summary)
    VALUES (?, ?, ?)
    ON CONFLICT(type, name)
    DO UPDATE SET updated_at = datetime('now', 'localtime')
  `).run(type, name, name);
  return (db.prepare('SELECT id FROM memory_entities WHERE type = ? AND name = ?').get(type, name) as { id: number }).id;
}

function factFields(): string {
  return 'id, subject, predicate, object, summary, confidence, importance, valid_from, valid_to, status, created_at, updated_at';
}

function rowToTemporalMemoryFact(row: any): TemporalMemoryFact {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    summary: row.summary,
    confidence: Number(row.confidence ?? 0.7),
    importance: Number(row.importance ?? 6),
    valid_from: row.valid_from || undefined,
    valid_to: row.valid_to || undefined,
    status: row.status === 'superseded' || row.status === 'archived' ? row.status : 'active',
    created_at: row.created_at || undefined,
    updated_at: row.updated_at || undefined,
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeDateTime(value: string | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.7));
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(Number.isFinite(value) ? value : 6)));
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
