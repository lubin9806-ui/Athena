# Athena Live2D Avatar Platform

Status: personal experimental plan, not a Desktop 1.0 public commitment.

This document defines the modular implementation plan for Athena's highly customizable Live2D avatar layer. Live2D is the first avatar renderer, but the platform is designed so later 3D/VRM adapters can reuse the same avatar events, profiles, permissions, and editor model.

## Product Direction

- Live2D is optional and disabled by default.
- First target is the user's personal Athena build, not public Desktop 1.0 marketing.
- The avatar is a visual and interactive presence layer. It must not fork Persona Engine, memory, prompt building, model routing, or voice services.
- The user can import local Live2D models from arbitrary directories.
- Multiple characters are supported. A Persona may suggest a character, but Persona and avatar are not hard-bound.
- The default behavior maps Athena emotion and runtime state to expressions and motions, with user-editable overrides.
- Four layouts are required: chat right rail, chat background, draggable overlay, and transparent desktop pet window.
- The desktop pet window must support always-on-top and click-through behavior with a clear interactive-area policy.
- Real-time lip sync is required. The first implementation should use Web Audio analysis; advanced motion-sync support can be added after the basic path is stable.
- Clickable model regions should trigger Athena-generated replies, not only fixed local text.
- Ordinary users should get a comfortable editor for layout, mapping, motion, expression, hot zones, lip sync, and parameter tuning.
- Developer tools should expose raw Live2D parameters for advanced debugging.
- A local package format and future online marketplace/share format are both required.
- External control is allowed, but it must be local-first, permissioned, schema-validated, and code-free.

## Non-Goals For Initial Stages

- Do not change `PromptBuilder`, Persona Engine, memory retrieval, message routing, or model provider behavior.
- Do not add Live2D as a marketed capability in `docs/PRODUCT_MATRIX.md` until it is implemented and separately approved.
- Do not require a model file for Stage 1 and Stage 2.
- Do not auto-download models, SDK payloads, or marketplace content.
- Do not execute arbitrary scripts from character packages.

## Technical Basis

- Live2D Cubism SDK for Web / Cubism Web Framework should be the preferred renderer foundation because Athena needs direct access to model parameters, expressions, motions, hit testing, lip-sync parameters, and debug tooling.
- Official SDK docs state that `.model3.json` is the model reference root and can point to model, motion, expression, physics, pose, eye blinking, lip-sync, user data, and related resources.
- Official lip-sync docs describe mapping lip-sync parameter IDs from `.model3.json` and passing values from audio input, motion, or other sources.
- Electron `BrowserWindow` is the basis for a separate transparent desktop pet window with always-on-top and click-through behavior. It must keep context isolation and preload-only IPC.

References:

- Live2D lip-sync docs: https://docs.live2d.com/en/cubism-sdk-manual/lipsync/
- Live2D direct Web framework docs: https://docs.live2d.com/en/cubism-sdk-manual/use-framework-web/
- Live2D Web samples: https://github.com/Live2D/CubismWebSamples
- Live2D Web framework: https://github.com/Live2D/CubismWebFramework
- Electron BrowserWindow: https://electronjs.org/docs/latest/api/browser-window

## Module Boundaries

### Shared Types

File target: `src/shared/types/avatar.ts`

Defines the stable protocol:

- avatar profile
- character package metadata
- local model source
- renderer provider
- layout mode
- state machine states
- emotion/motion/expression mapping
- Live2D parameter bindings
- lip-sync configuration
- pointer hit zones
- external control permissions
- marketplace package metadata

This file must not import renderer or Electron modules.

### Avatar Library

Future target: `src/core/avatar/AvatarLibrary.ts`

Responsibilities:

- register imported character packages
- scan `.model3.json`
- preserve arbitrary local source directories
- normalize package metadata
- validate package schemas
- list available expressions, motions, parameters, textures, physics, pose, user data, and hit areas where available
- store user customizations outside the imported model directory

### Avatar Runtime

Future target: `src/renderer/avatar/AvatarRuntime.ts`

Responsibilities:

