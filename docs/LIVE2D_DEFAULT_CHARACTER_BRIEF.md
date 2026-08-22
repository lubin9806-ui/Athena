# Athena Live2D Default Character Brief

Status: personal experimental concept, not a packaged or public release asset.

Concept image:

- `docs/concepts/athena-live2d-character-concept-v1.png`

## Role

This character is Athena's first optional Live2D desktop companion concept. She should feel like a calm, intelligent, warm presence for a local-first Windows assistant. The design is original and uses the supplied photos only as mood, hairstyle, and color-blocking reference. It must not copy or identify a real person.

## Visual Direction

- Adult woman, early-to-mid 20s presentation.
- Gentle, attentive, slightly shy expression.
- Black shoulder-length layered hair.
- Airy bangs with soft separation for Live2D sway.
- Small silver geometric hair clip on one side.
- Large expressive dark eyes with natural, quiet warmth.
- Crisp white short-sleeve blouse.
- Subtle pale-cyan Athena tech accents on collar, sleeve edge, skirt detail, or shoe trim.
- Dark navy pleated skirt with readable pleat separation.
- White sneakers or simple low-profile shoes.
- Overall mood: desk companion, not mascot parody; soft, polished, and comfortable beside the chat UI.

## Boundaries

- Adult, modest, nonsexual.
- No bed pose or suggestive pose in runtime defaults.
- Avoid student/uniform framing in public copy; describe the outfit as a refined companion blouse and pleated skirt.
- Avoid childlike proportions.
- Avoid exaggerated body proportions.
- Do not use the reference photos as identity targets.
- Do not claim the generated concept is a finished Live2D model.

## Live2D Art Requirements

The production art should be commissioned or generated as layered source art suitable for rigging, not as a flat screenshot.

Required base views:

- Full-body front standing pose.
- Neutral posture with both arms visible and separable.
- Optional side/back hair reference.
- Bust close-up for face detail.

Recommended separated parts:

- Face base.
- Front bangs, side bangs, back hair, individual loose hair strands.
- Left and right eyes: white, iris, pupil, highlight, upper/lower lashes.
- Brows separated.
- Mouth shapes separated for closed, small open, wide open, smile, vowel-like shapes.
- Blush layer.
- Head, neck, torso, upper arms, forearms, hands.
- Blouse collar, sleeves, pocket, buttons, subtle trim.
- Skirt waistband, pleat groups, hem accent.
- Hair clip separated as accessory.
- Shoes separated if full-body idle motions are supported.

## Expression Set

Minimum expressions:

- neutral
- happy
- soft smile
- thoughtful
- shy
- confused
- surprised
- focused
- worried
- sleepy
- playful
- proud
- embarrassed
- gentle concern

Expression design notes:

- Keep expressions readable at desktop-pet scale.
- Use eye/brow/mouth changes more than large pose changes.
- Keep blush subtle by default.
- Add a stronger blush expression as optional, not default.

## Motion Set

Minimum motion categories:

- idle breathing
- idle hair sway
- greeting
- listening
- thinking
- speaking loop
- speaking emphasis
- nod
- shake head
- wave
- small laugh
- surprised
- shy glance
- focused work
- sleepy blink
- wake
- head touch response
- hair clip touch response
- shoulder touch response
- drag/being moved response
- return to idle

Motion design notes:

- Default idle should be calm, not noisy.
- Listening state should look attentive and respectful.
- Speaking state should pair well with real-time mouth parameters.
- Thinking state should be small and polished: eyes shift, slight hand/chin gesture, or subtle head tilt.
- Touch responses should trigger Athena-generated replies through the avatar hot-zone action system.

## Parameter Priorities

Required Live2D parameter targets:

- `ParamAngleX`
- `ParamAngleY`
- `ParamAngleZ`
- `ParamEyeLOpen`
- `ParamEyeROpen`
- `ParamEyeBallX`
- `ParamEyeBallY`
- `ParamMouthOpenY`
- `ParamMouthForm`
- hair sway parameters
- body breathing parameter

Nice-to-have targets:

- independent bangs sway
- hair clip jiggle or small highlight movement
- blouse collar secondary movement
- skirt pleat secondary movement
- shoulder/arm subtle idle movement

## Hot Zones

Initial hot zones:

- Head: gentle touch response and Athena reply.
- Hair clip: small shy or playful response and Athena reply.
- Face: reserved response; avoid over-intimate default wording.
- Shoulder: attention response and Athena reply.
- Hand: greeting or reassurance response.
- Outfit accent: brief comment on the interface/theme, not body-focused wording.

## Runtime Defaults

- Default layout: draggable overlay.
- Alternate layouts: chat right rail, chat background, desktop pet.
- Default scale: medium, readable beside chat.
- Background: transparent for overlay and desktop pet.
- Pointer tracking: enabled with low strength.
- Lip sync: enabled for TTS audio.
- Click-through: off by default; transparent-only for desktop pet after user enables it.
- Always-on-top: off by default; user controlled.

## Next Production Step

To move from concept to real Live2D runtime proof, provide one of:

- A completed Live2D `.model3.json` model package.
- A layered PSD/CLIP source prepared for Live2D rigging.
- Approval to commission or generate a layered Live2D-ready source sheet from this brief.

