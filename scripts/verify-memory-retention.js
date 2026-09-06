const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-memory-retention-'));
process.env.ATHENA_DB_DIR = tempDir;
process.env.ATHENA_DB_FILENAME = 'memory-retention-test.db';

function dateKeyFromAge(now, ageDays) {
  const start = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(start - ageDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addEvent(db, now, ageDays, importance, marker) {
  const date = dateKeyFromAge(now, ageDays);
  const result = db.prepare(`
    INSERT INTO events (date, summary, detail, tags, importance)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, `${marker} summary`, `${marker} detail`, JSON.stringify([marker]), importance);
  return { id: result.lastInsertRowid, date, marker };
}

async function run() {
let exitCode = 0;
try {
  const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
  const now = new Date('2026-08-10T12:00:00.000Z');
  const db = memory.getDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 17, 'memory schema should match the current attachment-capable schema');

  const cases = [
    addEvent(db, now, 100, 2, 'fresh-low-kept'),
    addEvent(db, now, 400, 4, 'decay5-low-pruned'),
    addEvent(db, now, 400, 5, 'decay5-kept'),
    addEvent(db, now, 500, 5, 'decay6-low-pruned'),
    addEvent(db, now, 500, 6, 'decay6-kept'),
    addEvent(db, now, 600, 6, 'decay7-low-pruned'),
    addEvent(db, now, 600, 7, 'decay7-kept'),
    addEvent(db, now, 700, 7, 'decay8-low-pruned'),
    addEvent(db, now, 700, 8, 'decay8-kept'),
    addEvent(db, now, 731, 10, 'expired-pruned'),
  ];

  for (const item of cases) {
    const summary = memory.summarizeDailyMemory(item.date, { now, force: true });
    assert(summary, `daily summary should be generated for ${item.marker}`);
  }

  const retention = memory.applyMemoryRetentionPolicy(now);
  assert.equal(retention.rawEventsPruned, 5, 'decay should prune gradually by age and importance');

  const remaining = new Set(db.prepare('SELECT summary FROM events').all().map(row => row.summary));
  for (const marker of ['fresh-low-kept', 'decay5-kept', 'decay6-kept', 'decay7-kept', 'decay8-kept']) {
    assert(remaining.has(`${marker} summary`), `${marker} should remain as raw event memory`);
  }
  for (const marker of ['decay5-low-pruned', 'decay6-low-pruned', 'decay7-low-pruned', 'decay8-low-pruned', 'expired-pruned']) {
    assert(!remaining.has(`${marker} summary`), `${marker} should be pruned after summary exists`);
  }

  assert.equal(memory.minimumRawImportanceForAgeDays(400), 5);
  assert.equal(memory.minimumRawImportanceForAgeDays(500), 6);
  assert.equal(memory.minimumRawImportanceForAgeDays(600), 7);
  assert.equal(memory.minimumRawImportanceForAgeDays(700), 8);
  assert.equal(memory.isRawEventRetrievable(dateKeyFromAge(now, 731), 10, now), false);

  const dailyWithinHorizon = memory.searchDailyMemorySummaries('decay8-kept', 10, now);
  assert(dailyWithinHorizon.some(item => item.summary.includes('decay8-kept')), 'daily summaries should remain searchable inside 730 days');
  const dailyExpired = memory.searchDailyMemorySummaries('expired-pruned', 10, now);
  assert.equal(dailyExpired.length, 0, 'daily summaries past 730 days should not be retrieved');

  const yesterday = dateKeyFromAge(now, 1);
  db.prepare(`
    INSERT INTO messages (role, content, created_at)
    VALUES ('user', 'yesterday planning marker', ?)
  `).run(`${yesterday}T09:00:00.000Z`);
  const generated = memory.generateDueDailyMemorySummaries(now, 1);
  assert.equal(generated, 1, 'yesterday should be summarized on the next day');
  assert(memory.getDailyMemorySummary(yesterday)?.summary.includes('yesterday planning marker'));
  assert.equal(memory.getDailyMemorySummary(yesterday)?.summary_method, 'heuristic', 'default daily summary should be heuristic');

  const refinedYesterday = await memory.summarizeDailyMemoryWithRefiner(yesterday, async input => ({
    summary: `LLM refined summary for ${input.date}: yesterday planning marker retained.`,
    highlights: ['LLM refined planning marker'],
    importance: 9,
  }), { now, force: true });
  assert.equal(refinedYesterday.summary_method, 'llm-refined', 'LLM refined daily summary should be marked');
  assert(refinedYesterday.summary.includes('LLM refined summary'), 'LLM refined daily summary should replace heuristic text');

  const twoDaysAgo = dateKeyFromAge(now, 2);
  db.prepare(`
    INSERT INTO messages (role, content, created_at)
    VALUES ('user', 'two day semantic memory review marker', ?)
  `).run(`${twoDaysAgo}T09:00:00.000Z`);
  const refinedDue = await memory.generateDueDailyMemorySummariesWithRefiner(async input => ({
    summary: `Refined due daily memory for ${input.date}: ${input.highlights.join(' ')}`,
    highlights: ['two day refined marker'],
    importance: 7,
  }), now, 2);
  assert.equal(refinedDue.generated, 1, 'LLM-assisted due summarizer should create missing previous-day summaries');
  assert(refinedDue.llmRefined >= 1, 'LLM-assisted due summarizer should count refined summaries');

  const procedure = memory.upsertProceduralMemory({
    scope: 'global',
    key: 'testing preference',
    instruction: 'When the user says test, run the focused regression suite and report exact markers.',
    evidence: 'User repeatedly asks for direct validation proof.',
    confidence: 0.9,
    importance: 8,
  });
  assert(procedure.id > 0, 'procedural memory should be stored');

  const temporal = memory.addTemporalMemoryFact({
    subject: 'Athena memory system',
    predicate: 'current architecture',
    object: 'daily summaries plus procedural and temporal memory',
    summary: 'Athena memory system uses daily summaries, procedural memories, and temporal facts.',
    confidence: 0.86,
    importance: 8,
    validFrom: now.toISOString(),
    sourceTable: 'manual-test',
    sourceQuote: 'architecture verification',
  });
  assert(temporal.id > 0, 'temporal fact should be stored');

  memory.rebuildMemoryIndex();
  const vectorRow = db.prepare("SELECT semantic_vector FROM memory_index WHERE source_table = 'procedural_memories' AND source_id = ?").get(procedure.id);
  assert(vectorRow && JSON.parse(vectorRow.semantic_vector).some(value => value > 0), 'memory index should store local semantic vectors');
  const longChineseQuery = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光量子火箭';
  assert(memory.extractKeywords(longChineseQuery).some(keyword => /量子|火箭/.test(keyword)), 'long Chinese queries must retain tail keywords');
  assert(memory.extractIndexKeywords(longChineseQuery).some(keyword => /量子|火箭/.test(keyword)), 'long Chinese memory entries must index tail keywords');

  const indexBeforeFailedRebuild = db.prepare('SELECT source_table, source_id, keywords FROM memory_index ORDER BY source_table, source_id').all();
  db.exec(`
    CREATE TEMP TRIGGER fail_memory_index_rebuild
    BEFORE INSERT ON memory_index
    WHEN NEW.source_table = 'events'
    BEGIN
      SELECT RAISE(ABORT, 'forced index rebuild failure');
    END;
  `);
  assert.throws(() => memory.rebuildMemoryIndex(), /forced index rebuild failure/);
  db.exec('DROP TRIGGER fail_memory_index_rebuild');
  const indexAfterFailedRebuild = db.prepare('SELECT source_table, source_id, keywords FROM memory_index ORDER BY source_table, source_id').all();
  assert.deepEqual(indexAfterFailedRebuild, indexBeforeFailedRebuild, 'failed index rebuild must roll back atomically');
  memory.setMemoryVectorProvider({
    id: 'test-local-vector',
    dimensions: 4,
    vectorize(text) {
      return /provider-indexed|provider-query/.test(text) ? [1, 0, 0, 0] : null;
    },
  });
  assert.equal(memory.getMemoryVectorProviderId(), 'test-local-vector', 'local vector provider should be replaceable');
  const providerProcedure = memory.upsertProceduralMemory({
    scope: 'global',
    key: 'provider vector seam',
    instruction: 'provider-indexed stores a semantic vector without query keyword overlap.',
    evidence: 'retention verifier',
    confidence: 0.9,
    importance: 8,
  });
  assert(
    memory.searchMemoryIndex('procedural_memories', 'provider-query', 10).includes(providerProcedure.id),
    'provider vector search should retrieve semantically matched memories without keyword overlap',
  );
  memory.setMemoryVectorProvider(null);
  assert.equal(memory.getMemoryVectorProviderId(), 'local-hash-ngram', 'vector provider should reset to local fallback');
  const context = memory.retrieveContext({
    query: 'memory system test architecture',
    maxProfileFacts: 0,
    maxProceduralMemories: 8,
    maxTemporalFacts: 8,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    recentMessageCount: 0,
  });
  assert(context.proceduralMemories.some(item => item.key === 'testing preference'), 'procedural memories should be retrievable');
  assert(context.temporalFacts.some(item => item.subject === 'Athena memory system'), 'temporal facts should be retrievable');
  assert(context.evidence.some(item => item.memoryTable === 'memory_facts' && item.memoryId === temporal.id && item.origin === 'fact_source' && item.sourceTable === 'manual-test'), 'temporal fact provenance should be normalized into retrieval evidence');
  const semanticDaily = memory.searchDailyMemorySummaries('语义记忆系统', 10, now);
  assert(Array.isArray(semanticDaily), 'semantic daily summary search should return an array');

  const extracted = memory.extractMemoryFromUserMessage('以后你要优先给我明确的下一步。当前测试目标是记忆审核队列');
  const queuedExtracted = memory.queueExtractedMemory(extracted, { minImportance: 5 });
  assert(queuedExtracted.queued >= 1, 'auto-extracted procedural or temporal memory should be queued for review');

  const reviewRule = memory.enqueueMemoryReviewCandidate({
    kind: 'procedure',
    title: 'global / review approved rule',
    content: 'When review approval is tested, write the rule only after approval.',
    payload: {
      scope: 'global',
      key: 'review approved rule',
      instruction: 'When review approval is tested, write the rule only after approval.',
      evidence: 'retention verifier',
      confidence: 0.9,
      importance: 8,
    },
    reason: 'test review approval',
    confidence: 0.9,
    importance: 8,
  });
  assert.equal(reviewRule.status, 'pending', 'manual review candidate should start pending');
  const duplicateReviewRule = memory.enqueueMemoryReviewCandidate({
    kind: 'procedure',
    title: 'global / review approved rule',
    content: 'When review approval is tested, write the rule only after approval.',
    payload: {
      scope: 'global',
      key: 'review approved rule',
      instruction: 'When review approval is tested, write the rule only after approval.',
      evidence: 'retention verifier',
      confidence: 0.9,
      importance: 8,
    },
    reason: 'test review approval duplicate',
    confidence: 0.8,
    importance: 7,
  });
  assert.equal(duplicateReviewRule.id, reviewRule.id, 'duplicate pending review candidates should merge by group key');
  assert.equal(
    memory.retrieveContext({
      query: 'review approved rule',
      maxProfileFacts: 0,
      maxProceduralMemories: 8,
      maxTemporalFacts: 0,
      maxEvents: 0,
      maxDailySummaries: 0,
      maxProjectNotes: 0,
      recentMessageCount: 0,
    }).proceduralMemories.some(item => item.key === 'review approved rule'),
    false,
    'pending review candidates should not be retrievable',
  );
  const approvedRule = memory.approveMemoryReviewItem(reviewRule.id);
  assert.equal(approvedRule.status, 'applied', 'approved review candidate should be marked applied');
  assert(
    memory.retrieveContext({
      query: 'review approved rule',
      maxProfileFacts: 0,
      maxProceduralMemories: 8,
      maxTemporalFacts: 0,
      maxEvents: 0,
      maxDailySummaries: 0,
      maxProjectNotes: 0,
      recentMessageCount: 0,
    }).proceduralMemories.some(item => item.key === 'review approved rule'),
    'approved procedural memory should be retrievable',
  );

  const bulkRule = memory.enqueueMemoryReviewCandidate({
    kind: 'procedure',
    title: 'global / bulk approved rule',
    content: 'When bulk review approval is tested, approve through the batch API.',
    payload: {
      scope: 'global',
      key: 'bulk approved rule',
      instruction: 'When bulk review approval is tested, approve through the batch API.',
      evidence: 'retention verifier',
      confidence: 0.9,
      importance: 8,
    },
    reason: 'test bulk review approval',
    confidence: 0.9,
    importance: 8,
  });
  assert.equal(memory.approveMemoryReviewItems([bulkRule.id])[0].status, 'applied', 'bulk approval should apply pending candidates');

  const rejectedFact = memory.rejectMemoryReviewItem(memory.enqueueMemoryReviewCandidate({
    kind: 'fact',
    title: 'Rejected subject / current_state',
    content: 'Rejected subject current_state rejected object',
    payload: {
      subject: 'Rejected subject',
      predicate: 'current_state',
      object: 'rejected object',
      summary: 'Rejected subject current_state rejected object',
      confidence: 0.8,
      importance: 8,
    },
    reason: 'test review rejection',
    confidence: 0.8,
    importance: 8,
  }).id);
  assert.equal(rejectedFact.status, 'rejected', 'rejected review candidate should be marked rejected');
  assert.equal(db.prepare("SELECT COUNT(*) as c FROM memory_facts WHERE subject = 'Rejected subject'").get().c, 0, 'rejected fact should not be written');

  const bulkRejectedFact = memory.enqueueMemoryReviewCandidate({
    kind: 'fact',
    title: 'Bulk rejected subject / current_state',
    content: 'Bulk rejected subject current_state rejected object',
    payload: {
      subject: 'Bulk rejected subject',
      predicate: 'current_state',
      object: 'rejected object',
      summary: 'Bulk rejected subject current_state rejected object',
      confidence: 0.8,
      importance: 8,
    },
    reason: 'test bulk review rejection',
    confidence: 0.8,
    importance: 8,
  });
  assert.equal(memory.rejectMemoryReviewItems([bulkRejectedFact.id])[0].status, 'rejected', 'bulk rejection should reject pending candidates');

  memory.closeDatabase();
  console.log('ATHENA_MEMORY_RETENTION_OK');
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  try {
    const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
    memory.closeDatabase();
  } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(exitCode);
}
}

run();
