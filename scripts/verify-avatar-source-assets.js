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
  const expectedModelPath = path.join(PACKAGE_ROOT, manifest.runtime.expectedModel3Json);

  assert.equal(manifest.id, 'athena-live2d-default');
  assert.equal(manifest.status, 'source_art_only');
  assert.equal(manifest.providerTarget, 'live2d');
  assert.equal(manifest.runtime.runnable, false);
  assert.ok(manifest.runtime.blockedReason.includes('Cubism Editor export'));
  assert.ok(fs.existsSync(sourcePath), `missing source art: ${sourcePath}`);
  assert.ok(fs.statSync(sourcePath).size > 500000, 'source art is unexpectedly small');
  assert.equal(fs.existsSync(expectedModelPath), false, 'source package must not pretend to contain a runnable model3.json yet');
  assert.ok(Array.isArray(manifest.riggingTargets.requiredParameters));
  assert.ok(manifest.riggingTargets.requiredParameters.includes('ParamMouthOpenY'));
  assert.ok(manifest.riggingTargets.requiredMotionGroups.includes('Speak'));
  console.log('ATHENA_AVATAR_SOURCE_ASSETS_OK package=athena-live2d-default status=source_art_only runnable=false');
}

main();

