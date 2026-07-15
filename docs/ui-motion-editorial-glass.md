# Athena UI / Motion Direction — Athenian Daylight

Chinese working name: **雅典日光**.

## 1. Corrected conclusion

Athena is a functionally complex desktop companion inside a compact 480 × 700 window. Its hierarchy cannot depend on a dense architectural wireframe.

The revised direction is:

- **light-dominant rather than dark-dominant;**
- **surfaces, spacing, and soft depth rather than repeated lines;**
- **contemporary Athenian light and material rather than literal classical decoration;**
- **warm companion personality inside a calm professional structure.**

Reverse: 1999 remains only a reference for authored composition and confident asymmetry. Its period, archive language, props, and graphic density are excluded.

## 2. Complexity rule

Athena contains chat, three modes, memory administration, settings, voice, status, and desktop actions. Every decorative element therefore consumes part of the same attention budget as a real function.

### Use for hierarchy

1. whitespace;
2. tonal surface changes;
3. scale and typography;
4. soft shadow and translucency;
5. color accents;
6. lines only when the boundary cannot be understood without one.

### Line budget

- No stage frame around the conversation.
- No vertical timeline or full-height guide.
- No background grid or repeated column outlines.
- No outline around every card, panel, button, and input.
- At most three visible structural rules in the default screen, excluding icon strokes.
- Separators inside complex drawers use spacing and tonal grouping first.

## 3. Athenian source, translated without costume

### Agora

The Ancient Agora was the shared center of civic, social, cultural, and commercial activity. It remains the spatial model for an open conversation field rather than a boxed chat card.

