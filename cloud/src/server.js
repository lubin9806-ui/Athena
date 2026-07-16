'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { CloudDatabase } = require('./database');
const { CloudError, assert } = require('./errors');
const {
  AuthService, SyncService, RateLimiter, ModelGateway, EntitlementService, LocalFixtureModelProvider,
} = require('./services');
const { IdempotencyService, DataRightsService, BackupService, Metrics } = require('./lifecycle');
const { randomId } = require('./crypto');
const { LocalNoChargeBillingAdapter, LocalDeploymentAdapter, LocalRecoveryDeliveryAdapter } = require('./ports');

function createCloudApp(config, adapters = {}) {
  const store = new CloudDatabase(config);
  const sync = new SyncService(store, config);
  const services = {
    store,
    auth: new AuthService(store, config, adapters.recoveryDelivery || new LocalRecoveryDeliveryAdapter()),
    sync,
    rate: new RateLimiter(config),
    model: new ModelGateway(store, config, sync, adapters.modelProvider || new LocalFixtureModelProvider()),
    entitlements: new EntitlementService(store, config, adapters.billingAdapter || new LocalNoChargeBillingAdapter()),
    deployment: adapters.deploymentAdapter || new LocalDeploymentAdapter(config.region, 'local-2'),
    idempotency: new IdempotencyService(store),
    dataRights: new DataRightsService(store, config, sync),
    backup: new BackupService(store, config),
    metrics: new Metrics(),
  };

  const server = http.createServer(async (request, response) => {
    const started = Date.now();
    let status = 500;
    const requestId = request.headers['x-request-id'] || randomId('req');
    applySecurityHeaders(response, requestId);
    try {
      const result = await route(request, services, config);
      status = result.status || 200;
      writeResponse(response, status, result.body, result.headers);
    } catch (error) {
      const problem = normalizeError(error, requestId);
      status = problem.status;
      writeResponse(response, status, problem, { 'content-type': 'application/problem+json' });
    } finally {
      services.metrics.observe(Date.now() - started, status);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    services,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, resolve);
      });
      return server.address();
    },
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
    },
  };
}

