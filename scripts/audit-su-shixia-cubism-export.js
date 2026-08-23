const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const HANDOFF_ROOT = path.join(PACKAGE_ROOT, 'cubism-handoff');
const REPORT_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-export-audit.json');
const REQUIRE_GO = process.argv.includes('--require-go');

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const exportGate = readJson(path.join(HANDOFF_ROOT, 'export-gate.json'));
  const checks = [];

  checks.push(checkValue('manifest.cubismExportReady', manifest.production.cubismExportReady, false));
  checks.push(checkValue('exportGate.status', exportGate.status, 'manual_export_required'));
  checks.push(checkValue('exportGate.headlessExportAvailable', exportGate.editor.headlessExportAvailable, false));

  const runtimeFiles = exportGate.requiredRuntimeFiles.map(item => auditRuntimeFile(item));
  checks.push(...runtimeFiles.map(item => item.check));

  const model3File = runtimeFiles.find(item => item.kind === 'model3');
  const model3Audit = model3File?.exists ? auditModel3(model3File.absolutePath) : missingModel3Audit();
  checks.push(...model3Audit.checks);

  const runtimeProof = auditRuntimeProof();
  checks.push(...runtimeProof.checks);

  const failed = checks.filter(item => item.status !== 'pass');
  const status = failed.length === 0 ? 'go' : 'no_go';
  const report = {
    version: 1,
    generatedAt: '2026-08-24',
    packageId: manifest.id,
    status,
    conclusion: status === 'go'
      ? 'Cubism export evidence is present. Final release still requires human visual, rights, and license approval.'
      : 'Su Shixia V2 remains NO-GO for genuine Cubism release because export/runtime proof is incomplete.',
    exportGate: manifest.sourceArt.cubismExportGate,
    requireGoMode: REQUIRE_GO,
    runtimeFiles: runtimeFiles.map(item => ({
      kind: item.kind,
      path: item.path,
      exists: item.exists,
      size: item.size,
    })),
    model3: model3Audit.summary,
    runtimeProof: runtimeProof.summary,
    checks,
    blockingItems: failed.map(item => item.id),
    goNoGoBoundary: {
      liteRuntimePreview: manifest.production.liteRuntimePreviewReady === true ? 'go' : 'no_go',
      cubismEditorHandoff: manifest.production.cubismHandoffReady === true ? 'go' : 'no_go',
      genuineCubismExport: status,
      publicDistribution: 'no_go',
      reason: 'Public distribution is blocked until genuine Cubism export, Cubism Web runtime proof, visual review, rights review, and Live2D license review pass.',
    },
  };

  writeJson(REPORT_PATH, report);
  const summary = `SU_SHIXIA_CUBISM_EXPORT_AUDIT_${status.toUpperCase()} `
    + `missing=${failed.length} report=${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`;
  if (REQUIRE_GO && status !== 'go') {
    console.error(summary);
    process.exitCode = 1;
    return;
  }
  console.log(summary);
}

function auditRuntimeFile(item) {
  const absolutePath = path.resolve(HANDOFF_ROOT, item.path);
  const exists = fs.existsSync(absolutePath);
  const result = {
    kind: item.kind,
    path: path.relative(PACKAGE_ROOT, absolutePath).replace(/\\/g, '/'),
    absolutePath,
    exists,
    size: exists ? fs.statSync(absolutePath).size : 0,
  };
  const failures = [];
  if (!exists) failures.push('missing');
  if (exists && item.minBytes && result.size < item.minBytes) failures.push(`too_small:${result.size}<${item.minBytes}`);
  if (exists && item.magic && readMagic(absolutePath, item.magic.length) !== item.magic) failures.push(`bad_magic:${item.magic}`);
  return {
    ...result,
    check: {
      id: `runtime-file:${item.kind}`,
      status: failures.length === 0 ? 'pass' : 'fail',
      detail: failures.length ? failures.join(',') : result.path,
    },
  };
}

