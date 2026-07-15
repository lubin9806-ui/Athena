export interface WorkflowDefinition {
  id: string;
  label: string;
  description: string;
  steps: string[];
}

export interface WorkflowRun {
  workflow: WorkflowDefinition;
  message: string;
}

export class WorkflowManager {
  readonly enabled = true;
  private readonly workflows = new Map<string, WorkflowDefinition>();

  constructor() {
    this.register({
      id: 'daily',
      label: '日常整理',
      description: '把杂乱状态收束成一个能开始的清单。',
      steps: ['确认当前状态', '挑出一件最小可推进任务', '记录一个后续提醒'],
    });
    this.register({
      id: 'study',
      label: '学习',
      description: '拆知识点、做练习、留下复盘。',
      steps: ['明确学习目标', '拆成 25 分钟小段', '产出一条复盘记忆'],
    });
    this.register({
      id: 'drawing',
      label: '绘画',
      description: '从灵感到构图再到下一笔。',
      steps: ['确定主题和情绪', '列出构图/色彩选择', '决定下一张草图动作'],
    });
    this.register({
      id: 'coding',
      label: '代码',
      description: '定位、修改、验证、记录。',
      steps: ['复述问题边界', '定位相关文件', '做最小修改', '运行验证命令'],
    });
  }

  register(definition: WorkflowDefinition): void {
    this.workflows.set(definition.id, definition);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  runWorkflow(id: string): WorkflowRun | undefined {
    const workflow = this.workflows.get(id);
    if (!workflow) return undefined;
    return {
      workflow,
      message: `${workflow.label}工作流已准备好：${workflow.steps.map((step, index) => `${index + 1}. ${step}`).join('；')}`,
    };
  }
}
