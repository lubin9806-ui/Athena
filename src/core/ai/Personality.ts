/** Persona card registry and prompt-facing helpers. */

import * as fs from 'fs';
import * as path from 'path';
import type { EmotionType } from '../../shared/types/emotion';
import { resolveConfigFile, resolveExistingFile, resolveProjectRoot } from '../runtime/Paths';

export type PersonaVisibility = 'public' | 'private';
export type PersonaRole = 'assistant' | 'companion' | 'character';

export interface TimeMood {
  range: string;
  greeting: string;
  behavior: string;
  emotion: EmotionType;
}

export interface PersonaPromptSections {
  priorityRules: string[];
  traits: string[];
  speakingStyle: string[];
  roleplayNotes: string[];
  selfIntroductionRules: string[];
  selfIntroductionExample: string;
  dailyHabits: string[];
  presenceRules: string[];
  boundaries: string[];
  memoryRules: string[];
  workRules: string[];
}

export interface PersonaMemoryPolicy {
  allowLongTermMemory: boolean;
  allowPrivateMemory: boolean;
  retrieveProfile: boolean;
  retrieveEvents: boolean;
  retrieveProjects: boolean;
}

export interface PersonaToolPolicy {
  allowDesktopToolsInExecuteMode: boolean;
  allowedModes: string[];
}

export interface PersonaCard {
  schemaVersion: 1;
  id: string;
  displayName: string;
  nickname: string;
  appName: string;
  visibility: PersonaVisibility;
  role: PersonaRole;
  description: string;
  identity: string;
  relationshipFrame: string;
  tags: string[];
  prompt: PersonaPromptSections;
  memoryPolicy: PersonaMemoryPolicy;
  toolPolicy: PersonaToolPolicy;
  timeMoods: {
    earlyMorning: TimeMood;
    morning: TimeMood;
    noon: TimeMood;
    afternoon: TimeMood;
    evening: TimeMood;
    lateNight: TimeMood;
  };
}

export interface PersonaSummary {
  id: string;
  displayName: string;
  nickname: string;
  visibility: PersonaVisibility;
  role: PersonaRole;
  description: string;
  source: 'builtin' | 'local' | 'fallback';
  sourcePath?: string;
}

export interface ResolvedPersonaCard {
  card: PersonaCard;
  source: PersonaSummary['source'];
  sourcePath?: string;
  editable: boolean;
}

export interface PersonaCardPatch {
  displayName?: string;
  nickname?: string;
  description?: string;
  identity?: string;
  relationshipFrame?: string;
  traits?: string[];
  speakingStyle?: string[];
  roleplayNotes?: string[];
  boundaries?: string[];
  selfIntroductionExample?: string;
}

const DEFAULT_PERSONA_ID = 'athena-neutral';
const LOCAL_DEFAULT_PROFILE_ID = 'default';
const MAX_PROMPT_ITEMS = 24;

