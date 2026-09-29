'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { CloudDatabase } = require('./database');
const { CloudError, assert } = require('./errors');
const {
  AuthService, SyncService, RateLimiter, ModelGateway, EntitlementService,
  SearchGateway, LocalFixtureSearchProvider,
} = require('./services');
const { createModelProvider } = require('./model-providers');
const { IdempotencyService, DataRightsService, BackupService, Metrics } = require('./lifecycle');
const { PairingService } = require('./pairing');
const { randomId } = require('./crypto');
const { LocalNoChargeBillingAdapter, LocalRecoveryDeliveryAdapter, createDeploymentAdapter } = require('./ports');

function createCloudApp(config, adapters = {}) {
  const runtime = resolveRuntimeAdapters(config, adapters);
  const store = new CloudDatabase(config);
  const sync = new SyncService(store, config);
  const services = {
    store,
    auth: new AuthService(store, config, runtime.recoveryDelivery),
    sync,
    rate: new RateLimiter(config),
    // Built from the config rather than defaulted, so naming a provider in the
    // config is what actually decides which one answers.
    model: new ModelGateway(store, config, sync, runtime.modelProvider),
    search: new SearchGateway(store, config, runtime.searchProvider),
    entitlements: new EntitlementService(store, config, runtime.billingAdapter),
    deployment: runtime.deploymentAdapter,
    idempotency: new IdempotencyService(store),
    dataRights: new DataRightsService(store, config, sync),
    backup: new BackupService(store, config),
    metrics: new Metrics(),
  };
  services.runtimeBindings = Object.freeze({
    cloudProvider: runtime.deploymentAdapter.id,
    billingAdapter: runtime.billingAdapter.id,
    recoveryDeliveryAdapter: runtime.recoveryDelivery.id,
    modelProvider: runtime.modelProvider.id,
    searchProvider: runtime.searchProvider.id,
  });
  services.pairing = new PairingService(store, services.auth, config);

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
    return {
      status: ready ? 200 : 503,
      body: {
        status: ready ? 'ready' : 'not-ready',
        database,
        modelProvider: services.model.provider.id,
        deployment,
        runtimeBindings: services.runtimeBindings,
      },
    };
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

  // Local-network pairing sits with register and login because a phone that has
  // never had an account cannot present a token yet. Offering a code needs the
  // host itself; claiming one needs only the local network. Both routes are
  // absent outside the local environment.
  if (method === 'POST' && path === '/v1/pair/offer') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['label']);
    // An offer from a signed-in desktop pairs the phone into that account; an
    // anonymous one uses the machine's local account.
    let principal = null;
    if (request.headers.authorization) principal = authenticate(request, services.auth);
    return { body: services.pairing.offer({ remoteAddress: ip, context: principal, label: body.label }) };
  }
  if (method === 'POST' && path === '/v1/pair/claim') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['code', 'deviceName', 'platform']);
    return {
      body: services.pairing.claim({
        remoteAddress: ip,
        code: body.code,
        deviceName: body.deviceName,
        platform: body.platform,
      }),
    };
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
  if (method === 'POST' && path === '/v1/auth/mfa/disable') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['code']);
    services.auth.disableMfa(context, body.code); return { body: { enabled: false } };
  }
  // Who this session belongs to. Clients otherwise only learn it at login and
  // cannot tell, after a restart, whether MFA is on or the device still exists.
  if (method === 'GET' && path === '/v1/account') return { body: services.auth.account(context) };
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
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['prompt', 'mode', 'history']);
    const result = await services.idempotency.execute(context.tenantId, `POST:${path}`, request.headers['idempotency-key'], body,
      () => services.model.infer(context, body));
    return { status: result.statusCode, body: result.body, headers: { 'idempotency-replayed': String(result.replayed) } };
  }
  if (method === 'POST' && path === '/v1/search/query') {
    const body = await readJson(request, config.maxBodyBytes); exactKeys(body, ['query', 'maxResults']);
    const result = await services.idempotency.execute(context.tenantId, `POST:${path}`, request.headers['idempotency-key'], body,
      () => services.search.query(context, body));
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

function resolveRuntimeAdapters(config, adapters) {
  const runtime = {
    modelProvider: adapters.modelProvider || createModelProvider(config),
    searchProvider: adapters.searchProvider || new LocalFixtureSearchProvider(),
    billingAdapter: adapters.billingAdapter || new LocalNoChargeBillingAdapter(),
    deploymentAdapter: adapters.deploymentAdapter || createDeploymentAdapter(config),
    recoveryDelivery: adapters.recoveryDelivery || new LocalRecoveryDeliveryAdapter(),
  };
  assertAdapterBinding('Model provider', config.modelProvider, runtime.modelProvider, ['infer']);
  assertAdapterBinding('Search provider', config.searchProvider, runtime.searchProvider, ['search']);
  assertAdapterBinding('Billing adapter', config.billingAdapter, runtime.billingAdapter, ['transition']);
  assertAdapterBinding('Cloud provider', config.cloudProvider, runtime.deploymentAdapter, ['activeRegion', 'markUnavailable']);
  assertAdapterBinding('Recovery delivery adapter', config.recoveryDeliveryAdapter, runtime.recoveryDelivery, ['deliver']);
  return runtime;
}

function assertAdapterBinding(label, configuredId, adapter, methods) {
  if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0) {
    throw new Error(`${label} must expose a non-empty id.`);
  }
  if (adapter.id !== configuredId) {
    throw new Error(`${label} mismatch: config names ${configuredId} and runtime was given ${adapter.id}.`);
  }
  for (const method of methods) {
    if (typeof adapter[method] !== 'function') throw new Error(`${label} ${adapter.id} must implement ${method}().`);
  }
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
  if (Buffer.isBuffer(body)) {
    response.setHeader('athena-body-bytes', body.length);
    return response.end(body);
  }
  if (!response.hasHeader('content-type')) response.setHeader('content-type', 'application/json; charset=utf-8');
  const payload = JSON.stringify(body);
  response.setHeader('athena-body-bytes', Buffer.byteLength(payload, 'utf8'));
  response.end(payload);
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
