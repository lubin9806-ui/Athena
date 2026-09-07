import { ChildProcess } from 'child_process';

export interface PythonWorkerReply {
  ok: boolean;
  /** Mirrors the one-shot scripts' stderr categories so both paths classify alike. */
  code?: string;
  message?: string;
  /** Whatever the sidecar returns: transcribed text, a written file path. */
  [field: string]: unknown;
}

export interface PythonWorkerOptions {
  handshakeTimeoutMs: number;
  idleShutdownMs: number;
  startCooldownMs: number;
  requestTimeoutMs: number;
  maxLineBytes: number;
}

/**
 * A resident Python sidecar that keeps its model loaded between requests.
 *
 * Both voice models cost far more to load than to use - measured at ~850ms
 * against a ~450ms transcription, and ~1.7s against a ~2.4s synthesis - so the
 * load is paid once per session instead of once per sentence.
 *
 * The worker is an optimisation, never a dependency. It warms in the background,
 * and until it answers the handshake every request goes down the one-shot path,
 * so a machine where the resident process cannot start is slower, not broken.
 */
export class PythonWorker {
  private child: ChildProcess | null = null;
  private ready = false;
  private starting = false;
  private retryAfter = 0;
  private stdoutBuffer = '';
  private stderrTail = '';
  private settlePending: ((reply: PythonWorkerReply) => void) | null = null;
  private pendingId = 0;
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly spawnWorker: () => ChildProcess,
    private readonly options: PythonWorkerOptions,
  ) {}

  get isReady(): boolean {
    return this.ready && this.child !== null;
  }

  /** Begin loading the model in the background. Never throws, never blocks. */
  warm(): void {
    if (this.child || this.starting || Date.now() < this.retryAfter) return;
    this.start();
  }

  /**
   * Run one request through the resident model, or return null to say "not mine".
   *
   * null means the caller should use the one-shot path: the worker is still
   * warming, unavailable, or already busy. Only one job runs at a time because
   * the models are constructed single-threaded.
   */
  run(request: Record<string, unknown>, signal: AbortSignal): Promise<PythonWorkerReply | null> {
    if (!this.isReady || this.settlePending || signal.aborted) {
      this.warm();
      return Promise.resolve(null);
    }

    const child = this.child;
    const id = this.nextId++;
    this.clearIdleTimer();

    return new Promise<PythonWorkerReply | null>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const finish = (reply: PythonWorkerReply): void => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(reply);
      };

      const onAbort = (): void => {
        // Neither model can be interrupted part way through, so ending the
        // process is the only way to honour a cancel promptly. The next request
        // re-warms it.
        this.halt('语音操作已取消。', 'CANCELLED', 0);
      };

      this.pendingId = id;
      this.settlePending = finish;
      signal.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => {
        this.halt('Voice command timed out.', 'TIMEOUT', this.options.startCooldownMs);
      }, this.options.requestTimeoutMs);
      timer.unref?.();

      try {
        child?.stdin?.write(`${JSON.stringify({ ...request, id })}\n`);
      } catch (error) {
        this.halt(error instanceof Error ? error.message : String(error), 'WORKER_LOST', this.options.startCooldownMs);
      }
    });
  }

  /** Release the resident process; a later request warms a fresh one. */
  dispose(): void {
    this.halt('语音组件已关闭。', 'WORKER_LOST', 0);
  }

  private start(): void {
    this.starting = true;
    let child: ChildProcess;
    try {
      child = this.spawnWorker();
    } catch {
      this.starting = false;
      this.retryAfter = Date.now() + this.options.startCooldownMs;
      return;
    }

    this.child = child;
    // The resident process must never be the reason a parent stays alive.
    child.unref();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.readStdout(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-500);
    });
    child.once('error', (error: Error) => {
      this.halt(error.message, 'RUNTIME_MISSING', this.options.startCooldownMs);
    });
    child.once('exit', (code) => {
      this.halt(this.stderrTail || `Voice worker exited with ${code}.`, 'WORKER_LOST', this.options.startCooldownMs);
    });

    this.handshakeTimer = setTimeout(() => {
      if (!this.ready) this.halt('Voice worker did not report ready.', 'WORKER_LOST', this.options.startCooldownMs);
    }, this.options.handshakeTimeoutMs);
    this.handshakeTimer.unref?.();
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this.readLine(line);
      index = this.stdoutBuffer.indexOf('\n');
    }
    // A worker that never terminates a line must not grow this without bound.
    if (this.stdoutBuffer.length > this.options.maxLineBytes) {
      this.halt('Voice worker produced an unterminated line.', 'WORKER_LOST', this.options.startCooldownMs);
    }
  }

  private readLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Anything unparseable means the stream is no longer the protocol.
      this.halt('Voice worker sent a malformed reply.', 'WORKER_LOST', this.options.startCooldownMs);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const record = parsed as Record<string, unknown>;

    if (!this.ready) {
      if (record.ready !== true) return;
      this.ready = true;
      this.starting = false;
      this.clearHandshakeTimer();
      this.armIdleTimer();
      return;
    }

    const settle = this.settlePending;
    // A reply that does not match the request in flight would answer one
    // utterance with another's result, so it is dropped rather than returned.
    if (!settle || record.id !== this.pendingId) return;
    this.settlePending = null;
    this.pendingId = 0;
    this.armIdleTimer();
    settle({
      ...record,
      ok: record.ok === true,
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
    });
  }

  private halt(reason: string, code: string, cooldownMs: number): void {
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.starting = false;
    this.stdoutBuffer = '';
    this.clearHandshakeTimer();
    this.clearIdleTimer();
    if (cooldownMs > 0) this.retryAfter = Date.now() + cooldownMs;

    if (child) {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      try { child.kill(); } catch { /* Child may already be gone. */ }
    }

    const settle = this.settlePending;
    this.settlePending = null;
    this.pendingId = 0;
    this.stderrTail = '';
    settle?.({ ok: false, code, message: reason });
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    // An idle model is a couple of hundred megabytes held for nothing.
    this.idleTimer = setTimeout(() => {
      this.halt('Voice worker idle.', 'WORKER_LOST', 0);
    }, this.options.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }
}
