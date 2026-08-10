import { getDatabase } from '../database';
import { deleteMemoryIndex, upsertMemoryIndex } from '../indexer';
import { retrieveContext, extractKeywords } from '../retriever';
import * as fs from 'fs';

export type MemoryKind = 'profile' | 'procedure' | 'fact' | 'event' | 'daily' | 'project' | 'message';

export interface MemoryListOptions {
  kind?: MemoryKind | 'all';
  query?: string;
  limit?: number;
}

export interface MemoryListItem {
  id: number;
  kind: MemoryKind;
  title: string;
  content: string;
  meta: string;
  importance?: number;
  confidence?: number;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryListResult {
  items: MemoryListItem[];
  totals: Record<MemoryKind, number>;
}

export interface MemoryDebugResult {
  query: string;
  keywords: string[];
  relevanceScore: number;
  profileFacts: MemoryListItem[];
  proceduralMemories: MemoryListItem[];
  temporalFacts: MemoryListItem[];
  relatedEvents: MemoryListItem[];
  dailySummaries: MemoryListItem[];
  projectNotes: MemoryListItem[];
  recentMessages: MemoryListItem[];
}

export interface MemoryUpdatePatch {
  title?: string;
  content?: string;
  importance?: number;
  confidence?: number;
}

export interface MemoryImportCandidate {
  id: number;
  content: string;
  status: 'accepted' | 'rejected';
  reason: string;
  importance: number;
}

export interface MemoryImportPreview {
  sourcePath: string;
  contentMode: MemoryImportContentMode;
  totalRecords: number;
  assistantMessages: number;
  extractedAddMemories: number;
  accepted: MemoryImportCandidate[];
  rejected: MemoryImportCandidate[];
}

export interface MemoryImportCommitResult {
  imported: number;
  skipped: number;
}

const MAX_IMPORT_CANDIDATES = 5_000;
const MAX_IMPORTED_MEMORY_CHARS = 5_000;
export type MemoryImportContentMode = 'normal' | 'adult';

export function listMemories(options: MemoryListOptions = {}): MemoryListResult {
  const kind = options.kind || 'all';
  const query = normalizeQuery(options.query || '');
  const limit = Math.max(1, Math.min(200, options.limit || 80));
  const items: MemoryListItem[] = [];

  if (kind === 'all' || kind === 'profile') items.push(...listProfileMemories(query, limit));
  if (kind === 'all' || kind === 'procedure') items.push(...listProceduralMemories(query, limit));
  if (kind === 'all' || kind === 'fact') items.push(...listTemporalFactMemories(query, limit));
  if (kind === 'all' || kind === 'event') items.push(...listEventMemories(query, limit));
  if (kind === 'all' || kind === 'daily') items.push(...listDailySummaryMemories(query, limit));
  if (kind === 'all' || kind === 'project') items.push(...listProjectMemories(query, limit));
  if (kind === 'all' || kind === 'message') items.push(...listMessageMemories(query, limit));

  return {
    items: items
      .sort((a, b) => sortTimestamp(b) - sortTimestamp(a))
      .slice(0, limit),
    totals: getMemoryTotals(),
  };
}

export function deleteMemory(kind: MemoryKind, id: number): boolean {
  const db = getDatabase();
  const table: Record<MemoryKind, string> = {
    profile: 'profile',
    procedure: 'procedural_memories',
    fact: 'memory_facts',
    event: 'events',
    daily: 'daily_memory_summaries',
    project: 'project_notes',
    message: 'messages',
  };
  const result = db.prepare(`DELETE FROM ${table[kind]} WHERE id = ?`).run(id);
  if (result.changes > 0) deleteMemoryIndex(indexTableForKind(kind), id);
  return result.changes > 0;
}

export function updateMemory(kind: MemoryKind, id: number, patch: MemoryUpdatePatch): boolean {
  const db = getDatabase();
  const content = normalizeQuery(patch.content || '');
  const title = normalizeQuery(patch.title || '');
  const importance = patch.importance === undefined ? undefined : clampImportance(patch.importance);
  const confidence = patch.confidence === undefined ? undefined : Math.max(0, Math.min(1, patch.confidence));

  if (kind === 'profile') {
    const current = db.prepare('SELECT fact, importance, confidence FROM profile WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare(`
      UPDATE profile
      SET fact = ?,
          importance = ?,
          confidence = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(content || current.fact, importance ?? current.importance, confidence ?? current.confidence, id);
    if (result.changes > 0) {
      upsertMemoryIndex('profile', id, content || current.fact);
    }
    return result.changes > 0;
  }

  if (kind === 'event') {
    const current = db.prepare('SELECT summary, detail, importance FROM events WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare(`
      UPDATE events
      SET summary = ?,
          detail = ?,
          importance = ?
      WHERE id = ?
    `).run(title || current.summary, content || current.detail || current.summary, importance ?? current.importance, id);
    if (result.changes > 0) {
      upsertMemoryIndex('events', id, `${title || current.summary} ${content || current.detail || current.summary}`);
    }
    return result.changes > 0;
  }

  if (kind === 'procedure') {
    const current = db.prepare('SELECT key, instruction, importance, confidence FROM procedural_memories WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare(`
      UPDATE procedural_memories
      SET key = ?,
          instruction = ?,
          importance = ?,
          confidence = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(title || current.key, content || current.instruction, importance ?? current.importance, confidence ?? current.confidence, id);
    if (result.changes > 0) {
      upsertMemoryIndex('procedural_memories', id, `${title || current.key} ${content || current.instruction}`);
    }
    return result.changes > 0;
  }

  if (kind === 'fact') {
    const current = db.prepare('SELECT subject, predicate, object, summary, importance, confidence FROM memory_facts WHERE id = ?').get(id) as any;
    if (!current) return false;
    const summary = content || current.summary;
    const result = db.prepare(`
      UPDATE memory_facts
      SET summary = ?,
          importance = ?,
          confidence = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(summary, importance ?? current.importance, confidence ?? current.confidence, id);
    if (result.changes > 0) {
      upsertMemoryIndex('memory_facts', id, `${current.subject} ${current.predicate} ${current.object} ${summary}`);
    }
    return result.changes > 0;
  }

  if (kind === 'daily') {
    const current = db.prepare('SELECT summary, importance FROM daily_memory_summaries WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare(`
      UPDATE daily_memory_summaries
      SET summary = ?,
          importance = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(content || title || current.summary, importance ?? current.importance, id);
    if (result.changes > 0) {
      upsertMemoryIndex('daily_memory_summaries', id, content || title || current.summary);
    }
    return result.changes > 0;
  }

  if (kind === 'project') {
    const current = db.prepare('SELECT title, note, importance FROM project_notes WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare(`
      UPDATE project_notes
      SET title = ?,
          note = ?,
          importance = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(title || current.title, content || current.note, importance ?? current.importance, id);
    if (result.changes > 0) {
      upsertMemoryIndex('project_notes', id, `${title || current.title} ${content || current.note}`);
    }
    return result.changes > 0;
  }

  if (kind === 'message') {
    const current = db.prepare('SELECT content FROM messages WHERE id = ?').get(id) as any;
    if (!current) return false;
    const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content || current.content, id);
    if (result.changes > 0) {
      upsertMemoryIndex('messages', id, content || current.content);
    }
    return result.changes > 0;
  }

  return false;
}

export function previewChatRecordImport(sourcePath: string, contentMode: MemoryImportContentMode = 'normal'): MemoryImportPreview {
  const normalizedPath = sourcePath.trim();
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    throw new Error('聊天记录文件不存在');
  }

  const raw = fs.readFileSync(normalizedPath, 'utf8');
  const records = parseImportRecords(JSON.parse(raw));
  const assistantMessages = records.filter(item => item.role === 'assistant' && recordText(item));
  const textRecords = records.map(recordText).filter(Boolean);
  const extracted = unique(
    extractImportMemories(textRecords)
      .map(text => trimImportedMemory(normalizeQuery(text)))
      .filter(Boolean)
  ).slice(0, MAX_IMPORT_CANDIDATES);
  const accepted: MemoryImportCandidate[] = [];
  const rejected: MemoryImportCandidate[] = [];

  extracted.forEach((content, index) => {
    const rejectReason = importRejectReasonForMemory(content, contentMode);
    const candidate: MemoryImportCandidate = {
      id: index,
      content,
      status: rejectReason ? 'rejected' : 'accepted',
      reason: rejectReason || '可导入',
      importance: scoreImportedMemoryImportance(content),
    };
    if (rejectReason) rejected.push(candidate);
    else accepted.push(candidate);
  });

  return {
    sourcePath: normalizedPath,
    contentMode,
    totalRecords: records.length,
    assistantMessages: assistantMessages.length,
    extractedAddMemories: extracted.length,
    accepted,
    rejected,
  };
}

export function commitChatRecordImport(sourcePath: string, candidateIds?: number[], contentMode: MemoryImportContentMode = 'normal'): MemoryImportCommitResult {
  const preview = previewChatRecordImport(sourcePath, contentMode);
  const allow = candidateIds && candidateIds.length > 0 ? new Set(candidateIds) : undefined;
  const selected = preview.accepted.filter(candidate => !allow || allow.has(candidate.id));
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO events (date, summary, detail, tags, importance)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM events WHERE summary = ? AND detail = ?
    )
  `);

  let imported = 0;
  const insertMany = db.transaction((items: MemoryImportCandidate[]) => {
    for (const item of items) {
      const summary = `聊天记录记忆：${item.content.slice(0, 70)}`;
      const result = stmt.run(
        '2026-06-30',
        summary,
        item.content,
        JSON.stringify(['角色卡', '聊天记录']),
        item.importance,
        summary,
        item.content
      );
      if (result.changes > 0) imported += 1;
      if (result.changes > 0) {
        const row = db.prepare('SELECT id FROM events WHERE summary = ? AND detail = ?').get(summary, item.content) as { id: number } | undefined;
        if (row) upsertMemoryIndex('events', row.id, `${summary} ${item.content} 角色卡 聊天记录`);
      }
    }
  });
  insertMany(selected);

  return {
    imported,
    skipped: selected.length - imported,
  };
}

export function debugRetrieveMemory(query: string): MemoryDebugResult {
  const context = retrieveContext({
    query,
    maxProfileFacts: 12,
    maxEvents: 12,
    maxProjectNotes: 12,
    recentMessageCount: 12,
  });

  return {
    query,
    keywords: extractKeywords(query),
    relevanceScore: context.relevanceScore,
    profileFacts: context.profileFacts.map((fact, index) => ({
      id: index,
      kind: 'profile',
      title: '用户画像',
      content: fact.fact,
      meta: `confidence ${fact.confidence.toFixed(2)} · importance ${fact.importance}`,
      confidence: fact.confidence,
      importance: fact.importance,
      created_at: fact.created_at,
      updated_at: fact.updated_at,
    })),
    proceduralMemories: context.proceduralMemories.map(memory => ({
      id: memory.id,
      kind: 'procedure',
      title: `${memory.scope} / ${memory.key}`,
      content: memory.instruction,
      meta: `${memory.status} 路 confidence ${memory.confidence.toFixed(2)} 路 importance ${memory.importance}`,
      confidence: memory.confidence,
      importance: memory.importance,
      created_at: memory.created_at,
      updated_at: memory.updated_at,
    })),
    temporalFacts: context.temporalFacts.map(fact => ({
      id: fact.id,
      kind: 'fact',
      title: `${fact.subject} / ${fact.predicate}`,
      content: fact.summary,
      meta: `${fact.status} 路 confidence ${fact.confidence.toFixed(2)} 路 valid ${fact.valid_from || 'unknown'}`,
      confidence: fact.confidence,
      importance: fact.importance,
      created_at: fact.created_at,
      updated_at: fact.updated_at,
    })),
    relatedEvents: context.relatedEvents.map(event => ({
      id: event.id,
      kind: 'event',
      title: event.summary,
      content: event.detail || event.summary,
      meta: `${event.date} · recalled ${event.recalled_count}`,
      importance: event.importance,
      created_at: event.created_at,
    })),
    dailySummaries: context.dailySummaries.map(summary => ({
      id: summary.id,
      kind: 'daily',
      title: summary.date,
      content: summary.summary,
      meta: `${summary.decay_stage} 路 events ${summary.source_event_count} 路 messages ${summary.source_message_count}`,
      importance: summary.importance,
      created_at: summary.generated_at,
      updated_at: summary.updated_at,
    })),
    projectNotes: context.projectNotes.map(note => ({
      id: note.id,
      kind: 'project',
      title: `${note.project} / ${note.title}`,
      content: note.note,
      meta: `${note.status} · ${note.tags.join(', ') || 'no tags'}`,
      importance: note.importance,
      created_at: note.created_at,
      updated_at: note.updated_at,
    })),
    recentMessages: context.recentMessages.map(message => ({
      id: message.id,
      kind: 'message',
      title: message.role,
      content: message.content,
      meta: message.created_at,
      created_at: message.created_at,
    })),
  };
}

function listProfileMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE fact LIKE @like OR category LIKE @like OR source LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, category, fact, confidence, source, importance, created_at, updated_at
    FROM profile
    ${where}
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'profile',
    title: row.category,
    content: row.fact,
    meta: `${row.source || 'manual'} · confidence ${Number(row.confidence).toFixed(2)}`,
    confidence: row.confidence,
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function listEventMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE summary LIKE @like OR detail LIKE @like OR tags LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, date, summary, detail, tags, importance, recalled_count, created_at
    FROM events
    ${where}
    ORDER BY date DESC, importance DESC, id DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'event',
    title: row.summary,
    content: row.detail || row.summary,
    meta: `${row.date} · recalled ${row.recalled_count} · ${safeTags(row.tags).join(', ') || 'no tags'}`,
    importance: row.importance,
    created_at: row.created_at,
  }));
}

function listProceduralMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE key LIKE @like OR instruction LIKE @like OR evidence LIKE @like OR scope LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, scope, key, instruction, evidence, confidence, importance, status, created_at, updated_at
    FROM procedural_memories
    ${where}
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'procedure',
    title: `${row.scope} / ${row.key}`,
    content: row.instruction,
    meta: `${row.status} 路 ${row.evidence || 'no evidence'}`,
    confidence: row.confidence,
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function listTemporalFactMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE subject LIKE @like OR predicate LIKE @like OR object LIKE @like OR summary LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, subject, predicate, object, summary, confidence, importance, valid_from, valid_to, status, created_at, updated_at
    FROM memory_facts
    ${where}
    ORDER BY status ASC, importance DESC, valid_from DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'fact',
    title: `${row.subject} / ${row.predicate}`,
    content: row.summary || `${row.subject} ${row.predicate} ${row.object}`,
    meta: `${row.status} 路 valid ${row.valid_from || 'unknown'}${row.valid_to ? ` to ${row.valid_to}` : ''}`,
    confidence: row.confidence,
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function listDailySummaryMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE summary LIKE @like OR highlights LIKE @like OR date LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, date, summary, highlights, source_event_count, source_message_count, importance, decay_stage, generated_at, updated_at
    FROM daily_memory_summaries
    ${where}
    ORDER BY date DESC, importance DESC, id DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'daily',
    title: row.date,
    content: row.summary,
    meta: `${row.decay_stage} 路 events ${row.source_event_count} 路 messages ${row.source_message_count} 路 ${safeTags(row.highlights).join(', ') || 'no highlights'}`,
    importance: row.importance,
    created_at: row.generated_at,
    updated_at: row.updated_at,
  }));
}

function listProjectMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE project LIKE @like OR title LIKE @like OR note LIKE @like OR tags LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, project, title, note, status, tags, importance, created_at, updated_at
    FROM project_notes
    ${where}
    ORDER BY importance DESC, updated_at DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'project',
    title: `${row.project} / ${row.title}`,
    content: row.note,
    meta: `${row.status} · ${safeTags(row.tags).join(', ') || 'no tags'}`,
    importance: row.importance,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function listMessageMemories(query: string, limit: number): MemoryListItem[] {
  const db = getDatabase();
  const where = query ? 'WHERE content LIKE @like OR role LIKE @like' : '';
  const rows = db.prepare(`
    SELECT id, role, content, emotion, created_at
    FROM messages
    ${where}
    ORDER BY id DESC
    LIMIT @limit
  `).all({ like: `%${query}%`, limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    kind: 'message',
    title: row.role,
    content: row.content,
    meta: `${row.created_at}${row.emotion ? ` · ${row.emotion}` : ''}`,
    created_at: row.created_at,
  }));
}

function getMemoryTotals(): Record<MemoryKind, number> {
  const db = getDatabase();
  return {
    profile: countRows(db, 'profile'),
    procedure: countRows(db, 'procedural_memories'),
    fact: countRows(db, 'memory_facts'),
    event: countRows(db, 'events'),
    daily: countRows(db, 'daily_memory_summaries'),
    project: countRows(db, 'project_notes'),
    message: countRows(db, 'messages'),
  };
}

function indexTableForKind(kind: MemoryKind) {
  const table: Record<MemoryKind, 'profile' | 'procedural_memories' | 'memory_facts' | 'events' | 'daily_memory_summaries' | 'project_notes' | 'messages'> = {
    profile: 'profile',
    procedure: 'procedural_memories',
    fact: 'memory_facts',
    event: 'events',
    daily: 'daily_memory_summaries',
    project: 'project_notes',
    message: 'messages',
  };
  return table[kind];
}

function countRows(db: ReturnType<typeof getDatabase>, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
}

function safeTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

function sortTimestamp(item: MemoryListItem): number {
  const value = item.updated_at || item.created_at || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function parseImportRecords(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const source = value as Record<string, unknown>;
  for (const key of ['messages', 'records', 'items', 'data', 'conversation']) {
    if (Array.isArray(source[key])) return source[key] as any[];
  }
  return [source];
}

function recordText(item: any): string {
  if (!item || typeof item !== 'object') return '';
  for (const key of ['content', 'text', 'memory', 'summary', 'detail', 'fact', 'note']) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key];
  }
  if (typeof item.message === 'string') return item.message;
  if (item.message && typeof item.message === 'object' && typeof item.message.content === 'string') {
    return item.message.content;
  }
  return '';
}

function extractImportMemories(contents: string[]): string[] {
  const tagged = extractAddMemories(contents);
  return tagged.length > 0 ? tagged : contents;
}

function trimImportedMemory(text: string): string {
  return text.slice(0, MAX_IMPORTED_MEMORY_CHARS).trim();
}

function importRejectReasonForMemory(text: string, contentMode: MemoryImportContentMode): string {
  if (contentMode === 'adult') return text.length < 2 ? 'too short' : '';
  return rejectReasonForMemory(text);
}

function extractAddMemories(contents: string[]): string[] {
  const result: string[] = [];
  const regex = /<add:([^>]+)>/g;
  for (const content of contents) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      result.push(match[1]);
    }
  }
  return result;
}

function rejectReasonForMemory(text: string): string {
  if (text.length < 4) return '太短';
  if (text.length > 140) return '太长';
  const blocked = /锁骨|小腹|胸口|脖颈|颈窝|亲吻|亲亲|亲了|亲我|我亲|嘴唇|皮肤|腰|腿上|吃我|爱你|爱我|我也爱|妈妈|床|身体|印子|坐在我腿|贴着|蹭.*小腹|体育课换衣服/i;
  if (blocked.test(text)) return '过亲密或不适合作为长期记忆';
  return '';
}

function scoreImportedMemoryImportance(text: string): number {
  if (/感觉自己好没用|想哭|欠债|熬夜|睡不着|压力|难受/.test(text)) return 9;
  if (/记下来|喜欢|安心|照片|迟到|早起/.test(text)) return 7;
  return 6;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}
