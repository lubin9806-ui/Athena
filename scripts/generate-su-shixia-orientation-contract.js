const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REVIEW_ROOT = path.join(PACKAGE_ROOT, 'source', 'review');
const CONTRACT_PATH = path.join(REVIEW_ROOT, 'orientation-contract-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-orientation-readiness-audit.json');

const ORIENTATION_IDS = [
  'front',
  'front_three_quarter_left',
  'profile_left',
  'rear_three_quarter_left',
  'back',
  'rear_three_quarter_right',
  'profile_right',
  'front_three_quarter_right',
];

const REQUIRED_TRANSITIONS = [
  ['front', 'front_three_quarter_left'],
  ['front_three_quarter_left', 'profile_left'],
  ['profile_left', 'rear_three_quarter_left'],
  ['rear_three_quarter_left', 'back'],
  ['back', 'rear_three_quarter_right'],
  ['rear_three_quarter_right', 'profile_right'],
  ['profile_right', 'front_three_quarter_right'],
  ['front_three_quarter_right', 'front'],
];

const ORIENTATION_HIT_MAP_REQUIREMENTS = [
  'visible target layer resolution: body, garment, accessory',
  'orientation-specific face, hair, ear, neck, torso, arm, garment, and lower-body rectangles',
  'hidden-zone suspension during transition crossfade',
  'asymmetric A hair clip side preservation',
  'normal/private mode boundary inheritance from interaction matrix',
  'outfit occlusion map compatibility',
  'representative screenshot proof after Cubism export',
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const lite = readJson(path.join(PACKAGE_ROOT, 'model', 'su-shixia-live2d-v2-lite.model3.json')).AthenaLive2DLite;
  const interactionMatrix = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.interactionMatrix));
  const runtimeQa = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport));

  const orientations = ORIENTATION_IDS.map(id => orientation(id, manifest, profile));
  const transitions = REQUIRED_TRANSITIONS.map(([from, to]) => ({
    id: `${from}_to_${to}`,
    from,
    to,
    sourceStatus: from === 'front' && to === 'front_three_quarter_left'
      ? 'storyboard_reference_only'
      : 'future_source_required',
    requiredAssets: [
      'entry anticipation pose',
      'silhouette-compatible crossfade frame',
      'destination settle pose',
      'destination hit-map activation threshold',
      'reverse-compatible motion review',
    ],
    runtimePolicy: [
      'lock current hit map while crossfading',
      'preserve speech only if destination supports mouth and face parameters',
      'carry semantic intent but re-resolve available motions after settle',
      'do not mirror asymmetric hair clip blindly',
    ],
  }));

  const contract = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: 'orientation_contract_ready_multiview_sources_required',
    currentRuntime: {
      activeOrientation: 'front',
      availableSourceOrientations: ['front'],
      availableRuntimeOrientations: ['front'],
      turnPreviewMotionGroup: 'TurnPreview',
      turnPreviewCapability: lite.motionGroups.TurnPreview ? 'front_view_2_5d_hint_only' : 'missing',
      turnPreviewVisualQaCovered: runtimeQa.checks.requiredMotionCases.includes('TurnPreview'),
      multiViewReady: manifest.production.multiViewReady === true,
    },
    conceptReferences: [
      'docs/concepts/su-shixia-live2d-v2-default-turnaround-v1.png',
      'docs/concepts/su-shixia-live2d-v2-turn-touch-storyboard-v1.png',
    ],
    orientations,
    transitions,
    hitMapRequirements: ORIENTATION_HIT_MAP_REQUIREMENTS,
    interactionInheritance: {
      source: manifest.sourceArt.interactionMatrix,
      frontZoneCount: interactionMatrix.coverage.totalZones,
      privateOptInZoneCount: interactionMatrix.coverage.privateOptInZones.length,
      rule: 'Each orientation must derive its active zones from visible layers, not blindly copy the front rectangles.',
    },
    noGoUntil: [
      'Profile and back source packages exist as layered transparent assets.',
      'At least front, profile_left, profile_right, and back have reviewed orientation-specific hit maps.',
      'Turn transitions have authored entry, crossfade, and settle assets.',
      'Cubism export or equivalent runtime proof demonstrates orientation handoff without broken hair, clothing, or touch zones.',
    ],
  };

  const audit = orientationAudit(manifest, contract);
  writeJson(CONTRACT_PATH, contract);
  writeJson(AUDIT_PATH, audit);
  console.log(`SU_SHIXIA_ORIENTATION_CONTRACT_GENERATED orientations=${contract.orientations.length} status=${audit.status}`);
}

