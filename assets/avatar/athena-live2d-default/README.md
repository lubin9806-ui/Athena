# Athena Live2D Default Avatar Asset Handoff

This folder contains Athena's default layered 2D desktop companion package and its Cubism production handoff.

Current status: runnable with Athena Live2D Lite. It is not yet an official Live2D Cubism `.moc3` model.

## Files

- `source/athena-live2d-default-front-v1.png`: generated full-body front reference for Live2D art separation and rigging.
- `model/athena-live2d-lite.model3.json`: drawable layered model, parameters, expressions, motions, and hit areas for Athena's dependency-free 2D host.
- `profile.avatar.json`: runtime mappings for emotions, state motions, lip sync, pointer tracking, idle behavior, and body-part interactions.
- `layer-map.json`: required layer names, parameters, hit areas, and motion groups for Cubism production.
- `CUBISM_EXPORT_RUNBOOK.md`: manual Cubism Editor export checklist.
- `manifest.json`: machine-readable handoff metadata.

## Runtime Boundary

Athena Live2D Lite is runnable now through `BrowserLive2DLiteHost`. It provides:

- layered canvas rendering with a transparent background
- automatic breathing, blinking, hair sway, and gaze tracking
- expression blending and `ParamMouthOpenY` lip sync
- mapped state motions and canvas hit testing
- a profile contract that can later point to an official Cubism package

It is a custom Athena format stored in a `.model3.json`-shaped document for package compatibility. It does not contain or impersonate a Cubism `.moc3` binary.

## Why Cubism Is Not Yet Runnable

A runnable Cubism Web model requires files exported from Live2D Cubism Editor, especially:

- `.moc3`
- `.model3.json`
- texture PNGs
- expression files
- motion files
- optional physics, pose, and user data files

The generated PNG remains the visual reference for official Cubism production. It still needs layered source preparation, mesh setup, deformers, parameters, motions, physics, and Cubism export.

## Production Handoff

Use this folder together with:

- `docs/LIVE2D_DEFAULT_CHARACTER_BRIEF.md`
- `docs/LIVE2D_AVATAR_PLATFORM.md`

Expected official production deliverable:

- `model/athena-live2d-default.model3.json`

After that file exists, Athena's Live2D manifest scanner and adapter smoke tests can verify the real package.
