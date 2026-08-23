# Su Shixia Live2D V2 Interaction Contract

Date: 2026-08-23

Status: Stage 1 architecture specification. This document does not authorize runtime implementation or explicit asset generation.

## Purpose

Define a detailed, persona-driven interaction system for Su Shixia across body zones, garments, accessories, gestures, orientations, outfits, and content modes.

The current `AvatarHotZone` contract supports one Cubism hit area or rectangle, one fixed action, and one cooldown. V2 needs semantic touch classification, model-generated responses, allowlisted motion resolution, and content-aware validation.

## Design Rules

- The Persona Engine decides reaction meaning, emotional tone, and reply content.
- The avatar runtime decides which installed expression and motion assets can safely realize that meaning.
- The model never writes raw Cubism parameters, selects arbitrary files, unlocks content modes, or bypasses zone permissions.
- Pointer classification and exact coordinates stay local. A remote model receives the semantic zone and gesture only when remote-avatar context is enabled.
- Immediate visual acknowledgement must not wait for model latency.
- Public, intimate, and adult-only assets remain separate packages and manifests.

## Zone Taxonomy

Every applicable body zone supports a `left`, `right`, or `center` side and may be subdivided further by the active art package.

### Head And Face

- `hair.front`
- `hair.side`
- `hair.rear`
- `head.top`
- `forehead`
- `brow`
- `eye`
- `ear`
- `cheek`
- `nose`
- `mouth`
- `chin`
- `neck`

### Arms And Hands

- `shoulder`
- `upperArm`
- `elbow`
- `forearm`
- `wrist`
- `hand.back`
- `hand.palm`
- `finger`

### Torso

- `chest.upper`
- `chest`
- `rib.side`
- `waist`
- `abdomen`
- `back.upper`
- `back.lower`

### Lower Body

- `hip`
- `thigh.front`
- `thigh.side`
- `knee`
- `calf`
- `ankle`
- `foot`

### Garments And Accessories

- `accessory.hairClip`
- `accessory.earring`
- `accessory.necklace`
- `garment.blouse`
- `garment.collar`
- `garment.sleeve`
- `garment.waistband`
- `garment.skirt`
- `garment.cardigan`
- `garment.gown`
- `garment.shoe`

### Private Package Extensions

Adult-only packages may declare additional intimate zones without adding them to the public character manifest. Those identifiers, previews, reactions, and motions stay inside the adult package boundary.

## Occlusion And Target Resolution

- Resolve the visible top layer first: accessory, garment, then body.
- A touch on the blouse normally resolves to `garment.blouse`, not the covered body zone.
- Body-zone resolution through clothing requires an explicitly enabled interaction rule and an eligible content mode.
- A hidden zone is inactive. Back zones are available only in rear views; face zones are unavailable in a settled back view.
- Turning or outfit-switch transitions temporarily suspend ambiguous zones until the new hit map is stable.
- Mirrored views must preserve asymmetric details such as the left-side A hair clip.

## Gesture Classification

Classify pointer input locally into:

- `tap`
- `doubleTap`
- `repeatedTap`
- `hold`
- `stroke`
- `drag`
- `flick`
- `hover`

Classification considers duration, local path distance, direction, velocity, repeat count, pointer type, and movement relative to the active zone. The semantic event contains no raw screen path when sent to a remote model.

## Semantic Touch Event

```ts
interface AvatarTouchEventV2 {
  eventId: string;
  occurredAt: string;
  characterId: string;
  zoneId: string;
  side: 'left' | 'right' | 'center' | 'none';
  targetLayer: 'body' | 'garment' | 'accessory';
  gesture: 'tap' | 'doubleTap' | 'repeatedTap' | 'hold' | 'stroke' | 'drag' | 'flick' | 'hover';
  intensity: number;
  durationMs: number;
  repeatCount: number;
  orientation: string;
  outfitId: string;
  avatarState: string;
  speakingState: 'silent' | 'starting' | 'speaking' | 'paused' | 'ending';
  contentMode: 'normal' | 'adult';
  intimacyLevel: number;
  recentReactionTags: string[];
}
```

Values are normalized and bounded before they reach Persona Engine.

## Model Response Contract

The model returns semantic intent and reply content, not direct animation commands:

```ts
interface AvatarReactionIntentV2 {
  intent:
    | 'acknowledge'
    | 'accept'
    | 'affectionate'
    | 'shy'
    | 'playful'
    | 'comforted'
    | 'startled'
    | 'annoyed'
    | 'refuse'
    | 'ignore';
  emotion: string;
  intensity: number;
  motionTags: string[];
  expressionTags: string[];
  gaze: 'user' | 'touchSide' | 'away' | 'down' | 'none';
  replyMode: 'none' | 'text' | 'voice';
  replyText?: string;
  holdMs: number;
  cooldownClass: 'short' | 'normal' | 'long';
}
```

