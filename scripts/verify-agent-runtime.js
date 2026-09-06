const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-agent-runtime-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'agent-runtime.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const {
  AgentRunBusyError,
  AgentRunner,
  AgentStore,
  AgentToolRegistrationError,
  AgentToolRetryableError,
  ToolRegistry,
} = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));
const { ComputerAgentToolBridge } = require(path.join(root, 'dist', 'core', 'tools', 'AgentComputerTools.js'));

const capabilities = {
  nativeToolCalls: true,
  parallelToolCalls: true,
  streamingToolCalls: true,
  strictToolSchemas: true,
  toolChoiceModes: ['auto', 'none', 'required', 'specific'],
  jsonObjectOutput: true,
  jsonSchemaOutput: true,
  toolResultUsesCallId: true,
  toolResultUsesName: false,
};

class FixtureModel {
  providerName = 'fixture';
  modelName = 'fixture-agent-model';
  capabilities = capabilities;

  constructor(responses) {
    this.responses = [...responses];
    this.requests = [];
  }

  async chatWithTools(messages, tools, options) {
    this.requests.push({ messages: structuredClone(messages), tools: structuredClone(tools), options });
    const next = this.responses.shift();
    if (!next) throw new Error('Fixture model response queue exhausted');
    return typeof next === 'function' ? next(messages, tools, options) : structuredClone(next);
  }
}

