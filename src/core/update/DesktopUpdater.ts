import { app, BrowserWindow, dialog, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { NsisUpdater } from 'electron-updater';
import {
  ChannelControl,
  evaluateOfferedVersion,
  isApprovedRemoteUrl,
  parseChannelControl,
  parsePublishedCandidate,
  parseRollbackControl,
  parseUpdateConfiguration,
  RollbackControl,
  PublishedCandidate,
  UpdateConfiguration,
} from './UpdatePolicy';

const MINIMUM_INTERVAL_MS = 15 * 60 * 1000;
const MAXIMUM_REMOTE_JSON_BYTES = 64 * 1024;

type RemoteResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' | 'invalid' | 'unavailable' };

interface ApprovedUpdateState {
  control: ChannelControl;
  candidate: PublishedCandidate | null;
  rollback: RollbackControl | null;
}

export function initializeDesktopUpdater(window: BrowserWindow): void {
  if (!app.isPackaged || process.env.ATHENA_DISABLE_UPDATES === '1') return;
  const configuration = loadConfiguration();
  if (!configuration?.enabled) {
    console.log('ATHENA_UPDATE_DISABLED no-approved-feed');
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
  updater.on('update-not-available', info => console.log(`ATHENA_UPDATE_CURRENT version=${safeText(info.version)}`));
  updater.on('download-progress', progress => console.log(`ATHENA_UPDATE_PROGRESS percent=${Math.floor(progress.percent)}`));
  updater.on('update-available', async info => {
    const state = await readApprovedUpdateState(configuration, channelRoot);
    if (!state) return;
    if (state.control.paused) {
      console.log(`ATHENA_UPDATE_PAUSED reason=${safeText(state.control.reason || 'operator-paused')}`);
      return;
    }
    if (!state.candidate || state.candidate.version !== info.version) {
      console.error(`ATHENA_UPDATE_BLOCKED reason=candidate-version-mismatch offered=${safeText(info.version)}`);
      return;
    }
    const decision = evaluateOfferedVersion(app.getVersion(), state.candidate.version, configuration.channel, state.rollback);
    if (!decision.approved || decision.allowDowngrade !== updater.allowDowngrade) {
      console.error(`ATHENA_UPDATE_BLOCKED reason=${decision.reason} offered=${safeText(info.version)}`);
      return;
    }
    const choice = await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Athena 更新可用',
      message: `发现 ${configuration.channel} 更新 ${info.version}。`,
      detail: decision.allowDowngrade
        ? `这是受控回滚：${state.rollback?.reason || '已批准的稳定性回滚'}。下载完成后会再次询问是否安装。`
        : '下载完成后会再次询问是否重启安装。你的本地数据不会由卸载器自动删除。',
      buttons: ['稍后', decision.allowDowngrade ? '下载回滚版本' : '下载更新'],
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
    const state = await readApprovedUpdateState(configuration, channelRoot);
    if (!state) return;
    if (state.control.paused) {
      console.log(`ATHENA_UPDATE_PAUSED reason=${safeText(state.control.reason || 'operator-paused')}`);
      return;
    }
    if (!state.candidate) return;
    const decision = evaluateOfferedVersion(app.getVersion(), state.candidate.version, configuration.channel, state.rollback);
    if (!decision.approved) {
      if (decision.reason === 'version-not-actionable') {
        console.log(`ATHENA_UPDATE_CURRENT version=${safeText(state.candidate.version)}`);
      } else {
        console.error(`ATHENA_UPDATE_BLOCKED reason=${decision.reason} target=${safeText(state.candidate.version)}`);
      }
      return;
    }
    updater.allowDowngrade = decision.allowDowngrade;
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
    const stats = fs.statSync(filePath);
    if (stats.size > MAXIMUM_REMOTE_JSON_BYTES) return null;
    return parseUpdateConfiguration(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

async function readApprovedUpdateState(configuration: UpdateConfiguration, channelRoot: string): Promise<ApprovedUpdateState | null> {
  const control = await readRemoteJson(
    configuration.baseUrl,
    `${channelRoot}/control.json`,
    value => parseChannelControl(value, configuration.channel),
  );
  if (control.status !== 'ok') {
    console.error(`ATHENA_UPDATE_BLOCKED control-${control.status}`);
    return null;
  }
  if (control.value.paused) return { control: control.value, candidate: null, rollback: null };

  const candidate = await readRemoteJson(
    configuration.baseUrl,
    `${channelRoot}/latest.json`,
    value => parsePublishedCandidate(value, configuration.channel),
  );
  if (candidate.status !== 'ok') {
    console.error(`ATHENA_UPDATE_BLOCKED candidate-${candidate.status}`);
    return null;
  }

  const rollback = await readRemoteJson(
    configuration.baseUrl,
    `${channelRoot}/rollback.json`,
    value => parseRollbackControl(value, configuration.channel),
    true,
  );
  if (rollback.status === 'missing') return { control: control.value, candidate: candidate.value, rollback: null };
  if (rollback.status !== 'ok') {
    console.error(`ATHENA_UPDATE_BLOCKED rollback-${rollback.status}`);
    return null;
  }
  if (rollback.value.targetCandidateId !== candidate.value.candidateId
    || rollback.value.targetVersion !== candidate.value.version) {
    console.error('ATHENA_UPDATE_BLOCKED rollback-candidate-mismatch');
    return null;
  }
  return { control: control.value, candidate: candidate.value, rollback: rollback.value };
}

async function readRemoteJson<T>(
  approvedBaseUrl: string,
  url: string,
  parse: (value: unknown) => T | null,
  optional = false,
): Promise<RemoteResult<T>> {
  if (!isApprovedRemoteUrl(approvedBaseUrl, url)) return { status: 'invalid' };
  try {
    const response = await net.fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      redirect: 'manual',
    });
    if (optional && response.status === 404) return { status: 'missing' };
    if (!response.ok || !response.url || new URL(response.url).href !== new URL(url).href) return { status: 'unavailable' };
    if (!isApprovedRemoteUrl(approvedBaseUrl, response.url)) return { status: 'invalid' };
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json' && !contentType?.endsWith('+json')) return { status: 'invalid' };
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_REMOTE_JSON_BYTES) return { status: 'invalid' };
    const text = await readBoundedText(response);
    if (text === null) return { status: 'invalid' };
    const parsed = parse(JSON.parse(text));
    return parsed ? { status: 'ok', value: parsed } : { status: 'invalid' };
  } catch {
    return { status: 'unavailable' };
  }
}

async function readBoundedText(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAXIMUM_REMOTE_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(combined);
}

function safeError(error: unknown): string {
  return safeText(error instanceof Error ? error.message : String(error));
}

function safeText(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 240);
}
