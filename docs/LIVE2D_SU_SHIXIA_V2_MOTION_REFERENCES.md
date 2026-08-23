# Su Shixia V2 Motion References

Date: 2026-08-24

Status: `reference_driven_lite_preview`

## Purpose

Su Shixia V2 should not feel like a rigid parameter demo. Motions must be reference-driven: each motion group should have an observed source for timing, body weight, facial response, and recovery back to idle.

The current runtime is a Live2D Lite preview, not a genuine Cubism `.moc3` rig. It uses the same motion group names and parameter ideas that will later map to authored Cubism motion clips.

## Reference Sources

- Live2D Cubism Web Samples GitHub: `https://github.com/Live2D/CubismWebSamples`
- Live2D Cubism Native Samples GitHub: `https://github.com/Live2D/CubismNativeSamples`
- Live2D SDK manual, motion playback and `.motion3.json`: `https://docs.live2d.com/en/cubism-sdk-manual/motion/`
- Live2D standard parameter list: `https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/`
- Pixi Live2D display runtime reference: `https://github.com/guansss/pixi-live2d-display`
- VTube Studio API/Wiki GitHub: `https://github.com/DenchiSoft/VTubeStudio`
- Live2D motion append workflow example: `https://github.com/shinshin86/live2d-add-motion-sample-web-ui`
- OpenSeeFace tracking research reference: `https://github.com/emilianavt/OpenSeeFace`
- Inochi2D puppet-system comparison reference: `https://github.com/Inochi2D/inochi2d`
- Local Haru sample package: `assets/avatar/live2d-official-haru`
- Su Shixia turn and touch storyboard: `docs/concepts/su-shixia-live2d-v2-turn-touch-storyboard-v1.png`

The official samples are used as timing and grouping references. Do not copy third-party character art, textures, or unclear-license motion assets into Su Shixia.

## GitHub Scan Notes

Checked on 2026-08-24:

- `Live2D/CubismWebSamples`: official sample repository. GitHub reports the repository license as `NOASSERTION/Other`, so Athena treats it as an official structural and timing reference only. The Haru sample layout confirms the expected `Haru.model3.json`, `Haru.moc3`, `Haru.physics3.json`, `expressions`, `motions`, `sounds`, and texture directory shape.
- `Live2D/CubismNativeSamples`: official native sample repository. Useful as cross-runtime confirmation for the same model, motion, physics, texture, and export-package shape. Not used as Athena's runtime implementation path.
- `guansss/pixi-live2d-display`: GitHub API reports `MIT License`. Useful for desktop-friendly hit-test, expression, and motion playback patterns around Pixi. Athena still needs Live2D Cubism Core license review before public distribution.
- `DenchiSoft/VTubeStudio`: GitHub API reports `MIT License`. Useful as a workflow reference for model control, animation triggering, and VTube Studio-style recording/automation concepts. Do not import app assets.
- `shinshin86/live2d-add-motion-sample-web-ui`: GitHub API reports `MIT License`. Useful as an engineering reference for appending JSON motion definitions to an existing model package. Athena can borrow the workflow idea, but Su Shixia motion data remains generated or authored in the Athena package.
- `emilianavt/OpenSeeFace`: GitHub API reports `BSD-2-Clause`. Useful as future research for camera-driven blink, gaze, and expression parameters. Do not add it as a dependency until a camera feature is explicitly scoped.
- `Inochi2D/inochi2d`: GitHub API reports `BSD-2-Clause`. Useful as an open puppet-system comparison, but not a replacement for the current Cubism target.
- `HKUDS/CLI-Anything` Live2D skill and similar CLI references describe inspection, linting, diffing, asset management, and model-package editing around existing Cubism runtime files. They do not remove the need for a real rigged Cubism source project and `.moc3` export.
- `J621111/live2d-automation` points at menu-driven Cubism Editor automation for paths such as `[File] -> [Export Embedded File] -> Export as MOC3 file`. Treat this as possible GUI automation research only, not a supported headless exporter.
- VTube Studio wiki pages still describe runtime export as a Cubism Editor action and note that Editor communication can sync/record parameters, not synthesize a finished rig from flat art.

Machine-readable snapshot: `docs/quality/su-shixia-github-reference-scan.json`.

## Motion Reference Families

The GitHub scan is now organized by motion family so each authored Cubism clip can point back to a reviewable reference direction:

- `idle-presence`: idle, listen, think, return, and sleepy presence loops.
- `voice-speech`: TTS-driven speech, nod, and no/boundary head motions.
- `face-head-touch`: head, hair, hair clip, face, ear, and neck touch reactions.
- `hands-arms-gesture`: hand, wrist, forearm, upper-arm, wave, and drag-follow motions.
- `garment-body-boundary`: shoulder, collar, blouse, clothing, chest, ribs, abdomen, waist, hip, skirt, leg, knee, calf, ankle, foot, and shoe reactions.
- `turn-orientation`: current front-view `TurnPreview` and future profile/back orientation transitions.
- `future-tracking`: optional future gaze, blink, expression, and head-angle input from tracking workflows.

Every current Su Shixia Lite runtime motion group must be covered by at least one motion reference family before it is promoted to an authored Cubism clip. This is reference discipline, not asset import: third-party character art, textures, voices, and unclear-license motion files stay out of the Su Shixia package.

