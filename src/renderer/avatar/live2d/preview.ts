import './preview.css';
import profile from '../../../../assets/avatar/athena-live2d-default/profile.avatar.json';
import manifest from '../../../../assets/avatar/athena-live2d-default/manifest.json';
import modelDocument from '../../../../assets/avatar/athena-live2d-default/model/athena-live2d-lite.model3.json';
import type { AvatarCharacterProfile, AvatarLayoutMode, AvatarMotionMapping } from '../../../shared/types/avatar';
import type { EmotionType } from '../../../shared/types/emotion';
import { StaticAudioLevelSource, WebAudioAnalyserLevelSource } from '../AvatarLipSyncController';
import { AvatarRealtimeLipSyncController, MutableAudioLevelSource } from '../AvatarRealtimeLipSyncController';
import { BrowserCubismLive2DHost } from './BrowserCubismLive2DHost';
import { BrowserLive2DLiteHost } from './BrowserLive2DLiteHost';
import {
  applyAvatarProfileCustomization,
  readAvatarProfileCustomization,
  type AvatarProfileCustomization,
} from './AvatarProfileCustomization';
import { Live2DCanvasController } from './Live2DCanvasController';

const CUSTOMIZATION_KEY = 'athena.live2d.default.customization.v1';
const canvas = requiredElement<HTMLCanvasElement>('avatar');
const expressionSelect = requiredElement<HTMLSelectElement>('expression');
const emotionSelect = requiredElement<HTMLSelectElement>('emotion');
const emotionIntensity = requiredElement<HTMLInputElement>('emotion-intensity');
const emotionBinding = requiredElement<HTMLSelectElement>('emotion-binding');
const motionSelect = requiredElement<HTMLSelectElement>('motion');
const layoutSelect = requiredElement<HTMLSelectElement>('layout');
const mouth = requiredElement<HTMLInputElement>('mouth');
const speechAudioFile = requiredElement<HTMLInputElement>('speech-audio-file');
const speechAudio = requiredElement<HTMLAudioElement>('speech-audio');
const lipSensitivity = requiredElement<HTMLInputElement>('lip-sensitivity');
const lipSmoothing = requiredElement<HTMLInputElement>('lip-smoothing');
const lipGain = requiredElement<HTMLInputElement>('lip-gain');
const status = requiredElement<HTMLOutputElement>('status');
let customization = readAvatarProfileCustomization(localStorage.getItem(CUSTOMIZATION_KEY));
const typedProfile = applyAvatarProfileCustomization(profile as AvatarCharacterProfile, customization);
typedProfile.model.rootPath = 'avatar/athena-live2d-default';
typedProfile.model.model3JsonPath = 'model/athena-live2d-default-sdk5.model3.json';
typedProfile.layout.transform = { ...typedProfile.layout.transform, x: 0, y: 0 };

const liteHost = new BrowserLive2DLiteHost({ fetchModel: async () => modelDocument });
const host = new BrowserCubismLive2DHost({ fallbackHost: liteHost });
const controller = new Live2DCanvasController({
  profile: typedProfile,
  host,
  canvas,
  onHotZoneAction: (_action, hotZoneId) => {
    status.value = `触发区域：${hotZoneId}`;
  },
});
const mutableAudioSource = new MutableAudioLevelSource(new StaticAudioLevelSource(0));
const realtimeLipSync = new AvatarRealtimeLipSyncController({
  settings: typedProfile.lipSync,
  adapter: { setParameter: (parameterId, value) => host.setParameter(parameterId, value) },
  audioSource: mutableAudioSource,
  onValue: value => { mouth.value = value.toFixed(3); },
});

for (const expressionId of manifest.riggingTargets.requiredExpressions) addOption(expressionSelect, expressionId);
for (const expressionId of uniqueExpressionIds(typedProfile)) addOption(emotionBinding, expressionId);
for (const mapping of typedProfile.expressions) addOption(emotionSelect, mapping.emotion);
for (const group of manifest.riggingTargets.requiredMotionGroups) addOption(motionSelect, group);
layoutSelect.value = typedProfile.layout.mode;
lipSensitivity.value = String(typedProfile.lipSync.sensitivity);
lipSmoothing.value = String(typedProfile.lipSync.smoothing);
lipGain.value = String(typedProfile.lipSync.gain);
syncEmotionBinding();

