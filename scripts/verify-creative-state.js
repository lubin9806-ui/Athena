const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  CREATIVE_SECTIONS,
  DEFAULT_LOCKED_SECTIONS,
  emptyCreativeState,
  mergeCreativeState,
  setCreativeSectionLock,
  hasCreativeContent,
  buildCreativePrompt,
  formatCreativeStateForDisplay,
  parseCreativeState,
  serializeCreativeState,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeState.js'));

const FACE = '24岁现代东亚年轻女性，鹅蛋脸，杏仁形深棕色眼眸，自然窄双眼皮。';
const HAIR = '深棕近黑色中长发，低位半扎发，哑光深琥珀色发夹。';
const OUTFIT = '低饱和燕麦米色修身针织开衫，深灰褐色高腰西装长裤。';
const CAFE = '午后咖啡馆靠窗座位，暖色阳光斜射。';
const BOOKSTORE = '现代城市独立书店内的临窗阅读区，深胡桃木书架。';
const POSE = '侧身坐在木质扶手椅上，视线落向窗外。';
const TECH = 'cinematic lifestyle portrait, Rembrandt lighting, photorealistic.';

const empty = emptyCreativeState();
assert.equal(empty.version, 0);
assert.equal(hasCreativeContent(empty), false);
assert.deepEqual(empty.locked, DEFAULT_LOCKED_SECTIONS);

// A pasted full spec establishes the baseline.
const initial = mergeCreativeState(empty, {
  replaceAll: true,
  sections: { character: FACE, hair: HAIR, outfit: OUTFIT, scene: CAFE, pose: POSE, technical: TECH },
});
assert.equal(initial.state.version, 1);
assert.deepEqual(initial.changed.sort(), [...CREATIVE_SECTIONS].sort());
assert.equal(hasCreativeContent(initial.state), true);

// The reported failure: changing the scene must not redraw the face.
const sceneEdit = mergeCreativeState(initial.state, {
  sections: { scene: BOOKSTORE },
  explicitSections: ['scene'],
});
assert.deepEqual(sceneEdit.changed, ['scene']);
assert.equal(sceneEdit.state.sections.scene, BOOKSTORE);
assert.equal(sceneEdit.state.sections.character, FACE, 'the face must survive a scene change');
assert.equal(sceneEdit.state.sections.hair, HAIR);
assert.equal(sceneEdit.state.sections.outfit, OUTFIT);
assert.equal(sceneEdit.state.sections.pose, POSE);
assert.equal(sceneEdit.state.version, 2);

// A locked section is not rewritten just because the model produced something for
// it; the edit has to name it. The refusal is reported, not applied silently.
const drift = mergeCreativeState(sceneEdit.state, {
  sections: { scene: BOOKSTORE, character: '换了一张脸', hair: '换了发型' },
  explicitSections: ['scene'],
});
assert.deepEqual(drift.changed, [], 'nothing changes when only locked sections differ');
assert.deepEqual(drift.refused.sort(), ['character', 'hair']);
assert.equal(drift.state.sections.character, FACE);
assert.equal(drift.state, sceneEdit.state, 'a merge that changes nothing keeps the same state object');

// Naming a locked section is how the user actually changes it.
const deliberate = mergeCreativeState(sceneEdit.state, {
  sections: { hair: '改成利落短发' },
  explicitSections: ['hair'],
});
assert.deepEqual(deliberate.changed, ['hair']);
assert.deepEqual(deliberate.refused, []);
assert.equal(deliberate.state.sections.hair, '改成利落短发');
assert.equal(deliberate.state.sections.character, FACE);

// Unlocking is available for someone who wants free rein.
const unlocked = setCreativeSectionLock(deliberate.state, 'outfit', false);
assert.equal(unlocked.locked.includes('outfit'), false);
const outfitDrift = mergeCreativeState(unlocked, { sections: { outfit: '换成风衣' } });
assert.deepEqual(outfitDrift.changed, ['outfit']);
assert.deepEqual(outfitDrift.refused, []);
assert.equal(setCreativeSectionLock(unlocked, 'outfit', false), unlocked, 'a no-op lock change keeps the state');

// A fresh full spec resets the locks along with the content.
const restarted = mergeCreativeState(unlocked, {
  replaceAll: true,
  sections: { character: '完全不同的角色', scene: CAFE },
});
assert.equal(restarted.state.sections.character, '完全不同的角色');
assert.equal(restarted.state.sections.hair, '', 'replaceAll clears sections the new spec omits');
assert.deepEqual(restarted.state.locked, DEFAULT_LOCKED_SECTIONS);

// The prompt sent to the image model is the merged description, in a stable order.
const prompt = buildCreativePrompt(sceneEdit.state);
assert(prompt.includes(FACE) && prompt.includes(BOOKSTORE) && prompt.includes(TECH));
assert(!prompt.includes(CAFE), 'the replaced scene must not linger in the prompt');
assert(prompt.indexOf(FACE) < prompt.indexOf(BOOKSTORE), 'sections keep a stable order');

// The readable version keeps the section names and shows what is locked.
const display = formatCreativeStateForDisplay(sceneEdit.state);
assert(display.includes('角色五官'));
assert(display.includes('已锁定'));
assert(display.includes(BOOKSTORE));

// Round-trips, and survives anything malformed on disk.
const restored = parseCreativeState(serializeCreativeState(sceneEdit.state));
assert.deepEqual(restored, sceneEdit.state);
for (const raw of [null, undefined, '', 'not json', '[]', '{"sections":"nope"}', '{"sections":{"character":5}}', '{"locked":["nonsense"]}']) {
  const parsed = parseCreativeState(raw);
  assert.equal(typeof parsed.version, 'number');
  assert.deepEqual(Object.keys(parsed.sections).sort(), [...CREATIVE_SECTIONS].sort());
  assert(parsed.locked.every(section => CREATIVE_SECTIONS.includes(section)));
}

// An empty edit is not a version bump.
const noop = mergeCreativeState(sceneEdit.state, { sections: {} });
assert.deepEqual(noop.changed, []);
assert.equal(noop.state.version, sceneEdit.state.version);

console.log(`ATHENA_CREATIVE_STATE_OK sections=${CREATIVE_SECTIONS.length} locked=${DEFAULT_LOCKED_SECTIONS.join('+')}`);
