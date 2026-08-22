import type { AvatarLipSyncSettings } from '../../shared/types/avatar';
import {
  AvatarLipSyncController,
  type AvatarAudioLevelSource,
  type AvatarLipSyncControllerOptions,
} from './AvatarLipSyncController';

export interface AvatarFrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export interface AvatarRealtimeLipSyncControllerOptions extends AvatarLipSyncControllerOptions {
  scheduler?: AvatarFrameScheduler;
  onValue?: (value: number) => void;
}

export class AvatarRealtimeLipSyncController {
  private readonly controller: AvatarLipSyncController;
  private readonly scheduler: AvatarFrameScheduler;
  private frameHandle: number | null = null;
  private generation = 0;

  constructor(private readonly options: AvatarRealtimeLipSyncControllerOptions) {
    this.controller = new AvatarLipSyncController(options);
    this.scheduler = options.scheduler ?? browserFrameScheduler();
  }

  get value(): number {
    return this.controller.value;
  }

  get isRunning(): boolean {
    return this.controller.isRunning;
  }

  start(): void {
    if (this.controller.isRunning) return;
    this.controller.start();
    this.generation += 1;
    this.schedule(this.generation);
  }

  async stop(): Promise<void> {
    const wasRunning = this.controller.isRunning;
    this.generation += 1;
    if (this.frameHandle !== null) this.scheduler.cancel(this.frameHandle);
    this.frameHandle = null;
    if (!wasRunning) {
      this.controller.stop();
      return;
    }
    await this.controller.reset();
    this.options.onValue?.(0);
  }

  updateSettings(settings: AvatarLipSyncSettings): void {
    this.controller.updateSettings(settings);
  }

  private schedule(generation: number): void {
    this.frameHandle = this.scheduler.request(() => {
      this.frameHandle = null;
      void this.tick(generation);
    });
  }

  private async tick(generation: number): Promise<void> {
    if (generation !== this.generation || !this.controller.isRunning) return;
    const value = await this.controller.tick();
    if (generation !== this.generation || !this.controller.isRunning) return;
    this.options.onValue?.(value);
    this.schedule(generation);
  }
}

export class MutableAudioLevelSource implements AvatarAudioLevelSource {
  constructor(private source: AvatarAudioLevelSource) {}

  use(source: AvatarAudioLevelSource): void {
    this.source = source;
  }

  readLevel(): number {
    return this.source.readLevel();
  }
}

export function browserFrameScheduler(): AvatarFrameScheduler {
  if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
    throw new Error('Realtime lip sync requires requestAnimationFrame support.');
  }
  return {
    request: callback => requestAnimationFrame(callback),
    cancel: handle => cancelAnimationFrame(handle),
  };
}
