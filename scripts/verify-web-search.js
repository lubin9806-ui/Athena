const assert = require('assert');
process.env.ATHENA_PERSONA_PROFILE = 'athena-neutral';
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

// Legacy shape: the result anchor wraps the <h2> inside a b_algoheader wrapper.
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

// Current shape as served by cn.bing.com: no b_algoheader, the result link lives in
// the <h2>, and the block opens with a b_tpcn site-attribution anchor pointing at the
// site root. Parsing the first anchor instead of the <h2> anchor silently returns
// homepages; missing the <h2> entirely returns nothing at all, which is how Bing
// degraded to zero results and left sogou as the only live provider (ATH-WEB-002).
const bingCurrentFixture = `
  <li class="b_algo" data-id iid=SERP.5326>
    <div class="b_tpcn"><a class="tilk" aria-label="news.example.com" href="https://news.example.com" h="ID=SERP,5117.1"><div class="tptt">示例新闻</div></a></div>
    <h2 class=""><a target="_blank" href="https://news.example.com/item?a=1" h="ID=SERP,5117.2"><strong>必应</strong>结果标题</a></h2>
    <div class="b_caption"><p class="b_lineclamp2">必应返回的摘要内容。</p></div>
  </li>
  <li class="b_algo">
    <h2 class=""><a href="http://127.0.0.1/private">内网结果</a></h2>
    <div class="b_caption"><p>不应返回。</p></div>
  </li>
`;
const bingCurrentSources = parseBingHtml(bingCurrentFixture, 5);
assert.strictEqual(bingCurrentSources.length, 1, 'Bing parser must read the current b_algo markup and still drop private addresses.');
assert.strictEqual(
  bingCurrentSources[0].url,
  'https://news.example.com/item?a=1',
  'Bing result URL must come from the <h2> anchor, not the site-attribution anchor.',
);
// Keyword highlighting becomes a space here, the same as in every parser above.
assert.strictEqual(bingCurrentSources[0].title, '必应 结果标题');
assert.strictEqual(bingCurrentSources[0].snippet, '必应返回的摘要内容。');

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

// ATH-CHAT-001: "刚刚" describing a pose is not a request for fresh information.
// Recency keywords cannot carry a 2000-character description on their own.
const longVisualBrief = [
  '角色五官：24岁现代东亚年轻女性，鹅蛋脸，面部轮廓柔和流畅，杏仁形深棕色眼眸，自然窄双眼皮，眼神安静克制，皮肤白皙偏暖，真实细腻肌理。',
  '服装描写：将原来的灰紫色针织上衣改为低饱和燕麦米色修身针织开衫，内搭同色系简洁方领吊带，垂坠面料，腰部结构简洁，无明显品牌标识。',
  '环境背景：场景由咖啡馆改为现代城市独立书店内的临窗阅读区，深胡桃木书架、暖灰色微水泥墙面、原木桌椅、少量绿植和陶瓷摆件。',
  '桌面放置一本翻开的摄影集、一杯白色陶瓷拿铁和一副细框眼镜，避免蛋糕与原图桌面陈设。',
  '角色 Pose：她侧身坐在靠窗的木质扶手椅上，右手握住白色咖啡杯杯耳，杯子刚刚离开桌面，视线落向窗外而不是镜头。',
  '画面关键词：cinematic lifestyle portrait, Rembrandt lighting, natural skin texture, realistic pores, photorealistic, 8K detail.',
].join('\n');
assert(longVisualBrief.length > 400);
assert.strictEqual(shouldAutoSearch(longVisualBrief), false, 'A long visual brief must not auto-search on an incidental recency word.');
assert.strictEqual(
  shouldAutoSearch(`${longVisualBrief}\n帮我联网搜索一下这种布光的名字。`),
  true,
  'An explicit search request must survive even when it trails a long description.',
);
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

// --- Contracted search API ------------------------------------------------------
const { parseZhipuResults } = require('../dist/core/web/SearchApiClient.js');

