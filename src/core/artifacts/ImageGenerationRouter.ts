import type {
  ImageCloudProvider,
  ImageGenerationSettings,
  ImageProviderDescriptor,
  LocalImageDiscoverySnapshot,
  LocalImageRuntimeStatus,
} from '../../shared/types';
import { getImageCredentialStatus, resolveImageCredential } from '../ai/CredentialStore';
import { imageProviderDescriptor, IMAGE_PROVIDER_DESCRIPTORS } from './ImageProviderCatalog';
import { LocalImageGenerationProvider } from './LocalImageGenerationProvider';
import {
  comfyUnresponsiveMessage,
  findComfyUILaunchTarget,
  LocalImageDiscoveryService,
  waitForComfyUIConnection,
} from './LocalImageDiscoveryService';
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

/** A cold Comfy Desktop start loads Python, custom nodes and the manager before it listens. */
const COMFY_STARTUP_TIMEOUT_MS = 3 * 60_000;

export interface LocalEngineLauncher {
  path: string;
  label: string;
}

export interface ImageGenerationRouterOptions {
  settingsResolver: () => ImageGenerationSettings;
  decodeValidator: (bytes: Buffer) => { width: number; height: number };
  fetcher?: typeof fetch;
  /**
   * Opens the local engine's own app and resolves to '' on success or the reason
   * it could not - the shape of Electron's `shell.openPath`. Without it a stopped
   * ComfyUI is reported, not started.
   */
  launchLocalEngine?: (target: LocalEngineLauncher) => Promise<string>;
  /** Seams for the regression; production uses the real discovery, search and wait. */
  discovery?: LocalImageDiscoveryService;
  resolveLauncher?: () => LocalEngineLauncher | null;
  waitForComfyUI?: (baseUrl: string, timeoutMs: number) => Promise<string | null>;
  comfyStartupTimeoutMs?: number;
}

interface LocalEngineState {
  standaloneReady: boolean;
  comfyReady: boolean;
  /** ComfyUI is answering, busy, or stopped but startable: `generate` has something to do. */
  comfyWorthTrying: boolean;
}

export class ImageGenerationRouter implements ImageGenerationProvider {
  private readonly local: LocalImageGenerationProvider;
  private readonly discovery: LocalImageDiscoveryService;
  private comfyStartup: Promise<string | null> | null = null;

