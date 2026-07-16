import type { WorkflowDefinition } from './WorkflowManager';
export const drawingWorkflow: WorkflowDefinition = {
  id: 'drawing', label: '绘画', description: '从灵感到构图再到下一笔。',
  steps: ['确定主题、用途和情绪', '列出构图与色彩选择', '完成一张最小草图', '记录要保留和要调整的部分'],
};
