import type { AvatarAdapter } from './AvatarRuntime';
import type { AvatarLipSyncSettings } from '../../shared/types/avatar';

export interface AvatarAudioLevelSource {
  readLevel(): number;
}

export interface AvatarLipSyncControllerOptions {
  settings: AvatarLipSyncSettings;
  adapter: Pick<AvatarAdapter, 'setParameter'>;
  audioSource: AvatarAudioLevelSource;
  now?: () => number;
}

export class AvatarLipSyncController {
  private readonly now: () => number;
  private lastUpdatedAt: number | null = null;
  private currentValue = 0;
  private running = false;

  constructor(private readonly options: AvatarLipSyncControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.running = true;
    this.lastUpdatedAt = null;
    this.currentValue = 0;
  }

  stop(): void {
    this.running = false;
    this.lastUpdatedAt = null;
    this.currentValue = 0;
  }

  get value(): number {
    return this.currentValue;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async tick(): Promise<number> {
    const settings = this.options.settings;
    if (!this.running || !settings.enabled || settings.parameterIds.length === 0) return this.currentValue;

    const now = this.now();
    const deltaMs = this.lastUpdatedAt === null ? 16 : Math.max(1, now - this.lastUpdatedAt);
    this.lastUpdatedAt = now;

    const rawLevel = clamp01(this.options.audioSource.readLevel());
    const target = scaleLevel(rawLevel, settings);
    const timeConstant = target > this.currentValue ? settings.attackMs : settings.releaseMs;
    const smoothing = smoothingFactor(deltaMs, timeConstant, settings.smoothing);
    this.currentValue = clamp(settings.minValue + ((target - settings.minValue) * smoothing) + ((this.currentValue - settings.minValue) * (1 - smoothing)), settings.minValue, settings.maxValue);

    await Promise.all(settings.parameterIds.map(parameterId => this.options.adapter.setParameter(parameterId, this.currentValue)));
    return this.currentValue;
  }
}

export class StaticAudioLevelSource implements AvatarAudioLevelSource {
  constructor(private level = 0) {}

  setLevel(level: number): void {
    this.level = level;
  }

  readLevel(): number {
    return this.level;
  }
}

export class WebAudioAnalyserLevelSource implements AvatarAudioLevelSource {
  private readonly samples: Uint8Array<ArrayBuffer>;

  constructor(private readonly analyser: AnalyserNode) {
    this.samples = new Uint8Array(new ArrayBuffer(Math.max(1, analyser.frequencyBinCount)));
  }

  readLevel(): number {
    this.analyser.getByteTimeDomainData(this.samples);
    let sumSquares = 0;
    for (const sample of this.samples) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }
    return clamp01(Math.sqrt(sumSquares / this.samples.length));
  }
}

function scaleLevel(level: number, settings: AvatarLipSyncSettings): number {
  const normalized = clamp01(level * settings.gain * settings.sensitivity);
  return clamp(settings.minValue + normalized * (settings.maxValue - settings.minValue), settings.minValue, settings.maxValue);
}

function smoothingFactor(deltaMs: number, timeConstantMs: number, userSmoothing: number): number {
  const safeTime = Math.max(1, timeConstantMs);
  const base = 1 - Math.exp(-deltaMs / safeTime);
  const smoothing = clamp01(userSmoothing);
  return clamp01(base * (1 - smoothing) + base * 0.25 * smoothing);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
