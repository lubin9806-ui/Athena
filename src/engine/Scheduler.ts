export type ScheduledJobStatus = 'scheduled' | 'completed' | 'cancelled';

export interface ScheduledJob {
  id: string;
  title: string;
  dueAt: string;
  status: ScheduledJobStatus;
  createdAt: string;
}

interface InternalJob {
  job: ScheduledJob;
  timer?: NodeJS.Timeout;
}

// setTimeout saturates above this delay and fires immediately instead, so any
// longer wait has to be split into chunks.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class Scheduler {
  readonly enabled = true;
  private readonly jobs = new Map<string, InternalJob>();

  // `id` lets a persistent caller keep its stored row and the in-memory timer under
  // the same identity, so a restored job can be cancelled by the id the user saw.
  schedule(title: string, dueAt: Date, onDue?: (job: ScheduledJob) => void, options: { id?: string } = {}): ScheduledJob {
    const id = options.id || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (this.jobs.has(id)) throw new Error(`Scheduled job already exists: ${id}`);
    const job: ScheduledJob = {
      id,
      title: title.trim() || 'Reminder',
      dueAt: dueAt.toISOString(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(id, { job });
    this.arm(id, dueAt.getTime(), onDue);
    return { ...job };
  }

  // The due time is the source of truth, not the timer: a capped or early-firing
  // timer (long delay, clock change, sleep/resume) re-arms for the remainder
  // instead of completing the job.
  private arm(id: string, dueAtMs: number, onDue?: (job: ScheduledJob) => void): void {
    const entry = this.jobs.get(id);
    if (!entry) return;
    const remaining = Math.max(0, dueAtMs - Date.now());
    entry.timer = setTimeout(() => {
      const current = this.jobs.get(id);
      if (!current || current.job.status !== 'scheduled') return;
      if (Date.now() < dueAtMs) {
        this.arm(id, dueAtMs, onDue);
        return;
      }
      current.job.status = 'completed';
      onDue?.({ ...current.job });
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  }

  /** Whether a timer is currently armed for this id. */
  has(id: string): boolean {
    return this.jobs.get(id)?.job.status === 'scheduled';
  }

  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values()).map(item => ({ ...item.job }));
  }

  cancel(id: string): boolean {
    const current = this.jobs.get(id);
    if (!current || current.job.status !== 'scheduled') return false;
    if (current.timer) clearTimeout(current.timer);
    current.job.status = 'cancelled';
    return true;
  }

  shutdown(): void {
    for (const item of this.jobs.values()) {
      if (item.timer) clearTimeout(item.timer);
    }
    this.jobs.clear();
  }
}

export const globalScheduler = new Scheduler();
