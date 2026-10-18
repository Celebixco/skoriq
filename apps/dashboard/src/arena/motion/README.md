# Stadium light ambience

Six-second, silent 1280×720 ambient light loop authored and rendered with HyperFrames 0.8.164. The production interface stays native React; this video contains only three restrained gold light fields on black.

The motion adapts the HyperFrames registry `aurora-drift` primitive. Its paused GSAP timeline advances through one complete sine cycle. Endpoint phases are normalized to zero to prevent a loop jump. GSAP is shipped locally under `assets/` so rendering this composition does not require a runtime CDN request.

## Production use

The output is `../../../public/assets/arena-light-loop.mp4` when viewed from this source directory. Use it only as an `aria-hidden`, muted, inline, looping decorative layer with `mix-blend-mode: screen` and low opacity. Hide the video for reduced-motion users and constrained mobile layouts. The stadium WebP is the primary background and remains sufficient by itself.

## Rebuild

```sh
npx --yes hyperframes@0.8.164 check
npx --yes hyperframes@0.8.164 preview --background
npx --yes hyperframes@0.8.164 render --quality delivery --crf 27 --workers 1 --fps 24 --output ../../../public/assets/arena-light-loop.mp4 --strict
```

The source passed the full HyperFrames runtime, layout and contrast check with zero errors. Its nested decorative wrapper is intentionally a single timeline row. The layout motion audit ignores that wrapper; snapshots at 0.5, 3 and 5.5 seconds confirm the light fields change under seek.

## Background image provenance

The companion `arena-stadium.webp` and `arena-tunnel.webp` images were created with the built-in imagegen tool, then converted to WebP with Sharp at quality 78. No manual creative image edits were applied. Both are 1672×941.

- Stadium prompt: a standalone cinematic night football stadium photograph with a very dark quiet left 40%, warm ivory floodlights across the upper half, emerald-black pitch, distant golden crowd points and subtle yellow football tactical paths integrated into the grass perspective. No text, logos, UI, cards, buttons, labels, borders or emblems.
- Tunnel prompt: a standalone dark concrete players tunnel opening to a night stadium, emerald pitch in the central opening, warm amber wall lights reflected in a wet floor, dark quiet left and right walls, and one physical gold admission ticket with a football-pitch diagram on a black equipment trunk at lower left. No text, logos, UI, forms, fields, buttons, labels, borders or emblems.

The approved concept images were used only as visual references for atmosphere and materials. Their rendered interfaces are absent from these production assets.
