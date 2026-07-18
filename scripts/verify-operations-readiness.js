const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function resolveGit() {
  const candidates = [
    process.env.ATHENA_GIT_PATH,
    'git',
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Git\\cmd\\git.exe' : null,
    process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'git', 'cmd', 'git.exe')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = childProcess.spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('Git executable not found. Set ATHENA_GIT_PATH to the approved git executable.');
}

const GIT = resolveGit();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function git(args) {
  return childProcess.execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function signatureStatus(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return 'Missing';
  const escaped = absolute.replace(/'/g, "''");
  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status`],
    { encoding: 'utf8' },
  );
  return result.status === 0 ? result.stdout.trim() : 'InspectionFailed';
}

function parseIssues() {
  const source = fs.readFileSync(path.join(ROOT, 'docs', 'ISSUE_REGISTER.md'), 'utf8');
  return source.split(/\r?\n/).filter(line => /^\| ATH-/.test(line)).map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return {
      id: cells[0],
      title: cells[1],
      evidence: cells[2],
      severity: cells[3],
      window: cells[4],
      status: cells[5],
    };
  });
}

function blocker(id, detail) {
  return { id, detail };
}

function decide(blockers) {
  return blockers.length === 0 ? 'GO' : 'NO-GO';
}

function artifact(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return { path: relativePath, exists: false };
  const stat = fs.statSync(absolute);
  return {
    path: relativePath,
    exists: true,
    bytes: stat.size,
    sha256: sha256(absolute),
    signature: signatureStatus(relativePath),
  };
}

function main() {
  const operations = readJson('config/operations.json');
  const commercial = readJson('config/commercial.json');
  const steam = readJson('config/steam.json');
  const cloudProviders = readJson('cloud/config/provider-policies.json');
  const supplyChain = readJson('docs/SUPPLY_CHAIN_MANIFEST.json');
  const issues = parseIssues();
  const issue = id => issues.find(item => item.id === id);
  const isOpen = id => !issue(id) || issue(id).status !== 'Closed';

  for (const required of [
    'docs/ops/RELEASE_OPERATIONS.md',
    'docs/ops/STATUS_PAGE_TEMPLATE.md',
    'docs/ops/INCIDENT_RECORD_TEMPLATE.md',
    'docs/WINDOW_11_RELEASE_REVIEW.md',
  ]) assert(exists(required), `Missing operations artifact: ${required}`);
  assert.equal(operations.reviewId, 'ATH-OPS-001');
  assert.equal(operations.releaseControls.p0RequiresGlobalStop, true);
  assert.equal(operations.releaseControls.unsignedArtifactDistributionAllowed, false);
  assert.equal(operations.releaseControls.unrepeatableEvidenceDistributionAllowed, false);
  assert.equal(operations.dataMigration.preMigrationBackupRequired, true);
  assert(operations.lifecycle.minimumEndOfSupportNoticeDays >= 180);

  const head = git(['rev-parse', 'HEAD']);
  const dirtyEntries = git(['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean);
  const openP0 = issues.filter(item => item.severity === 'P0' && item.status !== 'Closed');
  const unstaffedRoles = Object.entries(operations.roles).filter(([, value]) => !value).map(([name]) => name);
  const missingChannels = Object.entries(operations.channels).filter(([, value]) => !value).map(([name]) => name);
  const installer = artifact('release/Athena Setup 0.9.0-beta.1.exe');
  const desktopExe = artifact('release/win-unpacked/Athena.exe');
  const steamExe = artifact('release-steam/win-unpacked/AthenaSteam.exe');
  const recordedInstaller = supplyChain.buildArtifacts?.find(item => /Athena Setup 0\.9\.0-beta\.1\.exe$/.test(item.path));
  const manifestMatchesInstaller = Boolean(
    installer.exists
      && recordedInstaller
      && recordedInstaller.bytes === installer.bytes
      && recordedInstaller.sha256 === installer.sha256,
  );

  const desktopBlockers = [];
  if (isOpen('ATH-REL-001')) desktopBlockers.push(blocker('ATH-REL-001', issue('ATH-REL-001')?.status || 'missing'));
  if (isOpen('ATH-DESKTOP-001')) desktopBlockers.push(blocker('ATH-DESKTOP-001', issue('ATH-DESKTOP-001')?.status || 'missing'));
  if (isOpen('ATH-DESKTOP-002')) desktopBlockers.push(blocker('ATH-DESKTOP-002', issue('ATH-DESKTOP-002')?.status || 'missing'));
  if (isOpen('ATH-OPS-001')) desktopBlockers.push(blocker('ATH-OPS-001', issue('ATH-OPS-001')?.status || 'missing'));
  if (dirtyEntries.length) desktopBlockers.push(blocker('DIRTY_CHECKOUT', `${dirtyEntries.length} status entries`));
  if (!installer.exists || installer.bytes < 10 * 1024 * 1024) desktopBlockers.push(blocker('INSTALLER_INVALID', installer.exists ? `${installer.bytes} bytes` : 'missing'));
  if (installer.signature !== 'Valid' || desktopExe.signature !== 'Valid') desktopBlockers.push(blocker('SIGNATURE_INVALID', `installer=${installer.signature}; exe=${desktopExe.signature}`));
  if (!manifestMatchesInstaller) desktopBlockers.push(blocker('SUPPLY_CHAIN_MANIFEST_STALE', 'current installer does not match recorded artifact'));
  if (commercial.provider.mode !== 'production') desktopBlockers.push(blocker('LICENSE_PROVIDER_MISSING', commercial.provider.mode));
  if (Object.values(commercial.identity).some(value => !value)) desktopBlockers.push(blocker('PUBLIC_IDENTITY_MISSING', 'legal entity and public channels incomplete'));

  const steamBlockers = [];
  if (isOpen('ATH-STEAM-001')) steamBlockers.push(blocker('ATH-STEAM-001', issue('ATH-STEAM-001')?.status || 'missing'));
  if (isOpen('ATH-OPS-001')) steamBlockers.push(blocker('ATH-OPS-001', issue('ATH-OPS-001')?.status || 'missing'));
  if (!steam.appId || !steam.depotId) steamBlockers.push(blocker('STEAM_IDS_MISSING', `appId=${steam.appId}; depotId=${steam.depotId}`));
  if (!steamExe.exists || steamExe.signature !== 'Valid') steamBlockers.push(blocker('STEAM_CANDIDATE_MISSING', steamExe.signature));
  if (!process.env.STEAM_APP_ID || !process.env.STEAM_DEPOT_ID) steamBlockers.push(blocker('STEAM_ACCOUNT_EVIDENCE_MISSING', 'no configured AppID/DepotID evidence'));

  const productionProviders = cloudProviders.providers.filter(provider => provider.productionEligible);
  const cloudBlockers = [];
  if (isOpen('ATH-CLOUD-001')) cloudBlockers.push(blocker('ATH-CLOUD-001', issue('ATH-CLOUD-001')?.status || 'missing'));
  if (isOpen('ATH-OPS-001')) cloudBlockers.push(blocker('ATH-OPS-001', issue('ATH-OPS-001')?.status || 'missing'));
  if (!cloudProviders.productionDecision || productionProviders.length === 0) cloudBlockers.push(blocker('CLOUD_PROVIDER_MISSING', 'local fixture only'));
  if (!operations.statusPage.publicUrl || !operations.statusPage.provider) cloudBlockers.push(blocker('STATUS_PAGE_NOT_DEPLOYED', 'public URL/provider missing'));
  if (!operations.roles.cloudOnCallPrimary || !operations.roles.cloudOnCallSecondary) cloudBlockers.push(blocker('ON_CALL_NOT_STAFFED', 'primary/secondary missing'));

  const mobileProjectPaths = ['ios', 'android', 'mobile'].filter(relativePath => exists(relativePath));
  const mobileBase = [];
  if (isOpen('ATH-MOBILE-001')) mobileBase.push(blocker('ATH-MOBILE-001', issue('ATH-MOBILE-001')?.status || 'missing'));
  if (isOpen('ATH-CLOUD-001')) mobileBase.push(blocker('ATH-CLOUD-001', 'production Cloud prerequisite not closed'));
  if (isOpen('ATH-OPS-001')) mobileBase.push(blocker('ATH-OPS-001', issue('ATH-OPS-001')?.status || 'missing'));
  if (mobileProjectPaths.length === 0) mobileBase.push(blocker('MOBILE_PROJECT_MISSING', 'no iOS or Android project'));

  const iosBlockers = [...mobileBase];
  if (!process.env.APPLE_TEAM_ID) iosBlockers.push(blocker('APPLE_ACCOUNT_CERTIFICATE_MISSING', 'no configured team/certificate evidence'));
  if (!exists('docs/mobile/IOS_STORE_LISTING.md')) iosBlockers.push(blocker('IOS_STORE_LISTING_MISSING', 'no listing/privacy/screenshot manifest'));

  const androidBlockers = [...mobileBase];
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT) androidBlockers.push(blocker('PLAY_ACCOUNT_SIGNING_MISSING', 'no configured account/signing evidence'));
  if (!exists('docs/mobile/ANDROID_STORE_LISTING.md')) androidBlockers.push(blocker('ANDROID_STORE_LISTING_MISSING', 'no listing/data-safety/screenshot manifest'));

  const platforms = {
    desktopDirect: { decision: decide(desktopBlockers), blockers: desktopBlockers },
    steam: { decision: decide(steamBlockers), blockers: steamBlockers },
    cloud: { decision: decide(cloudBlockers), blockers: cloudBlockers },
    ios: { decision: decide(iosBlockers), blockers: iosBlockers },
    android: { decision: decide(androidBlockers), blockers: androidBlockers },
  };
  const allNoGo = Object.values(platforms).every(platform => platform.decision === 'NO-GO');

  const report = {
    schemaVersion: 1,
    reviewId: 'ATH-OPS-001',
    generatedAt: new Date().toISOString(),
    head,
    dirtyStatusEntries: dirtyEntries.length,
    openP0: openP0.map(({ id, status, window }) => ({ id, status, window })),
    operations: {
      statusPageDeployed: Boolean(operations.statusPage.publicUrl && operations.statusPage.provider),
      unstaffedRoles,
      missingChannels,
    },
    artifacts: { installer, desktopExe, steamExe, manifestMatchesInstaller },
    platforms,
  };

  for (const [name, platform] of Object.entries(platforms)) {
    console.log(`ATHENA_W11_PLATFORM_DECISION ${name}=${platform.decision} blockers=${platform.blockers.length}`);
  }
  console.log(`ATHENA_W11_OPEN_P0 count=${openP0.length} ids=${openP0.map(item => item.id).join(',')}`);
  console.log(`ATHENA_W11_OPERATIONS_EXTERNAL_BLOCKED roles=${unstaffedRoles.length} channels=${missingChannels.length} statusPage=${report.operations.statusPageDeployed ? 'deployed' : 'missing'}`);
  console.log(`ATHENA_OPS_WINDOW11_AUDIT_OK allNoGo=${allNoGo} dirty=${dirtyEntries.length} manifestCurrent=${manifestMatchesInstaller}`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--require-go') && !Object.values(platforms).every(platform => platform.decision === 'GO')) process.exit(2);
}

main();
