import type { WorkflowDefinition } from './WorkflowManager';
export const dailyWorkflow: WorkflowDefinition = {
  id: 'daily', label: '日常整理', description: '把杂乱状态收束成一个能开始的清单。',
  steps: ['确认当前状态和可用时间', '挑出一件最小可推进任务', '执行或安排这件任务', '记录一个后续提醒'],
};
