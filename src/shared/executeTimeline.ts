/**
 * What an execute session looks like as a conversation.
 *
 * The execution centre used to be nine panels - a task board, a current-task
 * card, an approval section, a plan, a deliverables list, a history list - and
 * none of them said what Athena was doing or why ("分区太多，让人眼花缭乱",
 * 2026-09-15). The same records make a single stream instead: what the person
 * said, what Athena said before each action, the action with its result, and
 * what the person decided. Built from persisted records only, so a session
 * reopened tomorrow reads exactly as it did while it ran.
 */

import type {
  AgentApprovalRecord,
  AgentRunSnapshot,
  AgentStepRecord,
} from './types';
import {
  agentModelFailureHeadline,
  agentStepStatusLabel,
  agentToolLabel,
  describeAgentToolTarget,
  presentAgentApproval,
  readAgentRunFailure,
  type AgentApprovalField,
  type AgentApprovalView,
} from './agentRunPresentation';
import { deriveAgentRunVerification, summarizeAgentToolOutcome, type AgentRunVerification } from './agentVerification';

export type ExecuteToolStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'denied' | 'cancelled';

export interface ExecuteTimelineUser {
  kind: 'user';
  id: string;
  runId: string;
  text: string;
}

export interface ExecuteTimelineNarration {
  kind: 'narration';
  id: string;
  runId: string;
  text: string;
}

export interface ExecuteTimelineTool {
  kind: 'tool';
  id: string;
  runId: string;
  stepId: string | null;
  label: string;
  target: string;
  status: ExecuteToolStatus;
  statusLabel: string;
  summary: string;
  fields: AgentApprovalField[];
  output: string;
}

export interface ExecuteTimelineDecision {
  kind: 'decision';
  id: string;
  runId: string;
  text: string;
  tone: 'ok' | 'no' | 'neutral';
}

export interface ExecuteTimelineAsk {
  kind: 'ask';
  id: string;
  runId: string;
  approvalId: string;
  view: AgentApprovalView;
}

export interface ExecuteTimelineFinal {
  kind: 'final';
  id: string;
  runId: string;
  text: string;
  verification: AgentRunVerification;
}

export interface ExecuteTimelineError {
  kind: 'error';
  id: string;
  runId: string;
  title: string;
  detail: string;
}

export type ExecuteTimelineItem =
  | ExecuteTimelineUser
  | ExecuteTimelineNarration
  | ExecuteTimelineTool
  | ExecuteTimelineDecision
  | ExecuteTimelineAsk
  | ExecuteTimelineFinal
  | ExecuteTimelineError;

interface TranscriptMessage {
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
}

export type ExecuteSessionState = 'idle' | 'running' | 'waiting' | 'stopped' | 'failed' | 'done';
export type ExecuteSessionWait = 'approval' | 'retry' | 'budget' | 'replay' | null;

export interface ExecuteSessionSnapshot {
  chatWindowId: number;
  projectId: number | null;
  title: string;
  /** First task objective in the visible session, stable across clarification runs. */
  goal: string;
  items: ExecuteTimelineItem[];
  state: ExecuteSessionState;
  /** What the session is doing, in the words the person reads: never "completed" alone. */
  stateLabel: string;
  waitingOn: ExecuteSessionWait;
  activeRunId: string | null;
  pendingApprovalCount: number;
  canStop: boolean;
  canResume: boolean;
  runCount: number;
  /** Tool steps that actually ran across the whole session. */
  actionCount: number;
  /** How long the newest turn has been going, or took. */
  durationMs: number;
}

const MAX_OUTPUT_CHARS = 4_000;

export function buildExecuteTimeline(runs: readonly AgentRunSnapshot[]): ExecuteTimelineItem[] {
  return runs.flatMap(snapshot => buildRunItems(snapshot));
}