  constructor(private readonly options: ImageGenerationRouterOptions) {
    this.discovery = options.discovery ?? new LocalImageDiscoveryService();
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

  /**
   * Whether there is anything to try - not whether an engine answered this second.
   *
   * A stopped ComfyUI that Athena can start, or a busy one that is not answering,
   * still goes to `generate`, which starts the first and explains the second.
   * Calling both "not set up" sent the user to the settings panel for an engine
   * that was installed and one launch away from working.
   */
  isAvailable(): boolean {
    const settings = this.options.settingsResolver();
    if (settings.provider === 'local') {
      const state = this.localEngineState(settings, this.discovery.snapshot());
      if (settings.local.engine === 'athena') return state.standaloneReady;
      if (settings.local.engine === 'comfyui') return state.comfyWorthTrying;
      return state.standaloneReady || state.comfyWorthTrying;
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

  private localEngineState(settings: ImageGenerationSettings, snapshot: LocalImageDiscoverySnapshot | null): LocalEngineState {
    const standalone = this.local.status();
    const standaloneReady = standalone.runtimeConfigured
      && (standalone.modelConfigured || Boolean(snapshot?.models.some(model => model.standaloneCompatible)));
    const comfy = snapshot?.comfyui;
    const comfyReady = comfy?.connected === true && comfy.workflows.length > 0;
    const startable = comfy?.launchable === true && Boolean(this.options.launchLocalEngine);
    return {
      standaloneReady,
      comfyReady,
      comfyWorthTrying: comfy?.connected === true || comfy?.reachability === 'unresponsive' || startable,
    };
  }

  private async generateLocal(request: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const settings = this.options.settingsResolver();
    let snapshot = settings.local.autoDiscover || settings.local.engine !== 'athena'
      ? await this.discovery.refresh(settings, signal)
      : this.discovery.snapshot();
    let state = this.localEngineState(settings, snapshot);
    const comfyWanted = settings.local.engine === 'comfyui' || (settings.local.engine === 'auto' && !state.standaloneReady);
    if (comfyWanted && snapshot && !snapshot.comfyui.connected) {
      snapshot = await this.bringUpComfyUI(settings, snapshot, signal, request.onProgress);
      state = this.localEngineState(settings, snapshot);
    }
    const useComfy = settings.local.engine === 'comfyui' || (settings.local.engine === 'auto' && !state.standaloneReady && state.comfyReady);
    if (useComfy) {
      if (!snapshot) throw new Error('尚未完成本地生图环境扫描。');
      const ready = snapshot;
      return new ComfyUIImageGenerationProvider({
        baseUrl: settings.local.comfyuiBaseUrl,
        checkpoint: settings.local.comfyuiCheckpoint,
        discoveryResolver: async () => ready,
        decodeValidator: this.options.decodeValidator,
        ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
      }).generate(request, signal);
    }
    if (!state.standaloneReady) {
      if (settings.local.engine === 'comfyui') throw new Error('ComfyUI 未连接，或没有可用的完整 checkpoint / 受支持拆分模型工作流。');
      throw new Error('没有发现可直接使用的 Athena 独立引擎与本地模型，也没有连接到可用的 ComfyUI。');
    }
    const discoveredModel = snapshot?.models.find(model => model.standaloneCompatible)?.path || '';
    const effectiveSettings = discoveredModel && !settings.local.modelPath.trim()
      ? { ...settings, local: { ...settings.local, modelPath: discoveredModel } }
      : settings;
    return new LocalImageGenerationProvider({
      settingsResolver: () => effectiveSettings,
      decodeValidator: this.options.decodeValidator,
    }).generate(request, signal);
  }

  /**
   * Gets ComfyUI answering before the picture is asked of it.
   *
   * On 2026-09-11 the user opened Comfy Desktop and asked for the picture nineteen
   * seconds later; Python had not even started, the check failed, and the run
   * concluded Athena could not draw. A stopped engine Athena knows how to start is
   * started and waited for. A busy one is not restarted - it may be halfway through
   * someone's render - it is reported as busy.
   */
  private async bringUpComfyUI(
    settings: ImageGenerationSettings,
    snapshot: LocalImageDiscoverySnapshot,
    signal: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<LocalImageDiscoverySnapshot> {
    if (snapshot.comfyui.reachability === 'unresponsive') {
      throw new Error(comfyUnresponsiveMessage(snapshot.comfyui.baseUrl));
    }
    const launcher = (this.options.resolveLauncher ?? findComfyUILaunchTarget)();
    if (!launcher || !this.options.launchLocalEngine) return snapshot;
    onProgress?.(`ComfyUI 没在运行，正在启动 ${launcher.label}，冷启动一般要一两分钟…`);
    const baseUrl = await untilAborted(this.startComfyUI(launcher, settings), signal);
    if (!baseUrl) {
      const minutes = Math.max(1, Math.round((this.options.comfyStartupTimeoutMs ?? COMFY_STARTUP_TIMEOUT_MS) / 60_000));
      throw new Error(`已经打开 ${launcher.label}，但它 ${minutes} 分钟内没有就绪，可能还在加载。过一会儿再说一次“生成图片”就行。`);
    }
    onProgress?.(`${launcher.label} 已就绪，开始生图…`);
    return this.discovery.refresh(settings, signal);
  }

  /** One start at a time: a request that arrives while the engine boots waits on it. */
  private startComfyUI(launcher: LocalEngineLauncher, settings: ImageGenerationSettings): Promise<string | null> {
    if (this.comfyStartup) return this.comfyStartup;
    const launch = this.options.launchLocalEngine;
    const wait = this.options.waitForComfyUI ?? ((baseUrl: string, timeoutMs: number) => waitForComfyUIConnection(baseUrl, timeoutMs));
    const timeoutMs = this.options.comfyStartupTimeoutMs ?? COMFY_STARTUP_TIMEOUT_MS;
    this.comfyStartup = (async () => {
      const failure = launch ? await launch(launcher) : 'no launcher';
      if (failure) throw new Error(`启动 ${launcher.label} 失败：${failure}`);
      return wait(settings.local.comfyuiBaseUrl, timeoutMs);
    })().finally(() => { this.comfyStartup = null; });
    return this.comfyStartup;
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

/** The shared start keeps going for whoever else waits on it; only this caller stops. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('生图已取消。'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('生图已取消。'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}
