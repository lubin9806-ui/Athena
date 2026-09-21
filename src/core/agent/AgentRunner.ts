import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import type {
  AgentApprovalRecord,
  AgentRunRecord,
  AgentStepRecord,
  AgentTaskRecord,
} from '../../shared/types';
import { deriveAgentRunVerification } from '../../shared/agentVerification';
import {
  ModelCapabilityError,
  ModelOutputTruncatedError,
  ModelProtocolError,
  type ModelMessage,
  type ModelResponse,
  type ModelToolCall,
} from '../ai/model';
import { classifyModelFailure } from '../ai/ModelFailure';
import { AgentPolicyEngine, type AgentPolicyContext, type AgentPolicyDecision } from './AgentPolicyEngine';
import { AgentStore } from './AgentStore';
import {
  SESSION_USER_MESSAGE_EVENT,
  type AgentModelClient,
  type AgentRunBudget,
  type AgentRunFailureRecord,
  type AgentRunHandle,
  type AgentRunnerCheckpointV1,
  type AgentRunnerGate,
  type AgentRunnerOptions,
  type AgentRunnerResult,
  type AgentSessionUserMessage,
  type AgentSubmitUserMessageOutcome,
  type CreateAgentExecutionInput,
  type PendingAgentToolBatch,
  type PendingAgentToolCall,
} from './AgentRuntimeTypes';
import {
  AgentToolArgumentsError,
  AgentToolNotFoundError,
  AgentToolRetryableError,
  ToolRegistry,
  type AgentToolExecutionResult,
  type ResolvedAgentTool,
} from './ToolRegistry';

// A budget is not a failure line any more: reaching it pauses the run and asks.
// Sixteen rounds covers a write-run-fix-rerun loop without asking; the old eight
// was used up by a plain read-around-and-report task (2026-09-14 run log).
const DEFAULT_MAX_MODEL_ROUNDS = 16;
const DEFAULT_MAX_TOOL_CALLS = 48;
const DEFAULT_MODEL_ATTEMPTS = 3;
const DEFAULT_MODEL_RETRY_DELAY_MS = 1_000;
const MAX_MODEL_RETRY_DELAY_MS = 8_000;
const MIN_AGENT_OUTPUT_TOKENS = 8_192;
/** The adapters' own ceiling for a request's output budget. */
const MAX_AGENT_OUTPUT_TOKENS = 32_768;
const MAX_OUTPUT_BUDGET_RAISES = 2;
const MAX_INITIAL_MESSAGES = 128;
const MAX_CHECKPOINT_MESSAGES = 512;
const MAX_CHECKPOINT_CHARS = 16 * 1024 * 1024;
const MAX_MODEL_CONTENT_CHARS = 1_000_000;
const MAX_MODEL_TOOL_ARGUMENT_CHARS = 2_000_000;

const CLOSING_INSTRUCTION = [
  '这次任务的执行预算已经用完，用户选择不再继续。',
  '不要再调用任何工具。请根据上面真实的工具结果，如实说明：已经完成了什么、还没有完成什么、哪些步骤失败或没有执行。',
  '没有工具结果支持的内容不要说成已经完成。',
].join('\n');

const MAX_SESSION_MESSAGE_CHARS = 20_000;
/** Decision scopes written when the person answers a waiting run by writing to it instead. */
export const SUPERSEDED_BY_MESSAGE_SCOPE = 'superseded-by-message';
export const CONTINUED_BY_MESSAGE_SCOPE = 'continued-by-message';
/** Written on approvals the person's standing "免审批" decision granted. */
export const AUTO_APPROVE_SCOPE = 'auto-approve';

interface ActiveRun {
  controller: AbortController;
  promise: Promise<AgentRunnerResult>;
}

const ACTIVE_AGENT_RUNS = new Map<string, ActiveRun>();

interface PreparedCall {
  pending: PendingAgentToolCall;
  step: AgentStepRecord;
  resolved: ResolvedAgentTool | null;
  decision: AgentPolicyDecision | null;
  validationError: Error | null;
}

export class AgentRunBusyError extends Error {
  constructor(runId: string) {
    super(`Agent run is already active in this process: ${runId}`);
    this.name = 'AgentRunBusyError';
  }
}

export class AgentRunCancelledError extends Error {
  constructor() {
    super('Agent run was cancelled');
    this.name = 'AgentRunCancelledError';
  }
}

/** The model could not be reached after every attempt this request was allowed. */
class AgentModelUnavailableError extends Error {
  constructor(readonly failure: unknown, readonly attempts: number) {
    super(failure instanceof Error ? failure.message : String(failure || 'Model request failed'));
    this.name = 'AgentModelUnavailableError';
  }
}

export class AgentRunner {
  private readonly activeRuns = ACTIVE_AGENT_RUNS;
  private readonly maxModelRounds: number;
  private readonly maxToolCalls: number;
  private readonly modelMaxAttempts: number;
  private readonly modelRetryDelayMs: number;
  private readonly maxPersistedToolOutputChars: number;
  private readonly isAutoApproveEnabled: () => boolean;

  constructor(
    private readonly model: AgentModelClient,
    private readonly tools: ToolRegistry,
    private readonly policy = new AgentPolicyEngine(),
    private readonly store = new AgentStore(),
    options: AgentRunnerOptions = {},
  ) {
    this.maxModelRounds = clampInteger(options.maxModelRounds, 1, 32, DEFAULT_MAX_MODEL_ROUNDS);
    this.maxToolCalls = clampInteger(options.maxToolCalls, 1, 128, DEFAULT_MAX_TOOL_CALLS);
    this.modelMaxAttempts = clampInteger(options.modelMaxAttempts, 1, 5, DEFAULT_MODEL_ATTEMPTS);
    this.modelRetryDelayMs = clampInteger(options.modelRetryDelayMs, 0, 30_000, DEFAULT_MODEL_RETRY_DELAY_MS);
    this.maxPersistedToolOutputChars = clampInteger(options.maxPersistedToolOutputChars, 1_000, 200_000, 20_000);
    this.isAutoApproveEnabled = options.isAutoApproveEnabled || (() => false);
  }

  create(input: CreateAgentExecutionInput): AgentRunRecord {
    if (!this.model.capabilities.nativeToolCalls) {
      throw new ModelCapabilityError('AgentRunner requires a model adapter with native tool-call support');
    }
    const checkpoint = createCheckpoint(input, { modelRounds: this.maxModelRounds, toolCalls: this.maxToolCalls });
    return this.store.createRun({
      taskId: input.taskId,
      scene: input.scene || 'work',
      strategy: input.strategy || 'native-tools',
      provider: this.model.providerName,
      model: this.model.modelName,
      state: checkpoint as unknown as Record<string, unknown>,
    });
  }

  start(input: CreateAgentExecutionInput): AgentRunHandle {
    const run = this.create(input);
    return { run, result: this.run(run.id) };
  }

  run(runId: string): Promise<AgentRunnerResult> {
    if (this.activeRuns.has(runId)) return Promise.reject(new AgentRunBusyError(runId));
    const controller = new AbortController();
    const promise = this.drive(runId, controller.signal)
      .finally(() => this.activeRuns.delete(runId));
    this.activeRuns.set(runId, { controller, promise });
    return promise;
  }

  resume(runId: string): Promise<AgentRunnerResult> {
    return this.run(runId);
  }

  /** The current result of a run without driving it, e.g. after one of several approvals is decided. */
  inspect(runId: string): AgentRunnerResult {
    return this.buildResult(runId);
  }

