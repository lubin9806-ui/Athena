const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-persona-config-test-'));
process.env.ATHENA_CONFIG_DIR = testConfigDir;
const { buildChatPrompt, buildSystemPrompt } = require(path.join(root, 'dist/core/ai/PromptBuilder.js'));
const { getPersonaEditorState, importPersonaCardFromFile, resolvePersonaCard, savePersonaCard } = require(path.join(root, 'dist/core/ai/Personality.js'));

const emptyContext = {
  profileFacts: [],
  projectNotes: [],
  relatedEvents: [],
  recentMessages: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function identityPromptFor(profileId) {
  return buildChatPrompt({
    userMessage: '你是谁，介绍一下你自己',
    recentMessages: [],
    retrievedContext: emptyContext,
    personaProfileId: profileId,
  })[0].content;
}

const neutralPersona = resolvePersonaCard('athena-neutral');
const neutralPrompt = buildSystemPrompt(undefined, neutralPersona);
const neutralIdentityPrompt = identityPromptFor('athena-neutral');

assert(neutralPersona.id === 'athena-neutral', 'public fallback persona must be athena-neutral');
assert(neutralPrompt.includes('你的名字是 Athena'), 'public prompt must name Athena');
assert(neutralPrompt.includes('发布版默认不携带开发者私人记忆'), 'public prompt must include the release privacy boundary');
assert(neutralPrompt.includes('用户可以通过角色卡自定义身份'), 'public prompt must describe custom persona cards');
assert(neutralIdentityPrompt.includes('我叫 Athena'), 'public identity scene must reinforce neutral introduction');
assert(!neutralPrompt.includes('苏时夏'), 'public prompt must not contain the private persona name');
assert(!neutralPrompt.includes('Su Shixia'), 'public prompt must not contain the private romanized persona name');

const rendererHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const rendererApp = fs.readFileSync(path.join(root, 'src/renderer/app.ts'), 'utf8');
assert(rendererHtml.includes('setting-persona-profile'), 'settings UI must expose the persona card profile entry');
assert(rendererHtml.includes('persona-display-name'), 'settings UI must expose persona display name editing');
assert(rendererHtml.includes('persona-speaking-style'), 'settings UI must expose persona speaking-style editing');
assert(!rendererHtml.includes('Muse & Venus'), 'visible startup branding must not use Muse & Venus');
assert(!rendererHtml.includes('苏时夏'), 'renderer HTML must not hard-code the private persona name');
assert(!rendererApp.includes('苏时夏'), 'renderer app must not hard-code the private persona name');
assert(!rendererApp.includes('Su Shixia'), 'renderer app must not hard-code the private romanized persona name');

const tempPersonaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-persona-test-'));
process.env.ATHENA_PERSONA_DIR = tempPersonaDir;
const saved = savePersonaCard('test-card', {
  displayName: 'Test Persona',
  nickname: 'Tester',
  description: 'Temporary test card',
  identity: 'A temporary local test persona.',
  relationshipFrame: 'A test-only assistant relationship.',
  traits: ['precise', 'short'],
  speakingStyle: ['plain'],
  roleplayNotes: ['test mode only'],
  boundaries: ['do not leak private cards'],
  selfIntroductionExample: 'I am Test Persona.',
});
const reloaded = getPersonaEditorState('test-card');
assert(fs.existsSync(path.join(tempPersonaDir, 'test-card.persona.json')), 'persona save must write a local persona card file');
assert(saved.card.displayName === 'Test Persona', 'persona save must return the saved card');
assert(reloaded.card.displayName === 'Test Persona', 'persona editor state must reload the saved card');

const looseImportPath = path.join(tempPersonaDir, 'loose-persona.json');
fs.writeFileSync(looseImportPath, JSON.stringify({
  name: 'Imported Persona',
  nickname: 'Importer',
  identity: 'Imported from a plain JSON persona file.',
  relationship: 'Test import relationship.',
  traits: ['adaptable', 'local'],
  speakingStyle: ['clear'],
  roleplayNotes: ['import test'],
  boundaries: ['test boundary'],
  selfIntro: 'I am Imported Persona.',
}, null, 2));
const imported = importPersonaCardFromFile('imported-card', looseImportPath);
assert(fs.existsSync(path.join(tempPersonaDir, 'imported-card.persona.json')), 'persona import must write the selected profile card file');
assert(imported.card.displayName === 'Imported Persona', 'persona import must map loose name fields');
assert(imported.card.identity.includes('plain JSON'), 'persona import must map loose identity fields');
assert(imported.card.prompt.traits.includes('adaptable'), 'persona import must map loose traits');

const nestedImportPath = path.join(tempPersonaDir, 'nested-character-card.json');
fs.writeFileSync(nestedImportPath, `\uFEFF${JSON.stringify({
  spec: 'chara_card_v2',
  data: {
    char_name: 'Nested Persona',
    description: 'Nested card description.',
    personality: 'curious\nwarm',
    scenario: 'A desktop companion imported from a nested character card.',
    first_mes: 'Hello from a nested card.',
    mes_example: '<START>\nuser: hi\nchar: hello',
    system_prompt: 'Speak naturally.',
    tags: ['nested', 'character-card'],
  },
}, null, 2)}`, 'utf8');
const nested = importPersonaCardFromFile('nested-card', nestedImportPath);
assert(nested.card.displayName === 'Nested Persona', 'persona import must map nested char_name fields');
assert(nested.card.identity.includes('Nested card description'), 'persona import must map nested description fields');
assert(nested.card.prompt.traits.includes('curious'), 'persona import must split nested personality text');
assert(nested.card.prompt.selfIntroductionExample === 'Hello from a nested card.', 'persona import must map first_mes');

const adultFixturePath = path.join(root, 'docs/persona-import-fixtures/18plus-companion-character-card.json');
const adultFixture = importPersonaCardFromFile('adult-fixture-card', adultFixturePath);
assert(adultFixture.card.displayName === 'Mira Vale', 'persona import must map the 18+ fixture name');
assert(adultFixture.card.identity.includes('adult local desktop companion'), 'persona import must map the 18+ fixture identity');
assert(adultFixture.card.relationshipFrame.includes('18+ mode'), 'persona import must map the 18+ fixture scenario');
assert(adultFixture.card.prompt.traits.includes('consent-aware'), 'persona import must split the 18+ fixture personality text');

const genericImportPath = path.join(tempPersonaDir, 'unknown-format.json');
fs.writeFileSync(genericImportPath, JSON.stringify({
  bundle: {
    blocks: [
      { label: 'headline', content: 'Unknown Format Persona' },
      { label: 'core', content: 'This file uses arbitrary keys but still contains a usable adult companion persona description.' },
      { label: 'voice', content: 'Warm, direct, playful, and clear.' },
    ],
  },
}, null, 2));
const generic = importPersonaCardFromFile('generic-card', genericImportPath);
assert(generic.card.displayName === 'unknown-format', 'generic persona import must fall back to the file name');
assert(generic.card.identity.includes('adult companion persona'), 'generic persona import must collect arbitrary string content');
delete process.env.ATHENA_PERSONA_DIR;

const privateCardPath = path.join(root, 'personality', 'private', 'default.persona.json');
if (fs.existsSync(privateCardPath)) {
  process.env.ATHENA_PERSONA_FILE = privateCardPath;
  const privatePersona = resolvePersonaCard('default');
  const privatePrompt = buildSystemPrompt(undefined, privatePersona);
  const privateIdentityPrompt = identityPromptFor('default');
  assert(privatePersona.visibility === 'private', 'local owner persona must be marked private');
  assert(privatePrompt.includes('你的名字是 苏时夏'), 'private prompt must load the owner persona card');
  assert(privatePrompt.includes('我叫苏时夏，叫我时夏就好'), 'private self-introduction example must be interpolated');
  assert(privateIdentityPrompt.includes('我叫苏时夏，叫我时夏就好'), 'private identity scene must reinforce the intended introduction');
}

console.log('persona prompt OK');
