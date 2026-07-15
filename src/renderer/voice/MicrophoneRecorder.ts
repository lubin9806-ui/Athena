export type MicrophoneRecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

export interface MicrophoneRecorderOptions {
  onStateChange?: (state: MicrophoneRecorderState) => void;
  onVolume?: (level: number) => void;
  onDuration?: (durationMs: number) => void;
  onError?: (error: Error) => void;
}

interface RecordingSession {
  readonly id: number;
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  processor: AudioWorkletNode | null;
  silentGain: GainNode | null;
  chunks: Float32Array[];
  inputSampleRate: number;
  totalFrames: number;
  active: boolean;
  cancelled: boolean;
  trackEndListeners: Array<{ track: MediaStreamTrack; listener: () => void }>;
  cleanupPromise: Promise<void> | null;
}

const OUTPUT_SAMPLE_RATE = 16_000;
const WORKLET_PROCESSOR_NAME = 'athena-pcm-capture';
const WORKLET_CHUNK_SIZE = 4_096;
const WORKLET_SOURCE = `
class AthenaPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(${WORKLET_CHUNK_SIZE});
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    let sourceOffset = 0;
    while (sourceOffset < input.length) {
      const count = Math.min(input.length - sourceOffset, this.chunk.length - this.offset);
      this.chunk.set(input.subarray(sourceOffset, sourceOffset + count), this.offset);
      this.offset += count;
      sourceOffset += count;

      if (this.offset === this.chunk.length) {
        const completed = this.chunk;
        this.port.postMessage(completed, [completed.buffer]);
        this.chunk = new Float32Array(${WORKLET_CHUNK_SIZE});
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('${WORKLET_PROCESSOR_NAME}', AthenaPcmCaptureProcessor);
`;

/**
 * Captures microphone PCM in the renderer and encodes it as a 16 kHz mono
 * 16-bit PCM WAV. Each instance owns at most one active recording session.
 */
export class MicrophoneRecorder {
  private readonly options: MicrophoneRecorderOptions;
  private currentState: MicrophoneRecorderState = 'idle';
  private session: RecordingSession | null = null;
  private nextSessionId = 1;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<Uint8Array> | null = null;
  private lastWav: Uint8Array | null = null;
  private lastDurationMs = 0;
  private lastDeviceLabel = '默认麦克风';

  constructor(options: MicrophoneRecorderOptions = {}) {
    this.options = options;
  }

  get state(): MicrophoneRecorderState {
    return this.currentState;
  }

  get durationMs(): number {
    return this.lastDurationMs;
  }

  get deviceLabel(): string {
    return this.lastDeviceLabel;
  }

  start(): Promise<void> {
    if (this.currentState === 'recording') {
      return Promise.resolve();
    }

    if (this.currentState === 'requesting' && this.startPromise) {
      return this.startPromise;
    }

    if (this.currentState === 'stopping' && this.stopPromise) {
      return this.stopPromise.then(
        () => this.start(),
        () => this.start(),
      );
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error('Microphone capture is not supported in this environment.'));
    }

    const session: RecordingSession = {
      id: this.nextSessionId++,
      stream: null,
      context: null,
      source: null,
      processor: null,
      silentGain: null,
      chunks: [],
      inputSampleRate: OUTPUT_SAMPLE_RATE,
      totalFrames: 0,
      active: false,
      cancelled: false,
      trackEndListeners: [],
      cleanupPromise: null,
    };

    this.lastWav = null;
    this.lastDurationMs = 0;
    this.session = session;
    this.setState('requesting');
    this.emitVolume(0);
    this.emitDuration(0);

