'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const androidRoot = path.join(root, 'mobile', 'android');
const required = [
  'mobile/android/README.md',
  'mobile/android/settings.gradle.kts',
  'mobile/android/app/build.gradle.kts',
  'mobile/android/app/src/main/AndroidManifest.xml',
  'mobile/android/app/src/main/java/com/elanastra/athena/MainActivity.kt',
  'mobile/android/app/src/main/java/com/elanastra/athena/cloud/AthenaCloudClient.kt',
  'mobile/android/app/src/main/java/com/elanastra/athena/ui/AthenaCompanionApp.kt',
  'mobile/protocol/companion-client.js',
  'mobile/protocol/companion-protocol.test.js',
  'docs/ANDROID_COMPANION_PLAN.md',
];
for (const relative of required) {
  const resolved = path.join(root, relative);
  if (!fs.existsSync(resolved)) throw new Error(`Required Android companion artifact is missing: ${relative}`);
}

const source = walk(path.join(root, 'mobile'))
  .filter((file) => /\.(kt|xml|js|kts|md)$/i.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

for (const forbidden of [
  /require\(['"]electron['"]\)/,
  /src[\\/]app[\\/]main/,
  /database[\\/]athena\.db/,
  /ComputerTools/,
  /mode === ['"]execute['"].*infer/,
  /live2dcubismcore/,
]) {
  if (forbidden.test(source)) throw new Error(`Android companion contains forbidden Desktop coupling: ${forbidden}`);
}
if (!source.includes('com.elanastra.athena')) throw new Error('ApplicationId namespace is missing.');
if (!source.includes('invalid-mode') || !source.includes('Execute')) {
  throw new Error('Android companion must fail closed on Execute mode.');
}
if (!source.includes('/v1/search/query')) throw new Error('Android companion must use the Cloud search proxy.');
if (/sogou|duckduckgo/i.test(source)) throw new Error('Android companion must not scrape third-party HTML search pages.');

const gradle = fs.readFileSync(path.join(androidRoot, 'app', 'build.gradle.kts'), 'utf8');
if (!gradle.includes('applicationId = "com.elanastra.athena"')) throw new Error('applicationId must be com.elanastra.athena.');
if (!gradle.includes('minSdk = 29')) throw new Error('minSdk 29 is required.');
if (!gradle.includes('ALLOW_LOOPBACK_CLEARTEXT')) throw new Error('Cleartext must be flavor-gated.');

const protocol = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'mobile/protocol/companion-protocol.test.js'], {
  cwd: root, encoding: 'utf8', shell: false,
});
process.stdout.write(protocol.stdout || '');
process.stderr.write(protocol.stderr || '');
if (protocol.status !== 0) throw new Error(`Android companion protocol tests failed with exit code ${protocol.status}.`);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
const sdkState = sdk && fs.existsSync(sdk) ? 'present' : 'absent';
if (sdkState === 'present') {
  const gradlew = path.join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (fs.existsSync(gradlew)) {
    const assemble = spawnSync(gradlew, [':app:assembleDebug'], { cwd: androidRoot, encoding: 'utf8', shell: false });
    process.stdout.write(assemble.stdout || '');
    process.stderr.write(assemble.stderr || '');
    if (assemble.status !== 0) throw new Error('Android assembleDebug failed.');
  }
}

const protocolPass = (protocol.stdout.match(/^# pass /m) || protocol.stdout.match(/^ok /m) || protocol.stdout.match(/# tests/));
process.stdout.write(
  `ATHENA_ANDROID_COMPANION_ENGINEERING_OK applicationId=com.elanastra.athena modes=create,companion,reason execute=excluded search=cloud-proxy billing=local-no-charge sdk=${sdkState} production=no-go\n`,
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(resolved) : [resolved];
  });
}
