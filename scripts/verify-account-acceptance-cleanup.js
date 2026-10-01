'use strict';

// Narrow unit regression for the acceptance runner, not live-provider proof.
// Load its private cleanup closure with mocked dependencies; no user profile,
// Electron instance, real credentials, or external network is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sourceRef = process.argv.find(value => value.startsWith('--source-ref='))?.split('=')[1];
const source = sourceRef
  ? execFileSync('git', ['show', `${sourceRef}:src/core/cloud/AccountRuntimeAcceptance.ts`], { cwd: root, encoding: 'utf8', windowsHide: true })
  : fs.readFileSync(path.join(root, 'src/core/cloud/AccountRuntimeAcceptance.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const tenantId = `ten_${'1'.repeat(32)}`;
function account() { return { tenantId, accessToken: 'synthetic-unit-token', seedDeviceId: `dev_${'2'.repeat(32)}`, email: 'unit@example.test', password: 'unit-only' }; }
function load(fetchImpl, settings = {}) {
  const exports = {};
  const context = vm.createContext({
    exports, module: { exports }, Buffer, AbortSignal,
    console: { log() {}, error() {} }, fetch: fetchImpl,
    require(name) {
      if (name.startsWith('node:')) return require(name);
      if (name === '../config/SettingsStore') return settings;
      return {};
    },
  });
  vm.runInContext(`${compiled}\nexports.cleanupForTest = deleteDisposableAccount;`, context);
  return { context, exports };
}
function reply(status, body = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }

(async () => {
  let deletes = 0;
  const completed = account();
  const first = load(async (_url, options) => {
    if (options.method === 'DELETE') {
      deletes++;
      return deletes === 1 ? reply(200, { status: 'complete', cryptographicErase: true }) : reply(401, { title: 'session-expired' });
    }
    return reply(503, { title: 'synthetic-negative-probe-failure' });
  });
  await assert.rejects(first.exports.cleanupForTest('http://127.0.0.1:1', completed), error => error.actual === 503 && error.expected === 401);
  assert.equal(completed.deleted, true, 'server-confirmed erasure must be remembered before the negative probe');
  await first.exports.cleanupForTest('http://127.0.0.1:1', completed);
  assert.equal(deletes, 1, 'a negative-probe failure must not cause a second DELETE with an erased session');
  console.log('PASS successful-erasure-is-not-deleted-twice');

  const primary = new Error('synthetic-primary-acceptance-failure');
  let failedCleanupCalls = 0;
  const second = load(async () => { failedCleanupCalls++; return reply(401, { title: 'session-expired' }); }, {
    saveSettingsBundle() { throw primary; },
  });
  second.context.syntheticAccount = account();
  vm.runInContext('seedDisposableAccount = async () => syntheticAccount;', second.context);
  await assert.rejects(second.exports.runAccountRuntimeAcceptance({ baseUrl: 'http://127.0.0.1:1', credentialsDirectory: 'unused', endpointSource: 'developer-override', selfSeed: true }), error => error === primary);
  assert.equal(failedCleanupCalls, 1, 'cleanup must still be attempted after the primary failure');
  console.log('PASS cleanup-failure-keeps-primary-assertion');

  const unconfirmed = account();
  let unconfirmedCalls = 0;
  let boundedRequest = false;
  const third = load(async (_url, options) => {
    boundedRequest = options.signal instanceof AbortSignal;
    unconfirmedCalls++;
    return reply(200, { status: 'complete', cryptographicErase: false });
  });
  await assert.rejects(third.exports.cleanupForTest('http://127.0.0.1:1', unconfirmed));
  assert.notEqual(unconfirmed.deleted, true, 'an invalid receipt must not be remembered as successful erasure');
  assert.equal(unconfirmedCalls, 1);
  assert.equal(boundedRequest, true, 'acceptance requests must have a finite timeout');
  console.log('PASS invalid-erasure-receipt-still-fails');
  console.log('ATHENA_ACCOUNT_ACCEPTANCE_CLEANUP_OK cases=3 network=mocked primaryFailure=preserved erasure=not-repeated');
})().catch(error => { console.error(error); process.exitCode = 1; });
