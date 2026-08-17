import { createHash } from 'crypto';
import * as path from 'path';
import type {
  AgentApprovalRecord,
  AgentRunRecord,
  AgentStepRecord,
  AgentTaskRecord,
} from '../../shared/types';
import {
  ModelCapabilityError,
  ModelProtocolError,
  type ModelMessage,
  type ModelResponse,
  type ModelToolCall,
} from '../ai/model';
import { AgentPolicyEngine, type AgentPolicyContext, type AgentPolicyDecision } from './AgentPolicyEngine';
import { AgentStore } from './AgentStore';
import type {
  AgentModelClient,
  AgentRunHandle,
  AgentRunnerCheckpointV1,
  AgentRunnerOptions,
  AgentRunnerResult,
  CreateAgentExecutionInput,
  PendingAgentToolBatch,
  PendingAgentToolCall,
} from './AgentRuntimeTypes';
import {
  AgentToolArgumentsError,
  AgentToolNotFoundError,
  AgentToolRetryableError,
  ToolRegistry,
  type AgentToolExecutionResult,
  type ResolvedAgentTool,
} from './ToolRegistry';

const DEFAULT_MAX_MODEL_ROUNDS = 8;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MODEL_ATTEMPTS = 2;
const MAX_INITIAL_MESSAGES = 128;
const MAX_CHECKPOINT_MESSAGES = 512;
const MAX_CHECKPOINT_CHARS = 16 * 1024 * 1024;
const MAX_MODEL_CONTENT_CHARS = 1_000_000;
const MAX_MODEL_TOOL_ARGUMENT_CHARS = 2_000_000;

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

