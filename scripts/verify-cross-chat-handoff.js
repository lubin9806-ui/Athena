const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cross-chat-handoff-'));
process.env.ATHENA_DB_DIR = scratch;
process.env.ATHENA_DB_FILENAME = 'cross-chat-handoff.db';
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { buildChatPromptWithSnapshot } = require(path.join(root, 'dist', 'core', 'ai', 'PromptBuilder.js'));

let exitCode = 0;
try {
  const alpha = memory.createProject({ title: 'Alpha handoff' });
  const beta = memory.createProject({ title: 'Beta isolation' });

  const olderAlpha = memory.createChatWindow({ title: 'Live2D lip sync', projectId: alpha.id, mode: 'reason' });
  memory.saveChatMessage(olderAlpha.id, 'user', 'Live2D 嘴型同步需要使用音素时间轴。', undefined, 'reason');
  memory.saveChatMessage(olderAlpha.id, 'assistant', '下一步验证元音口型和眨眼动作是否会冲突。', undefined, 'reason');

  const expectedPrevious = memory.createChatWindow({ title: 'Memory redesign', projectId: alpha.id, mode: 'reason' });
  memory.saveChatMessage(expectedPrevious.id, 'user', '我们决定先做跨聊天接续，不引入新的向量数据库。', undefined, 'reason');
  memory.saveChatMessage(expectedPrevious.id, 'assistant', '下一步是复用窗口摘要，并补 Project 隔离测试。', undefined, 'reason');

  const archivedAlpha = memory.createChatWindow({ title: 'Archived distraction', projectId: alpha.id });
  memory.saveChatMessage(archivedAlpha.id, 'user', '归档窗口不能成为交接来源。');
  memory.archiveChatWindow(archivedAlpha.id, true);

  const temporaryAlpha = memory.createTemporaryChatWindow({ title: 'Temporary distraction', projectId: alpha.id });
  memory.saveChatMessage(temporaryAlpha.id, 'user', '临时窗口秘密不能进入交接。');

  const betaWindow = memory.createChatWindow({ title: 'Beta distraction', projectId: beta.id });
  memory.saveChatMessage(betaWindow.id, 'user', '另一个 Project 的内容不能进入 Alpha。');

  const topicCurrent = memory.createChatWindow({ title: 'Fresh topic lookup', projectId: alpha.id, mode: 'reason' });
  const topicInput = memory.saveChatMessage(topicCurrent.id, 'user', '继续上次关于 Live2D 嘴型同步的话题。', undefined, 'reason');
  const topicRetrieved = memory.retrieveContext({
    query: topicInput.content,
    chatWindowId: topicCurrent.id,
    maxProfileFacts: 0,
    maxProceduralMemories: 0,
    maxTemporalFacts: 0,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    maxDocumentChunks: 0,
  });
  assert.equal(topicRetrieved.previousChatWindow?.id, olderAlpha.id, 'a named topic should beat a newer unrelated chat');
  assert.equal(topicRetrieved.previousChatWindow.matchStrategy, 'topic');
  assert.ok(topicRetrieved.previousChatWindow.matchScore >= 3);
  assert.ok(topicRetrieved.previousChatWindow.matchedTerms.some(term => /live2d|嘴型同步/.test(term)));
  const topicPrompt = buildChatPromptWithSnapshot({
    userMessage: topicInput.content,
    recentMessages: topicRetrieved.recentMessages.filter(message => message.id !== topicInput.id),
    retrievedContext: topicRetrieved,
    mode: 'reason',
  }).messages.map(message => message.content).join('\n');
  assert.match(topicPrompt, /匹配方式: 话题匹配/);
  assert.match(topicPrompt, /回复开头先用一句自然语言说明你接上的是哪个话题/);
  assert.match(topicPrompt, /音素时间轴/);
  assert.doesNotMatch(topicPrompt, /不引入新的向量数据库/);
  memory.deleteChatWindow(topicCurrent.id);

  const current = memory.createChatWindow({ title: 'Fresh Alpha chat', projectId: alpha.id, mode: 'reason' });
  const currentInput = memory.saveChatMessage(current.id, 'user', '我们继续上次没有说完的话题。', undefined, 'reason');

  assert.equal(memory.requestsPreviousChatHandoff('我们继续上次没有说完的话题。', 1), true);
  assert.equal(memory.requestsPreviousChatHandoff('你还记得我们之前聊过这个吗？', 1), true);
  assert.equal(memory.requestsPreviousChatHandoff('继续', 1), true, 'a bare resume in a fresh chat should request a handoff');
  assert.equal(memory.requestsPreviousChatHandoff('继续', 2), false, 'a bare resume inside an established chat should stay in the current window');
  assert.equal(memory.requestsPreviousChatHandoff('继续上次的话题', 2), false, 'an established chat already carries its own history');
  assert.equal(memory.requestsPreviousChatHandoff('继续生成图片', 1), false);
  assert.equal(memory.requestsPreviousChatHandoff('执行之前先检查文件', 1), false);

  const retrieved = memory.retrieveContext({
    query: currentInput.content,
    chatWindowId: current.id,
    recentMessageCount: 20,
    maxProfileFacts: 0,
    maxProceduralMemories: 0,
    maxTemporalFacts: 0,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    maxDocumentChunks: 0,
  });
  assert.equal(retrieved.previousChatWindow?.id, expectedPrevious.id, 'handoff must use the latest eligible sibling in the same Project');
  assert.equal(retrieved.previousChatWindow.matchStrategy, 'recent');
  assert.equal(retrieved.previousChatWindow.matchScore, 0);
  assert.match(retrieved.previousChatWindow.summary, /不引入新的向量数据库/);
  assert.doesNotMatch(retrieved.previousChatWindow.summary, /临时窗口秘密|另一个 Project|归档窗口/);

  const built = buildChatPromptWithSnapshot({
    userMessage: currentInput.content,
    recentMessages: retrieved.recentMessages.filter(message => message.id !== currentInput.id),
    retrievedContext: retrieved,
    mode: 'reason',
  });
  const prompt = built.messages.map(message => message.content).join('\n');
  assert.match(prompt, /最近一次聊天交接/);
  assert.match(prompt, /Memory redesign/);
  assert.match(prompt, /复用窗口摘要/);
  assert.doesNotMatch(prompt, /临时窗口秘密|另一个 Project 的内容|归档窗口不能/);
  const handoffSnapshot = built.snapshot.included.find(item => item.kind === 'previous_window_handoff');
  assert.ok(handoffSnapshot, 'context snapshot must expose the handoff decision');
  assert.equal(handoffSnapshot.id, String(expectedPrevious.id));
  assert.ok(handoffSnapshot.evidence?.some(item => (
    item.memoryTable === 'chat_windows'
    && item.memoryId === expectedPrevious.id
    && item.memoryKind === 'window'
  )), 'handoff snapshot must preserve window provenance');

  const ordinary = memory.retrieveContext({
    query: '帮我分析今天的任务',
    chatWindowId: current.id,
    maxProfileFacts: 0,
    maxProceduralMemories: 0,
    maxTemporalFacts: 0,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    maxDocumentChunks: 0,
  });
  assert.equal(ordinary.previousChatWindow, undefined, 'ordinary prompts must not receive cross-chat handoff context');

  const temporaryContext = memory.retrieveContext({
    query: '继续上次的话题',
    chatWindowId: temporaryAlpha.id,
    maxProfileFacts: 0,
    maxProceduralMemories: 0,
    maxTemporalFacts: 0,
    maxEvents: 0,
    maxDailySummaries: 0,
    maxProjectNotes: 0,
    maxDocumentChunks: 0,
  });
  assert.equal(temporaryContext.previousChatWindow, undefined, 'Temporary Chat must not load a persistent handoff');

  console.log('ATHENA_CROSS_CHAT_HANDOFF_OK');
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  memory.closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(exitCode);
}
