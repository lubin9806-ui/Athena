const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-image-runtime-live-'));

(async () => {
  await app.whenReady();
  const { LocalImageRuntimeManager } = require(path.join(root, 'dist', 'core', 'artifacts', 'index.js'));
  const phases = [];
  const manager = new LocalImageRuntimeManager({
    manifestPath: path.join(root, 'resources', 'image-runtime', 'runtime-manifest.json'),
    installBase: path.join(scratch, 'runtime'),
  });
  const result = await manager.install('cpu', progress => {
    if (phases.at(-1) !== progress.phase) phases.push(progress.phase);
  }, AbortSignal.timeout(10 * 60_000));
  assert.equal(result.backend, 'cpu');
  assert.equal(fs.existsSync(result.runtimePath), true);
  assert.deepEqual(phases, ['preparing', 'downloading', 'verifying', 'extracting', 'complete']);
  const help = await runHelp(result.runtimePath);
  assert.match(help, /stable-diffusion/i);
  assert.match(help, /--backend/);
  assert.match(help, /--output/);
  assert.match(help, /--sampling-method/);
  assert.match(help, /--cfg-scale/);
  assert.match(help, /--vae-tiling/);
  console.log(`ATHENA_IMAGE_RUNTIME_LIVE_OK variant=cpu sha256=verified executable=${path.basename(result.runtimePath)} phases=${phases.join(',')}`);
})().then(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error?.stack || error);
  fs.rmSync(scratch, { recursive: true, force: true });
  app.exit(1);
});

function runHelp(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-h'], {
      cwd: path.dirname(executable),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('sd-cli help probe timed out'));
    }, 30_000);
    child.stdout.on('data', chunk => { if (output.length < 128_000) output += String(chunk); });
    child.stderr.on('data', chunk => { if (output.length < 128_000) output += String(chunk); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(`sd-cli help probe failed with exit code ${code}`));
    });
  });
}
