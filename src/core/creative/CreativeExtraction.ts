import {
  CREATIVE_SECTIONS,
  filledCreativeSections,
  type CreativePatch,
  type CreativeSection,
  type CreativeState,
} from './CreativeState';

export type CreativeMessageKind = 'full_spec' | 'edit' | 'not_creative';

export interface CreativeExtraction {
  kind: CreativeMessageKind;
  patch: CreativePatch;
  /** One sentence describing what was understood, shown to the user for confirmation. */
  understanding: string;
  /** Things the request leaves genuinely open, which are worth asking about. */
  gaps: string[];
  /** Technical details Athena would fill in herself, listed so they can be refused. */
  plannedExtensions: string[];
  issues: string[];
  /** Whether the headings were read off the page or interpreted by a model. */
  source: 'local' | 'model';
}

const MAX_UNDERSTANDING_CHARS = 300;
const MAX_SECTION_CHARS = 4_000;

/**
 * Reads the model's account of what an image message changes.
 *
 * Never throws and never invents a section: anything unrecognised is dropped and
 * reported, because a bad parse here silently rewrites the user's character
 * description (ATH-IMG-002).
 */
export function parseCreativeExtraction(raw: string): CreativeExtraction {
  const issues: string[] = [];
  const object = readJsonObject(raw, issues);
  const kind = readKind(object.kind, issues);

  const gaps = readStringList(object.gaps, issues, 'gap');
  const plannedExtensions = readStringList(object.plannedExtensions ?? object.planned_extensions, issues, 'extension');

  if (kind === 'not_creative') {
    return {
      kind,
      patch: { sections: {} },
      understanding: readText(object.understanding, MAX_UNDERSTANDING_CHARS),
      gaps: [],
      plannedExtensions: [],
      issues,
      source: 'model',
    };
  }

  const sections: Partial<Record<CreativeSection, string>> = {};
  const incoming = object.sections;
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (!CREATIVE_SECTIONS.includes(key as CreativeSection)) {
        issues.push(`unknown-section:${key.slice(0, 24)}`);
        continue;
      }
      if (typeof value !== 'string') {
        issues.push(`invalid-section:${key}`);
        continue;
      }
      const text = value.replace(/\r\n/g, '\n').trim().slice(0, MAX_SECTION_CHARS);
      if (text) sections[key as CreativeSection] = text;
    }
  } else {
    issues.push('missing-sections');
  }

  const explicitSections = readExplicitSections(object.explicitSections ?? object.explicit_sections, issues);
  if (Object.keys(sections).length === 0) {
    issues.push('empty-patch');
    return {
      kind: 'not_creative',
      patch: { sections: {} },
      understanding: readText(object.understanding, MAX_UNDERSTANDING_CHARS),
      gaps: [],
      plannedExtensions: [],
      issues,
      source: 'model',
    };
  }

  return {
    kind,
    patch: {
      sections,
      explicitSections,
      // A full spec replaces the accumulated description; an edit never does.
      replaceAll: kind === 'full_spec',
    },
    understanding: readText(object.understanding, MAX_UNDERSTANDING_CHARS),
    gaps,
    plannedExtensions,
    issues,
    source: 'model',
  };
}

/**
 * Whether this request is worth confirming before acting.
 *
 * Confirmation is for the cases where being wrong costs something: a request with
 * a genuine gap, or a new description that would overwrite one already built up.
 * A first request into an empty window is not one of those - "画一张雪山日出"
 * deserves a picture, not an interview. Nor is a brief whose own headings were
 * read verbatim, where there is no interpretation to check (ATH-CHAT-004).
 */
export function needsCreativeConfirmation(
  extraction: CreativeExtraction,
  context: { hasExistingContent?: boolean } = {},
): boolean {
  if (extraction.kind === 'not_creative') return false;
  if (extraction.gaps.length > 0) return true;
  if (extraction.kind !== 'full_spec') return false;
  // Replacing work that already exists is worth a sentence first.
  if (context.hasExistingContent) return true;
  // A model's reading of a free-form brief is an interpretation; headings are not.
  return extraction.source === 'model';
}

const SHORT_SECTION_LABELS: Record<CreativeSection, string> = {
  subject: '主体',
  character: '五官',
  hair: '头发发饰',
  outfit: '服装',
  pose: '姿态',
  scene: '场景',
  style: '风格',
  technical: '画面参数',
  notes: '其他说明',
};

/** The sections a person would recognise, for the confirmation sentence. */
export function describeCreativeChange(changed: CreativeSection[], refused: CreativeSection[]): string {
  const parts: string[] = [];
  if (changed.length > 0) parts.push(`更新了 ${changed.map(section => SHORT_SECTION_LABELS[section]).join('、')}`);
  if (refused.length > 0) parts.push(`保持了锁定的 ${refused.map(section => SHORT_SECTION_LABELS[section]).join('、')}`);
  return parts.join('；');
}

/**
 * No denominator: a landscape needs two sections and a character sheet needs
 * eight, so "2/9" would report a complete description as mostly missing.
 */
export function creativeStateSummary(state: CreativeState): string {
  const filled = filledCreativeSections(state);
  if (filled.length === 0) return `v${state.version} · 还没有画面描述`;
  return `v${state.version} · ${filled.map(section => SHORT_SECTION_LABELS[section]).join('、')}`;
}

function readJsonObject(raw: string, issues: string[]): Record<string, unknown> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    issues.push('empty-response');
    return {};
  }
  for (const candidate of [text, extractFirstJsonObject(text)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (candidate !== text) issues.push('json-recovered-from-prose');
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate rather than losing the turn.
    }
  }
  issues.push('unparsable-response');
  return {};
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function readKind(value: unknown, issues: string[]): CreativeMessageKind {
  if (value === 'full_spec' || value === 'edit' || value === 'not_creative') return value;
  issues.push(value === undefined ? 'missing-kind' : 'invalid-kind');
  // Treating an unreadable reply as a creative edit would let it rewrite the
  // description, so the safe default is to leave the state alone.
  return 'not_creative';
}

function readExplicitSections(value: unknown, issues: string[]): CreativeSection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push('invalid-explicit-sections');
    return [];
  }
  const result: CreativeSection[] = [];
  for (const item of value) {
    if (typeof item === 'string' && CREATIVE_SECTIONS.includes(item as CreativeSection)) result.push(item as CreativeSection);
    else issues.push('invalid-explicit-section');
  }
  return result;
}

function readStringList(value: unknown, issues: string[], label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`invalid-${label}-list`);
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function readText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}
