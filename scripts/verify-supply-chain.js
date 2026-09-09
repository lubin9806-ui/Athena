const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const docsDir = path.join(repoRoot, "docs");
const releaseResourcesDir = path.join(repoRoot, "release", "win-unpacked", "resources");

// Default is to compare against the committed manifest. Regenerating is an
// explicit act (--write) because a baseline its own verifier rewrites can never
// report drift: it just adopts whatever the current machine happens to hold.
const writeMode = process.argv.includes("--write");

// Fields that legitimately differ per machine and per moment. Everything else
// is asserted. Keep this list short and obvious; widening it silently is how a
// baseline stops being one.
const BASELINE_EXCLUSIONS = [
  ["generatedAt"],
  ["buildTools", "node"],
  ["localOllamaRuntime"],
  ["repositoryProvenance", "gitRemote"]
];

function fail(message) {
  console.error(`SUPPLY_CHAIN_VERIFY_FAIL ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex").toUpperCase();
}

function listFiles(root) {
  if (!exists(root)) {
    return [];
  }
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out.sort();
}

function rel(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

let packageLockCache = null;

function readPackageLockMeta(name, version) {
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (!exists(lockPath)) {
    return null;
  }
  packageLockCache ||= readJson(lockPath);
  const suffix = `node_modules/${name}`;
  const candidates = Object.entries(packageLockCache.packages || {}).filter(([packagePath, meta]) => (
    packagePath === suffix || packagePath.endsWith(`/${suffix}`)
  ) && (!version || meta.version === version));
  if (candidates.length === 0) return null;
  candidates.sort(([left], [right]) => left.length - right.length || left.localeCompare(right));
  const [packagePath, meta] = candidates[0];
  return { packagePath, meta };
}

function readPackageMeta(name, version, resolved) {
  const lockEntry = readPackageLockMeta(name, version);
  const lockMeta = lockEntry && lockEntry.meta;
  const packageJsonPath = lockEntry
    ? path.join(repoRoot, lockEntry.packagePath, "package.json")
    : path.join(repoRoot, "node_modules", ...name.split("/"), "package.json");
  if (!exists(packageJsonPath)) {
    return {
      name,
      version,
      resolved: resolved || (lockMeta && lockMeta.resolved) || null,
      license: normalizeLicense(lockMeta && lockMeta.license),
      notice: "package.json not found in node_modules"
    };
  }
  const pkg = readJson(packageJsonPath);
  const repository =
    typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository && pkg.repository.url
        ? pkg.repository.url
        : null;
  return {
    name,
    version: version || pkg.version,
    resolved: resolved || (lockMeta && lockMeta.resolved) || null,
    license: normalizeLicense(pkg.license || pkg.licenses || (lockMeta && lockMeta.license)),
    repository,
    homepage: pkg.homepage || null
  };
}

function normalizeLicense(value) {
  if (!value) {
    return "UNKNOWN";
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLicense(item.type || item)).join(" OR ");
  }
  if (typeof value === "object") {
    return normalizeLicense(value.type || value.name);
  }
  return String(value);
}

function collectNpmRuntimePackages() {
  let tree;
  try {
    const commandShell = process.env.ComSpec || "cmd.exe";
    tree = JSON.parse(
      childProcess.execFileSync(commandShell, ["/d", "/s", "/c", "npm.cmd ls --omit=dev --json --all"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
  } catch (error) {
    fail(`npm ls --omit=dev failed: ${error.stderr || error.message}`);
  }

  const seen = new Map();
  function walk(deps) {
    for (const [name, node] of Object.entries(deps || {})) {
      if (!node || typeof node.version !== "string" || !node.version) {
        continue;
      }
      const key = `${name}@${node.version || "unknown"}`;
      if (!seen.has(key)) {
        seen.set(key, readPackageMeta(name, node.version || null, node.resolved || null));
      }
      walk(node.dependencies);
    }
  }
  walk(tree.dependencies);
  return [...seen.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function parseRequirements() {
  const reqPath = path.join(repoRoot, "requirements-voice.txt");
  const lines = fs
    .readFileSync(reqPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return lines.map((requirement) => ({
    requirement,
    distributionStatus: "declared runtime/install-time requirement; not bundled in the Desktop installer"
  }));
}

function powershellVersion(filePath) {
  if (!exists(filePath)) {
    return null;
  }
  const escaped = filePath.replace(/'/g, "''");
  try {
    return childProcess
      .execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      )
      .trim() || null;
  } catch {
    return null;
  }
}

function ollamaCliVersion() {
  const ollamaExe = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe");
  if (!exists(ollamaExe)) {
    return null;
  }
  try {
    const output = childProcess.execFileSync(ollamaExe, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.trim();
  } catch {
    return null;
  }
}

const TEXT_NORMALIZATION_LIMIT = 16 * 1024 * 1024;

// core.autocrlf=true means one commit lands as LF bytes in a tool-written file
// and CRLF bytes in a fresh checkout, while git calls both clean. Hashing the
// raw working copy therefore reports drift for a file nobody edited, so text is
// measured with LF endings and the entry says so. Binaries hash byte-for-byte.
function measureFile(filePath) {
  const stat = fs.statSync(filePath);
  const probeLength = Math.min(8192, stat.size);
  const probe = Buffer.alloc(probeLength);
  if (probeLength > 0) {
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, probe, 0, probeLength, 0);
    } finally {
      fs.closeSync(fd);
    }
  }

  // git's own binary heuristic: a NUL byte near the start.
  if (probe.includes(0) || stat.size > TEXT_NORMALIZATION_LIMIT) {
    return { bytes: stat.size, sha256: sha256(filePath), normalized: false };
  }

  const raw = fs.readFileSync(filePath);
  const normalized = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  return {
    bytes: normalized.length,
    sha256: crypto.createHash("sha256").update(normalized).digest("hex").toUpperCase(),
    normalized: true
  };
}

function fileEntry(filePath) {
  const measured = measureFile(filePath);
  const entry = {
    path: rel(filePath),
    bytes: measured.bytes,
    sha256: measured.sha256
  };
  if (measured.normalized) {
    entry.lineEndings = "lf-normalized";
  }
  return entry;
}

function collectBundledAssets() {
  const resourceFiles = listFiles(path.join(repoRoot, "resources"))
    .filter((filePath) => path.basename(filePath) !== "OllamaSetup.exe")
    .map(fileEntry);
  const voiceFiles = [
    "tts.py",
    "stt.py",
    "stt_whisper.py",
    "play_audio.py",
    "requirements-voice.txt"
  ].map((name) => fileEntry(path.join(repoRoot, name)));
  const storeAssets = listFiles(path.join(repoRoot, "build", "appx")).map(fileEntry);
  return [...resourceFiles, ...voiceFiles, ...storeAssets].sort((a, b) => a.path.localeCompare(b.path));
}

function collectBuildManifest() {
  const installer = listFiles(path.join(repoRoot, "release"))
    .filter((filePath) => /^Athena Setup .*\.exe$/.test(path.basename(filePath)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const unpackedExe = path.join(repoRoot, "release", "win-unpacked", "Athena.exe");
  const entries = [];
  if (installer) entries.push(fileEntry(installer));
  if (exists(unpackedExe)) entries.push(fileEntry(unpackedExe));
  return entries;
}

function blobPathForDigest(digest) {
  return path.join(process.env.USERPROFILE || "", ".ollama", "models", "blobs", digest.replace(":", "-"));
}

function collectLocalOllamaModel() {
  const manifestPath = path.join(
    process.env.USERPROFILE || "",
    ".ollama",
    "models",
    "manifests",
    "registry.ollama.ai",
    "library",
    "qwen2.5",
    "14b"
  );
  if (!exists(manifestPath)) {
    return {
      runtimeTag: "qwen2.5:14b",
      status: "not present in current user Ollama store during manifest generation"
    };
  }

  const manifest = readJson(manifestPath);
  const files = [
    {
      role: "manifest",
      source: manifestPath,
      destination: "models/manifests/registry.ollama.ai/library/qwen2.5/14b",
      bytes: fs.statSync(manifestPath).size,
      sha256: sha256(manifestPath)
    }
  ];

  const layers = [manifest.config, ...(manifest.layers || [])].filter(Boolean);
  for (const layer of layers) {
    const source = blobPathForDigest(layer.digest);
    files.push({
      role: layer.mediaType,
      digest: layer.digest,
      source,
      destination: `models/blobs/${layer.digest.replace(":", "-")}`,
      bytes: exists(source) ? fs.statSync(source).size : null,
      manifestBytes: layer.size,
      sha256: exists(source) ? sha256(source) : null,
      status: exists(source) ? "verified" : "missing"
    });
  }

  return {
    runtimeTag: "qwen2.5:14b",
    localOllamaId: files[0].sha256.slice(0, 12).toLowerCase(),
    upstreamOllamaPage: "https://ollama.com/library/qwen2.5:14b",
    architecture: "qwen2",
    parameters: "14.8B",
    quantization: "Q4_K_M",
    files
  };
}

function collectOfflineAllowlist() {
  const allowlistPath = path.join(docsDir, "OFFLINE_MODEL_ALLOWLIST.json");
  if (!exists(allowlistPath)) {
    return {
      path: "docs/OFFLINE_MODEL_ALLOWLIST.json",
      status: "missing; offline pack generation is blocked until exact model files are allowlisted"
    };
  }
  return {
    path: "docs/OFFLINE_MODEL_ALLOWLIST.json",
    status: "present",
    sha256: measureFile(allowlistPath).sha256,
    content: readJson(allowlistPath)
  };
}

function collectRepositoryProvenance() {
  const modelFiles = listFiles(path.join(repoRoot, "models")).map(fileEntry);
  let gitRemote = "none configured or unavailable";
  try {
    gitRemote = childProcess
      .execFileSync("git", ["remote", "-v"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim() || "none configured";
  } catch {
    gitRemote = "none configured or unavailable";
  }
  return {
    gitRemote,
    unknownOrExcludedPayloads: [
      {
        path: "models/",
        status: "Blocked",
        packagingStatus: "excluded from normal installer and offline pack",
        evidenceNeeded:
          "human approval for retention plus source URL, license, and redistribution proof for each local GGUF or placeholder file before any distribution",
        files: modelFiles
      },
      {
        path: "legacy/root-artifacts/",
        status: "archived",
        packagingStatus: "not included by electron-builder.yml",
        evidence: "legacy/root-artifacts/MANIFEST.sha256"
      },
      {
        path: "新建文件夹/",
        status: "Blocked",
        packagingStatus: "not included by electron-builder.yml",
        evidenceNeeded: "user confirmation of owner, purpose, and retention policy"
      }
    ]
  };
}

function collectAssetProvenanceSummary() {
  return {
    bundledRuntimeAssets: collectBundledAssets(),
    nonBundledPromotionalAssets: listFiles(path.join(repoRoot, "promo")).map(fileEntry),
    nonBundledConceptAssets: listFiles(path.join(docsDir, "concepts")).map(fileEntry),
    requiredHumanSignoffs: [
      "Athena name, Su Shixia name, logos/icons, splash/tray images, screenshots, wallpapers, and poster concepts",
      "publisher legal identity, company ownership, trademark clearance, EULA, public privacy URL, and support contact",
      "confirmation that no third-party font, icon, photo, voice, or audio asset is redistributed without a recorded license"
    ]
  };
}

function verifyStaticFiles() {
  const required = [
    "docs/THIRD_PARTY_NOTICES.md",
    "docs/ASSET_PROVENANCE.md",
    "docs/OFFLINE_MODEL_ALLOWLIST.json",
    "docs/OFFLINE_MODEL_ALLOWLIST.example.json",
    "electron-builder.yml",
    "scripts/package-offline.ps1"
  ];
  for (const file of required) {
    if (!exists(path.join(repoRoot, file))) {
      fail(`required supply-chain file is missing: ${file}`);
    }
  }

  const notices = fs.readFileSync(path.join(docsDir, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const phrase of [
    "NPM runtime packages",
    "Python voice requirements",
    "Electron",
    "Qwen2.5",
    "Ollama",
    "Asset provenance"
  ]) {
    if (!notices.includes(phrase)) {
      fail(`THIRD_PARTY_NOTICES.md does not include required section: ${phrase}`);
    }
  }

  const builder = fs.readFileSync(path.join(repoRoot, "electron-builder.yml"), "utf8");
  for (const phrase of ['- "athena.db"', '- "!**/*-wal"', '- "!**/*-shm"', '- "!backups/**"']) {
    if (!builder.includes(phrase)) {
      fail(`electron-builder database resource filter is missing ${phrase}`);
    }
  }

  const offlineScript = fs.readFileSync(path.join(repoRoot, "scripts", "package-offline.ps1"), "utf8");
  if (!offlineScript.includes("OFFLINE_MODEL_ALLOWLIST.json")) {
    fail("offline pack script must require OFFLINE_MODEL_ALLOWLIST.json");
  }
  if (/robocopy\s+\$modelSource/i.test(offlineScript) || /\.ollama\\models/i.test(offlineScript)) {
    fail("offline pack script must not copy the whole user .ollama\\models directory");
  }
}

function verifyReleaseResources() {
  if (!exists(releaseResourcesDir)) {
    return;
  }
  const disallowed = [];
  for (const file of listFiles(releaseResourcesDir)) {
    const relative = rel(file).toLowerCase();
    if (
      relative.includes("/database/backups/") ||
      relative.endsWith(".db-wal") ||
      relative.endsWith(".db-shm") ||
      relative.includes("/ollama-models/") ||
      relative.endsWith("/ollamasetup.exe")
    ) {
      disallowed.push(rel(file));
    }
  }
  if (disallowed.length) {
    fail(`packaged resources contain disallowed files: ${disallowed.join(", ")}`);
  }
}

function verifyLicenses(packages) {
  const missing = packages.filter((pkg) => !pkg.license || pkg.license === "UNKNOWN");
  if (missing.length) {
    fail(`runtime npm packages have missing licenses: ${missing.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`);
  }
}

function collectTrackedPaths() {
  try {
    const output = childProcess.execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024
    });
    return new Set(output.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

// Exactly the shape fileEntry() produces. Policy objects that merely carry a
// "path" (models/, legacy/root-artifacts/) are not file entries and stay.
function isFileEntry(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.path === "string"
    && typeof value.bytes === "number"
    && typeof value.sha256 === "string";
}

// A supply-chain baseline can only assert over what is committed. Hashes of
// gitignored or not-yet-added payloads (resources/voice-runtime, models/,
// release/, promo/) differ per machine, so they are recorded but not compared.
function dropUntrackedEntries(value, tracked) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isFileEntry(item) || tracked.has(item.path))
      .map((item) => dropUntrackedEntries(item, tracked));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = dropUntrackedEntries(item, tracked);
    }
    return out;
  }
  return value;
}

function baselineView(manifest, tracked) {
  const view = dropUntrackedEntries(manifest, tracked);
  for (const parts of BASELINE_EXCLUSIONS) {
    let node = view;
    for (let index = 0; index < parts.length - 1 && node; index += 1) {
      node = node[parts[index]];
    }
    if (node && typeof node === "object") {
      delete node[parts[parts.length - 1]];
    }
  }
  return view;
}

// Keyed comparison keeps one inserted dependency from cascading into a diff on
// every later index.
function arrayKey(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (typeof item.path === "string") return item.path;
  if (typeof item.requirement === "string") return item.requirement;
  if (typeof item.name === "string") {
    return typeof item.version === "string" ? `${item.name}@${item.version}` : item.name;
  }
  if (typeof item.decision === "string") return item.decision;
  return null;
}

function describeValue(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return "absent";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

const DIFF_COLLECTION_LIMIT = 200;

function collectDiffs(expected, actual, location, out) {
  if (out.length >= DIFF_COLLECTION_LIMIT) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const expectedKeys = expected.map(arrayKey);
    const actualKeys = actual.map(arrayKey);
    if (expectedKeys.every(Boolean) && actualKeys.every(Boolean)) {
      const expectedMap = new Map(expected.map((item, index) => [expectedKeys[index], item]));
      const actualMap = new Map(actual.map((item, index) => [actualKeys[index], item]));
      for (const [key, item] of expectedMap) {
        if (!actualMap.has(key)) {
          out.push(`${location}[${key}]: removed`);
        } else {
          collectDiffs(item, actualMap.get(key), `${location}[${key}]`, out);
        }
      }
      for (const key of actualMap.keys()) {
        if (!expectedMap.has(key)) {
          out.push(`${location}[${key}]: added`);
        }
      }
      return;
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectDiffs(expected[index], actual[index], `${location}[${index}]`, out);
    }
    return;
  }

  const expectedIsObject = Boolean(expected) && typeof expected === "object" && !Array.isArray(expected);
  const actualIsObject = Boolean(actual) && typeof actual === "object" && !Array.isArray(actual);
  if (expectedIsObject && actualIsObject) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      collectDiffs(expected[key], actual[key], location ? `${location}.${key}` : key, out);
    }
    return;
  }

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    out.push(`${location}: ${describeValue(expected)} -> ${describeValue(actual)}`);
  }
}

function compareAgainstBaseline(manifest, manifestPath, packageCount) {
  if (!exists(manifestPath)) {
    fail(`baseline manifest is missing: ${rel(manifestPath)}; generate it with "npm.cmd run supply-chain:write" and commit the result`);
  }
  const tracked = collectTrackedPaths();
  if (!tracked) {
    fail("git ls-files is unavailable, so the committed baseline scope cannot be determined");
  }

  const diffs = [];
  collectDiffs(baselineView(readJson(manifestPath), tracked), baselineView(manifest, tracked), "", diffs);
  if (diffs.length) {
    // collectDiffs stops at DIFF_COLLECTION_LIMIT, so report the count as a
    // floor rather than pretending it is the total.
    const counted = diffs.length >= DIFF_COLLECTION_LIMIT ? `${DIFF_COLLECTION_LIMIT}+` : `${diffs.length}`;
    console.error(`SUPPLY_CHAIN_VERIFY_FAIL supply-chain drift against ${rel(manifestPath)}: ${counted} difference(s)`);
    for (const line of diffs.slice(0, 25)) {
      console.error(`  ${line}`);
    }
    if (diffs.length > 25) {
      console.error(`  ... and ${diffs.length - 25} more`);
    }
    console.error('  review every difference, then re-baseline with "npm.cmd run supply-chain:write" and commit the manifest');
    process.exit(1);
  }

  const excluded = BASELINE_EXCLUSIONS.map((parts) => parts.join(".")).join(",");
  console.log(`ATHENA_SUPPLY_CHAIN_OK packages=${packageCount} manifest=${rel(manifestPath)} baseline=compared excluded=${excluded},untracked-file-hashes`);
}

function main() {
  verifyStaticFiles();
  verifyReleaseResources();

  const packageJson = readJson(path.join(repoRoot, "package.json"));
  const packageLock = readJson(path.join(repoRoot, "package-lock.json"));
  const npmRuntimePackages = collectNpmRuntimePackages();
  verifyLicenses(npmRuntimePackages);

  const ollamaSetup = path.join(repoRoot, "resources", "OllamaSetup.exe");
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {
      name: packageJson.name,
      version: packageJson.version,
      license: packageJson.license,
      private: packageJson.private
    },
    buildTools: {
      node: process.version,
      packageLockVersion: packageLock.lockfileVersion,
      electron: {
        version: packageJson.devDependencies.electron,
        license: "MIT",
        licenseSource: "https://github.com/electron/electron/blob/main/LICENSE",
        chromiumNoticeInPackage: "release/win-unpacked/LICENSES.chromium.html"
      },
      electronBuilder: packageJson.devDependencies["electron-builder"],
      typescript: packageJson.devDependencies.typescript,
      vite: packageJson.devDependencies.vite
    },
    npmRuntimePackages,
    pythonVoiceRequirements: parseRequirements(),
    externalBinaries: exists(ollamaSetup)
      ? [
          {
            name: "OllamaSetup.exe",
            path: rel(ollamaSetup),
            version: powershellVersion(ollamaSetup),
            bytes: fs.statSync(ollamaSetup).size,
            sha256: sha256(ollamaSetup),
            license: "MIT for the open-source Ollama project; installer redistribution still requires release signoff",
            licenseSource: "https://github.com/ollama/ollama/blob/main/LICENSE"
          }
        ]
      : [],
    models: [
      {
        runtimeTag: "qwen2.5:14b",
        upstreamModel: "Qwen/Qwen2.5-14B-Instruct",
        license: "Apache-2.0",
        licenseSource: "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE",
        ollamaSource: "https://ollama.com/library/qwen2.5:14b",
        distributionPolicy:
          "No model payload may enter the offline pack unless docs/OFFLINE_MODEL_ALLOWLIST.json lists exact source, destination, and SHA-256."
      }
    ],
    localOllamaRuntime: {
      installedVersion: ollamaCliVersion(),
      defaultModel: collectLocalOllamaModel()
    },
    offlineModelAllowlist: collectOfflineAllowlist(),
    bundledAssets: collectBundledAssets(),
    assetProvenance: collectAssetProvenanceSummary(),
    repositoryProvenance: collectRepositoryProvenance(),
    buildArtifacts: collectBuildManifest(),
    packagingDecisions: [
      {
        decision: "normal installer excludes OllamaSetup.exe and local model payloads",
        evidence: "electron-builder.yml files excludes resources/OllamaSetup.exe; model payloads are not included"
      },
      {
        decision: "packaged resources include only database/athena.db seed data",
        evidence: "electron-builder.yml extraResources filters exclude database backups, migrations, WAL, and SHM files"
      },
      {
        decision: "offline pack copies only allowlisted model files with SHA-256 verification",
        evidence: "scripts/package-offline.ps1 requires docs/OFFLINE_MODEL_ALLOWLIST.json"
      },
      {
        decision: "Microsoft Store AppX uses Store-managed updates and excludes Direct updater metadata, OllamaSetup.exe, local model payloads, Steam runtime files, and user data",
        evidence: "electron-builder.store.yml; scripts/verify-microsoft-store.js"
      }
    ],
    openReleaseSignoffs: [
      "publisher legal identity, support contact, EULA, and public privacy URL",
      "human ownership review for Athena/Su Shixia names, icons, wallpaper, screenshots, and audio",
      "Ollama installer redistribution terms beyond project source license",
      "code signing, updater, rollback, CI, and store credentials"
    ]
  };

  const manifestPath = path.join(docsDir, "SUPPLY_CHAIN_MANIFEST.json");
  if (writeMode) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`ATHENA_SUPPLY_CHAIN_WRITTEN packages=${npmRuntimePackages.length} manifest=${rel(manifestPath)}`);
    return;
  }

  compareAgainstBaseline(manifest, manifestPath, npmRuntimePackages.length);
}

main();
