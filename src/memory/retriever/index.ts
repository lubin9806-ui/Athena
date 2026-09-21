import type { ChatWindow, ChatWindowContext, ChatWindowHandoffContext, ConversationMode, DailyMemorySummary, MemoryEvent, ProceduralMemory, ProfileEntry, ProjectNote, RetrievedContext, TemporalMemoryFact } from '../../shared/types';
import { getImportantDailyMemorySummaries, isRawEventRetrievable, searchDailyMemorySummaries } from '../daily';
import { searchEvents, getImportantEvents } from '../episodic';
import { getImportantTemporalMemoryFacts, searchTemporalMemoryFacts } from '../graph';
import { getImportantProceduralMemories, searchProceduralMemories } from '../procedural';
import { searchProfileFacts, getHighConfidenceProfile } from '../profile';
import { searchProjectNotes, getImportantProjectNotes } from '../projects';
import { buildMemoryRetrievalEvidence, type MemoryEvidenceTarget } from '../provenance';
import { getMemoryVectorProviderId, searchMemoryIndex } from '../indexer';
import { getChatWindow, getChatWindowMessages, getRecentMessages, listPreviousPersistentChatWindows } from '../working';
import { searchProjectDocumentChunks } from '../documents';

export interface RetrieveOptions {
  query: string;
  maxProfileFacts?: number;
  maxProceduralMemories?: number;
  maxTemporalFacts?: number;
  maxEvents?: number;
  maxDailySummaries?: number;
  maxProjectNotes?: number;
  maxDocumentChunks?: number;
  recentMessageCount?: number;
  conversationMode?: ConversationMode;
  chatWindowId?: number;
  projectId?: number;
}

export interface AsyncMemoryEmbeddingProvider {
  id: string;
  minimumSimilarity?: number;
  embed(inputs: string[]): Promise<number[][]>;
  embedRetrieval?(query: string, documents: Array<{ title: string; text: string }>): Promise<number[][]>;
}

interface Scored<T> {
  item: T;
  score: number;
}

export function retrieveContext(options: RetrieveOptions): RetrievedContext {
  const {
    query,
    maxProfileFacts = 20,
    maxProceduralMemories = 6,
    maxTemporalFacts = 8,
    maxEvents = 8,
    maxDailySummaries = maxEvents,
    maxProjectNotes = 8,
    maxDocumentChunks = 8,
    recentMessageCount = 20,
    conversationMode,
    chatWindowId,
  } = options;

  const keywords = extractKeywords(query);
  const chatWindow = chatWindowId ? getChatWindow(chatWindowId) : null;
  const requestedProjectId = Number.isInteger(options.projectId) && Number(options.projectId) > 0 ? options.projectId : undefined;
  if (chatWindow?.project_id && requestedProjectId && chatWindow.project_id !== requestedProjectId) {
    throw new Error('Memory retrieval Project does not match the active chat window.');
  }
  const activeProjectId = chatWindow?.project_id || requestedProjectId || null;
  const recentMessages = chatWindowId
    ? getChatWindowMessages(chatWindowId, recentMessageCount)
    : getRecentMessages(recentMessageCount, conversationMode);
  const previousChatWindow = chatWindowId
    && chatWindow
    && !chatWindow.is_temporary
    && requestsPreviousChatHandoff(query, chatWindow.messageCount ?? recentMessages.length)
    ? selectPreviousChatWindowHandoff(chatWindowId, query)
    : null;
  const profileFacts = collectProfileFacts(keywords, maxProfileFacts);
  const proceduralMemories = collectProceduralMemories(keywords, maxProceduralMemories, activeProjectId);
  const temporalFacts = collectTemporalFacts(keywords, maxTemporalFacts);
  const relatedEvents = collectEvents(keywords, maxEvents);
  const dailySummaries = collectDailySummaries(keywords, maxDailySummaries);
  const projectNotes = collectProjectNotes(keywords, maxProjectNotes, activeProjectId);
  const documentChunks = activeProjectId && maxDocumentChunks > 0
    ? searchProjectDocumentChunks(activeProjectId, query, maxDocumentChunks)
    : [];
  const evidence = buildMemoryRetrievalEvidence(buildEvidenceTargets({
    profileFacts,
    proceduralMemories,
    temporalFacts,
    relatedEvents,
    dailySummaries,
    projectNotes,
    documentChunks,
  }));

  return {
    profileFacts,
    proceduralMemories,
    temporalFacts,
    relatedEvents,
    dailySummaries,
    projectNotes,
    documentChunks,
    recentMessages,
    chatWindow: chatWindow ? toChatWindowContext(chatWindow, recentMessages.length) : undefined,
    previousChatWindow: previousChatWindow || undefined,
    evidence,
    relevanceScore: calculateRelevanceScore(profileFacts, proceduralMemories, temporalFacts, relatedEvents, dailySummaries, projectNotes, documentChunks, keywords),
  };
}