  async cancel(runId: string): Promise<AgentRunnerResult> {
    const active = this.activeRuns.get(runId);
    if (active) {
      active.controller.abort(new AgentRunCancelledError());
      return active.promise;
    }
    await this.cancelPersistedRun(runId);
    return this.buildResult(runId);
  }

  listRecoverableRuns(limit = 100): AgentRunRecord[] {
    return this.store.listRecoverableRuns(limit);
  }

  /**
   * A message written to a run that has not finished belongs to that run.
   *
   * Replying while a run waited used to start a second, parallel task that knew
   * nothing of the first. A driving run now picks the message up before its
   * next model round. A waiting run treats the message as the person's answer:
   * an ordinary reply is retained without silently deciding pending tool calls;
   * only explicit stop/change wording supersedes those calls. A paused retry or
   * budget question counts as "go on", and the same run receives the message.
   */
  submitUserMessage(runId: string, message: AgentSessionUserMessage): AgentSubmitUserMessageOutcome {
    const run = this.store.getRun(runId);
    if (!run || isTerminalStatus(run.status)) return { outcome: 'terminal', runId };
    const content = message.content.trim().slice(0, MAX_SESSION_MESSAGE_CHARS);
    if (!content) throw new Error('A session message needs text');
    this.store.appendEvent(runId, SESSION_USER_MESSAGE_EVENT, {
      content,
      chatMessageId: positiveIntegerOrNull(message.chatMessageId),
      ...(message.images?.length ? { images: structuredClone(message.images) } : {}),
    });
    if (this.activeRuns.has(runId)) return { outcome: 'queued', runId };
    let waitingOnToolApproval = false;
    const supersedesPendingCalls = messageSupersedesPendingCalls(content);
    for (const approval of this.store.listApprovals(runId)) {
      if (approval.status !== 'pending') continue;
      const continues = approval.request.kind === 'model_retry' || approval.request.kind === 'budget_extension';
      if (!continues) {
        if (!supersedesPendingCalls) {
          // An answer or extra detail is not a rejection. Keep the pending
          // operation waiting for an explicit button decision; the inbox is
          // drained when the run resumes, so the model receives this message.
          waitingOnToolApproval = true;
          continue;
        }
      }
      this.store.resolveApproval(
        approval.id,
        continues ? 'approved' : 'denied',
        { actor: 'user', scope: continues ? CONTINUED_BY_MESSAGE_SCOPE : SUPERSEDED_BY_MESSAGE_SCOPE },
        approval.revision,
      );
    }
    if (waitingOnToolApproval) return { outcome: 'queued', runId };
    return { outcome: 'resumed', runId, result: this.run(runId) };
  }

  /** Messages that reached a run after it had stopped reading them, oldest first. */
  unreadSessionMessages(runId: string): AgentSessionUserMessage[] {
    const run = this.store.getRun(runId);
    if (!run) return [];
    let inboxSequence = 0;
    try {
      inboxSequence = parseCheckpoint(run.state).session?.inboxSequence ?? 0;
    } catch {
      inboxSequence = 0;
    }
    return this.readInbox(runId, inboxSequence).map(item => item.message);
  }

  private async drive(runId: string, signal: AbortSignal): Promise<AgentRunnerResult> {
    try {
      let run = requireRun(this.store, runId);
      if (isTerminalStatus(run.status)) return this.buildResult(runId);
      let state = parseCheckpoint(run.state);
      if (run.status === 'queued') run = this.store.startRun(run.id, run.revision);
      if (run.phase === 'understanding') {
        run = this.store.transitionRun(run.id, 'planning', run.revision, { state: state as unknown as Record<string, unknown> });
      }

      while (true) {
        throwIfAborted(signal);
        run = requireRun(this.store, runId);
        state = parseCheckpoint(run.state);
        if (state.gate) {
          const outcome = await this.settleGate(run, state);
          if (outcome === 'waiting' || outcome === 'finished') return this.buildResult(runId);
          continue;
        }
        if (run.phase === 'awaiting_approval' && !state.pendingBatch) {
          throw new Error('Awaiting-approval run has no persisted tool batch');
        }
        if (state.pendingBatch) {
          const paused = await this.processPendingBatch(run, state, signal);
          if (paused) return this.buildResult(runId);
          continue;
        }
        if (run.phase !== 'planning') {
          run = this.store.transitionRun(run.id, 'planning', run.revision);
        }
        if (this.drainInbox(run.id, state)) {
          run = this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, requireRun(this.store, run.id).revision);
        }
        if (state.closing) {
          const summary = await this.requestModel(run, state, signal, { closing: true });
          state.messages.push({ role: 'assistant', content: summary.content });
          state.round += 1;
          run = this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, requireRun(this.store, run.id).revision);
          return this.completeRun(run, state, summary.content);
        }
        const budget = this.budgetOf(state);
        if (state.round >= budget.modelRounds) {
          this.openGate(run, state, { id: randomUUID(), kind: 'budget_extension', reason: 'model_rounds' });
          return this.buildResult(runId);
        }
        const response = await this.requestModel(run, state, signal);
        state.messages.push({
          role: 'assistant',
          content: response.content,
          ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        });
        state.round += 1;
        run = this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, requireRun(this.store, run.id).revision);

