const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-hot-zone-event-proof.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const report = readJson(REPORT_PATH);

  assert.equal(manifest.sourceArt.hotZoneEventProof, '../../../docs/quality/su-shixia-hot-zone-event-proof.json');
  assert.equal(manifest.production.hotZoneEventProofReady, true);
  assert.equal(report.version, 1);
  assert.equal(report.packageId, 'su-shixia-live2d-v2');
  assert.equal(report.status, 'go');
  assert.equal(report.runtimeModule, 'dist/renderer/avatar/live2d/Live2DCanvasController');
  assert.deepEqual(report.coverage.representativeZones, ['face_cheek', 'left_hand', 'chest', 'left_thigh', 'hair_clip']);
  assert.equal(report.coverage.callbackCount, 5);
  assert.ok(report.coverage.runtimeEvents.includes('avatar.hotZone'));
  assert.ok(report.coverage.motionGroups.includes('TouchFace'));
  assert.ok(report.coverage.motionGroups.includes('TouchPalm'));
  assert.ok(report.coverage.motionGroups.includes('TouchChest'));
  assert.ok(report.coverage.motionGroups.includes('TouchThigh'));
  assert.ok(report.coverage.motionGroups.includes('TouchHairClip'));
  assert.ok(report.coverage.expressions.includes('shy'));
  assert.ok(report.checks.every(item => item.status === 'pass'));
  assert.equal(report.boundary.provesCanvasPointerToHotZoneAction, true);
  assert.equal(report.boundary.provesPersonaReplyCallback, true);
  assert.equal(report.boundary.provesCompiledControllerPath, true);
  assert.equal(report.boundary.proofDoesNotVerifyRealCubismMoc3, true);
  assert.equal(report.boundary.proofDoesNotVerifyBrowserPixelRendering, true);

  const chest = report.cases.find(item => item.id === 'chest');
  assert.ok(chest);
  assert.equal(chest.motionGroup, 'TouchChest');
  assert.equal(chest.expressionId, 'shy');
  assert.equal(chest.promptTemplatePresent, true);
  assert.equal(chest.normalModePromptBoundary, true);
  assert.equal(chest.privateAttemptMode, 'private_opt_in');

  const hand = report.cases.find(item => item.id === 'left_hand');
  assert.ok(hand);
  assert.equal(hand.motionGroup, 'TouchPalm');
  assert.equal(hand.privateAttemptMode, 'normal');

  console.log(`SU_SHIXIA_HOT_ZONE_EVENT_PROOF_OK cases=${report.cases.length} callbacks=${report.coverage.callbackCount}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
