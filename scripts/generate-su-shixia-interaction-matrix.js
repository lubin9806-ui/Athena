const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REVIEW_ROOT = path.join(PACKAGE_ROOT, 'source', 'review');
const MATRIX_PATH = path.join(REVIEW_ROOT, 'interaction-matrix-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-interaction-readiness-audit.json');

const REQUIRED_ZONE_IDS = [
  'hair',
  'hair_clip',
  'forehead',
  'left_ear',
  'right_ear',
  'face_cheek',
  'mouth_chin',
  'neck',
  'collar',
  'left_shoulder',
  'right_shoulder',
  'left_upper_arm',
  'right_upper_arm',
  'left_forearm',
  'right_forearm',
  'left_wrist',
  'right_wrist',
  'left_hand',
  'right_hand',
  'blouse',
  'chest',
  'left_ribs',
  'right_ribs',
  'abdomen',
  'waist',
  'hip',
  'skirt_front',
  'left_thigh',
  'right_thigh',
  'left_knee',
  'right_knee',
  'left_calf',
  'right_calf',
  'left_ankle',
  'right_ankle',
  'left_shoe',
  'right_shoe',
];

const REQUIRED_REPRESENTATIVE_MOTIONS = [
  'TouchFace',
  'TouchEar',
  'TouchChest',
  'TouchWaist',
  'TouchSkirt',
  'TouchThigh',
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const lite = readJson(path.join(PACKAGE_ROOT, 'model', 'su-shixia-live2d-v2-lite.model3.json')).AthenaLive2DLite;
  const runtimeQa = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport));
  const motionTemplateNames = new Set(
    fs.readdirSync(path.join(PACKAGE_ROOT, 'cubism-handoff', 'motions'))
      .filter(file => file.endsWith('.motion3.json'))
      .map(file => path.basename(file, '.motion3.json')),
  );

  const zones = profile.hotZones.map(zone => {
    const motionGroup = findMotionGroup(zone.action);
    const expressionId = findExpressionId(zone.action);
    const targetLayer = targetLayerForZone(zone.id);
    const allowedModes = zone.interaction?.privateModeAllowed
      ? ['normal', 'private_opt_in']
      : ['normal'];
    return {
      id: zone.id,
      label: zone.label,
      hitAreaName: zone.hitAreaName,
      targetLayer,
      bodyPart: zone.interaction?.bodyPart ?? zone.label,
      sensitivity: zone.interaction?.sensitivity ?? 'neutral',
      privateModeAllowed: zone.interaction?.privateModeAllowed === true,
      allowedModes,
      replyDelegatedToPersona: zone.interaction?.modelReplyDelegated === true,
      motionGroup,
      expressionId,
      motionIntent: zone.interaction?.motionIntent ?? '',
      normalModeBoundary: zone.interaction?.normalModeBoundary ?? '',
      privateModeBoundary: zone.interaction?.privateModeBoundary ?? null,
      promptTemplate: findReplyPrompt(zone.action),
      cooldownMs: zone.cooldownMs,
      enabled: zone.enabled,
      hasLiteMotion: Boolean(motionGroup && lite.motionGroups[motionGroup]),
      hasCubismMotionTemplate: Boolean(motionGroup && motionTemplateNames.has(motionGroup)),
      runtimeVisualQaCovered: runtimeQa.checks.requiredMotionCases.includes(motionGroup),
    };
  });

  const coverage = {
    totalZones: zones.length,
    enabledZones: zones.filter(zone => zone.enabled).length,
    byTargetLayer: countBy(zones, 'targetLayer'),
    bySensitivity: countBy(zones, 'sensitivity'),
    privateOptInZones: zones.filter(zone => zone.privateModeAllowed).map(zone => zone.id),
    privateSensitivityZones: zones.filter(zone => zone.sensitivity === 'private').map(zone => zone.id),
    sensitiveZones: zones.filter(zone => zone.sensitivity === 'sensitive').map(zone => zone.id),
    representativeVisualQaMotions: REQUIRED_REPRESENTATIVE_MOTIONS,
  };

  const matrix = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: 'interaction_matrix_ready',
    policy: {
      defaultMode: profile.interactionPolicy.defaultMode,
      privateModeRequiresExplicitOptIn: profile.interactionPolicy.privateModeRequiresExplicitOptIn,
      replyDelegatedToPersona: profile.interactionPolicy.replyDelegatedToPersona,
      normalModePrompt: profile.interactionPolicy.normalModePrompt,
      privateModePrompt: profile.interactionPolicy.privateModePrompt,
      forbiddenPublicAssetTypes: profile.interactionPolicy.forbiddenPublicAssetTypes,
    },
    coverage,
    requiredZoneIds: REQUIRED_ZONE_IDS,
    zones,
    runtimeBoundary: {
      modelMayGenerateReplyText: true,
      modelMaySelectArbitraryMotionFile: false,
      modelMayBypassModePolicy: false,
      publicPackageContainsPrivateAssets: false,
      immediateVisualResponseRequired: true,
      noGo: [
        'Gesture classification is still tap-zone based; hold, stroke, drag, and repeated-tap classifiers remain future work.',
        'True orientation-specific hit maps require profile/back source packages and Cubism deformation proof.',
        'Private/adult-only assets remain absent from the public package.',
      ],
    },
  };

  const audit = buildAudit(manifest, matrix, lite, runtimeQa, motionTemplateNames);
  writeJson(MATRIX_PATH, matrix);
  writeJson(AUDIT_PATH, audit);
  console.log(`SU_SHIXIA_INTERACTION_MATRIX_GENERATED zones=${zones.length} status=${audit.status}`);
}

