const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const HANDOFF_ROOT = path.join(PACKAGE_ROOT, 'cubism-handoff');
const MOTION_ROOT = path.join(HANDOFF_ROOT, 'motions');

const PARAMETERS = [
  parameter('ParamAngleX', 'Angle X', -30, 30, 0, 'head'),
  parameter('ParamAngleY', 'Angle Y', -30, 30, 0, 'head'),
  parameter('ParamAngleZ', 'Angle Z', -30, 30, 0, 'head'),
  parameter('ParamEyeLOpen', 'Left Eye Open', 0, 1, 1, 'eye'),
  parameter('ParamEyeROpen', 'Right Eye Open', 0, 1, 1, 'eye'),
  parameter('ParamEyeBallX', 'Eye Ball X', -1, 1, 0, 'eye'),
  parameter('ParamEyeBallY', 'Eye Ball Y', -1, 1, 0, 'eye'),
  parameter('ParamMouthOpenY', 'Mouth Open Y', 0, 1, 0, 'mouth'),
  parameter('ParamMouthForm', 'Mouth Form', -1, 1, 0, 'mouth'),
  parameter('ParamBodyAngleX', 'Body Angle X', -10, 10, 0, 'body'),
  parameter('ParamBodyAngleY', 'Body Angle Y', -10, 10, 0, 'body'),
  parameter('ParamBodyAngleZ', 'Body Angle Z', -10, 10, 0, 'body'),
  parameter('ParamBreath', 'Breath', 0, 1, 0, 'body'),
  parameter('ParamHairFront', 'Hair Front Swing', -1, 1, 0, 'physics'),
  parameter('ParamHairSide', 'Hair Side Swing', -1, 1, 0, 'physics'),
  parameter('ParamHairBack', 'Hair Back Swing', -1, 1, 0, 'physics'),
  parameter('ParamSkirtSwing', 'Skirt Swing', -1, 1, 0, 'physics'),
  parameter('ParamArmL', 'Left Arm Pose', -1, 1, 0, 'arm'),
  parameter('ParamArmR', 'Right Arm Pose', -1, 1, 0, 'arm'),
  parameter('ParamHandCheek', 'Cheek Touch Hand Overlay', 0, 1, 0, 'arm'),
  parameter('ParamAccessoryHairClip', 'A Hair Clip Visibility', 0, 1, 1, 'appearance'),
];

