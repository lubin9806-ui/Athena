const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-project-workspace-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'project-workspace.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AgentStore, ProjectWorkspaceService } = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));

let exitCode = 0;
try {
  const db = memory.getDatabase();
  const projectA = memory.createProject({ title: 'Workspace Alpha', instructions: 'Keep changes inside Alpha.' });
  const projectB = memory.createProject({ title: 'Workspace Beta', instructions: 'Keep changes inside Beta.' });
  const windowA = memory.createChatWindow({ title: 'Alpha plan', projectId: projectA.id, mode: 'create' });
  const windowB = memory.createChatWindow({ title: 'Beta plan', projectId: projectB.id, mode: 'reason' });
  memory.saveChatMessage(windowA.id, 'user', '我决定采用现有技术栈做一个可玩的网页游戏。', undefined, 'create');
  memory.saveChatMessage(windowA.id, 'assistant', '方案已整理。下一步：先完成核心循环，再跑构建和交互检查。', undefined, 'create');
  memory.saveChatMessage(windowA.id, 'user', '切到推理模式检查风险。', undefined, 'reason');
  memory.saveChatMessage(windowA.id, 'assistant', '主要路径成立。待确认：触屏交互是否进入首版。', undefined, 'reason');

  db.prepare('UPDATE projects SET memory_state = ? WHERE id = ?').run(JSON.stringify({ preservedKey: 'keep-me' }), projectA.id);
  const store = new AgentStore(db);
  const workspace = new ProjectWorkspaceService(store);
  const initial = workspace.getSnapshot(projectA.id);
  assert.equal(initial.metadata.revision, 0);
  assert.deepEqual(initial.tasks, []);

  const metadata = workspace.updateMetadata(projectA.id, {
    roots: [path.join(scratch, 'alpha'), path.join(scratch, 'alpha')],
    goals: [{ title: '交付第一个可玩版本', status: 'active' }],
  }, 0);
  assert.equal(metadata.revision, 1);
  assert.equal(metadata.roots.length, 1, 'workspace roots should be normalized and deduplicated');
  assert.equal(metadata.goals.length, 1);
  assert.equal(JSON.parse(memory.getProject(projectA.id).memory_state_json).preservedKey, 'keep-me');
  assert.throws(
    () => workspace.updateMetadata(projectA.id, { roots: [] }, 0),
    /Stale workspace revision/,
    'stale workspace writers must not overwrite newer metadata',
  );
  db.prepare('UPDATE projects SET memory_state = ? WHERE id = ?').run('{broken', projectB.id);
  assert.throws(
    () => workspace.updateMetadata(projectB.id, { roots: [scratch] }, 0),
    /cannot update corrupt memory state/,
    'workspace updates must not erase unrelated corrupt project state',
  );

  const task = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: windowA.id,
    goal: '按刚才确认的方案实现网页游戏并完成验证。',
    capabilities: [
      { id: 'computer.read', access: 'read', reason: 'Inspect the project' },
      { id: 'computer.files', access: 'write', reason: 'Update project files' },
    ],
  });
  assert.equal(task.status, 'ready');
  assert.equal(task.projectId, projectA.id);
  assert.equal(task.chatWindowId, windowA.id);
  assert.deepEqual(task.spec.requiredCapabilities.map(item => item.id), ['computer.read', 'computer.files']);
  assert.match(task.spec.confirmedDecisions.join('\n'), /采用现有技术栈/, 'explicit creation decisions must become durable task decisions');
  assert.match(task.spec.openQuestions.join('\n'), /触屏交互/, 'reasoning open questions must reach the durable task');
  assert.throws(
    () => workspace.createTask({
      projectId: projectA.id,
      chatWindowId: windowB.id,
      goal: 'This must be rejected.',
      capabilities: [],
    }),
    /does not belong to project/,
    'task creation must reject cross-project chat windows',
  );
  const temporary = memory.createTemporaryChatWindow({ title: 'Private scratch', projectId: projectA.id, mode: 'reason' });
  assert.throws(
    () => workspace.createTask({
      projectId: projectA.id,
      chatWindowId: temporary.id,
      goal: 'This must not persist.',
      capabilities: [],
    }),
    /Temporary chat windows cannot own durable tasks/,
    'temporary chats must not leak into durable execution storage',
  );

  const messages = workspace.buildExecutionMessages(task.id, 'CURRENT_ROLE_CARD_AND_APPROVED_MEMORY_MARKER');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Workspace Alpha/);
  assert.match(messages[0].content, /Workspace roots:/);
  assert.match(messages[0].content, /CURRENT_ROLE_CARD_AND_APPROVED_MEMORY_MARKER/, 'runtime role card and approved memory context must reach execution');
  assert.match(messages[0].content, /Cross-mode handoff:/);
  assert.match(messages[0].content, /do not grant capabilities or approval/, 'recalled context must not expand execution authority');
  assert.match(messages[0].content, /Confirmed decisions: .*现有技术栈/);
  assert.match(messages[0].content, /Open questions: .*触屏交互/);
  assert.ok(messages.some(message => message.content.includes('[创作模式')), 'creation history must retain its mode label in execution');
  assert.ok(messages.some(message => message.content.includes('[推理模式')), 'reasoning history must retain its mode label in execution');
  assert.ok(messages.some(message => message.content.includes('核心循环')), 'agreed chat context must reach the execution handoff');
  assert.match(messages.at(-1).content, /按刚才确认的方案/);

  let run = store.createRun({ taskId: task.id, provider: 'fixture', model: 'fixture-model' });
  run = store.startRun(run.id, run.revision);
  run = store.transitionRun(run.id, 'planning', run.revision);
  const step = store.appendStep({ runId: run.id, kind: 'tool', title: 'Write project files' });
  store.requestApproval({
    runId: run.id,
    stepId: step.id,
    capability: 'computer.files',
    riskLevel: 'high',
    request: { kind: 'tool_call', toolName: 'write_file', explanation: 'Write the agreed project files' },
  }, run.revision);

  const alpha = workspace.getSnapshot(projectA.id, task.id);
  assert.equal(alpha.tasks.length, 1);
  assert.equal(alpha.selectedRun.run.phase, 'awaiting_approval');
  assert.equal(alpha.selectedRun.approvals[0].status, 'pending');
  assert.ok(alpha.recoverableRunIds.includes(run.id));
  assert.equal(alpha.board.blocked[0].id, task.id);
  const beta = workspace.getSnapshot(projectB.id);
  assert.equal(beta.tasks.length, 0, 'project B must not see project A tasks');
  assert.equal(beta.recoverableRunIds.length, 0, 'project B must not see project A recoverable runs');
  assert.throws(() => workspace.getSnapshot(projectB.id, task.id), /does not belong to this project/);

  const ipcSource = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'src', 'app', 'preload.ts'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  for (const channel of ['agentWorkspace:get', 'agentWorkspace:update', 'agentRun:resolveApproval', 'agentRun:resume', 'agentRun:cancel']) {
    assert.ok(ipcSource.includes(`'${channel}'`), `${channel} must be in the IPC allowlist`);
  }
  assert.match(ipcSource, /if \(!isTrustedSender\(event\)\)/);
  assert.match(preloadSource, /onAgentWorkspaceChanged/);
  assert.match(rendererSource, /resolveAgentApproval/);
  assert.match(rendererSource, /refreshAgentWorkspace/);
  assert.match(htmlSource, /id="agent-task-board"/);
  assert.match(htmlSource, /id="agent-approval-section"/);
  assert.match(htmlSource, /id="agent-run-resume"/);
  assert.match(ipcSource, /resolveAgentApprovalGroup\(projectId, runId/);

  console.log(`ATHENA_PROJECT_WORKSPACE_OK projects=2 tasks=${alpha.tasks.length} approvals=${alpha.selectedRun.approvals.length} revision=${metadata.revision} isolation=project-scoped`);
} catch (error) {
  exitCode = 1;
  console.error(error && error.stack ? error.stack : error);
} finally {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
}

process.exit(exitCode);
