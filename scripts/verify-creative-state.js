const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  CREATIVE_SECTIONS,
  DEFAULT_LOCKED_SECTIONS,
  creativeSectionLabel,
  emptyCreativeState,
  mergeCreativeState,
  setCreativeSectionLock,
  hasCreativeContent,
  filledCreativeSections,
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
const PORTRAIT_SECTIONS = ['character', 'hair', 'outfit', 'pose', 'scene', 'technical'];

const empty = emptyCreativeState();
assert.equal(empty.version, 0);
assert.equal(hasCreativeContent(empty), false);
assert.deepEqual(empty.locked, DEFAULT_LOCKED_SECTIONS);
assert.deepEqual(filledCreativeSections(empty), []);

// Every section is optional. A landscape is a complete description with two of
// them, so nothing may require the portrait set to be present.
const landscape = mergeCreativeState(empty, { sections: { subject: '雪山日出', scene: '高原，无人' } });
assert.deepEqual(landscape.changed, ['subject', 'scene']);
assert.equal(hasCreativeContent(landscape.state), true);
assert.equal(buildCreativePrompt(landscape.state), '雪山日出\n\n高原，无人');
assert.deepEqual(filledCreativeSections(landscape.state), ['subject', 'scene']);

// The bug this replaces: `character` is locked by default, so a scene-only picture
// could never gain a character. A lock protects what is written, not the slot.
const peopled = mergeCreativeState(landscape.state, { sections: { character: FACE } });
assert.deepEqual(peopled.changed, ['character'], 'an empty locked section must still be fillable');
assert.deepEqual(peopled.refused, []);
assert.equal(peopled.state.sections.character, FACE);
// And once it is written, the lock bites.
const overwrite = mergeCreativeState(peopled.state, { sections: { character: '换了一张脸' } });
assert.deepEqual(overwrite.changed, []);
assert.deepEqual(overwrite.refused, ['character'], 'a written locked section is protected');
assert.equal(overwrite.state.sections.character, FACE);

// A pasted full spec establishes the baseline.
const initial = mergeCreativeState(empty, {
  replaceAll: true,
  sections: { character: FACE, hair: HAIR, outfit: OUTFIT, scene: CAFE, pose: POSE, technical: TECH },
});
assert.equal(initial.state.version, 1);
assert.deepEqual(initial.changed.sort(), [...PORTRAIT_SECTIONS].sort());
assert.equal(initial.state.sections.subject, '', 'sections the spec omits stay empty rather than invented');
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
assert(prompt.indexOf(BOOKSTORE) < prompt.indexOf(TECH), 'the camera notes come after the scene');
assert(!/\n\n\n/.test(prompt), 'empty sections must not leave gaps in the prompt');

// The readable version keeps the section names and shows what is locked.
const display = formatCreativeStateForDisplay(sceneEdit.state);
assert(display.includes('角色五官'));
assert(display.includes('已锁定'));
assert(display.includes(BOOKSTORE));
assert(!display.includes('画面主体'), 'an empty section is not shown as an empty heading');
for (const section of CREATIVE_SECTIONS) assert(creativeSectionLabel(section), `${section} needs a label`);

// Round-trips, and survives anything malformed on disk.
const restored = parseCreativeState(serializeCreativeState(sceneEdit.state));
assert.deepEqual(restored, sceneEdit.state);
for (const raw of [null, undefined, '', 'not json', '[]', '{"sections":"nope"}', '{"sections":{"character":5}}', '{"locked":["nonsense"]}']) {
  const parsed = parseCreativeState(raw);
  assert.equal(typeof parsed.version, 'number');
  assert.deepEqual(Object.keys(parsed.sections).sort(), [...CREATIVE_SECTIONS].sort());
  assert(parsed.locked.every(section => CREATIVE_SECTIONS.includes(section)));
}
// A blob written before the newer sections existed still loads, with them empty.
const legacyState = parseCreativeState(JSON.stringify({
  version: 4,
  sections: { character: FACE, hair: HAIR, outfit: OUTFIT, scene: CAFE, pose: POSE, technical: TECH },
  locked: ['character'],
  updatedAt: new Date().toISOString(),
}));
assert.equal(legacyState.version, 4);
assert.equal(legacyState.sections.character, FACE);
assert.equal(legacyState.sections.subject, '');
assert.equal(legacyState.sections.notes, '');
assert.deepEqual(legacyState.locked, ['character']);

// An empty edit is not a version bump.
const noop = mergeCreativeState(sceneEdit.state, { sections: {} });
assert.deepEqual(noop.changed, []);
assert.equal(noop.state.version, sceneEdit.state.version);

// --- Reading a brief that carries its own headings (no model call) ---

