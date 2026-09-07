import { CREATIVE_SECTIONS, creativeSectionLabel, type CreativeSection } from './CreativeState';
import type { CreativeExtraction } from './CreativeExtraction';

/**
 * Reads a description that already carries its own section headings.
 *
 * When someone pastes a written brief - 「服装描写：…」「环境背景：…」 - the
 * structure is already on the page, and asking a model to find it costs seconds
 * and can come back empty. This reads it directly: no round trip, no failure mode.
 * Free-form prose is not forced through here; it falls through to the model.
 */
export interface LocalCreativeParse {
  sections: Partial<Record<CreativeSection, string>>;
  /** Sections the text named with a heading, so they may overwrite a locked one. */
  explicitSections: CreativeSection[];
  /**
   * How much of the message landed inside a section, ignoring the headings
   * themselves. Headings are structure, not content, and counting them would make
   * a short two-line edit look like mostly stray prose.
   */
  coverage: number;
  /** True when the paste is complete enough to stand as a whole new description. */
  fullSpec: boolean;
}

/** Below this, the message is mostly prose that happens to contain a heading. */
const MIN_COVERAGE = 0.6;
/**
 * One heading is not a document. A lone 「说明：…」 in ordinary conversation would
 * otherwise be filed as a section, so single-heading messages go to the model.
 */
const MIN_SECTIONS = 2;
/** A paste this complete, and carrying an identity, replaces rather than merges. */
const FULL_SPEC_MIN_SECTIONS = 5;
const IDENTITY_SECTIONS: CreativeSection[] = ['subject', 'character'];

const SECTION_ALIASES: Record<string, CreativeSection> = {};
function alias(section: CreativeSection, ...names: string[]): void {
  for (const name of names) SECTION_ALIASES[normalizeLabel(name)] = section;
}

alias('subject', '主体', '画面主体', '拍摄主体', '主题', '题材', 'subject', 'main subject', 'topic');
alias('character', '角色', '人物', '角色五官', '五官', '人物五官', '面部', '脸部', '长相', '外貌',
  '人设', '角色设定', '人物设定', '角色描写', '人物描写',
  'character', 'face', 'facial features', 'appearance', 'person');
alias('hair', '头发', '发型', '发饰', '头发与发饰', '头发发型', '头发描写', 'hair', 'hairstyle');
alias('outfit', '服装', '服装描写', '穿着', '衣服', '服饰', '装扮', '着装',
  'outfit', 'clothing', 'clothes', 'wardrobe', 'costume', 'attire');
alias('pose', '姿态', '姿势', '动作', '体态', '神态', '角色pose', '姿态与动作', '动作描写',
  'pose', 'posture', 'action', 'gesture');
alias('scene', '环境背景', '场景', '背景', '环境', '地点', '场景描写', '环境描写', '场景背景',
  'scene', 'background', 'environment', 'setting', 'location');
alias('style', '风格', '画风', '艺术风格', '美术风格', '调性', '氛围',
  'style', 'art style', 'aesthetic', 'mood');
alias('technical', '画面关键词', '画面参数', '关键词', '镜头', '光影', '光线', '构图', '画质',
  '摄影参数', '技术参数', '参数', '画面', '出图参数',
  'technical', 'camera', 'lighting', 'composition', 'quality', 'rendering', 'keywords', 'prompt');
alias('notes', '备注', '补充', '补充说明', '其他', '说明', '注意', '附加',
  'notes', 'note', 'other', 'misc', 'additional');

/** `## 服装描写` - a heading line with no content of its own. */
const HEADING_ONLY = /^\s*#{1,6}\s*\**\s*(.{1,24}?)\s*\**\s*[:：]?\s*$/;
/** `【服装】低饱和…` or `[Outfit] …` */
const BRACKETED = /^\s*[【\[]\s*(.{1,24}?)\s*[】\]]\s*[:：]?\s*(.*)$/;
/** `- **服装描写**：低饱和…` and every plainer variant of it. */
const LABEL_COLON = /^\s*(?:[-*•·]|\d+\s*[.、)）])?\s*\**\s*(.{1,24}?)\s*\**\s*[:：]\s*(.*)$/;

