import type { AvatarMotionMapping, AvatarPoint } from '../../../shared/types/avatar';
import type { Live2DHost, Live2DHostLoadOptions } from './Live2DHost';

interface LiteParameter {
  default: number;
  min: number;
  max: number;
}

interface LiteExpression {
  mouthForm: number;
  mouthOpen: number;
  eyeOpen: number;
  blush: number;
  brow: number;
}

interface LiteHitArea {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LiteLayer {
  id: string;
  type: string;
  color?: string;
  accent?: string;
  alpha?: number;
  expressionAlpha?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  rotation?: number;
  sway?: number;
  side?: 'L' | 'R';
  gap?: number;
  count?: number;
  points?: number[][];
  lines?: number[][][];
}

interface Live2DLiteDefinition {
  schemaVersion: number;
  displayName: string;
  canvas: { width: number; height: number };
  parameters: Record<string, LiteParameter>;
  expressions: Record<string, LiteExpression>;
  motionGroups: Record<string, string[]>;
  hitAreas: LiteHitArea[];
  layers: LiteLayer[];
}

interface Live2DLiteDocument {
  Version: number;
  AthenaLive2DLite?: Live2DLiteDefinition;
}

interface ExpressionState extends LiteExpression {
  intensity: number;
}

const NEUTRAL_EXPRESSION: ExpressionState = {
  mouthForm: 0,
  mouthOpen: 0,
  eyeOpen: 1,
  blush: 0.12,
  brow: 0,
  intensity: 1,
};

export interface BrowserLive2DLiteHostOptions {
  pixelRatio?: number;
  fetchModel?: (url: string) => Promise<unknown>;
}

/**
 * Athena's dependency-free layered 2D host. It intentionally accepts only the
 * AthenaLive2DLite extension and never claims to load a Cubism moc3 binary.
 */
export class BrowserLive2DLiteHost implements Live2DHost {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private model: Live2DLiteDefinition | null = null;
  private readonly parameters = new Map<string, number>();
  private expression: ExpressionState = { ...NEUTRAL_EXPRESSION };
  private expressionTarget: ExpressionState = { ...NEUTRAL_EXPRESSION };
  private activeMotion = 'Idle';
  private motionStartedAt = 0;
  private animationFrame = 0;
  private startedAt = 0;
  private viewport = { scale: 1, offsetX: 0, offsetY: 0, cssWidth: 1, cssHeight: 1 };

  constructor(private readonly options: BrowserLive2DLiteHostOptions = {}) {}

  async load(options: Live2DHostLoadOptions): Promise<void> {
    await this.unload();
    const document = await this.loadDocument(options.modelUrl);
    const model = document.AthenaLive2DLite;
    if (!model) {
      throw new Error('This host requires an AthenaLive2DLite model. Use a Cubism Web host for moc3 packages.');
    }
    validateModel(model);

    const context = options.canvas.getContext('2d');
    if (!context) throw new Error('The Live2D Lite canvas does not provide a 2D rendering context.');

    this.canvas = options.canvas;
    this.context = context;
    this.model = model;
    this.parameters.clear();
    for (const [id, definition] of Object.entries(model.parameters)) {
      this.parameters.set(id, definition.default);
    }
    const neutral = model.expressions.neutral ?? NEUTRAL_EXPRESSION;
    this.expression = { ...neutral, intensity: 1 };
    this.expressionTarget = { ...neutral, intensity: 1 };
    this.activeMotion = 'Idle';
    this.startedAt = performance.now();
    this.motionStartedAt = this.startedAt;
    this.startLoop();
  }

  async unload(): Promise<void> {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.context?.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    this.canvas = null;
    this.context = null;
    this.model = null;
    this.parameters.clear();
  }

  async setExpression(expressionId: string, intensity: number): Promise<void> {
    const model = this.requireModel();
    const selected = model.expressions[expressionId];
    if (!selected) throw new Error(`Unknown Live2D Lite expression: ${expressionId}`);
    const neutral = model.expressions.neutral ?? NEUTRAL_EXPRESSION;
    const amount = clamp(intensity, 0, 1);
    this.expressionTarget = {
      mouthForm: mix(neutral.mouthForm, selected.mouthForm, amount),
      mouthOpen: mix(neutral.mouthOpen, selected.mouthOpen, amount),
      eyeOpen: mix(neutral.eyeOpen, selected.eyeOpen, amount),
      blush: mix(neutral.blush, selected.blush, amount),
      brow: mix(neutral.brow, selected.brow, amount),
      intensity: amount,
    };
  }

