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
  TouchEar: ['reference:su-shixia-touch-storyboard', 'ear_startle_react'],
  TouchNeck: ['reference:su-shixia-touch-storyboard', 'neck_shy_react'],
  TouchShoulder: ['reference:Haru/TapBody', 'shoulder_turn_react'],
  TouchHand: ['reference:Haru/TouchHand', 'hand_touch_react'],
  TouchUpperArm: ['reference:Haru/TapBody', 'upper_arm_react'],
  TouchForearm: ['reference:Haru/TouchHand', 'forearm_react'],
  TouchWrist: ['reference:Haru/TouchHand', 'wrist_react'],
  TouchPalm: ['reference:Haru/TouchHand', 'palm_react'],
  TouchCollar: ['reference:Haru/TouchOutfit', 'collar_adjust_react'],
  TouchBlouse: ['reference:Haru/TouchOutfit', 'blouse_adjust_react'],
  TouchClothing: ['reference:Haru/TouchOutfit', 'clothing_adjust_react'],
  TouchChest: ['reference:private-zone-boundary', 'cover_stepback_react'],
  TouchRibs: ['reference:private-zone-boundary', 'side_step_react'],
  TouchAbdomen: ['reference:private-zone-boundary', 'abdomen_shy_react'],
  TouchWaist: ['reference:Haru/TapBody', 'waist_shy_react'],
  TouchHip: ['reference:private-zone-boundary', 'hip_boundary_react'],
  TouchSkirt: ['reference:Haru/TouchOutfit', 'skirt_adjust_react'],
  TouchLeg: ['reference:Haru/TapBody', 'leg_touch_react'],
  TouchThigh: ['reference:private-zone-boundary', 'thigh_boundary_react'],
  TouchKnee: ['reference:Haru/TapBody', 'knee_balance_react'],
  TouchCalf: ['reference:Haru/TapBody', 'calf_shift_react'],
  TouchAnkle: ['reference:Haru/TapBody', 'ankle_shift_react'],
  TouchFoot: ['reference:Haru/TapBody', 'foot_shift_react'],
  TouchShoe: ['reference:Haru/TapBody', 'shoe_shift_react'],
  TurnPreview: ['reference:su-shixia-turnaround', 'front_turn_preview'],
  Drag: ['reference:Haru/TapBody', 'drag_follow'],
  Return: ['reference:Haru/Idle', 'return_idle'],
  Sleepy: ['reference:Haru/Sleepy', 'sleepy_idle'],
};

