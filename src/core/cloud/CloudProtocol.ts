import { randomBytes } from 'crypto';

export class CloudProtocolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CloudProtocolError';
  }
}

export interface CloudProtocolSession {
  accessToken: string | null;
  refreshToken: string | null;
  tenantId: string | null;
  userId: string | null;
  deviceId: string | null;
}

/** Long enough for a slow local disk, short enough that one stuck request cannot hold every later sync. */
const REQUEST_TIMEOUT_MS = 20_000;
const SESSION_CODES = new Set(['session-expired', 'refresh-expired', 'invalid-refresh', 'invalid-session', 'authentication-required']);

export class CloudProtocol {
  private refreshInFlight: Promise<void> | null = null;
  session: CloudProtocolSession = {
    accessToken: null,
    refreshToken: null,
    tenantId: null,
    userId: null,
    deviceId: null,
  };

  /**
   * Called as soon as a refresh rotates the tokens. The old refresh token stops
   * working at that moment, so tokens kept only in memory until the end of a
   * sync would sign the computer out if anything failed in between.
   */
  onTokensRotated: ((session: CloudProtocolSession) => void) | null = null;

  constructor(public baseUrl: string, private readonly platform = 'desktop') {}

  static assertBaseUrl(baseUrl: string, allowLoopbackCleartext = true): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) throw new CloudProtocolError(0, 'base-url-missing', 'Athena Cloud 基址为空，生产模式 fail-closed。');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new CloudProtocolError(0, 'base-url-invalid', 'Athena Cloud 基址无效。');
    }
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '10.0.2.2';
    if (parsed.protocol === 'http:' && (!allowLoopbackCleartext || !loopback)) {
      throw new CloudProtocolError(0, 'cleartext-forbidden', '非回环地址必须使用 HTTPS。');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CloudProtocolError(0, 'base-url-invalid', 'Athena Cloud 基址协议无效。');
    }
    return trimmed;
  }

  async register(input: { tenantName: string; email: string; password: string; deviceName: string }): Promise<Record<string, unknown>> {
    const body = await this.request('POST', '/v1/auth/register', {
      auth: false,
      json: { ...input, platform: this.platform },
    });
    this.applySession(body);
    return body;
  }

  async login(input: {
    tenantId?: string | null;
    email: string;
    password: string;
    deviceName: string;
    mfaCode?: string | null;
    recoveryCode?: string | null;
  }): Promise<Record<string, unknown>> {
    const body = await this.request('POST', '/v1/auth/login', {
      auth: false,
      json: {
        tenantId: input.tenantId?.trim() || null,
        email: input.email,
        password: input.password,
        mfaCode: input.mfaCode ?? null,
        recoveryCode: input.recoveryCode ?? null,
        deviceName: input.deviceName,
        platform: this.platform,
      },
    });
    this.applySession(body);
    return body;
  }

  async logout(): Promise<void> {
    if (this.session.accessToken) await this.request('POST', '/v1/auth/logout');
    this.session = { accessToken: null, refreshToken: null, tenantId: null, userId: null, deviceId: null };
  }

  /** Who the stored session belongs to, as the server sees it now. */
  async account(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/account');
  }

  async deleteAccount(): Promise<Record<string, unknown>> {
    const tenantId = this.session.tenantId;
    if (!tenantId) throw new CloudProtocolError(401, 'invalid-session', '账号会话缺少租户信息。');
    return this.request('DELETE', '/v1/account', { json: { confirmation: `DELETE ${tenantId}` } });
  }

  async listDevices(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/devices');
  }

  async offerPairing(label = 'Athena Desktop', authenticated = true): Promise<Record<string, unknown>> {
    return this.request('POST', '/v1/pair/offer', { auth: authenticated, json: { label } });
  }

  async putRecord(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resourceId = String(record.resourceId || '');
    return this.request('PUT', `/v1/sync/records/${encodeURIComponent(resourceId)}`, { json: record, idempotent: true });
  }

  async listChanges(cursor?: string | null, limit = 100): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.request('GET', `/v1/sync/changes?${query.toString()}`);
  }

  private applySession(body: Record<string, unknown>): void {
    this.session.accessToken = String(body.accessToken || '');
    this.session.refreshToken = String(body.refreshToken || '');
    this.session.tenantId = String(body.tenantId || '');
    this.session.userId = String(body.userId || '');
    const device = isRecord(body.device) ? body.device : {};
    this.session.deviceId = typeof device.id === 'string' ? device.id : null;
  }

  private async request(
    method: string,
    path: string,
    options: { auth?: boolean; json?: Record<string, unknown> | null; idempotent?: boolean } = {},
    retried = false,
  ): Promise<Record<string, unknown>> {
    const baseUrl = CloudProtocol.assertBaseUrl(this.baseUrl);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-request-id': randomBytes(12).toString('hex'),
    };
    const attemptedAccessToken = this.session.accessToken;
    if (options.json) headers['content-type'] = 'application/json';
    if (options.auth !== false) {
      if (!this.session.accessToken) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
      headers.authorization = `Bearer ${this.session.accessToken}`;
    }
    if (options.idempotent) headers['idempotency-key'] = randomBytes(16).toString('hex');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: options.json ? JSON.stringify(options.json) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw networkError(error, baseUrl);
    }
    if (response.status === 204) return {};
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { detail: text }; }
    if (response.status === 409 && parsed.outcome === 'conflict') return parsed;
    const code = String(parsed.title || parsed.code || 'http-error');
    if (response.status === 401 && code === 'session-expired' && !retried && this.session.refreshToken) {
      // Another request may already have rotated the shared client's tokens
      // while this older 401 was in transit. Never consume the new refresh
      // token for a request sent with the old access token.
      if (attemptedAccessToken === this.session.accessToken) await this.refresh();
      return this.request(method, path, options, true);
    }
    if (!response.ok) {
      throw new CloudProtocolError(response.status, code, describeCloudProblem(response.status, code, parsed.detail), parsed);
    }
    return parsed;
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = this.refreshTokens();
    this.refreshInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.refreshInFlight === operation) this.refreshInFlight = null;
    }
  }

  private async refreshTokens(): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await this.request('POST', '/v1/auth/refresh', {
        auth: false,
        json: { refreshToken: this.session.refreshToken },
      });
    } catch (error) {
      if (error instanceof CloudProtocolError && (error.status === 401 || error.status === 403)) {
        throw new CloudProtocolError(401, 'session-invalid', describeCloudProblem(401, 'session-expired'), error.payload);
      }
      throw error;
    }
    this.session.accessToken = String(body.accessToken || '');
    this.session.refreshToken = String(body.refreshToken || '');
    this.onTokensRotated?.({ ...this.session });
  }
}

