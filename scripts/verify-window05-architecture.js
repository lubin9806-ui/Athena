const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkflowManager } = require('../dist/core/workflow/WorkflowManager.js');

const manager = new WorkflowManager();
assert.strictEqual(manager.listWorkflows().length, 4);
let run = manager.startWorkflow('coding');
assert(run && /第 1\/4 步/.test(run.message));
for (let index = 0; index < 3; index += 1) run = manager.advanceWorkflow();
assert(run && /第 4\/4 步/.test(run.message));
run = manager.advanceWorkflow();
assert.strictEqual(run.completed, true);
assert.strictEqual(manager.getActiveWorkflow(), undefined);

const productMatrix = fs.readFileSync(path.join(__dirname, '../docs/PRODUCT_MATRIX.md'), 'utf8');
assert.match(productMatrix, /Skills 生命周期 \| 骨架 \| Excluded 首发/);
assert.match(productMatrix, /第三方插件市场 \| 未实现 \| Excluded/);
assert.doesNotMatch(productMatrix, /完整工作流[^\n]*GA/);
console.log('ATHENA_WINDOW05_ARCH_OK');