// Shape taken from the published reference: search_result[] of
// { title, content, link, media, icon, refer, publish_date }.
const zhipuFixture = {
  id: 'req-1',
  request_id: 'req-1',
  search_intent: [{ query: 'GPT-6', intent: 'SEARCH_ALL', keywords: 'GPT-6' }],
  search_result: [
    { title: '智谱返回的标题', content: '智谱返回的摘要内容。', link: 'https://news.example.cn/item?a=1', media: '示例媒体', publish_date: '2026-09-04' },
    { title: '第二条', content: '第二条摘要。', link: 'https://docs.example.cn/second', refer: 'ref_2' },
    { title: '内网地址', content: '不应返回。', link: 'http://127.0.0.1/private' },
    { title: '重复地址', content: '不应重复。', link: 'https://news.example.cn/item?a=1' },
  ],
};
const zhipuSources = parseZhipuResults(zhipuFixture, 5);
assert.strictEqual(zhipuSources.length, 2, 'Private and duplicate URLs must be dropped.');
assert.strictEqual(zhipuSources[0].title, '智谱返回的标题');
assert.strictEqual(zhipuSources[0].url, 'https://news.example.cn/item?a=1');
assert.strictEqual(zhipuSources[0].domain, 'news.example.cn');
assert.strictEqual(zhipuSources[0].snippet, '智谱返回的摘要内容。');
assert.deepStrictEqual(zhipuSources.map(source => source.id), [1, 2]);
// A renamed results field must degrade to zero rather than throw, and the client
// logs the actual keys so the break is diagnosable instead of silent.
assert.deepStrictEqual(parseZhipuResults({ results: [] }, 5), []);
assert.deepStrictEqual(parseZhipuResults(null, 5), []);
assert.deepStrictEqual(parseZhipuResults({ search_result: [{ title: '没有链接' }] }, 5), []);

async function verifyContractedApiPriority() {
  // The HTML providers are blocked at the governor, so reaching them is observable
  // without any network access.
  const blockingGovernor = {
    acquire: async provider => { if (provider !== 'zhipu') throw new Error(`BLOCKED:${provider}`); },
    cooldown: () => {},
  };
  const apiSources = [{ id: 1, title: '签约结果', url: 'https://api.example.cn/one', domain: 'api.example.cn', snippet: '来自签约 API。' }];

  const workingApi = {
    configuredProvider: () => 'zhipu',
    isConfigured: () => true,
    search: async () => apiSources,
  };
  const withApi = new WebSearchService(scriptedExtractor, blockingGovernor, workingApi);
  const viaApi = await withApi.search('测试查询', 5);
  assert.strictEqual(viaApi.provider, 'zhipu', 'A configured contracted API must lead the provider chain.');
  assert.deepStrictEqual(viaApi.providers, ['zhipu']);
  assert.strictEqual(viaApi.sources[0].title, '签约结果');
  assert.strictEqual(withApi.getDiagnostics().zhipu.successes, 1);
  assert.strictEqual(withApi.getDiagnostics().sogou.attempts, 0, 'A successful API call must not also hit the scraped providers.');

  // A failing API must degrade to the HTML chain instead of failing the whole search.
  const failingApi = {
    configuredProvider: () => 'zhipu',
    isConfigured: () => true,
    search: async () => { throw Object.assign(new Error('额度不足'), { searchFailureCode: 'rate_limited', retryAfterMs: 1_000 }); },
  };
  const degraded = new WebSearchService(scriptedExtractor, blockingGovernor, failingApi);
  await assert.rejects(() => degraded.search('测试查询', 5), /联网搜索/, 'All providers failing must still surface a degradation message.');
  const diagnostics = degraded.getDiagnostics();
  assert.strictEqual(diagnostics.zhipu.failures.rate_limited, 1, 'The API failure must be classified, not swallowed.');
  assert.ok(diagnostics.sogou.attempts >= 1 && diagnostics.bing.attempts >= 1, 'A failed API call must fall through to the scraped providers.');

  // With no key configured nothing changes for existing users.
  const unconfigured = new WebSearchService(scriptedExtractor, blockingGovernor, { configuredProvider: () => null, isConfigured: () => false, search: async () => [] });
  await assert.rejects(() => unconfigured.search('测试查询', 5), /联网搜索/);
  assert.strictEqual(unconfigured.getDiagnostics().zhipu.attempts, 0, 'An unconfigured API must never be attempted.');

  console.log('WEB_SEARCH_API_OK provider=zhipu priority=first fallback=html-chain classification=shared credential=required');
}

// --- Model-driven research loop -------------------------------------------------
// The planner writes its own queries and picks its own pages, so the budget,
// de-duplication and fallback branches are asserted offline against a scripted
// model rather than left to whatever a live provider happens to return.
const { WebResearchAgent } = require('../dist/core/web/WebResearchAgent.js');

const AGENT_SETTINGS = { enabled: true, mode: 'auto', maxResults: 5, deepRead: true, secondarySearch: true, maxPages: 3 };

