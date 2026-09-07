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
  const calls = [];
  const gate = { enabled: true, saveHistory: true, ...overrides.gate };
  const engine = new InitiativeEngine({
    client: {
      decide: async (input) => {
        calls.push(input);
        if (overrides.reject) throw overrides.reject();
        return overrides.reply ?? JSON.stringify({ action: 'wait', nextCheckMinutes: 30, reason: 'quiet' });
      },
    },
    isForegroundBusy: overrides.isForegroundBusy,
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
  return { engine, spoken, gate, calls };
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

  // --- Not competing with the user, and not holding a slot forever (ATH-PERF-001) ---

  // A wake is never urgent. If the user is waiting on a reply, it must cost nothing
  // at all - no call, no budget - and look again shortly.
  resetJobs();
  const busy = buildEngine({
    isForegroundBusy: () => true,
    reply: JSON.stringify({ action: 'speak', nextCheckMinutes: 30, reason: 'x', message: '在忙什么' }),
  });
  const busyResult = await busy.engine.wake();
  assert.deepEqual(busy.calls, [], 'a wake must not call the model while a foreground request is in flight');
  assert.equal(busyResult.spoke, false);
  assert.deepEqual(busy.spoken, []);
  assert(busyResult.issues.includes('deferred:foreground-busy'));
  assert.equal(pendingInitiativeJobs().length, 1, 'a deferred wake still schedules the next look');
  assert(busyResult.nextCheckMinutes > 0 && busyResult.nextCheckMinutes <= 5, 'a deferred wake looks again soon, not in half an hour');

  // The same engine proceeds normally once the foreground is clear.
  resetJobs();
  let foregroundBusy = true;
  const clearing = buildEngine({ isForegroundBusy: () => foregroundBusy });
  await clearing.engine.wake();
  assert.equal(clearing.calls.length, 0);
  foregroundBusy = false;
  await clearing.engine.wake();
  assert.equal(clearing.calls.length, 1, 'the wake proceeds once nothing is in flight');

  // The decision is given its own deadline rather than inheriting the adapter's.
  resetJobs();
  const budgeted = buildEngine();
  await budgeted.engine.wake();
  assert.equal(budgeted.calls.length, 1);
  const passedSignal = budgeted.calls[0].signal;
  assert(passedSignal instanceof AbortSignal, 'the decision must carry an abort signal');
  assert.equal(passedSignal.aborted, false, 'the signal must not already be spent');

  // A decision that runs past its deadline is reported as a timeout, and the loop
  // survives it exactly as it survives an outright failure.
  resetJobs();
  const timedOut = buildEngine({
    reject: () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
  });
  const timeoutResult = await timedOut.engine.wake();
  assert.equal(timeoutResult.action, 'wait');
  assert(timeoutResult.issues.includes('decision-timeout'), `expected a timeout issue, got ${timeoutResult.issues.join('|')}`);
  assert.deepEqual(timedOut.spoken, []);
  assert.equal(pendingInitiativeJobs().length, 1, 'a timed-out decision must still schedule the next wake');

  // One wake is one call. A retry loop here would multiply background cost silently.
  resetJobs();
  const counted = buildEngine();
  await counted.engine.wake();
  assert.equal(counted.calls.length, 1, 'a wake makes exactly one model call');

  // Stopping cancels what is outstanding.
  resetJobs();
  const stopping = buildEngine();
  stopping.engine.start();
  assert.equal(pendingInitiativeJobs().length, 1);
  stopping.engine.stop();
  assert.equal(pendingInitiativeJobs().length, 0, 'stop must cancel the outstanding wake');

  // --- Per-stage timing, so a serial pile-up is visible (ATH-PERF-001) ---

  const { TurnProfile, isAbort } = require(path.join(root, 'dist', 'core', 'runtime', 'TurnProfile.js'));

  let fakeClock = 1_000;
  const profile = new TurnProfile(() => fakeClock);
  await profile.measure('routing', async () => { fakeClock += 40; return 'rules'; }, value => value);
  profile.record('creative', 0, 'skipped');
  await profile.measure('reply', async () => { fakeClock += 3_200; return 'done'; });
  assert.deepEqual(profile.list(), [
    { name: 'routing', ms: 40, outcome: 'rules' },
    { name: 'creative', ms: 0, outcome: 'skipped' },
    { name: 'reply', ms: 3200, outcome: 'ok' },
  ]);
  assert.equal(profile.callCount(), 2, 'a skipped stage is not a call');
  assert.equal(profile.totalMs(), 3240);
  assert.equal(profile.format(), 'total=3240ms routing=40ms/rules creative=0ms/skipped reply=3200ms/ok');

  // A stage that overruns is recorded as a timeout rather than a generic failure,
  // which is the difference between "the provider is slow" and "we gave up".
  const failing2 = new TurnProfile(() => fakeClock);
  await assert.rejects(() => failing2.measure('creative', async () => {
    fakeClock += 6_000;
    throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  }));
  assert.deepEqual(failing2.list(), [{ name: 'creative', ms: 6000, outcome: 'timeout' }]);
  const failing3 = new TurnProfile(() => fakeClock);
  await assert.rejects(() => failing3.measure('creative', async () => { throw new Error('500 from provider'); }));
  assert.equal(failing3.list()[0].outcome, 'failed');

  assert.equal(isAbort(Object.assign(new Error('x'), { name: 'AbortError' })), true);
  assert.equal(isAbort(Object.assign(new Error('x'), { name: 'TimeoutError' })), true);
  assert.equal(isAbort(new Error('ordinary')), false);
  assert.equal(isAbort(null), false);
  assert.equal(isAbort('AbortError'), false);

  // --- Which messages may reach the extraction at all (ATH-PERF-001) ---

  const { isCreativeCandidate, countVisualTerms } = require(path.join(root, 'dist', 'core', 'creative', 'index.js'));

  // The reported case: a long visual brief pasted into ordinary conversation.
  const visualBrief = '她坐在靠窗的位置，画面整体偏暖，逆光穿过发丝，浅景深把背景虚化开，'
    + '服装是低饱和的燕麦色针织衫，构图留白偏右，质感要真实的皮肤肌理，超写实摄影风格。';
  assert.equal(isCreativeCandidate(visualBrief), true);
  assert(countVisualTerms(visualBrief) >= 3);

  // An outright request needs no corroboration, however short.
  for (const request of ['画一张雪山日出', '生成一张图', '再来一张', '帮我出张图', 'draw me a picture of a cat', '重新画一下']) {
    assert.equal(isCreativeCandidate(request), true, `an image request must qualify: ${request}`);
  }

  // What must NOT reach the extraction: long, but not about a picture. This is the
  // case that was paying for a model call in series ahead of its own answer.
  const longDiscussion = '我最近在想我们那个项目的架构问题，数据库这块儿如果继续用现在的方案，'
    + '迁移的时候会很麻烦，因为每次改表结构都要手写一遍迁移脚本，而且回滚路径也没有测过。'
    + '我倾向于先把迁移做成可重放的，然后再考虑要不要换 ORM。你觉得这个顺序合理吗，还是说'
    + '应该先把测试补齐再动迁移？另外部署脚本那边也有类似的问题，配置是散在好几个地方的，'
    + '有一份在仓库里，有一份在环境变量里，还有一份是打包的时候生成的，每次排查问题都要'
    + '先花十几分钟确认到底哪一份生效了。我想的是把它们合并成一个来源，然后其余的都从那里'
    + '派生出来，这样至少出问题的时候只有一个地方要看。不过这么改的话，现有的部署流程要跟着'
    + '动，可能得分两步走，先加新的来源并让旧的继续可用，等确认没问题了再把旧的删掉。';
  assert(longDiscussion.length > 300, 'the fixture must be long enough to have passed the old gate');
  assert.equal(isCreativeCandidate(longDiscussion), false, 'a long technical discussion must not trigger creative extraction');

  for (const ordinary of ['', '   ', '今天怎么样', '帮我看看这段代码为什么报错，栈里说是空指针']) {
    assert.equal(isCreativeCandidate(ordinary), false, `must not qualify: ${JSON.stringify(ordinary)}`);
  }
  assert.doesNotThrow(() => isCreativeCandidate(undefined));
  assert.doesNotThrow(() => isCreativeCandidate(null));

  globalScheduler.shutdown();
  console.log(`ATHENA_INITIATIVE_OK bounds=${minMinutes}-${maxMinutes}m default=${defaultMinutes}m quiet=${bounds.quietHoursStart}-${bounds.quietHoursEnd} maxPerDay=${bounds.maxMessagesPerDay} defersToForeground=yes stageTiming=yes`);
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
