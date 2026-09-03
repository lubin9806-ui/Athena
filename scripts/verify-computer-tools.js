const assert = require('assert');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scratch = path.join(root, 'temp', 'computer-tools-verification');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const { ComputerToolService } = require('../dist/core/tools/ComputerTools.js');
const { COMPUTER_TOOL_DEFINITIONS } = require('../dist/core/tools/ComputerToolCatalog.js');
const { LLMClient } = require('../dist/core/ai/Client.js');
const { buildToolArgumentPreview, buildToolConfirmation, requiresComputerAction, ToolRuntime, shouldPlanComputerTools } = require('../dist/core/tools/ToolRuntime.js');
const { toolPermissionPrompt } = require('../dist/core/tools/ComputerTools.js');
const { buildChatPrompt } = require('../dist/core/ai/PromptBuilder.js');
const { getSettingsBundle, normalizeToolSettings, resolveToolSettingsForMode } = require('../dist/core/config/SettingsStore.js');

let serviceForCleanup = null;

function settings(permissionLevel) {
  return {
    permissionLevel,
    modePermissions: {
      create: permissionLevel,
      companion: permissionLevel,
      reason: permissionLevel,
      execute: permissionLevel,
    },
    maxToolRounds: 3,
    commandTimeoutSeconds: 20,
  };
}

async function startHttpServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.url === '/large' ? 'x'.repeat(500_000) : 'ATHENA_PORT_OK');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return { server, port: address.port };
}