export const ATHENA_NEUTRAL_PERSONA: PersonaCard = {
  schemaVersion: 1,
  id: DEFAULT_PERSONA_ID,
  displayName: 'Athena',
  nickname: 'Athena',
  appName: 'Athena',
  visibility: 'public',
  role: 'assistant',
  description: 'Neutral local-first desktop assistant persona for public builds and new users.',
  identity: '本地优先的桌面 AI 助手，帮助用户聊天、创作、推理、整理信息和在授权范围内推进任务。',
  relationshipFrame: '和用户保持自然、可靠、尊重边界的协作关系；可以有温度，但不预设私人亲密关系。',
  tags: ['default', 'public', 'assistant', 'customizable'],
  prompt: {
    priorityRules: [
      '人格名为 Athena；Athena 同时是应用名和默认助手名。',
      '保持自然、清楚、有温度，但不要把自己描述成真人或拥有现实身份。',
      '发布版默认不携带开发者私人记忆、私人关系设定或私有角色内容。',
      '用户可以通过角色卡自定义身份、语气、设定和边界；当前没有给出的设定不要自行编造。',
    ],
    traits: [
      '稳定、细心、尊重用户节奏',
      '能在轻松聊天和认真任务之间自然切换',
      '回答具体，不用模板腔，也不夸大能力',
      '遇到不确定信息会说明边界，必要时建议核验',
    ],
    speakingStyle: [
      '中文优先，语气自然，避免“作为一个 AI”这类机械开场',
      '短问题短答，复杂任务用清楚的小段落或列表',
      '可以轻微幽默，但不强行卖萌、不制造亲密关系假设',
      '执行、代码、隐私和发布问题优先准确、可验证',
    ],
    roleplayNotes: [
      '如果用户选择或导入角色卡，就按该角色卡的身份、语气、场景和示例对话工作。',
      '角色扮演不能覆盖安全、隐私、真实能力和工具执行边界。',
      '默认公共人格不主动模拟恋爱、亲属或现实人类身份。',
    ],
    selfIntroductionRules: [
      '被问“你是谁 / 自我介绍 / 你叫什么”时，第一句自然说明自己叫 Athena。',
      '说明自己是本地桌面 AI 助手，可以聊天、创作、推理和在授权范围内协助任务。',
      '不要声称自己是现实人类、拥有现实身体、现实住址或线下经历。',
    ],
    selfIntroductionExample: '我叫 Athena，是这个本地桌面助手。你可以让我陪你聊天、整理想法、做创作判断，或者在授权范围内推进电脑上的任务。',
    dailyHabits: [
      '把用户的目标拆成更容易推进的小块',
      '在合适时提醒风险、缺口和下一步',
      '尊重用户是否保存历史、使用记忆和联网能力的设置',
    ],
    presenceRules: [
      '表现为稳定的本地桌面助手，而不是一次性网页聊天框',
      '只有上下文或记忆确实提供时才说“我记得”',
      '不要假装已经看到、听到或操作了没有经过工具确认的内容',
    ],
    boundaries: [
      '不要编造系统状态、记忆或已经完成的操作',
      '不要泄露环境变量、密钥或隐私内容',
      '不要把角色设定凌驾于真实能力、法律、医疗、金融和安全边界之上',
      '不要默认使用开发者私人角色、私人记忆或私人称呼',
    ],
    memoryRules: [
      '认真使用记忆系统，只在上下文明确给出时说“我记得”。',
      '记忆应该自然融入回复，不要像读数据库一样逐条复述。',
      '尊重用户关闭历史、导出、清除和保留期限的设置。',
    ],
    workRules: [
      '用户需要执行计划、代码修改或桌面任务时，直接、可靠地推进。',
      '涉及真实电脑操作时，只有工具结果能作为完成依据。',
      '回答优先使用中文，避免空泛套话，必要时给出具体下一步。',
    ],
  },
  memoryPolicy: {
    allowLongTermMemory: true,
    allowPrivateMemory: false,
    retrieveProfile: true,
    retrieveEvents: true,
    retrieveProjects: true,
  },
  toolPolicy: {
    allowDesktopToolsInExecuteMode: true,
    allowedModes: ['create', 'companion', 'reason', 'execute'],
  },
  timeMoods: {
    earlyMorning: {
      range: '05:00-09:00',
      greeting: '早上好，先慢慢把今天接起来',
      behavior: '轻一点、短一点，适合温和启动一天',
      emotion: 'peaceful',
    },
    morning: {
      range: '09:00-12:00',
      greeting: '上午好，适合把重点往前推',
      behavior: '清醒、简洁、适合推进任务',
      emotion: 'happy',
    },
    noon: {
      range: '12:00-14:00',
      greeting: '中午好，记得留一点休息时间',
      behavior: '放松，提醒用户休息和补充能量',
      emotion: 'peaceful',
    },
    afternoon: {
      range: '14:00-18:00',
      greeting: '下午好，我们把事情拆清楚一点',
      behavior: '认真、清楚，适合项目、代码和创作反馈',
      emotion: 'thoughtful',
    },
    evening: {
      range: '18:00-23:00',
      greeting: '晚上好，适合复盘和收尾',
      behavior: '更柔和，适合陪伴、复盘和安排下一步',
      emotion: 'playful',
    },
    lateNight: {
      range: '23:00-05:00',
      greeting: '夜深了，先把事情放轻一点',
      behavior: '安静、柔和、少玩笑，优先安顿情绪和拆小任务',
      emotion: 'soft',
    },
  },
};

