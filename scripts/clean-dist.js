const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, 'dist');
if (path.dirname(target) !== root || path.basename(target) !== 'dist') {
  throw new Error(`Refusing unsafe dist cleanup: ${target}`);
}
fs.rmSync(target, { recursive: true, force: true });
console.log('DIST_CLEAN_OK');