- consume Athena UI events
- maintain avatar state
- choose motion/expression based on mapping rules
- route pointer events to configured hot zones
- expose a renderer-agnostic adapter API

It should work with a mock adapter before the Live2D SDK is added.

### Live2D Adapter

Future target: `src/renderer/avatar/live2d/Live2DAvatarAdapter.ts`

Responsibilities:

- load `.model3.json`
- initialize Cubism Web Framework/Core
- render on canvas/WebGL
- enumerate motions, expressions, lip-sync parameters, model parameters, drawables, and user data
- apply expression, motion, parameter, eye tracking, pointer tracking, idle animation, and lip-sync values
- report load and render errors with clear user-facing reasons

### Avatar Editor

Future target: renderer settings panel or separate avatar panel.

Editor sections:

- Character: import, select, duplicate, export package
- Layout: mode, size, scale, opacity, position, mirror, always-on-top, click-through
- Behavior: idle timing, state transitions, mouse following, listening/speaking/thinking behavior
- Emotion Mapping: Athena emotion -> expression and optional motion
- Motion Mapping: state/event -> motion group or explicit motion
- Lip Sync: source, sensitivity, smoothing, gain, parameter binding
- Hot Zones: body region -> action, prompt template, local motion/expression
- Parameter Debugger: raw parameter search, slider, reset, pin favorite
- External Control: enable, token, permissions, connected clients, audit
- Marketplace: local package validation, future remote source metadata

### Desktop Pet Window

Future target: `src/app/avatar/AvatarPetWindow.ts`

Responsibilities:

- create a transparent BrowserWindow
- support always-on-top
- support click-through policies
- keep context isolation
- expose only avatar-specific preload methods
- separate pet-window lifecycle from the main chat window

Click-through modes:

- `off`: normal interactive window
- `transparentOnly`: model/hit areas receive events, transparent regions pass through
- `full`: entire window passes through until toggled back

### External Control

Recommended transport: local WebSocket on `127.0.0.1` with permission token and JSON Schema validation.

Why this path:

- more responsive and modern than polling a local JSON file
- safer than exposing arbitrary HTTP routes
- easier to permission and audit than plugin code execution
- suitable for future local tools, Stream Deck style integrations, and developer harnesses

Rules:

- disabled by default
- binds only to loopback
- per-client approval
- token required
- schema-validated command whitelist
- no arbitrary code
- no arbitrary filesystem reads from avatar commands
- command audit stored separately from chat content

Example command:

```json
{
  "type": "avatar.motion.play",
  "characterId": "local-character",
  "motion": "wave",
  "priority": 70,
  "ttlMs": 5000
}
```

## Avatar State Machine

Required states:

- `unloaded`
- `idle`
- `listening`
- `thinking`
- `streaming`
- `speaking`
- `interrupted`
- `error`
- `sleepy`
- `away`

Common event mapping:

| Athena Event | Avatar State | Typical Output |
|---|---|---|
| app ready | idle | idle motion, breathing, blink |
| microphone recording starts | listening | attentive pose, eye focus |
| user message submitted | thinking | thinking expression/motion |
| assistant response streams | streaming | subtle speaking/readiness motion |
| TTS playback starts | speaking | lip sync + speaking motion |
| TTS playback ends | idle | return to idle |
| user cancels | interrupted | interruption expression |
| model/voice error | error | confused/worried expression |
| long inactivity | sleepy/away | idle pool, sleepy motion |

## Live2D Customization Surface

Minimum expression set:

- neutral
- happy
- thoughtful
- shy
- confused
- excited
- tired
- playful
- soft
- serious
- surprised
- worried
- embarrassed
- angry
- sad
- proud
- focused
- sleepy

Minimum motion/event categories:

- idle
- idle long
- greet
- listen
- think
- speak loop
- speak emphasis
- nod
- shake head
- wave
- laugh
- surprised
- shy
- worried
- focus
- sleepy
- wake
- touch head
- touch face
- touch shoulder
- touch hand
- drag
- return

The model may not contain every category. The editor must show missing mappings and allow fallback chains.

## Lip Sync Plan

Stage path:

