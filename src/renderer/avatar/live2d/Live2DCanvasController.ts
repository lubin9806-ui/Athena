import type {
  AvatarCharacterProfile,
  AvatarHotZoneAction,
  AvatarLayoutMode,
  AvatarPoint,
  AvatarRect,
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
  private layoutMode: AvatarLayoutMode;
  private offsetX: number;
  private offsetY: number;
  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null = null;

  constructor(private readonly options: Live2DCanvasControllerOptions) {
    this.layoutMode = options.profile.layout.mode;
    this.offsetX = options.profile.layout.transform.x;
    this.offsetY = options.profile.layout.transform.y;
    this.canvas = options.canvas ?? createCanvas();
    this.ownsCanvas = !options.canvas;
    this.canvas.classList.add('athena-avatar-canvas', 'athena-live2d-canvas');
    if (options.className) this.canvas.classList.add(options.className);
    this.canvas.dataset.avatarProvider = 'live2d';
    this.applyLayout(options.profile.layout.mode);
    if (options.container && !options.container.contains(this.canvas)) options.container.appendChild(this.canvas);

    this.runtime = new AvatarRuntime(
      new Live2DAvatarAdapter({ canvas: this.canvas, host: options.host }),
      { now: options.now },
    );
    this.detachEvent = options.onEvent ? this.runtime.subscribe(options.onEvent) : () => {};
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
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
    this.layoutMode = mode;
    this.applyLayout(mode);
  }

  getSnapshot(): AvatarStateSnapshot {
    return this.runtime.getSnapshot();
  }

  async destroy(): Promise<void> {
    this.detachEvent();
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    if (this.loaded) await this.runtime.unload();
    this.loaded = false;
    if (this.ownsCanvas) this.canvas.remove();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.loaded) return;
    if (this.dragState?.pointerId === event.pointerId) {
      const deltaX = event.clientX - this.dragState.startX;
      const deltaY = event.clientY - this.dragState.startY;
      if (Math.hypot(deltaX, deltaY) >= 4) this.dragState.moved = true;
      this.offsetX = this.dragState.offsetX + deltaX;
      this.offsetY = this.dragState.offsetY + deltaY;
      this.applyOffsets();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = normalizedPointer(event, rect);
    void this.runtime.dispatch({ type: 'pointer.move', point });
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.loaded) return;
    if (this.isDraggable()) {
      this.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: this.offsetX,
        offsetY: this.offsetY,
        moved: false,
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    this.triggerHotZone(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragState?.pointerId !== event.pointerId) return;
    const moved = this.dragState.moved;
    this.dragState = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (!moved) this.triggerHotZone(event.clientX, event.clientY);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.dragState?.pointerId !== event.pointerId) return;
    this.dragState = null;
  };

  private triggerHotZone(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const canvasPoint: AvatarPoint = { x: clientX - rect.left, y: clientY - rect.top };
    const hitAreas = this.options.host.hitTestCanvasPoint?.(canvasPoint) ?? [];
    const hotZone = this.options.profile.hotZones.find(zone => zone.enabled && (
      (zone.hitAreaName && hitAreas.includes(zone.hitAreaName))
      || (zone.rect && pointInsideHotZone(canvasPoint, zone.rect, rect))
    ));
    if (!hotZone) return;
    void this.runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: hotZone.id }).then(action => {
      if (!action) return;
      return this.applyHotZoneVisualAction(action).then(() => {
        this.options.onHotZoneAction?.(action, hotZone.id);
      });
    });
  }

  private async applyHotZoneVisualAction(action: AvatarHotZoneAction): Promise<void> {
    if (action.type === 'composite') {
      for (const child of action.actions ?? []) await this.applyHotZoneVisualAction(child);
      return;
    }
    if (action.type === 'setExpression' && action.expressionId) {
      await this.options.host.setExpression(action.expressionId, 1);
      return;
    }
    if (action.type === 'playMotion' && action.motionGroup) {
      const configured = this.options.profile.motions.find(mapping => (
        mapping.motionGroup === action.motionGroup
        && (!action.motionId || mapping.motionId === action.motionId)
      ));
      await this.options.host.playMotion(configured ?? {
        state: 'idle',
        motionGroup: action.motionGroup,
        motionId: action.motionId,
        priority: 'focused',
        loop: false,
      });
    }
  }

  private applyLayout(mode: AvatarLayoutMode): void {
    const transform = this.options.profile.layout.transform;
    this.canvas.dataset.avatarLayoutMode = mode;
    this.canvas.style.opacity = String(clamp(transform.opacity, 0, 1));
    this.applyOffsets();
    this.canvas.style.setProperty('--avatar-scale-x', String(transform.scale * (transform.mirrored ? -1 : 1)));
    this.canvas.style.setProperty('--avatar-scale-y', String(transform.scale));
    this.canvas.style.setProperty('--avatar-rotation', `${transform.rotationDeg}deg`);
  }

  private applyOffsets(): void {
    this.canvas.style.setProperty('--avatar-offset-x', `${this.offsetX}px`);
    this.canvas.style.setProperty('--avatar-offset-y', `${this.offsetY}px`);
  }

  private isDraggable(): boolean {
    return !this.options.profile.layout.lockPosition
      && (this.layoutMode === 'draggable_overlay' || this.layoutMode === 'desktop_pet');
  }
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

function pointInsideHotZone(point: AvatarPoint, zone: AvatarRect, canvasRect: DOMRect): boolean {
  const normalized = [zone.x, zone.y, zone.width, zone.height].every(value => value >= 0 && value <= 1);
  const x = normalized ? point.x / Math.max(1, canvasRect.width) : point.x;
  const y = normalized ? point.y / Math.max(1, canvasRect.height) : point.y;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}
