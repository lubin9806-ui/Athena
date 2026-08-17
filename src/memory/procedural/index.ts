import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { ProceduralMemory } from '../../shared/types';

export interface ProceduralMemoryInput {
  scope?: ProceduralMemory['scope'];
  projectId?: number;
  key: string;
  instruction: string;
  evidence?: string;
  confidence?: number;
  importance?: number;
}

export function upsertProceduralMemory(input: ProceduralMemoryInput): ProceduralMemory {
  const db = getDatabase();
  const scope = cleanScope(input.scope);
  const projectId = resolveProceduralProjectId(scope, input.projectId);
  const key = normalizeText(input.key).slice(0, 120);
  const instruction = normalizeText(input.instruction).slice(0, 2_000);
  const evidence = input.evidence ? normalizeText(input.evidence).slice(0, 2_000) : undefined;
  if (!key || !instruction) throw new Error('Procedural memory requires a key and instruction.');

  const existing = projectId
    ? db.prepare("SELECT id FROM procedural_memories WHERE scope = 'project' AND project_id = ? AND key = ?").get(projectId, key) as { id: number } | undefined
    : db.prepare('SELECT id FROM procedural_memories WHERE scope = ? AND project_id IS NULL AND key = ?').get(scope, key) as { id: number } | undefined;
  const confidence = clampConfidence(input.confidence ?? 0.7);
  const importance = clampImportance(input.importance ?? 6);
  let id: number;
  if (existing) {
    db.prepare(`
      UPDATE procedural_memories
      SET instruction = ?, evidence = ?, confidence = MAX(confidence, ?), importance = MAX(importance, ?),
          status = 'active', updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(instruction, evidence || null, confidence, importance, existing.id);
    id = existing.id;
  } else {
    id = db.prepare(`
      INSERT INTO procedural_memories (scope, project_id, key, instruction, evidence, confidence, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(scope, projectId || null, key, instruction, evidence || null, confidence, importance).lastInsertRowid as number;
  }
  upsertMemoryIndex('procedural_memories', id, `${scope} ${projectId || ''} ${key} ${instruction} ${evidence || ''}`, scope === 'project' ? projectId : 0);
  return getProceduralMemory(id) as ProceduralMemory;
}

export function searchProceduralMemories(keyword: MemorySearchTerms, limit = 10, projectId?: number | null): ProceduralMemory[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('procedural_memories', terms, safeLimit, projectId === undefined ? undefined : { projectId, includeGlobal: true });
  const scope = proceduralScope(projectId);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT ${proceduralFields()}
        FROM procedural_memories
        WHERE id IN (${placeholders(indexedIds)}) AND status = 'active' ${scope.clause}
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(...indexedIds, ...scope.params, safeLimit) as any[]
    : db.prepare(`
        SELECT ${proceduralFields()}
        FROM procedural_memories
        WHERE status = 'active' ${scope.clause}
          AND (${likeClauses(['key', 'instruction', 'evidence', 'scope'], terms)})
        ORDER BY importance DESC, confidence DESC, updated_at DESC
        LIMIT ?
      `).all(...scope.params, ...likeValues(['key', 'instruction', 'evidence', 'scope'], terms), safeLimit) as any[];

  const memories = rows.map(rowToProceduralMemory);
  markProceduralMemoriesRecalled(memories.map(memory => memory.id));
  return memories;
}

export function getImportantProceduralMemories(minImportance = 7, limit = 10, projectId?: number | null): ProceduralMemory[] {
  const scope = proceduralScope(projectId);
  const rows = getDatabase().prepare(`
    SELECT ${proceduralFields()}
    FROM procedural_memories
    WHERE status = 'active' AND importance >= ? ${scope.clause}
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT ?
  `).all(clampImportance(minImportance), ...scope.params, Math.max(1, Math.min(50, Math.round(limit)))) as any[];
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
  return 'id, scope, project_id, key, instruction, evidence, confidence, importance, status, created_at, updated_at, last_recalled_at';
}

function rowToProceduralMemory(row: any): ProceduralMemory {
  return {
    id: row.id,
    scope: cleanScope(row.scope),
    project_id: row.project_id || undefined,
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

function resolveProceduralProjectId(scope: ProceduralMemory['scope'], value: number | undefined): number | undefined {
  if (scope !== 'project') {
    if (value !== undefined) throw new Error('Only project-scoped procedural memory can reference a Project.');
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error('Project-scoped procedural memory requires a Project ID.');
  const row = getDatabase().prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(value) as { id: number } | undefined;
  if (!row) throw new Error('Project-scoped procedural memory references an unavailable Project.');
  return row.id;
}

function proceduralScope(projectId: number | null | undefined): { clause: string; params: number[] } {
  if (projectId === undefined) return { clause: '', params: [] };
  if (projectId === null || !Number.isInteger(projectId) || projectId <= 0) {
    return { clause: "AND scope != 'project'", params: [] };
  }
  return { clause: "AND (scope != 'project' OR project_id = ?)", params: [projectId] };
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
