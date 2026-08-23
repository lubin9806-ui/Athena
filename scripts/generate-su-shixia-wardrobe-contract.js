const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const WARDROBE_ROOT = path.join(PACKAGE_ROOT, 'wardrobe');
const HANDOFF_ROOT = path.join(PACKAGE_ROOT, 'cubism-handoff');
const CONTRACT_PATH = path.join(WARDROBE_ROOT, 'wardrobe-contract-v1.json');
const BINDING_PLAN_PATH = path.join(HANDOFF_ROOT, 'wardrobe-binding-plan-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-wardrobe-readiness-audit.json');

const GARMENT_GROUPS = [
  'torso-front',
  'torso-back',
  'left-sleeve',
  'right-sleeve',
  'collar-neckline',
  'waist-connection',
  'lower-front',
  'lower-side',
  'lower-rear',
  'arm-pose-variants',
  'orientation-variants',
  'hot-zone-occlusion-map',
];

const REQUIRED_QA = [
  'front alignment and hidden-fill review',
  'bust, waist, hip, skirt/trouser occlusion review',
  'arm-lift, cheek-touch, chest-protection, and hand-near-face compatibility',
  'idle, speak, touch-face, touch-chest, touch-waist, touch-skirt, and turn-preview motion QA',
  'normal and private-opt-in mode hit-zone policy proof',
  'Cubism Web screenshot/contact-sheet proof after genuine export',
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const contract = wardrobeContract(manifest);
  const bindingPlan = wardrobeBindingPlan(contract);
  const audit = wardrobeAudit(contract, bindingPlan, manifest);

  writeJson(CONTRACT_PATH, contract);
  writeJson(BINDING_PLAN_PATH, bindingPlan);
  writeJson(AUDIT_PATH, audit);

  console.log(`SU_SHIXIA_WARDROBE_CONTRACT_GENERATED outfits=${contract.publicOutfits.length} ready=${audit.trueOutfitSwapReady}`);
}

function wardrobeContract(manifest) {
  return {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: 'contract_ready_true_outfit_sources_required',
    defaultOutfitId: 'classic_daily',
    activeRuntimeSupport: {
      appearancePresetIds: [
        'classic_blouse_navy',
        'soft_office_gray',
        'warm_evening',
        'blue_focus',
        'no_clip_minimal',
      ],
      currentCapability: 'preview tint and accessory visibility only',
      trueOutfitSwapReady: false,
      boundary: 'Do not present these presets as separate garment silhouettes.',
    },
    publicOutfits: [
      outfit({
        id: 'classic_daily',
        label: 'Signature Daily',
        intent: 'Default white blouse, deep navy high-waisted pleated skirt, silver A hair clip.',
        contentRating: 'public',
        sourceStatus: 'current_source_exists_review_required',
        cubismParameter: 'ParamOutfitClassic',
        defaultValue: 1,
        existingSourceLayers: [
          'SSX_BLOUSE_FRONT',
          'SSX_BLOUSE_COLLAR_L',
          'SSX_BLOUSE_COLLAR_R',
          'SSX_BLOUSE_SLEEVE_L',
          'SSX_BLOUSE_SLEEVE_R',
          'SSX_SKIRT_WAISTBAND',
          'SSX_SKIRT_PANEL_L',
          'SSX_SKIRT_PANEL_C',
          'SSX_SKIRT_PANEL_R',
        ],
        missingForProduction: [
          'human-polished hidden fill',
          'arm-pose garment variants',
          'true Cubism opacity binding',
          'skirt pleat physics after mesh authoring',
        ],
      }),
      outfit({
        id: 'soft_assistant',
        label: 'Soft Assistant',
        intent: 'Draped blouse, fine-knit cardigan, flowing dark skirt; no rigid suits or mechanical trim.',
        contentRating: 'public',
        sourceStatus: 'future_source_required',
        cubismParameter: 'ParamOutfitAssistant',
        defaultValue: 0,
        missingForProduction: [
          'cardigan source layers',
          'draped blouse source layers',
          'flowing skirt source layers',
          'cloth physics and clipping',
        ],
      }),
      outfit({
        id: 'home_companion',
        label: 'Home Companion',
        intent: 'Soft knit top with relaxed lower garment for rest, sleep, and long companionship scenes.',
        contentRating: 'public',
        sourceStatus: 'future_source_required',
        cubismParameter: 'ParamOutfitHome',
        defaultValue: 0,
        missingForProduction: [
          'knit top source layers',
          'relaxed lower garment source layers',
          'sitting/rest pose compatibility review',
          'sleepy and idle cloth-follow QA',
        ],
      }),
      outfit({
        id: 'ivory_ceremony',
        label: 'Ivory Ceremony',
        intent: 'Elegant ivory draped evening gown with restrained silver details and optional high ponytail.',
        contentRating: 'public',
        sourceStatus: 'future_source_required',
        cubismParameter: 'ParamOutfitCeremony',
        defaultValue: 0,
        missingForProduction: [
          'gown bodice source layers',
          'draped skirt and train source layers',
          'high-ponytail hair variant source',
          'long-cloth physics and draw-order QA',
        ],
      }),
    ],
    privatePackageBoundary: {
      id: 'private_opt_in',
      contentRating: 'private-adult-opt-in',
      includedInPublicPackage: false,
      includedInStorePackage: false,
      sourceStatus: 'separate_package_required',
      runtimeRequirement: 'normal mode must never load, advertise, or select private outfit or pose assets',
      notes: [
        'Private/adult assets must live outside the public Su Shixia package.',
        'The persona model may respond within the active mode, but runtime policy decides which motions and assets are valid.',
        'No private body or explicit pose image assets are present in this package.',
      ],
    },
    sharedRequirements: {
      garmentGroups: GARMENT_GROUPS,
      requiredQa: REQUIRED_QA,
      bodyPresetPolicy: 'Every body preset needs outfit-compatible art and motion QA; no arbitrary 3D-style body morph promise.',
      orientationPolicy: 'Front, three-quarter, profile, and back views require separate reviewed source or authored Cubism deformation proof.',
      hotZonePolicy: 'Outfit changes must update occlusion and sensitivity metadata before touch zones are active.',
    },
    noGoUntil: [
      'All public outfit source packages exist and pass source review.',
      'Cubism drawables, clipping, draw order, and visibility parameters are authored for each outfit.',
      'Runtime QA proves outfit switching without layer popping, broken touch zones, or invalid motions.',
      'A genuine Cubism export and Cubism Web runtime proof exist.',
    ],
  };
}

