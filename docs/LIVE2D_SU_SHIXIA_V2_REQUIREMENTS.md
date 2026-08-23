# Su Shixia Live2D V2 Requirements

Date: 2026-08-23

Status: approved requirements baseline. The V3 concept is a temporary visual target, not final layered source art or a Cubism model.

## Product Role

- Character name: Su Shixia.
- Su Shixia is Athena's public default character, not only a private local skin.
- Her product roles combine companion, virtual partner, and assistant.
- Her behavior is driven by the active Persona Engine profile. The visual model must not hard-code one fixed personality.
- Public default behavior begins as natural companionship. Stronger intimacy is user-enabled rather than assumed at first launch.

## Visual Identity

- Clearly adult, approximately 20 years old.
- Visual style is an even balance of semi-realistic portrait illustration and high-end anime character art.
- Face direction: softly rounded oval face, large but natural dark eyes, small nose, subtle warm smile, fair natural skin, and light natural makeup.
- Default hair: natural black, straight shoulder-length hair, airy bangs, and rig-friendly side locks.
- Permanent identity detail: a small silver geometric A-shaped hair clip.
- Optional hairstyle: high ponytail with face-framing strands.
- Default figure: mature, naturally curvy, graceful, and realistic. Avoid childlike or exaggerated proportions.
- The user-supplied AI-generated images are visual references only. Final public source art must remain an original design.
- Avoid a cheap AI appearance, plastic skin, inconsistent anatomy, costume-template styling, and excessive decorative technology.

## Outfit System

The first release targets four switchable outfits:

1. Signature daily outfit: soft white blouse and deep navy high-waisted pleated skirt. Use natural fabric, simple adult styling, and minimal silver detail.
2. Soft assistant outfit: feminine light workwear using a draped blouse, fine-knit cardigan, and flowing dark skirt. Avoid rigid suits and mechanical trim.
3. Home companion outfit: soft knit top with comfortable lounge trousers or a similarly relaxed lower garment.
4. Date or ceremony outfit: elegant ivory draped evening gown with restrained silver details; optional high ponytail.

Outfit switching supports:

- manual selection;
- time-based selection;
- work, rest, sleep, date, and other scene rules;
- persona or conversation triggers;
- future user-imported outfit packages.

## Appearance Customization

- Hair color, eye color, outfit, and accessories are user-selectable.
- Body customization uses art-validated presets rather than unrestricted mesh deformation.
- Candidate preset dimensions include apparent height, shoulder width, waist, bust, hip and leg balance, and overall slender-to-mature presentation.
- Every body preset must have compatible outfit art and motion QA. The UI must not promise arbitrary 3D-style body morphing.

## Display Customization

- Default framing: knee-up.
- Additional framing: portrait, bust, half body, knee-up, and full body where the source art supports it.
- Persist scale, screen position, left/right orientation, opacity, always-on-top state, and motion activity level.
- Existing chat-right, overlay, desktop-pet, and related placements remain supported.

## Motion Requirements

The current unacceptable failure modes include rigid idle loops, static bodies during speech, mismatched expressions, abrupt motion transitions, and missing eye, hair, clothing, and weight inertia.

Required behavior:

- motion energy and gesture amplitude follow the active persona;
- eye focus can follow the pointer without becoming constant or distracting;
- edge proximity, long inactivity, incoming messages, conversation emotion, audio, and hot-zone touches can trigger bounded reactions;
- idle behavior varies over time and does not expose a short repeated loop;
- speech coordinates mouth, jaw, cheeks, eyes, eyebrows, head, torso, and occasional hand gestures;
- transitions blend without snapping to a neutral pose;
- breathing, hair, clothing, and body-weight secondary motion remain active at rest;
- personality can change how the same touch or event is expressed without changing safety boundaries.

Initial motion set:

- idle variants;
- listen;
- think;
- speak at low, medium, and high energy;
- nod;
- wave;
- touch head;
- touch accessory;
- drag response;
- return-to-rest;
- message arrival;
- rest or sleep transition.

### Multi-View Turning

- Normal Cubism head and upper-body angle parameters cover only a limited turn around the current view. They must not be presented as a true full-body 180-degree rotation.
- Full turning uses a multi-view state system with separately prepared front, three-quarter, profile, rear three-quarter, and back art or model states.
- Each view needs its own correct occlusion order, hair silhouette, face visibility, torso construction, arm placement, skirt construction, and hot-zone map.
- Turning transitions use authored anticipation and settle motion plus a bounded crossfade or view handoff. A single front rig must not be stretched into a false side or back view.
- Left and right views may share mirrored assets only where asymmetric details, especially the A-shaped hair clip, remain physically correct.
- The runtime state machine must know the active orientation before accepting motions or touches that require a visible face, hand, or accessory.

### Action Composition

- Complex reactions use `anticipate -> action -> hold -> settle` phases rather than one uninterruptible clip.
- Action selection considers the active persona, current emotion, intimacy level, orientation, outfit, available hands, current speech state, recent repetition, and user motion-activity preference.
- Important motions need graceful interruption and a valid return path for speech start, drag, window movement, outfit switch, and application shutdown.
- Repeated events choose among weighted variants and cooldowns so the companion does not expose a mechanical response loop.

