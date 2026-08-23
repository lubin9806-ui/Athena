const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const SOURCE_PARTS = path.join(PACKAGE_ROOT, 'source', 'parts', 'layers-v1');
const MODEL_ROOT = path.join(PACKAGE_ROOT, 'model');
const MODEL_PARTS = path.join(MODEL_ROOT, 'layers-v1');

const CANVAS = { width: 920, height: 1712 };
const PARAMETERS = {
  ParamAngleX: { default: 0, min: -30, max: 30 },
  ParamAngleY: { default: 0, min: -30, max: 30 },
  ParamAngleZ: { default: 0, min: -30, max: 30 },
  ParamEyeLOpen: { default: 1, min: 0, max: 1 },
  ParamEyeROpen: { default: 1, min: 0, max: 1 },
  ParamEyeBallX: { default: 0, min: -1, max: 1 },
  ParamEyeBallY: { default: 0, min: -1, max: 1 },
  ParamMouthOpenY: { default: 0, min: 0, max: 1 },
  ParamMouthForm: { default: 0, min: -1, max: 1 },
  ParamBodyAngleX: { default: 0, min: -10, max: 10 },
  ParamBreath: { default: 0, min: 0, max: 1 },
  ParamHairSwing: { default: 0, min: -1, max: 1 },
  ParamTurnX: { default: 0, min: -1, max: 1 },
  ParamBodyCurve: { default: 0, min: -1, max: 1 },
};

const EXPRESSIONS = {
  neutral: { mouthForm: 0, mouthOpen: 0, eyeOpen: 1, blush: 0.16, brow: 0 },
  happy: { mouthForm: 0.72, mouthOpen: 0.16, eyeOpen: 0.88, blush: 0.34, brow: 0.08 },
  soft_smile: { mouthForm: 0.5, mouthOpen: 0.04, eyeOpen: 0.95, blush: 0.24, brow: 0 },
  thoughtful: { mouthForm: -0.16, mouthOpen: 0.02, eyeOpen: 0.9, blush: 0.12, brow: -0.12 },
  shy: { mouthForm: 0.28, mouthOpen: 0.02, eyeOpen: 0.78, blush: 0.68, brow: 0.1 },
  confused: { mouthForm: -0.32, mouthOpen: 0.16, eyeOpen: 0.96, blush: 0.16, brow: -0.24 },
  surprised: { mouthForm: -0.08, mouthOpen: 0.62, eyeOpen: 1, blush: 0.22, brow: 0.2 },
  focused: { mouthForm: -0.04, mouthOpen: 0, eyeOpen: 0.86, blush: 0.1, brow: -0.18 },
  worried: { mouthForm: -0.46, mouthOpen: 0.08, eyeOpen: 0.9, blush: 0.22, brow: -0.3 },
  sleepy: { mouthForm: -0.1, mouthOpen: 0.04, eyeOpen: 0.42, blush: 0.1, brow: -0.04 },
  playful: { mouthForm: 0.82, mouthOpen: 0.2, eyeOpen: 0.8, blush: 0.32, brow: 0.16 },
};

const MOTION_GROUPS = {
  Idle: ['reference:Haru/Idle', 'breath', 'blink', 'hair_sway'],
  Listen: ['reference:Haru/Listen', 'lean_in'],
  Think: ['reference:Haru/Think', 'look_side'],
  Speak: ['reference:Haru/Speak', 'mouth_sync'],
  Greet: ['reference:Haru/Greet', 'soft_greet'],
  Nod: ['reference:Haru/Nod', 'small_nod'],
  ShakeHead: ['reference:Haru/ShakeHead', 'boundary_no'],
  Wave: ['reference:Haru/Wave', 'hand_wave'],
  TouchHead: ['reference:Haru/TouchHead', 'head_pat_react'],
  TouchHair: ['reference:Haru/TouchHair', 'hair_touch_react'],
  TouchHairClip: ['reference:Haru/TouchHair', 'clip_touch_react'],
  TouchFace: ['reference:su-shixia-touch-storyboard', 'cheek_shy_react'],
  TouchHand: ['reference:Haru/TouchHand', 'hand_touch_react'],
  TouchClothing: ['reference:Haru/TouchOutfit', 'clothing_adjust_react'],
  TouchChest: ['reference:private-zone-boundary', 'cover_stepback_react'],
  TouchWaist: ['reference:Haru/TapBody', 'waist_shy_react'],
  TouchLeg: ['reference:Haru/TapBody', 'leg_touch_react'],
  TouchFoot: ['reference:Haru/TapBody', 'foot_shift_react'],
  TurnPreview: ['reference:su-shixia-turnaround', 'front_turn_preview'],
  Drag: ['reference:Haru/TapBody', 'drag_follow'],
  Return: ['reference:Haru/Idle', 'return_idle'],
  Sleepy: ['reference:Haru/Sleepy', 'sleepy_idle'],
};