const DEFORMERS = [
  deformer('Root', null, ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']),
  deformer('Body', 'Root', ['ParamBreath', 'ParamBodyAngleX', 'ParamBodyAngleZ']),
  deformer('Head', 'Root', ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']),
  deformer('Eyes', 'Head', ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen']),
  deformer('Mouth', 'Head', ['ParamMouthOpenY', 'ParamMouthForm']),
  deformer('HairFront', 'Head', ['ParamAngleX', 'ParamHairFront']),
  deformer('HairSide', 'Head', ['ParamAngleX', 'ParamHairSide']),
  deformer('HairBack', 'Head', ['ParamBodyAngleX', 'ParamHairBack']),
  deformer('Arms', 'Body', ['ParamArmL', 'ParamArmR', 'ParamHandCheek']),
  deformer('Accessory', 'Head', ['ParamAccessoryHairClip']),
  deformer('Skirt', 'Body', ['ParamBodyAngleX', 'ParamSkirtSwing']),
  deformer('Legs', 'Root', ['ParamBodyAngleX']),
];

const MESH_GROUPS = [
  group('Head', ['SSX_HEAD_FACE_BASE', 'SSX_HEAD_NECK']),
  group('Eyes', ['SSX_EYE_L_WHITE', 'SSX_EYE_L_IRIS', 'SSX_EYE_L_PUPIL', 'SSX_EYE_L_HIGHLIGHT', 'SSX_EYE_L_UPPER_LASH', 'SSX_EYE_L_LOWER_LASH', 'SSX_EYE_L_CLOSED', 'SSX_EYE_R_WHITE', 'SSX_EYE_R_IRIS', 'SSX_EYE_R_PUPIL', 'SSX_EYE_R_HIGHLIGHT', 'SSX_EYE_R_UPPER_LASH', 'SSX_EYE_R_LOWER_LASH', 'SSX_EYE_R_CLOSED']),
  group('Brows', ['SSX_BROW_L', 'SSX_BROW_R']),
  group('Mouth', ['SSX_MOUTH_CLOSED', 'SSX_MOUTH_OPEN_SMALL', 'SSX_MOUTH_OPEN_WIDE', 'SSX_MOUTH_FORM_EI', 'SSX_MOUTH_FORM_OU', 'SSX_MOUTH_FORM_MBP']),
  group('Hair', ['SSX_HAIR_REAR_CENTER', 'SSX_HAIR_REAR_LEFT', 'SSX_HAIR_REAR_RIGHT', 'SSX_HAIR_BANGS_CENTER', 'SSX_HAIR_BANGS_LEFT', 'SSX_HAIR_BANGS_RIGHT', 'SSX_HAIR_SIDE_LOCK_LEFT', 'SSX_HAIR_SIDE_LOCK_RIGHT', 'SSX_HAIR_LOOSE_STRANDS']),
  group('Accessory', ['SSX_ACCESSORY_HAIR_CLIP']),
  group('Body', ['SSX_TORSO_BASE', 'SSX_BLOUSE_FRONT', 'SSX_BLOUSE_COLLAR_L', 'SSX_BLOUSE_COLLAR_R', 'SSX_BLOUSE_SLEEVE_L', 'SSX_BLOUSE_SLEEVE_R', 'SSX_BLOUSE_BUTTON_PLACKET', 'SSX_BLOUSE_BACK_FILL']),
  group('Arms', ['SSX_ARM_UPPER_L', 'SSX_ARM_LOWER_L', 'SSX_HAND_NEUTRAL_L', 'SSX_HAND_CHEEK_L', 'SSX_ARM_UPPER_R', 'SSX_ARM_LOWER_R', 'SSX_HAND_NEUTRAL_R', 'SSX_HAND_CHEEK_R']),
  group('Skirt', ['SSX_WAIST_PELVIS_BASE', 'SSX_SKIRT_WAIST', 'SSX_SKIRT_REAR_BASE', 'SSX_SKIRT_FRONT_BASE', 'SSX_SKIRT_PLEATS_L', 'SSX_SKIRT_PLEATS_CENTER', 'SSX_SKIRT_PLEATS_R', 'SSX_SKIRT_HEM_UNDERSIDE']),
  group('Legs', ['SSX_THIGH_L', 'SSX_CALF_L', 'SSX_KNEE_OVERLAY_L', 'SSX_THIGH_R', 'SSX_CALF_R', 'SSX_KNEE_OVERLAY_R', 'SSX_SHOE_L', 'SSX_SHOE_R']),
];

const MOTIONS = {
  Idle: motion('Idle', 3.6, true, [
    curve('ParamBreath', [[0, 0], [0.9, 1], [1.8, 0.15], [2.7, 0.9], [3.6, 0]]),
    curve('ParamAngleZ', [[0, -1.5], [1.8, 1.5], [3.6, -1.5]]),
    curve('ParamHairFront', [[0, -0.2], [1.8, 0.25], [3.6, -0.2]]),
    curve('ParamHairSide', [[0, 0.15], [1.8, -0.18], [3.6, 0.15]]),
    curve('ParamAccessoryHairClip', [[0, 1], [3.6, 1]]),
  ]),
  Listen: motion('Listen', 2.4, true, [
    curve('ParamAngleX', [[0, -3], [1.2, -6], [2.4, -3]]),
    curve('ParamAngleY', [[0, -2], [1.2, -4], [2.4, -2]]),
    curve('ParamBodyAngleX', [[0, -2], [1.2, -4], [2.4, -2]]),
  ]),
  Think: motion('Think', 2.8, true, [
    curve('ParamAngleX', [[0, -5], [1.4, 4], [2.8, -5]]),
    curve('ParamMouthForm', [[0, -0.18], [2.8, -0.18]]),
    curve('ParamEyeBallX', [[0, -0.25], [1.4, 0.18], [2.8, -0.25]]),
  ]),
  Speak: motion('Speak', 1.2, true, [
    curve('ParamMouthOpenY', [[0, 0.08], [0.18, 0.62], [0.34, 0.18], [0.52, 0.74], [0.76, 0.12], [1.2, 0.2]]),
    curve('ParamMouthForm', [[0, 0.18], [0.35, 0.45], [0.72, -0.22], [1.2, 0.18]]),
    curve('ParamAngleY', [[0, 0], [0.6, -2], [1.2, 0]]),
  ]),
  Nod: motion('Nod', 1.2, false, [
    curve('ParamAngleY', [[0, 0], [0.28, -10], [0.55, 4], [0.85, -4], [1.2, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.55, -1.5], [1.2, 0]]),
  ]),
  ShakeHead: motion('ShakeHead', 1.45, false, [
    curve('ParamAngleX', [[0, 0], [0.18, -12], [0.42, 12], [0.66, -9], [0.95, 7], [1.45, 0]]),
    curve('ParamHairSide', [[0, 0], [0.42, 0.8], [0.86, -0.7], [1.45, 0]]),
  ]),
  TouchHair: motion('TouchHair', 1.6, false, [
    curve('ParamAngleZ', [[0, 0], [0.32, 4], [1.6, 0]]),
    curve('ParamHairFront', [[0, 0], [0.28, 0.75], [0.78, -0.35], [1.6, 0]]),
    curve('ParamHairSide', [[0, 0], [0.32, -0.55], [1.6, 0]]),
  ]),
  TouchHairClip: motion('TouchHairClip', 1.6, false, [
    curve('ParamAngleX', [[0, 0], [0.35, 5], [1.6, 0]]),
    curve('ParamAngleZ', [[0, 0], [0.4, -4], [1.6, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.45, 0.28], [1.6, 0]]),
  ]),
  TouchHead: motion('TouchHead', 1.8, false, [
    curve('ParamAngleY', [[0, 0], [0.35, -8], [1.2, -5], [1.8, 0]]),
    curve('ParamAngleZ', [[0, 0], [0.45, 4], [1.8, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.45, 0.35], [1.8, 0]]),
  ]),
  TouchFace: motion('TouchFace', 2.0, false, [
    curve('ParamHandCheek', [[0, 0], [0.22, 1], [1.2, 1], [2, 0]]),
    curve('ParamAngleX', [[0, 0], [0.4, -7], [1.5, -4], [2, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.4, 0.28], [2, 0]]),
  ]),
  TouchEar: motion('TouchEar', 1.5, false, [
    curve('ParamAngleX', [[0, 0], [0.18, 7], [0.42, -4], [1.5, 0]]),
    curve('ParamAngleZ', [[0, 0], [0.35, 6], [1.5, 0]]),
    curve('ParamMouthOpenY', [[0, 0], [0.3, 0.18], [1.5, 0]]),
  ]),
  TouchNeck: motion('TouchNeck', 1.7, false, [
    curve('ParamAngleY', [[0, 0], [0.38, -7], [1.7, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.45, -3], [1.7, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.42, 0.24], [1.7, 0]]),
  ]),
  TouchShoulder: motion('TouchShoulder', 1.45, false, [
    curve('ParamAngleX', [[0, 0], [0.35, 6], [1.45, 0]]),
    curve('ParamBodyAngleX', [[0, 0], [0.45, 3], [1.45, 0]]),
  ]),
  TouchHand: motion('TouchHand', 1.7, false, [
    curve('ParamArmR', [[0, 0], [0.35, 0.8], [1.15, 0.35], [1.7, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.35, 0.45], [1.7, 0]]),
  ]),
  TouchUpperArm: motion('TouchUpperArm', 1.5, false, [
    curve('ParamArmL', [[0, 0], [0.38, -0.4], [1.5, 0]]),
    curve('ParamArmR', [[0, 0], [0.38, 0.4], [1.5, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.42, 1.6], [1.5, 0]]),
  ]),
  TouchForearm: motion('TouchForearm', 1.5, false, [
    curve('ParamArmR', [[0, 0], [0.36, 0.55], [1.5, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.32, 0.28], [1.5, 0]]),
  ]),
  TouchWrist: motion('TouchWrist', 1.55, false, [
    curve('ParamArmR', [[0, 0], [0.3, 0.7], [0.9, 0.25], [1.55, 0]]),
    curve('ParamAngleY', [[0, 0], [0.5, -2], [1.55, 0]]),
  ]),
  TouchPalm: motion('TouchPalm', 1.65, false, [
    curve('ParamArmR', [[0, 0], [0.34, 0.85], [1.05, 0.45], [1.65, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.38, 0.48], [1.65, 0]]),
  ]),
  TouchCollar: motion('TouchCollar', 1.65, false, [
    curve('ParamAngleY', [[0, 0], [0.36, -5], [1.65, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.4, -2.6], [1.65, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.36, 0.18], [1.65, 0]]),
  ]),
  TouchClothing: motion('TouchClothing', 1.6, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.32, -3], [0.78, 2], [1.6, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.3, -0.22], [1.6, 0]]),
  ]),
  TouchBlouse: motion('TouchBlouse', 1.65, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.3, -2.5], [0.86, 1.8], [1.65, 0]]),
    curve('ParamArmL', [[0, 0], [0.4, -0.35], [1.65, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.35, -0.18], [1.65, 0]]),
  ]),
  TouchChest: motion('TouchChest', 1.75, false, [
    curve('ParamAngleY', [[0, 0], [0.35, -6], [1.75, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.34, -4], [1.75, 0]]),
    curve('ParamArmL', [[0, 0], [0.34, -0.75], [1.75, 0]]),
  ]),
  TouchRibs: motion('TouchRibs', 1.65, false, [
    curve('ParamAngleX', [[0, 0], [0.35, -5], [1.65, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.35, -4], [1.65, 0]]),
  ]),
  TouchAbdomen: motion('TouchAbdomen', 1.7, false, [
    curve('ParamAngleY', [[0, 0], [0.38, -4], [1.7, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.42, 2.8], [1.7, 0]]),
  ]),
  TouchWaist: motion('TouchWaist', 1.8, false, [
    curve('ParamAngleX', [[0, 0], [0.38, 5], [1.8, 0]]),
    curve('ParamBodyAngleX', [[0, 0], [0.42, 4], [1.8, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.42, 3.5], [1.8, 0]]),
  ]),
  TouchHip: motion('TouchHip', 1.8, false, [
    curve('ParamAngleX', [[0, 0], [0.42, 6], [1.8, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.38, 4.5], [1.8, 0]]),
    curve('ParamSkirtSwing', [[0, 0], [0.4, 0.65], [1.8, 0]]),
  ]),
  TouchSkirt: motion('TouchSkirt', 1.7, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.32, -3], [0.78, 2], [1.7, 0]]),
    curve('ParamSkirtSwing', [[0, 0], [0.35, -0.75], [0.85, 0.35], [1.7, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.3, -0.24], [1.7, 0]]),
  ]),
  TouchLeg: motion('TouchLeg', 1.7, false, [
    curve('ParamAngleY', [[0, 0], [0.35, -4], [1.7, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.45, 2], [1.7, 0]]),
  ]),
  TouchThigh: motion('TouchThigh', 1.75, false, [
    curve('ParamAngleY', [[0, 0], [0.36, -5], [1.75, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.42, 3.5], [1.75, 0]]),
    curve('ParamSkirtSwing', [[0, 0], [0.42, 0.55], [1.75, 0]]),
  ]),
  TouchKnee: motion('TouchKnee', 1.45, false, [
    curve('ParamBodyAngleX', [[0, 0], [0.36, 2.5], [1.45, 0]]),
    curve('ParamBodyAngleZ', [[0, 0], [0.36, 1.5], [1.45, 0]]),
  ]),
  TouchCalf: motion('TouchCalf', 1.45, false, [
    curve('ParamBodyAngleX', [[0, 0], [0.34, 2], [1.45, 0]]),
    curve('ParamAngleY', [[0, 0], [0.4, -2], [1.45, 0]]),
  ]),
  TouchAnkle: motion('TouchAnkle', 1.35, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.3, 1.8], [1.35, 0]]),
    curve('ParamAngleY', [[0, 0], [0.34, -2], [1.35, 0]]),
  ]),
  TouchFoot: motion('TouchFoot', 1.35, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.32, 2.2], [1.35, 0]]),
    curve('ParamAngleY', [[0, 0], [0.34, -2], [1.35, 0]]),
  ]),
  TouchShoe: motion('TouchShoe', 1.35, false, [
    curve('ParamBodyAngleZ', [[0, 0], [0.32, 2], [1.35, 0]]),
    curve('ParamMouthForm', [[0, 0], [0.34, -0.14], [1.35, 0]]),
  ]),
  TurnPreview: motion('TurnPreview', 2.2, false, [
    curve('ParamAngleX', [[0, 0], [0.65, 18], [1.45, -12], [2.2, 0]]),
    curve('ParamBodyAngleX', [[0, 0], [0.65, 7], [1.45, -5], [2.2, 0]]),
    curve('ParamHairSide', [[0, 0], [0.8, -0.9], [1.6, 0.8], [2.2, 0]]),
  ]),
  Return: motion('Return', 1.8, false, [
    curve('ParamAngleX', [[0, 8], [1.8, 0]]),
    curve('ParamAngleY', [[0, -4], [1.8, 0]]),
    curve('ParamBodyAngleX', [[0, 4], [1.8, 0]]),
  ]),
  Sleepy: motion('Sleepy', 3.4, true, [
    curve('ParamEyeLOpen', [[0, 0.55], [1.7, 0.32], [3.4, 0.55]]),
    curve('ParamEyeROpen', [[0, 0.55], [1.7, 0.32], [3.4, 0.55]]),
    curve('ParamAngleY', [[0, -4], [1.7, -8], [3.4, -4]]),
  ]),
};

