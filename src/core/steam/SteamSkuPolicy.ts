import * as fs from 'fs';
import * as path from 'path';
import type {
  AppSettings,
  SteamProductConfig,
  SteamRuntimeConfig,
  ToolPermissionLevel,
  ToolSettings,
} from '../../shared/types';

const FORBIDDEN_STEAM_TOOLS = new Set([
  'run_command',
  'terminal_start',
  'terminal_write',
  'terminal_read',
  'terminal_list',
  'terminal_stop',
  'launch_program',
  'open_path',
  'http_request',
  'check_port',
]);

let runtimeOverride: SteamRuntimeConfig | null | undefined;

export function loadSteamProductConfig(filePath?: string): SteamProductConfig {
  const target = filePath || path.join(resolveProjectRoot(), 'config', 'steam.json');
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as unknown;
  assertSteamProductConfig(parsed);
  return parsed;
}

export function loadSteamRuntimeConfig(): SteamRuntimeConfig | null {
  if (runtimeOverride !== undefined) return runtimeOverride;
  const explicit = process.env.ATHENA_STEAM_RUNTIME_CONFIG?.trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    explicit,
    resourcesPath ? path.join(resourcesPath, 'steam', 'steam-runtime.json') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as unknown;
    assertSteamRuntimeConfig(parsed);
    return parsed;
  }
  return null;
}

export function setSteamRuntimeOverrideForTests(config: SteamRuntimeConfig | null | undefined): void {
  runtimeOverride = config;
}

export function isSteamSku(): boolean {
  return loadSteamRuntimeConfig()?.skuId === 'athena-steam-personal-v1';
}

export function applySteamSettingsPolicy(settings: AppSettings): AppSettings {
  if (!isSteamSku()) return settings;
  const cappedTools = capSteamToolSettings(settings.tools);
  return {
    ...settings,
    general: {
      ...settings.general,
      launchAtStartup: false,
      closeToTray: false,
    },
    tools: cappedTools,
    webSearch: {
      ...settings.webSearch,
      enabled: false,
      deepRead: false,
      secondarySearch: false,
    },
    privacy: {
      ...settings.privacy,
      networkConsent: {
        ...settings.privacy.networkConsent,
        webSearch: false,
        imageGeneration: false,
        onlineSpeechToText: false,
        onlineTextToSpeech: false,
        externalToolNetwork: false,
        cloudSync: false,
      },
    },
    cloud: {
      ...settings.cloud,
      syncEnabled: false,
    },
  };
}

export function capSteamToolSettings(settings: ToolSettings): ToolSettings {
  if (!isSteamSku()) return settings;
  return {
    ...settings,
    permissionLevel: capToolPermission(settings.permissionLevel),
    modePermissions: {
      create: capToolPermission(settings.modePermissions.create),
      companion: capToolPermission(settings.modePermissions.companion),
      reason: capToolPermission(settings.modePermissions.reason),
      execute: capToolPermission(settings.modePermissions.execute),
    },
    allowExternalNetwork: false,
  };
}

export function isSteamToolAllowed(toolName: string, minimumLevel?: ToolPermissionLevel): boolean {
  if (!isSteamSku()) return true;
  return minimumLevel !== 'full' && !FORBIDDEN_STEAM_TOOLS.has(toolName);
}

export function isSteamExternalNavigationAllowed(): boolean {
  return !isSteamSku();
}

