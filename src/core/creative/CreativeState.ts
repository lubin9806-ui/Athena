export const CREATIVE_SECTIONS = ['character', 'hair', 'outfit', 'scene', 'pose', 'technical'] as const;
export type CreativeSection = typeof CREATIVE_SECTIONS[number];

/**
 * Sections that describe who the character is. They survive an edit unless the
 * user asks for them by name, which is what stops a scene change from redrawing
 * the face (ATH-IMG-002, ATH-CHAT-004).
 */
export const DEFAULT_LOCKED_SECTIONS: CreativeSection[] = ['character', 'hair', 'outfit'];

export interface CreativeState {
  version: number;
  sections: Record<CreativeSection, string>;
  /** Sections that an edit may not touch unless it names them explicitly. */
  locked: CreativeSection[];
  updatedAt: string;
}

export interface CreativePatch {
  /** Only the sections this edit actually changes. */
  sections: Partial<Record<CreativeSection, string>>;
  /** Sections the user named, which is what allows a locked one to change. */
  explicitSections?: CreativeSection[];
  /** Replaces everything rather than merging, for a freshly pasted full spec. */
  replaceAll?: boolean;
}

export interface CreativeMergeResult {
  state: CreativeState;
  changed: CreativeSection[];
  /** Locked sections an edit tried to change without naming them. */
  refused: CreativeSection[];
}

const MAX_SECTION_CHARS = 4_000;
const SECTION_LABELS: Record<CreativeSection, string> = {
  character: '角色五官',
  hair: '头发与发饰',
  outfit: '服装',
  scene: '环境背景',
  pose: '姿态与动作',
  technical: '画面与摄影',
};

export function emptyCreativeState(now: Date = new Date()): CreativeState {
  return {
    version: 0,
    sections: { character: '', hair: '', outfit: '', scene: '', pose: '', technical: '' },
    locked: [...DEFAULT_LOCKED_SECTIONS],
    updatedAt: now.toISOString(),
  };
}

/**
 * Applies an edit to the accumulated description.
 *
 * Only the sections the edit carries are touched; everything else is preserved
 * verbatim. That is the whole point: asking to change the scene must not be an
 * invitation to rewrite the face. A locked section changes only when the edit
 * named it, and the refusal is reported rather than applied silently.
 */
export function mergeCreativeState(
  current: CreativeState,
  patch: CreativePatch,
  now: Date = new Date(),
): CreativeMergeResult {
  const base = patch.replaceAll ? emptyCreativeState(now) : current;
  const explicit = new Set(patch.explicitSections ?? []);
  const sections = { ...base.sections };
  const changed: CreativeSection[] = [];
  const refused: CreativeSection[] = [];

  for (const section of CREATIVE_SECTIONS) {
    const incoming = normalizeSection(patch.sections[section]);
    if (incoming === null) continue;
    const locked = !patch.replaceAll && base.locked.includes(section);
    if (locked && !explicit.has(section)) {
      if (incoming !== sections[section]) refused.push(section);
      continue;
    }
    if (incoming === sections[section]) continue;
    sections[section] = incoming;
    changed.push(section);
  }

  if (changed.length === 0) {
    return { state: patch.replaceAll ? { ...base, sections } : current, changed, refused };
  }
  return {
    state: {
      version: base.version + 1,
      sections,
      locked: patch.replaceAll ? [...DEFAULT_LOCKED_SECTIONS] : [...base.locked],
      updatedAt: now.toISOString(),
    },
    changed,
    refused,
  };
}

export function setCreativeSectionLock(
  state: CreativeState,
  section: CreativeSection,
  locked: boolean,
  now: Date = new Date(),
): CreativeState {
  const already = state.locked.includes(section);
  if (already === locked) return state;
  return {
    ...state,
    locked: locked ? [...state.locked, section] : state.locked.filter(item => item !== section),
    updatedAt: now.toISOString(),
  };
}

export function hasCreativeContent(state: CreativeState): boolean {
  return CREATIVE_SECTIONS.some(section => state.sections[section].length > 0);
}

/** The merged description that is actually sent to the image model. */
export function buildCreativePrompt(state: CreativeState): string {
  return CREATIVE_SECTIONS
    .map(section => state.sections[section])
    .filter(Boolean)
    .join('\n\n');
}

/** The version a person reads and copies, with the section names kept. */
export function formatCreativeStateForDisplay(state: CreativeState): string {
  const blocks = CREATIVE_SECTIONS
    .filter(section => state.sections[section])
    .map(section => `【${SECTION_LABELS[section]}${state.locked.includes(section) ? ' · 已锁定' : ''}】\n${state.sections[section]}`);
  return blocks.join('\n\n');
}

export function parseCreativeState(raw: string | null | undefined, now: Date = new Date()): CreativeState {
  const fallback = emptyCreativeState(now);
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
  const value = parsed as Record<string, unknown>;
  const sections = { ...fallback.sections };
  const incoming = value.sections;
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    for (const section of CREATIVE_SECTIONS) {
      const text = (incoming as Record<string, unknown>)[section];
      if (typeof text === 'string') sections[section] = text.slice(0, MAX_SECTION_CHARS);
    }
  }
  const locked = Array.isArray(value.locked)
    ? value.locked.filter((item): item is CreativeSection => CREATIVE_SECTIONS.includes(item as CreativeSection))
    : [...DEFAULT_LOCKED_SECTIONS];
  return {
    version: typeof value.version === 'number' && Number.isFinite(value.version) ? Math.max(0, Math.round(value.version)) : 0,
    sections,
    locked,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
  };
}

export function serializeCreativeState(state: CreativeState): string {
  return JSON.stringify(state);
}

function normalizeSection(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim().slice(0, MAX_SECTION_CHARS);
  return text;
}
