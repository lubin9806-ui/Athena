/**
 * Per-stage timing for one turn.
 *
 * A turn can put several model calls in series - routing, then creative
 * extraction, then the reply itself - and until now the only visible number was
 * how long the whole thing took. That made a serial pile-up indistinguishable
 * from one slow provider. Each stage records its own duration and how it ended,
 * so a regression can assert on the shape of the turn and not just its total
 * (ATH-PERF-001).
 */
export interface TurnStage {
  name: string;
  ms: number;
  /** How the stage ended: `ok`, `skipped`, `timeout`, `failed`, or anything specific. */
  outcome: string;
}

export class TurnProfile {
  private readonly stages: TurnStage[] = [];
  private readonly startedAtMs: number;

  constructor(private readonly now: () => number = () => Date.now()) {
    this.startedAtMs = this.now();
  }

  record(name: string, ms: number, outcome: string): void {
    this.stages.push({ name, ms: Math.max(0, Math.round(ms)), outcome });
  }

  /**
   * Times an awaited stage. The outcome is read off the result so a stage that
   * returned nothing useful is not recorded as a success.
   */
  async measure<T>(
    name: string,
    run: () => Promise<T>,
    describe: (value: T) => string = () => 'ok',
  ): Promise<T> {
    const started = this.now();
    try {
      const value = await run();
      this.record(name, this.now() - started, describe(value));
      return value;
    } catch (error) {
      this.record(name, this.now() - started, isAbort(error) ? 'timeout' : 'failed');
      throw error;
    }
  }

  /** Stages that actually ran, in order. */
  list(): TurnStage[] {
    return this.stages.map(stage => ({ ...stage }));
  }

  /** How many stages made a call rather than being skipped outright. */
  callCount(): number {
    return this.stages.filter(stage => stage.outcome !== 'skipped').length;
  }

  totalMs(): number {
    return Math.max(0, Math.round(this.now() - this.startedAtMs));
  }

  /** One line per turn: `total=4210ms creative=12ms/local reply=3980ms/ok` */
  format(): string {
    const parts = this.stages.map(stage => `${stage.name}=${stage.ms}ms/${stage.outcome}`);
    return `total=${this.totalMs()}ms ${parts.join(' ')}`.trim();
  }
}

export function isAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