async function waitForProcessExit(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

async function verifyExecutionCenterUi() {
  const html = await fs.readFile(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const renderer = await fs.readFile(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'src', 'renderer', 'style.css'), 'utf8');
  const preload = await fs.readFile(path.join(root, 'src', 'app', 'preload.ts'), 'utf8');
  const executionPanelStart = html.indexOf('id="execution-panel"');
  const settingsPanelStart = html.indexOf('id="settings-panel"');
  const permissionControl = html.indexOf('id="setting-tool-permission-execute"');
  assert(executionPanelStart >= 0 && settingsPanelStart > executionPanelStart);
  assert(permissionControl > executionPanelStart && permissionControl < settingsPanelStart, 'tool permissions must live inside the execution center');
  assert(html.includes('id="execution-history"'));
  assert(html.includes('id="execution-stop"'));
  assert(html.includes('id="mode-execute-button"'));
  assert(html.includes('id="settings-open-execution"'));
  assert(renderer.includes('handleExecutionStatus(status)'));
  assert(renderer.includes('finishExecutionTask(response?.toolExecutions ?? [], response?.content || currentContent)'));
  assert(!renderer.includes('chatPanel.setLastAssistantTools('), 'detailed tool cards must not remain inside chat');
  assert(styles.includes('#execution-panel-body'));
  assert(styles.includes('grid-template-columns: repeat(4, 1fr)'));
  assert(preload.includes("cancelExecution: () => ipcRenderer.invoke('execution:cancel')"));
  console.log('ATHENA_EXECUTION_CENTER_UI_OK');
}

async function verifyService() {
  const service = new ComputerToolService();
  serviceForCleanup = service;
  assert.equal(COMPUTER_TOOL_DEFINITIONS.length, 22);
  assert.equal(new Set(COMPUTER_TOOL_DEFINITIONS.map(tool => tool.name)).size, COMPUTER_TOOL_DEFINITIONS.length);
  assert(shouldPlanComputerTools('package.json 里面的 name 是什么？'));
  assert(shouldPlanComputerTools('帮我在 8080 端口启动服务'));
  assert(shouldPlanComputerTools('帮我把桌面上的图片整理放在海报文件夹里'));
  assert(shouldPlanComputerTools('把下载目录里的 PDF 归档到资料文件夹'));
  assert(requiresComputerAction('帮我把桌面上的图片整理放在海报文件夹里'));
  assert(requiresComputerAction('请打开记事本'));
  assert(!shouldPlanComputerTools('今天心情怎么样？'));
  assert(!requiresComputerAction('今天心情怎么样？'));

  const configuredTools = getSettingsBundle().settings.tools;
  const companionTools = resolveToolSettingsForMode(configuredTools, 'companion');
  const createTools = resolveToolSettingsForMode(configuredTools, 'create');
  const reasonTools = resolveToolSettingsForMode(configuredTools, 'reason');
  const executeTools = resolveToolSettingsForMode(configuredTools, 'execute');
  assert.equal(companionTools.permissionLevel, 'off');
  assert.equal(createTools.permissionLevel, 'off');
  assert.equal(reasonTools.permissionLevel, 'off');
  assert.equal(executeTools.permissionLevel, 'off');
  assert.equal(service.getDefinitions(companionTools).length, 0);
  assert.equal(service.getDefinitions(createTools).length, 0);
  assert.equal(service.getDefinitions(reasonTools).length, 0);
  assert.equal(service.getDefinitions(executeTools).length, 0);
  const sensitivePreview = buildToolArgumentPreview({
    url: 'https://preview-user:preview-password@example.com/path',
    headers: {
      Authorization: 'Bearer preview-secret-token',
      Cookie: 'session=preview-secret-cookie',
      Accept: 'application/json',
    },
  });
  assert(sensitivePreview.includes('[REDACTED]'));
  assert(!sensitivePreview.includes('preview-secret-token'));
  assert(!sensitivePreview.includes('preview-secret-cookie'));
  assert(!sensitivePreview.includes('preview-user'));
  assert(!sensitivePreview.includes('preview-password'));
  const migratedOff = normalizeToolSettings({
    permissionLevel: 'off',
    maxToolRounds: 4,
    commandTimeoutSeconds: 60,
  });
  assert.deepEqual(migratedOff.modePermissions, { create: 'off', companion: 'off', reason: 'off', execute: 'off' });
  const migratedPartial = normalizeToolSettings({
    permissionLevel: 'read',
    modePermissions: { companion: 'files' },
    maxToolRounds: 4,
    commandTimeoutSeconds: 60,
  });
  assert.deepEqual(migratedPartial.modePermissions, { create: 'off', companion: 'off', reason: 'off', execute: 'files' });
  const migratedLegacyReason = normalizeToolSettings({
    permissionLevel: 'read',
    modePermissions: { create: 'files', companion: 'read', reason: 'full' },
    maxToolRounds: 4,
    commandTimeoutSeconds: 60,
  });
  assert.deepEqual(migratedLegacyReason.modePermissions, { create: 'off', companion: 'off', reason: 'off', execute: 'full' });
  console.log('ATHENA_TOOL_MODE_MATRIX_OK');
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });

  const readDefinitions = service.getDefinitions(settings('read')).map(item => item.name);
  const fileDefinitions = service.getDefinitions(settings('files')).map(item => item.name);
  const fullDefinitions = service.getDefinitions(settings('full')).map(item => item.name);
  assert(readDefinitions.includes('read_file'));
  assert(!readDefinitions.includes('write_file'));
  assert(fileDefinitions.includes('write_file'));
  assert(fileDefinitions.includes('move_matching_files'));
  assert(!fileDefinitions.includes('run_command'));
  assert(fullDefinitions.includes('run_command'));
  assert.equal(
    buildToolConfirmation('copy_path', 'Copy path', { source: 'a.txt', destination: 'b.txt' }).risk,
    'destructive-file',
    'copy_path defaults to overwrite and must require confirmation unless overwrite=false',
  );
  assert(fullDefinitions.includes('terminal_start'));
  assert(fullDefinitions.includes('terminal_write'));
  assert(fullDefinitions.includes('terminal_read'));
  assert(fullDefinitions.includes('terminal_list'));
  assert(fullDefinitions.includes('terminal_stop'));
  assert(fullDefinitions.includes('http_request'));
  assert(fullDefinitions.includes('check_port'));
  assert.equal(service.getDefinitions(settings('off')).length, 0);

  const packageRead = await service.execute('read_file', {
    path: path.join(root, 'package.json'),
    max_bytes: 4096,
  }, settings('read'));
  assert.equal(packageRead.status, 'completed');
  assert(packageRead.output.includes('"name": "athena"'));

  const deniedWrite = await service.execute('write_file', {
    path: path.join(scratch, 'denied.txt'),
    content: 'should-not-exist',
  }, settings('read'));
  assert.equal(deniedWrite.status, 'denied');

  const target = path.join(scratch, 'roundtrip.txt');
  const write = await service.execute('write_file', {
    path: target,
    content: 'alpha',
  }, settings('files'));
  assert.equal(write.status, 'completed');

  const replace = await service.execute('replace_in_file', {
    path: target,
    old_text: 'alpha',
    new_text: 'beta',
  }, settings('files'));
  assert.equal(replace.status, 'completed');
  assert.equal(await fs.readFile(target, 'utf8'), 'beta');

  const fileSearch = await service.execute('search_files', {
    root: scratch,
    pattern: '*.txt',
  }, settings('read'));
  assert.equal(fileSearch.status, 'completed');
  assert(fileSearch.output.includes('roundtrip.txt'));

  const textSearch = await service.execute('search_text', {
    root: scratch,
    query: 'beta',
    file_pattern: '*.txt',
  }, settings('read'));
  assert.equal(textSearch.status, 'completed');
  assert(textSearch.output.includes('roundtrip.txt:1'));
  assert(textSearch.output.includes('scan_budget_exhausted: false'));

  const batchSource = path.join(scratch, 'batch-source');
  const batchDestination = path.join(batchSource, '海报');
  await fs.mkdir(batchDestination, { recursive: true });
  await fs.writeFile(path.join(batchSource, 'poster.png'), 'new-poster');
  await fs.writeFile(path.join(batchSource, 'photo.JPG'), 'photo');
  await fs.writeFile(path.join(batchSource, 'notes.txt'), 'keep-here');
  await fs.writeFile(path.join(batchDestination, 'poster.png'), 'existing-poster');
  const batchMove = await service.execute('move_matching_files', {
    source_directory: batchSource,
    destination_directory: batchDestination,
    file_type: 'image',
  }, settings('files'));
  assert.equal(batchMove.status, 'completed');
  assert(batchMove.output.includes('moved: 2'));
  assert.equal(await fs.readFile(path.join(batchDestination, 'poster.png'), 'utf8'), 'existing-poster');
  assert.equal(await fs.readFile(path.join(batchDestination, 'poster (2).png'), 'utf8'), 'new-poster');
  assert.equal(await fs.readFile(path.join(batchDestination, 'photo.JPG'), 'utf8'), 'photo');
  assert.equal(await fs.readFile(path.join(batchSource, 'notes.txt'), 'utf8'), 'keep-here');
  await assert.rejects(fs.stat(path.join(batchSource, 'poster.png')));
  const deniedBatchMove = await service.execute('move_matching_files', {
    source_directory: batchSource,
    destination_directory: batchDestination,
    file_type: 'image',
  }, settings('read'));
  assert.equal(deniedBatchMove.status, 'denied');

  const originalUserProfile = process.env.USERPROFILE;
  const knownFolderProfile = path.join(scratch, 'known-folder-profile');
  const knownDesktop = path.join(knownFolderProfile, 'Desktop');
  await fs.mkdir(knownDesktop, { recursive: true });
  process.env.USERPROFILE = knownFolderProfile;
  try {
    const desktopAlias = await service.execute('file_info', { path: '桌面' }, settings('read'));
    assert.equal(desktopAlias.status, 'completed');
    assert(desktopAlias.output.includes(knownDesktop));
  } finally {
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  }

  const protectedDestination = path.join(scratch, 'protected-destination.txt');
  await fs.writeFile(protectedDestination, 'keep-me', 'utf8');
  const failedMove = await service.execute('move_path', {
    source: path.join(scratch, 'missing-source.txt'),
    destination: protectedDestination,
    overwrite: true,
  }, settings('files'));
  assert.equal(failedMove.status, 'failed');
  assert.equal(await fs.readFile(protectedDestination, 'utf8'), 'keep-me');

  const samePathMove = await service.execute('move_path', {
    source: protectedDestination,
    destination: protectedDestination,
    overwrite: true,
  }, settings('files'));
  assert.equal(samePathMove.status, 'failed');
  assert.equal(await fs.readFile(protectedDestination, 'utf8'), 'keep-me');

  const guardedParent = path.join(scratch, 'guarded-parent');
  const guardedSource = path.join(guardedParent, 'source.txt');
  const guardedSibling = path.join(guardedParent, 'sibling.txt');
  await fs.mkdir(guardedParent, { recursive: true });
  await fs.writeFile(guardedSource, 'source-safe', 'utf8');
  await fs.writeFile(guardedSibling, 'sibling-safe', 'utf8');
  const ancestorMove = await service.execute('move_path', {
    source: guardedSource,
    destination: guardedParent,
    overwrite: true,
  }, settings('files'));
  assert.equal(ancestorMove.status, 'failed');
  assert.equal(await fs.readFile(guardedSource, 'utf8'), 'source-safe');
  assert.equal(await fs.readFile(guardedSibling, 'utf8'), 'sibling-safe');

  const expansionTarget = path.join(scratch, 'replace-expansion.txt');
  await fs.writeFile(expansionTarget, 'aa', 'utf8');
  const oversizedReplace = await service.execute('replace_in_file', {
    path: expansionTarget,
    old_text: 'a',
    new_text: 'x'.repeat(1_100_000),
    replace_all: true,
  }, settings('files'));
  assert.equal(oversizedReplace.status, 'failed');
  assert.equal(await fs.readFile(expansionTarget, 'utf8'), 'aa');

  const command = process.platform === 'win32'
    ? 'Write-Output ATHENA_TOOL_COMMAND_OK'
    : 'printf ATHENA_TOOL_COMMAND_OK';
  const commandResult = await service.execute('run_command', { command, cwd: root }, settings('full'));
  assert.equal(commandResult.status, 'completed');
  assert(commandResult.output.includes('ATHENA_TOOL_COMMAND_OK'));

  const terminalStart = await service.execute('terminal_start', {
    shell: 'powershell',
    cwd: root,
    command: 'Write-Output ATHENA_TERMINAL_START_OK',
  }, settings('full'));
  assert.equal(terminalStart.status, 'completed');
  assert(terminalStart.output.includes('ATHENA_TERMINAL_START_OK'), `PowerShell start command was not observed:\n${terminalStart.output}`);
  const sessionId = terminalStart.output.match(/session_id: (term-[^\s]+)/)?.[1];
  assert(sessionId, 'terminal_start did not return a session_id');

  const terminalWrite = await service.execute('terminal_write', {
    session_id: sessionId,
    input: '$AthenaTerminalValue = 42; Write-Output ATHENA_TERMINAL_WRITE_OK',
    wait_ms: 1200,
  }, settings('full'));
  assert.equal(terminalWrite.status, 'completed');
  assert(terminalWrite.output.includes('ATHENA_TERMINAL_WRITE_OK'));

  const terminalState = await service.execute('terminal_write', {
    session_id: sessionId,
    input: 'Write-Output $AthenaTerminalValue',
    wait_ms: 1200,
  }, settings('full'));
  assert.equal(terminalState.status, 'completed');
  assert(/(^|\s)42(\s|$)/.test(terminalState.output), `persistent PowerShell state was not observed:\n${terminalState.output}`);

  await service.execute('terminal_write', {
    session_id: sessionId,
    input: 'Start-Sleep -Milliseconds 700; Write-Output ATHENA_TERMINAL_READ_OK',
    wait_ms: 50,
  }, settings('full'));
  const terminalRead = await service.execute('terminal_read', {
    session_id: sessionId,
    wait_ms: 2500,
  }, settings('full'));
  assert.equal(terminalRead.status, 'completed');
  assert(terminalRead.output.includes('ATHENA_TERMINAL_READ_OK'));

  const terminalList = await service.execute('terminal_list', {}, settings('full'));
  assert.equal(terminalList.status, 'completed');
  assert(terminalList.output.includes(sessionId));

  const terminalStop = await service.execute('terminal_stop', {
    session_id: sessionId,
  }, settings('full'));
  assert.equal(terminalStop.status, 'completed');

  if (process.platform === 'win32') {
    const cmdStart = await service.execute('terminal_start', {
      shell: 'cmd',
      cwd: root,
      command: 'echo ATHENA_CMD_TERMINAL_OK',
    }, settings('full'));
    assert.equal(cmdStart.status, 'completed');
    assert(cmdStart.output.includes('ATHENA_CMD_TERMINAL_OK'));
    const cmdSessionId = cmdStart.output.match(/session_id: (term-[^\s]+)/)?.[1];
    assert(cmdSessionId);
    const cmdStop = await service.execute('terminal_stop', { session_id: cmdSessionId }, settings('full'));
    assert.equal(cmdStop.status, 'completed');
  }

  const revokeStart = await service.execute('terminal_start', {
    shell: 'powershell',
    cwd: root,
    command: 'Write-Output ATHENA_TERMINAL_REVOKE_OK',
  }, settings('full'));
  assert.equal(revokeStart.status, 'completed');
  const revokedSessionId = revokeStart.output.match(/session_id: (term-[^\s]+)/)?.[1];
  const revokedPid = Number(revokeStart.output.match(/pid: (\d+)/)?.[1]);
  assert(revokedSessionId && Number.isInteger(revokedPid));
  service.applyPermissionLevel('read');
  const listAfterRevocation = await service.execute('terminal_list', {}, settings('full'));
  assert.equal(listAfterRevocation.status, 'completed');
  assert(!listAfterRevocation.output.includes(revokedSessionId));
  assert(await waitForProcessExit(revokedPid), `revoked terminal process ${revokedPid} is still running`);

  const credentialUrl = await service.execute('http_request', {
    url: 'http://preview-user:preview-password@127.0.0.1:1/',
  }, settings('full'));
  assert.equal(credentialUrl.status, 'failed');

  const { server, port } = await startHttpServer();
  try {
    const portResult = await service.execute('check_port', {
      host: '127.0.0.1',
      port,
    }, settings('full'));
    assert.equal(portResult.status, 'completed');
    assert(portResult.output.includes('open: true'));

    const httpResult = await service.execute('http_request', {
      url: `http://127.0.0.1:${port}/probe`,
    }, settings('full'));
    assert.equal(httpResult.status, 'completed');
    assert(httpResult.output.includes('ATHENA_PORT_OK'));

    const largeHttpResult = await service.execute('http_request', {
      url: `http://127.0.0.1:${port}/large`,
    }, settings('full'));
    assert.equal(largeHttpResult.status, 'completed');
    assert(largeHttpResult.output.includes('body_truncated: true'));
    assert(largeHttpResult.output.length < 200_000);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  await service.execute('delete_path', { path: target }, settings('files'));
  service.shutdown();
  serviceForCleanup = null;
  await fs.rm(scratch, { recursive: true, force: true });
  console.log('ATHENA_TOOLS_SERVICE_OK');
}

