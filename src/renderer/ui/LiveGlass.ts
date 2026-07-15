export class LiveGlass {
  private frame = 0;
  private pointerX = window.innerWidth * 0.5;
  private pointerY = 0;
  private targetPointerX = this.pointerX;
  private targetPointerY = this.pointerY;
  private lastFrameAt = performance.now();
  private voiceLevel = 0;
  private settingsReducedMotion = false;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly surfaces: HTMLElement[]) {
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    for (const surface of surfaces) surface.addEventListener('pointerdown', this.handlePointerDown);
    this.applyMaterialPosition();
  }

  setVoiceLevel(level: number): void {
    this.voiceLevel = Math.max(0, Math.min(1, level));
    for (const surface of this.surfaces) {
      surface.style.setProperty('--glass-energy', this.voiceLevel.toFixed(3));
    }
  }

  setMotionReduced(reduced: boolean): void {
    this.settingsReducedMotion = reduced;
    if (!reduced) return;
    cancelAnimationFrame(this.frame);
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
}
