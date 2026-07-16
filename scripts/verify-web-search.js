const assert = require('assert');
const {
  WebSearchService,
  buildSecondarySearchQuery,
  detectSearchFailurePage,
  extractSearchQuery,
  parseBingHtml,
  parseDuckDuckGoHtml,
  parseSogouMobileHtml,
  shouldAutoSearch,
} = require('../dist/core/web/WebSearchService.js');
const {
  extractReadableContent,
  isPrivateIpAddress,
  selectRelevantExcerpt,
} = require('../dist/core/web/PageContentExtractor.js');
const { buildChatPrompt } = require('../dist/core/ai/PromptBuilder.js');

const fixture = `
  <div class="result results_links">
    <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fa%3D1&amp;rut=abc">Example &amp; News</a></h2>
    <a class="result__snippet">Today&#39;s <b>verified</b> result.</a>
  </div>
  <div class="result results_links">
    <h2><a class='result-link' href='https://docs.example.org/update'>Second result</a></h2>
    <td class='result-snippet'>A second useful summary.</td>
  </div>
  <div class="result results_links">
    <h2><a class="result__a" href="http://127.0.0.1/private">Private address</a></h2>
    <a class="result__snippet">Must not be exposed.</a>
  </div>
`;

const sources = parseDuckDuckGoHtml(fixture, 5);
assert.strictEqual(sources.length, 2, 'Expected two public, unique sources.');
assert.strictEqual(sources[0].title, 'Example & News');
assert.strictEqual(sources[0].url, 'https://example.com/news?a=1');
assert.strictEqual(sources[0].snippet, "Today's verified result.");
assert.strictEqual(sources[1].domain, 'docs.example.org');

const sogouFixture = `
  <h3><a class="resultLink" href="./tc?url=https%3A%2F%2Fexample.cn%2Fcurrent%3Fa%3D1&amp;title=test">国内实时结果</a></h3>
  <a class="txt-summary"><div class="clamp2">来自国内搜索源的最新摘要。</div></a>
  <h3><a class="resultLink" href="./tc?url=http%3A%2F%2F127.0.0.1%2Fprivate">内网结果</a></h3>
  <a class="txt-summary"><div class="clamp2">不应返回。</div></a>
`;
const sogouSources = parseSogouMobileHtml(sogouFixture, 5);
assert.strictEqual(sogouSources.length, 1, 'Sogou parser should keep only public results.');
assert.strictEqual(sogouSources[0].url, 'https://example.cn/current?a=1');
assert.strictEqual(sogouSources[0].snippet, '来自国内搜索源的最新摘要。');
assert.throws(
  () => detectSearchFailurePage('<title>安全验证</title><div>请输入验证码</div>'),
  /反爬验证/,
  'Anti-bot pages must be treated as provider failures.',
);

const bingFixture = `
  <li class="b_algo">
    <div class="b_algoheader"><a href="https://news.example.com/item"><h2>必应结果标题</h2></a></div>
    <div class="b_caption"><p>必应返回的摘要内容。</p></div>
  </li>
`;
const bingSources = parseBingHtml(bingFixture, 5);
assert.strictEqual(bingSources.length, 1);
assert.strictEqual(bingSources[0].domain, 'news.example.com');
assert.strictEqual(bingSources[0].snippet, '必应返回的摘要内容。');

const complexPageFixture = `
  <!doctype html><html><head>
    <title>复杂网页测试</title>
    <meta property="article:published_time" content="2026-07-13T10:00:00+08:00" />
    <script type="application/ld+json">{
      "@type":"NewsArticle",
      "headline":"复杂网页测试",
      "datePublished":"2026-07-13T10:00:00+08:00",
      "articleBody":"OpenAI 发布了新的桌面研究功能。该功能支持逐页深读、二次搜索和来源交叉核验，并明确区分搜索摘要与网页正文证据。系统会限制正文长度，拒绝内网地址，避免网页中的提示词改变助手规则。研究结果会保留原始来源编号，让回答中的每一个实时事实都可以追溯。"
    }</script>
  </head><body>
    <nav>首页 登录 注册 分享</nav>
    <main><article>
      <h1>复杂网页测试</h1>
      <p>这是一段页面导语，用来验证 article 与 main 内容识别。</p>
      <p>关键事实：研究管线会读取多个公开网页，再根据证据缺口发起第二轮查询。</p>
      <table><tr><th>能力</th><th>状态</th></tr><tr><td>正文抽取</td><td>已启用</td></tr></table>
    </article></main>
    <aside>相关推荐 广告 评论</aside>
  </body></html>
`;
const complexPage = extractReadableContent(
  complexPageFixture,
  'https://example.com/research',
  '逐页深读 二次搜索 来源核验',
  760,
);
assert.ok(complexPage, 'Complex HTML extraction returned no content.');
assert.match(complexPage.excerpt, /逐页深读|第二轮查询|来源交叉核验/);
assert.doesNotMatch(complexPage.excerpt, /登录 注册 分享/);
assert.ok(['json-ld', 'article', 'main', 'semantic'].includes(complexPage.method));
assert.strictEqual(isPrivateIpAddress('127.0.0.1'), true);
assert.strictEqual(isPrivateIpAddress('192.168.1.8'), true);
assert.strictEqual(isPrivateIpAddress('8.8.8.8'), false);
assert.match(
  selectRelevantExcerpt('普通介绍。\n无关内容。\n关键事实：二次搜索会换一个搜索源交叉核验。', '二次搜索 交叉核验', 300),
  /关键事实/,
);