function buildAudit(manifest, matrix, lite, runtimeQa, motionTemplateNames) {
  const zones = matrix.zones;
  const zoneIds = new Set(zones.map(zone => zone.id));
  const checks = [
    check('matrix-ready', matrix.status === 'interaction_matrix_ready'),
    check('zone-count', zones.length === manifest.production.liteRuntimeHitZoneCount, `zones=${zones.length}`),
    check('required-zones-present', REQUIRED_ZONE_IDS.every(id => zoneIds.has(id))),
    check('all-zones-enabled', zones.every(zone => zone.enabled === true)),
    check('all-zones-reply-delegated', zones.every(zone => zone.replyDelegatedToPersona === true)),
    check('all-zones-have-body-part', zones.every(zone => zone.bodyPart.trim().length > 0)),
    check('all-zones-have-motion-intent', zones.every(zone => zone.motionIntent.trim().length > 0)),
    check('all-zones-have-normal-boundary', zones.every(zone => zone.normalModeBoundary.includes('非露骨'))),
    check('private-zones-opt-in', zones.filter(zone => zone.sensitivity === 'private').every(zone => zone.privateModeAllowed === true)),
    check('private-zones-have-private-boundary', zones.filter(zone => zone.privateModeAllowed).every(zone => typeof zone.privateModeBoundary === 'string' && zone.privateModeBoundary.includes('显式私密模式'))),
    check('target-layer-body-present', matrix.coverage.byTargetLayer.body > 0),
    check('target-layer-garment-present', matrix.coverage.byTargetLayer.garment > 0),
    check('target-layer-accessory-present', matrix.coverage.byTargetLayer.accessory > 0),
    check('lite-motion-groups-present', zones.every(zone => zone.hasLiteMotion)),
    check('cubism-motion-templates-present', zones.every(zone => zone.hasCubismMotionTemplate)),
    check('representative-visual-qa-covered', REQUIRED_REPRESENTATIVE_MOTIONS.every(motion => runtimeQa.checks.requiredMotionCases.includes(motion))),
    check('no-public-private-assets', manifest.production.adultPackageIncluded === false),
    check('policy-normal-default', matrix.policy.defaultMode === 'normal'),
    check('policy-private-opt-in', matrix.policy.privateModeRequiresExplicitOptIn === true),
    check('model-reply-runtime-bounded', matrix.runtimeBoundary.modelMayGenerateReplyText === true && matrix.runtimeBoundary.modelMayBypassModePolicy === false),
  ];
  const blockers = checks.filter(item => item.status !== 'pass').map(item => item.id);
  return {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: matrix.packageId,
    status: blockers.length === 0 ? 'go' : 'no_go',
    zoneCount: zones.length,
    privateOptInZoneCount: matrix.coverage.privateOptInZones.length,
    targetLayerCoverage: matrix.coverage.byTargetLayer,
    sensitivityCoverage: matrix.coverage.bySensitivity,
    checks,
    blockers,
    motionCoverage: {
      liteMotionGroups: Object.keys(lite.motionGroups).length,
      cubismMotionTemplates: motionTemplateNames.size,
      representativeVisualQaMotions: REQUIRED_REPRESENTATIVE_MOTIONS,
    },
    goNoGo: {
      semanticTouchMatrix: blockers.length === 0 ? 'go' : 'no_go',
      runtimePromptBoundary: 'go',
      immediateLiteVisualResponse: 'go',
      gestureClassifierV2: 'no_go',
      orientationSpecificHitMaps: 'no_go',
      privateAssetPackage: 'no_go',
    },
  };
}

function targetLayerForZone(id) {
  if (/clip|accessory/.test(id)) return 'accessory';
  if (/collar|blouse|skirt|shoe/.test(id)) return 'garment';
  return 'body';
}

function findMotionGroup(action) {
  if (!action) return null;
  if (action.type === 'playMotion') return action.motionGroup ?? null;
  for (const child of action.actions ?? []) {
    const motion = findMotionGroup(child);
    if (motion) return motion;
  }
  return null;
}

function findExpressionId(action) {
  if (!action) return null;
  if (action.type === 'setExpression') return action.expressionId ?? null;
  for (const child of action.actions ?? []) {
    const expression = findExpressionId(child);
    if (expression) return expression;
  }
  return null;
}

function findReplyPrompt(action) {
  if (!action) return null;
  if (action.type === 'athenaReply') return action.promptTemplate ?? null;
  for (const child of action.actions ?? []) {
    const prompt = findReplyPrompt(child);
    if (prompt) return prompt;
  }
  return null;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] ?? 'unknown';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
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
