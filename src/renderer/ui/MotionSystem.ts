export type AthenaSpace = 'companion' | 'work';

interface SentMessageFlight {
  startLeft: number;
  startTop: number;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
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
    flight.style.width = `${Math.min(target.width, Math.max(132, composerRect.width - 210))}px`;
    document.body.appendChild(flight);

    const geometry = this.measureSentMessageFlight(flight, start, target);
    flight.style.left = `${geometry.startLeft}px`;
    flight.style.top = `${geometry.startTop}px`;
    this.composer.dataset.sendMotion = 'true';

    const duration = 540;
    const animation = flight.animate([
      {
        opacity: 0,
        transform: 'translate3d(0, 7px, 0) scale(0.94)',
        filter: 'blur(2px) saturate(0.92)',
        borderRadius: '23px',
      },
      {
        opacity: 0.96,
        offset: 0.2,
        transform: 'translate3d(0, -5px, 0) scale(1.018)',
        filter: 'blur(0) saturate(1.04)',
        borderRadius: '20px 20px 10px 20px',
      },
      {
        opacity: 0.98,
        transform: `translate3d(${geometry.dx}px, ${geometry.dy}px, 0) scale(${geometry.scaleX}, ${geometry.scaleY})`,
        filter: 'blur(0) saturate(1)',
        borderRadius: '17px 17px 7px 17px',
      },
    ], {
      duration,
      easing: 'cubic-bezier(0.18, 0.86, 0.2, 1)',
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
      scaleX: Math.max(0.74, Math.min(1.12, target.width / Math.max(1, flightRect.width))),
      scaleY: Math.max(0.86, Math.min(1.08, target.height / Math.max(1, flightRect.height))),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  }
}
