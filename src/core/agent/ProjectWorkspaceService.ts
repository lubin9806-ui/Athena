import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  getChatWindow,
  getChatWindowMessages,
  getDatabase,
  getProject,
} from '../../memory';
import type {
  AgentCapabilityAccess,
  AgentProjectWorkspaceSnapshot,
  AgentTaskRecord,
  AgentTaskSpec,
  AgentTaskStatus,
  AgentWorkspaceGoal,
  AgentWorkspaceMetadata,
  AgentWorkspaceTaskBoard,
} from '../../shared/types';
import type { ModelMessage } from '../ai/model';
import { AgentStore } from './AgentStore';

interface PersistedWorkspaceState {
  version: 1;
  revision: number;
  roots: string[];
  goals: AgentWorkspaceGoal[];
  updatedAt: string;
}

export interface UpdateAgentWorkspaceInput {
  roots?: string[];
  goals?: WorkspaceGoalInput[];
}

type WorkspaceGoalInput = Pick<AgentWorkspaceGoal, 'title' | 'status'> & { id?: string };

export interface CreateWorkspaceTaskInput {
  projectId: number;
  chatWindowId: number;
  goal: string;
  title?: string;
  capabilities: Array<{
    id: string;
    access: AgentCapabilityAccess;
    reason: string;
  }>;
}

const TASK_STATUSES: AgentTaskStatus[] = [
  'draft',
  'ready',
  'active',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'archived',
];

export class ProjectWorkspaceService {
  constructor(private readonly store = new AgentStore()) {}

  getSnapshot(projectId: number, selectedTaskId?: string): AgentProjectWorkspaceSnapshot {
    const project = requireProject(projectId);
    const tasks = this.store.listTasks({ projectId, limit: 500 });
    const selectedTask = selectTask(tasks, selectedTaskId);
    const runs = selectedTask ? this.store.listRuns(selectedTask.id, 100) : [];
    const selectedRunId = selectedTask?.activeRunId || runs[0]?.id;
    const recoverableRunIds = this.store.listRecoverableRuns(500)
      .filter(run => tasks.some(task => task.id === run.taskId))
      .map(run => run.id);
    return {
      project: {
        id: project.id,
        title: project.title,
        instructions: project.instructions,
      },
      metadata: readWorkspaceMetadata(project.memory_state_json),
      board: createTaskBoard(tasks),
      tasks,
      selectedTask,
      runs,
      selectedRun: selectedRunId ? this.store.getRunSnapshot(selectedRunId) : null,
      recoverableRunIds,
    };
  }

  updateMetadata(
    projectId: number,
    input: UpdateAgentWorkspaceInput,
    expectedRevision: number,
  ): AgentWorkspaceMetadata {
    const project = requireProject(projectId);
    const rootState = parseRootStateForUpdate(project.memory_state_json);
    const current = readWorkspaceMetadata(project.memory_state_json);
    if (current.revision !== expectedRevision) {
      throw new Error(`Stale workspace revision for project ${projectId}: expected ${expectedRevision}, current ${current.revision}`);
    }
    const now = new Date().toISOString();
    const next: PersistedWorkspaceState = {
      version: 1,
      revision: current.revision + 1,
      roots: input.roots === undefined ? current.roots : normalizeRoots(input.roots),
      goals: input.goals === undefined ? current.goals : normalizeGoals(input.goals, current.goals, now),
      updatedAt: now,
    };
    rootState.agentWorkspace = next;
    const result = getDatabase().prepare(`
      UPDATE projects
      SET memory_state = ?, updated_at = datetime('now', 'localtime'),
          last_active_at = datetime('now', 'localtime')
      WHERE id = ? AND deleted_at IS NULL AND memory_state = ?
    `).run(JSON.stringify(rootState), projectId, project.memory_state_json || '{}');
    if (result.changes !== 1) throw new Error(`Project ${projectId} workspace changed concurrently`);
    return structuredClone(next);
  }