    let pendingStart: Promise<void>;
    pendingStart = this.initializeSession(session).finally(() => {
      if (this.startPromise === pendingStart) {
        this.startPromise = null;
      }
    });
    this.startPromise = pendingStart;
    return pendingStart;
  }

  stop(): Promise<Uint8Array> {
    if (this.currentState === 'stopping' && this.stopPromise) {
      return this.stopPromise;
    }

    if (this.currentState === 'requesting' && this.startPromise) {
      return this.startPromise.then(() => this.stop());
    }

    if (this.currentState === 'idle') {
      if (this.lastWav) {
        return Promise.resolve(this.lastWav.slice());
      }
      return Promise.reject(new Error('The microphone is not recording.'));
    }

    const session = this.session;
    if (!session || !session.active) {
      return Promise.reject(new Error('The microphone recording session is unavailable.'));
    }

    session.active = false;
    this.setState('stopping');

    let pendingStop: Promise<Uint8Array>;
    pendingStop = this.finishSession(session).finally(() => {
      if (this.stopPromise === pendingStop) {
        this.stopPromise = null;
      }
    });
    this.stopPromise = pendingStop;
    return pendingStop;
  }

  async cancel(): Promise<void> {
    this.lastWav = null;
    const session = this.session;

    if (!session) {
      this.lastDurationMs = 0;
      this.setState('idle');
      this.emitVolume(0);
      this.emitDuration(0);
      return;
    }

    session.active = false;
    session.cancelled = true;
    if (this.session === session) {
      this.session = null;
    }

    this.lastDurationMs = 0;
    this.setState('idle');
    this.emitVolume(0);
    this.emitDuration(0);
    await cleanupSession(session);
  }

  private async initializeSession(session: RecordingSession): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (!this.owns(session)) {
        stopStream(stream);
        return;
      }

      session.stream = stream;

      if (typeof AudioContext === 'undefined') {
        throw new Error('Web Audio is not supported in this environment.');
      }

      const context = new AudioContext({ latencyHint: 'interactive' });
      const source = context.createMediaStreamSource(stream);
      const silentGain = context.createGain();

      session.context = context;
      session.source = source;
      session.silentGain = silentGain;
      session.inputSampleRate = context.sampleRate;

      if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
        throw new Error('AudioWorklet microphone capture is not supported in this environment.');
      }

      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      if (!this.owns(session)) {
        await cleanupSession(session);
        return;
      }

      const processor = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        outputChannelCount: [1],
      });
      session.processor = processor;
      silentGain.gain.value = 0;
      processor.port.onmessage = (event: MessageEvent<unknown>): void => {
        this.captureFrame(session, event.data);
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);

      await context.resume();

      if (!this.owns(session)) {
        await cleanupSession(session);
        return;
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0 || audioTracks.every(track => track.readyState === 'ended')) {
        throw new Error('The microphone audio track ended before recording could start.');
      }
      this.lastDeviceLabel = audioTracks.find(track => track.readyState === 'live')?.label || '默认麦克风';

      for (const track of audioTracks) {
        const listener = (): void => { void this.handleUnexpectedTrackEnd(session); };
        track.addEventListener('ended', listener, { once: true });
        session.trackEndListeners.push({ track, listener });
      }

      session.active = true;
      this.setState('recording');
    } catch (error) {
      await cleanupSession(session);

      if (!this.owns(session)) {
        return;
      }

      this.session = null;
      this.setState('idle');
      this.emitVolume(0);
      throw error;
    }
  }

  private captureFrame(session: RecordingSession, data: unknown): void {
    if (!this.owns(session) || !session.active || this.currentState !== 'recording') {
      return;
    }

    if (!(data instanceof Float32Array) || data.length === 0) return;
    const copy = data.slice();
    session.chunks.push(copy);
    session.totalFrames += copy.length;

    this.lastDurationMs = (session.totalFrames / session.inputSampleRate) * 1_000;
    this.emitDuration(this.lastDurationMs);
    this.emitVolume(calculateRms(copy));
  }

  private async finishSession(session: RecordingSession): Promise<Uint8Array> {
    await cleanupSession(session);

    if (session.cancelled) {
      throw new DOMException('The microphone recording was cancelled.', 'AbortError');
    }

    const pcm = concatenateChunks(session.chunks, session.totalFrames);
    const resampled = resampleMono(pcm, session.inputSampleRate, OUTPUT_SAMPLE_RATE);
    const wav = encodePcm16Wav(resampled, OUTPUT_SAMPLE_RATE);

    session.chunks = [];
    if (this.session === session) {
      this.session = null;
      this.lastWav = wav;
      this.setState('idle');
      this.emitVolume(0);
    }

    return wav.slice();
  }

  private owns(session: RecordingSession): boolean {
    return this.session === session && !session.cancelled;
  }

  private async handleUnexpectedTrackEnd(session: RecordingSession): Promise<void> {
    if (!this.owns(session) || (this.currentState !== 'recording' && this.currentState !== 'requesting')) {
      return;
    }

    session.active = false;
    session.cancelled = true;
    this.session = null;
    this.lastWav = null;
    this.lastDurationMs = 0;
    this.setState('idle');
    this.emitVolume(0);
    this.emitDuration(0);
    await cleanupSession(session);
    safelyNotify(() => this.options.onError?.(new Error('The microphone device disconnected.')));
  }

  private setState(state: MicrophoneRecorderState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    safelyNotify(() => this.options.onStateChange?.(state));
  }

  private emitVolume(level: number): void {
    safelyNotify(() => this.options.onVolume?.(level));
  }

  private emitDuration(durationMs: number): void {
    safelyNotify(() => this.options.onDuration?.(durationMs));
  }
}

