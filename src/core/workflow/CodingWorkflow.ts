import type { WorkflowDefinition } from './WorkflowManager';
export const codingWorkflow: WorkflowDefinition = {
  id: 'coding', label: '代码', description: '定位、修改、验证、记录。',
  steps: ['复述问题边界与验收条件', '定位相关文件并确认影响范围', '做最小可回退修改', '运行验证命令并记录结果'],
};
