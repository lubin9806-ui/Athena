/**
 * Mobile connection boundary. It has no Electron, SQLite, Node crypto or UI
 * dependency, so native Android/iOS shells do not inherit Desktop internals.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const SESSION_CODES = new Set(['session-expired', 'refresh-expired', 'invalid-refresh', 'invalid-session', 'authentication-required']);

export interface MobileCloudSession {
  version: 1;
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  deviceId: string;
}

/** Implement with Android Keystore or iOS Keychain in the native shell. */
export interface MobileSessionStore {
  read(): Promise<MobileCloudSession | null>;
  write(session: MobileCloudSession): Promise<void>;
  clear(): Promise<void>;
}

export interface MobileConnectionStatus {
  tenantId: string;
  userId: string;
  email: string;
  deviceId: string;
  devices: Array<{ id: string; name: string; platform: string; status: string }>;
}

export interface MobilePairingInput {
  baseUrl: string;
  code: string;
}

export class MobileCloudConnectionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MobileCloudConnectionError';
  }
}

/**
 * The Desktop hand-off contains only a public endpoint and a short-lived,
 * single-use code. It never contains an access token or refresh token.
 */
export function parseMobilePairingUri(value: string, allowLoopbackCleartext = false): MobilePairingInput {
  let uri: URL;
  try { uri = new URL(value); } catch { throw new MobileCloudConnectionError(0, 'pairing-uri-invalid', '手机配对链接无效。'); }
  if (uri.protocol !== 'athena:' || uri.hostname !== 'pair' || uri.pathname !== '') {
    throw new MobileCloudConnectionError(0, 'pairing-uri-invalid', '这不是 Athena 手机配对链接。');
  }
  if (uri.searchParams.get('version') !== '1') {
    throw new MobileCloudConnectionError(0, 'pairing-version-unsupported', '手机配对链接版本不受支持。');
  }
  const baseUrl = assertBaseUrl(uri.searchParams.get('server') || '', allowLoopbackCleartext);
  const code = uri.searchParams.get('code') || '';
  if (!/^\d{6}$/.test(code)) throw new MobileCloudConnectionError(0, 'invalid-code', '手机配对码格式无效。');
  return { baseUrl, code };
}

export class AthenaMobileConnectionClient {
  private session: MobileCloudSession | null = null;

  constructor(
    private readonly store: MobileSessionStore,
    private readonly deviceName: string,
    private readonly platform: 'android' | 'ios' = 'android',
    private readonly allowLoopbackCleartext = false,
  ) {}

  async restore(): Promise<MobileCloudSession | null> {
    const stored = await this.store.read();
    if (!stored) return null;
    this.session = normalizeSession(stored, this.allowLoopbackCleartext);
    return this.session;
  }

  async pairFromUri(uri: string): Promise<MobileConnectionStatus> {
    return this.pair(parseMobilePairingUri(uri, this.allowLoopbackCleartext));
  }

  async pair(input: MobilePairingInput): Promise<MobileConnectionStatus> {
    const baseUrl = assertBaseUrl(input.baseUrl, this.allowLoopbackCleartext);
    if (!/^\d{6}$/.test(input.code)) throw new MobileCloudConnectionError(0, 'invalid-code', '手机配对码格式无效。');
    const body = await this.request(baseUrl, 'POST', '/v1/pair/claim', {
      auth: false,
      json: { code: input.code, deviceName: this.deviceName, platform: this.platform },
    });
    this.session = sessionFromResponse(baseUrl, body, this.allowLoopbackCleartext);
    await this.store.write(this.session);
    return this.connectionStatus();
  }

  /** Serial reads deliberately avoid racing a one-time refresh-token rotation. */
  async connectionStatus(): Promise<MobileConnectionStatus> {
    const session = this.requireSession();
    const account = await this.request(session.baseUrl, 'GET', '/v1/account');
    const devicesBody = await this.request(session.baseUrl, 'GET', '/v1/devices');
    const devices = Array.isArray(devicesBody.devices)
      ? devicesBody.devices.filter(isRecord).map(device => ({
        id: stringField(device.id), name: stringField(device.name), platform: stringField(device.platform), status: stringField(device.status),
      })).filter(device => device.id)
      : [];
    return {
      tenantId: stringField(account.tenantId) || session.tenantId,
      userId: stringField(account.userId) || session.userId,
      email: stringField(account.email),
      deviceId: session.deviceId,
      devices,
    };
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    try { if (session) await this.request(session.baseUrl, 'POST', '/v1/auth/logout'); }
    finally {
      this.session = null;
      await this.store.clear();
    }
  }

