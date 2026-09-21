export type AgentTaskStatus =
  | 'draft'
  | 'ready'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type AgentRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type AgentRunPhase =
  | 'understanding'
  | 'researching'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export type AgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled';
export type AgentRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AgentCapabilityAccess = 'read' | 'write' | 'execute' | 'network' | 'account';
export type AgentValidationStatus = 'pending' | 'passed' | 'failed' | 'not_applicable';

export interface AgentPlanStepSpec {
  id: string;
  title: string;
  description?: string;
  successCriteria: string[];
  requiredCapabilities: string[];
}

export interface AgentCapabilityRequirement {
  id: string;
  access: AgentCapabilityAccess;
  reason: string;
  required: boolean;
}

export interface AgentRiskSpec {
  id: string;
  level: AgentRiskLevel;
  description: string;
  mitigation?: string;
}

export interface AgentValidationSpec {
  id: string;
  description: string;
  command?: string;
  required: boolean;
}

export interface AgentTaskSpec {
  version: 1;
  goal: string;
  successCriteria: string[];
  constraints: string[];
  confirmedDecisions: string[];
  openQuestions: string[];
  plan: AgentPlanStepSpec[];
  requiredCapabilities: AgentCapabilityRequirement[];
  risks: AgentRiskSpec[];
  validation: AgentValidationSpec[];
}

export interface AgentTaskRecord {
  id: string;
  projectId: number | null;
  chatWindowId: number | null;
  title: string;
  status: AgentTaskStatus;
  spec: AgentTaskSpec;
  revision: number;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface AgentRunRecord {
  id: string;
  taskId: string;
  status: AgentRunStatus;
  phase: AgentRunPhase;
  scene: string;
  strategy: string;
  provider: string | null;
  model: string | null;
  state: Record<string, unknown>;
  approvalGroupId: string | null;
  error: string | null;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentStepRecord {
  id: string;
  runId: string;
  sequence: number;
  kind: string;
  title: string;
  status: AgentStepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentApprovalRecord {
  id: string;
  runId: string;
  stepId: string | null;
  groupId: string;
  capability: string;
  riskLevel: AgentRiskLevel;
  status: AgentApprovalStatus;
  request: Record<string, unknown>;
  decision: Record<string, unknown>;
  revision: number;
  createdAt: string;
  decidedAt: string | null;
}

export interface AgentArtifactRecord {
  id: string;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  kind: string;
  name: string;
  uri: string | null;
  metadata: Record<string, unknown>;
  validationStatus: AgentValidationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunEventRecord {
  id: number;
  runId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRunSnapshot {
  task: AgentTaskRecord;
  run: AgentRunRecord;
  steps: AgentStepRecord[];
  approvals: AgentApprovalRecord[];
  artifacts: AgentArtifactRecord[];
  events: AgentRunEventRecord[];
}

export interface AgentWorkspaceGoal {
  id: string;
  title: string;
  status: 'active' | 'achieved' | 'paused';
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkspaceMetadata {
  version: 1;
  revision: number;
  roots: string[];
  goals: AgentWorkspaceGoal[];
  updatedAt: string;
}

export interface AgentWorkspaceTaskBoard {
  draft: AgentTaskRecord[];
  ready: AgentTaskRecord[];
  active: AgentTaskRecord[];
  blocked: AgentTaskRecord[];
  completed: AgentTaskRecord[];
  failed: AgentTaskRecord[];
  cancelled: AgentTaskRecord[];
  archived: AgentTaskRecord[];
}

export interface AgentProjectWorkspaceSnapshot {
  project: {
    id: number;
    title: string;
    instructions: string;
  };
  metadata: AgentWorkspaceMetadata;
  board: AgentWorkspaceTaskBoard;
  tasks: AgentTaskRecord[];
  selectedTask: AgentTaskRecord | null;
  runs: AgentRunRecord[];
  selectedRun: AgentRunSnapshot | null;
  recoverableRunIds: string[];
}

export interface AgentExecutionSummary {
  taskId: string;
  runId: string;
  /** `running` means the message joined a run that is still working; its reply arrives with that run. */
  status: 'completed' | 'paused' | 'failed' | 'cancelled' | 'running';
}
