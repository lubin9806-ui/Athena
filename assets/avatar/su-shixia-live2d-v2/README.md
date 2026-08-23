# Su Shixia Live2D V2 Source Baseline

This package contains the Stage 2A automated layered-source baseline, the Stage 2B front-source refinement pass, the Stage 3A Live2D Lite runtime preview, and the Stage 3C appearance-preset preview for Su Shixia.

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
- runtime appearance contact sheet for five preview-only presets;
- static review dashboard combining source boards, runtime QA, delivery blockers, and GitHub reference scan;
- softer v2 six-state mouth atlas derived from the approved face direction;
- corrective front-view neutral hands and shoes atlas;
- grouped layered PSD generated with `ag-psd`;
- front-view parameter, orientation, interaction, and package-boundary plans.
- Live2D Lite runtime preview using the Su Shixia transparent source parts;
- Athena avatar profile configured as the default Su Shixia V2 model variant;
- 40 reference-driven motion groups mapped from Haru official sample groups and Su Shixia interaction storyboards;
- 37 semantic touch zones for hair, face, ears, neck, shoulders, arms, hands, clothing, torso, waist, skirt, legs, ankles, and shoes;
- normal/private-opt-in interaction policy metadata so persona replies are model-generated but runtime-bounded;
- preview-only appearance presets for hair color, eye color, blouse/skirt/shoe tint, and hair-clip visibility;
- Cubism Editor handoff package with rig spec, 37 motion templates, physics template, display info template, export runbook, Editor readiness checklist, and machine-readable export gate.
- Cubism-ready A hair clip visibility parameter plan via `ParamAccessoryHairClip`.

Not included:

- human-polished hidden fill and seam cleanup;
- final visual approval for hand/arm layering, lower-body occlusion, or turn motion quality;
- final hand-authored mesh topology or deformers;
- a Cubism project or genuine V2 `.moc3` export;
- authored Cubism mesh/deformers, physics, or `.motion3.json` clips for Su Shixia;
- final multi-view profile or back source packages;
- full-turn runtime handoffs beyond the provisional turn-preview motion group;
- true multi-outfit silhouette swaps or separate garment rigs;
- adult-only private assets.

The reference composite remains visible in the PSD. Generated part groups are hidden so an illustrator or rigger can compare alignment before replacing or correcting individual layers. The v2 mouth atlas, hands, automated hidden fill, and target rectangles remain provisional until a human-visible review approves them.

Mutually exclusive hair variants, closed-eye states, alternate mouth shapes, and cheek-touch hands are hidden by default inside their PSD groups. The alignment preview renders only the default standing state so alternative motions do not contaminate the comparison.

Build and verify:

```powershell
npm.cmd run test:live2d:su-shixia-source
npm.cmd run test:live2d:su-shixia-runtime
npm.cmd run test:live2d:su-shixia-cubism-proof-template
npm.cmd run test:live2d:su-shixia-cubism-audit
npm.cmd run test:live2d:su-shixia-cubism-required
npm.cmd run test:live2d:su-shixia-delivery-audit
npm.cmd run test:live2d:su-shixia-review-dashboard
```

The Lite runtime preview is allowed for local Athena integration and review. Runtime visual QA now proves nonblank transparent frames, visible motion deltas for the key preview motions, and visible appearance-preset differences. `source/review/su-shixia-live2d-v2-review-dashboard.html` collects the current visual boards, GitHub reference scan, blockers, and Go/No-Go state in one local page. These presets recolor or hide existing layers only; they are not true clothing swaps. The A hair clip can be mapped to a real Cubism opacity parameter, but the color presets and clothing variations still need new source layers or runtime texture/drawable work before they can become genuine Cubism wardrobe controls. The contact sheets still show provisional automated art quality in hands, arms, lower body, wardrobe variety, and turn behavior.

`test:live2d:su-shixia-cubism-proof-template` creates the runtime proof JSON skeleton and verifies that it is still marked unverified. `test:live2d:su-shixia-cubism-audit` is expected to pass while reporting `NO-GO` until a real Editor export exists. `test:live2d:su-shixia-cubism-required` is the hard gate for the future genuine Cubism package and should fail now. The Cubism handoff package is ready for Editor work, but a genuine `.moc3` has not been exported. Source and handoff directories must remain excluded from public installers. Public distribution stays blocked pending source refinement, rights review, Live2D license review, genuine Cubism rigging, and runtime QA.