async function route(request, services, config) {
  const url = new URL(request.url, 'http://athena.local');
  const path = url.pathname;
  const method = request.method || 'GET';
  const ip = request.socket.remoteAddress || 'unknown';
  services.rate.consume(`ip:${ip}`, path.startsWith('/v1/auth/') ? config.authRateLimitPerMinute : config.rateLimitPerMinute);

  if (method === 'GET' && path === '/health/live') return { body: { status: 'live', version: '1.0' } };
  if (method === 'GET' && path === '/health/ready') {
    const database = services.store.db.prepare('SELECT 1 AS ok').get().ok === 1;
    const deployment = services.deployment.activeRegion();
    const ready = database && Boolean(deployment.region);
    return { status: ready ? 200 : 503, body: { status: ready ? 'ready' : 'not-ready', database, modelProvider: services.model.provider.id, deployment } };
  }
  if (method === 'GET' && path === '/internal/metrics' && config.environment === 'local') return { body: services.metrics.snapshot() };

  if (method === 'POST' && path === '/v1/auth/register') {
    const body = await readJson(request, config.maxBodyBytes);
    exactKeys(body, ['tenantName', 'email', 'password', 'deviceName', 'platform']);
    return { status: 201, body: services.auth.registerTenant(body) };
  }
  if (method === 'POST' && path === '/v1/auth/login') {
    const body = await readJson(request, config.maxBodyBytes);
    exactKeys(body, ['tenantId', 'email', 'password', 'mfaCode', 'recoveryCode', 'deviceName', 'platform']);
    return { body: services.auth.login(body) };
  }
  if (method === 'POST' && path === '/v1/auth/refresh') {
    const body = await readJson(request, config.maxBodyBytes);
    exactKeys(body, ['refreshToken']);
    return { body: services.auth.refresh(body.refreshToken) };
  }
  if (method === 'POST' && path === '/v1/auth/recovery/request') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['tenantId', 'email']);
    const result = services.auth.requestRecovery(body);
    if (config.environment !== 'local') delete result.localToken;
    return { status: 202, body: result };
  }
  if (method === 'POST' && path === '/v1/auth/recovery/complete') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['tenantId', 'token', 'newPassword']);
    return { body: services.auth.completeRecovery(body) };
  }

  const context = authenticate(request, services.auth);
  services.rate.consume(`tenant:${context.tenantId}`);

  if (method === 'POST' && path === '/v1/auth/logout') {
    services.auth.logout(context);
    return { status: 204, body: null };
  }
  if (method === 'POST' && path === '/v1/auth/mfa/setup') return { body: services.auth.beginMfa(context) };
  if (method === 'POST' && path === '/v1/auth/mfa/confirm') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['code']);
    services.auth.confirmMfa(context, body.code); return { body: { enabled: true } };
  }
  if (method === 'GET' && path === '/v1/devices') return { body: { devices: services.auth.listDevices(context) } };
  const deviceMatch = path.match(/^\/v1\/devices\/(dev_[a-f0-9]{32})$/);
  if (method === 'DELETE' && deviceMatch) {
    services.auth.revokeDevice(context, deviceMatch[1]); return { status: 204, body: null };
  }

  const recordMatch = path.match(/^\/v1\/sync\/records\/([A-Za-z0-9._:-]{1,128})$/);
  if (method === 'GET' && recordMatch) return { body: services.sync.get(context, recordMatch[1]) };
  if (method === 'PUT' && recordMatch) {
    const body = await readJson(request, config.maxBodyBytes);
    exactKeys(body, ['resourceId', 'resourceType', 'schemaVersion', 'baseVector', 'payload', 'deleted']);
    assert(body.resourceId === recordMatch[1], 400, 'resource-id-mismatch', 'Path and body resource IDs must match.');
    const result = await services.idempotency.execute(context.tenantId, `PUT:${path}`, request.headers['idempotency-key'], body,
      () => services.sync.put(context, body));
    return { status: result.statusCode, body: result.body, headers: { 'idempotency-replayed': String(result.replayed) } };
  }
  if (method === 'GET' && path === '/v1/sync/changes') {
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
    return { body: services.sync.list(context, url.searchParams.get('cursor'), limit) };
  }

  if (method === 'POST' && path === '/v1/model/responses') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['prompt', 'mode']);
    const result = await services.idempotency.execute(context.tenantId, `POST:${path}`, request.headers['idempotency-key'], body,
      () => services.model.infer(context, body));
    return { status: result.statusCode, body: result.body, headers: { 'idempotency-replayed': String(result.replayed) } };
  }
  const appealMatch = path.match(/^\/v1\/abuse\/([a-z0-9_]+)\/appeal$/i);
  if (method === 'POST' && appealMatch) {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['statement']);
    return { body: services.model.appeal(context, appealMatch[1], body.statement) };
  }

  if (method === 'GET' && path === '/v1/entitlements') return { body: services.entitlements.get(context) };
  if (method === 'POST' && path === '/v1/entitlements/local-transition') {
    assert(config.environment === 'local', 404, 'not-found', 'Route was not found.');
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['state']);
    return { body: services.entitlements.transition(context, body.state) };
  }

  if (method === 'POST' && path === '/v1/data/exports') return { status: 202, body: services.dataRights.createExport(context) };
  const exportMatch = path.match(/^\/v1\/data\/exports\/(job_[a-f0-9]{32})$/);
  if (method === 'GET' && exportMatch) {
    return { body: services.dataRights.downloadExport(context, exportMatch[1]), headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="athena-export-${exportMatch[1]}.json"` } };
  }
  if (method === 'DELETE' && path === '/v1/account') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['confirmation']);
    return { body: services.dataRights.deleteAccount(context, body.confirmation) };
  }

  if (method === 'GET' && path === '/v1/audit') {
    assert(['owner', 'admin'].includes(context.role), 403, 'admin-required', 'Administrative role required.');
    return { body: { valid: services.store.verifyAudit(context.tenantId), events: services.store.listAudit(context.tenantId, 200) } };
  }
  if (method === 'POST' && path === '/v1/admin/keys/rotate') {
    assert(context.role === 'owner', 403, 'owner-required', 'Owner role required.');
    const version = services.store.rotateTenantKey(context.tenantId);
    services.store.appendAudit(context.tenantId, context.userId, 'key.rotate', context.tenantId, 'success', { version });
    return { body: { activeKeyVersion: version } };
  }

  throw new CloudError(404, 'not-found', 'Route was not found.');
}

function authenticate(request, authService) {
  const authorization = request.headers.authorization;
  assert(typeof authorization === 'string' && authorization.startsWith('Bearer '), 401, 'authentication-required', 'Bearer authentication is required.');
  return authService.authenticate(authorization.slice(7));
}

function readJson(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') return reject(new CloudError(415, 'unsupported-media-type', 'Content-Type must be application/json.'));
    let bytes = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new CloudError(413, 'body-too-large', 'Request body exceeds the size limit.'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed);
      } catch { reject(new CloudError(400, 'invalid-json', 'Request body must be a JSON object.')); }
    });
    request.on('error', reject);
  });
}

function exactKeys(body, allowed) {
  const extras = Object.keys(body).filter((key) => !allowed.includes(key));
  assert(extras.length === 0, 400, 'unknown-properties', 'Request contains unsupported properties.', { properties: extras });
}

function applySecurityHeaders(response, requestId) {
  response.setHeader('x-request-id', requestId);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  response.setHeader('athena-api-version', '1');
}

function writeResponse(response, status, body, headers = {}) {
  for (const [key, value] of Object.entries(headers || {})) response.setHeader(key, value);
  response.statusCode = status;
  if (status === 204 || body === null || body === undefined) return response.end();
  if (Buffer.isBuffer(body)) return response.end(body);
  if (!response.hasHeader('content-type')) response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function normalizeError(error, requestId) {
  const safe = error instanceof CloudError ? error : new CloudError(500, 'internal-error', 'An internal error occurred.');
  return {
    type: `https://docs.athena.invalid/problems/${safe.code}`,
    title: safe.code,
    status: safe.status,
    detail: safe.message,
    instance: `urn:athena:request:${requestId}`,
    ...safe.extras,
  };
}

module.exports = { createCloudApp, normalizeError };
