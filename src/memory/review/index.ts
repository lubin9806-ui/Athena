import { addMemoryEvent, type MemoryEventInput } from '../episodic';
import { addTemporalMemoryFact, type TemporalMemoryFactInput } from '../graph';
import { addProfileFact, type ProfileFactInput } from '../profile';
import { addProjectNote, type ProjectNoteInput } from '../projects';
import { upsertProceduralMemory, type ProceduralMemoryInput } from '../procedural';
import { getDatabase } from '../database';
import type { ExtractedMemory } from '../extractor';
import type { MemoryReviewItem, MemoryReviewKind } from '../../shared/types';
import { createHash } from 'crypto';

export interface MemoryReviewCandidate {
  kind: MemoryReviewKind;
  title: string;
  content: string;
  payload: Record<string, unknown>;
  reason: string;
  confidence: number;
  importance: number;
  sourceTable?: string;
  sourceId?: number;
  chatWindowId?: number;
  autoApply?: boolean;
  groupKey?: string;
}

export interface MemoryReviewQueueResult {
  queued: number;
  applied: number;
  rejected: number;
}

export interface MemoryReviewListOptions {
  status?: 'pending' | 'applied' | 'rejected' | 'all';
  limit?: number;
}

export function queueExtractedMemory(
  extracted: ExtractedMemory,
  options: { sourceMessageId?: number; chatWindowId?: number; minImportance?: number } = {},
): MemoryReviewQueueResult {
  const candidates = candidatesFromExtractedMemory(extracted, options);
  let queued = 0;
  let applied = 0;
  let rejected = 0;

  for (const candidate of candidates) {
    const item = enqueueMemoryReviewCandidate(candidate);
    if (item.status === 'applied') applied += 1;
    else if (item.status === 'rejected') rejected += 1;
    else queued += 1;
  }

  return { queued, applied, rejected };
}

