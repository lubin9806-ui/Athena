/** Athena 主进程入口 */

import { app, BrowserWindow, dialog, Tray, Menu, nativeImage, shell, WebContents } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { installLoggingPipeGuards } from '../engine/Logger';
import { registerIpcHandlers } from './ipc';
import { consumeMicrophoneGrant, hasMicrophoneGrant } from './security/PermissionGate';
import { getAppSettings } from '../core/config/SettingsStore';
import { applyDesktopSettings } from './DesktopSettings';
import { installCrashDiagnostics, recordCrashDiagnostic } from '../core/runtime/CrashDiagnostics';
import { initializeDesktopUpdater } from '../core/update/DesktopUpdater';
import { describeSteamCloudAvailability, initializeSteamPlatform } from '../core/steam/SteamPlatform';
import { isSteamExternalNavigationAllowed } from '../core/steam/SteamSkuPolicy';
import { isMicrosoftStoreSku } from '../core/store/MicrosoftStoreSku';

installLoggingPipeGuards();
installCrashDiagnostics();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const isSmokeTest = process.argv.includes('--smoke-test') || process.env.ATHENA_SMOKE_TEST === '1';
const steamPlatform = initializeSteamPlatform();
const isSteamBuild = steamPlatform.state.sku === 'steam';
const isMicrosoftStoreBuild = isMicrosoftStoreSku();
const isVoiceSmokeTest = isSmokeTest && process.env.ATHENA_SMOKE_VOICE === '1';
const isModelSmokeTest = isSmokeTest && process.env.ATHENA_SMOKE_MODEL === '1';
const smokeScreenshotPath = process.env.ATHENA_SMOKE_SCREENSHOT?.trim();
const smokeCaptureRipple = isSmokeTest && process.env.ATHENA_SMOKE_CAPTURE_RIPPLE === '1';
const smokeSelectId = isSmokeTest ? process.env.ATHENA_SMOKE_SELECT?.trim() || null : null;
const smokeTheme = process.env.ATHENA_SMOKE_THEME === 'night'
  ? 'night'
  : process.env.ATHENA_SMOKE_THEME === 'day'
    ? 'day'
    : null;
const smokePanel = process.env.ATHENA_SMOKE_PANEL === 'settings'
  ? 'settings'
  : process.env.ATHENA_SMOKE_PANEL === 'model'
    ? 'model'
  : process.env.ATHENA_SMOKE_PANEL === 'memory'
    ? 'memory'
    : process.env.ATHENA_SMOKE_PANEL === 'tools'
      ? 'tools'
    : process.env.ATHENA_SMOKE_PANEL === 'execution'
      ? 'execution'
      : null;
const smokeMode = process.env.ATHENA_SMOKE_MODE === 'create'
  ? 'create'
  : process.env.ATHENA_SMOKE_MODE === 'reason'
    ? 'reason'
    : process.env.ATHENA_SMOKE_MODE === 'companion'
      ? 'companion'
      : null;
const smokeWindowWidth = smokeDimension(process.env.ATHENA_SMOKE_WIDTH, 1180, 680, 3840);
const smokeWindowHeight = smokeDimension(process.env.ATHENA_SMOKE_HEIGHT, 760, 560, 2160);
const smokeUserDataPath = isSmokeTest
  ? path.join(os.tmpdir(), 'athena-smoke', String(process.pid))
  : null;
let smokeReadyLogged = false;

if (isVoiceSmokeTest) {
  app.disableHardwareAcceleration();
}

if (smokeUserDataPath) {
  app.setPath('userData', smokeUserDataPath);
  process.env.ATHENA_CONFIG_DIR ||= path.join(smokeUserDataPath, 'config');
  process.env.ATHENA_DB_DIR ||= path.join(smokeUserDataPath, 'database');
  process.env.ATHENA_DIAGNOSTICS_DIR ||= path.join(smokeUserDataPath, 'diagnostics');
  process.env.ATHENA_VOICE_TEMP_DIR ||= path.join(smokeUserDataPath, 'voice');
  if (isVoiceSmokeTest) {
    fs.mkdirSync(process.env.ATHENA_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ATHENA_CONFIG_DIR, 'settings.json'), JSON.stringify({
      version: 2,
      voice: {
        sttEnabled: true,
        ttsEnabled: true,
        autoPlayAssistant: false,
        sttEngine: 'local_whisper',
        ttsVoice: '',
        silenceAutoStop: true,
      },
    }, null, 2), 'utf8');
  }
  process.once('exit', () => {
    try {
      fs.rmSync(smokeUserDataPath, { recursive: true, force: true });
    } catch {
      // A terminated Chromium helper may briefly retain a cache file on Windows.
    }
  });
}

