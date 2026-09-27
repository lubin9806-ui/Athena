'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'release', 'win-unpacked', 'Athena.exe');
const accountConfigPath = path.join(root, 'release', 'win-unpacked', 'resources', 'account-config.json');

assert.ok(fs.existsSync(executable), `Packaged executable is missing: ${executable}`);
assert.ok(fs.existsSync(accountConfigPath), `Packaged account config is missing: ${accountConfigPath}`);
const accountConfig = JSON.parse(fs.readFileSync(accountConfigPath, 'utf8'));
assert.deepEqual(accountConfig, {
  schemaVersion: 1,
  enabled: true,
  baseUrl: 'https://staging-api.elanastra.com',
}, 'Packaged account acceptance only runs against the approved staging endpoint.');

const result = spawnSync(executable, ['--account-staging-acceptance'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  timeout: 240_000,
  windowsHide: true,
  env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.signal, null, `Packaged account acceptance was terminated by ${result.signal}.`);
assert.equal(result.status, 0, `Packaged account acceptance exited with ${result.status}.`);

const transcript = `${result.stdout || ''}\n${result.stderr || ''}`;
assert.match(
  transcript,
  /ATHENA_PACKAGED_ACCOUNT_ACCEPTANCE_START packaged=true appPath=app\.asar endpoint=https:\/\/staging-api\.elanastra\.com profile=isolated/,
  'Packaged runtime did not prove app.asar and its embedded staging endpoint.',
);
assert.match(
  transcript,
  /ATHENA_PACKAGED_ACCOUNT_ACCEPTANCE_OK endpoint=https:\/\/staging-api\.elanastra\.com endpointSource=packaged-resource .*adultMode=true firstLogin=blocked conflict=explicit sync=cloud logout=local-preserved deviceRevoke=verified cleanup=cryptographic-erase/,
  'Packaged runtime did not complete the account/sync acceptance contract.',
);
assert.match(
  transcript,
  /ATHENA_PACKAGED_ACCOUNT_ACCEPTANCE_CLEANUP_OK profile=removed/,
  'Packaged runtime did not remove its isolated local profile.',
);
console.log('ATHENA_PACKAGED_CLOUD_STAGING_OK package=app.asar endpointSource=packaged-resource account=deleted profile=removed');
