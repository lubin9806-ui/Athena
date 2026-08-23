const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');

async function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const reportPath = path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport);
  const report = readJson(reportPath);
  const reportRoot = path.dirname(reportPath);
  const contactSheetPath = path.join(reportRoot, report.contactSheet);
  const appearanceContactSheetPath = path.join(reportRoot, report.appearanceContactSheet);

  assert.equal(manifest.production.runtimeVisualQaReady, true);
  assert.equal(manifest.production.appearancePresetVisualQaReady, true);
  assert.equal(report.status, 'runtime_visual_qa_ready');
  assert.equal(report.sourceModel, manifest.sourceArt.liteRuntimeModel);
  assert.equal(report.checks.transparentBackground, true);
  assert.equal(report.checks.individualFrames, 11);
  assert.ok(report.checks.appearancePresetFrames >= 4);
  assert.equal(report.checks.appearancePresetPreviewOnly, true);
  assert.equal(report.checks.allAppearanceFramesVisible, true);
  assert.equal(report.checks.noOfficialCubismClaim, true);
  assert.ok(report.gate.includes('not proof of a genuine Cubism .moc3 export'));
  assert.ok(report.manualReviewFindings.some(item => item.area === 'hand-arm-layering' && item.status === 'needs-human-polish'));
  assert.ok(report.manualReviewFindings.some(item => item.area === 'full-turn' && item.status === 'not-production-ready'));
  assert.ok(report.manualReviewFindings.some(item => item.area === 'true-wardrobe-swap' && item.status === 'not-production-ready'));

  const contact = await loadImage(contactSheetPath);
  assert.equal(contact.width, 1440);
  assert.equal(contact.height, 2100);
  assert.ok(fs.statSync(contactSheetPath).size > 500000, 'visual QA contact sheet is unexpectedly small');
  const appearanceContact = await loadImage(appearanceContactSheetPath);
  assert.equal(appearanceContact.width, 1080);
  assert.equal(appearanceContact.height, 1400);
  assert.ok(fs.statSync(appearanceContactSheetPath).size > 250000, 'appearance QA contact sheet is unexpectedly small');
  for (const frame of report.appearanceFrames) {
    assert.equal(frame.previewOnly, true, `appearance frame must be preview-only: ${frame.id}`);
    assert.equal(frame.silhouetteSwap, false, `appearance frame must not claim true outfit swap: ${frame.id}`);
    assert.ok(frame.visiblePixels > 180000, `appearance frame is visually empty: ${frame.id}`);
  }

  const required = new Set(['Idle', 'Listen', 'Speak', 'TouchFace', 'TouchEar', 'TouchChest', 'TouchWaist', 'TouchSkirt', 'TouchThigh', 'TurnPreview', 'Sleepy']);
  assert.deepEqual(new Set(report.checks.requiredMotionCases), required);
  for (const frame of report.frames) {
    const framePath = path.join(reportRoot, frame.file);
    assert.ok(fs.existsSync(framePath), `missing visual QA frame: ${frame.file}`);
    const stats = await imageStats(framePath);
    assert.equal(stats.width, 920);
    assert.equal(stats.height, 1712);
    assert.ok(stats.transparentPixels > 1000000, `frame must preserve transparent background: ${frame.id}`);
    assert.ok(stats.visiblePixels > 180000, `frame is visually empty: ${frame.id}`);
    assert.ok(frame.visiblePixels > 180000, `report visible pixel count too low: ${frame.id}`);
    if (frame.id !== 'idle') {
      assert.ok(frame.diffFromIdle.changedVisiblePixels > 1800, `motion is not visually distinct from idle: ${frame.id}`);
    }
  }

  console.log(
    `SU_SHIXIA_LIVE2D_VISUAL_QA_OK frames=${report.frames.length} `
    + `contactSheet=${contact.width}x${contact.height} motionDiff=visible cubism=false`,
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function imageStats(filePath) {
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let visiblePixels = 0;
  let transparentPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) transparentPixels += 1;
    else visiblePixels += 1;
  }
  return { width: image.width, height: image.height, visiblePixels, transparentPixels };
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
