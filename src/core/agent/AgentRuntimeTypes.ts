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
  /** Where this run sits in its chat window's execute session. Runs from before sessions have none. */
  session?: AgentRunSessionState;
}

export interface AgentRunSessionState {
  chatWindowId: number | null;
  /** Index of this run's own first message; everything before it was carried in from earlier turns. */
  ownStart: number;
  /** The last `session.user_message` event already added to `messages`. */
  inboxSequence: number;
  /** The newest chat message this run has read, so the next turn knows what came after it. */
  lastChatMessageId: number | null;
}

/** Recorded on a run when the person writes to it while it is running or waiting. */
export const SESSION_USER_MESSAGE_EVENT = 'session.user_message';

export interface AgentSessionUserMessage {
  content: string;
  chatMessageId?: number | null;
  images?: ModelMessage['images'];
}

export type AgentSubmitUserMessageOutcome =
  /** The run was driving in this process; the message joins before its next model round. */
  | { outcome: 'queued'; runId: string }
  /** The run was waiting; what it waited on was answered by the message and the run continues. */
  | { outcome: 'resumed'; runId: string; result: Promise<AgentRunnerResult> }
  /** The run had already finished; the caller starts the next turn instead. */
  | { outcome: 'terminal'; runId: string };

export interface CreateAgentExecutionInput {
  taskId: string;
  messages: ModelMessage[];
  allowedCapabilities: string[];
  approvalMode?: 'risk_based' | 'always';
  scene?: string;
  strategy?: string;
  session?: { chatWindowId: number | null; lastChatMessageId?: number | null };
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
