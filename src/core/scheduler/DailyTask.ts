export interface DailyTaskResult {
  title: string;
  steps: string[];
}

export class DailyTask {
  readonly enabled = true;

  run(title: string = 'Daily reset'): DailyTaskResult {
    return {
      title,
      steps: [
        '整理今天最重要的一件事',
        '清掉一个小阻塞',
        '记录一个需要继续跟进的点',
      ],
    };
  }
}
