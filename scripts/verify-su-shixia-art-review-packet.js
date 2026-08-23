const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-art-review-packet.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const report = readJson(REPORT_PATH);

  assert.equal(manifest.sourceArt.artReviewPacket, '../../../docs/quality/su-shixia-art-review-packet.json');
  assert.equal(manifest.production.artReviewPacketReady, true);
  assert.equal(report.version, 1);
  assert.equal(report.packageId, 'su-shixia-live2d-v2');
  assert.equal(report.status, 'manual_review_packet_ready');
  assert.equal(report.goNoGo.packetReady, 'go');
  assert.equal(report.goNoGo.humanLayerReviewApproved, 'no_go');
  assert.equal(report.goNoGo.hiddenFillReviewApproved, 'no_go');
  assert.equal(report.goNoGo.alignmentReviewApproved, 'no_go');
  assert.equal(report.boundary.doesNotApproveArtAutomatically, true);
  assert.equal(report.boundary.doesNotStartGenuineCubismRigging, true);
  assert.ok(report.reviewLanes.length >= 8);
  assert.ok(report.openFindings.some(item => item.area === 'hands'));
  assert.ok(report.openFindings.some(item => item.area === 'hidden-fill'));
  assert.ok(report.openFindings.some(item => item.area === 'alignment'));
  for (const id of [
    'identity-default-read',
    'hands-arms-anatomy',
    'hidden-fill-occlusion',
    'lower-body-shoes',
    'mouth-expression-speech',
    'alignment-scale',
    'wardrobe-source-boundary',
    'turn-multiview-boundary',
  ]) {
    const lane = report.reviewLanes.find(item => item.id === id);
    assert.ok(lane, `missing lane ${id}`);
    assert.equal(lane.status, 'review_required');
    assert.ok(lane.partCount > 0, `lane has no parts: ${id}`);
    assert.ok(lane.passCriteria.length >= 2, `lane missing pass criteria: ${id}`);
  }
  assert.ok(report.reviewLanes.find(item => item.id === 'hands-arms-anatomy').highRiskParts.some(item => item.name.includes('HAND')));
  assert.ok(report.reviewLanes.find(item => item.id === 'hidden-fill-occlusion').highRiskParts.some(item => item.riskFlags.includes('hidden-fill-review')));
  assert.ok(report.reviewLanes.find(item => item.id === 'lower-body-shoes').highRiskParts.some(item => item.name.includes('SHOE')));
  assert.ok(report.reviewLanes.find(item => item.id === 'mouth-expression-speech').highRiskParts.some(item => item.name.includes('MOUTH')));
  assert.deepEqual(
    report.blockerMapping['source-and-layering:hidden-fill-review-approved'],
    ['hidden-fill-occlusion'],
  );
  assert.ok(report.blockerMapping['source-and-layering:human-layer-review-approved'].includes('hands-arms-anatomy'));
  assert.ok(report.blockerMapping['appearance-and-wardrobe:true-outfit-swap'].includes('wardrobe-source-boundary'));
  assert.ok(report.approvalGates.every(item => item.status === 'review_required'));
  assert.ok(JSON.stringify(report).includes('front-alignment-preview-v1.png'));
  assert.ok(JSON.stringify(report).includes('parts-contact-sheet-v1.png'));
  assert.ok(!/[A-Z]:\\/.test(JSON.stringify(report)), 'packet must not contain absolute Windows paths');

  console.log(`SU_SHIXIA_ART_REVIEW_PACKET_OK lanes=${report.reviewLanes.length} gates=${report.approvalGates.length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
