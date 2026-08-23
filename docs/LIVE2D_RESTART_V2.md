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
- 37 semantic hot zones for hair, face, ears, mouth/chin, neck, collar, shoulders, arms, wrists, hands, blouse, chest, ribs, abdomen, waist, hip, skirt, thighs, knees, calves, ankles, and shoes;
- normal/private-opt-in interaction policy metadata that keeps model-generated persona replies bounded by runtime mode;
- 40 motion groups mapped to reference-driven behavior;
- motion reference brief: `docs/LIVE2D_SU_SHIXIA_V2_MOTION_REFERENCES.md`;
- reproducible runtime gate: `npm.cmd run test:live2d:su-shixia-runtime`;
- Athena integration gate: `npm.cmd run test:live2d:integration`;
- desktop pet smoke gate: `npm.cmd run test:live2d:desktop-pet`.
- Cubism Editor handoff package: `assets/avatar/su-shixia-live2d-v2/cubism-handoff`;
- 37 `.motion3.json` reference templates plus physics and display-info templates.

Stage 3A status: `LITE RUNTIME PREVIEW READY`. Su Shixia V2 is now the default Athena Live2D model variant for local preview and desktop-pet smoke. This is not a genuine Cubism export: `cubismProjectReady` and `cubismExportReady` remain false. Haru remains the Cubism Web quality benchmark and motion reference source, not Athena's default identity.

Cubism Editor 5.3 is installed locally at `C:\Program Files\Live2D Cubism 5.3`, but no supported headless `.moc3` export command was found. The current handoff is therefore ready for Editor-based rigging/export, not an automated Cubism build.

## Stage 3B Current Evidence

Produced on 2026-08-24:

- Runtime visual QA directory: `assets/avatar/su-shixia-live2d-v2/source/review/runtime-visual-qa-v1`;
- 11 transparent motion frames for `Idle`, `Listen`, `Speak`, `TouchFace`, `TouchEar`, `TouchChest`, `TouchWaist`, `TouchSkirt`, `TouchThigh`, `TurnPreview`, and `Sleepy`;
- runtime motion contact sheet: `runtime-motion-contact-sheet-v1.png`;
- machine-readable visual QA report: `runtime-visual-qa-v1.json`;
- reproducible visual QA gate included in `npm.cmd run test:live2d:su-shixia-runtime`.

Stage 3B status: `RUNTIME VISUAL QA READY, PUBLIC ART REVIEW STILL NO-GO`. The QA report proves the Lite renderer produces nonblank transparent frames and visible motion deltas for key states. It also records high-priority manual review findings for hand/arm layering and full-turn behavior, plus medium-priority lower-body occlusion quality. This is useful runtime evidence, not final character-art approval and not a genuine Cubism export.

## Stage 3C Current Evidence

Produced on 2026-08-24:

- preview-only appearance preset contract: `docs/LIVE2D_SU_SHIXIA_V2_APPEARANCE_PRESETS.md`;
- five Lite appearance presets in `model/su-shixia-live2d-v2-lite.model3.json`;
- layer-level `appearanceTags` for hair, eyes, blouse, skirt, shoes, and the A hair clip;
- Athena preference persistence for `appearancePresetId`;
- runtime tint and accessory-visibility support in `BrowserLive2DLiteHost`;
- appearance visual QA contact sheet: `runtime-appearance-contact-sheet-v1.png`;
- GitHub scan notes and motion-reference families in `docs/LIVE2D_SU_SHIXIA_V2_MOTION_REFERENCES.md`.

Stage 3C status: `APPEARANCE PRESET PREVIEW READY, TRUE WARDROBE STILL NO-GO`. The current system can recolor hair, eyes, blouse, skirt, shoes, and hide or tint the A hair clip. It does not include new clothing silhouettes, garment physics, or genuine Cubism wardrobe parameters. `trueOutfitSwapReady` remains false until separate outfit source layers and Cubism binding exist.

## Stage 3D Current Evidence

Produced on 2026-08-24:

- Cubism Editor readiness checklist: `assets/avatar/su-shixia-live2d-v2/cubism-handoff/CUBISM_EDITOR_READINESS_CHECKLIST.md`;
- machine-readable export gate: `assets/avatar/su-shixia-live2d-v2/cubism-handoff/export-gate.json`;
- `ParamAccessoryHairClip` added to the Cubism rig spec, display-info template, and idle motion template;
- `appearanceControls` in `rig-spec.json` maps the current A hair clip visibility to a real Cubism opacity control;
- explicit wardrobe No-Go entries in the handoff package for hair/eye/outfit color tints and future outfits.

