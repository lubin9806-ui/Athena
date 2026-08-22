import type {
  AvatarCharacterProfile,
  AvatarLayoutMode,
  AvatarStateSnapshot,
} from '../../shared/types/avatar';
import { AvatarRuntime, type AthenaAvatarEvent, type AvatarRuntimeEventHandler } from './AvatarRuntime';
import { ThreeAvatarAdapter } from './three/ThreeAvatarAdapter';
import type { ThreeAvatarHost } from './three/ThreeAvatarHost';

export interface AvatarCanvasControllerOptions {
  profile: AvatarCharacterProfile;
  host: ThreeAvatarHost;
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  className?: string;
  now?: () => string;
  onEvent?: AvatarRuntimeEventHandler;
}

export class AvatarCanvasController {
  readonly canvas: HTMLCanvasElement;
  readonly runtime: AvatarRuntime;

  private readonly detachEvent: () => void;
  private readonly ownsCanvas: boolean;
  private loaded = false;

  constructor(private readonly options: AvatarCanvasControllerOptions) {
    this.canvas = options.canvas ?? createCanvas();
    this.ownsCanvas = !options.canvas;
    this.canvas.classList.add('athena-avatar-canvas');
    if (options.className) this.canvas.classList.add(options.className);
    this.canvas.dataset.avatarProvider = options.profile.provider;
    this.canvas.dataset.avatarLayoutMode = options.profile.layout.mode;

    if (options.container && !options.container.contains(this.canvas)) {
      options.container.appendChild(this.canvas);
    }

    this.runtime = new AvatarRuntime(
      new ThreeAvatarAdapter({ canvas: this.canvas, host: options.host }),
      { now: options.now },
    );
    this.detachEvent = options.onEvent ? this.runtime.subscribe(options.onEvent) : () => {};
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.runtime.load(this.options.profile);
    this.loaded = true;
  }

  async dispatch(event: AthenaAvatarEvent): Promise<void> {
    if (!this.loaded) await this.load();
    await this.runtime.dispatch(event);
  }

  updateLayoutMode(mode: AvatarLayoutMode): void {
    this.canvas.dataset.avatarLayoutMode = mode;
  }

  getSnapshot(): AvatarStateSnapshot {
    return this.runtime.getSnapshot();
  }

  async destroy(): Promise<void> {
    this.detachEvent();
    if (this.loaded) {
      await this.runtime.unload();
      this.loaded = false;
    }
    if (this.ownsCanvas) this.canvas.remove();
  }
}

function createCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('AvatarCanvasController needs a canvas when document is unavailable.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 480;
  canvas.setAttribute('aria-label', 'Athena 3D avatar');
  return canvas;
}
