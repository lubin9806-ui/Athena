const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const runCount = clampInt(process.env.ATHENA_SMOKE_STABILITY_RUNS, 3, 2, 10);

runNode(path.join(root, 'scripts', 'clean-dist.js'), []);
runNode(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ['build', '--config', 'vite.config.mts']);
runNode(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), []);

const electronPath = require('electron');
const durations = [];
for (let index = 0; index < runCount; index += 1) {
  const started = Date.now();
  const result = spawnSync(electronPath, ['.', '--smoke-test'], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  durations.push(Date.now() - started);
  if (result.status !== 0 || result.error || !output.includes('ATHENA_SMOKE_READY_TO_SHOW') || !output.includes('ATHENA_SMOKE_DOM_OK')) {
    process.stderr.write(output);
    throw result.error || new Error(`smoke stability run ${index + 1}/${runCount} failed with exit ${result.status}`);
  }
  assert(!output.includes('ATHENA_SMOKE_GATE_FAILED'), `run ${index + 1} reported a failed gate despite exit 0`);
}

console.log(`ATHENA_SMOKE_STABILITY_OK runs=${runCount} durationsMs=${durations.join(',')}`);

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function clampInt(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}
