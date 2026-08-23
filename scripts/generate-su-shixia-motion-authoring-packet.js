const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const MOTION_ROOT = path.join(PACKAGE_ROOT, 'cubism-handoff', 'motions');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-motion-authoring-packet.json');

const GESTURE_TIERS = {
  idle_presence: ['Idle', 'Listen', 'Think', 'Return', 'Sleepy'],
  voice_speech: ['Speak', 'Nod', 'ShakeHead'],
  face_head_touch: ['TouchHead', 'TouchHair', 'TouchHairClip', 'TouchFace', 'TouchEar', 'TouchNeck'],
  hands_arms: ['TouchShoulder', 'TouchHand', 'TouchUpperArm', 'TouchForearm', 'TouchWrist', 'TouchPalm'],
  garment_torso: ['TouchCollar', 'TouchClothing', 'TouchBlouse', 'TouchChest', 'TouchRibs', 'TouchAbdomen', 'TouchWaist', 'TouchHip', 'TouchSkirt'],
  legs_feet: ['TouchLeg', 'TouchThigh', 'TouchKnee', 'TouchCalf', 'TouchAnkle', 'TouchFoot', 'TouchShoe'],
  turn_preview: ['TurnPreview'],
};

const QA_REPRESENTATIVES = ['Idle', 'Listen', 'Speak', 'TouchFace', 'TouchEar', 'TouchChest', 'TouchWaist', 'TouchSkirt', 'TouchThigh', 'TurnPreview', 'Sleepy'];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const matrix = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.interactionMatrix));
  const githubScan = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.githubReferenceScan));
  const motions = readMotionTemplates();
  const referenceByMotion = buildReferenceMap(githubScan.motionReferenceFamilies);
  const zoneByMotion = buildZoneMap(matrix.zones);
  const authoringRows = Object.values(motions)
    .sort((a, b) => a.motionGroup.localeCompare(b.motionGroup))
    .map(motion => authoringRow(motion, referenceByMotion, zoneByMotion));

  const packet = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: 'motion_authoring_packet_ready',
    source: {
      githubReferenceScan: manifest.sourceArt.githubReferenceScan,
      interactionMatrix: manifest.sourceArt.interactionMatrix,
      motionTemplateDirectory: manifest.sourceArt.cubismHandoffDirectory + '/motions',
      policy: 'Use GitHub repositories as timing, file-format, hit-test, and workflow references only. Do not copy third-party character assets or motion data into Su Shixia.',
    },
    gestureTiers: Object.entries(GESTURE_TIERS).map(([id, motionGroups]) => ({
      id,
      motionGroups,
      count: motionGroups.length,
      present: motionGroups.every(name => motions[name]),
    })),
    authoringRows,
    stiffnessReview: buildStiffnessReview(authoringRows),
    voiceSyncReview: buildVoiceSyncReview(authoringRows),
    touchReview: buildTouchReview(authoringRows),
    turnReview: {
      status: 'preview_only',
      motionGroup: 'TurnPreview',
      requirement: 'Use as a front-view 2.5D turn hint only until front/profile/back source packages and orientation-specific hit maps exist.',
      noGoForTrueTurn: [
        'No profile source package.',
        'No back source package.',
        'No orientation-specific hit maps.',
        'No Cubism Editor deformation proof.',
      ],
    },
    qaRepresentatives: QA_REPRESENTATIVES.map(name => ({
      motionGroup: name,
      present: Boolean(motions[name]),
      reason: qaReason(name),
    })),
    approvalGates: [
      gate('motion-reference-coverage', authoringRows.every(row => row.referenceFamilies.length > 0), 'Every Cubism motion template maps to at least one GitHub-backed reference family.'),
      gate('speech-mouth-curve-ready', hasCurve(motions.Speak, 'ParamMouthOpenY') && hasCurve(motions.Speak, 'ParamMouthForm'), 'Speech has mouth-open and mouth-form curves for TTS/lip-sync handoff.'),
      gate('touch-zone-motion-intent-ready', matrix.zones.every(zone => zone.motionIntent.trim().length > 0), 'Every hot zone carries a semantic motion intent.'),
      gate('private-zone-runtime-gated', matrix.zones.filter(zone => zone.privateModeAllowed).every(zone => zone.privateModeBoundary && zone.privateModeBoundary.includes('显式私密模式')), 'Private/sensitive zones stay runtime gated; model replies cannot bypass policy.'),
      gate('third-party-assets-not-copied', githubScan.adoptedDecisions.some(item => item.includes('not copied assets')), 'GitHub repos are references only, not asset sources.'),
      gate('true-turn-still-blocked', manifest.production.multiViewReady === false, 'TurnPreview remains a preview until multiview source packages exist.'),
    ],
    goNoGo: {
      motionAuthoringPacket: 'go',
      cubismMotionTemplates: 'go',
      voiceTimingHandoff: 'go',
      touchReactionStoryboard: 'go',
      stiffnessPolishApproved: 'no_go',
      genuineCubismMotionPlayback: 'no_go',
      trueTurn: 'no_go',
    },
    nextRequiredEvidence: [
      'Cubism Editor playback capture showing each representative motion is visually distinct and not stiff.',
      'Human review of shoulder, wrist, thigh, skirt, and chest reactions for natural timing.',
      'Voice/TTS capture with ParamMouthOpenY driven by real audio and motion blending.',
      'Profile/back source packages before any true turn or pose rotation claim.',
    ],
  };

  writeJson(OUTPUT_PATH, packet);
  console.log(`SU_SHIXIA_MOTION_AUTHORING_PACKET_GENERATED motions=${authoringRows.length} status=${packet.status}`);
}

