import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SET_VISIBLE_CHANNEL = 'avatar:desktop:setVisible';
const HIDE_CHANNEL = 'avatar:desktop:hide';
const EVENT_CHANNEL = 'avatar:desktop:event';
const READY_CHANNEL = 'avatar:desktop:ready';
const INTERACTION_CHANNEL = 'avatar:desktop:interaction';
const WINDOW_EVENT_CHANNEL = 'avatar:desktop:event:renderer';
const WINDOW_INTERACTION_CHANNEL = 'avatar:desktop:interaction:renderer';

const ALLOWED_EVENT_TYPES = new Set([
  'app.ready',
  'voice.listening.start',
  'voice.listening.end',
  'chat.thinking.start',
  'chat.streaming.start',
  'voice.speaking.start',
  'voice.speaking.end',
  'chat.interrupted',
  'chat.error',
  'activity.idle',
  'activity.sleepy',
  'activity.away',
  'emotion.update',
  'lipSync.update',
  'preferences.update',
]);

interface DesktopPetWindowOptions {
  mainWindow: BrowserWindow;
  preloadPath: string;
  rendererPath: string;
  iconPath: string;
  smokeTest?: boolean;
  shouldClose?: () => boolean;
}

interface StoredBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export class DesktopPetWindow {
  private window: BrowserWindow | null = null;
  private lastEvent: Record<string, unknown> = { type: 'app.ready' };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: DesktopPetWindowOptions) {
    ipcMain.handle(SET_VISIBLE_CHANNEL, this.handleSetVisible);
    ipcMain.handle(HIDE_CHANNEL, this.handleHide);
    ipcMain.on(EVENT_CHANNEL, this.handleAvatarEvent);
    ipcMain.on(READY_CHANNEL, this.handlePetReady);
    ipcMain.on(INTERACTION_CHANNEL, this.handleInteraction);
  }

  async setVisible(visible: boolean): Promise<boolean> {
    if (this.disposed) return false;
    if (!visible) {
      this.window?.hide();
      return false;
    }
    const window = this.ensureWindow();
    if (window.webContents.isLoadingMainFrame()) {
      await waitForWindowLoad(window);
    }
    window.showInactive();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persistBounds();
    ipcMain.removeHandler(SET_VISIBLE_CHANNEL);
    ipcMain.removeHandler(HIDE_CHANNEL);
    ipcMain.removeListener(EVENT_CHANNEL, this.handleAvatarEvent);
    ipcMain.removeListener(READY_CHANNEL, this.handlePetReady);
    ipcMain.removeListener(INTERACTION_CHANNEL, this.handleInteraction);
    this.window?.destroy();
    this.window = null;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const bounds = this.readBounds();
    const window = new BrowserWindow({
      ...bounds,
      minWidth: 240,
      minHeight: 360,
      maxWidth: 560,
      maxHeight: 860,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: true,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      icon: this.options.iconPath,
      webPreferences: {
        preload: this.options.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    this.window = window;
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    window.loadFile(this.options.rendererPath);
    window.on('move', this.schedulePersistBounds);
    window.on('resize', this.schedulePersistBounds);
    window.on('close', event => {
      if (this.disposed || this.options.shouldClose?.()) return;
      event.preventDefault();
      window.hide();
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    if (this.options.smokeTest) {
      window.webContents.on('console-message', (_event, _level, message) => {
        if (message.startsWith('ATHENA_LIVE2D_PET_')) console.log(message);
      });
    }
    return window;
  }

  private readonly handleSetVisible = async (event: IpcMainInvokeEvent, value: unknown): Promise<boolean> => {
    if (!this.isMainSender(event)) return false;
    return this.setVisible(value === true);
  };

  private readonly handleHide = (event: IpcMainInvokeEvent): boolean => {
    if (!this.isPetSender(event)) return false;
    this.window?.hide();
    return true;
  };

  private readonly handleAvatarEvent = (event: IpcMainEvent, value: unknown): void => {
    if (!this.isMainSender(event)) return;
    const cleaned = cleanAvatarEvent(value);
    if (!cleaned) return;
    this.lastEvent = cleaned;
    if (this.window?.isVisible()) this.window.webContents.send(WINDOW_EVENT_CHANNEL, cleaned);
  };

  private readonly handlePetReady = (event: IpcMainEvent): void => {
    if (!this.isPetSender(event)) return;
    event.sender.send(WINDOW_EVENT_CHANNEL, this.lastEvent);
  };

  private readonly handleInteraction = (event: IpcMainEvent, value: unknown): void => {
    if (!this.isPetSender(event)) return;
    const interaction = cleanInteraction(value);
    if (!interaction || this.options.mainWindow.isDestroyed()) return;
    this.options.mainWindow.webContents.send(WINDOW_INTERACTION_CHANNEL, interaction);
  };

  private readonly schedulePersistBounds = (): void => {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistBounds();
    }, 250);
  };

  private persistBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    try {
      fs.mkdirSync(path.dirname(this.boundsPath), { recursive: true });
      fs.writeFileSync(this.boundsPath, JSON.stringify(bounds, null, 2), 'utf8');
    } catch {
      // Window position persistence must never prevent the companion from closing.
    }
  }

  private readBounds(): StoredBounds {
    const fallback = { width: 340, height: 580 };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.boundsPath, 'utf8')) as Partial<StoredBounds>;
      const width = clampDimension(parsed.width, 240, 560, fallback.width);
      const height = clampDimension(parsed.height, 360, 860, fallback.height);
      if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return { width, height };
      const display = screen.getDisplayNearestPoint({ x: Number(parsed.x), y: Number(parsed.y) });
      return {
        x: clampDimension(parsed.x, display.workArea.x, display.workArea.x + display.workArea.width - width, display.workArea.x),
        y: clampDimension(parsed.y, display.workArea.y, display.workArea.y + display.workArea.height - height, display.workArea.y),
        width,
        height,
      };
    } catch {
      return fallback;
    }
  }

  private get boundsPath(): string {
    return path.join(app.getPath('userData'), 'avatar', 'live2d-desktop-window.json');
  }

  private isMainSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !this.options.mainWindow.isDestroyed() && event.sender === this.options.mainWindow.webContents;
  }

  private isPetSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents);
  }
}

