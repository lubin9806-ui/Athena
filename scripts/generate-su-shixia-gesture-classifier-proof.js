const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-gesture-classifier-proof.json');

const CASES = [
  { id: 'tap-face', zoneId: 'face_cheek', gesture: 'tap', mode: 'chat_right', moves: [], downAt: 100, upAt: 180 },
  { id: 'repeat-tap-hair-clip', zoneId: 'hair_clip', gesture: 'repeat_tap', mode: 'chat_right', preTap: true, moves: [], downAt: 420, upAt: 500 },
  { id: 'long-press-hand', zoneId: 'left_hand', gesture: 'long_press', mode: 'chat_right', moves: [], downAt: 1000, upAt: 1720 },
  { id: 'stroke-skirt', zoneId: 'skirt_front', gesture: 'stroke', mode: 'chat_right', moves: [{ dx: 14, dy: 4, at: 2250 }, { dx: 28, dy: 7, at: 2310 }], downAt: 2200, upAt: 2380 },
  { id: 'drag-waist', zoneId: 'waist', gesture: 'drag', mode: 'desktop_pet', moves: [{ dx: 18, dy: 10, at: 3050 }, { dx: 32, dy: 18, at: 3120 }], downAt: 3000, upAt: 3200 },
];

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
    this.captures = new Set();
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
  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }
  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }
  hasPointerCapture(pointerId) {
    return this.captures.has(pointerId);
  }
  remove() {}
  async dispatchPointer(type, point, timeStamp) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ pointerId: 1, clientX: point.x, clientY: point.y, timeStamp });
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
    buildHotZoneReplyPrompt,
    findAthenaReplyPrompt,
  } = require('../dist/renderer/avatar');
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));

  const results = [];
  for (const testCase of CASES) {
    const canvas = new FakeCanvas();
    const host = new FakeLive2DHost();
    const callbacks = [];
    const events = [];
    const testProfile = JSON.parse(JSON.stringify(profile));
    testProfile.layout.mode = testCase.mode;
    testProfile.layout.lockPosition = testCase.mode !== 'desktop_pet';
    testProfile.model.rootPath = PACKAGE_ROOT;
    const zone = testProfile.hotZones.find(item => item.id === testCase.zoneId);
    assert.ok(zone, `missing hot zone ${testCase.zoneId}`);
    const controller = new Live2DCanvasController({
      profile: testProfile,
      host,
      canvas,
      now: () => '2026-08-24T00:00:00.000Z',
      onEvent: event => events.push(event),
      onHotZoneAction: (action, hotZoneId, gestureType) => callbacks.push({ action, hotZoneId, gestureType }),
    });
    await controller.load();

    if (testCase.preTap) {
      host.nextHitAreas = zone.hitAreaName ? [zone.hitAreaName] : [];
      const prePoint = centerOf(zone.rect, canvas);
      await canvas.dispatchPointer('pointerdown', prePoint, testCase.downAt - 260);
      await canvas.dispatchPointer('pointerup', prePoint, testCase.downAt - 190);
      await waitForAsyncHandlers();
    }

    const beforeCase = host.calls.length;
    host.nextHitAreas = zone.hitAreaName ? [zone.hitAreaName] : [];
    const startPoint = centerOf(zone.rect, canvas);
    await canvas.dispatchPointer('pointerdown', startPoint, testCase.downAt);
    for (const move of testCase.moves) {
      await canvas.dispatchPointer('pointermove', { x: startPoint.x + move.dx, y: startPoint.y + move.dy }, move.at);
    }
    const finalMove = testCase.moves[testCase.moves.length - 1];
    const upPoint = finalMove ? { x: startPoint.x + finalMove.dx, y: startPoint.y + finalMove.dy } : startPoint;
    await canvas.dispatchPointer('pointerup', upPoint, testCase.upAt);
    await waitForAsyncHandlers();

    const callback = callbacks.findLast(item => item.hotZoneId === testCase.zoneId);
    assert.ok(callback, `missing callback for ${testCase.id}`);
    const promptTemplate = findAthenaReplyPrompt(callback.action);
    const replyPrompt = buildHotZoneReplyPrompt(promptTemplate, zone, testProfile.interactionPolicy, 'normal', callback.gestureType) ?? '';
    const caseCalls = host.calls.slice(beforeCase).filter(call => call.type === 'motion' || call.type === 'expression' || call.type === 'pointer');
    results.push({
      id: testCase.id,
      zoneId: testCase.zoneId,
      expectedGesture: testCase.gesture,
      actualGesture: callback.gestureType,
      layoutMode: testCase.mode,
      bodyPart: zone.interaction?.bodyPart,
      sensitivity: zone.interaction?.sensitivity,
      motionGroup: caseCalls.find(call => call.type === 'motion')?.motionGroup ?? null,
      expressionId: caseCalls.find(call => call.type === 'expression')?.expressionId ?? null,
      promptIncludesGesture: replyPrompt.includes('触碰方式：'),
      promptIncludesBoundary: replyPrompt.includes('运行时互动边界'),
      pointerMoveObserved: caseCalls.some(call => call.type === 'pointer'),
    });
    await controller.destroy();
  }

  const checks = [
    check('all-gestures-covered', ['tap', 'repeat_tap', 'long_press', 'stroke', 'drag'].every(gesture => results.some(item => item.actualGesture === gesture))),
    check('all-gestures-match-expected', results.every(item => item.expectedGesture === item.actualGesture)),
    check('all-cases-play-motion', results.every(item => item.motionGroup)),
    check('all-cases-set-expression', results.every(item => item.expressionId)),
    check('all-prompts-include-gesture', results.every(item => item.promptIncludesGesture)),
    check('all-prompts-include-boundary', results.every(item => item.promptIncludesBoundary)),
    check('stroke-updates-pointer', results.some(item => item.id === 'stroke-skirt' && item.pointerMoveObserved)),
    check('drag-mode-covered', results.some(item => item.id === 'drag-waist' && item.layoutMode === 'desktop_pet')),
  ];

  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: checks.every(item => item.status === 'pass') ? 'go' : 'no_go',
    runtimeModule: 'dist/renderer/avatar/live2d/Live2DCanvasController',
    promptModule: 'dist/renderer/avatar/live2d/AthenaLive2DCompanion',
    gestures: ['tap', 'repeat_tap', 'long_press', 'stroke', 'drag'],
    thresholds: {
      repeatTapMs: 450,
      longPressMs: 600,
      strokeTravelPx: 18,
      strokePathPx: 28,
      dragTravelPx: 16,
    },
    checks,
    cases: results,
    boundary: {
      provesCompiledGestureClassifier: true,
      provesPromptReceivesGestureType: true,
      provesGestureSpecificMotionSelection: false,
      proofDoesNotVerifyFinalCubismAnimationPolish: true,
      proofDoesNotEnablePrivateAssets: true,
    },
  };
  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_GESTURE_CLASSIFIER_PROOF_GENERATED gestures=${report.gestures.length} status=${report.status}`);
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
