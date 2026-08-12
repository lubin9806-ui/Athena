const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-research-tools-'));
const projectRoot = path.join(scratch, 'project');

const { ToolRegistry } = require(path.join(root, 'dist', 'core', 'agent', 'ToolRegistry.js'));
const { ProviderRequestGovernor } = require(path.join(root, 'dist', 'core', 'web', 'WebSearchService.js'));
const {
  GitHubResearchService,
  ProjectAnalysisService,
  ResearchAgentToolBridge,
} = require(path.join(root, 'dist', 'core', 'integrations'));

(async () => {
  const requests = [];
  process.env.ATHENA_GITHUB_TEST_TOKEN = 'github-test-secret-value';
  const github = new GitHubResearchService({
    tokenEnvironmentVariable: 'ATHENA_GITHUB_TEST_TOKEN',
    now: () => Date.parse('2026-08-12T04:00:00.000Z'),
    fetcher: async (url, init) => {
      requests.push({ url: String(url), headers: { ...init.headers } });
      const pathname = new URL(url).pathname;
      if (pathname === '/search/repositories') return jsonResponse(searchFixture(), 200, rateHeaders(58));
      if (pathname === '/repos/openai/openai-node') return jsonResponse(repositoryFixture(), 200, rateHeaders(57));
      if (pathname === '/repos/openai/openai-node/readme') return jsonResponse({
        name: 'README.md',
        path: 'README.md',
        html_url: 'https://github.com/openai/openai-node/blob/master/README.md',
        encoding: 'base64',
        content: Buffer.from('# OpenAI Node\nOfficial library.').toString('base64'),
      }, 200, rateHeaders(56));
      return jsonResponse({ message: 'Not Found' }, 404, rateHeaders(55));
    },
  });
  const search = await github.searchRepositories({ query: 'local first assistant', sort: 'stars' }, new AbortController().signal);
  assert.equal(search.repositories.length, 1);
  assert.equal(search.repositories[0].fullName, 'openai/openai-node');
  assert.match(search.sourceUrl, /api\.github\.com\/search\/repositories/);
  assert.match(search.sourceUrl, /fork%3Afalse/);
  assert.equal(search.rateLimit.remaining, 58);
  assert.equal(requests[0].headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.equal(requests[0].headers.Authorization, 'Bearer github-test-secret-value');
  assert.equal(requests[0].headers.Authorization.includes('github-test-secret-value'), true);
  assert.doesNotMatch(JSON.stringify(search), /github-test-secret-value/);

  const noRateHeaders = new GitHubResearchService({ fetcher: async () => jsonResponse(searchFixture(), 200, {}) });
  const noRateEvidence = await noRateHeaders.searchRepositories({ query: 'test' }, new AbortController().signal);
  assert.equal(noRateEvidence.rateLimit.remaining, null, 'missing rate-limit headers must not be reported as zero');

  const detail = await github.getRepository('openai', 'openai-node', true, new AbortController().signal);
  assert.equal(detail.repository.license, 'Apache-2.0');
  assert.match(detail.readme.text, /Official library/);
  assert.equal(detail.readme.htmlUrl, 'https://github.com/openai/openai-node/blob/master/README.md');
  await assert.rejects(() => github.getRepository('..', 'escape', true, new AbortController().signal), /invalid/);
  delete process.env.ATHENA_GITHUB_TEST_TOKEN;

  const redirected = new GitHubResearchService({
    fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/collect' } }),
  });
  await assert.rejects(() => redirected.searchRepositories({ query: 'test' }, new AbortController().signal), /escaped the approved origin/);

  const governor = new ProviderRequestGovernor();
  await governor.acquire('bing');
  const cancelledGovernor = new AbortController();
  cancelledGovernor.abort(new Error('research cancelled'));
  await assert.rejects(() => governor.acquire('bing', Date.now(), cancelledGovernor.signal), /research cancelled/);

  let rateFetches = 0;
  const rateLimited = new GitHubResearchService({
    now: () => Date.parse('2026-08-12T04:00:00.000Z'),
    fetcher: async () => {
      rateFetches += 1;
      return jsonResponse({ message: 'rate limit exceeded' }, 429, { ...rateHeaders(0), 'retry-after': '120' });
    },
  });
  await assert.rejects(() => rateLimited.searchRepositories({ query: 'test' }, new AbortController().signal), /GitHub API 429/);
  await assert.rejects(() => rateLimited.searchRepositories({ query: 'test' }, new AbortController().signal), /rate limited until/);
  assert.equal(rateFetches, 1, 'rate-limited GitHub calls must stop before another network request');

  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'fixture-project',
    private: true,
    scripts: { test: 'node test.js', build: 'tsc' },
    dependencies: { typescript: '^5.9.0' },
  }, null, 2));
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Fixture Project\nCurrent milestone: playable prototype.');
  fs.mkdirSync(path.join(projectRoot, 'src'));
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.ts'), 'export const ready = true;\n');
  initializeGitRepository(projectRoot);

  const projectAnalysis = new ProjectAnalysisService();
  const inspection = await projectAnalysis.inspect([projectRoot], {}, new AbortController().signal);
  assert.equal(inspection.roots[0].status, 'inspected');
  assert.equal(inspection.roots[0].manifests[0].summary.name, 'fixture-project');
  assert.deepEqual(inspection.roots[0].manifests[0].summary.scripts, ['build', 'test']);
  assert.match(inspection.roots[0].readme.text, /playable prototype/);
  assert.match(inspection.roots[0].git.recentCommits, /initial fixture/);
  await assert.rejects(() => projectAnalysis.inspect([projectRoot], { rootIndex: 1 }, new AbortController().signal), /outside the registered/);

  const registry = new ToolRegistry();
  let webConsent = false;
  let readPermission = true;
  const webSearch = {
    research: async (query) => ({
      query,
      provider: 'duckduckgo',
      searchedAt: '2026-08-12T04:00:00.000Z',
      sources: [{ id: 1, title: 'Evidence', url: 'https://example.com/evidence', domain: 'example.com', snippet: 'Fixture' }],
      pages: [],
    }),
  };
  const bridge = new ResearchAgentToolBridge({
    registry,
    webSearch,
    getWebSearchSettings: () => ({ enabled: true, mode: 'auto', maxResults: 6, deepRead: true, secondarySearch: true, maxPages: 3 }),
    canUseWebSearch: () => webConsent,
    canInspectProject: () => readPermission,
    resolveProjectRoots: runId => {
      assert.equal(runId, 'run-fixture');
      return [projectRoot];
    },
    github,
    projectAnalysis,
  });
  assert.deepEqual(bridge.refresh(), ['project_inspect']);
  webConsent = true;
  assert.deepEqual(bridge.refresh(), ['github_get_repository', 'github_search_repositories', 'project_inspect', 'web_research']);

  const projectResult = await execute(registry, 'project_inspect', {}, 'run-fixture');
  assert.equal(projectResult.status, 'completed');
  assert.match(projectResult.content, /Local Project evidence/);
  const webResult = await execute(registry, 'web_research', { query: 'current evidence' }, 'run-fixture');
  assert.match(webResult.content, /External evidence/);
  assert.deepEqual(webResult.metadata.sourceUrls, ['https://example.com/evidence']);

  const resolvedGitHub = registry.resolve(call('github_search_repositories', { query: 'assistant' }));
  assert.equal(resolvedGitHub.policy.access, 'network');
  assert.equal(resolvedGitHub.policy.riskLevel, 'medium');
  webConsent = false;
  await assert.rejects(() => registry.executeResolved(
    call('github_search_repositories', { query: 'assistant' }),
    resolvedGitHub,
    context('run-fixture'),
  ), /consent was revoked/);
  readPermission = false;
  const resolvedProject = registry.resolve(call('project_inspect', {}));
  await assert.rejects(() => registry.executeResolved(call('project_inspect', {}), resolvedProject, context('run-fixture')), /permission was revoked/);
  assert.deepEqual(bridge.refresh(), [], 'revoked consent and read permission must remove research tools');
  bridge.shutdown();

  const controller = fs.readFileSync(path.join(root, 'src', 'core', 'controller', 'AthenaController.ts'), 'utf8');
  const privacy = fs.readFileSync(path.join(root, 'src', 'core', 'privacy', 'PrivacyDataService.ts'), 'utf8');
  const projectSource = fs.readFileSync(path.join(root, 'src', 'core', 'integrations', 'ProjectAnalysisService.ts'), 'utf8');
  assert.match(controller, /this\.researchTools\.refresh\(\)/, 'execution and resume paths must refresh research availability');
  assert.match(privacy, /api\.github\.com/, 'privacy notice must name the GitHub API destination');
  assert.doesNotMatch(projectSource, /env:\s*\{\s*\.\.\.process\.env/, 'project Git inspection must not inherit secret-bearing process environment');
  const webSource = fs.readFileSync(path.join(root, 'src', 'core', 'web', 'WebSearchService.ts'), 'utf8');
  assert.doesNotMatch(webSource, /redirect:\s*'follow'/, 'search providers must not follow unvalidated redirects');
  console.log('ATHENA_RESEARCH_TOOLS_OK github=official-api web=native-tool project=roots-only rate_limit=halted evidence=sourced');
})().finally(() => {
  delete process.env.ATHENA_GITHUB_TEST_TOKEN;
  fs.rmSync(scratch, { recursive: true, force: true });
}).catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});