export function parseLabeledCreativeSpec(message: string): LocalCreativeParse | null {
  const text = typeof message === 'string' ? message.replace(/\r\n/g, '\n') : '';
  if (!text.trim()) return null;

  const collected = new Map<CreativeSection, string[]>();
  const order: CreativeSection[] = [];
  let current: CreativeSection | null = null;
  let covered = 0;
  let structural = 0;

  for (const line of text.split('\n')) {
    const heading = readHeading(line);
    if (heading) {
      current = heading.section;
      if (!collected.has(current)) {
        collected.set(current, []);
        order.push(current);
      }
      structural += countContentChars(line) - countContentChars(heading.rest);
      if (heading.rest.trim()) {
        collected.get(current)!.push(heading.rest.trim());
        covered += countContentChars(heading.rest);
      }
      continue;
    }
    if (!current) continue;
    if (line.trim()) {
      collected.get(current)!.push(line.trim());
      covered += countContentChars(line);
    } else {
      collected.get(current)!.push('');
    }
  }

  if (order.length < MIN_SECTIONS) return null;
  // The headings are discounted from both sides, so what is measured is the share
  // of actual text that fell into a section. Charging a two-line edit for its own
  // labels would reject the shortest, clearest briefs.
  const body = countContentChars(text) - structural;
  const coverage = body > 0 ? covered / body : 0;
  if (coverage < MIN_COVERAGE) return null;

  const sections: Partial<Record<CreativeSection, string>> = {};
  for (const section of order) {
    const body = (collected.get(section) ?? []).join('\n').trim();
    if (body) sections[section] = body;
  }
  const explicitSections = CREATIVE_SECTIONS.filter(section => sections[section] !== undefined);
  if (explicitSections.length < MIN_SECTIONS) return null;

  return {
    sections,
    explicitSections,
    coverage,
    fullSpec: explicitSections.length >= FULL_SPEC_MIN_SECTIONS
      && IDENTITY_SECTIONS.some(section => sections[section] !== undefined),
  };
}

/** The locally parsed brief, in the shape the rest of the turn already handles. */
export function localCreativeExtraction(parse: LocalCreativeParse): CreativeExtraction {
  const named = parse.explicitSections.map(creativeSectionLabel).join('、');
  return {
    kind: parse.fullSpec ? 'full_spec' : 'edit',
    patch: {
      sections: parse.sections,
      explicitSections: parse.explicitSections,
      replaceAll: parse.fullSpec,
    },
    understanding: parse.fullSpec
      ? `按你贴的这份完整描述重建画面设定：${named}`
      : `按你写的段落更新：${named}`,
    // Nothing is guessed here, so there is nothing to report as guessed. Inventing
    // gaps to look thorough would be its own kind of not listening.
    gaps: [],
    plannedExtensions: [],
    issues: [],
    source: 'local',
  };
}

function readHeading(line: string): { section: CreativeSection; rest: string } | null {
  for (const pattern of [BRACKETED, HEADING_ONLY, LABEL_COLON]) {
    const match = pattern.exec(line);
    if (!match) continue;
    const section = SECTION_ALIASES[normalizeLabel(match[1] ?? '')];
    // An unrecognised label means this is an ordinary line that happens to hold a
    // colon, not a heading. That check is what keeps prose out.
    if (section) return { section, rest: match[2] ?? '' };
  }
  return null;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\s　_\-–—·・:：]/g, '')
    .replace(/^[#*>【\[]+|[#*】\]]+$/g, '')
    .trim();
}

function countContentChars(text: string): number {
  return text.replace(/\s/g, '').length;
}