const HOT_ZONES = [
  zone('hair', 'Hair', 'Hair', [0.34, 0.03, 0.33, 0.15], 'TouchHair', 'playful', '用户轻触了你的头发。用苏时夏的人格语气自然回应，带一点轻巧的反应，但不要夸张。'),
  zone('hair_clip', 'Hair Clip', 'HairClip', [0.55, 0.07, 0.08, 0.06], 'TouchHairClip', 'shy', '用户碰到了你的银色 A 字发夹。用苏时夏的人格语气回应，可以有一点害羞和整理发夹的动作感。'),
  zone('forehead', 'Forehead', 'Forehead', [0.41, 0.10, 0.18, 0.07], 'TouchHead', 'soft_smile', '用户轻触了你的额头。用苏时夏的人格语气给一句温柔、自然、简短的回应。'),
  zone('face_cheek', 'Face And Cheek', 'Face', [0.39, 0.13, 0.22, 0.13], 'TouchFace', 'shy', '用户轻触了你的脸颊。用苏时夏的人格语气回应，允许害羞，但保持自然和边界。'),
  zone('mouth_chin', 'Mouth And Chin', 'MouthChin', [0.43, 0.22, 0.14, 0.06], 'TouchFace', 'surprised', '用户点到了你的嘴唇或下巴附近。用苏时夏的人格语气给一句短反馈，表现一点惊讶和不好意思。'),
  zone('neck_collar', 'Neck And Collar', 'NeckCollar', [0.39, 0.25, 0.22, 0.08], 'TouchClothing', 'shy', '用户碰到了你的脖颈或衣领。用苏时夏的人格语气回应，动作上轻轻缩肩或整理衣领。'),
  zone('shoulders', 'Shoulders', 'Shoulder', [0.28, 0.30, 0.44, 0.08], 'Nod', 'soft_smile', '用户轻触了你的肩膀。用苏时夏的人格语气自然回应，可以像被叫住一样看向用户。'),
  zone('hands', 'Hands', 'Hand', [0.20, 0.47, 0.58, 0.11], 'TouchHand', 'happy', '用户碰到了你的手。用苏时夏的人格语气回应，像轻轻打招呼或短暂牵手的氛围。'),
  zone('chest', 'Chest', 'Chest', [0.37, 0.33, 0.26, 0.12], 'TouchChest', 'shy', '用户碰到了你的胸口区域。回应交给苏时夏人格，但必须经过运行时模式和边界校验。'),
  zone('waist', 'Waist', 'Waist', [0.35, 0.45, 0.30, 0.08], 'TouchWaist', 'shy', '用户碰到了你的腰部。回应交给苏时夏人格，并根据当前模式控制亲密程度。'),
  zone('skirt_clothing', 'Skirt Or Clothing', 'Clothing', [0.30, 0.51, 0.40, 0.13], 'TouchClothing', 'confused', '用户碰到了你的衣服或裙摆。用苏时夏人格回应，动作上整理衣服，正常模式保持明确边界。'),
  zone('thighs', 'Thighs', 'Legs', [0.33, 0.62, 0.34, 0.14], 'TouchLeg', 'shy', '用户碰到了你的大腿区域。回应交给苏时夏人格，但必须经过运行时模式和边界校验。'),
  zone('knees_lower_legs', 'Knees And Lower Legs', 'LowerLegs', [0.34, 0.74, 0.32, 0.17], 'TouchLeg', 'soft_smile', '用户碰到了你的膝盖或小腿。用苏时夏人格自然回应，动作上轻轻换重心。'),
  zone('feet', 'Feet', 'Feet', [0.34, 0.91, 0.32, 0.07], 'TouchFoot', 'confused', '用户碰到了你的脚部。用苏时夏人格简短回应，动作上轻轻后退或挪脚。'),
];

