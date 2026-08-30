const path = require('path');

const root = path.resolve(__dirname, '..');
const { buildChatPrompt } = require(path.join(root, 'dist/core/ai/PromptBuilder.js'));
const { resolveModeGenerationOptions } = require(path.join(root, 'dist/core/ai/Client.js'));
const { Conversation } = require(path.join(root, 'dist/core/ai/Conversation.js'));

const emptyContext = {
  profileFacts: [],
  projectNotes: [],
  relatedEvents: [],
  recentMessages: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function systemPrompt(mode) {
  return buildChatPrompt({
    userMessage: '帮我处理这个想法',
    recentMessages: [],
    retrievedContext: emptyContext,
    mode,
  })[0].content;
}

const createPrompt = systemPrompt('create');
const companionPrompt = systemPrompt('companion');
const reasonPrompt = systemPrompt('reason');
const executePrompt = systemPrompt('execute');

assert(createPrompt.includes('当前运行模式：创作'), 'create mode prompt must be active');
assert(createPrompt.includes('发散之后必须收束'), 'create mode must turn divergence into an actionable result');
assert(createPrompt.includes('创作与陪伴是两套行为模式，但继续执行当前角色卡'), 'create mode must retain the selected persona while separating behavior');
assert(createPrompt.includes('创作任务优先于陪伴反应'), 'create mode must prevent companion reactions from blocking allowed work');
assert(createPrompt.includes('不要擅自把角色卡的年龄、关系或身体代入素材'), 'create mode must not self-insert the persona into user material');
assert(createPrompt.includes('明确为成年人的合法虚构内容保持开放'), 'create mode must allow adult fictional creation');
assert(createPrompt.includes('不说教、不羞辱'), 'create mode must avoid moralizing refusals for allowed creation');
assert(companionPrompt.includes('当前运行模式：陪伴'), 'companion mode prompt must be active');
assert(companionPrompt.includes('自然、连续、有回应感'), 'companion mode must prioritize conversational continuity');
assert(reasonPrompt.includes('当前运行模式：推理'), 'reason mode prompt must be active');
assert(reasonPrompt.includes('事实、假设、推断和结论'), 'reason mode must separate evidence levels');
assert(executePrompt.includes('当前运行模式：执行'), 'execute mode prompt must be active');
assert(executePrompt.includes('真实、可核验的电脑操作'), 'execute mode must require real computer actions');
assert(executePrompt.includes('不得只给教程、口头计划'), 'execute mode must not substitute instructions for execution');
assert(new Set([createPrompt, companionPrompt, reasonPrompt, executePrompt]).size === 4, 'all four modes must produce distinct system prompts');

const createGeneration = resolveModeGenerationOptions('create', 0.7);
const companionGeneration = resolveModeGenerationOptions('companion', 0.7);
const reasonGeneration = resolveModeGenerationOptions('reason', 0.7);
const executeGeneration = resolveModeGenerationOptions('execute', 0.7);

assert(
  createGeneration.temperature > companionGeneration.temperature
    && companionGeneration.temperature > reasonGeneration.temperature,
  'mode temperatures must order create > companion > reason'
);
assert(
  createGeneration.topP > companionGeneration.topP
    && companionGeneration.topP > reasonGeneration.topP,
  'mode top-p values must order create > companion > reason'
);
assert(executeGeneration.temperature <= reasonGeneration.temperature, 'execute mode must be at least as deterministic as reason mode');
assert(executeGeneration.topP < reasonGeneration.topP, 'execute mode must use the narrowest sampling range');

async function verifyModeForwarding() {
  const calls = [];
  const mockClient = {
    chat: async (messages, _onStream, mode) => {
      calls.push({ messages, mode });
      return '测试完成';
    },
  };
  const conversation = new Conversation(mockClient);
  await conversation.process('检查这个结论', [], emptyContext, 'reason');
  assert(calls.length === 1, 'conversation must call the model exactly once');
  assert(calls[0].mode === 'reason', 'conversation must forward the active mode to the model client');
  assert(calls[0].messages[0].content.includes('当前运行模式：推理'), 'forwarded prompt must match the active mode');
}

verifyModeForwarding()
  .then(() => console.log('conversation modes OK'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
