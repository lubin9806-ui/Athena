const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'memory-recall-cases.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-memory-embeddings-live-'));
process.env.ATHENA_DB_DIR = scratch;
process.env.ATHENA_DB_FILENAME = 'memory-embeddings-live.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { OllamaMemoryEmbeddingProvider } = require(path.join(root, 'dist', 'core', 'ai', 'OllamaMemoryEmbeddingProvider.js'));
const { buildChatPromptWithSnapshot } = require(path.join(root, 'dist', 'core', 'ai', 'PromptBuilder.js'));

const endpoint = (process.env.ATHENA_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const model = (process.env.ATHENA_MEMORY_EMBEDDING_MODEL || 'embeddinggemma').trim();

async function retrieveForFreshWindow(projectId, query, provider) {
  const current = memory.createChatWindow({ title: `Live eval: ${query.slice(0, 30)}`, projectId, mode: 'reason' });
  memory.saveChatMessage(current.id, 'user', query, undefined, 'reason');
  const startedAt = performance.now();
  let embeddingBatch = null;
  const tracedProvider = {
    id: provider.id,
    minimumSimilarity: provider.minimumSimilarity,
    async embed(inputs) {
      const vectors = await provider.embed(inputs);
      embeddingBatch = { inputs, vectors };
      return vectors;
    },
    async embedRetrieval(query, documents) {
      const vectors = await provider.embedRetrieval(query, documents);
      embeddingBatch = { inputs: [query, ...documents.map(document => `${document.title}\n${document.text}`)], vectors };
      return vectors;
    },
  };
  try {
    const retrieved = await memory.retrieveContextWithSemanticHandoff({
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
    }, tracedProvider);
    return { retrieved, elapsedMs: performance.now() - startedAt, embeddingBatch };
  } finally {
    memory.deleteChatWindow(current.id);
  }
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function describeRanking(batch) {
  if (!batch) return 'no-semantic-batch';
  const queryVector = batch.vectors[0];
  return batch.inputs.slice(1).map((input, index) => ({
    label: input.split('\n', 1)[0].replace(/\s+/g, ' ').slice(0, 28),
    score: cosineSimilarity(queryVector, batch.vectors[index + 1]),
  })).sort((left, right) => right.score - left.score).slice(0, 3)
    .map(item => `${item.label}:${item.score.toFixed(4)}`).join(',');
}

async function main() {
  const provider = new OllamaMemoryEmbeddingProvider({ endpoint, model, timeoutMs: 30_000 });
  const status = await provider.status(true);
  assert.equal(status.state, 'ready', `local embedding provider is not ready: ${status.message}`);

  const warmStartedAt = performance.now();
  const warmVectors = await provider.embed(['跨会话偏好记忆', '长期记忆召回与用户偏好']);
  const warmupMs = performance.now() - warmStartedAt;
  assert.equal(warmVectors.length, 2);
  assert(warmVectors[0].length >= 8, 'embedding vector must have a usable dimension');
  assert.equal(warmVectors[0].length, warmVectors[1].length);

  const project = memory.createProject({ title: 'Live embedding recall Project' });
  const topicWindows = new Map();
  for (const topic of fixture.topics) {
    const window = memory.createChatWindow({ title: topic.title, projectId: project.id, mode: 'reason' });
    topic.messages.forEach((content, index) => {
      memory.saveChatMessage(window.id, index % 2 === 0 ? 'user' : 'assistant', content, undefined, 'reason');
    });
    topicWindows.set(topic.id, window.id);
  }

  const paraphrases = fixture.cases.filter(item => item.category === 'paraphrase');
  assert(paraphrases.length > 0, 'live eval requires paraphrase cases');
  const results = [];
  let promptEvidenceVerified = 0;
  for (const testCase of paraphrases) {
    const { retrieved, elapsedMs, embeddingBatch } = await retrieveForFreshWindow(project.id, testCase.query, provider);
    const expectedWindowId = topicWindows.get(testCase.expectedTopic);
    const actualWindowId = retrieved.previousChatWindow?.id;
    const result = {
      id: testCase.id,
      expectedTopic: testCase.expectedTopic,
      correct: actualWindowId === expectedWindowId,
      strategy: retrieved.previousChatWindow?.matchStrategy || 'none',
      score: retrieved.previousChatWindow?.matchScore ?? -1,
      elapsedMs,
      ranking: describeRanking(embeddingBatch),
    };
    results.push(result);
    console.log(`ATHENA_MEMORY_EMBEDDINGS_LIVE_CASE id=${result.id} correct=${result.correct} strategy=${result.strategy} score=${Number(result.score).toFixed(4)} elapsedMs=${result.elapsedMs.toFixed(1)} ranking=${result.ranking}`);
    if (result.correct) {
      const expectedTopic = fixture.topics.find(item => item.id === testCase.expectedTopic);
      const built = buildChatPromptWithSnapshot({
        userMessage: testCase.query,
        recentMessages: [],
        retrievedContext: retrieved,
        mode: 'reason',
      });
      const prompt = built.messages.map(message => message.content).join('\n');
      assert.match(prompt, /匹配方式: 本地语义向量匹配/);
      assert(prompt.includes(expectedTopic.messages[0]), `${testCase.id} prompt must include the expected handoff summary`);
      assert.match(prompt, /回复开头先用一句自然语言说明你接上的是哪个话题/);
      const snapshot = built.snapshot.included.find(item => item.kind === 'previous_window_handoff');
      assert(snapshot, `${testCase.id} must expose previous-window snapshot evidence`);
      assert(snapshot.evidence?.some(item => item.memoryTable === 'chat_windows' && item.memoryId === expectedWindowId));
      promptEvidenceVerified += 1;
    }
  }

  const correct = results.filter(item => item.correct).length;
  const accuracy = correct / results.length;
  const averageMs = results.reduce((sum, item) => sum + item.elapsedMs, 0) / results.length;
  const maximumMs = Math.max(...results.map(item => item.elapsedMs));
  const failures = results.filter(item => !item.correct).map(item => item.id);
  const negativeQueries = [
    '继续上次古典音乐和弦编排的话题',
    '恢复之前的酸面包发酵配方讨论',
    '接着聊以前的量子化学催化剂实验',
    '回到上次酒店路线和旅行预算的话题',
  ];
  const negativeResults = [];
  for (const query of negativeQueries) {
    const { retrieved, elapsedMs, embeddingBatch } = await retrieveForFreshWindow(project.id, query, provider);
    const ranking = describeRanking(embeddingBatch);
    const strategy = retrieved.previousChatWindow?.matchStrategy || 'none';
    negativeResults.push({ query, strategy, ranking, elapsedMs });
    console.log(`ATHENA_MEMORY_EMBEDDINGS_LIVE_NEGATIVE strategy=${strategy} elapsedMs=${elapsedMs.toFixed(1)} ranking=${ranking}`);
  }
  assert(
    accuracy >= fixture.thresholds.semanticUpgradeTarget,
    `live semantic recall accuracy ${accuracy.toFixed(3)} is below ${fixture.thresholds.semanticUpgradeTarget}: ${failures.join(', ')}`,
  );
  assert(results.some(item => item.strategy === 'semantic'), 'live eval did not exercise semantic handoff');
  assert(negativeResults.every(item => item.strategy !== 'semantic'), 'unrelated live queries must not select a semantic window');
  assert.equal(promptEvidenceVerified, correct, 'every correct live match must reach prompt assembly with provenance');

  console.log(`ATHENA_MEMORY_EMBEDDINGS_LIVE_OK provider=ollama model=${model} endpoint=loopback dimensions=${warmVectors[0].length} cases=${results.length} accuracy=${accuracy.toFixed(3)} promptEvidence=${promptEvidenceVerified}/${correct} warmupMs=${warmupMs.toFixed(1)} averageMs=${averageMs.toFixed(1)} maximumMs=${maximumMs.toFixed(1)} failures=${failures.join(',') || 'none'}`);
}

main()
  .then(() => {
    memory.closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    memory.closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  });
