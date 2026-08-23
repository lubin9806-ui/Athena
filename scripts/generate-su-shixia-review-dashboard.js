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

const MOTION_REFERENCE_FAMILIES = [
  {
    id: 'idle-presence',
    label: 'Idle, listen, think, return',
    motionGroups: ['Idle', 'Listen', 'Think', 'Greet', 'Return', 'Sleepy'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/Haru/motions', 'Live2D/CubismNativeSamples:Samples/Resources'],
    use: 'Use official Haru motion timing as a low-amplitude presence reference for breathing, eye motion, hair settling, and recovery.',
    boundary: 'Timing and grouping reference only; Su Shixia needs authored curves and her own layered art.',
  },
  {
    id: 'voice-speech',
    label: 'TTS speech and voice response',
    motionGroups: ['Speak', 'Nod', 'ShakeHead'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/Haru/Haru.model3.json', 'Live2D/CubismWebSamples:Samples/Resources/Haru/sounds'],
    use: 'Use official sample model and sound package layout to keep voice-triggered motion, expression, and audio timing separate.',
    boundary: 'Athena TTS drives mouth parameters locally; do not import sample voice clips.',
  },
  {
    id: 'face-head-touch',
    label: 'Head, hair, face, ear, neck reactions',
    motionGroups: ['TouchHead', 'TouchHair', 'TouchHairClip', 'TouchFace', 'TouchEar', 'TouchNeck'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/Haru/motions', 'DenchiSoft/VTubeStudio:Wiki/API trigger workflow'],
    use: 'Combine official small head motions with trigger-style reaction design for shy, startled, and affectionate micro-reactions.',
    boundary: 'No third-party character motion is copied; sensitive-zone responses stay mode-gated.',
  },
  {
    id: 'hands-arms-gesture',
    label: 'Hands, arms, wave, drag',
    motionGroups: ['Wave', 'TouchHand', 'TouchUpperArm', 'TouchForearm', 'TouchWrist', 'TouchPalm', 'Drag'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/Hiyori/motions', 'Live2D/CubismWebSamples:Samples/Resources/Mao/motions', 'guansss/pixi-live2d-display:interaction runtime'],
    use: 'Use official sample gesture clips and Pixi hit-test patterns as references for hand wave, arm recoil, and pointer-driven drag follow.',
    boundary: 'Independent arm motion still requires real mesh deformers; Lite overlay hands are preview-only.',
  },
  {
    id: 'garment-body-boundary',
    label: 'Clothing, torso, skirt, legs',
    motionGroups: ['TouchShoulder', 'TouchCollar', 'TouchBlouse', 'TouchClothing', 'TouchChest', 'TouchRibs', 'TouchAbdomen', 'TouchWaist', 'TouchHip', 'TouchSkirt', 'TouchLeg', 'TouchThigh', 'TouchKnee', 'TouchCalf', 'TouchAnkle', 'TouchFoot', 'TouchShoe'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/Haru/motions', 'Live2D/CubismWebSamples:Samples/Resources/Haru/Haru.physics3.json'],
    use: 'Use official motion and physics package shape as a timing reference for weight shift, garment adjustment, and recovery to idle.',
    boundary: 'Private opt-in zones remain semantic and runtime-gated; public package must not include explicit assets.',
  },
  {
    id: 'turn-orientation',
    label: 'Turn preview and future multi-view',
    motionGroups: ['TurnPreview'],
    githubRefs: ['Live2D/CubismWebSamples:Samples/Resources/*/motions', 'Inochi2D/inochi2d:parameterized puppet contrast'],
    use: 'Use official parameterized motion format and open puppet-system contrast to plan front/profile/back transitions.',
    boundary: 'Current `TurnPreview` is a 2.5D hint; true turn requires separate source packages and orientation hit maps.',
  },
  {
    id: 'future-tracking',
    label: 'Future gaze, blink, expression input',
    motionGroups: ['Idle', 'Listen', 'Speak'],
    githubRefs: ['DenchiSoft/VTubeStudio:API/Wiki', 'emilianavt/OpenSeeFace:landmark tracking'],
    use: 'Use ecosystem references for future camera or tracking input that can drive gaze, blink, expression, and head angle parameters.',
    boundary: 'Not a current dependency and not required for the Lite preview.',
  },
];

function main() {
  const manifest = readJson(path.join(PACKAGE_ROOT, 'manifest.json'));
  const sourceReview = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.reviewReport));
  const artReviewPacket = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-art-review-packet.json'));
  const runtimeQa = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.runtimeVisualQaReport));
  const deliveryAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-live2d-v2-delivery-audit.json'));
  const exportAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-export-audit.json'));
  const runtimeProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-cubism-runtime-proof.json'));
  const motionAuthoringPacket = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-motion-authoring-packet.json'));
  const wardrobeContract = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.wardrobeContract));
  const wardrobeAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-wardrobe-readiness-audit.json'));
  const interactionMatrix = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.interactionMatrix));
  const interactionAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-interaction-readiness-audit.json'));
  const runtimePolicyProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-runtime-policy-proof.json'));
  const hotZoneEventProof = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-hot-zone-event-proof.json'));
  const orientationContract = readJson(path.join(PACKAGE_ROOT, manifest.sourceArt.orientationContract));
  const orientationAudit = readJson(path.join(ROOT, 'docs', 'quality', 'su-shixia-orientation-readiness-audit.json'));

  const githubScan = {
    version: 1,
    generatedAt: '2026-08-24',
    source: 'GitHub API snapshot plus repository review notes',
    packageId: manifest.id,
    status: 'reference_scan_ready',
    repositories: GITHUB_REFERENCES,
    motionReferenceFamilies: MOTION_REFERENCE_FAMILIES,
    adoptedDecisions: [
      'Keep official Live2D samples as package and timing references, not copied assets.',
      'Use Pixi and VTube Studio ecosystem ideas for hit-test, motion trigger, and parameter-control design.',
      'Map every Su Shixia motion group to at least one reference family before authoring Cubism motion clips.',
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
      <h2>Art Review Packet</h2>
      <p class="note">This packet makes the human source-art gate actionable. It does not approve art automatically.</p>
      ${artReviewPacketTable(artReviewPacket)}
    </section>

    <section>
      <h2>GitHub Reference Scan</h2>
      <p class="note">These repositories inform structure, runtime behavior, and future input routes. They are not imported character assets.</p>
      ${githubTable(githubScan.repositories)}
      <h3>Motion Reference Families</h3>
      ${motionFamilyTable(githubScan.motionReferenceFamilies)}
    </section>

    <section>
      <h2>Motion Authoring Packet</h2>
      <p class="note">GitHub references are converted into a Cubism motion handoff checklist. This proves coverage and boundaries, not final hand-polished playback.</p>
      ${motionAuthoringSummaryTable(motionAuthoringPacket)}
      ${motionAuthoringTable(motionAuthoringPacket.authoringRows)}
    </section>

    <section>
      <h2>Wardrobe Contract</h2>
      <p class="note">Current runtime presets remain tint/accessory previews. True wardrobe requires separate source layers, Cubism drawables, and motion QA.</p>
      ${wardrobeTable(wardrobeContract.publicOutfits)}
      <p class="note">Wardrobe audit: <code>${escapeHtml(wardrobeAudit.status)}</code>; true outfit swap: <code>${wardrobeAudit.trueOutfitSwapReady}</code>; future source outfits missing: <code>${wardrobeAudit.futureSourceOutfitCount}</code>.</p>
    </section>

    <section>
      <h2>Interaction Matrix</h2>
      <p class="note">The persona may generate replies, but the runtime owns zone permissions, motion allowlists, and mode boundaries.</p>
      ${interactionSummaryTable(interactionMatrix, interactionAudit)}
      <h3>Runtime Policy Proof</h3>
      ${runtimePolicyProofTable(runtimePolicyProof)}
      <h3>Hot Zone Event Proof</h3>
      ${hotZoneEventProofTable(hotZoneEventProof)}
      ${interactionZoneTable(interactionMatrix.zones)}
    </section>

    <section>
      <h2>Orientation Contract</h2>
      <p class="note">TurnPreview is a front-view 2.5D hint. True turn behavior requires source packages and hit maps per orientation.</p>
      ${orientationSummaryTable(orientationContract, orientationAudit)}
      ${orientationTable(orientationContract.orientations)}
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
  writeTextWithRetry(DASHBOARD_PATH, html);
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

function motionFamilyTable(families) {
  const rows = families.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    escapeHtml(item.label),
    item.motionGroups.map(group => `<code>${escapeHtml(group)}</code>`).join(' '),
    item.githubRefs.map(escapeHtml).join('<br>'),
    escapeHtml(item.boundary),
  ]);
  return simpleTable(['Family', 'Label', 'Motion Groups', 'GitHub Evidence', 'Boundary'], rows, true);
}

