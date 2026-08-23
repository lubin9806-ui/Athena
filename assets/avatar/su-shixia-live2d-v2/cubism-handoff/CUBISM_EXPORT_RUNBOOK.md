# Su Shixia V2 Cubism Export Runbook

Status: cubism editor handoff ready

## Inputs

- PSD: `../source/su-shixia-front-layered-v1.psd`
- Rig spec: `rig-spec.json`
- Motion templates: `motions/*.motion3.json` (37 reference templates, including all profile touch motion groups)
- Physics template: `su-shixia-live2d-v2.physics3.template.json`
- Display info template: `su-shixia-live2d-v2.cdi3.template.json`
- Wardrobe binding plan: `wardrobe-binding-plan-v1.json`
- Editor checklist: `CUBISM_EDITOR_READINESS_CHECKLIST.md`
- Export gate: `export-gate.json`

## Editor Steps

1. Open Live2D Cubism Editor 5.3.
2. Import the PSD and preserve all `SSX_*` layer names.
3. Create the parameters listed in `rig-spec.json`, including `ParamAccessoryHairClip`.
4. Build meshes for each `meshGroups` entry. Keep the face, eyes, mouth, hair, arms, skirt, and legs as separately deformable groups.
5. Create deformers according to `deformers`.
6. Bind standard parameters first: head, eyes, mouth, body, breath.
7. Add secondary physics outputs for hair and skirt.
8. Bind `ParamAccessoryHairClip` to the A hair clip opacity. This is the only current Cubism-ready appearance control.
9. Open `wardrobe-binding-plan-v1.json` for the future outfit visibility parameter contract. Do not mark those parameters complete until matching outfit drawables exist.
10. Import or recreate the provided motion templates after confirming parameter IDs match.
   - Touch templates are timing and parameter references, not final polished animation.
   - Keep normal/private interaction boundaries in `profile.avatar.json`; Cubism should only provide visual reactions.
11. Export runtime files into `../model`:
   - `su-shixia-live2d-v2.moc3`
   - `su-shixia-live2d-v2.model3.json`
   - `su-shixia-live2d-v2.physics3.json`
   - `su-shixia-live2d-v2.cdi3.json`
   - texture directory
12. Run Athena validation and desktop smoke.

## Wardrobe Boundary

The Lite runtime can recolor hair, eyes, blouse, skirt, and shoes for preview. Cubism production cannot treat those tints as true clothing or texture variants. Only `ParamAccessoryHairClip` is ready for a current-source Cubism opacity binding. New outfits require separate source layers, drawables, clipping, draw order, parameters, motions, and QA evidence.

The formal true-wardrobe contract is generated separately as `../wardrobe/wardrobe-contract-v1.json`, with Cubism binding notes in `wardrobe-binding-plan-v1.json`.

## Non-Automated Boundary

Cubism Editor 5.3 is installed locally, but this workspace did not find a supported headless export command. Do not mark `.moc3` ready until the Editor export exists and the runtime loads it through `cubism-web`.
