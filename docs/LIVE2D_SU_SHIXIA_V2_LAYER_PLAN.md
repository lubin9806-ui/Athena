# Su Shixia Live2D V2 Layer And Rig Plan

Date: 2026-08-23

Status: Stage 2B front-source refinement review exists at `assets/avatar/su-shixia-live2d-v2`. It contains a 66-part layered PSD, corrected default-state placement evidence, and explicit provisional findings, but no Cubism project or V2 `.moc3` export.

## Core Decision

Su Shixia is not planned as one front-facing sheet stretched into every pose.

- The primary front model covers normal head turns, gaze, speech, idle motion, and most desktop interactions.
- Full body turning uses separately authored orientation states and separate rigs or art groups.
- Large hand and body actions use dedicated arm, hand, torso, and garment variants.
- Outfit and body customization use compatible validated asset variants rather than unrestricted deformation.

## Orientation Model Set

Target orientation states:

- `front`
- `front_three_quarter_left`
- `profile_left`
- `rear_three_quarter_left`
- `back`
- `rear_three_quarter_right`
- `profile_right`
- `front_three_quarter_right`

Production can begin with `front`, `profile_left`, `profile_right`, and `back`, using authored transition frames for three-quarter handoffs. The left and right states remain distinct because the hair clip and hair part are asymmetric.

Each orientation state owns:

- visible face and ear geometry;
- front, side, and rear hair groups;
- torso and neck silhouette;
- arm and hand visibility;
- garment occlusion order;
- orientation-specific hot zones;
- compatible motion and expression inventory;
- entry and exit transition clips.

## Front Model Source Hierarchy

The final source file should use stable English IDs and human-readable labels. Exact editor grouping can change during illustration, but the semantic ownership must remain.

```text
su_shixia_front
  reference
  rear_hair
    rear_hair_center
    rear_hair_left_outer
    rear_hair_left_inner
    rear_hair_right_outer
    rear_hair_right_inner
    rear_hair_underlayer
  body
    neck
    torso_base
    shoulder_left
    shoulder_right
    chest_base
    waist_base
    leg_left
    leg_right
  arm_left
    upper_arm
    forearm
    wrist
    hand_neutral
    hand_open
    hand_touch_cheek
    hand_wave
  arm_right
    upper_arm
    forearm
    wrist
    hand_neutral
    hand_open
    hand_touch_cheek
    hand_wave
  default_outfit
    blouse_back
    blouse_torso
    collar_left
    collar_right
    button_placket
    button_set
    sleeve_left
    sleeve_right
    cuff_left
    cuff_right
    waistband_back
    waistband_front
    skirt_back
    skirt_pleats_left
    skirt_pleats_center
    skirt_pleats_right
    shoe_left
    shoe_right
  head
    face_base
    ear_left
    ear_right
    nose_shadow
    nose_line
    cheek_shadow_left
    cheek_shadow_right
    blush_left
    blush_right
    brow_left
    brow_right
    eye_left
      sclera
      iris
      pupil
      highlight
      upper_lash
      lower_lash
      lid_shadow
    eye_right
      sclera
      iris
      pupil
      highlight
      upper_lash
      lower_lash
      lid_shadow
    mouth
      mouth_interior
      tongue
      teeth_upper
      lip_upper
      lip_lower
      mouth_corner_left
      mouth_corner_right
    front_hair
      bangs_center
      bangs_left_1
      bangs_left_2
      bangs_right_1
      bangs_right_2
      side_lock_left_front
      side_lock_left_rear
      side_lock_right_front
      side_lock_right_rear
      top_hair
    accessories
      hair_clip_base
      hair_clip_highlight
      necklace_chain_left
      necklace_chain_right
      necklace_pendant
      bracelet
  overlays
    eye_wetness
    tear_left
    tear_right
    blush_soft
    blush_strong
    shadow_expression
```

Hidden fill must extend behind moving parts. Eye sockets, mouth interior, face edges under hair, torso under sleeves, legs under skirt, and hair under the clip cannot end at the visible boundary.

## Gesture Source Requirements

The first interaction set requires more than neutral hanging arms:

- left and right hand-to-cheek variants;
- relaxed open hand;
- small wave;
- hand near chest for shy or startled responses;
- hand reaching toward the hair clip;
- arm positions that remain valid in front and three-quarter views;
- shoulder and blouse fill underneath every lifted arm;
- sleeve folds compatible with each arm pose;
- skirt and torso variants for lean, turn, and weight shift.

