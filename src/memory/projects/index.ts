import { getDatabase } from '../database';
import { deleteMemoryIndex, normalizeMemorySearchTerms, searchMemoryIndex, upsertMemoryIndex, type MemorySearchTerms } from '../indexer';
import type { AthenaProject, ProjectNote } from '../../shared/types';

export type ProjectStatus = ProjectNote['status'];

export interface ProjectNoteInput {
  project: string;
  title: string;
  note: string;
  status?: ProjectStatus;
  tags?: string[];
  importance?: number;
}

export interface AthenaProjectInput {
  title?: string;
  instructions?: string;
}

export interface AthenaProjectPatch {
  title?: string;
  instructions?: string;
}

const DEFAULT_PROJECT_TITLE = 'General';
const MAX_PROJECT_TITLE_CHARS = 80;
const MAX_PROJECT_INSTRUCTIONS_CHARS = 4_000;

export function ensureDefaultProject(): AthenaProject {
  const existing = getActiveProject();
  if (existing) return existing;
  return createProject({ title: DEFAULT_PROJECT_TITLE });
}

export function createProject(input: AthenaProjectInput = {}): AthenaProject {
  const db = getDatabase();
  const title = cleanProjectTitle(input.title) || DEFAULT_PROJECT_TITLE;
  const instructions = cleanProjectInstructions(input.instructions);
  const result = db.prepare(`
    INSERT INTO projects (title, instructions, memory_state)
    VALUES (?, ?, '{}')
  `).run(title, instructions);
  return activateProject(result.lastInsertRowid as number) || ensureDefaultProject();
}

export function getProject(id: number): AthenaProject | null {
  const row = getDatabase().prepare(`
    SELECT ${projectSelectFields()}
    ${projectSelectFrom()}
    WHERE p.id = ? AND p.deleted_at IS NULL
    GROUP BY p.id
    LIMIT 1
  `).get(id);
  return row ? rowToProject(row) : null;
}

export function getActiveProject(): AthenaProject | null {
  const row = getDatabase().prepare(`
    SELECT ${projectSelectFields()}
    ${projectSelectFrom()}
    WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
    GROUP BY p.id
    ORDER BY p.last_active_at DESC, p.id ASC
    LIMIT 1
  `).get();
  return row ? rowToProject(row) : null;
}

export function listProjects(includeArchived = false): AthenaProject[] {
  const db = getDatabase();
  const archivedClause = includeArchived ? '' : 'AND p.archived_at IS NULL';
  const rows = db.prepare(`
    SELECT ${projectSelectFields()}
    ${projectSelectFrom()}
    WHERE p.deleted_at IS NULL ${archivedClause}
    GROUP BY p.id
    ORDER BY p.archived_at IS NOT NULL ASC, p.last_active_at DESC, p.updated_at DESC, p.id DESC
  `).all() as any[];
  if (rows.length === 0 && !includeArchived) return [ensureDefaultProject()];
  return rows.map(rowToProject);
}

export function activateProject(id: number): AthenaProject | null {
  const existing = getProject(id);
  if (!existing || existing.archived_at || existing.deleted_at) return null;
  getDatabase().prepare(`
    UPDATE projects
    SET last_active_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL
  `).run(id);
  return getProject(id);
}

export function updateProject(id: number, patch: AthenaProjectPatch): AthenaProject | null {
  const existing = getProject(id);
  if (!existing || existing.deleted_at) return null;
  const title = cleanProjectTitle(patch.title);
  const instructions = typeof patch.instructions === 'string'
    ? cleanProjectInstructions(patch.instructions)
    : existing.instructions;
  getDatabase().prepare(`
    UPDATE projects
    SET title = ?,
        instructions = ?,
        updated_at = datetime('now', 'localtime'),
        last_active_at = datetime('now', 'localtime')
    WHERE id = ? AND deleted_at IS NULL
  `).run(title || existing.title, instructions, id);
  return getProject(id);
}

function projectSelectFields(): string {
  return `
    p.id,
    p.title,
    p.instructions,
    p.memory_state,
    p.archived_at,
    p.deleted_at,
    p.created_at,
    p.updated_at,
    p.last_active_at,
    COUNT(cw.id) AS window_count
  `;
}

function projectSelectFrom(): string {
  return `
    FROM projects p
    LEFT JOIN chat_windows cw ON cw.project_id = p.id AND cw.deleted_at IS NULL
  `;
}

function rowToProject(row: any): AthenaProject {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions || '',
    memory_state_json: row.memory_state || '{}',
    archived_at: row.archived_at || undefined,
    deleted_at: row.deleted_at || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
    windowCount: Number(row.window_count || 0),
  };
}

