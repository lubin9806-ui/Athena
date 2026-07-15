const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { buildChatPrompt, buildSystemPrompt } = require(path.join(root, 'dist/core/ai/PromptBuilder.js'));

const emptyContext = {
  profileFacts: [],
  projectNotes: [],
  relatedEvents: [],
  recentMessages: [],
};

const prompt = buildSystemPrompt();
const identityPrompt = buildChatPrompt({
  userMessage: '你是谁，介绍一下你自己',
  recentMessages: [],
  retrievedContext: emptyContext,
})[0].content;

const rendererHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const rendererApp = fs.readFileSync(path.join(root, 'src/renderer/app.ts'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(prompt.includes('你的名字是 苏时夏'), 'system prompt must name Su Shixia first');
assert(prompt.includes('昵称 时夏'), 'system prompt must include Shixia nickname');
assert(prompt.includes('Athena 只是你所在的本地桌面应用'), 'system prompt must separate app name from persona name');
assert(prompt.includes('不要自称 Athena、Muse、Venus 或 Oracle'), 'system prompt must forbid old persona names');
assert(prompt.includes('我叫苏时夏，叫我时夏就好'), 'self-introduction example must be interpolated');
assert(!prompt.includes('{SELF_INTRODUCTION_EXAMPLE}'), 'self-introduction example must not be left as a placeholder');
assert(identityPrompt.includes('我叫苏时夏，叫我时夏就好'), 'identity scene must reinforce the intended introduction');
assert(rendererHtml.includes('和时夏说点什么'), 'input placeholder must address Shixia');
assert(rendererApp.includes('时夏在。今天想先聊两句'), 'startup greeting must use Shixia');
assert(!rendererHtml.includes('Muse & Venus'), 'visible startup branding must not use Muse & Venus');
assert(!rendererApp.includes('Athena 已经醒着'), 'startup greeting must not call the persona Athena');

console.log('persona prompt OK');
