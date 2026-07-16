import { app, BrowserWindow, dialog, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { NsisUpdater } from 'electron-updater';

interface UpdateConfiguration {
  schemaVersion: number;
  enabled: boolean;
  baseUrl: string;
  channel: 'beta' | 'stable';
  checkIntervalHours: number;
}

interface ChannelControl {
  paused?: boolean;
  reason?: string | null;
}

interface RollbackControl {
  targetVersion?: string;
  targetCandidateId?: string;
  reason?: string;
}

const MINIMUM_INTERVAL_MS = 15 * 60 * 1000;

export function initializeDesktopUpdater(window: BrowserWindow): void {
  if (!app.isPackaged || process.env.ATHENA_DISABLE_UPDATES === '1') return;
  const configuration = loadConfiguration();
  if (!configuration?.enabled) {
    console.log('ATHENA_UPDATE_DISABLED no-approved-feed');
    return;
  }
  if (!isApprovedHttpsBase(configuration.baseUrl)) {
    console.error('ATHENA_UPDATE_BLOCKED invalid-https-feed');
    return;
  }

  const channelRoot = `${configuration.baseUrl}/channels/${configuration.channel}`;
  const updater = new NsisUpdater({
    provider: 'generic',
    url: channelRoot,
    channel: configuration.channel,
    timeout: 30000,
  });
  updater.channel = configuration.channel;
  updater.allowDowngrade = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  updater.on('error', error => console.error(`ATHENA_UPDATE_ERROR ${safeError(error)}`));
  updater.on('update-not-available', info => console.log(`ATHENA_UPDATE_CURRENT version=${info.version}`));
  updater.on('download-progress', progress => console.log(`ATHENA_UPDATE_PROGRESS percent=${Math.floor(progress.percent)}`));
  updater.on('update-available', async info => {
    const control = await readRemoteJson<ChannelControl>(`${channelRoot}/control.json`);
    if (!control || control.paused) {
      console.log(`ATHENA_UPDATE_PAUSED reason=${safeText(control?.reason || 'control-unavailable')}`);
      return;
    }
    const choice = await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Athena 更新可用',
      message: `发现 ${configuration.channel} 更新 ${info.version}。`,
      detail: '下载完成后会再次询问是否重启安装。你的本地数据不会由卸载器自动删除。',
      buttons: ['稍后', '下载更新'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice.response === 1) await updater.downloadUpdate();
  });
  updater.on('update-downloaded', async info => {
    const choice = await dialog.showMessageBox(window, {
      type: 'info',
      title: '更新已验证并下载',
      message: `Athena ${info.version} 已准备好安装。`,
      detail: '选择重启后，应用会退出并运行已签名的 NSIS 更新。',
      buttons: ['稍后', '重启并安装'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice.response === 1) updater.quitAndInstall(false, true);
  });

  const check = async (): Promise<void> => {
    const control = await readRemoteJson<ChannelControl>(`${channelRoot}/control.json`);
    if (!control || control.paused) {
      console.log(`ATHENA_UPDATE_PAUSED reason=${safeText(control?.reason || 'control-unavailable')}`);
      return;
    }
    const rollback = await readRemoteJson<RollbackControl>(`${channelRoot}/rollback.json`, true);
    updater.allowDowngrade = Boolean(rollback?.targetVersion && rollback.targetVersion !== app.getVersion());
    await updater.checkForUpdates();
  };

  setTimeout(() => void check().catch(error => console.error(`ATHENA_UPDATE_CHECK_FAILED ${safeError(error)}`)), 5000);
  const intervalMs = Math.max(MINIMUM_INTERVAL_MS, configuration.checkIntervalHours * 60 * 60 * 1000);
  const timer = setInterval(() => void check().catch(error => console.error(`ATHENA_UPDATE_CHECK_FAILED ${safeError(error)}`)), intervalMs);
  timer.unref();
}

function loadConfiguration(): UpdateConfiguration | null {
  try {
    const filePath = path.join(process.resourcesPath, 'update-config.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as UpdateConfiguration;
  } catch {
    return null;
  }
}

async function readRemoteJson<T>(url: string, optional = false): Promise<T | null> {
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (optional && response.status === 404) return null;
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function isApprovedHttpsBase(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function safeError(error: unknown): string {
  return safeText(error instanceof Error ? error.message : String(error));
}

function safeText(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 240);
}
