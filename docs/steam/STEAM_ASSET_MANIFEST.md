# Steam Asset Manifest and Provenance

## Visual direction

Theme inspiration: Athens. The system stays simple and premium: one translucent pale-jade glass symbol, Aegean ink-indigo negative space, restrained Pentelic-marble geometry, and sparse olive details. It avoids literal goddess portraits, armor, tourist-postcard ruins, dense columns, generic AI/robot imagery, and marketing clutter.

## Generated master assets

Generated with the built-in OpenAI image generation tool on 2026-07-16 and human-directed through targeted edits:

- `assets/steam/source/athena-athens-main-master.png`: landscape capsule master; exact `ATHENA` wordmark; simplified Athens-through-proportion direction.
- `assets/steam/source/athena-athens-vertical-master.png`: portrait capsule master.
- `assets/steam/source/athena-athens-library-hero-master.png`: artwork-only panoramic master.
- `assets/steam/source/athena-wordmark-chroma.png`: exact wordmark source on chroma green.
- `assets/steam/library/library_logo.png`: chroma-removed RGBA wordmark.

Prompt intent was recorded in the Window 08 work log and summarized here: premium Athens-inspired editorial 3D art; Aegean indigo, pale jade glass, Pentelic marble, sparse olive; exact `ATHENA` only where titles are permitted; no additional text, people, copyrighted characters, badges, awards, prices, watermarks, or external logos.

## Steam-format derivatives

`scripts/prepare-steam-assets.ps1` mechanically crops/resizes the approved masters:

| Asset | Path | Dimensions |
|---|---|---:|
| Header capsule | `assets/steam/store/header_capsule.png` | 920x430 |
| Small capsule | `assets/steam/store/small_capsule.png` | 462x174 |
| Main capsule | `assets/steam/store/main_capsule.png` | 1232x706 |
| Vertical capsule | `assets/steam/store/vertical_capsule.png` | 748x896 |
| Library capsule | `assets/steam/library/library_capsule.png` | 600x900 |
| Library header | `assets/steam/library/library_header.png` | 920x430 |
| Library hero | `assets/steam/library/library_hero.png` | 3840x1240 |
| Library logo | `assets/steam/library/library_logo.png` | RGBA, wide |
| Shortcut icon | `assets/steam/community/shortcut_icon_256.png` | 256x256 |
| App icon | `assets/steam/community/app_icon_184.png` | 184x184 |

Base capsules contain only artwork and the product title. Library Hero contains no text. The Library Logo contains only the wordmark.

## Runtime screenshot candidates

The five 16:9 PNGs at or above 1920x1080 under `assets/steam/screenshots/` were captured directly from the compiled Electron runtime in companion/create/reason and day/night states. No generative image tool was used to fabricate UI screenshots. A memory-panel candidate was rejected and deleted because it exposed local conversation data.

These are accurate Desktop baseline source candidates, not proof of a real Steam AppID build. Before submission, recapture from the signed near-final build installed through the private Steam branch, then compare against these files and replace them if any UI/build difference exists.

Steam base capsule and screenshot rules: [Graphical Asset Rules](https://partner.steamgames.com/doc/store/assets/rules), [Store Graphical Assets](https://partner.steamgames.com/doc/store/assets/standard).
