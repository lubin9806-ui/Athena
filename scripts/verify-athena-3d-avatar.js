const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION_2 = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a;

function readGlbJson(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.ok(buffer.length > 12, 'GLB file is too small');
  assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, 'invalid GLB magic');
  assert.equal(buffer.readUInt32LE(4), GLB_VERSION_2, 'expected GLB version 2');
  assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB header length does not match file size');

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    assert.ok(offset + chunkLength <= buffer.length, 'GLB chunk exceeds file bounds');

    if (chunkType === CHUNK_TYPE_JSON) {
      const jsonText = buffer.subarray(offset, offset + chunkLength).toString('utf8').trim();
      return JSON.parse(jsonText);
    }

    offset += chunkLength;
  }

  throw new Error('GLB JSON chunk not found');
}

function listNames(items = []) {
  return items.map(item => item.name).filter(Boolean);
}

function main() {
  const root = path.resolve(__dirname, '..');
  const manifestPath = path.join(root, 'assets', 'avatar', 'athena-3d-default', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const modelPath = path.join(path.dirname(manifestPath), manifest.runtime.modelPath);
  assert.equal(manifest.runtime.runnable, true);
  assert.equal(manifest.runtime.format, 'glb');
  assert.equal(manifest.runtime.upgradeTarget, 'vrm');
  assert.ok(fs.existsSync(modelPath), `missing model: ${modelPath}`);
  assert.ok(fs.statSync(modelPath).size > 50_000, 'GLB is unexpectedly small');

  const gltf = readGlbJson(modelPath);
  assert.equal(gltf.asset?.version, '2.0', 'expected glTF 2.0 asset');

  const nodeNames = listNames(gltf.nodes);
  const materialNames = listNames(gltf.materials);
  const meshNames = listNames(gltf.meshes);
  for (const required of ['ATH_HEAD', 'ATH_TORSO_BLOUSE', 'ATH_SKIRT', 'ATH_MOUTH_NEUTRAL', 'ATH_HAIR_CLIP_A']) {
    assert.ok(nodeNames.includes(required), `missing semantic node: ${required}`);
  }
  for (const required of manifest.hotZones) {
    assert.ok(nodeNames.includes(required), `missing hot-zone node: ${required}`);
  }
  for (const required of ['white_blouse', 'deep_navy_skirt', 'athena_cyan_accent', 'soft_black_hair']) {
    assert.ok(materialNames.includes(required), `missing material: ${required}`);
  }

  assert.ok(nodeNames.length >= 30, `expected rich node set, got ${nodeNames.length}`);
  assert.ok(meshNames.length >= 25, `expected rich mesh set, got ${meshNames.length}`);
  console.log(
    `ATHENA_3D_AVATAR_OK format=glb nodes=${nodeNames.length} meshes=${meshNames.length} materials=${materialNames.length} model=${modelPath}`,
  );
}

main();
