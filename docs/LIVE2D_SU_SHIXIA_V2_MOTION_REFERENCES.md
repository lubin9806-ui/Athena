# Su Shixia V2 Motion References

Date: 2026-08-24

Status: `reference_driven_lite_preview`

## Purpose

Su Shixia V2 should not feel like a rigid parameter demo. Motions must be reference-driven: each motion group should have an observed source for timing, body weight, facial response, and recovery back to idle.

The current runtime is a Live2D Lite preview, not a genuine Cubism `.moc3` rig. It uses the same motion group names and parameter ideas that will later map to authored Cubism motion clips.

## Reference Sources

- Live2D Cubism Web Samples GitHub: `https://github.com/Live2D/CubismWebSamples`
- Live2D SDK manual, motion playback and `.motion3.json`: `https://docs.live2d.com/en/cubism-sdk-manual/motion/`
- Live2D standard parameter list: `https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/`
- Local Haru sample package: `assets/avatar/live2d-official-haru`
- Su Shixia turn and touch storyboard: `docs/concepts/su-shixia-live2d-v2-turn-touch-storyboard-v1.png`

The official samples are used as timing and grouping references. Do not copy third-party character art, textures, or unclear-license motion assets into Su Shixia.

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
| `TouchHand` | small wave/hand response | Haru `TouchHand`; greeting/hand-hold boundary |
| `TouchClothing` | clothing-adjust/body recoil cue | Haru `TouchOutfit`; boundary-aware |
| `TouchChest` | shy/protective recoil | private-zone boundary; runtime gated |
| `TouchWaist` | side bend and shy glance | Haru `TapBody`; runtime gated by mode |
| `TouchLeg` | weight shift and look down | Haru `TapBody`; runtime gated by mode |
| `TouchFoot` | small step back | Haru `TapBody`; runtime gated by mode |
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
- Final Cubism production still needs authored `.motion3.json` clips, physics, mesh deformers, and export from Cubism Editor.
