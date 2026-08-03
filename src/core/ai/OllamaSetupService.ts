import { BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface OllamaSetupStatus {
  installed: boolean;
  bundledInstallerAvailable: boolean;
  executablePath: string;
}

export function getOllamaSetupStatus(): OllamaSetupStatus {
  const executablePath = findOllamaExecutable() || '';
  return {
    installed: Boolean(executablePath),
    bundledInstallerAvailable: Boolean(findBundledInstaller()),
    executablePath,
  };
}

export async function openOllamaDownload(): Promise<boolean> {
  await shell.openExternal('https://ollama.com/download/windows');
  return true;
}

export async function installBundledOllama(window: BrowserWindow): Promise<{ started: boolean; error?: string }> {
  const installer = findBundledInstaller();
  if (!installer) return { started: false, error: '当前安装包未附带 Ollama 安装器，请使用官方下载入口。' };
  const choice = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '安装 Ollama',
    message: '将启动 Ollama 官方 Windows 安装器。',
    detail: '安装器会修改当前 Windows 用户的软件环境。继续前请确认来源和签名。',
    buttons: ['取消', '继续安装'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (choice.response !== 1) return { started: false };
  spawn(installer, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { started: true };
}

export async function pullOllamaModel(window: BrowserWindow, model: string): Promise<{ started: boolean; error?: string }> {
  const executable = findOllamaExecutable();
  if (!executable) return { started: false, error: '尚未检测到 Ollama。' };
  const safeModel = model.trim();
  if (!/^[a-zA-Z0-9._:/-]{1,160}$/.test(safeModel)) return { started: false, error: '模型名称格式无效。' };
  const choice = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '下载本地模型',
    message: `将通过 Ollama 下载 ${safeModel}`,
    detail: '模型可能占用数 GB 网络流量和磁盘空间。下载由 Ollama 执行，可在 Ollama 中查看进度。',
    buttons: ['取消', '开始下载'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (choice.response !== 1) return { started: false };
  spawn(executable, ['pull', safeModel], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { started: true };
}

function findOllamaExecutable(): string | null {
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe') : '',
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function findBundledInstaller(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'OllamaSetup.exe') : '',
    path.join(path.dirname(process.execPath), 'OllamaSetup.exe'),
    path.resolve(process.cwd(), 'resources', 'OllamaSetup.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}
