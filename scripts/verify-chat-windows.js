const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-chat-windows-'));
process.env.ATHENA_DB_DIR = tempDir;
process.env.ATHENA_DB_FILENAME = 'chat-windows-test.db';

const root = path.resolve(__dirname, '..');
const memory = require(path.join(root, 'dist/memory/index.js'));
const { buildChatPrompt, buildChatPromptWithSnapshot } = require(path.join(root, 'dist/core/ai/PromptBuilder.js'));

let exitCode = 0;
try {
  const first = memory.ensureDefaultChatWindow();
  assert.ok(first.id > 0, 'default chat window should be created');

  const windowA = memory.createChatWindow({ title: 'Window A', mode: 'companion' });
  const windowB = memory.createChatWindow({ title: 'Window B', mode: 'companion' });
  assert.notEqual(windowA.id, windowB.id, 'windows must have distinct ids');

  memory.activateChatWindow(windowA.id);
  memory.saveChatMessage(windowA.id, 'user', '我选择方案一', undefined, 'companion');
  memory.saveChatMessage(windowA.id, 'assistant', 'A-only assistant reply', 'calm', 'companion');

  memory.activateChatWindow(windowB.id);
  memory.saveChatMessage(windowB.id, 'user', 'B-only user message', undefined, 'companion');

  const messagesA = memory.getChatWindowMessages(windowA.id, 20).map((message) => message.content);
  const messagesB = memory.getChatWindowMessages(windowB.id, 20).map((message) => message.content);

  assert.deepEqual(messagesA, ['我选择方案一', 'A-only assistant reply']);
  assert.deepEqual(messagesB, ['B-only user message']);
  assert.ok(!messagesA.some((content) => content.includes('B-only')), 'window A must not contain window B messages');
  assert.ok(!messagesB.some((content) => content.includes('方案一') || content.includes('A-only')), 'window B must not contain window A messages');

  const stateA = memory.getChatWindow(windowA.id);
  assert.equal(stateA.messageCount, 2);
  assert.ok(stateA.summary.includes('user: 我选择方案一'), 'rolling summary must retain first user selection');
  assert.ok(stateA.summary.includes('assistant: A-only assistant reply'), 'rolling summary must append assistant replies');
  const workingStateA = JSON.parse(stateA.working_state_json);
  assert.equal(workingStateA.lastRole, 'assistant');
  assert.equal(workingStateA.lastMode, 'companion');
  assert.equal(workingStateA.lastMessagePreview, 'A-only assistant reply');
  assert.equal(workingStateA.lastUserSelection, '方案一');
  assert.equal(workingStateA.messageCount, 2);

  const pinnedA = memory.pinChatWindowFact(windowA.id, '方案一是当前窗口的已确认方向');
  const pinnedB = memory.pinChatWindowFact(windowB.id, 'B 窗口只记录 B 的事实');
  const pinnedStateA = JSON.parse(pinnedA.working_state_json);
  const pinnedStateB = JSON.parse(pinnedB.working_state_json);
  assert.equal(pinnedStateA.pinnedFacts.length, 1, 'window A should persist pinned facts in working state');
  assert.equal(pinnedStateA.pinnedFacts[0].text, '方案一是当前窗口的已确认方向');
  assert.equal(pinnedStateB.pinnedFacts[0].text, 'B 窗口只记录 B 的事实');
  assert.ok(!JSON.stringify(pinnedStateA.pinnedFacts).includes('B 窗口'), 'pinned facts must remain scoped to their window');
  const unpinnedA = memory.unpinChatWindowFact(windowA.id, pinnedStateA.pinnedFacts[0].id);
  assert.equal(JSON.parse(unpinnedA.working_state_json).pinnedFacts.length, 0, 'unpinned facts should be removed from the current window');

  for (let index = 0; index < 8; index += 1) {
    memory.saveChatMessage(windowA.id, 'user', `持续上下文 ${index}`, undefined, 'companion');
  }
  const rolledA = memory.getChatWindow(windowA.id);
  assert.ok(rolledA.summary.includes('持续上下文 7'), 'rolling summary must continue updating over multiple rounds');
  assert.ok(rolledA.summary.length <= 1200, 'rolling summary must stay bounded');

  const contextA = memory.retrieveContext({
    query: '我选了什么',
    recentMessageCount: 20,
    maxProfileFacts: 0,
    maxEvents: 0,
    maxProjectNotes: 0,
    chatWindowId: windowA.id,
  });
  const promptA = buildChatPrompt({
    userMessage: '我选了什么',
    recentMessages: contextA.recentMessages,
    retrievedContext: contextA,
    mode: 'companion',
  });
  const promptTextA = promptA.map((message) => message.content).join('\n');
  assert.ok(promptTextA.includes('窗口 rolling summary'), 'model prompt must include window rolling summary');
  assert.ok(promptTextA.includes('working_state_json'), 'model prompt must include window working state');
  assert.ok(promptTextA.includes('我选择方案一'), 'second turn prompt must carry the first turn selection');
  assert.ok(promptTextA.includes('我选了什么'), 'model prompt must include the current user input');

  const contextB = memory.retrieveContext({
    query: '我选了什么',
    recentMessageCount: 20,
    maxProfileFacts: 0,
    maxEvents: 0,
    maxProjectNotes: 0,
    chatWindowId: windowB.id,
  });
  const promptB = buildChatPrompt({
    userMessage: '我选了什么',
    recentMessages: contextB.recentMessages,
    retrievedContext: contextB,
    mode: 'companion',
  });
  const promptTextB = promptB.map((message) => message.content).join('\n');
  assert.ok(!promptTextB.includes('我选择方案一'), 'window B prompt must not inherit window A selection');

  const longMessages = Array.from({ length: 36 }, (_, index) => ({
    id: 10_000 + index,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `long-history-${index} ` + 'x'.repeat(700),
    created_at: new Date().toISOString(),
  }));
  const managed = buildChatPromptWithSnapshot({
    userMessage: 'current-input-marker',
    recentMessages: longMessages,
    retrievedContext: {
      ...contextA,
      recentMessages: longMessages,
      chatWindow: {
        id: windowA.id,
        title: 'Window A',
        summary: 'window-summary-marker ' + 's'.repeat(900),
        workingStateJson: JSON.stringify({ marker: 'working-state-marker', payload: 'w'.repeat(900) }),
        messageCount: longMessages.length,
        updatedAt: new Date().toISOString(),
      },
    },
    mode: 'companion',
    maxPromptTokens: 3200,
  });
  const managedText = managed.messages.map((message) => message.content).join('\n');
  assert.ok(managedText.includes('current-input-marker'), 'current input must always be included');
  assert.ok(managed.snapshot.budget.estimatedPromptTokens <= managed.snapshot.budget.maxPromptTokens + 128, 'managed prompt should stay close to the configured budget');
  assert.ok(managed.snapshot.omitted.length > 0, 'context manager must omit low-priority items under pressure');
  assert.ok(
    managed.snapshot.omitted.some((item) => item.kind === 'old_history' || item.kind === 'window_summary' || item.kind === 'working_state'),
    'snapshot must explain omitted lower-priority context',
  );

  const savedSnapshot = memory.saveContextSnapshot({
    windowId: windowA.id,
    userMessageId: undefined,
    mode: 'companion',
    budget: managed.snapshot.budget,
    included: managed.snapshot.included,
    omitted: managed.snapshot.omitted,
    promptMessageCount: managed.snapshot.budget.promptMessageCount,
    promptChars: managed.snapshot.budget.promptChars,
    estimatedPromptTokens: managed.snapshot.budget.estimatedPromptTokens,
  });
  assert.ok(savedSnapshot.id > 0, 'context snapshot should be saved for debugging');
  assert.equal(memory.getRecentContextSnapshots(windowA.id, 1)[0].id, savedSnapshot.id, 'latest context snapshot should be queryable');

  const db = memory.getDatabase();
  const globalMessagesBeforeTemporary = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  const temporarySecret = 'TEMP-ONLY-SECRET-ATHENA-7429';
  const temporary = memory.createTemporaryChatWindow({ title: 'Temporary Scratch', mode: 'companion' });
  assert.equal(temporary.is_temporary, true, 'temporary chat window must be marked explicitly');
  assert.ok(!memory.listChatWindows(false).some((item) => item.id === temporary.id), 'temporary windows must not enter the default long-term window list');
  const tempUser = memory.saveChatMessage(temporary.id, 'user', `remember in temp only ${temporarySecret}`, undefined, 'companion');
  memory.saveChatMessage(temporary.id, 'assistant', `temp reply can still see ${temporarySecret}`, 'calm', 'companion');
  const temporaryMessages = memory.getChatWindowMessages(temporary.id, 20).map((message) => message.content);
  assert.deepEqual(temporaryMessages, [
    `remember in temp only ${temporarySecret}`,
    `temp reply can still see ${temporarySecret}`,
  ], 'temporary window should keep continuity inside the active window');
  const globalMessagesAfterTemporary = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  assert.equal(globalMessagesAfterTemporary, globalMessagesBeforeTemporary, 'temporary chat messages must not be copied into global message history');
  assert.ok(!memory.getRecentMessages(50).some((message) => message.content.includes(temporarySecret)), 'global recent history must not include temporary chat content');

  const contextAfterTemporary = memory.retrieveContext({
    query: temporarySecret,
    recentMessageCount: 20,
    maxProfileFacts: 0,
    maxEvents: 0,
    maxProjectNotes: 0,
    chatWindowId: windowB.id,
  });
  const promptAfterTemporary = buildChatPrompt({
    userMessage: 'Can you cite the temporary secret?',
    recentMessages: contextAfterTemporary.recentMessages,
    retrievedContext: contextAfterTemporary,
    mode: 'companion',
  });
  assert.ok(
    !promptAfterTemporary.map((message) => message.content).join('\n').includes(temporarySecret),
    'ordinary windows must not receive temporary chat content in their prompt',
  );

  const tempSnapshot = memory.saveContextSnapshot({
    windowId: temporary.id,
    userMessageId: tempUser.id,
    mode: 'companion',
    budget: managed.snapshot.budget,
    included: managed.snapshot.included,
    omitted: managed.snapshot.omitted,
    promptMessageCount: managed.snapshot.budget.promptMessageCount,
    promptChars: managed.snapshot.budget.promptChars,
    estimatedPromptTokens: managed.snapshot.budget.estimatedPromptTokens,
  });
  assert.ok(tempSnapshot.id > 0, 'temporary context snapshot should be available while the window is open');
  assert.equal(memory.deleteChatWindow(temporary.id), true, 'closing a temporary window should succeed');
  assert.equal(memory.getChatWindow(temporary.id), null, 'closed temporary window must not be queryable');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE window_id = ?').get(temporary.id).c, 0, 'temporary chat messages should be cleared on close');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM context_snapshots WHERE window_id = ?').get(temporary.id).c, 0, 'temporary context snapshots should be cleared on close');

  const renamed = memory.renameChatWindow(windowA.id, 'Renamed A');
  assert.equal(renamed.title, 'Renamed A');

  const archived = memory.archiveChatWindow(windowB.id, true);
  assert.ok(archived.archived_at, 'archived window should record archived_at');
  assert.ok(!memory.listChatWindows(false).some((item) => item.id === windowB.id), 'archived windows should be hidden by default');

  assert.equal(memory.deleteChatWindow(windowA.id), true);
  assert.ok(!memory.listChatWindows(true).some((item) => item.id === windowA.id), 'soft-deleted windows should be hidden');

  console.log('ATHENA_CHAT_WINDOWS_OK');
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  memory.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(exitCode);
}
