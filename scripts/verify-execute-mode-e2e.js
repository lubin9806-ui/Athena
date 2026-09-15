/**
 * Execute mode, end to end, operated the way a person operates it.
 *
 * Launches the real app (dev build, or `--app=<Athena.exe>` for a packaged one)
 * with an isolated config and database, then drives the real renderer through
 * Chrome DevTools Protocol input events only: click the 执行 tab, type the goal,
 * press send, read each approval card and click its buttons. Nothing is called
 * behind the UI to make progress; the preload API is only read to observe state.
 * What a scenario delivered is checked independently on disk afterwards.
 *
 *   node scripts/verify-execute-mode-e2e.js                 fixture-provider scenarios
 *   node scripts/verify-execute-mode-e2e.js --live          real selected provider (reads the saved credential in the app)
 *   node scripts/verify-execute-mode-e2e.js --only=a,b      named scenarios
 *   node scripts/verify-execute-mode-e2e.js --app=release\\win-unpacked\\Athena.exe
 *
 * Close any running Athena first: the app holds a single-instance lock.
 */
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(item => {
  const [key, ...rest] = item.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : 'true'];
}));
const LIVE = args.has('live');
const APP = args.get('app') ? path.resolve(args.get('app')) : null;
const RUN_ROOT = path.join(os.tmpdir(), 'athena-execute-e2e', new Date().toISOString().replace(/[:.]/g, '-'));
const { deriveAgentRunVerification, summarizeAgentToolOutcome } = require(path.join(root, 'dist', 'shared', 'agentVerification.js'));

// ---------------------------------------------------------------------------
// Chrome DevTools Protocol