/** The whole window as one session: its stream, and what it is doing right now. */
export function buildExecuteSession(input: {
  chatWindowId: number;
  projectId: number | null;
  title: string;
  /** Oldest first. */
  runs: readonly AgentRunSnapshot[];
  now?: number;
}): ExecuteSessionSnapshot {
  const runs = input.runs;
  const latest = runs[runs.length - 1] || null;
  const pending = latest
    ? latest.approvals.filter(item => item.status === 'pending' && item.groupId === latest.run.approvalGroupId)
    : [];
  const waitingOn: ExecuteSessionWait = pending.some(item => item.request.kind === 'model_retry')
    ? 'retry'
    : pending.some(item => item.request.kind === 'budget_extension')
      ? 'budget'
      : pending.some(item => item.request.kind === 'uncertain_replay')
        ? 'replay'
        : pending.length > 0
          ? 'approval'
          : null;
  const status = latest?.run.status || null;
  const state: ExecuteSessionState = !latest
    ? 'idle'
    : status === 'paused'
      ? 'waiting'
      : status === 'completed'
        ? 'done'
        : status === 'failed'
          ? 'failed'
          : status === 'cancelled'
            ? 'stopped'
            : 'running';
  const started = latest?.run.startedAt || latest?.run.createdAt || '';
  const ended = latest?.run.completedAt || '';
  const startedMs = started ? new Date(started).getTime() : NaN;
  const endedMs = ended ? new Date(ended).getTime() : (input.now ?? Date.now());
  return {
    chatWindowId: input.chatWindowId,
    projectId: input.projectId,
    title: input.title,
    goal: runs[0]?.task.spec.goal || input.title,
    items: buildExecuteTimeline(runs),
    state,
    stateLabel: describeSessionState(latest, state, pending),
    waitingOn,
    activeRunId: latest && (status === 'running' || status === 'paused' || status === 'queued') ? latest.run.id : null,
    pendingApprovalCount: pending.length,
    canStop: status === 'running' || status === 'paused' || status === 'queued',
    canResume: status === 'paused' && pending.length === 0,
    runCount: runs.length,
    actionCount: runs.reduce((total, snapshot) => total + snapshot.steps.filter(step => (
      step.kind === 'tool' && step.status === 'completed'
    )).length, 0),
    durationMs: Number.isFinite(startedMs) ? Math.max(0, endedMs - startedMs) : 0,
  };
}

/**
 * A finished run is not the same as a job done: a turn that ran nothing, left a
 * step unexecuted, or has nothing to check says so here rather than closing on
 * "已完成" (ATH-EXEC-004).
 */
function describeSessionState(
  latest: AgentRunSnapshot | null,
  state: ExecuteSessionState,
  pending: readonly AgentApprovalRecord[],
): string {
  if (!latest) return '待命';
  if (state === 'waiting') {
    const retry = pending.find(item => item.request.kind === 'model_retry');
    if (retry) {
      const failure = isRecord(retry.request.failure) ? retry.request.failure : {};
      return `已暂停 · ${agentModelFailureHeadline(failure.kind)}`;
    }
    if (pending.some(item => item.request.kind === 'budget_extension')) return '已暂停 · 预算用完';
    if (pending.some(item => item.request.kind === 'uncertain_replay')) return '等待确认 · 上次中断的一步';
    return pending.length > 1 ? `等待审批 · ${pending.length} 项` : '等待审批';
  }
  if (state === 'running') {
    if (latest.run.phase === 'executing') return '正在执行';
    if (latest.run.phase === 'verifying') return '正在核对结果';
    if (latest.run.phase === 'researching') return '正在查资料';
    return '正在规划';
  }
  if (state === 'failed') return '执行失败';
  if (state === 'stopped') return '已停止';
  if (state === 'done') {
    const verification = deriveAgentRunVerification(latest.task, latest.run, latest.steps);
    if (verification === 'verified') return '已完成 · 已验证';
    if (verification === 'unverified') return '已结束 · 未验证';
    if (verification === 'issues') {
      const outcome = summarizeAgentToolOutcome(latest.steps);
      const parts = [
        outcome.failed.length > 0 ? `${outcome.failed.length} 步失败未重做` : '',
        outcome.denied.length > 0 ? `${outcome.denied.length} 步未执行` : '',
      ].filter(Boolean);
      return parts.length > 0 ? `已结束 · ${parts.join('、')}` : '已结束';
    }
    return '已回答';
  }
  return '待命';
}