Stage 3D status: `CUBISM EDITOR HANDOFF GATE READY, EXPORT STILL MANUAL NO-GO`. The handoff now specifies how to prove a real `.moc3` export: required files, `MOC3` header, Cubism Web runtime load without Lite fallback, visible motion/expression proof, lip-sync proof, hot-zone policy proof, and remaining visual/rights/license review gates. It still does not create the Cubism project or export the `.moc3`.

## Stage 3E Current Evidence

Produced on 2026-08-24:

- Cubism export audit script: `scripts/audit-su-shixia-cubism-export.js`;
- current machine-readable audit report: `docs/quality/su-shixia-cubism-export-audit.json`;
- npm audit command: `npm.cmd run test:live2d:su-shixia-cubism-audit`;
- future hard export gate: `npm.cmd run test:live2d:su-shixia-cubism-required`.

Stage 3E status: `EXPORT AUDIT READY, CURRENT RESULT NO-GO`. The audit command intentionally exits successfully while reporting `SU_SHIXIA_CUBISM_EXPORT_AUDIT_NO_GO` so normal source/runtime checks can preserve the current truth. The required command uses `--require-go` and must fail until the exported `.moc3`, exported `model3.json`, texture, physics/display files, Cubism Web proof, lip-sync proof, visual-delta proof, and hot-zone policy proof all exist.

## Stage 3F Current Evidence

Produced on 2026-08-24:

- runtime proof template generator: `scripts/generate-su-shixia-cubism-runtime-proof-template.js`;
- runtime proof template verifier: `scripts/verify-su-shixia-cubism-runtime-proof-template.js`;
- current proof template: `docs/quality/su-shixia-cubism-runtime-proof.json`;
- npm proof-template command: `npm.cmd run test:live2d:su-shixia-cubism-proof-template`.

Stage 3F status: `RUNTIME PROOF TEMPLATE READY, PROOF STILL NO-GO`. The template fixes the evidence schema for a future genuine Cubism run: renderer must be `cubism-web`, Lite fallback is disallowed, lip-sync must move and reset `ParamMouthOpenY`, visual deltas must cover expressions and motions, hot-zone policy must cover normal and private-opt-in modes, and manual review must resolve hands, lower body, turn behavior, and wardrobe limits. The template is deliberately `template_unverified` and fails the export audit until real captured evidence replaces it.

## Stage 3G Current Evidence

Produced on 2026-08-24:

- total delivery audit script: `scripts/audit-su-shixia-live2d-delivery.js`;
- total delivery audit verifier: `scripts/verify-su-shixia-live2d-delivery-audit.js`;
- machine-readable delivery report: `docs/quality/su-shixia-live2d-v2-delivery-audit.json`;
- npm command: `npm.cmd run test:live2d:su-shixia-delivery-audit`.

Stage 3G status: `DELIVERY AUDIT READY, OVERALL NO-GO`. The report now aggregates the full chain instead of only export state. It marks requirements, Lite runtime, interaction, and Cubism Editor handoff as GO; appearance/wardrobe as PARTIAL; source/layering, genuine Cubism export, and distribution as NO-GO until human art review, true outfit source/drawables, real Cubism export/runtime proof, rights review, and Live2D license review exist.

## Stage 3H Current Evidence

Produced on 2026-08-24:

- static review dashboard: `assets/avatar/su-shixia-live2d-v2/source/review/su-shixia-live2d-v2-review-dashboard.html`;
- GitHub reference scan: `docs/quality/su-shixia-github-reference-scan.json`;
- dashboard generator: `scripts/generate-su-shixia-review-dashboard.js`;
- dashboard verifier: `scripts/verify-su-shixia-review-dashboard.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-review-dashboard`.

Stage 3H status: `REVIEW DASHBOARD READY, OVERALL STILL NO-GO`. The dashboard combines source alignment, source scale, source part sheet, Lite motion QA, appearance QA, GitHub reference sources, delivery blockers, manual findings, and Cubism proof boundaries into one local page. The GitHub scan informs package structure, runtime interaction, motion trigger workflow, and future face-tracking research, but it does not import third-party character assets or replace the required Cubism Editor export. The scan now also groups references into motion families so every current Su Shixia motion group has a reference direction before it is promoted to authored Cubism motion.

