import { getDatabase } from '../database';
import { deleteMemoryIndex, searchMemoryIndex, upsertMemoryIndex } from '../indexer';
import type { ProfileCategory, ProfileEntry } from '../../shared/types';

export interface ProfileFactInput {
  category: ProfileCategory;
  fact: string;
  confidence?: number;
  source?: string;
  importance?: number;
}

export function addProfileFact(
  category: ProfileCategory,
  fact: string,
  confidence: number = 0.5,
  source?: string,
  importance: number = 5
): void {
  const db = getDatabase();
  const normalizedFact = normalizeText(fact);
  if (!normalizedFact) return;

  const existing = db.prepare(`
    SELECT id
    FROM profile
    WHERE category = ? AND fact = ?
    ORDER BY importance DESC, updated_at DESC
    LIMIT 1
  `).get(category, normalizedFact) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE profile
      SET confidence = MIN(1.0, confidence + ?),
          source = COALESCE(?, source),
          importance = MAX(importance, ?),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(clampConfidence(confidence) * 0.2, source || null, clampImportance(importance), existing.id);
    upsertMemoryIndex('profile', existing.id, `${category} ${normalizedFact} ${source || ''}`);
    return;
  }

  const result = db.prepare(`
    INSERT INTO profile (category, fact, confidence, source, importance)
    VALUES (?, ?, ?, ?, ?)
  `).run(category, normalizedFact, clampConfidence(confidence), source || null, clampImportance(importance));
  upsertMemoryIndex('profile', result.lastInsertRowid as number, `${category} ${normalizedFact} ${source || ''}`);
}

export function addProfileFacts(facts: ProfileFactInput[]): void {
  const db = getDatabase();
  const insertMany = db.transaction((items: ProfileFactInput[]) => {
    for (const item of items) {
      addProfileFact(
        item.category,
        item.fact,
        item.confidence ?? 0.5,
        item.source,
        item.importance ?? 5
      );
    }
  });
  insertMany(facts);
}

export function getAllProfile(): Record<ProfileCategory, ProfileEntry[]> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT category, fact, confidence, source, importance, created_at, updated_at
    FROM profile
    ORDER BY importance DESC, confidence DESC, updated_at DESC
  `).all() as any[];

  const result: Record<ProfileCategory, ProfileEntry[]> = {
    identity: [],
    preference: [],
    habit: [],
    project: [],
    health: [],
  };

  for (const row of rows) {
    result[row.category as ProfileCategory].push(rowToProfileEntry(row));
  }
  return result;
}

export function getHighConfidenceProfile(minConfidence: number = 0.4, limit: number = 30): ProfileEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT fact, confidence, source, importance, created_at, updated_at
    FROM profile
    WHERE confidence >= ?
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT ?
  `).all(minConfidence, limit) as any[];
  return rows.map(rowToProfileEntry);
}

export function searchProfileFacts(keyword: string, limit: number = 12): ProfileEntry[] {
  const db = getDatabase();
  const indexedIds = searchMemoryIndex('profile', [keyword], limit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT fact, confidence, source, importance, created_at, updated_at
        FROM profile
        WHERE id IN (${placeholders(indexedIds)})
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(...indexedIds, limit) as any[]
    : db.prepare(`
        SELECT fact, confidence, source, importance, created_at, updated_at
        FROM profile
        WHERE fact LIKE ?
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(`%${keyword}%`, limit) as any[];

  const facts = rows.map(rowToProfileEntry);
  markProfileFactsRecalled(facts.map(fact => fact.fact));
  return facts;
}

export function updateRecallTimestamp(factContent: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE profile
    SET last_recalled_at = datetime('now', 'localtime'),
        confidence = MIN(1.0, confidence + 0.03)
    WHERE fact = ?
  `).run(factContent);
}

export function deleteProfileFact(factContent: string): boolean {
  const db = getDatabase();
  const rows = db.prepare('SELECT id FROM profile WHERE fact = ?').all(factContent) as { id: number }[];
  const result = db.prepare('DELETE FROM profile WHERE fact = ?').run(factContent);
  if (result.changes > 0) {
    for (const row of rows) deleteMemoryIndex('profile', row.id);
  }
  return result.changes > 0;
}

function markProfileFactsRecalled(facts: string[]): void {
  if (facts.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE profile
    SET last_recalled_at = datetime('now', 'localtime'),
        confidence = MIN(1.0, confidence + 0.02)
    WHERE fact = ?
  `);
  const updateMany = db.transaction((items: string[]) => {
    for (const item of items) stmt.run(item);
  });
  updateMany(facts);
}

function rowToProfileEntry(row: any): ProfileEntry {
  return {
    fact: row.fact,
    confidence: row.confidence,
    source: row.source || undefined,
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}
