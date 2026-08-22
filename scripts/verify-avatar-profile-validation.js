const assert = require('node:assert/strict');

const {
  validateAvatarExternalCommand,
  validateAvatarProfile,
} = require('../dist/core/avatar');

function baseProfile() {
  return {
    id: 'athena-live2d-default',
    displayName: 'Athena Live2D Default',
    provider: 'live2d',
    enabled: true,
    model: {
      source: 'localDirectory',
      rootPath: 'G:/Athena/example-live2d',
      model3JsonPath: 'G:/Athena/example-live2d/avatar.model3.json',
    },
    layout: {
      mode: 'draggable_overlay',
      transform: { x: 0, y: 0, scale: 1, opacity: 1, rotationDeg: 0, mirrored: false },
      alwaysOnTop: false,
      clickThroughMode: 'off',
      transparentBackground: true,
      lockPosition: false,
    },
    expressions: [
      { emotion: 'happy', expressionId: 'happy', intensityScale: 1 },
    ],
    motions: [
      { state: 'idle', motionGroup: 'Idle', priority: 'idle', loop: true },
    ],
    parameters: [],
    lipSync: {
      enabled: true,
      source: 'ttsAudio',
      parameterIds: ['ParamMouthOpenY'],
      sensitivity: 1,
      smoothing: 0.5,
      gain: 1,
      attackMs: 35,
      releaseMs: 120,
      minValue: 0,
      maxValue: 1,
    },
    pointerTracking: {
      enabled: true,
      headParameterIds: ['ParamAngleX', 'ParamAngleY'],
      eyeParameterIds: ['ParamEyeBallX', 'ParamEyeBallY'],
      strength: 0.6,
      smoothing: 0.5,
    },
    idle: {
      enabled: true,
      idleDelayMs: 30000,
      sleepyDelayMs: 300000,
      awayDelayMs: 900000,
      motionGroups: ['Idle'],
      randomize: true,
    },
    hotZones: [
      {
        id: 'head',
        label: 'Head',
        hitAreaName: 'Head',
        action: {
          type: 'athenaReply',
          promptTemplate: 'The user touched the avatar head. Reply warmly and briefly.',
        },
        cooldownMs: 1200,
        enabled: true,
      },
    ],
    externalControl: {
      transport: 'disabled',
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      requireToken: true,
      allowedCommandTypes: [],
      auditEnabled: true,
    },
  };
}

function main() {
  const valid = baseProfile();
  assert.equal(validateAvatarProfile(valid).ok, true);

  const invalid = baseProfile();
  invalid.model.model3JsonPath = '';
  invalid.layout.transform.scale = 0;
  invalid.lipSync.parameterIds = [];
  invalid.hotZones[0].action.promptTemplate = '';
  invalid.externalControl = {
    transport: 'localWebSocket',
    enabled: true,
    host: '127.0.0.1',
    port: 80,
    requireToken: false,
    allowedCommandTypes: ['system.shell.exec'],
    auditEnabled: false,
  };
  const result = validateAvatarProfile(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path === 'model.model3JsonPath'));
  assert.ok(result.issues.some(issue => issue.path === 'layout.transform.scale'));
  assert.ok(result.issues.some(issue => issue.path === 'lipSync.parameterIds'));
  assert.ok(result.issues.some(issue => issue.path === 'hotZones[0].action.promptTemplate'));
  assert.ok(result.issues.some(issue => issue.path === 'externalControl.port'));
  assert.ok(result.issues.some(issue => issue.path === 'externalControl.requireToken'));
  assert.ok(result.issues.some(issue => issue.path === 'externalControl.allowedCommandTypes[0]'));

  const controlled = baseProfile();
  controlled.externalControl = {
    transport: 'localWebSocket',
    enabled: true,
    host: '127.0.0.1',
    port: 18920,
    requireToken: true,
    allowedCommandTypes: ['avatar.motion.play'],
    auditEnabled: true,
  };
  assert.equal(validateAvatarProfile(controlled).ok, true);
  assert.equal(validateAvatarExternalCommand({
    type: 'avatar.motion.play',
    characterId: controlled.id,
    priority: 50,
    ttlMs: 5000,
  }, controlled).ok, true);
  assert.equal(validateAvatarExternalCommand({
    type: 'system.shell.exec',
    characterId: controlled.id,
  }, controlled).ok, false);

  console.log('ATHENA_AVATAR_PROFILE_VALIDATION_OK profile=valid invalid=blocked externalControl=allowlist');
}

main();

