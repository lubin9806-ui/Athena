import { globalScheduler, type ScheduledJob } from '../../engine/Scheduler';
import { createLogger } from '../../engine/Logger';
import {
  createScheduledJob,
  getScheduledJob,
  listPendingScheduledJobs,
  markScheduledJobCancelled,
  markScheduledJobCompleted,
  upsertSyncedReminder,
  type ScheduledJobRecord,
} from './ScheduledJobStore';

const logger = createLogger('Reminder');

/**
 * The instance that owns the live timers, so a reminder arriving on the sync
 * can be armed now rather than at the next start. Cloud sync runs far from the
 * controller that constructs this and has no route to it otherwise; a reminder
 * only armed on restart would silently not ring for hours.
 */
let liveReminder: Reminder | null = null;

export function setLiveReminder(reminder: Reminder | null): void {
  liveReminder = reminder;
}

/**
 * Takes a reminder written on another device. Returns true when this device now
 * holds a timer for it - a reminder already past is stored but never re-fired,
 * because ringing about a moment that has gone is noise rather than a reminder.
 */
export function adoptSyncedReminder(
  input: { id: string; title: string; dueAt: string; status: 'scheduled' | 'completed' | 'cancelled' },
  now: Date = new Date(),
): boolean {
  const existing = getScheduledJob(input.id);
  const written = upsertSyncedReminder(input);
  if (!written) return false;

  if (input.status !== 'scheduled') {
    // Finished or called off elsewhere: the timer here has to go, or this
    // device rings for something the user has already dealt with.
    if (existing?.status === 'scheduled') globalScheduler.cancel(input.id);
    return false;
  }
  if (new Date(written.record.dueAt).getTime() <= now.getTime()) return false;
  // Re-arming replaces the timer for this id rather than adding a second one,
  // so a reminder whose time was changed elsewhere fires once, at the new time.
  globalScheduler.cancel(input.id);
  liveReminder?.adopt(written.record);
  return true;
}

export interface ReminderRequest {
  title: string;
  dueAt: Date;
  chatWindowId?: number | null;
}

export interface DueReminder {
  id: string;
  title: string;
  dueAt: string;
  chatWindowId: number | null;
  /** True when the due time passed while Athena was not running. */
  overdue: boolean;
}

export class Reminder {
  readonly enabled = true;
  private onDue?: (reminder: DueReminder) => void;

  /**
   * Reminders are written to the database before a timer is armed, so a reminder
   * survives a restart. Timers cannot be serialised, which is why the handler is
   * registered once here rather than passed per schedule call.
   */
  setDueHandler(handler: (reminder: DueReminder) => void): void {
    this.onDue = handler;
  }

  schedule(request: ReminderRequest): ScheduledJob {
    const id = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record = createScheduledJob({
      id,
      kind: 'reminder',
      title: request.title,
      dueAt: request.dueAt,
      chatWindowId: request.chatWindowId ?? null,
    });
    return this.arm(record, false);
  }

  /**
   * Re-arms every reminder that is still pending. A reminder whose due time passed
   * while Athena was closed fires immediately and is reported as overdue, rather
   * than being silently dropped.
   */
  restorePending(now: Date = new Date()): { restored: number; overdue: number } {
    let restored = 0;
    let overdue = 0;
    for (const record of listPendingScheduledJobs()) {
      if (record.kind !== 'reminder') continue;
      const isOverdue = new Date(record.dueAt).getTime() <= now.getTime();
      try {
        this.arm(record, isOverdue);
      } catch (error) {
        logger.warn(`Failed to restore reminder ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      restored += 1;
      if (isOverdue) overdue += 1;
    }
    return { restored, overdue };
  }

  list(): ScheduledJob[] {
    return globalScheduler.listJobs();
  }

  /** Arms a row written by the sync rather than by schedule(). */
  adopt(record: ScheduledJobRecord): ScheduledJob {
    return this.arm(record, false);
  }

  cancel(id: string): boolean {
    const cancelled = markScheduledJobCancelled(id);
    globalScheduler.cancel(id);
    return cancelled;
  }

  private arm(record: ScheduledJobRecord, overdue: boolean): ScheduledJob {
    // Restoring twice must not throw; the live timer already covers the row.
    const armed = globalScheduler.listJobs().find(job => job.id === record.id);
    if (armed && globalScheduler.has(record.id)) return armed;
    return globalScheduler.schedule(record.title, new Date(record.dueAt), () => {
      // The row is the source of truth: if it is no longer scheduled the reminder
      // was cancelled or already delivered, so nothing is emitted.
      if (!markScheduledJobCompleted(record.id)) return;
      this.onDue?.({
        id: record.id,
        title: record.title,
        dueAt: record.dueAt,
        chatWindowId: record.chatWindowId,
        overdue,
      });
    }, { id: record.id });
  }
}
