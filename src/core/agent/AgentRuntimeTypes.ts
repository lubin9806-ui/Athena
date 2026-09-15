import type { AgentRunRecord, AgentRunSnapshot } from '../../shared/types';
import type { AgentRunVerification } from '../../shared/agentVerification';
export type { AgentRunVerification } from '../../shared/agentVerification';
import type {
  ModelAdapterCapabilities,
  ModelMessage,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition,
  ModelToolChoice,
} from '../ai/model';

export interface AgentModelClient {
  readonly providerName: string;
  readonly modelName: string;
  readonly capabilities: ModelAdapterCapabilities;
  /** The configured reply budget, when the client has one. */
  readonly maxOutputTokens?: number;
  chatWithTools(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    options?: {
      toolChoice?: ModelToolChoice;
      mode?: 'create' | 'companion' | 'reason' | 'execute';
      stream?: boolean;
      signal?: AbortSignal;
      overrides?: { maxTokens?: number };
    },
  ): Promise<ModelResponse>;
}

export interface PendingAgentToolCall {
  call: ModelToolCall;
  stepId: string | null;
}

export interface PendingAgentToolBatch {
  calls: PendingAgentToolCall[];
  cursor: number;
}

/** Why a run stopped, written once for a person and once for the log. */
export interface AgentRunFailureRecord {
  kind: string;
  code: string;
  message: string;
  detail: string;
}

export interface AgentRunBudget {
  modelRounds: number;
  toolCalls: number;
}

/**
 * A decision the runner waits on that is not about a tool call. Each one is held
 * as an ordinary approval so it survives a restart and shows on the same card.
 */
export type AgentRunnerGate =
  | { id: string; kind: 'model_retry'; failure: AgentRunFailureRecord; attempts: number }
  | { id: string; kind: 'budget_extension'; reason: 'model_rounds' | 'tool_calls' };

export interface AgentRunnerCheckpointV1 {
  version: 1;
  messages: ModelMessage[];
  round: number;
  toolCallCount: number;
  allowedCapabilities: string[];
  approvalMode: 'risk_based' | 'always';
  pendingBatch: PendingAgentToolBatch | null;
  validationResults: Record<string, {
    status: 'passed' | 'failed';
    evidence: string;
    stepId: string;
  }>;
  finalContent: string | null;
  /** Limits for this stretch of work. Checkpoints written before budgets could grow have none. */
  budget?: AgentRunBudget;
  gate?: AgentRunnerGate | null;
  /** The person declined more budget: one last model call, without tools, to report back. */
  closing?: boolean;
  /** The output-token budget that last worked for this run, so later rounds start there. */
  outputTokens?: number;
}

export interface CreateAgentExecutionInput {
  taskId: string;
  messages: ModelMessage[];
  allowedCapabilities: string[];
  approvalMode?: 'risk_based' | 'always';
  scene?: string;
  strategy?: string;
}

export interface AgentRunnerResult {
  runId: string;
  status: 'completed' | 'paused' | 'failed' | 'cancelled';
  content: string;
  error: string | null;
  verification: AgentRunVerification;
  /** Why a failed run failed, or what a run paused on a model outage is waiting out. */
  failure: AgentRunFailureRecord | null;
  snapshot: AgentRunSnapshot;
}

export interface AgentRunnerOptions {
  maxModelRounds?: number;
  maxToolCalls?: number;
  modelMaxAttempts?: number;
  modelRetryDelayMs?: number;
  maxPersistedToolOutputChars?: number;
}

export interface AgentRunHandle {
  run: AgentRunRecord;
  result: Promise<AgentRunnerResult>;
}