export async function retrieveContextWithSemanticHandoff(
  options: RetrieveOptions,
  provider: AsyncMemoryEmbeddingProvider,
): Promise<RetrievedContext> {
  const context = retrieveContext(options);
  if (!options.chatWindowId || context.previousChatWindow?.matchStrategy !== 'recent') return context;

  const topicTerms = extractHandoffTopicTerms(options.query);
  if (topicTerms.length === 0) return context;
  const candidates = listPreviousPersistentChatWindows(options.chatWindowId, 24);
  if (candidates.length === 0) return context;

  try {
    const queryInput = topicTerms.join(' ');
    const documents = candidates.map(window => ({
      title: window.title,
      text: `${window.summary}\n${window.working_state_json || window.working_state}`.slice(0, 2_400),
    }));
    const inputs = [queryInput, ...documents.map(document => `${document.title}\n${document.text}`)];
    const vectors = provider.embedRetrieval
      ? await provider.embedRetrieval(queryInput, documents)
      : await provider.embed(inputs);
    if (vectors.length !== inputs.length) return context;
    const queryVector = vectors[0];
    const ranked = candidates
      .map((window, index) => ({ window, score: cosineSimilarity(queryVector, vectors[index + 1] || []) }))
      .filter(item => Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const minimumSimilarity = Math.max(0.2, Math.min(0.95, provider.minimumSimilarity ?? 0.5));
    if (!best || best.score < minimumSimilarity) return context;
    if (runnerUp && best.score - runnerUp.score < 0.02) return context;
    context.previousChatWindow = {
      ...toChatWindowContext(best.window),
      matchStrategy: 'semantic',
      matchScore: Number(best.score.toFixed(4)),
      matchedTerms: [],
    };
  } catch {
    // Semantic recall is optional. Keyword/topic retrieval remains the truthful fallback.
  }
  return context;
}

export function requestsPreviousChatHandoff(query: string, currentWindowMessageCount: number): boolean {
  const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized || currentWindowMessageCount > 1) return false;

  const explicitPreviousChat = [
    /(?:上次|上回|上一(?:次|轮)|上个(?:聊天|对话|话题)).{0,18}(?:聊|说|谈|讨论|提到|继续|接着|没说完|内容|进度|决定|方案)/,
    /(?:继续|接着|恢复|回到).{0,12}(?:上次|上回|上一(?:次|轮)|上个(?:聊天|对话|话题))/,
    /之前.{0,12}(?:聊|说|谈|讨论|提到|决定|约定).{0,18}(?:继续|接着|内容|话题|方案|进度|是什么|什么)/,
    /(?:之前|以前).{0,12}(?:聊过|说过|谈过|讨论过|提到过|决定过|约定过)/,
    /(?:继续|接着|恢复|回到).{0,18}之前.{0,12}(?:聊|说|谈|讨论|提到|决定|约定)/,
    /(?:continue|resume|pick up).{0,24}(?:last time|previous (?:chat|conversation)|where we left off)/,
    /(?:what|where).{0,18}(?:did we|we).{0,18}(?:last time|previously|leave off)/,
  ].some(pattern => pattern.test(normalized));
  if (explicitPreviousChat) return true;

  return /^(?:(?:那|好|好的|嗯|我们)\s*)?(?:继续|接着)(?:说|聊|谈|讨论)?(?:吧|下去)?[。！？.!?]*$/.test(normalized)
    || /^(?:continue|resume|pick up)(?: where we left off)?[.!?]*$/.test(normalized);
}