async function verifyRuntimePermissionRevocation() {
  await fs.mkdir(scratch, { recursive: true });
  const forbiddenTarget = path.join(scratch, 'revoked-command-should-not-run.txt');
  await fs.rm(forbiddenTarget, { force: true });

  let releasePlanner;
  let signalPlannerStarted;
  const plannerRelease = new Promise(resolve => { releasePlanner = resolve; });
  const plannerStarted = new Promise(resolve => { signalPlannerStarted = resolve; });
  let planningRound = 0;
  const fakeLlm = {
    contextWindow: 4096,
    chat: async () => '权限已经降低，本轮没有继续执行高权限操作。',
    chatJson: async () => {
      planningRound += 1;
      if (planningRound === 1) {
        signalPlannerStarted();
        await plannerRelease;
        const command = process.platform === 'win32'
          ? `Set-Content -LiteralPath '${forbiddenTarget}' -Value forbidden`
          : `printf forbidden > '${forbiddenTarget}'`;
        return JSON.stringify({
          kind: 'tool',
          content: '',
          calls: [{ name: 'run_command', arguments: { command, cwd: root } }],
        });
      }
      return JSON.stringify({ kind: 'respond', content: '权限已经降低。', calls: [] });
    },
  };

  const runtime = new ToolRuntime(fakeLlm);
  runtime.setPermissionLevel('full');
  try {
    const running = runtime.process({
      messages: [
        { role: 'system', content: 'test' },
        { role: 'user', content: '请使用电脑工具执行一条命令。' },
      ],
      userMessage: '请使用电脑工具执行一条命令。',
      mode: 'execute',
      settings: settings('full'),
    });
    await plannerStarted;
    runtime.setPermissionLevel('read');
    releasePlanner();
    const result = await running;
    assert(result.executions.some(item => item.name === 'run_command' && item.status === 'denied'));
    await assert.rejects(fs.stat(forbiddenTarget));
  } finally {
    runtime.shutdown();
    await fs.rm(scratch, { recursive: true, force: true });
  }
  console.log('ATHENA_TOOL_PERMISSION_REVOCATION_OK');
}

