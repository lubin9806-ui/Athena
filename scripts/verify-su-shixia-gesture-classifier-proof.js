const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-gesture-classifier-proof.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const report = readJson(REPORT_PATH);
  const packageJson = readJson(path.join(ROOT, 'package.json'));

  assert.equal(manifest.sourceArt.gestureClassifierProof, '../../../docs/quality/su-shixia-gesture-classifier-proof.json');
  assert.equal(manifest.production.gestureClassifierV2Ready, true);
  assert.equal(report.version, 1);
  assert.equal(report.packageId, 'su-shixia-live2d-v2');
  assert.equal(report.status, 'go');
  assert.equal(report.runtimeModule, 'dist/renderer/avatar/live2d/Live2DCanvasController');
  assert.equal(report.promptModule, 'dist/renderer/avatar/live2d/AthenaLive2DCompanion');
  assert.deepEqual(report.gestures, ['tap', 'repeat_tap', 'long_press', 'stroke', 'drag']);
  assert.equal(report.thresholds.repeatTapMs, 450);
  assert.equal(report.thresholds.longPressMs, 600);
  assert.equal(report.thresholds.dragTravelPx, 16);
  assert.ok(report.checks.every(item => item.status === 'pass'));
  assert.equal(report.boundary.provesCompiledGestureClassifier, true);
  assert.equal(report.boundary.provesPromptReceivesGestureType, true);
  assert.equal(report.boundary.provesGestureSpecificMotionSelection, false);
  assert.equal(report.boundary.proofDoesNotVerifyFinalCubismAnimationPolish, true);
  assert.equal(report.boundary.proofDoesNotEnablePrivateAssets, true);

  for (const gesture of report.gestures) {
    assert.ok(report.cases.some(item => item.expectedGesture === gesture && item.actualGesture === gesture), `missing gesture ${gesture}`);
  }
  assertCase(report, 'tap-face', 'face_cheek', 'tap', 'TouchFace');
  assertCase(report, 'repeat-tap-hair-clip', 'hair_clip', 'repeat_tap', 'TouchHairClip');
  assertCase(report, 'long-press-hand', 'left_hand', 'long_press', 'TouchPalm');
  assertCase(report, 'stroke-skirt', 'skirt_front', 'stroke', 'TouchSkirt');
  assertCase(report, 'drag-waist', 'waist', 'drag', 'TouchWaist');
  assert.ok(report.cases.every(item => item.promptIncludesGesture));
  assert.ok(report.cases.every(item => item.promptIncludesBoundary));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-gesture-classifier'].includes('verify-su-shixia-gesture-classifier-proof.js'));

  console.log(`SU_SHIXIA_GESTURE_CLASSIFIER_PROOF_OK gestures=${report.gestures.length} cases=${report.cases.length}`);
}

function assertCase(report, id, zoneId, gesture, motionGroup) {
  const item = report.cases.find(value => value.id === id);
  assert.ok(item, `missing case ${id}`);
  assert.equal(item.zoneId, zoneId);
  assert.equal(item.actualGesture, gesture);
  assert.equal(item.motionGroup, motionGroup);
  assert.ok(item.expressionId);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
