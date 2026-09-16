const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-agent-runtime-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'agent-runtime.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const {
  AgentPolicyEngine,
  AgentRunBusyError,
  AgentRunner,
  AgentStore,
  AgentToolRegistrationError,
  AgentToolRetryableError,
  ToolRegistry,
} = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));
const { ComputerAgentToolBridge } = require(path.join(root, 'dist', 'core', 'tools', 'AgentComputerTools.js'));
const { LLMClient } = require(path.join(root, 'dist', 'core', 'ai', 'Client.js'));
const { summarizeAgentToolOutcome } = require(path.join(root, 'dist', 'shared', 'agentVerification.js'));
const { describeAgentToolStep, presentAgentApproval } = require(path.join(root, 'dist', 'shared', 'agentRunPresentation.js'));

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

  // ATH-SEC-010: a write that arranges for code to run later is as risky as running
  // it now, whatever tier allows the write. Checked through the real bridge and
  // policy engine, in both tiers that can write, without touching any of the paths.
  const home = os.homedir();
  const autorunCalls = [
    ['write_file', { path: '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\athena-fixture.cmd', content: 'calc.exe', mode: 'append' }, /启动文件夹/],
    ['write_file', { path: path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'), content: 'Start-Process calc', mode: 'append' }, /PowerShell 配置文件/],
    ['write_file', { path: '~/.bashrc', content: 'calc.exe', mode: 'append' }, /Shell 启动脚本/],
    ['copy_path', { source: path.join(scratch, 'payload.cmd'), destination: '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\payload.cmd', overwrite: false }, /启动文件夹/],
    ['copy_path', { source: path.join(scratch, 'hook'), destination: path.join(scratch, 'repo', '.git', 'hooks', 'pre-commit'), overwrite: false }, /git hooks/],
    ['copy_path', { source: path.join(scratch, 'x.lnk'), destination: path.join(home, 'Desktop', 'Athena fixture.lnk'), overwrite: false }, /快捷方式/],
    ['write_file', { path: path.join(scratch, 'notes.txt'), content: 'one more line', mode: 'append' }, /追加/],
  ];
  const policyEngine = new AgentPolicyEngine();
  for (const tier of ['files', 'full']) {
    const tierRegistry = new ToolRegistry();
    const tierBridge = new ComputerAgentToolBridge({
      registry: tierRegistry,
      getSettings: () => ({ ...bridgeSettings, permissionLevel: tier, modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: tier } }),
    });
    tierBridge.refresh();
    for (const [name, args, explanation] of autorunCalls) {
      const resolved = tierRegistry.resolve(toolCall(`autorun-${tier}-${name}`, name, args));
      assert.equal(resolved.policy.approval, 'always', `${tier}: ${name} ${JSON.stringify(args)} must always ask`);
      assert.match(resolved.policy.reason, explanation);
      const decision = policyEngine.evaluate(resolved.policy, {
        taskSpec: { requiredCapabilities: [{ id: resolved.policy.capability }] },
        allowedCapabilities: [resolved.policy.capability],
        approvalMode: 'risk_based',
      });
      assert.equal(decision.kind, 'approval', `${tier}: ${name} must stop for approval, got ${decision.kind}`);
      assert.doesNotMatch(decision.explanation, /explicit approval is required/, 'the card explanation must not append English');
    }
    // A copy that cannot overwrite anything, into an ordinary folder, still needs no approval.
    const plainCopy = tierRegistry.resolve(toolCall(`plain-copy-${tier}`, 'copy_path', {
      source: path.join(scratch, 'a.txt'), destination: path.join(scratch, 'b.txt'), overwrite: false,
    }));
    assert.equal(plainCopy.policy.approval, 'risk_based');
    tierBridge.shutdown();
  }

  // ATH-SEC-009: what an approval keeps must be enough to decide on it. Terminal input
  // is the command being typed, so it stays readable; secrets inside it do not.
  const displayRegistry = new ToolRegistry();
  const displayBridge = new ComputerAgentToolBridge({ registry: displayRegistry, getSettings: () => ({ ...bridgeSettings, permissionLevel: 'full' }) });
  displayBridge.refresh();
  const terminalWrite = displayRegistry.resolve(toolCall('display-terminal', 'terminal_write', { session_id: 'term-1', input: 'npm publish --token=npm_abcdefghijklmnop' }));
  assert.match(terminalWrite.persistedArguments.input, /^npm publish/, 'terminal input must stay visible for approval');
  assert.doesNotMatch(terminalWrite.persistedArguments.input, /npm_abcdefghijklmnop/, 'secrets inside a command must still be masked');
  const scriptWrite = displayRegistry.resolve(toolCall('display-write', 'write_file', { path: path.join(scratch, 'app.js'), content: 'console.log("hello from fixture")' }));
  assert.match(scriptWrite.persistedArguments.content, /CONTENT_REDACTED chars=33/, 'stored arguments keep only the payload size');
  assert.equal(scriptWrite.approvalPreview.content.text, 'console.log("hello from fixture")', 'the approval preview shows what will be written');
  displayBridge.shutdown();

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
      assert.match(messages.at(-1).content, /flaky_read/);
      assert.match(messages.at(-1).content, /参数不符合要求/);
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
  // The model stopping is not the call succeeding: a run whose only tool call never
  // ran must not read as an ordinary finished run.
  assert.equal(invalidResult.verification, 'issues', 'a run whose only call failed must carry the failure into its verdict');

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
  assert.equal(deniedResult.verification, 'issues', 'a refused call is not a completed one');
  assert.equal(summarizeAgentToolOutcome(deniedResult.snapshot.steps).denied.length, 1);

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

  const verdicts = await verifyRecoveryIdentity(store);
  const outputBudget = await verifyOutputBudget(store);
  const outage = await verifyModelOutageCheckpoint(store);
  const budget = await verifyBudgetGates(store);
  const approvalItems = await verifyApprovalItems(store, bridgeSettings);
  const session = await verifySessionContinuity(store);
  const autoApprove = await verifyAutoApprove(store, bridgeSettings);

  console.log([
    'ATHENA_AGENT_RUNTIME_OK',
    `run=${runId}`,
    `retries=${flakyAttempts}`,
    `approvals=${resumed.snapshot.approvals.length}`,
    'recovery=replay-guarded',
    `verdicts=${verdicts}`,
    `outputBudget=${outputBudget}`,
    `outage=${outage}`,
    `budget=${budget}`,
    `approvalItems=${approvalItems}`,
    `session=${session}`,
    `autoApprove=${autoApprove}`,
  ].join(' '));
}