async function verifyNoFakeProgressAndCancellation() {
  let isolatedChatCalls = 0;
  let isolatedPlanCalls = 0;
  const isolationRuntime = new ToolRuntime({
    contextWindow: 4096,
    chat: async () => {
      isolatedChatCalls += 1;
      return '不应调用普通模型。';
    },
    chatJson: async () => {
      isolatedPlanCalls += 1;
      return JSON.stringify({ kind: 'respond', content: '', calls: [] });
    },
  });
  isolationRuntime.setPermissionLevel('full');
  const isolatedMessage = '帮我把桌面上的图片整理放在海报文件夹里';
  const isolatedResult = await isolationRuntime.process({
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: isolatedMessage }],
    userMessage: isolatedMessage,
    mode: 'reason',
    settings: settings('full'),
  });
  assert.equal(isolatedChatCalls, 0);
  assert.equal(isolatedPlanCalls, 0);
  assert.equal(isolatedResult.executions.length, 0);
  assert(isolatedResult.content.includes('切换到“执行”模式'));
  isolationRuntime.shutdown();

  let normalChatCalls = 0;
  let planCalls = 0;
  const promiseLlm = {
    contextWindow: 4096,
    chat: async () => {
      normalChatCalls += 1;
      return '不应该进入普通聊天回退。';
    },
    chatJson: async () => {
      planCalls += 1;
      return JSON.stringify({ kind: 'respond', content: '好的，我来帮你整理，请稍等片刻。', calls: [] });
    },
  };
  const promiseRuntime = new ToolRuntime(promiseLlm);
  promiseRuntime.setPermissionLevel('full');
  const promiseMessage = '帮我把桌面上的图片整理放在海报文件夹里';
  const promiseResult = await promiseRuntime.process({
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: promiseMessage }],
    userMessage: promiseMessage,
    mode: 'execute',
    settings: settings('full'),
  });
  assert.equal(planCalls, 2);
  assert.equal(normalChatCalls, 0);
  assert(promiseResult.content.includes('没有改动任何文件'));
  promiseRuntime.shutdown();

  let releasePlanner;
  let signalPlannerStarted;
  const plannerRelease = new Promise(resolve => { releasePlanner = resolve; });
  const plannerStarted = new Promise(resolve => { signalPlannerStarted = resolve; });
  const cancelLlm = {
    contextWindow: 4096,
    chat: async () => '不应该进入普通聊天。',
    chatJson: async () => {
      signalPlannerStarted();
      await plannerRelease;
      return JSON.stringify({
        kind: 'tool',
        content: '',
        calls: [{ name: 'make_directory', arguments: { path: path.join(scratch, 'cancel-should-not-exist') } }],
      });
    },
  };
  const cancelRuntime = new ToolRuntime(cancelLlm);
  cancelRuntime.setPermissionLevel('full');
  const statuses = [];
  const cancelRunning = cancelRuntime.process({
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: '请创建一个测试文件夹' }],
    userMessage: '请创建一个测试文件夹',
    mode: 'execute',
    settings: settings('full'),
    onStatus: status => statuses.push(status.phase),
  });
  await plannerStarted;
  assert.equal(cancelRuntime.cancelCurrent(), 1);
  releasePlanner();
  const cancelResult = await cancelRunning;
  assert(cancelResult.content.includes('已停止电脑操作'));
  assert.equal(cancelResult.executions.length, 0);
  assert(statuses.includes('cancelled'));
  await assert.rejects(fs.stat(path.join(scratch, 'cancel-should-not-exist')));
  cancelRuntime.shutdown();

  await fs.mkdir(scratch, { recursive: true });
  const confirmationTarget = path.join(scratch, 'confirmation-must-preserve.txt');
  await fs.writeFile(confirmationTarget, 'preserve', 'utf8');
  let confirmationRound = 0;
  let confirmationRequest;
  const confirmationStatuses = [];
  const confirmationRuntime = new ToolRuntime({
    contextWindow: 4096,
    chat: async () => 'confirmation test',
    chatJson: async () => {
      confirmationRound += 1;
      return confirmationRound === 1
        ? JSON.stringify({ kind: 'tool', content: '', calls: [{ name: 'delete_path', arguments: { path: confirmationTarget } }] })
        : JSON.stringify({ kind: 'respond', content: 'cancelled safely', calls: [] });
    },
  });
  confirmationRuntime.setPermissionLevel('full');
  const confirmationResult = await confirmationRuntime.process({
    messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'delete test file' }],
    userMessage: 'delete test file',
    mode: 'execute',
    settings: settings('full'),
    onStatus: status => confirmationStatuses.push(status.phase),
    onConfirm: async request => {
      confirmationRequest = request;
      return false;
    },
  });
  assert.equal(confirmationRequest.risk, 'destructive-file');
  assert(confirmationStatuses.includes('confirming'));
  assert(confirmationStatuses.includes('cancelled'));
  assert(confirmationResult.executions.some(item => item.name === 'delete_path' && item.status === 'denied'));
  assert.equal(await fs.readFile(confirmationTarget, 'utf8'), 'preserve');
  confirmationRuntime.shutdown();
  await fs.rm(scratch, { recursive: true, force: true });
  console.log('ATHENA_TOOL_NO_FAKE_PROGRESS_OK');
  console.log('ATHENA_TOOL_CANCELLATION_OK');
  console.log('ATHENA_TOOL_HIGH_RISK_CONFIRMATION_OK');
  console.log('ATHENA_MODE_TOOL_ISOLATION_OK');
}