function toChatWindowContext(window: ChatWindow, fallbackMessageCount = 0): ChatWindowContext {
  return {
    id: window.id,
    title: window.title,
    summary: window.summary,
    workingStateJson: window.working_state_json || window.working_state || '{}',
    messageCount: window.messageCount ?? fallbackMessageCount,
    updatedAt: window.updated_at,
    isTemporary: window.is_temporary === true,
    projectId: window.project_id,
    projectTitle: window.projectTitle,
    projectInstructions: window.projectInstructions,
    projectInstructionsSnapshot: window.projectInstructionsSnapshot,
  };
}

function selectPreviousChatWindowHandoff(currentWindowId: number, query: string): ChatWindowHandoffContext | null {
  const candidates = listPreviousPersistentChatWindows(currentWindowId, 24);
  if (candidates.length === 0) return null;

  const topicTerms = extractHandoffTopicTerms(query);
  let bestTopic: { window: ChatWindow; score: number; matchedTerms: string[] } | null = null;
  for (const window of candidates) {
    const title = window.title.toLowerCase();
    const searchable = `${window.title}\n${window.summary}\n${window.working_state_json || window.working_state}`.toLowerCase();
    const matchedTerms = topicTerms.filter(term => searchable.includes(term));
    const score = matchedTerms.reduce((sum, term) => (
      sum + Math.min(12, Array.from(term).length) + (title.includes(term) ? 4 : 0)
    ), 0);
    if (score >= 3 && (!bestTopic || score > bestTopic.score)) {
      bestTopic = { window, score, matchedTerms };
    }
  }

  if (!bestTopic && topicTerms.length > 0 && getMemoryVectorProviderId() !== 'local-hash-ngram') {
    const candidateById = new Map(candidates.map(window => [window.id, window]));
    const semanticWindowId = searchMemoryIndex(
      'chat_windows',
      topicTerms,
      candidates.length + 1,
      { projectId: candidates[0].project_id || null, includeGlobal: false },
    ).find(id => candidateById.has(id));
    const semanticWindow = semanticWindowId ? candidateById.get(semanticWindowId) : undefined;
    if (semanticWindow) {
      return {
        ...toChatWindowContext(semanticWindow),
        matchStrategy: 'semantic',
        matchScore: 1,
        matchedTerms: [],
      };
    }
  }

  const selected = bestTopic || { window: candidates[0], score: 0, matchedTerms: [] };
  return {
    ...toChatWindowContext(selected.window),
    matchStrategy: bestTopic ? 'topic' : 'recent',
    matchScore: selected.score,
    matchedTerms: selected.matchedTerms.slice(0, 6),
  };
}