function modelResponse(content, toolCalls = []) {
  return {
    provider: 'ollama',
    model: 'fixture-agent-model',
    responseId: null,
    content,
    toolCalls,
    finishReason: toolCalls.length ? 'tool_calls' : 'stop',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

function toolCall(id, name, args) {
  return { id, name, arguments: args, rawArguments: JSON.stringify(args) };
}

function registerTool(registry, input) {
  return registry.register({
    version: input.version || 'fixture-v1',
    capability: input.capability,
    label: input.name,
    description: `Fixture tool ${input.name}`,
    parameters: input.parameters,
    strict: true,
    idempotent: input.idempotent,
    supportsIdempotencyKey: input.supportsIdempotencyKey,
    retry: input.retry,
    policy: {
      capability: input.capability,
      access: input.access,
      riskLevel: input.riskLevel,
      approval: input.approval,
      reason: `Fixture policy for ${input.name}`,
    },
    execute: input.execute,
    name: input.name,
  });
}

function createReadyTask(store, title, capabilitiesInput, validation = []) {
  let task = store.createTask({
    title,
    goal: title,
    spec: {
      successCriteria: ['The fixture run reaches a truthful terminal state'],
      requiredCapabilities: capabilitiesInput.map(item => ({
        id: item.id,
        access: item.access,
        reason: `Fixture requires ${item.id}`,
        required: true,
      })),
      validation,
    },
  });
  task = store.transitionTask(task.id, 'ready', task.revision);
  return task;
}

async function main() {
  let store = new AgentStore(memory.getDatabase());

  let bridgeSettings = {
    permissionLevel: 'full',
    modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'full' },
    maxToolRounds: 4,
    commandTimeoutSeconds: 2,
    allowExternalNetwork: false,
  };
  const bridgeRegistry = new ToolRegistry();
  const bridge = new ComputerAgentToolBridge({ registry: bridgeRegistry, getSettings: () => bridgeSettings });
  const bridgedNames = bridge.refresh();
  assert.ok(bridgedNames.includes('read_file'));
  assert.ok(bridgedNames.includes('copy_path'));
  const copyCall = toolCall('bridge-copy', 'copy_path', { source: 'source.txt', destination: 'destination.txt' });
  assert.equal(bridgeRegistry.resolve(copyCall).policy.approval, 'always', 'default overwrite copy must require approval');
  const writeCall = toolCall('bridge-write', 'write_file', { path: 'secret.txt', content: 'private fixture content' });
  assert.match(bridgeRegistry.resolve(writeCall).persistedArguments.content, /CONTENT_REDACTED/);
  const probePath = path.join(scratch, 'bridge-probe.txt');
  fs.writeFileSync(probePath, 'probe', 'utf8');
  const readCall = toolCall('bridge-read', 'read_file', { path: probePath });
  const resolvedRead = bridgeRegistry.resolve(readCall);
  bridgeSettings = { ...bridgeSettings, permissionLevel: 'off' };
  const revokedRead = await bridgeRegistry.executeResolved(readCall, resolvedRead, {
    runId: 'bridge-run',
    stepId: 'bridge-step',
    callId: readCall.id,
    attempt: 1,
    idempotencyKey: 'bridge-run:bridge-step:bridge-read',
    signal: new AbortController().signal,
  });
  assert.equal(revokedRead.status, 'denied', 'current permission must be enforced again at execution time');
  assert.deepEqual(bridge.refresh(), [], 'revoked permissions must remove model-visible computer tools');
  bridge.shutdown();

  const invalidRegistry = new ToolRegistry();
  assert.throws(() => registerTool(invalidRegistry, {
    name: 'invalid_schema',
    parameters: { type: 'string' },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => modelResponse('unused'),
  }), AgentToolRegistrationError, 'tool schemas must be object-shaped');
  const ownershipRegistry = new ToolRegistry();
  const ownershipDefinition = registerTool(ownershipRegistry, {
    name: 'owned_tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => ({ status: 'completed', summary: 'Owned', content: '' }),
  });
  assert.equal(ownershipRegistry.unregister('owned_tool', {}), false);
  assert.equal(ownershipRegistry.has('owned_tool'), true);
  assert.equal(ownershipRegistry.unregister('owned_tool', ownershipDefinition), true);

  let flakyAttempts = 0;
  let writes = 0;
  const registry = new ToolRegistry();
  registerTool(registry, {
    name: 'flaky_read',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
    idempotent: true,
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => {
      flakyAttempts += 1;
      if (flakyAttempts === 1) throw new AgentToolRetryableError('temporary read failure');
      return { status: 'completed', summary: 'Read completed', content: 'fixture data' };
    },
  });
  registerTool(registry, {
    name: 'dangerous_write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['path', 'content', 'password'],
      additionalProperties: false,
    },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'high',
    approval: 'always',
    execute: async () => {
      writes += 1;
      return { status: 'completed', summary: 'Write completed', content: 'one file changed' };
    },
  });

  const task = createReadyTask(store, 'Approval and restart recovery', [
    { id: 'workspace.read', access: 'read' },
    { id: 'workspace.write', access: 'write' },
  ]);
  const firstModel = new FixtureModel([modelResponse('', [
    toolCall('call-read', 'flaky_read', { query: 'Athena' }),
    toolCall('call-write-one', 'dangerous_write', { path: 'result-one.txt', content: 'hello', password: 'secret-value' }),
    toolCall('call-write-two', 'dangerous_write', { path: 'result-two.txt', content: 'world', password: 'secret-value' }),
  ])]);
  const firstRunner = new AgentRunner(firstModel, registry, undefined, store, { modelRetryDelayMs: 1 });
  const first = await firstRunner.start({
    taskId: task.id,
    messages: [{ role: 'user', content: 'Read and then write the fixture.' }],
    allowedCapabilities: ['workspace.read', 'workspace.write'],
  }).result;
  assert.equal(first.status, 'paused');
  assert.equal(first.snapshot.run.phase, 'awaiting_approval');
  assert.equal(first.snapshot.approvals.length, 2);
  assert.equal(new Set(first.snapshot.approvals.map(item => item.groupId)).size, 1, 'one tool batch must use one approval group');
  assert(first.snapshot.approvals.every(item => item.request.toolName === 'dangerous_write'));
  assert(first.snapshot.approvals.every(item => item.request.arguments.password === '[REDACTED]'));
  assert.equal(flakyAttempts, 0, 'a batch must pause before executing any call when one call needs approval');
  assert.equal(writes, 0);

  const runId = first.runId;
  const approvalIds = first.snapshot.approvals.map(item => item.id);
  memory.closeDatabase();
  store = new AgentStore(memory.getDatabase());
  for (const approvalId of approvalIds) {
    const approval = store.getApproval(approvalId);
    store.resolveApproval(approval.id, 'approved', { actor: 'fixture-user' }, approval.revision);
  }

  const resumedModel = new FixtureModel([messages => {
    const toolMessages = messages.filter(message => message.role === 'tool');
    assert.equal(toolMessages.length, 3);
    assert.equal(toolMessages[0].toolCallId, 'call-read');
    assert.equal(toolMessages[1].toolCallId, 'call-write-one');
    assert.equal(toolMessages[2].toolCallId, 'call-write-two');
    return modelResponse('Recovered run complete.');
  }]);
  const resumedRunner = new AgentRunner(resumedModel, registry, undefined, store, { modelRetryDelayMs: 1 });
  const resumed = await resumedRunner.resume(runId);
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.content, 'Recovered run complete.');
  assert.equal(flakyAttempts, 2, 'idempotent retry should stop after the first successful attempt');
  assert.equal(writes, 2, 'each approved non-idempotent tool must execute exactly once');
  assert.ok(resumed.snapshot.events.some(event => event.type === 'runner.tool_retry_scheduled'));

  let invalidExecutions = 0;
  const invalidTask = createReadyTask(store, 'Reject invalid model arguments', [{ id: 'workspace.read', access: 'read' }]);
  const invalidModel = new FixtureModel([
    modelResponse('', [toolCall('call-invalid', 'flaky_read', {})]),
    messages => {
      assert.match(messages.at(-1).content, /validation failed/i);
      return modelResponse('Invalid arguments were rejected.');
    },
  ]);
  const invalidRegistryRuntime = new ToolRegistry();
  registerTool(invalidRegistryRuntime, {
    name: 'flaky_read',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => {
      invalidExecutions += 1;
      return { status: 'completed', summary: 'Should not run', content: '' };
    },
  });
  const invalidResult = await new AgentRunner(invalidModel, invalidRegistryRuntime, undefined, store).start({
    taskId: invalidTask.id,
    messages: [{ role: 'user', content: 'Call with missing arguments.' }],
    allowedCapabilities: ['workspace.read'],
  }).result;
  assert.equal(invalidResult.status, 'completed');
  assert.equal(invalidExecutions, 0);
  assert.equal(invalidResult.snapshot.steps.find(step => step.kind === 'tool').status, 'failed');

  let deniedExecutions = 0;
  const deniedTask = createReadyTask(store, 'Deny ungranted capability', [{ id: 'workspace.write', access: 'write' }]);
  const deniedRegistry = new ToolRegistry();
  registerTool(deniedRegistry, {
    name: 'write_without_grant',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'medium',
    approval: 'never',
    execute: async () => {
      deniedExecutions += 1;
      return { status: 'completed', summary: 'Should not run', content: '' };
    },
  });
  const deniedModel = new FixtureModel([
    modelResponse('', [toolCall('call-denied', 'write_without_grant', {})]),
    modelResponse('Policy denial handled.'),
  ]);
  const deniedResult = await new AgentRunner(deniedModel, deniedRegistry, undefined, store).start({
    taskId: deniedTask.id,
    messages: [{ role: 'user', content: 'Attempt an ungranted write.' }],
    allowedCapabilities: [],
  }).result;
  assert.equal(deniedResult.status, 'completed');
  assert.equal(deniedExecutions, 0);
  assert.equal(deniedResult.snapshot.approvals.length, 0);
  assert.equal(deniedResult.snapshot.steps.find(step => step.kind === 'tool').status, 'skipped');

  const validatedTask = createReadyTask(
    store,
    'Require explicit validation evidence',
    [{ id: 'workspace.read', access: 'read' }],
    [{ id: 'fixture-check', description: 'Fixture validation must pass', required: true }],
  );
  const validationRegistry = new ToolRegistry();
  registerTool(validationRegistry, {
    name: 'validate_fixture',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => ({
      status: 'completed',
      summary: 'Validation passed',
      content: 'fixture check passed',
      validations: [{ id: 'fixture-check', status: 'passed', evidence: 'fixture assertion passed' }],
    }),
  });
  const validationModel = new FixtureModel([
    modelResponse('', [toolCall('call-validation', 'validate_fixture', {})]),
    modelResponse('Validated completion.'),
  ]);
  const validated = await new AgentRunner(validationModel, validationRegistry, undefined, store).start({
    taskId: validatedTask.id,
    messages: [{ role: 'user', content: 'Complete only after validation.' }],
    allowedCapabilities: ['workspace.read'],
  }).result;
  assert.equal(validated.status, 'completed');
  assert.equal(validated.snapshot.run.state.validationResults['fixture-check'].status, 'passed');
  assert.equal(validated.verification, 'verified');

  // Conversation-created tasks carry `validation: []`, so the runner has nothing to
  // enforce and reaches `completed` on any run that stops calling tools. Acting
  // without declared acceptance evidence must read as unverified, not as accepted.
  const unverifiedTask = createReadyTask(
    store,
    'Act without declared acceptance evidence',
    [{ id: 'workspace.read', access: 'read' }],
  );
  const unverified = await new AgentRunner(
    new FixtureModel([
      modelResponse('', [toolCall('call-unverified', 'validate_fixture', {})]),
      modelResponse('Did the work.'),
    ]),
    validationRegistry,
    undefined,
    store,
  ).start({
    taskId: unverifiedTask.id,
    messages: [{ role: 'user', content: 'Do the work.' }],
    allowedCapabilities: ['workspace.read'],
  }).result;
  assert.equal(unverified.status, 'completed');
  assert.equal(unverified.verification, 'unverified');

  // A run that only answered, without touching anything, has nothing to verify.
  const answeredTask = createReadyTask(store, 'Answer without acting', []);
  const answered = await new AgentRunner(
    new FixtureModel([modelResponse('Here is the answer.')]),
    new ToolRegistry(),
    undefined,
    store,
  ).start({
    taskId: answeredTask.id,
    messages: [{ role: 'user', content: 'Just answer.' }],
    allowedCapabilities: [],
  }).result;
  assert.equal(answered.status, 'completed');
  assert.equal(answered.verification, 'not_applicable');

  const unvalidatedTask = createReadyTask(
    store,
    'Reject unvalidated completion',
    [],
    [{ id: 'required-check', description: 'Required check', required: true }],
  );
  const unvalidated = await new AgentRunner(
    new FixtureModel([modelResponse('Unsupported completion claim.')]),
    new ToolRegistry(),
    undefined,
    store,
  ).start({
    taskId: unvalidatedTask.id,
    messages: [{ role: 'user', content: 'Try to finish without evidence.' }],
    allowedCapabilities: [],
  }).result;
  assert.equal(unvalidated.status, 'failed');
  assert.match(unvalidated.error, /required-check/);

  let versionedExecutions = 0;
  const versionedTask = createReadyTask(store, 'Do not reuse approvals across tool versions', [{ id: 'workspace.write', access: 'write' }]);
  const versionedRegistry = new ToolRegistry();
  const versionedDefinition = version => ({
    name: 'versioned_write',
    version,
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'high',
    approval: 'always',
    execute: async () => {
      versionedExecutions += 1;
      return { status: 'completed', summary: 'Versioned write', content: version };
    },
  });
  registerTool(versionedRegistry, versionedDefinition('fixture-v1'));
  const versionedRunner = new AgentRunner(
    new FixtureModel([modelResponse('', [toolCall('call-versioned', 'versioned_write', { value: 'one' })])]),
    versionedRegistry,
    undefined,
    store,
  );
  const versionedPaused = await versionedRunner.start({
    taskId: versionedTask.id,
    messages: [{ role: 'user', content: 'Run the versioned tool.' }],
    allowedCapabilities: ['workspace.write'],
  }).result;
  const versionOneApproval = versionedPaused.snapshot.approvals[0];
  store.resolveApproval(versionOneApproval.id, 'approved', { actor: 'fixture-user' }, versionOneApproval.revision);
  versionedRegistry.unregister('versioned_write');
  registerTool(versionedRegistry, versionedDefinition('fixture-v2'));
  const versionTwoPaused = await versionedRunner.resume(versionedPaused.runId);
  assert.equal(versionTwoPaused.status, 'paused');
  assert.equal(versionTwoPaused.snapshot.approvals.length, 2);
  const versionTwoApproval = versionTwoPaused.snapshot.approvals.find(item => item.request.toolVersion === 'fixture-v2');
  assert.ok(versionTwoApproval);
  assert.equal(versionedExecutions, 0);
  const versionedCancelled = await versionedRunner.cancel(versionedPaused.runId);
  assert.equal(versionedCancelled.status, 'cancelled');
  assert.equal(versionedCancelled.snapshot.approvals.find(item => item.id === versionTwoApproval.id).status, 'cancelled');

  let slowStartedResolve;
  const slowStarted = new Promise(resolve => { slowStartedResolve = resolve; });
  const slowTask = createReadyTask(store, 'Cancellation and run lock', [{ id: 'workspace.read', access: 'read' }]);
  const slowRegistry = new ToolRegistry();
  registerTool(slowRegistry, {
    name: 'slow_read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async (_args, context) => {
      slowStartedResolve();
      return new Promise((resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason || new Error('aborted')), { once: true });
      });
    },
  });
  const slowModel = new FixtureModel([modelResponse('', [toolCall('call-slow', 'slow_read', {})])]);
  const slowRunner = new AgentRunner(slowModel, slowRegistry, undefined, store);
  const slowHandle = slowRunner.start({
    taskId: slowTask.id,
    messages: [{ role: 'user', content: 'Start a slow read.' }],
    allowedCapabilities: ['workspace.read'],
  });
  await slowStarted;
  await assert.rejects(slowRunner.resume(slowHandle.run.id), AgentRunBusyError);
  await assert.rejects(
    new AgentRunner(new FixtureModel([]), slowRegistry, undefined, store).resume(slowHandle.run.id),
    AgentRunBusyError,
    'different runner instances must share the same process-wide run lock',
  );
  const cancelled = await slowRunner.cancel(slowHandle.run.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.snapshot.steps.find(step => step.kind === 'tool').status, 'cancelled');

  let replayExecutions = 0;
  const replayTask = createReadyTask(store, 'Uncertain non-idempotent replay', [{ id: 'workspace.write', access: 'write' }]);
  const replayRegistry = new ToolRegistry();
  registerTool(replayRegistry, {
    name: 'side_effect',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'medium',
    approval: 'never',
    execute: async () => {
      replayExecutions += 1;
      return { status: 'completed', summary: 'Side effect complete', content: 'done' };
    },
  });
  const replayCall = toolCall('call-replay', 'side_effect', { value: 'once' });
  const replayModel = new FixtureModel([modelResponse('Replay completed.')]);
  const replayRunner = new AgentRunner(replayModel, replayRegistry, undefined, store);
  let replayRun = replayRunner.create({
    taskId: replayTask.id,
    messages: [{ role: 'user', content: 'Perform one side effect.' }],
    allowedCapabilities: ['workspace.write'],
  });
  replayRun = store.startRun(replayRun.id, replayRun.revision);
  replayRun = store.transitionRun(replayRun.id, 'planning', replayRun.revision);
  const replayState = structuredClone(replayRun.state);
  replayState.round = 1;
  replayState.messages.push({ role: 'assistant', content: '', toolCalls: [replayCall] });
  replayState.pendingBatch = { cursor: 0, calls: [{ call: replayCall, stepId: null }] };
  replayRun = store.checkpointRun(replayRun.id, replayState, replayRun.revision);
  let replayStep = store.appendStep({ runId: replayRun.id, kind: 'tool', title: 'Use side_effect', input: { callId: replayCall.id } });
  replayState.pendingBatch.calls[0].stepId = replayStep.id;
  replayRun = store.checkpointRun(replayRun.id, replayState, replayRun.revision);
  replayRun = store.transitionRun(replayRun.id, 'executing', replayRun.revision);
  replayStep = store.transitionStep(replayStep.id, 'running', replayStep.revision);

  const replayPaused = await replayRunner.resume(replayRun.id);
  assert.equal(replayPaused.status, 'paused');
  const replayApproval = replayPaused.snapshot.approvals.find(item => item.request.kind === 'uncertain_replay');
  assert.ok(replayApproval);
  assert.equal(replayApproval.riskLevel, 'critical');
  assert.equal(replayExecutions, 0);
  store.resolveApproval(replayApproval.id, 'approved', { actor: 'fixture-user', replayConfirmed: true }, replayApproval.revision);
  const replayCompleted = await replayRunner.resume(replayRun.id);
  assert.equal(replayCompleted.status, 'completed');
  assert.equal(replayExecutions, 1);

  let reconstructedExecutions = 0;
  const reconstructedTask = createReadyTask(store, 'Reconstruct completed tool result', [{ id: 'workspace.write', access: 'write' }]);
  const reconstructedRegistry = new ToolRegistry();
  registerTool(reconstructedRegistry, {
    name: 'completed_before_checkpoint',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'medium',
    approval: 'never',
    execute: async () => {
      reconstructedExecutions += 1;
      return { status: 'completed', summary: 'Must not replay', content: '' };
    },
  });
  const reconstructedCall = toolCall('call-reconstructed', 'completed_before_checkpoint', {});
  const reconstructedModel = new FixtureModel([messages => {
    assert.match(messages.at(-1).content, /already completed/);
    return modelResponse('Reconstructed without replay.');
  }]);
  const reconstructedRunner = new AgentRunner(reconstructedModel, reconstructedRegistry, undefined, store);
  let reconstructedRun = reconstructedRunner.create({
    taskId: reconstructedTask.id,
    messages: [{ role: 'user', content: 'Do not replay completed work.' }],
    allowedCapabilities: ['workspace.write'],
  });
  reconstructedRun = store.startRun(reconstructedRun.id, reconstructedRun.revision);
  reconstructedRun = store.transitionRun(reconstructedRun.id, 'planning', reconstructedRun.revision);
  const reconstructedState = structuredClone(reconstructedRun.state);
  reconstructedState.round = 1;
  reconstructedState.messages.push({ role: 'assistant', content: '', toolCalls: [reconstructedCall] });
  reconstructedState.pendingBatch = { cursor: 0, calls: [{ call: reconstructedCall, stepId: null }] };
  reconstructedRun = store.checkpointRun(reconstructedRun.id, reconstructedState, reconstructedRun.revision);
  let reconstructedStep = store.appendStep({ runId: reconstructedRun.id, kind: 'tool', title: 'Use completed_before_checkpoint', input: { callId: reconstructedCall.id } });
  reconstructedState.pendingBatch.calls[0].stepId = reconstructedStep.id;
  reconstructedRun = store.checkpointRun(reconstructedRun.id, reconstructedState, reconstructedRun.revision);
  reconstructedRun = store.transitionRun(reconstructedRun.id, 'executing', reconstructedRun.revision);
  reconstructedStep = store.transitionStep(reconstructedStep.id, 'running', reconstructedStep.revision);
  reconstructedStep = store.transitionStep(reconstructedStep.id, 'completed', reconstructedStep.revision, {
    output: { status: 'completed', summary: 'Already completed', content: 'already completed', attempts: 1 },
  });
  const reconstructed = await reconstructedRunner.resume(reconstructedRun.id);
  assert.equal(reconstructed.status, 'completed');
  assert.equal(reconstructedExecutions, 0, 'terminal tool steps must be reconstructed instead of replayed');

  const corruptTask = createReadyTask(store, 'Fail safely on a corrupt checkpoint', []);
  const corruptRunner = new AgentRunner(new FixtureModel([]), new ToolRegistry(), undefined, store);
  let corruptRun = corruptRunner.create({
    taskId: corruptTask.id,
    messages: [{ role: 'user', content: 'This checkpoint will be corrupted.' }],
    allowedCapabilities: [],
  });
  corruptRun = store.startRun(corruptRun.id, corruptRun.revision);
  store.checkpointRun(corruptRun.id, { invalid: true }, corruptRun.revision);
  const corruptResult = await corruptRunner.resume(corruptRun.id);
  assert.equal(corruptResult.status, 'failed');
  assert.match(corruptResult.error, /checkpoint version/);

  console.log(`ATHENA_AGENT_RUNTIME_OK run=${runId} retries=${flakyAttempts} approvals=${resumed.snapshot.approvals.length} recovery=replay-guarded`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
});