/** Whether an error means the stored session can no longer be used and the person has to sign in again. */
export function isSessionEnded(error: unknown): boolean {
  if (!(error instanceof CloudProtocolError)) return false;
  if (error.code === 'session-invalid' || error.code === 'principal-disabled') return true;
  return error.status === 401 && SESSION_CODES.has(error.code);
}

const PROBLEM_MESSAGES: Record<string, string> = {
  'invalid-credentials': '邮箱、密码或账号 ID 不对。',
  'mfa-required': '这个账号开了两步验证，请填写验证器里的 6 位数字，或者一个恢复码。',
  'invalid-mfa': '两步验证码不对或已过期。',
  'mfa-already-enabled': '两步验证已经开着了。',
  'mfa-not-enabled': '两步验证没有开启。',
  'account-locked': '尝试次数太多，账号暂时锁定 15 分钟。',
  'rate-limit': '请求太频繁，请过一分钟再试。',
  'device-limit': '这个账号登录的设备已经到 8 台上限。请在已登录的设备上移除不用的设备，再回来登录。',
  'invalid-password': '密码需要 12 到 128 个字符。',
  'invalid-email': '邮箱格式不对。',
  'invalid-id': '账号 ID 格式不对，应该是 ten_ 开头的一串字符。',
  'invalid-tenant': '账号名称需要 2 到 100 个字符。',
  'session-expired': '登录已过期，请重新登录。',
  'refresh-expired': '登录已过期，请重新登录。',
  'invalid-refresh': '登录已过期，请重新登录。',
  'invalid-session': '登录已过期，请重新登录。',
  'authentication-required': '尚未登录 Athena 账号。',
  'principal-disabled': '这台电脑已经从账号里移除，或者账号已停用。请重新登录。',
  'quota-exhausted': '这个账号本月的同步额度已经用完，下个月会恢复。',
  'record-too-large': '有一条内容太长，超出了单条同步的上限。',
  'unsupported-sync-version': '这台电脑的同步格式和 Cloud 不一致，请更新 Athena。',
  'pairing-locked': '配对码输错太多次，请等一分钟。',
  'invalid-code': '配对码不对或已过期。',
};

export function describeCloudProblem(status: number, code: string, detail?: unknown): string {
  const known = PROBLEM_MESSAGES[code];
  if (known) return known;
  if (status === 404 && code === 'not-found') return '这个地址能连上，但它不是 Athena Cloud，或者版本太旧。请检查 Cloud 基址。';
  if (status >= 500) return 'Athena Cloud 内部出错了，请稍后再试。';
  const text = typeof detail === 'string' && detail.trim() ? detail.trim() : code;
  return `Athena Cloud 拒绝了这次请求（${text}）。`;
}

function networkError(error: unknown, baseUrl: string): CloudProtocolError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new CloudProtocolError(0, 'network-timeout', `Athena Cloud（${baseUrl}）${REQUEST_TIMEOUT_MS / 1000} 秒内没有响应。`);
  }
  return new CloudProtocolError(0, 'network-unreachable', `连不上 Athena Cloud（${baseUrl}）。请确认 Cloud 服务已经启动、地址填写正确。`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
