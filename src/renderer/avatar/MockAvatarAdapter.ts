import type {
  AvatarCharacterProfile,
  AvatarMotionMapping,
  AvatarPoint,
  AvatarProvider,
  AvatarState,
  AvatarStateSnapshot,
} from '../../shared/types/avatar';
import type { AvatarAdapter } from './AvatarRuntime';

export interface MockAvatarActionLog {
  type: string;
  value?: string | number | AvatarPoint;
}

export class MockAvatarAdapter implements AvatarAdapter {
  readonly actions: MockAvatarActionLog[] = [];

  private snapshot: AvatarStateSnapshot = {
    characterId: 'unloaded',
    provider: 'mock',
    loaded: false,
    state: 'unloaded',
    lipSyncActive: false,
  };

  async load(profile: AvatarCharacterProfile): Promise<void> {
    this.snapshot = {
      characterId: profile.id,
      provider: profile.provider as AvatarProvider,
      loaded: true,
      state: 'idle',
      lipSyncActive: false,
    };
    this.actions.push({ type: 'load', value: profile.id });
  }

  async unload(): Promise<void> {
    this.actions.push({ type: 'unload', value: this.snapshot.characterId });
    this.snapshot = {
      characterId: 'unloaded',
      provider: 'mock',
      loaded: false,
      state: 'unloaded',
      lipSyncActive: false,
    };
  }

  async setState(state: AvatarState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      state,
      lipSyncActive: state === 'speaking',
    };
    this.actions.push({ type: 'state', value: state });
  }

  async setExpression(expressionId: string): Promise<void> {
    this.snapshot = { ...this.snapshot, expressionId };
    this.actions.push({ type: 'expression', value: expressionId });
  }

  async playMotion(mapping: AvatarMotionMapping): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      motionGroup: mapping.motionGroup,
      motionId: mapping.motionId,
    };
    this.actions.push({ type: 'motion', value: mapping.motionId || mapping.motionGroup });
  }

  async setParameter(parameterId: string, value: number): Promise<void> {
    this.actions.push({ type: `parameter:${parameterId}`, value });
  }

  async updatePointer(point: AvatarPoint): Promise<void> {
    this.snapshot = { ...this.snapshot, pointer: point };
    this.actions.push({ type: 'pointer', value: point });
  }

  getSnapshot(): AvatarStateSnapshot {
    return {
      ...this.snapshot,
      pointer: this.snapshot.pointer ? { ...this.snapshot.pointer } : undefined,
    };
  }
}