        if (response.toolCalls.length === 0) {
          // Something the person wrote while this answer was being produced has not
          // been read yet: answer it before calling the turn finished.
          if (this.readInbox(run.id, state.session?.inboxSequence ?? 0).length > 0) continue;
          return this.completeRun(run, state, response.content);
        }
        state.pendingBatch = {
          cursor: 0,
          calls: response.toolCalls.map(call => ({ call: structuredClone(call), stepId: null })),
        };
        if (state.toolCallCount + response.toolCalls.length > budget.toolCalls) {
          // The calls stay pending behind the question, so a yes runs them and a no
          // still answers each one before the closing summary.
          this.openGate(run, state, { id: randomUUID(), kind: 'budget_extension', reason: 'tool_calls' });
          return this.buildResult(runId);
        }
        this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, run.revision);
      }
    } catch (error) {
      if (isCancellation(error, signal)) {
        await this.cancelPersistedRun(runId);
        return this.buildResult(runId);
      }
      if (error instanceof AgentModelUnavailableError) {
        // A dropped connection used to end the run and throw away every step it had
        // taken; the person could only start over. The run now waits at its
        // checkpoint with the reason on the card (2026-09-14, two "fetch failed" runs).
        if (this.parkForModelRetry(runId, error)) return this.buildResult(runId);
        await this.failPersistedRun(runId, failureRecordOf(error.failure));
        return this.buildResult(runId);
      }
      await this.failPersistedRun(runId, failureRecordOf(error));
      return this.buildResult(runId);
    }
  }

  private completeRun(initialRun: AgentRunRecord, state: AgentRunnerCheckpointV1, content: string): AgentRunnerResult {
    let run = initialRun;
    state.finalContent = content;
    assertRequiredValidations(requireTask(this.store, run.taskId), state);
    run = this.store.transitionRun(run.id, 'verifying', requireRun(this.store, run.id).revision, { state: state as unknown as Record<string, unknown> });
    run = this.store.transitionRun(run.id, 'completed', run.revision, { state: state as unknown as Record<string, unknown> });
    return this.buildResult(run.id);
  }

  private budgetOf(state: AgentRunnerCheckpointV1): AgentRunBudget {
    return state.budget ?? { modelRounds: this.maxModelRounds, toolCalls: this.maxToolCalls };
  }

  /** Adds messages the person wrote since the last model round, in the order they were sent. */
  private drainInbox(runId: string, state: AgentRunnerCheckpointV1): boolean {
    const unread = this.readInbox(runId, state.session?.inboxSequence ?? 0);
    if (unread.length === 0) return false;
    const session = state.session ?? {
      chatWindowId: null,
      ownStart: Math.max(0, state.messages.map(message => message.role).lastIndexOf('user')),
      inboxSequence: 0,
      lastChatMessageId: null,
    };
    for (const item of unread) {
      state.messages.push({
        role: 'user',
        content: item.message.content,
        ...(item.message.images?.length ? { images: item.message.images } : {}),
      });
      session.inboxSequence = item.sequence;
      if (item.message.chatMessageId && (session.lastChatMessageId ?? 0) < item.message.chatMessageId) {
        session.lastChatMessageId = item.message.chatMessageId;
      }
    }
    state.session = session;
    this.store.appendEvent(runId, 'session.messages_read', { count: unread.length, inboxSequence: session.inboxSequence });
    return true;
  }

  private readInbox(runId: string, afterSequence: number): Array<{ sequence: number; message: AgentSessionUserMessage }> {
    return this.store.listEvents(runId, 10_000)
      .filter(event => event.type === SESSION_USER_MESSAGE_EVENT && event.sequence > afterSequence)
      .flatMap(event => {
        const content = typeof event.payload.content === 'string' ? event.payload.content.trim() : '';
        if (!content) return [];
        const images = Array.isArray(event.payload.images) ? event.payload.images as AgentSessionUserMessage['images'] : undefined;
        return [{
          sequence: event.sequence,
          message: {
            content,
            chatMessageId: positiveIntegerOrNull(event.payload.chatMessageId),
            ...(images?.length ? { images } : {}),
          },
        }];
      });
  }

  private openGate(initialRun: AgentRunRecord, state: AgentRunnerCheckpointV1, gate: AgentRunnerGate): void {
    state.gate = gate;
    const run = this.store.checkpointRun(
      initialRun.id,
      state as unknown as Record<string, unknown>,
      requireRun(this.store, initialRun.id).revision,
    );
    this.requestGateApproval(run, state, gate);
  }

  private requestGateApproval(run: AgentRunRecord, state: AgentRunnerCheckpointV1, gate: AgentRunnerGate): void {
    const budget = this.budgetOf(state);
    const request: Record<string, unknown> = gate.kind === 'model_retry'
      ? {
          kind: 'model_retry',
          gateId: gate.id,
          failure: gate.failure,
          attempts: gate.attempts,
          round: state.round,
          completedToolSteps: this.store.listSteps(run.id).filter(step => step.kind === 'tool' && step.status === 'completed').length,
        }
      : {
          kind: 'budget_extension',
          gateId: gate.id,
          reason: gate.reason,
          used: { modelRounds: state.round, toolCalls: state.toolCallCount },
          budget,
          extension: { modelRounds: this.maxModelRounds, toolCalls: this.maxToolCalls },
          pendingToolCalls: state.pendingBatch ? state.pendingBatch.calls.length - state.pendingBatch.cursor : 0,
        };
    this.store.requestApproval({
      runId: run.id,
      capability: 'runner.continue',
      riskLevel: 'low',
      request,
    }, run.revision);
    this.store.appendEvent(run.id, 'runner.gate_opened', {
      gateId: gate.id,
      kind: gate.kind,
      ...(gate.kind === 'model_retry'
        ? { failureKind: gate.failure.kind, failureCode: gate.failure.code, attempts: gate.attempts }
        : { reason: gate.reason, round: state.round, toolCallCount: state.toolCallCount }),
    });
  }

  private async settleGate(
    initialRun: AgentRunRecord,
    state: AgentRunnerCheckpointV1,
  ): Promise<'waiting' | 'continue' | 'finished'> {
    const gate = state.gate;
    if (!gate) return 'continue';
    const approval = this.store.listApprovals(initialRun.id)
      .filter(item => item.request.kind === gate.kind && item.request.gateId === gate.id)
      .at(-1);
    if (!approval) {
      // The process stopped between saving the gate and asking: ask now.
      if (initialRun.phase === 'awaiting_approval') throw new Error(`Runner gate ${gate.id} has no approval record`);
      this.requestGateApproval(initialRun, state, gate);
      return 'waiting';
    }
    if (approval.status === 'pending') return 'waiting';

    this.store.appendEvent(initialRun.id, 'runner.gate_resolved', { gateId: gate.id, kind: gate.kind, decision: approval.status });
    if (approval.status !== 'approved' && gate.kind === 'model_retry') {
      await this.failPersistedRun(initialRun.id, gate.failure);
      return 'finished';
    }
    if (approval.status === 'approved' && gate.kind === 'budget_extension') {
      const budget = this.budgetOf(state);
      state.budget = {
        modelRounds: budget.modelRounds + this.maxModelRounds,
        toolCalls: budget.toolCalls + this.maxToolCalls,
      };
    }
    if (approval.status !== 'approved' && gate.kind === 'budget_extension') {
      await this.declinePendingCallsForBudget(initialRun.id, state);
      state.messages.push({ role: 'user', content: CLOSING_INSTRUCTION });
      state.closing = true;
    }
    state.gate = null;
    const run = requireRun(this.store, initialRun.id);
    if (run.phase === 'awaiting_approval') {
      this.store.transitionRun(run.id, 'planning', run.revision, { state: state as unknown as Record<string, unknown> });
    } else {
      this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, run.revision);
    }
    return 'continue';
  }

  /** Every call the model already proposed gets an answer, so the transcript stays valid. */
  private async declinePendingCallsForBudget(runId: string, state: AgentRunnerCheckpointV1): Promise<void> {
    const batch = state.pendingBatch;
    if (!batch) return;
    await this.ensureBatchSteps(runId, batch, state);
    for (let index = batch.cursor; index < batch.calls.length; index += 1) {
      const pending = batch.calls[index];
      const result: AgentToolExecutionResult = {
        status: 'denied',
        summary: '执行预算已用完，按你的选择没有执行',
        content: '执行预算已用完，用户选择停止，这一步没有执行。',
      };
      skipStepWithResult(this.store, requireStep(this.store, String(pending.stepId)), result);
      state.messages.push(toToolMessage(pending.call, result, this.maxPersistedToolOutputChars));
      batch.cursor = index + 1;
    }
    state.pendingBatch = null;
  }

  private parkForModelRetry(runId: string, error: AgentModelUnavailableError): boolean {
    const run = this.store.getRun(runId);
    if (!run || isTerminalStatus(run.status) || !['planning', 'executing', 'researching'].includes(run.phase)) return false;
    let state: AgentRunnerCheckpointV1;
    try {
      state = parseCheckpoint(run.state);
    } catch {
      return false;
    }
    if (state.gate || state.pendingBatch) return false;
    const failure = failureRecordOf(error.failure);
    if (failure.kind === 'cancelled') return false;
    this.openGate(run, state, { id: randomUUID(), kind: 'model_retry', failure, attempts: error.attempts });
    return true;
  }

  private async requestModel(
    run: AgentRunRecord,
    state: AgentRunnerCheckpointV1,
    signal: AbortSignal,
    options: { closing?: boolean } = {},
  ): Promise<ModelResponse> {
    let step = this.store.appendStep({
      runId: run.id,
      kind: 'model',
      title: `Model round ${state.round + 1}`,
      input: { round: state.round + 1, messageCount: state.messages.length, ...(options.closing ? { closing: true } : {}) },
    });
    step = this.store.transitionStep(step.id, 'running', step.revision);
    this.store.appendEvent(run.id, 'runner.model_requested', { stepId: step.id, round: state.round + 1 });
    // The configured budget is sized for a chat reply. A tool call carries whole file
    // contents, and a reasoning model spends part of any budget thinking first: at the
    // default 2048 tokens DeepSeek's write_file arguments were cut off at a few hundred
    // characters on every retry (2026-09-15 live run). Execution starts higher and
    // raises the budget again when a response still stops at the limit.
    const configuredOutputTokens = positiveIntegerOrNull(this.model.maxOutputTokens);
    const startingOutputTokens = state.outputTokens ?? Math.max(MIN_AGENT_OUTPUT_TOKENS, configuredOutputTokens ?? 0);
    let outputTokens = startingOutputTokens;
    let budgetRaises = 0;
    let loweredAfterRejection = false;
    let transportFailures = 0;
    let lastError: unknown;
    let attempts = 0;
    while (true) {
      throwIfAborted(signal);
      attempts += 1;
      try {
        const task = requireTask(this.store, run.taskId);
        const declared = new Set(task.spec.requiredCapabilities.map(item => item.id));
        const exposedCapabilities = state.allowedCapabilities.filter(capability => declared.has(capability));
        // The closing summary keeps the tool definitions (a transcript holding tool
        // results is not valid without them on some providers) but may not call one.
        const response = await this.model.chatWithTools(
          structuredClone(state.messages),
          this.tools.getModelDefinitionsForCapabilities(exposedCapabilities),
          { toolChoice: options.closing ? 'none' : 'auto', mode: 'reason', signal, overrides: { maxTokens: outputTokens } },
        );
        assertModelResponseBounds(response);
        // An answer that stopped at the limit is unfinished, not final.
        if (response.finishReason === 'length' && response.toolCalls.length === 0) {
          throw new ModelOutputTruncatedError('Output limit reached before the answer was complete');
        }
        // Later rounds start from the budget that worked instead of hitting the limit again.
        if (outputTokens !== startingOutputTokens) state.outputTokens = outputTokens;
        this.store.transitionStep(step.id, 'completed', requireStep(this.store, step.id).revision, {
          output: {
            attempt: attempts,
            finishReason: response.finishReason,
            contentChars: response.content.length,
            toolCalls: response.toolCalls.map(call => call.name),
            usage: response.usage,
            outputTokens,
          },
        });
        this.store.appendEvent(run.id, 'runner.model_completed', {
          stepId: step.id,
          attempt: attempts,
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
        });
        return response;
      } catch (error) {
        lastError = error;
        if (isCancellation(error, signal)) throw new AgentRunCancelledError();
        if (error instanceof ModelOutputTruncatedError && budgetRaises < MAX_OUTPUT_BUDGET_RAISES && outputTokens < MAX_AGENT_OUTPUT_TOKENS) {
          const raised = Math.min(MAX_AGENT_OUTPUT_TOKENS, outputTokens * 2);
          this.store.appendEvent(run.id, 'runner.model_output_budget_raised', { stepId: step.id, from: outputTokens, to: raised });
          outputTokens = raised;
          budgetRaises += 1;
          continue;
        }
        const failure = classifyModelFailure(error);
        // A provider may cap output below what execution asked for. Fall back to the
        // budget the person configured, once, before treating the rejection as final.
        if (failure.code === 'model.request_rejected' && !loweredAfterRejection
          && configuredOutputTokens !== null && outputTokens > configuredOutputTokens) {
          this.store.appendEvent(run.id, 'runner.model_output_budget_lowered', { stepId: step.id, from: outputTokens, to: configuredOutputTokens, error: failure.detail });
          outputTokens = configuredOutputTokens;
          loweredAfterRejection = true;
          budgetRaises = MAX_OUTPUT_BUDGET_RAISES;
          continue;
        }
        transportFailures += 1;
        if (transportFailures >= this.attemptsAllowed(error, failure.kind)) break;
        const delayMs = Math.min(MAX_MODEL_RETRY_DELAY_MS, this.modelRetryDelayMs * 2 ** (transportFailures - 1));
        this.store.appendEvent(run.id, 'runner.model_retry_scheduled', {
          stepId: step.id,
          attempt: attempts,
          delayMs,
          error: failure.detail,
          failureKind: failure.kind,
          failureCode: failure.code,
        });
        await abortableDelay(delayMs, signal);
      }
    }
    const failure = classifyModelFailure(lastError);
    this.store.transitionStep(step.id, 'failed', requireStep(this.store, step.id).revision, {
      output: { attempts, outputTokens, failureKind: failure.kind, failureCode: failure.code },
      error: failure.detail,
    });
    throw new AgentModelUnavailableError(lastError, attempts);
  }

  /**
   * A reset or refused connection is usually over in seconds, so it gets the full
   * allowance. A timeout already waited out its own long budget, and a malformed
   * response tends to repeat, so those get one more try before the run asks.
   */
  private attemptsAllowed(error: unknown, kind: string): number {
    if (!isRetryableModelError(error)) return 1;
    return kind === 'timeout' ? Math.min(2, this.modelMaxAttempts) : this.modelMaxAttempts;
  }

  private async processPendingBatch(
    initialRun: AgentRunRecord,
    state: AgentRunnerCheckpointV1,
    signal: AbortSignal,
  ): Promise<boolean> {
    const batch = state.pendingBatch;
    if (!batch) return false;
    let run = initialRun;
    const task = requireTask(this.store, run.taskId);
    await this.ensureBatchSteps(run.id, batch, state);
    run = requireRun(this.store, run.id);
    const prepared = this.prepareCalls(task, state, batch);
    const pausedForRecovery = await this.prepareInterruptedSteps(run, prepared, state);
    if (pausedForRecovery) return true;
    run = requireRun(this.store, run.id);
    const pausedForPolicy = await this.preparePolicyApprovals(run, prepared, state);
    if (pausedForPolicy) return true;
    run = requireRun(this.store, run.id);

    const approvals = this.store.listApprovals(run.id);
    const activeApprovals = run.approvalGroupId
      ? approvals.filter(item => item.groupId === run.approvalGroupId)
      : [];
    if (activeApprovals.some(item => item.status === 'pending')) return true;
    if (run.phase === 'awaiting_approval') {
      run = activeApprovals.every(item => item.status === 'approved')
        ? this.store.transitionRun(run.id, 'executing', run.revision)
        : this.store.transitionRun(run.id, 'planning', run.revision);
    }
    if (run.phase === 'planning') run = this.store.transitionRun(run.id, 'executing', run.revision);
    if (run.phase !== 'executing') throw new Error(`Pending tool batch cannot execute while run phase is ${run.phase}`);

    for (let index = batch.cursor; index < batch.calls.length; index += 1) {
      throwIfAborted(signal);
      const item = prepared[index];
      const currentStep = requireStep(this.store, item.step.id);
      let result: AgentToolExecutionResult;
      if (['completed', 'failed', 'skipped'].includes(currentStep.status)) {
        result = resultFromTerminalStep(currentStep);
      } else if (currentStep.status === 'cancelled') {
        throw new AgentRunCancelledError();
      } else if (item.validationError || !item.resolved || !item.decision) {
        result = {
          status: 'failed',
          summary: describeUnrunnableCall(item.pending.call.name, item.validationError),
          content: errorMessage(item.validationError),
        };
        completeStepWithResult(this.store, currentStep, result, 0);
      } else if (item.decision.kind === 'deny') {
        result = { status: 'denied', summary: '策略不允许这项操作，没有执行', content: item.decision.explanation };
        skipStepWithResult(this.store, currentStep, result);
      } else {
        const approval = findToolApproval(
          approvals,
          currentStep.id,
          item.pending.call,
          item.decision,
          item.resolved.definition.version,
          run.approvalGroupId,
        );
        const replayApproval = findReplayApproval(
          approvals,
          currentStep.id,
          item.pending.call,
          item.resolved.definition.version,
          run.approvalGroupId,
        );
        if ((item.decision.kind === 'approval' && approval?.status !== 'approved')
          || (replayApproval && replayApproval.status !== 'approved')) {
          const deniedByUser = approval?.status === 'denied' || replayApproval?.status === 'denied';
          const superseded = [approval, replayApproval].some(item => item?.decision.scope === SUPERSEDED_BY_MESSAGE_SCOPE);
          result = superseded
            ? {
                status: 'denied',
                summary: '用户没有批准，而是发来了新消息，这一步没有执行',
                content: '用户没有回答这次审批，而是发来了一条新消息（在后面）。这一步没有执行。先按新消息回应；如果这一步仍然需要，就重新提出，会重新征求批准。',
              }
            : {
                status: 'denied',
                summary: deniedByUser ? '你拒绝了这项操作，没有执行' : '这项操作没有获得批准，没有执行',
                content: deniedByUser ? '用户拒绝了这项操作。' : '这项操作的审批没有通过。',
              };
          skipStepWithResult(this.store, currentStep, result);
        } else {
          result = await this.executePreparedCall(run, currentStep, item.pending.call, item.resolved, signal);
        }
      }
      state.messages.push(toToolMessage(item.pending.call, result, this.maxPersistedToolOutputChars));
      recordValidationResults(state, currentStep.id, result);
      state.toolCallCount += 1;
      batch.cursor = index + 1;
      run = this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, requireRun(this.store, run.id).revision);
    }

    state.pendingBatch = null;
    run = this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, run.revision);
    this.store.transitionRun(run.id, 'planning', run.revision);
    return false;
  }

  private async ensureBatchSteps(
    runId: string,
    batch: PendingAgentToolBatch,
    state: AgentRunnerCheckpointV1,
  ): Promise<void> {
    const existingByCallId = new Map(this.store.listSteps(runId)
      .filter(step => typeof step.input.callId === 'string')
      .map(step => [String(step.input.callId), step]));
    let changed = false;
    for (const pending of batch.calls) {
      if (pending.stepId && this.store.getStep(pending.stepId)) continue;
      const existing = existingByCallId.get(pending.call.id);
      const step = existing || this.store.appendStep({
        runId,
        kind: 'tool',
        title: `Use ${pending.call.name}`,
        input: {
          callId: pending.call.id,
          toolName: pending.call.name,
          // Persisted with the step so the step list reads "执行命令 · npm test" even
          // after the tool has left the registry.
          toolLabel: this.tools.list().find(tool => tool.name === pending.call.name)?.label || pending.call.name,
          arguments: safelyPersistArguments(this.tools, pending.call),
        },
      });
      pending.stepId = step.id;
      changed = true;
    }
    if (changed) {
      const run = requireRun(this.store, runId);
      this.store.checkpointRun(runId, state as unknown as Record<string, unknown>, run.revision);
    }
  }

  private prepareCalls(
    task: AgentTaskRecord,
    state: AgentRunnerCheckpointV1,
    batch: PendingAgentToolBatch,
  ): PreparedCall[] {
    const context: AgentPolicyContext = {
      taskSpec: task.spec,
      allowedCapabilities: state.allowedCapabilities,
      approvalMode: state.approvalMode,
      autoApprove: this.isAutoApproveEnabled() === true,
    };
    return batch.calls.map((pending) => {
      const step = requireStep(this.store, String(pending.stepId));
      try {
        const resolved = this.tools.resolve(pending.call);
        return {
          pending,
          step,
          resolved,
          decision: this.policy.evaluate(resolved.policy, context),
          validationError: null,
        };
      } catch (error) {
        if (!(error instanceof AgentToolArgumentsError) && !(error instanceof AgentToolNotFoundError)) throw error;
        return { pending, step, resolved: null, decision: null, validationError: error };
      }
    });
  }

  private async prepareInterruptedSteps(
    initialRun: AgentRunRecord,
    prepared: PreparedCall[],
    state: AgentRunnerCheckpointV1,
  ): Promise<boolean> {
    let run = initialRun;
    let requested = false;
    const approvals = this.store.listApprovals(run.id);
    for (const item of prepared.slice(state.pendingBatch?.cursor || 0)) {
      let step = requireStep(this.store, item.step.id);
      if (step.status !== 'running' || !item.resolved) continue;
      step = this.store.transitionStep(step.id, 'waiting', step.revision, {
        output: { recovery: 'execution outcome was not checkpointed before interruption' },
      });
      this.store.appendEvent(run.id, 'runner.tool_interrupted', {
        stepId: step.id,
        toolName: item.pending.call.name,
        replaySafe: item.resolved.definition.idempotent || item.resolved.definition.supportsIdempotencyKey === true,
      });
      const replaySafe = item.resolved.definition.idempotent || item.resolved.definition.supportsIdempotencyKey === true;
      if (replaySafe || findReplayApproval(
        approvals,
        step.id,
        item.pending.call,
        item.resolved.definition.version,
        run.approvalGroupId,
      )) continue;
      run = requireRun(this.store, run.id);
      this.store.requestApproval({
        runId: run.id,
        stepId: step.id,
        capability: item.resolved.policy.capability,
        riskLevel: 'critical',
        request: {
          kind: 'uncertain_replay',
          callId: item.pending.call.id,
          toolName: item.pending.call.name,
          toolLabel: item.resolved.definition.label,
          toolVersion: item.resolved.definition.version,
          callFingerprint: fingerprintCall(item.pending.call),
          arguments: item.resolved.persistedArguments,
          preview: item.resolved.approvalPreview,
          explanation: 'Athena 上次退出时这一步正在执行，它的效果无法确认。',
        },
      }, run.revision);
      requested = true;
    }
    if (requested) return true;
    return this.store.listApprovals(run.id).some(item => item.status === 'pending' && item.request.kind === 'uncertain_replay');
  }

  private async preparePolicyApprovals(
    initialRun: AgentRunRecord,
    prepared: PreparedCall[],
    state: AgentRunnerCheckpointV1,
  ): Promise<boolean> {
    let run = initialRun;
    let requested = false;
    let approvals = this.store.listApprovals(run.id);
    for (const item of prepared.slice(state.pendingBatch?.cursor || 0)) {
      if (!item.resolved || item.decision?.kind !== 'approval') continue;
      let step = requireStep(this.store, item.step.id);
      if (findToolApproval(
        approvals,
        step.id,
        item.pending.call,
        item.decision,
        item.resolved.definition.version,
        run.approvalGroupId,
      )) continue;
      if (step.status === 'pending') step = this.store.transitionStep(step.id, 'waiting', step.revision);
      run = requireRun(this.store, run.id);
      const approval = this.store.requestApproval({
        runId: run.id,
        stepId: step.id,
        capability: item.decision.capability,
        riskLevel: item.decision.riskLevel,
        request: {
          kind: 'tool_call',
          callId: item.pending.call.id,
          toolName: item.pending.call.name,
          toolLabel: item.resolved.definition.label,
          toolVersion: item.resolved.definition.version,
          callFingerprint: fingerprintCall(item.pending.call),
          arguments: item.resolved.persistedArguments,
          preview: item.resolved.approvalPreview,
          explanation: item.decision.explanation,
        },
      }, run.revision);
      // With 免审批 on, the same record is written and immediately granted, so the
      // session still shows every call that was let through and on whose say-so.
      if (item.decision.autoApproved) {
        this.store.resolveApproval(approval.id, 'approved', { actor: 'auto-approve', scope: AUTO_APPROVE_SCOPE }, approval.revision);
      } else {
        requested = true;
      }
      approvals = this.store.listApprovals(run.id);
    }
    if (requested) return true;
    const pendingStepIds = new Set(prepared
      .slice(state.pendingBatch?.cursor || 0)
      .map(item => item.step.id));
    return approvals.some(item => item.status === 'pending' && item.stepId !== null && pendingStepIds.has(item.stepId));
  }

  private async executePreparedCall(
    run: AgentRunRecord,
    initialStep: AgentStepRecord,
    call: ModelToolCall,
    resolved: ResolvedAgentTool,
    signal: AbortSignal,
  ): Promise<AgentToolExecutionResult> {
    let step = initialStep;
    if (step.status === 'pending' || step.status === 'waiting') {
      step = this.store.transitionStep(step.id, 'running', step.revision);
    }
    const retrySafe = resolved.definition.idempotent || resolved.definition.supportsIdempotencyKey === true;
    const maxAttempts = retrySafe ? resolved.retry.maxAttempts : 1;
    let lastResult: AgentToolExecutionResult | null = null;
    let lastError: unknown;
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      throwIfAborted(signal);
      this.store.appendEvent(run.id, 'runner.tool_attempt_started', {
        stepId: step.id,
        callId: call.id,
        toolName: call.name,
        attempt,
      });
      const timeout = AbortSignal.timeout(Number(resolved.definition.timeoutMs || 60_000));
      const attemptSignal = AbortSignal.any([signal, timeout]);
      try {
        const result = await this.tools.executeResolved(call, resolved, {
          runId: run.id,
          stepId: step.id,
          callId: call.id,
          attempt,
          idempotencyKey: `${run.id}:${step.id}:${call.id}`,
          signal: attemptSignal,
        });
        throwIfAborted(signal);
        if (timeout.aborted) throw new AgentToolRetryableError(`Tool ${call.name} timed out`);
        lastResult = result;
        if (result.status !== 'failed' || result.retryable !== true || attempt >= maxAttempts) break;
      } catch (error) {
        if (isCancellation(error, signal)) throw new AgentRunCancelledError();
        lastError = error;
        const retryable = error instanceof AgentToolRetryableError ? error.retryable : timeout.aborted;
        if (!retryable || attempt >= maxAttempts) break;
      }
      const delayMs = Math.min(
        resolved.retry.maxDelayMs,
        resolved.retry.initialDelayMs * Math.pow(2, attempt - 1),
      );
      this.store.appendEvent(run.id, 'runner.tool_retry_scheduled', {
        stepId: step.id,
        callId: call.id,
        toolName: call.name,
        attempt,
        delayMs,
      });
      await abortableDelay(delayMs, signal);
    }
    const result = lastResult || {
      status: 'failed' as const,
      // The reason, not "Tool generate_image_artifact failed": this line is what the
      // step list shows and the first thing the model reads about the failure.
      summary: describeToolFailure(call.name, lastError),
      content: errorMessage(lastError),
      retryable: false,
    };
    completeStepWithResult(this.store, requireStep(this.store, step.id), result, attemptsUsed);
    this.store.appendEvent(run.id, 'runner.tool_completed', {
      stepId: step.id,
      callId: call.id,
      toolName: call.name,
      status: result.status,
    });
    return result;
  }

  private async cancelPersistedRun(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || isTerminalStatus(run.status)) return;
    for (const step of this.store.listSteps(runId)) {
      if (['pending', 'running', 'waiting'].includes(step.status)) {
        this.store.transitionStep(step.id, 'cancelled', step.revision, { error: 'Run cancelled' });
      }
    }
    this.cancelPendingApprovals(runId, 'Run cancelled');
    const current = requireRun(this.store, runId);
    if (!isTerminalStatus(current.status)) {
      this.store.transitionRun(runId, 'cancelled', current.revision, { error: 'Run cancelled' });
    }
  }

  private async failPersistedRun(runId: string, failure: AgentRunFailureRecord): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || isTerminalStatus(run.status)) return;
    for (const step of this.store.listSteps(runId)) {
      if (step.status === 'running') {
        this.store.transitionStep(step.id, 'failed', step.revision, { error: failure.detail });
      } else if (step.status === 'pending' || step.status === 'waiting') {
        this.store.transitionStep(step.id, 'cancelled', step.revision, { error: 'Run failed before this step completed' });
      }
    }
    this.cancelPendingApprovals(runId, 'Run failed');
    const current = requireRun(this.store, runId);
    if (!isTerminalStatus(current.status)) {
      this.store.appendEvent(runId, 'runner.failed', {
        error: failure.detail,
        message: failure.message,
        failureKind: failure.kind,
        failureCode: failure.code,
      });
      const latest = requireRun(this.store, runId);
      this.store.transitionRun(runId, 'failed', latest.revision, { error: failure.detail });
    }
  }

  private buildResult(runId: string): AgentRunnerResult {
    const snapshot = this.store.getRunSnapshot(runId);
    let content = '';
    let gate: AgentRunnerGate | null = null;
    try {
      const state = parseCheckpoint(snapshot.run.state);
      content = state.finalContent || '';
      gate = state.gate || null;
    }
    catch (error) {
      if (!isTerminalStatus(snapshot.run.status)) throw error;
    }
    const status = snapshot.run.status === 'paused'
      ? 'paused'
      : snapshot.run.status === 'completed'
        ? 'completed'
        : snapshot.run.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    return {
      runId,
      status,
      content,
      error: snapshot.run.error,
      verification: deriveAgentRunVerification(snapshot.task, snapshot.run, snapshot.steps),
      failure: status === 'failed'
        ? readRecordedFailure(snapshot.events, snapshot.run.error)
        : status === 'paused' && gate?.kind === 'model_retry'
          ? gate.failure
          : null,
      snapshot,
    };
  }

  private cancelPendingApprovals(runId: string, reason: string): void {
    for (const approval of this.store.listApprovals(runId)) {
      if (approval.status === 'pending') {
        this.store.resolveApproval(approval.id, 'cancelled', { actor: 'agent-runner', reason }, approval.revision);
      }
    }
  }
}

