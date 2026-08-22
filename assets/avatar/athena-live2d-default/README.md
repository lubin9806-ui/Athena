# Athena Live2D Default Avatar Asset Handoff

This folder contains Athena's default layered 2D desktop companion package and its Cubism production handoff.

Current status: runnable with Athena Live2D Lite and exported as a genuine Cubism 5.3 baseline package. Athena does not load the Cubism package yet, and the Cubism rig is not production-polished.

## Files

- `source/athena-live2d-default-front-v1.png`: generated full-body front reference for Live2D art separation and rigging.
- `source/athena-live2d-default-front-v2-alpha.png`: improved adult front master with real transparent alpha and rig-friendly arm/leg gaps.
- `source/athena-live2d-default-layered-v1.psd`: Cubism-importable layered PSD containing 67 named parts in five groups plus the alignment reference.
- `source/parts/*-atlas-v1-alpha.png`: transparent generated source atlases for head/hair, eyes/brows, mouths, upper body, and lower body.
- `source/parts/layers-v1/`: 67 individually sliced transparent PNG layers.
- `source/parts/parts-inventory-v1.json`: source atlas, crop, dimensions, and pixel inventory for every layer.
- `source/parts/parts-contact-sheet-v1.png`: visual QA sheet for all generated layers.
- `model/athena-live2d-lite.model3.json`: drawable layered model, parameters, expressions, motions, and hit areas for Athena's dependency-free 2D host.
- `model/athena-live2d-default.cmo3`: editable Cubism 5.3 project with generated meshes, full-body deformer hierarchy, face angle keyforms, and blink/lip-sync parameter groups.
- `model/athena-live2d-default.model3.json`: genuine Cubism SDK manifest.
- `model/athena-live2d-default.moc3`: genuine Cubism 5.3 runtime model binary.
- `model/athena-live2d-default.4096/texture_00.png`: exported 4096 px Cubism texture atlas.
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

## Cubism Baseline Boundary

The Cubism package now contains:

- `.moc3`
- `.model3.json`
- a 4096 px texture PNG
- display metadata
- `EyeBlink` and `LipSync` parameter groups

This is an automated baseline rig, not the final companion model. Angle X/Y and four-corner face keyforms exist, and eye/mouth parameters are bound, but the open/closed eye and mouth shapes still need visible manual refinement. Physics, expressions, authored motions, and hit areas are not present yet. The generated layer composition also needs default-visibility cleanup around alternate face parts.

Athena continues to use the Lite model until a licensed Cubism Web runtime adapter is integrated and validated.

## Production Handoff

Use this folder together with:

- `docs/LIVE2D_DEFAULT_CHARACTER_BRIEF.md`
- `docs/LIVE2D_AVATAR_PLATFORM.md`

Current Cubism baseline deliverable:

- `model/athena-live2d-default.model3.json`

Run `node scripts/verify-live2d-cubism-baseline.js` after compiling Athena to verify the exported binary, texture, parameter groups, and honest readiness flags. The stricter `verify-live2d-production-package.js` gate remains intentionally unmet until expressions, motions, hit areas, and physics are authored.
