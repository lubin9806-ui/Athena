# Athena Live2D Default Avatar Asset Handoff

This folder contains the first original source-art handoff for Athena's optional Live2D desktop companion.

Current status: source art only. It is not yet a runnable Live2D Cubism model.

## Files

- `source/athena-live2d-default-front-v1.png`: generated full-body front reference for Live2D art separation and rigging.
- `layer-map.json`: required layer names, parameters, hit areas, and motion groups for Cubism production.
- `CUBISM_EXPORT_RUNBOOK.md`: manual Cubism Editor export checklist.
- `manifest.json`: machine-readable handoff metadata.

## Why This Is Not Yet Runnable

A runnable Cubism Web model requires files exported from Live2D Cubism Editor, especially:

- `.moc3`
- `.model3.json`
- texture PNGs
- expression files
- motion files
- optional physics, pose, and user data files

The generated PNG in this folder is a reference/source-art asset. It still needs layered source preparation, mesh setup, deformers, parameters, motions, physics, and Cubism export.

## Production Handoff

Use this folder together with:

- `docs/LIVE2D_DEFAULT_CHARACTER_BRIEF.md`
- `docs/LIVE2D_AVATAR_PLATFORM.md`

Expected next production deliverable:

- `model/athena-live2d-default.model3.json`

After that file exists, Athena's Live2D manifest scanner and adapter smoke tests can verify the real package.
