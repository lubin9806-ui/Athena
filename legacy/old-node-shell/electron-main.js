/**
 * Athena — Electron 桌面入口 v3
 * 自动启动 launch.js 服务器（或复用已有服务）
 * 无边框窗口 + 系统托盘 + 开机自启 + 进程清理 + 麦克风授权
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, screen, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3000;
const LAUNCH_SCRIPT = path.join(__dirname, 'launch.js');
const ICON_PATH = path.join(__dirname, 'resources', 'tray.png');

let mainWindow = null;
let tray = null;
let serverProcess = null;

// ========== 创建占位托盘图标 ==========
function createTrayIcon() {
  if (fs.existsSync(ICON_PATH)) {
    return nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  }
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 139;
    buf[i * 4 + 1] = 92;
    buf[i * 4 + 2] = 246;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ========== 检测端口是否已被占用 ==========
function checkPortOccupied() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ollama === true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// ========== 等待服务器就绪 ==========
function waitForServer(callback, attempts = 0) {
  if (attempts > 60) { callback(false); return; }
  const req = http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ollama) callback(true);
        else setTimeout(() => waitForServer(callback, attempts + 1), 1000);
      } catch { setTimeout(() => waitForServer(callback, attempts + 1), 1000); }
    });
  });
  req.on('error', () => setTimeout(() => waitForServer(callback, attempts + 1), 1000));
  req.setTimeout(5000, () => { req.destroy(); setTimeout(() => waitForServer(callback, attempts + 1), 1000); });
  req.end();
}

// ========== 创建窗口 ==========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    resizable: true,
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: '#0a0015',
  });

  // 自动授权麦克风和摄像头
  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true); // 自动允许
    } else {
      callback(false);
    }
  });

  // 处理页面内的权限请求
  ses.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'audioCapture') {
      return true;
    }
    return false;
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const [ww, wh] = mainWindow.getSize();
    mainWindow.setPosition(sw - ww - 20, sh - wh - 60);
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ========== 系统托盘 ==========
function createTray() {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('Athena · 苏时夏');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Athena', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '重启', click: () => { app.relaunch(); app.exit(0); } },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) {
    console.error('[Athena] 托盘创建失败:', e.message);
  }
}

// ========== 设置开机自启 ==========
function setupAutoStart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: ['--no-sandbox'],
    });
    console.log('[Athena] 开机自启已设置');
  } catch (e) {
    console.error('[Athena] 开机自启设置失败:', e.message);
  }
}

// ========== 清理子进程 ==========
function cleanup() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGKILL');
      console.log('[Athena] 子进程已终止');
    } catch {}
    serverProcess = null;
  }
}

// ========== 启动 ==========
app.whenReady().then(async () => {
  const occupied = await checkPortOccupied();
  
  if (!occupied) {
    console.log('[Athena] 启动服务...');
    serverProcess = spawn('node', [LAUNCH_SCRIPT], {
      cwd: __dirname,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
      env: { ...process.env, ELECTRON_MODE: 'true' },
    });

    serverProcess.on('error', (err) => {
      console.error('[Athena] 服务启动失败:', err.message);
      app.quit();
    });

    waitForServer((ok) => {
      if (ok) {
        createWindow();
        createTray();
        setupAutoStart();
        console.log('[Athena] 桌面版已启动');
      } else {
        console.error('[Athena] 服务启动超时');
        cleanup();
        app.quit();
      }
    });
  } else {
    console.log('[Athena] 检测到已有服务运行，直接加载...');
    createWindow();
    createTray();
    setupAutoStart();
    console.log('[Athena] 桌面版已启动（复用现有服务）');
  }
});

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  app.isQuitting = true;
  cleanup();
});

app.on('will-quit', () => {
  cleanup();
});

process.on('exit', () => {
  cleanup();
});