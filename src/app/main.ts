/** Athena 主进程入口 */

import { app, BrowserWindow, Tray, Menu, nativeImage, screen, shell, WebContents } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { installLoggingPipeGuards } from '../engine/Logger';
import { registerIpcHandlers } from './ipc';

installLoggingPipeGuards();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const isSmokeTest = process.argv.includes('--smoke-test') || process.env.ATHENA_SMOKE_TEST === '1';
const isVoiceSmokeTest = isSmokeTest && process.env.ATHENA_SMOKE_VOICE === '1';
const smokeScreenshotPath = process.env.ATHENA_SMOKE_SCREENSHOT?.trim();
const smokeCaptureRipple = isSmokeTest && process.env.ATHENA_SMOKE_CAPTURE_RIPPLE === '1';
const smokeTheme = process.env.ATHENA_SMOKE_THEME === 'night'
  ? 'night'
  : process.env.ATHENA_SMOKE_THEME === 'day'
    ? 'day'
    : null;
const smokePanel = process.env.ATHENA_SMOKE_PANEL === 'settings'
  ? 'settings'
  : process.env.ATHENA_SMOKE_PANEL === 'memory'
    ? 'memory'
    : process.env.ATHENA_SMOKE_PANEL === 'execution'
      ? 'execution'
      : null;
const smokeUserDataPath = isSmokeTest
  ? path.join(os.tmpdir(), 'athena-smoke', String(process.pid))
  : null;
let smokeReadyLogged = false;