function extractHandoffTopicTerms(query: string): string[] {
  const stripped = query
    .toLowerCase()
    .replace(/你还记得|还记得|是否记得|能否回忆|回忆一下/g, ' ')
    .replace(/继续|接着|恢复|回到/g, ' ')
    .replace(/上次|上回|上一(?:次|轮)|上个(?:聊天|对话|话题)|之前|以前/g, ' ')
    .replace(/没说完|聊过|说过|谈过|讨论过|提到过|决定过|约定过/g, ' ')
    .replace(/的话题|的内容|的进度|聊|说|谈|讨论|提到|决定|约定|关于|我们|这个|那个|什么|吗|吧/g, ' ')
    .replace(/[，。！？、,.!?;；:：()（）[\]{}]/g, ' ');
  const terms = extractKeywords(stripped)
    .filter(term => !['内容', '话题', '进度', '没有', '记得', '回忆', 'where', 'left', 'off'].includes(term))
    .sort((left, right) => Array.from(right).length - Array.from(left).length);
  const compact: string[] = [];
  for (const term of terms) {
    if (compact.some(existing => existing.includes(term))) continue;
    compact.push(term);
    if (compact.length >= 12) break;
  }
  return compact;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function extractKeywords(message: string): string[] {
  const chineseMatches = message.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const englishMatches = message.match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g) || [];
  const stopWords = new Set([
    '这个', '那个', '什么', '怎么', '可以', '我们', '他们', '你们', '一个', '一些',
    '没有', '不是', '自己', '知道', '这样', '今天', '明天', '昨天', '帮我', '需要',
    'the', 'this', 'that', 'what', 'how', 'can', 'you', 'your', 'and', 'for', 'with',
  ]);

  const groups = [
    ...chineseMatches.map(buildBalancedChineseNgrams),
    englishMatches.map(word => word.toLowerCase()),
  ];
  return collectBalancedKeywords(groups, stopWords, 32);
}

function buildBalancedChineseNgrams(phrase: string): string[] {
  const words: string[] = phrase.length <= 16 ? [phrase] : [];
  const maxStart = Math.max(0, phrase.length - 2);
  const positions: number[] = [];
  for (let offset = 0; offset <= maxStart; offset += 1) {
    const head = offset;
    const tail = maxStart - offset;
    if (!positions.includes(head)) positions.push(head);
    if (!positions.includes(tail)) positions.push(tail);
    if (positions.length >= maxStart + 1) break;
  }
  for (const index of positions) {
    for (let size = 2; size <= 4 && index + size <= phrase.length; size += 1) {
      words.push(phrase.slice(index, index + size));
    }
  }
  return words;
}

function collectBalancedKeywords(groups: string[][], stopWords: Set<string>, maxTerms: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const maxGroupLength = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < maxGroupLength && result.length < maxTerms; index += 1) {
    for (const group of groups) {
      const word = group[index]?.trim();
      if (!word || word.length < 2 || stopWords.has(word) || seen.has(word)) continue;
      seen.add(word);
      result.push(word);
      if (result.length >= maxTerms) break;
    }
  }
  return result;
}

function collectProfileFacts(keywords: string[], limit: number): ProfileEntry[] {
  if (limit <= 0) return [];
  const found: ProfileEntry[] = [];
  const seen = new Set<string>();

  if (keywords.length > 0) {
    for (const fact of searchProfileFacts(keywords, candidateSearchLimit(limit))) {
      if (seen.has(fact.fact)) continue;
      seen.add(fact.fact);
      found.push(fact);
    }
  }

  for (const fact of getHighConfidenceProfile(0.4, limit)) {
    if (found.length >= limit) break;
    if (seen.has(fact.fact)) continue;
    seen.add(fact.fact);
    found.push(fact);
  }

  return scoreAndSort(found, keywords, fact => fact.fact, fact => fact.importance + fact.confidence * 5)
    .slice(0, limit)
    .map(item => item.item);
}

function collectEvents(keywords: string[], limit: number): MemoryEvent[] {
  if (limit <= 0) return [];
  const found: MemoryEvent[] = [];
  const seen = new Set<number>();

  if (keywords.length > 0) {
    for (const event of searchEvents(keywords, candidateSearchLimit(limit))) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      found.push(event);
    }
  }

  for (const event of getImportantEvents(6, limit)) {
    if (found.length >= limit) break;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    found.push(event);
  }

  const retrievable = found.filter(event => isRawEventRetrievable(event.date, event.importance));

  return scoreAndSort(
    retrievable,
    keywords,
    event => `${event.summary} ${event.detail || ''} ${event.tags.join(' ')}`,
    event => event.importance
  ).slice(0, limit).map(item => item.item);
}

