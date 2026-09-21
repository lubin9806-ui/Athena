const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const ASAR_PATH = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar');

const FORBIDDEN_PACKAGE_PATTERNS = [
  /^assets\/avatar(?:\/|$)/,
  /^assets\/vendor\/live2d(?:\/|$)/,
  /^dist\/app\/avatar(?:\/|$)/,
  /^dist\/app\/live2d-preload\.js$/,
  /^dist\/core\/avatar(?:\/|$)/,
  /^dist\/renderer\/avatar(?:\/|$)/,
  /^dist\/renderer\/live2d-(?:pet|preview)(?:\.|\/)/,
  /^node_modules\/untitled-pixi-live2d-engine(?:\/|$)/,
  /^node_modules\/pixi\.js(?:\/|$)/,
];

const BUILDER_EXCLUSIONS = [
  '!dist/app/avatar/**/*',
  '!dist/app/live2d-preload.js',
  '!dist/core/avatar/**/*',
  '!dist/renderer/avatar/**/*',
  '!dist/renderer/live2d-*.html',
  '!dist/renderer/live2d-*.js',
  '!dist/renderer/live2d-*.css',
  '!node_modules/untitled-pixi-live2d-engine/**/*',
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function verifySourceContract() {
  assert.match(read('src/shared/releaseFeatures.ts'), /live2d:\s*false/, 'Live2D release feature must remain disabled');

  const vite = read('vite.config.mts');
  assert.match(
    vite,
    /disabledPaths\s*=\s*\[\s*['"]avatar['"]\s*,\s*['"]steam['"]\s*,\s*['"]vendor\/live2d['"]\s*\]/,
    'Vite must prune the complete renderer avatar, Steam, and vendored Live2D trees',
  );
  assert.doesNotMatch(vite, /\blive2dPet\s*:/, 'Vite must not build the disabled desktop-pet entry point');

  for (const config of ['electron-builder.yml', 'electron-builder.store.yml', 'electron-builder.steam.yml']) {
    const builder = read(config);
    const excludesAllSourceAssets = builder.includes('!assets/**/*');
    for (const exclusion of ['!assets/avatar/**/*', '!assets/vendor/live2d/**/*']) {
      assert.ok(
        excludesAllSourceAssets || builder.includes(exclusion),
        `${config} is missing disabled Live2D asset exclusion: ${exclusion}`,
      );
    }
    for (const exclusion of BUILDER_EXCLUSIONS) {
      assert.ok(builder.includes(exclusion), `${config} is missing disabled Live2D exclusion: ${exclusion}`);
    }
  }
}

function verifyBuiltRenderer() {
  const renderer = path.join(ROOT, 'dist', 'renderer');
  assert.ok(fs.existsSync(renderer), 'Renderer build is missing; run the Vite build first.');
  assert.equal(fs.existsSync(path.join(renderer, 'avatar')), false, 'Disabled renderer avatar assets were not pruned');
  for (const entry of ['live2d-pet.html', 'live2d-pet.js', 'live2d-preview.html', 'live2d-preview.js']) {
    assert.equal(fs.existsSync(path.join(renderer, entry)), false, `Disabled renderer entry was built: ${entry}`);
  }
}

function verifyAsar() {
  assert.ok(fs.existsSync(ASAR_PATH), `Desktop package is missing: ${ASAR_PATH}`);
  const entries = asar.listPackage(ASAR_PATH).map(value => value.replace(/^\\/, '').replace(/\\/g, '/'));
  for (const pattern of FORBIDDEN_PACKAGE_PATTERNS) {
    const leaked = entries.find(value => pattern.test(value));
    assert.equal(leaked, undefined, `Disabled Live2D code or asset leaked into ASAR: ${leaked}`);
  }
  console.log(`ATHENA_LIVE2D_RELEASE_GATE_OK live2d=disabled renderer=pruned package=excluded entries=${entries.length} builders=3`);
}

verifySourceContract();
verifyBuiltRenderer();
if (process.argv.includes('--source-only')) {
  console.log('ATHENA_LIVE2D_RELEASE_GATE_SOURCE_OK live2d=disabled renderer=pruned builders=3');
} else {
  verifyAsar();
}
