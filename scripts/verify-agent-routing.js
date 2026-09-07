const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'scripts', 'fixtures', 'agent-routing-cases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { AgentMessageRouter } = require(path.join(root, 'dist', 'core', 'routing', 'index.js'));
const { resolveDirectImageGenerationIntent } = require(path.join(root, 'dist', 'core', 'artifacts', 'index.js'));

assert.equal(fixture.schemaVersion, 1);
assert(Array.isArray(fixture.cases));
assert(fixture.cases.length >= fixture.thresholds.minimumCases);
assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length, 'routing case ids must be unique');

const router = new AgentMessageRouter();
const routes = ['conversation', 'web_research', 'durable_execution'];
const matrix = Object.fromEntries(routes.map(expected => [expected, Object.fromEntries(routes.map(actual => [actual, 0]))]));
let correct = 0;
let safetyFalsePositives = 0;
const failures = [];

for (const testCase of fixture.cases) {
  const input = {
    message: testCase.message,
    mode: testCase.mode,
    forceWebSearch: testCase.forceWebSearch === true,
    webSearchEnabled: testCase.webSearchEnabled !== false,
    canStartDurableExecution: testCase.canExecute !== false,
    recentMessages: testCase.history || [],
  };
  const frozenInput = JSON.stringify(input);
  const first = router.route(input);
  const second = router.route(input);
  assert.deepEqual(second, first, `${testCase.id} must route deterministically`);
  assert.equal(JSON.stringify(input), frozenInput, `${testCase.id} mutated its input`);
  assert(routes.includes(first.route), `${testCase.id} returned an unknown route`);
  matrix[testCase.expected][first.route] += 1;
  if (first.route === testCase.expected && (!testCase.reason || first.reason === testCase.reason)) correct += 1;
  else failures.push({ id: testCase.id, expected: testCase.expected, expectedReason: testCase.reason, actual: first });
  if (testCase.safety && testCase.expected !== 'durable_execution' && first.route === 'durable_execution') safetyFalsePositives += 1;
  if (first.route === 'web_research') assert(first.query && first.query.length > 0, `${testCase.id} must carry a search query`);
  if (first.route === 'durable_execution') assert.equal(first.effectiveMode, 'execute');
}

for (const mode of ['create', 'companion', 'reason', 'execute']) {
  const imageRoute = router.route({
    message: '请直接生成一张横版的星空城市概念图',
    mode,
    webSearchEnabled: true,
    canStartDurableExecution: true,
  });
  assert.equal(imageRoute.route, 'image_generation', `${mode} should generate images without switching modes`);
  assert.equal(imageRoute.effectiveMode, mode);
  assert.equal(imageRoute.autoSwitch, false);
}
assert.equal(router.route({
  message: '请分析一下本地生图接口的设计方案，不要执行',
  mode: 'reason',
  webSearchEnabled: true,
  canStartDurableExecution: true,
}).route, 'conversation');

const detailedImagePrompt = 'Afternoon light in a small bathroom, soft steam, reflective glass, natural composition.生图';
assert.equal(router.route({
  message: detailedImagePrompt,
  mode: 'companion',
  webSearchEnabled: true,
  canStartDurableExecution: true,
}).route, 'image_generation', 'ASCII punctuation before 生图 must still enter direct image generation');
assert.equal(resolveDirectImageGenerationIntent(detailedImagePrompt).prompt.endsWith('生图'), false, 'execution suffix must not be sent to the image model');

const regenerationHistory = [
  { role: 'user', content: detailedImagePrompt },
  { role: 'assistant', content: '已生成图片。' },
  { role: 'user', content: '生成图片' },
  { role: 'assistant', content: '已生成另一张图片。' },
];
const regenerated = resolveDirectImageGenerationIntent('重新生成', regenerationHistory);
assert(regenerated, 'regeneration must resolve a prior descriptive image prompt');
assert.equal(regenerated.prompt, 'Afternoon light in a small bathroom, soft steam, reflective glass, natural composition.');
assert.equal(router.route({
  message: '重新生成',
  mode: 'companion',
  webSearchEnabled: true,
  canStartDurableExecution: true,
  recentMessages: regenerationHistory,
}).route, 'image_generation', 'regeneration with image context must re-enter direct image generation');
assert.equal(router.route({
  message: '重新生成',
  mode: 'companion',
  webSearchEnabled: true,
  canStartDurableExecution: true,
  recentMessages: [],
}).route, 'conversation', 'regeneration without image context must not invent an image prompt');

// ATH-IMG-002: a bare command carries no subject. Sending it to the engine as the
// prompt produced a confidently unrelated picture, which is worse than asking.
assert.equal(resolveDirectImageGenerationIntent('生成图片'), null, 'a bare image command must not become its own prompt');
assert.equal(resolveDirectImageGenerationIntent('生成图片', [
  { role: 'user', content: '帮我看看这个报错的堆栈是什么意思' },
  { role: 'assistant', content: '这是一个空指针异常。' },
]), null, 'an unrelated prior message must not be drafted as an image prompt');

