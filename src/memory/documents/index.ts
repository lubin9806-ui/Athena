import type { ProjectDocument, ProjectDocumentChunk } from '../../shared/types';
import { getDatabase } from '../database';
import { deleteMemoryIndex, searchMemoryIndex, upsertMemoryIndex } from '../indexer';

export interface ProjectDocumentChunkInput {
  locator: string;
  pageStart?: number;
  pageEnd?: number;
  text: string;
}

export interface ProjectDocumentInput {
  projectId: number;
  name: string;
  mimeType: ProjectDocument['mime_type'];
  storagePath: string;
  bytes: number;
  sha256: string;
  parser: ProjectDocument['parser'];
  ocrEngine?: ProjectDocument['ocr_engine'];
  ocrLanguages?: string[];
  needsOcr?: boolean;
  pageCount?: number;
  chunks: ProjectDocumentChunkInput[];
}

export interface ProjectDocumentStorageRecord extends ProjectDocument {
  storage_path: string;
}

export function saveProjectDocument(input: ProjectDocumentInput): ProjectDocument {
  const db = getDatabase();
  const charCount = input.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const documentId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO project_documents (
        project_id, name, mime_type, storage_path, bytes, sha256, parser,
        ocr_engine, ocr_languages, needs_ocr, page_count, char_count, chunk_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `).run(
      input.projectId, input.name, input.mimeType, input.storagePath, input.bytes,
      input.sha256, input.parser, input.ocrEngine || null, JSON.stringify(input.ocrLanguages || []), input.needsOcr ? 1 : 0,
      input.pageCount || null, charCount, input.chunks.length,
    );
    const id = result.lastInsertRowid as number;
    const insertChunk = db.prepare(`
      INSERT INTO project_document_chunks (
        document_id, project_id, ordinal, locator, page_start, page_end, text, char_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    input.chunks.forEach((chunk, ordinal) => {
      const chunkId = insertChunk.run(
        id, input.projectId, ordinal, chunk.locator, chunk.pageStart || null,
        chunk.pageEnd || null, chunk.text, chunk.text.length,
      ).lastInsertRowid as number;
      upsertMemoryIndex('project_document_chunks', chunkId, `${input.name} ${chunk.locator} ${chunk.text}`, input.projectId);
    });
    return id;
  })();
  return getProjectDocument(documentId) as ProjectDocument;
}

export function getProjectDocument(id: number): ProjectDocument | null {
  const row = getDatabase().prepare(`SELECT ${documentFields()} FROM project_documents WHERE id = ? LIMIT 1`).get(id);
  return row ? rowToProjectDocument(row) : null;
}

export function getProjectDocumentStorageRecord(id: number, projectId?: number): ProjectDocumentStorageRecord | null {
  const row = projectId
    ? getDatabase().prepare(`SELECT ${documentFields()}, storage_path FROM project_documents WHERE id = ? AND project_id = ? LIMIT 1`).get(id, projectId)
    : getDatabase().prepare(`SELECT ${documentFields()}, storage_path FROM project_documents WHERE id = ? LIMIT 1`).get(id);
  return row ? { ...rowToProjectDocument(row), storage_path: (row as any).storage_path } : null;
}

