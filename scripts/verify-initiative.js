const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-initiative-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'initiative.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const {
  parseInitiativeIntent,
  clampInitiativeMinutes,
  blockedReason,
  isQuietHour,
  nextAllowedWake,
  DEFAULT_INITIATIVE_POLICY,
} = require(path.join(root, 'dist', 'core', 'initiative', 'index.js'));

const bounds = DEFAULT_INITIATIVE_POLICY;
const { minMinutes, maxMinutes, defaultMinutes } = bounds;

function parse(raw) {
  return parseInitiativeIntent(raw, bounds);
}

// A clean decision survives untouched.
const wait = parse(JSON.stringify({ action: 'wait', nextCheckMinutes: 27, reason: 'user said they would be back' }));
assert.deepEqual(wait.issues, []);
assert.equal(wait.intent.action, 'wait');
assert.equal(wait.intent.nextCheckMinutes, 27);
assert.equal(wait.intent.message, undefined);

const speak = parse(JSON.stringify({ action: 'speak', nextCheckMinutes: 60, reason: 'still working late', message: '还在弄那个作业？' }));
assert.deepEqual(speak.issues, []);
assert.equal(speak.intent.action, 'speak');
assert.equal(speak.intent.message, '还在弄那个作业？');

// A speak decision with nothing to say would produce an empty notification.
const empty = parse(JSON.stringify({ action: 'speak', nextCheckMinutes: 30, reason: 'x', message: '   ' }));
assert.equal(empty.intent.action, 'wait', 'speak without a message must degrade to waiting');
assert(empty.issues.includes('speak-without-message'));

// The shorthand a model naturally writes.
assert.equal(parse('{"action":"wait","nextCheckMinutes":"45m"}').intent.nextCheckMinutes, 45);
assert.equal(parse('{"action":"wait","nextCheckMinutes":"1.5h"}').intent.nextCheckMinutes, 90);
assert.equal(parse('{"action":"wait","next_check":"90 minutes"}').intent.nextCheckMinutes, 90);
assert.equal(parse('{"action":"wait","nextCheck":120}').intent.nextCheckMinutes, 120);

// The schedule is only as trustworthy as the model's arithmetic, so it is clamped.
const tooSoon = parse('{"action":"wait","nextCheckMinutes":0}');
assert.equal(tooSoon.intent.nextCheckMinutes, minMinutes, 'a zero interval must be clamped to the floor');
assert(tooSoon.issues.includes('next-check-clamped'));
const tooLate = parse('{"action":"wait","nextCheckMinutes":"30d"}');
assert.equal(tooLate.intent.nextCheckMinutes, maxMinutes, 'a month-long interval must be clamped to the ceiling');
assert(tooLate.issues.includes('next-check-clamped'));
assert.equal(parse('{"action":"wait","nextCheckMinutes":-5}').intent.nextCheckMinutes, minMinutes);

// Anything unusable falls back to the default rather than stalling the loop.
for (const raw of [
  '',
  '   ',
  'soon',
  'not json at all',
  '{"action":"wait","nextCheckMinutes":"soon"}',
  '{"action":"wait","nextCheckMinutes":null}',
  '{"action":"wait"}',
  '[]',
  '{"action":"wait","nextCheckMinutes":',
]) {
  const result = parse(raw);
  assert.equal(result.intent.action, 'wait', `unusable input must default to waiting: ${JSON.stringify(raw)}`);
  assert.equal(result.intent.nextCheckMinutes, defaultMinutes, `unusable input must use the default interval: ${JSON.stringify(raw)}`);
  assert(result.issues.length > 0, `unusable input must report an issue: ${JSON.stringify(raw)}`);
}

// Never throws, whatever arrives.
for (const hostile of [undefined, null, 0, {}, [], '{"action":{"$":1}}', '{"reason":{"nested":true}}']) {
  assert.doesNotThrow(() => parseInitiativeIntent(hostile, bounds), `hostile input must not throw: ${JSON.stringify(hostile)}`);
}

// Models wrap JSON in prose often enough to be worth recovering.
const fenced = parse('好的，我的判断如下：\n```json\n{"action":"wait","nextCheckMinutes":30,"reason":"quiet"}\n```\n希望有帮助。');
assert.equal(fenced.intent.nextCheckMinutes, 30);
assert(fenced.issues.includes('json-recovered-from-prose'));

// An unknown action is not a licence to act.
const bogus = parse('{"action":"execute","nextCheckMinutes":30}');
assert.equal(bogus.intent.action, 'wait');
assert(bogus.issues.includes('invalid-action'));