const {
  parseLabeledCreativeSpec,
  localCreativeExtraction,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeLocalParser.js'));

const PASTED_SPEC = [
  '角色五官：24岁现代东亚年轻女性，鹅蛋脸，杏仁形深棕色眼眸，自然窄双眼皮，眼神安静克制。',
  '服装描写：低饱和燕麦米色修身针织开衫，深灰褐色高腰宽松西装长裤，垂坠面料。',
  '头发与发饰：深棕近黑色中长发，低位半扎发，哑光深琥珀色醋酸发夹固定。',
  '环境背景：现代城市独立书店内的临窗阅读区，深胡桃木书架，右侧整面落地窗。',
  '角色 Pose：侧身坐在靠窗的木质扶手椅上，视线落向窗外而不是镜头。',
  '画面关键词：超写实摄影、Rembrandt lighting、35mm full-frame、shallow depth of field。',
].join('\n\n');

const pasted = parseLabeledCreativeSpec(PASTED_SPEC);
assert(pasted, 'a written brief must be read locally');
assert.deepEqual(pasted.explicitSections, ['character', 'hair', 'outfit', 'pose', 'scene', 'technical']);
assert.equal(pasted.fullSpec, true, 'six sections including an identity is a whole description');
assert.equal(pasted.coverage, 1, 'every line of a pure spec belongs to a section');
assert(pasted.sections.character.startsWith('24岁'), 'the heading must not be kept in the content');
assert(pasted.sections.pose.includes('视线落向窗外'), '角色 Pose must map to pose, not character');
assert(pasted.sections.technical.includes('Rembrandt'));
assert.equal(pasted.sections.subject, undefined, 'sections the brief never mentions stay absent');

const pastedExtraction = localCreativeExtraction(pasted);
assert.equal(pastedExtraction.kind, 'full_spec');
assert.equal(pastedExtraction.source, 'local');
assert.equal(pastedExtraction.patch.replaceAll, true);
assert.deepEqual(pastedExtraction.issues, []);
assert.deepEqual(pastedExtraction.gaps, [], 'nothing is guessed locally, so nothing is reported as a gap');
assert(pastedExtraction.understanding.includes('角色五官'));

// Every heading style people actually type.
const styled = parseLabeledCreativeSpec([
  '## 服装',
  '白色亚麻衬衫',
  '',
  '【环境背景】黄昏的海边',
  '- **画面关键词**：柔和逆光, 35mm',
  '3. Style: 吉卜力动画风格',
].join('\n'));
assert(styled, 'markdown, bracketed, bulleted and English headings must all read');
assert.equal(styled.sections.outfit, '白色亚麻衬衫');
assert.equal(styled.sections.scene, '黄昏的海边');
assert.equal(styled.sections.technical, '柔和逆光, 35mm');
assert.equal(styled.sections.style, '吉卜力动画风格');
assert.equal(styled.fullSpec, false, 'four sections without an identity is an edit, not a replacement');

// A two-line edit is read locally and names what it touches, which is what lets it
// through a lock.
const shortEdit = parseLabeledCreativeSpec('场景：书店\n服装：换成白色长裙');
assert(shortEdit, 'a short brief must not be penalised for the length of its own labels');
assert.equal(shortEdit.coverage, 1);
assert.deepEqual(shortEdit.explicitSections, ['outfit', 'scene']);
const shortExtraction = localCreativeExtraction(shortEdit);
assert.equal(shortExtraction.kind, 'edit');
assert.equal(shortExtraction.patch.replaceAll, false);
const throughLock = mergeCreativeState(initial.state, shortExtraction.patch);
assert.deepEqual(throughLock.changed.sort(), ['outfit', 'scene']);
assert.deepEqual(throughLock.refused, [], 'a named section passes its own lock');
assert.equal(throughLock.state.sections.character, FACE, 'unnamed sections are still untouched');

// What must NOT be read as a brief. Prose with a colon is the dangerous case: a
// false heading here files a chat line as part of the picture.
for (const notASpec of [
  '',
  '   ',
  '帮我把这张图的场景换成书店，然后头发弄短一点',
  '她说：好的\n他回答：那就这样',
  '备注：明天开会\n说明：记得带电脑',
  '场景：书店',
  '今天天气不错。场景：其实我想说的是别的事情，这段话很长很长，完全不是一份画面描述，只是恰好里面出现了一个看起来像标题的词而已，后面还有更多的普通句子。',
  // Headings that arrive at the end of a paragraph of unrelated prose: the message
  // is a conversation that mentions a scene, not a brief.
  '我想跟你聊一个完全无关的话题，最近工作上遇到一些事情，说来话长，我先把前因后果讲清楚，免得你误会我的意思，总之情况比较复杂，等我慢慢说。\n场景：书店\n服装：白裙',
]) {
  assert.equal(
    parseLabeledCreativeSpec(notASpec),
    null,
    `must not be read as a written brief: ${JSON.stringify(notASpec.slice(0, 30))}`,
  );
}
assert.equal(parseLabeledCreativeSpec(undefined), null);
assert.equal(parseLabeledCreativeSpec(null), null);

// --- Extraction: a bad parse here silently rewrites the character description ---

const {
  parseCreativeExtraction,
  describeCreativeChange,
  creativeStateSummary,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeExtraction.js'));

const sceneOnly = parseCreativeExtraction(JSON.stringify({
  kind: 'edit',
  understanding: '把场景从咖啡馆换成书店',
  explicitSections: ['scene'],
  sections: { scene: BOOKSTORE },
}));
assert.equal(sceneOnly.kind, 'edit');
assert.equal(sceneOnly.source, 'model');
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

// The newer sections are accepted rather than dropped as unknown.
const broad = parseCreativeExtraction(JSON.stringify({
  kind: 'edit',
  understanding: '一张风景',
  sections: { subject: '雪山', style: '水彩', notes: '不要出现人' },
}));
assert.deepEqual(Object.keys(broad.patch.sections).sort(), ['notes', 'style', 'subject']);
assert.deepEqual(broad.issues, []);

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

// The summary names what exists rather than counting toward a total nobody owes.
assert.equal(creativeStateSummary(empty), 'v0 · 还没有画面描述');
assert.equal(creativeStateSummary(landscape.state), 'v1 · 主体、场景');
assert(!creativeStateSummary(sceneEdit.state).includes('/'), 'no denominator: sections are optional');

// --- What the extractor asks the provider for (ATH-IMG-004, ATH-PERF-001) ---

const {
  ModelCreativeSectionExtractor,
} = require(path.join(root, 'dist', 'core', 'creative', 'CreativeSectionExtractor.js'));

async function verifyExtractorRequest() {
  const seen = [];
  const spyExtractor = new ModelCreativeSectionExtractor({
    chatJson: async (messages, schema, mode, overrides, signal) => {
      seen.push({ messages, schema, mode, overrides, signal });
      return JSON.stringify({ kind: 'edit', understanding: '换场景', sections: { scene: BOOKSTORE } });
    },
  });
  const spySignal = AbortSignal.timeout(5_000);
  const spyResult = await spyExtractor.extract({
    message: '把场景换成书店',
    state: initial.state,
    signal: spySignal,
  });
  assert.equal(spyResult.kind, 'edit');
  assert.equal(seen.length, 1, 'one extraction is one call');

  // The output budget is not a size preference. Reasoning models spend output tokens
  // before emitting content, so a tight cap is reached mid-thought and the provider
  // returns finish=length with zero characters - which parses as not_creative and
  // silently abandons the edit. Measured: at 1200 roughly one DeepSeek call in three
  // came back empty; at 3000 none did.
  assert(
    seen[0].overrides.maxTokens >= 3_000,
    `the extraction budget must leave room for reasoning tokens, got ${seen[0].overrides.maxTokens}`,
  );

  // The caller's deadline has to reach the provider, or the call falls back to the
  // adapter's general 30s and holds the turn.
  assert.equal(seen[0].signal, spySignal, 'the abort signal must be passed through to the provider');

  // Only the sections that exist are sent. Six empty slots taught the model that a
  // picture is supposed to have six of them, and cost payload on every call.
  const sentPayload = JSON.parse(seen[0].messages[seen[0].messages.length - 1].content);
  assert.deepEqual(
    Object.keys(sentPayload.currentSections).sort(),
    [...PORTRAIT_SECTIONS].sort(),
    'empty sections must not be sent as null placeholders',
  );
  assert(!Object.values(sentPayload.currentSections).includes(null));
  assert.equal(sentPayload.message, '把场景换成书店');
}

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

const modelFullSpec = { kind: 'full_spec', gaps: [], plannedExtensions: [], source: 'model' };
const localFullSpec = { kind: 'full_spec', gaps: [], plannedExtensions: [], source: 'local' };

// Replacing a description that already exists is worth a sentence first.
assert.equal(needsCreativeConfirmation(modelFullSpec, { hasExistingContent: true }), true);
assert.equal(needsCreativeConfirmation(localFullSpec, { hasExistingContent: true }), true);
// A first request into an empty window gets a picture, not an interview - but a
// model's reading of free-form prose is still an interpretation worth checking.
assert.equal(needsCreativeConfirmation(localFullSpec, { hasExistingContent: false }), false);
assert.equal(needsCreativeConfirmation(modelFullSpec, { hasExistingContent: false }), true);
assert.equal(needsCreativeConfirmation(localFullSpec), false, 'context defaults to an empty window');
// A real gap is always worth asking about, whoever found it.
assert.equal(needsCreativeConfirmation({ kind: 'edit', gaps: ['光线方向'], plannedExtensions: [], source: 'model' }), true);
assert.equal(needsCreativeConfirmation({ kind: 'edit', gaps: [], plannedExtensions: ['镜头'], source: 'model' }, { hasExistingContent: true }), false);
assert.equal(needsCreativeConfirmation({ kind: 'not_creative', gaps: ['x'], plannedExtensions: [], source: 'model' }, { hasExistingContent: true }), false);

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

verifyExtractorRequest()
  .then(() => {
    console.log(`ATHENA_CREATIVE_STATE_OK sections=${CREATIVE_SECTIONS.length}/optional locked=${DEFAULT_LOCKED_SECTIONS.join('+')}/when-written brief=read-locally budget=reasoning-safe`);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
