import type { Application } from 'pixi.js';
import type {
  CubismIdHandle,
  CubismInternalModel,
  Live2DModel,
  Live2DPlugin,
} from 'untitled-pixi-live2d-engine';
import type { AvatarMotionMapping, AvatarPoint } from '../../../shared/types/avatar';
import type { Live2DHost, Live2DHostLoadOptions } from './Live2DHost';

type PixiRuntime = typeof import('pixi.js');
interface CubismRuntime {
  Live2DModel: typeof Live2DModel;
  Live2DPlugin: typeof Live2DPlugin;
}

interface LoadedRuntime {
  pixi: PixiRuntime;
  cubism: CubismRuntime;
}

export interface BrowserCubismLive2DHostOptions {
  coreScriptUrl?: string;
  fallbackHost?: Live2DHost;
  loadRuntime?: () => Promise<LoadedRuntime>;
  pixelRatio?: () => number;
}

type CubismModel = Live2DModel<CubismInternalModel>;

const DEFAULT_CORE_SCRIPT_URL = 'vendor/live2d/live2dcubismcore.min.js';
const EXPRESSION_PARAMETERS: Record<string, Record<string, number>> = {
  neutral: {},
  happy: { ParamMouthForm: 1 },
  soft_smile: { ParamMouthForm: 0.62 },
  thoughtful: { ParamMouthForm: -0.18 },
  shy: { ParamMouthForm: 0.48 },
  confused: { ParamMouthForm: -0.42 },
  surprised: { ParamMouthOpenY: 0.44, ParamMouthForm: 0.12 },
  focused: { ParamMouthForm: 0.05 },
  worried: { ParamMouthForm: -0.68 },
  sleepy: { ParamEyeLOpen: 0.48, ParamEyeROpen: 0.48, ParamMouthForm: -0.08 },
  playful: { ParamMouthForm: 0.82 },
};

let coreLoadPromise: Promise<void> | null = null;
let pluginRegistered = false;

export class BrowserCubismLive2DHost implements Live2DHost {
  private app: Application | null = null;
  private model: CubismModel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fallbackActive = false;
  private fallbackReason: string | null = null;
  private baseSize: { width: number; height: number } | null = null;
  private fittedTransform: { x: number; y: number; scale: number } | null = null;
  private activeMotion: AvatarMotionMapping | null = null;
  private activeMotionStartedAt = 0;
  private idleMotionCursor = 0;
  private readonly parameterIndexes = new Map<string, number>();
  private readonly manualParameters = new Map<string, number>();
  private readonly expressionParameters = new Map<string, number>();

  constructor(private readonly options: BrowserCubismLive2DHostOptions = {}) {}

  async load(loadOptions: Live2DHostLoadOptions): Promise<void> {
    await this.unload();
    try {
      await ensureCubismCore(this.options.coreScriptUrl ?? DEFAULT_CORE_SCRIPT_URL);
      const runtime = await (this.options.loadRuntime ?? loadBrowserRuntime)();
      if (!pluginRegistered) {
        runtime.pixi.extensions.add(runtime.cubism.Live2DPlugin);
        pluginRegistered = true;
      }

      const model = await runtime.cubism.Live2DModel.from(loadOptions.modelUrl, {
        autoHitTest: false,
        autoFocus: false,
        eyeBlink: true,
        breathDepth: 0.7,
        useHighPrecisionMask: 'auto',
        anchorMode: 'drawable',
        textureOptions: { lod: 'single-auto' },
      }) as CubismModel;

      this.model = model;
      const app = new runtime.pixi.Application();
      const size = canvasCssSize(loadOptions.canvas);
      await app.init({
        canvas: loadOptions.canvas,
        width: size.width,
        height: size.height,
        preference: 'webgl',
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: false,
        resolution: this.resolvePixelRatio(),
        powerPreference: 'high-performance',
      });

      model.anchor.set(0.5, 0.5);
      app.stage.addChild(model);
      this.app = app;
      this.baseSize = { width: Math.max(1, model.width), height: Math.max(1, model.height) };
      this.indexParameters(model);
      model.internalModel.on('beforeModelUpdate', this.applyPersistentParameters);
      app.ticker.add(this.updateVisibleMotion);
      this.resize(loadOptions.canvas);
      this.observeCanvas(loadOptions.canvas);
    } catch (error) {
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      await this.teardownCubism();
      if (!this.options.fallbackHost || !loadOptions.canvas.getContext('2d')) throw error;
      await this.options.fallbackHost.load(loadOptions);
      this.fallbackActive = true;
    }
  }

