import { getDatabase } from '../database';

export type IndexedMemoryTable = 'messages' | 'profile' | 'events' | 'daily_memory_summaries' | 'procedural_memories' | 'memory_facts' | 'project_notes';
export type MemorySearchTerms = string | string[];

export interface MemoryIndexStats {
  messages: number;
  profile: number;
  events: number;
  daily_memory_summaries: number;
  procedural_memories: number;
  memory_facts: number;
  project_notes: number;
}

export function upsertMemoryIndex(sourceTable: IndexedMemoryTable, sourceId: number, text: string): void {
  const db = getDatabase();
  const keywords = extractIndexKeywords(text);

  if (keywords.length === 0) {
    deleteMemoryIndex(sourceTable, sourceId);
    return;
  }

  db.prepare(`
    INSERT INTO memory_index (source_table, source_id, keywords)
    VALUES (?, ?, ?)
    ON CONFLICT(source_table, source_id)
    DO UPDATE SET keywords = excluded.keywords,
                  created_at = datetime('now', 'localtime')
  `).run(sourceTable, sourceId, JSON.stringify(keywords));
}

export function deleteMemoryIndex(sourceTable: IndexedMemoryTable, sourceId: number): void {
  getDatabase()
    .prepare('DELETE FROM memory_index WHERE source_table = ? AND source_id = ?')
    .run(sourceTable, sourceId);
}

export function searchMemoryIndex(sourceTable: IndexedMemoryTable, keywords: MemorySearchTerms, limit: number = 20): number[] {
  const terms = normalizeMemorySearchTerms(keywords);
  if (terms.length === 0) return [];

  const clauses = terms.map(() => 'keywords LIKE ?').join(' OR ');
  const rows = getDatabase().prepare(`
    SELECT source_id
    FROM memory_index
    WHERE source_table = ? AND (${clauses})
    ORDER BY id DESC
    LIMIT ?
  `).all(sourceTable, ...terms.map(term => `%${term}%`), limit) as { source_id: number }[];

  return rows.map(row => row.source_id);
}

export function normalizeMemorySearchTerms(keywords: MemorySearchTerms, maxTerms = 12): string[] {
  const items = Array.isArray(keywords) ? keywords : [keywords];
  return Array.from(new Set(
    items
      .map(item => item.trim())
      .filter(Boolean)
  )).slice(0, maxTerms);
}

export function rebuildMemoryIndex(): MemoryIndexStats {
  const db = getDatabase();
  db.prepare('DELETE FROM memory_index').run();

  const stats: MemoryIndexStats = {
    messages: 0,
    profile: 0,
    events: 0,
    daily_memory_summaries: 0,
    procedural_memories: 0,
    memory_facts: 0,
    project_notes: 0,
  };

  const messages = db.prepare('SELECT id, role, content, emotion FROM messages').all() as any[];
  for (const row of messages) {
    upsertMemoryIndex('messages', row.id, `${row.role} ${row.content} ${row.emotion || ''}`);
    stats.messages += 1;
  }

  const profile = db.prepare('SELECT id, category, fact, source FROM profile').all() as any[];
  for (const row of profile) {
    upsertMemoryIndex('profile', row.id, `${row.category} ${row.fact} ${row.source || ''}`);
    stats.profile += 1;
  }

  const events = db.prepare('SELECT id, summary, detail, tags, emotion FROM events').all() as any[];
  for (const row of events) {
    upsertMemoryIndex('events', row.id, `${row.summary} ${row.detail || ''} ${row.tags || ''} ${row.emotion || ''}`);
    stats.events += 1;
  }

  const dailySummaries = db.prepare('SELECT id, date, summary, highlights, decay_stage FROM daily_memory_summaries').all() as any[];
  for (const row of dailySummaries) {
    upsertMemoryIndex('daily_memory_summaries', row.id, `${row.date} ${row.summary} ${row.highlights || ''} ${row.decay_stage || ''}`);
    stats.daily_memory_summaries += 1;
  }

  const procedural = db.prepare('SELECT id, scope, key, instruction, evidence FROM procedural_memories WHERE status = \'active\'').all() as any[];
  for (const row of procedural) {
    upsertMemoryIndex('procedural_memories', row.id, `${row.scope} ${row.key} ${row.instruction} ${row.evidence || ''}`);
    stats.procedural_memories += 1;
  }

  const facts = db.prepare('SELECT id, subject, predicate, object, summary FROM memory_facts WHERE status = \'active\' AND valid_to IS NULL').all() as any[];
  for (const row of facts) {
    upsertMemoryIndex('memory_facts', row.id, `${row.subject} ${row.predicate} ${row.object} ${row.summary}`);
    stats.memory_facts += 1;
  }

  const projectNotes = db.prepare('SELECT id, project, title, note, status, tags FROM project_notes').all() as any[];
  for (const row of projectNotes) {
    upsertMemoryIndex('project_notes', row.id, `${row.project} ${row.title} ${row.note} ${row.status} ${row.tags || ''}`);
    stats.project_notes += 1;
  }

  return stats;
}

export function extractIndexKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const words: string[] = [];

  const chineseMatches = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const phrase of chineseMatches) {
    if (phrase.length <= 16) words.push(phrase);
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= phrase.length - size; i += 1) {
        words.push(phrase.slice(i, i + size));
      }
    }
  }

  const englishMatches = normalized.match(/[a-z][a-z0-9_-]{1,}/g) || [];
  words.push(...englishMatches);

  const stopWords = new Set([
    '这个', '那个', '什么', '怎么', '可以', '我们', '他们', '你们', '一个', '一些',
    '没有', '不是', '自己', '知道', '这样', '今天', '明天', '昨天', '帮我', '需要',
    'the', 'this', 'that', 'what', 'how', 'can', 'you', 'your', 'and', 'for', 'with',
  ]);

  return Array.from(new Set(
    words
      .map(word => word.trim())
      .filter(word => word.length >= 2 && !stopWords.has(word))
  )).slice(0, 48);
}
