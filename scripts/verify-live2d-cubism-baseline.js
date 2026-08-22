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
  const mocBuffer = fs.readFileSync(mocPath);
  const mocHeader = mocBuffer.subarray(0, 4).toString('ascii');

  assert.equal(manifest.production.cubismRigged, true);
  assert.equal(manifest.production.rigQuality, 'baseline_automatic_unpolished');
  assert.equal(manifest.production.cubismExported, true);
  assert.equal(manifest.production.defaultVisualReady, true);
  assert.equal(manifest.production.defaultVisualSource, 'ATH_REFERENCE_COMPOSITE');
  assert.equal(manifest.production.referenceCompositeAtlased, true);
  assert.equal(manifest.production.generatedRigPartsDefaultHidden, true);
  assert.equal(manifest.production.hiddenRigPartsExported, true);
  assert.equal(manifest.production.expressionVariantSourceReady, true);
  assert.equal(manifest.production.expressionVariantCount, 3);
  assert.equal(manifest.production.expressionVariantArtMeshesAtlased, true);
  assert.equal(manifest.production.visibleBlinkVariantBound, true);
  assert.equal(manifest.production.visibleMouthOpenVariantBound, true);
  assert.equal(manifest.production.visibleSmileVariantBound, true);
  assert.equal(manifest.production.visibleEyeAndMouthDeformationPolished, false);
  assert.equal(manifest.production.physicsReady, true);
  assert.equal(manifest.production.expressionsReady, false);
  assert.equal(manifest.production.motionsReady, true);
  assert.equal(manifest.production.hitAreasReady, false);
  assert.ok(fs.statSync(path.join(PACKAGE_ROOT, manifest.production.cubismProject)).size > 1000000);
  const expressionMetadataPath = path.join(PACKAGE_ROOT, manifest.sourceArt.expressionVariantsMetadata);
  const expressionPsdPath = path.join(PACKAGE_ROOT, manifest.sourceArt.expressionVariantsPsd);
  const expressionSheetPath = path.join(PACKAGE_ROOT, manifest.sourceArt.expressionVariantsContactSheet);
  const expressionMetadata = readJson(expressionMetadataPath);
  assert.deepEqual(expressionMetadata.variants.map(variant => variant.id), ['blink', 'speak', 'happy']);
  assert.ok(fs.statSync(expressionPsdPath).size > 500000, 'expression variant PSD is unexpectedly small');
  assert.ok(fs.statSync(expressionSheetPath).size > 100000, 'expression contact sheet is unexpectedly small');
  for (const variant of expressionMetadata.variants) {
    const variantPath = path.join(path.dirname(expressionMetadataPath), variant.output);
    assert.ok(fs.statSync(variantPath).size > 20000, `expression variant is unexpectedly small: ${variant.id}`);
    assert.equal(variant.width, 899);
    assert.equal(variant.height, 1750);
  }
  assert.equal(mocHeader, 'MOC3', 'exported file does not have a Cubism MOC3 header');
  assert.ok(fs.statSync(mocPath).size > 92000, 'exported moc3 does not include the face-variant rig revision');
  assert.equal(texturePaths.length, 1);
  assert.ok(fs.statSync(texturePaths[0]).size > 3000000, 'exported texture does not include the face-variant atlas revision');

  for (const artMeshId of ['ATH_EXPRESSION_BLINK_PATCH', 'ATH_EXPRESSION_SPEAK_PATCH', 'ATH_EXPRESSION_HAPPY_PATCH']) {
    assert.ok(mocBuffer.includes(Buffer.from(artMeshId, 'ascii')), `exported MOC3 is missing ${artMeshId}`);
  }

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

  console.log(`ATHENA_LIVE2D_CUBISM_FACE_VARIANTS_OK moc=${fs.statSync(mocPath).size} textures=${texturePaths.length} variants=${expressionMetadata.variants.length} eyeBlink=2 lipSync=1 rig=${manifest.production.rigQuality}`);
}

main();
