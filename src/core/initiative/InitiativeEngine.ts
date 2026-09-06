import { createLogger } from '../../engine/Logger';
import { classifyModelFailure } from '../ai/ModelFailure';
import {
  countInitiativeMessagesSince,
  createScheduledJob,
  listPendingScheduledJobs,
  markScheduledJobCancelled,
  markScheduledJobCompleted,
  recordInitiativeOutcome,
  type ScheduledJobRecord,
} from '../scheduler/ScheduledJobStore';
import { globalScheduler } from '../../engine/Scheduler';
import { parseInitiativeIntent, type InitiativeIntent } from './InitiativeIntent';
import {
  blockedReason,
  nextAllowedWake,
  DEFAULT_INITIATIVE_POLICY,
  type InitiativeBlockReason,
  type InitiativePolicy,
} from './InitiativePolicy';

const logger = createLogger('Initiative');

export interface InitiativeContext {
  /** Minutes since the user last sent anything, or null when there is no history. */
  minutesSinceLastUserMessage: number | null;
  recentTurns: Array<{ role: string; content: string }>;
  proactiveMessagesToday: number;
}

export interface InitiativeDecisionClient {
  decide(input: { context: InitiativeContext; now: Date }): Promise<string>;
}

export interface InitiativeEngineOptions {
  client: InitiativeDecisionClient;
  readGate: () => { enabled: boolean; saveHistory: boolean };
  readContext: () => InitiativeContext;
  speak: (message: string) => { chatWindowId: number } | null;
  policy?: InitiativePolicy;
  now?: () => Date;
}

export interface InitiativeWakeResult {
  action: InitiativeAction;
  nextCheckMinutes: number;
  blocked: InitiativeBlockReason;
  issues: string[];
  spoke: boolean;
}

type InitiativeAction = InitiativeIntent['action'];

const MAX_CONTEXT_TURNS = 6;
const MAX_TURN_CHARS = 400;

/**
 * Decides when Athena looks again, and on waking whether she says anything.
 *
 * The model chooses the cadence and the wording; policy owns the bounds. Silence
 * is a first-class outcome, so a wake that produces nothing is a success, not a
 * failure to be retried (ATH-INIT-001 V1).
 */
export class InitiativeEngine {
  private readonly policy: InitiativePolicy;
  private readonly now: () => Date;

  constructor(private readonly options: InitiativeEngineOptions) {
    this.policy = options.policy ?? DEFAULT_INITIATIVE_POLICY;
    this.now = options.now ?? (() => new Date());
  }

  /** Re-arms the pending wake, or schedules a first one when initiative is on. */
  start(): void {
    const pending = listPendingScheduledJobs().filter(job => job.kind === 'initiative');
    const gate = this.options.readGate();
    if (!gate.enabled) {
      for (const job of pending) this.cancelWake(job.id);
      return;
    }
    if (pending.length === 0) {
      this.scheduleWake(this.policy.defaultMinutes);
      return;
    }
    // Only one wake is ever outstanding; extras are leftovers from an interrupted run.
    for (const job of pending.slice(1)) this.cancelWake(job.id);
    this.armWake(pending[0]);
  }

  stop(): void {
    for (const job of listPendingScheduledJobs()) {
      if (job.kind === 'initiative') this.cancelWake(job.id);
    }
  }

  /**
   * Runs one wake: re-check the gates, ask the model, act, then schedule the next.
   * `jobId` is the row that fired, so the outcome is recorded against it and the
   * daily budget can be counted from settled jobs.
   */
  async wake(jobId?: string): Promise<InitiativeWakeResult> {
    const gate = this.options.readGate();
    const context = this.options.readContext();
    const now = this.now();
    const blocked = blockedReason({
      enabled: gate.enabled,
      saveHistory: gate.saveHistory,
      messagesSpokenToday: context.proactiveMessagesToday,
      now,
      policy: this.policy,
    });

    if (blocked === 'disabled' || blocked === 'history-off') {
      logger.info(`Initiative wake skipped and loop stopped: ${blocked}`);
      return { action: 'wait', nextCheckMinutes: 0, blocked, issues: [], spoke: false };
    }

    let raw = '';
    let issues: string[] = [];
    try {
      raw = await this.options.client.decide({ context: trimContext(context), now });
    } catch (error) {
      // An unreachable or failing model must not stop the loop; it just means this
      // wake produced nothing and the next one is scheduled normally.
      const failure = classifyModelFailure(error);
      logger.warn(`Initiative decision failed [code=${failure.code}]: ${failure.detail}`);
      issues = [`decision-failed:${failure.code}`];
    }

    const parsed = raw ? parseInitiativeIntent(raw, this.policy) : null;
    const intent: InitiativeIntent = parsed?.intent ?? { action: 'wait', nextCheckMinutes: this.policy.defaultMinutes, reason: 'decision unavailable' };
    issues = [...issues, ...(parsed?.issues ?? [])];

    let spoke = false;
    if (intent.action === 'speak' && intent.message) {
      if (blocked) {
        logger.info(`Initiative message withheld: ${blocked}`);
        issues.push(`withheld:${blocked}`);
      } else {
        spoke = Boolean(this.options.speak(intent.message));
        if (!spoke) issues.push('delivery-refused');
      }
    }
    if (jobId) recordInitiativeOutcome(jobId, spoke);

    const scheduled = this.scheduleWake(intent.nextCheckMinutes);
    logger.info(`Initiative wake done [action=${intent.action}, spoke=${spoke}, next=${intent.nextCheckMinutes}m, blocked=${blocked ?? 'none'}, issues=${issues.join('|') || 'none'}]`);
    return {
      action: intent.action,
      nextCheckMinutes: scheduled ? intent.nextCheckMinutes : 0,
      blocked,
      issues,
      spoke,
    };
  }

  countMessagesToday(now: Date = this.now()): number {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return countInitiativeMessagesSince(start);
  }

  private scheduleWake(minutes: number): ScheduledJobRecord | null {
    if (!this.options.readGate().enabled) return null;
    const record = createScheduledJob({
      id: `initiative-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: 'initiative',
      title: 'Initiative check',
      dueAt: nextAllowedWake(this.now(), minutes, this.policy),
    });
    this.armWake(record);
    return record;
  }

  private armWake(record: ScheduledJobRecord): void {
    // start() runs on every settings save as well as at boot, so re-arming an id
    // that already has a live timer must be a no-op rather than an error.
    if (globalScheduler.has(record.id)) return;
    globalScheduler.schedule(record.title, new Date(record.dueAt), () => {
      if (!markScheduledJobCompleted(record.id)) return;
      void this.wake(record.id).catch(error => {
        logger.warn(`Initiative wake threw: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, { id: record.id });
  }

  private cancelWake(id: string): void {
    markScheduledJobCancelled(id);
    globalScheduler.cancel(id);
  }
}

function trimContext(context: InitiativeContext): InitiativeContext {
  return {
    ...context,
    recentTurns: context.recentTurns.slice(-MAX_CONTEXT_TURNS).map(turn => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_TURN_CHARS),
    })),
  };
}