if (smokeUserDataPath) {
  app.setPath('userData', smokeUserDataPath);
  process.once('exit', () => {
    try {
      fs.rmSync(smokeUserDataPath, { recursive: true, force: true });
    } catch {
      // A terminated Chromium helper may briefly retain a cache file on Windows.
    }
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (isVoiceSmokeTest) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}

function isMainAppPage(webContents: WebContents | null, requestingUrl?: string): boolean {
  if (!mainWindow || webContents !== mainWindow.webContents) return false;

  const candidateUrl = requestingUrl || webContents.getURL();
  try {
    const expectedPath = path.normalize(path.join(__dirname, '../renderer/index.html')).toLowerCase();
    const candidate = new URL(candidateUrl);
    return candidate.protocol === 'file:'
      && path.normalize(fileURLToPath(candidate)).toLowerCase() === expectedPath;
  } catch {
    return false;
  }
}

function configureMediaPermissions(window: BrowserWindow): void {
  const appSession = window.webContents.session;

  appSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    return permission === 'media'
      && details.isMainFrame
      && details.mediaType === 'audio'
      && isMainAppPage(webContents, details.requestingUrl);
  });

  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = details.mediaTypes || [];
    const isAudioOnly = mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio');
    callback(
      permission === 'media'
      && details.isMainFrame
      && isAudioOnly
      && isMainAppPage(webContents, details.requestingUrl),
    );
  });
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    resizable: true,
    icon: path.join(__dirname, '../../resources/su-shixia-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.webContents.setAudioMuted(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isMainAppPage(mainWindow?.webContents ?? null, url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  configureMediaPermissions(mainWindow);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`ATHENA_RENDERER_GONE reason=${details.reason} exitCode=${details.exitCode}`);
  });
  if (isSmokeTest) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('ATHENA_SMOKE_')) console.log(message);
    });
  }
  mainWindow.on('unresponsive', () => {
    console.error('ATHENA_WINDOW_UNRESPONSIVE');
  });
  mainWindow.loadURL(pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString());

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow?.show();
    else logSmokeReady();
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    if (!isSmokeTest || !mainWindow) return;
    let domReady = false;
    try {
      domReady = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          try {
             const api = window.athenaAPI;
             const micButton = document.getElementById('voice-stt-btn');
             const appShell = document.getElementById('app-shell');
             const stage = document.getElementById('stage');
             const titlebar = document.getElementById('titlebar');
             const memoryButton = document.getElementById('btn-memory');
             const memoryClose = document.getElementById('btn-memory-close');
             const memoryPanel = document.getElementById('memory-panel');
             const executionButton = document.getElementById('mode-execute-button');
             const executionPanel = document.getElementById('execution-panel');
             const webSearchButton = document.getElementById('web-search-btn');
             const composerMoreButton = document.getElementById('composer-more-btn');
             const toolAccessHint = document.getElementById('tool-access-hint');
             const executeToolPermission = document.getElementById('setting-tool-permission-execute');
             const uiReady = Boolean(
               appShell &&
               document.getElementById('chat-container') &&
               document.getElementById('input-form') &&
               stage &&
               titlebar &&
               memoryButton &&
               memoryClose &&
               memoryPanel &&
               executionButton &&
               executionPanel &&
               webSearchButton &&
               composerMoreButton &&
               toolAccessHint &&
               executeToolPermission instanceof HTMLSelectElement &&
               document.getElementById('setting-web-search-enabled') &&
               document.getElementById('setting-web-search-deep-read') &&
               document.getElementById('setting-web-search-secondary') &&
               document.getElementById('setting-web-search-max-pages') &&
               micButton &&
              document.getElementById('voice-file-btn') &&
              document.getElementById('voice-feedback') &&
              api &&
              typeof api.transcribeRecording === 'function' &&
              typeof api.playAudioFile === 'function' &&
              typeof api.getSettings === 'function' &&
              typeof api.saveSettings === 'function'
              && typeof api.cancelExecution === 'function'
              && typeof api.onWebSearchStatus === 'function'
             );
             if (!uiReady) return false;

             const stageRect = stage.getBoundingClientRect();
             stage.dispatchEvent(new PointerEvent('pointermove', {
               bubbles: true,
               clientX: stageRect.right - 12,
               clientY: stageRect.top + stageRect.height * 0.35,
             }));
             await new Promise(resolve => setTimeout(resolve, 80));
             const glassReactive = Boolean(titlebar.style.getPropertyValue('--glass-x'));
             if (!glassReactive) return false;

             const titlebarRect = titlebar.getBoundingClientRect();
             titlebar.dispatchEvent(new PointerEvent('pointerdown', {
               bubbles: true,
               clientX: titlebarRect.left + titlebarRect.width * 0.6,
               clientY: titlebarRect.top + titlebarRect.height * 0.5,
             }));
             const rippleReactive = Boolean(titlebar.querySelector('.liquid-ripple'));
             if (!rippleReactive) return false;

             const originalSettings = await api.getSettings();
             const credentialRedacted = originalSettings.model.deepseek.apiKey === '';
             const toolPermissionControlsReady = executeToolPermission.value === originalSettings.settings.tools.modePermissions.execute
               && originalSettings.settings.tools.modePermissions.create === 'off'
               && originalSettings.settings.tools.modePermissions.companion === 'off'
               && originalSettings.settings.tools.modePermissions.reason === 'off';
             if (!credentialRedacted || !toolPermissionControlsReady) return false;
             await new Promise(resolve => setTimeout(resolve, 90));
             composerMoreButton.click();
             webSearchButton.click();
             const webSearchForceReactive = webSearchButton.getAttribute('aria-pressed') === 'true';
             webSearchButton.click();
             const webSearchForceRestored = webSearchButton.getAttribute('aria-pressed') === 'false';
             if (!webSearchForceReactive || !webSearchForceRestored) return false;
             const originalMode = originalSettings.settings.conversation.activeMode;
             const probeMode = originalMode === 'reason' ? 'create' : 'reason';
             const probeButton = document.querySelector('.mode-btn[data-mode="' + probeMode + '"]');
             const originalButton = document.querySelector('.mode-btn[data-mode="' + originalMode + '"]');
             if (!(probeButton instanceof HTMLButtonElement) || !(originalButton instanceof HTMLButtonElement)) return false;
             probeButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const modeReactive = appShell.dataset.mode === probeMode;
             const toolHintReactive = toolAccessHint.dataset.level === originalSettings.settings.tools.modePermissions[probeMode];
             const modePersisted = (await api.getSettings()).settings.conversation.activeMode === probeMode;
             originalButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const modeRestored = appShell.dataset.mode === originalMode
               && (await api.getSettings()).settings.conversation.activeMode === originalMode;
             const toolHintRestored = toolAccessHint.dataset.level === originalSettings.settings.tools.modePermissions[originalMode];
             if (!modeReactive || !modePersisted || !modeRestored || !toolHintReactive || !toolHintRestored) return false;

             memoryButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const panelReactive = memoryPanel.dataset.open === 'true';
             memoryClose.click();
             executionButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const executionModeReactive = appShell.dataset.mode === 'execute';
             const executionWorkspaceReactive = getComputedStyle(executionPanel).display !== 'none'
               && executionPanel.getAttribute('aria-hidden') === 'false';
             const executionPermissionReactive = toolAccessHint.dataset.level === originalSettings.settings.tools.modePermissions.execute;
             originalButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const executionModeRestored = appShell.dataset.mode === originalMode;
             console.log('ATHENA_SMOKE_UI_STATE', JSON.stringify({
               panelReactive,
               panelAfterClose: memoryPanel.dataset.open,
               executionModeReactive,
               executionWorkspaceReactive,
               executionPermissionReactive,
               executionModeRestored,
               glassReactive,
               rippleReactive,
                modeReactive,
                modePersisted,
                modeRestored,
                toolHintReactive,
                toolHintRestored,
                toolPermissionControlsReady,
                credentialRedacted,
                webSearchForceReactive,
               webSearchForceRestored,
             }));
             if (!panelReactive || memoryPanel.dataset.open !== 'false' || !executionModeReactive || !executionWorkspaceReactive || !executionPermissionReactive || !executionModeRestored) return false;

             const ipcProbe = await api.transcribeRecording(new Uint8Array());
            if (!ipcProbe || ipcProbe.ok !== false || !/empty/i.test(ipcProbe.error || '')) return false;
            const playbackProbe = await api.playAudioFile('');
            if (!playbackProbe || playbackProbe.ok !== false) return false;
            if (!${isVoiceSmokeTest ? 'true' : 'false'}) return true;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const audioReady = stream.getAudioTracks().length > 0;
            stream.getTracks().forEach(track => track.stop());
            if (!audioReady) return false;

            const waitFor = async (predicate, timeoutMs = 4000) => {
              const deadline = Date.now() + timeoutMs;
              while (Date.now() < deadline) {
                if (predicate()) return true;
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              return false;
            };

            micButton.click();
            const recordingStarted = await waitFor(() => micButton.getAttribute('aria-pressed') === 'true');
            if (!recordingStarted) return false;
            await new Promise(resolve => setTimeout(resolve, 350));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            return waitFor(() => micButton.getAttribute('aria-pressed') === 'false');
          } catch {
            return false;
          }
        })()
      `);
    } catch (error) {
      console.error('ATHENA_SMOKE_RENDERER_ERROR', error);
    }
    if (smokeScreenshotPath) {
      const wasVisible = mainWindow.isVisible();
      try {
        if (!wasVisible) {
          mainWindow.showInactive();
          await new Promise(resolve => setTimeout(resolve, 180));
        }
        if (smokeTheme) {
          const themeApplied = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const shell = document.getElementById('app-shell');
              if (!shell) return false;
              document.documentElement.dataset.theme = ${JSON.stringify(smokeTheme)};
              document.documentElement.style.colorScheme = ${JSON.stringify(smokeTheme === 'night' ? 'dark' : 'light')};
              shell.dataset.theme = ${JSON.stringify(smokeTheme)};
              return shell.dataset.theme === ${JSON.stringify(smokeTheme)};
            })()
          `);
          if (!themeApplied) throw new Error('Smoke theme could not be applied');
          await new Promise(resolve => setTimeout(resolve, 160));
        }
        if (smokePanel) {
          const smokePanelButtonId = smokePanel === 'settings' ? 'btn-settings' : smokePanel === 'memory' ? 'btn-memory' : 'mode-execute-button';
          const smokePanelId = smokePanel === 'settings' ? 'settings-panel' : smokePanel === 'memory' ? 'memory-panel' : 'execution-panel';
          const panelOpened = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const button = document.getElementById(${JSON.stringify(smokePanelButtonId)});
              const panel = document.getElementById(${JSON.stringify(smokePanelId)});
              if (!(button instanceof HTMLButtonElement) || !panel) return false;
              button.click();
              return ${JSON.stringify(smokePanel)} === 'execution'
                ? document.getElementById('app-shell')?.dataset.mode === 'execute' && getComputedStyle(panel).display !== 'none'
                : panel.dataset.open === 'true';
            })()
          `);
          if (!panelOpened) throw new Error('Smoke panel could not be opened');
          await new Promise(resolve => setTimeout(resolve, 380));
          if (smokeTheme) {
            await mainWindow.webContents.executeJavaScript(`
              (() => {
                const shell = document.getElementById('app-shell');
                if (!shell) return false;
                document.documentElement.dataset.theme = ${JSON.stringify(smokeTheme)};
                document.documentElement.style.colorScheme = ${JSON.stringify(smokeTheme === 'night' ? 'dark' : 'light')};
                shell.dataset.theme = ${JSON.stringify(smokeTheme)};
                return true;
              })()
            `);
            await new Promise(resolve => setTimeout(resolve, 160));
          }
        }
        if (smokeCaptureRipple) {
          await new Promise(resolve => setTimeout(resolve, 420));
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const surface = document.getElementById('input-form');
              if (!surface) return false;
              const rect = surface.getBoundingClientRect();
              surface.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                clientX: rect.left + rect.width * 0.42,
                clientY: rect.top + rect.height * 0.48,
              }));
              return true;
            })()
          `);
          await new Promise(resolve => setTimeout(resolve, 120));
        } else {
          await new Promise(resolve => setTimeout(resolve, 420));
        }
        fs.mkdirSync(path.dirname(smokeScreenshotPath), { recursive: true });
        const screenshot = await mainWindow.webContents.capturePage();
        fs.writeFileSync(smokeScreenshotPath, screenshot.toPNG());
        console.log(`ATHENA_SMOKE_SCREENSHOT ${smokeScreenshotPath}`);
      } catch (error) {
        console.error('ATHENA_SMOKE_SCREENSHOT_FAILED', error);
      } finally {
        if (!wasVisible) mainWindow.hide();
      }
    }
    logSmokeReady();
    console.log(domReady ? 'ATHENA_SMOKE_DOM_OK' : 'ATHENA_SMOKE_DOM_MISSING');
    setTimeout(() => app.exit(domReady ? 0 : 1), 50);
  });

  mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
    if (!isSmokeTest) return;
    console.error(`ATHENA_SMOKE_LOAD_FAILED ${code} ${description}`);
    app.exit(1);
  });

  registerIpcHandlers(mainWindow);

  // 窗口位置：右下角
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const [ww, wh] = mainWindow.getSize();
  mainWindow.setPosition(sw - ww - 20, sh - wh - 60);

  mainWindow.on('minimize', () => mainWindow?.hide());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function logSmokeReady(): void {
  if (smokeReadyLogged) return;
  smokeReadyLogged = true;
  console.log('ATHENA_SMOKE_READY_TO_SHOW');
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../../resources/su-shixia-tray.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('苏时夏 — Athena Desktop Assistant');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开苏时夏', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(() => {
  createWindow();
  if (!isSmokeTest) createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const gotTheLock = isSmokeTest || app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();
else app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