function execute(registry, name, args, runId) {
  const modelCall = call(name, args);
  const resolved = registry.resolve(modelCall);
  return registry.executeResolved(modelCall, resolved, context(runId));
}

function call(name, args) {
  return { id: `call-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) };
}

function context(runId) {
  return {
    runId,
    stepId: 'step-fixture',
    callId: 'call-fixture',
    attempt: 1,
    idempotencyKey: 'research-fixture',
    signal: new AbortController().signal,
  };
}

function jsonResponse(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function rateHeaders(remaining) {
  return {
    'x-ratelimit-limit': '60',
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(Math.floor(Date.parse('2026-08-12T05:00:00.000Z') / 1000)),
    'x-ratelimit-resource': 'search',
  };
}

function searchFixture() {
  return { total_count: 1, incomplete_results: false, items: [repositoryFixture()] };
}

function repositoryFixture() {
  return {
    full_name: 'openai/openai-node',
    description: 'Official JavaScript library',
    html_url: 'https://github.com/openai/openai-node',
    stargazers_count: 10000,
    forks_count: 1000,
    open_issues_count: 100,
    language: 'TypeScript',
    topics: ['openai', 'typescript'],
    license: { spdx_id: 'Apache-2.0' },
    archived: false,
    fork: false,
    default_branch: 'master',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    pushed_at: '2026-08-01T00:00:00Z',
    homepage: 'https://www.npmjs.com/package/openai',
    visibility: 'public',
    size: 12345,
    subscribers_count: 250,
  };
}

function initializeGitRepository(directory) {
  const options = { cwd: directory, stdio: 'ignore' };
  childProcess.execFileSync('git', ['init'], options);
  childProcess.execFileSync('git', ['config', 'user.name', 'Athena Test'], options);
  childProcess.execFileSync('git', ['config', 'user.email', 'athena-test@example.invalid'], options);
  childProcess.execFileSync('git', ['add', 'package.json', 'README.md', 'src/index.ts'], options);
  childProcess.execFileSync('git', ['commit', '-m', 'initial fixture'], options);
}
