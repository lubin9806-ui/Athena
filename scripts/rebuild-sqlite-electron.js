const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const cli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const result = spawnSync(process.execPath, [
  cli,
  '--force',
  '--which-module', 'better-sqlite3',
  '--version', electronVersion,
  '--arch', 'x64',
  '--module-dir', root,
], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