1. Web Audio analyser obtains volume/RMS and selected band energy from the TTS audio element.
2. Values are smoothed and mapped to configured mouth parameters, typically `ParamMouthOpenY`.
3. The Live2D model's own lip-sync parameter list from `.model3.json` is preferred when available.
4. If MotionSync metadata is present later, add a specialized adapter path.

User controls:

- enabled
- sensitivity
- smoothing
- gain
- attack/release
- min/max mouth value
- parameter binding
- preview test

## Generated Character Pipeline

The user has reference images but no model yet. The pipeline should be:

1. Collect reference images when Stage 3 or Stage 4 needs a real model target.
2. Generate or refine character concept sheets separately from runtime implementation.
3. Convert concept to actual Live2D-ready art through a human/artist or specialized Live2D workflow.
4. Import the resulting `.model3.json` package into Athena.

Athena should not claim to generate a production Live2D rig directly unless such a pipeline is actually implemented.

## Harness And Evaluation

DeepSeek harness or any OpenAI-compatible local/remote model can be used for evaluation, not as a hard runtime dependency.

Harness targets:

- state machine transitions
- click hot zone prompt quality
- emotion-to-expression mapping quality
- unsafe or boundary-crossing generated replies
- fallback behavior when model assets are missing
- external control permission behavior

Harness shape:

- input: event sequence, profile, mapping config, optional recent chat context
- output: expected state, expression, motion, action, and safety notes
- providers: local Ollama, DeepSeek, OpenAI-compatible, or offline rule assertions

## Implementation Stages

### Stage 1: Protocol And Plan

Artifacts:

- `docs/LIVE2D_AVATAR_PLATFORM.md`
- `src/shared/types/avatar.ts`

Validation:

- `npm.cmd run typecheck`
- `git diff --check`

Commit after validation.

### Stage 2: Mock Runtime Skeleton

Artifacts:

- `src/renderer/avatar/AvatarRuntime.ts`
- `src/renderer/avatar/MockAvatarAdapter.ts`
- `src/renderer/avatar/index.ts`
- optional verification script for state transitions

No UI and no SDK yet.

Validation:

- `npm.cmd run typecheck`
- small node/electron-free verifier if needed

Commit after validation.

### Stage 3: Avatar Library And Local Import Scanner

Artifacts:

- core scanner for local model directories
- `.model3.json` manifest parser
- safe metadata normalization
- schema validation

Validation:

- fixture-based parser tests
- no filesystem writes outside Athena config unless user chooses import/export

Commit after validation.

The user should provide Live2D reference images before or during this stage if a default generated character direction is needed.

### Stage 4: Live2D SDK Adapter

Artifacts:

- Cubism Web setup
- canvas renderer
- model loading from arbitrary local directory
- motion/expression enumeration
- error handling

Validation:

- load a sample or user-provided model
- screenshot/canvas nonblank check
- motion/expression smoke check

Commit after validation.

### Stage 5: Interaction And Lip Sync

Artifacts:

- TTS audio analyser
- mouth parameter binding
- listening/thinking/speaking transitions
- pointer tracking
- hit zones -> Athena-generated replies
- idle state pool

Validation:

- event sequence checks
- visual smoke
- audio analyser sanity check

Commit after validation.

### Stage 6: User Editor

Artifacts:

- comfortable settings/editor UI
- mapping editor
- parameter debugger
- import/export character profile

Validation:

- renderer smoke
- layout checks for desktop and compact sizes

Commit after validation.

### Stage 7: Desktop Pet Window

Artifacts:

- transparent always-on-top pet BrowserWindow
- click-through policies
- drag/position persistence
- isolated preload

Validation:

- window lifecycle smoke
- click-through policy smoke where feasible

Commit after validation.

### Stage 8: Marketplace And External Control

Artifacts:

- local character package format
- package validation
- future remote manifest format
- local WebSocket control service
- permission and audit UI

Validation:

- schema tests
- permission tests
- malformed command rejection tests

Commit after validation.

## Stage Gate Rule

Every stage must:

- inspect `git status --short`
- avoid staging local `config/settings.json`
- run the stage-specific checks
- stage only files belonging to the stage
- commit with a scoped message
- report remaining uncommitted files