function motionAuthoringSummaryTable(packet) {
  return `<table>
        <tbody>
          <tr><th>Status</th><td><code>${escapeHtml(packet.status)}</code></td></tr>
          <tr><th>Rows</th><td><code>${packet.authoringRows.length}</code> motion templates</td></tr>
          <tr><th>Voice sync</th><td><code>${escapeHtml(packet.voiceSyncReview.status)}</code></td></tr>
          <tr><th>Stiffness risk</th><td><code>high=${packet.stiffnessReview.highRisk.length}</code> <code>medium=${packet.stiffnessReview.mediumRisk.length}</code></td></tr>
          <tr><th>Go/No-Go</th><td>${Object.entries(packet.goNoGo).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
        </tbody>
      </table>`;
}

function motionAuthoringTable(rows) {
  const rendered = rows.map(item => [
    `<code>${escapeHtml(item.motionGroup)}</code>`,
    `<code>${escapeHtml(item.tier)}</code>`,
    `<code>${escapeHtml(item.duration)}s</code>`,
    `<code>${escapeHtml(item.curveCount)}</code>`,
    `<code>${escapeHtml(item.stiffnessRisk)}</code>`,
    item.referenceFamilies.map(family => `<code>${escapeHtml(family.id)}</code>`).join(' '),
    escapeHtml(item.authoringIntent),
  ]);
  return simpleTable(['Motion', 'Tier', 'Duration', 'Curves', 'Stiffness', 'Refs', 'Intent'], rendered, true);
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

function artReviewPacketTable(packet) {
  const rows = packet.reviewLanes.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    escapeHtml(item.label),
    `<code>${escapeHtml(item.status)}</code>`,
    `<code>${item.partCount}</code>`,
    `<code>${item.highRiskPartCount}</code>`,
  ]);
  const gates = packet.approvalGates.map(item => `<code>${escapeHtml(item.id)}=${escapeHtml(item.status)}</code>`).join(' ');
  return `${simpleTable(['Lane', 'Label', 'Status', 'Parts', 'High Risk'], rows, true)}
      <p class="note">Approval gates: ${gates}</p>`;
}