/**
 * 免审批 stops the questions, not the record - and not every question.
 *
 * A write that arranges for code to run later (a startup folder, a shell
 * profile) still asks, whatever the switch says: that is how malware persists,
 * and the thing that proposed it may be a web page Athena just read
 * (ATH-SEC-010).
 */
async function verifyAutoApprove(store, bridgeSettings) {
  const registry = new ToolRegistry();
  const bridge = new ComputerAgentToolBridge({
    registry,
    getSettings: () => ({ ...bridgeSettings, permissionLevel: 'full', allowExternalNetwork: false }),
  });
  bridge.refresh();
  const target = path.join(scratch, 'auto-approved.txt');
  const startupTarget = '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\athena-fixture.cmd';
  const startupResolved = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'athena-fixture.cmd');
  const capabilities = [{ id: 'computer.files', access: 'write' }];

  let autoApprove = false;
  const runner = new AgentRunner(
    new FixtureModel([
      modelResponse('我把结果写下来。', [toolCall('auto-write', 'write_file', { path: target, content: 'written without asking' })]),
      modelResponse('写好了。'),
    ]),
    registry,
    undefined,
    store,
    { isAutoApproveEnabled: () => autoApprove },
  );
  const asked = await runner.start({
    taskId: createReadyTask(store, 'Ask before writing when approvals are on', capabilities).id,
    messages: [{ role: 'user', content: '把结果写进文件。' }],
    allowedCapabilities: ['computer.files'],
  }).result;
  assert.equal(asked.status, 'paused', 'with approvals on, a write still stops for the person');
  assert.equal(fs.existsSync(target), false, 'nothing may run while the question is open');
  await runner.cancel(asked.runId);

  autoApprove = true;
  const proceeded = await new AgentRunner(
    new FixtureModel([
      modelResponse('我把结果写下来。', [toolCall('auto-write-2', 'write_file', { path: target, content: 'written without asking' })]),
      modelResponse('写好了。'),
    ]),
    registry,
    undefined,
    store,
    { isAutoApproveEnabled: () => autoApprove },
  ).start({
    taskId: createReadyTask(store, 'Write without asking when 免审批 is on', capabilities).id,
    messages: [{ role: 'user', content: '把结果写进文件。' }],
    allowedCapabilities: ['computer.files'],
  }).result;
  assert.equal(proceeded.status, 'completed', '免审批 must not stop for a write it already covers');
  assert.equal(fs.readFileSync(target, 'utf8'), 'written without asking');
  const granted = proceeded.snapshot.approvals.filter(item => item.request.kind === 'tool_call');
  assert.equal(granted.length, 1, 'the call is still recorded as an approval, so the session can show it');
  assert.equal(granted[0].status, 'approved');
  assert.equal(granted[0].decision.actor, 'auto-approve', 'the record must say who let it through');

  const autorun = await new AgentRunner(
    new FixtureModel([
      modelResponse('我把启动脚本放进去。', [toolCall('auto-startup', 'write_file', { path: startupTarget, content: 'calc.exe' })]),
      modelResponse('放好了。'),
    ]),
    registry,
    undefined,
    store,
    { isAutoApproveEnabled: () => autoApprove },
  ).start({
    taskId: createReadyTask(store, 'Keep asking before code that runs later', capabilities).id,
    messages: [{ role: 'user', content: '开机的时候自动跑一下。' }],
    allowedCapabilities: ['computer.files'],
  }).result;
  assert.equal(autorun.status, 'paused', '免审批 must not cover a write that schedules code to run later');
  const pending = autorun.snapshot.approvals.find(item => item.status === 'pending');
  assert.ok(pending, 'the startup write must still have a question waiting');
  assert.match(String(pending.request.explanation || ''), /启动文件夹/);
  assert.equal(fs.existsSync(startupResolved), false, 'the startup write must not have happened');
  await new AgentRunner(new FixtureModel([]), registry, undefined, store).cancel(autorun.runId);
  bridge.shutdown();
  return 'asks-when-off,writes-when-on,records-who-allowed,autorun-still-asks';
}

