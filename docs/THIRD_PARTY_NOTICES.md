# Third-Party Notices

Athena's Desktop installer and optional offline pack use third-party runtime,
voice, model, and tool artifacts. Keep this file with redistributed packages.
The exact machine-readable bill of materials is generated at
`docs/SUPPLY_CHAIN_MANIFEST.json` by `npm.cmd run test:supply-chain`.

## Electron

The Desktop shell is built with Electron.

- Package: `electron`
- Version: see `package.json` and `docs/SUPPLY_CHAIN_MANIFEST.json`
- License reference: https://github.com/electron/electron/blob/main/LICENSE
- Chromium notices: packaged Electron builds include
  `release/win-unpacked/LICENSES.chromium.html`

## NPM runtime packages

Runtime npm dependencies and transitive packages are enumerated in
`docs/SUPPLY_CHAIN_MANIFEST.json`, including package name, version, resolved
registry URL when available, license, repository, and homepage.

Current direct runtime packages:

- `better-sqlite3`
- `cheerio`

## Python voice requirements

Athena declares voice-related Python requirements in `requirements-voice.txt`.
These wheels are not bundled in the normal Desktop installer. They must be
audited again if a future release bundles Python, wheels, speech models, or
system installers.

Declared requirements:

- `faster-whisper==1.2.1`
- `av==17.1.0`
- `numpy==2.4.6`

Window 05 removed Google `SpeechRecognition`, unofficial Edge TTS, and
Python `sounddevice` from the Desktop 1.0 voice runtime. TTS/playback use
Windows framework APIs; Athena does not redistribute Windows voices.

## Ollama

The normal Desktop installer excludes `resources/OllamaSetup.exe` from the app
payload. The optional offline pack may include `OllamaSetup.exe`; the file
version and SHA-256 are recorded in `docs/SUPPLY_CHAIN_MANIFEST.json`.

- Project: https://ollama.com
- Source/license reference: https://github.com/ollama/ollama/blob/main/LICENSE
- Local CLI observed during Window 04: `ollama version is 0.31.2`
- Bundled installer candidate: `resources/OllamaSetup.exe`, ProductVersion
  `0.31.1`, SHA-256
  `E56DEF86D8E5612F67F2876720C5808C01F9A5AB63DBEE7D873E9C0CB4A8FECA`
- Release gate: the open-source Ollama project is MIT licensed, but public
  redistribution of the Windows installer and use of Ollama branding must be
  approved before a public offline package is shipped. Ollama's posted terms
  state that Ollama retains rights in its service, software, trademarks, and
  content; this repository does not contain separate written redistribution
  approval.

## Qwen2.5

Athena's default local model tag is `qwen2.5:14b`.

- Current configured runtime: `config/model.json` -> `qwen2.5:14b`
- Current local Ollama model ID: `7cdf5a0187d5`
- Current local quantization: `Q4_K_M`
- Current local size: 9.0 GB
- Current local architecture/parameters: `qwen2`, 14.8B
- Ollama model reference: https://ollama.com/library/qwen2.5:14b
- Reference model: `Qwen/Qwen2.5-14B-Instruct`
- License reference: https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE
- Qwen release note: https://qwenlm.github.io/blog/qwen2.5/

Offline model files may only be included when
`docs/OFFLINE_MODEL_ALLOWLIST.json` lists each exact source file, destination,
and SHA-256. Copying the whole user `.ollama\models` directory is not allowed.
The current allowlist includes the Ollama manifest plus config, model, system,
template, and license blobs. The main model blob is:

- `sha256-2049f5674b1e92b4464e5729975c9689fcfbf0b0e4443ccf10b5339f370f9a54`
- Bytes: `8988110688`
- SHA-256: `2049F5674B1E92B4464E5729975C9689FCFBF0B0E4443CCF10B5339F370F9A54`

## Asset provenance

Bundled and generated UI/material assets are recorded in
`docs/ASSET_PROVENANCE.md` and hashed in `docs/SUPPLY_CHAIN_MANIFEST.json`.
Human ownership/legal signoff for public distribution remains a release gate.

## Blocked public-release proofs

The following items are not inferred and must be supplied by the project owner
or counsel before a public release:

- publisher legal entity, support contact, EULA, and stable public privacy URL
- Athena and Su Shixia name/trademark clearance
- human ownership signoff for icons, tray images, splash screen, wallpapers,
  screenshots, poster art, and promotional copy
- written approval or documented policy basis for redistributing
  `OllamaSetup.exe` inside an offline package
- source/license/retention decision for local files under `models/` and
  `新建文件夹/`
