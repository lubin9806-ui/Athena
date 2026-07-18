const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const docsDir = path.join(repoRoot, "docs");
const releaseResourcesDir = path.join(repoRoot, "release", "win-unpacked", "resources");

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

function packageDirFor(name) {
  return path.join(repoRoot, "node_modules", ...name.split("/"));
}

function readPackageLockMeta(name) {
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (!exists(lockPath)) {
    return null;
  }
  const lock = readJson(lockPath);
  return lock.packages ? lock.packages[`node_modules/${name}`] || null : null;
}

function readPackageMeta(name, version, resolved) {
  const packageJsonPath = path.join(packageDirFor(name), "package.json");
  const lockMeta = readPackageLockMeta(name);
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
    version: pkg.version || version,
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

function fileEntry(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: rel(filePath),
    bytes: stat.size,
    sha256: sha256(filePath)
  };
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
    sha256: sha256(allowlistPath),
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
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`ATHENA_SUPPLY_CHAIN_OK packages=${npmRuntimePackages.length} manifest=${rel(manifestPath)}`);
}

main();
