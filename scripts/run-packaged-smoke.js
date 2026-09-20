const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'release', 'win-unpacked', 'Athena.exe');
const result = spawnSync(executable, ['--smoke-test'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
  timeout: 120_000,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.signal, null, `Packaged smoke was terminated by ${result.signal}.`);
assert.equal(result.status, 0, `Packaged smoke exited with ${result.status}.`);

const transcript = `${result.stdout || ''}\n${result.stderr || ''}`;
assert.match(transcript, /ATHENA_SMOKE_READY_TO_SHOW/, 'Packaged smoke did not reach ready-to-show.');
assert.match(transcript, /ATHENA_SMOKE_DOM_OK/, 'Packaged smoke did not complete the DOM gate.');
console.log('ATHENA_PACKAGED_SMOKE_OK markers=ready-to-show,dom');
