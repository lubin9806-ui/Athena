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

export interface MemoryVectorProvider {
  id: string;
  dimensions: number;
  vectorize(text: string): number[] | null;
}

const SEMANTIC_VECTOR_DIMENSIONS = 64;
const SEMANTIC_SCAN_LIMIT = 750;

let memoryVectorProvider: MemoryVectorProvider | null = null;

export function setMemoryVectorProvider(provider: MemoryVectorProvider | null): void {
  memoryVectorProvider = provider && provider.dimensions > 0 ? provider : null;
}

export function getMemoryVectorProviderId(): string {
  return memoryVectorProvider?.id || 'local-hash-ngram';
}

export function upsertMemoryIndex(sourceTable: IndexedMemoryTable, sourceId: number, text: string): void {
  const db = getDatabase();
  const keywords = extractIndexKeywords(text);
  const semanticVector = buildSemanticVector(text);

  if (keywords.length === 0) {
    deleteMemoryIndex(sourceTable, sourceId);
    return;
  }

  db.prepare(`
    INSERT INTO memory_index (source_table, source_id, keywords, semantic_vector)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_table, source_id)
    DO UPDATE SET keywords = excluded.keywords,
                  semantic_vector = excluded.semantic_vector,
                  created_at = datetime('now', 'localtime')
  `).run(sourceTable, sourceId, JSON.stringify(keywords), JSON.stringify(semanticVector));
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
  const exactRows = getDatabase().prepare(`
    SELECT source_id, keywords, semantic_vector
    FROM memory_index
    WHERE source_table = ? AND (${clauses})
    ORDER BY id DESC
    LIMIT ?
  `).all(sourceTable, ...terms.map(term => `%${term}%`), Math.max(limit, Math.min(120, limit * 4))) as MemoryIndexRow[];

  const semanticRows = getDatabase().prepare(`
    SELECT source_id, keywords, semantic_vector
    FROM memory_index
    WHERE source_table = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(sourceTable, SEMANTIC_SCAN_LIMIT) as MemoryIndexRow[];

  const queryVector = buildSemanticVector(terms.join(' '));
  const scored = new Map<number, number>();
  for (const row of exactRows) {
    scored.set(row.source_id, Math.max(scored.get(row.source_id) ?? 0, 10 + keywordScore(row.keywords, terms)));
  }
  for (const row of semanticRows) {
    const vector = parseSemanticVector(row.semantic_vector || row.keywords);
    const semanticScore = cosineSimilarity(queryVector, vector);
    if (semanticScore < 0.2) continue;
    const score = semanticScore * 8 + keywordScore(row.keywords, terms);
    scored.set(row.source_id, Math.max(scored.get(row.source_id) ?? 0, score));
  }

  return Array.from(scored.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
    .map(([sourceId]) => sourceId);
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

interface MemoryIndexRow {
  source_id: number;
  keywords: string;
  semantic_vector?: string;
}

function keywordScore(keywordsJson: string, terms: string[]): number {
  const text = keywordsJson.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function buildSemanticVector(text: string): number[] {
  const providerVector = buildProviderVector(text);
  if (providerVector) return providerVector;

  const vector = Array.from({ length: SEMANTIC_VECTOR_DIMENSIONS }, () => 0);
  const features = semanticFeatures(text);
  for (const feature of features) {
    vector[hashFeature(feature) % SEMANTIC_VECTOR_DIMENSIONS] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map(value => Number((value / magnitude).toFixed(6))) : vector;
}

function buildProviderVector(text: string): number[] | null {
  if (!memoryVectorProvider) return null;
  try {
    const vector = memoryVectorProvider.vectorize(text);
    if (!vector) return null;
    return normalizeVector(vector, memoryVectorProvider.dimensions);
  } catch {
    return null;
  }
}

function normalizeVector(vector: number[], dimensions: number): number[] | null {
  const safeDimensions = Math.max(1, Math.min(4096, Math.round(dimensions)));
  if (!Array.isArray(vector) || vector.length < safeDimensions) return null;
  const folded = Array.from({ length: SEMANTIC_VECTOR_DIMENSIONS }, () => 0);
  vector.slice(0, safeDimensions).forEach((value, index) => {
    folded[index % SEMANTIC_VECTOR_DIMENSIONS] += Number.isFinite(value) ? value : 0;
  });
  const magnitude = Math.sqrt(folded.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? folded.map(value => Number((value / magnitude).toFixed(6))) : null;
}

function semanticFeatures(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const features: string[] = [];
  const words = normalized.match(/[a-z][a-z0-9_-]{1,}/g) || [];
  features.push(...words);
  const cjkPhrases = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const phrase of cjkPhrases) {
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i <= phrase.length - size; i += 1) {
        features.push(phrase.slice(i, i + size));
      }
    }
  }
  return features.slice(0, 600);
}

function parseSemanticVector(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
      return parsed.slice(0, SEMANTIC_VECTOR_DIMENSIONS);
    }
  } catch {
    // Older rows may only have keyword JSON; rebuild a vector from that text.
  }
  return buildSemanticVector(value);
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < SEMANTIC_VECTOR_DIMENSIONS; index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function hashFeature(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
