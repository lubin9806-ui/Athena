import type { LiquidGlassMotion } from './LiquidGlassRenderer';

export class LiveGlass {
  private frame = 0;
  private pointerX = window.innerWidth * 0.5;
  private pointerY = 0;
  private targetPointerX = this.pointerX;
  private targetPointerY = this.pointerY;
  private lastFrameAt = performance.now();
  private voiceLevel = 0;
  private velocityX = 0;
  private velocityY = 0;
  private settingsReducedMotion = false;
  private idleTimer: number | undefined;
  private idlePhase = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private readonly surfaces: HTMLElement[],
    private readonly shell?: HTMLElement,
    private readonly lifeCore?: HTMLElement,
    private readonly rippleSurfaces: HTMLElement[] = surfaces,
    private readonly onMotion?: (motion: LiquidGlassMotion) => void,
  ) {
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    for (const surface of this.rippleSurfaces) surface.addEventListener('pointerdown', this.handlePointerDown);
    this.applyMaterialPosition();
    this.scheduleIdleShift();
  }

  setVoiceLevel(level: number): void {
    this.voiceLevel = Math.max(0, Math.min(1, level));
    for (const surface of this.surfaces) {
      surface.style.setProperty('--glass-energy', this.voiceLevel.toFixed(3));
    }
    this.shell?.style.setProperty('--glass-energy', this.voiceLevel.toFixed(3));
    this.lifeCore?.style.setProperty('--glass-energy', this.voiceLevel.toFixed(3));
    if (this.shouldBypassAnimationFrame()) {
      this.applyMaterialPosition();
    } else if (!this.frame) {
      this.frame = requestAnimationFrame(this.update);
    }
  }

  setMotionReduced(reduced: boolean): void {
    this.settingsReducedMotion = reduced;
    window.clearTimeout(this.idleTimer);
    if (!reduced) {
      this.scheduleIdleShift();
      return;
    }
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.idleTimer);
    this.frame = 0;
    this.pointerX = this.targetPointerX;
    this.pointerY = this.targetPointerY;
    this.velocityX = 0;
    this.velocityY = 0;
    this.applyMaterialPosition();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.idleTimer);
    this.frame = 0;
    window.removeEventListener('pointermove', this.handlePointerMove);
    for (const surface of this.rippleSurfaces) surface.removeEventListener('pointerdown', this.handlePointerDown);
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.targetPointerX = event.clientX;
    this.targetPointerY = event.clientY;
    if (this.shouldBypassAnimationFrame()) {
      this.pointerX = this.targetPointerX;
      this.pointerY = this.targetPointerY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.applyMaterialPosition();
      return;
    }
    if (!this.frame) this.frame = requestAnimationFrame(this.update);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.isMotionReduced()) return;
    const surface = event.currentTarget;
    if (!(surface instanceof HTMLElement)) return;
    this.targetPointerX = event.clientX;
    this.targetPointerY = event.clientY;
    surface.dataset.liquidPressed = 'true';
    this.onMotion?.({
      pointerX: event.clientX,
      pointerY: event.clientY,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      energy: Math.max(this.voiceLevel, 0.34),
    });
    window.setTimeout(() => {
      surface.dataset.liquidPressed = 'false';
      this.applyMaterialPosition();
    }, 180);
  };

  private readonly update = (now: number): void => {
    this.frame = 0;
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - this.lastFrameAt) / 1_000));
    this.lastFrameAt = now;
    const distance = Math.hypot(
      this.targetPointerX - this.pointerX,
      this.targetPointerY - this.pointerY,
    );
    const ease = this.isMotionReduced() ? 1 : 1 - Math.exp(-deltaSeconds * 15);
    const previousX = this.pointerX;
    const previousY = this.pointerY;
    this.pointerX += (this.targetPointerX - this.pointerX) * ease;
    this.pointerY += (this.targetPointerY - this.pointerY) * ease;
    const targetVelocityX = Math.max(-1, Math.min(1, (this.pointerX - previousX) / deltaSeconds / 1_100));
    const targetVelocityY = Math.max(-1, Math.min(1, (this.pointerY - previousY) / deltaSeconds / 1_100));
    const velocityEase = this.isMotionReduced() ? 1 : 1 - Math.exp(-deltaSeconds * 10);
    this.velocityX += (targetVelocityX - this.velocityX) * velocityEase;
    this.velocityY += (targetVelocityY - this.velocityY) * velocityEase;
    this.applyMaterialPosition();

    const velocity = Math.hypot(this.velocityX, this.velocityY);
    if (!this.isMotionReduced() && (distance > 0.28 || velocity > 0.008)) {
      this.frame = requestAnimationFrame(this.update);
    } else {
      this.pointerX = this.targetPointerX;
      this.pointerY = this.targetPointerY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.applyMaterialPosition();
    }
  };

  private applyMaterialPosition(): void {
    // Read every moving surface before writing custom properties. Interleaving
    // these reads and writes forced repeated layout work during pointer and
    // microphone animation frames.
    const lifeCoreRect = this.lifeCore?.getBoundingClientRect();
    const surfaceRects = this.surfaces.map(surface => ({
      surface,
      rect: surface.getBoundingClientRect(),
    }));
    const viewportX = Math.max(0, Math.min(1, this.pointerX / Math.max(1, window.innerWidth)));
    const viewportY = Math.max(0, Math.min(1, this.pointerY / Math.max(1, window.innerHeight)));
    const velocity = Math.min(1, Math.hypot(this.velocityX, this.velocityY));
    this.shell?.style.setProperty('--scene-x', `${(viewportX * 100).toFixed(2)}%`);
    this.shell?.style.setProperty('--scene-y', `${(viewportY * 100).toFixed(2)}%`);
    this.shell?.style.setProperty('--scene-velocity-x', this.velocityX.toFixed(3));
    this.shell?.style.setProperty('--scene-velocity-y', this.velocityY.toFixed(3));
    this.shell?.style.setProperty('--scene-velocity', velocity.toFixed(3));

    if (this.lifeCore && lifeCoreRect) {
      const coreRect = lifeCoreRect;
      const coreX = coreRect.left + coreRect.width * 0.5;
      const coreY = coreRect.top + coreRect.height * 0.5;
      const distance = Math.hypot(this.pointerX - coreX, this.pointerY - coreY);
      const proximity = Math.max(0, 1 - distance / 120);
      const localX = Math.max(-1, Math.min(1, (this.pointerX - coreX) / 120));
      const localY = Math.max(-1, Math.min(1, (this.pointerY - coreY) / 120));
      this.lifeCore.style.setProperty('--core-proximity', proximity.toFixed(3));
      this.lifeCore.style.setProperty('--core-pointer-x', localX.toFixed(3));
      this.lifeCore.style.setProperty('--core-pointer-y', localY.toFixed(3));
      this.lifeCore.style.setProperty('--core-velocity-x', this.velocityX.toFixed(3));
      this.lifeCore.style.setProperty('--core-velocity-y', this.velocityY.toFixed(3));
      this.lifeCore.style.setProperty('--core-velocity', velocity.toFixed(3));
      this.lifeCore.dataset.attentive = String(proximity > 0.08);
    }

    for (const { surface, rect } of surfaceRects) {
      if (!rect.width || !rect.height) continue;
      const x = Math.max(-0.2, Math.min(1.2, (this.pointerX - rect.left) / rect.width));
      const y = Math.max(-0.5, Math.min(1.5, (this.pointerY - rect.top) / rect.height));
      const depth = Math.max(0, 1 - Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 0.82));
      const pressure = Math.min(1, velocity * 0.78 + this.voiceLevel * 0.72 + depth * 0.08);
      surface.style.setProperty('--glass-x', `${(x * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-y', `${(y * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-inverse-x', `${((1 - x) * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-inverse-y', `${((1 - y) * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-angle', `${(112 + (x - 0.5) * 18 + (y - 0.5) * 8).toFixed(2)}deg`);
      surface.style.setProperty('--glass-depth', depth.toFixed(3));
      surface.style.setProperty('--glass-shift-x', `${((x - 0.5) * 4.8).toFixed(2)}px`);
      surface.style.setProperty('--glass-shift-y', `${((y - 0.5) * 2.8).toFixed(2)}px`);
      surface.style.setProperty('--glass-velocity-x', this.velocityX.toFixed(3));
      surface.style.setProperty('--glass-velocity-y', this.velocityY.toFixed(3));
      surface.style.setProperty('--glass-velocity', velocity.toFixed(3));
      surface.style.setProperty('--glass-pressure', pressure.toFixed(3));
      surface.style.setProperty('--glass-caustic-x', `${(50 + this.velocityX * 22).toFixed(2)}%`);
      surface.style.setProperty('--glass-caustic-y', `${(50 + this.velocityY * 18).toFixed(2)}%`);
    }

    this.onMotion?.({
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      energy: this.voiceLevel,
    });
  }

  private isMotionReduced(): boolean {
    return this.settingsReducedMotion || this.reducedMotion.matches;
  }

  private shouldBypassAnimationFrame(): boolean {
    return this.isMotionReduced() || (typeof document !== 'undefined' && document.visibilityState !== 'visible');
  }

  private scheduleIdleShift(): void {
    if (this.isMotionReduced() || !this.lifeCore) return;
    const delay = 4_600 + Math.random() * 7_200;
    this.idleTimer = window.setTimeout(() => {
      this.idlePhase += 1;
      this.lifeCore?.style.setProperty('--core-idle-x', `${((this.idlePhase % 3) - 1) * 0.7}px`);
      this.lifeCore?.style.setProperty('--core-idle-y', `${((this.idlePhase % 2) * 2 - 1) * 0.45}px`);
      if (this.lifeCore) this.lifeCore.dataset.idleShift = String(this.idlePhase % 3);
      this.scheduleIdleShift();
    }, delay);
  }
}
