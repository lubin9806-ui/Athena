/**
 * Run the Electron smoke test with the microphone stages enabled.
 *
 * The voice stages are behind ATHENA_SMOKE_VOICE because they arm a microphone
 * grant and drive a real recording session. A tiny launcher keeps the env var
 * out of the npm script, where the syntax differs per shell.
 *
 * These stages cover what the pure detector suite cannot: that the recording
 * animation is still fed while listening and cleared afterwards.
 */
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const electron = require('electron');

const child = spawn(electron, ['.', '--smoke-test'], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, ATHENA_SMOKE_VOICE: '1' },
});

child.on('error', (error) => {
  console.error(`ATHENA_VOICE_SMOKE_FAILED ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => {
  process.exit(code === null ? 1 : code);
});
