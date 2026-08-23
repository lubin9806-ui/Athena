const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.join(ROOT, 'assets', 'avatar', 'su-shixia-live2d-v2');
const REVIEW_ROOT = path.join(PACKAGE_ROOT, 'source', 'review');
const DASHBOARD_PATH = path.join(REVIEW_ROOT, 'su-shixia-live2d-v2-review-dashboard.html');
const GITHUB_SCAN_PATH = path.join(ROOT, 'docs', 'quality', 'su-shixia-github-reference-scan.json');

const GITHUB_REFERENCES = [
  {
    repo: 'Live2D/CubismWebSamples',
    url: 'https://github.com/Live2D/CubismWebSamples',
    license: 'NOASSERTION',
    stars: 387,
    pushedAt: '2026-04-02T02:28:14Z',
    use: 'Official package shape, motion group layout, Cubism Web runtime expectations.',
    boundary: 'Use as structural reference only; do not copy sample character assets into Su Shixia.',
  },
  {
    repo: 'Live2D/CubismNativeSamples',
    url: 'https://github.com/Live2D/CubismNativeSamples',
    license: 'NOASSERTION',
    stars: 237,
    pushedAt: '2026-04-02T02:25:54Z',
    use: 'Cross-runtime confirmation for model, motion, physics, texture, and export package layout.',
    boundary: 'Native runtime is not Athena desktop renderer; keep implementation in the existing Web/Electron path.',
  },
  {
    repo: 'guansss/pixi-live2d-display',
    url: 'https://github.com/guansss/pixi-live2d-display',
    license: 'MIT',
    stars: 1495,
    pushedAt: '2024-08-20T04:41:10Z',
    use: 'Pixi display, hit-test, expression, and motion playback patterns for desktop interaction.',
    boundary: 'Useful runtime reference; still requires Live2D Cubism Core licensing review before distribution.',
  },
  {
    repo: 'DenchiSoft/VTubeStudio',
    url: 'https://github.com/DenchiSoft/VTubeStudio',
    license: 'MIT',
    stars: 1274,
    pushedAt: '2026-08-12T17:22:32Z',
    use: 'Triggering, tracking, and parameter-control workflow ideas for model-driven reactions.',
    boundary: 'Workflow reference only; no VTube Studio app assets or API assumptions in the core package.',
  },
  {
    repo: 'shinshin86/live2d-add-motion-sample-web-ui',
    url: 'https://github.com/shinshin86/live2d-add-motion-sample-web-ui',
    license: 'MIT',
    stars: 121,
    pushedAt: '2026-07-13T13:39:41Z',
    use: 'Engineering reference for adding motion JSON definitions to an existing model package.',
    boundary: 'Borrow the workflow concept; authored Su Shixia motion data remains local to Athena.',
  },
  {
    repo: 'emilianavt/OpenSeeFace',
    url: 'https://github.com/emilianavt/OpenSeeFace',
    license: 'BSD-2-Clause',
    stars: 2034,
    pushedAt: '2025-12-28T11:52:30Z',
    use: 'Optional future face and landmark tracking input source for gaze, blink, and expression parameters.',
    boundary: 'Not needed for the current Lite preview; do not add as a dependency until a camera feature is explicitly scoped.',
  },
  {
    repo: 'Inochi2D/inochi2d',
    url: 'https://github.com/Inochi2D/inochi2d',
    license: 'BSD-2-Clause',
    stars: 1771,
    pushedAt: '2026-08-01T20:34:43Z',
    use: 'Useful contrast for open 2D rigging concepts and parameterized puppet design.',
    boundary: 'Not a Cubism replacement for Athena V2; genuine Cubism export remains the target.',
  },
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const sourceReview = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.reviewReport));
  const runtimeQa = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport));
  const deliveryAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-live2d-v2-delivery-audit.json'));
  const exportAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-export-audit.json'));
  const runtimeProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-runtime-proof.json'));

  const githubScan = {
    version: 1,
    generatedAt: '2026-08-24',
    source: 'GitHub API snapshot plus repository review notes',
    packageId: manifest.id,
    status: 'reference_scan_ready',
    repositories: GITHUB_REFERENCES,
    adoptedDecisions: [
      'Keep official Live2D samples as package and timing references, not copied assets.',
      'Use Pixi and VTube Studio ecosystem ideas for hit-test, motion trigger, and parameter-control design.',
      'Keep face-tracking and alternate rigging ecosystems as future research, not current dependencies.',
      'Do not claim a genuine Cubism default until Editor export and Cubism Web proof replace the current Lite preview.',
    ],
  };
  writeJson(GITHUB_SCAN_PATH, githubScan);

  const imageBoards = [
    board('Source alignment', manifest.sourceArt.alignmentPreview, 'Default-state source placement and target review.'),
    board('Display scale', manifest.sourceArt.scalePreview, 'Full-body readability at chat, overlay, pet, and compact sizes.'),
    board('Parts sheet', manifest.sourceArt.partsContactSheet, 'Named transparent source parts and layer-slice coverage.'),
    board('Motion QA', manifest.sourceArt.runtimeVisualQaContactSheet, 'Lite preview motion frames and touch reactions.'),
    board('Appearance QA', manifest.sourceArt.appearanceVisualQaContactSheet, 'Preview-only hair, eye, outfit tint, and hair-clip variants.'),
  ];

  const html = `<!doctype html>
<html lang="en" data-su-shixia-review-dashboard="v1">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Su Shixia Live2D V2 Review Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2430;
      --muted: #606779;
      --line: #d8dce5;
      --paper: #f7f8fb;
      --panel: #ffffff;
      --go: #147a43;
      --partial: #9a6500;
      --no: #ad2831;
      --blue: #2f5d9e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: var(--paper);
      line-height: 1.5;
    }
    header {
      padding: 28px 32px 18px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    main {
      max-width: 1380px;
      margin: 0 auto;
      padding: 24px 32px 40px;
    }
    h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: 0; }
    h1 { font-size: 26px; }
    h2 { font-size: 18px; margin-bottom: 12px; }
    h3 { font-size: 14px; }
    p { margin: 6px 0 0; color: var(--muted); }
    section {
      margin-top: 24px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    th { color: var(--muted); font-weight: 650; background: #f1f3f8; }
    code {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 12px;
      color: #26324a;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 10px;
      border: 1px solid var(--line);
      background: #fff;
      font-size: 12px;
      color: var(--muted);
    }
    .status-go { color: var(--go); font-weight: 700; }
    .status-partial { color: var(--partial); font-weight: 700; }
    .status-no_go, .status-no-go { color: var(--no); font-weight: 700; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .board {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 14px;
      min-width: 0;
    }
    .board img {
      display: block;
      width: 100%;
      max-height: 620px;
      object-fit: contain;
      margin-top: 10px;
      background:
        linear-gradient(45deg, #eceff5 25%, transparent 25%),
        linear-gradient(-45deg, #eceff5 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #eceff5 75%),
        linear-gradient(-45deg, transparent 75%, #eceff5 75%);
      background-size: 18px 18px;
      background-position: 0 0, 0 9px, 9px -9px, -9px 0;
      border: 1px solid var(--line);
    }
    .blockers {
      columns: 2 320px;
      padding-left: 18px;
      margin: 8px 0 0;
      color: var(--ink);
    }
    .blockers li { break-inside: avoid; margin-bottom: 6px; }
    .note {
      border-left: 3px solid var(--blue);
      background: #fff;
      padding: 10px 12px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      h1 { font-size: 22px; }
      th, td { font-size: 12px; padding: 8px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Su Shixia Live2D V2 Review Dashboard</h1>
    <p>Static local review board for source art, Lite runtime motion, wardrobe preview, GitHub reference scan, and delivery Go/No-Go state.</p>
    <div class="meta">
      <span class="pill">Package <code>${escapeHtml(manifest.id)}</code></span>
      <span class="pill">Generated <code>2026-08-24</code></span>
      <span class="pill">Overall <span class="status-${escapeHtml(deliveryAudit.status)}">${escapeHtml(deliveryAudit.status.toUpperCase())}</span></span>
      <span class="pill">Blockers <code>${deliveryAudit.blockers.length}</code></span>
    </div>
  </header>
  <main>
    <section>
      <h2>Delivery Stage Summary</h2>
      ${stageTable(deliveryAudit.stages)}
    </section>

    <section>
      <h2>Review Boards</h2>
      <div class="grid">
        ${imageBoards.map(renderBoard).join('\n        ')}
      </div>
    </section>

    <section>
      <h2>GitHub Reference Scan</h2>
      <p class="note">These repositories inform structure, runtime behavior, and future input routes. They are not imported character assets.</p>
      ${githubTable(githubScan.repositories)}
    </section>

    <section>
      <h2>Open Manual Findings</h2>
      ${findingsTable([...(sourceReview.openFindings ?? []), ...(runtimeQa.manualReviewFindings ?? [])])}
    </section>

    <section>
      <h2>Blockers</h2>
      <ul class="blockers">
        ${deliveryAudit.blockers.map(item => `<li><code>${escapeHtml(item)}</code></li>`).join('\n        ')}
      </ul>
    </section>

    <section>
      <h2>Next Required Evidence</h2>
      ${simpleTable(['Evidence'], deliveryAudit.nextRequiredEvidence.map(item => [item]))}
    </section>

    <section>
      <h2>Runtime Proof Boundary</h2>
      <table>
        <tbody>
          <tr><th>Current renderer proof</th><td><code>${escapeHtml(runtimeProof.renderer)}</code> / <code>${escapeHtml(runtimeProof.status)}</code></td></tr>
          <tr><th>Export audit</th><td><code>${escapeHtml(exportAudit.status)}</code></td></tr>
          <tr><th>Public package</th><td><code>${manifest.distribution.publicInstallerAllowed ? 'allowed' : 'blocked'}</code></td></tr>
          <tr><th>Store package</th><td><code>${manifest.distribution.storePackageAllowed ? 'allowed' : 'blocked'}</code></td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;

  fs.mkdirSync(REVIEW_ROOT, { recursive: true });
  fs.writeFileSync(DASHBOARD_PATH, html, 'utf8');
  console.log(`SU_SHIXIA_REVIEW_DASHBOARD_GENERATED dashboard=${path.relative(ROOT, DASHBOARD_PATH).replace(/\\/g, '/')} githubRefs=${githubScan.repositories.length}`);
}

function board(title, relativePath, description) {
  return {
    title,
    path: path.relative(REVIEW_ROOT, path.join(PACKAGE_ROOT, relativePath)).replace(/\\/g, '/'),
    description,
  };
}

function renderBoard(item) {
  return `<article class="board">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <img src="${escapeHtml(item.path)}" alt="${escapeHtml(item.title)}">
        </article>`;
}

function stageTable(stages) {
  const rows = stages.map(stage => [
    `<code>${escapeHtml(stage.id)}</code>`,
    `<span class="status-${escapeHtml(stage.status)}">${escapeHtml(stage.status.toUpperCase())}</span>`,
    stage.checks.map(item => `${escapeHtml(item.id)}: ${escapeHtml(item.status)}${item.detail ? ` (${escapeHtml(item.detail)})` : ''}`).join('<br>'),
  ]);
  return simpleTable(['Stage', 'Status', 'Checks'], rows, true);
}

function githubTable(repos) {
  const rows = repos.map(item => [
    `<a href="${escapeHtml(item.url)}">${escapeHtml(item.repo)}</a>`,
    `<code>${escapeHtml(item.license)}</code>`,
    String(item.stars),
    escapeHtml(item.use),
    escapeHtml(item.boundary),
  ]);
  return simpleTable(['Repository', 'License', 'Stars', 'Use', 'Boundary'], rows, true);
}

function findingsTable(findings) {
  const rows = findings.map(item => [
    `<code>${escapeHtml(item.area)}</code>`,
    `<code>${escapeHtml(item.severity)}</code>`,
    `<code>${escapeHtml(item.status)}</code>`,
    escapeHtml(item.note),
  ]);
  return simpleTable(['Area', 'Severity', 'Status', 'Note'], rows, true);
}

function simpleTable(headers, rows, trustedRows = false) {
  return `<table>
        <thead><tr>${headers.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map(row => `<tr>${row.map(cell => `<td>${trustedRows ? cell : escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n          ')}
        </tbody>
      </table>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main();