export function addProjectNote(input: ProjectNoteInput): ProjectNote {
  const db = getDatabase();
  const project = normalizeText(input.project) || 'General';
  const title = normalizeText(input.title) || 'Untitled note';
  const note = normalizeText(input.note);
  const status = input.status || 'active';
  const tags = input.tags || [];
  const importance = clampImportance(input.importance ?? 5);

  const existing = getProjectNote(project, title);
  if (existing) {
    db.prepare(`
      UPDATE project_notes
      SET note = ?,
          status = ?,
          tags = ?,
          importance = MAX(importance, ?),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(note, status, JSON.stringify(mergeTags(existing.tags, tags)), importance, existing.id);
    const updated = getProjectNote(project, title)!;
    upsertProjectNoteIndex(updated);
    return updated;
  }

  db.prepare(`
    INSERT INTO project_notes (project, title, note, status, tags, importance)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project, title, note, status, JSON.stringify(tags), importance);

  const created = getProjectNote(project, title)!;
  upsertProjectNoteIndex(created);
  return created;
}

export function searchProjectNotes(keyword: MemorySearchTerms, limit: number = 10): ProjectNote[] {
  const db = getDatabase();
  const terms = normalizeMemorySearchTerms(keyword);
  if (terms.length === 0) return [];
  const indexedIds = searchMemoryIndex('project_notes', terms, limit);
  const rows = indexedIds.length > 0
    ? db.prepare(`
        SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
        FROM project_notes
        WHERE id IN (${placeholders(indexedIds)}) AND status != 'archived'
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `).all(...indexedIds, limit) as any[]
    : db.prepare(`
        SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
        FROM project_notes
        WHERE status != 'archived'
          AND (${likeClauses(['project', 'title', 'note', 'tags'], terms)})
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `).all(...likeValues(['project', 'title', 'note', 'tags'], terms), limit) as any[];

  const notes = rows.map(rowToProjectNote);
  markProjectNotesRecalled(notes.map(note => note.id));
  return notes;
}

export function getImportantProjectNotes(minImportance: number = 7, limit: number = 10): ProjectNote[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
    FROM project_notes
    WHERE importance >= ? AND status != 'archived'
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `).all(minImportance, limit) as any[];
  return rows.map(rowToProjectNote);
}

export function getRecentProjectNotes(limit: number = 10): ProjectNote[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
    FROM project_notes
    WHERE status != 'archived'
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.map(rowToProjectNote);
}

export function getAllProjectNotes(): ProjectNote[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
    FROM project_notes
    ORDER BY status ASC, importance DESC, updated_at DESC
  `).all() as any[];
  return rows.map(rowToProjectNote);
}

export function updateProjectNoteStatus(id: number, status: ProjectStatus): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE project_notes
    SET status = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(status, id).changes > 0;
  if (result) {
    const row = getProjectNoteById(id);
    if (row) upsertProjectNoteIndex(row);
  }
  return result;
}

export function deleteProjectNote(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM project_notes WHERE id = ?').run(id);
  if (result.changes > 0) deleteMemoryIndex('project_notes', id);
  return result.changes > 0;
}

function getProjectNote(project: string, title: string): ProjectNote | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
    FROM project_notes
    WHERE project = ? AND title = ?
  `).get(project, title) as any;
  return row ? rowToProjectNote(row) : undefined;
}

function getProjectNoteById(id: number): ProjectNote | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at, last_recalled_at
    FROM project_notes
    WHERE id = ?
  `).get(id) as any;
  return row ? rowToProjectNote(row) : undefined;
}

function upsertProjectNoteIndex(note: ProjectNote): void {
  upsertMemoryIndex(
    'project_notes',
    note.id,
    `${note.project} ${note.title} ${note.note} ${note.status} ${note.tags.join(' ')}`
  );
}

function markProjectNotesRecalled(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE project_notes
    SET last_recalled_at = datetime('now', 'localtime')
    WHERE id = ?
  `);
  const updateMany = db.transaction((noteIds: number[]) => {
    for (const id of noteIds) stmt.run(id);
  });
  updateMany(ids);
}

function rowToProjectNote(row: any): ProjectNote {
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    note: row.note,
    status: row.status,
    tags: safeParseTags(row.tags),
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_recalled_at: row.last_recalled_at || undefined,
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

function cleanProjectTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_TITLE_CHARS)
    : '';
}

function cleanProjectInstructions(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim().slice(0, MAX_PROJECT_INSTRUCTIONS_CHARS)
    : '';
}

function mergeTags(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map(tag => normalizeText(tag)).filter(Boolean)));
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