function readMotionTemplates() {
  return fs.readdirSync(MOTION_ROOT)
    .filter(file => file.endsWith('.motion3.json'))
    .reduce((acc, file) => {
      const motion = readJson(path.join(MOTION_ROOT, file));
      const motionGroup = path.basename(file, '.motion3.json');
      const curves = motion.Curves ?? [];
      acc[motionGroup] = {
        motionGroup,
        duration: motion.Meta?.Duration ?? 0,
        fps: motion.Meta?.Fps ?? 0,
        loop: motion.Meta?.Loop === true,
        curveCount: curves.length,
        parameterIds: curves.map(curve => curve.Id),
        amplitudeScore: amplitudeScore(curves),
      };
      return acc;
    }, {});
}

function buildReferenceMap(families) {
  const byMotion = new Map();
  for (const family of families) {
    for (const motionGroup of family.motionGroups) {
      const values = byMotion.get(motionGroup) ?? [];
      values.push({
        id: family.id,
        label: family.label,
        githubRefs: family.githubRefs,
        use: family.use,
        boundary: family.boundary,
      });
      byMotion.set(motionGroup, values);
    }
  }
  return byMotion;
}

function buildZoneMap(zones) {
  return zones.reduce((acc, zone) => {
    if (!zone.motionGroup) return acc;
    const values = acc.get(zone.motionGroup) ?? [];
    values.push({
      id: zone.id,
      bodyPart: zone.bodyPart,
      sensitivity: zone.sensitivity,
      privateModeAllowed: zone.privateModeAllowed,
      motionIntent: zone.motionIntent,
    });
    acc.set(zone.motionGroup, values);
    return acc;
  }, new Map());
}

function authoringRow(motion, referenceByMotion, zoneByMotion) {
  const referenceFamilies = referenceByMotion.get(motion.motionGroup) ?? [];
  const zones = zoneByMotion.get(motion.motionGroup) ?? [];
  return {
    motionGroup: motion.motionGroup,
    tier: tierForMotion(motion.motionGroup),
    duration: motion.duration,
    loop: motion.loop,
    curveCount: motion.curveCount,
    parameterIds: motion.parameterIds,
    amplitudeScore: motion.amplitudeScore,
    referenceFamilies,
    zones,
    authoringIntent: authoringIntent(motion.motionGroup, zones),
    stiffnessRisk: stiffnessRisk(motion, zones),
    cubismPolishNeeded: [
      'Replace linear template feel with Cubism tangent/easing polish.',
      'Check mesh deformation at the most extreme keyframes.',
      'Tune hair, sleeve, skirt, and recovery overlap after real playback.',
    ],
  };
}

