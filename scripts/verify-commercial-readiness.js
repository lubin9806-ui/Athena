const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '..');
const { assertCommercialPolicy, commercialProductionBlockers } = require('../dist/core/commercial/CommercialPolicy.js');
const { LicenseService } = require('../dist/core/commercial/LicenseService.js');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

class MemoryStore {
  constructor() { this.entitlement = null; }
  async load() { return this.entitlement ? structuredClone(this.entitlement) : null; }
  async save(entitlement) { this.entitlement = structuredClone(entitlement); }
  async clear() { this.entitlement = null; }
}

class LocalTestAdapter {
  constructor(policy) {
    this.id = 'local-window-07-fixture';
    this.mode = 'test';
    this.policy = policy;
    this.devices = new Map();
    this.secret = 'window-07-fixture-only';
  }

  token(entitlement) {
    return crypto.createHmac('sha256', this.secret)
      .update([entitlement.entitlementId, entitlement.skuId, entitlement.deviceId, entitlement.status].join('|'))
      .digest('hex');
  }

  async activate(request) {
    assert.strictEqual(request.licenseKey, 'LOCAL-TEST-KEY');
    const active = this.devices.get(request.licenseKey) || new Set();
    if (!active.has(request.deviceId) && active.size >= this.policy.product.maxActiveDevices) {
      throw new Error('Device limit reached.');
    }
    active.add(request.deviceId);
    this.devices.set(request.licenseKey, active);
    const entitlement = {
      schemaVersion: 1,
      entitlementId: `fixture-${request.deviceId}`,
      skuId: request.skuId,
      deviceId: request.deviceId,
      includedMajorVersion: 1,
      issuedAt: new Date(0).toISOString(),
      status: 'active',
      verificationToken: '',
    };
    entitlement.verificationToken = this.token(entitlement);
    return entitlement;
  }

  async deactivate(entitlement) {
    for (const devices of this.devices.values()) devices.delete(entitlement.deviceId);
  }

  async verify(entitlement, deviceId) {
    return entitlement.deviceId === deviceId && entitlement.verificationToken === this.token(entitlement);
  }
}

async function verifyLicenseBoundary(policy) {
  const adapter = new LocalTestAdapter(policy);
  assert.throws(() => new LicenseService(policy, adapter, new MemoryStore()), /explicit local-test opt-in/);

  const first = new LicenseService(policy, adapter, new MemoryStore(), { allowTestAdapter: true });
  const second = new LicenseService(policy, adapter, new MemoryStore(), { allowTestAdapter: true });
  const thirdStore = new MemoryStore();
  const third = new LicenseService(policy, adapter, thirdStore, { allowTestAdapter: true });
  await first.activate('LOCAL-TEST-KEY', 'device-0001', '1.0.0');
  await second.activate('LOCAL-TEST-KEY', 'device-0002', '1.0.0');
  await assert.rejects(() => third.activate('LOCAL-TEST-KEY', 'device-0003', '1.0.0'), /Device limit reached/);
  await first.deactivate('device-0001');
  assert.strictEqual((await third.activate('LOCAL-TEST-KEY', 'device-0003', '1.0.0')).status, 'active');
  assert.strictEqual((await third.current('another-device')).status, 'invalid');
  thirdStore.entitlement.verificationToken = 'tampered';
  assert.strictEqual((await third.current('device-0003')).status, 'invalid');
  assert(!JSON.stringify(thirdStore.entitlement).includes('LOCAL-TEST-KEY'), 'raw license keys must never be persisted');
  await assert.rejects(() => third.activate('LOCAL-TEST-KEY', 'device-0003', '2.0.0'), /only covers Athena Desktop 1.x/);
}

function verifyMaterials() {
  const materialFiles = ['promo/index.html', 'promo/product.html', 'promo/visual.html', 'docs/DESKTOP_1_0_STORE_LISTING.md'];
  const text = materialFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  for (const forbidden of ['Muse & Venus', 'Oracle 推演', '支持 macOS', '支持 Linux', '支持日历', 'Live2D 已上线', '云同步已上线']) {
    assert(!text.includes(forbidden), `release material contains forbidden claim: ${forbidden}`);
  }
  for (const required of ['Windows 10/11 x64', '本地优先', 'Planned', '尚未开放购买']) {
    assert(text.includes(required), `release material is missing required boundary: ${required}`);
  }
  for (const file of materialFiles.filter(file => file.endsWith('.html'))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const $ = cheerio.load(source);
    assert.strictEqual($('html').attr('lang'), 'zh-CN', `${file} must declare its language`);
    assert.strictEqual($('title').length, 1, `${file} must have one title`);
    assert.strictEqual($('h1').length, 1, `${file} must have one primary heading`);
    assert.strictEqual($('script[src="./promo.js"]').length, 1, `${file} must load the shared visual script`);
    assert(!source.includes('\uFFFD'), `${file} contains a replacement character`);
  }
}

async function main() {
  const policy = readJson('config/commercial.json');
  assertCommercialPolicy(policy);
  assert.strictEqual(policy.releaseStage, 'prelaunch');
  assert.strictEqual(policy.provider.mode, 'unconfigured');
  assert.deepStrictEqual(policy.product, {
    name: 'Athena Desktop',
    skuId: 'athena-desktop-personal-v1',
    displayName: 'Athena Desktop 1.x Personal',
    licenseModel: 'one_time',
    accountRequired: false,
    maxActiveDevices: 2,
    includedMajorVersion: 1,
    freeTier: false,
    subscription: false,
    price: null,
    currency: null,
  });
  const blockers = commercialProductionBlockers(policy);
  assert(blockers.length >= 10, 'prelaunch config must remain blocked until external commercial inputs exist');
  assert(blockers.some(blocker => blocker.includes('legalEntity')));
  assert(blockers.some(blocker => blocker.includes('verificationPublicKey')));
  await verifyLicenseBoundary(policy);
  verifyMaterials();
  console.log(`ATHENA_COMMERCIAL_READINESS_OK sku=${policy.product.skuId} model=one_time devices=2 productionBlockers=${blockers.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
