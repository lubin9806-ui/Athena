import type { ProfileCategory } from '../../shared/types';
import type { MemoryEventInput } from '../episodic';
import type { ProceduralMemoryInput } from '../procedural';
import type { ProfileFactInput } from '../profile';
import type { ProjectNoteInput } from '../projects';
import type { TemporalMemoryFactInput } from '../graph';

export interface ExtractedMemory {
  profileFacts: ProfileFactInput[];
  event?: MemoryEventInput;
  projectNote?: ProjectNoteInput;
  proceduralMemories: ProceduralMemoryInput[];
  temporalFacts: TemporalMemoryFactInput[];
}

export function extractMemoryFromUserMessage(message: string): ExtractedMemory {
  const clean = cleanMemoryText(message);
  return {
    profileFacts: extractProfileFacts(clean),
    event: extractEvent(clean),
    projectNote: extractProjectNote(clean),
    proceduralMemories: extractProceduralMemories(clean),
    temporalFacts: extractTemporalFacts(clean),
  };
}

function extractProfileFacts(message: string): ProfileFactInput[] {
  const facts: ProfileFactInput[] = [];
  const patterns: { category: ProfileCategory; regex: RegExp; label: string; importance: number }[] = [
    { category: 'preference', regex: /(?:我|本人|俺)(?:喜欢|爱|偏好|更喜欢|最喜欢)(.+)/i, label: '用户喜欢', importance: 7 },
    { category: 'preference', regex: /(?:我|本人|俺)(?:不喜欢|讨厌|不想要)(.+)/i, label: '用户不喜欢', importance: 7 },
    { category: 'identity', regex: /(?:我|本人|俺)(?:是|叫|来自|住在)(.+)/i, label: '用户', importance: 8 },
    { category: 'habit', regex: /(?:我|本人|俺)(?:习惯|经常|通常|每天|每晚)(.+)/i, label: '用户习惯', importance: 6 },
    { category: 'project', regex: /(?:我|本人|俺)(?:正在|在做|计划做|想做|准备做)(.+)/i, label: '用户正在推进', importance: 6 },
    { category: 'health', regex: /(?:我|本人|俺)(?:累|困|焦虑|头疼|不舒服|睡不着)(.*)/i, label: '用户状态', importance: 6 },
    { category: 'preference', regex: /\b(?:i like|i love|my favorite is|i prefer)\s+(.+)/i, label: '用户喜欢', importance: 7 },
    { category: 'identity', regex: /\b(?:i am|i'm|my name is|i live in)\s+(.+)/i, label: '用户', importance: 8 },
    { category: 'habit', regex: /\b(?:i usually|i often|i always)\s+(.+)/i, label: '用户习惯', importance: 6 },
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (!match) continue;
    const value = cleanMemoryText(match[1] || match[0]);
    if (value.length < 2 || value.length > 120) continue;
    facts.push({
      category: pattern.category,
      fact: `${pattern.label}${value}`,
      confidence: 0.55,
      source: 'auto',
      importance: pattern.importance,
    });
  }

  if (/记住|remember this|please remember/i.test(message)) {
    facts.push({
      category: 'preference',
      fact: `用户明确要求记住：${message.slice(0, 120)}`,
      confidence: 0.75,
      source: 'explicit',
      importance: 8,
    });
  }

  return facts;
}

function extractProjectNote(message: string): ProjectNoteInput | undefined {
  const isProjectLike = /Athena|项目|工程|功能|需求|bug|修复|计划|路线图|todo|待办|实现|开发|project|feature|roadmap|fix/i.test(message);
  if (!isProjectLike) return undefined;

  const projectMatch = message.match(/(?:项目|project)\s*[:：]?\s*([A-Za-z0-9_\-\u4e00-\u9fff]{2,24})/i);
  const project = projectMatch?.[1] || (message.includes('Athena') ? 'Athena' : 'General');

  return {
    project,
    title: inferProjectTitle(message),
    note: message.slice(0, 240),
    tags: extractTags(message),
    importance: /重要|必须|关键|urgent|important|blocker|核心/i.test(message) ? 8 : 6,
  };
}

function extractEvent(message: string): MemoryEventInput | undefined {
  const isMemorable = /今天|昨天|刚刚|完成|决定|遇到|解决|发布|上线|失败|卡住|重要|记住|finished|decided|fixed|blocked|released/i.test(message);
  if (!isMemorable || message.length < 6) return undefined;

  return {
    date: new Date().toISOString().slice(0, 10),
    summary: message.slice(0, 80),
    detail: message.slice(0, 240),
    tags: extractTags(message),
    importance: /重要|关键|卡住|失败|blocker|important|urgent/i.test(message) ? 8 : 6,
  };
}

function extractProceduralMemories(message: string): ProceduralMemoryInput[] {
  const memories: ProceduralMemoryInput[] = [];
  const patterns: Array<{ regex: RegExp; key: string; importance: number }> = [
    { regex: /(?:以后|以後|下次|之后|之後|今后|今後).{0,12}(?:你|Athena|助手).{0,12}(?:要|应该|應該|记得|記得|优先|優先)(.+)/i, key: 'future collaboration rule', importance: 8 },
    { regex: /(?:when i say|next time|from now on|please always|remember to)\s+(.+)/i, key: 'future collaboration rule', importance: 8 },
    { regex: /(?:测试|test).{0,16}(?:就|时|時).{0,16}(?:跑|执行|執行|run)(.+)/i, key: 'testing workflow', importance: 7 },
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (!match) continue;
    const instruction = cleanMemoryText(match[1] || match[0]).slice(0, 800);
    if (instruction.length < 4) continue;
    memories.push({
      scope: inferProceduralScope(message),
      key: pattern.key,
      instruction,
      evidence: message.slice(0, 1_000),
      confidence: 0.72,
      importance: pattern.importance,
    });
  }

  return memories;
}

function extractTemporalFacts(message: string): TemporalMemoryFactInput[] {
  const facts: TemporalMemoryFactInput[] = [];
  const patterns: Array<{ regex: RegExp; predicate: string; importance: number }> = [
    { regex: /(?:当前|現在|现在|目前)(.{2,80}?)(?:是|为|為|=)(.{2,160})/i, predicate: 'current_state', importance: 7 },
    { regex: /(?:current|active|now)\s+(.{2,80}?)\s+(?:is|=)\s+(.{2,160})/i, predicate: 'current_state', importance: 7 },
    { regex: /(.{2,80}?)(?:已经|已經|改成|变成|變成|切换到|切換到)(.{2,160})/i, predicate: 'changed_to', importance: 7 },
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (!match) continue;
    const subject = cleanMemoryText(match[1]);
    const object = cleanMemoryText(match[2]);
    if (subject.length < 2 || object.length < 2) continue;
    facts.push({
      subject,
      predicate: pattern.predicate,
      object,
      summary: `${subject} ${pattern.predicate} ${object}`,
      confidence: 0.68,
      importance: pattern.importance,
      sourceTable: 'messages',
      sourceQuote: message.slice(0, 1_000),
    });
  }

  return facts;
}

function inferProjectTitle(message: string): string {
  if (/记忆|memory/i.test(message)) return 'Memory system';
  if (/bug|修复|错误|报错|fix/i.test(message)) return 'Issue to fix';
  if (/todo|待办|计划|下一步|roadmap/i.test(message)) return 'Todo';
  if (/需求|功能|feature|实现/i.test(message)) return 'Feature request';
  if (/设计|界面|UI|视觉/i.test(message)) return 'Design note';
  return message.slice(0, 40);
}

function extractTags(message: string): string[] {
  const tags: string[] = [];
  const tagMap: [RegExp, string][] = [
    [/Athena/i, 'Athena'],
    [/记忆|memory/i, 'memory'],
    [/语音|tts|stt|voice/i, 'voice'],
    [/Live2D/i, 'live2d'],
    [/界面|UI|视觉|three/i, 'ui'],
    [/bug|修复|错误|fix/i, 'fix'],
    [/todo|待办|计划|roadmap/i, 'todo'],
  ];
  for (const [regex, tag] of tagMap) {
    if (regex.test(message)) tags.push(tag);
  }
  return Array.from(new Set(tags));
}

function inferProceduralScope(message: string): ProceduralMemoryInput['scope'] {
  if (/项目|project|Athena/i.test(message)) return 'project';
  if (/测试|test|typecheck|smoke/i.test(message)) return 'tool';
  if (/语气|风格|人格|persona/i.test(message)) return 'persona';
  return 'global';
}

function cleanMemoryText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[。.!！?？]+$/g, '');
}
