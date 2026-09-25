'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createCloudApp } = require('../src/server');

async function main() {
  const cloudRoot = path.resolve(__dirname, '..');
  const workspace = path.resolve(cloudRoot, '..');
  const blueprint = fs.readFileSync(path.join(workspace, 'render.yaml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(cloudRoot, 'Dockerfile'), 'utf8');

  for (const required of [
    'runtime: docker', 'region: singapore', 'plan: 0.5c-512mb', 'numInstances: 1',
    'autoDeployTrigger: off', 'staging-api.elanastra.com', 'mountPath: /app/storage', 'sizeGB: 1',
    'value: staging', 'value: 0.0.0.0', 'value: /app/storage/athena-cloud.db',
    'generateValue: true', 'value: render', 'value: local-no-charge',
    'value: local-return-token', 'value: local-fixture',
  ]) assert.ok(blueprint.includes(required), `Render Blueprint is missing: ${required}`);
  assert.ok(!/ATHENA_CLOUD_MASTER_KEY_BASE64\s*\n\s*value:/u.test(blueprint), 'Master key must not be committed.');
  assert.match(dockerfile, /^FROM node:24\.21\.0-bookworm AS dependencies/m);
  assert.match(dockerfile, /^USER node$/m);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-render-staging-'));
  const config = loadConfig({
    environment: 'staging',
    host: '127.0.0.1',
    port: 0,
    dbPath: path.join(root, 'athena-cloud.db'),
    backupDir: path.join(root, 'backups'),
    exportDir: path.join(root, 'exports'),
    masterKey: crypto.randomBytes(32),
    tlsTerminated: true,
    region: 'singapore',
    cloudProvider: 'render',
  });
  const app = createCloudApp(config);
  try {
    const address = await app.listen();
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.status, 'ready');
    assert.equal(health.deployment.region, 'singapore');
    assert.equal(health.runtimeBindings.cloudProvider, 'render');
    assert.equal(health.runtimeBindings.billingAdapter, 'local-no-charge');
    assert.equal(health.runtimeBindings.recoveryDeliveryAdapter, 'local-return-token');
    assert.equal(health.runtimeBindings.modelProvider, 'local-fixture');
    assert.equal(health.runtimeBindings.searchProvider, 'local-fixture');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write('ATHENA_CLOUD_RENDER_STAGING_OK env=staging provider=render region=singapore production=no-go\n');
}

main().catch((error) => {
  process.stderr.write(`ATHENA_CLOUD_RENDER_STAGING_FAIL ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