const MOTIONS = [
  motion('idle', 'Idle', 'idle', true, 450, 450),
  motion('listening', 'Listen', 'focused', true, 250, 300, 'Idle'),
  motion('thinking', 'Think', 'focused', true, 250, 300, 'Idle'),
  motion('streaming', 'Speak', 'normal', true, 200, 260, 'Idle'),
  motion('speaking', 'Speak', 'focused', true, 160, 220, 'Idle'),
  motion('interrupted', 'ShakeHead', 'urgent', false, 80, 180, 'Idle'),
  motion('error', 'ShakeHead', 'urgent', false, 120, 260, 'Idle'),
  motion('sleepy', 'Sleepy', 'idle', true, 500, 500, 'Idle'),
  motion('away', 'Return', 'idle', true, 600, 600, 'Idle'),
];

const EXPRESSIONS_MAP = [
  ['peaceful', 'soft_smile', 0.82, 'neutral'],
  ['happy', 'happy', 1],
  ['thoughtful', 'thoughtful', 0.9],
  ['shy', 'shy', 1],
  ['confused', 'confused', 0.95],
  ['excited', 'surprised', 0.9, 'happy'],
  ['tired', 'sleepy', 1],
  ['playful', 'playful', 1],
  ['soft', 'soft_smile', 0.88],
];

const LAYER_DRAW_ORDER = [
  'SSX_HAIR_REAR_CENTER',
  'SSX_HAIR_REAR_LEFT',
  'SSX_HAIR_REAR_RIGHT',
  'SSX_HEAD_NECK',
  'SSX_WAIST_PELVIS_BASE',
  'SSX_THIGH_L',
  'SSX_THIGH_R',
  'SSX_CALF_L',
  'SSX_CALF_R',
  'SSX_KNEE_OVERLAY_L',
  'SSX_KNEE_OVERLAY_R',
  'SSX_SHOE_L',
  'SSX_SHOE_R',
  'SSX_TORSO_BASE',
  'SSX_BLOUSE_BACK_FILL',
  'SSX_ARM_UPPER_L',
  'SSX_ARM_UPPER_R',
  'SSX_BLOUSE_FRONT',
  'SSX_BLOUSE_COLLAR_L',
  'SSX_BLOUSE_COLLAR_R',
  'SSX_BLOUSE_BUTTON_PLACKET',
  'SSX_BLOUSE_SLEEVE_L',
  'SSX_BLOUSE_SLEEVE_R',
  'SSX_ARM_LOWER_L',
  'SSX_ARM_LOWER_R',
  'SSX_HAND_NEUTRAL_L',
  'SSX_HAND_NEUTRAL_R',
  'SSX_SKIRT_REAR_BASE',
  'SSX_SKIRT_FRONT_BASE',
  'SSX_SKIRT_PLEATS_L',
  'SSX_SKIRT_PLEATS_CENTER',
  'SSX_SKIRT_PLEATS_R',
  'SSX_SKIRT_WAIST',
  'SSX_SKIRT_HEM_UNDERSIDE',
  'SSX_HEAD_FACE_BASE',
  'SSX_HAIR_SIDE_LOCK_LEFT',
  'SSX_HAIR_SIDE_LOCK_RIGHT',
  'SSX_EYE_L_WHITE',
  'SSX_EYE_R_WHITE',
  'SSX_EYE_L_IRIS',
  'SSX_EYE_R_IRIS',
  'SSX_EYE_L_PUPIL',
  'SSX_EYE_R_PUPIL',
  'SSX_EYE_L_HIGHLIGHT',
  'SSX_EYE_R_HIGHLIGHT',
  'SSX_EYE_L_UPPER_LASH',
  'SSX_EYE_R_UPPER_LASH',
  'SSX_EYE_L_LOWER_LASH',
  'SSX_EYE_R_LOWER_LASH',
  'SSX_EYE_L_CLOSED',
  'SSX_EYE_R_CLOSED',
  'SSX_BROW_L',
  'SSX_BROW_R',
  'SSX_MOUTH_FORM_MBP',
  'SSX_MOUTH_CLOSED',
  'SSX_MOUTH_OPEN_SMALL',
  'SSX_MOUTH_OPEN_WIDE',
  'SSX_MOUTH_FORM_EI',
  'SSX_MOUTH_FORM_OU',
  'SSX_HAND_CHEEK_L',
  'SSX_HAND_CHEEK_R',
  'SSX_HAIR_BANGS_LEFT',
  'SSX_HAIR_BANGS_RIGHT',
  'SSX_HAIR_BANGS_CENTER',
  'SSX_HAIR_LOOSE_STRANDS',
  'SSX_ACCESSORY_HAIR_CLIP',
];