function collectProceduralMemories(keywords: string[], limit: number, projectId: number | null): ProceduralMemory[] {
  if (limit <= 0) return [];
  const found: ProceduralMemory[] = [];
  const seen = new Set<string>();

  if (keywords.length > 0) {
    for (const memory of searchProceduralMemories(keywords, candidateSearchLimit(limit), projectId)) {
      const key = `${memory.scope}:${memory.project_id || 'global'}:${memory.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(memory);
    }
  }

  for (const memory of getImportantProceduralMemories(7, limit, projectId)) {
    if (found.length >= limit) break;
    const key = `${memory.scope}:${memory.project_id || 'global'}:${memory.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(memory);
  }

  return scoreAndSort(
    found,
    keywords,
    memory => `${memory.scope} ${memory.key} ${memory.instruction} ${memory.evidence || ''}`,
    memory => memory.importance + memory.confidence * 3
  ).slice(0, limit).map(item => item.item);
}

function collectTemporalFacts(keywords: string[], limit: number): TemporalMemoryFact[] {
  if (limit <= 0) return [];
  const found: TemporalMemoryFact[] = [];
  const seen = new Set<string>();

  if (keywords.length > 0) {
    for (const fact of searchTemporalMemoryFacts(keywords, candidateSearchLimit(limit))) {
      const key = `${fact.subject}:${fact.predicate}:${fact.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(fact);
    }
  }

  for (const fact of getImportantTemporalMemoryFacts(7, limit)) {
    if (found.length >= limit) break;
    const key = `${fact.subject}:${fact.predicate}:${fact.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(fact);
  }

  return scoreAndSort(
    found,
    keywords,
    fact => `${fact.subject} ${fact.predicate} ${fact.object} ${fact.summary}`,
    fact => fact.importance + fact.confidence * 3
  ).slice(0, limit).map(item => item.item);
}

function collectDailySummaries(keywords: string[], limit: number): DailyMemorySummary[] {
  if (limit <= 0) return [];
  const found: DailyMemorySummary[] = [];
  const seen = new Set<string>();

  if (keywords.length > 0) {
    for (const summary of searchDailyMemorySummaries(keywords, candidateSearchLimit(limit))) {
      if (seen.has(summary.date)) continue;
      seen.add(summary.date);
      found.push(summary);
    }
  }

  for (const summary of getImportantDailyMemorySummaries(6, limit)) {
    if (found.length >= limit) break;
    if (seen.has(summary.date)) continue;
    seen.add(summary.date);
    found.push(summary);
  }

  return scoreAndSort(
    found,
    keywords,
    summary => `${summary.date} ${summary.summary} ${summary.highlights.join(' ')}`,
    summary => summary.importance
  ).slice(0, limit).map(item => item.item);
}

function collectProjectNotes(keywords: string[], limit: number, projectId: number | null): ProjectNote[] {
  if (limit <= 0) return [];
  const found: ProjectNote[] = [];
  const seen = new Set<number>();

  if (keywords.length > 0) {
    for (const note of searchProjectNotes(keywords, candidateSearchLimit(limit), projectId)) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      found.push(note);
    }
  }

  for (const note of getImportantProjectNotes(6, limit, projectId)) {
    if (found.length >= limit) break;
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    found.push(note);
  }

  return scoreAndSort(
    found,
    keywords,
    note => `${note.project} ${note.title} ${note.note} ${note.tags.join(' ')}`,
    note => note.importance
  ).slice(0, limit).map(item => item.item);
}

function buildEvidenceTargets(context: {
  profileFacts: ProfileEntry[];
  proceduralMemories: ProceduralMemory[];
  temporalFacts: TemporalMemoryFact[];
  relatedEvents: MemoryEvent[];
  dailySummaries: DailyMemorySummary[];
  projectNotes: ProjectNote[];
  documentChunks: import('../../shared/types').ProjectDocumentChunk[];
}): MemoryEvidenceTarget[] {
  return [
    ...context.profileFacts.filter(fact => fact.id).map(fact => ({
      memoryTable: 'profile', memoryId: fact.id as number, memoryKind: 'profile' as const, excerpt: fact.fact,
    })),
    ...context.proceduralMemories.map(memory => ({
      memoryTable: 'procedural_memories', memoryId: memory.id, memoryKind: 'procedure' as const,
      projectId: memory.project_id, excerpt: memory.instruction, legacy: memory.scope === 'project' && !memory.project_id,
    })),
    ...context.temporalFacts.map(fact => ({
      memoryTable: 'memory_facts', memoryId: fact.id, memoryKind: 'fact' as const, excerpt: fact.summary,
    })),
    ...context.relatedEvents.map(event => ({
      memoryTable: 'events', memoryId: event.id, memoryKind: 'event' as const, excerpt: event.summary,
    })),
    ...context.dailySummaries.map(summary => ({
      memoryTable: 'daily_memory_summaries', memoryId: summary.id, memoryKind: 'daily' as const, excerpt: summary.summary,
    })),
    ...context.projectNotes.map(note => ({
      memoryTable: 'project_notes', memoryId: note.id, memoryKind: 'project' as const,
      projectId: note.project_id, excerpt: note.note, legacy: !note.project_id,
    })),
    ...context.documentChunks.map(chunk => ({
      memoryTable: 'project_document_chunks', memoryId: chunk.id, memoryKind: 'document' as const,
      projectId: chunk.project_id, excerpt: `${chunk.document_name} ${chunk.locator}: ${chunk.text}`,
    })),
  ];
}

function candidateSearchLimit(limit: number): number {
  return Math.max(limit, Math.min(50, limit * 3));
}

function scoreAndSort<T>(
  items: T[],
  keywords: string[],
  textOf: (item: T) => string,
  baseScoreOf: (item: T) => number
): Scored<T>[] {
  return items
    .map(item => ({
      item,
      score: baseScoreOf(item) + keywordMatchScore(textOf(item), keywords) * 4,
    }))
    .sort((a, b) => b.score - a.score);
}

function keywordMatchScore(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 1;
  }
  return score;
}

function calculateRelevanceScore(
  profileFacts: ProfileEntry[],
  proceduralMemories: ProceduralMemory[],
  temporalFacts: TemporalMemoryFact[],
  events: MemoryEvent[],
  dailySummaries: DailyMemorySummary[],
  projectNotes: ProjectNote[],
  documentChunks: import('../../shared/types').ProjectDocumentChunk[],
  keywords: string[]
): number {
  const profileScore = profileFacts.reduce((sum, fact) => sum + keywordMatchScore(fact.fact, keywords) * fact.confidence, 0);
  const proceduralScore = proceduralMemories.reduce((sum, memory) => sum + keywordMatchScore(`${memory.key} ${memory.instruction}`, keywords) * memory.confidence, 0);
  const temporalScore = temporalFacts.reduce((sum, fact) => sum + keywordMatchScore(`${fact.subject} ${fact.predicate} ${fact.object} ${fact.summary}`, keywords) * fact.confidence, 0);
  const eventScore = events.reduce((sum, event) => sum + keywordMatchScore(`${event.summary} ${event.detail || ''}`, keywords) * 0.8, 0);
  const dailyScore = dailySummaries.reduce((sum, summary) => sum + keywordMatchScore(`${summary.summary} ${summary.highlights.join(' ')}`, keywords) * 0.6, 0);
  const projectScore = projectNotes.reduce((sum, note) => sum + keywordMatchScore(`${note.project} ${note.title} ${note.note}`, keywords), 0);
  const documentScore = documentChunks.reduce((sum, chunk) => sum + keywordMatchScore(`${chunk.document_name} ${chunk.locator} ${chunk.text}`, keywords), 0);
  return Math.min(1, (profileScore + proceduralScore + temporalScore + eventScore + dailyScore + projectScore + documentScore) / 10);
}
