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

verifyScheduler();

// setTimeout saturates above ~24.86 days and fires immediately, so a longer
// reminder must re-arm in chunks and re-check its due time before completing.
// Driven by a fake clock and captured timers so no real waiting is needed.
function verifyScheduler() {
  const MAX_TIMER_DELAY_MS = 2_147_483_647;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const realNow = Date.now;
  const pending = [];
  let clock = 1_700_000_000_000;
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay };
    pending.push(timer);
    return timer;
  };
  global.clearTimeout = () => {};
  Date.now = () => clock;

  try {
    const { Scheduler } = require('../dist/engine/Scheduler.js');
    const scheduler = new Scheduler();
    const fired = [];
    const job = scheduler.schedule('长提醒', new Date(clock + THIRTY_DAYS_MS), item => fired.push(item));

    // The first chunk is capped, not the full 30 days.
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].delay, MAX_TIMER_DELAY_MS);

    // Firing that chunk must not complete the job: the due time has not arrived.
    clock += MAX_TIMER_DELAY_MS;
    pending.shift().fn();
    assert.strictEqual(fired.length, 0, 'reminder fired before its due time');
    assert.strictEqual(scheduler.listJobs()[0].status, 'scheduled');

    // It re-armed for the remainder instead.
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].delay, THIRTY_DAYS_MS - MAX_TIMER_DELAY_MS);

    // Once the real due time is reached it completes exactly once.
    clock += THIRTY_DAYS_MS - MAX_TIMER_DELAY_MS;
    pending.shift().fn();
    assert.strictEqual(fired.length, 1);
    assert.strictEqual(fired[0].id, job.id);
    assert.strictEqual(scheduler.listJobs()[0].status, 'completed');

    // Short reminders still arm against their exact delay.
    const shortScheduler = new Scheduler();
    const shortFired = [];
    shortScheduler.schedule('短提醒', new Date(clock + 1_000), item => shortFired.push(item));
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].delay, 1_000);
    clock += 1_000;
    pending.shift().fn();
    assert.strictEqual(shortFired.length, 1);

    // A cancelled job stays cancelled even if its armed chunk still fires.
    const cancelScheduler = new Scheduler();
    const cancelFired = [];
    const cancelled = cancelScheduler.schedule('取消', new Date(clock + THIRTY_DAYS_MS), item => cancelFired.push(item));
    assert.strictEqual(cancelScheduler.cancel(cancelled.id), true);
    clock += THIRTY_DAYS_MS;
    for (const timer of pending.splice(0)) timer.fn();
    assert.strictEqual(cancelFired.length, 0);
    assert.strictEqual(cancelScheduler.listJobs()[0].status, 'cancelled');
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    Date.now = realNow;
  }
}

const productMatrix = fs.readFileSync(path.join(__dirname, '../docs/PRODUCT_MATRIX.md'), 'utf8');
assert.match(productMatrix, /Skills 生命周期 \| 骨架 \| Excluded 首发/);
assert.match(productMatrix, /第三方插件市场 \| 未实现 \| Excluded/);
assert.doesNotMatch(productMatrix, /完整工作流[^\n]*GA/);
console.log('ATHENA_WINDOW05_ARCH_OK');