  async unload(): Promise<void> {
    if (this.fallbackActive) await this.options.fallbackHost?.unload();
    this.fallbackActive = false;
    this.fallbackReason = null;
    await this.teardownCubism();
  }

  async setExpression(expressionId: string, intensity: number): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.setExpression(expressionId, intensity);
    const model = this.requireModel();
    this.expressionParameters.clear();
    const expressionManager = model.internalModel.motionManager.expressionManager;
    const hasNativeExpression = expressionManager?.definitions.some(definition => (
      typeof definition === 'object'
      && definition !== null
      && 'Name' in definition
      && definition.Name === expressionId
    ));
    if (intensity >= 0.995 && hasNativeExpression) {
      await model.expression(expressionId);
      return;
    }
    const target = EXPRESSION_PARAMETERS[expressionId];
    if (target) {
      const weight = clamp(intensity, 0, 1);
      for (const [id, value] of Object.entries(target)) {
        const neutral = id.startsWith('ParamEye') && id.endsWith('Open') ? 1 : 0;
        this.expressionParameters.set(id, neutral + (value - neutral) * weight);
      }
      this.applyPersistentParameters();
      return;
    }
    // Imported models may omit expression files; keeping the neutral pose is intentional.
  }

  async playMotion(mapping: AvatarMotionMapping): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.playMotion(mapping);
    const model = this.requireModel();
    if (!hasMotionGroup(model, mapping.motionGroup)) return;
    const requestedIndex = this.resolveMotionIndex(model, mapping);
    this.activeMotion = mapping;
    this.activeMotionStartedAt = nowMs();
    await model.motion(
      mapping.motionGroup,
      requestedIndex,
      motionPriority(mapping.priority),
      { loop: mapping.loop },
    );
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.setParameter(parameterId, value);
    this.requireModel();
    this.manualParameters.set(parameterId, value);
    this.applyPersistentParameters();
  }

  async updatePointer(point: AvatarPoint): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.updatePointer(point);
    this.requireModel().focus(clamp(point.x, -1, 1), clamp(-point.y, -1, 1));
  }

  hitTestCanvasPoint(point: AvatarPoint): string[] {
    if (this.fallbackActive) return this.options.fallbackHost?.hitTestCanvasPoint?.(point) ?? [];
    return this.model?.hitTest(point.x, point.y) ?? [];
  }

  getRendererKind(): 'cubism-web' | 'live2d-lite' | 'unloaded' {
    if (this.fallbackActive) return 'live2d-lite';
    return this.model ? 'cubism-web' : 'unloaded';
  }

  getFallbackReason(): string | null {
    return this.fallbackReason;
  }

  getDrawableIds(): string[] {
    if (this.fallbackActive || !this.model) return [];
    return [...this.model.internalModel.getDrawableIDs()];
  }

  private requireModel(): CubismModel {
    if (!this.model) throw new Error('Cubism Live2D model is not loaded.');
    return this.model;
  }

  private resolvePixelRatio(): number {
    const value = this.options.pixelRatio?.() ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio);
    return clamp(value, 1, 2);
  }

  private indexParameters(model: CubismModel): void {
    this.parameterIndexes.clear();
    const coreModel = model.internalModel.coreModel;
    for (let index = 0; index < coreModel.getParameterCount(); index += 1) {
      const id = cubismIdToString(coreModel.getParameterId(index));
      if (id) this.parameterIndexes.set(id, index);
    }
  }

  private readonly applyPersistentParameters = (): void => {
    const coreModel = this.model?.internalModel.coreModel;
    if (!coreModel) return;
    for (const parameters of [this.expressionParameters, this.manualParameters]) {
      for (const [id, value] of parameters) {
        const index = this.parameterIndexes.get(id);
        if (index !== undefined) coreModel.setParameterValueByIndex(index, value);
      }
    }
  };

  private observeCanvas(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.resize(canvas));
    this.resizeObserver.observe(canvas);
  }

  private resize(canvas: HTMLCanvasElement): void {
    if (!this.app || !this.model || !this.baseSize) return;
    const size = canvasCssSize(canvas);
    this.app.renderer.resize(size.width, size.height, this.resolvePixelRatio());
    const scale = Math.min(
      (size.width * 0.94) / this.baseSize.width,
      (size.height * 0.96) / this.baseSize.height,
    );
    this.fittedTransform = { x: size.width / 2, y: size.height / 2, scale };
    this.applyVisibleMotion(nowMs());
  }

  private async teardownCubism(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.app?.ticker.remove(this.updateVisibleMotion);
    this.manualParameters.clear();
    this.expressionParameters.clear();
    this.parameterIndexes.clear();
    this.baseSize = null;
    this.fittedTransform = null;
    this.activeMotion = null;
    this.activeMotionStartedAt = 0;
    this.idleMotionCursor = 0;
    if (this.model) {
      this.model.internalModel.off('beforeModelUpdate', this.applyPersistentParameters);
      this.app?.stage.removeChild(this.model);
      this.model.destroy({ children: true, texture: true, baseTexture: true });
      this.model = null;
    }
    this.app?.destroy(false, { children: true, texture: true, textureSource: true, context: true });
    this.app = null;
  }

  private readonly updateVisibleMotion = (): void => {
    this.applyVisibleMotion(nowMs());
  };

  private applyVisibleMotion(now: number): void {
    if (!this.model || !this.fittedTransform) return;
    const seconds = now / 1000;
    const active = this.activeMotion;
    const group = active?.motionGroup ?? 'Idle';
    const elapsed = active ? (now - this.activeMotionStartedAt) / 1000 : 0;
    const weight = active ? motionEnvelope(group, elapsed, active.loop) : 1;
    const idleBob = Math.sin(seconds * 1.25) * 3.6;
    const breath = Math.sin(seconds * 1.75) * 0.008;
    const pose = visibleMotionPose(group, elapsed, weight);

    this.model.position.set(
      this.fittedTransform.x + pose.x,
      this.fittedTransform.y + idleBob + pose.y,
    );
    this.model.scale.set(
      this.fittedTransform.scale * (1 + pose.scaleX),
      this.fittedTransform.scale * (1 + breath + pose.scaleY),
    );
    this.model.rotation = pose.rotation;
  }

  private resolveMotionIndex(model: CubismModel, mapping: AvatarMotionMapping): number {
    const count = motionGroupCount(model, mapping.motionGroup);
    const requestedIndex = Number.parseInt(mapping.motionId ?? '', 10);
    if (Number.isFinite(requestedIndex)) return clamp(Math.trunc(requestedIndex), 0, Math.max(0, count - 1));
    if (mapping.motionGroup === 'Idle' && count > 1) {
      const index = this.idleMotionCursor % count;
      this.idleMotionCursor = (this.idleMotionCursor + 1) % count;
      return index;
    }
    return 0;
  }
}