## Motion Group Map

| Su Shixia group | Current preview behavior | Reference direction |
| --- | --- | --- |
| `Idle` | breathing, blinking, hair sway | Haru `Idle`; low-amplitude loop |
| `Listen` | slight lean and attentive head movement | Haru `Listen`; user-facing attention |
| `Think` | side glance and slow head drift | Haru `Think`; quiet cognitive motion |
| `Speak` | head bob plus lip sync | Haru `Speak`; TTS-driven `ParamMouthOpenY` |
| `Greet` | gentle upward body motion | Haru `Greet`; not too energetic |
| `Nod` | short nod | Haru `Nod`; affirmative micro-motion |
| `ShakeHead` | boundary/no gesture | Haru `ShakeHead`; used for error and boundary reactions |
| `Wave` | right-hand wave approximation | Haru `Wave`; later requires independent arm rig |
| `TouchHead` | head dips, hair reacts | Haru `TouchHead`; affectionate but restrained |
| `TouchHair` | hair sway and head tilt | Haru `TouchHair`; light tactile response |
| `TouchHairClip` | small head tilt and accessory reaction | Haru `TouchHair`; Su Shixia A-clip identity |
| `TouchFace` | shy face turn plus hidden cheek-hand overlay | Su Shixia storyboard; later needs authored hand motion |
| `TouchEar` | startled ear-side recoil | Su Shixia storyboard; sensitive-zone boundary |
| `TouchNeck` | shoulder tuck and collar protection | Su Shixia storyboard; sensitive-zone boundary |
| `TouchShoulder` | small turn as if being called | Haru `TapBody`; neutral touch |
| `TouchHand` | small wave/hand response | Haru `TouchHand`; greeting/hand-hold boundary |
| `TouchUpperArm` | arm draws in slightly | Haru `TapBody`; neutral touch |
| `TouchForearm` | soft arm lift | Haru `TouchHand`; neutral touch |
| `TouchWrist` | wrist turns and eye contact | Haru `TouchHand`; affectionate boundary |
| `TouchPalm` | brief hand-present gesture | Haru `TouchHand`; affectionate boundary |
| `TouchCollar` | collar adjustment and shy retreat | Haru `TouchOutfit`; sensitive-zone boundary |
| `TouchBlouse` | blouse adjustment/body recoil cue | Haru `TouchOutfit`; boundary-aware |
| `TouchClothing` | clothing-adjust/body recoil cue | Haru `TouchOutfit`; boundary-aware |
| `TouchChest` | shy/protective recoil | private-zone boundary; runtime gated |
| `TouchRibs` | side-step recoil | private-zone boundary; runtime gated |
| `TouchAbdomen` | small tuck and garment adjustment | private-zone boundary; runtime gated |
| `TouchWaist` | side bend and shy glance | Haru `TapBody`; runtime gated by mode |
| `TouchHip` | side step and skirt-waist adjustment | private-zone boundary; runtime gated |
| `TouchSkirt` | skirt adjustment and step back | Haru `TouchOutfit`; boundary-aware |
| `TouchLeg` | weight shift and look down | Haru `TapBody`; runtime gated by mode |
| `TouchThigh` | weight shift and skirt sway | private-zone boundary; runtime gated |
| `TouchKnee` | knee bend/standing balance | Haru `TapBody`; neutral touch |
| `TouchCalf` | foot shift and glance down | Haru `TapBody`; neutral touch |
| `TouchAnkle` | ankle shift | Haru `TapBody`; neutral touch |
| `TouchFoot` | small step back | Haru `TapBody`; runtime gated by mode |
| `TouchShoe` | shoe-tip shift | Haru `TapBody`; neutral touch |
| `TurnPreview` | head/body turn approximation | Su Shixia turnaround; not full 3D rotation |
| `Drag` | hair follows pointer | desktop pet dragging |
| `Return` | recover to idle | Haru `Idle` recovery timing |
| `Sleepy` | slow head drop | Haru `Sleepy` |

## Parameter Contract

Use standard Live2D parameter IDs where possible:

- head: `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`
- eyes: `ParamEyeLOpen`, `ParamEyeROpen`, `ParamEyeBallX`, `ParamEyeBallY`
- mouth: `ParamMouthOpenY`, `ParamMouthForm`
- body: `ParamBodyAngleX`
- breathing: `ParamBreath`
- preview-only extensions: `ParamHairSwing`, `ParamTurnX`, `ParamBodyCurve`

`ParamTurnX` and `ParamBodyCurve` are temporary Lite preview helpers. A genuine Cubism rig should replace them with authored deformers and standard body/head parameters where possible.

## Current Limits

- `TouchFace` can show hidden cheek-hand layers, but the arm path is not yet a mesh-authored motion.
- `TurnPreview` is only a front-view 2.5D turn hint. It is not a real back/side/full-turn handoff.
- Full-body intimate/private reactions are semantic and mode-gated. The runtime must validate mode and consent before asking the persona model to answer.
- The Lite profile now exposes 37 semantic touch zones and 40 motion groups. Cubism handoff includes 37 `.motion3.json` templates covering the touch groups used by the profile.
- Final Cubism production still needs authored `.motion3.json` clips, physics, mesh deformers, and export from Cubism Editor.
