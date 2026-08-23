const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-live2d-v2-delivery-audit.json');

function main() {
  const manifest = readJson(path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2', 'manifest.json'));
  const report = readJson(REPORT_PATH);

  assert.equal(manifest.sourceArt.deliveryAuditReport, '../../../docs/quality/su-shixia-live2d-v2-delivery-audit.json');
  assert.equal(manifest.sourceArt.reviewDashboard, 'source/review/su-shixia-live2d-v2-review-dashboard.html');
  assert.equal(manifest.sourceArt.githubReferenceScan, '../../../docs/quality/su-shixia-github-reference-scan.json');
  assert.equal(manifest.sourceArt.wardrobeContract, 'wardrobe/wardrobe-contract-v1.json');
  assert.equal(manifest.sourceArt.wardrobeBindingPlan, 'cubism-handoff/wardrobe-binding-plan-v1.json');
  assert.equal(manifest.sourceArt.wardrobeReadinessAudit, '../../../docs/quality/su-shixia-wardrobe-readiness-audit.json');
  assert.equal(manifest.sourceArt.interactionMatrix, 'source/review/interaction-matrix-v1.json');
  assert.equal(manifest.sourceArt.interactionReadinessAudit, '../../../docs/quality/su-shixia-interaction-readiness-audit.json');
  assert.equal(manifest.sourceArt.runtimePolicyProof, '../../../docs/quality/su-shixia-runtime-policy-proof.json');
  assert.equal(manifest.sourceArt.hotZoneEventProof, '../../../docs/quality/su-shixia-hot-zone-event-proof.json');
  assert.equal(manifest.sourceArt.orientationContract, 'source/review/orientation-contract-v1.json');
  assert.equal(manifest.sourceArt.orientationReadinessAudit, '../../../docs/quality/su-shixia-orientation-readiness-audit.json');
  assert.equal(manifest.production.deliveryAuditReady, true);
  assert.equal(manifest.production.reviewDashboardReady, true);
  assert.equal(manifest.production.githubReferenceScanReady, true);
  assert.equal(manifest.production.wardrobeContractReady, true);
  assert.equal(manifest.production.wardrobeBindingPlanReady, true);
  assert.equal(manifest.production.wardrobeReadinessAuditReady, true);
  assert.equal(manifest.production.runtimeOutfitPreferenceReady, true);
  assert.equal(manifest.production.interactionMatrixReady, true);
  assert.equal(manifest.production.interactionReadinessAuditReady, true);
  assert.equal(manifest.production.runtimePolicyProofReady, true);
  assert.equal(manifest.production.hotZoneEventProofReady, true);
  assert.equal(manifest.production.orientationContractReady, true);
  assert.equal(manifest.production.orientationReadinessAuditReady, true);
  assert.equal(report.version, 1);
  assert.equal(report.packageId, 'su-shixia-live2d-v2');
  assert.equal(report.status, 'no_go');
  assert.equal(report.stages.length, 8);
  assert.equal(report.summary.requirements, 'go');
  assert.equal(report.summary.liteRuntime, 'go');
  assert.equal(report.summary.interaction, 'go');
  assert.equal(report.summary.cubismHandoff, 'go');
  assert.equal(report.summary.appearanceAndWardrobe, 'partial');
  assert.equal(report.summary.genuineCubismExport, 'no_go');
  assert.equal(report.summary.distribution, 'no_go');
  assert.equal(report.goNoGo.localLitePreview, 'go');
  assert.equal(report.goNoGo.editorHandoff, 'go');
  assert.equal(report.goNoGo.genuineCubismDefault, 'no_go');
  assert.equal(report.goNoGo.trueWardrobe, 'no_go');
  assert.equal(report.goNoGo.publicDistribution, 'no_go');
  assert.ok(report.blockers.includes('source-and-layering:human-layer-review-approved'));
  assert.ok(report.blockers.includes('source-and-layering:hidden-fill-review-approved'));
  assert.ok(report.blockers.includes('source-and-layering:alignment-review-approved'));
  assert.ok(report.blockers.includes('source-and-layering:multi-view-source-ready'));
  assert.ok(report.stages.find(item => item.id === 'source-and-layering').checks.some(item => item.id === 'orientation-contract-go' && item.status === 'pass'));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('Profile/back source packages')));
  assert.ok(report.blockers.includes('genuine-cubism-export:cubism-export-ready'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'interaction-audit-go' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'runtime-policy-proof-go' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'hot-zone-event-proof-go' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'hot-zone-callback-proof' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'compiled-helper-policy-coverage' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'interaction').checks.some(item => item.id === 'interaction-visual-qa-representatives' && item.status === 'pass'));
  assert.ok(report.blockers.includes('appearance-and-wardrobe:true-outfit-swap'));
  assert.ok(report.stages.find(item => item.id === 'appearance-and-wardrobe').checks.some(item => item.id === 'wardrobe-contract-go' && item.status === 'pass'));
  assert.ok(report.stages.find(item => item.id === 'appearance-and-wardrobe').checks.some(item => item.id === 'runtime-outfit-preference-ready' && item.status === 'pass'));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('Wardrobe contract blockers')));
  assert.ok(report.blockers.includes('distribution:public-installer-allowed'));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('Cubism Editor project')));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('true clothing variants')));

  console.log(`SU_SHIXIA_LIVE2D_DELIVERY_AUDIT_OK status=${report.status} blockers=${report.blockers.length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
