const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default', 'model');
const MOTION_ROOT = path.join(MODEL_ROOT, 'motions');

const motions = {
  Idle: [
    motion('Idle.motion3.json', 6, true, {
      ParamAngleZ: [[0, 0], [1.5, 1.8], [3, 0], [4.5, -1.8], [6, 0]],
      ParamBodyAngleZ: [[0, 0], [1.5, 0.9], [3, 0], [4.5, -0.9], [6, 0]],
      ParamBreath: [[0, 0], [1.5, 1], [3, 0.1], [4.5, 0.9], [6, 0]],
    }),
    motion('Idle_LookAround.motion3.json', 7.2, true, {
      ParamAngleX: [[0, 0], [1.2, -5], [2.6, -2], [4.4, 5], [6.2, 2], [7.2, 0]],
      ParamEyeBallX: [[0, 0], [1.2, -0.3], [3, -0.1], [4.4, 0.32], [6.2, 0.12], [7.2, 0]],
      ParamEyeBallY: [[0, 0], [2, 0.12], [5.8, -0.1], [7.2, 0]],
      ParamBreath: [[0, 0], [2, 0.85], [4.3, 0.15], [7.2, 0]],
    }),
    motion('Idle_ShiftWeight.motion3.json', 8, true, {
      ParamBodyAngleX: [[0, 0], [2, -2.2], [4, 0.8], [6, 2.2], [8, 0]],
      ParamBodyAngleZ: [[0, 0], [2, 1.4], [4, 0], [6, -1.4], [8, 0]],
      ParamAngleZ: [[0, 0], [2, -1.2], [4, 0.4], [6, 1.2], [8, 0]],
      ParamBreath: [[0, 0], [2.4, 0.9], [5.3, 0.2], [8, 0]],
    }),
    motion('Idle_SoftNod.motion3.json', 6.8, true, {
      ParamAngleY: [[0, 0], [1.6, 2.8], [3.2, -1.2], [5.1, 1.6], [6.8, 0]],
      ParamBodyAngleY: [[0, 0], [1.6, 1.3], [3.2, -0.5], [5.1, 0.8], [6.8, 0]],
      ParamEyeLOpen: [[0, 1], [2.8, 0.92], [3.15, 1], [6.8, 1]],
      ParamEyeROpen: [[0, 1], [2.8, 0.92], [3.15, 1], [6.8, 1]],
    }),
    motion('Idle_HairSway.motion3.json', 7.6, true, {
      ParamAngleX: [[0, 0], [1.9, 2.5], [3.8, -2.5], [5.7, 1.2], [7.6, 0]],
      ParamAngleZ: [[0, 0], [1.9, -1.4], [3.8, 1.4], [5.7, -0.8], [7.6, 0]],
      ParamHairFront: [[0, 0], [1.9, 0.75], [3.8, -0.75], [5.7, 0.38], [7.6, 0]],
      ParamHairSide: [[0, 0], [1.9, 0.9], [3.8, -0.9], [5.7, 0.44], [7.6, 0]],
      ParamHairBack: [[0, 0], [1.9, 0.58], [3.8, -0.58], [5.7, 0.28], [7.6, 0]],
    }),
    motion('Idle_DeepBreath.motion3.json', 9.2, true, {
      ParamBreath: [[0, 0], [2.3, 1], [4.6, 0.15], [6.9, 0.92], [9.2, 0]],
      ParamBodyAngleY: [[0, 0], [2.3, 1.2], [4.6, 0], [6.9, 0.8], [9.2, 0]],
      ParamAngleY: [[0, 0], [2.3, -1.5], [4.6, 0], [6.9, -1], [9.2, 0]],
    }),
  ],
  Greet: motion('Greet.motion3.json', 2.4, false, {
    ParamAngleZ: [[0, 0], [0.45, -4], [1.1, 4], [1.7, -2], [2.4, 0]],
    ParamBodyAngleZ: [[0, 0], [0.45, -2], [1.1, 2.5], [1.7, -1], [2.4, 0]],
    ParamEyeLSmile: [[0, 0], [0.4, 1], [1.8, 1], [2.4, 0]],
    ParamEyeRSmile: [[0, 0], [0.4, 1], [1.8, 1], [2.4, 0]],
    ParamMouthForm: [[0, 0], [0.35, 0.8], [2, 0.8], [2.4, 0]],
  }),
  Listen: motion('Listen.motion3.json', 4, true, {
    ParamAngleX: [[0, 0], [1, -3], [2, -1], [3, 2], [4, 0]],
    ParamAngleY: [[0, 0], [1.2, 2], [2.8, 2], [4, 0]],
    ParamEyeBallX: [[0, 0], [1.1, -0.15], [2.7, 0.12], [4, 0]],
    ParamBodyAngleX: [[0, 0], [2, -1], [4, 0]],
  }),
  Think: motion('Think.motion3.json', 4.5, true, {
    ParamAngleX: [[0, 0], [0.8, -6], [3.5, -6], [4.5, 0]],
    ParamAngleY: [[0, 0], [0.8, 4], [3.5, 4], [4.5, 0]],
    ParamEyeBallX: [[0, 0], [0.8, 0.35], [3.5, 0.35], [4.5, 0]],
    ParamEyeBallY: [[0, 0], [0.8, 0.2], [3.5, 0.2], [4.5, 0]],
    ParamBrowLY: [[0, 0], [0.8, 0.25], [3.5, 0.25], [4.5, 0]],
    ParamBrowRY: [[0, 0], [0.8, 0.25], [3.5, 0.25], [4.5, 0]],
  }),
  Speak: motion('Speak.motion3.json', 3, true, {
    ParamAngleZ: [[0, 0], [0.75, 1.3], [1.5, 0], [2.25, -1.3], [3, 0]],
    ParamBodyAngleX: [[0, 0], [0.75, 1], [1.5, 0], [2.25, -1], [3, 0]],
    ParamBodyAngleZ: [[0, 0], [0.75, 0.6], [1.5, 0], [2.25, -0.6], [3, 0]],
  }),
  Nod: motion('Nod.motion3.json', 1.35, false, {
    ParamAngleY: [[0, 0], [0.25, 8], [0.52, -5], [0.78, 7], [1.05, -3], [1.35, 0]],
    ParamBodyAngleY: [[0, 0], [0.3, 3], [0.65, -1.5], [1, 2], [1.35, 0]],
  }),
  ShakeHead: motion('ShakeHead.motion3.json', 1.6, false, {
    ParamAngleX: [[0, 0], [0.25, -12], [0.58, 12], [0.92, -10], [1.25, 8], [1.6, 0]],
    ParamBodyAngleX: [[0, 0], [0.35, -3], [0.75, 3], [1.15, -2], [1.6, 0]],
  }),
  Wave: motion('Wave.motion3.json', 2.8, false, {
    ParamAngleZ: [[0, 0], [0.4, -5], [0.85, 4], [1.3, -5], [1.75, 4], [2.25, -2], [2.8, 0]],
    ParamBodyAngleZ: [[0, 0], [0.4, -3], [0.85, 2], [1.3, -3], [1.75, 2], [2.3, -1], [2.8, 0]],
    ParamEyeLSmile: [[0, 0], [0.3, 1], [2.3, 1], [2.8, 0]],
    ParamEyeRSmile: [[0, 0], [0.3, 1], [2.3, 1], [2.8, 0]],
    ParamMouthForm: [[0, 0], [0.3, 0.9], [2.3, 0.9], [2.8, 0]],
  }),
  TouchHead: motion('TouchHead.motion3.json', 2.1, false, {
    ParamAngleY: [[0, 0], [0.4, 5], [1.5, 5], [2.1, 0]],
    ParamAngleZ: [[0, 0], [0.4, 3], [1.5, 3], [2.1, 0]],
    ParamEyeLOpen: [[0, 1], [0.45, 0.7], [1.5, 0.7], [2.1, 1]],
    ParamEyeROpen: [[0, 1], [0.45, 0.7], [1.5, 0.7], [2.1, 1]],
    ParamCheek: [[0, 0], [0.35, 0.8], [1.65, 0.8], [2.1, 0]],
  }),
  TouchHairClip: motion('TouchHairClip.motion3.json', 2.3, false, {
    ParamAngleX: [[0, 0], [0.45, 7], [1.7, 7], [2.3, 0]],
    ParamAngleZ: [[0, 0], [0.45, -4], [1.7, -4], [2.3, 0]],
    ParamEyeLSmile: [[0, 0], [0.45, 0.8], [1.7, 0.8], [2.3, 0]],
    ParamEyeRSmile: [[0, 0], [0.45, 0.8], [1.7, 0.8], [2.3, 0]],
    ParamCheek: [[0, 0], [0.35, 1], [1.8, 1], [2.3, 0]],
  }),
  Drag: motion('Drag.motion3.json', 2.2, true, {
    ParamBodyAngleX: [[0, 0], [0.5, -4], [1.1, 0], [1.7, 4], [2.2, 0]],
    ParamBodyAngleZ: [[0, 0], [0.5, 2], [1.1, 0], [1.7, -2], [2.2, 0]],
    ParamAngleZ: [[0, 0], [0.5, 1.5], [1.1, 0], [1.7, -1.5], [2.2, 0]],
  }),
  Return: motion('Return.motion3.json', 2.5, false, {
    ParamAngleY: [[0, -6], [0.6, 3], [1.2, 0], [1.8, 2], [2.5, 0]],
    ParamBodyAngleY: [[0, -3], [0.7, 1.5], [1.4, 0], [2.5, 0]],
    ParamEyeLOpen: [[0, 0.55], [0.7, 1], [2.5, 1]],
    ParamEyeROpen: [[0, 0.55], [0.7, 1], [2.5, 1]],
  }),
};

