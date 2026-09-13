# The Transition Choreographer

**Slug:** transition-choreo
**Surfaces touched (3+ minimum):** transitions, engine, library, recorder
**One-line:** A motion designer who treats the 10 CSS transitions as a vocabulary and writes scene changes by hand on the bar grid.

## Who they are
You are a motion designer in your early thirties who came up cutting TV show opens and now does title sequences for streaming series. You live in After Effects for paid work, but you keep a side project where you try to author the same kind of motion grammar in the browser. Your toolbelt is AE expressions, a folder of title-sequence references, and a habit of timing cuts to the breath rather than to the beat.

## What they're trying to do
You want to drop a friend's instrumental into /engine, freeze three library clips on the timeline, and write a scene-change choreography across the 10 CSS transitions — `whip-blur`, `glitch-block`, `zoom-through`, `flash-cover`, `paint-stroke`, `chromatic-split`, `swivel`, `circle-wipe`, `warp-dissolve`, `lens-flare` — so the transitions land on phrase boundaries rather than on every bar. You record the WebM, scrub it back at quarter speed, and rewrite the transitions that do not land on the breath.

## Which surfaces they actually use, and why
1. **10 CSS transitions (engine-transitions.client.js)** — the surface you spend the most time on; you serialize them through the Promise queue so two transitions never overlap, and you pick which transition fires on which phrase boundary by hand.
2. **Engine** — you load three clips into the engine's layers panel and use the engine's bar grid to mark phrase boundaries manually.
3. **Library** — your library is three 8-second clips you shot in the same location at different times of day; the transitions make the time-of-day shift legible.
4. **Recorder** — you record 30-second WebMs at each pass, scrub them at quarter speed in QuickTime, and re-cut the transitions that do not land.

## A typical session (90-180 minutes)
1. You drop the friend's 60-second instrumental, the engine detects BPM=104 and shows the bar grid.
2. You mark phrase boundaries at bars 8, 16, 24, 32, 40, 48 — six phrases across the track.
3. You assign transitions: bar 8 = `whip-blur` (450ms), bar 16 = `swivel` (600ms), bar 24 = `glitch-block` (500ms), bar 32 = `zoom-through` (500ms), bar 40 = `paint-stroke` (550ms), bar 48 = `circle-wipe` (600ms).
4. You record a 30-second WebM via MediaRecorder, scrub it at quarter speed.
5. The `glitch-block` at bar 24 lands a sixteenth after the breath — you rewrite it as `chromatic-split` (500ms) and re-record.
6. The `paint-stroke` at bar 40 reads like an intertitle — you swap it for `warp-dissolve` (600ms) and re-record.
7. You settle on the sequence `whip-blur` → `swivel` → `chromatic-split` → `zoom-through` → `warp-dissolve` → `circle-wipe` and record the final WebM.
8. You almost quit at step 5 — the first `glitch-block` looked fine on the engine canvas, but at quarter speed it landed late. You almost shipped it before scrubbing back and noticing the breath.

## What they'd pay for
You would pay for a per-transition keyframe editor so you can nudge the 450ms `whip-blur` to 380ms when the breath is short. You would not pay for cloud rendering.

## What would make them leave
You would leave forever if the 10 transitions started auto-firing on every bar by default, because the silence between transitions is the work. You would tolerate the absence of an easing-curve picker forever — the default easings are good enough.

## Quote
"The 10 transitions are a vocabulary, and the engine's bar grid is the only reason I trust that a `chromatic-split` at bar 24 lands on the breath instead of the beat."
