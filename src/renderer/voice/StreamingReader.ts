import { isFenceLine, mayBecomeFence, takeSpeakableSentences, toSpeakableChunk } from './SpokenText';

export interface StreamingReaderDeps {
  /** Returns the path of a synthesized clip, or null if it could not be made. */
  synthesize(text: string): Promise<string | null>;
  /** Resolves when the clip stops playing - ended, failed, or was stopped. */
  playToEnd(audioPath: string): Promise<void>;
  /** Fired before the first clip, so the caller can arm playback-time state. */
  onFirstClip(): void;
  /** Fired once, when the reply has been read out or abandoned. */
  onFinish(cancelled: boolean): void;
  onError(error: Error): void;
}

/** How long the pump waits for more text before checking again. */
const IDLE_POLL_MS = 60;

/**
 * Reads a reply aloud while it is still being written (ATH-VOICE-009).
 *
 * Speaking used to start in the `finally` of a completed turn, so the first
 * sound arrived after the whole reply had been generated *and* synthesized. A
 * thirty second answer meant thirty seconds of silence. This starts on the first
 * finished sentence instead.
 *
 * The pump keeps one synthesis running ahead of playback. Without that, every
 * sentence boundary would be a silent gap the length of a PowerShell start,
 * which is worse to listen to than a single delay at the beginning.
 */
export class StreamingReader {
  private readonly deps: StreamingReaderDeps;
  private consumed = 0;
  /** Raw stream text not yet turned into sentences. */
  private raw = '';
  private insideFence = false;
  private queue: string[] = [];
  private pump: Promise<void> | null = null;
  private ended = false;
  private cancelled = false;
  private spoke = false;

  constructor(deps: StreamingReaderDeps) {
    this.deps = deps;
  }

  get isActive(): boolean {
    return this.pump !== null && !this.cancelled;
  }

  /** Called with the whole reply so far, as each chunk arrives. */
  push(fullContent: string): void {
    if (this.cancelled || this.ended) return;
    if (fullContent.length < this.consumed) {
      // The reply was replaced rather than extended; start reading it afresh.
      this.consumed = 0;
      this.raw = '';
      this.insideFence = false;
    }
    this.raw += fullContent.slice(this.consumed);
    this.consumed = fullContent.length;
    this.drain(false);
  }

  /** No more text is coming; speak whatever is left and finish. */
  finish(): void {
    if (this.cancelled || this.ended) return;
    this.ended = true;
    this.drain(true);
    this.start();
  }

  /** Stop reading now. Anything queued is dropped. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.queue = [];
    this.raw = '';
    if (!this.pump) this.deps.onFinish(true);
  }

  /**
   * Take whole sentences off the raw buffer, stepping around code blocks.
   *
   * Sentences are found in the raw text and cleaned afterwards, rather than the
   * buffer being cleaned first. Cleaning changes lengths, so a cleaned buffer
   * cannot say how much raw text a spoken sentence consumed - and getting that
   * wrong means speaking a fragment twice or skipping one.
   *
   * Waiting for whole *lines* would have been simpler, and was the first
   * attempt, but a streaming reply often has no newline until the end: the
   * reader then said nothing until the reply was complete, which is the delay
   * this class exists to remove.
   */
  private drain(flush: boolean): void {
    const emitted: string[] = [];

    for (;;) {
      if (this.insideFence) {
        const closed = this.dropThroughFenceLine();
        if (!closed) break;
        continue;
      }

      const fenceStart = this.findFenceStart();
      // Text before a code block is complete by definition: the block ends it.
      const limit = fenceStart >= 0 ? fenceStart : this.speakableLimit();
      const region = this.raw.slice(0, limit);
      const { sentences, rest } = takeSpeakableSentences(region, flush || fenceStart >= 0);
      for (const sentence of sentences) {
        const spoken = toSpeakableChunk(sentence);
        if (spoken) emitted.push(spoken);
      }
      this.raw = rest + this.raw.slice(limit);

      if (fenceStart < 0) break;
      this.dropFenceOpener();
    }

    for (const sentence of emitted) this.queue.push(sentence);
    if (emitted.length > 0) this.start();
  }

  /**
   * How much of the buffer may be spoken now.
   *
   * The unfinished last line is included - that is the whole point - unless it
   * could still turn into a code fence, in which case reading it would mean
   * reading backticks aloud.
   */
  private speakableLimit(): number {
    const lastBreak = this.raw.lastIndexOf('\n');
    const tail = this.raw.slice(lastBreak + 1);
    return mayBecomeFence(tail) ? lastBreak + 1 : this.raw.length;
  }

  /** Index of the first complete line that opens a code block, or -1. */
  private findFenceStart(): number {
    let start = 0;
    for (;;) {
      const end = this.raw.indexOf('\n', start);
      if (end < 0) return -1;
      if (isFenceLine(this.raw.slice(start, end))) return start;
      start = end + 1;
    }
  }

  private dropFenceOpener(): void {
    const end = this.raw.indexOf('\n');
    this.raw = end < 0 ? '' : this.raw.slice(end + 1);
    this.insideFence = true;
  }

  /** Discard code until past its closing fence; false if it has not arrived. */
  private dropThroughFenceLine(): boolean {
    let start = 0;
    for (;;) {
      const end = this.raw.indexOf('\n', start);
      if (end < 0) {
        // Everything so far is inside the block; none of it will be spoken.
        this.raw = this.raw.slice(start);
        return false;
      }
      if (isFenceLine(this.raw.slice(start, end))) {
        this.raw = this.raw.slice(end + 1);
        this.insideFence = false;
        return true;
      }
      start = end + 1;
    }
  }

  private start(): void {
    if (this.pump || this.cancelled) return;
    this.pump = this.run().finally(() => {
      this.pump = null;
    });
  }

  private async run(): Promise<void> {
    let inFlight: Promise<string | null> | null = null;
    try {
      while (!this.cancelled) {
        if (!inFlight && this.queue.length > 0) inFlight = this.synthesizeNext();
        if (!inFlight) {
          if (this.ended) break;
          await delay(IDLE_POLL_MS);
          continue;
        }

        const audioPath = await inFlight;
        inFlight = null;
        if (this.cancelled) break;

        // Start the next clip's synthesis before playing this one, so the wait
        // for it overlaps the audio instead of being added between sentences.
        if (this.queue.length > 0) inFlight = this.synthesizeNext();

        if (!audioPath) continue;
        if (!this.spoke) {
          this.spoke = true;
          this.deps.onFirstClip();
        }
        await this.deps.playToEnd(audioPath);
      }
    } catch (error) {
      this.deps.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.deps.onFinish(this.cancelled);
    }
  }

  private synthesizeNext(): Promise<string | null> {
    const sentence = this.queue.shift();
    if (!sentence) return Promise.resolve(null);
    return this.deps.synthesize(sentence).catch((error) => {
      // One sentence failing to synthesize should cost that sentence, not the
      // rest of the reply.
      this.deps.onError(error instanceof Error ? error : new Error(String(error)));
      return null;
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
