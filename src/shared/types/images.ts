export type ImageProviderId =
  | 'local'
  | 'openai'
  | 'google'
  | 'stability'
  | 'bfl'
  | 'volcengine'
  | 'dashscope'
  | 'replicate'
  | 'fal'
  | 'custom';

export type ImageCloudProvider = Exclude<ImageProviderId, 'local'>;
export type LocalImageBackend = 'auto' | 'cuda' | 'vulkan' | 'cpu';
export type LocalImageEngine = 'auto' | 'athena' | 'comfyui';
export type LocalImageProfile = 'fast' | 'balanced' | 'quality' | 'custom';
export type ImageCloudFallback = 'never' | 'ask';
export type LocalImageRuntimeVariantId = 'cuda12' | 'vulkan' | 'cpu';

export interface ImageRemoteProviderSettings {
  baseUrl: string;
  model: string;
}

export interface ImageGenerationSettings {
  provider: ImageProviderId;
  cloudFallback: ImageCloudFallback;
  local: {
    engine: LocalImageEngine;
    autoDiscover: boolean;
    runtimePath: string;
    modelPath: string;
    comfyuiBaseUrl: string;
    comfyuiCheckpoint: string;
    backend: LocalImageBackend;
    profile: LocalImageProfile;
    steps: number;
    cfgScale: number;
  };
  remote: Record<ImageCloudProvider, ImageRemoteProviderSettings>;
}

export interface ImageProviderDescriptor {
  id: ImageProviderId;
  label: string;
  kind: 'local' | 'direct' | 'aggregator' | 'compatible';
  credentialRequired: boolean;
  supportsEdit: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
  costHint: 'local' | 'low' | 'variable' | 'premium';
}

export interface ImageCredentialStatus {
  provider: ImageCloudProvider;
  configured: boolean;
  source: 'environment' | 'local-env-file' | 'windows-safe-storage' | 'none';
  encryptionAvailable: boolean;
}

export interface LocalImageRuntimeStatus {
  runtimeConfigured: boolean;
  modelConfigured: boolean;
  ready: boolean;
  runtimePath: string;
  modelPath: string;
  backend: LocalImageBackend;
  message: string;
}

export interface DiscoveredLocalImageModel {
  name: string;
  path: string;
  format: '.safetensors' | '.gguf' | '.ckpt' | '.pth' | '.pt';
  source: 'athena' | 'comfyui' | 'stability-matrix' | 'automatic1111' | 'forge' | 'fooocus' | 'other';
  bytes: number;
  role: 'checkpoint' | 'diffusion-model' | 'text-encoder' | 'vae' | 'unknown';
  standaloneCompatible: boolean;
}

export interface LocalImageDiscoverySnapshot {
  scannedAt: string;
  models: DiscoveredLocalImageModel[];
  comfyui: {
    installed: boolean;
    launchable: boolean;
    launcherLabel?: string;
    installedModelCount: number;
    installedWorkflows: Array<'checkpoint' | 'z-image-turbo'>;
    connected: boolean;
    baseUrl: string;
    checkpoints: string[];
    diffusionModels: string[];
    textEncoders: string[];
    vaes: string[];
    workflows: Array<'checkpoint' | 'z-image-turbo'>;
    error?: string;
  };
}

export interface LocalComfyUILaunchResult {
  started: boolean;
  connected: boolean;
  baseUrl?: string;
  message: string;
  snapshot?: LocalImageDiscoverySnapshot;
}

export interface LocalImageRuntimeVariant {
  id: LocalImageRuntimeVariantId;
  label: string;
  backend: Exclude<LocalImageBackend, 'auto'>;
  archiveName: string;
  downloadUrl: string;
  downloadBytes: number;
  sha256: string;
  releaseTag: string;
  recommendedFor: string;
}

export interface LocalImageRuntimeInstallProgress {
  variant: LocalImageRuntimeVariantId;
  phase: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'complete' | 'failed' | 'cancelled';
  downloadedBytes: number;
  totalBytes: number;
  message: string;
}

export interface LocalImageRuntimeInstallResult {
  variant: LocalImageRuntimeVariantId;
  backend: Exclude<LocalImageBackend, 'auto'>;
  runtimePath: string;
  installRoot: string;
  reused: boolean;
}