/**
 * ATH-EXEC-006: one chat window is one session.
 *
 * Writing to a run that is waiting used to start a second task with none of the
 * first one's context, so the API key Athena had just asked for arrived as a
 * brand-new request. A message now joins the run it was written to: a driving
 * run reads it before its next model round, and a waiting run treats it as the
 * answer to what it was waiting on.
 */
async function verifySessionContinuity(store) {
  const registry = new ToolRegistry();
  let downloads = 0;
  registerTool(registry, {
    name: 'download_model',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'high',
    approval: 'always',
    execute: async () => {
      downloads += 1;
      return { status: 'completed', summary: 'Downloaded', content: '6.46 GB' };
    },
  });

  const waitingTask = createReadyTask(store, 'Answer a waiting run by writing to it', [{ id: 'workspace.write', access: 'write' }]);
  let afterMessage = null;
  const waitingModel = new FixtureModel([
    modelResponse('这个模型要 6.46 GB，我开始下。', [toolCall('call-download', 'download_model', { url: 'https://example.com/model' })]),
    messages => {
      afterMessage = structuredClone(messages);
      return modelResponse('好，那就先不下，我去看文件夹。');
    },
  ]);
  const waitingRunner = new AgentRunner(waitingModel, registry, undefined, store, { modelRetryDelayMs: 1 });
  const paused = await waitingRunner.start({
    taskId: waitingTask.id,
    messages: [{ role: 'user', content: '把模型下到 ComfyUI。' }],
    allowedCapabilities: ['workspace.write'],
    session: { chatWindowId: 7, lastChatMessageId: 41 },
  }).result;
  assert.equal(paused.status, 'paused');
  assert.equal(paused.snapshot.run.state.session.ownStart, 0, 'the run must record where its own messages start');
  const pendingApproval = paused.snapshot.approvals.find(item => item.status === 'pending');
  assert.ok(pendingApproval);

  const submitted = waitingRunner.submitUserMessage(paused.runId, {
    content: '等一下，先别下，看看文件夹里有没有。',
    chatMessageId: 42,
  });
  assert.equal(submitted.outcome, 'resumed', 'a waiting run continues rather than spawning a second task');
  const continued = await submitted.result;
  assert.equal(continued.runId, paused.runId, 'the reply stays in the same run');
  assert.equal(continued.status, 'completed');
  assert.equal(downloads, 0, 'writing instead of approving must not run the waiting call');
  const decided = store.getApproval(pendingApproval.id);
  assert.equal(decided.status, 'denied');
  assert.equal(decided.decision.scope, 'superseded-by-message');
  const supersededResult = afterMessage.find(message => message.role === 'tool' && message.toolCallId === 'call-download');
  assert.match(supersededResult.content, /发来了新消息/, 'the model must be told why the call did not run');
  assert.equal(afterMessage.at(-1).role, 'user');
  assert.equal(afterMessage.at(-1).content, '等一下，先别下，看看文件夹里有没有。');
  assert.equal(
    store.getRun(continued.runId).state.session.lastChatMessageId,
    42,
    'the run must remember the newest chat message it has read',
  );

  // A message written while the run is mid-round joins before the next model call.
  const queuedRegistry = new ToolRegistry();
  let queuedRunner = null;
  let queuedRunId = null;
  let queuedOutcome = null;
  registerTool(queuedRegistry, {
    name: 'slow_read',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => {
      queuedOutcome = queuedRunner.submitUserMessage(queuedRunId, { content: '顺便把结果存成 txt。', chatMessageId: 43 });
      return { status: 'completed', summary: 'Read', content: 'two files' };
    },
  });
  let secondRound = null;
  const queuedModel = new FixtureModel([
    modelResponse('我先看看文件夹。', [toolCall('call-read', 'slow_read', { query: 'checkpoints' })]),
    messages => {
      secondRound = structuredClone(messages);
      return modelResponse('看完了，也按你说的存了。');
    },
  ]);
  queuedRunner = new AgentRunner(queuedModel, queuedRegistry, undefined, store, { modelRetryDelayMs: 1 });
  const queuedHandle = queuedRunner.start({
    taskId: createReadyTask(store, 'Read a message written mid-run', [{ id: 'workspace.read', access: 'read' }]).id,
    messages: [{ role: 'user', content: '看看 checkpoints 文件夹。' }],
    allowedCapabilities: ['workspace.read'],
    session: { chatWindowId: 7, lastChatMessageId: 42 },
  });
  queuedRunId = queuedHandle.run.id;
  const queued = await queuedHandle.result;
  assert.equal(queuedOutcome.outcome, 'queued', 'a driving run takes the message without being restarted');
  assert.equal(queued.status, 'completed');
  assert.equal(secondRound.at(-1).content, '顺便把结果存成 txt。', 'the queued message must reach the next model round');
  assert.equal(queuedRunner.unreadSessionMessages(queued.runId).length, 0, 'a message the run read must not be repeated as a new turn');
  assert.equal(
    queuedRunner.submitUserMessage(queued.runId, { content: '再来一条。' }).outcome,
    'terminal',
    'a finished run hands the next message back to the caller',
  );
  assert.equal(queuedRunner.unreadSessionMessages(queued.runId).length, 0, 'a message a finished run refused must not be recorded against it');

  // The narrow race: the message lands after the last inbox check but before the
  // run ends. It is still the window's message, so the next turn starts with it.
  store.appendEvent(queued.runId, 'session.user_message', { content: '刚才那个存哪了？', chatMessageId: 44 });
  assert.deepEqual(
    queuedRunner.unreadSessionMessages(queued.runId).map(item => item.content),
    ['刚才那个存哪了？'],
    'a message that arrived as the run ended must be handed to the next turn',
  );
  return 'waiting-resumes,mid-run-queues,finished-hands-back';
}

