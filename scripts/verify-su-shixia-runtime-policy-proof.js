const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-runtime-policy-proof.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const matrix = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.interactionMatrix));
  const report = readJson(REPORT_PATH);

  assert.equal(manifest.sourceArt.runtimePolicyProof, '../../../docs/quality/su-shixia-runtime-policy-proof.json');
  assert.equal(manifest.production.runtimePolicyProofReady, true);
  assert.equal(report.version, 1);
  assert.equal(report.packageId, 'su-shixia-live2d-v2');
  assert.equal(report.status, 'go');
  assert.equal(report.runtimeModule, 'dist/renderer/avatar/live2d/AthenaLive2DCompanion');
  assert.equal(report.coverage.totalZones, profile.hotZones.length);
  assert.equal(report.coverage.totalZones, matrix.coverage.totalZones);
  assert.equal(report.coverage.privateOptInCapableZones, matrix.coverage.privateOptInZones.length);
  assert.equal(report.coverage.normalModeProofs, profile.hotZones.length);
  assert.ok(report.coverage.privateModeProofs >= 5);
  assert.ok(report.coverage.privateAttemptsFallingBackToNormal >= 20);
  assert.ok(report.coverage.forbiddenPublicAssetTypes.includes('adult_costume'));
  assert.ok(report.coverage.forbiddenPublicAssetTypes.includes('adult_motion'));
  assert.ok(report.checks.every(item => item.status === 'pass'));
  assert.equal(report.boundary.replyTextGeneratedByPersona, true);
  assert.equal(report.boundary.runtimeOwnsModeAndPromptBoundary, true);
  assert.equal(report.boundary.normalModeAdultEscalationAllowed, false);
  assert.equal(report.boundary.publicPackagePrivateAssetsAllowed, false);
  assert.equal(report.boundary.proofDoesNotVerifyCubismMoc3, true);

  const chest = report.zoneProofs.find(item => item.id === 'chest');
  assert.ok(chest);
  assert.equal(chest.sensitivity, 'private');
  assert.equal(chest.normalMode.effectiveMode, 'normal');
  assert.equal(chest.normalMode.blocksAdultEscalation, true);
  assert.equal(chest.privateOptInAttempt.effectiveMode, 'private_opt_in');
  assert.equal(chest.privateOptInAttempt.includesPrivateBoundary, true);

  const hand = report.zoneProofs.find(item => item.id === 'left_hand');
  assert.ok(hand);
  assert.equal(hand.privateModeAllowed, false);
  assert.equal(hand.privateOptInAttempt.effectiveMode, 'normal');
  assert.equal(hand.privateOptInAttempt.fallsBackToNormalWhenNotAllowed, true);

  console.log(`SU_SHIXIA_RUNTIME_POLICY_PROOF_OK zones=${report.coverage.totalZones} privateModeProofs=${report.coverage.privateModeProofs}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
