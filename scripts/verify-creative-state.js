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

// --- Extraction: a bad parse here silently rewrites the character description ---

const {
  parseCreativeExtraction,
  describeCreativeChange,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeExtraction.js'));

const sceneOnly = parseCreativeExtraction(JSON.stringify({
  kind: 'edit',
  understanding: '把场景从咖啡馆换成书店',
  explicitSections: ['scene'],
  sections: { scene: BOOKSTORE },
}));
assert.equal(sceneOnly.kind, 'edit');
assert.deepEqual(sceneOnly.issues, []);
assert.deepEqual(Object.keys(sceneOnly.patch.sections), ['scene']);
assert.deepEqual(sceneOnly.patch.explicitSections, ['scene']);
assert.equal(sceneOnly.patch.replaceAll, false, 'an edit must never replace the whole description');

const fullSpec = parseCreativeExtraction(JSON.stringify({
  kind: 'full_spec',
  understanding: '一整套新的人物设定',
  sections: { character: FACE, scene: CAFE },
}));
assert.equal(fullSpec.patch.replaceAll, true);

// Anything unreadable must leave the accumulated description alone rather than
// guess at it.
for (const raw of ['', 'not json', '{}', '[]', '{"kind":"rewrite_everything"}', '{"kind":"edit"}', '{"kind":"edit","sections":"nope"}']) {
  const parsed = parseCreativeExtraction(raw);
  assert.equal(parsed.kind, 'not_creative', `unreadable extraction must not edit: ${JSON.stringify(raw)}`);
  assert.deepEqual(parsed.patch.sections, {});
  assert(parsed.issues.length > 0);
}

// Unknown or non-string sections are dropped and reported, never merged.
const noisy = parseCreativeExtraction(JSON.stringify({
  kind: 'edit',
  understanding: 'x',
  sections: { scene: BOOKSTORE, background: '不存在的段落', pose: 42 },
  explicitSections: ['scene', 'nonsense'],
}));
assert.deepEqual(Object.keys(noisy.patch.sections), ['scene']);
assert.deepEqual(noisy.patch.explicitSections, ['scene']);
assert(noisy.issues.some(issue => issue.startsWith('unknown-section:')));
assert(noisy.issues.some(issue => issue.startsWith('invalid-section:')));

// Recovered from prose, because models wrap JSON in explanations.
const fenced = parseCreativeExtraction('明白了：\n```json\n{"kind":"edit","understanding":"换场景","sections":{"scene":"新场景"}}\n```');
assert.equal(fenced.kind, 'edit');
assert(fenced.issues.includes('json-recovered-from-prose'));

assert.doesNotThrow(() => parseCreativeExtraction(undefined));
assert.doesNotThrow(() => parseCreativeExtraction(null));

// The extraction feeds straight into the merge, and the face still survives.
const extracted = mergeCreativeState(initial.state, sceneOnly.patch);
assert.equal(extracted.state.sections.character, FACE);
assert.equal(extracted.state.sections.scene, BOOKSTORE);
assert.match(describeCreativeChange(extracted.changed, extracted.refused), /更新了 场景/);
assert.match(describeCreativeChange(['scene'], ['character']), /保持了锁定的 五官/);

// --- Confirm before acting (ATH-CHAT-004) ---

const {
  needsCreativeConfirmation,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeExtraction.js'));
const {
  readCreativeReply,
  formatCreativeProposal,
  parseCreativeWorkspace,
  serializeCreativeWorkspace,
  emptyCreativeWorkspace,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeWorkspace.js'));

// A whole new character, or a request with a real gap, is worth a sentence back.
// A narrow unambiguous edit is not - asking every time is its own kind of not listening.
assert.equal(needsCreativeConfirmation({ kind: 'full_spec', gaps: [], plannedExtensions: [] }), true);
assert.equal(needsCreativeConfirmation({ kind: 'edit', gaps: ['光线方向'], plannedExtensions: [] }), true);
assert.equal(needsCreativeConfirmation({ kind: 'edit', gaps: [], plannedExtensions: ['镜头'] }), false);
assert.equal(needsCreativeConfirmation({ kind: 'not_creative', gaps: ['x'], plannedExtensions: [] }), false);

// Only a message that is nothing but an affirmative counts as consent.
for (const yes of ['好', '好的', '可以', '确认', '就这样', '生成吧', 'ok', 'Yes']) {
  assert.equal(readCreativeReply(yes), 'confirm', `${yes} should confirm`);
}
for (const no of ['取消', '算了', '不用了', '先不要', 'cancel']) {
  assert.equal(readCreativeReply(no), 'cancel', `${no} should cancel`);
}
// The dangerous case: consent-shaped, but actually a revision.
for (const revise of [
  '好，不过把场景换成书店',
  '可以，但头发再长一点',
  '好的，另外加一盏侧光并且把背景虚化程度调高一些',
  '为什么要问我',
  '',
]) {
  assert.equal(readCreativeReply(revise), 'revise', `${JSON.stringify(revise)} must not be read as consent`);
}

const proposal = {
  patch: { sections: { scene: BOOKSTORE }, explicitSections: ['scene'] },
  understanding: '把场景从咖啡馆换成书店',
  gaps: ['时间是下午还是傍晚'],
  plannedExtensions: ['侧逆光', '浅景深'],
  createdAt: new Date().toISOString(),
};
const proposalText = formatCreativeProposal(proposal);
assert(proposalText.includes('我理解的是：把场景从咖啡馆换成书店'));
assert(proposalText.includes('侧逆光'));
assert(proposalText.includes('时间是下午还是傍晚'));
assert(proposalText.includes('角色特征我不会动'));

// The workspace round-trips, and a blob written before proposals existed still reads.
const workspace = { state: sceneEdit.state, pending: proposal };
const roundTripped = parseCreativeWorkspace(serializeCreativeWorkspace(workspace));
assert.deepEqual(roundTripped.state, sceneEdit.state);
assert.equal(roundTripped.pending.understanding, proposal.understanding);

const legacyBlob = serializeCreativeState(sceneEdit.state);
const legacy = parseCreativeWorkspace(legacyBlob);
assert.deepEqual(legacy.state, sceneEdit.state, 'a bare state blob must still load');
assert.equal(legacy.pending, null);

for (const raw of [null, '', 'not json', '[]', '{"pending":"nope"}', '{"pending":{"patch":"nope"}}']) {
  const parsed = parseCreativeWorkspace(raw);
  assert.equal(parsed.pending, null, `malformed pending must not survive: ${JSON.stringify(raw)}`);
  assert.deepEqual(Object.keys(parsed.state.sections).sort(), [...CREATIVE_SECTIONS].sort());
}
assert.equal(emptyCreativeWorkspace().pending, null);

console.log(`ATHENA_CREATIVE_STATE_OK sections=${CREATIVE_SECTIONS.length} locked=${DEFAULT_LOCKED_SECTIONS.join('+')} confirm=before-acting`);
