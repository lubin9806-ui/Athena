const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-memory-embeddings-'));
process.env.ATHENA_DB_DIR = scratch;
process.env.ATHENA_DB_FILENAME = 'memory-embeddings.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { OllamaMemoryEmbeddingProvider } = require(path.join(root, 'dist', 'core', 'ai', 'OllamaMemoryEmbeddingProvider.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist', 'core', 'config', 'SettingsStore.js'));

function semanticVector(text) {
  const value = String(text).toLowerCase();
  if (/live2d|口型同步|嘴部动作/.test(value)) return [1, 0, 0, 0, 0, 0, 0, 0];
  if (/记忆系统|向量数据库/.test(value)) return [0, 1, 0, 0, 0, 0, 0, 0];
  return [0, 0, 1, 0, 0, 0, 0, 0];
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

async function main() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.url === '/api/tags' && request.method === 'GET') {
      requests.push({ path: request.url, method: request.method });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'embeddinggemma:latest' }] }));
      return;
    }
    if (request.url === '/api/embed' && request.method === 'POST') {
      const body = await readJsonBody(request);
      requests.push({ path: request.url, method: request.method, body });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        model: body.model,
        embeddings: body.input.map(semanticVector),
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal(DEFAULT_SETTINGS.memory.semanticRetrieval, false, 'semantic recall must be opt-in');
    assert.equal(DEFAULT_SETTINGS.memory.embeddingModel, 'embeddinggemma');

    const provider = new OllamaMemoryEmbeddingProvider({ endpoint, model: 'embeddinggemma', timeoutMs: 2_000 });
    assert.equal(provider.minimumSimilarity, 0.28, 'EmbeddingGemma threshold must match live positive/negative calibration');
    const disabled = await provider.status(false);
    assert.equal(disabled.state, 'disabled');
    assert.equal(requests.length, 0, 'disabled status must not contact Ollama');
    const ready = await provider.status(true);
    assert.equal(ready.state, 'ready');
    assert.match(ready.message, /embeddinggemma/);

    const missing = await new OllamaMemoryEmbeddingProvider({ endpoint, model: 'missing-embed-model' }).status(true);
    assert.equal(missing.state, 'model-missing');
    const blocked = await new OllamaMemoryEmbeddingProvider({ endpoint: 'https://example.com', model: 'embeddinggemma' }).status(true);
    assert.equal(blocked.state, 'blocked-endpoint');

    const project = memory.createProject({ title: 'Embedding recall' });
    const semanticTarget = memory.createChatWindow({ title: 'Character animation', projectId: project.id, mode: 'reason' });
    memory.saveChatMessage(semanticTarget.id, 'user', 'Live2D 口型同步参数需要单独调试。', undefined, 'reason');
    const recentDistractor = memory.createChatWindow({ title: 'Memory architecture', projectId: project.id, mode: 'reason' });
    memory.saveChatMessage(recentDistractor.id, 'user', '记忆系统继续使用现有向量数据库。', undefined, 'reason');
    const current = memory.createChatWindow({ title: 'Fresh semantic lookup', projectId: project.id, mode: 'reason' });
    const query = '继续上次角色嘴部动作的话题';
    memory.saveChatMessage(current.id, 'user', query, undefined, 'reason');

    const retrieveOptions = {
      query,
      chatWindowId: current.id,
      maxProfileFacts: 0,
      maxProceduralMemories: 0,
      maxTemporalFacts: 0,
      maxEvents: 0,
      maxDailySummaries: 0,
      maxProjectNotes: 0,
      maxDocumentChunks: 0,
    };
    const baseline = memory.retrieveContext(retrieveOptions);
    assert.equal(baseline.previousChatWindow.id, recentDistractor.id, 'keyword fallback should expose the semantic gap');
    assert.equal(baseline.previousChatWindow.matchStrategy, 'recent');

    const semantic = await memory.retrieveContextWithSemanticHandoff(retrieveOptions, provider);
    assert.equal(semantic.previousChatWindow.id, semanticTarget.id);
    assert.equal(semantic.previousChatWindow.matchStrategy, 'semantic');
    assert.equal(semantic.previousChatWindow.matchScore, 1);

    const embedRequest = requests.find(item => item.path === '/api/embed');
    assert(embedRequest, 'semantic handoff must call the local Ollama embed endpoint');
    assert.equal(embedRequest.body.model, 'embeddinggemma');
    assert.equal(embedRequest.body.truncate, true);
    assert(Array.isArray(embedRequest.body.input) && embedRequest.body.input.length === 3, 'query plus two candidate windows should be embedded in one batch');
    assert.match(embedRequest.body.input[0], /^task: search result \| query: /, 'EmbeddingGemma query prompt must use the retrieval-query format');
    assert.match(embedRequest.body.input[1], /^title: .+ \| text: /, 'EmbeddingGemma candidates must use the retrieval-document format');

    const malformedFallback = await memory.retrieveContextWithSemanticHandoff(retrieveOptions, {
      id: 'malformed-fixture',
      async embed() { return [[1], [1]]; },
    });
    assert.equal(malformedFallback.previousChatWindow.id, recentDistractor.id, 'invalid semantic output must preserve keyword fallback');

    const ipc = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'src', 'app', 'preload.ts'), 'utf8');
    const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
    assert.match(ipc, /memory:embeddingStatus/);
    assert.match(preload, /getMemoryEmbeddingStatus/);
    assert.match(renderer, /semanticRetrieval: settingMemorySemantic\.checked/);
    assert.match(renderer, /pullOllamaModel\(model\)/, 'embedding model download must reuse the confirmed Ollama pull flow');
    assert.match(html, /id="setting-memory-semantic"/);
    assert.match(html, /id="setting-memory-embedding-status"/);
    assert.match(html, /id="setting-memory-embedding-pull"/);

    console.log(`ATHENA_MEMORY_EMBEDDINGS_OK provider=ollama model=embeddinggemma endpoint=loopback batchInputs=${embedRequest.body.input.length} baseline=recent semantic=matched missingModel=reported remoteEndpoint=blocked fallback=preserved`);
  } finally {
    memory.closeDatabase();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