function buildRunItems(snapshot: AgentRunSnapshot): ExecuteTimelineItem[] {
  const { run, steps, approvals } = snapshot;
  const messages = readMessages(run.state);
  const ownStart = readOwnStart(run.state, messages);
  const stepsByCall = new Map<string, AgentStepRecord>();
  for (const step of steps) {
    if (step.kind !== 'tool') continue;
    const callId = typeof step.input.callId === 'string' ? step.input.callId : '';
    if (callId) stepsByCall.set(callId, step);
  }
  const resultsByCall = new Map<string, TranscriptMessage>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) resultsByCall.set(message.toolCallId, message);
  }
  const approvalsByStep = new Map<string, AgentApprovalRecord[]>();
  for (const approval of approvals) {
    if (!approval.stepId) continue;
    approvalsByStep.set(approval.stepId, [...(approvalsByStep.get(approval.stepId) || []), approval]);
  }

  const items: ExecuteTimelineItem[] = [];
  const finalContent = typeof run.state.finalContent === 'string' ? run.state.finalContent.trim() : '';
  for (let index = ownStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'user') {
      const text = message.content.trim();
      if (text) items.push({ kind: 'user', id: `${run.id}:u${index}`, runId: run.id, text });
      continue;
    }
    if (message.role !== 'assistant') continue;
    const text = message.content.trim();
    const isFinal = text.length > 0 && text === finalContent && !message.toolCalls?.length && isLastAssistant(messages, index);
    if (text && isFinal) {
      items.push({
        kind: 'final',
        id: `${run.id}:f${index}`,
        runId: run.id,
        text,
        verification: deriveAgentRunVerification(snapshot.task, run, steps),
      });
    } else if (text) {
      items.push({ kind: 'narration', id: `${run.id}:n${index}`, runId: run.id, text });
    }
    for (const call of message.toolCalls || []) {
      const step = stepsByCall.get(call.id) || null;
      items.push(toolItem(run.id, call, step, resultsByCall.get(call.id) || null));
      for (const decision of decisionItems(run.id, step, approvalsByStep.get(step?.id || '') || [])) items.push(decision);
    }
  }

  for (const approval of approvals) {
    if (approval.status !== 'pending' || approval.groupId !== run.approvalGroupId) continue;
    items.push({
      kind: 'ask',
      id: `${run.id}:a${approval.id}`,
      runId: run.id,
      approvalId: approval.id,
      view: presentAgentApproval(approval),
    });
  }

  if (run.status === 'failed') {
    const failure = readAgentRunFailure(snapshot.events);
    items.push({
      kind: 'error',
      id: `${run.id}:err`,
      runId: run.id,
      title: failure?.message || run.error || '这次执行失败了',
      detail: failure?.detail || '',
    });
  }
  if (run.status === 'cancelled') {
    items.push({ kind: 'decision', id: `${run.id}:stopped`, runId: run.id, text: '你停止了这次执行', tone: 'neutral' });
  }
  return items;
}

function toolItem(
  runId: string,
  call: { id: string; name: string; arguments: Record<string, unknown> },
  step: AgentStepRecord | null,
  result: TranscriptMessage | null,
): ExecuteTimelineTool {
  const input = step?.input || { toolName: call.name, arguments: call.arguments };
  const parsed = parseToolResult(result?.content || '');
  const status = toolStatus(step, parsed.status);
  return {
    kind: 'tool',
    id: `${runId}:t${call.id}`,
    runId,
    stepId: step?.id || null,
    label: agentToolLabel({ title: step?.title || call.name, input }),
    target: describeAgentToolTarget(input.arguments ?? call.arguments),
    status,
    statusLabel: status === 'denied' ? '未执行' : agentStepStatusLabel(status),
    summary: parsed.summary || (typeof step?.output.summary === 'string' ? step.output.summary : '') || step?.error || '',
    fields: argumentFields(input.arguments ?? call.arguments),
    output: clip(parsed.output || (typeof step?.output.content === 'string' ? step.output.content : ''), MAX_OUTPUT_CHARS),
  };
}

