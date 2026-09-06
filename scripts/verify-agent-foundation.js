const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-agent-foundation-'));
const databaseDir = path.join(scratch, 'database');
const databasePath = path.join(databaseDir, 'agent-foundation-test.db');
fs.mkdirSync(databaseDir, { recursive: true });

// Start from a pre-agent schema marker so this test covers the v9 -> v10 migration path.
const legacy = new Database(databasePath);
legacy.exec('CREATE TABLE migration_probe (value TEXT NOT NULL); INSERT INTO migration_probe VALUES (\'preserved\');');
legacy.pragma('user_version = 9');
legacy.close();

process.env.ATHENA_DB_DIR = databaseDir;
process.env.ATHENA_DB_FILENAME = path.basename(databasePath);
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const {
  AgentApprovalError,
  AgentConcurrencyError,
  AgentStateTransitionError,
  AgentStore,
} = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));

let exitCode = 0;
try {
  const db = memory.getDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 17, 'agent foundation records must survive the current schema');
  assert.equal(db.prepare('SELECT value FROM migration_probe').get().value, 'preserved', 'migration must retain existing data');
  assert.ok(fs.readdirSync(path.join(databaseDir, 'backups')).some(name => name.endsWith('.bak')), 'migration should create a backup');

  const project = memory.ensureDefaultProject();
  const chatWindow = memory.createChatWindow({ title: 'Agent foundation', projectId: project.id, mode: 'reason' });
  let store = new AgentStore(db);

  let task = store.createTask({
    title: 'Build a playable web game',
    goal: 'Turn the agreed design into a verified playable web game.',
    projectId: project.id,
    chatWindowId: chatWindow.id,
    spec: {
      successCriteria: ['The game launches', 'The core loop is playable'],
      confirmedDecisions: ['Use the current project stack'],
      openQuestions: ['Final art direction'],
      plan: [{
        id: 'implement',
        title: 'Implement the agreed game',
        successCriteria: ['Build passes'],
        requiredCapabilities: ['workspace.write', 'terminal.execute'],
      }],
      requiredCapabilities: [{
        id: 'workspace.write',
        access: 'write',
        reason: 'Create and update project files',
        required: true,
      }],
      risks: [{
        id: 'overwrite',
        level: 'high',
        description: 'Existing project files could be changed',
        mitigation: 'Review the scoped write approval',
      }],
      validation: [{
        id: 'tests',
        description: 'Run the project tests',
        command: 'npm test',
        required: true,
      }],
    },
  });
  assert.equal(task.status, 'draft');
  assert.equal(task.spec.version, 1);
  assert.equal(task.projectId, project.id);
  assert.equal(task.chatWindowId, chatWindow.id);

  assert.throws(
    () => store.updateTaskSpec(task.id, task.spec, task.revision + 1),
    AgentConcurrencyError,
    'stale writers must not overwrite task state',
  );
  task = store.transitionTask(task.id, 'ready', task.revision);

  let run = store.createRun({
    taskId: task.id,
    scene: 'work',
    strategy: 'reason',
    provider: 'test-provider',
    model: 'test-model',
    state: { agreedPlanVersion: 1 },
  });
  assert.equal(run.status, 'queued');
  assert.equal(store.getTask(task.id).activeRunId, run.id);

  run = store.startRun(run.id, run.revision);
  run = store.transitionRun(run.id, 'planning', run.revision, { state: { agreedPlanVersion: 1, planReady: true } });
  run = store.checkpointRun(run.id, { agreedPlanVersion: 1, planReady: true, cursor: 'implement' }, run.revision);
  let step = store.appendStep({ runId: run.id, kind: 'tool', title: 'Write project files', input: { scope: 'workspace' } });
  step = store.transitionStep(step.id, 'running', step.revision);

  const approval = store.requestApproval({
    runId: run.id,
    stepId: step.id,
    capability: 'workspace.write',
    riskLevel: 'high',
    request: { roots: ['G:/Athena'], operation: 'write' },
  }, run.revision);
  run = store.getRun(run.id);
  assert.equal(run.phase, 'awaiting_approval');
  assert.equal(run.status, 'paused');
  assert.equal(store.getTask(task.id).status, 'blocked');
  assert.ok(store.listRecoverableRuns().some(item => item.id === run.id));
  assert.throws(
    () => store.transitionRun(run.id, 'executing', run.revision),
    AgentApprovalError,
    'execution must remain blocked while approval is pending',
  );

  const runId = run.id;
  memory.closeDatabase();

  // Re-open the same database to prove the interrupted run is recoverable after restart.
  store = new AgentStore(memory.getDatabase());
  let snapshot = store.getRunSnapshot(runId);
  assert.equal(snapshot.run.phase, 'awaiting_approval');
  assert.equal(snapshot.run.state.cursor, 'implement');
  assert.equal(snapshot.approvals[0].status, 'pending');
  assert.equal(snapshot.steps[0].status, 'running');

  const resolved = store.resolveApproval(approval.id, 'approved', { actor: 'user', scopeConfirmed: true }, approval.revision);
  assert.equal(resolved.status, 'approved');
  run = store.getRun(runId);
  run = store.transitionRun(run.id, 'executing', run.revision);
  assert.equal(run.approvalGroupId, null, 'leaving an approval checkpoint must close its group');

  step = store.getStep(step.id);
  step = store.transitionStep(step.id, 'completed', step.revision, { output: { filesChanged: 3 } });
  let artifact = store.addArtifact({
    taskId: task.id,
    runId: run.id,
    stepId: step.id,
    kind: 'code_diff',
    name: 'Playable game implementation',
    uri: 'workspace://game',
    metadata: { filesChanged: 3 },
  });
  artifact = store.updateArtifactValidation(artifact.id, 'passed');
  assert.equal(artifact.validationStatus, 'passed');

  run = store.transitionRun(run.id, 'verifying', run.revision, { state: { cursor: 'verification', testsPassed: true } });
  run = store.transitionRun(run.id, 'completed', run.revision);
  assert.equal(run.status, 'completed');
  assert.ok(!store.listRecoverableRuns().some(item => item.id === run.id));

  snapshot = store.getRunSnapshot(run.id);
  assert.equal(snapshot.task.status, 'completed');
  assert.equal(snapshot.task.activeRunId, null);
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.artifacts[0].validationStatus, 'passed');
  assert.deepEqual(snapshot.events.map(event => event.sequence), snapshot.events.map((_, index) => index + 1), 'run events must be ordered and contiguous');
  assert.throws(
    () => store.transitionRun(run.id, 'executing', run.revision),
    AgentStateTransitionError,
    'terminal runs must reject further execution',
  );

  console.log(`ATHENA_AGENT_FOUNDATION_OK task=${task.id} run=${run.id} events=${snapshot.events.length}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(exitCode);
}