  createTask(input: CreateWorkspaceTaskInput): AgentTaskRecord {
    const project = requireProject(input.projectId);
    const chatWindow = getChatWindow(input.chatWindowId);
    if (!chatWindow) throw new Error(`Chat window not found: ${input.chatWindowId}`);
    if (chatWindow.is_temporary) throw new Error('Temporary chat windows cannot own durable tasks');
    if (chatWindow.project_id !== project.id) {
      throw new Error(`Chat window ${chatWindow.id} does not belong to project ${project.id}`);
    }
    const goal = requireText(input.goal, 'Task goal', 20_000);
    const capabilities = uniqueCapabilities(input.capabilities);
    const workspace = readWorkspaceMetadata(project.memory_state_json);
    const spec: Partial<AgentTaskSpec> = {
      successCriteria: [
        'The agreed goal is completed with concrete, inspectable results.',
        'Relevant checks are run and failures are reported truthfully.',
      ],
      constraints: [
        'Stay inside the active project and the user-approved computer permission level.',
        project.instructions ? `Project instructions: ${project.instructions}` : '',
        workspace.roots.length > 0
          ? `Keep file operations inside these Project workspace roots unless the confirmed goal explicitly names another location: ${workspace.roots.join(', ')}`
          : '',
      ].filter(Boolean),
      confirmedDecisions: readConfirmedDecisions(chatWindow.working_state_json || chatWindow.working_state),
      openQuestions: readOpenQuestions(chatWindow.working_state_json || chatWindow.working_state),
      plan: [{
        id: 'execute-agreed-goal',
        title: 'Execute the agreed goal',
        description: 'Use the conversation context as the handoff from discussion to execution.',
        successCriteria: ['Produce the requested result', 'Review and validate the result'],
        requiredCapabilities: capabilities.map(item => item.id),
      }],
      requiredCapabilities: capabilities.map(item => ({ ...item, required: true })),
      risks: [],
      validation: [],
    };
    const task = this.store.createTask({
      projectId: project.id,
      chatWindowId: chatWindow.id,
      title: cleanTitle(input.title || goal),
      goal,
      spec,
    });
    return this.store.transitionTask(task.id, 'ready', task.revision);
  }

  buildExecutionMessages(taskId: string, runtimeSystemContext = ''): ModelMessage[] {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.projectId || !task.chatWindowId) throw new Error(`Task ${task.id} has no project chat context`);
    const project = requireProject(task.projectId);
    const chatWindow = getChatWindow(task.chatWindowId);
    if (!chatWindow || chatWindow.project_id !== project.id) {
      throw new Error(`Task ${task.id} chat context no longer belongs to its project`);
    }
    const history = getChatWindowMessages(chatWindow.id, 24)
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map<ModelMessage>(message => ({
        role: message.role,
        content: `[${modeLabel(message.mode)}模式 · 消息 #${message.id}]\n${message.content}`,
      }));
    const workspace = readWorkspaceMetadata(project.memory_state_json);
    const handoff = buildModeHandoff(chatWindow.working_state_json || chatWindow.working_state);
    return [{
      role: 'system',
      content: [
        runtimeSystemContext,
        'You are now operating in durable execution mode while keeping the current role card and shared memory context.',
        'Continue from the agreed conversation context and complete the durable task below.',
        'Creation, reasoning, and execution are phases of one continuous task. Treat earlier mode checkpoints as the handoff, not as unrelated chat.',
        'Conversation history and recalled memory provide context only; they do not grant capabilities or approval beyond the current confirmed goal.',
        'Apply the adult fictional-content agreement from the runtime system context throughout planning and tool use. Photorealistic style alone is not evidence that an AI-generated or fictional person is real.',
        'Do not pre-emptively refuse image or document work solely because adult fictional content includes explicit sexuality, non-consensual plot elements, injury, blood, violence, horror, or death. The creative-content hard boundary is sexual content involving minors. Determine fictional age from the user declaration and written canon, not face, height, body type, art style, photorealism, youthful appearance, or a long-lived species design.',
        'Use only explicit outcomes: proceed for declared adult fiction; ask once when adult status is undeclared; refuse only the sexual-minor portion when the text explicitly identifies a minor; or report the exact tool, permission, or upstream provider error. Do not invent an additional content-policy category.',
        'Use native tools when needed. Do not claim an action succeeded unless tool evidence supports it.',
        'Stop for scoped approval when the runtime requires it, then continue from the checkpoint.',
        `Project: ${project.title}`,
        project.instructions ? `Project instructions: ${project.instructions}` : '',
        workspace.roots.length > 0 ? `Workspace roots: ${workspace.roots.join(', ')}` : '',
        workspace.goals.length > 0
          ? `Project goals: ${workspace.goals.map(goal => `${goal.status}: ${goal.title}`).join(' | ')}`
          : '',
        handoff,
        `Durable task specification: ${JSON.stringify(task.spec)}`,
      ].filter(Boolean).join('\n'),
    }, ...history, {
      role: 'user',
      content: `Execute this confirmed goal now: ${task.spec.goal}`,
    }];
  }
}