function main() {
  fs.mkdirSync(MOTION_ROOT, { recursive: true });
  for (const [name, document] of Object.entries(MOTIONS)) {
    writeJson(path.join(MOTION_ROOT, `${name}.motion3.json`), document);
  }
  writeJson(path.join(HANDOFF_ROOT, 'rig-spec.json'), {
    id: 'su-shixia-live2d-v2-cubism-rig-spec',
    status: 'cubism_editor_handoff_ready',
    sourcePsd: '../source/su-shixia-front-layered-v1.psd',
    canvas: { width: 919, height: 1712 },
    parameters: PARAMETERS,
    deformers: DEFORMERS,
    meshGroups: MESH_GROUPS,
    appearanceControls: appearanceControls(),
    editorReadinessChecklist: editorReadinessChecklist(),
    requiredExports: [
      'model/su-shixia-live2d-v2.moc3',
      'model/su-shixia-live2d-v2.model3.json',
      'model/su-shixia-live2d-v2.physics3.json',
      'model/su-shixia-live2d-v2.cdi3.json',
      'model/textures/texture_00.png'
    ],
    notAutomated: 'Cubism Editor 5.3 is installed locally, but no supported headless moc3 export command was found. Mesh/deformer authoring and export remain a manual Editor step.',
  });
  writeJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.physics3.template.json'), physicsTemplate());
  writeJson(path.join(HANDOFF_ROOT, 'su-shixia-live2d-v2.cdi3.template.json'), displayInfoTemplate());
  writeJson(path.join(HANDOFF_ROOT, 'export-gate.json'), exportGate());
  fs.writeFileSync(path.join(HANDOFF_ROOT, 'CUBISM_EXPORT_RUNBOOK.md'), runbook());
  fs.writeFileSync(path.join(HANDOFF_ROOT, 'CUBISM_EDITOR_READINESS_CHECKLIST.md'), editorReadinessMarkdown());
  console.log(`SU_SHIXIA_CUBISM_HANDOFF_GENERATED parameters=${PARAMETERS.length} motions=${Object.keys(MOTIONS).length} meshGroups=${MESH_GROUPS.length}`);
}

