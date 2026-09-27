'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const stagingMode = process.argv.includes('--staging');
const selfSeed = stagingMode || process.env.ATHENA_ACCOUNT_ACCEPTANCE_SELF_SEED === 'true';
const baseUrl = String(
  process.env.ATHENA_ACCOUNT_ACCEPTANCE_URL
  || (stagingMode ? 'https://staging-api.elanastra.com' : ''),
).trim().replace(/\/+$/, '');
const email = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ATHENA_ACCOUNT_ACCEPTANCE_PASSWORD || '');
const expectedAdultMode = process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'true'
  ? true
  : process.env.ATHENA_ACCOUNT_ACCEPTANCE_ADULT_MODE === 'false'
    ? false
    : selfSeed ? true : null;

if (!baseUrl || (!selfSeed && (!email || !password))) {
  console.error('Set ATHENA_ACCOUNT_ACCEPTANCE_URL, ATHENA_ACCOUNT_ACCEPTANCE_EMAIL, and ATHENA_ACCOUNT_ACCEPTANCE_PASSWORD.');
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-account-runtime-'));
const credentialsDirectory = path.join(scratch, 'credentials');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_CREDENTIALS_DIR = credentialsDirectory;
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_EXPORT_DIR = path.join(scratch, 'exports');
process.env.ATHENA_DIAGNOSTICS_DIR = path.join(scratch, 'diagnostics');
process.env.ATHENA_ATTACHMENT_DIR = path.join(scratch, 'attachments');
process.env.ATHENA_VOICE_TEMP_DIR = path.join(scratch, 'voice');
process.env.ATHENA_USE_LOCAL_SETTINGS = '0';
app.disableHardwareAcceleration();
app.setPath('userData', path.join(scratch, 'user-data'));

(async () => {
  let exitCode = 0;
  try {
    await app.whenReady();
    const { runAccountRuntimeAcceptance } = require('../dist/core/cloud/AccountRuntimeAcceptance.js');
    const result = await runAccountRuntimeAcceptance({
      baseUrl,
      credentialsDirectory,
      endpointSource: 'developer-override',
      selfSeed,
      email,
      password,
      expectedAdultMode,
    });
    console.log(
      `ATHENA_ACCOUNT_RUNTIME_OK endpoint=${result.endpoint} backgroundBytes=${result.backgroundBytes}`
      + ` dimensions=${result.width}x${result.height} adultMode=${result.adultMode}`
      + ' firstLogin=blocked conflict=explicit logout=local-preserved'
      + ` deviceRevoke=${selfSeed ? 'verified' : 'not-tested'} cleanup=${result.cleanup}`,
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    try {
      const { closeDatabase } = require('../dist/memory/database/index.js');
      closeDatabase();
    } catch {
      // The database is lazy and may never have opened.
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    app.exit(exitCode);
  }
})();
