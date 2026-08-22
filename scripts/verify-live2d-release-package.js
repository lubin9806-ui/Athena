const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const ASAR_PATH = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar');

const REQUIRED_RUNTIME_ENTRIES = [
  'dist/app/live2d-preload.js',
  'dist/renderer/live2d-pet.html',
  'dist/renderer/avatar/athena-live2d-default/model/athena-live2d-default-sdk5.model3.json',
  'dist/renderer/avatar/athena-live2d-default/model/athena-live2d-default-sdk5.moc3',
  'dist/renderer/avatar/athena-live2d-default/model/athena-live2d-default.physics3.json',
  'dist/renderer/avatar/athena-live2d-default/model/athena-live2d-default-sdk5.4096/texture_00.png',
  'dist/renderer/vendor/live2d/live2dcubismcore.min.js',
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /(?:^|\/)athena-live2d-default\/source(?:\/|$)/,
  /(?:^|\/)athena-live2d-default\/CUBISM_EXPORT_RUNBOOK\.md$/,
  /(?:^|\/)athena-live2d-default\/layer-map\.json$/,
  /(?:^|\/)athena-3d-default(?:\/|$)/,
  /^assets\/avatar(?:\/|$)/,
  /^assets\/vendor\/live2d(?:\/|$)/,
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function verifySourceContract() {
  const vite = read('vite.config.mts');
  for (const privatePath of [
    'avatar/athena-live2d-default/source',
    'avatar/athena-live2d-default/CUBISM_EXPORT_RUNBOOK.md',
    'avatar/athena-live2d-default/layer-map.json',
    'avatar/athena-3d-default',
  ]) {
    assert.ok(vite.includes(`'${privatePath}'`), `Vite release pruning is missing ${privatePath}`);
  }
  for (const config of ['electron-builder.yml', 'electron-builder.store.yml', 'electron-builder.steam.yml']) {
    const builder = read(config);
    assert.ok(builder.includes('!assets/avatar/**/*'), `${config} must exclude direct avatar source duplication`);
    assert.ok(builder.includes('!assets/vendor/live2d/**/*'), `${config} must exclude direct Cubism Core duplication`);
  }
}

function verifyBuiltRenderer() {
  const renderer = path.join(ROOT, 'dist', 'renderer');
  assert.ok(fs.existsSync(renderer), 'Renderer build is missing; run the Vite build first.');
  for (const relativePath of REQUIRED_RUNTIME_ENTRIES.filter(value => value.startsWith('dist/renderer/'))) {
    assert.ok(fs.existsSync(path.join(ROOT, relativePath)), `Renderer runtime asset is missing: ${relativePath}`);
  }
  for (const forbiddenPath of [
    'dist/renderer/avatar/athena-live2d-default/source',
    'dist/renderer/avatar/athena-live2d-default/CUBISM_EXPORT_RUNBOOK.md',
    'dist/renderer/avatar/athena-live2d-default/layer-map.json',
    'dist/renderer/avatar/athena-3d-default',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, forbiddenPath)), false, `Private build asset leaked: ${forbiddenPath}`);
  }
}

function verifyAsar() {
  assert.ok(fs.existsSync(ASAR_PATH), `Desktop package is missing: ${ASAR_PATH}`);
  const entries = asar.listPackage(ASAR_PATH).map(value => value.replace(/^\\/, '').replace(/\\/g, '/'));
  for (const required of REQUIRED_RUNTIME_ENTRIES) {
    assert.ok(entries.includes(required), `Packaged Live2D runtime asset is missing: ${required}`);
  }
  const expressionCount = entries.filter(value => /\/expressions\/[^/]+\.exp3\.json$/.test(value)).length;
  const motionCount = entries.filter(value => /\/motions\/[^/]+\.motion3\.json$/.test(value)).length;
  assert.ok(expressionCount >= 11, `Expected at least 11 packaged expressions, found ${expressionCount}`);
  assert.ok(motionCount >= 17, `Expected at least 17 packaged motions including idle variants, found ${motionCount}`);
  for (const pattern of FORBIDDEN_ENTRY_PATTERNS) {
    const leaked = entries.find(value => pattern.test(value));
    assert.equal(leaked, undefined, `Private or duplicate avatar asset leaked into ASAR: ${leaked}`);
  }
  const core = asar.extractFile(ASAR_PATH, 'dist/renderer/vendor/live2d/live2dcubismcore.min.js');
  assert.ok(core.length > 200_000, 'Packaged Cubism Core is unexpectedly small.');
  console.log(`ATHENA_LIVE2D_PACKAGE_OK entries=${entries.length} expressions=${expressionCount} motions=${motionCount} privateSources=excluded coreBytes=${core.length}`);
}

verifySourceContract();
verifyBuiltRenderer();
if (process.argv.includes('--source-only')) {
  console.log('ATHENA_LIVE2D_PACKAGE_SOURCE_OK runtimeAssets=present privateSources=excluded builders=3');
} else {
  verifyAsar();
}