export function assertSteamProductConfig(value: unknown): asserts value is SteamProductConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('Unsupported Steam product config schema.');
  if (value.skuId !== 'athena-steam-personal-v1') throw new Error('Steam SKU drift detected.');
  if (value.appId !== null || value.depotId !== null) {
    throw new Error('Real Steam AppID/DepotID must be supplied by the release environment, not committed to config/steam.json.');
  }
  if (value.launchExecutable !== 'AthenaSteam.exe') throw new Error('Steam launch executable drift detected.');
  if (value.externalPayments !== false) throw new Error('Steam SKU must not enable external payments.');
  if (!Array.isArray(value.supportedPlatforms) || value.supportedPlatforms.length !== 1 || value.supportedPlatforms[0] !== 'windows-x64') {
    throw new Error('Steam 1.0 may only claim Windows x64.');
  }
  const excluded = new Set(Array.isArray(value.excludedCapabilities) ? value.excludedCapabilities : []);
  for (const required of ['full-execute', 'terminal', 'arbitrary-http', 'external-payments']) {
    if (!excluded.has(required)) throw new Error(`Steam excluded capability missing: ${required}`);
  }
  const cloud = requireRecord(value.cloud, 'cloud');
  const approval = requireRecord(cloud.approval, 'cloud.approval');
  const entries = Array.isArray(cloud.entries) ? cloud.entries : [];
  if (approval.window !== '03') throw new Error('Steam Cloud approval must be owned by window 03.');
  if (approval.status !== 'not-approved' && approval.status !== 'approved') throw new Error('Invalid Steam Cloud approval status.');
  if (approval.status !== 'approved' && (cloud.enabled === true || entries.length > 0)) {
    throw new Error('Steam Cloud cannot be enabled or populated before window 03 approval.');
  }
  if (approval.status === 'approved' && (!approval.approvedAt || !approval.evidence)) {
    throw new Error('Approved Steam Cloud data requires dated window 03 evidence.');
  }
  const maxFileBytes = requirePositiveInteger(cloud.maxFileBytes, 'cloud.maxFileBytes');
  const maxTotalBytes = requirePositiveInteger(cloud.maxTotalBytes, 'cloud.maxTotalBytes');
  let total = 0;
  const ids = new Set<string>();
  const remoteNames = new Set<string>();
  for (const entry of entries) {
    const item = requireRecord(entry, 'cloud.entries[]');
    const id = requireSafeToken(item.id, 'cloud entry id');
    const remoteName = requireSafeRemoteName(item.remoteName);
    const relativePath = requireSafeRelativePath(item.relativePath);
    const maxBytes = requirePositiveInteger(item.maxBytes, `cloud entry ${id} maxBytes`);
    if (maxBytes > maxFileBytes) throw new Error(`Steam Cloud entry ${id} exceeds maxFileBytes.`);
    if (item.containsPersonalData !== false && item.containsPersonalData !== true) {
      throw new Error(`Steam Cloud entry ${id} must declare containsPersonalData.`);
    }
    if (ids.has(id) || remoteNames.has(remoteName)) throw new Error(`Duplicate Steam Cloud entry: ${id}`);
    ids.add(id);
    remoteNames.add(remoteName);
    total += maxBytes;
    void relativePath;
  }
  if (total > maxTotalBytes) throw new Error('Steam Cloud whitelist exceeds maxTotalBytes.');
}

export function assertSteamRuntimeConfig(value: unknown): asserts value is SteamRuntimeConfig {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.skuId !== 'athena-steam-personal-v1') {
    throw new Error('Invalid Steam runtime config.');
  }
  requireSteamId(value.appId, 'appId');
  requireSteamId(value.depotId, 'depotId');
  requireSafeToken(value.buildBranch, 'buildBranch');
  if (typeof value.cloudEnabled !== 'boolean' || typeof value.generatedAt !== 'string') {
    throw new Error('Steam runtime config is incomplete.');
  }
}

function capToolPermission(level: ToolPermissionLevel): ToolPermissionLevel {
  return level === 'full' ? 'files' : level;
}

function resolveProjectRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Steam config ${name} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

function requireSteamId(value: unknown, name: string): number {
  const id = requirePositiveInteger(value, name);
  if (id > 0xffffffff) throw new Error(`${name} is outside the Steam AppID range.`);
  return id;
}

function requireSafeToken(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) {
    throw new Error(`${name} contains unsupported characters.`);
  }
  return value;
}

function requireSafeRemoteName(value: unknown): string {
  if (typeof value !== 'string' || !/^athena-v1\/[a-z0-9._-]{1,80}\.json$/i.test(value)) {
    throw new Error('Steam Cloud remoteName must stay under athena-v1/ and end in .json.');
  }
  return value;
}

function requireSafeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('..') || !/^[a-z0-9._\\/-]{1,120}$/i.test(value)) {
    throw new Error('Steam Cloud relativePath must be a bounded relative path.');
  }
  return value.replace(/\\/g, '/');
}