function buildStiffnessReview(rows) {
  const highRisk = rows.filter(row => row.stiffnessRisk === 'high').map(row => row.motionGroup);
  const mediumRisk = rows.filter(row => row.stiffnessRisk === 'medium').map(row => row.motionGroup);
  return {
    status: highRisk.length === 0 ? 'review_ready' : 'needs_polish',
    highRisk,
    mediumRisk,
    requirements: [
      'Every touch reaction needs anticipation, response, hold, and recovery phases.',
      'At least one secondary element should move for intimate or startled reactions: hair, sleeve, skirt, gaze, or hand overlay.',
      'Looping idle/listen/speak motions must remain subtle enough for long desktop use.',
    ],
  };
}

function buildVoiceSyncReview(rows) {
  const speak = rows.find(row => row.motionGroup === 'Speak');
  return {
    status: speak && speak.parameterIds.includes('ParamMouthOpenY') && speak.parameterIds.includes('ParamMouthForm') ? 'handoff_ready' : 'missing_speech_curves',
    motionGroup: 'Speak',
    duration: speak?.duration ?? 0,
    requiredRuntimeBlend: [
      'TTS amplitude owns ParamMouthOpenY.',
      'Motion template provides jaw rhythm and mouth-form bias only.',
      'Speaking state should blend with Listen/Idle without snapping head angle.',
    ],
  };
}

function buildTouchReview(rows) {
  const touchRows = rows.filter(row => row.motionGroup.startsWith('Touch'));
  return {
    status: 'storyboard_ready',
    count: touchRows.length,
    privateOrSensitiveMotions: touchRows
      .filter(row => row.zones.some(zone => zone.privateModeAllowed || zone.sensitivity !== 'neutral'))
      .map(row => row.motionGroup),
    representativeMotions: ['TouchFace', 'TouchPalm', 'TouchChest', 'TouchSkirt', 'TouchThigh'],
    runtimeBoundary: 'Persona may write the line; runtime owns zone permission, expression, cooldown, and motion allowlist.',
  };
}

function amplitudeScore(curves) {
  let total = 0;
  for (const curve of curves) {
    const values = [];
    const segments = curve.Segments ?? [];
    for (let index = 1; index < segments.length; index += 3) values.push(Number(segments[index]));
    if (values.length > 1) total += Math.max(...values) - Math.min(...values);
  }
  return Number(total.toFixed(3));
}

function stiffnessRisk(motion, zones) {
  if (motion.motionGroup === 'TurnPreview') return 'high';
  if (motion.curveCount <= 2 && zones.some(zone => zone.sensitivity !== 'neutral')) return 'high';
  if (motion.curveCount <= 2) return 'medium';
  if (motion.amplitudeScore < 2 && motion.motionGroup.startsWith('Touch')) return 'medium';
  return 'low';
}

function tierForMotion(motionGroup) {
  for (const [tier, groups] of Object.entries(GESTURE_TIERS)) {
    if (groups.includes(motionGroup)) return tier;
  }
  return 'uncategorized';
}

function authoringIntent(motionGroup, zones) {
  if (zones.length > 0) return zones.map(zone => zone.motionIntent).filter(Boolean).join(' / ');
  if (motionGroup === 'Speak') return 'Speech rhythm, mouth openness, tiny head motion, no robotic jaw snapping.';
  if (motionGroup === 'Idle') return 'Subtle breathing and small hair drift for long companion presence.';
  if (motionGroup === 'Listen') return 'Lean attention toward the user without overacting.';
  if (motionGroup === 'Think') return 'Small gaze and mouth-form changes to show thought.';
  if (motionGroup === 'TurnPreview') return 'Front-view hint for body/head turn only; not true rotation.';
  return 'State transition and recovery motion.';
}

function hasCurve(motion, id) {
  return Boolean(motion?.parameterIds?.includes(id));
}

function qaReason(name) {
  if (name === 'Speak') return 'Voice adaptation and mouth parameter proof.';
  if (name === 'TurnPreview') return 'Future turn boundary and current preview behavior.';
  if (name.startsWith('Touch')) return 'Body-zone touch reaction proof.';
  return 'Long-running companion state proof.';
}

function gate(id, passed, detail) {
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