function decisionItems(
  runId: string,
  step: AgentStepRecord | null,
  approvals: readonly AgentApprovalRecord[],
): ExecuteTimelineDecision[] {
  if (!step) return [];
  return approvals.flatMap((approval): ExecuteTimelineDecision[] => {
    if (approval.status === 'pending') return [];
    const label = typeof approval.request.toolLabel === 'string' ? approval.request.toolLabel : step.title;
    const id = `${runId}:d${approval.id}`;
    if (approval.decision.scope === 'superseded-by-message') {
      return [{ kind: 'decision', id, runId, text: `你没有批准「${label}」，改成发了一条消息`, tone: 'neutral' }];
    }
    if (approval.status === 'approved') {
      const auto = approval.decision.actor === 'auto-approve';
      return [{ kind: 'decision', id, runId, text: auto ? `免审批：自动允许「${label}」` : `你批准了「${label}」`, tone: auto ? 'neutral' : 'ok' }];
    }
    if (approval.status === 'denied') {
      return [{ kind: 'decision', id, runId, text: `你拒绝了「${label}」`, tone: 'no' }];
    }
    return [];
  });
}

function toolStatus(step: AgentStepRecord | null, resultStatus: string): ExecuteToolStatus {
  if (resultStatus === 'denied') return 'denied';
  if (!step) return resultStatus === 'completed' ? 'completed' : 'pending';
  if (step.status === 'skipped') return 'denied';
  if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled') return step.status;
  if (step.status === 'running' || step.status === 'waiting' || step.status === 'pending') return step.status;
  return 'pending';
}

function argumentFields(value: unknown): AgentApprovalField[] {
  if (!isRecord(value)) return [];
  return presentAgentApproval({
    id: 'preview',
    capability: '',
    riskLevel: 'low',
    request: { kind: 'tool_call', arguments: value, toolName: '', toolLabel: '' },
  }).fields;
}

function parseToolResult(content: string): { status: string; summary: string; output: string } {
  if (!content) return { status: '', summary: '', output: '' };
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed)) {
      return {
        status: typeof parsed.status === 'string' ? parsed.status : '',
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        output: typeof parsed.output === 'string' ? parsed.output : '',
      };
    }
  } catch {
    // A tool that answered in plain text is shown as it answered.
  }
  return { status: '', summary: '', output: content };
}

function isLastAssistant(messages: readonly TranscriptMessage[], index: number): boolean {
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    if (messages[cursor].role === 'assistant') return false;
  }
  return true;
}

function readMessages(state: Record<string, unknown>): TranscriptMessage[] {
  const value = isRecord(state) ? state.messages : null;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.content !== 'string' || typeof item.role !== 'string') return [];
    const toolCalls = Array.isArray(item.toolCalls)
      ? item.toolCalls.flatMap((call) => (
        isRecord(call) && typeof call.id === 'string' && typeof call.name === 'string'
          ? [{ id: call.id, name: call.name, arguments: isRecord(call.arguments) ? call.arguments : {} }]
          : []
      ))
      : undefined;
    return [{
      role: item.role,
      content: item.content,
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(typeof item.toolCallId === 'string' ? { toolCallId: item.toolCallId } : {}),
    }];
  });
}

/**
 * Where this run's own turn begins. Everything before it was carried in from
 * earlier turns of the same window and is already on screen above.
 */
function readOwnStart(state: Record<string, unknown>, messages: readonly TranscriptMessage[]): number {
  const session = isRecord(state) ? state.session : null;
  const recorded = isRecord(session) ? Number(session.ownStart) : NaN;
  if (Number.isInteger(recorded) && recorded >= 0 && recorded <= messages.length) return recorded;
  // Runs from before sessions: their own turn is the last user message of the transcript.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index;
  }
  return 0;
}

function clip(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
