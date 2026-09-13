const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const campaignRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(campaignRoot, '..', '..');
const runtimeRoot = path.join(campaignRoot, 'source', 'runtime');
const executable = path.join(projectRoot, 'release', 'win-unpacked', 'Athena.exe');
const archive = path.join(projectRoot, 'release', 'win-unpacked', 'resources', 'app.asar');
const width = 1280;
const height = 820;
const cases = [
  { id: '04-companion-day', mode: 'companion', theme: 'day' },
  { id: '05-create-day', mode: 'create', theme: 'day' },
  { id: '06-reason-day', mode: 'reason', theme: 'day' },
  { id: '07-execution-day', panel: 'execution', theme: 'day' },
  { id: '08-memory-day', panel: 'memory', theme: 'day' },
  { id: '09-companion-night', mode: 'companion', theme: 'night' },
];

function childEnvironment(testCase, outputPath) {
  const env = { ...process.env };
  // Never pass existing Athena paths, provider credentials, persona overrides,
  // or Electron debugging/probe options into the isolated screenshot process.
  for (const key of Object.keys(env)) {
    if (/^(ATHENA_|ELECTRON_|OPENAI_|DEEPSEEK_|ANTHROPIC_|OLLAMA_)/i.test(key)
      || /API_KEY|ACCESS_TOKEN|SECRET/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    ATHENA_USE_LOCAL_SETTINGS: '0',
    ATHENA_PERSONA_PROFILE: `promo-public-preview-${crypto.randomUUID()}`,
    ATHENA_SMOKE_SCREENSHOT: outputPath,
    ATHENA_SMOKE_WIDTH: String(width),
    ATHENA_SMOKE_HEIGHT: String(height),
    ATHENA_SMOKE_THEME: testCase.theme,
  });
  if (testCase.mode) env.ATHENA_SMOKE_MODE = testCase.mode;
  if (testCase.panel) env.ATHENA_SMOKE_PANEL = testCase.panel;
  // --smoke-test gives the package a per-process temporary userData/config/DB.
  return env;
}

async function capture(testCase) {
  const outputPath = path.join(runtimeRoot, `${testCase.id}.png`);
  const logPath = path.join(runtimeRoot, `${testCase.id}.log`);
  const started = new Date().toISOString();
  const log = [`capture=${testCase.id}`, `started=${started}`, `executable=${executable}`];
  const result = await new Promise(resolve => {
    const child = spawn(executable, ['--smoke-test'], {
      cwd: projectRoot,
      env: childEnvironment(testCase, outputPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90_000);
    child.stdout.on('data', chunk => log.push(chunk.toString()));
    child.stderr.on('data', chunk => log.push(chunk.toString()));
    child.on('error', error => { log.push(`SPAWN_ERROR ${error.message}`); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut });
    });
  });
  const combined = log.join('\n');
  fs.writeFileSync(logPath, `${combined}\nresult=${JSON.stringify(result)}\n`, 'utf8');
  assert.equal(result.timedOut, false, `${testCase.id}: timed out`);
  assert.equal(result.code, 0, `${testCase.id}: package exited ${result.code}; see ${logPath}`);
  for (const marker of ['ATHENA_SMOKE_SCREENSHOT', 'ATHENA_SMOKE_READY_TO_SHOW', 'ATHENA_SMOKE_DOM_OK']) {
    assert(combined.includes(marker), `${testCase.id}: missing ${marker}; see ${logPath}`);
  }
  assert(!/ATHENA_SMOKE_(SCREENSHOT_FAILED|GATE_FAILED|RENDERER_ERROR|DOM_MISSING)/.test(combined), `${testCase.id}: smoke failure`);
  const png = fs.readFileSync(outputPath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not a PNG');
  const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  assert(dimensions.width >= width && dimensions.height >= height, 'Capture is smaller than requested');
  const record = {
    ...testCase,
    outputPath,
    logPath,
    ...dimensions,
    bytes: png.length,
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
    started,
    completed: new Date().toISOString(),
    source: 'Existing packaged Athena.exe --smoke-test; Electron webContents.capturePage(); isolated fresh public preview profile',
  };
  console.log(`CAPTURE_OK ${JSON.stringify(record)}`);
  return record;
}

async function main() {
  assert(fs.existsSync(executable), 'Packaged executable is missing');
  assert(fs.existsSync(archive), 'Packaged app archive is missing');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const asar = require(path.join(projectRoot, 'node_modules', '@electron', 'asar'));
  const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  const packagedMain = asar.extractFile(archive, path.join('dist', 'app', 'main.js')).toString();
  assert(packagedMain.includes('webContents.capturePage'), 'Package lacks the real runtime screenshot hook');
  const captures = [];
  for (const testCase of cases) captures.push(await capture(testCase));
  fs.writeFileSync(path.join(runtimeRoot, 'capture-manifest.json'), `${JSON.stringify({
    version: packagedMetadata.version,
    executable,
    archive,
    archiveModified: fs.statSync(archive).mtime.toISOString(),
    privacy: 'No existing personal config, database, persona, or provider environment was passed to the screenshot processes. No live model or microphone probe enabled.',
    captures,
  }, null, 2)}\n`, 'utf8');
  console.log(`CAPTURE_SET_OK count=${captures.length}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