/**
 * A failed call counts as recovered only when the same call later succeeds: that is
 * a fix-and-rerun loop. A failure the run simply moved past stays on the record.
 */
async function verifyRecoveryIdentity(store) {
  const attempts = {};
  const registry = new ToolRegistry();
  registerTool(registry, {
    name: 'run_check',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'medium',
    approval: 'never',
    execute: async ({ target }) => {
      attempts[target] = (attempts[target] || 0) + 1;
      return attempts[target] === 1 && target !== 'other'
        ? { status: 'failed', summary: `check ${target} failed (exit 1)`, content: '1 failing' }
        : { status: 'completed', summary: `check ${target} passed`, content: 'ok' };
    },
  });
  const capabilities = [{ id: 'workspace.write', access: 'write' }];

  const rerun = await new AgentRunner(new FixtureModel([
    modelResponse('', [toolCall('check-1', 'run_check', { target: 'suite' })]),
    modelResponse('', [toolCall('check-2', 'run_check', { target: 'suite' })]),
    modelResponse('All green.'),
  ]), registry, undefined, store).start({
    taskId: createReadyTask(store, 'Fix and rerun until the check passes', capabilities).id,
    messages: [{ role: 'user', content: 'Run the suite until it passes.' }],
    allowedCapabilities: ['workspace.write'],
  }).result;
  assert.equal(rerun.status, 'completed');
  assert.equal(rerun.verification, 'unverified', 'a failure redone successfully is not an open issue');
  const rerunOutcome = summarizeAgentToolOutcome(rerun.snapshot.steps);
  assert.equal(rerunOutcome.recovered, 1);
  assert.equal(rerunOutcome.failed.length, 0);

  const abandoned = await new AgentRunner(new FixtureModel([
    modelResponse('', [toolCall('check-3', 'run_check', { target: 'lint' })]),
    modelResponse('', [toolCall('check-4', 'run_check', { target: 'other' })]),
    modelResponse('Moved on.'),
  ]), registry, undefined, store).start({
    taskId: createReadyTask(store, 'Move past a failing check', capabilities).id,
    messages: [{ role: 'user', content: 'Run the checks.' }],
    allowedCapabilities: ['workspace.write'],
  }).result;
  assert.equal(abandoned.status, 'completed');
  assert.equal(abandoned.verification, 'issues', 'a failure nobody redid must stay visible after other work succeeds');
  const abandonedOutcome = summarizeAgentToolOutcome(abandoned.snapshot.steps);
  assert.equal(abandonedOutcome.failed.length, 1);
  assert.equal(describeAgentToolStep(abandonedOutcome.failed[0]), 'run_check · lint');
  assert.equal(abandoned.snapshot.steps.find(step => step.kind === 'tool').input.toolLabel, 'run_check', 'steps carry the tool label');
  return 'rerun-recovered,abandoned-kept';
}

/**
 * 2026-09-15 live run: with the chat reply budget (2048) DeepSeek's write_file
 * arguments stopped mid-string on every retry, because a reasoning model spends the
 * budget thinking first. The fixture answers from the budget the request actually
 * asks for, through the real adapter.
 */
