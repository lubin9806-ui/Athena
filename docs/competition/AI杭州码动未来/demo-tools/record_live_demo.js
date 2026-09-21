'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const sourceScript = path.join(repo, 'scripts', 'verify-execute-mode-e2e.js');
const runtimeConfig = path.join(__dirname, '..', 'demo-assets', 'runtime-config-deepseek');
const credentialDir = path.join(process.env.APPDATA || '', 'Athena', 'credentials');
const outputBase = path.join(__dirname, '..', 'demo-output');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(outputBase, `live-deepseek-${stamp}`);
const framesDir = path.join(outputDir, 'frames');
const transformedScript = path.join(os.tmpdir(), `athena-demo-e2e-${process.pid}.js`);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function findPage(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(item => item.type === 'page' && /renderer[\\/]index\.html/.test(decodeURIComponent(item.url)));
      if (target) return target;
    } catch {
      // Electron has not opened its debugging endpoint yet.
    }
    await sleep(200);
  }
  throw new Error(`Athena renderer did not appear on debugging port ${port}`);
}

async function capture(port, stopSignal, childExit) {
  const target = await findPage(port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  let frameNo = 0;
  let firstTimestamp = null;
  const frames = [];
  const pending = new Map();

  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (message.method !== 'Page.screencastFrame') return;
    const timestamp = Number(message.params.metadata?.timestamp || 0);
    if (firstTimestamp === null) firstTimestamp = timestamp;
    frameNo += 1;
    const file = `frame-${String(frameNo).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(framesDir, file), Buffer.from(message.params.data, 'base64'));
    frames.push({
      file,
      relativeMs: Math.max(0, Math.round((timestamp - firstTimestamp) * 1000)),
      pageScaleFactor: message.params.metadata?.pageScaleFactor ?? null,
      deviceWidth: message.params.metadata?.deviceWidth ?? null,
      deviceHeight: message.params.metadata?.deviceHeight ?? null,
    });
    socket.send(JSON.stringify({
      id: nextId++,
      method: 'Page.screencastFrameAck',
      params: { sessionId: message.params.sessionId },
    }));
  });

  await send('Page.enable');
  await send('Page.startScreencast', {
    format: 'jpeg',
    quality: 94,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 3,
  });

  const outcome = await Promise.race([
    stopSignal.then(() => ({ reason: 'scenario-finished', exitCode: 0 })),
    childExit.then(exitCode => ({ reason: 'child-exited', exitCode })),
  ]);
  await send('Page.stopScreencast').catch(() => {});
  socket.close();

  const durationMs = frames.length > 0 ? frames.at(-1).relativeMs : 0;
  const manifest = {
    capturedAt: new Date().toISOString(),
    scenario: 'live-fix-failing-tests',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    source: 'Chromium Page.startScreencast from the real Athena renderer',
    stopReason: outcome.reason,
    childExitCode: outcome.exitCode,
    frameCount: frames.length,
    durationMs,
    frames,
  };
  fs.writeFileSync(path.join(outputDir, 'capture.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function main() {
  if (!fs.existsSync(sourceScript)) throw new Error(`Missing source E2E script: ${sourceScript}`);
  if (!fs.existsSync(runtimeConfig)) throw new Error(`Missing isolated runtime config: ${runtimeConfig}`);
  if (!fs.existsSync(path.join(credentialDir, 'model-credentials.enc.json'))) {
    throw new Error(`Missing encrypted DeepSeek credential store: ${credentialDir}`);
  }

  fs.mkdirSync(framesDir, { recursive: true });
  const port = await freePort();
  const original = fs.readFileSync(sourceScript, 'utf8');
  const transformed = original
    .replace("const root = path.resolve(__dirname, '..');", `const root = ${JSON.stringify(repo)};`)
    .replace('const port = await freePort();', `const port = ${port};`);
  if (transformed === original) throw new Error('Could not prepare the existing E2E script for a fixed debugging port');
  fs.writeFileSync(transformedScript, transformed);

  const logFile = path.join(outputDir, 'run.log');
  const log = fs.openSync(logFile, 'w');
  const child = childProcess.spawn(process.execPath, [transformedScript, '--live', '--only=live-fix-failing-tests'], {
    cwd: repo,
    env: {
      ...process.env,
      APPDATA: runtimeConfig,
      ATHENA_CREDENTIALS_DIR: credentialDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const childExit = new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
  let finishRecording;
  const stopSignal = new Promise(resolve => { finishRecording = resolve; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => {
      process.stdout.write(chunk);
      fs.writeSync(log, chunk);
      if (/ATHENA_EXECUTE_E2E_(?:OK|FAILED)/.test(String(chunk))) finishRecording();
    });
  }

  try {
    const manifest = await capture(port, stopSignal, childExit);
    console.log(`ATHENA_DEMO_CAPTURE ${outputDir}`);
    console.log(`ATHENA_DEMO_FRAMES count=${manifest.frameCount} durationMs=${manifest.durationMs} exit=${manifest.childExitCode}`);
    if (manifest.childExitCode !== 0) process.exitCode = manifest.childExitCode;
  } finally {
    fs.closeSync(log);
    fs.rmSync(transformedScript, { force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  try { fs.rmSync(transformedScript, { force: true }); } catch {}
  process.exitCode = 1;
});
