const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const CONTRACT_PATH = path.join(PACKAGE_ROOT, 'source', 'review', 'orientation-contract-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-orientation-readiness-audit.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const contract = readJson(CONTRACT_PATH);
  const audit = readJson(AUDIT_PATH);
  const packageJson = readJson(path.join(ROOT, 'package.json'));

  assert.equal(manifest.sourceArt.orientationContract, 'source/review/orientation-contract-v1.json');
  assert.equal(manifest.sourceArt.orientationReadinessAudit, '../../../docs/quality/su-shixia-orientation-readiness-audit.json');
  assert.equal(manifest.production.orientationContractReady, true);
  assert.equal(manifest.production.orientationReadinessAuditReady, true);
  assert.equal(manifest.production.multiViewReady, false);

  assert.equal(contract.version, 1);
  assert.equal(contract.packageId, 'su-shixia-live2d-v2');
  assert.equal(contract.status, 'orientation_contract_ready_multiview_sources_required');
  assert.equal(contract.orientations.length, 8);
  assert.equal(contract.transitions.length, 8);
  assert.deepEqual(contract.currentRuntime.availableSourceOrientations, ['front']);
  assert.deepEqual(contract.currentRuntime.availableRuntimeOrientations, ['front']);
  assert.equal(contract.currentRuntime.turnPreviewCapability, 'front_view_2_5d_hint_only');
  assert.equal(contract.currentRuntime.turnPreviewVisualQaCovered, true);
  assert.ok(contract.orientations.some(item => item.id === 'front' && item.sourceStatus === 'current_front_source_review_required'));
  assert.ok(contract.orientations.some(item => item.id === 'profile_left' && item.sourceStatus === 'future_source_required'));
  assert.ok(contract.orientations.some(item => item.id === 'back' && item.unavailableFrontZones.includes('face_cheek')));
  assert.ok(contract.hitMapRequirements.some(item => item.includes('asymmetric A hair clip')));
  assert.ok(contract.interactionInheritance.frontZoneCount >= 37);
  assert.ok(contract.noGoUntil.some(item => item.includes('Profile and back source packages')));

  assert.equal(audit.version, 1);
  assert.equal(audit.status, 'no_go');
  assert.equal(audit.sourceReadyOrientationCount, 1);
  assert.equal(audit.futureSourceOrientationCount, 7);
  assert.equal(audit.goNoGo.orientationContract, 'go');
  assert.equal(audit.goNoGo.frontOrientationLitePreview, 'go');
  assert.equal(audit.goNoGo.turnPreview2_5dHint, 'go');
  assert.equal(audit.goNoGo.profileSourcePackages, 'no_go');
  assert.equal(audit.goNoGo.backSourcePackage, 'no_go');
  assert.equal(audit.goNoGo.orientationSpecificHitMaps, 'no_go');
  assert.equal(audit.goNoGo.fullTurnProduction, 'no_go');
  assert.ok(audit.blockers.includes('multiview-production-ready'));
  assert.ok(audit.blockers.includes('profile-left-source-ready'));
  assert.ok(audit.blockers.includes('profile-right-source-ready'));
  assert.ok(audit.blockers.includes('back-source-ready'));
  assert.ok(audit.blockers.includes('orientation-specific-hit-maps-ready'));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-orientation-contract'].includes('verify-su-shixia-orientation-contract.js'));

  console.log(`SU_SHIXIA_ORIENTATION_CONTRACT_OK orientations=${contract.orientations.length} status=${audit.status}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