function parameter(id, label, min, max, defaultValue, group) {
  return { id, label, min, max, defaultValue, group };
}

function deformer(id, parent, parameters) {
  return { id, parent, parameters };
}

function group(id, parts) {
  return { id, parts };
}

function motion(name, duration, loop, curves) {
  const converted = curves.map(item => ({
    Target: 'Parameter',
    Id: item.id,
    Segments: linearSegments(item.points),
  }));
  const segmentCount = curves.reduce((total, item) => total + Math.max(0, item.points.length - 1), 0);
  const pointCount = curves.reduce((total, item) => total + item.points.length, 0);
  return {
    Version: 3,
    Meta: {
      Name: name,
      Duration: duration,
      Fps: 30,
      Loop: loop,
      AreBeziersRestricted: true,
      CurveCount: converted.length,
      TotalSegmentCount: segmentCount,
      TotalPointCount: pointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: converted,
  };
}

function curve(id, points) {
  return { id, points };
}

function linearSegments(points) {
  const [first, ...rest] = points;
  const segments = [first[0], first[1]];
  for (const point of rest) segments.push(0, point[0], point[1]);
  return segments;
}

function physicsTemplate() {
  return {
    Version: 3,
    Meta: {
      PhysicsSettingCount: 4,
      TotalInputCount: 6,
      TotalOutputCount: 4,
      VertexCount: 16,
      EffectiveForces: {
        Gravity: { X: 0, Y: -1 },
        Wind: { X: 0, Y: 0 },
      },
      PhysicsDictionary: [
        { Id: 'PhysicsSetting_HairFront', Name: 'Hair Front' },
        { Id: 'PhysicsSetting_HairSide', Name: 'Hair Side' },
        { Id: 'PhysicsSetting_HairBack', Name: 'Hair Back' },
        { Id: 'PhysicsSetting_Skirt', Name: 'Skirt' },
      ],
    },
    PhysicsSettings: [
      physics('PhysicsSetting_HairFront', ['ParamAngleX', 'ParamAngleZ'], 'ParamHairFront'),
      physics('PhysicsSetting_HairSide', ['ParamAngleX', 'ParamBodyAngleX'], 'ParamHairSide'),
      physics('PhysicsSetting_HairBack', ['ParamAngleZ'], 'ParamHairBack'),
      physics('PhysicsSetting_Skirt', ['ParamBodyAngleX', 'ParamBodyAngleZ'], 'ParamSkirtSwing'),
    ],
  };
}

function physics(id, inputs, output) {
  return {
    Id: id,
    Input: inputs.map(source => ({ Source: { Target: 'Parameter', Id: source }, Weight: 60, Type: 'X', Reflect: false })),
    Output: [{ Destination: { Target: 'Parameter', Id: output }, VertexIndex: 1, Scale: 1, Weight: 80, Type: 'Angle', Reflect: false }],
    Vertices: [
      { Mobility: 1, Delay: 0, Acceleration: 1, Radius: 0, Position: { X: 0, Y: 0 } },
      { Mobility: 0.82, Delay: 0.18, Acceleration: 0.9, Radius: 12, Position: { X: 0, Y: -12 } },
      { Mobility: 0.72, Delay: 0.28, Acceleration: 0.82, Radius: 20, Position: { X: 0, Y: -28 } },
      { Mobility: 0.62, Delay: 0.36, Acceleration: 0.72, Radius: 30, Position: { X: 0, Y: -48 } },
    ],
    Normalization: {
      Position: { Minimum: -10, Default: 0, Maximum: 10 },
      Angle: { Minimum: -10, Default: 0, Maximum: 10 },
    },
  };
}

function displayInfoTemplate() {
  return {
    Version: 3,
    ParameterGroups: [
      { Id: 'ParamGroupHead', GroupName: 'Head', Ids: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'] },
      { Id: 'ParamGroupEye', GroupName: 'Eye', Ids: ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY'] },
      { Id: 'ParamGroupMouth', GroupName: 'Mouth', Ids: ['ParamMouthOpenY', 'ParamMouthForm'] },
      { Id: 'ParamGroupBody', GroupName: 'Body', Ids: ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath'] },
      { Id: 'ParamGroupPhysics', GroupName: 'Physics', Ids: ['ParamHairFront', 'ParamHairSide', 'ParamHairBack', 'ParamSkirtSwing'] },
      { Id: 'ParamGroupArms', GroupName: 'Arms', Ids: ['ParamArmL', 'ParamArmR', 'ParamHandCheek'] },
      { Id: 'ParamGroupAppearance', GroupName: 'Appearance', Ids: ['ParamAccessoryHairClip'] },
    ],
    Parameters: PARAMETERS.map(item => ({ Id: item.id, GroupId: `ParamGroup${capitalize(item.group)}`, Name: item.label })),
    PartGroups: MESH_GROUPS.map(item => ({ Id: `PartGroup${item.id}`, GroupName: item.id, Ids: item.parts })),
  };
}

function appearanceControls() {
  return {
    status: 'preview_mapping_ready_true_wardrobe_not_ready',
    cubismReadyControls: [
      {
        id: 'ParamAccessoryHairClip',
        type: 'partOpacity',
        defaultValue: 1,
        drawables: ['SSX_ACCESSORY_HAIR_CLIP'],
        mapsLitePreset: 'no_clip_minimal',
        editorInstruction: 'Bind SSX_ACCESSORY_HAIR_CLIP opacity to ParamAccessoryHairClip: 1 visible, 0 hidden.',
      },
    ],
    runtimeOnlyPreviewChannels: [
      'hair tint',
      'eye tint',
      'blouse tint',
      'skirt tint',
      'shoe tint',
    ],
    wardrobeNoGo: [
      'No alternate garment source layers exist yet.',
      'No Cubism drawables exist for new blouse, skirt, casual, evening, or private outfits.',
      'No outfit visibility parameters should be marked production-ready until separate reviewed clothing source art is imported.',
    ],
    futureOutfitParameterPlan: [
      { id: 'ParamOutfitClassic', defaultValue: 1, requiredSource: 'current white blouse and navy pleated skirt' },
      { id: 'ParamOutfitOffice', defaultValue: 0, requiredSource: 'future office outfit layered source' },
      { id: 'ParamOutfitEvening', defaultValue: 0, requiredSource: 'future warm/evening outfit layered source' },
      { id: 'ParamOutfitCasual', defaultValue: 0, requiredSource: 'future casual outfit layered source' },
      { id: 'ParamOutfitPrivate', defaultValue: 0, requiredSource: 'future separate private opt-in package only' },
    ],
  };
}

function editorReadinessChecklist() {
  return [
    gate('source-art', 'Open the PSD and confirm every visible/hidden imported layer keeps its SSX_* name.', ['source/su-shixia-front-layered-v1.psd', 'source/parts/parts-contact-sheet-v1.png']),
    gate('human-art-review', 'Review front alignment, hand/arm layering, lower-body occlusion, mouth shapes, hidden fill, and desktop-pet scale before rigging.', ['source/review/front-alignment-preview-v1.png', 'source/review/front-source-scale-preview-v1.png', 'source/review/source-review-v1.json']),
    gate('parameters', 'Create all rig-spec parameters with exact IDs, ranges, defaults, and display groups.', ['rig-spec.json', 'su-shixia-live2d-v2.cdi3.template.json']),
    gate('meshes', 'Mesh every meshGroups part and preserve draw order for face, hair, arms, skirt, legs, and accessory.', ['rig-spec.json']),
    gate('deformers', 'Create Root, Body, Head, Eyes, Mouth, Hair, Arms, Accessory, Skirt, and Legs deformers, then bind standard angle/breath/lip-sync parameters first.', ['rig-spec.json']),
    gate('physics', 'Configure hair-front, hair-side, hair-back, and skirt physics from the template and tune after motion playback.', ['su-shixia-live2d-v2.physics3.template.json']),
    gate('motions', 'Import or recreate all motion3 templates, then hand-polish touch reactions and recovery timing.', ['motions/*.motion3.json']),
    gate('appearance', 'Bind ParamAccessoryHairClip. Do not claim true clothing swaps until new outfit drawables and parameters exist.', ['rig-spec.json']),
    gate('export', 'Export moc3, model3, textures, physics, and display-info files into ../model, then verify they load with cubism-web instead of Live2D Lite.', ['export-gate.json']),
    gate('release-boundary', 'Keep source, handoff, adult-only, and private assets out of public installers until rights, license, and visual QA are approved.', ['../manifest.json']),
  ];
}

function gate(id, action, evidence) {
  return { id, action, evidence, status: 'manual_required' };
}

function exportGate() {
  return {
    id: 'su-shixia-live2d-v2-cubism-export-gate',
    status: 'manual_export_required',
    editor: {
      product: 'Live2D Cubism Editor',
      testedLocalInstall: 'C:\\Program Files\\Live2D Cubism 5.3',
      headlessExportAvailable: false,
    },
    requiredRuntimeFiles: [
      { kind: 'model3', path: '../model/su-shixia-live2d-v2.model3.json' },
      { kind: 'moc3', path: '../model/su-shixia-live2d-v2.moc3', minBytes: 90000, magic: 'MOC3' },
      { kind: 'physics3', path: '../model/su-shixia-live2d-v2.physics3.json' },
      { kind: 'cdi3', path: '../model/su-shixia-live2d-v2.cdi3.json' },
      { kind: 'texture', path: '../model/textures/texture_00.png', minBytes: 300000 },
    ],
    requiredRuntimeProof: [
      'BrowserCubismLive2DHost reports cubism-web, not live2d-lite.',
      'Rendered frame is nonblank with transparent background.',
      'ParamMouthOpenY changes during TTS and resets after speech.',
      'At least five expressions and six motions are visually distinct in screenshot/contact-sheet evidence.',
      'Hot zones still generate bounded persona prompts through the runtime policy.',
    ],
    noGoUntil: [
      'All required runtime files exist and the moc3 header is valid.',
      'Athena loads the model through cubism-web without fallback.',
      'Manual art review accepts hands, lower body, turn behavior, and wardrobe limits.',
      'Rights and Live2D license review are complete.',
    ],
  };
}

function runbook() {
  return `# Su Shixia V2 Cubism Export Runbook

Status: cubism editor handoff ready

## Inputs

- PSD: \`../source/su-shixia-front-layered-v1.psd\`
- Rig spec: \`rig-spec.json\`
- Motion templates: \`motions/*.motion3.json\` (37 reference templates, including all profile touch motion groups)
- Physics template: \`su-shixia-live2d-v2.physics3.template.json\`
- Display info template: \`su-shixia-live2d-v2.cdi3.template.json\`
- Editor checklist: \`CUBISM_EDITOR_READINESS_CHECKLIST.md\`
- Export gate: \`export-gate.json\`

## Editor Steps

1. Open Live2D Cubism Editor 5.3.
2. Import the PSD and preserve all \`SSX_*\` layer names.
3. Create the parameters listed in \`rig-spec.json\`, including \`ParamAccessoryHairClip\`.
4. Build meshes for each \`meshGroups\` entry. Keep the face, eyes, mouth, hair, arms, skirt, and legs as separately deformable groups.
5. Create deformers according to \`deformers\`.
6. Bind standard parameters first: head, eyes, mouth, body, breath.
7. Add secondary physics outputs for hair and skirt.
8. Bind \`ParamAccessoryHairClip\` to the A hair clip opacity. This is the only current Cubism-ready appearance control.
9. Import or recreate the provided motion templates after confirming parameter IDs match.
   - Touch templates are timing and parameter references, not final polished animation.
   - Keep normal/private interaction boundaries in \`profile.avatar.json\`; Cubism should only provide visual reactions.
10. Export runtime files into \`../model\`:
   - \`su-shixia-live2d-v2.moc3\`
   - \`su-shixia-live2d-v2.model3.json\`
   - \`su-shixia-live2d-v2.physics3.json\`
   - \`su-shixia-live2d-v2.cdi3.json\`
   - texture directory
11. Run Athena validation and desktop smoke.

## Wardrobe Boundary

The Lite runtime can recolor hair, eyes, blouse, skirt, and shoes for preview. Cubism production cannot treat those tints as true clothing or texture variants. Only \`ParamAccessoryHairClip\` is ready for a current-source Cubism opacity binding. New outfits require separate source layers, drawables, clipping, draw order, parameters, motions, and QA evidence.

## Non-Automated Boundary

Cubism Editor 5.3 is installed locally, but this workspace did not find a supported headless export command. Do not mark \`.moc3\` ready until the Editor export exists and the runtime loads it through \`cubism-web\`.
`;
}

function editorReadinessMarkdown() {
  const rows = editorReadinessChecklist()
    .map(item => `| ${item.id} | ${item.action} | ${item.evidence.join('<br>')} |`)
    .join('\n');
  return `# Su Shixia V2 Cubism Editor Readiness Checklist

Status: manual editor work required

This checklist is the handoff contract before Su Shixia V2 can become a genuine Cubism \`.moc3\` package. Passing the current Lite runtime tests does not satisfy these items.

| Gate | Required action | Evidence |
| --- | --- | --- |
${rows}

## Go/No-Go

- GO for local Lite preview: current generated source, Lite runtime, touch zones, appearance preview, and visual QA pass.
- NO-GO for public Cubism default: no genuine \`.moc3\`, no Cubism Web proof, unresolved art review findings, no true wardrobe drawables, and no rights/license approval.
- NO-GO for true wardrobe: only the A hair clip has a current-source Cubism visibility parameter. Clothing and color variants need new source layers or texture/drawable variants.
`;
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

main();