Large arm changes may use art swaps plus deformation. Do not force a neutral arm mesh through extreme rotation when it damages anatomy.

## Outfit Separation

Every outfit package provides:

- torso front and back;
- left and right sleeves;
- collar and neckline elements;
- waist connection;
- lower garment front, side, and rear groups;
- arm-pose compatibility variants;
- orientation compatibility metadata;
- hot-zone occlusion metadata;
- preview and content rating.

The default blouse and pleated skirt require enough separate pleat groups for breathing, hip shift, turn anticipation, and settle motion without producing one rigid fan shape.

## Face And Voice Parameters

Required standard or equivalent parameters:

- `ParamAngleX`
- `ParamAngleY`
- `ParamAngleZ`
- `ParamBodyAngleX`
- `ParamBodyAngleY`
- `ParamBodyAngleZ`
- `ParamEyeLOpen`
- `ParamEyeROpen`
- `ParamEyeBallX`
- `ParamEyeBallY`
- `ParamBrowLY`
- `ParamBrowRY`
- `ParamMouthOpenY`
- `ParamMouthForm`
- `ParamBreath`

Recommended custom parameters:

- `ParamJawOpen`
- `ParamCheekLift`
- `ParamBlush`
- `ParamShoulderLiftL`
- `ParamShoulderLiftR`
- `ParamLeanX`
- `ParamLeanY`
- `ParamHairClipSwing`
- `ParamSkirtSwingX`
- `ParamSkirtSwingY`
- `ParamWeightShift`

Full view changes are state transitions, not extreme values of `ParamAngleX`.

## Physics Groups

Initial physics groups:

- front bangs;
- left side locks;
- right side locks;
- rear hair mass;
- hair clip micro-swing;
- necklace pendant;
- blouse breathing and torso follow;
- left skirt pleats;
- center skirt pleats;
- right skirt pleats;
- body weight and settle motion.

Physics intensity scales with motion activity and persona energy but remains bounded per outfit.

## Expression Assets

Initial expression targets:

- neutral attentive;
- gentle smile;
- open joy;
- concern;
- quiet sadness;
- focused thinking;
- surprise;
- controlled annoyance;
- shy affection;
- playful confidence.

Mouth direction targets:

- relaxed closed;
- lightly parted transition;
- vertical A or AH;
- spread E or I;
- rounded O or U;
- compressed M, B, or P.

Expressions combine parameters and overlays. They should not replace the full face texture for every emotion unless a specific art swap is necessary.

## Turning Runtime Plan

```text
front idle
  -> turn anticipation
  -> front three-quarter
  -> profile handoff
  -> rear three-quarter handoff
  -> back settle
```

At every handoff:

- lock the active interaction zone map;
- preserve speech state where the destination rig supports it;
- map compatible expression intent into the destination rig;
- transfer motion energy and gaze intent;
- crossfade only between silhouette-compatible frames;
- unlock destination zones after the settle threshold.

The reverse path follows authored reverse-compatible motion, not automatic playback reversal when hair, hands, or clothing would move incorrectly.

## Touch Reaction Asset Matrix

High-value first-pass motions:

| Zone family | Immediate acknowledgement | Candidate authored motion |
| --- | --- | --- |
| Hair and head | blink, gaze up, small head dip | hair settle, lean into touch, pull away |
| Face and cheek | gaze to side, brow change | head turn, blush, hand-to-cheek |
| Hands and arms | gaze to hand, finger response | hand open, hand withdraw, small reciprocal reach |
| Shoulder and back | shoulder rise, glance | turn toward touch, small startle, relaxed settle |
| Clothing and accessories | glance to target | adjust collar, touch hair clip, smooth skirt |
| Waist and legs | posture acknowledgement | weight shift, step back, knee turn, boundary response |
| Restricted zones | local policy acknowledgement | only eligible package motions after validation |

The model chooses semantic intent and reply. The runtime resolves only motions valid for the active zone, orientation, outfit, content mode, and available limbs.

## Validation Before Cubism

- all source layers have stable unique IDs;
- transparent alpha contains no background contamination;
- hidden fill is present behind deformation boundaries;
- left and right limbs are not accidentally merged;
- asymmetric hair clip remains correct in every orientation;
- hand variants preserve finger count and wrist continuity;
- outfits declare orientation and gesture compatibility;
- public and adult package content cannot cross-reference;
- contact sheets show every source group and swap variant;
- model-sheet identity remains consistent across front, profile, and back views.

