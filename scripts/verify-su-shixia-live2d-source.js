const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { readPsd } = require('ag-psd');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const layerMap = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.layerMap));
  const inventory = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.partsInventory));
  const masterPath = path.join(PACKAGE_ROOT, manifest.sourceArt.frontMaster);
  const psdPath = path.join(PACKAGE_ROOT, manifest.sourceArt.layeredPsd);
  const contactSheetPath = path.join(PACKAGE_ROOT, manifest.sourceArt.partsContactSheet);

  assert.equal(manifest.status, 'layered_source_baseline_review_required');
  assert.equal(manifest.sourceOnly, true);
  assert.equal(manifest.production.automatedLayeredBaselineReady, true);
  assert.equal(manifest.production.humanLayerReviewRequired, true);
  assert.equal(manifest.production.cubismProjectReady, false);
  assert.equal(manifest.production.cubismExportReady, false);
  assert.equal(manifest.production.runtimeReady, false);
  assert.equal(manifest.production.multiViewReady, false);
  assert.equal(manifest.production.adultPackageIncluded, false);
  assert.equal(manifest.distribution.publicInstallerAllowed, false);
  assert.equal(manifest.distribution.storePackageAllowed, false);
  assert.equal(layerMap.status, 'automated_baseline_review_required');
  assert.deepEqual(layerMap.currentOrientationCoverage, ['front']);

  assert.equal(manifest.production.partsCount, 66);
  assert.equal(inventory.count, 66);
  assert.equal(new Set(inventory.parts.map(item => item.name)).size, 66, 'part names must be unique');
  assert.ok(inventory.parts.every(item => item.name.startsWith('SSX_')), 'all parts must use the SSX prefix');

  const expectedGroups = new Map(layerMap.groups.map(item => [item.name, item.expectedCount]));
  const actualGroups = new Map();
  for (const item of inventory.parts) actualGroups.set(item.group, (actualGroups.get(item.group) || 0) + 1);
  assert.deepEqual(actualGroups, expectedGroups);

  for (const required of [
    'SSX_HEAD_FACE_BASE',
    'SSX_HAIR_BANGS_CENTER',
    'SSX_ACCESSORY_HAIR_CLIP',
    'SSX_EYE_L_IRIS',
    'SSX_EYE_R_CLOSED',
    'SSX_MOUTH_FORM_OU',
    'SSX_BLOUSE_FRONT',
    'SSX_HAND_CHEEK_L',
    'SSX_HAND_CHEEK_R',
    'SSX_SKIRT_PLEATS_CENTER',
    'SSX_SHOE_L',
    'SSX_SHOE_R'
  ]) {
    assert.ok(inventory.parts.some(item => item.name === required), `missing required layer: ${required}`);
  }

  for (const item of inventory.parts) {
    const itemPath = path.join(PACKAGE_ROOT, 'source', 'parts', item.file);
    assert.ok(fs.existsSync(itemPath), `missing sliced layer: ${item.name}`);
    assert.ok(fs.statSync(itemPath).size > 100, `sliced layer is unexpectedly small: ${item.name}`);
    assert.ok(item.pixelCount >= 40, `sliced layer has too few pixels: ${item.name}`);
    assert.equal(item.targetRect.length, 4, `target rectangle is invalid: ${item.name}`);
    const stats = await imageAlphaStats(itemPath);
    assert.ok(stats.transparent > 20, `sliced layer needs transparent padding: ${item.name}`);
    assert.ok(stats.visible > 40, `sliced layer foreground is too small: ${item.name}`);
  }

  const master = await imageAlphaStats(masterPath);
  assert.equal(master.width, 919);
  assert.equal(master.height, 1712);
  assert.ok(master.transparent > 1200000, 'master must contain substantial transparent alpha');
  assert.ok(master.opaque > 250000, 'master foreground is unexpectedly small');
  assert.ok(master.partial > 1000, 'master must retain anti-aliased edge alpha');
  assert.ok(master.greenDominant <= 100, 'master has excessive visible green fringe');

  for (const file of [
    'head-hair-atlas-v1-alpha.png',
    'eyes-brows-atlas-v1-alpha.png',
    'mouths-atlas-v1-alpha.png',
    'upper-body-atlas-v1-alpha.png',
    'lower-body-atlas-v1-alpha.png'
  ]) {
    const stats = await imageAlphaStats(path.join(PACKAGE_ROOT, 'source', 'parts', file));
    assert.ok(stats.transparent > stats.visible, `${file} must be primarily transparent`);
    assert.ok(stats.partial > 500, `${file} must preserve anti-aliased edges`);
    assert.ok(stats.greenDominant <= 100, `${file} has excessive visible green fringe`);
  }

  const contact = await loadImage(contactSheetPath);
  assert.equal(contact.width, 1500);
  assert.equal(contact.height, 3360);

  assert.ok(fs.statSync(psdPath).size > 1000000, 'layered PSD is unexpectedly small');
  const psd = readPsd(fs.readFileSync(psdPath), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  assert.equal(psd.width, master.width);
  assert.equal(psd.height, master.height);
  const names = flattenNames(psd.children || []);
  for (const group of manifest.production.psdGroups) assert.ok(names.includes(group), `PSD is missing group: ${group}`);
  for (const item of inventory.parts) assert.ok(names.includes(item.name), `PSD is missing part: ${item.name}`);

  console.log(
    `SU_SHIXIA_LIVE2D_SOURCE_PACKAGE_OK status=${manifest.status} master=${master.width}x${master.height} `
    + `parts=${inventory.count} groups=${manifest.production.psdGroups.length} alpha=${master.transparent} review=required`,
  );
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
  let greenDominant = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) transparent += 1;
    else if (alpha === 255) opaque += 1;
    else partial += 1;
    if (alpha > 16 && data[index + 1] > Math.max(data[index], data[index + 2]) + 35) greenDominant += 1;
  }
  return { width: image.width, height: image.height, transparent, opaque, partial, visible: opaque + partial, greenDominant };
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
