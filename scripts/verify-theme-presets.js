const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-theme-presets-'));
const config = path.join(scratch, 'config');
fs.mkdirSync(config, {recursive: true});
process.env.ATHENA_CONFIG_DIR = config;
process.env.ATHENA_USE_LOCAL_SETTINGS = '0';

const sourceRoot = path.join(root, 'src');
const compiledRoot = path.join(scratch, 'compiled');
const compileTree = directory => {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      compileTree(sourcePath);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    const relative = path.relative(sourceRoot, sourcePath).replace(/\.ts$/, '.js');
    const outputPath = path.join(compiledRoot, relative);
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: sourcePath,
    }).outputText;
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    fs.writeFileSync(outputPath, output);
  }
};
compileTree(sourceRoot);

const store = require(path.join(compiledRoot, 'core/config/SettingsStore.js'));
const presets = require(path.join(compiledRoot, 'shared/interfacePresets.js'));
const settingsFile = path.join(config, 'settings.json');
const modelFile = path.join(config, 'model.json');

try {
  assert.equal(store.getAppSettings().appearance.interfacePreset, 'daylight', 'new installs use daylight');
  fs.writeFileSync(settingsFile, JSON.stringify({version: 2, marker: 'keep-me', appearance: {theme: 'night', glassEffects: false, animationLevel: 'low'}}));
  const migrated = store.getAppSettings();
  assert.deepEqual(migrated.appearance, {interfacePreset: 'daylight', theme: 'night', animationLevel: 'low', glassEffects: false});

  const classic = store.saveAppearanceSettings({interfacePreset: 'classic'});
  assert.equal(classic.interfacePreset, 'classic');
  assert.equal(store.getAppSettings().appearance.interfacePreset, 'classic', 'explicit choice survives reload');
  const persisted = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(persisted.marker, 'keep-me', 'appearance save keeps unknown and unrelated settings');
  assert.equal(persisted.appearance.theme, 'night'); assert.equal(persisted.appearance.glassEffects, false);
  assert.equal(fs.existsSync(modelFile), false, 'appearance-only save must not create or rewrite model settings');

  const pending = store.saveAppearanceSettings({interfacePreset: 'atelier'});
  assert.equal(pending.interfacePreset, 'atelier', 'prototype preference may be retained');
  assert.deepEqual(presets.resolveInterfacePreset('atelier'), {requested: 'atelier', effective: 'daylight', available: false});
  assert.deepEqual(presets.resolveInterfacePreset('bad'), {requested: 'daylight', effective: 'daylight', available: true});

  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.ts'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(root, 'src/app/ipc/index.ts'), 'utf8');
  assert(html.includes('id="interface-preset-options"'));
  assert(!html.includes('icon-athena-mark'), 'provisional A mark removed');
  assert(appSource.includes("import { installApprovedBrand }"));
  assert(ipcSource.includes("'appearance:set'"));

  const mark = fs.readFileSync(path.join(root, 'docs/brand/companion-prototype/assets/athena-mark.svg'));
  const icons = fs.readFileSync(path.join(root, 'docs/brand/companion-prototype/assets/icons.svg'));
  assert.equal(crypto.createHash('sha256').update(mark).digest('hex').toUpperCase(), '55AA336147DF7D5FBCE9FC485AB421988DF6108301817E023B800DDFD383E578');
  assert.equal(crypto.createHash('sha256').update(icons).digest('hex').toUpperCase(), '3852D37EF58BAFCBD6A8D3459A68F02DCDB452914D8E4DC5FD43825808318783');
  for (const file of ['athena-brand.ico', 'athena-brand-icon.png', 'athena-tray.png']) assert(fs.statSync(path.join(root, 'resources', file)).size > 500);
  console.log('ATHENA_INTERFACE_PRESETS_OK default=daylight classic=ready atelier=prototype appearance-only=true brand=unchanged');
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
