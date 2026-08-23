import athenaProfileDocument from '../../../../assets/avatar/athena-live2d-default/profile.avatar.json';
import liteModelDocument from '../../../../assets/avatar/athena-live2d-default/model/athena-live2d-lite.model3.json';
import haruProfileDocument from '../../../../assets/avatar/live2d-official-haru/profile.avatar.json';
import suShixiaProfileDocument from '../../../../assets/avatar/su-shixia-live2d-v2/profile.avatar.json';
import suShixiaLiteModelDocument from '../../../../assets/avatar/su-shixia-live2d-v2/model/su-shixia-live2d-v2-lite.model3.json';
import type {
  AvatarCharacterProfile,
  AvatarHotZone,
  AvatarHotZoneAction,
  AvatarInteractionMode,
  AvatarLayoutMode,
} from '../../../shared/types/avatar';
import type { EmotionType } from '../../../shared/types/emotion';
import { StaticAudioLevelSource, WebAudioAnalyserLevelSource } from '../AvatarLipSyncController';
import { AvatarRealtimeLipSyncController, MutableAudioLevelSource } from '../AvatarRealtimeLipSyncController';
import type { AthenaAvatarEvent } from '../AvatarRuntime';
import { applyAvatarProfileCustomization, readAvatarProfileCustomization } from './AvatarProfileCustomization';
import { BrowserCubismLive2DHost } from './BrowserCubismLive2DHost';
import { BrowserLive2DLiteHost } from './BrowserLive2DLiteHost';
import { Live2DCanvasController } from './Live2DCanvasController';

const CUSTOMIZATION_KEY = 'athena.live2d.default.customization.v1';
export const ATHENA_LIVE2D_PREFERENCES_KEY = 'athena.live2d.companion.v1';

export interface AthenaLive2DPreferences {
  version: 1;
  enabled: boolean;
  layout: AvatarLayoutMode;
  scale: number;
  opacity: number;
  modelVariant: AthenaLive2DModelVariant;
  interactionMode: AvatarInteractionMode;
}

export type AthenaLive2DModelVariant = 'su_shixia_v2' | 'official_haru' | 'athena_default';

export interface AthenaLive2DCompanionOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  layoutOverride?: AvatarLayoutMode;
  lockPosition?: boolean;
  onAthenaReply?: (prompt: string, hotZoneId: string) => void | Promise<void>;
  onError?: (error: Error) => void;
  onLipSyncValue?: (value: number) => void;
  onSpeakingChange?: (speaking: boolean) => void;
}

const DEFAULT_PREFERENCES: AthenaLive2DPreferences = {
  version: 1,
  enabled: true,
  layout: 'chat_right',
  scale: 1,
  opacity: 0.98,
  modelVariant: 'su_shixia_v2',
  interactionMode: 'normal',
};

export class AthenaLive2DCompanion {
  private readonly host: BrowserCubismLive2DHost;
  private readonly controller: Live2DCanvasController;
  private readonly audioSource = new MutableAudioLevelSource(new StaticAudioLevelSource(0));
  private readonly lipSync: AvatarRealtimeLipSyncController;
  private preferences: AthenaLive2DPreferences;
  private audioContext: AudioContext | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private activeMediaSource: MediaElementAudioSourceNode | null = null;
  private activeAnalyser: AnalyserNode | null = null;
  private idleTimer: number | null = null;
  private lastNonIdleEventAt = Date.now();
  private activeState: AthenaAvatarEvent['type'] = 'app.ready';
  private readonly profile: AvatarCharacterProfile;
  private loaded = false;
  private destroyed = false;

  constructor(private readonly options: AthenaLive2DCompanionOptions) {
    const storage = options.storage ?? window.localStorage;
    this.preferences = readAthenaLive2DPreferences(storage.getItem(ATHENA_LIVE2D_PREFERENCES_KEY));
    if (options.layoutOverride) this.preferences.layout = options.layoutOverride;
    const customization = readAvatarProfileCustomization(storage.getItem(CUSTOMIZATION_KEY));
    const selectedModel = live2dModelConfig(this.preferences.modelVariant);
    const profile = applyAvatarProfileCustomization(selectedModel.profile, customization);
    this.profile = profile;
    profile.model.rootPath = selectedModel.rootPath;
    profile.model.model3JsonPath = selectedModel.model3JsonPath;
    profile.layout.mode = this.preferences.layout;
    if (options.lockPosition !== undefined) profile.layout.lockPosition = options.lockPosition;
    profile.layout.transform = {
      ...profile.layout.transform,
      x: 0,
      y: 0,
      scale: this.preferences.scale,
      opacity: this.preferences.opacity,
    };

    const fallbackHost = new BrowserLive2DLiteHost({
      fetchModel: async url => live2dLiteModelDocument(url),
    });
    this.host = new BrowserCubismLive2DHost({ fallbackHost });
    this.controller = new Live2DCanvasController({
      profile,
      host: this.host,
      canvas: options.canvas,
      onHotZoneAction: (action, hotZoneId) => this.handleHotZoneAction(action, hotZoneId),
    });
    this.lipSync = new AvatarRealtimeLipSyncController({
      settings: profile.lipSync,
      adapter: { setParameter: (parameterId, value) => this.host.setParameter(parameterId, value) },
      audioSource: this.audioSource,
      onValue: value => {
        this.options.root.dataset.lipSync = value > 0.02 ? 'active' : 'idle';
        this.options.onLipSyncValue?.(value);
      },
    });
    this.applyPreferences();
  }