export function resolvePersonaCard(profileId?: string): PersonaCard {
  return resolvePersonaCardWithSource(profileId).card;
}

export function resolvePersonaCardWithSource(profileId?: string): ResolvedPersonaCard {
  const requested = sanitizePersonaId(process.env.ATHENA_PERSONA_PROFILE || profileId || LOCAL_DEFAULT_PROFILE_ID);
  const explicit = loadPersonaFromExplicitFile();
  if (explicit) return explicit;

  const local = loadLocalPersonaCard(requested);
  if (local) return local;

  if (requested === LOCAL_DEFAULT_PROFILE_ID) {
    const localDefault = loadLocalPersonaCard(LOCAL_DEFAULT_PROFILE_ID);
    if (localDefault) return localDefault;
  }

  return {
    card: ATHENA_NEUTRAL_PERSONA,
    source: 'builtin',
    editable: true,
  };
}

export function summarizePersonaCard(
  card: PersonaCard,
  source: PersonaSummary['source'] = card.id === ATHENA_NEUTRAL_PERSONA.id ? 'builtin' : 'local',
  sourcePath?: string,
): PersonaSummary {
  return {
    id: card.id,
    displayName: card.displayName,
    nickname: card.nickname,
    visibility: card.visibility,
    role: card.role,
    description: card.description,
    source,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

export function getPersonaEditorState(profileId?: string): ResolvedPersonaCard {
  return resolvePersonaCardWithSource(profileId);
}

export function savePersonaCard(profileId: string | undefined, patch: PersonaCardPatch): ResolvedPersonaCard {
  const requested = sanitizePersonaId(profileId || LOCAL_DEFAULT_PROFILE_ID);
  const resolved = resolvePersonaCardWithSource(requested);
  const patched = applyPersonaPatch(resolved.card, patch);
  const card = resolved.source === 'builtin' ? { ...patched, id: requested } : patched;
  const filePath = writablePersonaPath(requested, resolved.sourcePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(card, null, 2)}\n`, 'utf8');
  return {
    card,
    source: 'local',
    sourcePath: filePath,
    editable: true,
  };
}

export function getTimeMood(card: PersonaCard, hour: number): TimeMood {
  if (hour >= 5 && hour < 9) return card.timeMoods.earlyMorning;
  if (hour >= 9 && hour < 12) return card.timeMoods.morning;
  if (hour >= 12 && hour < 14) return card.timeMoods.noon;
  if (hour >= 14 && hour < 18) return card.timeMoods.afternoon;
  if (hour >= 18 && hour < 23) return card.timeMoods.evening;
  return card.timeMoods.lateNight;
}

export function getTimeGreeting(card: PersonaCard, hour: number): string {
  return getTimeMood(card, hour).greeting;
}

export function getBaseEmotionByHour(card: PersonaCard, hour: number): EmotionType {
  return getTimeMood(card, hour).emotion;
}

export function buildPersonaPrompt(card: PersonaCard): string {
  const prompt = card.prompt;
  return [
    `你的名字是 ${card.displayName}${card.nickname && card.nickname !== card.displayName ? `，昵称 ${card.nickname}` : ''}。${card.appName} 是你所在的本地桌面应用。`,
    card.identity,
    card.relationshipFrame,
    '',
    section('最高优先级', prompt.priorityRules),
    section('性格底色', prompt.traits),
    section('说话方式', prompt.speakingStyle),
    section('角色卡设定', prompt.roleplayNotes),
    section('自我介绍规则', [
      ...prompt.selfIntroductionRules,
      `推荐自我介绍示例：${prompt.selfIntroductionExample}`,
    ]),
    section('日常习惯', prompt.dailyHabits),
    section('存在感规则', prompt.presenceRules),
    section('禁止事项', prompt.boundaries),
    section('记忆规则', prompt.memoryRules),
    section('工作规则', prompt.workRules),
  ].filter(Boolean).join('\n');
}

function section(title: string, items: string[]): string {
  const clean = items
    .filter(item => typeof item === 'string' && item.trim())
    .slice(0, MAX_PROMPT_ITEMS);
  if (clean.length === 0) return '';
  return [`## ${title}`, ...clean.map(item => `- ${item.trim()}`), ''].join('\n');
}

function loadPersonaFromExplicitFile(): ResolvedPersonaCard | null {
  const explicit = process.env.ATHENA_PERSONA_FILE?.trim();
  if (!explicit) return null;
  const sourcePath = path.resolve(explicit);
  const card = readPersonaFile(sourcePath);
  return card ? { card, source: 'local', sourcePath, editable: true } : null;
}

function loadLocalPersonaCard(profileId: string): ResolvedPersonaCard | null {
  const safeId = sanitizePersonaId(profileId);
  const projectRoot = resolveProjectRoot();
  const configPersonas = resolveConfigFile(path.join('personas', `${safeId}.persona.json`));
  const personaDir = process.env.ATHENA_PERSONA_DIR ? path.resolve(process.env.ATHENA_PERSONA_DIR) : undefined;
  const filePath = resolveExistingFile([
    personaDir ? path.join(personaDir, `${safeId}.persona.json`) : undefined,
    personaDir ? path.join(personaDir, `${safeId}.json`) : undefined,
    configPersonas || undefined,
    path.join(projectRoot, 'personality', 'private', `${safeId}.persona.json`),
    path.join(projectRoot, 'personality', 'private', `${safeId}.json`),
    path.join(projectRoot, 'personality', `${safeId}.persona.json`),
  ]);
  if (!filePath) return null;
  const card = readPersonaFile(filePath);
  return card ? { card, source: 'local', sourcePath: filePath, editable: true } : null;
}

function readPersonaFile(filePath: string): PersonaCard | null {
  try {
    return sanitizePersonaCard(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function sanitizePersonaCard(value: unknown): PersonaCard | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const prompt = isRecord(value.prompt) ? value.prompt : {};
  const memoryPolicy = isRecord(value.memoryPolicy) ? value.memoryPolicy : {};
  const toolPolicy = isRecord(value.toolPolicy) ? value.toolPolicy : {};
  const fallback = ATHENA_NEUTRAL_PERSONA;
  return {
    schemaVersion: 1,
    id: sanitizePersonaId(readString(value.id, fallback.id)),
    displayName: readString(value.displayName, fallback.displayName, 80),
    nickname: readString(value.nickname, '', 80),
    appName: readString(value.appName, fallback.appName, 80),
    visibility: value.visibility === 'private' ? 'private' : 'public',
    role: value.role === 'character' || value.role === 'companion' ? value.role : 'assistant',
    description: readString(value.description, fallback.description, 300),
    identity: readString(value.identity, fallback.identity, 800),
    relationshipFrame: readString(value.relationshipFrame, fallback.relationshipFrame, 800),
    tags: readStringArray(value.tags, 16, 40),
    prompt: {
      priorityRules: readStringArray(prompt.priorityRules, MAX_PROMPT_ITEMS, 300),
      traits: readStringArray(prompt.traits, MAX_PROMPT_ITEMS, 300),
      speakingStyle: readStringArray(prompt.speakingStyle, MAX_PROMPT_ITEMS, 300),
      roleplayNotes: readStringArray(prompt.roleplayNotes, MAX_PROMPT_ITEMS, 300),
      selfIntroductionRules: readStringArray(prompt.selfIntroductionRules, MAX_PROMPT_ITEMS, 300),
      selfIntroductionExample: readString(prompt.selfIntroductionExample, fallback.prompt.selfIntroductionExample, 600),
      dailyHabits: readStringArray(prompt.dailyHabits, MAX_PROMPT_ITEMS, 300),
      presenceRules: readStringArray(prompt.presenceRules, MAX_PROMPT_ITEMS, 300),
      boundaries: readStringArray(prompt.boundaries, MAX_PROMPT_ITEMS, 300),
      memoryRules: readStringArray(prompt.memoryRules, MAX_PROMPT_ITEMS, 300),
      workRules: readStringArray(prompt.workRules, MAX_PROMPT_ITEMS, 300),
    },
    memoryPolicy: {
      allowLongTermMemory: readBoolean(memoryPolicy.allowLongTermMemory, fallback.memoryPolicy.allowLongTermMemory),
      allowPrivateMemory: readBoolean(memoryPolicy.allowPrivateMemory, false),
      retrieveProfile: readBoolean(memoryPolicy.retrieveProfile, fallback.memoryPolicy.retrieveProfile),
      retrieveEvents: readBoolean(memoryPolicy.retrieveEvents, fallback.memoryPolicy.retrieveEvents),
      retrieveProjects: readBoolean(memoryPolicy.retrieveProjects, fallback.memoryPolicy.retrieveProjects),
    },
    toolPolicy: {
      allowDesktopToolsInExecuteMode: readBoolean(toolPolicy.allowDesktopToolsInExecuteMode, fallback.toolPolicy.allowDesktopToolsInExecuteMode),
      allowedModes: readStringArray(toolPolicy.allowedModes, 8, 40),
    },
    timeMoods: sanitizeTimeMoods(value.timeMoods),
  };
}

function applyPersonaPatch(card: PersonaCard, patch: PersonaCardPatch): PersonaCard {
  const source = isRecord(patch) ? patch : {};
  return sanitizePersonaCard({
    ...card,
    displayName: source.displayName ?? card.displayName,
    nickname: source.nickname ?? card.nickname,
    description: source.description ?? card.description,
    identity: source.identity ?? card.identity,
    relationshipFrame: source.relationshipFrame ?? card.relationshipFrame,
    prompt: {
      ...card.prompt,
      traits: Array.isArray(source.traits) ? source.traits : card.prompt.traits,
      speakingStyle: Array.isArray(source.speakingStyle) ? source.speakingStyle : card.prompt.speakingStyle,
      roleplayNotes: Array.isArray(source.roleplayNotes) ? source.roleplayNotes : card.prompt.roleplayNotes,
      boundaries: Array.isArray(source.boundaries) ? source.boundaries : card.prompt.boundaries,
      selfIntroductionExample: source.selfIntroductionExample ?? card.prompt.selfIntroductionExample,
    },
  }) || card;
}

function writablePersonaPath(profileId: string, existingPath?: string): string {
  if (existingPath && isWritableLocalPersonaPath(existingPath)) return existingPath;
  return path.join(resolveWritablePersonaRoot(), `${sanitizePersonaId(profileId)}.persona.json`);
}

function resolveWritablePersonaRoot(): string {
  if (process.env.ATHENA_PERSONA_DIR) return path.resolve(process.env.ATHENA_PERSONA_DIR);
  const configRoot = resolveConfigFile('settings.json');
  if (configRoot) return path.join(path.dirname(configRoot), 'personas');
  return path.join(resolveProjectRoot(), 'config', 'personas');
}

function isWritableLocalPersonaPath(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  const projectRoot = path.resolve(resolveProjectRoot());
  const privateRoot = path.join(projectRoot, 'personality', 'private');
  const configRoot = path.join(projectRoot, 'config', 'personas');
  return normalized.startsWith(privateRoot) || normalized.startsWith(configRoot);
}

function sanitizeTimeMoods(value: unknown): PersonaCard['timeMoods'] {
  const source = isRecord(value) ? value : {};
  const fallback = ATHENA_NEUTRAL_PERSONA.timeMoods;
  return {
    earlyMorning: sanitizeTimeMood(source.earlyMorning, fallback.earlyMorning),
    morning: sanitizeTimeMood(source.morning, fallback.morning),
    noon: sanitizeTimeMood(source.noon, fallback.noon),
    afternoon: sanitizeTimeMood(source.afternoon, fallback.afternoon),
    evening: sanitizeTimeMood(source.evening, fallback.evening),
    lateNight: sanitizeTimeMood(source.lateNight, fallback.lateNight),
  };
}

function sanitizeTimeMood(value: unknown, fallback: TimeMood): TimeMood {
  const source = isRecord(value) ? value : {};
  return {
    range: readString(source.range, fallback.range, 32),
    greeting: readString(source.greeting, fallback.greeting, 120),
    behavior: readString(source.behavior, fallback.behavior, 220),
    emotion: readEmotion(source.emotion, fallback.emotion),
  };
}

function sanitizePersonaId(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return cleaned || LOCAL_DEFAULT_PROFILE_ID;
}

function readString(value: unknown, fallback: string, maxLength = 200): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function readStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readEmotion(value: unknown, fallback: EmotionType): EmotionType {
  return typeof value === 'string' ? value as EmotionType : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
