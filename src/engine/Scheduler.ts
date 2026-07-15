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

export class Scheduler {
  readonly enabled = true;
  private readonly jobs = new Map<string, InternalJob>();

  schedule(title: string, dueAt: Date, onDue?: (job: ScheduledJob) => void): ScheduledJob {
    const id = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job: ScheduledJob = {
      id,
      title: title.trim() || 'Reminder',
      dueAt: dueAt.toISOString(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };

    const delay = Math.max(0, dueAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      const current = this.jobs.get(id);
      if (!current || current.job.status !== 'scheduled') return;
      current.job.status = 'completed';
      onDue?.({ ...current.job });
    }, Math.min(delay, 2_147_483_647));

    this.jobs.set(id, { job, timer });
    return { ...job };
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