assert.equal(clampInitiativeMinutes(Number.NaN, bounds), defaultMinutes);
assert.equal(clampInitiativeMinutes(Number.POSITIVE_INFINITY, bounds), defaultMinutes);

// Gates: each one has to be able to stop Athena speaking.
const awake = new Date('2026-09-06T14:00:00');
assert.equal(blockedReason({ enabled: false, saveHistory: true, messagesSpokenToday: 0, now: awake }), 'disabled');
assert.equal(blockedReason({ enabled: true, saveHistory: false, messagesSpokenToday: 0, now: awake }), 'history-off');
assert.equal(blockedReason({ enabled: true, saveHistory: true, messagesSpokenToday: bounds.maxMessagesPerDay, now: awake }), 'daily-budget');
assert.equal(blockedReason({ enabled: true, saveHistory: true, messagesSpokenToday: 0, now: new Date('2026-09-06T03:00:00') }), 'quiet-hours');
assert.equal(blockedReason({ enabled: true, saveHistory: true, messagesSpokenToday: 0, now: awake }), null);

// The quiet window wraps midnight, so it is two ranges rather than one.
assert.equal(isQuietHour(23), true);
assert.equal(isQuietHour(2), true);
assert.equal(isQuietHour(7), true);
assert.equal(isQuietHour(8), false);
assert.equal(isQuietHour(22), false);

// A wake that would land at night is pushed to the morning instead of firing then.
const intoNight = nextAllowedWake(new Date('2026-09-06T22:30:00'), 120);
assert.equal(isQuietHour(intoNight.getHours()), false, 'a wake must not be scheduled inside the quiet window');
assert.equal(intoNight.getHours(), bounds.quietHoursEnd);
const daytime = nextAllowedWake(new Date('2026-09-06T14:00:00'), 30);
assert.equal(daytime.getHours(), 14);
assert.equal(daytime.getMinutes(), 30);

// --- Engine behaviour, against the real scheduled_jobs table ---

const { InitiativeEngine } = require(path.join(root, 'dist', 'core', 'initiative', 'index.js'));
const { globalScheduler } = require(path.join(root, 'dist', 'engine', 'Scheduler.js'));
const {
  listPendingScheduledJobs,
  getScheduledJob,
} = require(path.join(root, 'dist', 'core', 'scheduler', 'ScheduledJobStore.js'));

function pendingInitiativeJobs() {
  return listPendingScheduledJobs().filter(job => job.kind === 'initiative');
}

function buildEngine(overrides = {}) {
  const spoken = [];
  const gate = { enabled: true, saveHistory: true, ...overrides.gate };
  const engine = new InitiativeEngine({
    client: { decide: async () => overrides.reply ?? JSON.stringify({ action: 'wait', nextCheckMinutes: 30, reason: 'quiet' }) },
    readGate: () => gate,
    readContext: () => ({
      minutesSinceLastUserMessage: 20,
      recentTurns: [{ role: 'user', content: '我去洗澡了' }],
      proactiveMessagesToday: overrides.spokenToday ?? 0,
    }),
    speak: (message) => {
      if (overrides.refuseDelivery) return null;
      spoken.push(message);
      return { chatWindowId: 1 };
    },
    now: overrides.now,
  });
  return { engine, spoken, gate };
}

function resetJobs() {
  globalScheduler.shutdown();
  for (const job of listPendingScheduledJobs()) {
    require(path.join(root, 'dist', 'core', 'scheduler', 'ScheduledJobStore.js')).markScheduledJobCancelled(job.id);
  }
}

