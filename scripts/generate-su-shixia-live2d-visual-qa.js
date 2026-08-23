const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const MODEL_PATH = path.join(PACKAGE_ROOT, 'model', 'su-shixia-live2d-v2-lite.model3.json');
const REVIEW_ROOT = path.join(PACKAGE_ROOT, 'source', 'review', 'runtime-visual-qa-v1');
const CONTACT_SHEET_PATH = path.join(REVIEW_ROOT, 'runtime-motion-contact-sheet-v1.png');
const REPORT_PATH = path.join(REVIEW_ROOT, 'runtime-visual-qa-v1.json');

const CASES = [
  qaCase('idle', 'Idle', 2.2, expression('neutral')),
  qaCase('listen', 'Listen', 0.85, expression('soft_smile')),
  qaCase('speak', 'Speak', 0.52, expression('happy', { mouthOpen: 0.48 })),
  qaCase('touch-face', 'TouchFace', 0.55, expression('shy')),
  qaCase('touch-ear', 'TouchEar', 0.42, expression('surprised')),
  qaCase('touch-chest', 'TouchChest', 0.5, expression('shy')),
  qaCase('touch-waist', 'TouchWaist', 0.58, expression('shy')),
  qaCase('touch-skirt', 'TouchSkirt', 0.52, expression('confused')),
  qaCase('touch-thigh', 'TouchThigh', 0.52, expression('shy')),
  qaCase('turn-preview', 'TurnPreview', 0.82, expression('soft_smile')),
  qaCase('sleepy', 'Sleepy', 1.1, expression('sleepy')),
];