const HOT_ZONES = [
  zone({ id: 'hair', label: 'Hair', hitAreaName: 'Hair', rect: [0.34, 0.03, 0.33, 0.12], motionGroup: 'TouchHair', expressionId: 'playful', bodyPart: '头发', sensitivity: 'affectionate', motionIntent: '发丝轻晃、微微偏头', promptTemplate: '用户轻触了你的头发。用苏时夏的人格语气自然回应，带一点轻巧的反应，但不要夸张。' }),
  zone({ id: 'hair_clip', label: 'Hair Clip', hitAreaName: 'HairClip', rect: [0.55, 0.07, 0.08, 0.06], motionGroup: 'TouchHairClip', expressionId: 'shy', bodyPart: '银色 A 字发夹', sensitivity: 'affectionate', motionIntent: '整理发夹、眼神短暂移开', promptTemplate: '用户碰到了你的银色 A 字发夹。用苏时夏的人格语气回应，可以有一点害羞和整理发夹的动作感。' }),
  zone({ id: 'forehead', label: 'Forehead', hitAreaName: 'Forehead', rect: [0.41, 0.10, 0.18, 0.06], motionGroup: 'TouchHead', expressionId: 'soft_smile', bodyPart: '额头', sensitivity: 'affectionate', motionIntent: '轻轻低头、放松微笑', promptTemplate: '用户轻触了你的额头。用苏时夏的人格语气给一句温柔、自然、简短的回应。' }),
  zone({ id: 'left_ear', label: 'Left Ear', hitAreaName: 'LeftEar', rect: [0.34, 0.15, 0.06, 0.07], motionGroup: 'TouchEar', expressionId: 'surprised', bodyPart: '耳侧', sensitivity: 'sensitive', motionIntent: '轻微缩肩、脸红', promptTemplate: '用户碰到了你的耳侧。回应交给苏时夏人格，表现一点突然和害羞，正常模式保持克制。' }),
  zone({ id: 'right_ear', label: 'Right Ear', hitAreaName: 'RightEar', rect: [0.60, 0.15, 0.06, 0.07], motionGroup: 'TouchEar', expressionId: 'surprised', bodyPart: '耳侧', sensitivity: 'sensitive', motionIntent: '轻微缩肩、脸红', promptTemplate: '用户碰到了你的耳侧。回应交给苏时夏人格，表现一点突然和害羞，正常模式保持克制。' }),
  zone({ id: 'face_cheek', label: 'Face And Cheek', hitAreaName: 'Face', rect: [0.39, 0.13, 0.22, 0.11], motionGroup: 'TouchFace', expressionId: 'shy', bodyPart: '脸颊', sensitivity: 'affectionate', motionIntent: '抬手挡脸、脸红', promptTemplate: '用户轻触了你的脸颊。用苏时夏的人格语气回应，允许害羞，但保持自然和边界。' }),
  zone({ id: 'mouth_chin', label: 'Mouth And Chin', hitAreaName: 'MouthChin', rect: [0.43, 0.22, 0.14, 0.06], motionGroup: 'TouchFace', expressionId: 'surprised', bodyPart: '嘴唇或下巴附近', sensitivity: 'sensitive', motionIntent: '微微后仰、眼神闪躲', promptTemplate: '用户点到了你的嘴唇或下巴附近。用苏时夏的人格语气给一句短反馈，表现一点惊讶和不好意思。' }),
  zone({ id: 'neck', label: 'Neck', hitAreaName: 'Neck', rect: [0.42, 0.26, 0.16, 0.05], motionGroup: 'TouchNeck', expressionId: 'shy', bodyPart: '脖颈', sensitivity: 'sensitive', motionIntent: '缩肩、整理衣领', promptTemplate: '用户碰到了你的脖颈。用苏时夏的人格语气回应，动作上轻轻缩肩，正常模式保持边界。' }),
  zone({ id: 'collar', label: 'Collar', hitAreaName: 'Collar', rect: [0.37, 0.29, 0.26, 0.06], motionGroup: 'TouchCollar', expressionId: 'shy', bodyPart: '衣领', sensitivity: 'sensitive', motionIntent: '整理衣领、向后半步', promptTemplate: '用户碰到了你的衣领。回应交给苏时夏人格，动作上整理衣领，并根据当前模式控制亲密程度。' }),
  zone({ id: 'left_shoulder', label: 'Left Shoulder', hitAreaName: 'LeftShoulder', rect: [0.28, 0.31, 0.13, 0.08], motionGroup: 'TouchShoulder', expressionId: 'soft_smile', bodyPart: '肩膀', sensitivity: 'neutral', motionIntent: '像被叫住一样转头', promptTemplate: '用户轻触了你的肩膀。用苏时夏的人格语气自然回应，可以像被叫住一样看向用户。' }),
  zone({ id: 'right_shoulder', label: 'Right Shoulder', hitAreaName: 'RightShoulder', rect: [0.59, 0.31, 0.13, 0.08], motionGroup: 'TouchShoulder', expressionId: 'soft_smile', bodyPart: '肩膀', sensitivity: 'neutral', motionIntent: '像被叫住一样转头', promptTemplate: '用户轻触了你的肩膀。用苏时夏的人格语气自然回应，可以像被叫住一样看向用户。' }),
  zone({ id: 'left_upper_arm', label: 'Left Upper Arm', hitAreaName: 'LeftUpperArm', rect: [0.23, 0.39, 0.11, 0.13], motionGroup: 'TouchUpperArm', expressionId: 'soft_smile', bodyPart: '上臂', sensitivity: 'neutral', motionIntent: '手臂轻轻收回', promptTemplate: '用户碰到了你的上臂。用苏时夏人格给一句自然反馈，像是在被轻轻提醒。' }),
  zone({ id: 'right_upper_arm', label: 'Right Upper Arm', hitAreaName: 'RightUpperArm', rect: [0.66, 0.39, 0.11, 0.13], motionGroup: 'TouchUpperArm', expressionId: 'soft_smile', bodyPart: '上臂', sensitivity: 'neutral', motionIntent: '手臂轻轻收回', promptTemplate: '用户碰到了你的上臂。用苏时夏人格给一句自然反馈，像是在被轻轻提醒。' }),
  zone({ id: 'left_forearm', label: 'Left Forearm', hitAreaName: 'LeftForearm', rect: [0.19, 0.52, 0.11, 0.12], motionGroup: 'TouchForearm', expressionId: 'happy', bodyPart: '前臂', sensitivity: 'neutral', motionIntent: '轻轻抬手回应', promptTemplate: '用户碰到了你的前臂。用苏时夏人格回应，像轻轻打招呼。' }),
  zone({ id: 'right_forearm', label: 'Right Forearm', hitAreaName: 'RightForearm', rect: [0.70, 0.52, 0.11, 0.12], motionGroup: 'TouchForearm', expressionId: 'happy', bodyPart: '前臂', sensitivity: 'neutral', motionIntent: '轻轻抬手回应', promptTemplate: '用户碰到了你的前臂。用苏时夏人格回应，像轻轻打招呼。' }),
  zone({ id: 'left_wrist', label: 'Left Wrist', hitAreaName: 'LeftWrist', rect: [0.19, 0.63, 0.09, 0.06], motionGroup: 'TouchWrist', expressionId: 'happy', bodyPart: '手腕', sensitivity: 'affectionate', motionIntent: '手腕轻转、短暂看向用户', promptTemplate: '用户碰到了你的手腕。用苏时夏人格回应，氛围可以亲近但保持自然。' }),
  zone({ id: 'right_wrist', label: 'Right Wrist', hitAreaName: 'RightWrist', rect: [0.72, 0.63, 0.09, 0.06], motionGroup: 'TouchWrist', expressionId: 'happy', bodyPart: '手腕', sensitivity: 'affectionate', motionIntent: '手腕轻转、短暂看向用户', promptTemplate: '用户碰到了你的手腕。用苏时夏人格回应，氛围可以亲近但保持自然。' }),
  zone({ id: 'left_hand', label: 'Left Hand', hitAreaName: 'LeftHand', rect: [0.17, 0.68, 0.11, 0.10], motionGroup: 'TouchPalm', expressionId: 'happy', bodyPart: '手', sensitivity: 'affectionate', motionIntent: '轻轻抬手、短暂牵手感', promptTemplate: '用户碰到了你的手。用苏时夏的人格语气回应，像轻轻打招呼或短暂牵手的氛围。' }),
  zone({ id: 'right_hand', label: 'Right Hand', hitAreaName: 'RightHand', rect: [0.72, 0.68, 0.11, 0.10], motionGroup: 'TouchPalm', expressionId: 'happy', bodyPart: '手', sensitivity: 'affectionate', motionIntent: '轻轻抬手、短暂牵手感', promptTemplate: '用户碰到了你的手。用苏时夏的人格语气回应，像轻轻打招呼或短暂牵手的氛围。' }),
  zone({ id: 'blouse', label: 'Blouse', hitAreaName: 'Blouse', rect: [0.34, 0.34, 0.32, 0.11], motionGroup: 'TouchBlouse', expressionId: 'confused', bodyPart: '白衬衫', sensitivity: 'sensitive', motionIntent: '整理衬衫、视线下移再回看', promptTemplate: '用户碰到了你的白衬衫。用苏时夏人格回应，动作上整理衣服，正常模式保持明确边界。' }),
  zone({ id: 'chest', label: 'Chest', hitAreaName: 'Chest', rect: [0.38, 0.36, 0.24, 0.08], motionGroup: 'TouchChest', expressionId: 'shy', bodyPart: '胸口', sensitivity: 'private', privateModeAllowed: true, motionIntent: '护住胸口、后退半步、脸红', promptTemplate: '用户碰到了你的胸口区域。回应交给苏时夏人格，但必须经过运行时模式和边界校验。' }),
  zone({ id: 'left_ribs', label: 'Left Side', hitAreaName: 'LeftRibs', rect: [0.32, 0.42, 0.12, 0.08], motionGroup: 'TouchRibs', expressionId: 'shy', bodyPart: '侧腰上方', sensitivity: 'sensitive', motionIntent: '身体轻轻侧开', promptTemplate: '用户碰到了你的侧腰上方。回应交给苏时夏人格，正常模式保持克制边界。' }),
  zone({ id: 'right_ribs', label: 'Right Side', hitAreaName: 'RightRibs', rect: [0.56, 0.42, 0.12, 0.08], motionGroup: 'TouchRibs', expressionId: 'shy', bodyPart: '侧腰上方', sensitivity: 'sensitive', motionIntent: '身体轻轻侧开', promptTemplate: '用户碰到了你的侧腰上方。回应交给苏时夏人格，正常模式保持克制边界。' }),
  zone({ id: 'abdomen', label: 'Abdomen', hitAreaName: 'Abdomen', rect: [0.39, 0.45, 0.22, 0.07], motionGroup: 'TouchAbdomen', expressionId: 'shy', bodyPart: '腹部', sensitivity: 'sensitive', privateModeAllowed: true, motionIntent: '轻轻收腹、整理衣摆', promptTemplate: '用户碰到了你的腹部。回应交给苏时夏人格，并根据当前模式控制亲密程度。' }),
  zone({ id: 'waist', label: 'Waist', hitAreaName: 'Waist', rect: [0.35, 0.50, 0.30, 0.06], motionGroup: 'TouchWaist', expressionId: 'shy', bodyPart: '腰部', sensitivity: 'sensitive', privateModeAllowed: true, motionIntent: '腰部轻躲、回头看用户', promptTemplate: '用户碰到了你的腰部。回应交给苏时夏人格，并根据当前模式控制亲密程度。' }),
  zone({ id: 'hip', label: 'Hip', hitAreaName: 'Hip', rect: [0.35, 0.56, 0.30, 0.07], motionGroup: 'TouchHip', expressionId: 'shy', bodyPart: '臀侧或裙腰后侧', sensitivity: 'private', privateModeAllowed: true, motionIntent: '身体侧开、整理裙腰', promptTemplate: '用户碰到了你的臀侧或裙腰后侧。回应交给苏时夏人格，但必须经过运行时模式和边界校验。' }),
  zone({ id: 'skirt_front', label: 'Skirt Front', hitAreaName: 'SkirtFront', rect: [0.30, 0.56, 0.40, 0.11], motionGroup: 'TouchSkirt', expressionId: 'confused', bodyPart: '深色百褶裙', sensitivity: 'sensitive', motionIntent: '整理裙摆、向后半步', promptTemplate: '用户碰到了你的裙摆。用苏时夏人格回应，动作上整理裙摆，正常模式保持明确边界。' }),
  zone({ id: 'left_thigh', label: 'Left Thigh', hitAreaName: 'LeftThigh', rect: [0.32, 0.67, 0.15, 0.11], motionGroup: 'TouchThigh', expressionId: 'shy', bodyPart: '大腿', sensitivity: 'private', privateModeAllowed: true, motionIntent: '腿部换重心、裙摆轻晃', promptTemplate: '用户碰到了你的大腿区域。回应交给苏时夏人格，但必须经过运行时模式和边界校验。' }),
  zone({ id: 'right_thigh', label: 'Right Thigh', hitAreaName: 'RightThigh', rect: [0.53, 0.67, 0.15, 0.11], motionGroup: 'TouchThigh', expressionId: 'shy', bodyPart: '大腿', sensitivity: 'private', privateModeAllowed: true, motionIntent: '腿部换重心、裙摆轻晃', promptTemplate: '用户碰到了你的大腿区域。回应交给苏时夏人格，但必须经过运行时模式和边界校验。' }),
  zone({ id: 'left_knee', label: 'Left Knee', hitAreaName: 'LeftKnee', rect: [0.32, 0.78, 0.15, 0.08], motionGroup: 'TouchKnee', expressionId: 'soft_smile', bodyPart: '膝盖', sensitivity: 'neutral', motionIntent: '膝盖微弯、站姿调整', promptTemplate: '用户碰到了你的膝盖。用苏时夏人格自然回应，动作上轻轻换重心。' }),
  zone({ id: 'right_knee', label: 'Right Knee', hitAreaName: 'RightKnee', rect: [0.53, 0.78, 0.15, 0.08], motionGroup: 'TouchKnee', expressionId: 'soft_smile', bodyPart: '膝盖', sensitivity: 'neutral', motionIntent: '膝盖微弯、站姿调整', promptTemplate: '用户碰到了你的膝盖。用苏时夏人格自然回应，动作上轻轻换重心。' }),
  zone({ id: 'left_calf', label: 'Left Calf', hitAreaName: 'LeftCalf', rect: [0.32, 0.86, 0.14, 0.10], motionGroup: 'TouchCalf', expressionId: 'soft_smile', bodyPart: '小腿', sensitivity: 'neutral', motionIntent: '脚尖轻移、站姿放松', promptTemplate: '用户碰到了你的小腿。用苏时夏人格简短自然回应。' }),
  zone({ id: 'right_calf', label: 'Right Calf', hitAreaName: 'RightCalf', rect: [0.54, 0.86, 0.14, 0.10], motionGroup: 'TouchCalf', expressionId: 'soft_smile', bodyPart: '小腿', sensitivity: 'neutral', motionIntent: '脚尖轻移、站姿放松', promptTemplate: '用户碰到了你的小腿。用苏时夏人格简短自然回应。' }),
  zone({ id: 'left_ankle', label: 'Left Ankle', hitAreaName: 'LeftAnkle', rect: [0.32, 0.95, 0.13, 0.04], motionGroup: 'TouchAnkle', expressionId: 'confused', bodyPart: '脚踝', sensitivity: 'neutral', motionIntent: '脚踝轻转、站稳', promptTemplate: '用户碰到了你的脚踝。用苏时夏人格简短回应，动作上轻轻挪脚。' }),
  zone({ id: 'right_ankle', label: 'Right Ankle', hitAreaName: 'RightAnkle', rect: [0.55, 0.95, 0.13, 0.04], motionGroup: 'TouchAnkle', expressionId: 'confused', bodyPart: '脚踝', sensitivity: 'neutral', motionIntent: '脚踝轻转、站稳', promptTemplate: '用户碰到了你的脚踝。用苏时夏人格简短回应，动作上轻轻挪脚。' }),
  zone({ id: 'left_shoe', label: 'Left Shoe', hitAreaName: 'LeftShoe', rect: [0.31, 0.975, 0.14, 0.025], motionGroup: 'TouchShoe', expressionId: 'confused', bodyPart: '鞋', sensitivity: 'neutral', motionIntent: '鞋尖轻移', promptTemplate: '用户碰到了你的鞋。用苏时夏人格简短回应，动作上轻轻挪脚。' }),
  zone({ id: 'right_shoe', label: 'Right Shoe', hitAreaName: 'RightShoe', rect: [0.55, 0.975, 0.14, 0.025], motionGroup: 'TouchShoe', expressionId: 'confused', bodyPart: '鞋', sensitivity: 'neutral', motionIntent: '鞋尖轻移', promptTemplate: '用户碰到了你的鞋。用苏时夏人格简短回应，动作上轻轻挪脚。' }),
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
    interactionPolicy: {
      defaultMode: 'normal',
      privateModeRequiresExplicitOptIn: true,
      replyDelegatedToPersona: true,
      normalModePrompt: '正常模式下，所有身体触碰回应必须克制、非露骨、尊重边界；可以害羞、躲开、整理衣服、提醒用户或把话题带回陪伴/助理。',
      privateModePrompt: '私密模式只在用户显式开启后可用；回应仍需保持明确同意、可停止、尊重边界，并禁止涉及未成年人、非自愿、强迫或违法内容。',
      forbiddenPublicAssetTypes: ['nude_body', 'explicit_pose', 'adult_costume', 'adult_motion'],
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

function zone({
  id,
  label,
  hitAreaName,
  rect,
  motionGroup,
  expressionId,
  promptTemplate,
  bodyPart,
  sensitivity = 'neutral',
  privateModeAllowed = false,
  motionIntent,
}) {
  return {
    id,
    label,
    hitAreaName,
    rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] },
    interaction: {
      bodyPart,
      sensitivity,
      privateModeAllowed,
      modelReplyDelegated: true,
      normalModeBoundary: '保持克制、非露骨、尊重边界；必要时用害羞、整理衣服、后退或提醒来回应。',
      ...(privateModeAllowed
        ? { privateModeBoundary: '仅在显式私密模式下允许更亲密的暧昧回应；仍需保持明确同意、可停止和安全边界。' }
        : {}),
      motionIntent,
    },
    action: {
      type: 'composite',
      actions: [
        { type: 'playMotion', motionGroup },
        { type: 'setExpression', expressionId },
        { type: 'athenaReply', promptTemplate },
      ],
    },
    cooldownMs: ['sensitive', 'private'].includes(sensitivity) ? 2200 : 1400,
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
