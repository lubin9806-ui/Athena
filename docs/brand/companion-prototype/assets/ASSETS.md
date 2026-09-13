# Companion prototype assets

These assets belong to the independent clickable companion prototype. They do not replace the application or installer icons.

## Athena graphic mark

`athena-mark.svg` is a real, path-only SVG with `fill="currentColor"` and a square `0 0 519 519` viewBox. It contains the approved open crescent, temple, feather, and two stars. It contains no bitmap, wordmark, avatar, or character.

Status: **traced prototype master**, not a hand-polished production logo. The deterministic source is the positive graphic in `../../athena-primary-mark-colorways-v1.png`; the wordmark is excluded. The tracing retains the selected mark's silhouette and negative spaces, with a 0.85-source-pixel contour simplification. This does not supersede `../../athena-primary-mark-source-v1.png` as the reference for eventual manual geometry work.

Use it as an inline SVG or as an external CSS mask whose `background-color` follows `currentColor`. An `<img>` cannot inherit the surrounding CSS color into an external SVG.

```css
.athena-mark {
  display: inline-block;
  width: 40px;
  aspect-ratio: 1;
  background: currentColor;
  mask: url("assets/athena-mark.svg") center / contain no-repeat;
  -webkit-mask: url("assets/athena-mark.svg") center / contain no-repeat;
}
```

Positive: `#53675F` on `#F5F1E8`. Negative: `#F5F1E8` on `#53675F`.

The 16/24/32/48 px render comparison is included in `asset-review.png`. The full mark remains detailed at 16 and 24 px; those sizes require future manual optical simplification. Use 40 px or larger for the visible brand mark in this prototype. Small utility buttons use the separate functional icon family.

## Functional icon family

`icons.svg` is a 31-symbol external sprite. Every symbol uses a 24 × 24 grid, no fill, `currentColor` stroke, 1.75 px line width, and round line caps / joins.

The original functional symbol paths are reused from `src/renderer/index.html`, without the old provisional A monogram. Additional basic functional symbols use simple SVG primitives to cover prototype controls. This is an internal prototype asset family, not a claimed integration with Phosphor or another third-party library.

```html
<svg width="20" height="20" aria-hidden="true">
  <use href="assets/icons.svg#icon-sidebar"></use>
</svg>
```

Provide the accessible label on the associated control. Use the same icon for a function everywhere. Avoid using the brand's temple / feather motif as an action glyph.

Available symbol IDs:

- `icon-memory`, `icon-settings`, `icon-minimize`, `icon-close`
- `icon-plus`, `icon-mic`, `icon-file`, `icon-volume`
- `icon-send`, `icon-globe`, `icon-pin`, `icon-sidebar`
- `icon-tools`, `icon-refresh`, `icon-chat`, `icon-folder`
- `icon-chevron`, `icon-sun`, `icon-moon`, `icon-search`
- `icon-check`, `icon-paperclip`, `icon-copy`, `icon-stop`
- `icon-sliders`, `icon-arrow`, `icon-bookmark`, `icon-more`
- `icon-temporary`, `icon-heart`, `icon-maximize`

## Provenance and reproduction

The mark comes from the user-approved Athena project brand asset. Existing glyphs come from this repository; additional basic shapes were prepared for this prototype. No external font or icon package is embedded. The repository's current `UNLICENSED` status is unchanged.

`generate-assets.cjs` reads those local sources and uses the already installed `@napi-rs/canvas` dependency to prepare the vectors and render positive / negative logo sizes and the icon family. It only writes files in this assets folder.

From the repository root:

```powershell
node docs/brand/companion-prototype/assets/generate-assets.cjs
```

`asset-validation.json` records the source dimensions, crop, viewBox, contour count, and symbol inventory. `asset-review.png` is the rendered review sheet. The vectors have been XML-parsed and rendered, but that does not certify production optical calibration or change the application runtime.