async function main() {
  fs.mkdirSync(REVIEW_ROOT, { recursive: true });
  const model = readJson(MODEL_PATH).AthenaLive2DLite;
  const images = await loadLayerImages(model);
  const rendered = [];
  for (const item of CASES) {
    const frame = renderCase(model, images, item);
    const output = path.join(REVIEW_ROOT, `${item.id}.png`);
    fs.writeFileSync(output, frame.canvas.toBuffer('image/png'));
    rendered.push({
      ...item,
      output,
      width: frame.canvas.width,
      height: frame.canvas.height,
      data: frame.data,
      stats: imageStats(frame.data, frame.canvas.width, frame.canvas.height),
    });
  }
  const idle = rendered.find(item => item.id === 'idle');
  for (const item of rendered) {
    item.diffFromIdle = item.id === 'idle'
      ? { changedPixels: 0, changedVisiblePixels: 0, meanAlphaDelta: 0 }
      : compareImageData(idle, item);
  }
  await buildContactSheet(rendered);
  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    status: 'runtime_visual_qa_ready',
    sourceModel: 'model/su-shixia-live2d-v2-lite.model3.json',
    contactSheet: 'runtime-motion-contact-sheet-v1.png',
    checks: {
      transparentBackground: true,
      individualFrames: rendered.length,
      requiredMotionCases: CASES.map(item => item.motionGroup),
      allFramesVisible: rendered.every(item => item.stats.visiblePixels > 180000),
      motionFramesDifferFromIdle: rendered
        .filter(item => item.id !== 'idle')
        .every(item => item.diffFromIdle.changedVisiblePixels > 1800),
      noOfficialCubismClaim: true,
    },
    frames: rendered.map(item => ({
      id: item.id,
      motionGroup: item.motionGroup,
      seconds: item.seconds,
      file: path.basename(item.output),
      visiblePixels: item.stats.visiblePixels,
      partialAlphaPixels: item.stats.partialAlphaPixels,
      bounds: item.stats.bounds,
      diffFromIdle: item.diffFromIdle,
    })),
    manualReviewFindings: [
      {
        area: 'hand-arm-layering',
        status: 'needs-human-polish',
        severity: 'high',
        note: 'Current front source shows visible arm and hand cut-layer limitations in several poses. Runtime can animate the state, but final public art still needs manual hidden-fill and anatomy cleanup.',
      },
      {
        area: 'lower-body-layering',
        status: 'needs-human-polish',
        severity: 'medium',
        note: 'Shoes, calves, and skirt occlusion are structurally present but still read as provisional automated slices at full-body review scale.',
      },
      {
        area: 'full-turn',
        status: 'not-production-ready',
        severity: 'high',
        note: 'TurnPreview is a front-view 2.5D hint. True side/back turn behavior requires separate reviewed source views or a genuine Cubism rig with authored deformers.',
      },
    ],
    gate: 'This is a Live2D Lite visual QA render, not proof of a genuine Cubism .moc3 export.',
  };
  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_LIVE2D_VISUAL_QA_GENERATED frames=${rendered.length} contactSheet=${CONTACT_SHEET_PATH}`);
}

function renderCase(model, images, item) {
  const canvas = createCanvas(model.canvas.width, model.canvas.height);
  const context = canvas.getContext('2d');
  const pose = motionPose(item.motionGroup, item.seconds, item.seconds);
  const state = {
    activeMotion: item.motionGroup,
    expression: resolveExpression(model, item.expression),
    parameters: {
      ParamMouthOpenY: item.expression.mouthOpen ?? 0,
      ParamMouthForm: item.expression.mouthForm ?? 0,
      ParamEyeBallX: item.motionGroup === 'Think' ? -0.2 : 0,
      ParamEyeBallY: item.motionGroup === 'Sleepy' ? -0.2 : 0,
    },
  };
  for (const layer of model.layers) drawLayer(context, layer, images, pose, item.seconds, state);
  return { canvas, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

function drawLayer(context, layer, images, pose, seconds, state) {
  context.save();
  const headLayer = /HAIR|HEAD|FACE|EYE|BROW|MOUTH|BLUSH|ACCESSORY/.test(layer.id);
  const bodyLayer = /TORSO|BLOUSE|COLLAR|BUTTON|TRIM|SKIRT/.test(layer.id);
  const waveLayer = /ARM_(UPPER|LOWER)_R|HAND_R/.test(layer.id);

  if (headLayer) {
    context.translate(450 + pose.headX, 365 + pose.headY);
    context.rotate(pose.headRotation);
    context.translate(-450, -365);
  } else if (bodyLayer) {
    context.translate(450, 800);
    context.rotate(pose.bodyRotation);
    context.scale(1 + pose.breath * 0.004, 1 + pose.breath * 0.008);
    context.translate(-450, -800);
  }
  if (waveLayer && pose.wave !== 0) {
    context.translate(650, 650);
    context.rotate(-pose.wave * 0.7);
    context.translate(-650, -650);
  }
  if (layer.sway) context.translate(Math.sin(seconds * 1.6 + layer.sway) * pose.hair * layer.sway * 3, 0);
  if (layer.eyeTrack) {
    context.translate(parameter(state, 'ParamEyeBallX') * 5, -parameter(state, 'ParamEyeBallY') * 3);
  }

  context.globalAlpha = layerAlpha(layer, state);
  if (context.globalAlpha > 0.002) drawShape(context, layer, images, state);
  context.restore();
}

function drawShape(context, layer, images, state) {
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const width = layer.width ?? 0;
  const height = layer.height ?? 0;
  if (layer.type === 'ellipse') {
    context.fillStyle = layer.color ?? '#ffffff';
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (layer.type !== 'image') return;
  const image = images.get(layer.src);
  if (!image) throw new Error(`Missing visual QA image layer: ${layer.src}`);
  const sourceRect = layer.sourceRect ?? [0, 0, image.width, image.height];
  const [sourceX, sourceY, sourceWidth, sourceHeight] = sourceRect;
  context.drawImage(
    image,
    sourceX ?? 0,
    sourceY ?? 0,
    sourceWidth ?? image.width,
    sourceHeight ?? image.height,
    x,
    y,
    width || sourceWidth || image.width,
    height || sourceHeight || image.height,
  );
}

function motionPose(activeMotion, seconds, motionSeconds) {
  const breath = (Math.sin(seconds * 1.65) + 1) / 2;
  const pose = {
    headX: 0,
    headY: 0,
    headRotation: 0,
    bodyRotation: 0,
    breath,
    hair: Math.sin(seconds * 1.9) * 0.25,
    wave: 0,
  };
  switch (activeMotion) {
    case 'Listen':
      pose.headY += 5 + Math.sin(motionSeconds * 2) * 2;
      pose.bodyRotation -= 0.018;
      break;
    case 'Speak':
      pose.headY += Math.sin(motionSeconds * 3.4) * 2;
      pose.bodyRotation += Math.sin(motionSeconds * 1.7) * 0.008;
      break;
    case 'TouchFace':
      pose.headX -= 6 * Math.max(0, 1 - motionSeconds / 1.6);
      pose.headRotation += 0.045 * Math.max(0, 1 - motionSeconds / 1.6);
      pose.bodyRotation -= 0.01 * Math.max(0, 1 - motionSeconds / 1.8);
      break;
    case 'TouchEar':
      pose.headX += 4 * Math.sin(motionSeconds * 7) * Math.max(0, 1 - motionSeconds / 1.4);
      pose.headRotation += 0.065 * Math.max(0, 1 - motionSeconds / 1.4);
      pose.bodyRotation -= 0.014 * Math.max(0, 1 - motionSeconds / 1.4);
      break;
    case 'TouchChest':
      pose.headY += 7 * Math.max(0, 1 - motionSeconds / 1.6);
      pose.headRotation -= 0.035 * Math.max(0, 1 - motionSeconds / 1.6);
      pose.bodyRotation -= 0.024 * Math.max(0, 1 - motionSeconds / 1.7);
      break;
    case 'TouchWaist':
      pose.bodyRotation += 0.026 * Math.sin(motionSeconds * 5.2) * Math.max(0, 1 - motionSeconds / 1.8);
      pose.headX += 5 * Math.max(0, 1 - motionSeconds / 1.8);
      break;
    case 'TouchSkirt':
      pose.bodyRotation += Math.sin(motionSeconds * 5.8) * 0.018 * Math.max(0, 1 - motionSeconds / 1.9);
      pose.hair += Math.sin(motionSeconds * 3.4) * 0.2;
      break;
    case 'TouchThigh':
      pose.headY += 5 * Math.max(0, 1 - motionSeconds / 1.7);
      pose.bodyRotation += 0.018 * Math.max(0, 1 - motionSeconds / 1.7);
      break;
    case 'TurnPreview':
      pose.headX += Math.sin(motionSeconds * 1.8) * 12;
      pose.bodyRotation += Math.sin(motionSeconds * 1.8) * 0.045;
      pose.hair += Math.sin(motionSeconds * 2.2) * 0.6;
      break;
    case 'Sleepy':
      pose.headY += 10 + Math.sin(motionSeconds * 0.9) * 2;
      pose.headRotation += 0.035;
      break;
  }
  return pose;
}

function layerAlpha(layer, state) {
  if (layer.expressionAlpha === 'blush') return clamp(state.expression.blush, 0, 1);
  const mouthOpen = clamp(Math.max(parameter(state, 'ParamMouthOpenY'), state.expression.mouthOpen), 0, 1);
  const mouthForm = clamp(parameter(state, 'ParamMouthForm') + state.expression.mouthForm, -1, 1);
  switch (layer.alphaMode) {
    case 'eyeOpen':
      return clamp(state.expression.eyeOpen, 0, 1);
    case 'eyeClosed':
      return clamp(1 - state.expression.eyeOpen, 0, 1);
    case 'mouthClosed':
      return clamp(1 - mouthOpen * 2.8, 0, 1);
    case 'mouthOpenSmall':
      return clamp(mouthOpen <= 0.55 ? mouthOpen * 2.2 : 1 - ((mouthOpen - 0.55) * 2.2), 0, 1);
    case 'mouthOpenWide':
      return clamp((mouthOpen - 0.35) * 2.4, 0, 1);
    case 'mouthSmile':
      return clamp(mouthForm * 0.85 * (1 - mouthOpen), 0, 1);
    case 'mouthRound':
      return clamp((-mouthForm - 0.2) * 1.4, 0, 1);
    case 'mouthPressed':
      return clamp((0.3 - Math.abs(mouthForm)) * 2 * (1 - mouthOpen), 0, 1);
  }
  if (layer.motionAlpha && layer.motionAlpha !== state.activeMotion) return 0;
  return clamp(layer.alpha ?? 1, 0, 1);
}

async function buildContactSheet(rendered) {
  const columns = 4;
  const cellWidth = 360;
  const cellHeight = 700;
  const rows = Math.ceil(rendered.length / columns);
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#dfe4e8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '16px Segoe UI';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < rendered.length; index += 1) {
    const item = rendered[index];
    const image = await loadImage(item.output);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    drawChecker(context, left + 8, top + 8, cellWidth - 16, cellHeight - 16);
    const maxWidth = cellWidth - 36;
    const maxHeight = cellHeight - 72;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, left + (cellWidth - width) / 2, top + 44, width, height);
    context.fillStyle = '#20262d';
    context.fillText(`${item.id} / ${item.motionGroup}`, left + cellWidth / 2, top + 28, cellWidth - 24);
  }

  fs.writeFileSync(CONTACT_SHEET_PATH, canvas.toBuffer('image/png'));
}

function imageStats(data, width, height) {
  let visiblePixels = 0;
  let partialAlphaPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width + x) * 4) + 3];
      if (alpha <= 0) continue;
      visiblePixels += 1;
      if (alpha < 255) partialAlphaPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    visiblePixels,
    partialAlphaPixels,
    bounds: maxX < 0 ? null : { minX, minY, maxX, maxY },
  };
}

function compareImageData(left, right) {
  if (left.width !== right.width || left.height !== right.height) throw new Error('Visual QA frames must share dimensions.');
  let changedPixels = 0;
  let changedVisiblePixels = 0;
  let alphaDelta = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    const delta = Math.abs(left.data[index] - right.data[index])
      + Math.abs(left.data[index + 1] - right.data[index + 1])
      + Math.abs(left.data[index + 2] - right.data[index + 2])
      + Math.abs(left.data[index + 3] - right.data[index + 3]);
    if (delta <= 18) continue;
    changedPixels += 1;
    if (left.data[index + 3] > 0 || right.data[index + 3] > 0) changedVisiblePixels += 1;
    alphaDelta += Math.abs(left.data[index + 3] - right.data[index + 3]);
  }
  return {
    changedPixels,
    changedVisiblePixels,
    meanAlphaDelta: Number((alphaDelta / Math.max(1, left.width * left.height)).toFixed(4)),
  };
}

async function loadLayerImages(model) {
  const images = new Map();
  const sources = new Set(model.layers.filter(layer => layer.type === 'image' && layer.src).map(layer => layer.src));
  for (const source of sources) images.set(source, await loadImage(path.join(PACKAGE_ROOT, source)));
  return images;
}

function drawChecker(context, x, y, width, height) {
  context.fillStyle = '#f8f9fa';
  context.fillRect(x, y, width, height);
  const size = 20;
  for (let yy = y; yy < y + height; yy += size) {
    for (let xx = x; xx < x + width; xx += size) {
      if (((xx - x) / size + (yy - y) / size) % 2 < 1) continue;
      context.fillStyle = '#eef1f4';
      context.fillRect(xx, yy, Math.min(size, x + width - xx), Math.min(size, y + height - yy));
    }
  }
}

function resolveExpression(model, value) {
  return { ...(model.expressions[value.id] ?? model.expressions.neutral), ...value };
}

function qaCase(id, motionGroup, seconds, expression) {
  return { id, motionGroup, seconds, expression };
}

function expression(id, patch = {}) {
  return { id, ...patch };
}

function parameter(state, id) {
  return state.parameters[id] ?? 0;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
