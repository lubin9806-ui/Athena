import './preview.css';
import profile from '../../../../assets/avatar/athena-live2d-default/profile.avatar.json';
import modelDocument from '../../../../assets/avatar/athena-live2d-default/model/athena-live2d-lite.model3.json';
import type { AvatarCharacterProfile, AvatarMotionMapping } from '../../../shared/types/avatar';
import { BrowserLive2DLiteHost } from './BrowserLive2DLiteHost';
import { Live2DCanvasController } from './Live2DCanvasController';

const canvas = requiredElement<HTMLCanvasElement>('avatar');
const expressionSelect = requiredElement<HTMLSelectElement>('expression');
const motionSelect = requiredElement<HTMLSelectElement>('motion');
const mouth = requiredElement<HTMLInputElement>('mouth');
const status = requiredElement<HTMLOutputElement>('status');
const typedProfile = profile as AvatarCharacterProfile;
typedProfile.model.rootPath = '.';
typedProfile.model.model3JsonPath = 'model/athena-live2d-lite.model3.json';

const host = new BrowserLive2DLiteHost({ fetchModel: async () => modelDocument });
const controller = new Live2DCanvasController({
  profile: typedProfile,
  host,
  canvas,
  onHotZoneAction: (_action, hotZoneId) => {
    status.value = `触发区域：${hotZoneId}`;
  },
});

for (const mapping of typedProfile.expressions) addOption(expressionSelect, mapping.expressionId);
for (const mapping of uniqueMotions(typedProfile.motions)) addOption(motionSelect, mapping.motionGroup);

expressionSelect.addEventListener('change', () => {
  if (controller.runtime.getSnapshot().loaded) void host.setExpression(expressionSelect.value, 1);
});
motionSelect.addEventListener('change', () => {
  const mapping = typedProfile.motions.find(item => item.motionGroup === motionSelect.value);
  if (mapping) void host.playMotion(mapping);
});
mouth.addEventListener('input', () => void host.setParameter('ParamMouthOpenY', Number(mouth.value)));

void controller.load().then(() => {
  status.value = '运行中';
  document.body.dataset.previewReady = 'true';
}).catch(error => {
  status.value = error instanceof Error ? error.message : String(error);
  document.body.dataset.previewReady = 'error';
});

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

function uniqueMotions(motions: AvatarMotionMapping[]): AvatarMotionMapping[] {
  return motions.filter((motion, index) => motions.findIndex(candidate => candidate.motionGroup === motion.motionGroup) === index);
}
