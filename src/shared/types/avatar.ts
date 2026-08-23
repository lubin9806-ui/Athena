import type { EmotionType } from './emotion';

export type AvatarProvider = 'none' | 'mock' | 'live2d' | 'vrm' | 'gltf';

export type AvatarLayoutMode =
  | 'chat_right'
  | 'chat_background'
  | 'draggable_overlay'
  | 'desktop_pet';

export type AvatarState =
  | 'unloaded'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'streaming'
  | 'speaking'
  | 'interrupted'
  | 'error'
  | 'sleepy'
  | 'away';

export type AvatarMotionPriority = 'idle' | 'normal' | 'focused' | 'urgent';

export type AvatarClickThroughMode = 'off' | 'transparentOnly' | 'full';

export type AvatarExternalControlTransport = 'disabled' | 'localWebSocket';

export type AvatarInteractionMode = 'normal' | 'private_opt_in';

export type AvatarHotZoneSensitivity =
  | 'neutral'
  | 'affectionate'
  | 'sensitive'
  | 'private';

export type AvatarHotZoneActionType =
  | 'none'
  | 'athenaReply'
  | 'playMotion'
  | 'setExpression'
  | 'setState'
  | 'composite';

export type AvatarPackageSource = 'localDirectory' | 'localPackage' | 'marketplace';

export interface AvatarPoint {
  x: number;
  y: number;
}

export interface AvatarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AvatarTransform {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotationDeg: number;
  mirrored: boolean;
}

export interface AvatarLayoutSettings {
  mode: AvatarLayoutMode;
  transform: AvatarTransform;
  alwaysOnTop: boolean;
  clickThroughMode: AvatarClickThroughMode;
  transparentBackground: boolean;
  lockPosition: boolean;
  bounds?: AvatarRect;
}

export interface AvatarModelSource {
  source: AvatarPackageSource;
  rootPath: string;
  model3JsonPath?: string;
  modelPath?: string;
  packageId?: string;
  packageVersion?: string;
}

export interface AvatarModelAssetInventory {
  expressions: string[];
  motionGroups: Record<string, string[]>;
  parameters: string[];
  lipSyncParameters: string[];
  eyeBlinkParameters: string[];
  hitAreas: string[];
  physicsFile?: string;
  poseFile?: string;
  userDataFile?: string;
}

export interface AvatarExpressionMapping {
  emotion: EmotionType;
  expressionId: string;
  intensityScale: number;
  fallbackExpressionId?: string;
}

export interface AvatarMotionMapping {
  state: AvatarState;
  motionGroup: string;
  motionId?: string;
  priority: AvatarMotionPriority;
  loop: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  fallbackMotionGroup?: string;
}

export interface AvatarParameterBinding {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  favorite: boolean;
}

export interface AvatarLipSyncSettings {
  enabled: boolean;
  source: 'ttsAudio' | 'microphonePreview' | 'manual';
  parameterIds: string[];
  sensitivity: number;
  smoothing: number;
  gain: number;
  attackMs: number;
  releaseMs: number;
  minValue: number;
  maxValue: number;
}

export interface AvatarPointerTrackingSettings {
  enabled: boolean;
  headParameterIds: string[];
  eyeParameterIds: string[];
  strength: number;
  smoothing: number;
}

export interface AvatarIdleSettings {
  enabled: boolean;
  idleDelayMs: number;
  sleepyDelayMs: number;
  awayDelayMs: number;
  motionGroups: string[];
  randomize: boolean;
}

export interface AvatarHotZoneAction {
  type: AvatarHotZoneActionType;
  promptTemplate?: string;
  motionGroup?: string;
  motionId?: string;
  expressionId?: string;
  state?: AvatarState;
  actions?: AvatarHotZoneAction[];
}

export interface AvatarHotZoneInteractionContract {
  bodyPart: string;
  sensitivity: AvatarHotZoneSensitivity;
  privateModeAllowed: boolean;
  modelReplyDelegated: boolean;
  normalModeBoundary: string;
  privateModeBoundary?: string;
  motionIntent: string;
}

export interface AvatarHotZone {
  id: string;
  label: string;
  hitAreaName?: string;
  rect?: AvatarRect;
  interaction?: AvatarHotZoneInteractionContract;
  action: AvatarHotZoneAction;
  cooldownMs: number;
  enabled: boolean;
}

export interface AvatarExternalControlSettings {
  transport: AvatarExternalControlTransport;
  enabled: boolean;
  host: '127.0.0.1';
  port: number;
  requireToken: boolean;
  allowedCommandTypes: string[];
  auditEnabled: boolean;
}

export interface AvatarMarketplaceInfo {
  packageId: string;
  version: string;
  displayName: string;
  author?: string;
  license?: string;
  homepage?: string;
  previewImagePath?: string;
  tags: string[];
  sourceUrl?: string;
}

export interface AvatarInteractionPolicy {
  defaultMode: AvatarInteractionMode;
  privateModeRequiresExplicitOptIn: boolean;
  replyDelegatedToPersona: boolean;
  normalModePrompt: string;
  privateModePrompt: string;
  forbiddenPublicAssetTypes: string[];
}

export interface AvatarCharacterProfile {
  id: string;
  displayName: string;
  provider: AvatarProvider;
  enabled: boolean;
  model: AvatarModelSource;
  marketplace?: AvatarMarketplaceInfo;
  inventory?: AvatarModelAssetInventory;
  layout: AvatarLayoutSettings;
  expressions: AvatarExpressionMapping[];
  motions: AvatarMotionMapping[];
  parameters: AvatarParameterBinding[];
  lipSync: AvatarLipSyncSettings;
  pointerTracking: AvatarPointerTrackingSettings;
  idle: AvatarIdleSettings;
  interactionPolicy?: AvatarInteractionPolicy;
  hotZones: AvatarHotZone[];
  externalControl: AvatarExternalControlSettings;
  notes?: string;
}

export interface AvatarRuntimeEvent {
  type:
    | 'avatar.load'
    | 'avatar.unload'
    | 'avatar.state'
    | 'avatar.expression'
    | 'avatar.motion'
    | 'avatar.parameter'
    | 'avatar.pointer'
    | 'avatar.hotZone'
    | 'avatar.error';
  characterId: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface AvatarStateSnapshot {
  characterId: string;
  provider: AvatarProvider;
  loaded: boolean;
  state: AvatarState;
  expressionId?: string;
  motionGroup?: string;
  motionId?: string;
  lipSyncActive: boolean;
  pointer?: AvatarPoint;
  error?: string;
}

export interface AvatarExternalCommand {
  type: string;
  characterId: string;
  priority?: number;
  ttlMs?: number;
  payload?: Record<string, unknown>;
}
