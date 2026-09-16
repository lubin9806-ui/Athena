import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from '../../memory/database';
import type {
  AgentApprovalRecord,
  AgentApprovalStatus,
  AgentArtifactRecord,
  AgentRunEventRecord,
  AgentRunPhase,
  AgentRunRecord,
  AgentRunSnapshot,
  AgentRiskLevel,
  AgentStepRecord,
  AgentStepStatus,
  AgentTaskRecord,
  AgentTaskSpec,
  AgentTaskStatus,
  AgentValidationStatus,
  ToolPermissionLevel,
} from '../../shared/types';

const TOOL_PERMISSION_RANK: Record<ToolPermissionLevel, number> = { off: 0, read: 1, files: 2, full: 3 };

function isToolPermissionLevel(value: string): value is ToolPermissionLevel {
  return value === 'off' || value === 'read' || value === 'files' || value === 'full';
}
import {
  assertRunPhaseTransition,
  assertStepTransition,
  assertTaskTransition,
  isTerminalRunPhase,
  isTerminalStepStatus,
  runStatusForPhase,
} from './AgentStateMachine';

export interface CreateAgentTaskInput {
  title: string;
  goal: string;
  projectId?: number;
  chatWindowId?: number;
  spec?: Partial<AgentTaskSpec>;
}

export interface ListAgentTasksFilter {
  projectId?: number;
  chatWindowId?: number;
  statuses?: AgentTaskStatus[];
  limit?: number;
}

export interface CreateAgentRunInput {
  taskId: string;
  scene?: string;
  strategy?: string;
  provider?: string;
  model?: string;
  state?: Record<string, unknown>;
}

export interface AppendAgentStepInput {
  runId: string;
  kind: string;
  title: string;
  input?: Record<string, unknown>;
}

export interface RequestAgentApprovalInput {
  runId: string;
  stepId?: string;
  capability: string;
  riskLevel: AgentRiskLevel;
  request: Record<string, unknown>;
}

export interface AddAgentArtifactInput {
  taskId: string;
  runId?: string;
  stepId?: string;
  kind: string;
  name: string;
  uri?: string;
  metadata?: Record<string, unknown>;
  validationStatus?: AgentValidationStatus;
}

export class AgentRecordNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'AgentRecordNotFoundError';
  }
}

export class AgentConcurrencyError extends Error {
  constructor(entity: string, id: string, expected: number, actual: number) {
    super(`Stale ${entity} revision for ${id}: expected ${expected}, current ${actual}`);
    this.name = 'AgentConcurrencyError';
  }
}

export class AgentApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentApprovalError';
  }
}

export interface AgentStoreActivity {
  runId: string;
  type: string;
}

const ACTIVITY_LISTENERS = new Set<(activity: AgentStoreActivity) => void>();

/**
 * Every recorded step, approval and checkpoint, as it happens.
 *
 * A run only reported itself when it started and when it stopped, so the window
 * showed nothing between - the person watched a spinner while Athena explained
 * itself into a log nobody could see. Returns an unsubscribe function.
 */
export function onAgentStoreActivity(listener: (activity: AgentStoreActivity) => void): () => void {
  ACTIVITY_LISTENERS.add(listener);
  return () => ACTIVITY_LISTENERS.delete(listener);
}

export class AgentStore {
  constructor(private readonly database: Database.Database = getDatabase()) {}

  createTask(input: CreateAgentTaskInput): AgentTaskRecord {
    const title = requireText(input.title, 'Task title', 160);
    const spec = normalizeTaskSpec(input.goal, input.spec);
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO agent_tasks (id, project_id, chat_window_id, title, spec_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, positiveIntegerOrNull(input.projectId), positiveIntegerOrNull(input.chatWindowId), title, toJson(spec));
    return this.requireTask(id);
  }

