import type { WorkflowDefinition } from './WorkflowManager';
export const studyWorkflow: WorkflowDefinition = {
  id: 'study', label: '学习', description: '拆知识点、做练习、留下复盘。',
  steps: ['明确本轮学习目标', '拆成一个 25 分钟知识段', '完成一道自测或复述', '留下复盘和下一步'],
};