Reference: [Hellenic Ministry of Culture — Ancient Agora](https://odysseus.culture.gr/h/3/eh351.jsp?obj_id=2485)

### Acropolis Museum

The museum connects the Acropolis, exhibits, excavation, and modern city through transparent facades, glass floors, concrete, marble, and controlled natural light. This is the primary material reference.

Translation:

- warm stone-colored background;
- broad translucent glass planes;
- one or two soft cast shadows;
- memory represented by depth beneath a surface, not by a drawn archaeological diagram;
- modern asymmetry without faux ruins.

Reference: [Acropolis Museum — The Museum Building](https://www.theacropolismuseum.gr/en/museum-building)

### Researched material sources

The architectural material is not approximated with SVG linework. The production plate is generated from a reference brief grounded in these sources:

- [Acropolis Restoration Service — The Parthenon](https://acropolisrestoration.ysma.gr/wp-content/uploads/2025/05/06_PARTHENWN_EN.pdf): Doric proportions, restored drums, fluting, and Pentelic-marble construction.
- [Acropolis Museum — The Parthenon Gallery](https://www.theacropolismuseum.gr/en/exhibit-halls/parthenon-gallery): original marble sculpture shown in natural light inside a transparent glass envelope.
- [Acropolis Museum — South Frieze Block I](https://www.theacropolismuseum.gr/en/parthenon-south-frieze-block-1-i): Pentelic-marble architectural relief and Panathenaic movement.
- [Museo dell’Ara Pacis — Natura di marmo](https://www.arapacis.it/it/didattica/amici-natura-di-marmo-il-fregio-vegetale-dell-ara-pacis): deeply modeled vegetal relief as a Roman counterpoint.

`docs/concepts/athena-classical-material-field.png` remains concept research only. The runtime does not display the plate or derived architectural cut-outs. Literal columns and relief images were tested and rejected because they read as floating decoration rather than application structure.

### Parthenon refinements

The lesson from the Parthenon’s subtle curves and spacing corrections is perceptual harmony. It does not justify drawing more lines.

Translation:

- optical spacing can differ slightly at edges;
- large surfaces may taper by a few pixels;
- selected controls can use gentle asymmetric geometry;
- motion easings are smooth and controlled.

Reference: [YSMA — Parthenon](https://www.ysma.gr/en/monuments/parthenon/)

### Athena’s symbols

Olive, owl, and Greek lettering remain optional micro-details. Only one such reference may be visible in the default screen, and it must carry meaning.

Reference: [Acropolis Museum — Athenian Obol](https://www.theacropolismuseum.gr/en/athenian-obol-20)

## 4. Light material system

### Palette

| Token | Value | Role |
| --- | --- | --- |
| `--daylight` | `#f3f1eb` | main background |
| `--pentelic` | `#e7e1d6` | warm stone plane |
| `--glass-clear` | `rgba(255, 255, 255, .10)` | live title bar and composer base |
| `--glass-frost` | `rgba(255, 255, 255, .20)` | focused or active glass state |
| `--glass-edge` | `rgba(255, 255, 255, .82)` | ice-bright optical edge highlight |
| `--surface-white` | `rgba(255, 255, 255, .76)` | grouped tools and messages |
| `--ink` | `#29343a` | primary text |
| `--ink-muted` | `#68747a` | secondary text |
| `--aegean` | `#7398a7` | creation |
| `--terracotta` | `#b9796c` | companionship |
| `--olive` | `#7d886c` | healthy status and memory |
| `--bronze` | `#a68955` | reasoning and key emphasis |

### Background recipe

- Base: warm off-white stone, never pure white.
- One large cool glass plane placed off-axis near an edge.
- One broad warm sunlight wash, with no defined outline.
- Extremely subtle static mineral grain.
- No literal column, relief, statue, or architectural cut-out appears in the default background.
- No grid, full colonnade, temple silhouette, date code, or decorative line network.

The background is a quiet material field, not a picture. Athenian influence must come from daylight, proportion, spacing, warmth, and glass rather than inserted objects.

### Surface recipe

- Title and composer glass use only `4–18%` white tint, `15–21 px` backdrop blur, elevated saturation, and separate warm/cool optical edges.
- Glass relies on tint, translucency, light scattering, refraction cues, and shadow rather than an opaque white fill.
- A clear pane needs visible material behind it: broad warm and cool light fields sit beneath the controls without forming a picture.
- Tool groups use filled surfaces with 12–22 px radii.
- Adjacent actions are separated by 8–12 px of space or a tonal change.
- Borders are reserved for keyboard focus, destructive states, and rare precision boundaries.

### Live glass behavior

The title bar, mode selector, and composer share one small event-driven glass controller; no independent decorative animation loops are created.

- Pointer proximity separates the white highlight from its cool refraction by no more than `10 px`, using an inertial settle that stops after the pointer stops.
- Pointer down creates a clipped pressure response: a quick glint and one soft caustic bloom complete within `420 ms`. Repeated presses replace the previous response instead of stacking rings.
- Focus raises the glass tint from roughly `10%` to `20%`, increases blur slightly, lifts the composer by `3 px`, and tightens the shadow.
- Mode changes crossfade one warm and one cool refracted field inside the glass over `320–380 ms`.
- While the microphone is active, real input amplitude may alter highlight width by at most `6%`; it must not create a fake breathing pulse.
- Broad background light fields remain faintly legible through both bars, while pointer-driven highlights provide the primary material response.
- Pointer-driven updates run only while input changes and settle after the inertial gap closes; idle surfaces consume no animation frame loop.
- `prefers-reduced-motion` freezes the highlight at a balanced static position while preserving transparency.

### Conversation modes are runtime controls

The three tabs are not theme presets. The active mode is persisted, travels with every chat request, changes the system prompt, and selects a distinct Ollama sampling profile while reusing the same local model.

| Mode | Runtime priority | Generation profile |
|---|---|---|
| 创作 | diverge into distinct directions, then recommend and produce an actionable result | base temperature `+0.20`, `top_p 0.95` |
| 陪伴 | conversational continuity, emotional intent, and concise natural response | base temperature, `top_p 0.90` |
| 推理 | separate facts, assumptions, inference, risks, and a checkable conclusion | base temperature `-0.25`, `top_p 0.78` |

Temperature values are clamped to safe local bounds. Mode changes apply to the next submitted message and do not require downloading another model.

### Athenian Nocturne

Night mode is a distinct low-glare material treatment rather than an inverted daylight palette.

- The base stays blue-gray instead of pure black, with restrained bronze warmth at the upper-left and cool Aegean refraction at the right edge.
- Glass highlights are reduced to roughly half of daylight intensity; text remains neutral and readable without blue-white glare.
- A sparse, static celestial layer places a few sub-pixel stars near the upper and outer field plus one faint cool nebula wash. It never becomes a full-screen particle system or wallpaper illustration.
- `system` resolves to day or night through `prefers-color-scheme` and updates live when the OS preference changes.
- Theme selection is persisted through the existing appearance settings path; no idle animation loop is introduced.

## 5. Default composition

### Title bar

- One quiet transparent daylight-glass surface; it must not read as a white toolbar.
- Identity and online state on the left; memory, settings, and window controls on the right.
- A soft refracted highlight may react to pointer proximity around memory and settings.
- No surrounding frame beyond a sub-pixel optical glass edge.

### Mode selector

- Chinese labels remain primary.
- Only the active mode may show its Greek secondary label.
- One filled selection plate moves between modes.
- No three outlined cells and no permanent secondary microtype under every option.

### Agora / chat field

- Open background with generous left alignment.
- One small context label, one headline, one supporting sentence.
- Suggested actions live inside one soft grouped surface, not independent outlined tickets.
- Assistant content uses either open typesetting or one low-contrast filled reading surface depending on length.

Suggested empty-state copy:

> 在这里，想法可以慢慢成形。

> 创作、整理、推理，或者只是说两句。

### Composer

- Clearest and most tactile glass element in the window, but still visibly transparent.
- No opaque outline in the resting state; only a one-pixel prismatic optical rim.
- Text input occupies most of the width.
- Send uses the active mode color; secondary tools remain neutral.
- Focus, typing, and real microphone input change the material locally; the whole bar never pulses.

### Architectural restraint

- No background object is responsible for making the interface feel “Athenian.”
- Architectural influence is limited to measured spacing, calm asymmetry, warm stone color, and the optical depth of glass surfaces.
- The rejected 2.5D wallpaper direction must not return as isolated columns, relief cut-outs, parallax photo layers, or a full-screen scene.
- Future character should come from application states and content choreography rather than decorative scenery.

## 6. Three modes

| Mode | Concept | Surface behavior |
| --- | --- | --- |
| 创作 | `POIESIS` | cool daylight and Aegean-blue content groups |
| 陪伴 | `PHILIA` | warm daylight and terracotta selection/action |
| 推理 | `LOGOS` | neutral daylight with olive-bronze emphasis |

The modes do not swap wallpaper. They rebalance a few broad light fields and the functional accent so the app remains stable.

## 7. Motion

| Interaction | Duration | Treatment |
| --- | ---: | --- |
| Startup | 360–440 ms once | title, mode, content, and composer condense from soft blur with a short stagger |
| Mode switch | 180–240 ms | one glass selection plate moves immediately; the runtime mode is already active before the visual settle finishes |
| Message entry | 160–220 ms | opacity and 3 px reveal from the reading origin |
| Glass pointer response | event-driven inertial settle | warm highlight and cool refraction move out of phase within a 10 px range |
| Glass press | 260–420 ms once | a short local glint leads one soft caustic bloom; no concentric ring sequence or stacked residue |
| Composer focus | 150–220 ms | tint and blur rise, optical edge brightens, and the surface lifts 3 px |
| Microphone active | real input only | amplitude changes local highlight width by no more than 6% |
| Memory drawer | 260–340 ms | inspector expands from the memory control; underlying content desaturates slightly |
| Settings drawer | 260–340 ms | same spatial grammar as memory, with no staged line drawing |
| Thinking | active only | local text/cursor feedback beside the response |

Rules:

- no line-drawing startup;
- no animated background grid or moving architectural traces;
- no orb, divine beam, temple door, sigil, particles, or idle pulse;
- every transition is interruptible;
- reduced motion keeps only short opacity changes.

## 8. Complex panels

Memory and settings contain real complexity, so they use a professional inspector hierarchy:

- glass outer shell;
- opaque or near-opaque section groups;
- stronger section titles, quieter descriptions;
- fields grouped by purpose with 16–20 px vertical spacing;
- dividers only between materially different task groups;
- selected tabs use filled backgrounds, not underline plus border plus glow.

## 9. Explicit anti-goals

- no dark default background;
- no wireframe architecture;
- no large quantity of one-pixel rules;
- no outlined-card collection;
- no literal temple, ruin, statue, helmet, shield, owl illustration, Greek-key border, or tourist-poster styling;
- no isolated architectural render pasted into a corner and no fake 3D wallpaper parallax;
- no 1999 period, archive, countdown, ticket, radio, film, or dossier language;
- no generic colorful AI nebula;
- no idle GPU animation; live glass updates are event-driven and stop after settling.

## 10. Implementation map

| Existing area | Planned change |
| --- | --- |
| `#app-shell` | light stone and daylight base; never a full-screen photographic plate |
| `#titlebar` | transparent backdrop-filter glass with shared pointer-driven material variables |
| `#mode-switch` | compact neutral surface with one filled moving selection plate |
| `#presence-panel` | open layout; remove centered mark and structural drawing |
| `#chat-container` | tonal reading groups and whitespace instead of repeated outlines |
| `#input-form` | transparent live-glass composer, focus/mic material states, and active-mode send color |
| `.side-panel` | light glass inspector shell with opaque grouped sections |
| `app.ts` | coordinate mode, panel, focus, voice, and the shared live-glass state |
| `main.ts` | smoke-check the renderer, panel state, preload bridge, voice probes, and glass response |

## 11. Acceptance checklist

- The first impression is light, calm, warm, and usable.
- Removing every decorative line does not destroy the hierarchy.
- No more than three non-icon structural rules are visible in the default window.
- The title and composer remain recognizably transparent over changing background material.
- Athens is communicated without a literal column, relief, line network, or wallpaper plate.
- Athens is communicated through daylight, stone, glass, proportion, columns, olive, and measured warmth rather than a themed prop collection.
- Complex panels remain scannable without becoming a stack of outlined boxes.
- Su Shixia still feels warmer and more alive than the architectural system.
- Glass-off, reduced-motion, 480 × 700, typecheck, build, and Electron smoke checks pass after implementation.
