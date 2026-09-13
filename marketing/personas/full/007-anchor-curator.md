# The Anchor-Map Curator

**Slug:** anchor-curator
**Surfaces touched (3+ minimum):** presets, library, FX, versions, audio-analysis
**One-line:** A label A&R who curates the 19 anchor presets by hovering the (warmth × intensity) 2D embedding and re-tagging the library to match.

## Who they are
You are a music supervisor at an indie label in your late thirties who is also the de facto visual director because the label has one designer and she is busy. You have no design training but you have strong opinions and you keep a folder of reference frames from every release you have shipped. Your toolbelt is a spreadsheet of releases, a folder of reference frames, and a willingness to learn the anchor map because the engine's creator said it was the cleanest mental model.

## What they're trying to do
You want to open the anchor map at /versions/music_video.html, see the 19 anchor presets plotted by (warmth × intensity), hover each dot to read its name and preset JSON, and pick three presets that bracket an upcoming EP's emotional range — `kraft` (warmth 0.7, intensity 0.3) for the opener, `phosphor` (warmth 0.4, intensity 0.5) for the middle, `void` (warmth 0.1, intensity 0.85) for the closer. You re-tag the library so each tag (mood, palette, motion, subject) maps cleanly to one of the three anchors, then hand the curator's notes to the designer.

## Which surfaces they actually use, and why
1. **Presets (anchor map, 19 anchors)** — the surface you spend the most time on; the 2D (warmth × intensity) embedding is the cleanest mental model you have seen for choosing a look.
2. **Library** — you re-tag each library asset's mood/palette/motion/subject so the three-anchor scheme holds.
3. **FX pipeline** — you read each preset's `fx_state` block to confirm the three anchors use disjoint FX uniforms (no overlap on `chroma`, `grain`, `glow`).
4. **Versions** — you confirm each anchor's variant page (`/versions/kraft.html`, `/versions/phosphor.html`, `/versions/void.html`) reads the way the JSON says it does.
5. **Audio analysis** — you run audio-analysis v2 on the EP's three tracks and note the chromagram weight on each anchor's expected palette.

## A typical session (90-180 minutes)
1. You open /versions/music_video.html, the anchor map renders the 19 presets as dots on a 2D plane.
2. You hover `kraft` at (0.7, 0.3), the preset JSON pops up: `fx_state` is sepia=0.5, grain=0.4, bloom=0.2, the variant is kraft.html. You click through and confirm — kraft looks like cardboard.
3. You hover `phosphor` at (0.4, 0.5), the JSON is glow=0.6, chroma=0.3, temp=-0.1, the variant is phosphor.html. You click through and confirm — phosphor reads like a CRT terminal.
4. You hover `void` at (0.1, 0.85), the JSON is chroma=0.7, grain=0.6, posterize=4, the variant is void.html. You click through and confirm — void reads like deep space.
5. You open the library, re-tag each asset's mood to one of three buckets (`kraft: warm/quiet`, `phosphor: cool/active`, `void: cold/intense`) so the three anchors are the only options the ShotPicker sees.
6. You run audio-analysis v2 on the three tracks; the opener's chromagram is heavily weighted on A and C (warm), the middle on E and G (cool), the closer on F# and B (cold).
7. You paste the curator's notes into a Google Doc for the designer.
8. You almost quit at step 5 — re-tagging 60 library assets felt like busywork. You almost skipped it before remembering the tags are how the ShotPicker knows which anchor to apply per scene.

## What they'd pay for
You would not pay — the anchor map is the feature and you would happily file a small PR adding a "lock to anchor" button that pins a variant to one of the 19 anchors so the engine never drifts off the chosen look.

## What would make them leave
You would leave forever if the anchor map's 19 dots collapsed into a single "mood" dropdown, because the 2D embedding is the insight. You would tolerate the lack of a per-preset thumbnail grid forever — the dots are enough.

## Quote
"The 19 anchor presets plotted on the (warmth × intensity) 2D embedding is why the three-anchor EP scheme works, and the preset JSON's `fx_state` is the only reason I trust the scheme."