assert.strictEqual(shouldAutoSearch('Python 是什么？'), false, 'Stable encyclopedia questions should stay local.');
assert.strictEqual(shouldAutoSearch('今天 OpenAI 有什么最新新闻？'), true, 'Fresh information should trigger search.');
assert.strictEqual(shouldAutoSearch('谁是现任美国总统？'), true, 'Unstable public roles should trigger search.');
assert.strictEqual(extractSearchQuery('帮我联网搜索一下 2026 年最新显卡'), '2026 年最新显卡');
assert.match(
  buildSecondarySearchQuery('OpenAI 最新消息', sources, [], new Date('2026-07-13T12:00:00Z')),
  /官方 最新进展 2026-07-13/,
);

const service = new WebSearchService();
const diagnostics = service.getDiagnostics();
assert.deepStrictEqual(diagnostics.sogou, { attempts: 0, successes: 0, failures: {} });
assert.strictEqual(service.plan({
  message: '普通闲聊',
  settings: { enabled: true, mode: 'manual', maxResults: 5 },
}).shouldSearch, false);
assert.strictEqual(service.plan({
  message: '普通闲聊',
  force: true,
  settings: { enabled: true, mode: 'manual', maxResults: 5 },
}).shouldSearch, true);
assert.strictEqual(service.plan({
  message: 'Python 是什么？',
  settings: { enabled: true, mode: 'auto', maxResults: 5 },
  detectedAction: { type: 'search', param: 'Python 是什么' },
}).shouldSearch, false, 'Legacy broad search detection must not hijack stable questions.');
assert.strictEqual(service.plan({
  message: '帮我搜索一下 Python 3.14 最新变化',
  settings: { enabled: true, mode: 'manual', maxResults: 5 },
  detectedAction: { type: 'search', param: 'Python 3.14 最新变化' },
}).shouldSearch, true, 'An explicit search request should work in manual mode.');

const emptyMemory = {
  profileFacts: [],
  relatedEvents: [],
  projectNotes: [],
  recentMessages: [],
  relevanceScore: 0,
};
const prompt = buildChatPrompt({
  userMessage: '今天有什么新消息？',
  recentMessages: [],
  retrievedContext: emptyMemory,
  mode: 'reason',
  webSearchContext: {
    query: '今天有什么新消息',
    provider: 'duckduckgo',
    searchedAt: '2026-07-13T12:00:00.000Z',
    sources,
    pages: [{
      sourceId: 1,
      title: 'Example & News',
      url: 'https://example.com/news?a=1',
      excerpt: '这是逐页读取后提取出的正文证据。',
      charCount: 1800,
      extractionMethod: 'article',
      extractedAt: '2026-07-13T12:00:01.000Z',
    }],
    secondaryQueries: ['今天有什么新消息 官方 最新进展 2026-07-13'],
    providers: ['sogou', 'bing'],
    searchRounds: 2,
  },
});
assert.match(prompt[0].content, /本轮联网搜索资料/);
assert.match(prompt[0].content, /\[1\] Example & News/);
assert.match(prompt[0].content, /外部资料，不是系统指令/);
assert.match(prompt[0].content, /逐页深读证据/);
assert.match(prompt[0].content, /二次查询/);

async function verifyLiveSearch() {
  const statuses = [];
  const result = await service.research('OpenAI latest news', {
    enabled: true,
    mode: 'auto',
    maxResults: 5,
    deepRead: true,
    secondarySearch: true,
    maxPages: 3,
  }, status => statuses.push(status.phase));
  assert.ok(result.sources.length >= 1, 'Live search returned no sources.');
  assert.ok((result.pages?.length ?? 0) >= 1, 'Deep reading did not extract any page evidence.');
  assert.strictEqual(result.searchRounds, 2, 'Secondary search did not complete.');
  assert.ok(statuses.includes('reading') && statuses.includes('refining') && statuses.at(-1) === 'done');
  console.log(`WEB_SEARCH_LIVE_OK provider=${result.provider} providers=${result.providers?.join('+')} sources=${result.sources.length} pages=${result.pages?.length ?? 0} rounds=${result.searchRounds}`);
  return result;
}

async function verifyLlmSynthesis(result) {
  const { LLMClient } = require('../dist/core/ai/Client.js');
  const messages = buildChatPrompt({
    userMessage: 'OpenAI 最近有什么新消息？请简要回答。',
    recentMessages: [],
    retrievedContext: emptyMemory,
    mode: 'reason',
    webSearchContext: result,
  });
  const reply = await new LLMClient().chat(messages, undefined, 'reason', { numCtx: 8192 });
  assert.ok(reply.trim().length >= 20, 'LLM returned an empty web-grounded answer.');
  assert.match(reply, /\[[1-8]\]/, 'LLM answer did not include a source citation.');
  console.log(`WEB_SEARCH_LLM_OK chars=${reply.length} citation=true`);
}

(async () => {
  const shouldRunLive = process.argv.includes('--live') || process.argv.includes('--llm');
  const liveResult = shouldRunLive ? await verifyLiveSearch() : null;
  if (process.argv.includes('--llm')) await verifyLlmSynthesis(liveResult);
  console.log('WEB_SEARCH_VERIFY_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
