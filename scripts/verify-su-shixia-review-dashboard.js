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
  const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');

  assert.equal(manifest.sourceArt.reviewDashboard, 'source/review/su-shixia-live2d-v2-review-dashboard.html');
  assert.equal(manifest.sourceArt.githubReferenceScan, '../../../docs/quality/su-shixia-github-reference-scan.json');
  assert.equal(manifest.production.reviewDashboardReady, true);
  assert.equal(manifest.production.githubReferenceScanReady, true);

  assert.equal(githubScan.version, 1);
  assert.equal(githubScan.packageId, 'su-shixia-live2d-v2');
  assert.equal(githubScan.status, 'reference_scan_ready');
  assert.ok(githubScan.repositories.length >= 7);
  assert.ok(githubScan.repositories.some(item => item.repo === 'Live2D/CubismWebSamples' && item.license === 'NOASSERTION'));
  assert.ok(githubScan.repositories.some(item => item.repo === 'guansss/pixi-live2d-display' && item.license === 'MIT'));
  assert.ok(githubScan.repositories.some(item => item.repo === 'emilianavt/OpenSeeFace' && item.license === 'BSD-2-Clause'));
  assert.ok(githubScan.adoptedDecisions.some(item => item.includes('not copied assets')));

  assert.ok(html.includes('data-su-shixia-review-dashboard="v1"'));
  assert.ok(html.includes('front-alignment-preview-v1.png'));
  assert.ok(html.includes('front-source-scale-preview-v1.png'));
  assert.ok(html.includes('../parts/parts-contact-sheet-v1.png'));
  assert.ok(html.includes('runtime-motion-contact-sheet-v1.png'));
  assert.ok(html.includes('runtime-appearance-contact-sheet-v1.png'));
  assert.ok(html.includes('Live2D/CubismWebSamples'));
  assert.ok(html.includes('guansss/pixi-live2d-display'));
  assert.ok(html.includes('emilianavt/OpenSeeFace'));
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
