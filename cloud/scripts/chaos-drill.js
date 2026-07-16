'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createCloudApp } = require('../src/server');
const { UnavailableModelProvider } = require('../src/services');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cloud-drill-'));
  const config = loadConfig({
    port: 0, dbPath: path.join(root, 'cloud.db'), backupDir: path.join(root, 'backups'), exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32), rateLimitPerMinute: 2,
  });
  const app = createCloudApp(config);
  const results = {};
  try {
    const account = app.services.auth.registerTenant({
      tenantName: 'Drill Tenant', email: 'drill@example.test', password: 'correct horse battery staple drill',
      deviceName: 'Drill device', platform: 'test',
    });
    const context = app.services.auth.authenticate(account.accessToken);
    app.services.sync.put(context, {
      resourceId: 'memory.drill', resourceType: 'memory', schemaVersion: 1, baseVector: {}, payload: { state: 'before-drill' }, deleted: false,
    });

    const keyVersion = app.services.store.rotateTenantKey(account.tenantId);
    results.keyRotation = keyVersion === 2 && app.services.sync.get(context, 'memory.drill').payload.state === 'before-drill';

    app.services.model.provider = new UnavailableModelProvider();
    try { await app.services.model.infer(context, { prompt: 'private outage drill prompt', mode: 'reason' }); }
    catch (error) { results.providerOutage = error.code === 'model-unavailable' && error.status === 503; }

    const backup = await app.services.backup.create();
    const restored = app.services.backup.restoreTo(backup.id, path.join(root, 'restore', 'cloud.db'));
    results.restore = restored.integrity === 'ok';
    const backupRow = app.services.store.db.prepare('SELECT * FROM backup_catalog WHERE id=?').get(backup.id);
    fs.appendFileSync(backupRow.file_path, 'corruption');
    try { app.services.backup.restoreTo(backup.id, path.join(root, 'restore-corrupt.db')); }
    catch (error) { results.corruptBackupRejected = error.code === 'backup-corrupt'; }

    results.regionFailover = app.services.deployment.markUnavailable(config.region).region === 'local-2';
    results.totalRegionLoss = app.services.deployment.markUnavailable('local-2').region === null;

    app.services.rate.consume('drill', 1, 0);
    try { app.services.rate.consume('drill', 1, 0); }
    catch (error) { results.rateLimit = error.code === 'rate-limit'; }

    if (Object.values(results).some((value) => value !== true)) throw new Error(`Drill failure: ${JSON.stringify(results)}`);
    process.stdout.write(`ATHENA_CLOUD_DRILL_OK ${Object.entries(results).map(([key]) => `${key}=pass`).join(' ')}\n`);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`ATHENA_CLOUD_DRILL_FAILED ${error.message}\n`);
  process.exitCode = 1;
});