const physics = {
  Version: 3,
  Meta: {
    PhysicsSettingCount: 3,
    TotalInputCount: 6,
    TotalOutputCount: 3,
    VertexCount: 9,
    Fps: 60,
    EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
    PhysicsDictionary: [
      { Id: 'HairFrontPhysics', Name: 'Front Hair' },
      { Id: 'HairSidePhysics', Name: 'Side Hair' },
      { Id: 'HairBackPhysics', Name: 'Back Hair' },
    ],
  },
  PhysicsSettings: [
    physicsSetting('HairFrontPhysics', [input('ParamAngleX', 65), input('ParamAngleZ', 35)], 'ParamHairFront', 0.72, 0.42, 11, 14),
    physicsSetting('HairSidePhysics', [input('ParamAngleX', 75), input('ParamBodyAngleX', 25)], 'ParamHairSide', 0.8, 0.55, 9, 18),
    physicsSetting('HairBackPhysics', [input('ParamBodyAngleZ', 70), input('ParamAngleZ', 30)], 'ParamHairBack', 0.66, 0.7, 7, 22),
  ],
};

fs.mkdirSync(MOTION_ROOT, { recursive: true });
for (const [group, document] of Object.entries(motions)) {
  for (const entry of asEntries(document)) {
    fs.writeFileSync(path.join(MOTION_ROOT, entry.file), `${JSON.stringify(entry.document, null, 2)}\n`);
  }
}
fs.writeFileSync(path.join(MODEL_ROOT, 'athena-live2d-default.physics3.json'), `${JSON.stringify(physics, null, 2)}\n`);