async function verifyOutputBudget(store) {
  const noteRegistry = () => {
    const registry = new ToolRegistry();
    registerTool(registry, {
      name: 'save_note',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      idempotent: false,
      capability: 'workspace.write',
      access: 'write',
      riskLevel: 'medium',
      approval: 'never',
      execute: async ({ text }) => ({ status: 'completed', summary: `saved ${text.length} chars`, content: 'ok' }),
    });
    return registry;
  };
  const writeCapability = [{ id: 'workspace.write', access: 'write' }];
  const truncatedCall = { role: 'assistant', content: null, tool_calls: [{ id: 'call-note', type: 'function', function: { name: 'save_note', arguments: '{"text":"a long file that stops he' } }] };
  const cutReply = (res, message) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'cut', model: 'fixture-model', choices: [{ index: 0, message, finish_reason: 'length' }] }));
  };
  // DeepSeek-shaped, as in the live run: the budget travels as `max_tokens`.
  const configured = baseUrl => new LLMClient({
    provider: 'deepseek',
    remote: { deepseek: { baseUrl, model: 'fixture-model', temperature: 0.2, maxTokens: 2048, numCtx: 8192 } },
    fallback: { timeoutMs: 5_000 },
  }, () => 'sk-fixture');

  // Too small at first: raised, and later rounds start from the budget that worked.
  const raising = await startModelServer(({ req, res }) => {
    const body = raising.requests.at(-1);
    const hasResult = body.messages.some(message => message.role === 'tool');
    if (body.max_tokens < 16_384) return cutReply(res, truncatedCall);
    if (!hasResult) {
      return sendCompletion(res, { role: 'assistant', content: null, tool_calls: [{ id: 'call-note', type: 'function', function: { name: 'save_note', arguments: '{"text":"a long file that stops here no more"}' } }] });
    }
    return sendCompletion(res, { role: 'assistant', content: 'Saved the note.' });
  });
  try {
    const raised = await new AgentRunner(configured(raising.url), noteRegistry(), undefined, store, { modelRetryDelayMs: 1 }).start({
      taskId: createReadyTask(store, 'Raise the output budget for a long tool call', writeCapability).id,
      messages: [{ role: 'user', content: 'Save a long note.' }],
      allowedCapabilities: ['workspace.write'],
    }).result;
    assert.equal(raised.status, 'completed', `${raised.status}: ${raised.error}`);
    assert.deepEqual(raising.requests.map(body => body.max_tokens), [8_192, 16_384, 16_384],
      'execution must start above the chat budget, raise on a cut-off, and keep the raised budget');
    assert.equal(raised.snapshot.run.state.outputTokens, 16_384);
    assert(raised.snapshot.events.some(event => event.type === 'runner.model_output_budget_raised' && event.payload.from === 8_192 && event.payload.to === 16_384));
    assert.equal(raised.snapshot.approvals.length, 0, 'a raised budget that works needs no decision');
  } finally {
    await raising.close();
  }

  // A provider that refuses the larger budget: back to the configured one, once.
  const capped = await startModelServer(({ res }) => {
    const body = capped.requests.at(-1);
    if (body.max_tokens > 2_048) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Invalid max_tokens value, the valid range of max_tokens is [1, 2048]` } }));
      return;
    }
    sendCompletion(res, { role: 'assistant', content: 'Answered within the configured budget.' });
  });
  try {
    const lowered = await new AgentRunner(configured(capped.url), noteRegistry(), undefined, store, { modelRetryDelayMs: 1 }).start({
      taskId: createReadyTask(store, 'Fall back when the provider caps output', writeCapability).id,
      messages: [{ role: 'user', content: 'Answer.' }],
      allowedCapabilities: ['workspace.write'],
    }).result;
    assert.equal(lowered.status, 'completed', `${lowered.status}: ${lowered.error}`);
    assert.deepEqual(capped.requests.map(body => body.max_tokens), [8_192, 2_048]);
    assert(lowered.snapshot.events.some(event => event.type === 'runner.model_output_budget_lowered'));
  } finally {
    await capped.close();
  }

  // Cut off even at the ceiling: the run stops at its checkpoint and says why.
  const endless = await startModelServer(({ res }) => cutReply(res, truncatedCall));
  try {
    const exhausted = await new AgentRunner(configured(endless.url), noteRegistry(), undefined, store, { modelRetryDelayMs: 1 }).start({
      taskId: createReadyTask(store, 'Stop when no budget is enough', writeCapability).id,
      messages: [{ role: 'user', content: 'Save an enormous note.' }],
      allowedCapabilities: ['workspace.write'],
    }).result;
    assert.equal(exhausted.status, 'paused');
    assert.deepEqual(endless.requests.map(body => body.max_tokens), [8_192, 16_384, 32_768]);
    const gate = exhausted.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'model_retry');
    assert.equal(gate.request.failure.code, 'model.output_truncated');
    const view = presentAgentApproval(gate);
    assert.equal(view.title, '模型的输出无法执行，任务已暂停', 'a cut-off is not reported as the service going down');
  } finally {
    await endless.close();
  }
  return 'raised-and-kept,lowered-on-rejection,exhausted-parked';
}

/**
 * The 2026-09-14 "fetch failed" runs ended in `failed` with nothing but that string:
 * the cause was gone and the work could only be started over. Real sockets are
 * dropped here, so the errors are the ones fetch actually throws.
 */
async function verifyModelOutageCheckpoint(store) {
  let progressWrites = 0;
  const registry = new ToolRegistry();
  registerTool(registry, {
    name: 'record_progress',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false },
    idempotent: false,
    capability: 'workspace.write',
    access: 'write',
    riskLevel: 'medium',
    approval: 'never',
    execute: async () => {
      progressWrites += 1;
      return { status: 'completed', summary: 'Progress recorded', content: 'saved' };
    },
  });
  const dropping = await startModelServer(({ req, res, index }) => {
    if (index === 1) {
      return sendCompletion(res, {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-progress', type: 'function', function: { name: 'record_progress', arguments: '{"note":"step one"}' } }],
      });
    }
    if (index <= 4) return req.socket.destroy();
    return sendCompletion(res, { role: 'assistant', content: 'Finished after the outage.' });
  });
  try {
    const runner = new AgentRunner(fixtureClient(dropping.url), registry, undefined, store, { modelRetryDelayMs: 1 });
    const parked = await runner.start({
      taskId: createReadyTask(store, 'Survive a dropped model connection', [{ id: 'workspace.write', access: 'write' }]).id,
      messages: [{ role: 'user', content: 'Record progress, then finish.' }],
      allowedCapabilities: ['workspace.write'],
    }).result;
    assert.equal(parked.status, 'paused', 'a dropped connection must pause the run at its checkpoint, not end it');
    assert.equal(parked.snapshot.run.phase, 'awaiting_approval');
    assert.equal(parked.snapshot.task.status, 'blocked');
    assert.equal(dropping.requests.length, 4, 'one good round, then three attempts at the next');
    const retries = parked.snapshot.events.filter(event => event.type === 'runner.model_retry_scheduled');
    assert.equal(retries.length, 2);
    assert(retries.every(event => event.payload.failureCode === 'model.connection.reset'), JSON.stringify(retries.map(event => event.payload)));
    const gate = parked.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'model_retry');
    assert(gate, 'the outage must be waiting on a decision');
    assert.equal(gate.request.failure.code, 'model.connection.reset');
    assert.match(gate.request.failure.detail, /fetch failed.*UND_ERR_SOCKET/, 'the transport cause must be kept, not just "fetch failed"');
    assert.doesNotMatch(gate.request.failure.message, /fetch failed|UND_ERR|socket/i, 'the person-facing reason is written for a person');
    assert.equal(gate.request.completedToolSteps, 1);
    assert.equal(parked.failure.code, 'model.connection.reset');
    const failedModelStep = parked.snapshot.steps.filter(step => step.kind === 'model').at(-1);
    assert.equal(failedModelStep.status, 'failed');
    assert.match(failedModelStep.error, /UND_ERR_SOCKET/);
    const view = presentAgentApproval(gate);
    assert.equal(view.kind, 'model_retry');
    assert.equal(view.approveLabel, '从检查点重试');
    assert(view.fields.some(field => field.label === '已保留的进度' && /1 个工具步骤/.test(field.value)), JSON.stringify(view.fields));

    store.resolveApproval(gate.id, 'approved', { actor: 'fixture-user' }, gate.revision);
    const recovered = await runner.resume(parked.runId);
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.content, 'Finished after the outage.');
    assert.equal(progressWrites, 1, 'work done before the outage must not be redone');
    assert(dropping.requests.at(-1).messages.some(message => message.role === 'tool' && /Progress recorded/.test(message.content)),
      'the retried request must carry the checkpointed tool result');
  } finally {
    await dropping.close();
  }

  const refusedPort = await closedPort();
  const refusedRunner = new AgentRunner(fixtureClient(`http://127.0.0.1:${refusedPort}/v1`), new ToolRegistry(), undefined, store, { modelRetryDelayMs: 1 });
  const refusedParked = await refusedRunner.start({
    taskId: createReadyTask(store, 'Decline to retry an unreachable model', []).id,
    messages: [{ role: 'user', content: 'Answer.' }],
    allowedCapabilities: [],
  }).result;
  assert.equal(refusedParked.status, 'paused');
  const refusedGate = refusedParked.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'model_retry');
  assert.equal(refusedGate.request.failure.code, 'model.connection.refused');
  store.resolveApproval(refusedGate.id, 'denied', { actor: 'fixture-user' }, refusedGate.revision);
  const ended = await refusedRunner.resume(refusedParked.runId);
  assert.equal(ended.status, 'failed');
  assert.equal(ended.failure.code, 'model.connection.refused', 'the recorded classification survives the run ending');
  assert.match(ended.failure.message, /拒绝了连接/);
  assert.match(ended.error, /ECONNREFUSED/);

  // Rejected credentials will not fix themselves between attempts: ask at once.
  const rejecting = await startModelServer(({ res }) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid' } }));
  });
  try {
    const authParked = await new AgentRunner(fixtureClient(rejecting.url), new ToolRegistry(), undefined, store, { modelRetryDelayMs: 1 }).start({
      taskId: createReadyTask(store, 'Stop retrying rejected credentials', []).id,
      messages: [{ role: 'user', content: 'Answer.' }],
      allowedCapabilities: [],
    }).result;
    assert.equal(authParked.status, 'paused');
    assert.equal(rejecting.requests.length, 1, 'a rejected key must not be retried automatically');
    assert.equal(authParked.failure.kind, 'auth');
  } finally {
    await rejecting.close();
  }
  return 'reset-parked-resumed,refused-denied-failed,auth-no-retry';
}

