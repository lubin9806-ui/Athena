const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const isSecond = process.argv.includes('--second-instance-probe');
const scratch = process.env.ATHENA_RELIABILITY_PROBE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'athena-reliability-'));
const token = process.env.ATHENA_RELIABILITY_TOKEN || `probe-${process.pid}`;
process.env.ATHENA_RELIABILITY_PROBE_DIR = scratch;
process.env.ATHENA_RELIABILITY_TOKEN = token;
app.setPath('userData', path.join(scratch, 'electron-user-data'));

const gotLock = app.requestSingleInstanceLock({ source: 'desktop-reliability-test', token });

if (isSecond) {
  if (gotLock) app.releaseSingleInstanceLock();
  app.exit(gotLock ? 3 : 0);
} else if (!gotLock) {
  console.error('Primary reliability probe could not acquire the single-instance lock.');
  app.exit(4);
} else {
  void runPrimary();
}

async function runPrimary() {
  let exitCode = 0;
  try {
    await app.whenReady();
    const reliability = require(path.join(root, 'dist', 'core', 'runtime', 'DesktopReliability.js'));
    await verifyPolicies(reliability);
    await verifySingleInstanceDelivery();
    await verifyRendererReload(reliability.RendererRecoveryPolicy);
    verifyWalCheckpoint();
    console.log('ATHENA_DESKTOP_RELIABILITY_OK singleInstance=delivered rendererCrash=reloaded crashLoop=bounded unresponsive=grace-handler shutdown=bounded wal=checkpointed');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    app.releaseSingleInstanceLock();
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
    app.exit(exitCode);
  }
}

async function verifyPolicies({ RendererRecoveryPolicy, SingleInstanceActivationQueue, withTimeout }) {
  const policy = new RendererRecoveryPolicy(2, 60_000);
  assert.equal(policy.evaluate('clean-exit', 10_000).action, 'ignore');
  assert.equal(policy.evaluate('crashed', 10_000).action, 'reload');
  assert.equal(policy.evaluate('oom', 20_000).action, 'reload');
  assert.equal(policy.evaluate('killed', 30_000).action, 'stop');
  assert.equal(policy.evaluate('crashed', 80_001).action, 'reload', 'old crashes must age out of the failure window');
  assert.equal(new RendererRecoveryPolicy().evaluate('integrity-failure').action, 'stop');
  assert.equal(new RendererRecoveryPolicy().evaluate('launch-failed').action, 'stop');

  const activation = new SingleInstanceActivationQueue();
  assert.equal(activation.consume(), false);
  activation.request();
  activation.request();
  assert.equal(activation.hasPendingRequest, true);
  assert.equal(activation.consume(), true);
  assert.equal(activation.consume(), false, 'multiple early launches must coalesce into one focus action');

  assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'unexpected timeout'), 'ok');
  await assert.rejects(
    withTimeout(new Promise(() => {}), 25, 'fixture timeout'),
    /fixture timeout/,
  );
}

async function verifySingleInstanceDelivery() {
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('second-instance event was not delivered')), 10_000);
    app.once('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
      clearTimeout(timer);
      try {
        assert.equal(additionalData?.source, 'desktop-reliability-test');
        assert.equal(additionalData?.token, token);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  const childEnvironment = { ...process.env };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = childProcess.spawn(process.execPath, [__filename, '--second-instance-probe'], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const childExit = new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`second instance exited ${code}: ${stderr}`)));
  });
  await Promise.all([delivered, childExit]);
}

async function verifyRendererReload(RendererRecoveryPolicy) {
  const policy = new RendererRecoveryPolicy(1, 60_000);
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  let loadCount = 0;
  let goneCount = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('renderer crash recovery timed out')), 12_000);
    window.webContents.on('render-process-gone', (_event, details) => {
      goneCount += 1;
      const recovery = policy.evaluate(details.reason);
      if (recovery.action !== 'reload') {
        clearTimeout(timer);
        reject(new Error(`fixture renderer was not reloadable: ${details.reason}`));
        return;
      }
      setTimeout(() => window.webContents.reload(), 50);
    });
    window.webContents.on('did-finish-load', () => {
      loadCount += 1;
      if (loadCount === 1) {
        window.webContents.forcefullyCrashRenderer();
        return;
      }
      clearTimeout(timer);
      resolve();
    });
    void window.loadURL('data:text/html,<meta charset="utf-8"><title>Athena recovery probe</title><p>ready</p>');
  });
  assert.equal(goneCount, 1);
  assert.equal(loadCount, 2);
  window.destroy();
}

function verifyWalCheckpoint() {
  process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
  process.env.ATHENA_DB_FILENAME = 'reliability.db';
  process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
  const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
  const db = memory.getDatabase();
  const project = memory.createProject({ title: 'Reliability checkpoint' });
  memory.createChatWindow({ projectId: project.id, title: 'Durable state' });
  const databasePath = memory.getDatabaseFilePath();
  assert.equal(db.pragma('quick_check(1)', { simple: true }), 'ok');
  memory.closeDatabase();

  const Database = require('better-sqlite3');
  const reopened = new Database(databasePath, { readonly: true });
  try {
    assert.equal(reopened.pragma('quick_check(1)', { simple: true }), 'ok');
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?').get(project.id).count, 1);
  } finally {
    reopened.close();
  }
  const walPath = `${databasePath}-wal`;
  assert(!fs.existsSync(walPath) || fs.statSync(walPath).size === 0, 'WAL must be absent or empty after orderly close');

  const mainSource = fs.readFileSync(path.join(root, 'src', 'app', 'main.ts'), 'utf8');
  const databaseSource = fs.readFileSync(path.join(root, 'src', 'memory', 'database', 'index.ts'), 'utf8');
  assert.match(mainSource, /render-process-gone/);
  assert.match(mainSource, /createdWindow\.on\('responsive', clearUnresponsiveRecovery\)/);
  assert.match(mainSource, /singleInstanceActivation\.request\(\)/);
  assert.match(mainSource, /withTimeout\(shutdown\(\), 15_000/);
  assert.match(databaseSource, /wal_checkpoint\(TRUNCATE\)/);
}
