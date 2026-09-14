'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  randomId, sha256, hmacSha256, constantEqual, encryptBytes, decryptBytes, hashPassword, verifyPassword, validatePassword,
  generateTotpSecret, verifyTotp, generateRecoveryCodes,
} = require('./crypto');

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const { CloudError, assert } = require('./errors');

class AuthService {
  constructor(store, config, recoveryDelivery) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    this.recoveryDelivery = recoveryDelivery;
  }

  registerTenant({ tenantName, email, password, deviceName = 'Initial device', platform = 'unknown' }) {
    validateEmail(email);
    assert(typeof tenantName === 'string' && tenantName.trim().length >= 2 && tenantName.length <= 100, 400, 'invalid-tenant', 'Tenant name is invalid.');
    // Checked before the tenant row exists. Left to hashPassword, a short
    // password surfaced as a plain Error, which the HTTP layer reports as a 500.
    assertPasswordPolicy(password);
    const tenantId = this.store.createTenant(tenantName.trim());
    const userId = randomId('usr');
    const key = this.store.getTenantKey(tenantId);
    const normalizedEmail = email.trim().toLowerCase();
    const now = this.store.now();
    try {
      this.db.prepare(`INSERT INTO users
        (id,tenant_id,email_hash,email_enc,email_key_version,password_hash,role,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        userId, tenantId, this.emailHash(tenantId, normalizedEmail),
        encryptBytes(Buffer.from(normalizedEmail), key.key, `user-email:${tenantId}:${userId}`), key.version,
        hashPassword(password), 'owner', 'active', now,
      );
      const session = this.createSession(tenantId, userId, { deviceName, platform });
      this.store.appendAudit(tenantId, userId, 'tenant.register', tenantId, 'success', { platform });
      return { tenantId, userId, ...session };
    } catch (error) {
      this.db.prepare('DELETE FROM tenants WHERE id=?').run(tenantId);
      throw error;
    }
  }

  login({ tenantId, email, password, mfaCode, recoveryCode, deviceName = 'Athena client', platform = 'unknown' }) {
    validateId(tenantId, 'ten');
    validateEmail(email);
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.db.prepare('SELECT * FROM users WHERE tenant_id=? AND email_hash=?').get(
      tenantId, this.emailHash(tenantId, normalizedEmail),
    );
    if (!user || user.status !== 'active') throw new CloudError(401, 'invalid-credentials', 'Credentials are invalid.');
    this.assertNotLocked(user);
    if (!verifyPassword(password, user.password_hash)) {
      this.recordFailedProof(user, 'auth.login', 'invalid-credentials');
      throw new CloudError(401, 'invalid-credentials', 'Credentials are invalid.');
    }
    if (user.mfa_enabled) {
      const mfaValid = mfaCode ? this.verifyUserTotp(user, mfaCode) : false;
      const recoveryValid = !mfaValid && recoveryCode ? this.consumeRecoveryCode(user, recoveryCode) : false;
      if (!mfaValid && !recoveryValid) {
        // A request without any code is a client finding out that MFA is on and
        // costs nothing. A wrong code is a guess: once the password is known the
        // six digits are the only barrier left, so guesses share the lockout.
        if (mfaCode || recoveryCode) this.recordFailedProof(user, 'auth.login', 'invalid-mfa');
        else this.store.appendAudit(tenantId, user.id, 'auth.login', user.id, 'failure', { reason: 'mfa-required' });
        throw new CloudError(401, 'mfa-required', 'A valid MFA or recovery code is required.');
      }
    }
    this.db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE tenant_id=? AND id=?').run(tenantId, user.id);
    const session = this.createSession(tenantId, user.id, { deviceName, platform });
    this.store.appendAudit(tenantId, user.id, 'auth.login', user.id, 'success', { deviceId: session.device.id, platform });
    return { tenantId, userId: user.id, ...session };
  }

  authenticate(accessToken) {
    assert(typeof accessToken === 'string' && accessToken.length >= 32, 401, 'invalid-session', 'Session is invalid.');
    const row = this.db.prepare(`SELECT s.*,u.role,u.status AS user_status,t.status AS tenant_status,d.status AS device_status
      FROM sessions s JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
      JOIN tenants t ON t.id=s.tenant_id JOIN devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id
      WHERE s.access_hash=?`).get(sha256(accessToken));
    assert(row && !row.revoked_at && Date.parse(row.access_expires_at) > Date.now(), 401, 'session-expired', 'Session has expired.');
    assert(row.user_status === 'active' && row.tenant_status === 'active' && row.device_status === 'active', 403, 'principal-disabled', 'Principal is disabled.');
    this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=? AND tenant_id=?').run(this.store.now(), row.id, row.tenant_id);
    this.db.prepare('UPDATE devices SET last_seen_at=? WHERE id=? AND tenant_id=?').run(this.store.now(), row.device_id, row.tenant_id);
    return Object.freeze({ tenantId: row.tenant_id, userId: row.user_id, deviceId: row.device_id, role: row.role, sessionId: row.id });
  }

  refresh(refreshToken) {
    assert(typeof refreshToken === 'string' && refreshToken.length >= 32, 401, 'invalid-refresh', 'Refresh token is invalid.');
    const row = this.db.prepare(`SELECT s.*,u.role,u.status AS user_status,t.status AS tenant_status,d.status AS device_status
      FROM sessions s JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
      JOIN tenants t ON t.id=s.tenant_id JOIN devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id
      WHERE s.refresh_hash=?`).get(sha256(refreshToken));
    assert(row && !row.revoked_at && Date.parse(row.refresh_expires_at) > Date.now(), 401, 'refresh-expired', 'Refresh token has expired.');
    assert(row.user_status === 'active' && row.tenant_status === 'active' && row.device_status === 'active', 403, 'principal-disabled', 'Principal is disabled.');
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const nextRefresh = crypto.randomBytes(48).toString('base64url');
    const now = this.store.now();
    const accessExpiresAt = new Date(Date.now() + this.config.accessTtlMs).toISOString();
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTtlMs).toISOString();
    this.db.prepare(`UPDATE sessions SET access_hash=?,refresh_hash=?,access_expires_at=?,refresh_expires_at=?,last_seen_at=?
      WHERE tenant_id=? AND id=?`).run(sha256(accessToken), sha256(nextRefresh), accessExpiresAt, refreshExpiresAt, now, row.tenant_id, row.id);
    this.store.appendAudit(row.tenant_id, row.user_id, 'auth.refresh', row.id, 'success');
    return { accessToken, refreshToken: nextRefresh, accessExpiresAt, refreshExpiresAt };
  }

  requestRecovery({ tenantId, email }) {
    validateId(tenantId, 'ten');
    validateEmail(email);
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.db.prepare("SELECT * FROM users WHERE tenant_id=? AND email_hash=? AND status='active'")
      .get(tenantId, this.emailHash(tenantId, normalizedEmail));
    const generic = { accepted: true, expiresInSeconds: 900 };
    if (!user) return generic;
    const token = crypto.randomBytes(32).toString('base64url');
    const id = randomId('rec');
    const now = this.store.now();
    this.db.prepare('INSERT INTO recovery_requests VALUES (?,?,?,?,?,?,NULL)').run(
      id, tenantId, user.id, sha256(token), now, new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    );
    this.store.appendAudit(tenantId, user.id, 'auth.recovery.request', id, 'accepted');
    return { ...generic, ...this.recoveryDelivery.deliver({ tenantId, userId: user.id, token }) };
  }

  completeRecovery({ tenantId, token, newPassword }) {
    validateId(tenantId, 'ten');
    assert(typeof token === 'string' && token.length >= 32, 400, 'invalid-recovery', 'Recovery token is invalid.');
    assertPasswordPolicy(newPassword);
    const row = this.db.prepare('SELECT * FROM recovery_requests WHERE tenant_id=? AND token_hash=?').get(tenantId, sha256(token));
    assert(row && !row.consumed_at && Date.parse(row.expires_at) > Date.now(), 400, 'invalid-recovery', 'Recovery token is invalid or expired.');
    const now = this.store.now();
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash=?,failed_logins=0,locked_until=NULL WHERE tenant_id=? AND id=?')
        .run(hashPassword(newPassword), tenantId, row.user_id);
      this.db.prepare('UPDATE recovery_requests SET consumed_at=? WHERE tenant_id=? AND id=?').run(now, tenantId, row.id);
      this.db.prepare('UPDATE sessions SET revoked_at=? WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL').run(now, tenantId, row.user_id);
    })();
    this.store.appendAudit(tenantId, row.user_id, 'auth.recovery.complete', row.id, 'success', { sessionsRevoked: true });
    return { complete: true, sessionsRevoked: true };
  }

  /**
   * Signing out ends the device as well as the session.
   *
   * Every login and every pairing claim creates its own device, so a device has
   * exactly one session. Revoking only the session left the device counted as
   * active, and after maxDevicesPerUser sign-ins the account could not sign in
   * anywhere until another device removed the leftovers.
   */
  logout(context) {
    const now = this.store.now();
    this.db.transaction(() => {
      this.db.prepare('UPDATE sessions SET revoked_at=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL').run(now, context.tenantId, context.sessionId);
      this.db.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE tenant_id=? AND id=? AND status='active'").run(now, context.tenantId, context.deviceId);
    })();
    this.store.appendAudit(context.tenantId, context.userId, 'auth.logout', context.sessionId, 'success', { deviceId: context.deviceId });
  }

  account(context) {
    const user = this.requireUser(context);
    const key = this.store.getTenantKey(context.tenantId, user.email_key_version).key;
    const device = this.db.prepare('SELECT id,name,platform FROM devices WHERE tenant_id=? AND id=?').get(context.tenantId, context.deviceId);
    return {
      tenantId: context.tenantId,
      userId: context.userId,
      email: decryptBytes(user.email_enc, key, `user-email:${context.tenantId}:${user.id}`).toString('utf8'),
      role: user.role,
      mfaEnabled: Boolean(user.mfa_enabled),
      device: device ? { id: device.id, name: device.name, platform: device.platform } : null,
    };
  }

  beginMfa(context) {
    // Enrolling replaces the secret and clears mfa_enabled until confirmed.
    // Allowed on an account that already has MFA, that let any bearer session
    // switch MFA off by starting an enrolment it never finished.
    const current = this.requireUser(context);
    assert(!current.mfa_enabled, 409, 'mfa-already-enabled', 'MFA is already enabled. Disable it with a current code before enrolling again.');
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    const key = this.store.getTenantKey(context.tenantId);
    this.db.prepare(`UPDATE users SET mfa_secret_enc=?,mfa_key_version=?,mfa_enabled=0,recovery_hashes_json=?
      WHERE tenant_id=? AND id=?`).run(
      encryptBytes(Buffer.from(secret), key.key, `user-mfa:${context.tenantId}:${context.userId}`), key.version,
      JSON.stringify(recoveryCodes.map((code) => sha256(code))), context.tenantId, context.userId,
    );
    this.store.appendAudit(context.tenantId, context.userId, 'auth.mfa.begin', context.userId, 'success');
    return { secret, recoveryCodes };
  }

  confirmMfa(context, code) {
    const user = this.requireUser(context);
    assert(user.mfa_secret_enc && this.verifyUserTotp(user, code), 400, 'invalid-mfa', 'MFA code is invalid.');
    this.db.prepare('UPDATE users SET mfa_enabled=1 WHERE tenant_id=? AND id=?').run(context.tenantId, context.userId);
    this.store.appendAudit(context.tenantId, context.userId, 'auth.mfa.enable', context.userId, 'success');
  }

  /** Turning MFA off takes a current code or a recovery code, never just a session. */
  disableMfa(context, code) {
    const user = this.requireUser(context);
    assert(user.mfa_enabled, 409, 'mfa-not-enabled', 'MFA is not enabled.');
    this.assertNotLocked(user);
    const supplied = typeof code === 'string' ? code.trim() : '';
    const valid = supplied !== '' && (this.verifyUserTotp(user, supplied) || this.consumeRecoveryCode(user, supplied));
    if (!valid) {
      this.recordFailedProof(user, 'auth.mfa.disable', 'invalid-mfa');
      throw new CloudError(400, 'invalid-mfa', 'MFA code is invalid.');
    }
    this.db.prepare(`UPDATE users SET mfa_enabled=0,mfa_secret_enc=NULL,mfa_key_version=NULL,recovery_hashes_json='[]',
      failed_logins=0,locked_until=NULL WHERE tenant_id=? AND id=?`).run(context.tenantId, context.userId);
    this.store.appendAudit(context.tenantId, context.userId, 'auth.mfa.disable', context.userId, 'success');
  }

  assertNotLocked(user) {
    if (user.locked_until && Date.parse(user.locked_until) > Date.now()) throw new CloudError(429, 'account-locked', 'Account is temporarily locked.');
  }

  recordFailedProof(user, action, reason) {
    const failures = user.failed_logins + 1;
    const lockedUntil = failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    this.db.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE tenant_id=? AND id=?').run(failures, lockedUntil, user.tenant_id, user.id);
    this.store.appendAudit(user.tenant_id, user.id, action, user.id, 'failure', { reason });
  }

  listDevices(context) {
    return this.db.prepare(`SELECT id,name,platform,status,created_at AS createdAt,last_seen_at AS lastSeenAt,revoked_at AS revokedAt
      FROM devices WHERE tenant_id=? AND user_id=? ORDER BY created_at`).all(context.tenantId, context.userId);
  }

  revokeDevice(context, deviceId) {
    const device = this.db.prepare('SELECT * FROM devices WHERE tenant_id=? AND user_id=? AND id=?').get(context.tenantId, context.userId, deviceId);
    assert(device, 404, 'device-not-found', 'Device was not found.');
    const now = this.store.now();
    this.db.transaction(() => {
      this.db.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE tenant_id=? AND id=?").run(now, context.tenantId, deviceId);
      this.db.prepare('UPDATE sessions SET revoked_at=? WHERE tenant_id=? AND device_id=? AND revoked_at IS NULL').run(now, context.tenantId, deviceId);
    })();
    this.store.appendAudit(context.tenantId, context.userId, 'device.revoke', deviceId, 'success');
  }

  createSession(tenantId, userId, { deviceName, platform }) {
    assert(typeof deviceName === 'string' && deviceName.length > 0 && deviceName.length <= 100, 400, 'invalid-device', 'Device name is invalid.');
    assert(/^[a-z0-9 ._-]{1,40}$/i.test(platform), 400, 'invalid-platform', 'Platform is invalid.');
    const activeCount = this.db.prepare("SELECT count(*) AS count FROM devices WHERE tenant_id=? AND user_id=? AND status='active'").get(tenantId, userId).count;
    assert(activeCount < this.config.maxDevicesPerUser, 409, 'device-limit', 'Device limit reached.');
    const now = this.store.now();
    const device = { id: randomId('dev'), name: deviceName, platform, status: 'active', createdAt: now, lastSeenAt: now };
    const sessionId = randomId('ses');
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const accessExpiresAt = new Date(Date.now() + this.config.accessTtlMs).toISOString();
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTtlMs).toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO devices VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(
        device.id, tenantId, userId, device.name, device.platform, null, 'active', now, now,
      );
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,NULL)').run(
        sessionId, tenantId, userId, device.id, sha256(accessToken), sha256(refreshToken), now,
        accessExpiresAt, refreshExpiresAt, now,
      );
    })();
    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, device };
  }

  requireUser(context) {
    const user = this.db.prepare('SELECT * FROM users WHERE tenant_id=? AND id=?').get(context.tenantId, context.userId);
    assert(user && user.status === 'active', 403, 'user-disabled', 'User is disabled.');
    return user;
  }

  verifyUserTotp(user, code) {
    const key = this.store.getTenantKey(user.tenant_id, user.mfa_key_version).key;
    const secret = decryptBytes(user.mfa_secret_enc, key, `user-mfa:${user.tenant_id}:${user.id}`).toString('utf8');
    return verifyTotp(secret, code);
  }

  consumeRecoveryCode(user, code) {
    const hashes = JSON.parse(user.recovery_hashes_json);
    const candidate = sha256(String(code));
    const index = hashes.findIndex((value) => constantEqual(value, candidate));
    if (index < 0) return false;
    hashes.splice(index, 1);
    this.db.prepare('UPDATE users SET recovery_hashes_json=? WHERE tenant_id=? AND id=?').run(JSON.stringify(hashes), user.tenant_id, user.id);
    return true;
  }

  emailHash(tenantId, email) {
    return hmacSha256(this.config.masterKey, `${tenantId}:${email}`);
  }
}

class SyncService {
  constructor(store, config) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    this.allowedTypes = new Set(['memory', 'conversation', 'preference', 'reminder']);
  }

  get(context, resourceId) {
    validateResourceId(resourceId);
    const row = this.db.prepare('SELECT * FROM sync_records WHERE tenant_id=? AND resource_id=?').get(context.tenantId, resourceId);
    assert(row && (row.owner_user_id === context.userId || context.role === 'admin' || context.role === 'owner'), 404, 'record-not-found', 'Record was not found.');
    return this.present(row);
  }

  list(context, cursor, limit = 100) {
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 500, 400, 'invalid-limit', 'Limit must be between 1 and 500.');
    const since = cursor ? decodeCursor(cursor) : { time: '1970-01-01T00:00:00.000Z', resourceId: '' };
    const rows = this.db.prepare(`SELECT * FROM sync_records WHERE tenant_id=? AND owner_user_id=?
      AND (modified_at>? OR (modified_at=? AND resource_id>?)) ORDER BY modified_at,resource_id LIMIT ?`)
      .all(context.tenantId, context.userId, since.time, since.time, since.resourceId, limit);
    const last = rows[rows.length - 1];
    const nextCursor = last ? encodeCursor({ time: last.modified_at, resourceId: last.resource_id }) : cursor || encodeCursor(since);
    return { records: rows.map((row) => this.present(row)), nextCursor };
  }

  put(context, input) {
    validateResourceId(input.resourceId);
    assert(this.allowedTypes.has(input.resourceType), 400, 'invalid-resource-type', 'Resource type is not allowed.');
    assert(input.schemaVersion === 1, 400, 'unsupported-sync-version', 'Only sync schema version 1 is supported.', { supported: [1] });
    assert(input.deleted === true || input.deleted === false, 400, 'invalid-delete-state', 'deleted must be boolean.');
    if (!input.deleted) {
      const size = Buffer.byteLength(JSON.stringify(input.payload), 'utf8');
      assert(size <= this.config.syncRecordMaxBytes, 413, 'record-too-large', 'Sync record exceeds the size limit.');
    }
    const current = this.db.prepare('SELECT * FROM sync_records WHERE tenant_id=? AND resource_id=?').get(context.tenantId, input.resourceId);
    if (current && current.owner_user_id !== context.userId && !['owner', 'admin'].includes(context.role)) throw new CloudError(404, 'record-not-found', 'Record was not found.');
    const baseVector = normalizeVector(input.baseVector || {});
    if (current) {
      const currentVector = JSON.parse(current.vector_json);
      const relation = compareVectors(baseVector, currentVector);
      if (relation !== 'equal') {
        return { outcome: 'conflict', reason: relation === 'remote' ? 'server-ahead' : 'divergent-base', server: this.present(current) };
      }
    } else if (Object.keys(baseVector).length) {
      return { outcome: 'conflict', reason: 'missing-server-base', server: null };
    }
    const vector = { ...(current ? JSON.parse(current.vector_json) : {}) };
    vector[context.deviceId] = (vector[context.deviceId] || 0) + 1;
    const now = this.store.now();
    const key = this.store.getTenantKey(context.tenantId);
    const payloadEnc = input.deleted ? null : encryptBytes(
      Buffer.from(JSON.stringify(input.payload), 'utf8'), key.key, `sync:${context.tenantId}:${input.resourceId}`,
    );
    const encryptedBytes = payloadEnc ? Buffer.byteLength(payloadEnc) : 0;
    const month = new Date().toISOString().slice(0, 7);
    const usedBytes = this.db.prepare('SELECT sync_bytes FROM usage_monthly WHERE tenant_id=? AND month=?').get(context.tenantId, month)?.sync_bytes || 0;
    const syncQuota = JSON.parse(this.store.getTenant(context.tenantId).quota_json).syncBytes;
    assert(usedBytes + encryptedBytes <= syncQuota, 429, 'quota-exhausted', 'Monthly sync byte quota is exhausted.');
    const etag = sha256(JSON.stringify({ resourceId: input.resourceId, vector, deleted: input.deleted, payloadEnc }));
    this.db.prepare(`INSERT INTO sync_records
      (tenant_id,resource_id,owner_user_id,resource_type,schema_version,vector_json,payload_enc,key_version,deleted,modified_at,modified_by_device,etag)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,resource_id) DO UPDATE SET
      resource_type=excluded.resource_type,schema_version=excluded.schema_version,vector_json=excluded.vector_json,
      payload_enc=excluded.payload_enc,key_version=excluded.key_version,deleted=excluded.deleted,modified_at=excluded.modified_at,
      modified_by_device=excluded.modified_by_device,etag=excluded.etag`).run(
      context.tenantId, input.resourceId, current?.owner_user_id || context.userId, input.resourceType, 1,
      JSON.stringify(vector), payloadEnc, input.deleted ? null : key.version, input.deleted ? 1 : 0, now, context.deviceId, etag,
    );
    this.incrementUsage(context.tenantId, { syncBytes: encryptedBytes, requests: 1 });
    this.store.appendAudit(context.tenantId, context.userId, input.deleted ? 'sync.delete' : 'sync.put', input.resourceId, 'success', {
      resourceType: input.resourceType, deleted: input.deleted, bytes: encryptedBytes,
    });
    return { outcome: 'accepted', record: this.get(context, input.resourceId) };
  }

  present(row) {
    let payload = null;
    if (!row.deleted && row.payload_enc) {
      const key = this.store.getTenantKey(row.tenant_id, row.key_version).key;
      payload = JSON.parse(decryptBytes(row.payload_enc, key, `sync:${row.tenant_id}:${row.resource_id}`).toString('utf8'));
    }
    return {
      resourceId: row.resource_id, resourceType: row.resource_type, schemaVersion: row.schema_version,
      vector: JSON.parse(row.vector_json), payload, deleted: Boolean(row.deleted), modifiedAt: row.modified_at,
      modifiedByDevice: row.modified_by_device, etag: row.etag,
    };
  }

  incrementUsage(tenantId, values) {
    const month = new Date().toISOString().slice(0, 7);
    this.db.prepare(`INSERT INTO usage_monthly(tenant_id,month,model_tokens,sync_bytes,requests) VALUES (?,?,?,?,?)
      ON CONFLICT(tenant_id,month) DO UPDATE SET model_tokens=model_tokens+excluded.model_tokens,
      sync_bytes=sync_bytes+excluded.sync_bytes,requests=requests+excluded.requests`).run(
      tenantId, month, values.modelTokens || 0, values.syncBytes || 0, values.requests || 0,
    );
  }
}

class RateLimiter {
  constructor(config) {
    this.config = config;
    this.buckets = new Map();
  }

  consume(key, limit = this.config.rateLimitPerMinute, now = Date.now()) {
    const minute = Math.floor(now / 60000);
    const bucketKey = `${key}:${minute}`;
    const count = (this.buckets.get(bucketKey) || 0) + 1;
    this.buckets.set(bucketKey, count);
    if (this.buckets.size > 10000) {
      for (const oldKey of this.buckets.keys()) if (!oldKey.endsWith(`:${minute}`)) this.buckets.delete(oldKey);
    }
    if (count > limit) throw new CloudError(429, 'rate-limit', 'Rate limit exceeded.', { retryAfterSeconds: 60 - Math.floor((now % 60000) / 1000) });
  }
}

class ModelGateway {
  constructor(store, config, syncService, provider) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    this.syncService = syncService;
    this.provider = provider || new LocalFixtureModelProvider();
    const policyPath = path.join(__dirname, '..', 'config', 'provider-policies.json');
    this.policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')).providers.find((item) => item.id === config.modelProvider);
    if (!this.policy) throw new Error(`Model provider policy is missing for ${config.modelProvider}.`);
    // The policy that was reviewed has to be the policy of the provider that
    // actually answers. This used to be unchecked, so a deployment could name
    // one vendor's reviewed terms in config and route every conversation
    // through another - including through the echo fixture, which would look
    // like a working service that had simply become unhelpful.
    if (this.provider.id !== config.modelProvider) {
      throw new Error(`Model provider mismatch: config names ${config.modelProvider} and the gateway was given ${this.provider.id}.`);
    }
    if (config.environment === 'production' && !this.policy.productionEligible) throw new Error('Configured model provider is not production eligible.');
  }

  async infer(context, input) {
    assert(typeof input.prompt === 'string' && input.prompt.length >= 1 && input.prompt.length <= 32000, 400, 'invalid-prompt', 'Prompt is invalid.');
    assert(['create', 'companion', 'reason'].includes(input.mode), 400, 'invalid-mode', 'Cloud model gateway excludes Execute mode.');
    const history = normalizeHistory(input.history);
    // History is supplied by the client, not reconstructed from trusted server state.
    // Apply the same outbound-content policy to every user-authored turn that will be
    // sent to the provider; otherwise a caller can move a blocked prompt into history
    // and use a harmless current prompt to bypass the gateway check.
    const safety = [input.prompt, ...history.filter((item) => item.role === 'user').map((item) => item.content)]
      .map((content) => classifyContent(content))
      .find((result) => result.blocked) || { blocked: false };
    if (safety.blocked) {
      const caseId = randomId('abuse');
      const now = this.store.now();
      this.db.prepare('INSERT INTO abuse_cases VALUES (?,?,?,?,?,?,?,?,?)').run(
        caseId, context.tenantId, context.userId, safety.category, 'blocked', null, null, now, now,
      );
      this.store.appendAudit(context.tenantId, context.userId, 'model.block', caseId, 'blocked', { category: safety.category });
      throw new CloudError(422, 'content-blocked', 'Request was blocked by the local safety baseline.', { caseId, appealAllowed: true });
    }
    const estimatedInput = estimateTokens(input.prompt) + history.reduce((sum, item) => sum + estimateTokens(item.content), 0);
    const month = new Date().toISOString().slice(0, 7);
    const current = this.db.prepare('SELECT model_tokens FROM usage_monthly WHERE tenant_id=? AND month=?').get(context.tenantId, month)?.model_tokens || 0;
    assert(current + estimatedInput <= this.config.monthlyModelTokenQuota, 429, 'quota-exhausted', 'Monthly model token quota is exhausted.');
    const started = Date.now();
    let result;
    try {
      result = await this.provider.infer({
        prompt: input.prompt, mode: input.mode, history, requestId: randomId('req'),
      });
    } catch {
      this.store.appendAudit(context.tenantId, context.userId, 'model.infer', this.provider.id, 'failure', { durationMs: Date.now() - started });
      throw new CloudError(503, 'model-unavailable', 'Model provider is unavailable. Retry later.');
    }
    const outputTokens = estimateTokens(result.text);
    this.syncService.incrementUsage(context.tenantId, { modelTokens: estimatedInput + outputTokens, requests: 1 });
    this.store.appendAudit(context.tenantId, context.userId, 'model.infer', this.provider.id, 'success', {
      mode: input.mode, inputTokens: estimatedInput, outputTokens, durationMs: Date.now() - started,
      promptRetention: this.config.promptRetention, voiceRetention: this.config.voiceRetention,
    });
    return { text: result.text, provider: this.provider.id, usage: { inputTokens: estimatedInput, outputTokens }, retained: { prompt: false, voice: false } };
  }

  appeal(context, caseId, statement) {
    assert(typeof statement === 'string' && statement.length >= 10 && statement.length <= 2000, 400, 'invalid-appeal', 'Appeal statement is invalid.');
    const row = this.db.prepare('SELECT * FROM abuse_cases WHERE tenant_id=? AND user_id=? AND id=?').get(context.tenantId, context.userId, caseId);
    assert(row, 404, 'case-not-found', 'Abuse case was not found.');
    const key = this.store.getTenantKey(context.tenantId);
    this.db.prepare("UPDATE abuse_cases SET state='appealed',appeal_enc=?,key_version=?,updated_at=? WHERE tenant_id=? AND id=?").run(
      encryptBytes(Buffer.from(statement), key.key, `appeal:${context.tenantId}:${caseId}`), key.version, this.store.now(), context.tenantId, caseId,
    );
    this.store.appendAudit(context.tenantId, context.userId, 'abuse.appeal', caseId, 'success');
    return { caseId, state: 'appealed', escalation: 'manual-review-required' };
  }
}

class LocalFixtureModelProvider {
  constructor() { this.id = 'local-fixture'; }
  async infer({ prompt, mode, history = [] }) {
    const prior = history.length ? ` history=${history.length}` : '';
    return { text: `[${mode}${prior}] ${prompt.slice(0, 200)}` };
  }
}

class SearchGateway {
  constructor(store, config, provider) {
    this.store = store;
    this.config = config;
    this.provider = provider || new LocalFixtureSearchProvider();
    const policyPath = path.join(__dirname, '..', 'config', 'provider-policies.json');
    const policies = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    this.policy = (policies.searchProviders || []).find((item) => item.id === config.searchProvider);
    if (!this.policy) throw new Error(`Search provider policy is missing for ${config.searchProvider}.`);
    if (this.provider.id !== config.searchProvider) {
      throw new Error(`Search provider mismatch: config names ${config.searchProvider} and the gateway was given ${this.provider.id}.`);
    }
    if (config.environment === 'production' && !this.policy.productionEligible) {
      throw new Error('Configured search provider is not production eligible.');
    }
  }

  async query(context, input) {
    assert(typeof input.query === 'string' && input.query.trim().length >= 2 && input.query.length <= 300, 400, 'invalid-query', 'Search query is invalid.');
    const maxResults = input.maxResults == null ? 5 : input.maxResults;
    assert(Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 8, 400, 'invalid-max-results', 'maxResults must be between 1 and 8.');
    const safety = classifyContent(input.query);
    if (safety.blocked) {
      throw new CloudError(422, 'content-blocked', 'Request was blocked by the local safety baseline.', { appealAllowed: true });
    }
    const started = Date.now();
    let result;
    try {
      result = await this.provider.search({ query: input.query.trim(), maxResults, requestId: randomId('req') });
    } catch {
      this.store.appendAudit(context.tenantId, context.userId, 'search.query', this.provider.id, 'failure', { durationMs: Date.now() - started });
      throw new CloudError(503, 'search-unavailable', 'Search provider is unavailable. Retry later.');
    }
    this.store.appendAudit(context.tenantId, context.userId, 'search.query', this.provider.id, 'success', {
      resultCount: Array.isArray(result.results) ? result.results.length : 0,
      durationMs: Date.now() - started,
      queryRetention: 'none',
    });
    return {
      query: input.query.trim(),
      provider: this.provider.id,
      untrustedExternalEvidence: true,
      results: result.results,
      retained: { query: false },
    };
  }
}

class LocalFixtureSearchProvider {
  constructor() { this.id = 'local-fixture'; }
  async search({ query, maxResults }) {
    const retrievedAt = new Date().toISOString();
    return {
      results: [
        {
          title: `Fixture source for ${query.slice(0, 80)}`,
          url: 'https://example.test/athena-search-fixture',
          snippet: 'Local unsigned search fixture. This is not a commercial search SLA and does not scrape third-party HTML.',
          retrievedAt,
        },
        {
          title: 'Athena Cloud search proxy',
          url: 'https://example.test/cloud-search-proxy',
          snippet: 'Mobile clients must call Cloud /v1/search/query. They must not scrape third-party HTML search pages.',
          retrievedAt,
        },
      ].slice(0, maxResults),
    };
  }
}

class UnavailableModelProvider {
  constructor() { this.id = 'local-fixture'; }
  async infer() { throw new Error('injected provider outage'); }
}

class EntitlementService {
  constructor(store, config, billingAdapter) {
    this.store = store;
    this.db = store.db;
    this.config = config;
    this.billingAdapter = billingAdapter;
    if (billingAdapter.id !== config.billingAdapter) {
      throw new Error(`Billing adapter mismatch: config names ${config.billingAdapter} and the service was given ${billingAdapter.id}.`);
    }
  }
  get(context) {
    const row = this.db.prepare('SELECT state,plan,source,updated_at AS updatedAt FROM entitlements WHERE tenant_id=?').get(context.tenantId);
    return { ...row, billingEnabled: this.billingAdapter.id !== 'local-no-charge', chargesCreated: this.billingAdapter.chargesCreated || 0 };
  }
  transition(context, nextState) {
    assert(['trial', 'active', 'past_due', 'suspended', 'cancelled', 'refunded'].includes(nextState), 400, 'invalid-entitlement-state', 'Entitlement state is invalid.');
    assert(['owner', 'admin'].includes(context.role), 403, 'admin-required', 'Administrative role required.');
    const current = this.db.prepare('SELECT state FROM entitlements WHERE tenant_id=?').get(context.tenantId)?.state;
    const allowed = {
      trial: ['active', 'cancelled'], active: ['past_due', 'cancelled', 'refunded'],
      past_due: ['active', 'suspended', 'cancelled'], suspended: ['active', 'cancelled'],
      cancelled: ['refunded'], refunded: [],
    };
    assert(allowed[current]?.includes(nextState), 409, 'invalid-entitlement-transition', `Cannot transition entitlement from ${current} to ${nextState}.`);
    const result = this.billingAdapter.transition({ tenantId: context.tenantId, nextState });
    this.db.prepare('UPDATE entitlements SET state=?,source=?,external_reference=?,updated_at=? WHERE tenant_id=?')
      .run(result.state, this.billingAdapter.id, result.externalReference, this.store.now(), context.tenantId);
    this.store.appendAudit(context.tenantId, context.userId, 'entitlement.transition', context.tenantId, 'success', { nextState, charged: result.charged });
    return this.get(context);
  }
}

function normalizeHistory(value) {
  if (value == null) return [];
  assert(Array.isArray(value) && value.length <= 20, 400, 'invalid-history', 'History must be at most 20 messages.');
  return value.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item), 400, 'invalid-history', 'History items must be objects.');
    assert(['user', 'assistant'].includes(item.role), 400, 'invalid-history', 'History roles must be user or assistant.');
    assert(typeof item.content === 'string' && item.content.length >= 1 && item.content.length <= 8000, 400, 'invalid-history', 'History content is invalid.');
    return { role: item.role, content: item.content };
  });
}

function classifyContent(prompt) {
  const rules = [
    { category: 'credential-theft', pattern: /steal\s+(password|credential|token)|phishing\s+kit/i },
    { category: 'malware', pattern: /deploy\s+ransomware|write\s+malware\s+to\s+evade/i },
    { category: 'sexual-minors', pattern: /sexual\s+content\s+with\s+(a\s+)?minor/i },
  ];
  const hit = rules.find((rule) => rule.pattern.test(prompt));
  return hit ? { blocked: true, category: hit.category } : { blocked: false };
}

function compareVectors(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let leftAhead = false;
  let rightAhead = false;
  for (const key of keys) {
    if ((left[key] || 0) > (right[key] || 0)) leftAhead = true;
    if ((right[key] || 0) > (left[key] || 0)) rightAhead = true;
  }
  if (leftAhead && rightAhead) return 'concurrent';
  if (leftAhead) return 'local';
  if (rightAhead) return 'remote';
  return 'equal';
}

function normalizeVector(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid-vector', 'Version vector is invalid.');
  const normalized = {};
  for (const [device, revision] of Object.entries(value)) {
    validateId(device, 'dev');
    assert(Number.isSafeInteger(revision) && revision > 0, 400, 'invalid-vector', 'Version vector revision is invalid.');
    normalized[device] = revision;
  }
  return normalized;
}

function encodeCursor(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function decodeCursor(value) {
  try {
    const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!decoded || Number.isNaN(Date.parse(decoded.time)) || typeof decoded.resourceId !== 'string') throw new Error();
    return decoded;
  } catch { throw new CloudError(400, 'invalid-cursor', 'Sync cursor is invalid.'); }
}
function estimateTokens(text) { return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4)); }
function assertPasswordPolicy(password) {
  try {
    validatePassword(password);
  } catch (error) {
    throw new CloudError(400, 'invalid-password', error.message);
  }
}
function validateEmail(value) { assert(typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254, 400, 'invalid-email', 'Email is invalid.'); }
function validateId(value, prefix) { assert(typeof value === 'string' && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value), 400, 'invalid-id', 'Identifier is invalid.'); }
function validateResourceId(value) { assert(typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value), 400, 'invalid-resource-id', 'Resource ID is invalid.'); }

module.exports = {
  AuthService, SyncService, RateLimiter, ModelGateway, LocalFixtureModelProvider, UnavailableModelProvider,
  SearchGateway, LocalFixtureSearchProvider, EntitlementService, compareVectors, classifyContent, estimateTokens,
};