function wardrobeTable(outfits) {
  const rows = outfits.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    escapeHtml(item.label),
    `<code>${escapeHtml(item.sourceStatus)}</code>`,
    `<code>${escapeHtml(item.cubismParameter)}</code>`,
    item.missingForProduction.map(escapeHtml).join('<br>'),
  ]);
  return simpleTable(['Outfit', 'Label', 'Source Status', 'Cubism Parameter', 'Missing For Production'], rows, true);
}

function interactionSummaryTable(matrix, audit) {
  return `<table>
        <tbody>
          <tr><th>Audit</th><td><code>${escapeHtml(audit.status)}</code></td></tr>
          <tr><th>Zones</th><td><code>${matrix.coverage.totalZones}</code> total, <code>${matrix.coverage.privateOptInZones.length}</code> private opt-in capable</td></tr>
          <tr><th>Target layers</th><td>${Object.entries(matrix.coverage.byTargetLayer).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
          <tr><th>Sensitivity</th><td>${Object.entries(matrix.coverage.bySensitivity).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
          <tr><th>Known No-Go</th><td>${Object.entries(audit.goNoGo).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
        </tbody>
      </table>`;
}

function runtimePolicyProofTable(proof) {
  return `<table>
        <tbody>
          <tr><th>Status</th><td><code>${escapeHtml(proof.status)}</code></td></tr>
          <tr><th>Runtime module</th><td><code>${escapeHtml(proof.runtimeModule)}</code></td></tr>
          <tr><th>Coverage</th><td><code>zones=${proof.coverage.totalZones}</code> <code>normal=${proof.coverage.normalModeProofs}</code> <code>private=${proof.coverage.privateModeProofs}</code> <code>fallback=${proof.coverage.privateAttemptsFallingBackToNormal}</code></td></tr>
          <tr><th>Boundary</th><td>${Object.entries(proof.boundary).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
        </tbody>
      </table>`;
}

