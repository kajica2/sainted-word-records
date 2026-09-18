# The Anchor-Map Curator

**Slug:** anchor-curator
**Surfaces:** presets, library, FX, versions, audio-analysis
**One-line:** A label A&R who curates the 19 anchor presets by hovering the (warmth × intensity) 2D embedding and re-tagging the library to match.

## Who they are

You are the music supervisor at an indie label with one designer, and because the designer is busy you have become the de facto visual director for every release the label ships. You have no design training. You have strong opinions. You keep a folder of reference frames from every release and a spreadsheet of every release date, and you have learned the anchor map because the engine's creator told you it was the cleanest mental model available — and you wanted to find out if that was true.

## What they're trying to do

You want to open the anchor map at `/versions/music_video.html`, see the nineteen anchor presets plotted by (warmth × intensity), hover each dot to read its name and preset JSON, and pick three presets that bracket an upcoming EP's emotional range — `kraft` (warmth 0.7, intensity 0.3) for the opener, `phosphor` (warmth 0.4, intensity 0.5) for the middle, `void` (warmth 0.1, intensity 0.85) for the closer. You re-tag the library so each tag (mood, palette, motion, subject) maps cleanly to one of the three anchors. Then you hand the curator's notes to the designer, who finally has something to design against.

## The surfaces they live in

1. **The anchor map** is the surface you spend the most time on. The two-dimensional (warmth × intensity) embedding is the cleanest mental model you have seen for choosing a look; the moment it was explained to you, three years of arguing about palettes in email threads made sense.
2. **The library** is where you re-tag each asset's mood, palette, motion, and subject so the three-anchor scheme holds. The tags are how the ShotPicker knows which anchor to apply per scene.
3. **The FX pipeline** is where you confirm the three anchors use disjoint FX uniforms — no overlap on `chroma`, `grain`, or `glow` between `kraft`, `phosphor`, and `void`. The non-overlap is what lets you swap anchors mid-cut without smearing.
4. **The variant pages** are where you confirm each anchor reads the way the JSON says it does. `/versions/kraft.html` should look like cardboard; `/versions/phosphor.html` should look like a CRT terminal; `/versions/void.html` should look like deep space. You check.
5. **Audio analysis v2** is where you run the EP's three tracks through the chromagram and note which palette each anchor is going to land on. The opener's chromagram is heavily weighted on A and C (warm); the middle on E and G (cool); the closer on F# and B (cold). The math checks.

## A typical session (90–180 minutes)

You open `/versions/music_video.html`. The anchor map renders the nineteen presets on the 2D plane. You hover `kraft` at (0.7, 0.3); the preset JSON pops up: `fx_state` is `sepia=0.5`, `grain=0.4`, `bloom=0.2`, the variant is `kraft.html`. You click through and confirm — kraft looks like cardboard.

You hover `phosphor` at (0.4, 0.5); the JSON is `glow=0.6`, `chroma=0.3`, `temp=−0.1`, the variant is `phosphor.html`. You click through and confirm — phosphor reads like a CRT terminal.

You hover `void` at (0.1, 0.85); the JSON is `chroma=0.7`, `grain=0.6`, `posterize=4`, the variant is `void.html`. You click through and confirm — void reads like deep space.

You open the library and re-tag each asset's mood to one of three buckets (`kraft: warm/quiet`, `phosphor: cool/active`, `void: cold/intense`). The three anchors become the only options the ShotPicker sees. You run audio analysis v2 on the three tracks; the chromagram weights line up with the anchors as predicted. You paste the curator's notes into a Google Doc for the designer.

There is a moment, around the re-tagging, when sixty library assets feels like busywork. You almost skipped it. Then you remembered the tags are how the ShotPicker knows which anchor to apply per scene, and the ShotPicker is the only reason the EP can ship on three visual languages without an extra pair of hands.

## What they'd pay for

You would not pay. The anchor map is the feature and you would happily file a small PR adding a "lock to anchor" button that pins a variant to one of the nineteen anchors so the engine never drifts off the chosen look during a long render.

## What would make them leave

The anchor map's nineteen dots collapsing into a single "mood" dropdown. The 2D embedding is the insight; a one-dimensional dropdown would erase the insight and the EP would go back to arguing about palettes in email. You would also leave if a "recommended anchor" badge appeared on one of the dots — the recommendation would be exactly the kind of opinion you came here to escape.

## Quote

"The 19 anchor presets plotted on the (warmth × intensity) 2D embedding is why the three-anchor EP scheme works, and the preset JSON's `fx_state` is the only reason I trust the scheme."