const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scanLive2DModelPackage } = require('../dist/core/avatar');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const packageRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'avatar', 'athena-live2d-default'));
  const handoffManifest = readJson(path.join(packageRoot, 'manifest.json'));
  const layerMap = readJson(path.join(packageRoot, 'layer-map.json'));
  const expectedModelPath = path.join(packageRoot, handoffManifest.runtime.expectedCubismModel3Json);

  assert.equal(handoffManifest.production.visibleEyeAndMouthDeformationPolished, true, 'eye and mouth deformation is not production-polished');
  assert.equal(handoffManifest.production.physicsReady, true, 'physics is not production-ready');
  assert.equal(handoffManifest.production.expressionsReady, true, 'expressions are not production-ready');
  assert.equal(handoffManifest.production.motionsReady, true, 'motions are not production-ready');
  assert.equal(handoffManifest.production.hitAreasReady, true, 'hit areas are not production-ready');

  assert.ok(fs.existsSync(expectedModelPath), `missing exported model3.json: ${expectedModelPath}`);
  const scan = scanLive2DModelPackage({
    rootPath: path.dirname(expectedModelPath),
    model3JsonPath: expectedModelPath,
  });
  assert.equal(scan.warnings.length, 0, `manifest warnings: ${scan.warnings.join('; ')}`);
  assert.ok(scan.referencedFiles.some(file => file.kind === 'moc' && file.exists), 'missing referenced .moc3 file');
  assert.ok(scan.referencedFiles.some(file => file.kind === 'texture' && file.exists), 'missing referenced texture');

  for (const parameterId of handoffManifest.riggingTargets.requiredParameters) {
    if (parameterId === 'ParamMouthOpenY') {
      assert.ok(scan.inventory.lipSyncParameters.includes(parameterId), `missing lip-sync parameter group: ${parameterId}`);
    }
  }
  for (const hitArea of layerMap.requiredHitAreas) {
    assert.ok(scan.inventory.hitAreas.includes(hitArea.id), `missing hit area: ${hitArea.id}`);
  }
  for (const group of layerMap.requiredMotionGroups) {
    assert.ok(Object.prototype.hasOwnProperty.call(scan.inventory.motionGroups, group), `missing motion group: ${group}`);
  }
  console.log(`ATHENA_LIVE2D_PRODUCTION_PACKAGE_OK package=${handoffManifest.id} model3=${expectedModelPath}`);
}

main();
