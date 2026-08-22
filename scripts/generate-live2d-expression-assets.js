const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default', 'model');
const EXPRESSION_ROOT = path.join(MODEL_ROOT, 'expressions');

const expressions = {
  neutral: {},
  happy: {
    ParamMouthForm: 1,
    ParamEyeLSmile: 0.8,
    ParamEyeRSmile: 0.8,
    ParamCheek: 0.5,
    ParamBrowLY: 0.12,
    ParamBrowRY: 0.12,
  },
  soft_smile: {
    ParamMouthForm: 0.58,
    ParamEyeLSmile: 0.35,
    ParamEyeRSmile: 0.35,
    ParamCheek: 0.22,
  },
  thoughtful: {
    ParamMouthForm: -0.18,
    ParamEyeBallX: 0.28,
    ParamEyeBallY: 0.18,
    ParamBrowLY: 0.18,
    ParamBrowRY: 0.18,
  },
  shy: {
    ParamMouthForm: 0.45,
    ParamEyeLOpen: 0.82,
    ParamEyeROpen: 0.82,
    ParamEyeLSmile: 0.3,
    ParamEyeRSmile: 0.3,
    ParamCheek: 0.9,
  },
  confused: {
    ParamMouthForm: -0.38,
    ParamBrowLY: 0.25,
    ParamBrowRY: -0.12,
    ParamBrowLAngle: 0.42,
    ParamBrowRAngle: -0.28,
  },
  surprised: {
    ParamMouthOpenY: 0.5,
    ParamMouthForm: 0.1,
    ParamEyeLOpen: 1,
    ParamEyeROpen: 1,
    ParamBrowLY: 0.48,
    ParamBrowRY: 0.48,
  },
  focused: {
    ParamMouthForm: 0.04,
    ParamBrowLY: -0.16,
    ParamBrowRY: -0.16,
    ParamBrowLAngle: -0.12,
    ParamBrowRAngle: 0.12,
  },
  worried: {
    ParamMouthForm: -0.68,
    ParamBrowLY: 0.3,
    ParamBrowRY: 0.3,
    ParamBrowLAngle: -0.5,
    ParamBrowRAngle: 0.5,
    ParamCheek: 0.15,
  },
  sleepy: {
    ParamEyeLOpen: 0.46,
    ParamEyeROpen: 0.46,
    ParamMouthForm: -0.1,
    ParamBrowLY: -0.12,
    ParamBrowRY: -0.12,
  },
  playful: {
    ParamMouthForm: 0.86,
    ParamEyeLOpen: 0.28,
    ParamEyeROpen: 0.92,
    ParamEyeLSmile: 1,
    ParamEyeRSmile: 0.65,
    ParamCheek: 0.42,
  },
};

fs.mkdirSync(EXPRESSION_ROOT, { recursive: true });
for (const [name, values] of Object.entries(expressions)) {
  const document = {
    Type: 'Live2D Expression',
    FadeInTime: 0.28,
    FadeOutTime: 0.32,
    Parameters: Object.entries(values).map(([id, value]) => ({ Id: id, Value: value, Blend: 'Overwrite' })),
  };
  fs.writeFileSync(path.join(EXPRESSION_ROOT, `${name}.exp3.json`), `${JSON.stringify(document, null, 2)}\n`);
}

for (const fileName of ['athena-live2d-default-sdk5.model3.json', 'athena-live2d-default.model3.json']) {
  const filePath = path.join(MODEL_ROOT, fileName);
  const model = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  model.FileReferences.Expressions = Object.keys(expressions).map(name => ({
    Name: name,
    File: `expressions/${name}.exp3.json`,
  }));
  fs.writeFileSync(filePath, `${JSON.stringify(model, null, '\t')}\n`);
}

console.log(`ATHENA_LIVE2D_EXPRESSIONS_GENERATED expressions=${Object.keys(expressions).length}`);
