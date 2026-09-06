import type { InitiativeIntentBounds } from './InitiativeIntent';

export interface InitiativePolicy extends InitiativeIntentBounds {
  /** Local hour the quiet window opens, inclusive. */
  quietHoursStart: number;
  /** Local hour the quiet window closes, exclusive. */
  quietHoursEnd: number;
  /** Hard ceiling on proactive messages per local day. */
  maxMessagesPerDay: number;
}

// Fixed for V1. A model that can pick its own cadence still must not be able to
// pick "every minute", talk at 04:00, or run up an unbounded number of unattended
// model calls, so the bounds are policy rather than something the model returns.
export const DEFAULT_INITIATIVE_POLICY: InitiativePolicy = {
  minMinutes: 15,
  maxMinutes: 240,
  defaultMinutes: 45,
  quietHoursStart: 23,
  quietHoursEnd: 8,
  maxMessagesPerDay: 4,
};

export type InitiativeBlockReason =
  | 'disabled'
  | 'history-off'
  | 'quiet-hours'
  | 'daily-budget'
  | null;

export interface InitiativeGateInput {
  enabled: boolean;
  saveHistory: boolean;
  messagesSpokenToday: number;
  now: Date;
  policy?: InitiativePolicy;
}

/**
 * Returns why Athena must stay silent, or null when speaking is allowed.
 * Waking to look is always allowed to be re-evaluated later; this gates the
 * decision to actually say something.
 */
export function blockedReason(input: InitiativeGateInput): InitiativeBlockReason {
  const policy = input.policy ?? DEFAULT_INITIATIVE_POLICY;
  if (!input.enabled) return 'disabled';
  // Waking up to read context and then writing a message is exactly what turning
  // chat history off refuses (ATH-DATA-002).
  if (!input.saveHistory) return 'history-off';
  if (isQuietHour(input.now.getHours(), policy)) return 'quiet-hours';
  if (input.messagesSpokenToday >= policy.maxMessagesPerDay) return 'daily-budget';
  return null;
}

export function isQuietHour(hour: number, policy: InitiativePolicy = DEFAULT_INITIATIVE_POLICY): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = policy;
  if (start === end) return false;
  // The window normally wraps midnight, so it is two ranges rather than one.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Pushes a wake time out of the quiet window so Athena looks again when the user
 * is plausibly awake, instead of waking repeatedly through the night.
 */
export function nextAllowedWake(from: Date, minutes: number, policy: InitiativePolicy = DEFAULT_INITIATIVE_POLICY): Date {
  const candidate = new Date(from.getTime() + minutes * 60_000);
  if (!isQuietHour(candidate.getHours(), policy)) return candidate;
  const wake = new Date(candidate);
  wake.setMinutes(0, 0, 0);
  while (isQuietHour(wake.getHours(), policy)) wake.setHours(wake.getHours() + 1);
  return wake;
}
