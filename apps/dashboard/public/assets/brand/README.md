# SkorIQ brand assets

- `skoriq-mark-v1.svg`: the standalone Q symbol, with a 64 × 64 viewBox.
- `skoriq-wordmark-v1.svg`: the horizontal Q + SkorIQ lockup, with a 232 × 64 viewBox. The mark uses the same two paths as the standalone source; the lettering is outlined, so this file does not load a font.

The split Q suggests a moving score signal and the intelligence in “IQ”. Use the mark alone in a favicon or other small space; use the horizontal lockup where the full name needs to be readable. Keep the original proportions. Recommended minimum display sizes are 20 px high for the mark and 32 px high for the lockup. Leave at least one quarter of the symbol’s height clear on each side, outside the SVG’s canvas.

The symbol is stadium yellow `#FFC400`; the wordmark is warm ivory `#F1EDE0`. Both SVGs have transparent backgrounds and are intended for the site’s dark background, `#070B08`. Preserve the palette; do not add a badge, container, shadow, gradient, or outline.

## Creation and typography

Built-in imagegen was used for concept exploration. Prompt direction: a distinctive, minimal SkorIQ sports intelligence identity, a bold split Q with a diagonal momentum cut, stadium yellow on dark charcoal, and a compact editorial wordmark. The production SVG uses native geometry; the generated raster concept is not a production asset.

The outlined lettering spells **SkorIQ**, in Barlow Condensed ExtraBold (800). Barlow is © 2017 The Barlow Project Authors and is licensed under the SIL Open Font License 1.1. The font is not bundled here. Font outlines were exported directly from the official Google Fonts source, without a runtime font dependency.

- [Google Fonts source: Barlow Condensed ExtraBold](https://github.com/google/fonts/blob/main/ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf)
- [Barlow Condensed SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/barlowcondensed/OFL.txt)
- [Barlow project](https://github.com/jpt/barlow)

For an `<img>` containing the full lockup, use `alt="SkorIQ"`. When the mark sits beside an existing text label that already names the brand, use an empty image alt to avoid repeating the name.
