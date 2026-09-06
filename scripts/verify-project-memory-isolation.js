const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-project-memory-'));
const databasePath = path.join(scratch, 'project-memory.db');

const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    memory_state TEXT NOT NULL DEFAULT '{}',
    archived_at DATETIME,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    last_active_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  INSERT INTO projects (id, title) VALUES (1, 'Alpha'), (2, 'Twin'), (3, 'Twin');

  CREATE TABLE procedural_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    key TEXT NOT NULL,
    instruction TEXT NOT NULL,
    evidence TEXT,
    confidence REAL DEFAULT 0.7,
    importance INTEGER DEFAULT 6,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    last_recalled_at DATETIME,
    UNIQUE(scope, key)
  );
  INSERT INTO procedural_memories (scope, key, instruction, importance)
  VALUES ('project', 'legacy project rule', 'legacy project rule must stay unscoped', 9);

  CREATE TABLE project_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    tags TEXT DEFAULT '[]',
    importance INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    last_recalled_at DATETIME
  );
  INSERT INTO project_notes (project, title, note, importance) VALUES
    ('Alpha', 'unique legacy note', 'unique legacy alpha marker', 8),
    ('Twin', 'ambiguous legacy note', 'ambiguous twin marker', 9),
    ('Missing', 'unmatched legacy note', 'unmatched marker', 9);
  PRAGMA user_version = 11;
