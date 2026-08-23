# Su Shixia V2 Cubism Export Runbook

Status: cubism editor handoff ready

## Inputs

- PSD: `../source/su-shixia-front-layered-v1.psd`
- Rig spec: `rig-spec.json`
- Motion templates: `motions/*.motion3.json`
- Physics template: `su-shixia-live2d-v2.physics3.template.json`
- Display info template: `su-shixia-live2d-v2.cdi3.template.json`

## Editor Steps

1. Open Live2D Cubism Editor 5.3.
2. Import the PSD and preserve all `SSX_*` layer names.
3. Create the parameters listed in `rig-spec.json`.
4. Build meshes for each `meshGroups` entry. Keep the face, eyes, mouth, hair, arms, skirt, and legs as separately deformable groups.
5. Create deformers according to `deformers`.
6. Bind standard parameters first: head, eyes, mouth, body, breath.
7. Add secondary physics outputs for hair and skirt.
8. Import or recreate the provided motion templates after confirming parameter IDs match.
9. Export runtime files into `../model`:
   - `su-shixia-live2d-v2.moc3`
   - `su-shixia-live2d-v2.model3.json`
   - `su-shixia-live2d-v2.physics3.json`
   - `su-shixia-live2d-v2.cdi3.json`
   - texture directory
10. Run Athena validation and desktop smoke.

## Non-Automated Boundary

Cubism Editor 5.3 is installed locally, but this workspace did not find a supported headless export command. Do not mark `.moc3` ready until the Editor export exists and the runtime loads it through `cubism-web`.
