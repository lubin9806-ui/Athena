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

Avoid:

- Generic white blouse plus pleated skirt as the main identity.
- School uniform framing.
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

## Acceptance Gates

V2 cannot become the default until all are true:

- A human-visible screenshot review approves the character at chat-right, overlay, and desktop-pet sizes.
- The source package has named layers and passes alpha/contact-sheet validation.
- The Cubism export is genuine and loads through `cubism-web`.
- Lip sync changes `ParamMouthOpenY` in real time and resets after speech.
- At least five expressions and six motions are visually distinct, not just metadata.
- Hot zones trigger bounded Athena replies.
- Release docs still say public distribution is blocked until rights and Live2D license review are complete.

## Immediate Next Step

Create the v2 visual target before touching more runtime code. The next deliverable should be a new concept board or model sheet, not another patch to the v1 character.
