const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const CONTRACT_PATH = path.join(PACKAGE_ROOT, 'wardrobe', 'wardrobe-contract-v1.json');
const BINDING_PLAN_PATH = path.join(PACKAGE_ROOT, 'cubism-handoff', 'wardrobe-binding-plan-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-wardrobe-readiness-audit.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const contract = readJson(CONTRACT_PATH);
  const bindingPlan = readJson(BINDING_PLAN_PATH);
  const audit = readJson(AUDIT_PATH);
  const packageJson = readJson(path.join(ROOT, 'package.json'));

  assert.equal(manifest.sourceArt.wardrobeContract, 'wardrobe/wardrobe-contract-v1.json');
  assert.equal(manifest.sourceArt.wardrobeBindingPlan, 'cubism-handoff/wardrobe-binding-plan-v1.json');
  assert.equal(manifest.sourceArt.wardrobeReadinessAudit, '../../../docs/quality/su-shixia-wardrobe-readiness-audit.json');
  assert.equal(manifest.production.wardrobeContractReady, true);
  assert.equal(manifest.production.wardrobeBindingPlanReady, true);
  assert.equal(manifest.production.wardrobeReadinessAuditReady, true);
  assert.equal(manifest.production.trueOutfitSwapReady, false);

  assert.equal(contract.version, 1);
  assert.equal(contract.packageId, 'su-shixia-live2d-v2');
  assert.equal(contract.status, 'contract_ready_true_outfit_sources_required');
  assert.equal(contract.defaultOutfitId, 'classic_daily');
  assert.equal(contract.publicOutfits.length, 4);
  assert.ok(contract.publicOutfits.every(item => item.contentRating === 'public'));
  assert.ok(contract.publicOutfits.some(item => item.id === 'classic_daily' && item.sourceStatus === 'current_source_exists_review_required'));
  assert.equal(contract.publicOutfits.filter(item => item.sourceStatus === 'future_source_required').length, 3);
  assert.ok(contract.publicOutfits.every(item => item.requiredGarmentGroups.includes('hot-zone-occlusion-map')));
  assert.ok(contract.publicOutfits.every(item => item.motionCompatibility.includes('TouchChest')));
  assert.equal(contract.privatePackageBoundary.includedInPublicPackage, false);
  assert.equal(contract.privatePackageBoundary.includedInStorePackage, false);
  assert.ok(contract.privatePackageBoundary.notes.some(item => item.includes('No private body or explicit pose image assets')));
  assert.equal(contract.activeRuntimeSupport.trueOutfitSwapReady, false);
  assert.ok(contract.noGoUntil.some(item => item.includes('Cubism drawables')));

  assert.equal(bindingPlan.version, 1);
  assert.equal(bindingPlan.status, 'binding_plan_ready_sources_required');
  assert.equal(bindingPlan.parameterGroup.id, 'ParamGroupWardrobe');
  assert.deepEqual(bindingPlan.parameterGroup.ids, [
    'ParamOutfitClassic',
    'ParamOutfitAssistant',
    'ParamOutfitHome',
    'ParamOutfitCeremony',
  ]);
  assert.equal(bindingPlan.outfitParameters.find(item => item.id === 'ParamOutfitClassic').defaultValue, 1);
  assert.ok(bindingPlan.outfitParameters.filter(item => item.defaultValue === 0).length >= 3);
  assert.ok(bindingPlan.runtimeSwitchRules.some(item => item.includes('Suspend ambiguous torso')));
  assert.ok(bindingPlan.clippingRules.some(item => item.includes('Lower garment')));

  assert.equal(audit.version, 1);
  assert.equal(audit.status, 'no_go');
  assert.equal(audit.trueOutfitSwapReady, false);
  assert.equal(audit.goNoGo.wardrobeContract, 'go');
  assert.equal(audit.goNoGo.cubismBindingPlan, 'go');
  assert.equal(audit.goNoGo.currentDefaultOutfitSource, 'partial');
  assert.equal(audit.goNoGo.truePublicOutfitSwap, 'no_go');
  assert.equal(audit.goNoGo.privateOutfitPackage, 'no_go');
  assert.ok(audit.blockers.includes('all-public-sources-ready'));
  assert.ok(audit.blockers.includes('default-source-human-approved'));
  assert.ok(audit.checks.some(item => item.id === 'manifest-true-outfit-swap-not-ready' && item.status === 'pass'));
  assert.ok(packageJson.scripts['test:live2d:su-shixia-wardrobe-contract'].includes('verify-su-shixia-wardrobe-contract.js'));

  console.log(`SU_SHIXIA_WARDROBE_CONTRACT_OK publicOutfits=${contract.publicOutfits.length} status=${audit.status}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

main();