  get isEnabled(): boolean {
    return this.preferences.enabled;
  }

  get settings(): AthenaLive2DPreferences {
    return { ...this.preferences };
  }

  async load(): Promise<void> {
    if (this.destroyed || this.loaded || !this.preferences.enabled) return;
    this.options.root.dataset.state = 'loading';
    try {
      await this.controller.load();
      if (this.host.getRendererKind() === 'live2d-lite' && /network error/i.test(this.host.getFallbackReason() ?? '')) {
        await new Promise(resolve => window.setTimeout(resolve, 180));
        await this.controller.reload();
      }
      this.loaded = true;
      this.options.root.dataset.engine = this.host.getRendererKind();
      const fallbackReason = this.host.getFallbackReason();
      if (fallbackReason) this.options.root.dataset.fallbackReason = fallbackReason;
      else delete this.options.root.dataset.fallbackReason;
      this.options.root.dataset.state = 'ready';
      await this.controller.dispatch({ type: 'app.ready' });
      this.startIdleScheduler();
    } catch (error) {
      this.options.root.dataset.state = 'error';
      this.options.onError?.(asError(error));
    }
  }

  async dispatch(event: AthenaAvatarEvent): Promise<void> {
    if (!this.preferences.enabled || this.destroyed) return;
    if (!this.loaded) await this.load();
    if (!this.loaded) return;
    try {
      await this.controller.dispatch(event);
      this.noteAvatarEvent(event);
    } catch (error) {
      this.options.root.dataset.state = 'error';
      this.options.onError?.(asError(error));
    }
  }

  async setEmotionLabel(label?: string, intensity = 1): Promise<void> {
    await this.dispatch({ type: 'emotion.update', emotion: emotionFromLabel(label), intensity });
  }

  async setMouthValue(value: number): Promise<void> {
    if (!this.preferences.enabled || !this.loaded) return;
    await this.host.setParameter('ParamMouthOpenY', Math.max(0, Math.min(1, value)));
  }

  async attachAudio(audio: HTMLAudioElement): Promise<void> {
    if (!this.preferences.enabled || this.destroyed) return;
    if (!this.loaded) await this.load();
    if (!this.loaded) return;
    await this.stopAudioTracking();
    const context = this.audioContext ?? new AudioContext({ latencyHint: 'interactive' });
    this.audioContext = context;
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    analyser.connect(context.destination);
    this.audioSource.use(new WebAudioAnalyserLevelSource(analyser));
    this.activeAudio = audio;
    this.activeMediaSource = source;
    this.activeAnalyser = analyser;
    audio.addEventListener('play', this.handleAudioPlay);
    audio.addEventListener('pause', this.handleAudioStop);
    audio.addEventListener('ended', this.handleAudioStop);
    if (context.state === 'suspended') await context.resume();
  }

  async stopAudioTracking(): Promise<void> {
    if (this.activeAudio) {
      this.activeAudio.removeEventListener('play', this.handleAudioPlay);
      this.activeAudio.removeEventListener('pause', this.handleAudioStop);
      this.activeAudio.removeEventListener('ended', this.handleAudioStop);
      this.activeAudio = null;
    }
    this.activeMediaSource?.disconnect();
    this.activeAnalyser?.disconnect();
    this.activeMediaSource = null;
    this.activeAnalyser = null;
    await this.lipSync.stop();
    this.options.root.dataset.lipSync = 'idle';
    if (this.loaded) await this.dispatch({ type: 'voice.speaking.end' });
  }

