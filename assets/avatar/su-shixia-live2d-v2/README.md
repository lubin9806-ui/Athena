# Su Shixia Live2D V2 Source Baseline

This package contains the Stage 2A automated layered-source baseline and the Stage 2B front-source refinement pass for Su Shixia.

Status: `front_source_refinement_review_required`.

Included:

- transparent full-body front master;
- five transparent source-part atlases;
- 66 named transparent part slices;
- machine-readable layout and inventory;
- visual contact sheet;
- six-panel front alignment preview and machine-readable review report;
- four-size source readability preview for chat, overlay, desktop-pet, and compact placements;
- softer v2 six-state mouth atlas derived from the approved face direction;
- corrective front-view neutral hands and shoes atlas;
- grouped layered PSD generated with `ag-psd`;
- front-view parameter, orientation, interaction, and package-boundary plans.

Not included:

- human-polished hidden fill and seam cleanup;
- final hand-authored mesh topology or deformers;
- a Cubism project or genuine V2 `.moc3` export;
- multi-view profile or back source packages;
- runtime motions, physics, or full-turn handoffs;
- adult-only private assets.

The reference composite remains visible in the PSD. Generated part groups are hidden so an illustrator or rigger can compare alignment before replacing or correcting individual layers. The v2 mouth atlas, hands, automated hidden fill, and target rectangles remain provisional until a human-visible review approves them.

Mutually exclusive hair variants, closed-eye states, alternate mouth shapes, and cheek-touch hands are hidden by default inside their PSD groups. The alignment preview renders only the default standing state so alternative motions do not contaminate the comparison.

Build and verify:

```powershell
npm.cmd run test:live2d:su-shixia-source
```

This package is source-only and must remain excluded from public installers. Public distribution stays blocked pending source refinement, rights review, Live2D license review, genuine Cubism rigging, and runtime QA.
