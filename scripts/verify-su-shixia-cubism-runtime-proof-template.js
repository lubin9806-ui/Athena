const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROOF_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-runtime-proof.json');

function main() {
  const proof = readJson(PROOF_PATH);

  assert.equal(proof.version, 1);
  assert.equal(proof.packageId, 'su-shixia-live2d-v2');
  assert.equal(proof.status, 'template_unverified');
  assert.equal(proof.renderer, 'unverified');
  assert.equal(proof.captureEnvironment.expectedRenderer, 'cubism-web');
  assert.equal(proof.captureEnvironment.fallbackRendererDisallowed, 'live2d-lite');
  assert.ok(proof.requiredEvidence.length >= 7);
  assert.equal(proof.cubismWeb.passed, false);
  assert.equal(proof.lipSync.passed, false);
  assert.equal(proof.visualDelta.passed, false);
  assert.equal(proof.hotZonePolicy.passed, false);
  assert.equal(proof.manualReview.passed, false);
  assert.equal(proof.goNoGo.genuineCubismRuntimeProof, 'no_go');
  assert.ok(proof.manualReview.unresolvedAreas.includes('true-wardrobe'));

  console.log('SU_SHIXIA_CUBISM_RUNTIME_PROOF_TEMPLATE_OK status=no_go renderer=unverified');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