## Stage Boundary

The refined front source package now proves that named transparent parts, a contact sheet, a default-state alignment preview, and a readable layered PSD exist. It does not prove production-ready hidden fill, exact reconstruction, Cubism deformers, motions, physics, or multi-model handoffs. The next gate is human approval of the Stage 2B front alignment preview before Cubism rigging.

## Stage 3L Orientation Contract

Produced on 2026-08-24:

- orientation contract: `assets/avatar/su-shixia-live2d-v2/source/review/orientation-contract-v1.json`;
- orientation readiness audit: `docs/quality/su-shixia-orientation-readiness-audit.json`;
- generator: `scripts/generate-su-shixia-orientation-contract.js`;
- verifier: `scripts/verify-su-shixia-orientation-contract.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-orientation-contract`.

Stage 3L status: `ORIENTATION CONTRACT READY, TRUE MULTI-VIEW STILL NO-GO`. The contract defines eight target orientations, eight transition handoffs, orientation-specific hit-map requirements, and inheritance from the front interaction matrix. Current runtime support remains `front` plus `TurnPreview` as a front-view 2.5D hint. Profile, back, rear three-quarter, and orientation-specific hit maps remain missing source packages and must not be claimed as production-ready turn behavior.

## Motion Reference Discipline

The GitHub reference scan in `docs/quality/su-shixia-github-reference-scan.json` now includes motion-reference families for idle presence, voice speech, face/head touch, hand/arm gestures, garment/body boundary reactions, turn orientation, and future tracking input. The dashboard verifier checks that every current Lite runtime motion group is covered by at least one family before the motion can be treated as ready for Cubism authoring. These references guide timing and interaction design only; third-party character art, textures, voice clips, and unclear-license motion files are not imported into Su Shixia.

## Stage 3M Runtime Policy Proof

Produced on 2026-08-24:

- runtime policy proof: `docs/quality/su-shixia-runtime-policy-proof.json`;
- proof generator: `scripts/generate-su-shixia-runtime-policy-proof.js`;
- proof verifier: `scripts/verify-su-shixia-runtime-policy-proof.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-runtime-policy`.

Stage 3M status: `RUNTIME HOT-ZONE POLICY PROOF READY`. The proof uses the compiled `AthenaLive2DCompanion` helper to verify all 37 current hot zones in normal mode and private-opt-in attempts. Private-capable zones enter `private_opt_in` only when allowed by zone metadata; non-private zones fall back to normal even under a private-mode attempt. Sensitive and private zones in normal mode include the no-adult-escalation boundary. This is still Lite runtime policy evidence, not genuine Cubism export evidence.

## Stage 3N Hot-Zone Event Proof

Produced on 2026-08-24:

- hot-zone event proof: `docs/quality/su-shixia-hot-zone-event-proof.json`;
- proof generator: `scripts/generate-su-shixia-hot-zone-event-proof.js`;
- proof verifier: `scripts/verify-su-shixia-hot-zone-event-proof.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-hot-zone-events`.

Stage 3N status: `CANVAS HOT-ZONE EVENT PROOF READY`. The proof uses the compiled `Live2DCanvasController` and a fake Live2D host to prove representative canvas pointer hits route to `hotZone.trigger`, visual actions, runtime events, and the persona callback for face, hand, chest, thigh, and hair clip. It does not validate browser pixel rendering, true Cubism `.moc3`, or full orientation-specific hit maps.

## Stage 3O Art Review Packet

Produced on 2026-08-24:

- art review packet: `docs/quality/su-shixia-art-review-packet.json`;
- packet generator: `scripts/generate-su-shixia-art-review-packet.js`;
- packet verifier: `scripts/verify-su-shixia-art-review-packet.js`;
- npm command: `npm.cmd run test:live2d:su-shixia-art-review`.

Stage 3O status: `ART REVIEW PACKET READY`. The packet turns the source-art NO-GO items into eight manual signoff lanes and maps them to the current delivery blockers. It identifies high-risk parts for hands/arms, hidden fill, lower body/shoes, mouth/expression, alignment/scale, wardrobe source boundaries, and turn/multi-view boundaries. It intentionally keeps `humanLayerReviewApproved`, `hiddenFillReviewApproved`, and `alignmentReviewApproved` as `NO-GO` until reviewed evidence and signoff are present.
