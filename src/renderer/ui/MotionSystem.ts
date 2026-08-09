export type AthenaSpace = 'companion' | 'work';

interface SentMessageFlight {
  startLeft: number;
  startTop: number;
  dx: number;
  dy: number;
  scaleX: number;
}

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
    flight.style.width = `${Math.min(target.width, Math.max(156, composerRect.width * 0.42))}px`;
    document.body.appendChild(flight);

    const geometry = this.measureSentMessageFlight(flight, start, target);
    flight.style.left = `${geometry.startLeft}px`;
    flight.style.top = `${geometry.startTop}px`;
    this.composer.dataset.sendMotion = 'true';

    const duration = 430;
    const animation = flight.animate([
      {
        opacity: 0.18,
        transform: 'translate3d(0, 4px, 0) scale(0.98)',
      },
      {
        opacity: 0.92,
        offset: 0.18,
        transform: 'translate3d(0, -3px, 0) scale(1.01)',
      },
      {
        opacity: 0.96,
        transform: `translate3d(${geometry.dx}px, ${geometry.dy}px, 0) scale(${geometry.scaleX})`,
      },
    ], {
      duration,
      easing: 'cubic-bezier(0.2, 0.72, 0.18, 1)',
      fill: 'forwards',
    });

    let settled = false;
    const fallbackTimer = window.setTimeout(() => finish(), duration + 120);
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      flight.remove();
      delete this.composer.dataset.sendMotion;
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

  private measureSentMessageFlight(flight: HTMLElement, start: DOMRect, target: DOMRect): SentMessageFlight {
    const flightRect = flight.getBoundingClientRect();
    const startLeft = this.clamp(
      start.right - flightRect.width - 6,
      12,
      window.innerWidth - flightRect.width - 12,
    );
    const startTop = this.clamp(
      start.top + start.height / 2 - Math.min(flightRect.height, target.height) / 2,
      8,
      window.innerHeight - Math.min(flightRect.height, target.height) - 8,
    );

    return {
      startLeft,
      startTop,
      dx: target.left - startLeft,
      dy: target.top - startTop,
      scaleX: Math.max(0.9, Math.min(1.04, target.width / Math.max(1, flightRect.width))),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  }
}
