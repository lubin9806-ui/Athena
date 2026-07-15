Legacy Node/browser shell kept for reference only.

The active Athena desktop runtime is the Electron + TypeScript entrypoint:

- package main: `dist/app/main.js`
- source entry: `src/app/main.ts`
- renderer source: `src/renderer`
- startup command: `npm.cmd run dev`

These files were moved out of the repository root because they start an older
Node HTTP/browser-shell flow with file-backed memory. Keeping them in the root
made it easy to launch the wrong architecture by accident.
