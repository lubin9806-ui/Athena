const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-skill-library-'));
const builtinRoot = path.join(scratch, 'builtin');
const externalRoot = path.join(scratch, 'external');
const userRoot = path.join(scratch, 'user');
const stateFile = path.join(scratch, 'skills-state.json');

function writeSkill(base, name, options = {}) {
  const directory = path.join(base, name);
  fs.mkdirSync(path.join(directory, 'references'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${options.description || `Use ${name} when the fixture asks for specialized work.`}`,
    'license: MIT',
    'metadata:',
    `  version: "${options.version || '1.0.0'}"`,
    options.allowedTools ? `allowed-tools: ${options.allowedTools}` : '',
    '---',
    '',
    options.instructions || `Follow the ${name} fixture workflow exactly.`,
    '',
    'Read references/GUIDE.md only when detailed fixture guidance is needed.',
  ].filter(Boolean).join('\n'));
  fs.writeFileSync(path.join(directory, 'references', 'GUIDE.md'), `# ${name}\nDetailed fixture guidance.\n`);
  if (options.script) {
    fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'scripts', 'run.js'), 'console.log("must not auto-run");\n');
  }
  return directory;
}

const builtinDirectory = writeSkill(builtinRoot, 'builtin-review');
const externalDirectory = writeSkill(externalRoot, 'web-game-builder', {
  allowedTools: 'Bash(git:*) Read',
  script: true,
});

const { SkillLibrary } = require(path.join(root, 'dist', 'core', 'skills', 'SkillLibrary.js'));
const { SkillAgentToolBridge } = require(path.join(root, 'dist', 'core', 'skills', 'SkillAgentToolBridge.js'));
const { ToolRegistry } = require(path.join(root, 'dist', 'core', 'agent', 'ToolRegistry.js'));

