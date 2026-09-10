import { ModelTimeoutError } from './ModelTypes';

/**
 * A reasoning model can think for minutes before it emits anything at all, and a
 * non-streaming call stays silent until the whole answer is ready. Silence before
 * the provider starts talking is therefore normal, and only becomes evidence of a
 * dead connection much later than a mid-answer gap does.
 */
export const FIRST_RESPONSE_TIMEOUT_MS = 180_000;

/**
 * Bounds a model request by how long the provider stays *silent*, not by how long
 * the whole exchange takes.
 *
 * The budget used to be a single wall-clock deadline covering the streamed body,
 * so an answer that was arriving perfectly well — just at length, or after a long
 * think — was cut off mid-sentence once it outlived it. Worse, the abort surfaced
 * as "已停止。", which reads as though the user had pressed stop. Here the clock
 * restarts on every chunk, so a provider that keeps talking is never interrupted.
 *
 * An external signal (the stop button) still aborts immediately, and keeps its own
 * reason so that a real cancellation is never mistaken for a timeout.
 */
export class RequestDeadline {
  private readonly controller = new AbortController();
  private readonly external: AbortSignal | null;
  private readonly onExternalAbort: (() => void) | null;
  private readonly firstResponseMs: number;
  private readonly idleMs: number;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private disposed = false;

  constructor(idleMs: number, external?: AbortSignal | null, firstResponseMs = FIRST_RESPONSE_TIMEOUT_MS) {
    this.idleMs = atLeastOneMillisecond(idleMs);
    this.firstResponseMs = Math.max(this.idleMs, atLeastOneMillisecond(firstResponseMs));
    this.external = external ?? null;
    if (this.external?.aborted) {
      this.onExternalAbort = null;
      this.controller.abort(this.external.reason);
      return;
    }
    if (this.external) {
      this.onExternalAbort = () => this.controller.abort(this.external?.reason);
      this.external.addEventListener('abort', this.onExternalAbort, { once: true });
    } else {
      this.onExternalAbort = null;
    }
    this.arm(this.firstResponseMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Records a sign of life. Called for every chunk read off the response body, so
   * a stream that keeps producing keeps resetting its own deadline.
   */
  touch(): void {
    if (this.disposed || this.controller.signal.aborted) return;
    this.started = true;
    this.arm(this.idleMs);
  }

  /** Stops the clock once the request has finished, successfully or not. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.external && this.onExternalAbort) {
      this.external.removeEventListener('abort', this.onExternalAbort);
    }
  }

  /**
   * For metadata calls -- listing models, the settings connection test. Nothing is
   * being generated, so there is no think time to allow for and the whole call
   * stays inside the configured budget.
   */
  static forMetadata(timeoutMs: number): RequestDeadline {
    return new RequestDeadline(timeoutMs, null, timeoutMs);
  }

  private arm(waitMs: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.controller.abort(new ModelTimeoutError(this.expiryMessage(waitMs)));
    }, waitMs);
  }

  private expiryMessage(waitMs: number): string {
    return this.started
      ? `Provider stopped sending for ${waitMs}ms mid-response.`
      : `Provider sent no response within ${waitMs}ms.`;
  }
}

function atLeastOneMillisecond(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}
