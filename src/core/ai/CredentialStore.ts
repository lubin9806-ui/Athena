import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { RemoteModelProvider } from '../../shared/types';

export interface ModelCredentialStatus {
  provider: RemoteModelProvider;
  configured: boolean;
  source: 'environment' | 'windows-safe-storage' | 'none';
  encryptionAvailable: boolean;
}

interface CredentialFile {
  version: 1;
  entries: Partial<Record<RemoteModelProvider, string>>;
}

const PROVIDERS = new Set<RemoteModelProvider>(['openai', 'deepseek', 'athena-cloud', 'custom']);
const ENVIRONMENT_KEYS: Record<RemoteModelProvider, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'athena-cloud': 'ATHENA_CLOUD_API_KEY',
  custom: 'ATHENA_CUSTOM_API_KEY',
};

export function getModelCredentialStatus(provider: RemoteModelProvider): ModelCredentialStatus {
  assertProvider(provider);
  const environmentValue = process.env[ENVIRONMENT_KEYS[provider]]?.trim();
  if (environmentValue) {
    return { provider, configured: true, source: 'environment', encryptionAvailable: encryptionReady() };
  }
  const file = readCredentialFile();
  return {
    provider,
    configured: Boolean(file.entries[provider]),
    source: file.entries[provider] ? 'windows-safe-storage' : 'none',
    encryptionAvailable: encryptionReady(),
  };
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
  assertProvider(provider);
  const environmentValue = process.env[ENVIRONMENT_KEYS[provider]]?.trim();
  if (environmentValue) return environmentValue;
  const encrypted = readCredentialFile().entries[provider];
  if (!encrypted || !encryptionReady()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
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

function assertProvider(provider: RemoteModelProvider): void {
  if (!PROVIDERS.has(provider)) throw new Error('不支持的远程模型 Provider。');
}
