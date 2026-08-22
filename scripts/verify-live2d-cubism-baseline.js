const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scanLive2DModelPackage } = require('../dist/core/avatar');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const modelPath = path.join(PACKAGE_ROOT, manifest.runtime.expectedCubismModel3Json);
  const model = readJson(modelPath);
  const mocPath = path.join(path.dirname(modelPath), model.FileReferences.Moc);
  const texturePaths = model.FileReferences.Textures.map(file => path.join(path.dirname(modelPath), file));
  const mocHeader = fs.readFileSync(mocPath).subarray(0, 4).toString('ascii');

  assert.equal(manifest.production.cubismRigged, true);
  assert.equal(manifest.production.rigQuality, 'baseline_automatic_unpolished');
  assert.equal(manifest.production.cubismExported, true);
  assert.equal(manifest.production.visibleEyeAndMouthDeformationPolished, false);
  assert.equal(manifest.production.physicsReady, false);
  assert.equal(manifest.production.expressionsReady, false);
  assert.equal(manifest.production.motionsReady, false);
  assert.equal(manifest.production.hitAreasReady, false);
  assert.ok(fs.statSync(path.join(PACKAGE_ROOT, manifest.production.cubismProject)).size > 1000000);
  assert.equal(mocHeader, 'MOC3', 'exported file does not have a Cubism MOC3 header');
  assert.ok(fs.statSync(mocPath).size > 50000, 'exported moc3 is unexpectedly small');
  assert.equal(texturePaths.length, 1);
  assert.ok(fs.statSync(texturePaths[0]).size > 1000000, 'exported texture is unexpectedly small');

  const groups = Object.fromEntries(model.Groups.map(group => [group.Name, group.Ids]));
  assert.deepEqual(groups.EyeBlink, ['ParamEyeLOpen', 'ParamEyeROpen']);
  assert.deepEqual(groups.LipSync, ['ParamMouthOpenY']);

  const scan = scanLive2DModelPackage({
    rootPath: path.dirname(modelPath),
    model3JsonPath: modelPath,
  });
  assert.equal(scan.warnings.length, 0, `manifest warnings: ${scan.warnings.join('; ')}`);
  assert.ok(scan.referencedFiles.some(file => file.kind === 'moc' && file.exists));
  assert.ok(scan.referencedFiles.some(file => file.kind === 'texture' && file.exists));
  assert.ok(scan.inventory.lipSyncParameters.includes('ParamMouthOpenY'));

  console.log(`ATHENA_LIVE2D_CUBISM_BASELINE_OK moc=${fs.statSync(mocPath).size} textures=${texturePaths.length} eyeBlink=2 lipSync=1 rig=${manifest.production.rigQuality}`);
}

main();
