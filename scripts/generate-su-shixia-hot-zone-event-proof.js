const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-hot-zone-event-proof.json');
const CASE_IDS = ['face_cheek', 'left_hand', 'chest', 'left_thigh', 'hair_clip'];

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...values) {
    values.forEach(value => this.values.add(value));
  }
}

class FakeStyle {
  constructor() {
    this.values = {};
  }
  setProperty(name, value) {
    this.values[name] = value;
  }
}

class FakeCanvas {
  constructor() {
    this.width = 1000;
    this.height = 2000;
    this.clientWidth = 1000;
    this.clientHeight = 2000;
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== handler));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  remove() {}
  async dispatchPointerDown(point) {
    for (const handler of this.listeners.get('pointerdown') ?? []) {
      handler({ pointerId: 1, clientX: point.x, clientY: point.y });
    }
    await waitForAsyncHandlers();
  }
}

class FakeLive2DHost {
  constructor() {
    this.calls = [];
    this.nextHitAreas = [];
  }
  async load(options) {
    this.calls.push({ type: 'load', options });
  }
  async unload() {
    this.calls.push({ type: 'unload' });
  }
  async setExpression(expressionId, intensity) {
    this.calls.push({ type: 'expression', expressionId, intensity });
  }
  async playMotion(mapping) {
    this.calls.push({ type: 'motion', motionGroup: mapping.motionGroup, motionId: mapping.motionId });
  }
  async setParameter(parameterId, value) {
    this.calls.push({ type: 'parameter', parameterId, value });
  }
  async updatePointer(point) {
    this.calls.push({ type: 'pointer', point });
  }
  hitTestCanvasPoint() {
    this.calls.push({ type: 'hitTest', hitAreas: [...this.nextHitAreas] });
    return this.nextHitAreas;
  }
}

async function main() {
  const {
    Live2DCanvasController,
    findAthenaReplyPrompt,
    buildHotZoneReplyPrompt,
  } = require('../dist/renderer/avatar');
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  profile.layout.mode = 'chat_right';
  profile.layout.lockPosition = true;
  profile.model.rootPath = PACKAGE_ROOT;

  const canvas = new FakeCanvas();
  const host = new FakeLive2DHost();
  const callbacks = [];
  const events = [];
  const controller = new Live2DCanvasController({
    profile,
    host,
    canvas,
    now: () => '2026-08-24T00:00:00.000Z',
    onEvent: event => events.push(event),
    onHotZoneAction: (action, hotZoneId) => callbacks.push({ action, hotZoneId }),
  });
  await controller.load();

  const cases = [];
  for (const id of CASE_IDS) {
    const zone = profile.hotZones.find(item => item.id === id);
    assert.ok(zone, `missing hot zone ${id}`);
    const before = host.calls.length;
    host.nextHitAreas = zone.hitAreaName ? [zone.hitAreaName] : [];
    await canvas.dispatchPointerDown(centerOf(zone.rect, canvas));
    const afterCalls = host.calls.slice(before);
    const callback = callbacks.findLast(item => item.hotZoneId === id);
    assert.ok(callback, `missing callback for ${id}`);
    const promptTemplate = findAthenaReplyPrompt(callback.action);
    const normalPrompt = buildHotZoneReplyPrompt(promptTemplate, zone, profile.interactionPolicy, 'normal') ?? '';
    const privatePrompt = buildHotZoneReplyPrompt(promptTemplate, zone, profile.interactionPolicy, 'private_opt_in') ?? '';
    cases.push({
      id,
      hitAreaName: zone.hitAreaName,
      bodyPart: zone.interaction?.bodyPart,
      sensitivity: zone.interaction?.sensitivity,
      pointer: centerOf(zone.rect, canvas),
      callbackReceived: true,
      motionGroup: afterCalls.find(call => call.type === 'motion')?.motionGroup ?? null,
      expressionId: afterCalls.find(call => call.type === 'expression')?.expressionId ?? null,
      hitTestAreas: afterCalls.find(call => call.type === 'hitTest')?.hitAreas ?? [],
      promptTemplatePresent: Boolean(promptTemplate),
      normalModePromptBoundary: normalPrompt.includes('当前模式：normal'),
      privateAttemptMode: privatePrompt.includes('当前模式：private_opt_in') ? 'private_opt_in' : 'normal',
    });
  }

  await controller.destroy();

  const checks = [
    check('controller-loaded-profile', host.calls.some(call => call.type === 'load')),
    check('representative-zone-count', cases.length === CASE_IDS.length),
    check('all-cases-hit-tested', cases.every(item => item.hitTestAreas.includes(item.hitAreaName))),
    check('all-cases-callback-received', cases.every(item => item.callbackReceived)),
    check('all-cases-play-motion', cases.every(item => item.motionGroup)),
    check('all-cases-set-expression', cases.every(item => item.expressionId)),
    check('all-cases-have-prompt-template', cases.every(item => item.promptTemplatePresent)),
    check('normal-mode-boundary-generated', cases.every(item => item.normalModePromptBoundary)),
    check('private-zone-private-attempt-covered', cases.some(item => item.id === 'chest' && item.privateAttemptMode === 'private_opt_in')),
    check('controller-unloaded', host.calls.some(call => call.type === 'unload')),
  ];

  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: checks.every(item => item.status === 'pass') ? 'go' : 'no_go',
    runtimeModule: 'dist/renderer/avatar/live2d/Live2DCanvasController',
    coverage: {
      representativeZones: CASE_IDS,
      callbackCount: callbacks.length,
      runtimeEvents: events.map(event => event.type),
      motionGroups: cases.map(item => item.motionGroup).filter(Boolean),
      expressions: cases.map(item => item.expressionId).filter(Boolean),
    },
    checks,
    cases,
    boundary: {
      provesCanvasPointerToHotZoneAction: true,
      provesPersonaReplyCallback: true,
      provesCompiledControllerPath: true,
      proofDoesNotVerifyRealCubismMoc3: true,
      proofDoesNotVerifyBrowserPixelRendering: true,
    },
  };
  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_HOT_ZONE_EVENT_PROOF_GENERATED cases=${cases.length} status=${report.status}`);
}

function centerOf(rect, canvas) {
  return {
    x: (rect.x + rect.width / 2) * canvas.clientWidth,
    y: (rect.y + rect.height / 2) * canvas.clientHeight,
  };
}

function check(id, passed, detail = '') {
  return { id, status: passed ? 'pass' : 'fail', detail };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function waitForAsyncHandlers() {
  return new Promise(resolve => setImmediate(resolve));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