export class AgentRunner {
  private readonly activeRuns = ACTIVE_AGENT_RUNS;
  private readonly maxModelRounds: number;
  private readonly maxToolCalls: number;
  private readonly modelMaxAttempts: number;
  private readonly modelRetryDelayMs: number;
  private readonly maxPersistedToolOutputChars: number;

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
    this.modelRetryDelayMs = clampInteger(options.modelRetryDelayMs, 0, 30_000, 400);
    this.maxPersistedToolOutputChars = clampInteger(options.maxPersistedToolOutputChars, 1_000, 200_000, 20_000);
  }

  create(input: CreateAgentExecutionInput): AgentRunRecord {
    if (!this.model.capabilities.nativeToolCalls) {
      throw new ModelCapabilityError('AgentRunner requires a model adapter with native tool-call support');
    }
    const checkpoint = createCheckpoint(input);
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
        if (run.phase === 'awaiting_approval' && !state.pendingBatch) {
          throw new Error('Awaiting-approval run has no persisted tool batch');
        }
        if (state.pendingBatch) {
          const paused = await this.processPendingBatch(run, state, signal);
          if (paused) return this.buildResult(runId);
          continue;
        }
        if (state.round >= this.maxModelRounds) {
          throw new Error(`Agent model round limit reached (${this.maxModelRounds})`);
        }
        if (run.phase !== 'planning') {
          run = this.store.transitionRun(run.id, 'planning', run.revision);
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
          state.finalContent = response.content;
          assertRequiredValidations(requireTask(this.store, run.taskId), state);
          run = this.store.transitionRun(run.id, 'verifying', run.revision, { state: state as unknown as Record<string, unknown> });
          run = this.store.transitionRun(run.id, 'completed', run.revision, { state: state as unknown as Record<string, unknown> });
          return this.buildResult(run.id);
        }
        if (state.toolCallCount + response.toolCalls.length > this.maxToolCalls) {
          throw new Error(`Agent tool call limit reached (${this.maxToolCalls})`);
        }
        state.pendingBatch = {
          cursor: 0,
          calls: response.toolCalls.map(call => ({ call: structuredClone(call), stepId: null })),
        };
        this.store.checkpointRun(run.id, state as unknown as Record<string, unknown>, run.revision);
      }
    } catch (error) {
      if (isCancellation(error, signal)) {
        await this.cancelPersistedRun(runId);
        return this.buildResult(runId);
      }
      await this.failPersistedRun(runId, error);
      return this.buildResult(runId);
    }
  }

  private async requestModel(
    run: AgentRunRecord,
    state: AgentRunnerCheckpointV1,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    let step = this.store.appendStep({
      runId: run.id,
      kind: 'model',
      title: `Model round ${state.round + 1}`,
      input: { round: state.round + 1, messageCount: state.messages.length },
    });
    step = this.store.transitionStep(step.id, 'running', step.revision);
    this.store.appendEvent(run.id, 'runner.model_requested', { stepId: step.id, round: state.round + 1 });
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.modelMaxAttempts; attempt += 1) {
      throwIfAborted(signal);
      try {
        const task = requireTask(this.store, run.taskId);
        const declared = new Set(task.spec.requiredCapabilities.map(item => item.id));
        const exposedCapabilities = state.allowedCapabilities.filter(capability => declared.has(capability));
        const response = await this.model.chatWithTools(
          structuredClone(state.messages),
          this.tools.getModelDefinitionsForCapabilities(exposedCapabilities),
          { toolChoice: 'auto', mode: 'reason', signal },
        );
        assertModelResponseBounds(response);
        this.store.transitionStep(step.id, 'completed', requireStep(this.store, step.id).revision, {
          output: {
            attempt,
            finishReason: response.finishReason,
            contentChars: response.content.length,
            toolCalls: response.toolCalls.map(call => call.name),
            usage: response.usage,
          },
        });
        this.store.appendEvent(run.id, 'runner.model_completed', {
          stepId: step.id,
          attempt,
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
        });
        return response;
      } catch (error) {
        lastError = error;
        if (isCancellation(error, signal)) throw new AgentRunCancelledError();
        if (!isRetryableModelError(error) || attempt >= this.modelMaxAttempts) break;
        this.store.appendEvent(run.id, 'runner.model_retry_scheduled', {
          stepId: step.id,
          attempt,
          error: errorMessage(error),
        });
        await abortableDelay(this.modelRetryDelayMs * attempt, signal);
      }
    }
    this.store.transitionStep(step.id, 'failed', requireStep(this.store, step.id).revision, { error: errorMessage(lastError) });
    throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
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
          summary: 'Tool call validation failed',
          content: errorMessage(item.validationError),
        };
        completeStepWithResult(this.store, currentStep, result, 0);
      } else if (item.decision.kind === 'deny') {
        result = { status: 'denied', summary: 'Tool call denied by policy', content: item.decision.explanation };
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
          result = {
            status: 'denied',
            summary: 'Tool call was not approved',
            content: approval?.status === 'denied' || replayApproval?.status === 'denied'
              ? 'The user denied this scoped operation.'
              : 'The scoped approval was not granted.',
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
          toolVersion: item.resolved.definition.version,
          callFingerprint: fingerprintCall(item.pending.call),
          arguments: item.resolved.persistedArguments,
          explanation: 'The previous process stopped while this non-idempotent tool was running. Its side effects are unknown.',
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
      this.store.requestApproval({
        runId: run.id,
        stepId: step.id,
        capability: item.decision.capability,
        riskLevel: item.decision.riskLevel,
        request: {
          kind: 'tool_call',
          callId: item.pending.call.id,
          toolName: item.pending.call.name,
          toolVersion: item.resolved.definition.version,
          callFingerprint: fingerprintCall(item.pending.call),
          arguments: item.resolved.persistedArguments,
          explanation: item.decision.explanation,
        },
      }, run.revision);
      approvals = this.store.listApprovals(run.id);
      requested = true;
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
      summary: `Tool ${call.name} failed`,
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

  private async failPersistedRun(runId: string, error: unknown): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run || isTerminalStatus(run.status)) return;
    for (const step of this.store.listSteps(runId)) {
      if (step.status === 'running') {
        this.store.transitionStep(step.id, 'failed', step.revision, { error: errorMessage(error) });
      } else if (step.status === 'pending' || step.status === 'waiting') {
        this.store.transitionStep(step.id, 'cancelled', step.revision, { error: 'Run failed before this step completed' });
      }
    }
    this.cancelPendingApprovals(runId, 'Run failed');
    const current = requireRun(this.store, runId);
    if (!isTerminalStatus(current.status)) {
      this.store.appendEvent(runId, 'runner.failed', { error: errorMessage(error) });
      const latest = requireRun(this.store, runId);
      this.store.transitionRun(runId, 'failed', latest.revision, { error: errorMessage(error) });
    }
  }

  private buildResult(runId: string): AgentRunnerResult {
    const snapshot = this.store.getRunSnapshot(runId);
    let content = '';
    try { content = parseCheckpoint(snapshot.run.state).finalContent || ''; }
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

function createCheckpoint(input: CreateAgentExecutionInput): AgentRunnerCheckpointV1 {
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
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_CHECKPOINT_CHARS) throw new Error(`Agent checkpoint exceeds ${MAX_CHECKPOINT_CHARS} characters`);
  } catch (error) {
    throw new Error(`Agent checkpoint is not persistable: ${errorMessage(error)}`);
  }
}

function assertPendingCall(value: PendingAgentToolCall): void {
  if (!value || (value.stepId !== null && typeof value.stepId !== 'string')) throw new Error('Invalid pending tool step id');
  const call = value.call;
  if (!call || typeof call.id !== 'string' || typeof call.name !== 'string'
    || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
    throw new Error('Invalid pending model tool call');
  }
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
  store.transitionStep(current.id, result.status === 'completed' ? 'completed' : 'failed', current.revision, {
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
  return !(error instanceof ModelProtocolError)
    && !(error instanceof ModelCapabilityError)
    && !(error instanceof AgentToolArgumentsError)
    && !(error instanceof AgentToolNotFoundError);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
