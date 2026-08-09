export type AthenaSpace = 'companion' | 'work';

export class MotionSystem {
  private settingsReducedMotion = false;
  private hasChangedSpace = false;
  private transitionTimer: number | undefined;
  private readonly activeFlightCleanups = new Set<() => void>();
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
    message.style.visibility = 'hidden';

    const composerRect = this.composer.getBoundingClientRect();
    const start = this.composer.querySelector<HTMLElement>('#send-btn')?.getBoundingClientRect() ?? composerRect;
    const target = message.getBoundingClientRect();
    if (!target.width || !target.height) {
      this.settleSentMessage(message);
      return;
    }

    const flight = document.createElement('div');
    flight.className = 'message-flight';
    flight.textContent = text;
    flight.style.width = `${Math.min(target.width, Math.max(160, start.width - 150))}px`;
    document.body.appendChild(flight);

    const flightRect = flight.getBoundingClientRect();
    const startLeft = this.clamp(
      start.left + start.width / 2 - flightRect.width / 2,
      12,
      window.innerWidth - flightRect.width - 12,
    );
    const startTop = this.clamp(
      start.top + start.height / 2 - Math.min(flightRect.height, target.height) / 2,
      8,
      window.innerHeight - Math.min(flightRect.height, target.height) - 8,
    );
    flight.style.left = `${startLeft}px`;
    flight.style.top = `${startTop}px`;

    const dx = target.left - startLeft;
    const dy = target.top - startTop;
    const scaleX = Math.max(0.72, Math.min(1.08, target.width / Math.max(1, flight.offsetWidth)));
    const duration = 520;
    const animation = flight.animate([
      { opacity: 0.08, transform: 'translate3d(0, 8px, 0) scale(1.035)' },
      { opacity: 0.92, offset: 0.28, transform: 'translate3d(0, -4px, 0) scale(1)' },
      { opacity: 0.98, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX})` },
    ], {
      duration,
      easing: 'cubic-bezier(0.2, 0.82, 0.18, 1)',
      fill: 'forwards',
    });

    let settled = false;
    const fallbackTimer = window.setTimeout(() => finish(), duration + 120);
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      flight.remove();
      this.activeFlightCleanups.delete(finish);
      this.settleSentMessage(message);
    };

    this.activeFlightCleanups.add(finish);
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
    void animation.finished.then(finish, finish);
  }

  dispose(): void {
    window.clearTimeout(this.transitionTimer);
    for (const cleanup of this.activeFlightCleanups) cleanup();
    this.activeFlightCleanups.clear();
  }

  private isMotionReduced(): boolean {
    return this.settingsReducedMotion || this.reducedMotion.matches;
  }

  private settleSentMessage(message: HTMLElement): void {
    message.style.removeProperty('visibility');
    message.dataset.entry = 'landed';
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  }
}
