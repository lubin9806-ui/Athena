export type InitiativeAction = 'wait' | 'speak';

export interface InitiativeIntent {
  action: InitiativeAction;
  /** Minutes until Athena should wake and look again. Always inside the policy bounds. */
  nextCheckMinutes: number;
  /** Short rationale, kept for the job record and the log. Never shown as a message. */
  reason: string;
  /** Present only when action is 'speak'. */
  message?: string;
}

export interface InitiativeIntentBounds {
  minMinutes: number;
  maxMinutes: number;
  defaultMinutes: number;
}

export interface ParsedInitiativeIntent {
  intent: InitiativeIntent;
  /** Everything the model got wrong, for the log. An empty list means a clean parse. */
  issues: string[];
}

const MAX_REASON_CHARS = 200;
const MAX_MESSAGE_CHARS = 600;

/**
 * Turns the model's reply into an intent that is always safe to act on.
 *
 * The schedule is only as trustworthy as the model's arithmetic, and a wake loop
 * driven by an unvalidated number is a loop that can fire every second or never
 * again. So this never throws and never returns an out-of-range interval: it
 * clamps, downgrades and falls back, reporting what it had to correct
 * (ATH-INIT-001 V1).
 */
export function parseInitiativeIntent(raw: string, bounds: InitiativeIntentBounds): ParsedInitiativeIntent {
  const issues: string[] = [];
  const object = readJsonObject(raw, issues);

  const action = readAction(object.action, issues);
  const nextCheckMinutes = readMinutes(object.nextCheckMinutes ?? object.next_check ?? object.nextCheck, bounds, issues);
  const reason = readText(object.reason, MAX_REASON_CHARS);
  const message = readText(object.message, MAX_MESSAGE_CHARS);

  if (action === 'speak' && !message) {
    // A speak decision with nothing to say is the failure mode that produces an
    // empty or filler notification, so it degrades to waiting instead.
    issues.push('speak-without-message');
    return { intent: { action: 'wait', nextCheckMinutes, reason }, issues };
  }

  return {
    intent: action === 'speak'
      ? { action, nextCheckMinutes, reason, message }
      : { action, nextCheckMinutes, reason },
    issues,
  };
}

export function clampInitiativeMinutes(value: number, bounds: InitiativeIntentBounds): number {
  if (!Number.isFinite(value)) return bounds.defaultMinutes;
  return Math.min(bounds.maxMinutes, Math.max(bounds.minMinutes, Math.round(value)));
}

function readJsonObject(raw: string, issues: string[]): Record<string, unknown> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    issues.push('empty-response');
    return {};
  }
  // Models wrap JSON in prose or fences often enough that the first balanced object
  // is worth recovering before giving up entirely.
  const candidates = [text, extractFirstJsonObject(text)].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (candidate !== text) issues.push('json-recovered-from-prose');
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate; a malformed reply must not abort the wake loop.
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

function readAction(value: unknown, issues: string[]): InitiativeAction {
  if (value === 'speak' || value === 'wait') return value;
  if (value !== undefined) issues.push('invalid-action');
  else issues.push('missing-action');
  return 'wait';
}

// Accepts a plain number of minutes or the shorthand a model naturally writes
// ("27m", "1.5h", "90 minutes"). Anything else falls back to the default.
function readMinutes(value: unknown, bounds: InitiativeIntentBounds, issues: string[]): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      issues.push('invalid-next-check');
      return bounds.defaultMinutes;
    }
    const clamped = clampInitiativeMinutes(value, bounds);
    if (clamped !== Math.round(value)) issues.push('next-check-clamped');
    return clamped;
  }
  if (typeof value !== 'string') {
    issues.push(value === undefined ? 'missing-next-check' : 'invalid-next-check');
    return bounds.defaultMinutes;
  }
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) {
    issues.push('invalid-next-check');
    return bounds.defaultMinutes;
  }
  const amount = Number(match[1]);
  const unit = match[2] || 'm';
  const minutes = /^h/.test(unit) ? amount * 60 : /^d/.test(unit) ? amount * 1_440 : amount;
  const clamped = clampInitiativeMinutes(minutes, bounds);
  if (clamped !== Math.round(minutes)) issues.push('next-check-clamped');
  return clamped;
}

function readText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}