  private requireSession(): MobileCloudSession {
    if (!this.session) throw new MobileCloudConnectionError(401, 'invalid-session', '手机尚未连接 Athena。');
    return this.session;
  }

  private async request(
    baseUrl: string,
    method: string,
    path: string,
    options: { auth?: boolean; json?: Record<string, unknown> } = {},
    retried = false,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': randomHex(12) };
    if (options.json) headers['content-type'] = 'application/json';
    if (options.auth !== false) headers.authorization = `Bearer ${this.requireSession().accessToken}`;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method, headers, body: options.json ? JSON.stringify(options.json) : undefined, signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new MobileCloudConnectionError(0, timedOut ? 'network-timeout' : 'network-unreachable', timedOut
        ? 'Athena Cloud 没有及时响应。'
        : '无法连接 Athena Cloud。请检查网络和服务器地址。');
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (response.status === 204) return {};
    const parsed = await responseJson(response);
    const code = stringField(parsed.title) || stringField(parsed.code) || 'http-error';
    if (response.status === 401 && !retried && this.session?.refreshToken && SESSION_CODES.has(code)) {
      await this.refresh();
      return this.request(baseUrl, method, path, options, true);
    }
    if (!response.ok) throw new MobileCloudConnectionError(response.status, code, problemMessage(response.status, code, parsed.detail), parsed);
    return parsed;
  }

  private async refresh(): Promise<void> {
    const session = this.requireSession();
    const body = await this.request(session.baseUrl, 'POST', '/v1/auth/refresh', {
      auth: false, json: { refreshToken: session.refreshToken },
    }, true);
    const next = sessionFromResponse(session.baseUrl, { ...body, device: { id: session.deviceId } }, this.allowLoopbackCleartext);
    this.session = next;
    await this.store.write(next);
  }
}

function assertBaseUrl(value: string, allowLoopbackCleartext: boolean): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new MobileCloudConnectionError(0, 'base-url-invalid', 'Athena Cloud 服务器地址无效。'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MobileCloudConnectionError(0, 'base-url-invalid', 'Athena Cloud 必须使用 HTTPS 地址。');
  }
  if (parsed.protocol === 'http:' && (!allowLoopbackCleartext || !isLoopbackHost(parsed.hostname))) {
    throw new MobileCloudConnectionError(0, 'cleartext-forbidden', '手机端只允许 HTTPS；本地模拟器地址仅能在开发构建中启用。');
  }
  return trimmed;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host === '10.0.2.2';
}

function sessionFromResponse(baseUrl: string, body: Record<string, unknown>, allowLoopbackCleartext: boolean): MobileCloudSession {
  const device = isRecord(body.device) ? body.device : {};
  const session: MobileCloudSession = {
    version: 1,
    baseUrl: assertBaseUrl(baseUrl, allowLoopbackCleartext),
    accessToken: stringField(body.accessToken), refreshToken: stringField(body.refreshToken),
    tenantId: stringField(body.tenantId), userId: stringField(body.userId), deviceId: stringField(device.id),
  };
  if (!session.accessToken || !session.refreshToken || !session.tenantId || !session.userId || !session.deviceId) {
    throw new MobileCloudConnectionError(0, 'invalid-session-response', 'Athena Cloud 返回了不完整的手机会话。');
  }
  return session;
}

function normalizeSession(session: MobileCloudSession, allowLoopbackCleartext: boolean): MobileCloudSession {
  return sessionFromResponse(session.baseUrl, {
    accessToken: session.accessToken, refreshToken: session.refreshToken, tenantId: session.tenantId,
    userId: session.userId, device: { id: session.deviceId },
  }, allowLoopbackCleartext);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try { const parsed = text ? JSON.parse(text) : {}; return isRecord(parsed) ? parsed : {}; }
  catch { return { detail: text }; }
}

function problemMessage(status: number, code: string, detail: unknown): string {
  if (code === 'invalid-code') return '配对码不对或已过期。';
  if (code === 'pairing-locked') return '配对码输错太多次，请稍后重试。';
  if (code === 'pairing-network-only') return '本地配对只能在同一局域网内完成。';
  if (code === 'not-found') return '该服务器不支持 Athena 手机配对。';
  if (status >= 500) return 'Athena Cloud 暂时不可用，请稍后重试。';
  return typeof detail === 'string' && detail.trim() ? detail.trim() : `Athena Cloud 拒绝了请求（${code}）。`;
}

function randomHex(bytes: number): string {
  if (!globalThis.crypto?.getRandomValues) throw new MobileCloudConnectionError(0, 'secure-randomness-unavailable', '手机运行环境没有安全随机数能力。');
  return [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

function stringField(value: unknown): string { return typeof value === 'string' ? value : ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
