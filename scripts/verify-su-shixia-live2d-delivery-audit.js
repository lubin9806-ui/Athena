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
  assert.equal(manifest.production.deliveryAuditReady, true);
  assert.equal(manifest.production.reviewDashboardReady, true);
  assert.equal(manifest.production.githubReferenceScanReady, true);
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
  assert.ok(report.blockers.includes('genuine-cubism-export:cubism-export-ready'));
  assert.ok(report.blockers.includes('appearance-and-wardrobe:true-outfit-swap'));
  assert.ok(report.blockers.includes('distribution:public-installer-allowed'));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('Cubism Editor project')));
  assert.ok(report.nextRequiredEvidence.some(item => item.includes('true clothing variants')));

  console.log(`SU_SHIXIA_LIVE2D_DELIVERY_AUDIT_OK status=${report.status} blockers=${report.blockers.length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