/**
 * Only explicit change/stop language supersedes a waiting tool call. A token,
 * path, port number or ordinary clarification must never be treated as a hidden
 * click on “拒绝”. This deliberately stays narrow; the visible buttons remain
 * the unambiguous approval channel.
 */
function messageSupersedesPendingCalls(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /(?:先别|不要|别再|取消|停一下|暂停|改成|改用|换成|更正|纠正|不是.{0,80}(?:而是|是)|instead\b|\b(?:stop|cancel|pause)\b|\bdo not\b|\bdon't\b)/iu.test(normalized);
}

function createCheckpoint(input: CreateAgentExecutionInput, budget: AgentRunBudget): AgentRunnerCheckpointV1 {
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_INITIAL_MESSAGES) {
    throw new Error(`Agent execution requires 1-${MAX_INITIAL_MESSAGES} initial messages`);
  }
  const checkpoint: AgentRunnerCheckpointV1 = {
    version: 1,
    messages: structuredClone(input.messages),
    round: 0,
    toolCallCount: 0,
    allowedCapabilities: Array.from(new Set(input.allowedCapabilities.map(item => item.trim()).filter(Boolean))).sort(),
    approvalMode: input.approvalMode === 'always' ? 'always' : 'risk_based',
    pendingBatch: null,
    validationResults: {},
    finalContent: null,
    budget,
    gate: null,
    ...(input.session
      ? {
          session: {
            chatWindowId: positiveIntegerOrNull(input.session.chatWindowId),
            // Everything before the last message was carried in from earlier turns
            // of this window; the UI and the next turn both need that line.
            ownStart: Math.max(0, input.messages.length - 1),
            inboxSequence: 0,
            lastChatMessageId: positiveIntegerOrNull(input.session.lastChatMessageId),
          },
        }
      : {}),
  };
  assertCheckpoint(checkpoint);
  return checkpoint;
}

