export type RendererGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'
  | 'memory-eviction'
  | string;

export interface RendererRecoveryDecision {
  action: 'ignore' | 'reload' | 'stop';
  recentFailures: number;
  reason: RendererGoneReason;
}

export class RendererRecoveryPolicy {
  private readonly failures: number[] = [];

  constructor(
    private readonly maxAutomaticReloads = 2,
    private readonly failureWindowMs = 60_000,
  ) {
    if (!Number.isInteger(maxAutomaticReloads) || maxAutomaticReloads < 0 || maxAutomaticReloads > 10) {
      throw new Error('maxAutomaticReloads must be an integer between 0 and 10');
    }
    if (!Number.isFinite(failureWindowMs) || failureWindowMs < 1_000 || failureWindowMs > 3_600_000) {
      throw new Error('failureWindowMs must be between 1 second and 1 hour');
    }
  }

  evaluate(reason: RendererGoneReason, now = Date.now()): RendererRecoveryDecision {
    if (reason === 'clean-exit') return { action: 'ignore', recentFailures: this.recentFailureCount(now), reason };
    if (reason === 'launch-failed' || reason === 'integrity-failure') {
      return { action: 'stop', recentFailures: this.recentFailureCount(now) + 1, reason };
    }
    this.prune(now);
    this.failures.push(now);
    return {
      action: this.failures.length <= this.maxAutomaticReloads ? 'reload' : 'stop',
      recentFailures: this.failures.length,
      reason,
    };
  }

  recentFailureCount(now = Date.now()): number {
    this.prune(now);
    return this.failures.length;
  }

  private prune(now: number): void {
    while (this.failures.length > 0 && now - this.failures[0] >= this.failureWindowMs) this.failures.shift();
  }
}

export class SingleInstanceActivationQueue {
  private pending = false;

  request(): void {
    this.pending = true;
  }

  consume(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    return true;
  }

  get hasPendingRequest(): boolean {
    return this.pending;
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const boundedTimeout = Math.max(1, Math.min(120_000, Math.round(timeoutMs)));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), boundedTimeout);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
