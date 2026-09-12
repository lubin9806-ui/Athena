# Athena Asset Provenance

Window 04 records source, packaging, and release-gate status for current
Desktop assets. This is an engineering provenance ledger, not a legal opinion
or final rights signoff.

## Included In The Normal Desktop Installer

The normal Desktop installer includes `resources/` except
`resources/OllamaSetup.exe`, plus the voice helper scripts copied through
`electron-builder.yml`:

- `resources/icon.png`
- `resources/tray.png`
- `resources/splash.png`
- `resources/su-shixia-icon.png`
- `resources/su-shixia-tray.png`
- `resources/su-shixia.ico`
- `resources/su-shixia-icon-1080.png`
- `resources/athena-brand-icon.png`
- `resources/athena-tray.png`
- `resources/athena-brand.ico`
- `tts.py`
- `stt.py`
- `stt_whisper.py`
- `play_audio.py`
- `requirements-voice.txt`

The exact bytes and SHA-256 values are regenerated into
`docs/SUPPLY_CHAIN_MANIFEST.json` by `npm.cmd run test:supply-chain`.

Status: usable for internal alpha packaging. Public distribution is Blocked
until the project owner supplies human signoff for the Athena name, Su Shixia
name, icons, tray images, splash screen, screenshots, wallpapers, and any audio
or marketing material.

## Not Included In The Normal Installer

These paths are retained in the repository but are not included by
`electron-builder.yml`:

- `docs/concepts/`: generated design exploration images and prompt notes.
- `promo/`: promotional web pages, poster brief, and poster images.
- `models/`: local model files and Hugging Face cache fragments.
- `legacy/root-artifacts/`: preserved historical artifacts with
  `legacy/root-artifacts/MANIFEST.sha256`.
- `新建文件夹/`: unknown local folder retained without deletion.

`docs/SUPPLY_CHAIN_MANIFEST.json` records hashes for concept and promotional
assets as non-bundled provenance evidence. These files may not be used in a
public website, store listing, press kit, or installer until rights and
trademark signoff are supplied.

## Voice Assets

The installer bundles the managed voice runtime under `resources/voice`. This
paragraph previously said the opposite - that no wheels, models or voices were
bundled - which stopped being true when the offline sidecar was introduced and
was corrected on 2026-09-07 while adding the neural voice.

What ships, and under what terms:

| Payload | Source | Licence |
|---|---|---|
| CPython 3.11.9 embeddable (Windows x64) | python.org, SHA-256 pinned in `prepare-voice-runtime.js` | PSF |
| Python wheels | `requirements-voice.lock.txt`, exact pinned closure, `--no-deps --only-binary` | per package; re-audit on any lock change |
| `Systran/faster-whisper-tiny` STT model | Hugging Face, pinned commit | MIT |
| `rhasspy/piper-voices` `zh_CN-huayan-medium` TTS voice | Hugging Face, pinned commit | MIT |
| Athena helper scripts | this repository | Athena-owned |

Every packaged file is listed in `voice-runtime-manifest.json` with its size and
SHA-256, and `verify-voice-runtime.js` fails the build on any drift. Windows SAPI
voices are **not** bundled: they are whatever the user's system already has, so
no voice resource is redistributed or resold.

Athena-owned helpers packaged: `stt_whisper.py`, `tts_piper.py`, `tts-local.ps1`,
`tts-capabilities.ps1`, `play_audio_local.ps1`, and the two requirements files.
Legacy online `stt.py`/`tts.py` and Python playback helpers remain source history
only and are excluded from release resources.

## Model And Binary Assets

- `resources/OllamaSetup.exe` is excluded from the normal installer app payload.
- Local Ollama model stores are excluded from the normal installer.
- Offline packs must use `docs/OFFLINE_MODEL_ALLOWLIST.json` with exact file
  SHA-256 values.
- Copying the whole user `.ollama\models` directory is blocked.
- Public offline redistribution remains Blocked until Ollama installer
  redistribution and Qwen notice-handling signoff are approved.

## Approved Athena Brand Mark Exports

The three desktop brand files below are deterministic format conversions of
`docs/brand/companion-prototype/assets/athena-mark.svg`. The export script
`scripts/generate-approved-brand-icons.cjs` pins the source SVG SHA-256 to
`55AA336147DF7D5FBCE9FC485AB421988DF6108301817E023B800DDFD383E578` and aborts
if the approved source changes. It uses the repository's pinned
`@napi-rs/canvas` dependency to apply the documented background and foreground
colors, rasterize fixed sizes, and assemble the multi-frame ICO; it does not
generate or reinterpret the artwork.

| Packaged output | Bytes | SHA-256 |
|---|---:|---|
| `resources/athena-brand-icon.png` | 120,234 | `C7074184BFFD4DCDF62841B86F5652F020E962D8887D795D8084615D00C0C89F` |
| `resources/athena-tray.png` | 2,054 | `02B9F56C09AEA8971CF98A1741484EFF9DB97ADE26B4F759DE64836E1C72C200` |
| `resources/athena-brand.ico` | 27,219 | `E7E5243210C125597F3B235DF4C390F3EE250DACB4B1CAA37588429E7F3DF923` |

These records establish reproducibility and the exact packaged bytes only.
Public distribution remains Blocked pending human ownership/originality review
and Athena trademark clearance; this engineering ledger is not that approval.

## Blocked Proofs Needed

Do not infer or invent these records. The user/project owner must provide them:

- legal owner/publisher name and company authority to publish Athena
- trademark clearance for `Athena` and `Su Shixia`
- human ownership/originality signoff for icons, tray images, splash images,
  wallpapers, screenshots, posters, and promotional copy; authoring/generation
  records are still required for any asset not documented elsewhere in this ledger
