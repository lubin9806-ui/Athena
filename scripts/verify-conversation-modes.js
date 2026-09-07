const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-conversation-modes-'));
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
const { buildChatPrompt } = require(path.join(root, 'dist/core/ai/PromptBuilder.js'));
const { resolveModeGenerationOptions } = require(path.join(root, 'dist/core/ai/Client.js'));
const { Conversation } = require(path.join(root, 'dist/core/ai/Conversation.js'));
const { closeDatabase } = require(path.join(root, 'dist/memory/index.js'));

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
assert(createPrompt.includes('明确为成年人的虚构内容保持开放'), 'create mode must allow adult fictional creation');
assert(createPrompt.includes('不说教、不羞辱'), 'create mode must avoid moralizing refusals for allowed creation');
assert(createPrompt.includes('写实视觉风格不等于现实人物'), 'photorealistic synthetic images must not be treated as real-person evidence');
assert(createPrompt.includes('只保留未成年人性内容这一创作硬边界'), 'create mode must retain only the minor-sexual-content creative hard boundary');
assert(createPrompt.includes('非自愿或伤害剧情'), 'fictional non-consensual and injury themes must remain open');
assert(createPrompt.includes('年龄判断以用户明确声明和文字设定为准'), 'declared fictional age must take priority over visual age guesses');
assert(createPrompt.includes('娇小、娃娃脸、动漫风格、长生种或年轻外观都不构成拒绝理由'), 'youthful adult fictional designs must remain open');
assert(createPrompt.includes('不能只用“实际几百岁”等名义年龄覆盖'), 'nominal age must not override an explicitly stated child identity');
assert(createPrompt.includes('不得自行扩展第五类内容禁区'), 'the model must not invent a broad refusal category');
assert(createPrompt.includes('已声明成年虚构则继续'), 'declared adult fiction must have an explicit proceed outcome');
assert(companionPrompt.includes('当前运行模式：陪伴'), 'companion mode prompt must be active');
assert(companionPrompt.includes('自然、连续、有回应感'), 'companion mode must prioritize conversational continuity');
assert(reasonPrompt.includes('当前运行模式：推理'), 'reason mode prompt must be active');
assert(reasonPrompt.includes('事实、假设、推断和结论'), 'reason mode must separate evidence levels');
assert(executePrompt.includes('当前运行模式：执行'), 'execute mode prompt must be active');
assert(executePrompt.includes('真实、可核验的电脑操作'), 'execute mode must require real computer actions');
assert(executePrompt.includes('不得只给教程、口头计划'), 'execute mode must not substitute instructions for execution');
assert(executePrompt.includes('不得因为成年虚构素材包含露骨性、非自愿剧情、伤害、血腥或写实 AI 风格而在调用工具前自行拒绝'), 'execute mode must not pre-refuse open fictional image work');
assert(executePrompt.includes('状态码或原始错误'), 'execute mode must report precise provider errors instead of broad refusals');
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
  try {
    const response = await conversation.process('检查这个结论', [], emptyContext, 'reason');
    assert(calls.length === 1, 'conversation must call the model exactly once');
    assert(calls[0].mode === 'reason', 'conversation must forward the active mode to the model client');
    assert(calls[0].messages[0].content.includes('当前运行模式：推理'), 'forwarded prompt must match the active mode');
    assert(response.contextSnapshot?.id, 'mode forwarding must persist its context snapshot in the isolated Electron database');
  } finally {
    conversation.shutdown();
  }
}

async function main() {
  await app.whenReady();
  await verifyModeForwarding();
  console.log('ATHENA_CONVERSATION_MODES_OK persistence=verified runtime=electron');
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error?.stack || error);
    app.exit(1);
  })
  .finally(() => {
    closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
