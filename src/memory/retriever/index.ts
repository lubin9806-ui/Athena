import type { ConversationMode, DailyMemorySummary, MemoryEvent, ProceduralMemory, ProfileEntry, ProjectNote, RetrievedContext, TemporalMemoryFact } from '../../shared/types';
import { getImportantDailyMemorySummaries, isRawEventRetrievable, searchDailyMemorySummaries } from '../daily';
import { searchEvents, getImportantEvents } from '../episodic';
import { getImportantTemporalMemoryFacts, searchTemporalMemoryFacts } from '../graph';
import { getImportantProceduralMemories, searchProceduralMemories } from '../procedural';
import { searchProfileFacts, getHighConfidenceProfile } from '../profile';
import { searchProjectNotes, getImportantProjectNotes } from '../projects';
import { buildMemoryRetrievalEvidence, type MemoryEvidenceTarget } from '../provenance';
import { getChatWindow, getChatWindowMessages, getRecentMessages } from '../working';

export interface RetrieveOptions {
  query: string;
  maxProfileFacts?: number;
  maxProceduralMemories?: number;
  maxTemporalFacts?: number;
  maxEvents?: number;
  maxDailySummaries?: number;
  maxProjectNotes?: number;
  recentMessageCount?: number;
  conversationMode?: ConversationMode;
  chatWindowId?: number;
  projectId?: number;
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
  const profileFacts = collectProfileFacts(keywords, maxProfileFacts);
  const proceduralMemories = collectProceduralMemories(keywords, maxProceduralMemories, activeProjectId);
  const temporalFacts = collectTemporalFacts(keywords, maxTemporalFacts);
  const relatedEvents = collectEvents(keywords, maxEvents);
  const dailySummaries = collectDailySummaries(keywords, maxDailySummaries);
  const projectNotes = collectProjectNotes(keywords, maxProjectNotes, activeProjectId);
  const evidence = buildMemoryRetrievalEvidence(buildEvidenceTargets({
    profileFacts,
    proceduralMemories,
    temporalFacts,
    relatedEvents,
    dailySummaries,
    projectNotes,
  }));

  return {
    profileFacts,
    proceduralMemories,
    temporalFacts,
    relatedEvents,
    dailySummaries,
    projectNotes,
    recentMessages,
    chatWindow: chatWindow ? {
      id: chatWindow.id,
      title: chatWindow.title,
      summary: chatWindow.summary,
      workingStateJson: chatWindow.working_state_json || chatWindow.working_state || '{}',
      messageCount: chatWindow.messageCount ?? recentMessages.length,
      updatedAt: chatWindow.updated_at,
      isTemporary: chatWindow.is_temporary === true,
      projectId: chatWindow.project_id,
      projectTitle: chatWindow.projectTitle,
      projectInstructions: chatWindow.projectInstructions,
      projectInstructionsSnapshot: chatWindow.projectInstructionsSnapshot,
    } : undefined,
    evidence,
    relevanceScore: calculateRelevanceScore(profileFacts, proceduralMemories, temporalFacts, relatedEvents, dailySummaries, projectNotes, keywords),
  };
}

export function extractKeywords(message: string): string[] {
  const words: string[] = [];

  const chineseMatches = message.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const phrase of chineseMatches) {
    if (phrase.length <= 16) words.push(phrase);
    for (let size = 2; size <= 4; size++) {
      for (let i = 0; i <= phrase.length - size; i++) {
        words.push(phrase.slice(i, i + size));
      }
    }
  }

  const englishMatches = message.match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g) || [];
  words.push(...englishMatches.map(word => word.toLowerCase()));

  const stopWords = new Set([
    '这个', '那个', '什么', '怎么', '可以', '我们', '他们', '你们', '一个', '一些',
    '没有', '不是', '自己', '知道', '这样', '今天', '明天', '昨天', '帮我', '需要',
    'the', 'this', 'that', 'what', 'how', 'can', 'you', 'your', 'and', 'for', 'with',
  ]);

  return Array.from(new Set(
    words
      .map(word => word.trim())
      .filter(word => word.length >= 2 && !stopWords.has(word))
  )).slice(0, 32);
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
  keywords: string[]
): number {
  const profileScore = profileFacts.reduce((sum, fact) => sum + keywordMatchScore(fact.fact, keywords) * fact.confidence, 0);
  const proceduralScore = proceduralMemories.reduce((sum, memory) => sum + keywordMatchScore(`${memory.key} ${memory.instruction}`, keywords) * memory.confidence, 0);
  const temporalScore = temporalFacts.reduce((sum, fact) => sum + keywordMatchScore(`${fact.subject} ${fact.predicate} ${fact.object} ${fact.summary}`, keywords) * fact.confidence, 0);
  const eventScore = events.reduce((sum, event) => sum + keywordMatchScore(`${event.summary} ${event.detail || ''}`, keywords) * 0.8, 0);
  const dailyScore = dailySummaries.reduce((sum, summary) => sum + keywordMatchScore(`${summary.summary} ${summary.highlights.join(' ')}`, keywords) * 0.6, 0);
  const projectScore = projectNotes.reduce((sum, note) => sum + keywordMatchScore(`${note.project} ${note.title} ${note.note}`, keywords), 0);
  return Math.min(1, (profileScore + proceduralScore + temporalScore + eventScore + dailyScore + projectScore) / 10);
}