  async playMotion(mapping: AvatarMotionMapping): Promise<void> {
    const model = this.requireModel();
    const group = model.motionGroups[mapping.motionGroup]
      ? mapping.motionGroup
      : mapping.fallbackMotionGroup && model.motionGroups[mapping.fallbackMotionGroup]
        ? mapping.fallbackMotionGroup
        : 'Idle';
    this.activeMotion = group;
    this.motionStartedAt = performance.now();
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    const definition = this.requireModel().parameters[parameterId];
    if (!definition) return;
    this.parameters.set(parameterId, clamp(value, definition.min, definition.max));
  }

  async updatePointer(point: AvatarPoint): Promise<void> {
    await Promise.all([
      this.setParameter('ParamAngleX', clamp(point.x, -1, 1) * 20),
      this.setParameter('ParamAngleY', clamp(point.y, -1, 1) * -16),
      this.setParameter('ParamEyeBallX', clamp(point.x, -1, 1)),
      this.setParameter('ParamEyeBallY', clamp(point.y, -1, 1) * -1),
    ]);
  }

  hitTestCanvasPoint(point: AvatarPoint): string[] {
    const model = this.model;
    if (!model) return [];
    const x = (point.x - this.viewport.offsetX) / this.viewport.scale;
    const y = (point.y - this.viewport.offsetY) / this.viewport.scale;
    return model.hitAreas
      .filter(area => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height)
      .map(area => area.name);
  }

  private async loadDocument(url: string): Promise<Live2DLiteDocument> {
    const value = this.options.fetchModel
      ? await this.options.fetchModel(url)
      : await fetchJson(url);
    if (!isRecord(value)) throw new Error('Live2D Lite model document must be a JSON object.');
    return value as unknown as Live2DLiteDocument;
  }

