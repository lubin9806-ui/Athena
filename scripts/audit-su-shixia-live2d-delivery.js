const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-live2d-v2-delivery-audit.json');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const liteModel = readJson(path.join(PACKAGE_ROOT, 'model', 'su-shixia-live2d-v2-lite.model3.json')).AthenaLive2DLite;
  const sourceReview = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.reviewReport));
  const artReviewPacket = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-art-review-packet.json'));
  const motionAuthoringPacket = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-motion-authoring-packet.json'));
  const runtimeQa = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport));
  const exportAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-export-audit.json'));
  const runtimeProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-runtime-proof.json'));
  const wardrobeAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-wardrobe-readiness-audit.json'));
  const interactionAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-interaction-readiness-audit.json'));
  const gestureProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-gesture-classifier-proof.json'));
  const runtimePolicyProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-runtime-policy-proof.json'));
  const hotZoneEventProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-hot-zone-event-proof.json'));
  const orientationAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-orientation-readiness-audit.json'));

  const stages = [
    stage('requirements', 'go', [
      check('concept-baseline-approved', manifest.production.conceptBaselineApproved === true),
      check('athena-default-variant', manifest.production.athenaDefaultVariant === true),
    ]),
    stage('source-and-layering', sourceReview.gate.includes('Do not begin genuine Cubism rigging') ? 'no_go' : 'go', [
      check('transparent-master', manifest.production.transparentMasterReady === true),
      check('layered-baseline', manifest.production.automatedLayeredBaselineReady === true),
      check('art-review-packet-ready', manifest.production.artReviewPacketReady === true && artReviewPacket.status === 'manual_review_packet_ready'),
      check('parts-count', manifest.production.partsCount === 66),
      check('orientation-contract-ready', manifest.production.orientationContractReady === true),
      check('orientation-readiness-audit-ready', manifest.production.orientationReadinessAuditReady === true),
      check('orientation-contract-go', orientationAudit.goNoGo.orientationContract === 'go'),
      check('turn-preview-qa', orientationAudit.goNoGo.turnPreview2_5dHint === 'go'),
      check('human-layer-review-approved', manifest.production.humanLayerReviewRequired !== true, 'manual review remains required'),
      check('hidden-fill-review-approved', manifest.production.hiddenFillReviewRequired !== true, 'manual hidden-fill review remains required'),
      check('alignment-review-approved', manifest.production.alignmentReviewRequired !== true, 'alignment review remains required'),
      check('multi-view-source-ready', manifest.production.multiViewReady === true, 'profile/back source packages and orientation hit maps are not ready'),
    ]),
    stage('lite-runtime', 'go', [
      check('lite-runtime-ready', manifest.production.liteRuntimePreviewReady === true),
      check('runtime-ready', manifest.production.runtimeReady === true),
      check('layers', liteModel.layers.length === manifest.production.liteRuntimeLayerCount),
      check('hot-zones', profile.hotZones.length === manifest.production.liteRuntimeHitZoneCount),
      check('motions', Object.keys(liteModel.motionGroups).length === manifest.production.liteRuntimeMotionGroupCount),
      check('visual-qa-ready', runtimeQa.status === 'runtime_visual_qa_ready'),
      check('motion-frames-visible', runtimeQa.checks.allFramesVisible === true),
      check('motion-deltas-visible', runtimeQa.checks.motionFramesDifferFromIdle === true),
    ]),
    stage('appearance-and-wardrobe', manifest.production.trueOutfitSwapReady === true ? 'go' : 'partial', [
      check('appearance-preview-ready', manifest.production.appearancePresetPreviewReady === true),
      check('appearance-qa-ready', manifest.production.appearancePresetVisualQaReady === true),
      check('appearance-preset-count', manifest.production.appearancePresetCount >= 5),
      check('wardrobe-contract-ready', manifest.production.wardrobeContractReady === true),
      check('wardrobe-binding-plan-ready', manifest.production.wardrobeBindingPlanReady === true),
      check('wardrobe-readiness-audit-ready', manifest.production.wardrobeReadinessAuditReady === true),
      check('runtime-outfit-preference-ready', manifest.production.runtimeOutfitPreferenceReady === true),
      check('wardrobe-contract-go', wardrobeAudit.goNoGo.wardrobeContract === 'go'),
      check('wardrobe-binding-plan-go', wardrobeAudit.goNoGo.cubismBindingPlan === 'go'),
      check('preview-only', runtimeQa.checks.appearancePresetPreviewOnly === true, 'current appearance presets are preview-only'),
      check('true-outfit-swap', manifest.production.trueOutfitSwapReady === true, 'true outfit source layers and Cubism bindings are not ready'),
    ]),
    stage('interaction', 'go', [
      check('interaction-policy', manifest.production.interactionPolicyReady === true),
      check('interaction-matrix-ready', manifest.production.interactionMatrixReady === true),
      check('interaction-readiness-audit-ready', manifest.production.interactionReadinessAuditReady === true),
      check('gesture-classifier-v2-ready', manifest.production.gestureClassifierV2Ready === true),
      check('gesture-classifier-proof-go', gestureProof.status === 'go'),
      check('gesture-classifier-five-types', ['tap', 'repeat_tap', 'long_press', 'stroke', 'drag'].every(gesture => gestureProof.gestures.includes(gesture))),
      check('runtime-policy-proof-ready', manifest.production.runtimePolicyProofReady === true),
      check('runtime-policy-proof-go', runtimePolicyProof.status === 'go'),
      check('hot-zone-event-proof-ready', manifest.production.hotZoneEventProofReady === true),
      check('hot-zone-event-proof-go', hotZoneEventProof.status === 'go'),
      check('hot-zone-callback-proof', hotZoneEventProof.coverage.callbackCount >= 5),
      check('compiled-helper-policy-coverage', runtimePolicyProof.coverage.totalZones === profile.hotZones.length),
      check('runtime-normal-mode-boundary-proof', runtimePolicyProof.boundary.normalModeAdultEscalationAllowed === false),
      check('runtime-private-asset-boundary-proof', runtimePolicyProof.boundary.publicPackagePrivateAssetsAllowed === false),
      check('interaction-audit-go', interactionAudit.status === 'go'),
      check('interaction-zones-covered', interactionAudit.zoneCount === manifest.production.liteRuntimeHitZoneCount),
      check('interaction-private-zone-count', interactionAudit.privateOptInZoneCount >= 5),
      check('interaction-visual-qa-representatives', interactionAudit.motionCoverage.representativeVisualQaMotions.every(motion => runtimeQa.checks.requiredMotionCases.includes(motion))),
      check('normal-boundary', manifest.production.normalModeBoundaryReady === true),
      check('private-opt-in-boundary', manifest.production.privateModeOptInBoundaryReady === true),
      check('persona-reply-delegation', profile.interactionPolicy.replyDelegatedToPersona === true),
      check('private-mode-opt-in', profile.interactionPolicy.privateModeRequiresExplicitOptIn === true),
      check('semantic-hot-zones', profile.hotZones.length >= 35),
      check('private-zone-boundaries', profile.hotZones.some(zone => zone.interaction?.sensitivity === 'private' && zone.interaction?.privateModeAllowed === true)),
    ]),
    stage('cubism-handoff', 'go', [
      check('editor-installed', manifest.production.cubismEditorInstalledLocally === true),
      check('handoff-ready', manifest.production.cubismHandoffReady === true),
      check('readiness-checklist', manifest.production.cubismEditorReadinessChecklistReady === true),
      check('export-gate', manifest.production.cubismExportGateReady === true),
      check('motion-authoring-packet-ready', manifest.production.motionAuthoringPacketReady === true && motionAuthoringPacket.status === 'motion_authoring_packet_ready'),
      check('motion-template-count', manifest.production.cubismMotionTemplateCount >= 37),
      check('physics-template', manifest.production.cubismPhysicsTemplateReady === true),
      check('headless-export-unavailable', manifest.production.cubismHeadlessExportAvailable === false, 'manual Editor export remains required'),
    ]),
    stage('genuine-cubism-export', exportAudit.status === 'go' ? 'go' : 'no_go', [
      check('export-audit-ready', manifest.production.cubismExportAuditReady === true),
      check('runtime-proof-template-ready', manifest.production.cubismRuntimeProofTemplateReady === true),
      check('runtime-proof-not-template', runtimeProof.status !== 'template_unverified', 'runtime proof is still a template'),
      check('cubism-export-ready', manifest.production.cubismExportReady === true, 'no genuine .moc3 export yet'),
      check('cubism-project-ready', manifest.production.cubismProjectReady === true, 'no Cubism project committed/exported yet'),
      check('export-audit-go', exportAudit.status === 'go', `export audit status=${exportAudit.status}`),
    ]),
    stage('distribution', 'no_go', [
      check('public-installer-allowed', manifest.distribution.publicInstallerAllowed === true, 'public installer is intentionally blocked'),
      check('store-package-allowed', manifest.distribution.storePackageAllowed === true, 'Store package is intentionally blocked'),
      check('source-release-excluded', manifest.distribution.sourceFilesReleaseExcluded === true),
      check('rights-review', manifest.distribution.rightsReviewRequired === false, 'rights review remains required'),
      check('live2d-license-review', manifest.distribution.live2dLicenseReviewRequired === false, 'Live2D license review remains required'),
    ]),
  ];

  const blockers = stages
    .filter(item => item.status !== 'go')
    .flatMap(item => item.checks.filter(check => check.status !== 'pass').map(check => `${item.id}:${check.id}`));
  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: blockers.length === 0 ? 'go' : 'no_go',
    summary: {
      requirements: 'go',
      sourceAndLayering: stages.find(item => item.id === 'source-and-layering').status,
      liteRuntime: stages.find(item => item.id === 'lite-runtime').status,
      appearanceAndWardrobe: stages.find(item => item.id === 'appearance-and-wardrobe').status,
      interaction: stages.find(item => item.id === 'interaction').status,
      cubismHandoff: stages.find(item => item.id === 'cubism-handoff').status,
      genuineCubismExport: stages.find(item => item.id === 'genuine-cubism-export').status,
      distribution: stages.find(item => item.id === 'distribution').status,
    },
    stages,
    blockers,
    goNoGo: {
      localLitePreview: 'go',
      editorHandoff: 'go',
      genuineCubismDefault: exportAudit.status === 'go' ? 'go' : 'no_go',
      trueWardrobe: manifest.production.trueOutfitSwapReady ? 'go' : 'no_go',
      publicDistribution: 'no_go',
    },
    nextRequiredEvidence: [
      'Human art review approval for source alignment, hands, lower body, hidden fill, and turn behavior.',
      'Profile/back source packages plus orientation-specific hit maps for true turn behavior.',
      'Separate source layers/drawables for true clothing variants beyond preview tint presets.',
      'Wardrobe contract blockers resolved: default outfit human approval and three future public outfit source packages.',
      'Cubism Editor project and exported moc3/model3/physics/cdi/texture files.',
      'Cubism Web runtime proof replacing the template_unverified proof JSON.',
      'Rights review and Live2D license review before public distribution.',
    ],
  };

  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_LIVE2D_DELIVERY_AUDIT_${report.status.toUpperCase()} stages=${stages.length} blockers=${blockers.length} report=${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
}

function stage(id, status, checks) {
  return { id, status, checks };
}

function check(id, passed, detail = '') {
  return { id, status: passed ? 'pass' : 'fail', detail };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

main();
