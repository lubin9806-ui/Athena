/**
 * Turning a written reply into something worth listening to.
 *
 * Two jobs, both pure so they can be driven by fixtures rather than a speaker:
 * strip the markdown a reader can see but a listener only hears as noise, and
 * cut the stream into sentences so speaking can start before the reply is
 * finished (ATH-VOICE-009).
 */

/** Below this a fragment waits for more text rather than being spoken alone. */
const MIN_SENTENCE_CHARS = 6;
/**
 * A stretch this long with no punctuation is spoken anyway. Without it, a reply
 * that never punctuates would be held until the very end, which is the delay
 * streaming exists to remove.
 */
const MAX_SENTENCE_CHARS = 120;

/** Sentence enders in both scripts, plus the closers that trail them. */
const SENTENCE_END = /[。！？；…!?;]+["'"'）)』」】]*/;
const SOFT_BREAK = /[，,、]["'"'）)』」】]*/;

/**
 * Strip the markup a listener cannot hear.
 *
 * Fenced code is dropped rather than read: an implementation spoken aloud is
 * noise, and it stays on screen for anyone who wants it. Everything else keeps
 * its words and loses only its punctuation-as-formatting.
 */
export function toSpeakableText(markdown: string): string {
  const lines: string[] = [];
  let insideFence = false;
  for (const line of markdown.split('\n')) {
    if (isFenceLine(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const spoken = toSpeakableLine(line);
    if (spoken) lines.push(spoken);
  }
  return lines.join('\n').trim();
}

/** A ``` line, which opens or closes a code block. */
export function isFenceLine(line: string): boolean {
  return /^\s{0,3}(?:```|~~~)/.test(line);
}

/**
 * A partly-written line that could still turn into a fence.
 *
 * A streaming reader sees "``" before it sees "```js", and reading backticks
 * aloud is worse than waiting one more chunk to find out what they are.
 */
export function mayBecomeFence(line: string): boolean {
  return /^\s{0,3}(?:`{1,3}|~{1,3})[^\s`~]*$/.test(line);
}

/**
 * Clean a run of raw text that may span several lines.
 *
 * Used on a sentence sliced out of the stream: line-start markup is stripped per
 * line, and the lines are joined into one spoken run.
 */
export function toSpeakableChunk(raw: string): string {
  return raw
    .split('\n')
    .map(toSpeakableLine)
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Clean one line of markdown.
 *
 * Separate from toSpeakableText because a streaming reader has to track the
 * fence state itself: it sees an opening ``` long before the closing one, and
 * stripping "everything after an unterminated fence" would then treat the
 * closing fence as a new opening one and swallow the rest of the reply.
 */
export function toSpeakableLine(line: string): string {
  let text = line;

  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  text = text.replace(/^\s{0,3}#{1,6}\s+/, '');
  text = text.replace(/^\s{0,3}>\s?/, '');
  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(text)) return '';
  text = text.replace(/^\s{0,3}[-*+]\s+/, '');
  text = text.replace(/^\s{0,3}\d+[.)]\s+/, '');

  // A table rule carries no words; the cells do, separated by a pause.
  if (/^\s*\|?[\s:|-]*\|[\s:|-]*\|?\s*$/.test(text)) return '';
  text = text.replace(/\|/g, '，');

  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  return text.replace(/\s+/g, ' ').trim();
}

export interface SpeakableSplit {
  sentences: string[];
  /** Text held back because it is not yet a complete sentence. */
  rest: string;
}

/**
 * Take whole sentences off the front of a buffer.
 *
 * `flush` is the end of the reply: whatever is left is spoken as-is, because
 * there is no more text coming to complete it.
 */
export function takeSpeakableSentences(buffer: string, flush = false): SpeakableSplit {
  const sentences: string[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = findBoundary(rest);
    if (boundary < 0) break;
    const sentence = rest.slice(0, boundary).trim();
    rest = rest.slice(boundary);
    if (sentence) sentences.push(sentence);
  }

  if (flush) {
    const tail = rest.trim();
    if (tail) sentences.push(tail);
    rest = '';
  }

  return { sentences, rest: rest.replace(/^\s+/, '') };
}

/** The index just past the end of the first complete sentence, or -1. */
function findBoundary(text: string): number {
  const hard = matchAfter(text, SENTENCE_END, MIN_SENTENCE_CHARS);
  if (hard >= 0) return hard;

  // A newline ends a line of prose as surely as a full stop does.
  const newline = text.indexOf('\n');
  if (newline >= 0 && text.slice(0, newline).trim().length >= MIN_SENTENCE_CHARS) return newline + 1;

  // An English full stop, but not the one inside 3.14 or in "v1.2".
  const period = matchAfter(text, /\.(?=\s|$)/, MIN_SENTENCE_CHARS, index => !/\d/.test(text[index - 1] ?? ''));
  if (period >= 0) return period;

  if (text.length < MAX_SENTENCE_CHARS) return -1;
  // Too long to keep waiting: break at the last pause inside the limit, or at
  // the limit itself if there is not even a comma.
  const window = text.slice(0, MAX_SENTENCE_CHARS);
  const soft = lastMatchEnd(window, SOFT_BREAK);
  return soft >= MIN_SENTENCE_CHARS ? soft : MAX_SENTENCE_CHARS;
}

function matchAfter(
  text: string,
  pattern: RegExp,
  minimum: number,
  accept: (index: number) => boolean = () => true,
): number {
  const source = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let match = source.exec(text); match; match = source.exec(text)) {
    const end = match.index + match[0].length;
    if (end >= minimum && accept(match.index)) return end;
  }
  return -1;
}

function lastMatchEnd(text: string, pattern: RegExp): number {
  const source = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  let end = -1;
  for (let match = source.exec(text); match; match = source.exec(text)) {
    end = match.index + match[0].length;
  }
  return end;
}
