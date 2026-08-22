import type {
  AvatarMotionMapping,
  AvatarPoint,
  AvatarProvider,
} from '../../../shared/types/avatar';

export interface ThreeAvatarHostLoadOptions {
  canvas: HTMLCanvasElement;
  modelUrl: string;
  rootUrl: string;
  format: Extract<AvatarProvider, 'gltf' | 'vrm'>;
  transparentBackground: boolean;
}

export interface ThreeAvatarHost {
  load(options: ThreeAvatarHostLoadOptions): Promise<void>;
  unload(): Promise<void>;
  setState(state: string): Promise<void>;
  setExpression(expressionId: string, intensity: number): Promise<void>;
  playMotion(mapping: AvatarMotionMapping): Promise<void>;
  setParameter(parameterId: string, value: number): Promise<void>;
  updatePointer(point: AvatarPoint): Promise<void>;
}

export class MissingThreeAvatarHost implements ThreeAvatarHost {
  async load(): Promise<void> {
    throw new Error('Three avatar host is not configured. Wire BrowserThreeAvatarHost before loading a real GLTF or VRM model.');
  }

  async unload(): Promise<void> {}

  async setState(): Promise<void> {}

  async setExpression(): Promise<void> {}

  async playMotion(): Promise<void> {}

  async setParameter(): Promise<void> {}

  async updatePointer(): Promise<void> {}
}
