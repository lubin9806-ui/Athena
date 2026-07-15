export class Timer {
  readonly enabled = true;
  private startedAt: number | null = null;

  start(): void {
    this.startedAt = Date.now();
  }

  elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  stop(): number {
    const elapsed = this.elapsedMs();
    this.startedAt = null;
    return elapsed;
  }
}