function parseCheckpoint(value: Record<string, unknown>): AgentRunnerCheckpointV1 {
  const checkpoint = structuredClone(value) as unknown as AgentRunnerCheckpointV1;
  assertCheckpoint(checkpoint);
  return checkpoint;
}

function assertCheckpoint(value: AgentRunnerCheckpointV1): void {
  if (!value || value.version !== 1) throw new Error('Unsupported or missing agent runner checkpoint version');
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_CHECKPOINT_MESSAGES) {
    throw new Error('Invalid agent checkpoint messages');
  }
  for (const message of value.messages) {
    if (!message || !['system', 'user', 'assistant', 'tool'].includes(message.role)
      || typeof message.content !== 'string'
      || message.content.length > MAX_MODEL_CONTENT_CHARS) {
      throw new Error('Invalid message in agent checkpoint');
    }
    if (message.images !== undefined) {
      if (message.role !== 'user' || !Array.isArray(message.images) || message.images.length === 0 || message.images.length > 5) {
        throw new Error('Invalid image-bearing message in agent checkpoint');
      }
      for (const image of message.images) {
        if (!image || !/^[A-Za-z0-9._:-]{1,160}$/.test(image.id)
          || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
          || typeof image.filePath !== 'string' || image.filePath.length > 2_048 || !path.isAbsolute(image.filePath)
          || typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(image.sha256)
          || !Number.isInteger(image.bytes) || image.bytes <= 0 || image.bytes > 10 * 1024 * 1024
          || (image.detail !== undefined && !['auto', 'low', 'high'].includes(image.detail))) {
          throw new Error('Invalid image reference in agent checkpoint');
        }
      }
    }
  }
  if (!Number.isInteger(value.round) || value.round < 0) throw new Error('Invalid agent checkpoint round');
  if (!Number.isInteger(value.toolCallCount) || value.toolCallCount < 0) throw new Error('Invalid agent checkpoint tool count');
  if (!Array.isArray(value.allowedCapabilities) || value.allowedCapabilities.some(item => typeof item !== 'string')) {
    throw new Error('Invalid agent checkpoint capability grants');
  }
  if (!['risk_based', 'always'].includes(value.approvalMode)) throw new Error('Invalid agent checkpoint approval mode');
  if (!isRecord(value.validationResults)) throw new Error('Invalid agent checkpoint validation results');
  for (const [id, result] of Object.entries(value.validationResults)) {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id) || !isRecord(result)
      || (result.status !== 'passed' && result.status !== 'failed')
      || typeof result.evidence !== 'string'
      || typeof result.stepId !== 'string') {
      throw new Error(`Invalid agent validation checkpoint: ${id}`);
    }
  }
  if (value.pendingBatch !== null) {
    if (!value.pendingBatch || !Array.isArray(value.pendingBatch.calls) || value.pendingBatch.calls.length > 128
      || !Number.isInteger(value.pendingBatch.cursor)
      || value.pendingBatch.cursor < 0
      || value.pendingBatch.cursor > value.pendingBatch.calls.length) {
      throw new Error('Invalid pending agent tool batch');
    }
    for (const pending of value.pendingBatch.calls) assertPendingCall(pending);
  }
  if (value.finalContent !== null && typeof value.finalContent !== 'string') throw new Error('Invalid final agent content');
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)
      || !Number.isInteger(value.budget.modelRounds) || value.budget.modelRounds < 1
      || !Number.isInteger(value.budget.toolCalls) || value.budget.toolCalls < 1) {
      throw new Error('Invalid agent checkpoint budget');
    }
  }
  if (value.gate !== undefined && value.gate !== null) assertGate(value.gate);
  if (value.session !== undefined && value.session !== null) {
    const session = value.session as unknown;
    if (!isRecord(session)
      || (session.chatWindowId !== null && (!Number.isInteger(session.chatWindowId) || Number(session.chatWindowId) <= 0))
      || !Number.isInteger(session.ownStart) || Number(session.ownStart) < 0 || Number(session.ownStart) > value.messages.length
      || !Number.isInteger(session.inboxSequence) || Number(session.inboxSequence) < 0
      || (session.lastChatMessageId !== null && (!Number.isInteger(session.lastChatMessageId) || Number(session.lastChatMessageId) <= 0))) {
      throw new Error('Invalid agent checkpoint session state');
    }
  }
  if (value.closing !== undefined && typeof value.closing !== 'boolean') throw new Error('Invalid agent checkpoint closing flag');
  if (value.outputTokens !== undefined
    && (!Number.isInteger(value.outputTokens) || value.outputTokens < 128 || value.outputTokens > MAX_AGENT_OUTPUT_TOKENS)) {
    throw new Error('Invalid agent checkpoint output budget');
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_CHECKPOINT_CHARS) throw new Error(`Agent checkpoint exceeds ${MAX_CHECKPOINT_CHARS} characters`);
  } catch (error) {
    throw new Error(`Agent checkpoint is not persistable: ${errorMessage(error)}`);
  }
}