## Stage 3I Current Evidence

Produced on 2026-08-24:

- wardrobe contract: `assets/avatar/su-shixia-live2d-v2/wardrobe/wardrobe-contract-v1.json`;
- Cubism wardrobe binding plan: `assets/avatar/su-shixia-live2d-v2/cubism-handoff/wardrobe-binding-plan-v1.json`;
- wardrobe readiness audit: `docs/quality/su-shixia-wardrobe-readiness-audit.json`;
- wardrobe contract generator: `scripts/generate-su-shixia-wardrobe-contract.js`;
- wardrobe contract verifier: `scripts/verify-su-shixia-wardrobe-contract.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-wardrobe-contract`.

Stage 3I status: `WARDROBE CONTRACT READY, TRUE OUTFIT SWAP STILL NO-GO`. The contract defines four public outfit targets and a separate private opt-in package boundary. The binding plan reserves future Cubism wardrobe parameters and switch rules. It does not create alternate garment source layers, outfit drawables, clothing physics, or a genuine Cubism export. `trueOutfitSwapReady` remains false.

## Stage 3J Current Evidence

Produced on 2026-08-24:

- runtime preference contract updated in `src/renderer/avatar/live2d/AthenaLive2DCompanion.ts`;
- main-window to desktop-pet wardrobe state sync updated in `src/renderer/app.ts` and `src/renderer/live2d-pet.ts`;
- desktop-pet IPC sanitization updated in `src/app/avatar/DesktopPetWindow.ts`;
- integration verifier updated in `scripts/verify-live2d-athena-integration.js`;
- desktop-pet verifier updated in `scripts/verify-live2d-desktop-pet.js`.

Stage 3J status: `RUNTIME OUTFIT PREFERENCE READY, TRUE OUTFIT SWAP STILL NO-GO`. Athena now persists `outfitId` separately from `appearancePresetId` and syncs it to the desktop pet. The sanitizer allows only runtime-selectable outfits from the wardrobe contract. At this stage only `classic_daily` is runtime-selectable because the other public outfits have no source packages yet.

## Stage 3K Current Evidence

Produced on 2026-08-24:

- interaction matrix: `assets/avatar/su-shixia-live2d-v2/source/review/interaction-matrix-v1.json`;
- interaction readiness audit: `docs/quality/su-shixia-interaction-readiness-audit.json`;
- interaction matrix generator: `scripts/generate-su-shixia-interaction-matrix.js`;
- interaction matrix verifier: `scripts/verify-su-shixia-interaction-matrix.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-interaction-matrix`.

Stage 3K status: `SEMANTIC TOUCH MATRIX READY, ADVANCED GESTURES STILL NO-GO`. The matrix proves the current profile exposes 37 enabled touch zones across body, garment, and accessory layers, with bounded normal/private prompts, motion templates, and representative visual QA. It does not implement full gesture classification, orientation-specific hit maps, or private/adult asset packages.

## Stage 3L Current Evidence

Produced on 2026-08-24:

- orientation contract: `assets/avatar/su-shixia-live2d-v2/source/review/orientation-contract-v1.json`;
- orientation readiness audit: `docs/quality/su-shixia-orientation-readiness-audit.json`;
- orientation contract generator: `scripts/generate-su-shixia-orientation-contract.js`;
- orientation contract verifier: `scripts/verify-su-shixia-orientation-contract.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-orientation-contract`.

Stage 3L status: `ORIENTATION CONTRACT READY, TRUE MULTI-VIEW STILL NO-GO`. The current runtime has `front` plus `TurnPreview` as a visible 2.5D hint. Real turn behavior still requires profile/back source packages, orientation-specific hit maps, authored transition assets, and Cubism or equivalent runtime proof.

## Stage 3M Current Evidence

Produced on 2026-08-24:

- runtime policy proof: `docs/quality/su-shixia-runtime-policy-proof.json`;
- proof generator: `scripts/generate-su-shixia-runtime-policy-proof.js`;
- proof verifier: `scripts/verify-su-shixia-runtime-policy-proof.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-runtime-policy`.