expressionSelect.addEventListener('change', () => {
  if (controller.runtime.getSnapshot().loaded) void host.setExpression(expressionSelect.value, 1);
});
emotionSelect.addEventListener('change', syncEmotionBinding);
emotionIntensity.addEventListener('input', () => {
  void controller.dispatch({
    type: 'emotion.update',
    emotion: emotionSelect.value as EmotionType,
    intensity: Number(emotionIntensity.value),
  });
});
emotionBinding.addEventListener('change', () => {
  const emotion = emotionSelect.value as EmotionType;
  const mapping = typedProfile.expressions.find(item => item.emotion === emotion);
  if (!mapping) return;
  mapping.expressionId = emotionBinding.value;
  customization = {
    ...customization,
    version: 1,
    emotionBindings: {
      ...customization.emotionBindings,
      [emotion]: { expressionId: mapping.expressionId, intensityScale: mapping.intensityScale },
    },
  };
  saveCustomization();
  void controller.dispatch({ type: 'emotion.update', emotion, intensity: Number(emotionIntensity.value) });
});
motionSelect.addEventListener('change', () => {
  const mapping = typedProfile.motions.find(item => item.motionGroup === motionSelect.value) ?? {
    state: 'idle',
    motionGroup: motionSelect.value,
    priority: 'focused',
    loop: motionSelect.value === 'Idle' || motionSelect.value === 'Drag',
  } satisfies AvatarMotionMapping;
  void host.playMotion(mapping);
});
layoutSelect.addEventListener('change', () => {
  const mode = layoutSelect.value as AvatarLayoutMode;
  controller.updateLayoutMode(mode);
  document.body.dataset.layoutMode = mode;
  customization = { ...customization, version: 1, layout: { ...customization.layout, mode } };
  saveCustomization();
});
mouth.addEventListener('input', () => void host.setParameter('ParamMouthOpenY', Number(mouth.value)));
for (const input of [lipSensitivity, lipSmoothing, lipGain]) {
  input.addEventListener('input', updateLipSyncSettings);
}

let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let audioUrl: string | null = null;
speechAudioFile.addEventListener('change', () => {
  const file = speechAudioFile.files?.[0];
  if (!file) return;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  speechAudio.src = audioUrl;
  speechAudio.load();
  status.value = `已载入：${file.name}`;
});
speechAudio.addEventListener('play', () => {
  void startAudioLipSync().catch(handlePreviewError);
});
speechAudio.addEventListener('pause', () => {
  if (!speechAudio.ended) void stopAudioLipSync('语音已暂停').catch(handlePreviewError);
});
speechAudio.addEventListener('ended', () => void stopAudioLipSync('语音播放完成').catch(handlePreviewError));
window.addEventListener('beforeunload', () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  void realtimeLipSync.stop();
  void audioContext?.close();
});

void controller.load().then(() => {
  const renderer = host.getRendererKind();
  status.value = renderer === 'cubism-web' ? 'Cubism Web 运行中' : 'Lite 回退运行中';
  document.body.dataset.avatarEngine = renderer;
  canvas.dataset.avatarDrawables = JSON.stringify(host.getDrawableIds());
  document.body.dataset.layoutMode = typedProfile.layout.mode;
  document.body.dataset.previewReady = 'true';
}).catch(error => {
  status.value = error instanceof Error ? error.message : String(error);
  document.body.dataset.previewReady = 'error';
});

async function startAudioLipSync(): Promise<void> {
  if (!audioContext) audioContext = new AudioContext({ latencyHint: 'interactive' });
  if (!mediaSource) {
    mediaSource = audioContext.createMediaElementSource(speechAudio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    mediaSource.connect(analyser);
    analyser.connect(audioContext.destination);
    mutableAudioSource.use(new WebAudioAnalyserLevelSource(analyser));
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
  await controller.dispatch({ type: 'voice.speaking.start' });
  realtimeLipSync.start();
  status.value = '实时口型同步中';
  document.body.dataset.lipSync = 'active';
}

async function stopAudioLipSync(message: string): Promise<void> {
  await realtimeLipSync.stop();
  await controller.dispatch({ type: 'voice.speaking.end' });
  status.value = message;
  document.body.dataset.lipSync = 'idle';
}

function updateLipSyncSettings(): void {
  typedProfile.lipSync = {
    ...typedProfile.lipSync,
    sensitivity: Number(lipSensitivity.value),
    smoothing: Number(lipSmoothing.value),
    gain: Number(lipGain.value),
  };
  realtimeLipSync.updateSettings(typedProfile.lipSync);
  customization = { ...customization, version: 1, lipSync: { ...typedProfile.lipSync } };
  saveCustomization();
}

function syncEmotionBinding(): void {
  const mapping = typedProfile.expressions.find(item => item.emotion === emotionSelect.value);
  if (mapping) emotionBinding.value = mapping.expressionId;
}

function saveCustomization(): void {
  localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify(customization));
}

function handlePreviewError(error: unknown): void {
  status.value = error instanceof Error ? error.message : String(error);
  document.body.dataset.lipSync = 'error';
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing preview element: ${id}`);
  return element as T;
}

function addOption(select: HTMLSelectElement, value: string): void {
  if ([...select.options].some(option => option.value === value)) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function uniqueExpressionIds(character: AvatarCharacterProfile): string[] {
  return [...new Set(character.expressions.flatMap(mapping => (
    [mapping.expressionId, mapping.fallbackExpressionId].filter(Boolean) as string[]
  )))];
}