Example face-touch reaction:

1. Check touch permissions, visible face hot zone, cooldown, and current state.
2. Interpret the touch through persona and intimacy settings.
3. Acknowledge with gaze shift and a brief blink or eyebrow response.
4. Blend into a shy response such as subtle blush, head turn, shoulder draw-in, small backward lean, or hand-to-cheek motion.
5. Optionally produce a bounded voice or text response.
6. Hold briefly, then return through a natural settle animation instead of snapping to idle.

## Voice Adaptation

The current unacceptable failure modes include poor lip timing, mouth-only speech, emotion and persona mismatch, unnatural speech start/pause/end behavior, and inconsistent behavior across voices.

Required behavior:

- Mandarin is the primary launch language; other languages remain configurable.
- Use phoneme or viseme timing when the voice provider exposes it.
- When only audio is available, use calibrated audio analysis with per-voice smoothing rather than raw volume-only mouth opening.
- Map speaking emotion into eyes, eyebrows, mouth form, head motion, posture, and gesture energy.
- Handle speech start, internal pauses, interruption, completion, and cancellation as distinct animation states.
- Store a voice adaptation profile per voice or provider for latency, mouth gain, smoothing, expected pitch range, and motion energy.
- Persona controls speaking pace, pitch intent, pause style, emotional intensity, gesture frequency, gaze behavior, and interpersonal distance where supported by the selected TTS provider.
- Voice capability claims must remain truthful when a provider cannot expose a requested control.

## Interaction Zones

Detailed interaction contract: `docs/LIVE2D_SU_SHIXIA_V2_INTERACTION_CONTRACT.md`.

Initial bounded hot zones include:

- hair;
- head;
- cheek or face;
- hands;
- clothing and accessories;
- general body silhouette for drag and placement behavior.

The V2 contract expands this into head and face, arms and hands, torso, lower body, garments, accessories, and private-package extensions. Zones support left/right distinction, orientation visibility, clothing occlusion, gesture classification, permissions, and content ratings.

Persona Engine generates reaction intent, emotional tone, and reply content. The runtime validates that intent and resolves only compatible allowlisted expressions and motions. The model does not control raw Cubism parameters or unlock restricted interactions.

Reactions may vary by persona and intimacy level. Public defaults must remain appropriate, non-coercive, and user-configurable.

Touch settings must support per-zone enablement, reaction intensity, text or voice feedback, repeat cooldown, and a global disable control.

## Adult Private Content Boundary

- The public default character, Microsoft Store package, and general release assets exclude explicit sexual poses and animations.
- Adult-only intimate or explicit pose packs, if supported later, are separate private user-installed resources with an explicit age gate, deliberate opt-in, content rating metadata, and an immediate disable control.
- Adult content does not bypass the Persona Engine, touch permissions, interruption handling, privacy rules, or package validation.
- Extreme body poses usually require dedicated source art, occlusion groups, hand variants, outfit variants, and separately authored rigs. They must not be promised as arbitrary deformation of the default standing model.
- Public and adult packages must have separate manifests, tests, previews, export paths, and distribution rules so restricted assets cannot enter a public build accidentally.
- Stage 1 records the architecture boundary only. It does not generate or bundle explicit imagery.

## Runtime Quality Targets

- Prefer 60 FPS with a lower-performance mode.
- Maintain stable layout dimensions while animation runs.
- Keep expression and motion transitions visually continuous.
- Verify the model at portrait, bust, knee-up, and desktop-pet scales.
- Provide a motion activity control for users who prefer a quieter companion.
- Do not call generated concept art a rig, layered source package, or Cubism model.
- Do not call an export official Live2D without genuine Cubism rigging and `.moc3` export.

## Current Visual Baseline

- Selected temporary concept: `docs/concepts/su-shixia-live2d-v2-four-outfits-v3-soft.png`.
- Rejected direction: rigid blazer, geometric collar, cyan piping, hard mechanical trim, and costume-like Athena branding.
- The V3 concept is approved only as the basis for the next model-sheet pass. Face, garment construction, and body proportions can still be refined before layered source production.

## Stage 1 Deliverables

- default-outfit front, three-quarter, side, and back model views;
- bust close-up with stable facial landmarks;
- expression set covering neutral, gentle smile, joy, concern, sadness, focus, surprise, annoyance, shyness, and playful intimacy;
- mouth-shape direction covering closed, small open, wide open, rounded, and smile speech forms;
- hair separation notes for front bangs, side locks, rear mass, and accessory;
- outfit component notes for collar, sleeves, torso, skirt panels, and optional accessories;
- multi-view state map for front-to-side-to-back turning and view-specific motion availability;
- interaction sequence specification for face touch and other high-value hot zones;
- package-rating boundary for public and adult-only private motion resources;
- human screenshot review before any layered-source or Cubism work begins.

Layer and rig planning: `docs/LIVE2D_SU_SHIXIA_V2_LAYER_PLAN.md`.

## Approval Boundary

Requirements are approved. The visual target remains provisional until the Stage 1 model sheet and expression sheet receive human approval. Layered source production, Cubism rigging, public distribution rights, and Live2D licensing remain separate gates.