function auditModel3(model3Path) {
  const checks = [];
  let model;
  try {
    model = readJson(model3Path);
    checks.push({ id: 'model3:json', status: 'pass', detail: 'valid JSON' });
  } catch (error) {
    return {
      summary: { exists: true, validJson: false, error: String(error.message ?? error) },
      checks: [{ id: 'model3:json', status: 'fail', detail: String(error.message ?? error) }],
    };
  }

  const references = model.FileReferences ?? {};
  const moc = typeof references.Moc === 'string' ? references.Moc : '';
  const textures = Array.isArray(references.Textures) ? references.Textures : [];
  const motions = references.Motions && typeof references.Motions === 'object' ? references.Motions : {};
  const expressions = Array.isArray(references.Expressions) ? references.Expressions : [];

  checks.push(checkTruthy('model3:moc-reference', moc.endsWith('.moc3'), moc || 'missing'));
  checks.push(checkTruthy('model3:textures', textures.length > 0, String(textures.length)));
  checks.push(checkTruthy('model3:motions', Object.keys(motions).length >= 6, String(Object.keys(motions).length)));
  checks.push(checkTruthy('model3:expressions', expressions.length >= 5, String(expressions.length)));
  checks.push(checkReferencedFile(model3Path, moc, 'model3:moc-file'));
  for (const [index, texture] of textures.entries()) {
    checks.push(checkReferencedFile(model3Path, texture, `model3:texture:${index}`));
  }

  return {
    summary: {
      exists: true,
      validJson: true,
      moc,
      textureCount: textures.length,
      motionGroupCount: Object.keys(motions).length,
      expressionCount: expressions.length,
    },
    checks,
  };
}

function missingModel3Audit() {
  return {
    summary: {
      exists: false,
      validJson: false,
      moc: null,
      textureCount: 0,
      motionGroupCount: 0,
      expressionCount: 0,
    },
    checks: [
      { id: 'model3:json', status: 'fail', detail: 'missing exported Cubism model3.json' },
      { id: 'model3:moc-reference', status: 'fail', detail: 'missing exported Cubism model3.json' },
      { id: 'model3:textures', status: 'fail', detail: 'missing exported Cubism model3.json' },
      { id: 'model3:motions', status: 'fail', detail: 'missing exported Cubism model3.json' },
      { id: 'model3:expressions', status: 'fail', detail: 'missing exported Cubism model3.json' },
    ],
  };
}

function auditRuntimeProof() {
  const proofPath = path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-runtime-proof.json');
  const exists = fs.existsSync(proofPath);
  if (!exists) {
    return {
      summary: { path: path.relative(ROOT, proofPath).replace(/\\/g, '/'), exists: false },
      checks: [
        { id: 'runtime-proof:cubism-web', status: 'fail', detail: 'missing runtime proof JSON' },
        { id: 'runtime-proof:lip-sync', status: 'fail', detail: 'missing runtime proof JSON' },
        { id: 'runtime-proof:visual-delta', status: 'fail', detail: 'missing runtime proof JSON' },
        { id: 'runtime-proof:hot-zone-policy', status: 'fail', detail: 'missing runtime proof JSON' },
      ],
    };
  }
  const proof = readJson(proofPath);
  return {
    summary: { path: path.relative(ROOT, proofPath).replace(/\\/g, '/'), exists: true },
    checks: [
      checkValue('runtime-proof:cubism-web', proof.renderer, 'cubism-web'),
      checkTruthy('runtime-proof:lip-sync', proof.lipSync?.passed === true, JSON.stringify(proof.lipSync ?? null)),
      checkTruthy('runtime-proof:visual-delta', proof.visualDelta?.passed === true, JSON.stringify(proof.visualDelta ?? null)),
      checkTruthy('runtime-proof:hot-zone-policy', proof.hotZonePolicy?.passed === true, JSON.stringify(proof.hotZonePolicy ?? null)),
    ],
  };
}

function checkReferencedFile(baseFile, reference, id) {
  if (!reference) return { id, status: 'fail', detail: 'missing reference' };
  const absolutePath = path.resolve(path.dirname(baseFile), reference);
  return {
    id,
    status: fs.existsSync(absolutePath) ? 'pass' : 'fail',
    detail: path.relative(PACKAGE_ROOT, absolutePath).replace(/\\/g, '/'),
  };
}

function checkValue(id, actual, expected) {
  return {
    id,
    status: actual === expected ? 'pass' : 'fail',
    detail: `expected=${expected} actual=${actual}`,
  };
}

function checkTruthy(id, value, detail) {
  return { id, status: value ? 'pass' : 'fail', detail };
}

function readMagic(filePath, length) {
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, buffer, 0, length, 0);
  } finally {
    fs.closeSync(handle);
  }
  return buffer.toString('ascii');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

main();
