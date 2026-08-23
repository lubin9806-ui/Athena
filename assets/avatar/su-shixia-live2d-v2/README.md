# Su Shixia Live2D V2 Source Baseline

This package is the Stage 2A automated layered-source baseline for Su Shixia.

Status: `layered_source_baseline_review_required`.

Included:

- transparent full-body front master;
- five transparent source-part atlases;
- 66 named transparent part slices;
- machine-readable layout and inventory;
- visual contact sheet;
- grouped layered PSD generated with `ag-psd`;
- front-view parameter, orientation, interaction, and package-boundary plans.

Not included:

- human-polished hidden fill and seam cleanup;
- final hand-authored mesh topology or deformers;
- a Cubism project or genuine V2 `.moc3` export;
- multi-view profile or back source packages;
- runtime motions, physics, or full-turn handoffs;
- adult-only private assets.

The reference composite remains visible in the PSD. Generated part groups are hidden so an illustrator or rigger can compare alignment before replacing or correcting individual layers.

Build and verify:

```powershell
npm.cmd run test:live2d:su-shixia-source
```

This package is source-only and must remain excluded from public installers. Public distribution stays blocked pending source refinement, rights review, Live2D license review, genuine Cubism rigging, and runtime QA.
