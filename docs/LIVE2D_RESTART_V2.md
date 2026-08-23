# Athena Live2D Restart V2

Date: 2026-08-23

Status: restart accepted. The previous Athena default character direction is retired as a visual product direction.

## Decision

Athena keeps the Live2D runtime platform, desktop pet window, event bridge, lip-sync path, hot-zone contract, and local package validation work.

Athena does not continue polishing the current `athena-live2d-default` character as the product default. That asset remains only as a technical archive and regression fixture. The official Haru sample remains only a Cubism runtime benchmark and temporary reference model, not Athena's identity.

The new default character work starts from a fresh v2 art direction and must be judged on visual quality before more engineering features are added.

## Why Restart

- The v1 concept reads too generic and too close to a stock anime school/uniform direction.
- The character does not yet carry enough Athena-specific identity at desktop scale.
- The automatically generated rig proves the pipeline can run, but it is not a satisfying default companion.
- Continuing to add motions, settings, or packaging around the v1 asset would hide the real blocker: art direction and model quality.

## Keep

- `src/shared/types/avatar.ts`
- `src/core/avatar/*`
- `src/renderer/avatar/AvatarRuntime.ts`
- `src/renderer/avatar/live2d/*`
- `src/app/avatar/DesktopPetWindow.ts`
- `src/app/live2d-preload.ts`
- Live2D runtime packaging and source-leak checks
- Haru reference model for renderer and motion regression tests

## Retire

- `docs/concepts/athena-live2d-character-concept-v1.png` as the product art direction
- `assets/avatar/athena-live2d-default` as the default Athena identity
- v1 visual claims such as "default visual ready" or "engineering GO" for Athena's own character
- the 3D/VRM production route for the personal companion unless a later explicit need appears

## V2 Art Direction

The v2 character should feel like an adult desktop work companion for a local-first Windows assistant: warm, intelligent, calm, and present, but with a stronger original silhouette and less costume-template energy.

Required direction:

- Adult presentation, not student-coded.
- Distinct Athena identity visible at small desktop-pet scale.
- Original outfit system designed around desk work, subtle technology, and quiet elegance.
- Hair silhouette with rig-friendly separations and recognizable shape.
- Face design with high expression readability without exaggeration.
- Full-body and bust compositions designed for Live2D deformation from the start.
- No claim of photographic likeness or real-person identity.

Current approved baseline:

- Su Shixia is the public default character and combines companion, virtual partner, and assistant roles.
- The active Persona Engine profile drives personality, motion energy, voice behavior, and interaction style.
- The temporary V3 visual target uses a soft white blouse and deep navy pleated skirt for the default outfit.
- Athena identity comes from the complete face, hair, silver A-shaped hair clip, motion, voice, and interaction system. Do not force identity through rigid technology trim.
- Full requirements: `docs/LIVE2D_SU_SHIXIA_V2_REQUIREMENTS.md`.

Avoid:

- School-uniform framing, badges, sailor collars, or school-role language around the approved blouse and skirt.
- Rigid blazers, geometric collars, cyan piping, and mechanical costume trim as the main identity.
- Flat front-only art that lacks separated deformation intent.
- Feature work that compensates for weak art direction.

## Production Stages

### Stage 0: Reset Gate

- Mark v1 as retired.
- Keep Haru as the temporary runtime benchmark.
- Update release language so Athena's original Live2D character is explicitly not GO.
- Keep product/Store/Steam claims excluded until separately approved.

### Stage 1: V2 Visual Target

- Produce 2-3 strong v2 concept boards.
- Choose one direction based on desktop-pet readability, silhouette, expression range, and Athena identity.
- Create a final model sheet: front full-body, bust close-up, face expression set, hair side/back notes, outfit component notes.

### Stage 2: Layered Source

- Generate or commission a layered source sheet prepared for Live2D rigging.
- Required separations: head, face base, eyes, brows, mouth shapes, hair groups, torso, arms, hands, outfit accents, and optional lower body.
- Validate transparent alpha, layer names, layer bounds, and contact sheet.

### Stage 3: Cubism Rig

- Build a genuine Cubism project and export `.moc3` only after the source is good enough.
- Required parameters: head angles, eye open, eye ball, mouth open/form, breathing, and primary hair swing.
- Required motions: idle, listen, think, speak, nod, wave, touch head, touch accessory, drag, return.

### Stage 4: Athena Integration

- Wire v2 as the Athena default only after runtime screenshots, motion smoke, lip-sync, hot zones, and desktop pet behavior pass.
- Keep Haru available as a reference package.
- Keep user package import and customization separate from Persona Engine.

## Stage 1 Current Evidence

Produced on 2026-08-23:

- requirements baseline: `docs/LIVE2D_SU_SHIXIA_V2_REQUIREMENTS.md`;
- full-body interaction contract: `docs/LIVE2D_SU_SHIXIA_V2_INTERACTION_CONTRACT.md`;
- layer and multi-view rig plan: `docs/LIVE2D_SU_SHIXIA_V2_LAYER_PLAN.md`;
- selected temporary outfit baseline: `docs/concepts/su-shixia-live2d-v2-four-outfits-v3-soft.png`;
- default-outfit turnaround: `docs/concepts/su-shixia-live2d-v2-default-turnaround-v1.png`;
- expression direction: `docs/concepts/su-shixia-live2d-v2-expressions-v1.png`;
- mouth-shape direction: `docs/concepts/su-shixia-live2d-v2-mouth-shapes-v1.png`;
- turn and face-touch motion storyboard: `docs/concepts/su-shixia-live2d-v2-turn-touch-storyboard-v1.png`.