const ALPHA_MODES = {
  SSX_EYE_L_WHITE: 'eyeOpen',
  SSX_EYE_R_WHITE: 'eyeOpen',
  SSX_EYE_L_IRIS: 'eyeOpen',
  SSX_EYE_R_IRIS: 'eyeOpen',
  SSX_EYE_L_PUPIL: 'eyeOpen',
  SSX_EYE_R_PUPIL: 'eyeOpen',
  SSX_EYE_L_HIGHLIGHT: 'eyeOpen',
  SSX_EYE_R_HIGHLIGHT: 'eyeOpen',
  SSX_EYE_L_UPPER_LASH: 'eyeOpen',
  SSX_EYE_R_UPPER_LASH: 'eyeOpen',
  SSX_EYE_L_LOWER_LASH: 'eyeOpen',
  SSX_EYE_R_LOWER_LASH: 'eyeOpen',
  SSX_EYE_L_CLOSED: 'eyeClosed',
  SSX_EYE_R_CLOSED: 'eyeClosed',
  SSX_MOUTH_CLOSED: 'mouthClosed',
  SSX_MOUTH_OPEN_SMALL: 'mouthOpenSmall',
  SSX_MOUTH_OPEN_WIDE: 'mouthOpenWide',
  SSX_MOUTH_FORM_EI: 'mouthSmile',
  SSX_MOUTH_FORM_OU: 'mouthRound',
  SSX_MOUTH_FORM_MBP: 'mouthPressed',
};

const MOTION_ALPHA = {
  SSX_HAND_CHEEK_L: 'TouchFace',
  SSX_HAND_CHEEK_R: 'TouchFace',
};

const SWAY = {
  SSX_HAIR_REAR_CENTER: 0.65,
  SSX_HAIR_REAR_LEFT: 0.8,
  SSX_HAIR_REAR_RIGHT: 0.8,
  SSX_HAIR_SIDE_LOCK_LEFT: 1,
  SSX_HAIR_SIDE_LOCK_RIGHT: 1,
  SSX_HAIR_BANGS_CENTER: 0.45,
  SSX_HAIR_BANGS_LEFT: 0.62,
  SSX_HAIR_BANGS_RIGHT: 0.62,
  SSX_HAIR_LOOSE_STRANDS: 1.2,
  SSX_ACCESSORY_HAIR_CLIP: 0.36,
  SSX_SKIRT_PLEATS_L: 0.18,
  SSX_SKIRT_PLEATS_CENTER: 0.12,
  SSX_SKIRT_PLEATS_R: 0.18,
};

