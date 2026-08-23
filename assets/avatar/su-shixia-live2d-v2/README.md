# Su Shixia Live2D V2 Source Baseline

This package contains the Stage 2A automated layered-source baseline, the Stage 2B front-source refinement pass, and the Stage 3A Live2D Lite runtime preview for Su Shixia.

Status: `lite_runtime_preview_ready`.

Included:

- transparent full-body front master;
- five transparent source-part atlases;
- 66 named transparent part slices;
- machine-readable layout and inventory;
- visual contact sheet;
- six-panel front alignment preview and machine-readable review report;
- four-size source readability preview for chat, overlay, desktop-pet, and compact placements;
- runtime visual QA contact sheet for 11 key Lite motions;
- softer v2 six-state mouth atlas derived from the approved face direction;
- corrective front-view neutral hands and shoes atlas;
- grouped layered PSD generated with `ag-psd`;
- front-view parameter, orientation, interaction, and package-boundary plans.
- Live2D Lite runtime preview using the Su Shixia transparent source parts;
- Athena avatar profile configured as the default Su Shixia V2 model variant;
- 40 reference-driven motion groups mapped from Haru official sample groups and Su Shixia interaction storyboards;
- 37 semantic touch zones for hair, face, ears, neck, shoulders, arms, hands, clothing, torso, waist, skirt, legs, ankles, and shoes;
- normal/private-opt-in interaction policy metadata so persona replies are model-generated but runtime-bounded;
- Cubism Editor handoff package with rig spec, 37 motion templates, physics template, display info template, and export runbook.

Not included:

- human-polished hidden fill and seam cleanup;
- final visual approval for hand/arm layering, lower-body occlusion, or turn motion quality;
- final hand-authored mesh topology or deformers;
- a Cubism project or genuine V2 `.moc3` export;
- authored Cubism mesh/deformers, physics, or `.motion3.json` clips for Su Shixia;
- final multi-view profile or back source packages;
- full-turn runtime handoffs beyond the provisional turn-preview motion group;
- adult-only private assets.

The reference composite remains visible in the PSD. Generated part groups are hidden so an illustrator or rigger can compare alignment before replacing or correcting individual layers. The v2 mouth atlas, hands, automated hidden fill, and target rectangles remain provisional until a human-visible review approves them.

Mutually exclusive hair variants, closed-eye states, alternate mouth shapes, and cheek-touch hands are hidden by default inside their PSD groups. The alignment preview renders only the default standing state so alternative motions do not contaminate the comparison.

Build and verify:

```powershell
npm.cmd run test:live2d:su-shixia-source
npm.cmd run test:live2d:su-shixia-runtime
```

The Lite runtime preview is allowed for local Athena integration and review. Runtime visual QA now proves nonblank transparent frames and visible motion deltas for the key preview motions, but the contact sheet still shows provisional automated art quality in hands, arms, lower body, and turn behavior. The Cubism handoff package is ready for Editor work, but a genuine `.moc3` has not been exported. Source and handoff directories must remain excluded from public installers. Public distribution stays blocked pending source refinement, rights review, Live2D license review, genuine Cubism rigging, and runtime QA.