async function verifyLiveLoop() {
  const llm = new LLMClient();
  assert(await llm.checkConnection(), 'Ollama is not connected');
  const runtime = new ToolRuntime(llm);
  const userMessage = `请使用电脑工具读取 ${path.join(root, 'package.json')}，然后只告诉我 package name。`;
  const statuses = [];
  const toolSettings = settings('full');
  const messages = buildChatPrompt({
    userMessage,
    recentMessages: [],
    retrievedContext: {
      profileFacts: [],
      relatedEvents: [],
      projectNotes: [],
      recentMessages: [],
    },
    toolContext: toolPermissionPrompt(toolSettings),
    mode: 'execute',
  });
  const result = await runtime.process({
    messages,
    userMessage,
    mode: 'execute',
    settings: toolSettings,
    onStatus: status => statuses.push(status.phase),
  });
  assert(result.executions.some(item => item.name === 'read_file' && item.status === 'completed'));
  assert(/athena/i.test(result.content));
  assert(statuses.includes('planning'));
  assert(statuses.includes('running'));
  assert(statuses.includes('done'));
  runtime.shutdown();
  console.log('ATHENA_TOOLS_LLM_LOOP_OK');

  const organizeRuntime = new ToolRuntime(llm);
  const organizeSource = path.join(scratch, 'live-organize-source');
  const organizeDestination = path.join(scratch, 'live-organize-destination');
  await fs.rm(organizeSource, { recursive: true, force: true });
  await fs.rm(organizeDestination, { recursive: true, force: true });
  await fs.mkdir(organizeSource, { recursive: true });
  await fs.writeFile(path.join(organizeSource, '海报素材.png'), 'image');
  await fs.writeFile(path.join(organizeSource, '说明.txt'), 'text');
  const organizeMessage = `帮我把 ${organizeSource} 里的图片整理放到 ${organizeDestination} 文件夹里。`;
  const organizeMessages = buildChatPrompt({
    userMessage: organizeMessage,
    recentMessages: [],
    retrievedContext: {
      profileFacts: [],
      relatedEvents: [],
      projectNotes: [],
      recentMessages: [],
    },
    toolContext: toolPermissionPrompt(toolSettings),
    mode: 'execute',
  });
  try {
    const organizeResult = await organizeRuntime.process({
      messages: organizeMessages,
      userMessage: organizeMessage,
      mode: 'execute',
      settings: toolSettings,
    });
    assert(organizeResult.executions.some(item => item.status === 'completed'));
    assert.equal(await fs.readFile(path.join(organizeDestination, '海报素材.png'), 'utf8'), 'image');
    assert.equal(await fs.readFile(path.join(organizeSource, '说明.txt'), 'utf8'), 'text');
    console.log('ATHENA_NATURAL_FILE_ORGANIZE_LLM_OK');
  } finally {
    organizeRuntime.shutdown();
    await fs.rm(organizeSource, { recursive: true, force: true });
    await fs.rm(organizeDestination, { recursive: true, force: true });
  }

  const terminalRuntime = new ToolRuntime(llm);
  const terminalMessage = [
    '请严格使用持久终端工具完成测试，不要使用 run_command。',
    '第一步调用 terminal_start 启动 PowerShell 且不要传 command；',
    '拿到 session_id 后调用 terminal_write 写入 Write-Output ATHENA_LLM_TERMINAL_OK；',
    '确认真实输出后调用 terminal_stop 关闭同一个会话，再告诉我结果。',
  ].join('');
  const terminalSettings = { ...settings('full'), maxToolRounds: 5 };
  const terminalMessages = buildChatPrompt({
    userMessage: terminalMessage,
    recentMessages: [],
    retrievedContext: {
      profileFacts: [],
      relatedEvents: [],
      projectNotes: [],
      recentMessages: [],
    },
    toolContext: toolPermissionPrompt(terminalSettings),
    mode: 'execute',
  });
  try {
    const terminalResult = await terminalRuntime.process({
      messages: terminalMessages,
      userMessage: terminalMessage,
      mode: 'execute',
      settings: terminalSettings,
    });
    assert(terminalResult.executions.some(item => item.name === 'terminal_start' && item.status === 'completed'));
    assert(terminalResult.executions.some(item => item.name === 'terminal_write' && item.status === 'completed'));
    assert(terminalResult.executions.some(item => item.name.startsWith('terminal_') && item.outputPreview.includes('ATHENA_LLM_TERMINAL_OK')));
    assert(terminalResult.executions.some(item => item.name === 'terminal_stop' && item.status === 'completed'));
    assert(/ATHENA_LLM_TERMINAL_OK/i.test(terminalResult.content));
    console.log('ATHENA_TERMINAL_LLM_LOOP_OK');
  } finally {
    terminalRuntime.shutdown();
  }
}

(async () => {
  await verifyExecutionCenterUi();
  await verifyService();
  await verifyRuntimePermissionRevocation();
  await verifyNoFakeProgressAndCancellation();
  if (process.argv.includes('--live')) await verifyLiveLoop();
})().catch(async (error) => {
  serviceForCleanup?.shutdown();
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
