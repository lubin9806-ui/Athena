# Athena Architecture

Athena now has one active desktop runtime path:

1. `src/app/main.ts` creates the Electron main window, registers IPC, and loads the built renderer from `dist/renderer/index.html`.
2. `src/app/preload.ts` exposes the small `window.athenaAPI` bridge used by the renderer.
3. `src/app/ipc/index.ts` is the main-process boundary for chat, memory admin, voice, system info, and window controls.
4. `src/core/controller/AthenaController.ts` coordinates the LLM client, conversation state, memory retrieval, reminders, workflows, and desktop actions.
5. `src/memory/*` is the canonical SQLite-backed memory system. The old file-backed memory flow is not part of the active runtime.
6. `src/renderer/*` owns the UI, Three.js scene, chat panel, memory drawer, and voice controls.

## Runtime Paths

Runtime path resolution is centralized in `src/core/runtime/Paths.ts`.

- Development uses the repository root.
- Packaged builds can read resources from Electron's `resourcesPath`.
- Packaged SQLite state is copied from packaged resources into Electron `userData` before use.

Avoid adding new `process.cwd()` lookups in feature code. Add a resolver to `Paths.ts` instead.

## Packaging

`electron-builder.yml` is the single packaging configuration. `package.json` only owns scripts, metadata, and dependencies.

The package includes:

- compiled app and renderer output under `dist`
- `config/*`
- `skills/*`
- runtime image resources, excluding `resources/OllamaSetup.exe`
- voice helper scripts as external resources under `resources/voice`
- the seed SQLite database under `resources/database`

The normal NSIS installer is intentionally the lightweight app installer. Use
`npm.cmd run package:offline` after `npm.cmd run build` to create
`release/Athena-Offline-Pack`, which adds the Athena installer, Ollama installer,
bundled Ollama model store, and the offline setup scripts.

`win.signAndEditExecutable` is disabled so unsigned local builds can complete on Windows accounts without symlink privileges. For a formal signed release, re-enable executable signing/editing in an elevated or Developer Mode environment.

## Legacy Code

The old Node/browser shell files were moved to `legacy/old-node-shell`. They are retained for reference only and should not be used as startup entrypoints.
