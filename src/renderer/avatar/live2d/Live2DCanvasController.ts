import type {
  AvatarCharacterProfile,
  AvatarHotZoneAction,
  AvatarLayoutMode,
  AvatarPoint,
  AvatarStateSnapshot,
} from '../../../shared/types/avatar';
import { AvatarRuntime, type AthenaAvatarEvent, type AvatarRuntimeEventHandler } from '../AvatarRuntime';
import { Live2DAvatarAdapter } from './Live2DAvatarAdapter';
import type { Live2DHost } from './Live2DHost';

export interface Live2DCanvasControllerOptions {
  profile: AvatarCharacterProfile;
  host: Live2DHost;
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  className?: string;
  now?: () => string;
  onEvent?: AvatarRuntimeEventHandler;
  onHotZoneAction?: (action: AvatarHotZoneAction, hotZoneId: string) => void;
}

export class Live2DCanvasController {
  readonly canvas: HTMLCanvasElement;
  readonly runtime: AvatarRuntime;

  private readonly detachEvent: () => void;
  private readonly ownsCanvas: boolean;
  private loaded = false;

  constructor(private readonly options: Live2DCanvasControllerOptions) {
    this.canvas = options.canvas ?? createCanvas();
    this.ownsCanvas = !options.canvas;
    this.canvas.classList.add('athena-avatar-canvas', 'athena-live2d-canvas');
    if (options.className) this.canvas.classList.add(options.className);
    this.canvas.dataset.avatarProvider = 'live2d';
    this.canvas.dataset.avatarLayoutMode = options.profile.layout.mode;
    if (options.container && !options.container.contains(this.canvas)) options.container.appendChild(this.canvas);

    this.runtime = new AvatarRuntime(
      new Live2DAvatarAdapter({ canvas: this.canvas, host: options.host }),
      { now: options.now },
    );
    this.detachEvent = options.onEvent ? this.runtime.subscribe(options.onEvent) : () => {};
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.runtime.load(this.options.profile);
    this.loaded = true;
  }

  async dispatch(event: AthenaAvatarEvent): Promise<AvatarHotZoneAction | null> {
    if (!this.loaded) await this.load();
    return this.runtime.dispatch(event);
  }

  updateLayoutMode(mode: AvatarLayoutMode): void {
    this.canvas.dataset.avatarLayoutMode = mode;
  }

  getSnapshot(): AvatarStateSnapshot {
    return this.runtime.getSnapshot();
  }

  async destroy(): Promise<void> {
    this.detachEvent();
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    if (this.loaded) await this.runtime.unload();
    this.loaded = false;
    if (this.ownsCanvas) this.canvas.remove();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.loaded) return;
    const rect = this.canvas.getBoundingClientRect();
    const point = normalizedPointer(event, rect);
    void this.runtime.dispatch({ type: 'pointer.move', point });
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.loaded || !this.options.host.hitTestCanvasPoint) return;
    const rect = this.canvas.getBoundingClientRect();
    const canvasPoint: AvatarPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const hitAreas = this.options.host.hitTestCanvasPoint(canvasPoint);
    const hotZone = this.options.profile.hotZones.find(zone => zone.enabled && zone.hitAreaName && hitAreas.includes(zone.hitAreaName));
    if (!hotZone) return;
    void this.runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: hotZone.id }).then(action => {
      if (action) this.options.onHotZoneAction?.(action, hotZone.id);
    });
  };
}

function createCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') throw new Error('Live2DCanvasController needs a canvas when document is unavailable.');
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 520;
  canvas.setAttribute('aria-label', 'Athena Live2D avatar');
  return canvas;
}

function normalizedPointer(event: PointerEvent, rect: DOMRect): AvatarPoint {
  return {
    x: clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -1, 1),
    y: clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1, -1, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