  getTask(id: string): AgentTaskRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
    return row ? rowToTask(row) : null;
  }

  listTasks(filter: ListAgentTasksFilter = {}): AgentTaskRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.chatWindowId) {
      where.push('chat_window_id = ?');
      params.push(filter.chatWindowId);
    }
    if (filter.statuses?.length) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    const limit = clampInteger(filter.limit, 1, 500, 100);
    const rows = this.database.prepare(`
      SELECT * FROM agent_tasks
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(...params, limit) as unknown[];
    return rows.map(rowToTask);
  }

  updateTaskSpec(id: string, spec: AgentTaskSpec, expectedRevision: number): AgentTaskRecord {
    const existing = this.requireTask(id);
    assertRevision('task', existing.id, expectedRevision, existing.revision);
    const normalized = normalizeTaskSpec(spec.goal, spec);
    const result = this.database.prepare(`
      UPDATE agent_tasks
      SET spec_json = ?, revision = revision + 1, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND revision = ?
    `).run(toJson(normalized), id, expectedRevision);
    if (result.changes !== 1) throw this.createCurrentRevisionError('task', id, expectedRevision);
    return this.requireTask(id);
  }

  transitionTask(id: string, status: AgentTaskStatus, expectedRevision: number): AgentTaskRecord {
    const existing = this.requireTask(id);
    assertRevision('task', id, expectedRevision, existing.revision);
    assertTaskTransition(existing.status, status);
    const result = this.database.prepare(`
      UPDATE agent_tasks
      SET status = ?,
          revision = revision + 1,
          updated_at = datetime('now', 'localtime'),
          completed_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE completed_at END,
          archived_at = CASE WHEN ? = 'archived' THEN datetime('now', 'localtime') ELSE archived_at END
      WHERE id = ? AND revision = ?
    `).run(status, status, status, id, expectedRevision);
    if (result.changes !== 1) throw this.createCurrentRevisionError('task', id, expectedRevision);
    return this.requireTask(id);
  }

  createRun(input: CreateAgentRunInput): AgentRunRecord {
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId);
      if (!['ready', 'active', 'blocked'].includes(task.status)) {
        throw new Error(`Task ${task.id} cannot start a run while ${task.status}`);
      }
      if (task.activeRunId) {
        const active = this.getRun(task.activeRunId);
        if (active && !isTerminalRunPhase(active.phase)) {
          throw new Error(`Task ${task.id} already has active run ${active.id}`);
        }
      }

      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO agent_runs (id, task_id, scene, strategy, provider, model, state_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        task.id,
        cleanText(input.scene, 64) || 'work',
        cleanText(input.strategy, 64) || 'reason',
        cleanText(input.provider, 120) || null,
        cleanText(input.model, 160) || null,
        toJson(input.state || {}),
      );
      this.database.prepare(`
        UPDATE agent_tasks
        SET status = 'active', active_run_id = ?, revision = revision + 1,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(id, task.id);
      this.appendEventInternal(id, 'run.created', { taskId: task.id });
      return this.requireRun(id);
    })();
  }

  getRun(id: string): AgentRunRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id);
    return row ? rowToRun(row) : null;
  }

  /**
   * The highest computer permission this run may use. Null means none was recorded,
   * which only happens for runs created before schema 18 (ATH-SEC-005).
   */
  getRunPermissionCeiling(id: string): ToolPermissionLevel | null {
    const row = this.database.prepare('SELECT permission_ceiling FROM agent_runs WHERE id = ?')
      .get(id) as { permission_ceiling: string | null } | undefined;
    const value = row?.permission_ceiling;
    return value && isToolPermissionLevel(value) ? value : null;
  }

  /** Records a ceiling only if the run has none yet; never raises an existing one. */
  initializeRunPermissionCeiling(id: string, level: ToolPermissionLevel): void {
    this.database.prepare(`
      UPDATE agent_runs SET permission_ceiling = ? WHERE id = ? AND permission_ceiling IS NULL
    `).run(level, id);
  }

  /**
   * Lowers the ceiling of every run that is not finished. Revoking a permission has
   * to reach runs that are paused or queued too, or resuming one would restore what
   * the user just took away.
   */
  lowerActiveRunPermissionCeilings(level: ToolPermissionLevel): number {
    const rank = TOOL_PERMISSION_RANK[level];
    const rows = this.database.prepare(`
      SELECT id, permission_ceiling FROM agent_runs
      WHERE status IN ('queued', 'running', 'paused')
    `).all() as Array<{ id: string; permission_ceiling: string | null }>;
    let lowered = 0;
    const update = this.database.prepare('UPDATE agent_runs SET permission_ceiling = ? WHERE id = ?');
    for (const row of rows) {
      const current = row.permission_ceiling && isToolPermissionLevel(row.permission_ceiling)
        ? row.permission_ceiling
        : null;
      if (current !== null && TOOL_PERMISSION_RANK[current] <= rank) continue;
      update.run(level, row.id);
      lowered += 1;
    }
    return lowered;
  }

  listRuns(taskId: string, limit = 100): AgentRunRecord[] {
    return (this.database.prepare(`
      SELECT * FROM agent_runs WHERE task_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(taskId, clampInteger(limit, 1, 500, 100)) as unknown[]).map(rowToRun);
  }

  /**
   * Every run of a chat window, newest first: one window is one execute session,
   * so the window - not the task - is what the next turn continues from.
   */
  listWindowRuns(chatWindowId: number, limit = 20): AgentRunRecord[] {
    return (this.database.prepare(`
      SELECT r.* FROM agent_runs r
      JOIN agent_tasks t ON t.id = r.task_id
      WHERE t.chat_window_id = ?
      ORDER BY r.created_at DESC, r.rowid DESC
      LIMIT ?
    `).all(chatWindowId, clampInteger(limit, 1, 200, 20)) as unknown[]).map(rowToRun);
  }

  listRecoverableRuns(limit = 100): AgentRunRecord[] {
    return (this.database.prepare(`
      SELECT * FROM agent_runs
      WHERE status IN ('queued', 'running', 'paused')
      ORDER BY updated_at DESC LIMIT ?
    `).all(clampInteger(limit, 1, 500, 100)) as unknown[]).map(rowToRun);
  }

  startRun(id: string, expectedRevision: number): AgentRunRecord {
    return this.database.transaction(() => {
      const run = this.requireRun(id);
      assertRevision('run', id, expectedRevision, run.revision);
      if (run.status !== 'queued') throw new Error(`Run ${id} is already ${run.status}`);
      const result = this.database.prepare(`
        UPDATE agent_runs
        SET status = 'running', started_at = COALESCE(started_at, datetime('now', 'localtime')),
            updated_at = datetime('now', 'localtime'), revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(id, expectedRevision);
      if (result.changes !== 1) throw this.createCurrentRevisionError('run', id, expectedRevision);
      this.appendEventInternal(id, 'run.started', { phase: run.phase });
      return this.requireRun(id);
    })();
  }

  transitionRun(
    id: string,
    phase: AgentRunPhase,
    expectedRevision: number,
    options: { state?: Record<string, unknown>; error?: string } = {},
  ): AgentRunRecord {
    return this.database.transaction(() => {
      const run = this.requireRun(id);
      assertRevision('run', id, expectedRevision, run.revision);
      assertRunPhaseTransition(run.phase, phase);
      if (phase === 'awaiting_approval') {
        throw new AgentApprovalError('Use requestApproval() to create a resumable approval checkpoint.');
      }
      if (run.phase === 'awaiting_approval' && phase === 'executing') {
        this.assertApprovalGroupApproved(run);
      }

      const status = runStatusForPhase(phase);
      const state = options.state === undefined ? run.state : options.state;
      const approvalGroupId = run.phase === 'awaiting_approval' ? null : run.approvalGroupId;
      const result = this.database.prepare(`
        UPDATE agent_runs
        SET phase = ?, status = ?, state_json = ?, approval_group_id = ?, error = ?,
            started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, datetime('now', 'localtime')) ELSE started_at END,
            completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN datetime('now', 'localtime') ELSE NULL END,
            updated_at = datetime('now', 'localtime'), revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(
        phase,
        status,
        toJson(state),
        approvalGroupId,
        cleanText(options.error, 4_000) || null,
        status,
        status,
        id,
        expectedRevision,
      );
      if (result.changes !== 1) throw this.createCurrentRevisionError('run', id, expectedRevision);
      this.syncTaskFromRun(run.taskId, id, phase);
      this.appendEventInternal(id, 'run.phase_changed', { from: run.phase, to: phase, status });
      return this.requireRun(id);
    })();
  }

  checkpointRun(id: string, state: Record<string, unknown>, expectedRevision: number): AgentRunRecord {
    return this.database.transaction(() => {
      const run = this.requireRun(id);
      assertRevision('run', id, expectedRevision, run.revision);
      if (isTerminalRunPhase(run.phase)) throw new Error(`Terminal run ${id} cannot be checkpointed`);
      const result = this.database.prepare(`
        UPDATE agent_runs
        SET state_json = ?, updated_at = datetime('now', 'localtime'), revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(toJson(state), id, expectedRevision);
      if (result.changes !== 1) throw this.createCurrentRevisionError('run', id, expectedRevision);
      this.appendEventInternal(id, 'run.checkpointed', { keys: Object.keys(state).sort() });
      return this.requireRun(id);
    })();
  }

  appendStep(input: AppendAgentStepInput): AgentStepRecord {
    return this.database.transaction(() => {
      const run = this.requireRun(input.runId);
      if (isTerminalRunPhase(run.phase)) throw new Error(`Cannot append a step to terminal run ${run.id}`);
      const sequenceRow = this.database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_steps WHERE run_id = ?
      `).get(run.id) as { sequence: number };
      const id = randomUUID();
      const kind = requireText(input.kind, 'Step kind', 80);
      const title = requireText(input.title, 'Step title', 240);
      this.database.prepare(`
        INSERT INTO agent_steps (id, run_id, sequence, kind, title, input_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, run.id, sequenceRow.sequence, kind, title, toJson(input.input || {}));
      this.appendEventInternal(run.id, 'step.created', { stepId: id, sequence: sequenceRow.sequence, kind });
      return this.requireStep(id);
    })();
  }

  getStep(id: string): AgentStepRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_steps WHERE id = ?').get(id);
    return row ? rowToStep(row) : null;
  }

  listSteps(runId: string): AgentStepRecord[] {
    return (this.database.prepare(`
      SELECT * FROM agent_steps WHERE run_id = ? ORDER BY sequence ASC
    `).all(runId) as unknown[]).map(rowToStep);
  }

  transitionStep(
    id: string,
    status: AgentStepStatus,
    expectedRevision: number,
    options: { output?: Record<string, unknown>; error?: string } = {},
  ): AgentStepRecord {
    return this.database.transaction(() => {
      const step = this.requireStep(id);
      assertRevision('step', id, expectedRevision, step.revision);
      assertStepTransition(step.status, status);
      const output = options.output === undefined ? step.output : options.output;
      const result = this.database.prepare(`
        UPDATE agent_steps
        SET status = ?, output_json = ?, error = ?, revision = revision + 1,
            started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, datetime('now', 'localtime')) ELSE started_at END,
            completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled', 'skipped') THEN datetime('now', 'localtime') ELSE NULL END
        WHERE id = ? AND revision = ?
      `).run(
        status,
        toJson(output),
        cleanText(options.error, 4_000) || null,
        status,
        status,
        id,
        expectedRevision,
      );
      if (result.changes !== 1) throw this.createCurrentRevisionError('step', id, expectedRevision);
      this.appendEventInternal(step.runId, 'step.status_changed', { stepId: id, from: step.status, to: status });
      return this.requireStep(id);
    })();
  }

  requestApproval(input: RequestAgentApprovalInput, expectedRunRevision: number): AgentApprovalRecord {
    return this.database.transaction(() => {
      const run = this.requireRun(input.runId);
      assertRevision('run', run.id, expectedRunRevision, run.revision);
      if (isTerminalRunPhase(run.phase)) throw new AgentApprovalError(`Terminal run ${run.id} cannot request approval`);
      if (input.stepId) {
        const step = this.requireStep(input.stepId);
        if (step.runId !== run.id) throw new AgentApprovalError(`Step ${step.id} does not belong to run ${run.id}`);
      }

      let groupId = run.approvalGroupId;
      if (run.phase !== 'awaiting_approval') {
        assertRunPhaseTransition(run.phase, 'awaiting_approval');
        groupId = randomUUID();
      }
      groupId ||= randomUUID();
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO agent_approvals (
          id, run_id, step_id, group_id, capability, risk_level, request_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        run.id,
        input.stepId || null,
        groupId,
        requireText(input.capability, 'Approval capability', 160),
        input.riskLevel,
        toJson(input.request),
      );
      const result = this.database.prepare(`
        UPDATE agent_runs
        SET phase = 'awaiting_approval', status = 'paused', approval_group_id = ?,
            updated_at = datetime('now', 'localtime'), revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(groupId, run.id, expectedRunRevision);
      if (result.changes !== 1) throw this.createCurrentRevisionError('run', run.id, expectedRunRevision);
      this.database.prepare(`
        UPDATE agent_tasks SET status = 'blocked', revision = revision + 1,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(run.taskId);
      this.appendEventInternal(run.id, 'approval.requested', {
        approvalId: id,
        groupId,
        capability: input.capability,
        riskLevel: input.riskLevel,
      });
      return this.requireApproval(id);
    })();
  }

  getApproval(id: string): AgentApprovalRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_approvals WHERE id = ?').get(id);
    return row ? rowToApproval(row) : null;
  }

  listApprovals(runId: string): AgentApprovalRecord[] {
    // `created_at` only has one-second resolution, and a batch's approvals are written
    // within the same second; ordering the tie by the random id put a batch on the
    // approval card in random order. Insertion order is the order the calls run in.
    return (this.database.prepare(`
      SELECT * FROM agent_approvals WHERE run_id = ? ORDER BY created_at ASC, rowid ASC
    `).all(runId) as unknown[]).map(rowToApproval);
  }

  resolveApproval(
    id: string,
    status: Exclude<AgentApprovalStatus, 'pending'>,
    decision: Record<string, unknown>,
    expectedRevision: number,
  ): AgentApprovalRecord {
    return this.database.transaction(() => {
      const approval = this.requireApproval(id);
      assertRevision('approval', id, expectedRevision, approval.revision);
      if (approval.status !== 'pending') throw new AgentApprovalError(`Approval ${id} is already ${approval.status}`);
      const result = this.database.prepare(`
        UPDATE agent_approvals
        SET status = ?, decision_json = ?, decided_at = datetime('now', 'localtime'), revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `).run(status, toJson(decision), id, expectedRevision);
      if (result.changes !== 1) throw this.createCurrentRevisionError('approval', id, expectedRevision);
      this.appendEventInternal(approval.runId, 'approval.resolved', { approvalId: id, status });
      return this.requireApproval(id);
    })();
  }

  addArtifact(input: AddAgentArtifactInput): AgentArtifactRecord {
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId);
      if (input.runId) {
        const run = this.requireRun(input.runId);
        if (run.taskId !== task.id) throw new Error(`Run ${run.id} does not belong to task ${task.id}`);
      }
      if (input.stepId) {
        const step = this.requireStep(input.stepId);
        if (!input.runId || step.runId !== input.runId) throw new Error(`Step ${step.id} does not belong to the artifact run`);
      }
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO agent_artifacts (
          id, task_id, run_id, step_id, kind, name, uri, metadata_json, validation_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        task.id,
        input.runId || null,
        input.stepId || null,
        requireText(input.kind, 'Artifact kind', 80),
        requireText(input.name, 'Artifact name', 240),
        cleanText(input.uri, 4_000) || null,
        toJson(input.metadata || {}),
        input.validationStatus || 'pending',
      );
      if (input.runId) this.appendEventInternal(input.runId, 'artifact.created', { artifactId: id, kind: input.kind });
      return this.requireArtifact(id);
    })();
  }

  listArtifacts(taskId: string, runId?: string): AgentArtifactRecord[] {
    const rows = runId
      ? this.database.prepare(`
          SELECT * FROM agent_artifacts WHERE task_id = ? AND run_id = ? ORDER BY created_at ASC
        `).all(taskId, runId)
      : this.database.prepare(`
          SELECT * FROM agent_artifacts WHERE task_id = ? ORDER BY created_at ASC
        `).all(taskId);
    return (rows as unknown[]).map(rowToArtifact);
  }

  getArtifact(id: string): AgentArtifactRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(id);
    return row ? rowToArtifact(row) : null;
  }

  updateArtifactValidation(id: string, status: AgentValidationStatus): AgentArtifactRecord {
    return this.database.transaction(() => {
      const artifact = this.requireArtifact(id);
      this.database.prepare(`
        UPDATE agent_artifacts SET validation_status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
      `).run(status, id);
      if (artifact.runId) this.appendEventInternal(artifact.runId, 'artifact.validated', { artifactId: id, status });
      return this.requireArtifact(id);
    })();
  }

  appendEvent(runId: string, type: string, payload: Record<string, unknown> = {}): AgentRunEventRecord {
    return this.database.transaction(() => {
      this.requireRun(runId);
      return this.appendEventInternal(runId, type, payload);
    })();
  }

  listEvents(runId: string, limit = 1_000): AgentRunEventRecord[] {
    return (this.database.prepare(`
      SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sequence ASC LIMIT ?
    `).all(runId, clampInteger(limit, 1, 10_000, 1_000)) as unknown[]).map(rowToEvent);
  }

  getRunSnapshot(runId: string): AgentRunSnapshot {
    const run = this.requireRun(runId);
    return {
      task: this.requireTask(run.taskId),
      run,
      steps: this.listSteps(runId),
      approvals: this.listApprovals(runId),
      artifacts: this.listArtifacts(run.taskId, runId),
      events: this.listEvents(runId),
    };
  }

  private requireTask(id: string): AgentTaskRecord {
    const record = this.getTask(id);
    if (!record) throw new AgentRecordNotFoundError('Task', id);
    return record;
  }

  private requireRun(id: string): AgentRunRecord {
    const record = this.getRun(id);
    if (!record) throw new AgentRecordNotFoundError('Run', id);
    return record;
  }

  private requireStep(id: string): AgentStepRecord {
    const record = this.getStep(id);
    if (!record) throw new AgentRecordNotFoundError('Step', id);
    return record;
  }

  private requireApproval(id: string): AgentApprovalRecord {
    const record = this.getApproval(id);
    if (!record) throw new AgentRecordNotFoundError('Approval', id);
    return record;
  }

  private requireArtifact(id: string): AgentArtifactRecord {
    const row = this.database.prepare('SELECT * FROM agent_artifacts WHERE id = ?').get(id);
    if (!row) throw new AgentRecordNotFoundError('Artifact', id);
    return rowToArtifact(row);
  }

  private assertApprovalGroupApproved(run: AgentRunRecord): void {
    if (!run.approvalGroupId) throw new AgentApprovalError(`Run ${run.id} has no active approval group`);
    const counts = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM agent_approvals WHERE run_id = ? AND group_id = ?
    `).get(run.id, run.approvalGroupId) as { total: number; approved: number | null; pending: number | null };
    if (counts.total === 0 || counts.pending !== 0 || counts.approved !== counts.total) {
      throw new AgentApprovalError(`Approval group ${run.approvalGroupId} is not fully approved`);
    }
  }

  private syncTaskFromRun(taskId: string, runId: string, phase: AgentRunPhase): void {
    let status: AgentTaskStatus = 'active';
    if (phase === 'awaiting_approval') status = 'blocked';
    if (phase === 'completed') status = 'completed';
    if (phase === 'failed') status = 'failed';
    if (phase === 'cancelled') status = 'cancelled';
    const terminal = isTerminalRunPhase(phase);
    this.database.prepare(`
      UPDATE agent_tasks
      SET status = ?,
          active_run_id = CASE WHEN ? = 1 AND active_run_id = ? THEN NULL ELSE active_run_id END,
          completed_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE completed_at END,
          updated_at = datetime('now', 'localtime'), revision = revision + 1
      WHERE id = ?
    `).run(status, terminal ? 1 : 0, runId, phase, taskId);
  }

  private appendEventInternal(runId: string, type: string, payload: Record<string, unknown>): AgentRunEventRecord {
    const sequence = (this.database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_events WHERE run_id = ?
    `).get(runId) as { sequence: number }).sequence;
    const result = this.database.prepare(`
      INSERT INTO agent_run_events (run_id, sequence, type, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(runId, sequence, requireText(type, 'Event type', 160), toJson(payload));
    const row = this.database.prepare('SELECT * FROM agent_run_events WHERE id = ?').get(result.lastInsertRowid);
    for (const listener of ACTIVITY_LISTENERS) {
      try {
        listener({ runId, type });
      } catch {
        // A watcher must never break the run it is watching.
      }
    }
    return rowToEvent(row);
  }

  private createCurrentRevisionError(entity: string, id: string, expected: number): AgentConcurrencyError {
    const table = entity === 'task'
      ? 'agent_tasks'
      : entity === 'run'
        ? 'agent_runs'
        : entity === 'step'
          ? 'agent_steps'
          : 'agent_approvals';
    const row = this.database.prepare(`SELECT revision FROM ${table} WHERE id = ?`).get(id) as { revision: number } | undefined;
    return new AgentConcurrencyError(entity, id, expected, row?.revision || 0);
  }
}

function normalizeTaskSpec(goal: string, input: Partial<AgentTaskSpec> = {}): AgentTaskSpec {
  const normalizedGoal = requireText(goal || input.goal, 'Task goal', 8_000);
  return {
    version: 1,
    goal: normalizedGoal,
    successCriteria: stringList(input.successCriteria, 100, 1_000),
    constraints: stringList(input.constraints, 100, 1_000),
    confirmedDecisions: stringList(input.confirmedDecisions, 100, 1_000),
    openQuestions: stringList(input.openQuestions, 100, 1_000),
    plan: Array.isArray(input.plan) ? input.plan.slice(0, 200).map((step, index) => ({
      id: cleanText(step?.id, 160) || `step-${index + 1}`,
      title: requireText(step?.title, `Plan step ${index + 1} title`, 240),
      description: cleanText(step?.description, 2_000) || undefined,
      successCriteria: stringList(step?.successCriteria, 50, 1_000),
      requiredCapabilities: stringList(step?.requiredCapabilities, 50, 160),
    })) : [],
    requiredCapabilities: Array.isArray(input.requiredCapabilities)
      ? input.requiredCapabilities.slice(0, 100).map(item => ({
          id: requireText(item?.id, 'Capability id', 160),
          access: item.access,
          reason: cleanText(item?.reason, 1_000) || '',
          required: item.required !== false,
        }))
      : [],
    risks: Array.isArray(input.risks)
      ? input.risks.slice(0, 100).map(item => ({
          id: requireText(item?.id, 'Risk id', 160),
          level: item.level,
          description: requireText(item?.description, 'Risk description', 2_000),
          mitigation: cleanText(item?.mitigation, 2_000) || undefined,
        }))
      : [],
    validation: Array.isArray(input.validation)
      ? input.validation.slice(0, 100).map(item => ({
          id: requireText(item?.id, 'Validation id', 160),
          description: requireText(item?.description, 'Validation description', 2_000),
          command: cleanText(item?.command, 4_000) || undefined,
          required: item.required !== false,
        }))
      : [],
  };
}

function rowToTask(value: unknown): AgentTaskRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    chatWindowId: row.chat_window_id ?? null,
    title: row.title,
    status: row.status,
    spec: parseJson(row.spec_json, 'task spec') as unknown as AgentTaskSpec,
    revision: row.revision,
    activeRunId: row.active_run_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

function rowToRun(value: unknown): AgentRunRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    phase: row.phase,
    scene: row.scene,
    strategy: row.strategy,
    provider: row.provider ?? null,
    model: row.model ?? null,
    state: parseJson(row.state_json, 'run state'),
    approvalGroupId: row.approval_group_id ?? null,
    error: row.error ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

function rowToStep(value: unknown): AgentStepRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    kind: row.kind,
    title: row.title,
    status: row.status,
    input: parseJson(row.input_json, 'step input'),
    output: parseJson(row.output_json, 'step output'),
    error: row.error ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function rowToApproval(value: unknown): AgentApprovalRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id ?? null,
    groupId: row.group_id,
    capability: row.capability,
    riskLevel: row.risk_level,
    status: row.status,
    request: parseJson(row.request_json, 'approval request'),
    decision: parseJson(row.decision_json, 'approval decision'),
    revision: row.revision,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

function rowToArtifact(value: unknown): AgentArtifactRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id ?? null,
    stepId: row.step_id ?? null,
    kind: row.kind,
    name: row.name,
    uri: row.uri ?? null,
    metadata: parseJson(row.metadata_json, 'artifact metadata'),
    validationStatus: row.validation_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(value: unknown): AgentRunEventRecord {
  const row = value as Record<string, any>;
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type,
    payload: parseJson(row.payload_json, 'run event payload'),
    createdAt: row.created_at,
  };
}

function parseJson(value: unknown, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Agent state must be JSON serializable');
  return serialized;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function assertRevision(entity: string, id: string, expected: number, actual: number): void {
  if (expected !== actual) throw new AgentConcurrencyError(entity, id, expected, actual);
}
