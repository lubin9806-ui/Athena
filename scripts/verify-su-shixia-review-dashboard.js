const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const DASHBOARD_PATH = path.join(PACKAGE_ROOT, 'source', 'review', 'su-shixia-live2d-v2-review-dashboard.html');
const GITHUB_SCAN_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-github-reference-scan.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const deliveryAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-live2d-v2-delivery-audit.json'));
  const githubScan = readJson(GITHUB_SCAN_PATH);
  const motionAuthoringPacket = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-motion-authoring-packet.json'));
  const liteRuntime = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.liteRuntimeModel));
  const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');

  assert.equal(manifest.sourceArt.reviewDashboard, 'source/review/su-shixia-live2d-v2-review-dashboard.html');
  assert.equal(manifest.sourceArt.artReviewPacket, '../../../docs/quality/su-shixia-art-review-packet.json');
  assert.equal(manifest.sourceArt.githubReferenceScan, '../../../docs/quality/su-shixia-github-reference-scan.json');
  assert.equal(manifest.sourceArt.motionAuthoringPacket, '../../../docs/quality/su-shixia-motion-authoring-packet.json');
  assert.equal(manifest.sourceArt.wardrobeContract, 'wardrobe/wardrobe-contract-v1.json');
  assert.equal(manifest.sourceArt.interactionMatrix, 'source/review/interaction-matrix-v1.json');
  assert.equal(manifest.sourceArt.runtimePolicyProof, '../../../docs/quality/su-shixia-runtime-policy-proof.json');
  assert.equal(manifest.sourceArt.hotZoneEventProof, '../../../docs/quality/su-shixia-hot-zone-event-proof.json');
  assert.equal(manifest.sourceArt.orientationContract, 'source/review/orientation-contract-v1.json');
  assert.equal(manifest.production.reviewDashboardReady, true);
  assert.equal(manifest.production.artReviewPacketReady, true);
  assert.equal(manifest.production.githubReferenceScanReady, true);
  assert.equal(manifest.production.motionAuthoringPacketReady, true);
  assert.equal(manifest.production.wardrobeContractReady, true);
  assert.equal(manifest.production.interactionMatrixReady, true);
  assert.equal(manifest.production.runtimePolicyProofReady, true);
  assert.equal(manifest.production.hotZoneEventProofReady, true);
  assert.equal(manifest.production.orientationContractReady, true);

  assert.equal(githubScan.version, 1);
  assert.equal(githubScan.packageId, 'su-shixia-live2d-v2');
  assert.equal(githubScan.status, 'reference_scan_ready');
  assert.ok(githubScan.repositories.length >= 7);
  assert.ok(githubScan.repositories.some(item => item.repo === 'Live2D/CubismWebSamples' && item.license === 'NOASSERTION'));
  assert.ok(githubScan.repositories.some(item => item.repo === 'guansss/pixi-live2d-display' && item.license === 'MIT'));
  assert.ok(githubScan.repositories.some(item => item.repo === 'emilianavt/OpenSeeFace' && item.license === 'BSD-2-Clause'));
  assert.ok(githubScan.motionReferenceFamilies.length >= 7);
  assert.ok(githubScan.motionReferenceFamilies.some(item => item.id === 'voice-speech'));
  assert.ok(githubScan.motionReferenceFamilies.some(item => item.id === 'turn-orientation'));
  const referencedMotionGroups = new Set(githubScan.motionReferenceFamilies.flatMap(item => item.motionGroups));
  for (const motionGroup of Object.keys(liteRuntime.AthenaLive2DLite.motionGroups)) {
    assert.ok(referencedMotionGroups.has(motionGroup), `missing motion reference family for ${motionGroup}`);
  }
  assert.ok(githubScan.adoptedDecisions.some(item => item.includes('not copied assets')));
  assert.ok(githubScan.adoptedDecisions.some(item => item.includes('every Su Shixia motion group')));
  assert.equal(motionAuthoringPacket.status, 'motion_authoring_packet_ready');
  assert.equal(motionAuthoringPacket.authoringRows.length, manifest.production.cubismMotionTemplateCount);
  assert.equal(motionAuthoringPacket.goNoGo.trueTurn, 'no_go');
  assert.ok(motionAuthoringPacket.stiffnessReview.highRisk.includes('TurnPreview'));

  assert.ok(html.includes('data-su-shixia-review-dashboard="v1"'));
  assert.ok(html.includes('front-alignment-preview-v1.png'));
  assert.ok(html.includes('front-source-scale-preview-v1.png'));
  assert.ok(html.includes('../parts/parts-contact-sheet-v1.png'));
  assert.ok(html.includes('runtime-motion-contact-sheet-v1.png'));
  assert.ok(html.includes('runtime-appearance-contact-sheet-v1.png'));
  assert.ok(html.includes('Art Review Packet'));
  assert.ok(html.includes('hands-arms-anatomy'));
  assert.ok(html.includes('hidden-fill-occlusion'));
  assert.ok(html.includes('does not approve art automatically'));
  assert.ok(html.includes('Live2D/CubismWebSamples'));
  assert.ok(html.includes('guansss/pixi-live2d-display'));
  assert.ok(html.includes('emilianavt/OpenSeeFace'));
  assert.ok(html.includes('Motion Reference Families'));
  assert.ok(html.includes('idle-presence'));
  assert.ok(html.includes('voice-speech'));
  assert.ok(html.includes('garment-body-boundary'));
  assert.ok(html.includes('turn-orientation'));
  assert.ok(html.includes('Motion Authoring Packet'));
  assert.ok(html.includes('Voice sync'));
  assert.ok(html.includes('stiffnessPolishApproved=no_go'));
  assert.ok(html.includes('genuineCubismMotionPlayback=no_go'));
  assert.ok(html.includes('TouchChest'));
  assert.ok(html.includes('TouchThigh'));
  assert.ok(html.includes('TurnPreview'));
  assert.ok(html.includes('Wardrobe Contract'));
  assert.ok(html.includes('classic_daily'));
  assert.ok(html.includes('soft_assistant'));
  assert.ok(html.includes('ivory_ceremony'));
  assert.ok(html.includes('future_source_required'));
  assert.ok(html.includes('true outfit swap'));
  assert.ok(html.includes('Interaction Matrix'));
  assert.ok(html.includes('Runtime Policy Proof'));
  assert.ok(html.includes('compiled-helper-policy-coverage'));
  assert.ok(html.includes('publicPackagePrivateAssetsAllowed=false'));
  assert.ok(html.includes('Hot Zone Event Proof'));
  assert.ok(html.includes('TouchFace'));
  assert.ok(html.includes('Cubism moc3 proof'));
  assert.ok(html.includes('face_cheek'));
  assert.ok(html.includes('TouchChest'));
  assert.ok(html.includes('gestureClassifierV2=no_go'));
  assert.ok(html.includes('Orientation Contract'));
  assert.ok(html.includes('front_three_quarter_left'));
  assert.ok(html.includes('profile_left'));
  assert.ok(html.includes('fullTurnProduction=no_go'));
  assert.ok(html.includes('source-and-layering'));
  assert.ok(html.includes('genuine-cubism-export'));
  assert.ok(html.includes('distribution'));
  assert.ok(html.includes(deliveryAudit.blockers.length.toString()));
  assert.ok(html.includes('NO_GO'));
  assert.ok(html.includes('PARTIAL'));
  assert.ok(!/[A-Z]:\\/.test(html), 'dashboard must not contain absolute Windows paths');
  assert.ok(!html.includes('C:/Users/'), 'dashboard must not contain local user paths');

  const stat = fs.statSync(DASHBOARD_PATH);
  assert.ok(stat.size > 12000);

  console.log(`SU_SHIXIA_REVIEW_DASHBOARD_OK githubRefs=${githubScan.repositories.length} blockers=${deliveryAudit.blockers.length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
