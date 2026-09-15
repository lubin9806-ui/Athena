export type AgentRunVerification = 'verified' | 'unverified' | 'issues' | 'not_applicable';

interface VerifiableTask {
  spec: { validation: Array<{ required: boolean }> };
}

interface VerifiableRun {
  status: string;
  state: Record<string, unknown>;
}

interface VerifiableStep {
  kind: string;
  title: string;
  status: string;
  input: Record<string, unknown>;
}

export interface AgentToolOutcomeSummary<T extends VerifiableStep> {
  toolSteps: number;
  completed: number;
  /** Failed calls that no later identical call made good. */
  failed: T[];
  /** Calls that were refused (by the user, policy or budget) and never ran afterwards. */
  denied: T[];
  /** Failed or refused calls that a later identical call completed. */
  recovered: number;
}

/**
 * Separates a runner reaching its terminal state from evidence that the user's
 * goal succeeded. A failed call is recovered only when the exact same persisted
 * call later completes, which supports fix-and-rerun loops without hiding an
 * unrelated failure.
 *
 * This deliberately does not guess which failures "mattered". A failed probe the
 * agent worked around still shows up; the wording that goes with `issues` states
 * what happened (a step failed and was never redone), not that the goal failed.
 */
export function deriveAgentRunVerification(
  task: VerifiableTask,
  run: VerifiableRun,
  steps: readonly VerifiableStep[],
): AgentRunVerification {
  if (run.status !== 'completed') return 'not_applicable';
  if (task.spec.validation.some(item => item.required)) return 'verified';
  const toolSteps = steps.filter(step => step.kind === 'tool');
  if (toolSteps.length === 0) return 'not_applicable';
  return unresolvedAgentToolFailures(toolSteps).length > 0 ? 'issues' : 'unverified';
}

export function unresolvedAgentToolFailures<T extends VerifiableStep>(steps: readonly T[]): T[] {
  return steps.filter((step, index) => isUnsuccessful(step) && !isRedoneLater(steps, index));
}

export function summarizeAgentToolOutcome<T extends VerifiableStep>(steps: readonly T[]): AgentToolOutcomeSummary<T> {
  const tools = steps.filter(step => step.kind === 'tool');
  const failed: T[] = [];
  const denied: T[] = [];
  let recovered = 0;
  tools.forEach((step, index) => {
    if (!isUnsuccessful(step)) return;
    if (isRedoneLater(tools, index)) {
      recovered += 1;
    } else if (step.status === 'skipped') {
      denied.push(step);
    } else {
      failed.push(step);
    }
  });
  return {
    toolSteps: tools.length,
    completed: tools.filter(step => step.status === 'completed').length,
    failed,
    denied,
    recovered,
  };
}

function isUnsuccessful(step: VerifiableStep): boolean {
  return step.kind === 'tool' && (step.status === 'failed' || step.status === 'skipped');
}

function isRedoneLater(steps: readonly VerifiableStep[], index: number): boolean {
  const identity = agentToolStepIdentity(steps[index]);
  return steps.slice(index + 1).some(candidate => (
    candidate.kind === 'tool'
    && candidate.status === 'completed'
    && agentToolStepIdentity(candidate) === identity
  ));
}

function agentToolStepIdentity(step: VerifiableStep): string {
  const toolName = typeof step.input.toolName === 'string' ? step.input.toolName : step.title;
  const argumentsValue = isRecord(step.input.arguments) ? step.input.arguments : {};
  return `${toolName}\0${canonicalJson(argumentsValue)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
