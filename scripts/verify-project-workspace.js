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
const {
  AgentStore,
  ProjectWorkspaceService,
  carryTranscript,
  pairToolResults,
} = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));

function toolCallMessage(callId, name, args, text = '') {
  return {
    role: 'assistant',
    content: text,
    toolCalls: [{ id: callId, name, arguments: args, rawArguments: JSON.stringify(args) }],
  };
}

function toolResultMessage(callId, name, output, summary = 'ok') {
  return {
    role: 'tool',
    toolCallId: callId,
    toolName: name,
    content: JSON.stringify({ status: 'completed', summary, output }),
  };
}

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
  const systemPrompt = messages[0].content;
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Workspace Alpha/);
  assert.match(messages[0].content, /Workspace roots:/);
  assert.match(messages[0].content, /CURRENT_ROLE_CARD_AND_APPROVED_MEMORY_MARKER/, 'runtime role card and approved memory context must reach execution');
  assert.match(messages[0].content, /Cross-mode handoff:/);
  assert.match(messages[0].content, /do not grant capabilities or approval/, 'recalled context must not expand execution authority');
  assert.match(messages[0].content, /Photorealistic style alone is not evidence/, 'execution must not infer a real person from photorealistic AI style');
  assert.match(messages[0].content, /non-consensual plot elements, injury, blood, violence, horror, or death/, 'execution must retain the open adult-fiction handoff');
  assert.match(messages[0].content, /Determine fictional age from the user declaration and written canon/, 'execution must use declared fictional age instead of visual guessing');
  assert.match(messages[0].content, /Do not invent an additional content-policy category/, 'execution must not invent a broad refusal category');
  assert.match(messages[0].content, /Confirmed decisions: .*现有技术栈/);
  assert.match(messages[0].content, /Open questions: .*触屏交互/);
  // Mode labels stay, but as quoted context inside the system prompt. As real
  // turns they carried "[执行模式 · 消息 #12]" headers, and the model copied that
  // header into its own replies (2026-09-15 window 30).
  assert.match(systemPrompt, /\[创作\] 用户: 我决定采用现有技术栈/, 'creation history must reach execution with its mode label');
  assert.match(systemPrompt, /\[推理\] Athena: 主要路径成立/, 'reasoning history must reach execution with its mode label');
  assert.ok(systemPrompt.includes('核心循环'), 'agreed chat context must reach the execution handoff');
  assert.ok(
    messages.slice(1).every(message => !/消息 #\d+/.test(message.content)),
    'history must not be replayed as labelled turns the model can imitate',
  );
  assert.equal(messages.length, 2, 'the first turn of a window is the system prompt and the message itself');
  assert.equal(messages.at(-1).content, '按刚才确认的方案实现网页游戏并完成验证。', 'the turn is the message, not a restated goal');

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

  // ATH-EXEC-006: one chat window is one execute session. The next turn starts
  // from the previous run's own transcript - tool calls and their results - so
  // the reply that carries an API key continues that work instead of starting a
  // second task that has never seen the question.
  const sessionWindow = memory.createChatWindow({ title: 'Session window', projectId: projectA.id, mode: 'execute' });
  const askTurn = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: sessionWindow.id,
    goal: '把 Moody Krea 2 Mix 下到 ComfyUI。',
    capabilities: [{ id: 'computer.files', access: 'write', reason: 'Download the model' }],
  });
  const askMessages = [
    { role: 'system', content: 'OLD_SYSTEM_PROMPT_MARKER' },
    { role: 'user', content: '[执行模式 · 消息 #41]\n把 Moody Krea 2 Mix 下到 ComfyUI。' },
    toolCallMessage('call-1', 'list_directory', { path: 'D:/ComfyUI/models/checkpoints' }, '我先看看模型文件夹里有什么。'),
    toolResultMessage('call-1', 'list_directory', 'juggernautXL_v9.safetensors\n… 另外 10 个', '11 个文件，没有这个模型'),
    { role: 'assistant', content: '这个模型要登录才能下，请把 Civitai Token 发我。' },
  ];
  let askRun = store.createRun({
    taskId: askTurn.id,
    provider: 'fixture',
    model: 'fixture-model',
    state: {
      version: 1,
      messages: askMessages,
      round: 2,
      toolCallCount: 1,
      allowedCapabilities: ['computer.files'],
      approvalMode: 'risk_based',
      pendingBatch: null,
      validationResults: {},
      finalContent: '这个模型要登录才能下，请把 Civitai Token 发我。',
      session: { chatWindowId: sessionWindow.id, ownStart: 1, inboxSequence: 0, lastChatMessageId: null },
    },
  });
  askRun = store.startRun(askRun.id, askRun.revision);
  askRun = store.transitionRun(askRun.id, 'planning', askRun.revision);
  askRun = store.transitionRun(askRun.id, 'verifying', askRun.revision);
  askRun = store.transitionRun(askRun.id, 'completed', askRun.revision);

  const keyTurn = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: sessionWindow.id,
    goal: 'civitai_example_token_8c3e',
    capabilities: [{ id: 'computer.files', access: 'write', reason: 'Download the model' }],
  });
  const continued = workspace.buildExecutionMessages(keyTurn.id, 'RUNTIME_MARKER');
  assert.equal(continued[0].role, 'system');
  assert.ok(!continued[0].content.includes('OLD_SYSTEM_PROMPT_MARKER'), 'the previous run system prompt must not be carried into the new one');
  assert.equal(continued[1].role, 'user', 'a carried transcript still starts with the person speaking');
  assert.ok(
    continued.some(message => (message.toolCalls || []).some(call => call.id === 'call-1')),
    'the next turn must see the tool call the previous turn made',
  );
  const carriedResult = continued.find(message => message.role === 'tool' && message.toolCallId === 'call-1');
  assert.ok(carriedResult, 'the next turn must see the result of that tool call');
  assert.match(carriedResult.content, /没有这个模型/);
  assert.ok(
    continued.some(message => message.role === 'assistant' && message.content.includes('请把 Civitai Token 发我')),
    'the question the person is answering must still be in the transcript',
  );
  assert.equal(continued.at(-1).content, 'civitai_example_token_8c3e', 'the answer is the newest turn, unframed');
  assert.ok(
    continued.slice(1).every(message => !/消息 #\d+/.test(message.content)),
    'legacy message labels must be stripped from a carried transcript',
  );

  // A turn that was stopped mid-batch leaves tool calls without results, which
  // providers reject. Carrying the transcript repairs the pairing instead.
  const brokenWindow = memory.createChatWindow({ title: 'Stopped window', projectId: projectA.id, mode: 'execute' });
  const stoppedTurn = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: brokenWindow.id,
    goal: '删掉旧日志。',
    capabilities: [{ id: 'computer.files', access: 'write', reason: 'Delete logs' }],
  });
  let stoppedRun = store.createRun({
    taskId: stoppedTurn.id,
    provider: 'fixture',
    model: 'fixture-model',
    state: {
      version: 1,
      messages: [
        { role: 'system', content: 'OLD' },
        { role: 'user', content: '删掉旧日志。' },
        toolCallMessage('call-9', 'delete_path', { path: 'D:/logs' }, '先看一眼要删的东西。'),
      ],
      round: 1,
      toolCallCount: 0,
      allowedCapabilities: ['computer.files'],
      approvalMode: 'risk_based',
      pendingBatch: null,
      validationResults: {},
      finalContent: null,
      session: { chatWindowId: brokenWindow.id, ownStart: 1, inboxSequence: 0, lastChatMessageId: null },
    },
  });
  stoppedRun = store.startRun(stoppedRun.id, stoppedRun.revision);
  stoppedRun = store.transitionRun(stoppedRun.id, 'planning', stoppedRun.revision);
  stoppedRun = store.transitionRun(stoppedRun.id, 'cancelled', stoppedRun.revision, { error: 'Run cancelled' });
  const afterStop = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: brokenWindow.id,
    goal: '算了，别删了，先列出来给我看。',
    capabilities: [{ id: 'computer.read', access: 'read', reason: 'List logs' }],
  });
  const repaired = workspace.buildExecutionMessages(afterStop.id, 'RUNTIME_MARKER');
  const repairedResult = repaired.find(message => message.role === 'tool' && message.toolCallId === 'call-9');
  assert.ok(repairedResult, 'a call left without a result must get one, or the provider rejects the transcript');
  assert.match(repairedResult.content, /没有执行/);
  assert.match(repaired[0].content, /stopped by the user/, 'the model must be told the previous turn was stopped');

  // The pure transcript rules, checked on their own.
  const orphanRepaired = pairToolResults([
    { role: 'user', content: 'x' },
    toolResultMessage('ghost', 'run_command', 'should be dropped'),
    toolCallMessage('a', 'run_command', { command: 'dir' }),
    toolResultMessage('a', 'run_command', 'ok'),
  ]);
  assert.equal(orphanRepaired.length, 3, 'a result whose call is gone must be dropped');
  assert.equal(orphanRepaired[1].toolCalls[0].id, 'a');
  const bulky = carryTranscript([
    { role: 'system', content: 'ignored' },
    { role: 'user', content: '第一轮' },
    toolCallMessage('big', 'write_file', { path: 'a.txt', content: 'x'.repeat(50_000) }),
    toolResultMessage('big', 'write_file', 'y'.repeat(200_000)),
    { role: 'assistant', content: '写好了。' },
    { role: 'user', content: '第二轮' },
    toolCallMessage('recent', 'read_file', { path: 'a.txt' }),
    toolResultMessage('recent', 'read_file', 'z'.repeat(3_000)),
    { role: 'assistant', content: '读完了。' },
  ], { recentTurns: 1 });
  assert.equal(bulky.messages[0].role, 'user');
  assert.ok(!bulky.messages.some(message => message.role === 'system'), 'carried transcripts drop the old system prompt');
  const olderWrite = bulky.messages.find(message => (message.toolCalls || []).some(call => call.id === 'big'));
  assert.ok(olderWrite.toolCalls[0].arguments.content.length < 1_000, 'older tool arguments must be compacted');
  assert.equal(
    olderWrite.toolCalls[0].rawArguments,
    JSON.stringify(olderWrite.toolCalls[0].arguments),
    'compacted arguments must stay consistent with what is sent to the provider',
  );
  const olderResult = bulky.messages.find(message => message.toolCallId === 'big');
  assert.ok(olderResult.content.length < 2_000, 'older tool output must be compacted');
  const recentResult = bulky.messages.find(message => message.toolCallId === 'recent');
  assert.ok(recentResult.content.includes('z'.repeat(3_000)), 'the most recent turn keeps its evidence');
  const tiny = carryTranscript([
    { role: 'user', content: '一' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: '二' },
    { role: 'assistant', content: 'B' },
    { role: 'user', content: '三' },
    { role: 'assistant', content: 'C' },
  ], { maxMessages: 3, maxChars: 40 });
  assert.equal(tiny.droppedTurns, 2, 'whole turns are dropped oldest first when the budget runs out');
  assert.equal(tiny.messages[0].content, '三');

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
  // ATH-SEC-009: a click decides the item it was on; deciding the whole group has to
  // be asked for explicitly.
  assert.match(ipcSource, /resolveAgentApproval\(projectId, runId, approvalId, decision, scope/);
  assert.match(ipcSource, /value\.scope === 'group' \? 'group' : 'item'/, 'the IPC default must be a single item');
  assert.match(rendererSource, /dataset\.scope = 'item'/, 'each approval card button must decide only its own item');

  // ATH-CHAT-007: execute mode no longer asks first. The card it used to show was
  // a gate that asked about nothing - the goal was echoed back word for word and
  // the plan under it was one hardcoded step - so a task built the way the
  // controller now builds it has to be runnable straight away.
  const immediate = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: windowA.id,
    goal: '把桌面上的图片整理到海报文件夹。',
    capabilities: [{ id: 'computer.files', access: 'write', reason: 'Move files' }],
  });
  assert.equal(immediate.status, 'ready', 'execute mode must not park the task behind a confirmation');
  assert.equal(workspace.findPendingDraftTask(windowA.id), null, 'running directly leaves nothing pending');

  // The draft API stays for the migration path: a database written by the old
  // flow can still hold a pending draft, and the controller cancels it on the
  // next execute message rather than leaving it in the window forever.
  const legacyDraft = workspace.createTask({
    projectId: projectA.id,
    chatWindowId: windowA.id,
    goal: '旧流程留下的待确认任务。',
    keepDraft: true,
    capabilities: [{ id: 'computer.files', access: 'write', reason: 'Move files' }],
  });
  assert.equal(legacyDraft.status, 'draft');
  assert.equal(workspace.findPendingDraftTask(windowA.id).id, legacyDraft.id, 'a stale draft must be findable to be cleaned up');
  assert.equal(workspace.findPendingDraftTask(windowB.id), null, 'drafts do not leak across windows');

  console.log(`ATHENA_PROJECT_WORKSPACE_OK projects=2 tasks=${alpha.tasks.length} approvals=${alpha.selectedRun.approvals.length} revision=${metadata.revision} isolation=project-scoped execute=runs-immediately approvals=per-call`);
} catch (error) {
  exitCode = 1;
  console.error(error && error.stack ? error.stack : error);
} finally {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
}

process.exit(exitCode);