function assertGate(gate: AgentRunnerGate): void {
  if (!isRecord(gate) || typeof gate.id !== 'string' || !gate.id) throw new Error('Invalid agent checkpoint gate');
  if (gate.kind === 'model_retry') {
    const failure = gate.failure as unknown;
    if (!isRecord(failure)
      || ['kind', 'code', 'message', 'detail'].some(key => typeof failure[key] !== 'string')
      || !Number.isInteger(gate.attempts) || gate.attempts < 1) {
      throw new Error('Invalid model retry gate in agent checkpoint');
    }
    return;
  }
  if (gate.kind === 'budget_extension') {
    if (gate.reason !== 'model_rounds' && gate.reason !== 'tool_calls') throw new Error('Invalid budget gate in agent checkpoint');
    return;
  }
  throw new Error('Unknown agent checkpoint gate');
}

function assertPendingCall(value: PendingAgentToolCall): void {
  if (!value || (value.stepId !== null && typeof value.stepId !== 'string')) throw new Error('Invalid pending tool step id');
  const call = value.call;
  if (!call || typeof call.id !== 'string' || typeof call.name !== 'string'
    || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
    throw new Error('Invalid pending model tool call');
  }
}

function failureRecordOf(error: unknown): AgentRunFailureRecord {
  const failure = classifyModelFailure(error);
  return { kind: failure.kind, code: failure.code, message: failure.message, detail: failure.detail };
}