Stage 3M status: `RUNTIME HOT-ZONE POLICY PROOF READY, CUBISM RUNTIME PROOF STILL NO-GO`. The proof runs against the compiled `AthenaLive2DCompanion` helper and confirms normal/private prompt boundaries for all current Su Shixia hot zones. It proves the Lite runtime prompt boundary and public private-asset exclusion logic. It does not prove a genuine Cubism `.moc3` load, authored Cubism motion playback, or final public distribution readiness.

## Stage 3N Current Evidence

Produced on 2026-08-24:

- hot-zone event proof: `docs/quality/su-shixia-hot-zone-event-proof.json`;
- proof generator: `scripts/generate-su-shixia-hot-zone-event-proof.js`;
- proof verifier: `scripts/verify-su-shixia-hot-zone-event-proof.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-hot-zone-events`.

Stage 3N status: `CANVAS HOT-ZONE EVENT PROOF READY, PIXEL/CUBISM PROOF STILL SEPARATE`. The proof runs the compiled `Live2DCanvasController` path and confirms representative pointer hits for face, hand, chest, thigh, and hair clip route through hit-test, visual action, runtime event emission, and persona reply callback. It does not prove real Cubism `.moc3` loading or browser pixel output.

## Stage 3O Current Evidence

Produced on 2026-08-24:

- art review packet: `docs/quality/su-shixia-art-review-packet.json`;
- packet generator: `scripts/generate-su-shixia-art-review-packet.js`;
- packet verifier: `scripts/verify-su-shixia-art-review-packet.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-art-review`.

Stage 3O status: `ART REVIEW PACKET READY, ART APPROVAL STILL NO-GO`. The packet maps source-art review lanes to the current delivery blockers: identity/default read, hands/arms, hidden fill, lower body/shoes, mouth/expression, alignment/scale, wardrobe source boundary, and turn/multi-view boundary. It makes manual art signoff actionable but does not approve the art, does not clear the human-layer/hidden-fill/alignment blockers, and does not start genuine Cubism rigging.

## Stage 3P Current Evidence

Produced on 2026-08-24:

- motion authoring packet: `docs/quality/su-shixia-motion-authoring-packet.json`;
- packet generator: `scripts/generate-su-shixia-motion-authoring-packet.js`;
- packet verifier: `scripts/verify-su-shixia-motion-authoring-packet.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-motion-authoring`.

Stage 3P status: `MOTION AUTHORING PACKET READY, FINAL CUBISM MOTION POLISH STILL NO-GO`. The packet maps all 37 Cubism motion templates to GitHub-backed reference families, semantic touch zones, voice-sync requirements, stiffness-review notes, and true-turn boundaries. It gives the rigger a concrete motion checklist for idle, voice, face/head touch, hand/arm, clothing/torso, leg/foot, and turn-preview reactions. It does not prove final non-stiff Cubism playback, because that still requires Editor playback capture, mesh/deformer polish, real TTS blending, and human review.

## Stage 3Q Current Evidence

Produced on 2026-08-24:

- gesture classifier proof: `docs/quality/su-shixia-gesture-classifier-proof.json`;
- proof generator: `scripts/generate-su-shixia-gesture-classifier-proof.js`;
- proof verifier: `scripts/verify-su-shixia-gesture-classifier-proof.js`;
- runtime classifier: `src/renderer/avatar/live2d/Live2DCanvasController.ts`;
- prompt handoff: `src/renderer/avatar/live2d/AthenaLive2DCompanion.ts`;
- npm command: `npm.cmd run test:live2d:su-shixia-gesture-classifier`.

Stage 3Q status: `GESTURE CLASSIFIER V2 READY, GESTURE-SPECIFIC CUBISM ANIMATION STILL NO-GO`. The compiled runtime now distinguishes `tap`, `repeat_tap`, `long_press`, `stroke`, and `drag`, then passes the gesture type into the persona prompt boundary. The proof covers face, hair clip, hand, skirt, and waist interactions. It does not prove separate polished Cubism animations for each gesture type; current visual actions still use the zone's existing motion group until authored Cubism curves and QA exist.

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

Review the Stage 3A-3Q Lite runtime preview in chat-right and desktop-pet placements, including the motion and appearance contact sheets, art review packet, motion authoring packet, and gesture classifier proof. In parallel, prepare the genuine Cubism rig from the reviewed PSD: mesh groups, deformers, parameter ranges, physics chains, authored `.motion3.json` curves, and future wardrobe visibility parameters. Profile and back packages follow the approved front-source method; adult-only private assets remain a separate later package boundary.