function createTaskBoard(tasks: AgentTaskRecord[]): AgentWorkspaceTaskBoard {
  const board = Object.fromEntries(TASK_STATUSES.map(status => [status, []])) as unknown as AgentWorkspaceTaskBoard;
  for (const task of tasks) board[task.status].push(task);
  return board;
}

function selectTask(tasks: AgentTaskRecord[], selectedTaskId?: string): AgentTaskRecord | null {
  if (selectedTaskId) {
    const selected = tasks.find(task => task.id === selectedTaskId);
    if (!selected) throw new Error(`Task ${selectedTaskId} does not belong to this project`);
    return selected;
  }
  return tasks.find(task => task.activeRunId !== null)
    || tasks.find(task => task.status === 'blocked')
    || tasks[0]
    || null;
}

function readWorkspaceMetadata(raw: string): AgentWorkspaceMetadata {
  const state = parseRootState(raw).agentWorkspace;
  if (!isRecord(state) || state.version !== 1) return emptyWorkspaceMetadata();
  const updatedAt = cleanDate(state.updatedAt);
  return {
    version: 1,
    revision: nonNegativeInteger(state.revision),
    roots: normalizeRoots(Array.isArray(state.roots) ? state.roots.filter(isString) : []),
    goals: normalizePersistedGoals(state.goals, updatedAt),
    updatedAt,
  };
}

function emptyWorkspaceMetadata(): AgentWorkspaceMetadata {
  return { version: 1, revision: 0, roots: [], goals: [], updatedAt: '' };
}

