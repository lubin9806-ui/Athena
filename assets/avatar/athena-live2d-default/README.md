# Athena Live2D Default Avatar Asset Handoff

This folder contains Athena's default layered 2D desktop companion package and its Cubism production handoff.

Current status: Athena loads the genuine Cubism Web package by default, with a Lite fallback kept for emergency rendering. The package has parameter-bound blink, mouth-open, smile face variants, native expressions, motion files, physics metadata, alpha-fringe repaired runtime textures, and a visible runtime motion fallback for idle and interaction states. The Cubism rig is still an automated baseline, not a production-polished manual rig.

## Files

- `source/athena-live2d-default-front-v1.png`: generated full-body front reference for Live2D art separation and rigging.
- `source/athena-live2d-default-front-v2-alpha.png`: improved adult front master with real transparent alpha and rig-friendly arm/leg gaps.
- `source/athena-live2d-default-layered-v1.psd`: Cubism-importable layered PSD containing 67 named parts in five groups plus the alignment reference.
- `source/parts/*-atlas-v1-alpha.png`: transparent generated source atlases for head/hair, eyes/brows, mouths, upper body, and lower body.
- `source/parts/layers-v1/`: 67 individually sliced transparent PNG layers.
- `source/parts/parts-inventory-v1.json`: source atlas, crop, dimensions, and pixel inventory for every layer.
- `source/parts/parts-contact-sheet-v1.png`: visual QA sheet for all generated layers.
- `source/expression-variants/athena-live2d-expression-variants-v1.psd`: three aligned face patches imported into Cubism as separate ArtMeshes.
- `source/expression-variants/expression-variants-v1.json`: reproducible alignment, crop, and feather metadata for the blink, mouth-open, and smile patches.
- `source/expression-variants/expression-variants-contact-sheet-v1.png`: visual QA sheet comparing the three face variants.
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

Athena Live2D Lite remains available through `BrowserLive2DLiteHost`. It provides:

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
- separately atlased blink, mouth-open, and smile ArtMeshes
- blink opacity bound to `ParamEyeLOpen`, mouth-open opacity bound to `ParamMouthOpenY`, and smile opacity bound to `ParamMouthForm`

This is an automated baseline rig with an initial visible face-variant pass, not the final companion model. Angle X/Y and four-corner face keyforms exist, and the blink, mouth-open, and smile patches are parameter-bound. Broader face deformation polish, physics, `.exp3.json` expression presets, authored motions, and hit areas are not present yet.

The clean high-quality `ATH_REFERENCE_COMPOSITE` is now the default visible ArtMesh and is included in the 4096 px atlas. The 67 generated rig parts are hidden by default but deliberately retained in the MOC3 export, so later eye, mouth, expression, and motion work can reuse their meshes without degrading the default appearance.

Athena now uses the Cubism Web runtime adapter first and falls back to the Lite model only when Cubism loading fails.

The runtime also applies a small visible performance layer over the Cubism model. This keeps idle breathing, speaking, greeting, wave, touch-head, touch-hair-clip, drag, and return motions visible even when an automatically generated Cubism parameter curve is too weak to read on screen.

## Production Handoff

Use this folder together with:

- `docs/LIVE2D_DEFAULT_CHARACTER_BRIEF.md`
- `docs/LIVE2D_AVATAR_PLATFORM.md`

Current Cubism baseline deliverable:

- `model/athena-live2d-default.model3.json`

Run `npm.cmd run test:live2d:desktop-pet` after compiling Athena to verify the Cubism runtime, independent desktop pet window, state sync, lip-sync bridge, visible pixels, and visible motion. The stricter `verify-live2d-production-package.js` gate remains intentionally unmet until broader manual polish, independent arm deformation, and model-native hit areas are authored.
