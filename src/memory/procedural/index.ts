import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { ProceduralMemory } from '../../shared/types';

export interface ProceduralMemoryInput {
  scope?: ProceduralMemory['scope'];
  key: string;
  instruction: string;
  evidence?: string;
  confidence?: number;
  importance?: number;
}

export function upsertProceduralMemory(input: ProceduralMemoryInput): ProceduralMemory {
  const db = getDatabase();
  const scope = cleanScope(input.scope);
  const key = normalizeText(input.key).slice(0, 120);
  const instruction = normalizeText(input.instruction).slice(0, 2_000);
  const evidence = input.evidence ? normalizeText(input.evidence).slice(0, 2_000) : undefined;
  if (!key || !instruction) throw new Error('Procedural memory requires a key and instruction.');

  const result = db.prepare(`
    INSERT INTO procedural_memories (scope, key, instruction, evidence, confidence, importance)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, key)
    DO UPDATE SET instruction = excluded.instruction,
                  evidence = excluded.evidence,
                  confidence = MAX(confidence, excluded.confidence),
                  importance = MAX(importance, excluded.importance),
                  status = 'active',
                  updated_at = datetime('now', 'localtime')
  `).run(scope, key, instruction, evidence || null, clampConfidence(input.confidence ?? 0.7), clampImportance(input.importance ?? 6));

  const existing = db.prepare('SELECT id FROM procedural_memories WHERE scope = ? AND key = ?').get(scope, key) as { id: number } | undefined;
  const id = existing?.id || result.lastInsertRowid as number;
  upsertMemoryIndex('procedural_memories', id, `${scope} ${key} ${instruction} ${evidence || ''}`);
  return getProceduralMemory(id) as ProceduralMemory;
}

export function searchProceduralMemories(keyword: MemorySearchTerms, limit = 10): ProceduralMemory[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('procedural_memories', terms, safeLimit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT ${proceduralFields()}
        FROM procedural_memories
        WHERE id IN (${placeholders(indexedIds)}) AND status = 'active'
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(...indexedIds, safeLimit) as any[]
    : db.prepare(`
        SELECT ${proceduralFields()}
        FROM procedural_memories
        WHERE status = 'active'
          AND (${likeClauses(['key', 'instruction', 'evidence', 'scope'], terms)})
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(...likeValues(['key', 'instruction', 'evidence', 'scope'], terms), safeLimit) as any[];

  const memories = rows.map(rowToProceduralMemory);
  markProceduralMemoriesRecalled(memories.map(memory => memory.id));
  return memories;
}

export function getImportantProceduralMemories(minImportance = 7, limit = 10): ProceduralMemory[] {
  const rows = getDatabase().prepare(`
    SELECT ${proceduralFields()}
    FROM procedural_memories
    WHERE status = 'active' AND importance >= ?
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT ?
  `).all(clampImportance(minImportance), Math.max(1, Math.min(50, Math.round(limit)))) as any[];
  return rows.map(rowToProceduralMemory);
}

export function getProceduralMemory(id: number): ProceduralMemory | null {
  const row = getDatabase().prepare(`
    SELECT ${proceduralFields()}
    FROM procedural_memories
    WHERE id = ?
    LIMIT 1
  `).get(id);
  return row ? rowToProceduralMemory(row) : null;
}

export function archiveProceduralMemory(id: number): boolean {
  const result = getDatabase().prepare(`
    UPDATE procedural_memories
    SET status = 'archived', updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(id);
  if (result.changes > 0) deleteMemoryIndex('procedural_memories', id);
  return result.changes > 0;
}

function markProceduralMemoriesRecalled(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare("UPDATE procedural_memories SET last_recalled_at = datetime('now', 'localtime') WHERE id = ?");
  db.transaction((items: number[]) => {
    for (const id of items) stmt.run(id);
  })(ids);
}

function proceduralFields(): string {
  return 'id, scope, key, instruction, evidence, confidence, importance, status, created_at, updated_at, last_recalled_at';
}

function rowToProceduralMemory(row: any): ProceduralMemory {
  return {
    id: row.id,
    scope: cleanScope(row.scope),
    key: row.key,
    instruction: row.instruction,
    evidence: row.evidence || undefined,
    confidence: Number(row.confidence ?? 0.7),
    importance: Number(row.importance ?? 6),
    status: row.status === 'archived' ? 'archived' : 'active',
    created_at: row.created_at || undefined,
    updated_at: row.updated_at || undefined,
    last_recalled_at: row.last_recalled_at || undefined,
  };
}

function cleanScope(value: unknown): ProceduralMemory['scope'] {
  return value === 'project' || value === 'mode' || value === 'tool' || value === 'persona' ? value : 'global';
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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
