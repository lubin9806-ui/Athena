const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanLive2DModelPackage } = require('../dist/core/avatar');

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-live2d-'));
  writeFile(path.join(root, 'model.moc3'));
  writeFile(path.join(root, 'textures', 'texture_00.png'));
  writeFile(path.join(root, 'motions', 'idle.motion3.json'), '{}');
  writeFile(path.join(root, 'motions', 'tap.motion3.json'), '{}');
  writeFile(path.join(root, 'expressions', 'happy.exp3.json'), '{}');
  writeFile(path.join(root, 'physics.json'), '{}');
  writeFile(path.join(root, 'pose.json'), '{}');
  writeFile(path.join(root, 'userdata.json'), '{}');
  writeFile(path.join(root, 'avatar.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'model.moc3',
      Textures: ['textures/texture_00.png'],
      Physics: 'physics.json',
      Pose: 'pose.json',
      UserData: 'userdata.json',
      Expressions: [
        { Name: 'happy', File: 'expressions/happy.exp3.json' },
      ],
      Motions: {
        Idle: [{ File: 'motions/idle.motion3.json' }],
        TapBody: [{ File: 'motions/tap.motion3.json' }],
      },
    },
    Groups: [
      { Target: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
      { Target: 'LipSync', Ids: ['ParamMouthOpenY'] },
    ],
    HitAreas: [
      { Id: 'Head', Name: 'Head' },
      { Id: 'Body', Name: 'Body' },
    ],
  }, null, 2));
  return root;
}

function main() {
  const root = createFixture();
  const result = scanLive2DModelPackage({ rootPath: root });
  assert.equal(result.source.source, 'localDirectory');
  assert.equal(result.source.rootPath, path.resolve(root));
  assert.ok(result.source.model3JsonPath.endsWith('avatar.model3.json'));
  assert.deepEqual(result.inventory.expressions, ['happy']);
  assert.deepEqual(result.inventory.motionGroups.Idle, ['motions/idle.motion3.json']);
  assert.deepEqual(result.inventory.motionGroups.TapBody, ['motions/tap.motion3.json']);
  assert.deepEqual(result.inventory.lipSyncParameters, ['ParamMouthOpenY']);
  assert.deepEqual(result.inventory.eyeBlinkParameters, ['ParamEyeLOpen', 'ParamEyeROpen']);
  assert.deepEqual(result.inventory.hitAreas, ['Head', 'Body']);
  assert.equal(result.inventory.physicsFile, 'physics.json');
  assert.equal(result.inventory.poseFile, 'pose.json');
  assert.equal(result.inventory.userDataFile, 'userdata.json');
  assert.equal(result.warnings.length, 0);
  assert.ok(result.referencedFiles.every(file => file.exists && file.insideRoot));

  const escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-live2d-escape-'));
  writeFile(path.join(escapeRoot, 'unsafe.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: '../outside.moc3',
      Textures: [],
      Motions: {},
    },
  }));
  const unsafe = scanLive2DModelPackage({ rootPath: escapeRoot });
  assert.equal(unsafe.referencedFiles[0].insideRoot, false);
  assert.ok(unsafe.warnings.some(warning => warning.includes('escapes')));

  console.log('ATHENA_AVATAR_LIBRARY_OK manifest=model3 expressions=1 motionGroups=2 lipSync=1 hitAreas=2 escapes=warned');
}

main();