/** Reaching the round or tool-call budget pauses and asks; declining still gets an honest summary. */
async function verifyBudgetGates(store) {
  let ticks = 0;
  const registry = new ToolRegistry();
  registerTool(registry, {
    name: 'tick',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    idempotent: true,
    capability: 'workspace.read',
    access: 'read',
    riskLevel: 'low',
    approval: 'never',
    execute: async () => ({ status: 'completed', summary: 'tick', content: String(++ticks) }),
  });
  const read = [{ id: 'workspace.read', access: 'read' }];

  const loopModel = new FixtureModel([
    ...[0, 1, 2, 3].map(index => modelResponse('', [toolCall(`tick-${index}`, 'tick', {})])),
    (messages, _tools, options) => {
      assert.equal(options.toolChoice, 'none', 'the closing summary may not call tools');
      assert.match(messages.at(-1).content, /执行预算已经用完/);
      return modelResponse('Summary: ticked four times, stopped by choice.');
    },
  ]);
  const loopRunner = new AgentRunner(loopModel, registry, undefined, store, { maxModelRounds: 2, maxToolCalls: 32 });
  const firstPause = await loopRunner.start({
    taskId: createReadyTask(store, 'Pause at the round budget', read).id,
    messages: [{ role: 'user', content: 'Keep ticking.' }],
    allowedCapabilities: ['workspace.read'],
  }).result;
  assert.equal(firstPause.status, 'paused', 'the round budget must pause, not fail');
  const firstGate = firstPause.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'budget_extension');
  assert.equal(firstGate.request.reason, 'model_rounds');
  assert.deepEqual(firstGate.request.used, { modelRounds: 2, toolCalls: 2 });
  assert.equal(ticks, 2);
  store.resolveApproval(firstGate.id, 'approved', { actor: 'fixture-user' }, firstGate.revision);
  const secondPause = await loopRunner.resume(firstPause.runId);
  assert.equal(secondPause.status, 'paused');
  const secondGate = secondPause.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'budget_extension');
  assert.deepEqual(secondGate.request.used, { modelRounds: 4, toolCalls: 4 }, 'an approval extends the budget by one more window');
  store.resolveApproval(secondGate.id, 'denied', { actor: 'fixture-user' }, secondGate.revision);
  const summarized = await loopRunner.resume(firstPause.runId);
  assert.equal(summarized.status, 'completed');
  assert.equal(summarized.content, 'Summary: ticked four times, stopped by choice.');
  assert.equal(ticks, 4);
  assert.equal(summarized.snapshot.steps.filter(step => step.kind === 'model').at(-1).input.closing, true);

  const burstModel = new FixtureModel([
    modelResponse('', ['burst-1', 'burst-2', 'burst-3'].map(id => toolCall(id, 'tick', {}))),
    (messages, _tools, options) => {
      assert.equal(options.toolChoice, 'none');
      assert.deepEqual(messages.filter(message => message.role === 'tool').map(message => message.toolCallId), ['burst-1', 'burst-2', 'burst-3'],
        'every proposed call must be answered before the summary');
      return modelResponse('Stopped before running the burst.');
    },
  ]);
  const burstRunner = new AgentRunner(burstModel, registry, undefined, store, { maxToolCalls: 2 });
  const burstPause = await burstRunner.start({
    taskId: createReadyTask(store, 'Pause at the tool-call budget', read).id,
    messages: [{ role: 'user', content: 'Tick three times at once.' }],
    allowedCapabilities: ['workspace.read'],
  }).result;
  assert.equal(burstPause.status, 'paused');
  const burstGate = burstPause.snapshot.approvals.find(item => item.status === 'pending' && item.request.kind === 'budget_extension');
  assert.equal(burstGate.request.reason, 'tool_calls');
  assert.equal(burstGate.request.pendingToolCalls, 3);
  const ticksBeforeBurst = ticks;
  store.resolveApproval(burstGate.id, 'denied', { actor: 'fixture-user' }, burstGate.revision);
  const burstEnded = await burstRunner.resume(burstPause.runId);
  assert.equal(burstEnded.status, 'completed');
  assert.equal(ticks, ticksBeforeBurst, 'declined calls must not run');
  assert.equal(burstEnded.verification, 'issues', 'calls that never ran are part of the verdict');
  assert.equal(summarizeAgentToolOutcome(burstEnded.snapshot.steps).denied.length, 3);
  return 'rounds-extended-then-summarized,tool-calls-declined';
}

