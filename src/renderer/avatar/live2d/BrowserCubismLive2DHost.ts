import type { Application, Container, Graphics } from 'pixi.js';
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
const ENABLE_VISIBLE_LAYERED_RUNTIME_RIG = false;
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
  private layeredRig: LayeredPerformanceRig | null = null;
  private activeMotion: AvatarMotionMapping | null = null;
  private activeMotionStartedAt = 0;
  private activeMotionToken = 0;
  private readonly motionGroupCursors = new Map<string, number>();
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
      if (ENABLE_VISIBLE_LAYERED_RUNTIME_RIG) {
        this.layeredRig = createLayeredPerformanceRig(runtime.pixi);
        app.stage.addChild(this.layeredRig.root);
      }
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
    const motionGroup = hasMotionGroup(model, mapping.motionGroup)
      ? mapping.motionGroup
      : mapping.fallbackMotionGroup && hasMotionGroup(model, mapping.fallbackMotionGroup)
        ? mapping.fallbackMotionGroup
        : null;
    if (!motionGroup) return;
    const resolvedMapping = motionGroup === mapping.motionGroup ? mapping : { ...mapping, motionGroup };
    const requestedIndex = this.resolveMotionIndex(model, resolvedMapping);
    const token = ++this.activeMotionToken;
    this.activeMotion = resolvedMapping;
    this.activeMotionStartedAt = nowMs();
    const started = await model.motion(
      motionGroup,
      requestedIndex,
      motionPriority(resolvedMapping.priority),
      {
        loop: resolvedMapping.loop,
        onFinish: () => {
          if (resolvedMapping.loop || this.activeMotionToken !== token) return;
          void this.playMotion({
            state: 'idle',
            motionGroup: 'Idle',
            priority: 'idle',
            loop: true,
          });
        },
      },
    );
    if (!started && resolvedMapping.fallbackMotionGroup && resolvedMapping.fallbackMotionGroup !== motionGroup) {
      await this.playMotion({ ...resolvedMapping, motionGroup: resolvedMapping.fallbackMotionGroup });
    }
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.setParameter(parameterId, value);
    this.requireModel();
    this.manualParameters.set(parameterId, value);
    this.applyPersistentParameters();
  }

  async setAppearancePreset(presetId: string): Promise<void> {
    if (this.fallbackActive) return this.options.fallbackHost?.setAppearancePreset?.(presetId);
  }

  getAppearancePresetIds(): string[] {
    if (this.fallbackActive) return this.options.fallbackHost?.getAppearancePresetIds?.() ?? [];
    return [];
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
    this.layeredRig = null;
    this.activeMotion = null;
    this.activeMotionStartedAt = 0;
    this.activeMotionToken = 0;
    this.motionGroupCursors.clear();
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
    this.updateLayeredRig(seconds, pose, breath);
  }

  private updateLayeredRig(seconds: number, pose: VisibleMotionPose, breath: number): void {
    if (!ENABLE_VISIBLE_LAYERED_RUNTIME_RIG || !this.layeredRig || !this.fittedTransform) return;
    const rig = this.layeredRig;
    const scale = this.fittedTransform.scale * 0.52;
    rig.root.visible = true;
    rig.root.alpha = 0.34;
    rig.root.position.set(
      this.fittedTransform.x - (450 * scale) + pose.x,
      this.fittedTransform.y - (650 * scale) + pose.y,
    );
    rig.root.scale.set(scale);
    rig.root.rotation = pose.rotation * 0.55;

    const mouthOpen = clamp(this.manualParameters.get('ParamMouthOpenY') ?? this.expressionParameters.get('ParamMouthOpenY') ?? 0, 0, 1);
    const mouthForm = clamp(this.expressionParameters.get('ParamMouthForm') ?? this.manualParameters.get('ParamMouthForm') ?? 0, -1, 1);
    const eyeOpen = clamp(Math.min(
      this.expressionParameters.get('ParamEyeLOpen') ?? 1,
      this.expressionParameters.get('ParamEyeROpen') ?? 1,
    ), 0, 1);
    const hairSwing = Math.sin(seconds * 1.8) * 5 + pose.rotation * 140;
    const skirtSwing = Math.sin(seconds * 1.45) * 3 + pose.x * 0.25;
    const sleeveSwing = Math.sin(seconds * 2.2) * 2.5 + pose.rotation * 70;
    const wave = pose.rotation * 10;

    rig.hairBack.rotation = hairSwing * 0.0018;
    rig.hairSideL.rotation = -0.035 + hairSwing * 0.0034;
    rig.hairSideR.rotation = 0.035 + hairSwing * 0.0034;
    rig.bangs.rotation = hairSwing * 0.0022;
    rig.hairClip.rotation = -0.24 + hairSwing * 0.003;
    rig.head.rotation = pose.rotation * 0.45;
    rig.face.rotation = pose.rotation * 0.35;
    rig.face.y = 300 + Math.sin(seconds * 1.25) * 1.2;

    rig.eyeL.scale.y = Math.max(0.12, eyeOpen);
    rig.eyeR.scale.y = Math.max(0.12, eyeOpen);
    rig.eyeL.position.x = 358 + (this.manualParameters.get('ParamEyeBallX') ?? 0) * 4;
    rig.eyeR.position.x = 482 + (this.manualParameters.get('ParamEyeBallX') ?? 0) * 4;
    rig.browL.rotation = -0.09 - mouthForm * 0.035;
    rig.browR.rotation = 0.09 + mouthForm * 0.035;
    rig.mouth.scale.set(1 + Math.max(0, mouthForm) * 0.28, 0.55 + mouthOpen * 1.25);
    rig.mouth.y = 440 + mouthOpen * 5;

    rig.torso.scale.y = 1 + breath * 0.012;
    rig.sleeveL.rotation = -0.14 - sleeveSwing * 0.003;
    rig.sleeveR.rotation = 0.14 + sleeveSwing * 0.003 + wave * 0.012;
    rig.armL.rotation = -0.08 + sleeveSwing * 0.003;
    rig.armR.rotation = 0.08 + wave * 0.055;
    rig.skirt.rotation = skirtSwing * 0.003;
    rig.pleatL.rotation = -0.035 + skirtSwing * 0.004;
    rig.pleatC.rotation = skirtSwing * 0.002;
    rig.pleatR.rotation = 0.035 + skirtSwing * 0.004;
  }

  private resolveMotionIndex(model: CubismModel, mapping: AvatarMotionMapping): number {
    const count = motionGroupCount(model, mapping.motionGroup);
    const requestedIndex = Number.parseInt(mapping.motionId ?? '', 10);
    if (Number.isFinite(requestedIndex)) return clamp(Math.trunc(requestedIndex), 0, Math.max(0, count - 1));
    if (count > 1) {
      const cursor = this.motionGroupCursors.get(mapping.motionGroup) ?? 0;
      const index = cursor % count;
      this.motionGroupCursors.set(mapping.motionGroup, (cursor + 1) % count);
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

interface LayeredPerformanceRig {
  root: Container;
  hairBack: Container;
  hairSideL: Container;
  hairSideR: Container;
  bangs: Container;
  hairClip: Container;
  head: Container;
  face: Container;
  eyeL: Container;
  eyeR: Container;
  browL: Container;
  browR: Container;
  mouth: Container;
  torso: Container;
  sleeveL: Container;
  sleeveR: Container;
  armL: Container;
  armR: Container;
  skirt: Container;
  pleatL: Container;
  pleatC: Container;
  pleatR: Container;
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
    case 'TapBody':
      pose.x = Math.sin(elapsed * 4.8) * 7 * weight;
      pose.y = -Math.max(0, Math.sin(elapsed * 3.4)) * 8 * weight;
      pose.rotation = Math.sin(elapsed * 4.8) * 0.03 * weight;
      pose.scaleY = Math.sin(elapsed * 5.5) * 0.008 * weight;
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

function createLayeredPerformanceRig(pixi: PixiRuntime): LayeredPerformanceRig {
  const root = new pixi.Container();
  root.label = 'athena-visible-layered-performance-rig';
  root.sortableChildren = true;

  const hairBack = pivotedLayer(pixi, root, 'hair-back', 450, 320, 1);
  hairBack.addChild(ellipse(pixi, 225, 108, 450, 520, 0x11141a));

  const torso = pivotedLayer(pixi, root, 'torso', 450, 760, 3);
  torso.addChild(poly(pixi, [[280, 585], [620, 585], [690, 925], [210, 925]], 0xf7f8fc, 0.5));
  torso.addChild(roundRect(pixi, 260, 570, 380, 330, 40, 0xffffff, 0.42));
  torso.addChild(poly(pixi, [[332, 575], [445, 625], [390, 710], [310, 615]], 0xffffff, 0.54));
  torso.addChild(poly(pixi, [[568, 575], [455, 625], [510, 710], [590, 615]], 0xffffff, 0.54));
  torso.addChild(roundRect(pixi, 338, 622, 224, 8, 4, 0x92dff2, 0.58));

  const sleeveL = pivotedLayer(pixi, root, 'sleeve-left', 275, 610, 4);
  sleeveL.addChild(poly(pixi, [[250, 590], [340, 610], [315, 735], [220, 720]], 0xf8f9fc, 0.48));
  const sleeveR = pivotedLayer(pixi, root, 'sleeve-right', 625, 610, 4);
  sleeveR.addChild(poly(pixi, [[650, 590], [560, 610], [585, 735], [680, 720]], 0xf8f9fc, 0.48));

  const armL = pivotedLayer(pixi, root, 'arm-left', 248, 650, 2);
  armL.addChild(roundRect(pixi, 210, 612, 58, 255, 29, 0xf3cdbc, 0.35));
  armL.addChild(roundRect(pixi, 174, 810, 58, 225, 29, 0xf3cdbc, 0.35));
  armL.addChild(ellipse(pixi, 154, 998, 88, 76, 0xf3cdbc, 0.35));
  const armR = pivotedLayer(pixi, root, 'arm-right', 652, 650, 2);
  armR.addChild(roundRect(pixi, 632, 612, 58, 255, 29, 0xf3cdbc, 0.35));
  armR.addChild(roundRect(pixi, 668, 810, 58, 225, 29, 0xf3cdbc, 0.35));
  armR.addChild(ellipse(pixi, 660, 998, 88, 76, 0xf3cdbc, 0.35));

  const skirt = pivotedLayer(pixi, root, 'skirt', 450, 905, 5);
  skirt.addChild(poly(pixi, [[250, 890], [650, 890], [720, 1085], [180, 1085]], 0x101d34, 0.42));
  const pleatL = pivotedLayer(pixi, skirt, 'pleat-left', 320, 890, 1);
  pleatL.addChild(poly(pixi, [[230, 900], [350, 900], [330, 1082], [198, 1082]], 0x263c5a, 0.44));
  const pleatC = pivotedLayer(pixi, skirt, 'pleat-center', 450, 890, 2);
  pleatC.addChild(poly(pixi, [[385, 900], [520, 900], [535, 1082], [360, 1082]], 0x1f314c, 0.5));
  const pleatR = pivotedLayer(pixi, skirt, 'pleat-right', 580, 890, 1);
  pleatR.addChild(poly(pixi, [[548, 900], [670, 900], [702, 1082], [570, 1082]], 0x263c5a, 0.44));
  skirt.addChild(roundRect(pixi, 566, 1015, 54, 146, 6, 0x92dff2, 0.48));

  const hairSideL = pivotedLayer(pixi, root, 'hair-side-left', 305, 260, 8);
  hairSideL.addChild(poly(pixi, [[305, 210], [205, 325], [205, 620], [290, 605], [325, 390]], 0x0d1016, 0.66));
  const hairSideR = pivotedLayer(pixi, root, 'hair-side-right', 595, 260, 8);
  hairSideR.addChild(poly(pixi, [[595, 210], [695, 330], [690, 615], [610, 606], [575, 390]], 0x0d1016, 0.66));

  const head = pivotedLayer(pixi, root, 'head', 450, 365, 9);
  head.addChild(ellipse(pixi, 285, 180, 330, 370, 0xf7d2c1, 0.36));
  const face = pivotedLayer(pixi, head, 'face', 450, 365, 1);
  face.addChild(ellipse(pixi, 324, 390, 70, 34, 0xf3959e, 0.18));
  face.addChild(ellipse(pixi, 506, 390, 70, 34, 0xf3959e, 0.18));

  const eyeL = pivotedLayer(pixi, head, 'eye-left', 392, 370, 4);
  eyeL.addChild(ellipse(pixi, 350, 348, 84, 44, 0xffffff, 0.78));
  eyeL.addChild(ellipse(pixi, 374, 356, 32, 34, 0x2f3948, 0.82));
  eyeL.addChild(ellipse(pixi, 388, 346, 8, 8, 0xffffff, 0.85));
  const eyeR = pivotedLayer(pixi, head, 'eye-right', 508, 370, 4);
  eyeR.addChild(ellipse(pixi, 466, 348, 84, 44, 0xffffff, 0.78));
  eyeR.addChild(ellipse(pixi, 490, 356, 32, 34, 0x2f3948, 0.82));
  eyeR.addChild(ellipse(pixi, 504, 346, 8, 8, 0xffffff, 0.85));

  const browL = pivotedLayer(pixi, head, 'brow-left', 392, 320, 5);
  browL.addChild(roundRect(pixi, 356, 316, 72, 8, 4, 0x1b1d24, 0.74));
  const browR = pivotedLayer(pixi, head, 'brow-right', 508, 320, 5);
  browR.addChild(roundRect(pixi, 474, 316, 72, 8, 4, 0x1b1d24, 0.74));

  const mouth = pivotedLayer(pixi, head, 'mouth', 450, 458, 5);
  mouth.addChild(ellipse(pixi, 410, 440, 80, 36, 0x9d4d5f, 0.76));

  const bangs = pivotedLayer(pixi, root, 'bangs', 450, 180, 11);
  bangs.addChild(poly(pixi, [[305, 190], [450, 122], [598, 188], [560, 254], [505, 220], [462, 300], [412, 222], [354, 258]], 0x0f1218, 0.72));
  bangs.addChild(poly(pixi, [[312, 192], [248, 292], [300, 310], [358, 224]], 0x171a20, 0.66));
  bangs.addChild(poly(pixi, [[590, 194], [646, 294], [596, 314], [540, 222]], 0x171a20, 0.66));

  const hairClip = pivotedLayer(pixi, root, 'hair-clip', 626, 266, 12);
  hairClip.addChild(roundRect(pixi, 584, 252, 82, 18, 7, 0xd8dde2, 0.78));
  hairClip.addChild(roundRect(pixi, 602, 255, 38, 12, 4, 0x92dff2, 0.72));

  return {
    root,
    hairBack,
    hairSideL,
    hairSideR,
    bangs,
    hairClip,
    head,
    face,
    eyeL,
    eyeR,
    browL,
    browR,
    mouth,
    torso,
    sleeveL,
    sleeveR,
    armL,
    armR,
    skirt,
    pleatL,
    pleatC,
    pleatR,
  };
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

function pivotedLayer(pixi: PixiRuntime, parent: Container, label: string, pivotX: number, pivotY: number, zIndex: number): Container {
  const layer = new pixi.Container();
  layer.label = label;
  layer.pivot.set(pivotX, pivotY);
  layer.position.set(pivotX, pivotY);
  layer.zIndex = zIndex;
  parent.addChild(layer);
  return layer;
}

function ellipse(pixi: PixiRuntime, x: number, y: number, width: number, height: number, color: number, alpha = 1): Graphics {
  const graphic = new pixi.Graphics();
  drawEllipse(graphic, x, y, width, height, color, alpha);
  return graphic;
}

function roundRect(
  pixi: PixiRuntime,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: number,
  alpha = 1,
): Graphics {
  const graphic = new pixi.Graphics();
  const target = graphic as unknown as {
    roundRect: (x: number, y: number, width: number, height: number, radius: number) => unknown;
    fill: (style: { color: number; alpha: number }) => unknown;
  };
  target.roundRect(x, y, width, height, radius);
  target.fill({ color, alpha });
  return graphic;
}

function poly(pixi: PixiRuntime, points: number[][], color: number, alpha = 1): Graphics {
  const graphic = new pixi.Graphics();
  const target = graphic as unknown as {
    poly: (points: number[]) => unknown;
    fill: (style: { color: number; alpha: number }) => unknown;
  };
  target.poly(points.flatMap(point => [point[0] ?? 0, point[1] ?? 0]));
  target.fill({ color, alpha });
  return graphic;
}

function drawEllipse(graphic: Graphics, x: number, y: number, width: number, height: number, color: number, alpha: number): void {
  const target = graphic as unknown as {
    ellipse: (x: number, y: number, halfWidth: number, halfHeight: number) => unknown;
    fill: (style: { color: number; alpha: number }) => unknown;
  };
  target.ellipse(x + width / 2, y + height / 2, width / 2, height / 2);
  target.fill({ color, alpha });
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