function cleanAvatarEvent(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !ALLOWED_EVENT_TYPES.has(value.type)) return null;
  const cleaned: Record<string, unknown> = { type: value.type };
  if (typeof value.message === 'string') cleaned.message = value.message.slice(0, 500);
  if (typeof value.emotion === 'string') cleaned.emotion = value.emotion.slice(0, 40);
  if (typeof value.intensity === 'number' && Number.isFinite(value.intensity)) {
    cleaned.intensity = Math.max(0, Math.min(1, value.intensity));
  }
  if (typeof value.value === 'number' && Number.isFinite(value.value)) {
    cleaned.value = Math.max(0, Math.min(1, value.value));
  }
  if (typeof value.scale === 'number' && Number.isFinite(value.scale)) {
    cleaned.scale = Math.max(0.55, Math.min(1.45, value.scale));
  }
  if (typeof value.opacity === 'number' && Number.isFinite(value.opacity)) {
    cleaned.opacity = Math.max(0.3, Math.min(1, value.opacity));
  }
  if (typeof value.outfitId === 'string' && /^[a-z0-9_-]{3,64}$/.test(value.outfitId)) {
    cleaned.outfitId = value.outfitId;
  }
  return cleaned;
}

function cleanInteraction(value: unknown): { prompt: string; hotZoneId: string } | null {
  if (!isRecord(value)) return null;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim().slice(0, 1_000) : '';
  const hotZoneId = typeof value.hotZoneId === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value.hotZoneId)
    ? value.hotZoneId
    : '';
  return prompt && hotZoneId ? { prompt, hotZoneId } : null;
}

function clampDimension(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function waitForWindowLoad(window: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Desktop pet window load timed out.')), 15_000);
    const onReady = (): void => finish();
    const onFailed = (_event: unknown, code: number, description: string): void => {
      finish(new Error(`Desktop pet window failed to load (${code}): ${description}`));
    };
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      window.webContents.removeListener('did-finish-load', onReady);
      window.webContents.removeListener('did-fail-load', onFailed);
      if (error) reject(error);
      else resolve();
    };
    window.webContents.once('did-finish-load', onReady);
    window.webContents.once('did-fail-load', onFailed);
  });
}
