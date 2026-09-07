import { SpeechActivityDetector, SpeechActivityOptions } from './SpeechActivityDetector';

export interface BargeInMonitorOptions {
  /** Fired once, when the listener is confident a person started speaking. */
  onSpeech: () => void;
  onError?: (error: Error) => void;
  /** Detector frame period; the default matches the recorder's ~85ms frames. */
  frameMs?: number;
}

/**
 * Listens for the user talking over Athena, so reading aloud can be interrupted
 * (ATH-VOICE-002).
 *
 * Echo is the whole problem. The microphone hears the speakers, so a naive
 * listener stops the reading because it heard the reading. Two things keep that
 * from happening:
 *
 * 1. The browser's echo canceller needs a reference signal, which it only has
 *    for audio the page itself is playing. Barge-in therefore requires renderer
 *    playback; the caller must not hand this monitor a PowerShell playback to
 *    listen over.
 * 2. Whatever echo survives cancellation is steady and quiet, so it becomes the
 *    detector's measured floor during the first frames of playback, and a person
 *    has to stand clearly above it - a higher bar and a longer onset than
 *    dictation uses.
 *
 * Automatic gain control is off here on purpose: it would raise the room during
 * the quiet stretches between sentences, which is precisely the measurement the
 * floor depends on.
 *
 * The monitor is deliberately invisible. It writes no CSS custom properties,
 * touches no dataset, and emits no avatar events - the recording animation
 * belongs to an actual recording, and starting one is the caller's job.
 */
export class BargeInMonitor {
  private readonly options: BargeInMonitorOptions;
  private readonly detector: SpeechActivityDetector;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  // Explicitly backed by an ArrayBuffer: getFloatTimeDomainData will not accept
  // a view over the wider ArrayBufferLike the bare annotation infers.
  private samples: Float32Array<ArrayBuffer> | null = null;
  private ticker: number | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;

  constructor(options: BargeInMonitorOptions, activityOptions: SpeechActivityOptions) {
    this.options = options;
    this.detector = new SpeechActivityDetector(activityOptions);
  }

  get isListening(): boolean {
    return this.ticker !== null;
  }

  /** Idempotent: starting an already-running monitor is a no-op. */
  async start(): Promise<void> {
    if (this.ticker !== null) return;
    if (this.starting) return this.starting;

    const generation = ++this.generation;
    this.starting = this.open(generation).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    this.generation += 1;
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }

    const stream = this.stream;
    const source = this.source;
    const context = this.context;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.samples = null;
    this.context = null;

    try { source?.disconnect(); } catch { /* Already detached. */ }
    for (const track of stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* Already ended. */ }
    }
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch { /* Best effort. */ }
    }
  }

  private async open(generation: number): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
        throw new Error('Microphone monitoring is not supported in this environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const context = new AudioContext({ latencyHint: 'interactive' });
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      // The analyser is a sink here; nothing is routed onward, so the monitor
      // cannot feed the speakers and create a loop of its own.
      source.connect(analyser);

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.samples = new Float32Array(analyser.fftSize);
      this.detector.reset();

      await context.resume();
      if (generation !== this.generation) {
        await this.stop();
        return;
      }

      this.ticker = window.setInterval(() => this.sample(generation), this.options.frameMs ?? 85);
    } catch (error) {
      await this.stop();
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private sample(generation: number): void {
    if (generation !== this.generation) return;
    const analyser = this.analyser;
    const samples = this.samples;
    if (!analyser || !samples) return;

    analyser.getFloatTimeDomainData(samples);
    let sumOfSquares = 0;
    for (const sample of samples) sumOfSquares += sample * sample;
    const level = Math.sqrt(sumOfSquares / samples.length);

    if (this.detector.push(level) !== 'speech') return;
    // One shot: the caller stops the reading and starts a real recording, which
    // owns the microphone from here.
    void this.stop();
    this.options.onSpeech();
  }
}

/**
 * A higher bar than dictation on purpose.
 *
 * Interrupting is a decision, and the cost of a false positive is worse than the
 * cost of a missed one: cutting Athena off mid-sentence because a chair moved is
 * more disruptive than having to press the microphone button. So speech must sit
 * four times over the measured echo, for ~340ms, before the reading stops.
 */
export const BARGE_IN_ACTIVITY_OPTIONS: SpeechActivityOptions = {
  calibrationFrames: 6,
  floorMultiplier: 4,
  minimumLevel: 0.02,
  maximumFloor: 0.08,
  onsetFrames: 4,
  releaseFrames: 14,
  floorAdaptation: 0.05,
  maxSpeechFrames: 470,
};
