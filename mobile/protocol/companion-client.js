'use strict';

const { randomBytes } = require('node:crypto');

class CompanionError extends Error {
  constructor(status, code, detail, extras = {}) {
    super(detail || code || 'Companion request failed.');
    this.name = 'CompanionError';
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

class AthenaCompanionClient {
  constructor({ baseUrl, fetchImpl, platform = 'android' }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.platform = platform;
    this.accessToken = null;
    this.refreshToken = null;
    this.tenantId = null;
    this.userId = null;
    this.device = null;
    this.networkConsent = {
      remoteModel: false,
      webSearch: false,
    };
  }

  requireBaseUrl() {
    if (!this.baseUrl) throw new CompanionError(0, 'base-url-missing', 'Companion production flavor refuses an empty Cloud base URL.');
    if (this.baseUrl.startsWith('http://') && !isLoopback(this.baseUrl)) {
      throw new CompanionError(0, 'cleartext-forbidden', 'Cleartext Cloud URLs are only allowed for loopback fixtures.');
    }
  }

  async health() {
    const live = await this.request('GET', '/health/live', { auth: false });
    const ready = await this.request('GET', '/health/ready', { auth: false });
    return { live, ready };
  }

  async register({ tenantName, email, password, deviceName }) {
    const body = await this.request('POST', '/v1/auth/register', {
      auth: false,
      json: { tenantName, email, password, deviceName, platform: this.platform },
    });
    this.applySession(body);
    return body;
  }

  async login({ tenantId, email, password, mfaCode = null, recoveryCode = null, deviceName }) {
    const body = await this.request('POST', '/v1/auth/login', {
      auth: false,
      json: { tenantId, email, password, mfaCode, recoveryCode, deviceName, platform: this.platform },
    });
    this.applySession(body);
    return body;
  }

  async refreshSession() {
    const body = await this.request('POST', '/v1/auth/refresh', {
      auth: false,
      json: { refreshToken: this.refreshToken },
    });
    this.accessToken = body.accessToken;
    this.refreshToken = body.refreshToken;
    return body;
  }

  async logout() {
    await this.request('POST', '/v1/auth/logout', { json: null });
    this.accessToken = null;
    this.refreshToken = null;
  }

  async infer({ prompt, mode, history }) {
    if (!this.networkConsent.remoteModel) {
      throw new CompanionError(403, 'consent-required', 'Remote model consent is required before Cloud inference.');
    }
    if (mode === 'execute') {
      throw new CompanionError(400, 'invalid-mode', 'Android Companion excludes Execute mode.');
    }
    const json = history ? { prompt, mode, history } : { prompt, mode };
    return this.request('POST', '/v1/model/responses', { json, idempotent: true });
  }

  async search({ query, maxResults = 5 }) {
    if (!this.networkConsent.webSearch) {
      throw new CompanionError(403, 'consent-required', 'Web search consent is required before Cloud search.');
    }
    return this.request('POST', '/v1/search/query', { json: { query, maxResults }, idempotent: true });
  }

  async putRecord(record) {
    return this.request('PUT', `/v1/sync/records/${encodeURIComponent(record.resourceId)}`, {
      json: record,
      idempotent: true,
    });
  }

  async getRecord(resourceId) {
    return this.request('GET', `/v1/sync/records/${encodeURIComponent(resourceId)}`);
  }

  async listChanges({ cursor = null, limit = 100 } = {}) {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    query.set('limit', String(limit));
    return this.request('GET', `/v1/sync/changes?${query.toString()}`);
  }

  async entitlements() {
    return this.request('GET', '/v1/entitlements');
  }

  async listDevices() {
    return this.request('GET', '/v1/devices');
  }

  async exportData() {
    return this.request('POST', '/v1/data/exports');
  }

  async deleteAccount() {
    return this.request('DELETE', '/v1/account', { json: { confirmation: `DELETE ${this.tenantId}` } });
  }

  applySession(body) {
    this.accessToken = body.accessToken;
    this.refreshToken = body.refreshToken;
    this.tenantId = body.tenantId;
    this.userId = body.userId;
    this.device = body.device;
  }

  async request(method, path, { auth = true, json, idempotent = false } = {}) {
    this.requireBaseUrl();
    const headers = {
      accept: 'application/json',
      'x-request-id': randomBytes(12).toString('hex'),
    };
    if (json !== undefined && json !== null) headers['content-type'] = 'application/json';
    if (auth) {
      if (!this.accessToken) throw new CompanionError(401, 'invalid-session', 'Session is missing.');
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    if (idempotent) headers['idempotency-key'] = randomBytes(16).toString('hex');

    const execute = async () => {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: json === undefined || json === null ? undefined : JSON.stringify(json),
      });
      if (response.status === 204) return null;
      const text = await response.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text }; }
      if (response.status === 409 && parsed?.outcome === 'conflict') return parsed;
      if (!response.ok) {
        throw new CompanionError(response.status, parsed?.title || parsed?.code || 'http-error', parsed?.detail || text, parsed || {});
      }
      return parsed;
    };

    try {
      return await execute();
    } catch (error) {
      if (auth && error instanceof CompanionError && error.code === 'session-expired' && this.refreshToken) {
        await this.refreshSession();
        headers.authorization = `Bearer ${this.accessToken}`;
        return execute();
      }
      throw error;
    }
  }
}

function isLoopback(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '10.0.2.2';
  } catch {
    return false;
  }
}

module.exports = { AthenaCompanionClient, CompanionError };
