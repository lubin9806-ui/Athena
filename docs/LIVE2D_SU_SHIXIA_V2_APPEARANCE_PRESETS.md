# Su Shixia V2 Appearance Presets

Date: 2026-08-24

Status: `preview_ready_true_wardrobe_no_go`

## Purpose

Su Shixia needs user-adjustable hair color, eye color, clothing, and accessories without making the current preview look like a fake complete wardrobe system.

The current implementation is a Live2D Lite preview. It supports non-destructive appearance presets over the existing source layers:

- hair tint;
- iris and pupil tint;
- blouse tint;
- skirt tint;
- shoe tint;
- hair-clip tint or visibility.

## Included Presets

| Preset | Intent | Production boundary |
| --- | --- | --- |
| `classic_blouse_navy` | Default white blouse, dark navy pleated skirt, black hair, dark eyes, silver A hair clip | Current default silhouette |
| `soft_office_gray` | Cooler work-mode tint with charcoal skirt | Recolor only |
| `warm_evening` | Warmer companion tone with cream blouse and muted plum skirt tint | Recolor only |
| `blue_focus` | Sharper assistant tone with blue-gray eyes and ink-blue skirt | Recolor only |
| `no_clip_minimal` | Accessory-off check for the A hair clip | Visibility toggle only |

## Not Yet Included

- new blouse, jacket, dress, casualwear, sleepwear, fantasy, or adult-only clothing silhouettes;
- new cloth folds, hems, sleeves, collars, or occlusion shapes;
- physics-bound clothing parameters;
- genuine Cubism clothing toggle parameters;
- nude or explicit private package assets.

## Next True Wardrobe Step

True wardrobe support needs separate reviewed source art for every outfit:

1. Generate or commission each outfit on the same body and pose standard.
2. Slice garment-specific layers with hidden fill.
3. Add Cubism draw-order and clipping rules.
4. Bind outfit visibility parameters in Cubism Editor.
5. Export and verify a genuine `.moc3` package.
6. Keep adult-only/private assets outside the public Athena package.

Until then, `trueOutfitSwapReady` must remain `false`.
