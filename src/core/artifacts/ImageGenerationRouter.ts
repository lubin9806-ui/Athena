import type { ImageCloudProvider, ImageGenerationSettings, ImageProviderDescriptor, LocalImageRuntimeStatus } from '../../shared/types';
import { getImageCredentialStatus, resolveImageCredential } from '../ai/CredentialStore';
import { imageProviderDescriptor, IMAGE_PROVIDER_DESCRIPTORS } from './ImageProviderCatalog';
import { LocalImageGenerationProvider } from './LocalImageGenerationProvider';
import { LocalImageDiscoveryService } from './LocalImageDiscoveryService';
import { ComfyUIImageGenerationProvider } from './ComfyUIImageGenerationProvider';
import { OpenAIImageGenerationProvider, type GeneratedImage, type ImageEditRequest, type ImageGenerationProvider, type ImageGenerationRequest } from './OpenAIImageGenerationProvider';
import {
  BflImageGenerationProvider,
  DashScopeImageGenerationProvider,
  FalImageGenerationProvider,
  GoogleImageGenerationProvider,
  OpenAICompatibleImageGenerationProvider,
  ReplicateImageGenerationProvider,
  StabilityImageGenerationProvider,
} from './RemoteImageGenerationProviders';

export interface ImageGenerationRouterOptions {
  settingsResolver: () => ImageGenerationSettings;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
  fetcher?: typeof fetch;
}

export class ImageGenerationRouter implements ImageGenerationProvider {
  private readonly local: LocalImageGenerationProvider;
  private readonly discovery = new LocalImageDiscoveryService();

  constructor(private readonly options: ImageGenerationRouterOptions) {
    this.local = new LocalImageGenerationProvider({
      settingsResolver: options.settingsResolver,
      decodeValidator: options.decodeValidator,
    });
  }

  descriptors(): readonly ImageProviderDescriptor[] {
    return IMAGE_PROVIDER_DESCRIPTORS;
  }

  selectedDescriptor(): ImageProviderDescriptor {
    return imageProviderDescriptor(this.options.settingsResolver().provider);
  }

  isNetworkProvider(): boolean {
    return this.options.settingsResolver().provider !== 'local';
  }

  isAvailable(): boolean {
    const settings = this.options.settingsResolver();
    if (settings.provider === 'local') {
      const standalone = this.local.status();
      const discovered = this.discovery.snapshot();
      const standaloneReady = standalone.runtimeConfigured && (standalone.modelConfigured || Boolean(discovered?.models.some(model => model.standaloneCompatible)));
      const comfyReady = discovered?.comfyui.connected === true && discovered.comfyui.workflows.length > 0;
      if (settings.local.engine === 'athena') return standaloneReady;
      if (settings.local.engine === 'comfyui') return comfyReady;
      return standaloneReady || comfyReady;
    }
    const remote = settings.remote[settings.provider];
    return Boolean(remote.baseUrl.trim() && remote.model.trim() && getImageCredentialStatus(settings.provider).configured);
  }

  supportsEditing(): boolean {
    return this.selectedDescriptor().supportsEdit;
  }

  localStatus(): LocalImageRuntimeStatus {
    return this.local.status();
  }

  localDiscovery() {
    return this.discovery.snapshot();
  }

  async refreshLocalDiscovery(signal: AbortSignal = AbortSignal.timeout(8_000)) {
    return this.discovery.refresh(this.options.settingsResolver(), signal);
  }

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    try {
      if (this.options.settingsResolver().provider === 'local') return await this.generateLocal(request, signal);
      return await this.provider().generate(request, signal);
    } catch (error) {
      throw this.providerFailure(error);
    }
  }

  async edit(request: ImageEditRequest, signal: AbortSignal): Promise<GeneratedImage> {
    try {
      if (this.options.settingsResolver().provider === 'local') throw new Error('当前本地通道暂不支持图片编辑。');
      const provider = this.provider();
      if (!provider.edit) throw new Error(`${this.selectedDescriptor().label} 当前不支持图片编辑。`);
      return await provider.edit(request, signal);
    } catch (error) {
      throw this.providerFailure(error);
    }
  }

  private providerFailure(error: unknown): Error {
    const original = error instanceof Error ? error : new Error(String(error));
    const settings = this.options.settingsResolver();
    if (settings.provider === 'local' || settings.cloudFallback !== 'ask') return original;
    return new Error(`${original.message} Athena 没有自动切换或重试付费通道；如需改用其他通道，请在图像生成设置中手动选择后重试。`);
  }

  private async generateLocal(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.options.settingsResolver();
    const snapshot = settings.local.autoDiscover || settings.local.engine !== 'athena'
      ? await this.discovery.refresh(settings, signal)
      : this.discovery.snapshot();
    const standaloneStatus = this.local.status();
    const discoveredModel = snapshot?.models.find(model => model.standaloneCompatible)?.path || '';
    const standaloneReady = standaloneStatus.runtimeConfigured && (standaloneStatus.modelConfigured || Boolean(discoveredModel));
    const comfyReady = snapshot?.comfyui.connected === true && snapshot.comfyui.workflows.length > 0;
    const useComfy = settings.local.engine === 'comfyui' || (settings.local.engine === 'auto' && !standaloneReady && comfyReady);
    if (useComfy) {
      if (!snapshot) throw new Error('尚未完成本地生图环境扫描。');
      return new ComfyUIImageGenerationProvider({
        baseUrl: settings.local.comfyuiBaseUrl,
        checkpoint: settings.local.comfyuiCheckpoint,
        discoveryResolver: async () => snapshot,
        decodeValidator: this.options.decodeValidator,
        ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
      }).generate(request, signal);
    }
    if (!standaloneReady) {
      if (settings.local.engine === 'comfyui') throw new Error('ComfyUI 未连接，或没有可用的完整 checkpoint / 受支持拆分模型工作流。');
      throw new Error('没有发现可直接使用的 Athena 独立引擎与本地模型，也没有连接到可用的 ComfyUI。');
    }
    const effectiveSettings = discoveredModel && !settings.local.modelPath.trim()
      ? { ...settings, local: { ...settings.local, modelPath: discoveredModel } }
      : settings;
    return new LocalImageGenerationProvider({
      settingsResolver: () => effectiveSettings,
      decodeValidator: this.options.decodeValidator,
    }).generate(request, signal);
  }

  private provider(): ImageGenerationProvider {
    const settings = this.options.settingsResolver();
    if (settings.provider === 'local') return this.local;
    const remote = settings.remote[settings.provider];
    const base = {
      provider: settings.provider,
      settingsResolver: () => remote,
      credentialResolver: () => resolveImageCredential(settings.provider as ImageCloudProvider),
      decodeValidator: this.options.decodeValidator,
      ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
    };
    switch (settings.provider) {
      case 'openai':
        return new OpenAIImageGenerationProvider({
          credentialResolver: base.credentialResolver,
          decodeValidator: base.decodeValidator,
          model: remote.model,
          ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
        });
      case 'google': return new GoogleImageGenerationProvider(base);
      case 'stability': return new StabilityImageGenerationProvider(base);
      case 'bfl': return new BflImageGenerationProvider(base);
      case 'dashscope': return new DashScopeImageGenerationProvider(base);
      case 'replicate': return new ReplicateImageGenerationProvider(base);
      case 'fal': return new FalImageGenerationProvider(base);
      case 'volcengine':
      case 'custom':
        return new OpenAICompatibleImageGenerationProvider(base);
      default:
        throw new Error(`Unsupported image provider: ${String(settings.provider)}`);
    }
  }
}