/** Prefers what was classified when the run failed: re-reading the log line loses the error's type. */
function readRecordedFailure(
  events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>,
  runError: string | null,
): AgentRunFailureRecord | null {
  const recorded = [...events].reverse().find(event => event.type === 'runner.failed');
  const payload = recorded?.payload;
  if (payload && typeof payload.message === 'string' && payload.message.trim()) {
    return {
      kind: typeof payload.failureKind === 'string' ? payload.failureKind : 'passthrough',
      code: typeof payload.failureCode === 'string' ? payload.failureCode : 'model.unclassified',
      message: payload.message,
      detail: typeof payload.error === 'string' ? payload.error : runError || '',
    };
  }
  return runError ? failureRecordOf(new Error(runError)) : null;
}

function safelyPersistArguments(registry: ToolRegistry, call: ModelToolCall): Record<string, unknown> {
  try { return registry.resolve(call).persistedArguments; }
  catch { return { validationError: true }; }
}

function findToolApproval(
  approvals: AgentApprovalRecord[],
  stepId: string,
  call: ModelToolCall,
  decision: AgentPolicyDecision,
  toolVersion: string,
  activeGroupId: string | null,
): AgentApprovalRecord | undefined {
  return findLatestApproval(approvals, stepId, 'tool_call', call, toolVersion, activeGroupId, decision);
}

