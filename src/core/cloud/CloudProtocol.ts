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

export class CloudProtocol {
  session: CloudProtocolSession = {
    accessToken: null,
    refreshToken: null,
    tenantId: null,
    userId: null,
    deviceId: null,
  };

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
    tenantId: string;
    email: string;
    password: string;
    deviceName: string;
    mfaCode?: string | null;
    recoveryCode?: string | null;
  }): Promise<Record<string, unknown>> {
    const body = await this.request('POST', '/v1/auth/login', {
      auth: false,
      json: {
        tenantId: input.tenantId,
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

  async putRecord(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resourceId = String(record.resourceId || '');
    return this.request('PUT', `/v1/sync/records/${encodeURIComponent(resourceId)}`, { json: record, idempotent: true });
  }

  async listChanges(cursor?: string | null): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ limit: '100' });
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
    if (options.json) headers['content-type'] = 'application/json';
    if (options.auth !== false) {
      if (!this.session.accessToken) throw new CloudProtocolError(401, 'invalid-session', '尚未登录 Athena 账号。');
      headers.authorization = `Bearer ${this.session.accessToken}`;
    }
    if (options.idempotent) headers['idempotency-key'] = randomBytes(16).toString('hex');
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.json ? JSON.stringify(options.json) : undefined,
    });
    if (response.status === 204) return {};
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { detail: text }; }
    if (response.status === 409 && parsed.outcome === 'conflict') return parsed;
    if (response.status === 401 && parsed.title === 'session-expired' && !retried && this.session.refreshToken) {
      await this.refresh();
      return this.request(method, path, options, true);
    }
    if (!response.ok) {
      throw new CloudProtocolError(
        response.status,
        String(parsed.title || parsed.code || 'http-error'),
        String(parsed.detail || text || 'Athena Cloud 请求失败。'),
        parsed,
      );
    }
    return parsed;
  }

  private async refresh(): Promise<void> {
    const body = await this.request('POST', '/v1/auth/refresh', {
      auth: false,
      json: { refreshToken: this.session.refreshToken },
    });
    this.session.accessToken = String(body.accessToken || '');
    this.session.refreshToken = String(body.refreshToken || '');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