  private requireModel(): Live2DLiteDefinition {
    if (!this.model) throw new Error('Live2D Lite model is not loaded.');
    return this.model;
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (!this.canvas || !this.context || !this.model) return;
      this.render(now);
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private render(now: number): void {
    const canvas = this.canvas;
    const context = this.context;
    const model = this.model;
    if (!canvas || !context || !model) return;

    this.resizeCanvas(canvas);
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = canvas.clientHeight || canvas.height;
    const scale = Math.min(cssWidth / model.canvas.width, cssHeight / model.canvas.height);
    const offsetX = (cssWidth - model.canvas.width * scale) / 2;
    const offsetY = (cssHeight - model.canvas.height * scale) / 2;
    this.viewport = { scale, offsetX, offsetY, cssWidth, cssHeight };

    const ratio = this.options.pixelRatio ?? window.devicePixelRatio ?? 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);

    const seconds = (now - this.startedAt) / 1000;
    const motionSeconds = (now - this.motionStartedAt) / 1000;
    this.updateExpression(seconds);
    const pose = this.motionPose(seconds, motionSeconds);
    for (const layer of model.layers) this.drawLayer(context, layer, pose, seconds);
    context.restore();
  }

  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const ratio = this.options.pixelRatio ?? window.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width || 320) * ratio));
    const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height || 480) * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private updateExpression(seconds: number): void {
    const blinkPhase = seconds % 4.7;
    const blink = blinkPhase > 4.48 ? Math.max(0.05, Math.abs(blinkPhase - 4.59) / 0.11) : 1;
    const ease = 0.14;
    this.expression = {
      mouthForm: mix(this.expression.mouthForm, this.expressionTarget.mouthForm, ease),
      mouthOpen: mix(this.expression.mouthOpen, this.expressionTarget.mouthOpen, ease),
      eyeOpen: mix(this.expression.eyeOpen, this.expressionTarget.eyeOpen, ease) * blink,
      blush: mix(this.expression.blush, this.expressionTarget.blush, ease),
      brow: mix(this.expression.brow, this.expressionTarget.brow, ease),
      intensity: mix(this.expression.intensity, this.expressionTarget.intensity, ease),
    };
  }

  private motionPose(seconds: number, motionSeconds: number): MotionPose {
    const breath = (Math.sin(seconds * 1.65) + 1) / 2;
    const pointerX = this.parameter('ParamAngleX') / 30;
    const pointerY = this.parameter('ParamAngleY') / 30;
    const hair = this.parameter('ParamHairSwing') + Math.sin(seconds * 1.9) * 0.25;
    const pose: MotionPose = {
      headX: pointerX * 12,
      headY: pointerY * 8,
      headRotation: pointerX * 0.035,
      bodyRotation: this.parameter('ParamBodyAngleX') * 0.003,
      breath,
      hair,
      wave: 0,
    };

    switch (this.activeMotion) {
      case 'Listen':
        pose.headY += 5 + Math.sin(motionSeconds * 2) * 2;
        pose.bodyRotation -= 0.018;
        break;
      case 'Think':
        pose.headX += Math.sin(motionSeconds * 0.8) * 8;
        pose.headRotation += 0.035;
        break;
      case 'Speak':
        pose.headY += Math.sin(motionSeconds * 3.4) * 2;
        pose.bodyRotation += Math.sin(motionSeconds * 1.7) * 0.008;
        break;
      case 'Greet':
      case 'Wave':
        pose.wave = Math.sin(motionSeconds * 7) * 0.55 + 0.45;
        break;
      case 'Nod':
        pose.headY += Math.sin(motionSeconds * 5) * 10;
        break;
      case 'ShakeHead':
        pose.headX += Math.sin(motionSeconds * 7) * 16 * Math.max(0, 1 - motionSeconds / 1.3);
        break;
      case 'TouchHead':
      case 'TouchHairClip':
        pose.headRotation -= 0.055 * Math.max(0, 1 - motionSeconds / 1.5);
        pose.hair += Math.sin(motionSeconds * 9) * Math.max(0, 1 - motionSeconds / 1.5);
        break;
      case 'Drag':
        pose.hair += pointerX * 0.8;
        break;
      case 'Return':
        pose.headY += Math.sin(seconds * 0.9) * 3;
        break;
    }
    return pose;
  }

  private drawLayer(context: CanvasRenderingContext2D, layer: LiteLayer, pose: MotionPose, seconds: number): void {
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

    context.globalAlpha = this.layerAlpha(layer);
    context.fillStyle = layer.color ?? '#ffffff';
    context.strokeStyle = layer.color ?? '#ffffff';
    this.drawShape(context, layer);
    context.restore();
  }

  private drawShape(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const height = layer.height ?? 0;
    switch (layer.type) {
      case 'ellipse':
        context.beginPath();
        context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        context.fill();
        break;
      case 'roundRect':
        roundedRect(context, x, y, width, height, layer.radius ?? 0);
        context.fill();
        break;
      case 'path':
        drawPolygon(context, layer.points ?? []);
        context.fill();
        break;
      case 'strokes':
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = layer.width ?? 2;
        for (const line of layer.lines ?? []) drawStroke(context, line);
        break;
      case 'hairClip':
        this.drawHairClip(context, layer);
        break;
      case 'eye':
        this.drawEye(context, layer);
        break;
      case 'brow':
        this.drawBrow(context, layer);
        break;
      case 'mouth':
        this.drawMouth(context, layer);
        break;
      case 'buttons':
        for (let index = 0; index < (layer.count ?? 0); index += 1) {
          context.beginPath();
          context.arc(x, y + index * (layer.gap ?? 0), 8, 0, Math.PI * 2);
          context.fill();
        }
        break;
      case 'trim':
        roundedRect(context, x, y, width, height, height / 2);
        context.fill();
        break;
      case 'limb':
        context.translate(x + width / 2, y + height / 2);
        context.rotate(((layer.rotation ?? 0) * Math.PI) / 180);
        roundedRect(context, -width / 2, -height / 2, width, height, width / 2);
        context.fill();
        break;
      case 'pleats':
        this.drawPleats(context, layer);
        break;
    }
  }

  private drawEye(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const openness = clamp(this.expression.eyeOpen, 0.04, 1);
    const height = (layer.height ?? 0) * openness;
    const centerY = y + (layer.height ?? 0) / 2;
    if (openness < 0.16) {
      context.strokeStyle = '#24222b';
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(x + 8, centerY);
      context.quadraticCurveTo(x + width / 2, centerY + 7, x + width - 8, centerY);
      context.stroke();
      return;
    }
    context.save();
    context.beginPath();
    context.ellipse(x + width / 2, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = '#fffdfb';
    context.fillRect(x, centerY - height / 2, width, height);
    const pupilX = x + width / 2 + this.parameter('ParamEyeBallX') * width * 0.16;
    const pupilY = centerY - this.parameter('ParamEyeBallY') * height * 0.14;
    context.fillStyle = '#3c4654';
    context.beginPath();
    context.arc(pupilX, pupilY, Math.min(width, height) * 0.33, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#171b22';
    context.beginPath();
    context.arc(pupilX, pupilY, Math.min(width, height) * 0.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(pupilX - 5, pupilY - 5, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.strokeStyle = '#25232b';
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(x + width / 2, centerY, width / 2, height / 2, 0, Math.PI, Math.PI * 2);
    context.stroke();
  }

  private drawBrow(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const direction = layer.side === 'L' ? 1 : -1;
    context.strokeStyle = '#26242b';
    context.lineWidth = 6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x, y + direction * this.expression.brow * 12);
    context.quadraticCurveTo(x + width / 2, y - 5 - this.expression.brow * 10, x + width, y - direction * this.expression.brow * 12);
    context.stroke();
  }

  private drawMouth(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const height = layer.height ?? 0;
    const parameterOpen = this.parameter('ParamMouthOpenY');
    const open = clamp(Math.max(parameterOpen, this.expression.mouthOpen), 0, 1);
    const form = clamp(this.parameter('ParamMouthForm') + this.expression.mouthForm, -1, 1);
    if (open > 0.08) {
      context.fillStyle = '#8c3f50';
      context.beginPath();
      context.ellipse(x + width / 2, y + height / 2, width * (0.28 + open * 0.12), height * (0.1 + open * 0.38), 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#e9939e';
      context.beginPath();
      context.ellipse(x + width / 2, y + height * 0.68, width * 0.2, height * open * 0.12, 0, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.strokeStyle = '#a95f68';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x + width * 0.18, y + height / 2 - form * 4);
    context.quadraticCurveTo(x + width / 2, y + height / 2 + form * 12, x + width * 0.82, y + height / 2 - form * 4);
    context.stroke();
  }

  private drawHairClip(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const height = layer.height ?? 0;
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(-0.28);
    context.fillStyle = layer.color ?? '#d8dde2';
    roundedRect(context, -width / 2, -height / 2, width, height, 10);
    context.fill();
    context.fillStyle = layer.accent ?? '#92dff2';
    roundedRect(context, -width * 0.28, -height * 0.3, width * 0.56, height * 0.6, 6);
    context.fill();
    context.restore();
  }

  private drawPleats(context: CanvasRenderingContext2D, layer: LiteLayer): void {
    const x = layer.x ?? 0;
    const y = layer.y ?? 0;
    const width = layer.width ?? 0;
    const height = layer.height ?? 0;
    const count = Math.max(1, layer.count ?? 1);
    const step = width / count;
    for (let index = 0; index < count; index += 1) {
      context.beginPath();
      context.moveTo(x + index * step, y);
      context.lineTo(x + (index + 0.45) * step, y + height);
      context.lineTo(x + (index + 0.78) * step, y + height);
      context.lineTo(x + (index + 1) * step, y);
      context.closePath();
      context.fill();
    }
  }

  private layerAlpha(layer: LiteLayer): number {
    if (layer.expressionAlpha === 'blush') return clamp(this.expression.blush, 0, 1);
    return clamp(layer.alpha ?? 1, 0, 1);
  }

  private parameter(id: string): number {
    return this.parameters.get(id) ?? this.model?.parameters[id]?.default ?? 0;
  }
}

interface MotionPose {
  headX: number;
  headY: number;
  headRotation: number;
  bodyRotation: number;
  breath: number;
  hair: number;
  wave: number;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load Live2D Lite model (${response.status}): ${url}`);
  return response.json();
}

function validateModel(model: Live2DLiteDefinition): void {
  if (model.schemaVersion !== 1) throw new Error(`Unsupported Live2D Lite schema: ${model.schemaVersion}`);
  if (!(model.canvas.width > 0) || !(model.canvas.height > 0)) throw new Error('Live2D Lite canvas must have positive dimensions.');
  if (!Array.isArray(model.layers) || model.layers.length === 0) throw new Error('Live2D Lite model has no drawable layers.');
  if (!model.expressions.neutral) throw new Error('Live2D Lite model requires a neutral expression.');
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const resolved = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  context.beginPath();
  context.moveTo(x + resolved, y);
  context.lineTo(x + width - resolved, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolved);
  context.lineTo(x + width, y + height - resolved);
  context.quadraticCurveTo(x + width, y + height, x + width - resolved, y + height);
  context.lineTo(x + resolved, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolved);
  context.lineTo(x, y + resolved);
  context.quadraticCurveTo(x, y, x + resolved, y);
  context.closePath();
}

function drawPolygon(context: CanvasRenderingContext2D, points: number[][]): void {
  if (points.length === 0) return;
  context.beginPath();
  context.moveTo(points[0][0] ?? 0, points[0][1] ?? 0);
  for (const point of points.slice(1)) context.lineTo(point[0] ?? 0, point[1] ?? 0);
  context.closePath();
}

function drawStroke(context: CanvasRenderingContext2D, points: number[][]): void {
  if (points.length === 0) return;
  context.beginPath();
  context.moveTo(points[0][0] ?? 0, points[0][1] ?? 0);
  for (const point of points.slice(1)) context.lineTo(point[0] ?? 0, point[1] ?? 0);
  context.stroke();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