export function listProjectDocuments(projectId: number): ProjectDocument[] {
  const rows = getDatabase().prepare(`
    SELECT ${documentFields()}
    FROM project_documents
    WHERE project_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(projectId) as any[];
  return rows.map(rowToProjectDocument);
}

export function searchProjectDocumentChunks(projectId: number, query: string, limit = 8): ProjectDocumentChunk[] {
  const safeLimit = Math.max(1, Math.min(20, Math.round(limit)));
  const ids = searchMemoryIndex('project_document_chunks', query, safeLimit, { projectId, includeGlobal: false });
  if (ids.length === 0) return [];
  const rows = getDatabase().prepare(`
    SELECT c.id, c.document_id, c.project_id, d.name AS document_name, c.ordinal,
           c.locator, c.page_start, c.page_end, c.text, c.char_count
    FROM project_document_chunks c
    JOIN project_documents d ON d.id = c.document_id AND d.project_id = c.project_id
    WHERE c.project_id = ? AND d.status = 'ready' AND c.id IN (${ids.map(() => '?').join(', ')})
  `).all(projectId, ...ids) as any[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => byId.get(id)).filter(Boolean).map(rowToProjectDocumentChunk);
}

export function deleteProjectDocumentRecord(id: number, projectId: number): boolean {
  const db = getDatabase();
  const chunkIds = db.prepare('SELECT id FROM project_document_chunks WHERE document_id = ? AND project_id = ?').all(id, projectId) as Array<{ id: number }>;
  const result = db.prepare('DELETE FROM project_documents WHERE id = ? AND project_id = ?').run(id, projectId);
  if (result.changes > 0) for (const chunk of chunkIds) deleteMemoryIndex('project_document_chunks', chunk.id);
  return result.changes > 0;
}

export function updateProjectDocumentExtraction(
  id: number,
  projectId: number,
  input: Pick<ProjectDocumentInput, 'pageCount' | 'chunks' | 'ocrEngine' | 'ocrLanguages' | 'needsOcr'>,
): ProjectDocument {
  const db = getDatabase();
  db.transaction(() => {
    const existing = db.prepare('SELECT id, name FROM project_documents WHERE id = ? AND project_id = ?').get(id, projectId) as { id: number; name: string } | undefined;
    if (!existing) throw new Error('Project document extraction target is unavailable.');
    const oldChunks = db.prepare('SELECT id FROM project_document_chunks WHERE document_id = ? AND project_id = ?').all(id, projectId) as Array<{ id: number }>;
    for (const chunk of oldChunks) deleteMemoryIndex('project_document_chunks', chunk.id);
    db.prepare('DELETE FROM project_document_chunks WHERE document_id = ? AND project_id = ?').run(id, projectId);
    const insertChunk = db.prepare(`
      INSERT INTO project_document_chunks (document_id, project_id, ordinal, locator, page_start, page_end, text, char_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    input.chunks.forEach((chunk, ordinal) => {
      const chunkId = insertChunk.run(id, projectId, ordinal, chunk.locator, chunk.pageStart || null, chunk.pageEnd || null, chunk.text, chunk.text.length).lastInsertRowid as number;
      upsertMemoryIndex('project_document_chunks', chunkId, `${existing.name} ${chunk.locator} ${chunk.text}`, projectId);
    });
    const charCount = input.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    db.prepare(`
      UPDATE project_documents
      SET ocr_engine = ?, ocr_languages = ?, needs_ocr = ?, page_count = ?, char_count = ?, chunk_count = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND project_id = ?
    `).run(input.ocrEngine || null, JSON.stringify(input.ocrLanguages || []), input.needsOcr ? 1 : 0, input.pageCount || null, charCount, input.chunks.length, id, projectId);
  })();
  return getProjectDocument(id) as ProjectDocument;
}

function documentFields(): string {
  return 'id, project_id, name, mime_type, bytes, sha256, parser, ocr_engine, ocr_languages, needs_ocr, page_count, char_count, chunk_count, status, error, created_at, updated_at';
}

function rowToProjectDocument(row: any): ProjectDocument {
  return {
    id: Number(row.id), project_id: Number(row.project_id), name: row.name, mime_type: row.mime_type,
    bytes: Number(row.bytes), sha256: row.sha256, parser: row.parser,
    ocr_engine: row.ocr_engine || undefined,
    ocr_languages: parseStringArray(row.ocr_languages),
    needs_ocr: Boolean(row.needs_ocr),
    page_count: row.page_count ? Number(row.page_count) : undefined,
    char_count: Number(row.char_count), chunk_count: Number(row.chunk_count), status: row.status,
    error: row.error || undefined, created_at: row.created_at, updated_at: row.updated_at,
  };
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function rowToProjectDocumentChunk(row: any): ProjectDocumentChunk {
  return {
    id: Number(row.id), document_id: Number(row.document_id), project_id: Number(row.project_id),
    document_name: row.document_name, ordinal: Number(row.ordinal), locator: row.locator,
    page_start: row.page_start ? Number(row.page_start) : undefined,
    page_end: row.page_end ? Number(row.page_end) : undefined,
    text: row.text, char_count: Number(row.char_count),
  };
}
