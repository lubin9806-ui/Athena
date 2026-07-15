import { globalScheduler, type ScheduledJob } from '../../engine/Scheduler';

export interface ReminderRequest {
  title: string;
  dueAt: Date;
}

export class Reminder {
  readonly enabled = true;

  schedule(request: ReminderRequest, onDue?: (job: ScheduledJob) => void): ScheduledJob {
    return globalScheduler.schedule(request.title, request.dueAt, onDue);
  }

  list(): ScheduledJob[] {
    return globalScheduler.listJobs();
  }

  cancel(id: string): boolean {
    return globalScheduler.cancel(id);
  }
}
