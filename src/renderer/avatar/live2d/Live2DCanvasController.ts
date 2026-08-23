import type {
  AvatarCharacterProfile,
  AvatarHotZone,
  AvatarHotZoneAction,
  AvatarHotZoneGestureType,
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
  onHotZoneAction?: (action: AvatarHotZoneAction, hotZoneId: string, gestureType: AvatarHotZoneGestureType) => void;
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
    startAt: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    pathLength: number;
    lastX: number;
    lastY: number;
    hotZoneId: string | null;
  } | null = null;
  private touchState: {
    pointerId: number;
    startX: number;
    startY: number;
    startAt: number;
    pathLength: number;
    lastX: number;
    lastY: number;
    hotZoneId: string | null;
  } | null = null;
  private lastTap: {
    hotZoneId: string;
    at: number;
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

  async reload(): Promise<void> {
    if (this.loaded) await this.runtime.unload();
    this.loaded = false;
    await this.load();
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
      this.dragState.pathLength += Math.hypot(event.clientX - this.dragState.lastX, event.clientY - this.dragState.lastY);
      this.dragState.lastX = event.clientX;
      this.dragState.lastY = event.clientY;
      if (Math.hypot(deltaX, deltaY) >= 4) this.dragState.moved = true;
      this.offsetX = this.dragState.offsetX + deltaX;
      this.offsetY = this.dragState.offsetY + deltaY;
      this.applyOffsets();
      return;
    }
    if (this.touchState?.pointerId === event.pointerId) {
      this.touchState.pathLength += Math.hypot(event.clientX - this.touchState.lastX, event.clientY - this.touchState.lastY);
      this.touchState.lastX = event.clientX;
      this.touchState.lastY = event.clientY;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = normalizedPointer(event, rect);
    void this.runtime.dispatch({ type: 'pointer.move', point });
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.loaded) return;
    const hotZone = this.findHotZone(event.clientX, event.clientY);
    if (this.isDraggable()) {
      this.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startAt: eventTime(event),
        offsetX: this.offsetX,
        offsetY: this.offsetY,
        moved: false,
        pathLength: 0,
        lastX: event.clientX,
        lastY: event.clientY,
        hotZoneId: hotZone?.id ?? null,
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    this.touchState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: eventTime(event),
      pathLength: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      hotZoneId: hotZone?.id ?? null,
    };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragState?.pointerId === event.pointerId) {
      const dragState = this.dragState;
      this.dragState = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      const completedAt = eventTime(event);
      this.triggerHotZone(event.clientX, event.clientY, classifyHotZoneGesture({
        hotZoneId: dragState.hotZoneId,
        currentHotZoneId: this.findHotZone(event.clientX, event.clientY)?.id ?? null,
        startX: dragState.startX,
        startY: dragState.startY,
        endX: event.clientX,
        endY: event.clientY,
        startAt: dragState.startAt,
        endAt: completedAt,
        pathLength: dragState.pathLength,
        draggable: true,
        lastTap: this.lastTap,
      }), completedAt);
      return;
    }
    if (this.touchState?.pointerId !== event.pointerId) return;
    const touchState = this.touchState;
    this.touchState = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const completedAt = eventTime(event);
    this.triggerHotZone(event.clientX, event.clientY, classifyHotZoneGesture({
      hotZoneId: touchState.hotZoneId,
      currentHotZoneId: this.findHotZone(event.clientX, event.clientY)?.id ?? null,
      startX: touchState.startX,
      startY: touchState.startY,
      endX: event.clientX,
      endY: event.clientY,
      startAt: touchState.startAt,
      endAt: completedAt,
      pathLength: touchState.pathLength,
      draggable: false,
      lastTap: this.lastTap,
    }), completedAt);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.dragState?.pointerId === event.pointerId) this.dragState = null;
    if (this.touchState?.pointerId === event.pointerId) this.touchState = null;
  };

  private triggerHotZone(clientX: number, clientY: number, gestureType: AvatarHotZoneGestureType = 'tap', completedAt = Date.now()): void {
    const hotZone = this.findHotZone(clientX, clientY);
    if (!hotZone) return;
    if (gestureType === 'tap' || gestureType === 'repeat_tap') {
      this.lastTap = { hotZoneId: hotZone.id, at: completedAt };
    }
    void this.runtime.dispatch({ type: 'hotZone.trigger', hotZoneId: hotZone.id }).then(action => {
      if (!action) return;
      return this.applyHotZoneVisualAction(action).then(() => {
        this.options.onHotZoneAction?.(action, hotZone.id, gestureType);
      });
    });
  }

  private findHotZone(clientX: number, clientY: number): AvatarHotZone | null {
    const rect = this.canvas.getBoundingClientRect();
    const canvasPoint: AvatarPoint = { x: clientX - rect.left, y: clientY - rect.top };
    const hitAreas = this.options.host.hitTestCanvasPoint?.(canvasPoint) ?? [];
    const hotZone = this.options.profile.hotZones.find(zone => zone.enabled && zone.hitAreaName && hitAreas.includes(zone.hitAreaName))
      ?? this.options.profile.hotZones.find(zone => zone.enabled && zone.rect && pointInsideHotZone(canvasPoint, zone.rect, rect));
    return hotZone ?? null;
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

interface HotZoneGestureClassificationInput {
  hotZoneId: string | null;
  currentHotZoneId: string | null;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startAt: number;
  endAt: number;
  pathLength: number;
  draggable: boolean;
  lastTap: { hotZoneId: string; at: number } | null;
}

export function classifyHotZoneGesture(input: HotZoneGestureClassificationInput): AvatarHotZoneGestureType {
  const travel = Math.hypot(input.endX - input.startX, input.endY - input.startY);
  const duration = Math.max(0, input.endAt - input.startAt);
  const hotZoneId = input.currentHotZoneId ?? input.hotZoneId;
  if (input.draggable && travel >= 16) return 'drag';
  if (travel >= 18 || input.pathLength >= 28) return 'stroke';
  if (duration >= 600) return 'long_press';
  if (
    hotZoneId
    && input.lastTap?.hotZoneId === hotZoneId
    && input.endAt - input.lastTap.at > 0
    && input.endAt - input.lastTap.at <= 450
  ) {
    return 'repeat_tap';
  }
  return 'tap';
}

function eventTime(event: PointerEvent): number {
  return typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp)
    ? event.timeStamp
    : Date.now();
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
