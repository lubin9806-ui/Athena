const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { readPsd } = require('ag-psd');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const inventory = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.partsInventory));
  const masterPath = path.join(PACKAGE_ROOT, manifest.sourceArt.frontReference);
  const psdPath = path.join(PACKAGE_ROOT, manifest.sourceArt.layeredPsd);
  const contactSheetPath = path.join(PACKAGE_ROOT, manifest.sourceArt.partsContactSheet);

  assert.equal(manifest.production.layeredSourceReady, true);
  assert.equal(manifest.production.cubismRigged, false);
  assert.equal(inventory.count, 67);
  assert.equal(new Set(inventory.parts.map(part => part.name)).size, 67, 'part names must be unique');
  for (const required of ['ATH_HEAD_FACE_BASE', 'ATH_EYE_L_IRIS', 'ATH_MOUTH_FORM_A', 'ATH_ARM_LOWER_R_HAND', 'ATH_SKIRT_PLEAT_05', 'ATH_SHOE_R']) {
    assert.ok(inventory.parts.some(part => part.name === required), `missing required layer: ${required}`);
  }
  for (const part of inventory.parts) {
    const partPath = path.join(PACKAGE_ROOT, 'source', 'parts', part.file);
    assert.ok(fs.existsSync(partPath), `missing sliced layer: ${part.name}`);
    assert.ok(fs.statSync(partPath).size > 100, `sliced layer is unexpectedly small: ${part.name}`);
    assert.ok(part.pixelCount >= 40, `sliced layer has too few pixels: ${part.name}`);
  }

  const alphaStats = await imageAlphaStats(masterPath);
  assert.equal(alphaStats.width, 899);
  assert.equal(alphaStats.height, 1750);
  assert.ok(alphaStats.transparent > 1000000, 'master image must contain real transparent alpha');
  assert.ok(alphaStats.opaque > 250000, 'master foreground is unexpectedly small');

  const contactSheet = await loadImage(contactSheetPath);
  assert.equal(contactSheet.width, 1500);
  assert.equal(contactSheet.height, 3500);

  assert.ok(fs.statSync(psdPath).size > 1000000, 'layered PSD is unexpectedly small');
  const psd = readPsd(fs.readFileSync(psdPath), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const names = flattenNames(psd.children || []);
  for (const group of manifest.production.psdGroups) assert.ok(names.includes(group), `PSD is missing group: ${group}`);
  for (const part of inventory.parts) assert.ok(names.includes(part.name), `PSD is missing part: ${part.name}`);

  console.log(`ATHENA_LIVE2D_SOURCE_PACKAGE_OK master=${alphaStats.width}x${alphaStats.height} alpha=${alphaStats.transparent} parts=${inventory.count} psdGroups=${manifest.production.psdGroups.length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function imageAlphaStats(filePath) {
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let transparent = 0;
  let opaque = 0;
  let partial = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] === 0) transparent += 1;
    else if (data[index] === 255) opaque += 1;
    else partial += 1;
  }
  return { width: image.width, height: image.height, transparent, opaque, partial };
}

function flattenNames(children) {
  const names = [];
  for (const child of children) {
    names.push(child.name || '');
    if (child.children) names.push(...flattenNames(child.children));
  }
  return names;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
