const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const desktopPath = path.join(root, '.github', 'workflows', 'desktop-beta.yml');
const storePath = path.join(root, '.github', 'workflows', 'microsoft-store-private-beta.yml');

function readWorkflow(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireStep(workflow, jobName, stepName) {
  const job = workflow.jobs?.[jobName];
  assert(job, `Workflow is missing job ${jobName}.`);
  const step = job.steps?.find(candidate => candidate.name === stepName);
  assert(step, `${jobName} is missing step ${stepName}.`);
  assert.equal(typeof step.run, 'string', `${jobName}/${stepName} must be a run step.`);
  return step.run;
}

function assertFailFast(script, label) {
  assert.match(
    script,
    /\$PSNativeCommandUseErrorActionPreference\s*=\s*\$true/,
    `${label} must fail when any native command fails, not only when its last command fails.`,
  );
}

const desktop = readWorkflow(desktopPath);
const store = readWorkflow(storePath);

const nodeModules = requireStep(desktop, 'module-audit', 'Verify Node and service modules');
const electronModules = requireStep(desktop, 'module-audit', 'Verify Electron-backed modules');
const productRegression = requireStep(desktop, 'clean-checkout', 'Verify product regression suite');
const signedBuild = requireStep(desktop, 'clean-checkout', 'Build signed candidate');
const auditClean = requireStep(desktop, 'module-audit', 'Prove audit checkout remained clean');
const releaseSourceTime = requireStep(desktop, 'clean-checkout', 'Record deterministic source time');
const releaseTag = requireStep(desktop, 'clean-checkout', 'Verify release tag identity');
const releaseClean = requireStep(desktop, 'clean-checkout', 'Prove checkout remained clean');
const packagedSmoke = requireStep(desktop, 'clean-checkout', 'Packaged smoke');
const storeGates = requireStep(store, 'appx', 'Verify shared product gates');
const storeClean = requireStep(store, 'appx', 'Prove checkout remained clean');

for (const [label, script] of [
  ['desktop node/service audit', nodeModules],
  ['desktop Electron audit', electronModules],
  ['desktop product regression', productRegression],
  ['desktop signed build', signedBuild],
  ['desktop audit clean-checkout proof', auditClean],
  ['desktop deterministic source time', releaseSourceTime],
  ['desktop release tag identity', releaseTag],
  ['desktop release clean-checkout proof', releaseClean],
  ['Store shared gates', storeGates],
  ['Store clean-checkout proof', storeClean],
]) {
  assertFailFast(script, label);
}

for (const command of [
  'test:cloud-sync-boundaries',
  'test:chat-handoff',
  'test:memory-recall-evals',
  'test:memory-embeddings',
  'test:project-documents',
  'test:execute:e2e',
]) {
  assert(
    electronModules.includes(`npm.cmd run ${command}`),
    `Desktop CI is missing release-critical regression ${command}.`,
  );
}

assert(nodeModules.includes('npm.cmd run test:ci-workflows'), 'Desktop CI must enforce its own workflow contract.');
assert.equal(packagedSmoke.trim(), 'npm.cmd run test:packaged-smoke', 'Packaged smoke must use the blocking marker-verifying wrapper.');
assert(!electronModules.includes('test:execute:live'), 'Live model execution must not run in the ordinary PR workflow.');
assert(!electronModules.includes('test:memory-embeddings:live'), 'Live embeddings must not run in the ordinary PR workflow.');

if (process.platform === 'win32') {
  const probe = spawnSync('pwsh.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference = 'Stop'; $PSNativeCommandUseErrorActionPreference = $true; & cmd.exe /d /c exit 23; & cmd.exe /d /c exit 0",
  ], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(probe.status, 0, 'PowerShell fail-fast probe swallowed an intermediate native command failure.');
}

console.log('ATHENA_CI_WORKFLOWS_OK failFast=native protectedSteps=10 criticalRegressions=6 liveSecrets=excluded');
