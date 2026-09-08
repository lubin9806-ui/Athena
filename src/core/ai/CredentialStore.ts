import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ImageCloudProvider, ImageCredentialStatus, RemoteModelProvider, SearchApiProvider } from '../../shared/types';

export interface ModelCredentialStatus {
  provider: RemoteModelProvider;
  configured: boolean;
  source: 'environment' | 'local-env-file' | 'windows-safe-storage' | 'none';
  encryptionAvailable: boolean;
  error: CredentialStatusError | null;
}

export type CredentialStatusError = 'credential.encryption_unavailable' | 'credential.decrypt_failed';

export class CredentialStoreError extends Error {
  constructor(public readonly code: CredentialStatusError, message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

interface CredentialFile {
  version: 1;
  entries: Partial<Record<CredentialProvider, string>>;
}

type CredentialProvider = RemoteModelProvider | ImageCloudProvider | SearchApiProvider;

const PROVIDERS = new Set<CredentialProvider>([
  'openai', 'deepseek', 'athena-cloud', 'custom', 'google', 'stability', 'bfl',
  'volcengine', 'dashscope', 'replicate', 'fal', 'zhipu',
]);
const ENVIRONMENT_KEYS: Record<CredentialProvider, string> = {
  zhipu: 'ZHIPU_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'athena-cloud': 'ATHENA_CLOUD_API_KEY',
  custom: 'ATHENA_CUSTOM_API_KEY',
  google: 'GEMINI_API_KEY',
  stability: 'STABILITY_API_KEY',
  bfl: 'BFL_API_KEY',
  volcengine: 'ARK_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  fal: 'FAL_KEY',
};

export function getModelCredentialStatus(provider: RemoteModelProvider): ModelCredentialStatus {
  return getCredentialStatus(provider) as ModelCredentialStatus;
}

export function setModelCredential(provider: RemoteModelProvider, apiKey: string): ModelCredentialStatus {
  assertProvider(provider);
  const value = apiKey.trim();
  if (!value || value.length > 10_000) throw new Error('API Key 为空或长度无效。');
  if (!encryptionReady()) throw new Error('Windows 安全凭据加密当前不可用，API Key 未保存。');

  const file = readCredentialFile();
  file.entries[provider] = safeStorage.encryptString(value).toString('base64');
  writeCredentialFile(file);
  return getModelCredentialStatus(provider);
}

export function clearModelCredential(provider: RemoteModelProvider): ModelCredentialStatus {
  assertProvider(provider);
  const file = readCredentialFile();
  delete file.entries[provider];
  writeCredentialFile(file);
  return getModelCredentialStatus(provider);
}

export function resolveModelCredential(provider: RemoteModelProvider): string | null {
  return resolveCredential(provider);
}

export function getImageCredentialStatus(provider: ImageCloudProvider): ImageCredentialStatus {
  return getCredentialStatus(provider) as ImageCredentialStatus;
}

export function setImageCredential(provider: ImageCloudProvider, apiKey: string): ImageCredentialStatus {
  setCredential(provider, apiKey);
  return getImageCredentialStatus(provider);
}

export function clearImageCredential(provider: ImageCloudProvider): ImageCredentialStatus {
  clearCredential(provider);
  return getImageCredentialStatus(provider);
}

export function resolveImageCredential(provider: ImageCloudProvider): string | null {
  return resolveCredential(provider);
}

export function getSearchCredentialStatus(provider: SearchApiProvider): ModelCredentialStatus {
  return getCredentialStatus(provider) as ModelCredentialStatus;
}

export function setSearchCredential(provider: SearchApiProvider, apiKey: string): ModelCredentialStatus {
  setCredential(provider, apiKey);
  return getSearchCredentialStatus(provider);
}

export function clearSearchCredential(provider: SearchApiProvider): ModelCredentialStatus {
  clearCredential(provider);
  return getSearchCredentialStatus(provider);
}

export function resolveSearchCredential(provider: SearchApiProvider): string | null {
  return resolveCredential(provider);
}

function getCredentialStatus(provider: CredentialProvider): ModelCredentialStatus | ImageCredentialStatus {
  assertProvider(provider);
  const environment = resolveProcessEnvironmentCredential(provider);
  if (environment) return { provider, configured: true, source: environment.source, encryptionAvailable: encryptionReady(), error: null } as ModelCredentialStatus | ImageCredentialStatus;
  const file = readCredentialFile();
  const encrypted = file.entries[provider];
  if (encrypted !== undefined) {
    try {
      decryptStoredCredential(provider, encrypted);
      return {
        provider,
        configured: true,
        source: 'windows-safe-storage',
        encryptionAvailable: encryptionReady(),
        error: null,
      } as ModelCredentialStatus | ImageCredentialStatus;
    } catch (error) {
      return {
        provider,
        configured: false,
        source: 'windows-safe-storage',
        encryptionAvailable: encryptionReady(),
        error: error instanceof CredentialStoreError ? error.code : 'credential.decrypt_failed',
      } as ModelCredentialStatus | ImageCredentialStatus;
    }
  }
  const localEnvironment = resolveLocalEnvironmentCredential(provider);
  return {
    provider,
    configured: Boolean(localEnvironment),
    source: localEnvironment?.source ?? 'none',
    encryptionAvailable: encryptionReady(),
    error: null,
  } as ModelCredentialStatus | ImageCredentialStatus;
}

function setCredential(provider: CredentialProvider, apiKey: string): void {
  assertProvider(provider);
  const value = apiKey.trim();
  if (!value || value.length > 10_000) throw new Error('API Key 为空或长度无效。');
  if (!encryptionReady()) throw new Error('Windows 安全凭据加密当前不可用，API Key 未保存。');
  const file = readCredentialFile();
  file.entries[provider] = safeStorage.encryptString(value).toString('base64');
  writeCredentialFile(file);
}

function clearCredential(provider: CredentialProvider): void {
  assertProvider(provider);
  const file = readCredentialFile();
  delete file.entries[provider];
  writeCredentialFile(file);
}

function resolveCredential(provider: CredentialProvider): string | null {
  assertProvider(provider);
  const environment = resolveProcessEnvironmentCredential(provider);
  if (environment) return environment.value;
  const encrypted = readCredentialFile().entries[provider];
  if (encrypted !== undefined) return decryptStoredCredential(provider, encrypted);
  return resolveLocalEnvironmentCredential(provider)?.value ?? null;
}

function decryptStoredCredential(provider: CredentialProvider, encrypted: string): string {
  if (!encryptionReady()) {
    throw new CredentialStoreError(
      'credential.encryption_unavailable',
      `${provider} 的 Windows 加密凭据当前不可读取，请恢复当前 Windows 用户配置或重新保存 API Key。`,
    );
  }
  try {
    const value = safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim();
    if (!value) throw new Error('decrypted credential is empty');
    return value;
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError(
      'credential.decrypt_failed',
      `${provider} 的已保存 API Key 无法解密，请清除后重新保存；Athena 未改用其他凭据来源。`,
    );
  }
}

function resolveProcessEnvironmentCredential(provider: CredentialProvider): { value: string; source: 'environment' } | null {
  const key = ENVIRONMENT_KEYS[provider];
  const direct = process.env[key]?.trim();
  if (direct) return { value: direct, source: 'environment' };
  return null;
}

function resolveLocalEnvironmentCredential(provider: CredentialProvider): { value: string; source: 'local-env-file' } | null {
  const key = ENVIRONMENT_KEYS[provider];
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const value = readEnvKey(fs.readFileSync(filePath, 'utf8'), key);
      if (value) return { value, source: 'local-env-file' };
    } catch {
      // A malformed or unreadable local env file is ignored without exposing content.
    }
  }
  return null;
}

