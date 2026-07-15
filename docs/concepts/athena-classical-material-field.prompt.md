# Athena Classical Material Field

## Output

- Asset: `athena-classical-material-field.png`
- Role: full-window depth plate beneath the daylight UI and live-glass controls
- Method: OpenAI built-in image generation
- Composition: 480 × 700 UI aspect, generated at portrait resolution and cropped with `preserveAspectRatio="xMidYMid slice"`

## Research basis

- [Acropolis Restoration Service — The Parthenon](https://acropolisrestoration.ysma.gr/wp-content/uploads/2025/05/06_PARTHENWN_EN.pdf)
- [Acropolis Museum — The Parthenon Gallery](https://www.theacropolismuseum.gr/en/exhibit-halls/parthenon-gallery)
- [Acropolis Museum — South Frieze Block I](https://www.theacropolismuseum.gr/en/parthenon-south-frieze-block-1-i)
- [Museo dell’Ara Pacis — Natura di marmo](https://www.arapacis.it/it/didattica/amici-natura-di-marmo-il-fregio-vegetale-dell-ara-pacis)

These sources establish the material vocabulary: Pentelic marble, deep fluting, carved relief, vegetal rhythm, natural museum light, and transparent architectural envelopes. No web image is shipped in Athena or copied into the generated plate.

## Generation prompt

```text
Use case: stylized-concept
Asset type: production background material plate for a 480 x 700 desktop AI companion UI
Primary request: Create an original, museum-quality 3D material study based on researched classical Athenian and Roman architecture. This is a real volumetric background asset, not an illustration or wireframe.
Scene/backdrop: warm ivory daylight stone environment with a very faint cool glass-blue light plane; open and calm, mostly empty through the center-left so UI copy remains readable.
Subject: on the far right edge, one monumental cropped Corinthian marble column inspired by the Olympieion in Athens, with an actually modeled acanthus capital, deep fluting, rounded edges, subtle optical taper and physical depth. In the lower-left background, a quiet shallow marble bas-relief panel combining olive leaves, acanthus scroll rhythm, and restrained Panathenaic-procession drapery, interpreted as an original design rather than a copy of any artifact. A second distant column fragment may be barely visible at the far left edge.
Style/medium: high-end physically based 3D render, contemporary museum installation, believable Pentelic marble, photoreal material response, refined product presentation.
Composition/framing: portrait 24:35, edge-cropped architectural masses, generous negative space, no centered hero object, column remains behind future UI controls, relief is secondary and partially occluded.
Lighting/mood: soft Athenian morning daylight from upper left, warm sun transmission, subtle cool ambient bounce, shallow contact shadows, calm and premium.
Color palette: warm limestone, Pentelic ivory, pale sand, restrained terracotta warmth, faint Aegean blue reflection.
Materials/textures: fine marble pores, faint golden mineral veins, soft age patina, carefully worn high points, deep but soft flute occlusion, relief depth clearly readable in raking light.
Constraints: no text, no UI controls, no logos, no watermark; preserve a bright light background; all architecture must be solid volumetric material with physically plausible shadows.
Avoid: line art, wireframe, outline drawing, repeated colonnade, full temple facade, literal ruins, dark background, black shadows, neon glow, sci-fi HUD, particles, fantasy portal, decorative clutter, statues or human faces.
```

## Integration rule

The UI may grade, crop, blur, or mask this plate. It must not replace the modeled column, capital, flutes, or relief with SVG outlines. Text readability takes precedence over showing every carved detail.