const EYE_TRACK = new Set([
  'SSX_EYE_L_IRIS',
  'SSX_EYE_R_IRIS',
  'SSX_EYE_L_PUPIL',
  'SSX_EYE_R_PUPIL',
  'SSX_EYE_L_HIGHLIGHT',
  'SSX_EYE_R_HIGHLIGHT',
]);

function main() {
  const inventory = readJson(path.join(PACKAGE_ROOT, 'source', 'parts', 'parts-inventory-v1.json'));
  fs.mkdirSync(MODEL_PARTS, { recursive: true });
  for (const part of inventory.parts) {
    fs.copyFileSync(
      path.join(PACKAGE_ROOT, 'source', 'parts', part.file),
      path.join(MODEL_PARTS, path.basename(part.file)),
    );
  }

  const byName = new Map(inventory.parts.map(part => [part.name, part]));
  const layers = LAYER_DRAW_ORDER.map(name => {
    const part = byName.get(name);
    if (!part) throw new Error(`Missing part in inventory: ${name}`);
    return imageLayer(part);
  });
  layers.splice(layers.findIndex(layer => layer.id === 'SSX_EYE_L_WHITE'), 0,
    { id: 'SSX_BLUSH_L', type: 'ellipse', color: '#f19aa4', x: 380, y: 206, width: 54, height: 22, expressionAlpha: 'blush', alpha: 0.24 },
    { id: 'SSX_BLUSH_R', type: 'ellipse', color: '#f19aa4', x: 488, y: 206, width: 54, height: 22, expressionAlpha: 'blush', alpha: 0.24 },
  );

  const model = {
    Version: 3,
    AthenaLive2DLite: {
      schemaVersion: 1,
      displayName: 'Su Shixia Live2D V2 Lite Runtime Preview',
      canvas: CANVAS,
      parameters: PARAMETERS,
      expressions: EXPRESSIONS,
      motionGroups: MOTION_GROUPS,
      hitAreas: HOT_ZONES.map(zone => ({
        id: zone.hitAreaName ?? zone.id,
        name: zone.hitAreaName ?? zone.id,
        x: Math.round(zone.rect.x * CANVAS.width),
        y: Math.round(zone.rect.y * CANVAS.height),
        width: Math.round(zone.rect.width * CANVAS.width),
        height: Math.round(zone.rect.height * CANVAS.height),
      })),
      layers,
      metadata: {
        sourcePackage: 'assets/avatar/su-shixia-live2d-v2',
        generatedFrom: 'source/parts/parts-inventory-v1.json',
        motionReferencePolicy: 'Motion groups are named against Haru official sample groups and Su Shixia V2 storyboards; replace with authored Cubism motions after rigging.',
        cubismExportReady: false,
      },
    },
  };

  const profile = {
    id: 'su-shixia-live2d-v2',
    displayName: 'Su Shixia Live2D V2 Preview',
    provider: 'live2d',
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: '.',
      model3JsonPath: 'model/su-shixia-live2d-v2-lite.model3.json',
      packageId: 'su-shixia-live2d-v2',
      packageVersion: '0.3.0-lite-runtime-preview',
    },
    marketplace: {
      packageId: 'su-shixia-live2d-v2',
      version: '0.3.0-lite-runtime-preview',
      displayName: 'Su Shixia Live2D V2 Preview',
      author: 'Athena Project',
      license: 'internal-generated-source-pending-rights-review',
      tags: ['default-character', 'su-shixia', 'live2d-lite', 'preview'],
    },
    layout: {
      mode: 'chat_right',
      transform: { x: 0, y: 0, scale: 1, opacity: 1, rotationDeg: 0, mirrored: false },
      alwaysOnTop: true,
      clickThroughMode: 'transparentOnly',
      transparentBackground: true,
      lockPosition: false,
    },
    expressions: EXPRESSIONS_MAP.map(([emotion, expressionId, intensityScale, fallbackExpressionId]) => ({
      emotion,
      expressionId,
      intensityScale,
      ...(fallbackExpressionId ? { fallbackExpressionId } : {}),
    })),
    motions: MOTIONS,
    parameters: Object.entries(PARAMETERS).map(([id, definition]) => ({
      id,
      label: labelForParameter(id),
      min: definition.min,
      max: definition.max,
      defaultValue: definition.default,
      favorite: ['ParamAngleX', 'ParamAngleY', 'ParamMouthOpenY', 'ParamMouthForm', 'ParamHairSwing', 'ParamTurnX'].includes(id),
    })),
    lipSync: {
      enabled: true,
      source: 'ttsAudio',
      parameterIds: ['ParamMouthOpenY'],
      sensitivity: 1.04,
      smoothing: 0.58,
      gain: 1.08,
      attackMs: 30,
      releaseMs: 118,
      minValue: 0,
      maxValue: 1,
    },
    pointerTracking: {
      enabled: true,
      headParameterIds: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'],
      eyeParameterIds: ['ParamEyeBallX', 'ParamEyeBallY'],
      strength: 0.72,
      smoothing: 0.44,
    },
    idle: {
      enabled: true,
      idleDelayMs: 11000,
      sleepyDelayMs: 300000,
      awayDelayMs: 900000,
      motionGroups: ['Idle', 'Think'],
      randomize: true,
    },
    hotZones: HOT_ZONES,
    externalControl: {
      transport: 'disabled',
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      requireToken: true,
      allowedCommandTypes: ['avatar.motion.play', 'avatar.expression.set', 'avatar.parameter.set', 'avatar.pointer.move', 'avatar.hotZone.trigger'],
      auditEnabled: true,
    },
    notes: 'Su Shixia V2 layered-2D runtime preview. This is not a genuine Cubism .moc3 export. Motion groups are reference-driven from the Haru official sample grouping plus Su Shixia V2 touch/turn requirements, and should be replaced with authored Cubism motions after model rigging.',
  };

  writeJson(path.join(MODEL_ROOT, 'su-shixia-live2d-v2-lite.model3.json'), model);
  writeJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'), profile);
  console.log(`SU_SHIXIA_LIVE2D_LITE_RUNTIME_GENERATED layers=${layers.length} hitAreas=${HOT_ZONES.length} motions=${Object.keys(MOTION_GROUPS).length}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function imageLayer(part) {
  const [x, y, width, height] = part.targetRect;
  return {
    id: part.name,
    type: 'image',
    src: `model/layers-v1/${path.basename(part.file)}`,
    x,
    y,
    width,
    height,
    ...(ALPHA_MODES[part.name] ? { alphaMode: ALPHA_MODES[part.name] } : {}),
    ...(MOTION_ALPHA[part.name] ? { motionAlpha: MOTION_ALPHA[part.name], alpha: 0.92 } : {}),
    ...(SWAY[part.name] ? { sway: SWAY[part.name] } : {}),
    ...(EYE_TRACK.has(part.name) ? { eyeTrack: true } : {}),
  };
}

function zone(id, label, hitAreaName, rectTuple, motionGroup, expressionId, promptTemplate) {
  return {
    id,
    label,
    hitAreaName,
    rect: { x: rectTuple[0], y: rectTuple[1], width: rectTuple[2], height: rectTuple[3] },
    action: {
      type: 'composite',
      actions: [
        { type: 'playMotion', motionGroup },
        { type: 'setExpression', expressionId },
        { type: 'athenaReply', promptTemplate },
      ],
    },
    cooldownMs: ['chest', 'waist', 'skirt_clothing', 'thighs'].includes(id) ? 2200 : 1400,
    enabled: true,
  };
}

function motion(state, motionGroup, priority, loop, fadeInMs, fadeOutMs, fallbackMotionGroup) {
  return {
    state,
    motionGroup,
    priority,
    loop,
    fadeInMs,
    fadeOutMs,
    ...(fallbackMotionGroup ? { fallbackMotionGroup } : {}),
  };
}

function labelForParameter(id) {
  return id
    .replace(/^Param/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bX\b/g, 'X')
    .replace(/\bY\b/g, 'Y')
    .replace(/\bZ\b/g, 'Z');
}

main();