- font and icon licenses if future UI assets embed non-system fonts or external
  icon packs
- voice/audio rights if recorded voices, samples, or commercial TTS outputs are
  bundled
- source URL, license, and retention approval for each file under `models/`
- owner, purpose, and retention approval for `新建文件夹/`

## Window 08 Steam Store Assets

`assets/steam/` contains AI-generated Athens-inspired store/library artwork, a generated ATHENA wordmark, deterministic Steam-format crops, and five direct Electron runtime screenshot candidates. The generated images were created with OpenAI image generation on 2026-07-16 and are disclosed as pre-generated AI content in `docs/steam/STEAM_AI_CONTENT_DISCLOSURE.md`. Exact roles and dimensions are listed in `docs/steam/STEAM_ASSET_MANIFEST.md`.

The screenshot candidates were captured from the compiled Desktop baseline, not fabricated with image generation. They are not final Steam-build proof and must be recaptured or reconfirmed after a real signed AppID/private-branch build. A screenshot exposing local memory content was rejected and deleted.

Public Steam use remains Blocked pending Athena name/trademark clearance, human review of generated-art originality and PG-13 suitability, final build consistency, and Valve review.

## Microsoft Store AppX Assets

`build/appx/StoreLogo.png`, `Square44x44Logo.png`, `Square150x150Logo.png`, and `Wide310x150Logo.png` are deterministic transparent-background crops generated by `scripts/prepare-store-assets.ps1` from the tracked `resources/su-shixia-icon.png` source. They do not introduce a new third-party image source. Exact bytes and hashes are included in `docs/SUPPLY_CHAIN_MANIFEST.json`.

Partner Center use remains subject to the same human ownership and Athena/Su Shixia name review as the source icon. The engineering package is not evidence of Microsoft certification.

## Live2D Avatar Concepts

`docs/concepts/athena-live2d-character-concept-v1.png` is an internal AI-generated concept board created on 2026-08-22 from user-supplied visual reference images. The references were used for mood, hairstyle, outfit color blocking, and companion-character direction only; the concept is not a finished Live2D model and is not included in release packaging.

`assets/avatar/live2d-official-haru/` is a copied official Live2D Haru sample
package used as Athena's current internal reference/default model variant. It
contains the upstream Cubism model, textures, expressions, motions, physics,
pose, display-info, and Athena profile mapping. Sample voice files are not
bundled. Haru is not an original Athena character asset; it is a quality
benchmark used while the original Athena model is rebuilt.

`assets/avatar/athena-live2d-default/source/athena-live2d-default-front-v2-alpha.png` is the archived v1 AI-generated full-body source master. The v1 visual direction was retired on 2026-08-23 and is no longer Athena's default character target. The repository retains five generated parts atlases, 67 deterministic transparent layer slices, a visual contact sheet, a machine-readable parts inventory, and `athena-live2d-default-layered-v1.psd` generated with the MIT-licensed `ag-psd` development tool for technical reference and regression checks.

`assets/avatar/su-shixia-live2d-v2` is the new Stage 2A source-only baseline generated on 2026-08-23 from the approved Su Shixia V3 visual direction. OpenAI built-in image generation produced the front master and five chroma-key source atlases. Local deterministic scripts removed the green background, retained soft alpha, sliced 66 named `SSX_*` parts, generated a visual contact sheet, and wrote `su-shixia-front-layered-v1.psd` with the MIT-licensed `ag-psd` development tool. This is an automated alignment baseline that requires human hidden-fill, seam, mouth-style, hand, and layer-alignment review. It is not a Cubism project, `.moc3`, runtime model, or public-distribution approval. Public and Store distribution remain blocked pending source polish, provenance and rights review, Live2D licensing review, genuine Cubism rigging, and runtime QA. Adult-only private assets are not included.

The 2026-08-24 Stage 2B pass used OpenAI built-in image generation to derive a softer six-state mouth atlas and a corrective front-view neutral-hand and shoe atlas from the approved master. Local extraction scripts produced transparent versions, while the deterministic build added a six-panel default-state alignment preview, a machine-readable review report, corrected face-part proportions, and hidden-by-default alternative PSD layers. These remain generated provisional assets rather than hand-painted production approval.

The archived v1 model directory contains a genuine Cubism Editor project and exported `.moc3`, model, texture, physics, expression, and motion files. The export is a runnable, automatically generated baseline rig, not a hand-polished final character or approved default identity. Its visible face variants, motion set, physics, real-time lip sync, four in-app placements, and independent Electron desktop-pet window have passed the recorded engineering checks in `docs/quality/live2d-cubism-runtime-qa.json`.

Production source files, PSDs, layer maps, rigging notes, and the retired 3D prototype are excluded from release builds. The normal installer retains only the compiled Live2D runtime model and Cubism Core under `dist/renderer/`.

Public use and marketplace distribution remain Blocked pending human review, rights clearance for the supplied references, originality review, and Live2D SDK publication-license review. Athena can load customizable avatar profiles and models, so it must be evaluated with Live2D as a potential Expandable Application before public release.

## 3D Avatar Assets

`assets/avatar/athena-3d-default/model/athena-3d-default.glb` is a runnable GLB placeholder generated locally with Blender on 2026-08-22 from procedural geometry and the Athena Live2D concept direction. It is intended for internal 3D desktop-pet prototyping, not as a final VRM humanoid rig or public production character.

Public use, marketplace use, or bundled distribution remains Blocked pending human review, originality review, and a final avatar asset approval.
