const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const MATRIX_PATH = path.join(PACKAGE_ROOT, 'source', 'review', 'interaction-matrix-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-interaction-readiness-audit.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const matrix = readJson(MATRIX_PATH);
  const audit = readJson(AUDIT_PATH);
  const packageJson = readJson(path.join(ROOT, 'package.json'));

  assert.equal(manifest.sourceArt.interactionMatrix, 'source/review/interaction-matrix-v1.json');
  assert.equal(manifest.sourceArt.interactionReadinessAudit, '../../../docs/quality/su-shixia-interaction-readiness-audit.json');
  assert.equal(manifest.sourceArt.gestureClassifierProof, '../../../docs/quality/su-shixia-gesture-classifier-proof.json');
  assert.equal(manifest.production.interactionMatrixReady, true);
  assert.equal(manifest.production.interactionReadinessAuditReady, true);
  assert.equal(manifest.production.gestureClassifierV2Ready, true);

  assert.equal(matrix.version, 1);
  assert.equal(matrix.packageId, 'su-shixia-live2d-v2');
  assert.equal(matrix.status, 'interaction_matrix_ready');
  assert.equal(matrix.zones.length, 37);
  assert.equal(matrix.coverage.totalZones, 37);
  assert.equal(matrix.coverage.enabledZones, 37);
  assert.ok(matrix.coverage.byTargetLayer.body > 0);
  assert.ok(matrix.coverage.byTargetLayer.garment > 0);
  assert.ok(matrix.coverage.byTargetLayer.accessory > 0);
  assert.ok(matrix.coverage.bySensitivity.private >= 3);
  assert.ok(matrix.coverage.bySensitivity.sensitive >= 8);
  assert.ok(matrix.coverage.privateOptInZones.includes('chest'));
  assert.ok(matrix.coverage.privateOptInZones.includes('left_thigh'));
  assert.ok(matrix.requiredZoneIds.every(id => matrix.zones.some(zone => zone.id === id)));
  assert.ok(matrix.zones.every(zone => zone.hasLiteMotion));
  assert.ok(matrix.zones.every(zone => zone.hasCubismMotionTemplate));
  assert.ok(matrix.zones.every(zone => zone.replyDelegatedToPersona));
  assert.ok(matrix.zones.every(zone => zone.normalModeBoundary.includes('非露骨')));
  assert.ok(matrix.zones.filter(zone => zone.privateModeAllowed).every(zone => zone.privateModeBoundary.includes('显式私密模式')));
  assert.equal(matrix.runtimeBoundary.modelMaySelectArbitraryMotionFile, false);
  assert.equal(matrix.runtimeBoundary.modelMayBypassModePolicy, false);
  assert.equal(matrix.runtimeBoundary.publicPackageContainsPrivateAssets, false);
  assert.equal(matrix.runtimeBoundary.gestureClassifierV2.status, 'go');
  assert.deepEqual(matrix.runtimeBoundary.gestureClassifierV2.gestures, ['tap', 'repeat_tap', 'long_press', 'stroke', 'drag']);

  assert.equal(audit.version, 1);
  assert.equal(audit.status, 'go');
  assert.equal(audit.zoneCount, 37);
  assert.equal(audit.goNoGo.semanticTouchMatrix, 'go');
  assert.equal(audit.goNoGo.runtimePromptBoundary, 'go');
  assert.equal(audit.goNoGo.immediateLiteVisualResponse, 'go');
  assert.equal(audit.goNoGo.gestureClassifierV2, 'go');
  assert.equal(audit.goNoGo.gestureSpecificCubismAnimation, 'no_go');
  assert.equal(audit.goNoGo.orientationSpecificHitMaps, 'no_go');
  assert.equal(audit.goNoGo.privateAssetPackage, 'no_go');
  assert.deepEqual(audit.blockers, []);
  assert.ok(audit.checks.every(item => item.status === 'pass'));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-interaction-matrix'].includes('verify-su-shixia-interaction-matrix.js'));

  console.log(`SU_SHIXIA_INTERACTION_MATRIX_OK zones=${matrix.zones.length} privateZones=${matrix.coverage.privateOptInZones.length} status=${audit.status}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