// ATH-CHAT-001: a long visual brief accidentally carries every soft trigger -
// "将" as a preposition, "桌面" meaning a tabletop, "刚刚" describing a pose, and
// "list" inside "realistic". None of that is a computer action or a search.
const visualBrief = [
  '角色五官：24岁现代东亚年轻女性，鹅蛋脸，面部轮廓柔和流畅，杏仁形深棕色眼眸，自然窄双眼皮，眼神安静克制，皮肤白皙偏暖，真实细腻肌理。',
  '服装描写：将原来的灰紫色针织上衣改为低饱和燕麦米色修身针织开衫，内搭同色系简洁方领吊带，垂坠面料，腰部结构简洁，无明显品牌标识。',
  '环境背景：场景由咖啡馆改为现代城市独立书店内的临窗阅读区，深胡桃木书架、暖灰色微水泥墙面、原木桌椅、少量绿植和陶瓷摆件。',
  '桌面放置一本翻开的摄影集、一杯白色陶瓷拿铁和一副细框眼镜，避免蛋糕与原图桌面陈设。',
  '角色 Pose：她侧身坐在靠窗的木质扶手椅上，右手握住白色咖啡杯杯耳，杯子刚刚离开桌面，视线落向窗外而不是镜头。',
  '画面关键词：cinematic lifestyle portrait, Rembrandt lighting, natural skin texture, realistic pores, photorealistic, 8K detail.',
].join('\n');
assert(visualBrief.length > 400, 'the regression brief must stay long enough to exercise the long-text path');
for (const mode of ['companion', 'create', 'reason']) {
  assert.equal(router.route({
    message: visualBrief,
    mode,
    webSearchEnabled: true,
    canStartDurableExecution: true,
  }).route, 'conversation', `a long visual brief must stay conversational in ${mode} mode`);
}

// ATH-PERF-001: the preflight is a model round trip ahead of the reply, measured at
// several seconds even for a short message, so it must be possible to turn off
// without changing what the rules decide.
async function verifySemanticRoutingIsOptional() {
  let classifierCalls = 0;
  const countingRouter = new AgentMessageRouter({
    semanticClassifier: {
      classify: async () => {
        classifierCalls += 1;
        return { route: 'durable_execution', confidence: 'high', explicitActionConsent: true, referencesPriorContext: false, query: '' };
      },
    },
  });
  const ambiguous = {
    message: '这个配色我还在犹豫，你怎么看',
    mode: 'companion',
    webSearchEnabled: true,
    canStartDurableExecution: true,
  };
  const withReview = await countingRouter.routeAdaptive({ ...ambiguous });
  assert.equal(classifierCalls, 1, 'the classifier runs when semantic routing is allowed');
  assert.equal(withReview.routingMethod, 'model');

  countingRouter.clearCache();
  classifierCalls = 0;
  const withoutReview = await countingRouter.routeAdaptive({ ...ambiguous, semanticRoutingAllowed: false });
  assert.equal(classifierCalls, 0, 'disabling semantic routing must skip the model call entirely');
  assert.equal(withoutReview.routingMethod, 'rules');
  assert.equal(withoutReview.route, 'conversation', 'the rules decision stands on its own');
}

const accuracy = correct / fixture.cases.length;
const recalls = Object.fromEntries(routes.map(route => {
  const total = routes.reduce((sum, actual) => sum + matrix[route][actual], 0);
  return [route, total === 0 ? 1 : matrix[route][route] / total];
}));

assert.equal(failures.length, 0, `routing failures:\n${JSON.stringify(failures, null, 2)}`);
assert(accuracy >= fixture.thresholds.overallAccuracy, `routing accuracy ${accuracy} is below threshold`);
for (const [route, recall] of Object.entries(recalls)) {
  assert(recall >= fixture.thresholds.perRouteRecall, `${route} recall ${recall} is below threshold`);
}
assert(safetyFalsePositives <= fixture.thresholds.maximumSafetyFalsePositives, 'discussion-only prompts must never auto-execute');

const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'app', 'preload.ts'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
assert.match(ipc, /ipcMain\.handle\('chat:route'.*isTrustedSender/s);
assert.match(ipc, /const routing = await controller\.consumeRouteMessage/);
assert.match(ipc, /forceWebSearch \|\| routing\.route === 'web_research'/);
assert.match(preload, /routeMessage:.*ipcRenderer\.invoke\('chat:route'/);
assert.match(preload, /sendMessage:.*routingTicket.*ipcRenderer\.invoke\('chat:send'.*routingTicket/s);
assert.match(renderer, /routing\?\.route === 'durable_execution'.*selectMode\('execute'\)/s);
assert.match(renderer, /routingTicket = routing\?\.routingTicket/);
assert.match(ipc, /routingStage:\s*\{\s*durationMs: routing\.routingDurationMs \?\? 0,\s*outcome: routing\.routingMethod/s);

// ATH-PERF-001: the preflight is a model round trip ahead of the reply, measured at
// several seconds even for a short message, so it must be possible to turn off
// without changing what the rules decide.
verifySemanticRoutingIsOptional()
  .then(() => {
    assert.match(
      fs.readFileSync(path.join(root, 'src', 'core', 'controller', 'AthenaController.ts'), 'utf8'),
      /semanticRoutingAllowed:\s*settings\.conversation\.semanticRouting/,
      'the controller must gate the preflight on the setting',
    );
    console.log(`ATHENA_AGENT_ROUTING_OK cases=${fixture.cases.length} accuracy=${accuracy.toFixed(3)} safetyFalsePositives=${safetyFalsePositives} recall=${routes.map(route => `${route}:${recalls[route].toFixed(3)}`).join(',')} semanticPreflight=opt-in`);
  })
  .catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