async function cleanupSession(session: RecordingSession): Promise<void> {
  if (session.cleanupPromise) {
    return session.cleanupPromise;
  }

  session.cleanupPromise = (async (): Promise<void> => {
    session.active = false;

    const processor = session.processor;
    const source = session.source;
    const silentGain = session.silentGain;
    const context = session.context;
    const stream = session.stream;
    const trackEndListeners = session.trackEndListeners;

    session.processor = null;
    session.source = null;
    session.silentGain = null;
    session.context = null;
    session.stream = null;
    session.trackEndListeners = [];

    if (processor) {
      processor.port.onmessage = null;
      processor.port.close();
      safelyDisconnect(processor);
    }
    safelyDisconnect(source);
    safelyDisconnect(silentGain);
    for (const { track, listener } of trackEndListeners) {
      track.removeEventListener('ended', listener);
    }
    if (stream) stopStream(stream);

    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        // Resource cleanup is best effort after every node and track is detached.
      }
    }
  })();

  return session.cleanupPromise;
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track may already have ended or been stopped by the browser.
    }
  }
}

function safelyDisconnect(node: AudioNode | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // The node may already be disconnected.
  }
}

function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }

  return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

function concatenateChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
  const result = new Float32Array(totalFrames);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function resampleMono(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (input.length === 0 || inputRate <= 0 || outputRate <= 0) {
    return new Float32Array();
  }

  if (inputRate === outputRate) {
    return input.slice();
  }

  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);

  if (inputRate < outputRate) {
    const scale = inputRate / outputRate;
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * scale;
      const left = Math.min(input.length - 1, Math.floor(position));
      const right = Math.min(input.length - 1, left + 1);
      const fraction = position - left;
      output[index] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  const scale = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const start = index * scale;
    const end = Math.min(input.length, (index + 1) * scale);
    let cursor = start;
    let weightedSum = 0;
    let totalWeight = 0;

    while (cursor < end) {
      const sourceIndex = Math.min(input.length - 1, Math.floor(cursor));
      const nextBoundary = Math.min(end, sourceIndex + 1);
      const weight = nextBoundary - cursor;
      weightedSum += input[sourceIndex] * weight;
      totalWeight += weight;
      cursor = nextBoundary;
    }

    output[index] = totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  return output;
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(value), true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function safelyNotify(notify: () => void): void {
  try {
    notify();
  } catch {
    // Consumer callbacks must not interrupt capture or cleanup.
  }
}