function orientation(id, manifest, profile) {
  const isFront = id === 'front';
  const isProfile = id.includes('profile');
  const isBack = id === 'back';
  const isRear = id.includes('rear') || isBack;
  const requiredZoneFamilies = isBack
    ? ['hair-rear', 'neck-back', 'shoulder-back', 'back-upper', 'back-lower', 'waist-back', 'skirt-back', 'calf', 'shoe']
    : isProfile
      ? ['hair-side', 'ear-visible', 'face-profile', 'neck-side', 'torso-side', 'arm-side', 'waist-side', 'leg-side', 'shoe-side']
      : ['hair', 'face', 'ear', 'neck', 'torso', 'arms', 'hands', 'garment', 'lower-body', 'shoes'];
  return {
    id,
    sourceStatus: isFront ? 'current_front_source_review_required' : 'future_source_required',
    runtimeStatus: isFront ? 'lite_front_runtime_preview' : 'not_available',
    requiredSourcePackage: isFront ? manifest.sourceArt.layeredPsd : `future source/${id}/layered source package`,
    requiredZoneFamilies,
    expectedHitZonePolicy: {
      copyFrontZonesAllowed: false,
      visibleLayerFirst: true,
      privateModeBoundaryInherited: true,
      garmentOcclusionRequired: true,
      asymmetricAccessoryReviewRequired: true,
    },
    unavailableFrontZones: isRear
      ? ['face_cheek', 'mouth_chin', 'forehead', 'chest', 'blouse']
      : [],
    reusableFrontSemantics: isFront ? profile.hotZones.map(zone => zone.id) : [],
  };
}

function orientationAudit(manifest, contract) {
  const sourceReady = contract.orientations.filter(item => item.sourceStatus === 'current_front_source_review_required');
  const futureSources = contract.orientations.filter(item => item.sourceStatus === 'future_source_required');
  const checks = [
    check('contract-ready', contract.status === 'orientation_contract_ready_multiview_sources_required'),
    check('eight-orientation-targets', contract.orientations.length === 8),
    check('front-source-exists', sourceReady.some(item => item.id === 'front')),
    check('turn-preview-visual-qa', contract.currentRuntime.turnPreviewVisualQaCovered === true),
    check('interaction-inheritance', contract.interactionInheritance.frontZoneCount === manifest.production.liteRuntimeHitZoneCount),
    check('transition-plan-complete', contract.transitions.length === 8),
    check('hit-map-requirements-ready', contract.hitMapRequirements.length >= 7),
    check('multiview-production-ready', manifest.production.multiViewReady === true, 'profile/back source packages and hit maps are not ready'),
    check('profile-left-source-ready', futureSources.every(item => item.id !== 'profile_left'), 'profile_left source package missing'),
    check('profile-right-source-ready', futureSources.every(item => item.id !== 'profile_right'), 'profile_right source package missing'),
    check('back-source-ready', futureSources.every(item => item.id !== 'back'), 'back source package missing'),
    check('orientation-specific-hit-maps-ready', false, 'only front hit rectangles exist'),
  ];
  const blockers = checks.filter(item => item.status !== 'pass').map(item => item.id);
  return {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: contract.packageId,
    status: blockers.length === 0 ? 'go' : 'no_go',
    sourceReadyOrientationCount: sourceReady.length,
    futureSourceOrientationCount: futureSources.length,
    turnPreviewVisualQaCovered: contract.currentRuntime.turnPreviewVisualQaCovered,
    checks,
    blockers,
    goNoGo: {
      orientationContract: 'go',
      frontOrientationLitePreview: 'go',
      turnPreview2_5dHint: contract.currentRuntime.turnPreviewVisualQaCovered ? 'go' : 'no_go',
      profileSourcePackages: 'no_go',
      backSourcePackage: 'no_go',
      orientationSpecificHitMaps: 'no_go',
      fullTurnProduction: 'no_go',
    },
    requiredEvidence: contract.noGoUntil,
  };
}

function check(id, passed, detail = '') {
  return { id, status: passed ? 'pass' : 'fail', detail };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main();
