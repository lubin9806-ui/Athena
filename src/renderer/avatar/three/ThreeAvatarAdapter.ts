import type {
  AvatarCharacterProfile,
  AvatarMotionMapping,
  AvatarPoint,
  AvatarProvider,
  AvatarState,
  AvatarStateSnapshot,
} from '../../../shared/types/avatar';
import type { AvatarAdapter } from '../AvatarRuntime';
import { resolveThreeAvatarModelSource, type ThreeAvatarResolvedModelSource } from './ThreeAvatarAssetResolver';
import { MissingThreeAvatarHost, type ThreeAvatarHost } from './ThreeAvatarHost';

export interface ThreeAvatarAdapterOptions {
  canvas: HTMLCanvasElement;
  host?: ThreeAvatarHost;
}

export class ThreeAvatarAdapter implements AvatarAdapter {
  private readonly host: ThreeAvatarHost;
  private profile: AvatarCharacterProfile | null = null;
  private source: ThreeAvatarResolvedModelSource | null = null;
  private snapshot: AvatarStateSnapshot = {
    characterId: 'unloaded',
    provider: 'gltf',
    loaded: false,
    state: 'unloaded',
    lipSyncActive: false,
  };

  constructor(private readonly options: ThreeAvatarAdapterOptions) {
    this.host = options.host ?? new MissingThreeAvatarHost();
  }

  async load(profile: AvatarCharacterProfile): Promise<void> {
    if (profile.provider !== 'gltf' && profile.provider !== 'vrm') {
      throw new Error(`ThreeAvatarAdapter cannot load provider: ${profile.provider}`);
    }
    const source = resolveThreeAvatarModelSource(profile.model, profile.provider);
    await this.host.load({
      canvas: this.options.canvas,
      modelUrl: source.modelUrl,
      rootUrl: source.rootUrl,
      format: source.format,
      transparentBackground: profile.layout.transparentBackground,
    });
    this.profile = profile;
    this.source = source;
    this.snapshot = {
      characterId: profile.id,
      provider: profile.provider as AvatarProvider,
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
      provider: 'gltf',
      loaded: false,
      state: 'unloaded',
      lipSyncActive: false,
    };
  }

  async setState(state: AvatarState): Promise<void> {
    this.ensureLoaded();
    await this.host.setState(state);
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

  getResolvedSource(): ThreeAvatarResolvedModelSource | null {
    return this.source ? { ...this.source } : null;
  }

  private ensureLoaded(): void {
    if (!this.profile || !this.snapshot.loaded) throw new Error('3D avatar is not loaded.');
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