function scriptedLlm(turns, { nativeToolCalls = true } = {}) {
  const seen = [];
  return {
    seen,
    capabilities: { nativeToolCalls },
    async chatWithTools(messages, tools) {
      seen.push({ toolNames: tools.map(tool => tool.name), messages: messages.length });
      const turn = turns.shift() || { content: '够了', toolCalls: [] };
      if (turn.throws) throw new Error(turn.throws);
      return {
        content: turn.content || '',
        toolCalls: (turn.toolCalls || []).map((call, index) => ({
          id: `call_${seen.length}_${index}`,
          name: call.name,
          arguments: call.arguments,
          rawArguments: JSON.stringify(call.arguments),
        })),
        finishReason: turn.toolCalls?.length ? 'tool_calls' : 'stop',
        provider: 'test',
        model: 'test',
        responseId: null,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    },
  };
}

function scriptedSearch(resultsByQuery, { fallbackContext = null } = {}) {
  const queries = [];
  const fallbacks = [];
  return {
    queries,
    fallbacks,
    async search(query) {
      queries.push(query);
      const sources = (resultsByQuery[query] || []).map((source, index) => ({ id: index + 1, snippet: '', ...source }));
      if (sources.length === 0) throw new Error(`没有可用结果：${query}`);
      return { query, provider: 'sogou', searchedAt: new Date().toISOString(), sources, pages: [], searchRounds: 1, providers: ['sogou'] };
    },
    async research(query) {
      fallbacks.push(query);
      return fallbackContext || { query, provider: 'bing', searchedAt: new Date().toISOString(), sources: [], pages: [] };
    },
  };
}

const scriptedExtractor = {
  reads: [],
  async read(source, query) {
    scriptedExtractor.reads.push({ id: source.id, url: source.url, query });
    return {
      sourceId: source.id,
      title: source.title,
      url: source.url,
      excerpt: `${source.title} 的正文摘录。`,
      charCount: 900,
      extractionMethod: 'article',
      extractedAt: new Date().toISOString(),
    };
  },
};

async function verifyResearchAgent() {
  // The model refines its own query, and the second search repeats one hit: ids stay
  // stable and the duplicate must not be numbered twice.
  const llm = scriptedLlm([
    { toolCalls: [{ name: 'web_search', arguments: { query: 'GPT-6 发布时间' } }] },
    { toolCalls: [{ name: 'read_page', arguments: { source_id: 1 } }] },
    { toolCalls: [{ name: 'web_search', arguments: { query: 'GPT-6 官方公告 原文' } }] },
    { content: '资料已经足够。', toolCalls: [] },
  ]);
  const search = scriptedSearch({
    'GPT-6 发布时间': [
      { title: '首条结果', url: 'https://a.example.com/one', domain: 'a.example.com' },
      { title: '次条结果', url: 'https://b.example.com/two', domain: 'b.example.com' },
    ],
    'GPT-6 官方公告 原文': [
      { title: '首条结果重复', url: 'https://a.example.com/one?utm_source=x', domain: 'a.example.com' },
      { title: '第三条结果', url: 'https://c.example.com/three', domain: 'c.example.com' },
    ],
  });
  const statuses = [];
  const context = await new WebResearchAgent(llm, search, scriptedExtractor).research({
    question: 'GPT-6 什么时候发布的？',
    query: 'GPT-6',
    settings: AGENT_SETTINGS,
    onStatus: status => statuses.push(status.phase),
  });

  assert.deepStrictEqual(search.queries, ['GPT-6 发布时间', 'GPT-6 官方公告 原文'], 'The planner must search its own queries, not the template ones.');
  assert.deepStrictEqual(search.fallbacks, [], 'A successful planner run must not fall back to the fixed pipeline.');
  assert.strictEqual(context.sources.length, 3, 'Repeated URLs must be de-duplicated across rounds.');
  assert.deepStrictEqual(context.sources.map(source => source.id), [1, 2, 3], 'Citation ids must stay stable and contiguous.');
  assert.strictEqual(context.searchRounds, 2);
  assert.deepStrictEqual(context.secondaryQueries, ['GPT-6 官方公告 原文'], 'Follow-up queries come from the model.');
  assert.strictEqual(context.pages.length, 1);
  assert.strictEqual(context.pages[0].sourceId, 1);
  assert.ok(statuses.includes('refining') && statuses.includes('reading'), `Expected refining and reading status, got ${statuses.join(',')}`);
  // Without a closing 'done' the status bar stays stuck on 正在搜索网页.
  assert.strictEqual(statuses.at(-1), 'done', `Planner run must close with a done status, got ${statuses.join(',')}`);

  // Budget: 二次搜索 off means exactly one search, and 深读 off must never offer read_page.
  const boundedLlm = scriptedLlm([
    { toolCalls: [{ name: 'web_search', arguments: { query: '第一次' } }] },
    { toolCalls: [{ name: 'web_search', arguments: { query: '第二次' } }] },
    { toolCalls: [{ name: 'web_search', arguments: { query: '第三次' } }] },
  ]);
  const boundedSearch = scriptedSearch({ 第一次: [{ title: '唯一结果', url: 'https://d.example.com/x', domain: 'd.example.com' }] });
  const bounded = await new WebResearchAgent(boundedLlm, boundedSearch, scriptedExtractor).research({
    question: '预算测试',
    query: '预算',
    settings: { ...AGENT_SETTINGS, secondarySearch: false, deepRead: false },
  });
  assert.deepStrictEqual(boundedSearch.queries, ['第一次'], 'secondarySearch=false must allow exactly one search.');
  assert.strictEqual(bounded.pages.length, 0);
  assert.ok(
    boundedLlm.seen.every(turn => !turn.toolNames.includes('read_page')),
    'deepRead=false must never offer read_page to the model.',
  );
  assert.ok(
    boundedLlm.seen.at(-1).toolNames.length === 0 || boundedLlm.seen.length === 1,
    'The loop must stop offering web_search once the search budget is spent.',
  );

  // A model with no native tool calling keeps the old pipeline instead of losing search.
  const legacyFallback = { query: '回退', provider: 'sogou', searchedAt: new Date().toISOString(), sources: [{ id: 1, title: '回退结果', url: 'https://e.example.com/y', domain: 'e.example.com', snippet: '' }], pages: [] };
  const legacySearch = scriptedSearch({}, { fallbackContext: legacyFallback });
  const legacy = await new WebResearchAgent(scriptedLlm([], { nativeToolCalls: false }), legacySearch, scriptedExtractor).research({
    question: '回退测试',
    query: '回退',
    settings: AGENT_SETTINGS,
  });
  assert.deepStrictEqual(legacySearch.queries, [], 'A model without native tool calls must not drive the planner loop.');
  assert.deepStrictEqual(legacySearch.fallbacks, ['回退'], 'Missing tool calling must fall back to the fixed pipeline.');
  assert.strictEqual(legacy.sources.length, 1);

  // An empty planner run must also fall back rather than answer with no evidence.
  const emptySearch = scriptedSearch({}, { fallbackContext: legacyFallback });
  const emptyRun = await new WebResearchAgent(scriptedLlm([{ content: '不搜了', toolCalls: [] }]), emptySearch, scriptedExtractor).research({
    question: '空结果测试',
    query: '回退',
    settings: AGENT_SETTINGS,
  });
  assert.deepStrictEqual(emptySearch.fallbacks, ['回退'], 'A planner run with no sources must fall back to the fixed pipeline.');
  assert.strictEqual(emptyRun.sources.length, 1);

  // An unknown evidence id is rejected without aborting the run, and the planner can
  // only read ids a provider actually served it — never a free-form URL.
  const strayLlm = scriptedLlm([
    { toolCalls: [{ name: 'web_search', arguments: { query: '正常查询' } }] },
    { toolCalls: [{ name: 'read_page', arguments: { source_id: 99 } }] },
    { content: '结束', toolCalls: [] },
  ]);
  const straySearch = scriptedSearch({ 正常查询: [{ title: '正常结果', url: 'https://f.example.com/z', domain: 'f.example.com' }] });
  const strayReads = scriptedExtractor.reads.length;
  const stray = await new WebResearchAgent(strayLlm, straySearch, scriptedExtractor).research({
    question: '越界读取测试',
    query: '正常',
    settings: AGENT_SETTINGS,
  });
  assert.strictEqual(stray.sources.length, 1, 'A rejected read must not discard the evidence already gathered.');
  assert.strictEqual(scriptedExtractor.reads.length, strayReads, 'An unknown evidence id must never reach the page extractor.');

  // A model that dies mid-loop must keep the evidence already gathered instead of
  // discarding it and repeating every search through the fixed pipeline.
  const dyingLlm = scriptedLlm([
    { toolCalls: [{ name: 'web_search', arguments: { query: '第一轮查询' } }] },
    { throws: '模型连接中断' },
  ]);
  const dyingSearch = scriptedSearch({ 第一轮查询: [{ title: '已拿到的结果', url: 'https://g.example.com/keep', domain: 'g.example.com' }] });
  const survived = await new WebResearchAgent(dyingLlm, dyingSearch, scriptedExtractor).research({
    question: '中途失败测试',
    query: '中途失败',
    settings: AGENT_SETTINGS,
  });
  assert.strictEqual(survived.sources.length, 1, 'Evidence gathered before a model failure must survive.');
  assert.strictEqual(survived.sources[0].title, '已拿到的结果');
  assert.deepStrictEqual(dyingSearch.fallbacks, [], 'Partial evidence must not trigger a full re-run of the fixed pipeline.');

  console.log('WEB_RESEARCH_AGENT_OK planner=model-driven dedupe=canonical budget=enforced fallback=fixed-pipeline read=id-only partial=kept');
}

// Exercises the contracted API for real. CredentialStore needs Electron, so this
// reads the environment directly; without a key it skips rather than pretending.
async function verifyLiveContractedApi() {
  const apiKey = (process.env.ZHIPU_API_KEY || '').trim();
  if (!apiKey) {
    console.log('WEB_SEARCH_API_LIVE_SKIPPED reason=no-ZHIPU_API_KEY');
    return;
  }
  const { SearchApiClient } = require('../dist/core/web/SearchApiClient.js');
  const client = new SearchApiClient(() => ({ provider: 'zhipu', apiKey }));
  const sources = await client.search('OpenAI 最新模型', 5);
  assert.ok(sources.length >= 1, 'The contracted API returned no usable sources.');
  for (const source of sources) {
    assert.ok(/^https?:\/\//.test(source.url), `Contracted API returned a non-http URL: ${source.url}`);
    assert.ok(source.title, 'Contracted API returned a source with no title.');
  }
  const viaService = await new WebSearchService(undefined, undefined, client).search('OpenAI 最新模型', 5);
  assert.strictEqual(viaService.provider, 'zhipu', 'A working contracted API must lead the provider chain.');
  console.log(`WEB_SEARCH_API_LIVE_OK provider=zhipu sources=${sources.length} domains=${sources.map(item => item.domain).join(',')}`);
}

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

// Proves the loop against a real model: the queries must be the model's own, not the
// caller's, and the evidence must come back numbered for citation.
async function verifyLiveResearchAgent() {
  const { LLMClient } = require('../dist/core/ai/Client.js');
  const llm = new LLMClient();
  if (!llm.capabilities.nativeToolCalls) {
    console.log('WEB_RESEARCH_AGENT_LIVE_SKIPPED reason=model-has-no-native-tool-calls');
    return null;
  }
  // The agent falls back to the fixed pipeline on any planner failure, and a fallback
  // result satisfies every shape assertion below. Count the fallbacks explicitly so a
  // silently degraded run reports as degraded instead of passing.
  const plannerQueries = [];
  const fallbacks = [];
  const observed = {
    search: (query, maxResults, onStatus, signal) => {
      plannerQueries.push(query);
      return service.search(query, maxResults, onStatus, signal);
    },
    research: (query, settings, onStatus, signal) => {
      fallbacks.push(query);
      return service.research(query, settings, onStatus, signal);
    },
  };

  const statuses = [];
  const context = await new WebResearchAgent(llm, observed).research({
    question: 'OpenAI 最近发布了什么模型？请给出可核验的来源。',
    query: 'OpenAI 最新模型',
    settings: AGENT_SETTINGS,
    onStatus: status => statuses.push(status.phase),
  });

  if (fallbacks.length > 0) {
    console.log(`WEB_RESEARCH_AGENT_LIVE_DEGRADED fallbacks=${fallbacks.length} plannerQueries=${JSON.stringify(plannerQueries)}`);
    throw new Error('The planner fell back to the fixed pipeline, so this run proves nothing about model-driven research. Check the model connection above.');
  }
  assert.ok(context.sources.length >= 1, 'Live planner returned no sources.');
  assert.deepStrictEqual(context.sources.map(source => source.id), context.sources.map((_, index) => index + 1), 'Live evidence ids must be contiguous for citation.');
  assert.ok(statuses.at(-1) !== 'failed', 'Live planner ended in a failed state.');
  assert.ok(plannerQueries.length >= 1, 'The planner issued no searches of its own.');
  console.log(`WEB_RESEARCH_AGENT_LIVE_OK searches=${context.searchRounds} sources=${context.sources.length} pages=${context.pages?.length ?? 0} modelQueries=${JSON.stringify(plannerQueries)}`);
  return context;
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
  await verifyContractedApiPriority();
  await verifyResearchAgent();
  const shouldRunLive = process.argv.includes('--live') || process.argv.includes('--llm');
  if (shouldRunLive) await verifyLiveContractedApi();
  const liveResult = shouldRunLive ? await verifyLiveSearch() : null;
  if (process.argv.includes('--llm')) {
    const plannerResult = await verifyLiveResearchAgent();
    await verifyLlmSynthesis(plannerResult || liveResult);
  }
  console.log('WEB_SEARCH_VERIFY_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
