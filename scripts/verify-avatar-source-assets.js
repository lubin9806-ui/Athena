const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const manifestPath = path.join(PACKAGE_ROOT, 'manifest.json');
  const manifest = readJson(manifestPath);
  const sourcePath = path.join(PACKAGE_ROOT, manifest.sourceArt.frontReference);
  const liteModelPath = path.join(PACKAGE_ROOT, manifest.runtime.fallbackModel3Json);
  const runtimeModelPath = path.join(PACKAGE_ROOT, manifest.runtime.model3Json);
  const expectedCubismModelPath = path.join(PACKAGE_ROOT, manifest.runtime.expectedCubismModel3Json);

  assert.equal(manifest.id, 'athena-live2d-default');
  assert.equal(manifest.status, 'cubism_runtime_validated');
  assert.equal(manifest.providerTarget, 'live2d');
  assert.equal(manifest.runtime.runnable, true);
  assert.equal(manifest.runtime.engine, 'cubism-web');
  assert.equal(manifest.runtime.cubismRunnable, true);
  assert.equal(manifest.runtime.fallbackEngine, 'athena-live2d-lite');
  assert.ok(fs.existsSync(sourcePath), `missing source art: ${sourcePath}`);
  assert.ok(fs.statSync(sourcePath).size > 500000, 'source art is unexpectedly small');
  assert.ok(fs.existsSync(liteModelPath), `missing Live2D Lite model: ${liteModelPath}`);
  assert.ok(fs.existsSync(runtimeModelPath), `missing Cubism runtime model: ${runtimeModelPath}`);
  assert.ok(fs.existsSync(expectedCubismModelPath), `missing genuine Cubism export: ${expectedCubismModelPath}`);
  assert.ok(Array.isArray(manifest.riggingTargets.requiredParameters));
  assert.ok(manifest.riggingTargets.requiredParameters.includes('ParamMouthOpenY'));
  assert.ok(manifest.riggingTargets.requiredMotionGroups.includes('Speak'));
  console.log('ATHENA_AVATAR_SOURCE_ASSETS_OK package=athena-live2d-default status=cubism_runtime_validated liteFallback=true cubismExport=true cubismRuntime=true');
}

main();