function outfit(input) {
  return {
    id: input.id,
    label: input.label,
    intent: input.intent,
    contentRating: input.contentRating,
    sourceStatus: input.sourceStatus,
    cubismParameter: input.cubismParameter,
    defaultValue: input.defaultValue,
    requiredGarmentGroups: GARMENT_GROUPS,
    existingSourceLayers: input.existingSourceLayers ?? [],
    missingForProduction: input.missingForProduction,
    compatibleModes: ['normal', 'private-opt-in'],
    motionCompatibility: [
      'Idle',
      'Listen',
      'Speak',
      'TouchFace',
      'TouchChest',
      'TouchWaist',
      'TouchSkirt',
      'TurnPreview',
      'Sleepy',
    ],
    requiresOcclusionReviewForZones: [
      'collar',
      'blouse',
      'chest',
      'ribs',
      'abdomen',
      'waist',
      'hip',
      'skirt-or-lower-garment',
      'thigh',
      'knee',
    ],
  };
}

function wardrobeBindingPlan(contract) {
  const outfitParameters = contract.publicOutfits.map(item => ({
    id: item.cubismParameter,
    label: `${item.label} Visibility`,
    min: 0,
    max: 1,
    defaultValue: item.defaultValue,
    target: 'partOpacity',
    sourceStatus: item.sourceStatus,
    requiredSource: item.sourceStatus === 'current_source_exists_review_required'
      ? 'current default outfit layers plus human polish'
      : `future ${item.id} layered source package`,
  }));

  return {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: contract.packageId,
    status: 'binding_plan_ready_sources_required',
    parameterGroup: {
      id: 'ParamGroupWardrobe',
      name: 'Wardrobe',
      ids: outfitParameters.map(item => item.id),
    },
    outfitParameters,
    drawOrderRules: [
      'Only one public outfit visibility parameter may be 1 at a time.',
      'Body base stays below clothing layers and above private package exclusion guards.',
      'Hands and forearms remain above compatible sleeves only when the outfit declares that arm pose valid.',
      'Hair and accessory layers stay outfit-independent unless the outfit declares a hairstyle variant.',
    ],
    clippingRules: [
      'Sleeves clip to upper arms and expose hidden fill during hand-to-face motions.',
      'Collar and neckline clip to torso and neck without covering mouth or chin zones.',
      'Lower garment clips to waist, hip, and leg groups without hiding touch-zone boundaries.',
      'Long gown or relaxed trouser variants require separate lower-body clipping and motion QA.',
    ],
    runtimeSwitchRules: [
      'Switch outfit during idle or an explicit transition motion only.',
      'Suspend ambiguous torso and lower-body hit zones during the switch.',
      'Recompute active hit areas from the outfit occlusion map before accepting touch input.',
      'Persist chosen outfit separately from color/accessory appearance presets.',
    ],
    noGoBoundary: contract.noGoUntil,
  };
}

function wardrobeAudit(contract, bindingPlan, manifest) {
  const sourceReadyOutfits = contract.publicOutfits.filter(item => item.sourceStatus === 'current_source_exists_review_required');
  const futureOutfits = contract.publicOutfits.filter(item => item.sourceStatus === 'future_source_required');
  const checks = [
    check('contract-ready', contract.status === 'contract_ready_true_outfit_sources_required'),
    check('four-public-outfits', contract.publicOutfits.length === 4),
    check('default-outfit-defined', contract.defaultOutfitId === 'classic_daily'),
    check('private-boundary-excluded', contract.privatePackageBoundary.includedInPublicPackage === false && contract.privatePackageBoundary.includedInStorePackage === false),
    check('binding-plan-ready', bindingPlan.status === 'binding_plan_ready_sources_required'),
    check('wardrobe-parameter-count', bindingPlan.outfitParameters.length === 4),
    check('current-runtime-preview-only', contract.activeRuntimeSupport.trueOutfitSwapReady === false),
    check('manifest-true-outfit-swap-not-ready', manifest.production.trueOutfitSwapReady === false, 'true outfit swap remains intentionally blocked'),
    check('all-public-sources-ready', futureOutfits.length === 0, `${futureOutfits.length} future outfit source packages missing`),
    check('default-source-human-approved', sourceReadyOutfits.every(item => item.missingForProduction.length === 0), 'default outfit still needs human hidden-fill and Cubism polish'),
  ];
  const blockers = checks.filter(item => item.status !== 'pass').map(item => item.id);
  return {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: contract.packageId,
    status: blockers.length === 0 ? 'go' : 'no_go',
    trueOutfitSwapReady: false,
    sourceReadyOutfitCount: sourceReadyOutfits.length,
    futureSourceOutfitCount: futureOutfits.length,
    checks,
    blockers,
    goNoGo: {
      wardrobeContract: 'go',
      cubismBindingPlan: 'go',
      currentDefaultOutfitSource: 'partial',
      truePublicOutfitSwap: 'no_go',
      privateOutfitPackage: 'no_go',
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