for (const fileName of ['athena-live2d-default-sdk5.model3.json', 'athena-live2d-default.model3.json']) {
  const filePath = path.join(MODEL_ROOT, fileName);
  const model = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  model.FileReferences.Physics = 'athena-live2d-default.physics3.json';
  model.FileReferences.Motions = Object.fromEntries(Object.entries(motions).map(([group, document]) => [
    group,
    asEntries(document).map(entry => ({
      File: `motions/${entry.file}`,
      FadeInTime: group === 'Idle' ? 0.45 : 0.2,
      FadeOutTime: group === 'Idle' ? 0.45 : 0.25,
    })),
  ]));
  fs.writeFileSync(filePath, `${JSON.stringify(model, null, '\t')}\n`);
}

const motionCount = Object.values(motions).reduce((total, document) => total + asEntries(document).length, 0);
console.log(`ATHENA_LIVE2D_MOTIONS_GENERATED groups=${Object.keys(motions).length} motions=${motionCount} physics=${physics.PhysicsSettings.length}`);

function motion(file, duration, loop, parameters) {
  const curves = Object.entries(parameters).map(([id, points]) => ({
    Target: 'Parameter',
    Id: id,
    Segments: linearSegments(points),
  }));
  return {
    file,
    document: {
      Version: 3,
      Meta: {
        Duration: duration,
        Fps: 60,
        Loop: loop,
        AreBeziersRestricted: true,
        CurveCount: curves.length,
        TotalSegmentCount: curves.reduce((total, curve) => total + ((curve.Segments.length - 2) / 3), 0),
        TotalPointCount: curves.reduce((total, curve) => total + 1 + ((curve.Segments.length - 2) / 3), 0),
        UserDataCount: 0,
        TotalUserDataSize: 0,
      },
      Curves: curves,
    },
  };
}

function asEntries(document) {
  return Array.isArray(document) ? document : [document];
}

function linearSegments(points) {
  const [first, ...rest] = points;
  return [first[0], first[1], ...rest.flatMap(([time, value]) => [0, time, value])];
}

function input(id, weight) {
  return { Source: { Target: 'Parameter', Id: id }, Weight: weight, Type: 'Angle', Reflect: false };
}

function physicsSetting(id, inputs, outputId, mobility, delay, acceleration, radius) {
  return {
    Id: id,
    Input: inputs,
    Output: [{
      Destination: { Target: 'Parameter', Id: outputId },
      VertexIndex: 2,
      Scale: 1,
      Weight: 100,
      Type: 'Angle',
      Reflect: false,
    }],
    Vertices: [
      { Position: { X: 0, Y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
      { Position: { X: 0, Y: radius * 0.5 }, Mobility: mobility, Delay: delay, Acceleration: acceleration, Radius: radius * 0.5 },
      { Position: { X: 0, Y: radius }, Mobility: mobility * 0.86, Delay: delay * 1.2, Acceleration: acceleration * 0.82, Radius: radius * 0.5 },
    ],
    Normalization: {
      Position: { Minimum: -10, Default: 0, Maximum: 10 },
      Angle: { Minimum: -30, Default: 0, Maximum: 30 },
    },
  };
}