interface VisibleMotionPose {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

async function loadBrowserRuntime(): Promise<LoadedRuntime> {
  // @ts-expect-error Pixi publishes this CSP-safe runtime through package exports.
  await import('pixi.js/unsafe-eval');
  const [pixi, cubism] = await Promise.all([
    import('pixi.js'),
    // The package exposes this runtime entry, but Athena's legacy Node resolver
    // cannot read subpath export declarations during the CommonJS typecheck.
    // @ts-expect-error Runtime subpath is declared by the installed package exports.
    import('untitled-pixi-live2d-engine/cubism'),
  ]);
  return { pixi, cubism: cubism as CubismRuntime };
}

async function ensureCubismCore(url: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Cubism Web runtime requires a browser document.');
  if (hasCubismCore()) return;
  if (coreLoadPromise) return coreLoadPromise;
  coreLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-athena-cubism-core]');
    const script = existing ?? document.createElement('script');
    const handleLoad = (): void => hasCubismCore()
      ? resolve()
      : reject(new Error('Cubism Core script loaded without exposing Live2DCubismCore.'));
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load Cubism Core: ${url}`)), { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.dataset.athenaCubismCore = 'true';
      document.head.appendChild(script);
    }
  }).catch(error => {
    coreLoadPromise = null;
    throw error;
  });
  return coreLoadPromise;
}

function hasCubismCore(): boolean {
  return typeof globalThis === 'object' && 'Live2DCubismCore' in globalThis;
}

function cubismIdToString(id: CubismIdHandle): string {
  return id.getString().s;
}

function canvasCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1)),
    height: Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1)),
  };
}

function hasMotionGroup(model: CubismModel, group: string): boolean {
  return motionGroupCount(model, group) > 0;
}

function motionGroupCount(model: CubismModel, group: string): number {
  const settings = model.internalModel.settings as CubismInternalModel['settings'] & {
    motions?: Record<string, unknown[]>;
  };
  return Array.isArray(settings.motions?.[group]) ? settings.motions[group].length : 0;
}

function motionPriority(priority: AvatarMotionMapping['priority']): 1 | 2 | 3 {
  if (priority === 'idle') return 1;
  if (priority === 'urgent') return 3;
  return 2;
}

function visibleMotionPose(group: string, elapsed: number, weight: number): VisibleMotionPose {
  const wobble = Math.sin(elapsed * 3.1);
  const quick = Math.sin(elapsed * 8.5);
  const pose: VisibleMotionPose = { x: 0, y: 0, rotation: 0, scaleX: 0, scaleY: 0 };

  switch (group) {
    case 'Greet':
      pose.x = Math.sin(elapsed * 5.2) * 10 * weight;
      pose.y = -Math.sin(Math.min(1, elapsed / 0.55) * Math.PI) * 12 * weight;
      pose.rotation = Math.sin(elapsed * 5.2) * 0.035 * weight;
      pose.scaleY = Math.sin(elapsed * 4.4) * 0.01 * weight;
      break;
    case 'Listen':
      pose.x = -7 * weight + Math.sin(elapsed * 2.2) * 2 * weight;
      pose.rotation = -0.018 * weight + Math.sin(elapsed * 1.5) * 0.008 * weight;
      pose.scaleY = 0.006 * weight;
      break;
    case 'Think':
      pose.x = -5 * weight + Math.sin(elapsed * 1.6) * 3 * weight;
      pose.y = Math.sin(elapsed * 1.2) * 2 * weight;
      pose.rotation = -0.028 * weight;
      break;
    case 'Speak':
      pose.x = Math.sin(elapsed * 4.5) * 4 * weight;
      pose.y = Math.sin(elapsed * 7.5) * 3 * weight;
      pose.rotation = Math.sin(elapsed * 3.2) * 0.017 * weight;
      pose.scaleY = Math.max(0, Math.sin(elapsed * 10)) * 0.012 * weight;
      break;
    case 'Nod':
      pose.y = Math.sin(elapsed * 13) * 12 * weight;
      pose.rotation = Math.sin(elapsed * 13) * 0.012 * weight;
      pose.scaleY = -Math.max(0, Math.sin(elapsed * 13)) * 0.014 * weight;
      break;
    case 'ShakeHead':
      pose.x = Math.sin(elapsed * 17) * 15 * weight;
      pose.rotation = Math.sin(elapsed * 17) * 0.035 * weight;
      break;
    case 'Wave':
      pose.x = Math.sin(elapsed * 8.5) * 9 * weight;
      pose.rotation = Math.sin(elapsed * 8.5) * 0.045 * weight;
      pose.y = -Math.max(0, Math.sin(elapsed * 4.2)) * 7 * weight;
      break;
    case 'TouchHead':
      pose.y = 13 * weight + Math.sin(elapsed * 4.5) * 2 * weight;
      pose.rotation = 0.03 * weight;
      pose.scaleY = -0.018 * weight;
      pose.scaleX = 0.006 * weight;
      break;
    case 'TouchHairClip':
      pose.x = 8 * weight;
      pose.y = 5 * weight;
      pose.rotation = -0.038 * weight + Math.sin(elapsed * 5.2) * 0.01 * weight;
      break;
    case 'Drag':
      pose.x = quick * 5 * weight;
      pose.rotation = quick * 0.022 * weight;
      pose.scaleX = Math.sin(elapsed * 5) * 0.012 * weight;
      break;
    case 'Return':
      pose.y = -Math.sin(Math.min(1, elapsed / 1.2) * Math.PI) * 18 * weight;
      pose.rotation = Math.sin(elapsed * 5.5) * 0.025 * weight;
      break;
    case 'Idle':
    default:
      pose.x = Math.sin(elapsed * 0.75) * 2.4 * weight;
      pose.rotation = wobble * 0.011 * weight;
      pose.scaleY = Math.sin(elapsed * 2.2) * 0.006 * weight;
      break;
  }

  return pose;
}

function motionEnvelope(group: string, elapsed: number, loop: boolean): number {
  if (loop) return 1;
  const duration = MOTION_DURATIONS[group] ?? 2;
  if (elapsed >= duration) return 0;
  const fadeIn = Math.min(0.24, duration * 0.22);
  const fadeOut = Math.min(0.42, duration * 0.28);
  if (elapsed < fadeIn) return easeOut(elapsed / fadeIn);
  if (elapsed > duration - fadeOut) return easeOut((duration - elapsed) / fadeOut);
  return 1;
}

const MOTION_DURATIONS: Record<string, number> = {
  Greet: 2.4,
  Nod: 1.35,
  ShakeHead: 1.6,
  Wave: 2.8,
  TouchHead: 2.1,
  TouchHairClip: 2.3,
  Return: 2.5,
};

function easeOut(value: number): number {
  const clamped = clamp(value, 0, 1);
  return 1 - ((1 - clamped) ** 3);
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