let exitCode = 0;
(async () => {
try {
  const options = {
    roots: [
      { source: 'builtin', path: builtinRoot },
      { source: 'user', path: userRoot },
      { source: 'external', path: externalRoot },
    ],
    stateFile,
    userRoot,
  };
  const library = new SkillLibrary(options);
  let skills = library.discover();
  const builtin = skills.find(skill => skill.name === 'builtin-review');
  const external = skills.find(skill => skill.name === 'web-game-builder');
  assert.equal(builtin.trust, 'builtin');
  assert.equal(builtin.enabled, true);
  assert.equal(external.trust, 'untrusted');
  assert.equal(external.enabled, false);
  assert.equal(external.hasScripts, true);
  assert.match(external.warnings.join(' '), /does not grant Athena permissions/);
  assert.throws(() => library.load('web-game-builder', { runId: 'run-0', stepId: 'step-0' }), /disabled|not trusted/);

  const installed = library.installFromDirectory(externalDirectory);
  assert.equal(installed.source, 'user');
  assert.equal(installed.trust, 'untrusted');
  assert.throws(() => library.installFromDirectory(externalDirectory), /already installed/);
  assert.throws(() => library.installFromDirectory(builtinDirectory), /conflicts with builtin package/);
  const approved = library.setTrust(installed.name, installed.packageHash, 'approved');
  assert.equal(approved.enabled, false, 'approval must not silently enable a third-party skill');
  const enabled = library.setEnabled(installed.name, installed.packageHash, true);
  assert.equal(enabled.enabled, true);

  const registry = new ToolRegistry();
  const bridge = new SkillAgentToolBridge(registry, library);
  const registered = bridge.refresh();
  assert.deepEqual(registered.sort(), ['list_skills', 'load_skill', 'read_skill_resource']);
  const loadCall = { id: 'call-load', name: 'load_skill', arguments: { name: 'web-game-builder' }, rawArguments: '{"name":"web-game-builder"}' };
  const resolved = registry.resolve(loadCall);
  assert.equal(resolved.policy.capability, 'skills.read');
  assert.equal(resolved.policy.access, 'read');
  const result = await registry.executeResolved(loadCall, resolved, {
    runId: 'run-1', stepId: 'step-1', callId: loadCall.id, attempt: 1,
    idempotencyKey: 'fixture', signal: new AbortController().signal,
  });
  assert.match(result.content, /Follow the web-game-builder fixture workflow/);
  assert.match(result.content, /informational only/);
  assert.equal(library.snapshot().invocations[0].runId, 'run-1');
  assert.equal(library.snapshot().invocations[0].resourcePath, 'SKILL.md');
  const privacyBeforeClear = library.getPrivacyData();
  assert.equal(privacyBeforeClear.invocations.length, 1);
  assert.equal(privacyBeforeClear.packages[installed.packageHash].trust, 'approved');
  assert.equal(library.clearInvocationHistory(), 1);
  const privacyAfterClear = library.getPrivacyData();
  assert.equal(privacyAfterClear.invocations.length, 0);
  assert.equal(privacyAfterClear.packages[installed.packageHash].enabled, true, 'privacy clear must preserve explicit skill state');
  assert.throws(() => library.readResource('web-game-builder', '../secret.txt', { runId: 'run-1', stepId: 'step-1' }), /Invalid skill resource path/);

  fs.appendFileSync(path.join(userRoot, 'web-game-builder', 'references', 'GUIDE.md'), '\nChanged after approval.\n');
  assert.throws(
    () => library.readResource('web-game-builder', 'references/GUIDE.md', { runId: 'run-1', stepId: 'step-1' }),
    /changed and must be reviewed again/,
  );

  fs.appendFileSync(path.join(userRoot, 'web-game-builder', 'SKILL.md'), '\nChanged package content.\n');
  const userOnlyLibrary = new SkillLibrary({
    roots: [{ source: 'builtin', path: builtinRoot }, { source: 'user', path: userRoot }],
    stateFile,
    userRoot,
  });
  skills = userOnlyLibrary.discover();
  const changed = skills.find(skill => skill.name === 'web-game-builder');
  assert.notEqual(changed.packageHash, installed.packageHash);
  assert.equal(changed.trust, 'untrusted', 'changed package hashes must lose prior approval');
  assert.equal(changed.enabled, false);

  const bad = path.join(externalRoot, 'Bad_Name');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'SKILL.md'), '---\nname: Bad_Name\ndescription: invalid\n---\nbody\n');
  assert.throws(() => library.installFromDirectory(bad), /Invalid skill name/);
  library.discover();
  assert.ok(library.snapshot().diagnostics.some(item => item.path.endsWith('Bad_Name') && /Invalid skill name/.test(item.error)));

  const rollbackSource = writeSkill(externalRoot, 'rollback-check');
  const brokenStateFile = path.join(scratch, 'state-is-a-directory');
  fs.mkdirSync(brokenStateFile);
  const rollbackLibrary = new SkillLibrary({
    roots: [{ source: 'user', path: userRoot }],
    stateFile: brokenStateFile,
    userRoot,
  });
  assert.throws(() => rollbackLibrary.installFromDirectory(rollbackSource), /real file|EISDIR|EPERM|EEXIST/);
  assert.equal(fs.existsSync(path.join(userRoot, 'rollback-check')), false, 'failed state commit must roll back installed files');
  const directRollbackSkill = writeSkill(userRoot, 'rollback-uninstall');
  const rollbackSkills = rollbackLibrary.discover();
  const rollbackInstalled = rollbackSkills.find(skill => skill.name === 'rollback-uninstall');
  assert(rollbackInstalled);
  assert.throws(() => rollbackLibrary.uninstall(rollbackInstalled.name, rollbackInstalled.packageHash), /real file|EISDIR|EPERM|EEXIST/);
  assert.equal(fs.existsSync(directRollbackSkill), true, 'failed state commit must restore an uninstalled package');

  const sanitizedStateFile = path.join(scratch, 'sanitized-state.json');
  fs.writeFileSync(sanitizedStateFile, JSON.stringify({
    version: 1,
    packages: {
      invalid: { trust: 'approved', enabled: true },
      ['a'.repeat(64)]: { trust: 'owner', enabled: true },
      ['b'.repeat(64)]: { trust: 'approved', enabled: true },
    },
    invocations: [{ skillName: '../escape', packageHash: 'b'.repeat(64) }],
  }));
  const sanitizedLibrary = new SkillLibrary({ roots: [], stateFile: sanitizedStateFile, userRoot });
  const sanitized = sanitizedLibrary.getPrivacyData();
  assert.deepEqual(Object.keys(sanitized.packages), ['b'.repeat(64)]);
  assert.equal(sanitized.invocations.length, 0);

  const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
  for (const channel of ['skill:list', 'skill:installFromDirectory', 'skill:setTrust', 'skill:setEnabled', 'skill:uninstall']) {
    assert.ok(ipc.includes(`'${channel}'`));
  }
  assert.match(renderer, /真实加载记录/);
  assert.match(renderer, /当前不会自动调用/);
  assert.equal(userOnlyLibrary.uninstall(changed.name, changed.packageHash), true);
  assert.equal(fs.existsSync(path.join(userRoot, 'web-game-builder')), false);
  bridge.shutdown();
  console.log(`ATHENA_SKILL_LIBRARY_OK discovered=${skills.length} tools=${registered.length} invocation=recorded hash_reapproval=required`);
} catch (error) {
  exitCode = 1;
  console.error(error && error.stack ? error.stack : error);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

process.exit(exitCode);
})();