  async updatePreferences(patch: Partial<Omit<AthenaLive2DPreferences, 'version'>>): Promise<void> {
    const wasEnabled = this.preferences.enabled;
    this.preferences = sanitizePreferences({ ...this.preferences, ...patch, version: 1 });
    (this.options.storage ?? window.localStorage).setItem(
      ATHENA_LIVE2D_PREFERENCES_KEY,
      JSON.stringify(this.preferences),
    );
    this.applyPreferences();
    if (!wasEnabled && this.preferences.enabled) await this.load();
    if (wasEnabled && !this.preferences.enabled) await this.stopAudioTracking();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.stopAudioTracking();
    this.stopIdleScheduler();
    if (this.loaded) await this.controller.destroy();
    this.loaded = false;
    await this.audioContext?.close();
    this.audioContext = null;
  }

  private readonly handleAudioPlay = (): void => {
    this.options.onSpeakingChange?.(true);
    void this.dispatch({ type: 'voice.speaking.start' });
    this.lipSync.start();
  };

  private readonly handleAudioStop = (): void => {
    this.options.onSpeakingChange?.(false);
    void this.lipSync.stop().then(() => this.dispatch({ type: 'voice.speaking.end' }));
  };

  private applyPreferences(): void {
    this.options.root.dataset.enabled = String(this.preferences.enabled);
    this.options.root.dataset.layout = this.preferences.layout;
    this.options.root.style.setProperty('--live2d-companion-scale', String(this.preferences.scale));
    this.options.root.style.setProperty('--live2d-companion-opacity', String(this.preferences.opacity));
    this.controller.updateLayoutMode(this.preferences.layout);
    this.options.canvas.style.setProperty('--avatar-scale-x', String(this.preferences.scale));
    this.options.canvas.style.setProperty('--avatar-scale-y', String(this.preferences.scale));
  }

  private handleHotZoneAction(action: AvatarHotZoneAction, hotZoneId: string): void {
    const hotZone = this.profile.hotZones.find(zone => zone.id === hotZoneId);
    const prompt = buildHotZoneReplyPrompt(
      findAthenaReplyPrompt(action),
      hotZone,
      this.profile.interactionPolicy,
      this.preferences.interactionMode,
    );
    this.lastNonIdleEventAt = Date.now();
    if (prompt) void this.options.onAthenaReply?.(prompt, hotZoneId);
  }

  private startIdleScheduler(): void {
    if (this.idleTimer !== null) return;
    this.idleTimer = window.setInterval(() => {
      if (this.destroyed || !this.loaded || !this.preferences.enabled) return;
      if (this.activeAudio && !this.activeAudio.paused && !this.activeAudio.ended) return;
      if (Date.now() - this.lastNonIdleEventAt < 9_000) return;
      if (!isIdleCompatibleEvent(this.activeState)) return;
      void this.controller.dispatch({ type: 'activity.idle' });
    }, 11_000);
  }

