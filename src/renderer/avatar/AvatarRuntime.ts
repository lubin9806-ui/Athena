import type {
  AvatarCharacterProfile,
  AvatarExpressionMapping,
  AvatarHotZone,
  AvatarHotZoneAction,
  AvatarMotionMapping,
  AvatarPoint,
  AvatarRuntimeEvent,
  AvatarState,
  AvatarStateSnapshot,
} from '../../shared/types/avatar';
import type { EmotionType } from '../../shared/types/emotion';

export type AvatarRuntimeEventHandler = (event: AvatarRuntimeEvent) => void;

export type AthenaAvatarEvent =
  | { type: 'app.ready' }
  | { type: 'voice.listening.start' }
  | { type: 'voice.listening.end' }
  | { type: 'chat.thinking.start' }
  | { type: 'chat.streaming.start' }
  | { type: 'voice.speaking.start' }
  | { type: 'voice.speaking.end' }
  | { type: 'chat.interrupted' }
  | { type: 'chat.error'; message: string }
  | { type: 'activity.idle' }
  | { type: 'activity.sleepy' }
  | { type: 'activity.away' }
  | { type: 'emotion.update'; emotion: EmotionType; intensity?: number }
  | { type: 'pointer.move'; point: AvatarPoint }
  | { type: 'hotZone.trigger'; hotZoneId: string };

export interface AvatarAdapter {
  load(profile: AvatarCharacterProfile): Promise<void>;
  unload(): Promise<void>;
  setState(state: AvatarState): Promise<void>;
  setExpression(expressionId: string, intensity?: number): Promise<void>;
  playMotion(mapping: AvatarMotionMapping): Promise<void>;
  setParameter(parameterId: string, value: number): Promise<void>;
  updatePointer(point: AvatarPoint): Promise<void>;
  getSnapshot(): AvatarStateSnapshot;
}

export interface AvatarRuntimeOptions {
  now?: () => string;
}

export class AvatarRuntime {
  private profile: AvatarCharacterProfile | null = null;
  private readonly subscribers = new Set<AvatarRuntimeEventHandler>();
  private readonly now: () => string;

  constructor(private readonly adapter: AvatarAdapter, options: AvatarRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async load(profile: AvatarCharacterProfile): Promise<void> {
    this.profile = profile;
    await this.adapter.load(profile);
    this.emit('avatar.load', { provider: profile.provider });
    await this.applyState('idle');
  }

  async unload(): Promise<void> {
    const characterId = this.profile?.id || this.adapter.getSnapshot().characterId;
    await this.adapter.unload();
    this.emit('avatar.unload', { characterId });
    this.profile = null;
  }

  subscribe(handler: AvatarRuntimeEventHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  getSnapshot(): AvatarStateSnapshot {
    return this.adapter.getSnapshot();
  }

  async dispatch(event: AthenaAvatarEvent): Promise<AvatarHotZoneAction | null> {
    switch (event.type) {
      case 'app.ready':
      case 'voice.listening.end':
      case 'voice.speaking.end':
      case 'activity.idle':
        await this.applyState('idle');
        return null;
      case 'voice.listening.start':
        await this.applyState('listening');
        return null;
      case 'chat.thinking.start':
        await this.applyState('thinking');
        return null;
      case 'chat.streaming.start':
        await this.applyState('streaming');
        return null;
      case 'voice.speaking.start':
        await this.applyState('speaking');
        return null;
      case 'chat.interrupted':
        await this.applyState('interrupted');
        return null;
      case 'chat.error':
        await this.applyState('error');
        this.emit('avatar.error', { message: event.message });
        return null;
      case 'activity.sleepy':
        await this.applyState('sleepy');
        return null;
      case 'activity.away':
        await this.applyState('away');
        return null;
      case 'emotion.update':
        await this.applyEmotion(event.emotion, event.intensity);
        return null;
      case 'pointer.move':
        await this.adapter.updatePointer(event.point);
        this.emit('avatar.pointer', { point: event.point });
        return null;
      case 'hotZone.trigger':
        return this.triggerHotZone(event.hotZoneId);
      default:
        return assertNever(event);
    }
  }

  private async applyState(state: AvatarState): Promise<void> {
    await this.adapter.setState(state);
    const motion = this.findMotionForState(state);
    if (motion) {
      await this.adapter.playMotion(motion);
      this.emit('avatar.motion', { state, motionGroup: motion.motionGroup, motionId: motion.motionId });
    }
    this.emit('avatar.state', { state });
  }

  private async applyEmotion(emotion: EmotionType, intensity = 1): Promise<void> {
    const mapping = this.findExpressionForEmotion(emotion);
    if (!mapping) return;
    const resolvedIntensity = clamp01(intensity * mapping.intensityScale);
    await this.adapter.setExpression(mapping.expressionId, resolvedIntensity);
    this.emit('avatar.expression', {
      emotion,
      expressionId: mapping.expressionId,
      intensity: resolvedIntensity,
    });
  }

  private triggerHotZone(hotZoneId: string): AvatarHotZoneAction | null {
    const hotZone = this.profile?.hotZones.find(item => item.id === hotZoneId && item.enabled);
    if (!hotZone) return null;
    this.emit('avatar.hotZone', { hotZoneId, actionType: hotZone.action.type });
    return cloneAction(hotZone).action;
  }

  private findExpressionForEmotion(emotion: EmotionType): AvatarExpressionMapping | null {
    return this.profile?.expressions.find(item => item.emotion === emotion) || null;
  }

  private findMotionForState(state: AvatarState): AvatarMotionMapping | null {
    const motions = this.profile?.motions || [];
    return motions.find(item => item.state === state) || null;
  }

  private emit(type: AvatarRuntimeEvent['type'], payload?: Record<string, unknown>): void {
    const characterId = this.profile?.id || this.adapter.getSnapshot().characterId || 'unloaded';
    const event: AvatarRuntimeEvent = {
      type,
      characterId,
      occurredAt: this.now(),
      ...(payload ? { payload } : {}),
    };
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

function cloneAction(hotZone: AvatarHotZone): AvatarHotZone {
  return {
    ...hotZone,
    action: {
      ...hotZone.action,
      actions: hotZone.action.actions?.map(action => ({ ...action })),
    },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled avatar event: ${JSON.stringify(value)}`);
}

