import type { MemoryRetrievalEvidence } from '../../shared/types';
import { getDatabase } from '../database';

export interface MemoryEvidenceTarget {
  memoryTable: string;
  memoryId: number;
  memoryKind: MemoryRetrievalEvidence['memoryKind'];
  projectId?: number;
  excerpt?: string;
  legacy?: boolean;
}

export function buildMemoryRetrievalEvidence(targets: MemoryEvidenceTarget[]): MemoryRetrievalEvidence[] {
  const evidence: MemoryRetrievalEvidence[] = [];
  for (const target of uniqueTargets(targets)) {
    const sources = loadDurableSources(target);
    if (sources.length > 0) evidence.push(...sources);
    else evidence.push({
      memoryTable: target.memoryTable,
      memoryId: target.memoryId,
      memoryKind: target.memoryKind,
      projectId: target.projectId,
      sourceTable: target.memoryTable,
      sourceId: target.memoryId,
      origin: target.legacy ? 'legacy' : 'record',
      excerpt: cleanExcerpt(target.excerpt),
    });
  }
  return uniqueEvidence(evidence);
}

function loadDurableSources(target: MemoryEvidenceTarget): MemoryRetrievalEvidence[] {
  const db = getDatabase();
  const result: MemoryRetrievalEvidence[] = [];
  const reviews = db.prepare(`
    SELECT id, source_table, source_id, chat_window_id, reason, content
    FROM memory_review_queue
    WHERE status = 'applied' AND applied_table = ? AND applied_id = ?
    ORDER BY reviewed_at DESC, id DESC
  `).all(target.memoryTable, target.memoryId) as Array<{
    id: number;
    source_table?: string;
    source_id?: number;
    chat_window_id?: number;
    reason?: string;
    content?: string;
  }>;
  for (const review of reviews) {
    const hasDurableSource = Boolean(review.source_table && review.source_id);
    result.push({
      memoryTable: target.memoryTable,
      memoryId: target.memoryId,
      memoryKind: target.memoryKind,
      projectId: target.projectId,
      sourceTable: hasDurableSource ? review.source_table as string : 'memory_review_queue',
      sourceId: hasDurableSource ? review.source_id : review.id,
      chatWindowId: review.chat_window_id || undefined,
      origin: 'review',
      excerpt: cleanExcerpt(review.content || review.reason || target.excerpt),
    });
  }
  if (target.memoryTable === 'memory_facts') {
    const factSources = db.prepare(`
      SELECT source_table, source_id, quote
      FROM memory_fact_sources
      WHERE fact_id = ?
      ORDER BY id ASC
    `).all(target.memoryId) as Array<{ source_table: string; source_id?: number; quote?: string }>;
    for (const source of factSources) {
      result.push({
        memoryTable: target.memoryTable,
        memoryId: target.memoryId,
        memoryKind: target.memoryKind,
        projectId: target.projectId,
        sourceTable: source.source_table,
        sourceId: source.source_id || undefined,
        origin: 'fact_source',
        excerpt: cleanExcerpt(source.quote || target.excerpt),
      });
    }
  }
  if (target.memoryTable === 'project_document_chunks') {
    const document = db.prepare(`
      SELECT d.id, d.name, d.sha256, c.locator
      FROM project_document_chunks c
      JOIN project_documents d ON d.id = c.document_id AND d.project_id = c.project_id
      WHERE c.id = ?
      LIMIT 1
    `).get(target.memoryId) as { id: number; name: string; sha256: string; locator: string } | undefined;
    if (document) {
      result.push({
        memoryTable: target.memoryTable,
        memoryId: target.memoryId,
        memoryKind: target.memoryKind,
        projectId: target.projectId,
        sourceTable: 'project_documents',
        sourceId: document.id,
        origin: 'record',
        excerpt: cleanExcerpt(`${document.name} ${document.locator} sha256:${document.sha256.slice(0, 16)}`),
      });
    }
  }
  return result;
}

function uniqueTargets(targets: MemoryEvidenceTarget[]): MemoryEvidenceTarget[] {
  const seen = new Set<string>();
  return targets.filter(target => {
    if (!Number.isInteger(target.memoryId) || target.memoryId <= 0) return false;
    const key = `${target.memoryTable}:${target.memoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEvidence(items: MemoryRetrievalEvidence[]): MemoryRetrievalEvidence[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = [
      item.memoryTable,
      item.memoryId,
      item.sourceTable,
      item.sourceId || '',
      item.chatWindowId || '',
      item.origin,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanExcerpt(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 240) : undefined;
}
