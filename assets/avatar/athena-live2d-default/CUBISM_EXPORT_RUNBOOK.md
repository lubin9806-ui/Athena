# Cubism Export Runbook

Tool installed on this machine:

- `C:\Program Files\Live2D Cubism 5.3\CubismEditor5.exe`
- `C:\Program Files\Live2D Cubism 5.3\CubismViewer5.exe`

The installed Cubism Editor is a GUI tool. No supported command-line model exporter was found in the installation directory.

## Goal

Create a runnable Cubism Web package at:

- `assets/avatar/athena-live2d-default/model/athena-live2d-default.model3.json`

## Inputs

- `source/athena-live2d-default-front-v1.png`
- `layer-map.json`
- `docs/LIVE2D_DEFAULT_CHARACTER_BRIEF.md`

## Required Manual Production Steps

1. Create layered source art from `source/athena-live2d-default-front-v1.png`.
2. Use the layer names from `layer-map.json`.
3. Import the layered PSD/CLIP source into Live2D Cubism Editor.
4. Build meshes and deformers for head, hair, eyes, mouth, torso, arms, skirt, legs, and accessories.
5. Configure required parameters from `layer-map.json`.
6. Configure EyeBlink group:
   - `ParamEyeLOpen`
   - `ParamEyeROpen`
7. Configure LipSync group:
   - `ParamMouthOpenY`
   - optional `ParamMouthForm`
8. Add hit areas:
   - `Head`
   - `HairClip`
   - `Face`
   - `Shoulder`
   - `Hand`
   - `OutfitAccent`
9. Add expression files for the brief's required expressions.
10. Add motion groups for the required motion groups.
11. Add physics for hair and subtle clothing movement.
12. Export for SDK / Cubism Web into `model/`.

## Expected Output

Minimum runnable files:

```text
model/athena-live2d-default.model3.json
model/athena-live2d-default.moc3
model/textures/*.png
```

Preferred files:

```text
model/expressions/*.exp3.json
model/motions/*.motion3.json
model/physics.json
model/pose.json
model/userdata.json
```

## Verification

After export, run:

```powershell
node scripts\verify-live2d-production-package.js assets\avatar\athena-live2d-default
```

Then run the existing scanner:

```powershell
npx.cmd tsc
node scripts\verify-avatar-library.js
```

The package is not considered runnable until `verify-live2d-production-package.js` passes.

