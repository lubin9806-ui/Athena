import type {
  AvatarMotionMapping,
  AvatarPoint,
} from '../../../shared/types/avatar';

export interface Live2DHostLoadOptions {
  canvas: HTMLCanvasElement;
  modelUrl: string;
  rootUrl: string;
}

export interface Live2DHost {
  load(options: Live2DHostLoadOptions): Promise<void>;
  unload(): Promise<void>;
  setExpression(expressionId: string, intensity: number): Promise<void>;
  playMotion(mapping: AvatarMotionMapping): Promise<void>;
  setParameter(parameterId: string, value: number): Promise<void>;
  setAppearancePreset?(presetId: string): Promise<void>;
  getAppearancePresetIds?(): string[];
  updatePointer(point: AvatarPoint): Promise<void>;
  hitTestCanvasPoint?(point: AvatarPoint): string[];
}

export class MissingLive2DHost implements Live2DHost {
  async load(): Promise<void> {
    throw new Error('Live2D host is not configured. Install and wire the Cubism Web host before loading a real model.');
  }

  async unload(): Promise<void> {}

  async setExpression(): Promise<void> {}

  async playMotion(): Promise<void> {}

  async setParameter(): Promise<void> {}

  async updatePointer(): Promise<void> {}
}
