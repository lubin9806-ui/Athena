export type AthenaSpace = 'companion' | 'work';

export class MotionSystem {
  private settingsReducedMotion = false;
  private hasChangedSpace = false;
  private transitionTimer: number | undefined;
  private readonly activeMessageCleanups = new Set<() => void>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private readonly shell: HTMLElement,
    private readonly composer: HTMLElement,
  ) {}

  setMotionReduced(reduced: boolean): void {
    this.settingsReducedMotion = reduced;
  }

  beginSpaceTransition(from: AthenaSpace, to: AthenaSpace): void {
    if (from === to || this.isMotionReduced()) return;
    window.clearTimeout(this.transitionTimer);
    const duration = this.hasChangedSpace ? 480 : 860;
    this.hasChangedSpace = true;
    this.shell.dataset.spaceFrom = from;
    this.shell.dataset.spaceTo = to;
    this.shell.dataset.spaceMoving = 'true';
    this.shell.style.setProperty('--space-transition-duration', `${duration}ms`);
    this.transitionTimer = window.setTimeout(() => {
      delete this.shell.dataset.spaceMoving;
      delete this.shell.dataset.spaceFrom;
      delete this.shell.dataset.spaceTo;
    }, duration + 60);
  }

  animateSentMessage(message: HTMLElement, text: string): void {
    if (this.isMotionReduced()) {
      message.dataset.entry = 'settled';
      return;
    }

    message.dataset.entry = 'sending';
    this.composer.dataset.sendMotion = 'true';

    const duration = text.length > 80 ? 210 : 180;
    const animation = message.animate([
      {
        opacity: 0.62,
        transform: 'translate3d(0, 5px, 0) scale(0.985)',
      },
      {
        opacity: 1,
        offset: 0.78,
        transform: 'translate3d(0, -1px, 0) scale(1.002)',
      },
      {
        opacity: 1,
        transform: 'translate3d(0, 0, 0) scale(1)',
      },
    ], {
      duration,
      easing: 'cubic-bezier(0.2, 0.72, 0.18, 1)',
    });

    let settled = false;
    const fallbackTimer = window.setTimeout(() => finish(), duration + 80);
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      delete this.composer.dataset.sendMotion;
      this.activeMessageCleanups.delete(finish);
      this.settleSentMessage(message);
    };

    this.activeMessageCleanups.add(finish);
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
    void animation.finished.then(finish, finish);
  }

  dispose(): void {
    window.clearTimeout(this.transitionTimer);
    for (const cleanup of this.activeMessageCleanups) cleanup();
    this.activeMessageCleanups.clear();
  }

  private isMotionReduced(): boolean {
    return this.settingsReducedMotion || this.reducedMotion.matches;
  }

  private settleSentMessage(message: HTMLElement): void {
    message.dataset.entry = 'settled';
  }
}