export function enqueueMemoryReviewCandidate(candidate: MemoryReviewCandidate): MemoryReviewItem {
  const db = getDatabase();
  const normalized = normalizeCandidate(candidate);
  const existing = db.prepare(`
    SELECT ${reviewFields()}
    FROM memory_review_queue
    WHERE group_key = ? AND status = 'pending'
    LIMIT 1
  `).get(normalized.groupKey) as any;

  if (existing) {
    db.prepare(`
      UPDATE memory_review_queue
      SET title = ?,
          content = ?,
          payload_json = ?,
          reason = ?,
          confidence = MAX(confidence, ?),
          importance = MAX(importance, ?),
          source_table = COALESCE(source_table, ?),
          source_id = COALESCE(source_id, ?),
          chat_window_id = COALESCE(chat_window_id, ?)
      WHERE id = ? AND status = 'pending'
    `).run(
      normalized.title,
      normalized.content,
      JSON.stringify(normalized.payload),
      normalized.reason,
      normalized.confidence,
      normalized.importance,
      normalized.sourceTable || null,
      normalized.sourceId || null,
      normalized.chatWindowId || null,
      existing.id,
    );
    const item = getMemoryReviewItem(existing.id) as MemoryReviewItem;
    if (normalized.autoApply) return applyMemoryReviewItem(item.id);
    return item;
  }

  const result = db.prepare(`
    INSERT INTO memory_review_queue (
      kind,
      status,
      title,
      content,
      payload_json,
      reason,
      group_key,
      confidence,
      importance,
      source_table,
      source_id,
      chat_window_id
    )
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.kind,
    normalized.title,
    normalized.content,
    JSON.stringify(normalized.payload),
    normalized.reason,
    normalized.groupKey,
    normalized.confidence,
    normalized.importance,
    normalized.sourceTable || null,
    normalized.sourceId || null,
    normalized.chatWindowId || null,
  );

  const id = result.lastInsertRowid as number;
  if (normalized.autoApply) return applyMemoryReviewItem(id);
  return getMemoryReviewItem(id) as MemoryReviewItem;
}

export function listMemoryReviewQueue(options: MemoryReviewListOptions = {}): MemoryReviewItem[] {
  const status = options.status || 'pending';
  const limit = Math.max(1, Math.min(200, Math.round(options.limit || 80)));
  const where = status === 'all' ? '' : 'WHERE status = @status';
  const rows = getDatabase().prepare(`
    SELECT ${reviewFields()}
    FROM memory_review_queue
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `).all({ status, limit }) as any[];
  return rows.map(rowToMemoryReviewItem);
}

export function approveMemoryReviewItem(id: number): MemoryReviewItem | null {
  const item = getMemoryReviewItem(id);
  if (!item || item.status !== 'pending') return item;
  return applyMemoryReviewItem(id);
}

export function approveMemoryReviewItems(ids: number[]): MemoryReviewItem[] {
  return cleanIds(ids)
    .map(id => approveMemoryReviewItem(id))
    .filter((item): item is MemoryReviewItem => Boolean(item));
}

export function rejectMemoryReviewItem(id: number): MemoryReviewItem | null {
  const db = getDatabase();
  db.prepare(`
    UPDATE memory_review_queue
    SET status = 'rejected', reviewed_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'pending'
  `).run(id);
  return getMemoryReviewItem(id);
}

export function rejectMemoryReviewItems(ids: number[]): MemoryReviewItem[] {
  return cleanIds(ids)
    .map(id => rejectMemoryReviewItem(id))
    .filter((item): item is MemoryReviewItem => Boolean(item));
}

export function getMemoryReviewItem(id: number): MemoryReviewItem | null {
  const row = getDatabase().prepare(`
    SELECT ${reviewFields()}
    FROM memory_review_queue
    WHERE id = ?
    LIMIT 1
  `).get(id);
  return row ? rowToMemoryReviewItem(row) : null;
}

function applyMemoryReviewItem(id: number): MemoryReviewItem {
  const db = getDatabase();
  const item = getMemoryReviewItem(id);
  if (!item) throw new Error(`Memory review item not found: ${id}`);
  if (item.status === 'applied') return item;
  if (item.status !== 'pending') return item;

  const applied = applyPayload(item.kind, item.payload);
  db.prepare(`
    UPDATE memory_review_queue
    SET status = 'applied',
        applied_table = ?,
        applied_id = ?,
        reviewed_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(applied.table, applied.id, id);
  return getMemoryReviewItem(id) as MemoryReviewItem;
}

function candidatesFromExtractedMemory(
  extracted: ExtractedMemory,
  options: { sourceMessageId?: number; chatWindowId?: number; minImportance?: number },
): MemoryReviewCandidate[] {
  const minImportance = options.minImportance ?? 5;
  const sourceTable = options.sourceMessageId ? 'messages' : undefined;
  const sourceId = options.sourceMessageId;
  const chatWindowId = options.chatWindowId;
  const candidates: MemoryReviewCandidate[] = [];

  for (const fact of extracted.profileFacts.filter(item => (item.importance ?? 0) >= minImportance)) {
    candidates.push({
      kind: 'profile',
      title: fact.category,
      content: fact.fact,
      payload: fact as unknown as Record<string, unknown>,
      reason: fact.source === 'explicit' ? 'explicit remember request' : 'profile pattern matched',
      confidence: fact.confidence ?? 0.55,
      importance: fact.importance ?? 5,
      sourceTable,
      sourceId,
      chatWindowId,
      autoApply: fact.source === 'explicit' && (fact.confidence ?? 0) >= 0.7,
    });
  }

  if (extracted.event && (extracted.event.importance ?? 0) >= minImportance) {
    candidates.push({
      kind: 'event',
      title: extracted.event.summary,
      content: extracted.event.detail || extracted.event.summary,
      payload: extracted.event as unknown as Record<string, unknown>,
      reason: 'episodic event pattern matched',
      confidence: 0.65,
      importance: extracted.event.importance ?? 5,
      sourceTable,
      sourceId,
      chatWindowId,
      autoApply: (extracted.event.importance ?? 0) >= 8,
    });
  }

  if (extracted.projectNote && (extracted.projectNote.importance ?? 0) >= minImportance) {
    candidates.push({
      kind: 'project',
      title: extracted.projectNote.title,
      content: extracted.projectNote.note,
      payload: extracted.projectNote as unknown as Record<string, unknown>,
      reason: 'project note pattern matched',
      confidence: 0.6,
      importance: extracted.projectNote.importance ?? 5,
      sourceTable,
      sourceId,
      chatWindowId,
      autoApply: false,
    });
  }

  for (const memory of extracted.proceduralMemories.filter(item => (item.importance ?? 0) >= minImportance)) {
    candidates.push({
      kind: 'procedure',
      title: `${memory.scope || 'global'} / ${memory.key}`,
      content: memory.instruction,
      payload: memory as unknown as Record<string, unknown>,
      reason: 'procedural rule pattern matched; review required before changing assistant behavior',
      confidence: memory.confidence ?? 0.7,
      importance: memory.importance ?? 6,
      sourceTable,
      sourceId,
      chatWindowId,
      autoApply: false,
    });
  }

  for (const fact of extracted.temporalFacts.filter(item => (item.importance ?? 0) >= minImportance)) {
    candidates.push({
      kind: 'fact',
      title: `${fact.subject} / ${fact.predicate}`,
      content: fact.summary || `${fact.subject} ${fact.predicate} ${fact.object}`,
      payload: {
        ...fact,
        sourceTable: fact.sourceTable || sourceTable,
        sourceId: fact.sourceId || sourceId,
      } as Record<string, unknown>,
      reason: 'temporal fact pattern matched; review required before superseding prior facts',
      confidence: fact.confidence ?? 0.65,
      importance: fact.importance ?? 6,
      sourceTable,
      sourceId,
      chatWindowId,
      autoApply: false,
    });
  }

  return candidates;
}

function applyPayload(kind: MemoryReviewKind, payload: Record<string, unknown>): { table: string; id: number } {
  if (kind === 'profile') {
    const fact = payload as unknown as ProfileFactInput;
    addProfileFact(fact.category, fact.fact, fact.confidence, fact.source, fact.importance);
    const row = getDatabase().prepare('SELECT id FROM profile WHERE category = ? AND fact = ? ORDER BY id DESC LIMIT 1').get(fact.category, fact.fact) as { id: number };
    return { table: 'profile', id: row.id };
  }
  if (kind === 'event') {
    const event = addMemoryEvent(payload as unknown as MemoryEventInput);
    return { table: 'events', id: event.id };
  }
  if (kind === 'project') {
    const note = addProjectNote(payload as unknown as ProjectNoteInput);
    return { table: 'project_notes', id: note.id };
  }
  if (kind === 'procedure') {
    const memory = upsertProceduralMemory(payload as unknown as ProceduralMemoryInput);
    return { table: 'procedural_memories', id: memory.id };
  }
  const fact = addTemporalMemoryFact(payload as unknown as TemporalMemoryFactInput);
  return { table: 'memory_facts', id: fact.id };
}

function normalizeCandidate(candidate: MemoryReviewCandidate): MemoryReviewCandidate {
  const payload = sanitizePayload(candidate.payload);
  const title = normalizeText(candidate.title).slice(0, 300) || candidate.kind;
  const content = normalizeText(candidate.content).slice(0, 10_000);
  const reason = normalizeText(candidate.reason).slice(0, 1_000);
  return {
    ...candidate,
    title,
    content,
    payload,
    reason,
    confidence: clampConfidence(candidate.confidence),
    importance: clampImportance(candidate.importance),
    groupKey: normalizeGroupKey(candidate.groupKey) || buildGroupKey(candidate.kind, title, content, payload),
  };
}

function rowToMemoryReviewItem(row: any): MemoryReviewItem {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    content: row.content,
    payload: safeParseObject(row.payload_json),
    reason: row.reason || '',
    group_key: row.group_key || undefined,
    confidence: Number(row.confidence ?? 0.5),
    importance: Number(row.importance ?? 5),
    source_table: row.source_table || undefined,
    source_id: row.source_id || undefined,
    chat_window_id: row.chat_window_id || undefined,
    applied_table: row.applied_table || undefined,
    applied_id: row.applied_id || undefined,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at || undefined,
  };
}

function reviewFields(): string {
  return [
    'id',
    'kind',
    'status',
    'title',
    'content',
    'payload_json',
    'reason',
    'group_key',
    'confidence',
    'importance',
    'source_table',
    'source_id',
    'chat_window_id',
    'applied_table',
    'applied_id',
    'created_at',
    'reviewed_at',
  ].join(', ');
}

function sanitizePayload(value: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return stableObject(value as Record<string, unknown>) as Record<string, unknown>;
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableObject(entry)]),
  );
}

function buildGroupKey(kind: MemoryReviewKind, title: string, content: string, payload: Record<string, unknown>): string {
  const identity = JSON.stringify({
    kind,
    title: title.toLowerCase(),
    content: content.toLowerCase(),
    payload: stableObject(payload),
  });
  return `review:${kind}:${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function normalizeGroupKey(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ':').slice(0, 160);
}

function cleanIds(ids: number[]): number[] {
  return Array.from(new Set(ids
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0)));
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(Number.isFinite(value) ? value : 5)));
}
