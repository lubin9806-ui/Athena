const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-runtime-policy-proof.json');
const RUNTIME_MODULE_PATH = '../dist/renderer/avatar/live2d/AthenaLive2DCompanion';

function main() {
  const {
    buildHotZoneReplyPrompt,
    findAthenaReplyPrompt,
    readAthenaLive2DPreferences,
  } = require(RUNTIME_MODULE_PATH);
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const profile = readJson(path.join(PACKAGE_ROOT, 'profile.avatar.json'));
  const interactionMatrix = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.interactionMatrix));

  const zoneProofs = profile.hotZones.map(zone => {
    const basePrompt = findAthenaReplyPrompt(zone.action);
    const normalPrompt = buildHotZoneReplyPrompt(basePrompt, zone, profile.interactionPolicy, 'normal') ?? '';
    const privateAttemptPrompt = buildHotZoneReplyPrompt(basePrompt, zone, profile.interactionPolicy, 'private_opt_in') ?? '';
    const expectedPrivateMode = zone.interaction?.privateModeAllowed ? 'private_opt_in' : 'normal';
    return {
      id: zone.id,
      bodyPart: zone.interaction?.bodyPart ?? zone.label,
      sensitivity: zone.interaction?.sensitivity ?? 'neutral',
      privateModeAllowed: zone.interaction?.privateModeAllowed === true,
      actionPromptPresent: Boolean(basePrompt),
      normalMode: {
        effectiveMode: extractMode(normalPrompt),
        includesBodyPart: normalPrompt.includes(zone.interaction?.bodyPart ?? zone.label),
        includesMotionIntent: normalPrompt.includes(zone.interaction?.motionIntent ?? ''),
        includesNormalBoundary: normalPrompt.includes(zone.interaction?.normalModeBoundary ?? profile.interactionPolicy.normalModePrompt),
        blocksAdultEscalation: normalPrompt.includes('不要升级为成人或露骨内容'),
      },
      privateOptInAttempt: {
        expectedEffectiveMode: expectedPrivateMode,
        effectiveMode: extractMode(privateAttemptPrompt),
        includesPrivateBoundary: zone.interaction?.privateModeAllowed === true
          ? privateAttemptPrompt.includes(zone.interaction?.privateModeBoundary ?? profile.interactionPolicy.privateModePrompt)
          : false,
        fallsBackToNormalWhenNotAllowed: zone.interaction?.privateModeAllowed === true
          ? false
          : extractMode(privateAttemptPrompt) === 'normal',
      },
    };
  });

  const checks = [
    check('compiled-runtime-helper-loaded', typeof buildHotZoneReplyPrompt === 'function'),
    check('default-preferences-normal', readAthenaLive2DPreferences(null).interactionMode === 'normal'),
    check('all-zones-have-action-prompt', zoneProofs.every(item => item.actionPromptPresent)),
    check('all-normal-prompts-stay-normal', zoneProofs.every(item => item.normalMode.effectiveMode === 'normal')),
    check('all-normal-prompts-include-body-part', zoneProofs.every(item => item.normalMode.includesBodyPart)),
    check('all-normal-prompts-include-motion-intent', zoneProofs.every(item => item.normalMode.includesMotionIntent)),
    check('sensitive-normal-prompts-block-adult-escalation', zoneProofs
      .filter(item => item.sensitivity === 'sensitive' || item.sensitivity === 'private')
      .every(item => item.normalMode.blocksAdultEscalation)),
    check('private-opt-in-zones-enter-private-mode', zoneProofs
      .filter(item => item.privateModeAllowed)
      .every(item => item.privateOptInAttempt.effectiveMode === 'private_opt_in')),
    check('non-private-zones-remain-normal-on-private-attempt', zoneProofs
      .filter(item => !item.privateModeAllowed)
      .every(item => item.privateOptInAttempt.fallsBackToNormalWhenNotAllowed)),
    check('matrix-zone-count-matches-profile', interactionMatrix.coverage.totalZones === zoneProofs.length),
    check('public-forbidden-assets-declared', profile.interactionPolicy.forbiddenPublicAssetTypes.includes('adult_motion')),
  ];

  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status: checks.every(item => item.status === 'pass') ? 'go' : 'no_go',
    runtimeModule: 'dist/renderer/avatar/live2d/AthenaLive2DCompanion',
    profilePath: 'assets/avatar/su-shixia-live2d-v2/profile.avatar.json',
    coverage: {
      totalZones: zoneProofs.length,
      privateOptInCapableZones: zoneProofs.filter(item => item.privateModeAllowed).length,
      normalModeProofs: zoneProofs.filter(item => item.normalMode.effectiveMode === 'normal').length,
      privateModeProofs: zoneProofs.filter(item => item.privateOptInAttempt.effectiveMode === 'private_opt_in').length,
      privateAttemptsFallingBackToNormal: zoneProofs.filter(item => item.privateOptInAttempt.fallsBackToNormalWhenNotAllowed).length,
      forbiddenPublicAssetTypes: profile.interactionPolicy.forbiddenPublicAssetTypes,
    },
    checks,
    zoneProofs,
    boundary: {
      replyTextGeneratedByPersona: true,
      runtimeOwnsModeAndPromptBoundary: true,
      normalModeAdultEscalationAllowed: false,
      publicPackagePrivateAssetsAllowed: false,
      proofDoesNotVerifyCubismMoc3: true,
    },
  };
  writeJson(REPORT_PATH, report);
  console.log(`SU_SHIXIA_RUNTIME_POLICY_PROOF_GENERATED zones=${zoneProofs.length} status=${report.status}`);
}

function extractMode(prompt) {
  if (prompt.includes('当前模式：private_opt_in')) return 'private_opt_in';
  if (prompt.includes('当前模式：normal')) return 'normal';
  return 'unknown';
}

function check(id, passed, detail = '') {
  return { id, status: passed ? 'pass' : 'fail', detail };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main();
