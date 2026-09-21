'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const LOCAL_MASTER_KEY = crypto.createHash('sha256').update('athena-cloud-local-test-key-not-for-production').digest();

function loadConfig(overrides = {}) {
  const environment = overrides.environment || process.env.ATHENA_CLOUD_ENV || 'local';
  const masterKey = overrides.masterKey || decodeMasterKey(process.env.ATHENA_CLOUD_MASTER_KEY_BASE64) || LOCAL_MASTER_KEY;
  const config = {
    environment,
    host: overrides.host || process.env.ATHENA_CLOUD_HOST || '127.0.0.1',
    port: Number(overrides.port ?? process.env.ATHENA_CLOUD_PORT ?? 8787),
    dbPath: path.resolve(overrides.dbPath || process.env.ATHENA_CLOUD_DB || path.join(__dirname, '..', 'data', 'athena-cloud.db')),
    backupDir: path.resolve(overrides.backupDir || path.join(__dirname, '..', 'backups')),
    exportDir: path.resolve(overrides.exportDir || path.join(__dirname, '..', 'exports')),
    masterKey,
    tlsTerminated: overrides.tlsTerminated ?? process.env.ATHENA_CLOUD_TLS_TERMINATED === 'true',
    region: overrides.region || process.env.ATHENA_CLOUD_REGION || 'local-1',
    cloudProvider: overrides.cloudProvider || process.env.ATHENA_CLOUD_PROVIDER || 'local',
    billingAdapter: overrides.billingAdapter || process.env.ATHENA_CLOUD_BILLING_ADAPTER || 'local-no-charge',
    recoveryDeliveryAdapter: overrides.recoveryDeliveryAdapter || process.env.ATHENA_CLOUD_RECOVERY_DELIVERY_ADAPTER || 'local-return-token',
    modelProvider: overrides.modelProvider || process.env.ATHENA_CLOUD_MODEL_PROVIDER || 'local-fixture',
    searchProvider: overrides.searchProvider || process.env.ATHENA_CLOUD_SEARCH_PROVIDER || 'local-fixture',
    accessTtlMs: Number(overrides.accessTtlMs || 15 * 60 * 1000),
    refreshTtlMs: Number(overrides.refreshTtlMs || 30 * 24 * 60 * 60 * 1000),
    rateLimitPerMinute: Number(overrides.rateLimitPerMinute || 120),
    authRateLimitPerMinute: Number(overrides.authRateLimitPerMinute || 10),
    maxBodyBytes: Number(overrides.maxBodyBytes || 1024 * 1024),
    maxDevicesPerUser: Number(overrides.maxDevicesPerUser || 8),
    syncRecordMaxBytes: Number(overrides.syncRecordMaxBytes || 256 * 1024),
    monthlyModelTokenQuota: Number(overrides.monthlyModelTokenQuota || 100000),
    promptRetention: 'none',
    voiceRetention: 'none',
  };
  validateConfig(config);
  return Object.freeze(config);
}

function decodeMasterKey(value) {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('ATHENA_CLOUD_MASTER_KEY_BASE64 must decode to exactly 32 bytes.');
  return key;
}

function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('Invalid Cloud port.');
  if (!Buffer.isBuffer(config.masterKey) || config.masterKey.length !== 32) throw new Error('Cloud master key must be 32 bytes.');
  if (config.environment === 'production') {
    const blockers = [];
    if (!config.tlsTerminated) blockers.push('TLS termination proof');
    if (crypto.timingSafeEqual(config.masterKey, LOCAL_MASTER_KEY)) blockers.push('production master key');
    if (config.region.startsWith('local')) blockers.push('deployment region decision');
    if (config.cloudProvider === 'local') blockers.push('cloud provider decision');
    if (config.billingAdapter === 'local-no-charge') blockers.push('billing/tax adapter decision');
    if (config.recoveryDeliveryAdapter === 'local-return-token') blockers.push('account recovery delivery decision');
    if (config.modelProvider === 'local-fixture') blockers.push('model provider terms decision');
    if (config.searchProvider === 'local-fixture') blockers.push('search provider terms decision');
    if (blockers.length) throw new Error(`Production Cloud configuration blocked: ${blockers.join(', ')}.`);
  }
}

module.exports = { loadConfig, LOCAL_MASTER_KEY };