The runtime validates this response against:

- active content mode;
- per-zone permissions;
- installed and signed package inventory;
- active orientation and visible limbs;
- outfit compatibility;
- current speech and motion priority;
- user-selected motion activity;
- cooldown and recent repetition history.

Unknown tags, unavailable motions, invalid content, or out-of-range values fall back to a bounded neutral reaction.

## Two-Phase Response

1. Immediate local acknowledgement, targeted below 120 ms: gaze shift, blink, small head motion, or a subtle startle.
2. Asynchronous persona response: the model selects intent and generates text or voice while the runtime resolves compatible expressions and motion clips.

If model generation is delayed, cancelled, or fails, the immediate acknowledgement settles naturally without waiting indefinitely.

## Reaction Composition

A resolved reaction contains:

- pre-reaction acknowledgement;
- primary expression;
- gaze behavior;
- head and torso response;
- optional arm and hand motion;
- optional blush or other bounded overlay;
- model-generated text or voice;
- hold duration;
- settle animation;
- zone and intent cooldown.

The same touch may produce different reactions under different personas. A reserved persona can acknowledge quietly, a playful persona can tease, and an affectionate persona can respond warmly. The model may also refuse or ignore a touch. It cannot silently alter user permissions or unlock a restricted zone.

## Example: Cheek Touch

- Zone: `cheek.left`.
- Gesture: `tap`, `hold`, or `stroke`.
- Immediate response: eyes move toward the touch side and blink.
- Candidate model intents: `acknowledge`, `shy`, `affectionate`, `playful`, `annoyed`, or `refuse`.
- Candidate runtime realization: blush, head turn, chin tuck, shoulder draw-in, hand-to-cheek, backward lean, reply, hold, settle.
- Repetition changes the model context and cooldown but does not automatically increase intimacy permissions.

## Zone Permission Levels

- `public`: available in normal mode with bounded reactions.
- `personal`: user-enabled personal interaction; still non-explicit.
- `adult`: available only in adult mode with an eligible private package.
- `disabled`: never dispatches to the model and may fall through to window dragging.

Each zone stores enablement, allowed gestures, maximum intensity, reply mode, cooldown class, content rating, and whether semantic context may be sent to a remote provider.

## Adult Package Boundary

- Adult-only zones and explicit motions are absent from public and Store manifests.
- Adult mode requires deliberate user opt-in and an eligible private package.
- Public assets cannot reference adult previews, motion files, prompts, or zone identifiers.
- Package validation rejects rating mismatches and cross-package file references.
- The renderer provides a global immediate disable control and clears active adult motion state when the mode is disabled.
- Explicit pose production is outside Stage 1. The architecture reserves package and state boundaries without generating those assets now.

## Privacy And Logging

- Store semantic event names rather than raw pointer paths.
- Do not persist sensitive touch history by default.
- Audit package, zone, gesture, resolved intent, and validation outcome without storing generated intimate text unless normal chat retention explicitly applies.
- Remote providers receive touch context only under the same consent and provider disclosure rules as other conversation context.

## Required Runtime Evolution

Future implementation will need to evolve beyond the current `AvatarHotZone` shape:

- orientation-specific zone maps;
- garment and body occlusion layers;
- gesture classifiers;
- per-zone permission and content-rating metadata;
- a semantic Persona Engine request and response schema;
- allowlisted motion and expression tag resolution;
- immediate local pre-reactions;
- reaction history, weighted variants, and cooldown classes;
- public versus adult package isolation tests.

This remains future runtime work until the visual source and Stage 1 interaction review are approved.

## Stage 3K Runtime Matrix

Produced on 2026-08-24:

- interaction matrix: `assets/avatar/su-shixia-live2d-v2/source/review/interaction-matrix-v1.json`;
- interaction readiness audit: `docs/quality/su-shixia-interaction-readiness-audit.json`;
- generator: `scripts/generate-su-shixia-interaction-matrix.js`;
- verifier: `scripts/verify-su-shixia-interaction-matrix.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-interaction-matrix`.

Stage 3K status: `SEMANTIC TOUCH MATRIX READY, ADVANCED GESTURES STILL NO-GO`. The current package has 37 enabled zones covering body, garment, and accessory targets; every zone declares body part, sensitivity, mode boundary, motion intent, Lite motion, Cubism motion template, and persona reply delegation. Representative visual QA covers face, ear, chest, waist, skirt, and thigh touch reactions. Gesture classifier v2, orientation-specific hit maps, and private/adult asset packages remain future work.
