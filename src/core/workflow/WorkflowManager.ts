import { codingWorkflow } from './CodingWorkflow';
import { drawingWorkflow } from './DrawingWorkflow';
import { dailyWorkflow } from './DailyWorkflow';
import { studyWorkflow } from './StudyWorkflow';

export interface WorkflowDefinition {
  id: string;
  label: string;
  description: string;
  steps: string[];
}

export interface WorkflowRun {
  workflow: WorkflowDefinition;
  currentStep: number;
  completed: boolean;
  message: string;
}

export class WorkflowManager {
  readonly enabled = true;
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private active: { workflow: WorkflowDefinition; currentStep: number } | null = null;

  constructor() {
    [dailyWorkflow, studyWorkflow, drawingWorkflow, codingWorkflow].forEach(definition => this.register(definition));
  }

  register(definition: WorkflowDefinition): void {
    if (!definition.id.trim() || definition.steps.length === 0) throw new Error('Workflow requires an id and at least one step.');
    this.workflows.set(definition.id, { ...definition, steps: [...definition.steps] });
  }

  listWorkflows(): WorkflowDefinition[] { return Array.from(this.workflows.values()).map(item => ({ ...item, steps: [...item.steps] })); }

  startWorkflow(id: string): WorkflowRun | undefined {
    const workflow = this.workflows.get(id);
    if (!workflow) return undefined;
    this.active = { workflow, currentStep: 0 };
    return this.describeActive(`${workflow.label}工作流已开始`);
  }

  advanceWorkflow(): WorkflowRun | undefined {
    if (!this.active) return undefined;
    this.active.currentStep += 1;
    if (this.active.currentStep >= this.active.workflow.steps.length) {
      const completed = this.describeActive(`${this.active.workflow.label}工作流已完成`, true);
      this.active = null;
      return completed;
    }
    return this.describeActive('已进入下一步');
  }

  cancelWorkflow(): WorkflowRun | undefined {
    if (!this.active) return undefined;
    const cancelled = this.describeActive(`${this.active.workflow.label}工作流已取消`, true);
    this.active = null;
    return cancelled;
  }

  getActiveWorkflow(): WorkflowRun | undefined { return this.active ? this.describeActive('当前工作流') : undefined; }

  /** Compatibility alias: a run now starts an actual bounded session. */
  runWorkflow(id: string): WorkflowRun | undefined { return this.startWorkflow(id); }

  private describeActive(prefix: string, completed = false): WorkflowRun {
    const active = this.active!;
    const stepIndex = Math.min(active.currentStep, active.workflow.steps.length - 1);
    const step = active.workflow.steps[stepIndex];
    return {
      workflow: { ...active.workflow, steps: [...active.workflow.steps] },
      currentStep: stepIndex,
      completed,
      message: completed
        ? `${prefix}。`
        : `${prefix}。第 ${stepIndex + 1}/${active.workflow.steps.length} 步：${step}。完成后说“工作流下一步”，也可以说“取消工作流”。`,
    };
  }
}
