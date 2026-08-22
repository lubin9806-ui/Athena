const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'athena-live2d-default');
const MODEL_ROOT = path.join(PACKAGE_ROOT, 'model');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const runtimeModel = readJson(path.join(MODEL_ROOT, 'athena-live2d-default-sdk5.model3.json'));
  const sourceModel = readJson(path.join(MODEL_ROOT, 'athena-live2d-default.model3.json'));
  const displayInfo = readJson(path.join(MODEL_ROOT, 'athena-live2d-default-sdk5.cdi3.json'));
  const parameterIds = new Set(displayInfo.Parameters.map(parameter => parameter.Id));
  const required = manifest.riggingTargets.requiredExpressions;
  const runtimeExpressions = runtimeModel.FileReferences.Expressions;

  assert.ok([
    'cubism_native_expressions_validated',
    'athena_app_integration_validated',
  ].includes(manifest.status));
  assert.equal(manifest.production.expressionsReady, true);
  assert.equal(manifest.production.expressionCount, 11);
  assert.deepEqual(runtimeExpressions.map(item => item.Name), required);
  assert.deepEqual(sourceModel.FileReferences.Expressions, runtimeExpressions);
  for (const expression of runtimeExpressions) {
    const document = readJson(path.join(MODEL_ROOT, expression.File));
    assert.equal(document.Type, 'Live2D Expression');
    assert.ok(document.FadeInTime > 0);
    assert.ok(document.FadeOutTime > 0);
    for (const parameter of document.Parameters) {
      assert.ok(parameterIds.has(parameter.Id), `${expression.Name} references missing parameter ${parameter.Id}`);
      assert.ok(['Add', 'Multiply', 'Overwrite'].includes(parameter.Blend));
      assert.ok(Number.isFinite(parameter.Value));
    }
  }
  assert.ok(runtimeExpressions.find(item => item.Name === 'happy'));
  assert.ok(runtimeExpressions.find(item => item.Name === 'playful'));
  assert.ok(runtimeExpressions.find(item => item.Name === 'worried'));

  const hostSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'avatar', 'live2d', 'BrowserCubismLive2DHost.ts'), 'utf8');
  assert.ok(hostSource.includes('hasNativeExpression'));
  assert.ok(hostSource.includes('await model.expression(expressionId)'));
  assert.ok(hostSource.includes('EXPRESSION_PARAMETERS'), 'procedural intensity fallback must remain available');
  const qa = readJson(path.join(ROOT, 'docs', 'quality', 'live2d-cubism-runtime-qa.json'));
  assert.equal(qa.desktop.nativeExpressions.expressionsChecked, 11);
  assert.equal(qa.desktop.nativeExpressions.runtimeWarnings, 0);
  assert.equal(qa.desktop.nativeExpressions.passed, true);

  console.log(`ATHENA_LIVE2D_EXPRESSIONS_OK expressions=${runtimeExpressions.length} parameters=${parameterIds.size} native=preferred procedural=fallback`);
}

main();