  private stopIdleScheduler(): void {
    if (this.idleTimer === null) return;
    window.clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  private noteAvatarEvent(event: AthenaAvatarEvent): void {
    this.activeState = event.type;
    if (event.type !== 'activity.idle' && event.type !== 'app.ready') {
      this.lastNonIdleEventAt = Date.now();
    }
  }
}

export function readAthenaLive2DPreferences(value: string | null): AthenaLive2DPreferences {
  if (!value) return { ...DEFAULT_PREFERENCES };
  try {
    return sanitizePreferences(JSON.parse(value) as Partial<AthenaLive2DPreferences>);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function emotionFromLabel(label?: string): EmotionType {
  const value = label?.trim().toLowerCase() ?? '';
  if (/开心|高兴|愉快|happy/.test(value)) return 'happy';
  if (/思考|沉思|认真|thought/.test(value)) return 'thoughtful';
  if (/害羞|腼腆|shy/.test(value)) return 'shy';
  if (/疑惑|困惑|不解|confus/.test(value)) return 'confused';
  if (/期待|兴奋|惊喜|excited/.test(value)) return 'excited';
  if (/困|疲惫|疲倦|tired|sleep/.test(value)) return 'tired';
  if (/调皮|俏皮|playful/.test(value)) return 'playful';
  if (/温柔|柔和|安慰|soft/.test(value)) return 'soft';
  return 'peaceful';
}

export function findAthenaReplyPrompt(action: AvatarHotZoneAction): string | null {
  if (action.type === 'athenaReply') return action.promptTemplate?.trim() || null;
  for (const child of action.actions ?? []) {
    const prompt = findAthenaReplyPrompt(child);
    if (prompt) return prompt;
  }
  return null;
}

function sanitizePreferences(value: Partial<AthenaLive2DPreferences>): AthenaLive2DPreferences {
  return {
    version: 1,
    enabled: value.enabled !== false,
    layout: isLayoutMode(value.layout) ? value.layout : DEFAULT_PREFERENCES.layout,
    scale: clamp(value.scale, 0.55, 1.45, DEFAULT_PREFERENCES.scale),
    opacity: clamp(value.opacity, 0.3, 1, DEFAULT_PREFERENCES.opacity),
    modelVariant: isModelVariant(value.modelVariant) ? value.modelVariant : DEFAULT_PREFERENCES.modelVariant,
    interactionMode: value.interactionMode === 'private_opt_in' ? 'private_opt_in' : DEFAULT_PREFERENCES.interactionMode,
  };
}

export function buildHotZoneReplyPrompt(
  prompt: string | null,
  hotZone: AvatarHotZone | undefined,
  policy: AvatarCharacterProfile['interactionPolicy'],
  mode: AvatarInteractionMode,
): string | null {
  if (!prompt) return null;
  const interaction = hotZone?.interaction;
  const effectiveMode = mode === 'private_opt_in' && interaction?.privateModeAllowed ? 'private_opt_in' : 'normal';
  const lines = [
    prompt,
    '',
    '运行时互动边界：',
    `- 当前模式：${effectiveMode}`,
    `- 触碰区域：${interaction?.bodyPart ?? hotZone?.label ?? 'unknown'}`,
    `- 区域敏感度：${interaction?.sensitivity ?? 'neutral'}`,
    `- 动作意图：${interaction?.motionIntent ?? '自然、简短、符合当前人格'}`,
    '- 回应文本交给当前苏时夏人格生成，但必须遵守以下边界。',
  ];
  if (effectiveMode === 'private_opt_in') {
    lines.push(`- ${interaction?.privateModeBoundary ?? policy?.privateModePrompt ?? '私密模式仍需保持明确同意、可停止和安全边界。'}`);
  } else {
    lines.push(`- ${interaction?.normalModeBoundary ?? policy?.normalModePrompt ?? '正常模式保持克制、非露骨、尊重边界。'}`);
    if (interaction?.sensitivity === 'sensitive' || interaction?.sensitivity === 'private') {
      lines.push('- 正常模式下不要升级为成人或露骨内容；可以害羞、躲开、整理衣服、提醒边界或把话题带回陪伴/助理。');
    }
  }
  if (policy?.forbiddenPublicAssetTypes?.length) {
    lines.push(`- 公开包禁止素材类型：${policy.forbiddenPublicAssetTypes.join(', ')}。`);
  }
  return lines.join('\n');
}

function isLayoutMode(value: unknown): value is AvatarLayoutMode {
  return value === 'chat_right'
    || value === 'chat_background'
    || value === 'draggable_overlay'
    || value === 'desktop_pet';
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function live2dModelConfig(variant: AthenaLive2DModelVariant): {
  profile: AvatarCharacterProfile;
  rootPath: string;
  model3JsonPath: string;
} {
  if (variant === 'su_shixia_v2') {
    return {
      profile: suShixiaProfileDocument as AvatarCharacterProfile,
      rootPath: 'avatar/su-shixia-live2d-v2',
      model3JsonPath: 'model/su-shixia-live2d-v2-lite.model3.json',
    };
  }
  if (variant === 'athena_default') {
    return {
      profile: athenaProfileDocument as AvatarCharacterProfile,
      rootPath: 'avatar/athena-live2d-default',
      model3JsonPath: 'model/athena-live2d-default-sdk5.model3.json',
    };
  }
  return {
    profile: haruProfileDocument as AvatarCharacterProfile,
    rootPath: 'avatar/live2d-official-haru',
    model3JsonPath: 'Haru.model3.json',
  };
}

function isModelVariant(value: unknown): value is AthenaLive2DModelVariant {
  return value === 'su_shixia_v2' || value === 'official_haru' || value === 'athena_default';
}

function live2dLiteModelDocument(modelUrl: string): unknown {
  if (modelUrl.includes('su-shixia-live2d-v2')) return suShixiaLiteModelDocument;
  if (modelUrl.includes('athena-live2d-default')) return liteModelDocument;
  return fetch(modelUrl).then(response => {
    if (!response.ok) throw new Error(`Unable to load Live2D Lite model (${response.status}): ${modelUrl}`);
    return response.json();
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isIdleCompatibleEvent(type: AthenaAvatarEvent['type']): boolean {
  return type === 'app.ready'
    || type === 'activity.idle'
    || type === 'voice.speaking.end'
    || type === 'voice.listening.end'
    || type === 'emotion.update'
    || type === 'pointer.move';
}
