const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'scripts', 'fixtures', 'memory-recall-cases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-memory-recall-evals-'));
process.env.ATHENA_DB_DIR = scratch;
process.env.ATHENA_DB_FILENAME = 'memory-recall-evals.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));

function retrieveForFreshWindow(projectId, query) {
  const current = memory.createChatWindow({ title: `Eval: ${query.slice(0, 30)}`, projectId, mode: 'reason' });
  memory.saveChatMessage(current.id, 'user', query, undefined, 'reason');
  const retrieved = memory.retrieveContext({
    query,
    chatWindowId: current.id,
    recentMessageCount: 2,
    maxProfileFacts: 0,
    maxProceduralMemories: 0,
    maxTemporalFacts: 0,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    maxDocumentChunks: 0,
  });
  memory.deleteChatWindow(current.id);
  return retrieved;
}

let exitCode = 0;
try {
  assert.equal(fixture.schemaVersion, 1);
  assert(Array.isArray(fixture.topics) && fixture.topics.length >= 4);
  assert(Array.isArray(fixture.cases) && fixture.cases.length >= fixture.thresholds.minimumCases);
  assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length, 'recall eval case ids must be unique');

  const project = memory.createProject({ title: 'Recall eval Project' });
  const topicWindows = new Map();
  for (const topic of fixture.topics) {
    const window = memory.createChatWindow({ title: topic.title, projectId: project.id, mode: 'reason' });
    topic.messages.forEach((content, index) => {
      memory.saveChatMessage(window.id, index % 2 === 0 ? 'user' : 'assistant', content, undefined, 'reason');
    });
    topicWindows.set(topic.id, window.id);
  }

  const results = [];
  for (const testCase of fixture.cases) {
    const first = retrieveForFreshWindow(project.id, testCase.query);
    const second = retrieveForFreshWindow(project.id, testCase.query);
    assert.equal(second.previousChatWindow?.id, first.previousChatWindow?.id, `${testCase.id} must be deterministic`);
    const expectedWindowId = topicWindows.get(testCase.expectedTopic);
    results.push({
      id: testCase.id,
      category: testCase.category,
      expectedTopic: testCase.expectedTopic,
      expectedWindowId,
      actualWindowId: first.previousChatWindow?.id,
      strategy: first.previousChatWindow?.matchStrategy,
      matchedTerms: first.previousChatWindow?.matchedTerms || [],
      correct: first.previousChatWindow?.id === expectedWindowId,
    });
  }

  const byCategory = category => results.filter(item => item.category === category);
  const accuracy = category => {
    const items = byCategory(category);
    return items.length === 0 ? 1 : items.filter(item => item.correct).length / items.length;
  };
  const keywordAccuracy = accuracy('keyword');
  const paraphraseAccuracy = accuracy('paraphrase');
  const fallbackAccuracy = accuracy('fallback');

  assert.equal(keywordAccuracy, fixture.thresholds.keywordAccuracy, `keyword recall failures:\n${JSON.stringify(byCategory('keyword').filter(item => !item.correct), null, 2)}`);
  assert.equal(fallbackAccuracy, fixture.thresholds.fallbackAccuracy, `fallback recall failures:\n${JSON.stringify(byCategory('fallback').filter(item => !item.correct), null, 2)}`);

  const falsePositiveTriggers = fixture.negativeTriggers.filter(query => memory.requestsPreviousChatHandoff(query, 1));
  assert(falsePositiveTriggers.length <= fixture.thresholds.maximumFalsePositiveTriggers, `false positive handoff triggers: ${falsePositiveTriggers.join(' | ')}`);

  const otherProject = memory.createProject({ title: 'Isolation distractors' });
  const isolated = memory.createChatWindow({ title: '财务报表秘密', projectId: otherProject.id });
  memory.saveChatMessage(isolated.id, 'user', '财务报表秘密项目的季度现金流。');
  const isolationResult = retrieveForFreshWindow(project.id, '继续上次财务报表秘密的话题');
  assert.notEqual(isolationResult.previousChatWindow?.id, isolated.id, 'topic matching must not cross Project boundaries');

  const archived = memory.createChatWindow({ title: 'Archived secret garden', projectId: project.id });
  memory.saveChatMessage(archived.id, 'user', '秘密花园归档内容。');
  memory.archiveChatWindow(archived.id, true);
  const temporary = memory.createTemporaryChatWindow({ title: 'Temporary secret garden', projectId: project.id });
  memory.saveChatMessage(temporary.id, 'user', '秘密花园临时内容。');
  const boundaryResult = retrieveForFreshWindow(project.id, '继续上次秘密花园的话题');
  assert.notEqual(boundaryResult.previousChatWindow?.id, archived.id);
  assert.notEqual(boundaryResult.previousChatWindow?.id, temporary.id);

  const semanticGap = paraphraseAccuracy < fixture.thresholds.semanticUpgradeTarget;
  const failedParaphrases = byCategory('paraphrase').filter(item => !item.correct).map(item => item.id);
  memory.setMemoryVectorProvider({
    id: 'recall-eval-semantic-provider',
    dimensions: 6,
    vectorize(text) {
      const normalized = text.toLowerCase();
      const vector = [0, 0, 0, 0, 0, 0];
      if (/长期记忆|跨会话|偏好记忆/.test(normalized)) vector[0] = 1;
      if (/live2d|口型同步|音素|嘴部动作/.test(normalized)) vector[1] = 1;
      if (/whisper|语音转文字|麦克风|听写/.test(normalized)) vector[2] = 1;
      if (/temporary chat|长期存储|无痕会话|不落盘/.test(normalized)) vector[3] = 1;
      if (/authenticode|代码签名|发布证书/.test(normalized)) vector[4] = 1;
      if (/athenian daylight|侧边栏布局|日光主题/.test(normalized)) vector[5] = 1;
      return vector.some(value => value > 0) ? vector : null;
    },
  });
  const indexed = memory.rebuildMemoryIndex();
  assert.equal(indexed.chat_windows, fixture.topics.length + 1, 'only persistent, non-archived windows should enter the semantic index');
  for (const windowId of topicWindows.values()) {
    assert(
      memory.getDatabase().prepare("SELECT 1 FROM memory_index WHERE source_table = 'chat_windows' AND source_id = ?").get(windowId),
      `chat window #${windowId} must have a semantic index row`,
    );
  }
  assert.equal(memory.getDatabase().prepare("SELECT 1 FROM memory_index WHERE source_table = 'chat_windows' AND source_id = ?").get(archived.id), undefined);
  assert.equal(memory.getDatabase().prepare("SELECT 1 FROM memory_index WHERE source_table = 'chat_windows' AND source_id = ?").get(temporary.id), undefined);
  const semanticResults = byCategory('paraphrase').map(testCase => {
    const sourceCase = fixture.cases.find(item => item.id === testCase.id);
    const retrieved = retrieveForFreshWindow(project.id, sourceCase.query);
    return {
      id: testCase.id,
      correct: retrieved.previousChatWindow?.id === testCase.expectedWindowId,
      strategy: retrieved.previousChatWindow?.matchStrategy,
      expectedWindowId: testCase.expectedWindowId,
      actualWindowId: retrieved.previousChatWindow?.id,
      matchedTerms: retrieved.previousChatWindow?.matchedTerms || [],
    };
  });
  const providerParaphraseAccuracy = semanticResults.filter(item => item.correct).length / semanticResults.length;
  assert(providerParaphraseAccuracy >= fixture.thresholds.semanticUpgradeTarget, `semantic provider recall failures:\n${JSON.stringify(semanticResults.filter(item => !item.correct), null, 2)}`);
  assert(semanticResults.some(item => item.strategy === 'semantic'), 'paraphrase evals must exercise the semantic handoff path');
  memory.setMemoryVectorProvider(null);
  assert.equal(memory.getMemoryVectorProviderId(), 'local-hash-ngram');

  console.log(`ATHENA_MEMORY_RECALL_EVAL_OK cases=${results.length} keywordAccuracy=${keywordAccuracy.toFixed(3)} paraphraseAccuracy=${paraphraseAccuracy.toFixed(3)} providerParaphraseAccuracy=${providerParaphraseAccuracy.toFixed(3)} fallbackAccuracy=${fallbackAccuracy.toFixed(3)} falsePositiveTriggers=${falsePositiveTriggers.length} projectIsolation=pass temporaryArchiveBoundary=pass semanticGap=${semanticGap} failedParaphrases=${failedParaphrases.join(',') || 'none'}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(exitCode);
}
