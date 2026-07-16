'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config');

const root = path.resolve(__dirname, '..');
const workspace = path.resolve(root, '..');
const required = [
  'README.md', 'package.json', 'package-lock.json', 'config/provider-policies.json',
  'src/config.js', 'src/crypto.js', 'src/database.js', 'src/services.js', 'src/lifecycle.js', 'src/server.js', 'src/ports.js',
  '../docs/cloud/ARCHITECTURE.md', '../docs/cloud/API_V1.md', '../docs/cloud/THREAT_MODEL.md',
  '../docs/cloud/OPERATIONS_SLO.md', '../docs/cloud/PENETRATION_BASELINE.md', '../docs/cloud/PROVIDER_REGISTER.md',
  '../docs/cloud/CLOUD_GO_NO_GO.md',
];
for (const relative of required) {
  const resolved = path.resolve(root, relative);
  if (!fs.existsSync(resolved)) throw new Error(`Required Cloud artifact is missing: ${relative}`);
}

const sourceFiles = walk(path.join(root, 'src')).filter((file) => file.endsWith('.js'));
const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
for (const forbidden of [
  /require\(['"]electron['"]\)/,
  /src[\\/]app/,
  /src[\\/]core[\\/]tools/,
  /database[\\/]athena\.db/,
  /\/v1\/(computer|desktop|terminal|tools)/,
]) {
  if (forbidden.test(source)) throw new Error(`Cloud boundary contains forbidden Desktop coupling: ${forbidden}`);
}
if (!source.includes("AES-256-GCM") && !source.includes("aes-256-gcm")) throw new Error('At-rest encryption implementation was not found.');
if (!source.includes('tenant_id=?')) throw new Error('Tenant-scoped query pattern was not found.');

assertProductionFailsClosed();
const policies = JSON.parse(fs.readFileSync(path.join(root, 'config', 'provider-policies.json'), 'utf8'));
if (policies.productionDecision !== null || policies.providers.some((provider) => provider.id === 'local-fixture' && provider.productionEligible)) {
  throw new Error('Local provider must not be production eligible.');
}

const testFiles = fs.readdirSync(path.join(root, 'test'))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => path.join('test', name));
const tests = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
  cwd: root, encoding: 'utf8', shell: false,
});
process.stdout.write(tests.stdout || '');
process.stderr.write(tests.stderr || '');
if (tests.status !== 0) throw new Error(`Cloud tests failed with exit code ${tests.status}.`);

const testCount = (tests.stdout.match(/^✔ /gm) || []).length;
process.stdout.write(`ATHENA_CLOUD_1_0_ENGINEERING_OK tests=${testCount} boundary=independent production=no-go billing=local-no-charge\n`);

function assertProductionFailsClosed() {
  let blocked = false;
  try { loadConfig({ environment: 'production' }); } catch (error) { blocked = /Production Cloud configuration blocked/.test(error.message); }
  if (!blocked) throw new Error('Production configuration did not fail closed.');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(resolved) : [resolved];
  });
}