async function run() {
  await app.whenReady();

  // Off means nothing is ever armed.
  resetJobs();
  const disabled = buildEngine({ gate: { enabled: false } });
  disabled.engine.start();
  assert.equal(pendingInitiativeJobs().length, 0, 'initiative must arm nothing while it is off');

  // On means exactly one outstanding wake, never a pile of them.
  resetJobs();
  const armed = buildEngine();
  armed.engine.start();
  armed.engine.start();
  assert.equal(pendingInitiativeJobs().length, 1, 'only one wake may be outstanding');

  // A wait decision says nothing and schedules the next look.
  resetJobs();
  const waiting = buildEngine();
  const waitResult = await waiting.engine.wake();
  assert.equal(waitResult.action, 'wait');
  assert.equal(waitResult.spoke, false);
  assert.deepEqual(waiting.spoken, []);
  assert.equal(pendingInitiativeJobs().length, 1, 'a silent wake still schedules the next one');

  // A speak decision delivers once and records the outcome for the daily budget.
  resetJobs();
  const speaking = buildEngine({ reply: JSON.stringify({ action: 'speak', nextCheckMinutes: 40, reason: 'user has been away a while', message: '还没回来吗？' }) });
  speaking.engine.start();
  const firedJobId = pendingInitiativeJobs()[0].id;
  const speakResult = await speaking.engine.wake(firedJobId);
  assert.equal(speakResult.spoke, true);
  assert.deepEqual(speaking.spoken, ['还没回来吗？']);
  assert.equal(getScheduledJob(firedJobId).payload.spoke, true, 'the outcome must be recorded against the job that fired');

  // Chat history off stops the loop rather than merely staying quiet.
  resetJobs();
  const historyOff = buildEngine({ gate: { saveHistory: false }, reply: JSON.stringify({ action: 'speak', nextCheckMinutes: 30, reason: 'x', message: 'hi' }) });
  const historyResult = await historyOff.engine.wake();
  assert.equal(historyResult.blocked, 'history-off');
  assert.deepEqual(historyOff.spoken, [], 'nothing may be said while chat history is off');
  assert.equal(pendingInitiativeJobs().length, 0, 'the loop must not re-arm itself while history is off');

  // The daily budget withholds the message but keeps the loop alive.
  resetJobs();
  const budget = buildEngine({
    spokenToday: bounds.maxMessagesPerDay,
    reply: JSON.stringify({ action: 'speak', nextCheckMinutes: 30, reason: 'x', message: '再说一句' }),
  });
  const budgetResult = await budget.engine.wake();
  assert.equal(budgetResult.blocked, 'daily-budget');
  assert.equal(budgetResult.spoke, false);
  assert.deepEqual(budget.spoken, [], 'the daily budget must be a hard ceiling');
  assert(budgetResult.issues.includes('withheld:daily-budget'));
  assert.equal(pendingInitiativeJobs().length, 1);

  // A failing model must not end the loop.
  resetJobs();
  const failing = new InitiativeEngine({
    client: { decide: async () => { throw new Error('fetch failed: ECONNREFUSED'); } },
    readGate: () => ({ enabled: true, saveHistory: true }),
    readContext: () => ({ minutesSinceLastUserMessage: 10, recentTurns: [], proactiveMessagesToday: 0 }),
    speak: () => ({ chatWindowId: 1 }),
  });
  const failedResult = await failing.wake();
  assert.equal(failedResult.action, 'wait');
  assert(failedResult.issues.some(issue => issue.startsWith('decision-failed:')));
  assert.equal(pendingInitiativeJobs().length, 1, 'a failed decision must still schedule the next wake');

  // A refused delivery is reported rather than counted as spoken.
  resetJobs();
  const refused = buildEngine({
    refuseDelivery: true,
    reply: JSON.stringify({ action: 'speak', nextCheckMinutes: 30, reason: 'x', message: 'hi' }),
  });
  const refusedResult = await refused.engine.wake();
  assert.equal(refusedResult.spoke, false);
  assert(refusedResult.issues.includes('delivery-refused'));

  // A wake that would land at night is pushed past the quiet window.
  resetJobs();
  const late = buildEngine({ now: () => new Date('2026-09-06T22:40:00'), reply: JSON.stringify({ action: 'wait', nextCheckMinutes: 60, reason: 'late' }) });
  await late.engine.wake();
  const nightJob = pendingInitiativeJobs()[0];
  assert.equal(isQuietHour(new Date(nightJob.dueAt).getHours()), false, 'a scheduled wake must never sit inside the quiet window');

  // Stopping cancels what is outstanding.
  resetJobs();
  const stopping = buildEngine();
  stopping.engine.start();
  assert.equal(pendingInitiativeJobs().length, 1);
  stopping.engine.stop();
  assert.equal(pendingInitiativeJobs().length, 0, 'stop must cancel the outstanding wake');

  globalScheduler.shutdown();
  console.log(`ATHENA_INITIATIVE_OK bounds=${minMinutes}-${maxMinutes}m default=${defaultMinutes}m quiet=${bounds.quietHoursStart}-${bounds.quietHoursEnd} maxPerDay=${bounds.maxMessagesPerDay}`);
}

function cleanup(exitCode) {
  try { require(path.join(root, 'dist', 'memory', 'index.js')).closeDatabase(); } catch {}
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  app.exit(exitCode);
}

run()
  .then(() => cleanup(0))
  .catch((error) => {
    console.error(error?.stack || error);
    cleanup(1);
  });