Stage 1 status: `BASELINE ACCEPTED FOR STAGE 2`. The user approved continuing from the current visual baseline on 2026-08-23. These artifacts still define direction rather than runtime proof.

## Stage 2 Current Evidence

Produced on 2026-08-23:

- source-only package: `assets/avatar/su-shixia-live2d-v2`;
- transparent front master: `source/su-shixia-front-master-v2-alpha.png`;
- five transparent source-part atlases;
- 66 named `SSX_*` transparent slices;
- machine-readable parts layout and inventory;
- 1500 x 3360 visual contact sheet;
- grouped `source/su-shixia-front-layered-v1.psd` generated with `ag-psd`;
- reproducible build and verification gate: `npm.cmd run test:live2d:su-shixia-source`.

Stage 2 status: `AUTOMATED BASELINE REVIEW REQUIRED`. The package passes structural, alpha, naming, part-count, contact-sheet, and PSD-readback checks. Human refinement is still required for hidden fill, seams, hand anatomy, mouth style, target alignment, and deformation readiness. Profile, back, and adult-only private source packages do not exist yet.

Stage 2B refinement evidence produced on 2026-08-24:

- softer six-state v2 mouth atlas;
- corrective front-view neutral hands and shoes atlas;
- corrected eye and mouth target proportions;
- default-state-only six-panel alignment preview at `source/review/front-alignment-preview-v1.png`;
- four-size source readability preview at `source/review/front-source-scale-preview-v1.png`;
- machine-readable findings at `source/review/source-review-v1.json`;
- mutually exclusive PSD variants hidden by default.

Stage 2B status: `FRONT SOURCE REFINEMENT REVIEW REQUIRED`. Automated validation passes, but the alignment preview still shows the expected limits of independently generated parts. Mouth, hands, hidden fill, joint overlap, and exact reconstruction remain provisional and require human-visible approval before Cubism import.

Display-size review result: full-body rendering remains readable at 720 px, 520 px, and approximately 360 px high. At 220 px the facial performance is no longer readable, so compact placement must switch to a bust crop instead of shrinking the full body further.

## Stage 3A Current Evidence

Produced on 2026-08-24:

- Live2D Lite runtime preview: `assets/avatar/su-shixia-live2d-v2/model/su-shixia-live2d-v2-lite.model3.json`;
- runtime layer directory generated from the 66 named source parts;
- 68 runtime layers including two hidden cheek-touch hand overlays;
- Athena avatar profile: `assets/avatar/su-shixia-live2d-v2/profile.avatar.json`;
- 14 semantic hot zones for hair, face, mouth/chin, neck/collar, shoulders, hands, chest, waist, clothing/skirt, legs, and feet;
- 22 motion groups mapped to reference-driven behavior;
- motion reference brief: `docs/LIVE2D_SU_SHIXIA_V2_MOTION_REFERENCES.md`;
- reproducible runtime gate: `npm.cmd run test:live2d:su-shixia-runtime`;
- Athena integration gate: `npm.cmd run test:live2d:integration`;
- desktop pet smoke gate: `npm.cmd run test:live2d:desktop-pet`.
- Cubism Editor handoff package: `assets/avatar/su-shixia-live2d-v2/cubism-handoff`;
- 13 `.motion3.json` reference templates plus physics and display-info templates.

Stage 3A status: `LITE RUNTIME PREVIEW READY`. Su Shixia V2 is now the default Athena Live2D model variant for local preview and desktop-pet smoke. This is not a genuine Cubism export: `cubismProjectReady` and `cubismExportReady` remain false. Haru remains the Cubism Web quality benchmark and motion reference source, not Athena's default identity.

Cubism Editor 5.3 is installed locally at `C:\Program Files\Live2D Cubism 5.3`, but no supported headless `.moc3` export command was found. The current handoff is therefore ready for Editor-based rigging/export, not an automated Cubism build.

## Acceptance Gates

V2 cannot become the final public Cubism default until all are true:

- A human-visible screenshot review approves the character at chat-right, overlay, and desktop-pet sizes.
- The source package has named layers and passes alpha/contact-sheet validation.
- The Cubism export is genuine and loads through `cubism-web`.
- Lip sync changes `ParamMouthOpenY` in real time and resets after speech.
- At least five expressions and six motions are visually distinct, not just metadata.
- Hot zones trigger bounded Athena replies.
- Release docs still say public distribution is blocked until rights and Live2D license review are complete.

## Immediate Next Step

Review the Stage 3A Lite runtime preview in chat-right and desktop-pet placements. In parallel, prepare the genuine Cubism rig plan from the reviewed PSD: mesh groups, deformers, parameter ranges, physics chains, and authored `.motion3.json` reference clips. Profile and back packages follow the approved front-source method; adult-only private assets remain a separate later package boundary.
