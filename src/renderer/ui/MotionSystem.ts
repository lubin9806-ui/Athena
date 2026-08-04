export type AthenaSpace = 'companion' | 'work';

export class MotionSystem {
  private settingsReducedMotion = false;
  private hasChangedSpace = false;
  private transitionTimer: number | undefined;
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

    const start = this.composer.getBoundingClientRect();
    const target = message.getBoundingClientRect();
    if (!target.width || !target.height) return;

    const flight = document.createElement('div');
    flight.className = 'message-flight';
    flight.textContent = text;
    flight.style.left = `${start.left + 54}px`;
    flight.style.top = `${start.top + 12}px`;
    flight.style.width = `${Math.min(target.width, Math.max(160, start.width - 150))}px`;
    document.body.appendChild(flight);
    message.style.visibility = 'hidden';

    const dx = target.left - (start.left + 54);
    const dy = target.top - (start.top + 12);
    const scaleX = Math.max(0.72, Math.min(1.08, target.width / Math.max(1, flight.offsetWidth)));
    const animation = flight.animate([
      { opacity: 0.08, transform: 'translate3d(0, 8px, 0) scale(1.035)' },
      { opacity: 0.92, offset: 0.28, transform: 'translate3d(0, -4px, 0) scale(1)' },
      { opacity: 1, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX})` },
    ], {
      duration: 560,
      easing: 'cubic-bezier(0.2, 0.82, 0.18, 1)',
      fill: 'forwards',
    });

    void animation.finished.catch(() => undefined).finally(() => {
      flight.remove();
      message.style.removeProperty('visibility');
      message.dataset.entry = 'landed';
    });
  }

  dispose(): void {
    window.clearTimeout(this.transitionTimer);
  }

  private isMotionReduced(): boolean {
    return this.settingsReducedMotion || this.reducedMotion.matches;
  }
}