function readEnvKey(source: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Horizontal whitespace only. `\s` also matches the line break, so a declared but
  // empty `KEY=` used to consume the newline and return the *next* line as the
  // credential: `DEEPSEEK_API_KEY=` followed by `DEEPSEEK_MODEL=deepseek-chat` was
  // resolved as the literal key "DEEPSEEK_MODEL=deepseek-chat", which the provider
  // then rejected as an invalid key rather than as a missing one.
  const blank = '[^\\S\\r\\n]';
  const match = source.match(new RegExp(`^${blank}*(?:export${blank}+)?${escaped}${blank}*=${blank}*(.*)$`, 'm'));
  if (!match) return null;
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }
  return value || null;
}

function credentialFilePath(): string | null {
  const explicitDirectory = process.env.ATHENA_CREDENTIALS_DIR?.trim();
  if (explicitDirectory) return path.join(path.resolve(explicitDirectory), 'model-credentials.enc.json');
  if (!app?.isReady?.()) return null;
  return path.join(app.getPath('userData'), 'credentials', 'model-credentials.enc.json');
}

function readCredentialFile(): CredentialFile {
  const filePath = credentialFilePath();
  if (!filePath || !fs.existsSync(filePath)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<CredentialFile>;
    return { version: 1, entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeCredentialFile(value: CredentialFile): void {
  const filePath = credentialFilePath();
  if (!filePath) throw new Error('Athena 用户数据目录尚未就绪，API Key 未保存。');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function encryptionReady(): boolean {
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function assertProvider(provider: CredentialProvider): void {
  if (!PROVIDERS.has(provider)) throw new Error('不支持的远程模型 Provider。');
}
