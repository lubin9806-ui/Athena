import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { CloudProtocol } from './CloudProtocol';

interface AccountServiceRuntimeConfig {
  schemaVersion: 1;
  enabled: boolean;
  baseUrl: string;
}

const DISABLED_CONFIG: AccountServiceRuntimeConfig = {
  schemaVersion: 1,
  enabled: false,
  baseUrl: '',
};

/**
 * The official account endpoint is release metadata, not user state. Packaged
 * builds read the file emitted by build-desktop.js; source runs may opt into an
 * HTTPS official endpoint through the same build environment variable.
 */
export function officialAccountServiceConfig(): AccountServiceRuntimeConfig {
  if (!app.isPackaged) {
    const baseUrl = normalizeOfficialBaseUrl(process.env.ATHENA_ACCOUNT_BASE_URL || '');
    return baseUrl ? { schemaVersion: 1, enabled: true, baseUrl } : DISABLED_CONFIG;
  }
  try {
    const filePath = path.join(process.resourcesPath, 'account-config.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AccountServiceRuntimeConfig>;
    if (parsed.schemaVersion !== 1 || parsed.enabled !== true) return DISABLED_CONFIG;
    const baseUrl = normalizeOfficialBaseUrl(parsed.baseUrl || '');
    return baseUrl ? { schemaVersion: 1, enabled: true, baseUrl } : DISABLED_CONFIG;
  } catch {
    return DISABLED_CONFIG;
  }
}

/** Custom endpoints are deliberately ignored outside developer mode. */
export function resolveAccountServiceBaseUrl(developerMode: boolean, developerOverride: string): string {
  if (developerMode && developerOverride.trim()) {
    return CloudProtocol.assertBaseUrl(developerOverride);
  }
  return officialAccountServiceConfig().baseUrl;
}

function normalizeOfficialBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed.length > 2048 || /[\\\r\n\t]/.test(trimmed) || /%(?:2e|2f|5c)/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!parsed.hostname || (parsed.port && parsed.port !== '443')) return null;
    if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(parsed.pathname)) return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