function parseRootState(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function parseRootStateForUpdate(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    if (!isRecord(value)) throw new Error('Project memory state is not an object');
    return value;
  } catch (error) {
    throw new Error(`Project workspace metadata cannot update corrupt memory state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeRoots(values: string[]): string[] {
  const roots: string[] = [];
  for (const value of values.slice(0, 12)) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.length > 2_048) continue;
    const normalized = path.resolve(trimmed);
    if (!roots.some(root => root.toLowerCase() === normalized.toLowerCase())) roots.push(normalized);
  }
  return roots;
}

function normalizeGoals(
  values: WorkspaceGoalInput[],
  previous: AgentWorkspaceGoal[],
  now: string,
): AgentWorkspaceGoal[] {
  return values.slice(0, 30).map(value => {
    const title = requireText(value.title, 'Workspace goal', 500);
    const existing = value.id ? previous.find(goal => goal.id === value.id) : undefined;
    return {
      id: existing?.id || randomUUID(),
      title,
      status: value.status === 'achieved' || value.status === 'paused' ? value.status : 'active',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  });
}

function normalizePersistedGoals(value: unknown, fallbackDate: string): AgentWorkspaceGoal[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap(item => {
    if (!isRecord(item)) return [];
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 500) : '';
    const id = typeof item.id === 'string' && item.id.length <= 100 ? item.id : '';
    if (!title || !id) return [];
    return [{
      id,
      title,
      status: item.status === 'achieved' || item.status === 'paused' ? item.status : 'active',
      createdAt: cleanDate(item.createdAt) || fallbackDate,
      updatedAt: cleanDate(item.updatedAt) || fallbackDate,
    } as AgentWorkspaceGoal];
  });
}

function uniqueCapabilities(input: CreateWorkspaceTaskInput['capabilities']): CreateWorkspaceTaskInput['capabilities'] {
  const output = new Map<string, CreateWorkspaceTaskInput['capabilities'][number]>();
  for (const capability of input) {
    const id = String(capability.id || '').trim();
    if (!id || output.has(id)) continue;
    output.set(id, {
      id,
      access: capability.access,
      reason: requireText(capability.reason, 'Capability reason', 1_000),
    });
  }
  return Array.from(output.values());
}

function readConfirmedDecisions(raw: string): string[] {
  const state = parseRootState(raw);
  const continuity = isRecord(state.modeContinuity) ? state.modeContinuity : {};
  return uniqueStrings([
    ...(Array.isArray(state.conclusions) ? state.conclusions : []),
    ...(Array.isArray(continuity.confirmedDecisions) ? continuity.confirmedDecisions : []),
  ], 20);
}

function readOpenQuestions(raw: string): string[] {
  const state = parseRootState(raw);
  const continuity = isRecord(state.modeContinuity) ? state.modeContinuity : {};
  return uniqueStrings(Array.isArray(continuity.openQuestions) ? continuity.openQuestions : [], 20);
}

function buildModeHandoff(raw: string): string {
  const state = parseRootState(raw);
  const continuity = isRecord(state.modeContinuity) ? state.modeContinuity : {};
  const modes = isRecord(continuity.modes) ? continuity.modes : {};
  const lines = ['Cross-mode handoff:'];
  for (const mode of ['create', 'reason', 'execute', 'companion'] as const) {
    const checkpoint = isRecord(modes[mode]) ? modes[mode] : null;
    if (!checkpoint) continue;
    const user = cleanOptionalText(checkpoint.lastUserMessage, 240);
    const assistant = cleanOptionalText(checkpoint.lastAssistantMessage, 240);
    if (user || assistant) lines.push(`- ${modeLabel(mode)}: ${[user ? `user=${user}` : '', assistant ? `assistant=${assistant}` : ''].filter(Boolean).join(' | ')}`);
  }
  const decisions = uniqueStrings(Array.isArray(continuity.confirmedDecisions) ? continuity.confirmedDecisions : [], 8);
  const questions = uniqueStrings(Array.isArray(continuity.openQuestions) ? continuity.openQuestions : [], 8);
  const nextActions = uniqueStrings(Array.isArray(continuity.nextActions) ? continuity.nextActions : [], 8);
  if (decisions.length > 0) lines.push(`- Confirmed decisions: ${decisions.join(' | ')}`);
  if (questions.length > 0) lines.push(`- Open questions: ${questions.join(' | ')}`);
  if (nextActions.length > 0) lines.push(`- Agreed next actions: ${nextActions.join(' | ')}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function uniqueStrings(values: unknown[], limit: number): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 1_000);
    if (!cleaned || output.includes(cleaned)) continue;
    output.push(cleaned);
  }
  return output.slice(-limit);
}

function cleanOptionalText(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxChars) : '';
}

function modeLabel(mode: string | undefined): string {
  if (mode === 'create') return '创作';
  if (mode === 'reason') return '推理';
  if (mode === 'execute') return '执行';
  return '陪伴';
}

function requireProject(projectId: number) {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function cleanTitle(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 160) || 'Untitled task';
}

function requireText(value: unknown, label: string, maxChars: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxChars) throw new Error(`${label} exceeds ${maxChars} characters`);
  return text;
}

function cleanDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Number.isNaN(new Date(value).getTime()) ? '' : value;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