function findReplayApproval(
  approvals: AgentApprovalRecord[],
  stepId: string,
  call: ModelToolCall,
  toolVersion: string,
  activeGroupId: string | null,
): AgentApprovalRecord | undefined {
  return findLatestApproval(approvals, stepId, 'uncertain_replay', call, toolVersion, activeGroupId);
}

function findLatestApproval(
  approvals: AgentApprovalRecord[],
  stepId: string,
  kind: 'tool_call' | 'uncertain_replay',
  call: ModelToolCall,
  toolVersion: string,
  activeGroupId: string | null,
  decision?: AgentPolicyDecision,
): AgentApprovalRecord | undefined {
  const matches = approvals.filter(item => (
    item.stepId === stepId
    && item.request.kind === kind
    && item.request.callId === call.id
    && item.request.toolName === call.name
    && item.request.toolVersion === toolVersion
    && item.request.callFingerprint === fingerprintCall(call)
    && (!decision || (item.capability === decision.capability && riskCovers(item.riskLevel, decision.riskLevel)))
    && (item.status !== 'pending' || item.groupId === activeGroupId)
  ));
  if (matches.length > 1) {
    throw new Error(`Duplicate scoped approvals for step ${stepId} and tool call ${call.id}`);
  }
  return matches[0];
}

function completeStepWithResult(
  store: AgentStore,
  step: AgentStepRecord,
  result: AgentToolExecutionResult,
  attempts: number,
): void {
  let current = step;
  if (current.status === 'pending' || current.status === 'waiting') {
    current = store.transitionStep(current.id, 'running', current.revision);
  }
  if (current.status !== 'running') return;
  store.transitionStep(current.id, result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed', current.revision, {
    output: {
      status: result.status,
      summary: result.summary,
      content: truncate(result.content, 20_000),
      metadata: result.metadata || {},
      validations: result.validations || [],
      attempts,
    },
    ...(result.status === 'completed' ? {} : { error: result.summary }),
  });
}

function skipStepWithResult(store: AgentStore, step: AgentStepRecord, result: AgentToolExecutionResult): void {
  if (step.status === 'pending' || step.status === 'waiting') {
    store.transitionStep(step.id, 'skipped', step.revision, {
      output: { status: result.status, summary: result.summary, content: truncate(result.content, 20_000) },
      error: result.summary,
    });
  }
}

function resultFromTerminalStep(step: AgentStepRecord): AgentToolExecutionResult {
  const storedStatus = step.output.status;
  const status = storedStatus === 'completed' || storedStatus === 'failed' || storedStatus === 'denied'
    ? storedStatus
    : step.status === 'completed'
      ? 'completed'
      : step.status === 'skipped'
        ? 'denied'
        : 'failed';
  return {
    status,
    summary: typeof step.output.summary === 'string' ? step.output.summary : step.title,
    content: typeof step.output.content === 'string' ? step.output.content : step.error || '',
    metadata: isRecord(step.output.metadata) ? step.output.metadata : undefined,
    validations: readPersistedValidations(step.output.validations),
  };
}

function toToolMessage(call: ModelToolCall, result: AgentToolExecutionResult, maxChars: number): ModelMessage {
  return {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: JSON.stringify({
      status: result.status,
      summary: result.summary,
      output: truncate(result.content, maxChars),
      metadata: result.metadata || {},
      validations: result.validations || [],
    }),
  };
}

function recordValidationResults(
  state: AgentRunnerCheckpointV1,
  stepId: string,
  result: AgentToolExecutionResult,
): void {
  for (const validation of result.validations || []) {
    state.validationResults[validation.id] = {
      status: validation.status,
      evidence: validation.evidence,
      stepId,
    };
  }
}

function readPersistedValidations(value: unknown): AgentToolExecutionResult['validations'] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).flatMap((item) => (
    typeof item.id === 'string'
    && (item.status === 'passed' || item.status === 'failed')
    && typeof item.evidence === 'string'
      ? [{ id: item.id, status: item.status, evidence: item.evidence }]
      : []
  ));
}

/**
 * What the step list and the model are told when a call never reached its tool.
 *
 * "Tool call validation failed" was all either of them got. When the tool had
 * left the registry between approval and execution - the image engine went quiet
 * overnight while the approval waited - the model read the internal "is not
 * registered" detail as "Athena has no image tool" and told the user so.
 */
function describeUnrunnableCall(name: string, error: Error | null): string {
  if (error instanceof AgentToolNotFoundError) {
    return `${name} 现在不可用（它依赖的权限或服务在这期间变了），这一步没有执行`;
  }
  if (error instanceof AgentToolArgumentsError) return `${name} 的参数不符合要求，这一步没有执行`;
  return `${name} 的调用无效，这一步没有执行`;
}

function describeToolFailure(name: string, error: unknown): string {
  const reason = errorMessage(error).replace(/\s+/g, ' ').trim();
  if (!reason) return `${name} 执行失败`;
  return reason.length > 300 ? `${reason.slice(0, 297)}...` : reason;
}

function assertRequiredValidations(task: AgentTaskRecord, state: AgentRunnerCheckpointV1): void {
  const unmet = task.spec.validation
    .filter(item => item.required && state.validationResults[item.id]?.status !== 'passed')
    .map(item => item.id);
  if (unmet.length > 0) throw new Error(`Required task validations are not passed: ${unmet.join(', ')}`);
}

function assertModelResponseBounds(response: ModelResponse): void {
  if (response.content.length > MAX_MODEL_CONTENT_CHARS) {
    throw new ModelProtocolError(`Model response content exceeds ${MAX_MODEL_CONTENT_CHARS} characters`);
  }
  let argumentsChars = 0;
  for (const call of response.toolCalls) {
    argumentsChars += call.rawArguments.length;
    if (argumentsChars > MAX_MODEL_TOOL_ARGUMENT_CHARS) {
      throw new ModelProtocolError(`Model tool arguments exceed ${MAX_MODEL_TOOL_ARGUMENT_CHARS} characters`);
    }
  }
}

function fingerprintCall(call: ModelToolCall): string {
  return createHash('sha256')
    .update(call.name)
    .update('\0')
    .update(canonicalJson(call.arguments))
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function riskCovers(granted: AgentApprovalRecord['riskLevel'], required: AgentApprovalRecord['riskLevel']): boolean {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  return rank[granted] >= rank[required];
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelProtocolError
    || error instanceof ModelCapabilityError
    || error instanceof AgentToolArgumentsError
    || error instanceof AgentToolNotFoundError) return false;
  return classifyModelFailure(error).retryable;
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || error instanceof AgentRunCancelledError
    || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') && signal.aborted);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentRunCancelledError();
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new AgentRunCancelledError());
    };
    function finish(): void {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function requireRun(store: AgentStore, id: string): AgentRunRecord {
  const run = store.getRun(id);
  if (!run) throw new Error(`Agent run not found: ${id}`);
  return run;
}

function requireTask(store: AgentStore, id: string): AgentTaskRecord {
  const task = store.getTask(id);
  if (!task) throw new Error(`Agent task not found: ${id}`);
  return task;
}

function requireStep(store: AgentStore, id: string): AgentStepRecord {
  const step = store.getStep(id);
  if (!step) throw new Error(`Agent step not found: ${id}`);
  return step;
}

function isTerminalStatus(status: AgentRunRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 24))}\n...[truncated]`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : fallback));
}

function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
