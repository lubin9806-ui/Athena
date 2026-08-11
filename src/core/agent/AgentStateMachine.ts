import type { AgentRunPhase, AgentRunStatus, AgentStepStatus, AgentTaskStatus } from '../../shared/types';

const taskTransitions: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
  draft: ['ready', 'cancelled', 'archived'],
  ready: ['active', 'cancelled', 'archived'],
  active: ['blocked', 'completed', 'failed', 'cancelled'],
  blocked: ['active', 'failed', 'cancelled'],
  completed: ['archived'],
  failed: ['ready', 'archived'],
  cancelled: ['ready', 'archived'],
  archived: [],
};

const runPhaseTransitions: Record<AgentRunPhase, readonly AgentRunPhase[]> = {
  understanding: ['researching', 'planning', 'awaiting_approval', 'executing', 'verifying', 'failed', 'cancelled'],
  researching: ['planning', 'awaiting_approval', 'executing', 'failed', 'cancelled'],
  planning: ['researching', 'awaiting_approval', 'executing', 'verifying', 'failed', 'cancelled'],
  awaiting_approval: ['planning', 'executing', 'failed', 'cancelled'],
  executing: ['planning', 'awaiting_approval', 'verifying', 'failed', 'cancelled'],
  verifying: ['planning', 'executing', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const stepTransitions: Record<AgentStepStatus, readonly AgentStepStatus[]> = {
  pending: ['running', 'waiting', 'cancelled', 'skipped'],
  running: ['waiting', 'completed', 'failed', 'cancelled'],
  waiting: ['running', 'completed', 'failed', 'cancelled', 'skipped'],
  completed: [],
  failed: [],
  cancelled: [],
  skipped: [],
};

export class AgentStateTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} state transition: ${from} -> ${to}`);
    this.name = 'AgentStateTransitionError';
  }
}

export function assertTaskTransition(from: AgentTaskStatus, to: AgentTaskStatus): void {
  if (!taskTransitions[from].includes(to)) throw new AgentStateTransitionError('task', from, to);
}

export function assertRunPhaseTransition(from: AgentRunPhase, to: AgentRunPhase): void {
  if (!runPhaseTransitions[from].includes(to)) throw new AgentStateTransitionError('run', from, to);
}

export function assertStepTransition(from: AgentStepStatus, to: AgentStepStatus): void {
  if (!stepTransitions[from].includes(to)) throw new AgentStateTransitionError('step', from, to);
}

export function runStatusForPhase(phase: AgentRunPhase): AgentRunStatus {
  if (phase === 'awaiting_approval') return 'paused';
  if (phase === 'completed') return 'completed';
  if (phase === 'failed') return 'failed';
  if (phase === 'cancelled') return 'cancelled';
  return 'running';
}

export function isTerminalRunPhase(phase: AgentRunPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

export function isTerminalStepStatus(status: AgentStepStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}
