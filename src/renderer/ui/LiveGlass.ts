export class LiveGlass {
  private frame = 0;
  private pointerX = window.innerWidth * 0.5;
  private pointerY = 0;
  private targetPointerX = this.pointerX;
  private targetPointerY = this.pointerY;
  private lastFrameAt = performance.now();
  private voiceLevel = 0;
  private settingsReducedMotion = false;
  private idleTimer: number | undefined;
  private idlePhase = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private readonly surfaces: HTMLElement[],
    private readonly shell?: HTMLElement,
    private readonly lifeCore?: HTMLElement,
  ) {
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    for (const surface of surfaces) surface.addEventListener('pointerdown', this.handlePointerDown);
    this.applyMaterialPosition();
    this.scheduleIdleShift();
  }

  setVoiceLevel(level: number): void {
    this.voiceLevel = Math.max(0, Math.min(1, level));
    for (const surface of this.surfaces) {
      surface.style.setProperty('--glass-energy', this.voiceLevel.toFixed(3));
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
    this.applyMaterialPosition();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.handlePointerMove);
    for (const surface of this.surfaces) surface.removeEventListener('pointerdown', this.handlePointerDown);
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.targetPointerX = event.clientX;
    this.targetPointerY = event.clientY;
    if (!this.frame) this.frame = requestAnimationFrame(this.update);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.isMotionReduced()) return;
    const surface = event.currentTarget;
    if (!(surface instanceof HTMLElement)) return;
    const rect = surface.getBoundingClientRect();
    surface.querySelector('.liquid-ripple')?.remove();
    const ripple = document.createElement('span');
    ripple.className = 'liquid-ripple';
    ripple.style.setProperty('--ripple-x', `${event.clientX - rect.left}px`);
    ripple.style.setProperty('--ripple-y', `${event.clientY - rect.top}px`);
    surface.appendChild(ripple);
    ripple.addEventListener('animationend', (animationEvent) => {
      if (animationEvent.pseudoElement === '::before') ripple.remove();
    });
    window.setTimeout(() => ripple.remove(), 520);
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
    this.pointerX += (this.targetPointerX - this.pointerX) * ease;
    this.pointerY += (this.targetPointerY - this.pointerY) * ease;
    this.applyMaterialPosition();

    if (!this.isMotionReduced() && distance > 0.28) {
      this.frame = requestAnimationFrame(this.update);
    } else {
      this.pointerX = this.targetPointerX;
      this.pointerY = this.targetPointerY;
      this.applyMaterialPosition();
    }
  };

  private applyMaterialPosition(): void {
    const viewportX = Math.max(0, Math.min(1, this.pointerX / Math.max(1, window.innerWidth)));
    const viewportY = Math.max(0, Math.min(1, this.pointerY / Math.max(1, window.innerHeight)));
    this.shell?.style.setProperty('--scene-x', `${(viewportX * 100).toFixed(2)}%`);
    this.shell?.style.setProperty('--scene-y', `${(viewportY * 100).toFixed(2)}%`);

    if (this.lifeCore) {
      const coreRect = this.lifeCore.getBoundingClientRect();
      const coreX = coreRect.left + coreRect.width * 0.5;
      const coreY = coreRect.top + coreRect.height * 0.5;
      const distance = Math.hypot(this.pointerX - coreX, this.pointerY - coreY);
      const proximity = Math.max(0, 1 - distance / 120);
      const localX = Math.max(-1, Math.min(1, (this.pointerX - coreX) / 120));
      const localY = Math.max(-1, Math.min(1, (this.pointerY - coreY) / 120));
      this.lifeCore.style.setProperty('--core-proximity', proximity.toFixed(3));
      this.lifeCore.style.setProperty('--core-pointer-x', localX.toFixed(3));
      this.lifeCore.style.setProperty('--core-pointer-y', localY.toFixed(3));
    }

    for (const surface of this.surfaces) {
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const x = Math.max(-0.2, Math.min(1.2, (this.pointerX - rect.left) / rect.width));
      const y = Math.max(-0.5, Math.min(1.5, (this.pointerY - rect.top) / rect.height));
      const depth = Math.max(0, 1 - Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 0.82));
      surface.style.setProperty('--glass-x', `${(x * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-y', `${(y * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-inverse-x', `${((1 - x) * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-inverse-y', `${((1 - y) * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-angle', `${(112 + (x - 0.5) * 18 + (y - 0.5) * 8).toFixed(2)}deg`);
      surface.style.setProperty('--glass-depth', depth.toFixed(3));
      surface.style.setProperty('--glass-shift-x', `${((x - 0.5) * 4.8).toFixed(2)}px`);
      surface.style.setProperty('--glass-shift-y', `${((y - 0.5) * 2.8).toFixed(2)}px`);
    }
  }

  private isMotionReduced(): boolean {
    return this.settingsReducedMotion || this.reducedMotion.matches;
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
