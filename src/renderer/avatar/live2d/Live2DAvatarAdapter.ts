import type {
  AvatarCharacterProfile,
  AvatarMotionMapping,
  AvatarPoint,
  AvatarState,
  AvatarStateSnapshot,
} from '../../../shared/types/avatar';
import type { AvatarAdapter } from '../AvatarRuntime';
import { MissingLive2DHost, type Live2DHost } from './Live2DHost';
import { resolveLive2DModelSource, type Live2DResolvedModelSource } from './Live2DAssetResolver';

export interface Live2DAvatarAdapterOptions {
  canvas: HTMLCanvasElement;
  host?: Live2DHost;
}

export class Live2DAvatarAdapter implements AvatarAdapter {
  private readonly host: Live2DHost;
  private profile: AvatarCharacterProfile | null = null;
  private source: Live2DResolvedModelSource | null = null;
  private snapshot: AvatarStateSnapshot = {
    characterId: 'unloaded',
    provider: 'live2d',
    loaded: false,
    state: 'unloaded',
    lipSyncActive: false,
  };

  constructor(private readonly options: Live2DAvatarAdapterOptions) {
    this.host = options.host ?? new MissingLive2DHost();
  }

  async load(profile: AvatarCharacterProfile): Promise<void> {
    if (profile.provider !== 'live2d') {
      throw new Error(`Live2DAvatarAdapter cannot load provider: ${profile.provider}`);
    }
    const source = resolveLive2DModelSource(profile.model);
    await this.host.load({
      canvas: this.options.canvas,
      modelUrl: source.modelUrl,
      rootUrl: source.rootUrl,
    });
    this.profile = profile;
    this.source = source;
    this.snapshot = {
      characterId: profile.id,
      provider: 'live2d',
      loaded: true,
      state: 'idle',
      lipSyncActive: false,
    };
  }

  async unload(): Promise<void> {
    await this.host.unload();
    this.profile = null;
    this.source = null;
    this.snapshot = {
      characterId: 'unloaded',
      provider: 'live2d',
      loaded: false,
      state: 'unloaded',
      lipSyncActive: false,
    };
  }

  async setState(state: AvatarState): Promise<void> {
    this.ensureLoaded();
    this.snapshot = {
      ...this.snapshot,
      state,
      lipSyncActive: state === 'speaking',
    };
  }

  async setExpression(expressionId: string, intensity = 1): Promise<void> {
    this.ensureLoaded();
    await this.host.setExpression(expressionId, clamp01(intensity));
    this.snapshot = { ...this.snapshot, expressionId };
  }

  async playMotion(mapping: AvatarMotionMapping): Promise<void> {
    this.ensureLoaded();
    await this.host.playMotion(mapping);
    this.snapshot = {
      ...this.snapshot,
      motionGroup: mapping.motionGroup,
      motionId: mapping.motionId,
    };
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    this.ensureLoaded();
    await this.host.setParameter(parameterId, value);
  }

  async updatePointer(point: AvatarPoint): Promise<void> {
    this.ensureLoaded();
    await this.host.updatePointer(point);
    this.snapshot = { ...this.snapshot, pointer: { ...point } };
  }

  getSnapshot(): AvatarStateSnapshot {
    return {
      ...this.snapshot,
      pointer: this.snapshot.pointer ? { ...this.snapshot.pointer } : undefined,
    };
  }

  getResolvedSource(): Live2DResolvedModelSource | null {
    return this.source ? { ...this.source } : null;
  }

  private ensureLoaded(): void {
    if (!this.profile || !this.snapshot.loaded) throw new Error('Live2D avatar is not loaded.');
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