`);
legacy.close();

process.env.ATHENA_DB_DIR = scratch;
process.env.ATHENA_DB_FILENAME = path.basename(databasePath);
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { buildManagedContext } = require(path.join(root, 'dist', 'core', 'ai', 'ContextManager.js'));

let exitCode = 0;
try {
  const db = memory.getDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 19);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare("SELECT project_id FROM project_notes WHERE title = 'unique legacy note'").get().project_id, 1);
  assert.equal(db.prepare("SELECT project_id FROM project_notes WHERE title = 'ambiguous legacy note'").get().project_id, null);
  assert.equal(db.prepare("SELECT project_id FROM project_notes WHERE title = 'unmatched legacy note'").get().project_id, null);
  assert.equal(db.prepare("SELECT project_id FROM procedural_memories WHERE key = 'legacy project rule'").get().project_id, null);

  const alpha = memory.getProject(1);
  const beta = memory.createProject({ title: 'Beta' });
  const windowA = memory.createChatWindow({ title: 'Alpha memory', projectId: alpha.id, mode: 'reason' });
  const windowB = memory.createChatWindow({ title: 'Beta memory', projectId: beta.id, mode: 'reason' });

  const noteA = memory.addProjectNote({
    projectId: alpha.id,
    project: alpha.title,
    title: 'shared architecture marker',
    note: 'alpha-only retrieval marker',
    importance: 9,
  });
  const noteB = memory.addProjectNote({
    projectId: beta.id,
    project: beta.title,
    title: 'shared architecture marker',
    note: 'beta-only retrieval marker',
    importance: 9,
  });
  const procedureA = memory.upsertProceduralMemory({
    scope: 'project', projectId: alpha.id, key: 'shared review workflow',
    instruction: 'Use the alpha-only workflow.', confidence: 0.9, importance: 9,
  });
  const procedureB = memory.upsertProceduralMemory({
    scope: 'project', projectId: beta.id, key: 'shared review workflow',
    instruction: 'Use the beta-only workflow.', confidence: 0.9, importance: 9,
  });
  memory.upsertProceduralMemory({
    scope: 'global', key: 'global review workflow',
    instruction: 'Always report validation evidence.', confidence: 0.9, importance: 9,
  });
  assert.throws(() => memory.upsertProceduralMemory({
    scope: 'project', key: 'missing project identity', instruction: 'must fail',
  }), /requires a Project ID/);
  assert.throws(() => memory.upsertProceduralMemory({
    scope: 'global', projectId: alpha.id, key: 'invalid global identity', instruction: 'must fail',
  }), /Only project-scoped/);
  for (let index = 0; index < 130; index += 1) {
    memory.addProjectNote({
      projectId: beta.id,
      project: beta.title,
      title: `shared architecture distractor ${index}`,
      note: `beta index crowd marker ${index}`,
      importance: 10,
    });
  }
  assert.notEqual(procedureA.id, procedureB.id, 'the same procedural key must coexist across Projects');

  memory.rebuildMemoryIndex();
  const contextA = memory.retrieveContext({
    query: 'shared architecture review workflow marker', chatWindowId: windowA.id,
    maxProfileFacts: 0, maxTemporalFacts: 0, maxEvents: 0, maxDailySummaries: 0,
    maxProjectNotes: 10, maxProceduralMemories: 10, recentMessageCount: 0,
  });
  const contextB = memory.retrieveContext({
    query: 'beta-only retrieval marker shared review workflow', chatWindowId: windowB.id,
    maxProfileFacts: 0, maxTemporalFacts: 0, maxEvents: 0, maxDailySummaries: 0,
    maxProjectNotes: 10, maxProceduralMemories: 10, recentMessageCount: 0,
  });
  assert(contextA.projectNotes.some(note => note.id === noteA.id));
  assert(!contextA.projectNotes.some(note => note.id === noteB.id));
  assert(contextB.projectNotes.some(note => note.id === noteB.id));
  assert(!contextB.projectNotes.some(note => note.id === noteA.id));
  assert(contextA.proceduralMemories.some(item => item.id === procedureA.id));
  assert(!contextA.proceduralMemories.some(item => item.id === procedureB.id));
  assert(contextB.proceduralMemories.some(item => item.id === procedureB.id));
  assert(!contextB.proceduralMemories.some(item => item.id === procedureA.id));
  assert(!contextA.proceduralMemories.some(item => item.key === 'legacy project rule'));
  assert(!contextB.projectNotes.some(item => item.title === 'ambiguous legacy note'));
  const ambiguousContext = memory.retrieveContext({
    query: 'ambiguous twin marker', chatWindowId: windowA.id,
    maxProfileFacts: 0, maxProceduralMemories: 0, maxTemporalFacts: 0,
    maxEvents: 0, maxDailySummaries: 0, maxProjectNotes: 10, recentMessageCount: 0,
  });
  assert(!ambiguousContext.projectNotes.some(item => item.title === 'ambiguous legacy note'));
  assert(contextA.proceduralMemories.some(item => item.key === 'global review workflow'));
  assert.equal(db.prepare("SELECT project_id FROM memory_index WHERE source_table = 'procedural_memories' AND source_id = ?").get(procedureA.id).project_id, alpha.id);
  assert.equal(db.prepare("SELECT project_id FROM memory_index WHERE source_table = 'project_notes' AND source_id = ?").get(noteA.id).project_id, alpha.id);
  assert(contextA.evidence.some(item => item.memoryTable === 'project_notes' && item.memoryId === noteA.id && item.projectId === alpha.id));

  const sourceMessage = memory.saveMessage('user', 'review provenance source marker', undefined, 'reason');
  const review = memory.enqueueMemoryReviewCandidate({
    kind: 'project',
    title: 'review provenance marker',
    content: 'review provenance content',
    payload: {
      projectId: alpha.id,
      project: alpha.title,
      title: 'review provenance marker',
      note: 'review provenance content',
      importance: 9,
    },
    reason: 'project provenance verification',
    confidence: 0.9,
    importance: 9,
    sourceTable: 'messages',
    sourceId: sourceMessage.id,
    chatWindowId: windowA.id,
  });
  const applied = memory.approveMemoryReviewItem(review.id);
  const reviewedContext = memory.retrieveContext({
    query: 'review provenance marker', chatWindowId: windowA.id,
    maxProfileFacts: 0, maxProceduralMemories: 0, maxTemporalFacts: 0,
    maxEvents: 0, maxDailySummaries: 0, maxProjectNotes: 10, recentMessageCount: 0,
  });
  assert(reviewedContext.evidence.some(item => (
    item.memoryTable === 'project_notes'
    && item.memoryId === applied.applied_id
    && item.origin === 'review'
    && item.sourceTable === 'messages'
    && item.sourceId === sourceMessage.id
    && item.chatWindowId === windowA.id
  )));

  const sourceTableOnlyReview = memory.enqueueMemoryReviewCandidate({
    kind: 'project',
    title: 'source table only marker',
    content: 'source table only content',
    payload: {
      projectId: alpha.id,
      project: alpha.title,
      title: 'source table only marker',
      note: 'source table only content',
      importance: 9,
    },
    reason: 'source table without source id verification',
    confidence: 0.9,
    importance: 9,
    sourceTable: 'messages',
    chatWindowId: windowA.id,
  });
  const sourceTableOnlyApplied = memory.approveMemoryReviewItem(sourceTableOnlyReview.id);
  const sourceTableOnlyContext = memory.retrieveContext({
    query: 'source table only marker', chatWindowId: windowA.id,
    maxProfileFacts: 0, maxProceduralMemories: 0, maxTemporalFacts: 0,
    maxEvents: 0, maxDailySummaries: 0, maxProjectNotes: 10, recentMessageCount: 0,
  });
  assert(sourceTableOnlyContext.evidence.some(item => (
    item.memoryId === sourceTableOnlyApplied.applied_id
    && item.origin === 'review'
    && item.sourceTable === 'memory_review_queue'
    && item.sourceId === sourceTableOnlyReview.id
  )));

  const managed = buildManagedContext({
    userMessage: 'review provenance marker', recentMessages: [], retrievedContext: reviewedContext,
    mode: 'reason', systemContext: 'system', maxPromptTokens: 4096,
  });
  const projectSnapshot = managed.snapshot.included.find(item => item.kind === 'project_memory');
  assert(projectSnapshot?.evidence?.some(item => item.origin === 'review'));
  const savedSnapshot = memory.saveContextSnapshot({
    projectId: alpha.id,
    windowId: windowA.id,
    mode: 'reason',
    budget: managed.snapshot.budget,
    included: managed.snapshot.included,
    omitted: managed.snapshot.omitted,
    promptMessageCount: managed.snapshot.budget.promptMessageCount,
    promptChars: managed.snapshot.budget.promptChars,
    estimatedPromptTokens: managed.snapshot.budget.estimatedPromptTokens,
  });
  assert.equal(savedSnapshot.project_id, alpha.id);
  assert(savedSnapshot.included.some(item => item.evidence?.some(source => source.origin === 'review')));
  assert.throws(() => memory.retrieveContext({ query: 'mismatch', chatWindowId: windowA.id, projectId: beta.id }), /does not match/);

  console.log('ATHENA_PROJECT_MEMORY_OK schema=15 isolation=project-id legacy=conservative provenance=snapshot');
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
}

process.exit(exitCode);
