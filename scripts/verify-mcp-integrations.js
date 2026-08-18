const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-mcp-integrations-'));
const stateFile = path.join(scratch, 'mcp-servers.json');
const fixture = path.join(root, 'scripts', 'fixtures', 'mcp-stdio-server.js');

const { ToolRegistry } = require(path.join(root, 'dist', 'core', 'agent', 'ToolRegistry.js'));
const { McpConfigStore, McpIntegrationHost, describeMcpLaunch } = require(path.join(root, 'dist', 'core', 'integrations'));

(async () => {
  const registry = new ToolRegistry();
  const store = new McpConfigStore(stateFile);
  const host = new McpIntegrationHost(registry, { store, allowExternalNetwork: () => false });
  try {
    let server = await host.upsert({
      name: 'Fixture MCP',
      transport: 'stdio',
      protocolMode: 'legacy',
      stdio: { command: process.execPath, args: [fixture, '  padded argument  '], cwd: root, envKeys: [] },
    });
    assert.equal(server.enabled, false);
    assert.equal(server.approvedFingerprint, null);
    assert.match(describeMcpLaunch(server), /mcp-stdio-server\.js/);
    assert.equal(server.stdio.args[1], '  padded argument  ', 'stdio arguments must preserve approved whitespace exactly');
    assert.throws(() => store.setEnabled(server.id, server.configFingerprint, true), /must be approved/);

    server = await host.approve(server.id, server.configFingerprint, true);
    server = await host.setEnabled(server.id, server.configFingerprint, true);
    let snapshot = await host.connect(server.id);
    assert.equal(snapshot.status, 'connected');
    assert.equal(snapshot.serverName, 'athena-mcp-fixture');
    assert.equal(snapshot.tools.length, 3);
    assert.equal(snapshot.instructions, 'Fixture instructions must remain server-scoped.');

    const read = snapshot.tools.find(tool => tool.name === 'read_fixture');
    const write = snapshot.tools.find(tool => tool.name === 'write_fixture');
    const exit = snapshot.tools.find(tool => tool.name === 'exit_fixture');
    assert(read && write && exit);
    const readResolved = registry.resolve({ id: 'read-1', name: read.registeredName, arguments: { query: 'hello' }, rawArguments: '{}' });
    assert.equal(readResolved.policy.access, 'read');
    assert.equal(readResolved.policy.riskLevel, 'low');
    assert.equal(readResolved.policy.approval, 'never');
    const writeResolved = registry.resolve({ id: 'write-1', name: write.registeredName, arguments: { value: 'x' }, rawArguments: '{}' });
    assert.equal(writeResolved.policy.riskLevel, 'critical');
    assert.equal(writeResolved.policy.approval, 'always');
    const exitResolved = registry.resolve({ id: 'exit-1', name: exit.registeredName, arguments: {}, rawArguments: '{}' });
    assert.equal(exitResolved.policy.riskLevel, 'critical', 'missing annotations must use conservative MCP defaults');
    const result = await registry.executeResolved(
      { id: 'read-1', name: read.registeredName, arguments: { query: 'hello' }, rawArguments: '{}' },
      readResolved,
      { runId: 'run-1', stepId: 'step-1', callId: 'read-1', attempt: 1, idempotencyKey: 'mcp-fixture', signal: new AbortController().signal },
    );
    assert.equal(result.status, 'completed');
    assert.match(result.content, /fixture:hello/);
    assert.match(result.content, /Structured content/);
    await assert.rejects(() => host.remove(server.id, 'a'.repeat(64)), /configuration changed/);
    assert.equal(registry.has(read.registeredName), true, 'a stale mutation request must not disconnect the active server');
    await registry.executeResolved(
      { id: 'exit-1', name: exit.registeredName, arguments: {}, rawArguments: '{}' },
      exitResolved,
      { runId: 'run-1', stepId: 'step-2', callId: 'exit-1', attempt: 1, idempotencyKey: 'mcp-exit', signal: new AbortController().signal },
    );
    await waitFor(() => !registry.has(read.registeredName), 2_000);
    assert.equal(registry.has(write.registeredName), false, 'unexpected process exit must unregister every owned tool');

    const oldFingerprint = server.configFingerprint;
    server = await host.upsert({
      id: server.id,
      name: server.name,
      transport: 'stdio',
      protocolMode: 'legacy',
      stdio: { command: process.execPath, args: [fixture, '--changed'], cwd: root, envKeys: [] },
    });
    assert.notEqual(server.configFingerprint, oldFingerprint);
    assert.equal(server.approvedFingerprint, null);
    assert.equal(server.enabled, false);
    assert.equal(registry.has(read.registeredName), false, 'configuration changes must immediately unregister tools');

    let remote = await host.upsert({
      name: 'Remote MCP',
      transport: 'streamable-http',
      protocolMode: 'auto',
      http: { url: 'https://example.com/mcp', bearerTokenEnv: null },
    });
    remote = await host.approve(remote.id, remote.configFingerprint, true);
    remote = await host.setEnabled(remote.id, remote.configFingerprint, true);
    await assert.rejects(() => host.connect(remote.id), /requires explicit privacy consent/);

    let missingEnv = await host.upsert({
      name: 'Missing Env MCP',
      transport: 'stdio',
      protocolMode: 'legacy',
      stdio: { command: process.execPath, args: [fixture], cwd: root, envKeys: ['ATHENA_TEST_MCP_MISSING'] },
    });
    missingEnv = await host.approve(missingEnv.id, missingEnv.configFingerprint, true);
    missingEnv = await host.setEnabled(missingEnv.id, missingEnv.configFingerprint, true);
    await assert.rejects(() => host.connect(missingEnv.id), /environment variable is not set/);
    assert.doesNotMatch(host.snapshot().servers.find(item => item.id === missingEnv.id).error, /Bearer\s+\S+/i);

    assert.throws(() => store.upsert({ name: 'Unsafe URL', transport: 'streamable-http', http: { url: 'http://example.com/mcp' } }), /require HTTPS/);
    assert.throws(() => store.upsert({ name: 'Inline secret', transport: 'streamable-http', http: { url: 'https://user:secret@example.com/mcp' } }), /cannot contain credentials/);

    const brokenStateFile = path.join(scratch, 'state-is-directory');
    fs.mkdirSync(brokenStateFile);
    const rollbackStore = new McpConfigStore(brokenStateFile);
    assert.throws(() => rollbackStore.upsert({
      name: 'Rollback MCP',
      transport: 'stdio',
      stdio: { command: process.execPath, args: [fixture] },
    }), /real file/);
    assert.equal(rollbackStore.list().length, 0, 'failed state writes must roll back in-memory configuration');

    const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'src', 'app', 'main.ts'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
    for (const channel of ['mcp:list', 'mcp:upsert', 'mcp:approve', 'mcp:setEnabled', 'mcp:connect', 'mcp:disconnect', 'mcp:remove']) {
      assert.ok(ipc.includes(`'${channel}'`), `missing IPC channel ${channel}`);
    }
    assert.match(ipc, /await controller\.shutdown\(\)/, 'IPC disposal must await controller shutdown');
    assert.match(ipc, /args: cleanMcpArgumentList\(stdio\.args/, 'IPC must preserve approved stdio argument whitespace');
    assert.match(main, /app\.on\('will-quit'/, 'Electron quit must coordinate asynchronous integration shutdown');
    assert.match(main, /if \(shutdown\) await withTimeout\(shutdown\(\), 15_000/, 'Electron quit must await the active IPC services with a bounded timeout');
    assert.match(renderer, /argumentLines/, 'renderer must preserve stdio argument whitespace');
    assert.match(renderer, /当前 Windows 用户权限启动以下命令/);
    assert.match(renderer, /批准仅绑定当前配置指纹/);

    await host.remove(remote.id, remote.configFingerprint);
    snapshot = host.snapshot();
    assert.equal(snapshot.servers.some(item => item.id === remote.id), false);
    console.log(`ATHENA_MCP_INTEGRATIONS_OK servers=${snapshot.servers.length} tools=3 trust=content-bound network=consent-gated exit=unregistered`);
  } finally {
    await host.shutdown();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
