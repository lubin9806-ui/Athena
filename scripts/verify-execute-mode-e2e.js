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

/** Electron's own startup, not this app's code. Kept in the report, never asserted on. */
const ENGINE_NOISE = [
  /sandboxed_renderer\.bundle\.js script failed to run/,
  /Cannot destructure property 'preloadScripts' of 'binding\.startupData'/,
];

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
    this.ignoredNoise = [];
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
        this.recordError(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.recordError(message.params.args.map(item => item.value ?? item.description ?? '').join(' '));
      }
    });
  }

  /**
   * Electron's own sandbox bootstrap sometimes logs into the first window it
   * opens ("binding.startupData is null"), before any app code runs. Treating
   * that as an application error made the first scenario of every run red while
   * the run itself was perfect. It is recorded rather than dropped, so a real
   * error can never hide behind the same filter.
   */
  recordError(text) {
    const value = String(text || '');
    if (!value) return;
    if (ENGINE_NOISE.some(pattern => pattern.test(value))) this.ignoredNoise.push(value);
    else this.rendererErrors.push(value);
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

function prepareProfile(name, modelOverride, useSavedProfile) {
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
  const settings = useSavedProfile
    ? readJson(path.join(userConfig, 'settings.json'), { version: 2 })
    : { version: 2 };
  const model = modelOverride || (useSavedProfile ? readJson(path.join(userConfig, 'model.json'), null) : null);
  if (useSavedProfile && !model) throw new Error('no saved model configuration to run against');
  const merged = {
    ...settings,
    general: { ...settings.general, closeToTray: false, launchAtStartup: false },
    conversation: { ...settings.conversation, activeMode: 'companion', saveHistory: true, semanticRouting: false },
    tools: {
      ...settings.tools,
      modePermissions: { create: 'off', companion: 'off', reason: 'off', execute: 'full' },
      allowExternalNetwork: false,
      autoApprove: false,
    },
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
  if (model) fs.writeFileSync(path.join(profile.config, 'model.json'), JSON.stringify({ ...model, setupComplete: true }, null, 2));
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
  const stream = document.getElementById('execute-stream');
  if (!stream || stream.hidden) return [];
  return Array.from(stream.querySelectorAll('.agent-approval-item')).map((item, index) => {
    const fields = [];
    const labels = item.querySelectorAll('.agent-approval-fields > dt');
    for (const label of labels) fields.push({ label: label.textContent, value: label.nextElementSibling ? label.nextElementSibling.textContent : '' });
    const buttons = Array.from(item.querySelectorAll('button[data-agent-approval-id]')).map(button => ({
      id: button.dataset.agentApprovalId, decision: button.dataset.decision, scope: button.dataset.scope, text: button.textContent, disabled: button.disabled,
    }));
    return {
      index,
      codeLigatures: Array.from(item.querySelectorAll('.agent-approval-code')).map(element => getComputedStyle(element).fontVariantLigatures),
      kind: item.dataset.approvalKind,
      title: item.querySelector('.agent-approval-title')?.textContent || '',
      risk: item.querySelector('.agent-approval-risk')?.textContent || '',
      explanation: item.querySelector('.agent-approval-explanation')?.textContent || '',
      secretRequest: item.dataset.secretRequest === 'true',
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
  return page.evaluate(`(() => {
    const live = document.querySelector('#execute-stream .exec-live');
    const finals = Array.from(document.querySelectorAll('#execute-stream .exec-final'));
    return {
      stateLabel: live?.querySelector('.exec-live-text')?.textContent || '',
      state: live?.dataset.state || '',
      result: finals.at(-1)?.textContent || '',
      steps: Array.from(document.querySelectorAll('#execute-stream .exec-step')).map(item => (
        [item.dataset.status, item.querySelector('.exec-step-label')?.textContent, item.querySelector('.exec-step-target')?.textContent, item.querySelector('.exec-step-status')?.textContent].filter(Boolean).join(' · ')
      )),
      narration: Array.from(document.querySelectorAll('#execute-stream .exec-narr')).map(item => item.textContent),
      receipts: Array.from(document.querySelectorAll('#execute-stream .exec-receipt')).map(item => item.textContent),
      said: Array.from(document.querySelectorAll('#execute-stream .exec-user')).map(item => item.textContent),
      currentGoal: document.getElementById('execute-context-goal')?.textContent || '',
      busy: document.getElementById('send-btn')?.dataset.busy,
      feedback: document.getElementById('agent-execution-feedback')?.hidden ? '' : (document.getElementById('agent-execution-feedback')?.textContent || ''),
    };
  })()`);
}

async function runGoal(page, scenario, profile) {
  const transcript = { approvals: [], labels: [] };
  // 执行 sits inside the 工作台, the way a person finds it.
  await page.click('.space-btn[data-space="work"]');
  await page.waitFor(`document.getElementById('work-mode-switch')?.getAttribute('aria-hidden') === 'false'`, { label: 'work space' });
  await sleep(400);
  await page.click('.mode-btn[data-mode="execute"]');
  await page.waitFor(`document.getElementById('app-shell').dataset.mode === 'execute'`, { label: 'execute mode' });
  if (scenario.prepare) await scenario.prepare(page, profile);
  await page.type('#input-box', scenario.goal);
  await sleep(300);
  await page.click('#send-btn');
  const started = Date.now();
  const deadline = started + scenario.timeoutMs;
  const decided = new Set();
  const followUps = [...(scenario.followUps || [])];
  // One window is one session: a follow-up is the person answering the turn that
  // just stopped, not a new task, so the run it belongs to has to be a new one.
  let answeredRunId = null;
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
      // What is approved must render character for character (no `>=` drawn as ≥).
      assert(card.codeLigatures.every(value => value === 'none'), `approval code fields render ligatures: ${card.codeLigatures.join(',')}`);
      const decision = await scenario.decide(card, { cards, profile, transcript });
      transcript.approvals.push({ ...card, decision: decision.decision, reason: decision.reason });
      log(scenario.name, `审批卡「${card.title}」${card.fields.map(field => `${field.label}=${field.value.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ')} → ${decision.decision}（${decision.reason}）`);
      const button = card.buttons.find(item => item.decision === decision.decision && item.scope === (decision.scope || 'item'))
        || card.buttons.find(item => item.decision === decision.decision);
      assert(button, `card has no ${decision.decision} button`);
      await page.evaluate(`document.querySelector('#execute-stream .exec-ask')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
      await page.screenshot(path.join(profile.dir, `card-${transcript.approvals.length}.png`)).catch(() => {});
      decided.add(button.id);
      if (card.secretRequest && scenario.secretViaComposer) {
        assert.equal(typeof decision.secret, 'string', 'a secret request needs fixture secret input');
        await page.type('#input-box', decision.secret);
        await page.click('#send-btn');
        await page.waitFor(`document.getElementById('ui-dialog')?.open === true`, { label: 'pasted-secret interception warning' });
        const dialogText = await page.evaluate(`document.getElementById('ui-dialog')?.textContent || ''`);
        assert(!dialogText.includes(decision.secret), 'the warning must not echo the pasted secret');
        await page.click('#ui-dialog-confirm');
        await page.waitFor(`!document.querySelector('#execute-stream button[data-agent-approval-id="${button.id}"]')`, {
          timeoutMs: 60_000,
          label: 'the safely provided secret card to leave the list',
        });
        continue;
      }
      if (card.secretRequest) {
        assert.equal(typeof decision.secret, 'string', 'a secret request needs fixture secret input');
        await page.type('#execute-stream .exec-secret-input', decision.secret);
        if (decision.persist) await page.click('#execute-stream .exec-secret-remember input');
      }
      await page.click(`#execute-stream button[data-agent-approval-id="${button.id}"][data-decision="${button.decision}"][data-scope="${button.scope}"]`);
      await page.waitFor(`!document.querySelector('#execute-stream button[data-agent-approval-id="${button.id}"]:not(:disabled)')`, {
        timeoutMs: 60_000,
        label: 'the decided card to become inactive',
      });
      continue;
    }
    const observed = await readRun(page);
    if (observed && observed.snapshot.run.id !== answeredRunId) sawRun = true;
    const status = observed?.snapshot.run.status;
    const settled = sawRun
      && observed?.snapshot.run.id !== answeredRunId
      && ['completed', 'failed', 'cancelled'].includes(status)
      && screen.busy !== 'true';
    if (settled && followUps.length > 0) {
      const followUp = followUps.shift();
      answeredRunId = observed.snapshot.run.id;
      sawRun = false;
      log(scenario.name, `接着说：${followUp}`);
      await page.type('#input-box', followUp);
      await sleep(300);
      await page.click('#send-btn');
      await sleep(1_200);
      continue;
    }
    if (settled) {
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
    name: 'fixture-settings-ui',
    live: false,
    timeoutMs: 120_000,
    async setup(profile) {
      const provider = await startFixtureProvider(() => ({ role: 'assistant', content: '设置界面检查完成。' }));
      return { provider, goal: `确认 ${profile.workspace} 的执行设置界面可用。` };
    },
    async prepare(page, profile) {
      await page.click('#execute-chip-settings');
      await page.waitFor(`document.getElementById('execution-panel')?.dataset.open === 'true'`, { label: 'execute settings rail' });
      await sleep(500);
      const audit = await page.evaluate(`(() => {
        const panel = document.getElementById('execution-panel');
        const scrim = document.getElementById('panel-scrim');
        const extension = document.querySelector('.execution-extensions');
        const style = getComputedStyle(panel);
        const scrimStyle = getComputedStyle(scrim);
        return {
          width: panel.getBoundingClientRect().width,
          panelBlur: style.backdropFilter,
          scrimBlur: scrimStyle.backdropFilter,
          owner: scrim.dataset.owner,
          extensionOpen: extension?.open === true,
          visibleCards: Array.from(panel.querySelectorAll('.execution-card')).filter(item => getComputedStyle(item).display !== 'none').length,
          text: panel.innerText,
        };
      })()`);
      assert(audit.width <= 380, `execution settings rail is too wide: ${audit.width}`);
      assert(['none', ''].includes(audit.panelBlur), `execution settings rail still blurs: ${audit.panelBlur}`);
      assert(['none', ''].includes(audit.scrimBlur), `execution settings scrim still blurs: ${audit.scrimBlur}`);
      assert.equal(audit.owner, 'execution');
      assert.equal(audit.extensionOpen, false, 'Skills and MCP must be collapsed by default');
      assert.equal(audit.visibleCards, 3, 'only workspace, permission, and narration belong in the primary settings hierarchy');
      assert(!/SKILL LIBRARY|INTEGRATIONS/.test(audit.text), 'internal English section labels must not be visible');
      await page.screenshot(path.join(profile.dir, 'settings-ui.png'));
      await page.click('#btn-execution-close');
      await page.waitFor(`document.getElementById('execution-panel')?.dataset.open === 'false'`, { label: 'execute settings rail close' });
    },
    async decide() {
      throw new Error('settings UI fixture must not ask for approval');
    },
    async verify({ result }) {
      assert.equal(result.observed.snapshot.run.status, 'completed');
      assert.equal(result.transcript.approvals.length, 0);
    },
  },
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
    // 免审批 is the switch the user asked for: "打开后不再弹审批，只有申请类似
    // apikay 时弹". Driven through the real chip and its confirmation dialog.
    name: 'fixture-auto-approve',
    live: false,
    timeoutMs: 120_000,
    async setup(profile) {
      const first = path.join(profile.workspace, 'notes.txt');
      const second = path.join(profile.workspace, 'summary.txt');
      const provider = await startFixtureProvider(request => {
        if (!request.messages.some(message => message.role === 'tool')) {
          return toolCallReply([
            { name: 'write_file', arguments: { path: first, content: 'first without asking' } },
            { name: 'write_file', arguments: { path: second, content: 'second without asking' } },
          ]);
        }
        return { role: 'assistant', content: '两个文件都写好了，没打断你。' };
      });
      return { provider, first, second, goal: `在 ${profile.workspace} 写 notes.txt 和 summary.txt` };
    },
    async prepare(page) {
      await page.click('#execute-chip-approval');
      await page.waitFor(`document.getElementById('ui-dialog')?.open === true`, { label: 'the 免审批 confirmation' });
      const message = await page.evaluate(`document.getElementById('ui-dialog-message')?.textContent || ''`);
      assert.match(message, /只在需要 API Key、密码、Token/, 'the dialog must name the only interactive exception');
      await page.click('#ui-dialog-confirm');
      await page.waitFor(`document.getElementById('execute-chip-approval')?.dataset.auto === 'true'`, { label: '免审批 on' });
    },
    async decide(card) {
      throw new Error(`免审批 must not raise an approval card: ${card.title}`);
    },
    async verify({ result, context }) {
      const { snapshot } = result.observed;
      assert.equal(snapshot.run.status, 'completed');
      assert.equal(result.transcript.approvals.length, 0, 'no card may have been shown');
      assert.equal(fs.readFileSync(context.first, 'utf8'), 'first without asking');
      assert.equal(fs.readFileSync(context.second, 'utf8'), 'second without asking');
      const granted = snapshot.approvals.filter(item => item.request.kind === 'tool_call');
      assert.equal(granted.length, 2, 'every call it let through is still recorded');
      assert(granted.every(item => item.status === 'approved' && item.decision.actor === 'auto-approve'), JSON.stringify(granted.map(item => item.decision)));
      assert(
        result.screen.receipts.filter(text => text.includes('免审批')).length === 2,
        `the stream must say what was allowed without asking: ${result.screen.receipts.join(' | ')}`,
      );
      // Nothing was asked, and the turn still reports what it can stand behind:
      // this fixture declares no check, so it ends "未验证" rather than "已完成".
      assert.equal(result.screen.stateLabel, '已结束 · 未验证');
    },
  },
  {
    name: 'fixture-secure-secret',
    live: false,
    secretViaComposer: true,
    timeoutMs: 120_000,
    async setup(profile) {
      const seen = { secondRound: null };
      const provider = await startFixtureProvider(request => {
        if (!request.messages.some(message => message.role === 'tool')) {
          return toolCallReply([{ name: 'request_secret', arguments: {
            service: 'civitai-e2e',
            label: 'Civitai API Key',
            reason: '下载用户指定的模型',
          } }], '下载前需要 Civitai 的访问凭据。');
        }
        seen.secondRound = request.messages;
        return { role: 'assistant', content: '凭据已通过安全输入接入，没有写进聊天记录。' };
      });
      return { provider, seen, goal: `从 Civitai 下载模型到 ${profile.workspace}，需要凭据时使用安全输入。` };
    },
    async prepare(page) {
      // Turn on continuous execution: a secret request must remain the one
      // interactive exception even though ordinary tools auto-run.
      await page.click('#execute-chip-approval');
      await page.waitFor(`document.getElementById('ui-dialog')?.open === true`, { label: 'continuous execution warning' });
      await page.click('#ui-dialog-confirm');
      await page.waitFor(`document.getElementById('execute-chip-approval')?.dataset.auto === 'true'`, { label: 'continuous execution on' });
    },
    async decide(card) {
      assert.equal(card.secretRequest, true);
      assert.equal(card.title, '安全提供凭据');
      assert.match(card.explanation, /不会进入聊天记录/);
      return { decision: 'approved', reason: '通过安全输入提供', secret: 'e2e-secret-never-log', persist: false };
    },
    async verify({ result, context }) {
      assert.equal(result.observed.snapshot.run.status, 'completed');
      assert.equal(result.transcript.approvals.length, 1, 'only the secret request may interrupt continuous execution');
      const serialized = JSON.stringify({ snapshot: result.observed.snapshot, requests: context.provider.requests });
      assert.doesNotMatch(serialized, /e2e-secret-never-log/, 'secret must not enter the run or model request');
      const toolMessage = context.seen.secondRound.find(message => message.role === 'tool');
      assert.match(String(toolMessage.content), /credential:\/\/civitai-e2e/);
    },
  },
  {
    // ATH-EXEC-006: the reply that carries the answer must continue the task that
    // asked for it. The user's report was an API key; a port number tests the same
    // path without putting a real secret through a fixture.
    name: 'fixture-continuity',
    live: false,
    timeoutMs: 120_000,
    async setup(profile) {
      const target = path.join(profile.workspace, 'config.json');
      const seen = { secondRound: null };
      const provider = await startFixtureProvider(request => {
        const userTurns = request.messages.filter(message => message.role === 'user');
        if (userTurns.length <= 1) return { role: 'assistant', content: '端口号是多少？你告诉我我就写进去。' };
        if (!seen.secondRound) seen.secondRound = request.messages;
        if (!request.messages.some(message => message.role === 'tool')) {
          return toolCallReply([{ name: 'write_file', arguments: { path: target, content: '{"port": 8129}' } }]);
        }
        return { role: 'assistant', content: 'config.json 写好了，port 是 8129。' };
      });
      return {
        provider,
        target,
        seen,
        goal: `在 ${profile.workspace} 写一个 config.json，里面只放一个 port 字段。端口号我马上告诉你，先别猜。`,
      };
    },
    followUps: ['8129'],
    async decide(card) {
      assert.match(field(card, '路径') || '', /config\.json$/);
      return { decision: 'approved', reason: '这个文件可以写' };
    },
    async verify({ result, context }) {
      assert.equal(JSON.parse(fs.readFileSync(context.target, 'utf8')).port, 8129);
      const messages = context.seen.secondRound || [];
      assert(
        messages.some(message => message.role === 'assistant' && String(message.content).includes('端口号是多少')),
        'the next turn must carry the question it is answering',
      );
      assert(
        messages.some(message => message.role === 'user' && String(message.content).includes('config.json')),
        'the next turn must carry the request that started the session',
      );
      const lastUserTurn = messages.filter(message => message.role === 'user').at(-1);
      assert.equal(String(lastUserTurn.content).trim(), '8129', 'the answer is the newest turn');
      const session = result.observed.snapshot.run.state.session;
      assert.ok(session && session.ownStart > 1, `the run must know where its own turn starts: ${JSON.stringify(session)}`);
      assert(result.screen.said.some(text => text.trim() === '8129'), `both messages belong to one conversation: ${result.screen.said.join(' | ')}`);
      assert.match(result.screen.currentGoal, /config\.json/, 'the visible current goal must stay on the session objective');
      assert.notEqual(result.screen.currentGoal.trim(), '8129', 'a clarification must not replace the visible session objective');
    },
  },
  {
    name: 'live-session-continuity',
    live: true,
    timeoutMs: 10 * 60_000,
    async setup(profile) {
      return {
        target: path.join(profile.workspace, 'config.json'),
        goal: `在 ${profile.workspace} 这个文件夹里建一个 config.json，里面只写一个 port 字段。端口号我马上告诉你，先不要猜，也不要先把文件写出来。`,
      };
    },
    followUps: ['8129'],
    async decide(card) {
      const target = field(card, '路径') || field(card, '命令') || '';
      if (/config\.json/.test(target)) return { decision: 'approved', reason: '这个文件可以写' };
      return { decision: 'denied', reason: '只写 config.json' };
    },
    async verify({ result, context }) {
      assert.ok(fs.existsSync(context.target), 'config.json must exist once the port was given');
      const parsed = JSON.parse(fs.readFileSync(context.target, 'utf8'));
      assert.equal(Number(parsed.port), 8129, `the port must be the one given afterwards: ${JSON.stringify(parsed)}`);
      assert(result.screen.narration.length > 0, 'each step must be explained before it happens');
      return { narration: result.screen.narration.slice(0, 4) };
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
    const profile = prepareProfile(scenario.name, null, scenario.live);
    let context;
    let app;
    const entry = { scenario: scenario.name, profile: profile.dir };
    try {
      context = await scenario.setup(profile);
      if (context.provider) prepareProfileModel(profile, context.provider.model);
      if (!fs.existsSync(path.join(profile.config, 'model.json'))) {
        throw new Error('no saved model configuration to run against');
      }
      app = await launchApp(profile);
      log(scenario.name, `开始：${context.goal}`);
      const result = await runGoal(app.page, {
        ...scenario,
        goal: context.goal,
        decide: (card, extra) => scenario.decide(card, { ...extra, context }),
        prepare: scenario.prepare ? (page) => scenario.prepare(page, profile, context) : null,
      }, profile);
      result.page = app.page;
      await app.page.screenshot(path.join(profile.dir, 'final.png'));
      const details = await scenario.verify({ result, context, profile });
      assert.deepEqual(app.page.rendererErrors.filter(Boolean), [], 'the renderer must not log errors');
      if (app.page.ignoredNoise.length > 0) entry.ignoredRendererNoise = [...app.page.ignoredNoise];
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
