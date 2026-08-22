# Athena Live2D Reference Audit

Status: reference research only. Do not copy third-party art, model binaries, motions, sounds, or character identity into Athena.

## Sources Reviewed

- Live2D Sample Data Collection: https://www.live2d.com/en/learn/sample/
- Live2D Cubism Web Samples: https://github.com/Live2D/CubismWebSamples
- Live2D Sample Data Terms: https://www.live2d.com/eula/live2d-sample-model-terms_en.html
- Nizima My Live2D Clock sample workflow: https://docs.nizima.com/en/apps/myclo/getlive2d/
- Bunraku paper, single-illustration Live2D asset generation: https://arxiv.org/abs/2607.27348

Local inspection copy:

- `artifacts/live2d-reference-cubismwebsamples`

## Official Sample Model Findings

The official Web Samples are valuable because they expose production-style `.model3.json`, motion, expression, hit-area, and physics structures without guessing.

| Model | Motions | Motion groups | Expressions | Hit areas | Physics settings | Motion curves |
| --- | ---: | --- | ---: | --- | ---: | ---: |
| Haru | 6 | Idle:2, TapBody:4 | 8 | Head, Body | 4 | 378 |
| Hiyori | 10 | Idle:9, TapBody:1 | 0 | Body | 11 | 328 |
| Mao | 8 | Idle:2, TapBody:6 | 8 | Head, Body | 16 | 1088 |
| Mark | 6 | Idle:6 | 0 | none | 1 | 223 |
| Natori | 8 | Idle:3, TapBody:5 | 11 | Head, Body | 11 | 788 |
| Ren | 3 | Idle:1, TapBody:2 | 5 | Body, Head | 16 | 204 |
| Rice | 4 | Idle:1, TapBody:3 | 0 | Body | 9 | 216 |
| Wanko | 5 | Idle:3, TapBody:2 | 0 | Body | 4 | 110 |

## What Good Models Do Better

- Several idle motions are normal. Hiyori has nine Idle entries, Mark has six, and Natori has three. Athena should not rely on one looping idle.
- Motion files drive many visible parameters. Mao has 1088 motion curves and Natori has 788; Athena currently has broad motion groups but weaker authored deformation.
- Physics is not just hair. Natori and Mao include accessory, jacket, chain, robe, ribbon, and secondary motion outputs. Athena only has three hair chains.
- Hit areas are model-native in good examples. Athena still relies mostly on profile rectangles, which works but feels less precise.
- Expressions are separate from motion. Natori has 11 expressions and Haru/Mao have 8; Athena's expression count is acceptable, but expression intensity needs more visible deformation.
- The best desktop companion feel comes from randomness and state layering: multiple idle choices, blink/breath/physics always-on, state motions on top, and touch reactions with cooldown.

## Athena Upgrade Targets

Immediate, code-side targets:

- Add an idle scheduler that rotates among Idle, Think, LookAround, Stretch, SoftNod, HairFix, ShiftWeight, and Breathe variants. Status: implemented first pass with six Idle entries and a runtime idle scheduler.
- Add model event telemetry for `activeMotion`, `motionStartedAt`, and visible motion delta so regressions are caught automatically.
- Add richer interaction actions for head, face, hair clip, hand, outfit, and empty-space click, each with motion plus expression plus Athena reply.
- Keep alpha-fringe repair in the asset pipeline and verify transparent edge pixels after every texture regeneration.

Asset/rig targets:

- Replace single visible full-body art mesh with truly visible layered meshes for at least hair, eyes, mouth, brows, head, torso, sleeves, arms, skirt, legs, shoes, and accessories.
- Bind independent arm/hand parameters before claiming wave/gesture quality.
- Expand physics beyond hair: side hair, bangs, skirt, ribbon/tie, blouse sleeve, and hair clip micro-swing.
- Add model-native hit areas in Cubism export instead of relying only on rectangle fallbacks.
- Author multiple real idle motions with different timings, not just one parameter loop.

Reference quality bar:

- Minimum acceptable companion baseline: Natori-like expression count, Hiyori-like idle variety, Mao/Natori-like physics breadth, and Haru-like simple Head/Body hit-area contract.
- Athena should stay original in character identity and art direction. These references define structure and interaction depth, not visual copying.