class Page {
  static async connect(port, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let target;
    while (!target) {
      if (Date.now() > deadline) throw new Error('renderer page never appeared on the DevTools port');
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(item => item.type === 'page' && /renderer[\\/]index\.html/.test(decodeURIComponent(item.url)));
      } catch { /* not listening yet */ }
      if (!target) await sleep(300);
    }
    const page = new Page(target.webSocketDebuggerUrl);
    await page.opened;
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.rendererErrors = [];
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} ${message.error.data || ''}`));
        else resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.rendererErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.rendererErrors.push(message.params.args.map(item => item.value ?? item.description ?? '').join(' '));
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`renderer evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async waitFor(expression, { timeoutMs = 30_000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression).catch(() => null);
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  /**
   * A real mouse click at the element's centre. The point is measured after the
   * element has been scrolled into view without animation, and only used once the
   * element is what actually sits under it - a smooth scroll or an overlay would
   * otherwise send the click somewhere else.
   */
  async click(selector) {
    const locate = `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { found: false };
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { found: true, x, y, width: rect.width, height: rect.height, onTarget: Boolean(hit && (hit === element || element.contains(hit))) };
    })()`;
    const deadline = Date.now() + 10_000;
    let box = null;
    while (Date.now() < deadline) {
      box = await this.evaluate(locate);
      if (box.found && box.width > 0 && box.height > 0 && box.onTarget) break;
      await sleep(150);
    }
    if (!box?.onTarget) throw new Error(`cannot click ${selector}: ${box?.found ? 'covered or off screen' : 'not found'}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
  }

  async type(selector, text) {
    await this.click(selector);
    await this.send('Input.insertText', { text });
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------
// App profile and process

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function prepareProfile(name, modelOverride) {
  const dir = path.join(RUN_ROOT, name);
  const profile = {
    dir,
    config: path.join(dir, 'config'),
    database: path.join(dir, 'database'),
    diagnostics: path.join(dir, 'diagnostics'),
    voice: path.join(dir, 'voice'),
    workspace: path.join(dir, 'workspace'),
    log: path.join(dir, 'app.log'),
  };
  for (const folder of [profile.config, profile.database, profile.diagnostics, profile.voice, profile.workspace]) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const userConfig = path.join(process.env.APPDATA || '', 'Athena', 'config');
  const settings = readJson(path.join(userConfig, 'settings.json'), { version: 2 });
  const model = modelOverride || readJson(path.join(userConfig, 'model.json'), null);
  if (!model) throw new Error('no saved model configuration to run against');
  const merged = {
    ...settings,
    general: { ...settings.general, closeToTray: false, launchAtStartup: false },
    conversation: { ...settings.conversation, activeMode: 'companion', saveHistory: true, semanticRouting: false },
    tools: { ...settings.tools, modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'full' }, allowExternalNetwork: false },
    webSearch: { ...settings.webSearch, enabled: false },
    memory: { ...settings.memory, enabled: false, autoExtract: false },
    personalization: { ...settings.personalization, initiative: 'low', proactiveCare: false, initiativeMessages: false },
    voice: { ...settings.voice, sttEnabled: false, ttsEnabled: false, autoPlayAssistant: false, handsFree: false },
    privacy: {
      ...settings.privacy,
      networkConsent: { ...(settings.privacy?.networkConsent || {}), remoteModel: true, webSearch: false, externalToolNetwork: false, cloudSync: false },
      firstRunPrivacySeenAt: settings.privacy?.firstRunPrivacySeenAt || new Date().toISOString(),
    },
    ui: { ...settings.ui, startupIntro: false },
    cloud: { ...settings.cloud, syncEnabled: false },
  };
  fs.writeFileSync(path.join(profile.config, 'settings.json'), JSON.stringify(merged, null, 2));
  fs.writeFileSync(path.join(profile.config, 'model.json'), JSON.stringify({ ...model, setupComplete: true }, null, 2));
  return profile;
}

async function launchApp(profile) {
  const port = await freePort();
  const executable = APP || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const appArgs = APP ? [`--remote-debugging-port=${port}`] : [root, `--remote-debugging-port=${port}`];
  const log = fs.openSync(profile.log, 'a');
  const child = childProcess.spawn(executable, appArgs, {
    cwd: APP ? path.dirname(APP) : root,
    env: {
      ...process.env,
      ATHENA_CONFIG_DIR: profile.config,
      ATHENA_DB_DIR: profile.database,
      ATHENA_DIAGNOSTICS_DIR: profile.diagnostics,
      ATHENA_VOICE_TEMP_DIR: profile.voice,
      ATHENA_USE_LOCAL_SETTINGS: '0',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', log, log],
    windowsHide: false,
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const page = await Promise.race([
    Page.connect(port),
    exited.then(code => { throw new Error(`app exited with code ${code} before its window opened (see ${profile.log})`); }),
  ]);
  await page.waitFor(`Boolean(window.athenaAPI && document.getElementById('app-shell')?.dataset.mode && document.getElementById('input-box'))`, {
    timeoutMs: 60_000,
    label: 'renderer initialisation',
  });
  await sleep(1_500);
  return {
    page,
    async stop() {
      page.close();
      try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
      await Promise.race([exited, sleep(5_000)]);
    },
  };
}

// ---------------------------------------------------------------------------
// Acting as the user

const approvalCardsExpression = `(() => {
  const section = document.getElementById('agent-approval-section');
  if (!section || section.hidden) return [];
  return Array.from(section.querySelectorAll('.agent-approval-item')).map((item, index) => {
    const fields = [];
    const labels = item.querySelectorAll('.agent-approval-fields > dt');
    for (const label of labels) fields.push({ label: label.textContent, value: label.nextElementSibling ? label.nextElementSibling.textContent : '' });
    const buttons = Array.from(item.querySelectorAll('button[data-agent-approval-id]')).map(button => ({
      id: button.dataset.agentApprovalId, decision: button.dataset.decision, scope: button.dataset.scope, text: button.textContent, disabled: button.disabled,
    }));
    return {
      index,
      kind: item.dataset.approvalKind,
      title: item.querySelector('.agent-approval-title')?.textContent || '',
      risk: item.querySelector('.agent-approval-risk')?.textContent || '',
      explanation: item.querySelector('.agent-approval-explanation')?.textContent || '',
      fields,
      buttons,
    };
  });
})()`;

async function readRun(page) {
  return page.evaluate(`(async () => {
    const projects = await window.athenaAPI.listProjects();
    const project = projects[0];
    if (!project) return null;
    const workspace = await window.athenaAPI.getAgentWorkspace(project.id);
    const snapshot = workspace && workspace.selectedRun;
    return snapshot ? { projectId: project.id, snapshot } : null;
  })()`);
}

async function readScreen(page) {
  return page.evaluate(`(() => ({
    stateLabel: document.getElementById('execution-state-label')?.textContent || '',
    state: document.getElementById('execution-state-label')?.dataset.state || '',
    result: document.getElementById('execution-current-result')?.textContent || '',
    steps: Array.from(document.querySelectorAll('#agent-plan-list .agent-detail-item')).map(item => item.textContent),
    log: Array.from(document.querySelectorAll('#execution-live-log li')).map(item => item.textContent),
    busy: document.getElementById('send-btn')?.dataset.busy,
    feedback: document.getElementById('agent-execution-feedback')?.hidden ? '' : (document.getElementById('agent-execution-feedback')?.textContent || ''),
  }))()`);
}

async function runGoal(page, scenario, profile) {
  const transcript = { approvals: [], labels: [] };
  // 执行 sits inside the 创作 space, the way a person finds it.
  await page.click('.space-btn[data-space="work"]');
  await page.waitFor(`document.getElementById('work-mode-switch')?.getAttribute('aria-hidden') === 'false'`, { label: 'work space' });
  await sleep(400);
  await page.click('.mode-btn[data-mode="execute"]');
  await page.waitFor(`document.getElementById('app-shell').dataset.mode === 'execute'`, { label: 'execute mode' });
  await page.type('#input-box', scenario.goal);
  await sleep(300);
  await page.click('#send-btn');
  const started = Date.now();
  const deadline = started + scenario.timeoutMs;
  const decided = new Set();
  let sawRun = false;
  while (Date.now() < deadline) {
    await sleep(700);
    const screen = await readScreen(page);
    if (transcript.labels.at(-1) !== screen.stateLabel) {
      transcript.labels.push(screen.stateLabel);
      log(scenario.name, `状态：${screen.stateLabel}`);
    }
    // A decided card can linger, disabled, until the renderer refreshes.
    const cards = (await page.evaluate(approvalCardsExpression))
      .filter(card => card.buttons.some(button => !button.disabled) && !card.buttons.some(button => decided.has(button.id)));
    if (cards.length > 0) {
      const card = cards[0];
      const decision = await scenario.decide(card, { cards, profile, transcript });
      transcript.approvals.push({ ...card, decision: decision.decision, reason: decision.reason });
      log(scenario.name, `审批卡「${card.title}」${card.fields.map(field => `${field.label}=${field.value.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ')} → ${decision.decision}（${decision.reason}）`);
      const button = card.buttons.find(item => item.decision === decision.decision && item.scope === (decision.scope || 'item'))
        || card.buttons.find(item => item.decision === decision.decision);
      assert(button, `card has no ${decision.decision} button`);
      await page.evaluate(`document.getElementById('agent-approval-section')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
      await page.screenshot(path.join(profile.dir, `card-${transcript.approvals.length}.png`)).catch(() => {});
      decided.add(button.id);
      await page.click(`#agent-approval-list button[data-agent-approval-id="${button.id}"][data-decision="${button.decision}"][data-scope="${button.scope}"]`);
      await page.waitFor(`!document.querySelector('#agent-approval-list button[data-agent-approval-id="${button.id}"]')`, {
        timeoutMs: 60_000,
        label: 'the decided card to leave the list',
      });
      continue;
    }
    const observed = await readRun(page);
    if (observed) sawRun = true;
    const status = observed?.snapshot.run.status;
    if (sawRun && ['completed', 'failed', 'cancelled'].includes(status) && screen.busy !== 'true') {
      await sleep(1_500);
      return { transcript, observed: await readRun(page), screen: await readScreen(page), elapsedMs: Date.now() - started };
    }
    if (!observed && screen.feedback) throw new Error(`task did not start: ${screen.feedback}`);
  }
  const screen = await readScreen(page);
  throw new Error(`scenario timed out after ${scenario.timeoutMs} ms; last state "${screen.stateLabel}"`);
}

// ---------------------------------------------------------------------------
// Fixture provider: an OpenAI-compatible server whose script decides each reply.

async function startFixtureProvider(script) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fixture-agent' }] }));
        return;
      }
      const parsed = body ? JSON.parse(body) : {};
      requests.push(parsed);
      const reply = script(parsed, requests.length);
      if (reply === 'drop') {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `fixture-${requests.length}`,
        model: 'fixture-agent',
        choices: [{ index: 0, message: reply, finish_reason: reply.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    model: {
      provider: 'custom',
      setupComplete: true,
      assistModel: '',
      remote: { custom: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-agent', temperature: 0.2, maxTokens: 2048, numCtx: 32768 } },
    },
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    }),
  };
}

function toolCallReply(calls, content = null) {
  return {
    role: 'assistant',
    content,
    tool_calls: calls.map((call, index) => ({
      id: `call-${crypto.randomUUID().slice(0, 8)}-${index}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  };
}

function field(card, label) {
  return card.fields.find(item => item.label === label)?.value ?? null;
}

// ---------------------------------------------------------------------------
// Scenarios

const scenarios = [
  {
    name: 'fixture-outage-retry',
    live: false,
    timeoutMs: 120_000,
    async setup(profile) {
      const target = path.join(profile.workspace, 'progress.txt');
      let dropped = 0;
      // Decided by what the request carries, not by its position, so an unrelated
      // request from the app cannot shift the script.
      const provider = await startFixtureProvider(request => {
        if (!request.messages.some(message => message.role === 'tool')) {
          return toolCallReply([{ name: 'write_file', arguments: { path: target, content: 'step one' } }]);
        }
        if (dropped < 3) {
          dropped += 1;
          return 'drop';
        }
        return { role: 'assistant', content: `进度已写入 ${target}，任务完成。` };
      });
      return { provider, target, goal: `把“step one”写进 ${target}` };
    },
    async decide(card, { profile }) {
      if (card.kind === 'model_retry') {
        assert.match(card.explanation, /连接在请求途中被断开/, 'the card must say what happened');
        assert.match(field(card, '技术细节') || '', /UND_ERR_SOCKET/, 'the card must keep the transport cause');
        assert.match(field(card, '已保留的进度') || '', /1 个工具步骤已完成/);
        return { decision: 'approved', reason: '网络恢复了，从检查点重试' };
      }
      assert.equal(card.title, '写入文件');
      assert.equal(field(card, '路径'), path.join(profile.workspace, 'progress.txt'));
      assert.equal(field(card, '写入内容'), 'step one', 'the card must show what will be written');
      return { decision: 'approved', reason: '路径和内容都对' };
    },
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed');
      assert.equal(fs.readFileSync(context.target, 'utf8'), 'step one');
      assert(result.transcript.approvals.some(card => card.kind === 'model_retry'), 'the outage must have reached the person as a card');
      assert.equal(context.provider.requests.length, 5, 'one round, three dropped attempts, one retry');
      assert(context.provider.requests.at(-1).messages.some(message => message.role === 'tool'), 'the retry carried the completed step');
      const writes = snapshot.steps.filter(step => step.kind === 'tool' && step.input.toolName === 'write_file');
      assert.equal(writes.length, 1, 'the write before the outage must not be repeated');
      assert.equal(result.screen.stateLabel, '已结束 · 未验证');
      assert(result.transcript.labels.includes('已暂停 · 模型服务中断'), `labels: ${result.transcript.labels.join(' → ')}`);
    },
  },
  {
    name: 'fixture-budget-summary',
    live: false,
    timeoutMs: 180_000,
    async setup(profile) {
      const provider = await startFixtureProvider(request => {
        if (request.tool_choice === 'none') return { role: 'assistant', content: '按你的要求停在这里：看了 16 次目录，没有改动任何文件。' };
        return toolCallReply([{ name: 'list_directory', arguments: { path: profile.workspace } }]);
      });
      return { provider, goal: `一直查看 ${profile.workspace} 这个目录` };
    },
    async decide(card) {
      assert.equal(card.kind, 'budget_extension', `unexpected card ${card.title}`);
      assert.match(field(card, '已用') || '', /16 轮模型调用 · 16 次工具调用/);
      return { decision: 'denied', reason: '够了，停下来总结' };
    },
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed');
      assert.equal(context.provider.requests.at(-1).tool_choice, 'none', 'the closing summary may not call tools');
      assert.match(result.screen.result, /停在这里/);
      assert.equal(result.screen.stateLabel, '已结束 · 未验证');
      assert(result.transcript.labels.includes('已暂停 · 预算用完'), `labels: ${result.transcript.labels.join(' → ')}`);
    },
  },
  {
    name: 'fixture-approval-items',
    live: false,
    timeoutMs: 120_000,
    async setup(profile) {
      const keep = path.join(profile.workspace, 'keep.txt');
      const reject = path.join(profile.workspace, 'reject.txt');
      const provider = await startFixtureProvider(request => {
        if (!request.messages.some(message => message.role === 'tool')) {
          return toolCallReply([
            { name: 'write_file', arguments: { path: keep, content: 'keep me' } },
            { name: 'write_file', arguments: { path: reject, content: 'should never exist' } },
          ]);
        }
        return { role: 'assistant', content: 'keep.txt 已写入；reject.txt 被拒绝，没有写。' };
      });
      return { provider, keep, reject, goal: `在 ${profile.workspace} 写 keep.txt 和 reject.txt` };
    },
    async decide(card, { cards, transcript, context }) {
      if (transcript.approvals.length === 0) {
        assert.equal(cards.length, 2, 'both items must be listed separately');
        assert(cards.every(item => item.buttons.some(button => button.scope === 'item')), 'every item needs its own buttons');
        assert.equal(field(cards[0], '路径'), context.keep);
        assert.equal(field(cards[1], '路径'), context.reject);
        return { decision: 'approved', reason: 'keep.txt 可以写' };
      }
      assert.equal(cards.length, 1, 'the decided item must leave the card while the other waits');
      assert.equal(field(card, '路径'), context.reject);
      return { decision: 'denied', reason: '不要 reject.txt' };
    },
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed');
      assert.equal(fs.readFileSync(context.keep, 'utf8'), 'keep me');
      assert.equal(fs.existsSync(context.reject), false, 'the denied write must not happen');
      assert.equal(deriveAgentRunVerification(snapshot.task, snapshot.run, snapshot.steps), 'issues');
      assert.equal(result.screen.stateLabel, '已结束 · 1 步未执行');
      const messages = await result.page.evaluate(`(async () => {
        const windows = await window.athenaAPI.listChatWindows(false);
        return window.athenaAPI.getChatWindowMessages(windows[0].id, 20);
      })()`);
      const reply = messages.filter(message => message.role === 'assistant').at(-1);
      assert.match(reply.content, /没有成功，而且之后没有被重新成功执行/, 'the chat reply must name the step that did not run');
      assert(reply.content.includes(context.reject), reply.content);
    },
  },
  {
    name: 'live-fix-failing-tests',
    live: true,
    timeoutMs: 15 * 60_000,
    async setup(profile) {
      const project = path.join(profile.workspace, 'stats-lib');
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(path.join(project, 'stats.js'), [
        "'use strict';",
        '',
        'function mean(values) {',
        '  let total = 0;',
        '  for (const value of values) total += value;',
        '  return total / (values.length - 1);',
        '}',
        '',
        'function median(values) {',
        '  const middle = Math.floor(values.length / 2);',
        '  return values.length % 2 ? values[middle] : (values[middle] + values[middle + 1]) / 2;',
        '}',
        '',
        'module.exports = { mean, median };',
        '',
      ].join('\n'));
      const testSource = [
        "'use strict';",
        "const assert = require('node:assert/strict');",
        "const { mean, median } = require('./stats');",
        '',
        'const cases = [',
        "  ['mean of 2,4,6', () => assert.equal(mean([2, 4, 6]), 4)],",
        "  ['mean of one value', () => assert.equal(mean([5]), 5)],",
        "  ['median of unsorted odd list', () => assert.equal(median([9, 1, 5]), 5)],",
        "  ['median of even list', () => assert.equal(median([4, 1, 3, 2]), 2.5)],",
        '];',
        'let failed = 0;',
        'for (const [name, run] of cases) {',
        '  try { run(); console.log(`ok   ${name}`); }',
        '  catch (error) { failed += 1; console.log(`FAIL ${name}: ${error.message.split("\\n")[0]}`); }',
        '}',
        'if (failed) { console.log(`${failed} failing`); process.exit(1); }',
        "console.log('ALL TESTS PASSED');",
        '',
      ].join('\n');
      fs.writeFileSync(path.join(project, 'test.js'), testSource);
      return {
        project,
        testHash: sha256(testSource),
        goal: `${project} 里有个小的 Node.js 项目。请先运行 node test.js 看看测试结果；如果有失败，找出 stats.js 里的问题并修好（不要改 test.js），修完再运行测试，直到全部通过。最后告诉我改了哪些地方。`,
      };
    },
    decide: liveDecider(context => [context.project], { allowedWriteBase: context => context.project, forbiddenWrites: context => [path.join(context.project, 'test.js')] }),
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed', `run ended ${snapshot.run.status}: ${snapshot.run.error || ''}`);
      assert.equal(sha256(fs.readFileSync(path.join(context.project, 'test.js'), 'utf8')), context.testHash, 'test.js must be untouched');
      const independent = childProcess.spawnSync(process.execPath, ['test.js'], { cwd: context.project, encoding: 'utf8' });
      assert.equal(independent.status, 0, `independent test run failed:\n${independent.stdout}${independent.stderr}`);
      assert.match(independent.stdout, /ALL TESTS PASSED/);
      const tools = snapshot.steps.filter(step => step.kind === 'tool');
      const commands = tools.filter(step => ['run_command', 'terminal_write', 'terminal_start'].includes(step.input.toolName));
      assert(commands.some(step => step.status === 'failed'), 'the loop must have seen the failing tests first');
      assert(commands.some(step => step.status === 'completed'), 'the loop must end on a passing run');
      return { verification: deriveAgentRunVerification(snapshot.task, snapshot.run, snapshot.steps), outcome: summarizeCounts(snapshot.steps) };
    },
  },
  {
    name: 'live-write-program',
    live: true,
    timeoutMs: 20 * 60_000,
    async setup(profile) {
      const project = path.join(profile.workspace, 'wordfreq');
      fs.mkdirSync(project, { recursive: true });
      return {
        project,
        goal: [
          `在 ${project}（空文件夹）里用 Node.js 写一个命令行小工具 wordfreq.js：`,
          '读取一个文本文件，统计出现次数最多的前 N 个英文单词，忽略大小写和标点；用法是 node wordfreq.js <文件路径> [N]，N 默认 3；',
          '每行输出“单词 次数”（中间一个空格），按次数从多到少排列，次数相同按单词字母顺序。',
          '再写一个 test.js，用 Node 自带的 assert 测试（至少覆盖大小写、标点、N 大于单词总数这三种情况），运行测试，有失败就修，直到全部通过。',
        ].join(''),
      };
    },
    decide: liveDecider(context => [context.project], { allowedWriteBase: context => context.project }),
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed', `run ended ${snapshot.run.status}: ${snapshot.run.error || ''}`);
      for (const file of ['wordfreq.js', 'test.js']) assert(fs.existsSync(path.join(context.project, file)), `${file} was not written`);
      const sample = path.join(context.project, '..', 'independent-sample.txt');
      fs.writeFileSync(sample, 'The cat and the hat. THE end; cat, CAT! And a hat?');
      const output = childProcess.spawnSync(process.execPath, ['wordfreq.js', sample, '3'], { cwd: context.project, encoding: 'utf8' });
      assert.equal(output.status, 0, `wordfreq.js failed:\n${output.stdout}${output.stderr}`);
      const lines = output.stdout.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      assert.deepEqual(lines, ['cat 3', 'the 3', 'and 2'], `unexpected output:\n${output.stdout}`);
      const tests = childProcess.spawnSync(process.execPath, ['test.js'], { cwd: context.project, encoding: 'utf8' });
      assert.equal(tests.status, 0, `its own tests fail:\n${tests.stdout}${tests.stderr}`);
      return { verification: deriveAgentRunVerification(snapshot.task, snapshot.run, snapshot.steps), outcome: summarizeCounts(snapshot.steps) };
    },
  },
  {
    name: 'live-deny-delete',
    live: true,
    timeoutMs: 8 * 60_000,
    async setup(profile) {
      const logs = path.join(profile.workspace, 'old-logs');
      fs.mkdirSync(path.join(logs, '2026-09'), { recursive: true });
      fs.writeFileSync(path.join(logs, '2026-09', 'app.log'), 'keep this evidence');
      return { logs, goal: `把 ${logs} 这个文件夹整个删掉。` };
    },
    async decide(card, { context }) {
      const target = field(card, '路径') || field(card, '命令') || '';
      if (card.title === '删除文件' || /Remove-Item|rmdir|\brd\b|del /i.test(target)) {
        assert(target.includes(context.logs) || /old-logs/.test(target), `the card must name what is deleted: ${JSON.stringify(card.fields)}`);
        return { decision: 'denied', reason: '我改主意了，不删' };
      }
      if (['列出目录', '查看文件信息', '读取文件', '查找文件'].includes(card.title)) return { decision: 'approved', reason: '只读' };
      return { decision: 'denied', reason: `不在预期内的操作：${card.title}` };
    },
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert(fs.existsSync(path.join(context.logs, '2026-09', 'app.log')), 'the denied deletion must not have happened');
      assert(result.transcript.approvals.some(card => card.decision === 'denied'), 'the person must have been asked');
      assert.equal(snapshot.run.status, 'completed');
      assert.equal(deriveAgentRunVerification(snapshot.task, snapshot.run, snapshot.steps), 'issues');
      assert.match(result.screen.stateLabel, /未执行/);
      return { verification: 'issues', outcome: summarizeCounts(snapshot.steps) };
    },
  },
];

/**
 * A careful person's rules: reads are fine; writes only inside the project; commands
 * only when they run node/npm or look around inside the project; never anything
 * that deletes outside it.
 */
function liveDecider(roots, options = {}) {
  return async (card, { context, transcript }) => {
    if (card.kind === 'model_retry') {
      // A person retries a couple of times, then gives up rather than clicking forever.
      const retries = transcript.approvals.filter(item => item.kind === 'model_retry').length;
      return retries < 2
        ? { decision: 'approved', reason: `${card.title}，重试` }
        : { decision: 'denied', reason: '已经重试两次，结束任务' };
    }
    if (card.kind === 'budget_extension') return { decision: 'approved', reason: '还在推进，给它继续' };
    const allowedRoots = roots(context).map(item => item.toLowerCase());
    const inside = value => Boolean(value) && allowedRoots.some(base => path.resolve(value).toLowerCase().startsWith(base));
    const pathValue = field(card, '路径') || field(card, '目标路径');
    const command = field(card, '命令') || field(card, '写入终端的内容') || field(card, '启动后执行') || '';
    if (options.forbiddenWrites && pathValue && options.forbiddenWrites(context).some(item => path.resolve(pathValue).toLowerCase() === item.toLowerCase())) {
      return { decision: 'denied', reason: '说好了不改这个文件' };
    }
    if (pathValue) {
      return inside(pathValue)
        ? { decision: 'approved', reason: '在项目目录内' }
        : { decision: 'denied', reason: `路径不在项目目录内：${pathValue}` };
    }
    if (card.title === '执行命令' || card.title === '启动终端' || card.title === '写入终端') {
      const cwd = field(card, '工作目录') || '';
      const dangerous = /Remove-Item|\brm\b|\bdel\b|rmdir|format|Set-ExecutionPolicy|\breg\b|Invoke-WebRequest|curl|wget/i.test(command);
      const relevant = /\bnode\b|\bnpm\b|Get-ChildItem|\bdir\b|\bls\b|Get-Content|\btype\b|\bcat\b|Set-Location|\bcd\b|Test-Path/i.test(command);
      const targetsProject = allowedRoots.some(base => command.toLowerCase().includes(base)) || inside(cwd);
      if (!dangerous && relevant && (targetsProject || !/[a-z]:\\/i.test(command))) return { decision: 'approved', reason: '只是在项目里运行/查看' };
      return { decision: 'denied', reason: `命令超出预期：${command.slice(0, 120)}` };
    }
    return { decision: 'denied', reason: `不在预期内的操作：${card.title}` };
  };
}

function summarizeCounts(steps) {
  const outcome = summarizeAgentToolOutcome(steps);
  return { toolSteps: outcome.toolSteps, completed: outcome.completed, failed: outcome.failed.length, denied: outcome.denied.length, recovered: outcome.recovered };
}

// ---------------------------------------------------------------------------

async function main() {
  const only = args.get('only') ? new Set(args.get('only').split(',')) : null;
  const selected = scenarios.filter(item => (only ? only.has(item.name) : item.live === LIVE));
  assert(selected.length > 0, 'no scenario selected');
  const running = childProcess.spawnSync('tasklist', ['/FI', 'IMAGENAME eq Athena.exe', '/NH'], { encoding: 'utf8' }).stdout;
  assert(!/Athena\.exe/i.test(running), 'close the running Athena first: it holds the single-instance lock');
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  const report = [];
  let failures = 0;
  for (const scenario of selected) {
    const profile = prepareProfile(scenario.name, null);
    let context;
    let app;
    const entry = { scenario: scenario.name, profile: profile.dir };
    try {
      context = await scenario.setup(profile);
      if (context.provider) prepareProfileModel(profile, context.provider.model);
      app = await launchApp(profile);
      log(scenario.name, `开始：${context.goal}`);
      const result = await runGoal(app.page, { ...scenario, goal: context.goal, decide: (card, extra) => scenario.decide(card, { ...extra, context }) }, profile);
      result.page = app.page;
      await app.page.screenshot(path.join(profile.dir, 'final.png'));
      const details = await scenario.verify({ result, context, profile });
      assert.deepEqual(app.page.rendererErrors.filter(Boolean), [], 'the renderer must not log errors');
      Object.assign(entry, {
        ok: true,
        elapsedMs: result.elapsedMs,
        labels: result.transcript.labels,
        approvals: result.transcript.approvals.map(card => ({ title: card.title, kind: card.kind, decision: card.decision, reason: card.reason, fields: card.fields })),
        steps: result.screen.steps,
        result: result.screen.result,
        ...(details || {}),
      });
      log(scenario.name, `通过（${Math.round(result.elapsedMs / 1000)} 秒）`);
    } catch (error) {
      failures += 1;
      Object.assign(entry, { ok: false, error: error.stack || String(error) });
      if (app) {
        entry.screen = await readScreen(app.page).catch(() => null);
        entry.run = await readRun(app.page).then(value => value && {
          status: value.snapshot.run.status,
          phase: value.snapshot.run.phase,
          error: value.snapshot.run.error,
          steps: value.snapshot.steps.map(step => `${step.sequence} ${step.kind} ${step.input.toolName || ''} ${step.status} ${step.error || ''}`),
        }).catch(() => null);
        await app.page.screenshot(path.join(profile.dir, 'failure.png')).catch(() => {});
        entry.rendererErrors = app.page.rendererErrors;
      }
      log(scenario.name, `失败：${error.message}`);
    } finally {
      await app?.stop();
      await context?.provider?.close();
      report.push(entry);
      fs.writeFileSync(path.join(RUN_ROOT, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  console.log(`ATHENA_EXECUTE_E2E_REPORT ${path.join(RUN_ROOT, 'report.json')}`);
  if (failures > 0) {
    console.error(`ATHENA_EXECUTE_E2E_FAILED ${failures}/${selected.length}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ATHENA_EXECUTE_E2E_OK scenarios=${selected.map(item => item.name).join(',')} app=${APP ? 'packaged' : 'dev'}`);
}

function prepareProfileModel(profile, model) {
  fs.writeFileSync(path.join(profile.config, 'model.json'), JSON.stringify(model, null, 2));
}

function freePort() {
  return new Promise(resolve => {
    const probe = require('node:net').createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(scenario, message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${scenario} · ${message}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
