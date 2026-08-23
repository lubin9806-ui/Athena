const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadImage } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const model = readJson(path.join(PACKAGE_ROOT, 'model', 'su-shixia-live2d-v2-lite.model3.json'));
  const lite = model.AthenaLive2DLite;

  assert.equal(profile.id, 'su-shixia-live2d-v2');
  assert.equal(profile.model.model3JsonPath, 'model/su-shixia-live2d-v2-lite.model3.json');
  assert.equal(lite.schemaVersion, 1);
  assert.equal(lite.canvas.width, 920);
  assert.equal(lite.canvas.height, 1712);
  assert.equal(lite.layers.length, 68);
  assert.ok(lite.layers.some(layer => layer.type === 'image' && layer.id === 'SSX_HEAD_FACE_BASE'));
  assert.ok(lite.layers.some(layer => layer.id === 'SSX_BLUSH_L' && layer.expressionAlpha === 'blush'));
  assert.ok(lite.layers.some(layer => layer.id === 'SSX_MOUTH_OPEN_WIDE' && layer.alphaMode === 'mouthOpenWide'));
  assert.ok(lite.layers.some(layer => layer.id === 'SSX_EYE_L_CLOSED' && layer.alphaMode === 'eyeClosed'));
  assert.ok(Object.keys(lite.motionGroups).length >= 20);
  assert.ok(lite.motionGroups.TouchFace.some(value => value.includes('reference:')));
  assert.ok(profile.hotZones.length >= 14);
  for (const id of ['face_cheek', 'chest', 'waist', 'skirt_clothing', 'thighs', 'feet']) {
    assert.ok(profile.hotZones.some(zone => zone.id === id), `missing hot zone ${id}`);
  }
  for (const layer of lite.layers.filter(layer => layer.type === 'image')) {
    assert.ok(fs.existsSync(path.join(PACKAGE_ROOT, layer.src)), `missing runtime image layer ${layer.src}`);
  }
  const master = await loadImage(path.join(PACKAGE_ROOT, 'source', 'su-shixia-front-master-v2-alpha.png'));
  assert.equal(master.width, 919);
  assert.equal(master.height, 1712);
  assert.equal(manifest.production.liteRuntimePreviewReady, true);
  assert.equal(manifest.production.runtimeReady, true);
  assert.equal(manifest.production.cubismExportReady, false);
  assert.equal(manifest.production.motionReferenceDriven, true);

  console.log(`SU_SHIXIA_LIVE2D_RUNTIME_PREVIEW_OK layers=${lite.layers.length} hitZones=${profile.hotZones.length} motions=${Object.keys(lite.motionGroups).length} cubism=false`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
