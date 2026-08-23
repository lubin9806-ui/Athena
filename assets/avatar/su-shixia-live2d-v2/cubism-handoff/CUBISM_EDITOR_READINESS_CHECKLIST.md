# Su Shixia V2 Cubism Editor Readiness Checklist

Status: manual editor work required

This checklist is the handoff contract before Su Shixia V2 can become a genuine Cubism `.moc3` package. Passing the current Lite runtime tests does not satisfy these items.

| Gate | Required action | Evidence |
| --- | --- | --- |
| source-art | Open the PSD and confirm every visible/hidden imported layer keeps its SSX_* name. | source/su-shixia-front-layered-v1.psd<br>source/parts/parts-contact-sheet-v1.png |
| human-art-review | Review front alignment, hand/arm layering, lower-body occlusion, mouth shapes, hidden fill, and desktop-pet scale before rigging. | source/review/front-alignment-preview-v1.png<br>source/review/front-source-scale-preview-v1.png<br>source/review/source-review-v1.json |
| parameters | Create all rig-spec parameters with exact IDs, ranges, defaults, and display groups. | rig-spec.json<br>su-shixia-live2d-v2.cdi3.template.json |
| meshes | Mesh every meshGroups part and preserve draw order for face, hair, arms, skirt, legs, and accessory. | rig-spec.json |
| deformers | Create Root, Body, Head, Eyes, Mouth, Hair, Arms, Accessory, Skirt, and Legs deformers, then bind standard angle/breath/lip-sync parameters first. | rig-spec.json |
| physics | Configure hair-front, hair-side, hair-back, and skirt physics from the template and tune after motion playback. | su-shixia-live2d-v2.physics3.template.json |
| motions | Import or recreate all motion3 templates, then hand-polish touch reactions and recovery timing. | motions/*.motion3.json |
| appearance | Bind ParamAccessoryHairClip. Do not claim true clothing swaps until new outfit drawables and parameters exist. | rig-spec.json |
| export | Export moc3, model3, textures, physics, and display-info files into ../model, then verify they load with cubism-web instead of Live2D Lite. | export-gate.json |
| release-boundary | Keep source, handoff, adult-only, and private assets out of public installers until rights, license, and visual QA are approved. | ../manifest.json |

## Go/No-Go

- GO for local Lite preview: current generated source, Lite runtime, touch zones, appearance preview, and visual QA pass.
- NO-GO for public Cubism default: no genuine `.moc3`, no Cubism Web proof, unresolved art review findings, no true wardrobe drawables, and no rights/license approval.
- NO-GO for true wardrobe: only the A hair clip has a current-source Cubism visibility parameter. Clothing and color variants need new source layers or texture/drawable variants.
