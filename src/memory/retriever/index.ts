import type { ConversationMode, DailyMemorySummary, MemoryEvent, ProceduralMemory, ProfileEntry, ProjectNote, RetrievedContext, TemporalMemoryFact } from '../../shared/types';
import { getImportantDailyMemorySummaries, isRawEventRetrievable, searchDailyMemorySummaries } from '../daily';
import { searchEvents, getImportantEvents } from '../episodic';
import { getImportantTemporalMemoryFacts, searchTemporalMemoryFacts } from '../graph';
import { getImportantProceduralMemories, searchProceduralMemories } from '../procedural';
import { searchProfileFacts, getHighConfidenceProfile } from '../profile';
import { searchProjectNotes, getImportantProjectNotes } from '../projects';
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
  const recentMessages = chatWindowId
    ? getChatWindowMessages(chatWindowId, recentMessageCount)
    : getRecentMessages(recentMessageCount, conversationMode);
  const chatWindow = chatWindowId ? getChatWindow(chatWindowId) : null;
  const profileFacts = collectProfileFacts(keywords, maxProfileFacts);
  const proceduralMemories = collectProceduralMemories(keywords, maxProceduralMemories);
  const temporalFacts = collectTemporalFacts(keywords, maxTemporalFacts);
  const relatedEvents = collectEvents(keywords, maxEvents);
  const dailySummaries = collectDailySummaries(keywords, maxDailySummaries);
  const projectNotes = collectProjectNotes(keywords, maxProjectNotes);

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
  const found: ProfileEntry[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    for (const fact of searchProfileFacts(keyword, 6)) {
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
  const found: MemoryEvent[] = [];
  const seen = new Set<number>();

  for (const keyword of keywords) {
    for (const event of searchEvents(keyword, 5)) {
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

function collectProceduralMemories(keywords: string[], limit: number): ProceduralMemory[] {
  const found: ProceduralMemory[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    for (const memory of searchProceduralMemories(keyword, 4)) {
      const key = `${memory.scope}:${memory.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(memory);
    }
  }

  for (const memory of getImportantProceduralMemories(7, limit)) {
    if (found.length >= limit) break;
    const key = `${memory.scope}:${memory.key}`;
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
  const found: TemporalMemoryFact[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    for (const fact of searchTemporalMemoryFacts(keyword, 5)) {
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
  const found: DailyMemorySummary[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    for (const summary of searchDailyMemorySummaries(keyword, 5)) {
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

function collectProjectNotes(keywords: string[], limit: number): ProjectNote[] {
  const found: ProjectNote[] = [];
  const seen = new Set<number>();

  for (const keyword of keywords) {
    for (const note of searchProjectNotes(keyword, 5)) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      found.push(note);
    }
  }

  for (const note of getImportantProjectNotes(6, limit)) {
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
