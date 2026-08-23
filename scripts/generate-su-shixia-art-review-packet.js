const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-art-review-packet.json');

const LANES = [
  {
    id: 'identity-default-read',
    label: 'Identity and default read',
    partMatchers: [/HEAD_FACE_BASE/, /HAIR_BANGS/, /ACCESSORY_HAIR_CLIP/, /BLOUSE_FRONT/, /SKIRT_FRONT/],
    passCriteria: [
      'Reads as Su Shixia at first glance: soft semi-real 20-ish default, black shoulder-length hair, A hair clip, white blouse, dark pleated skirt.',
      'No mechanical trim, costume armor shapes, or cheap AI artifact styling are visible in the first viewport pose.',
    ],
  },
  {
    id: 'hands-arms-anatomy',
    label: 'Hands, wrists, and arms',
    partMatchers: [/HAND/, /ARM/],
    passCriteria: [
      'Neutral hands, cheek-touch hands, wrists, and sleeve joins read as plausible anatomy at chat size and review size.',
      'Hidden wrist/forearm fill remains valid during hand-to-face and hand-rest motions.',
    ],
  },
  {
    id: 'hidden-fill-occlusion',
    label: 'Hidden fill and occlusion',
    partMatchers: [/TORSO_BASE/, /BLOUSE_BACK_FILL/, /SKIRT_REAR/, /WAIST_PELVIS/, /THIGH/, /ARM/],
    passCriteria: [
      'Occluded torso, blouse, skirt, pelvis, arm, and leg fills are hand-painted or approved before Cubism deformers are authored.',
      'No blank holes appear when breathing, shy recoil, turn preview, or hand-touch overlays move.',
    ],
  },
  {
    id: 'lower-body-shoes',
    label: 'Lower body, knees, ankles, shoes',
    partMatchers: [/THIGH/, /KNEE/, /CALF/, /SHOE/],
    passCriteria: [
      'Leg proportions, knees, calves, ankles, and shoes remain natural in the knee-up and full-body frames.',
      'Skirt hem and thigh boundaries do not create unintended exposure or broken occlusion in normal mode.',
    ],
  },
  {
    id: 'mouth-expression-speech',
    label: 'Mouth, eyes, expression, speech',
    partMatchers: [/MOUTH/, /EYE/, /BROW/, /BLUSH/],
    passCriteria: [
      'Six mouth states are style-consistent and suitable for TTS lip-sync without uncanny jumps.',
      'Eyes, brows, blush, shy, surprised, and soft smile states preserve the half-real half-anime direction.',
    ],
  },
  {
    id: 'alignment-scale',
    label: 'Alignment, scale, and canvas readability',
    partMatchers: [/.*/],
    passCriteria: [
      'All target rectangles reconstruct the front master without visible drift, jumps, or mismatched seams.',
      'Chat, overlay, pet, and compact sizes use a readable crop/scale; 220 px full-body is not accepted for emotional readability.',
    ],
  },
  {
    id: 'wardrobe-source-boundary',
    label: 'Wardrobe source boundary',
    partMatchers: [/BLOUSE/, /SKIRT/, /SHOE/, /ACCESSORY/],
    passCriteria: [
      'Classic daily outfit can be approved as the only current-source outfit.',
      'Assistant, home, ceremony, private, and adult outfits remain future source packages, not recolor-only production claims.',
    ],
  },
  {
    id: 'turn-multiview-boundary',
    label: 'Turn and multi-view boundary',
    partMatchers: [/HAIR/, /HEAD/, /TORSO/, /SKIRT/],
    passCriteria: [
      'Current TurnPreview is accepted only as a front-view 2.5D hint.',
      'Profile, back, rear three-quarter, and orientation-specific hit maps require separate reviewed source packages.',
    ],
  },
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const sourceReview = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.reviewReport));
  const inventory = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.partsInventory));
  const wardrobeAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-wardrobe-readiness-audit.json'));
  const orientationAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-orientation-readiness-audit.json'));

  const parts = inventory.parts ?? [];
  const laneReports = LANES.map(lane => {
    const matchingParts = parts.filter(part => lane.partMatchers.some(pattern => pattern.test(part.name)));
    const highRiskParts = matchingParts
      .map(part => partRisk(part, sourceReview))
      .filter(part => part.riskFlags.length > 0);
    return {
      id: lane.id,
      label: lane.label,
      status: 'review_required',
      evidence: evidenceForLane(lane.id, manifest),
      partCount: matchingParts.length,
      highRiskPartCount: highRiskParts.length,
      highRiskParts,
      passCriteria: lane.passCriteria,
      signoffFields: ['reviewer', 'reviewedAt', 'decision', 'notes'],
    };
  });

  const approvalGates = [
    gate('human-layer-review-approved', false, 'Human approval of source alignment, anatomy, identity, hands, lower body, and display scale is still missing.'),
    gate('hidden-fill-review-approved', false, 'Hand-painted or human-approved occluded torso, clothing, arm, and leg fills are still missing.'),
    gate('alignment-review-approved', false, 'The front alignment and scale previews still need visible signoff before Cubism import.'),
    gate('multi-view-source-ready', false, 'Profile/back source packages and orientation-specific hit maps are still missing.'),
    gate('true-outfit-source-ready', false, 'Only the default outfit source exists; future outfit source packages remain missing.'),
  ];

  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: 'manual_review_packet_ready',
    sourceStatus: sourceReview.status,
    evidence: {
      alignmentPreview: packagePath(manifest.sourceArt.alignmentPreview),
      scalePreview: packagePath(manifest.sourceArt.scalePreview),
      partsContactSheet: packagePath(manifest.sourceArt.partsContactSheet),
      runtimeMotionContactSheet: packagePath(manifest.sourceArt.runtimeVisualQaContactSheet),
      appearanceContactSheet: packagePath(manifest.sourceArt.appearanceVisualQaContactSheet),
      reviewDashboard: packagePath(manifest.sourceArt.reviewDashboard),
      sourceReview: packagePath(manifest.sourceArt.reviewReport),
      wardrobeAudit: manifest.sourceArt.wardrobeReadinessAudit,
      orientationAudit: manifest.sourceArt.orientationReadinessAudit,
    },
    openFindings: sourceReview.openFindings,
    reviewLanes: laneReports,
    approvalGates,
    blockerMapping: {
      'source-and-layering:human-layer-review-approved': ['identity-default-read', 'hands-arms-anatomy', 'lower-body-shoes', 'mouth-expression-speech', 'alignment-scale'],
      'source-and-layering:hidden-fill-review-approved': ['hidden-fill-occlusion'],
      'source-and-layering:alignment-review-approved': ['alignment-scale'],
      'source-and-layering:multi-view-source-ready': ['turn-multiview-boundary'],
      'appearance-and-wardrobe:true-outfit-swap': ['wardrobe-source-boundary'],
    },
    goNoGo: {
      packetReady: 'go',
      humanLayerReviewApproved: 'no_go',
      hiddenFillReviewApproved: 'no_go',
      alignmentReviewApproved: 'no_go',
      trueWardrobeSourceReady: wardrobeAudit.trueOutfitSwapReady ? 'go' : 'no_go',
      multiviewSourceReady: orientationAudit.goNoGo.fullTurnProduction === 'go' ? 'go' : 'no_go',
    },
    boundary: {
      doesNotApproveArtAutomatically: true,
      doesNotStartGenuineCubismRigging: true,
      doesNotClaimTrueWardrobe: true,
      doesNotClaimMultiView: true,
      requiredBeforeCubismImport: [
        'Human signoff on every review lane marked review_required.',
        'Resolved or waived open findings with reviewer notes.',
        'Updated manifest gates only after evidence files and signoff are present.',
      ],
    },
  };

  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_ART_REVIEW_PACKET_GENERATED lanes=${laneReports.length} status=${report.status}`);
}

function partRisk(part, sourceReview) {
  const geometry = sourceReview.geometry.find(item => item.name === part.name);
  const flags = [];
  if ((geometry?.aspectDistortion ?? 1) >= 1.7) flags.push('high-aspect-or-scale-review');
  if (/HAND|WRIST|ARM/.test(part.name)) flags.push('anatomy-and-joint-review');
  if (/BLOUSE_BACK_FILL|TORSO_BASE|WAIST_PELVIS|SKIRT_REAR|THIGH|ARM/.test(part.name)) flags.push('hidden-fill-review');
  if (/MOUTH/.test(part.name)) flags.push('speech-shape-review');
  if (/SHOE|KNEE|CALF/.test(part.name)) flags.push('lower-body-review');
  return {
    name: part.name,
    group: part.group,
    file: part.file,
    targetRect: part.targetRect,
    aspectDistortion: geometry?.aspectDistortion ?? null,
    riskFlags: [...new Set(flags)],
  };
}

function evidenceForLane(id, manifest) {
  const common = [packagePath(manifest.sourceArt.partsContactSheet), packagePath(manifest.sourceArt.alignmentPreview)];
  if (id === 'alignment-scale') return [packagePath(manifest.sourceArt.alignmentPreview), packagePath(manifest.sourceArt.scalePreview)];
  if (id === 'mouth-expression-speech') return [packagePath(manifest.sourceArt.mouthAtlas), packagePath(manifest.sourceArt.runtimeVisualQaContactSheet)];
  if (id === 'wardrobe-source-boundary') return [packagePath(manifest.sourceArt.appearanceVisualQaContactSheet), manifest.sourceArt.wardrobeContract];
  if (id === 'turn-multiview-boundary') return [manifest.sourceArt.orientationContract, manifest.sourceArt.orientationReadinessAudit];
  return common;
}

function gate(id, approved, detail) {
  return {
    id,
    approved,
    status: approved ? 'pass' : 'review_required',
    detail,
  };
}

function packagePath(relativePath) {
  return `assets/avatar/su-shixia-live2d-v2/${relativePath}`.replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main();
