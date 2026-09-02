const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'scripts', 'fixtures', 'agent-routing-cases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { AgentMessageRouter } = require(path.join(root, 'dist', 'core', 'routing', 'index.js'));

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
assert.match(ipc, /const routing = await controller\.routeMessage/);
assert.match(ipc, /forceWebSearch \|\| routing\.route === 'web_research'/);
assert.match(preload, /routeMessage:.*ipcRenderer\.invoke\('chat:route'/);
assert.match(renderer, /routing\?\.route === 'durable_execution'.*selectMode\('execute'\)/s);

console.log(`ATHENA_AGENT_ROUTING_OK cases=${fixture.cases.length} accuracy=${accuracy.toFixed(3)} safetyFalsePositives=${safetyFalsePositives} recall=${routes.map(route => `${route}:${recalls[route].toFixed(3)}`).join(',')}`);
