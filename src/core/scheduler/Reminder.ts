import { globalScheduler, type ScheduledJob } from '../../engine/Scheduler';
import { createLogger } from '../../engine/Logger';
import {
  createScheduledJob,
  listPendingScheduledJobs,
  markScheduledJobCancelled,
  markScheduledJobCompleted,
  type ScheduledJobRecord,
} from './ScheduledJobStore';

const logger = createLogger('Reminder');

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
