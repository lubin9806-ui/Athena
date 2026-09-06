import type { AgentRunRecord, AgentRunSnapshot } from '../../shared/types';
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
  chatWithTools(
    messages: ModelMessage[],
    tools: ModelToolDefinition[],
    options?: {
      toolChoice?: ModelToolChoice;
      mode?: 'create' | 'companion' | 'reason' | 'execute';
      stream?: boolean;
      signal?: AbortSignal;
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
}

export interface CreateAgentExecutionInput {
  taskId: string;
  messages: ModelMessage[];
  allowedCapabilities: string[];
  approvalMode?: 'risk_based' | 'always';
  scene?: string;
  strategy?: string;
}

// Whether a terminated run carries evidence that the goal was actually met.
// `verified` means the task declared required validations and they passed;
// `unverified` means the run acted but declared nothing to check against.
export type AgentRunVerification = 'verified' | 'unverified' | 'not_applicable';

export interface AgentRunnerResult {
  runId: string;
  status: 'completed' | 'paused' | 'failed' | 'cancelled';
  content: string;
  error: string | null;
  verification: AgentRunVerification;
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