function hotZoneEventProofTable(proof) {
  const rows = proof.cases.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    `<code>${escapeHtml(item.hitAreaName)}</code>`,
    `<code>${escapeHtml(item.motionGroup)}</code>`,
    `<code>${escapeHtml(item.expressionId)}</code>`,
    `<code>${escapeHtml(item.privateAttemptMode)}</code>`,
  ]);
  return `${simpleTable(['Zone', 'Hit Area', 'Motion', 'Expression', 'Private Attempt'], rows, true)}
      <p class="note">Event proof status: <code>${escapeHtml(proof.status)}</code>; callbacks: <code>${proof.coverage.callbackCount}</code>; Cubism moc3 proof: <code>false</code>.</p>`;
}

function interactionZoneTable(zones) {
  const rows = zones.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    `<code>${escapeHtml(item.targetLayer)}</code>`,
    `<code>${escapeHtml(item.sensitivity)}</code>`,
    `<code>${escapeHtml(item.motionGroup)}</code>`,
    `<code>${escapeHtml(item.expressionId)}</code>`,
    escapeHtml(item.bodyPart),
  ]);
  return simpleTable(['Zone', 'Layer', 'Sensitivity', 'Motion', 'Expression', 'Body Part'], rows, true);
}

function orientationSummaryTable(contract, audit) {
  return `<table>
        <tbody>
          <tr><th>Audit</th><td><code>${escapeHtml(audit.status)}</code></td></tr>
          <tr><th>Current runtime</th><td><code>${escapeHtml(contract.currentRuntime.turnPreviewCapability)}</code>; visual QA <code>${escapeHtml(contract.currentRuntime.turnPreviewVisualQaCovered)}</code></td></tr>
          <tr><th>Sources</th><td><code>${audit.sourceReadyOrientationCount}</code> ready, <code>${audit.futureSourceOrientationCount}</code> future required</td></tr>
          <tr><th>Known No-Go</th><td>${Object.entries(audit.goNoGo).map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(value)}</code>`).join(' ')}</td></tr>
        </tbody>
      </table>`;
}

function orientationTable(orientations) {
  const rows = orientations.map(item => [
    `<code>${escapeHtml(item.id)}</code>`,
    `<code>${escapeHtml(item.sourceStatus)}</code>`,
    `<code>${escapeHtml(item.runtimeStatus)}</code>`,
    item.requiredZoneFamilies.map(escapeHtml).join('<br>'),
  ]);
  return simpleTable(['Orientation', 'Source Status', 'Runtime Status', 'Required Zone Families'], rows, true);
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

function writeTextWithRetry(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.writeFileSync(filePath, value, 'utf8');
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60 + attempt * 90);
    }
  }
  throw lastError;
}

main();