if (!smokeUserDataPath && isSteamBuild) {
  app.setName('Athena Steam');
  app.setPath('userData', path.join(app.getPath('appData'), 'Athena Steam'));
}

if (!smokeUserDataPath && isMicrosoftStoreBuild) {
  app.setName('Athena Microsoft Store');
  app.setPath('userData', path.join(app.getPath('appData'), 'Athena Microsoft Store'));
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (isVoiceSmokeTest) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('disable-gpu');
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
      && isMainAppPage(webContents, details.requestingUrl)
      && hasMicrophoneGrant();
  });

  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const isAudioOnly = mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio');
    callback(
      permission === 'media'
      && details.isMainFrame
      && isAudioOnly
      && isMainAppPage(webContents, details.requestingUrl)
      && consumeMicrophoneGrant(),
    );
  });
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function confirmExternalOpen(window: BrowserWindow, value: string): Promise<void> {
  if (!isSteamExternalNavigationAllowed()) return;
  if (!isSafeExternalUrl(value) || window.isDestroyed()) return;
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '确认打开外部链接',
    message: '此操作会启动系统浏览器并访问外部网络地址。',
    detail: value,
    buttons: ['取消', '打开链接'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result.response === 1 && !window.isDestroyed()) await shell.openExternal(value);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: isSmokeTest ? smokeWindowWidth : 1180,
    height: isSmokeTest ? smokeWindowHeight : 760,
    minWidth: 680,
    minHeight: 560,
    frame: false,
    resizable: true,
    icon: path.join(__dirname, '../../resources/su-shixia-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
  });

  mainWindow.webContents.setAudioMuted(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void confirmExternalOpen(mainWindow!, url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.on('will-download', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isMainAppPage(mainWindow?.webContents ?? null, url)) return;
    event.preventDefault();
    if (mainWindow) void confirmExternalOpen(mainWindow, url);
  });
  configureMediaPermissions(mainWindow);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`ATHENA_RENDERER_GONE reason=${details.reason} exitCode=${details.exitCode}`);
    recordCrashDiagnostic('renderer-gone', { reason: details.reason, exitCode: details.exitCode });
  });
  if (isSmokeTest) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('ATHENA_SMOKE_')) console.log(message);
    });
  }
  mainWindow.on('unresponsive', () => {
    console.error('ATHENA_WINDOW_UNRESPONSIVE');
    recordCrashDiagnostic('window-unresponsive', {});
  });
  mainWindow.loadURL(pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString());

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow?.show();
    else {
      if (isVoiceSmokeTest) mainWindow?.showInactive();
      logSmokeReady();
    }
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
             const lifeCore = document.getElementById('life-core');
             const inputForm = document.getElementById('input-form');
             const spaceNavigation = document.getElementById('space-navigation');
             const spaceSwitch = document.getElementById('mode-switch');
             const workModeSwitch = document.getElementById('work-mode-switch');
             const memoryButton = document.getElementById('btn-memory');
             const memoryClose = document.getElementById('btn-memory-close');
             const memoryPanel = document.getElementById('memory-panel');
             const executionButton = document.getElementById('mode-execute-button');
             const executionPanel = document.getElementById('execution-panel');
             const chatWindowNew = document.getElementById('chat-window-new');
             const chatWindowTemporary = document.getElementById('chat-window-temporary');
             const chatWindowBadge = document.getElementById('temporary-chat-badge');
             const chatWindowArchive = document.getElementById('chat-window-archive');
             const chatWindowDelete = document.getElementById('chat-window-delete');
             const chatWindowSelect = document.getElementById('chat-window-select');
             const webSearchButton = document.getElementById('web-search-btn');
             const composerMoreButton = document.getElementById('composer-more-btn');
             const availableToolsButton = document.getElementById('available-tools-btn');
             const toolsPanel = document.getElementById('tools-panel');
             const toolsPanelList = document.getElementById('tools-panel-list');
             const toolsClose = document.getElementById('btn-tools-close');
             const toolAccessHint = document.getElementById('tool-access-hint');
             const executeToolPermission = document.getElementById('setting-tool-permission-execute');
             const firstRunModelChoice = document.getElementById('model-first-run-choice');
              const modelProviderSelect = document.getElementById('setting-model-provider');
              const modelOllamaFields = document.getElementById('model-ollama-fields');
              const modelRemoteFields = document.getElementById('model-remote-fields');
              const inputBox = document.getElementById('input-box');
              const visiblePresenceAction = Array.from(document.querySelectorAll('.presence-action'))
                .find(button => getComputedStyle(button).display !== 'none');
              const uiReady = Boolean(
               appShell &&
               document.getElementById('chat-container') &&
               inputForm &&
               stage &&
               titlebar &&
               lifeCore &&
               spaceNavigation &&
               spaceSwitch &&
               workModeSwitch &&
               spaceSwitch.querySelectorAll('.space-btn').length === 2 &&
               workModeSwitch.querySelectorAll('.mode-btn').length === 3 &&
               memoryButton &&
               memoryClose &&
               memoryPanel &&
               executionButton &&
               executionPanel &&
               chatWindowNew instanceof HTMLButtonElement &&
               chatWindowTemporary instanceof HTMLButtonElement &&
               chatWindowBadge &&
               chatWindowArchive instanceof HTMLButtonElement &&
               chatWindowDelete instanceof HTMLButtonElement &&
               chatWindowSelect instanceof HTMLSelectElement &&
               webSearchButton &&
               composerMoreButton &&
               availableToolsButton instanceof HTMLButtonElement &&
               toolsPanel &&
               toolsPanelList &&
               toolsClose instanceof HTMLButtonElement &&
               toolAccessHint &&
               executeToolPermission instanceof HTMLSelectElement &&
               firstRunModelChoice &&
                modelProviderSelect instanceof HTMLSelectElement &&
                modelOllamaFields &&
                modelRemoteFields &&
                inputBox instanceof HTMLTextAreaElement &&
                visiblePresenceAction instanceof HTMLButtonElement &&
               document.getElementById('setting-remote-url') &&
               document.getElementById('setting-remote-model') &&
               document.getElementById('model-load-options') &&
               document.getElementById('setting-web-search-enabled') &&
               document.getElementById('setting-web-search-deep-read') &&
               document.getElementById('setting-web-search-secondary') &&
               document.getElementById('setting-web-search-max-pages') &&
               document.getElementById('setting-consent-web-search') &&
               document.getElementById('setting-consent-external-tool-network') &&
               document.getElementById('privacy-data-map') &&
               document.getElementById('privacy-static-decision') &&
               document.getElementById('privacy-export') &&
               document.getElementById('privacy-clear') &&
               micButton &&
              document.getElementById('voice-file-btn') &&
              document.getElementById('voice-feedback') &&
              api &&
              typeof api.transcribeRecording === 'function' &&
              typeof api.playAudioFile === 'function' &&
              typeof api.getSettings === 'function' &&
              typeof api.saveSettings === 'function'
              && typeof api.getPrivacyCenter === 'function'
              && typeof api.exportPrivacyData === 'function'
              && typeof api.clearLocalData === 'function'
              && typeof api.cancelExecution === 'function'
              && typeof api.getToolCatalog === 'function'
              && typeof api.onWebSearchStatus === 'function'
              && typeof api.requestMicrophoneAccess === 'function'
              && typeof api.getVoiceCapabilities === 'function'
              && typeof api.listModelOptions === 'function'
              );
              if (!uiReady) return false;

              const presencePrompt = visiblePresenceAction.dataset.prompt || '';
              visiblePresenceAction.click();
              const presenceQuickActionReactive = inputBox.value === presencePrompt && presencePrompt.length > 0;
              inputBox.value = '';
              inputBox.dispatchEvent(new Event('input', { bubbles: true }));
              if (!presenceQuickActionReactive) return false;

             const stageRect = stage.getBoundingClientRect();
             stage.dispatchEvent(new PointerEvent('pointermove', {
               bubbles: true,
               clientX: stageRect.right - 12,
               clientY: stageRect.top + stageRect.height * 0.35,
             }));
             await new Promise(resolve => setTimeout(resolve, 80));
             const glassReactive = Boolean(titlebar.style.getPropertyValue('--glass-x'));
             const liquidVelocityReactive = Boolean(titlebar.style.getPropertyValue('--glass-pressure'))
               && Boolean(lifeCore.style.getPropertyValue('--core-velocity'));
             let liquidShaderReactive = false;
             for (let attempt = 0; attempt < 40; attempt += 1) {
               liquidShaderReactive = spaceSwitch.dataset.liquidRenderer === 'webgl'
                 && workModeSwitch.dataset.liquidRenderer === 'webgl'
                 && inputForm.dataset.liquidRenderer === 'webgl';
               if (liquidShaderReactive) break;
               await new Promise(resolve => setTimeout(resolve, 50));
             }
             if (!glassReactive || !liquidVelocityReactive || !liquidShaderReactive) return false;

             const liquidFrameBefore = Number(spaceSwitch.dataset.liquidFrame || '0');
             stage.dispatchEvent(new PointerEvent('pointermove', {
               bubbles: true,
               clientX: stageRect.left + 18,
               clientY: stageRect.bottom - 18,
             }));
             let liquidFrameAfter = liquidFrameBefore;
             for (let attempt = 0; attempt < 20; attempt += 1) {
               await new Promise(resolve => setTimeout(resolve, 25));
               liquidFrameAfter = Number(spaceSwitch.dataset.liquidFrame || '0');
               if (liquidFrameAfter > liquidFrameBefore) break;
             }
             const liquidMotionReactive = liquidFrameAfter > liquidFrameBefore;
             console.log('ATHENA_SMOKE_LIQUID_FRAME', JSON.stringify({ liquidFrameBefore, liquidFrameAfter, liquidMotionReactive }));
             if (!liquidMotionReactive) return false;

             const switchRect = spaceSwitch.getBoundingClientRect();
             spaceSwitch.dispatchEvent(new PointerEvent('pointerdown', {
               bubbles: true,
               clientX: switchRect.left + switchRect.width * 0.6,
               clientY: switchRect.top + switchRect.height * 0.5,
             }));
             const liquidPressReactive = spaceSwitch.dataset.liquidPressed === 'true';
             if (!liquidPressReactive) return false;

             const inputLiquidCanvas = inputForm.querySelector('.liquid-glass-canvas');
             const inputLiquidCanvasRect = inputLiquidCanvas?.getBoundingClientRect();
             const inputLiquidCanvasStyle = inputLiquidCanvas ? window.getComputedStyle(inputLiquidCanvas) : null;
             const inputGlassFormRect = inputForm.getBoundingClientRect();
             const inputGlassReactive = Boolean(inputForm.style.getPropertyValue('--glass-x'))
               && Boolean(inputForm.style.getPropertyValue('--glass-pressure'));
             const inputLiquidCanvasVisible = inputLiquidCanvas instanceof HTMLCanvasElement
               && inputLiquidCanvas.hidden === false
               && inputLiquidCanvasRect
               && inputLiquidCanvasRect.width >= inputGlassFormRect.width - 2
               && inputLiquidCanvasRect.height >= inputGlassFormRect.height - 2
               && inputLiquidCanvasStyle?.display !== 'none'
               && inputLiquidCanvasStyle?.visibility !== 'hidden'
               && Number(inputLiquidCanvasStyle?.opacity || '1') > 0.5;
             console.log('ATHENA_SMOKE_INPUT_GLASS', JSON.stringify({
               inputGlassReactive,
               liquidRenderer: inputForm.dataset.liquidRenderer || null,
               liquidFrame: inputForm.dataset.liquidFrame || null,
               canvasVisible: inputLiquidCanvasVisible,
               canvasRect: inputLiquidCanvasRect ? {
                 left: inputLiquidCanvasRect.left,
                 top: inputLiquidCanvasRect.top,
                 right: inputLiquidCanvasRect.right,
                 bottom: inputLiquidCanvasRect.bottom,
                 width: inputLiquidCanvasRect.width,
                 height: inputLiquidCanvasRect.height,
               } : null,
               formRect: {
                 left: inputGlassFormRect.left,
                 top: inputGlassFormRect.top,
                 right: inputGlassFormRect.right,
                 bottom: inputGlassFormRect.bottom,
                 width: inputGlassFormRect.width,
                 height: inputGlassFormRect.height,
               },
             }));
             if (!inputGlassReactive || !inputLiquidCanvasVisible) return false;

             const originalSettings = await api.getSettings();
             const firstRunPaths = Array.from(firstRunModelChoice.querySelectorAll('[data-model-path]'))
               .map(button => button.getAttribute('data-model-path'));
             const remoteProviders = ['openai', 'deepseek', 'athena-cloud', 'custom'];
             const modelProviderTruthful = originalSettings.model.provider === 'ollama'
               && originalSettings.model.setupComplete === false
               && remoteProviders.every(provider => {
                 const config = originalSettings.model.remote[provider];
                 return config && config.baseUrl === '' && config.model === '';
               });
             const firstRunModelChoicesReady = ['local', 'api'].every(path => firstRunPaths.includes(path))
               && Boolean(modelProviderSelect.querySelector('option[value="choose-api"]'));
             const localPathButton = firstRunModelChoice.querySelector('[data-model-path="local"]');
             const apiPathButton = firstRunModelChoice.querySelector('[data-model-path="api"]');
             if (!(localPathButton instanceof HTMLButtonElement) || !(apiPathButton instanceof HTMLButtonElement)) return false;
             apiPathButton.click();
             const apiPathRequiresChoice = modelProviderSelect.value === 'choose-api'
               && modelOllamaFields.hidden
               && modelRemoteFields.hidden;
             localPathButton.click();
             const localPathReactive = modelProviderSelect.value === 'ollama'
               && !modelOllamaFields.hidden
               && modelRemoteFields.hidden;
             const firstRunPathReactive = apiPathRequiresChoice && localPathReactive;
             const toolPermissionControlsReady = executeToolPermission.value === originalSettings.settings.tools.modePermissions.execute
               && originalSettings.settings.tools.modePermissions.create === 'off'
               && originalSettings.settings.tools.modePermissions.companion === 'off'
               && originalSettings.settings.tools.modePermissions.reason === 'off';
             if (!modelProviderTruthful || !firstRunModelChoicesReady || !firstRunPathReactive || !toolPermissionControlsReady) return false;
             await new Promise(resolve => setTimeout(resolve, 90));
             composerMoreButton.click();
             const webSearchNeedsConsent = webSearchButton.disabled && /同意/.test(webSearchButton.title || '');
             let webSearchForceReactive = false;
             let webSearchForceRestored = false;
             if (webSearchNeedsConsent) {
               webSearchForceReactive = true;
               webSearchForceRestored = true;
             } else {
               webSearchButton.click();
               webSearchForceReactive = webSearchButton.getAttribute('aria-pressed') === 'true';
               webSearchButton.click();
               webSearchForceRestored = webSearchButton.getAttribute('aria-pressed') === 'false';
             }
             if (!webSearchForceReactive || !webSearchForceRestored) return false;
             const originalMode = originalSettings.settings.conversation.activeMode;
             const probeMode = originalMode === 'reason' ? 'create' : 'reason';
             const probeButton = document.querySelector('.mode-btn[data-mode="' + probeMode + '"]');
             const originalButton = originalMode === 'companion'
               ? document.querySelector('.space-btn[data-space="companion"]')
               : document.querySelector('.mode-btn[data-mode="' + originalMode + '"]');
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

             const previousChatWindowId = Number(chatWindowSelect.value);
             let promptCalledForNewChat = false;
             const originalPrompt = window.prompt;
             window.prompt = () => {
               promptCalledForNewChat = true;
               return null;
             };
             chatWindowNew.click();
             let newChatImmediateReactive = false;
             let createdChatWindowId = 0;
             try {
               for (let attempt = 0; attempt < 30; attempt += 1) {
                 await new Promise(resolve => setTimeout(resolve, 100));
                 createdChatWindowId = Number(chatWindowSelect.value);
                 const projectId = Number(document.getElementById('project-select')?.value);
                 const listedWindows = await api.listChatWindows(false, projectId);
                 newChatImmediateReactive = !promptCalledForNewChat
                   && Number.isInteger(createdChatWindowId)
                   && createdChatWindowId > 0
                   && createdChatWindowId !== previousChatWindowId
                   && listedWindows.some(windowRecord => windowRecord.id === previousChatWindowId)
                   && listedWindows.some(windowRecord => windowRecord.id === createdChatWindowId)
                   && /新对话/.test(chatWindowSelect.selectedOptions[0]?.textContent || '');
                 if (newChatImmediateReactive) break;
               }
             } finally {
               window.prompt = originalPrompt;
             }
             if (!newChatImmediateReactive) return false;
             inputBox.value = '提醒列表';
             inputForm.requestSubmit();
             let newChatAutoTitleReactive = false;
             for (let attempt = 0; attempt < 40; attempt += 1) {
               await new Promise(resolve => setTimeout(resolve, 100));
               newChatAutoTitleReactive = /提醒列表/.test(chatWindowSelect.selectedOptions[0]?.textContent || '');
               if (newChatAutoTitleReactive) break;
             }
             if (!newChatAutoTitleReactive) return false;
             const previousChatButton = document.querySelector('[data-chat-window-id="' + previousChatWindowId + '"]');
             if (previousChatButton instanceof HTMLButtonElement) previousChatButton.click();
             for (let attempt = 0; attempt < 20 && Number(chatWindowSelect.value) !== previousChatWindowId; attempt += 1) {
               await new Promise(resolve => setTimeout(resolve, 50));
             }
             await api.deleteChatWindow(createdChatWindowId);

             chatWindowTemporary.click();
             let temporaryChatReactive = false;
             for (let attempt = 0; attempt < 30; attempt += 1) {
               await new Promise(resolve => setTimeout(resolve, 100));
               temporaryChatReactive = appShell.dataset.temporaryChat === 'true'
                 && chatWindowBadge.hidden === false
                 && /临时聊天/.test(chatWindowBadge.textContent || '')
                 && /关闭后清除/.test(chatWindowBadge.textContent || '')
                 && chatWindowArchive.disabled === true
                 && chatWindowDelete.textContent.trim() === '关闭'
                 && /临时聊天/.test(chatWindowSelect.selectedOptions[0]?.textContent || '');
               if (temporaryChatReactive) break;
             }
             if (!temporaryChatReactive) return false;

             composerMoreButton.click();
             await new Promise(resolve => setTimeout(resolve, 90));
             const composerTools = document.getElementById('composer-secondary-tools');
             const composerToolsRect = composerTools?.getBoundingClientRect();
             const composerToolsStyle = composerTools ? window.getComputedStyle(composerTools) : null;
             const composerMeta = document.getElementById('composer-meta');
             const composerMetaRect = composerMeta?.getBoundingClientRect();
             const composerMetaStyle = composerMeta ? window.getComputedStyle(composerMeta) : null;
             const inputFormRect = inputForm?.getBoundingClientRect();
             const composerMetaVisible = Boolean(inputFormRect
               && composerMetaRect
               && composerMetaRect.width > 120
               && composerMetaRect.height > 8
               && composerMetaRect.top >= inputFormRect.top
               && composerMetaRect.bottom <= inputFormRect.bottom - 2
               && composerMetaStyle?.display !== 'none'
               && composerMetaStyle?.visibility !== 'hidden'
               && Number(composerMetaStyle?.opacity || '1') > 0.8);
             const composerToolsVisible = composerMoreButton.getAttribute('aria-expanded') === 'true'
               && composerToolsRect
               && composerToolsRect.width > 120
               && composerToolsRect.height > 120
               && composerToolsRect.top >= 0
               && composerToolsRect.left >= 0
               && composerToolsRect.bottom <= window.innerHeight
               && (!inputFormRect || composerToolsRect.bottom <= inputFormRect.top - 6)
               && composerToolsStyle?.visibility === 'visible'
               && Number(composerToolsStyle?.opacity) > 0.8
               && Number(composerToolsStyle?.zIndex) >= 100;
             console.log('ATHENA_SMOKE_COMPOSER_TOOLS', JSON.stringify({
               expanded: composerMoreButton.getAttribute('aria-expanded'),
               rect: composerToolsRect ? {
                 left: composerToolsRect.left,
                 top: composerToolsRect.top,
                 right: composerToolsRect.right,
                 bottom: composerToolsRect.bottom,
                 width: composerToolsRect.width,
                 height: composerToolsRect.height,
               } : null,
               inputRect: inputFormRect ? {
                 left: inputFormRect.left,
                 top: inputFormRect.top,
                 right: inputFormRect.right,
                 bottom: inputFormRect.bottom,
                 width: inputFormRect.width,
                 height: inputFormRect.height,
               } : null,
               visibility: composerToolsStyle?.visibility || null,
               opacity: composerToolsStyle?.opacity || null,
               pointerEvents: composerToolsStyle?.pointerEvents || null,
               zIndex: composerToolsStyle?.zIndex || null,
               className: composerTools?.className || null,
               inlineVisibility: composerTools?.style.visibility || null,
               inlineOpacity: composerTools?.style.opacity || null,
               parentId: composerTools?.parentElement?.id || null,
               dataOpen: composerTools?.dataset.open || null,
               metaRect: composerMetaRect ? {
                 left: composerMetaRect.left,
                 top: composerMetaRect.top,
                 right: composerMetaRect.right,
                 bottom: composerMetaRect.bottom,
                 width: composerMetaRect.width,
                 height: composerMetaRect.height,
               } : null,
               metaVisible: composerMetaVisible,
               windowHeight: window.innerHeight,
               windowWidth: window.innerWidth,
             }));
             if (!composerToolsVisible || !composerMetaVisible) return false;
             availableToolsButton.click();
             let toolCatalogReactive = false;
             for (let attempt = 0; attempt < 20; attempt += 1) {
               await new Promise(resolve => setTimeout(resolve, 50));
               const catalog = await api.getToolCatalog(originalMode);
               toolCatalogReactive = toolsPanel.dataset.open === 'true'
                 && Array.isArray(catalog?.tools)
                 && catalog.tools.length >= 20
                 && toolsPanelList.querySelectorAll('.tool-catalog-item').length === catalog.tools.length;
               if (toolCatalogReactive) break;
             }
             toolsClose.click();
             if (!toolCatalogReactive || toolsPanel.dataset.open !== 'false') return false;

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
               liquidVelocityReactive,
               liquidShaderReactive,
               liquidMotionReactive,
               liquidPressReactive,
               inputGlassReactive,
               inputLiquidCanvasVisible,
                modeReactive,
                modePersisted,
                modeRestored,
                toolHintReactive,
                toolHintRestored,
                toolPermissionControlsReady,
                modelProviderTruthful,
                firstRunModelChoicesReady,
                firstRunPathReactive,
                newChatImmediateReactive,
                newChatAutoTitleReactive,
                temporaryChatReactive,
                toolCatalogReactive,
                composerToolsVisible,
                composerMetaVisible,
                webSearchForceReactive,
                webSearchForceRestored,
                presenceQuickActionReactive,
              }));
             if (!panelReactive || memoryPanel.dataset.open !== 'false' || !executionModeReactive || !executionWorkspaceReactive || !executionPermissionReactive || !executionModeRestored) return false;

             const ipcProbe = await api.transcribeRecording(new Uint8Array());
            if (!ipcProbe || ipcProbe.ok !== false || !/(empty|disabled)/i.test(ipcProbe.error || '')) return false;
            const playbackProbe = await api.playAudioFile('');
            if (!playbackProbe || playbackProbe.ok !== false) return false;
            if (${isModelSmokeTest ? 'true' : 'false'}) {
              const modelTestButton = document.getElementById('model-test-connection');
              const chatDiagnostic = document.getElementById('model-diagnostic-chat');
              if (!(modelTestButton instanceof HTMLButtonElement) || !chatDiagnostic) return false;
              modelTestButton.click();
              let modelDiagnosticReactive = false;
              for (let attempt = 0; attempt < 1200; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const row = chatDiagnostic.closest('.model-diagnostic-row');
                const state = row?.getAttribute('data-state');
                if (state === 'success' || state === 'error') {
                  modelDiagnosticReactive = state === 'success';
                  console.log('ATHENA_SMOKE_MODEL_STATE', JSON.stringify({ state, text: chatDiagnostic.textContent }));
                  break;
                }
              }
              if (!modelDiagnosticReactive) return false;
            }
            if (!${isVoiceSmokeTest ? 'true' : 'false'}) return true;

            const voiceSmokeFail = (stage, detail = {}) => {
              console.log('ATHENA_SMOKE_VOICE_STATE', JSON.stringify({ ok: false, stage, ...detail }));
              return false;
            };
            const microphoneArmed = await api.requestMicrophoneAccess();
            if (!microphoneArmed) return voiceSmokeFail('requestMicrophoneAccess');

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
            if (!recordingStarted) {
              return voiceSmokeFail('recording-start', {
                documentHidden: document.hidden,
                visibilityState: document.visibilityState,
                disabled: micButton.disabled,
                enabled: micButton.dataset.enabled,
                pressed: micButton.getAttribute('aria-pressed'),
                title: micButton.title,
                feedback: document.getElementById('voice-feedback')?.textContent || '',
              });
            }
            await new Promise(resolve => setTimeout(resolve, 350));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            const recordingStopped = await waitFor(() => micButton.getAttribute('aria-pressed') === 'false');
            if (!recordingStopped) return voiceSmokeFail('recording-stop', { pressed: micButton.getAttribute('aria-pressed') });
            console.log('ATHENA_SMOKE_VOICE_STATE', JSON.stringify({ ok: true, stage: 'recording-cancel' }));
            return true;
          } catch (error) {
            console.log('ATHENA_SMOKE_VOICE_STATE', JSON.stringify({
              ok: false,
              stage: 'exception',
              message: error instanceof Error ? error.message : String(error),
            }));
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
        if (!smokePanel) {
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const shell = document.getElementById('app-shell');
              if (shell) shell.dataset.sidebar = 'open';
              for (const id of ['btn-memory-close', 'btn-settings-close', 'btn-tools-close']) {
                const button = document.getElementById(id);
                if (button instanceof HTMLButtonElement) button.click();
              }
              return true;
            })()
          `);
          await new Promise(resolve => setTimeout(resolve, 220));
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
          const smokePanelButtonId = smokePanel === 'settings'
            ? 'btn-settings'
            : smokePanel === 'model'
              ? 'model-status-button'
            : smokePanel === 'memory'
              ? 'btn-memory'
              : smokePanel === 'tools'
                ? 'available-tools-btn'
                : 'mode-execute-button';
          const smokePanelId = smokePanel === 'settings' || smokePanel === 'model'
            ? 'settings-panel'
            : smokePanel === 'memory'
              ? 'memory-panel'
              : smokePanel === 'tools'
                ? 'tools-panel'
                : 'execution-panel';
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
        if (smokeMode) {
          const modeApplied = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const button = ${JSON.stringify(smokeMode)} === 'companion'
                ? document.querySelector('.space-btn[data-space="companion"]')
                : document.querySelector('.mode-btn[data-mode="${smokeMode}"]');
              if (!(button instanceof HTMLButtonElement)) return false;
              button.click();
              return document.getElementById('app-shell')?.dataset.mode === ${JSON.stringify(smokeMode)};
            })()
          `);
          if (!modeApplied) throw new Error('Smoke mode could not be applied');
          await new Promise(resolve => setTimeout(resolve, 220));
        }
        if (smokeSelectId) {
          const selectOpened = await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const select = document.getElementById(${JSON.stringify(smokeSelectId)});
              const trigger = select?.nextElementSibling;
              if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement)) return false;
              document.querySelectorAll('.settings-section').forEach(section => {
                if (section instanceof HTMLDetailsElement) section.open = section.contains(select);
              });
              await new Promise(resolve => setTimeout(resolve, 320));
              trigger.scrollIntoView({ block: 'center' });
              await new Promise(resolve => setTimeout(resolve, 180));
              trigger.click();
              return trigger.dataset.open === 'true'
                && document.querySelector('.athena-select-menu')?.getAttribute('aria-hidden') === 'false';
            })()
          `);
          if (!selectOpened) throw new Error(`Smoke select could not be opened: ${smokeSelectId}`);
          await new Promise(resolve => setTimeout(resolve, 260));
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
        const layoutState = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const shell = document.getElementById('app-shell');
            const ids = ['titlebar', 'chat-window-bar', 'mode-switch', 'stage', 'input-form', 'memory-panel', 'settings-panel', 'tools-panel'];
            const rects = Object.fromEntries(ids.map(id => {
              const element = document.getElementById(id);
              if (!element) return [id, null];
              const rect = element.getBoundingClientRect();
              return [id, { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: getComputedStyle(element).display }];
            }));
            return { sidebar: shell?.dataset.sidebar, mode: shell?.dataset.mode, rects };
          })()
        `);
        console.log('ATHENA_SMOKE_LAYOUT_STATE', JSON.stringify(layoutState));
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

  mainWindow.center();

  mainWindow.on('minimize', () => mainWindow?.hide());
  mainWindow.on('close', (event) => {
    if (!isQuitting && !isSmokeTest && getAppSettings().general.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function logSmokeReady(): void {
  if (smokeReadyLogged) return;
  smokeReadyLogged = true;
  console.log('ATHENA_SMOKE_READY_TO_SHOW');
}

function smokeDimension(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../../resources/su-shixia-tray.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Athena Desktop Assistant');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Athena', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(() => {
  if (steamPlatform.state.status === 'relaunch-required') {
    app.quit();
    return;
  }
  if (steamPlatform.state.status === 'blocked') {
    dialog.showErrorBox(
      'Steam 启动校验失败',
      `Athena Steam 需要从拥有该 AppID 的 Steam 客户端启动。\n\n${steamPlatform.state.reason || 'Unknown Steamworks error.'}`,
    );
    app.quit();
    return;
  }
  if (isSteamBuild) {
    console.log(`ATHENA_STEAM_READY appId=${steamPlatform.state.appId} branch=${steamPlatform.state.branch || 'default'} cloud=${describeSteamCloudAvailability(steamPlatform)}`);
  }
  applyDesktopSettings(getAppSettings().general);
  createWindow();
  if (mainWindow && !isSmokeTest && !isSteamBuild && !isMicrosoftStoreBuild) initializeDesktopUpdater(mainWindow);
  if (!isSmokeTest && !isSteamBuild) createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show(); });
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const gotTheLock = isSmokeTest || app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();
else app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