/**
 * Approvals written by the real computer-tool bridge, read back through the card's
 * view model, then decided one by one. The card used to print tool names only and
 * approve the whole group with one click (ATH-SEC-009).
 */
async function verifyApprovalItems(store, bridgeSettings) {
  const registry = new ToolRegistry();
  const bridge = new ComputerAgentToolBridge({
    registry,
    getSettings: () => ({ ...bridgeSettings, permissionLevel: 'full', allowExternalNetwork: false }),
  });
  bridge.refresh();
  const target = path.join(scratch, 'approved-write.txt');
  const task = createReadyTask(store, 'Decide approvals one at a time', [
    { id: 'computer.files', access: 'write' },
    { id: 'computer.execute', access: 'execute' },
  ]);
  const model = new FixtureModel([
    modelResponse('', [
      toolCall('item-command', 'run_command', { command: 'Remove-Item -Recurse C:\\important; $env:API_KEY="sk-live-0123456789abcdef"' }),
      toolCall('item-write', 'write_file', { path: target, content: 'written after approval' }),
      toolCall('item-http', 'http_request', { url: 'https://example.com/upload' }),
    ]),
    modelResponse('Done with what was allowed.'),
  ]);
  const runner = new AgentRunner(model, registry, undefined, store);
  const paused = await runner.start({
    taskId: task.id,
    messages: [{ role: 'user', content: 'Clean up, write the file, upload.' }],
    allowedCapabilities: ['computer.files', 'computer.execute'],
  }).result;
  assert.equal(paused.status, 'paused');
  const pending = paused.snapshot.approvals.filter(item => item.status === 'pending');
  assert.equal(pending.length, 3);
  // Written within one second: the card must still list them in the order they run.
  assert.deepEqual(pending.map(item => item.request.toolName), ['run_command', 'write_file', 'http_request'], 'approvals must keep proposal order');
  // Three items can come back in order by luck; eight written in one burst cannot.
  let orderRun = store.createRun({ taskId: createReadyTask(store, 'Keep approval order', []).id });
  orderRun = store.startRun(orderRun.id, orderRun.revision);
  orderRun = store.transitionRun(orderRun.id, 'planning', orderRun.revision);
  for (let index = 0; index < 8; index += 1) {
    store.requestApproval({ runId: orderRun.id, capability: 'workspace.write', riskLevel: 'high', request: { kind: 'tool_call', index } }, store.getRun(orderRun.id).revision);
  }
  assert.deepEqual(store.listApprovals(orderRun.id).map(item => item.request.index), [0, 1, 2, 3, 4, 5, 6, 7], 'a burst of approvals must list in insertion order');
  const byTool = Object.fromEntries(pending.map(item => [item.request.toolName, item]));
  const commandView = presentAgentApproval(byTool.run_command);
  assert.equal(commandView.title, '执行命令');
  assert.equal(commandView.riskLabel, '高风险');
  const commandField = commandView.fields.find(field => field.label === '命令');
  assert(commandField && commandField.code, JSON.stringify(commandView.fields));
  assert.match(commandField.value, /Remove-Item -Recurse C:\\important/, 'the card must show the exact command');
  assert.doesNotMatch(commandField.value, /sk-live-0123456789abcdef/, 'secrets in the command stay masked');
  assert(commandView.fields.some(field => field.label === '工作目录' && /主目录/.test(field.value)), 'a missing cwd must be stated');
  assert.doesNotMatch(commandView.explanation, /[a-z]{4,} [a-z]{4,} [a-z]{4,}/i, `explanation must not be English: ${commandView.explanation}`);
  const writeView = presentAgentApproval(byTool.write_file);
  assert(writeView.fields.some(field => field.label === '路径' && field.value === target));
  assert(writeView.fields.some(field => field.label === '写入内容' && field.value === 'written after approval'), JSON.stringify(writeView.fields));
  assert(writeView.fields.some(field => field.label === '写入方式' && /覆盖/.test(field.value)));
  const httpView = presentAgentApproval(byTool.http_request);
  assert(httpView.fields.some(field => field.label === '地址' && field.value === 'https://example.com/upload'));
  assert(httpView.fields.some(field => field.label === '请求方法' && /GET/.test(field.value)));

  // Decide each item on its own: the run stays paused until nothing is pending.
  for (const [tool, decision] of [['run_command', 'denied'], ['write_file', 'approved'], ['http_request', 'denied']]) {
    const approval = store.getApproval(byTool[tool].id);
    store.resolveApproval(approval.id, decision, { actor: 'fixture-user', scope: 'approval-item' }, approval.revision);
  }
  const finished = await runner.resume(paused.runId);
  assert.equal(finished.status, 'completed');
  assert.equal(fs.readFileSync(target, 'utf8'), 'written after approval', 'the approved item must run');
  const toolSteps = finished.snapshot.steps.filter(step => step.kind === 'tool');
  assert.equal(toolSteps.find(step => step.input.toolName === 'run_command').status, 'skipped', 'the denied command must not run');
  assert.equal(toolSteps.find(step => step.input.toolName === 'write_file').status, 'completed');
  assert.equal(finished.verification, 'issues');
  bridge.shutdown();
  return 'command-write-http-mixed';
}

function fixtureClient(baseUrl) {
  return new LLMClient({
    provider: 'openai',
    remote: { openai: { baseUrl, model: 'fixture-model', temperature: 0.2, maxTokens: 512, numCtx: 8192 } },
    fallback: { timeoutMs: 5_000 },
  }, () => 'sk-fixture');
}

function startModelServer(handler) {
  return new Promise(resolve => {
    const requests = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push(body ? JSON.parse(body) : {});
        handler({ req, res, index: requests.length });
      });
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/v1`,
      requests,
      close: () => new Promise(done => {
        for (const socket of sockets) socket.destroy();
        server.close(done);
      }),
    }));
  });
}

function sendCompletion(res, message) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 'fixture-completion',
    model: 'fixture-model',
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
}

function closedPort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
});
