const path = require('path');
const { spawn } = require('child_process');

const loggerPath = path.resolve(__dirname, '../dist/engine/Logger.js');
const childCode = `
  const { createLogger } = require(${JSON.stringify(loggerPath)});
  const logger = createLogger('PipeProbe');
  setTimeout(() => logger.info('write after parent closes stdout'), 40);
  setTimeout(() => process.exit(0), 120);
`;

const child = spawn(process.execPath, ['-e', childCode], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.destroy();
child.stderr.destroy();

const timeout = setTimeout(() => {
  child.kill();
  console.error('logger pipe guard timed out');
  process.exitCode = 1;
}, 3000);

child.once('exit', (code, signal) => {
  clearTimeout(timeout);
  if (code !== 0 || signal) {
    console.error(`logger pipe guard failed: code=${code} signal=${signal || 'none'}`);
    process.exitCode = 1;
    return;
  }
  console.log('logger pipe guard OK');
});
