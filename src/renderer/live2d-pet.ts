import './live2d-pet.css';
import type { AthenaAvatarEvent } from './avatar/AvatarRuntime';
import { AthenaLive2DCompanion } from './avatar/live2d/AthenaLive2DCompanion';

type DesktopPetEvent = AthenaAvatarEvent
  | { type: 'lipSync.update'; value: number }
  | { type: 'preferences.update'; scale: number; opacity: number };

declare global {
  interface Window {
    athenaPetAPI: {
      hide: () => Promise<boolean>;
      ready: () => void;
      sendInteraction: (prompt: string, hotZoneId: string) => void;
      onAvatarEvent: (callback: (event: DesktopPetEvent) => void) => () => void;
    };
  }
}

const root = requiredElement<HTMLElement>('live2d-pet');
const companion = new AthenaLive2DCompanion({
  root,
  canvas: requiredElement<HTMLCanvasElement>('live2d-pet-canvas'),
  layoutOverride: 'desktop_pet',
  lockPosition: true,
  onAthenaReply: (prompt, hotZoneId) => window.athenaPetAPI.sendInteraction(prompt, hotZoneId),
  onError: error => console.error('ATHENA_LIVE2D_PET_ERROR', error),
});

requiredElement<HTMLButtonElement>('live2d-pet-hide').addEventListener('click', () => {
  void window.athenaPetAPI.hide();
});
const detachEvent = window.athenaPetAPI.onAvatarEvent(event => {
  root.dataset.lastEvent = event.type;
  if (event.type === 'emotion.update') root.dataset.stateSync = event.type;
  if (event.type === 'lipSync.update') {
    root.dataset.lipSyncValue = event.value.toFixed(3);
    void companion.setMouthValue(event.value);
    return;
  }
  if (event.type === 'preferences.update') {
    void companion.updatePreferences({
      enabled: true,
      layout: 'desktop_pet',
      scale: event.scale,
      opacity: event.opacity,
    });
    return;
  }
  void companion.dispatch(event);
});
window.addEventListener('beforeunload', () => {
  detachEvent();
  void companion.destroy();
});

void companion.load().then(() => {
  window.athenaPetAPI.ready();
  console.log(`ATHENA_LIVE2D_PET_READY engine=${root.dataset.engine ?? 'unknown'}`);
});

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing desktop pet element: ${id}`);
  return element as T;
}
