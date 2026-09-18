# The Transition Choreographer

**Slug:** transition-choreo
**Surfaces:** transitions, engine, library, recorder
**One-line:** A motion designer who treats the 10 CSS transitions as a vocabulary and writes scene changes by hand on the bar grid.

## Who they are

You cut TV show opens for a living, and you have started doing title sequences for streaming series on the side. After Effects is home; AE expressions are a second language. You keep a separate project where you try to author the same motion grammar in the browser, because browser-rendered motion is where the industry is heading and you would rather learn it now than later. Your timing sense comes from the breath, not the beat — every cut you ship lands on the inhale.

## What they're trying to do

You want to drop a friend's instrumental into `/engine`, freeze three library clips on the timeline, and write a scene-change choreography across the ten CSS transitions — `whip-blur`, `glitch-block`, `zoom-through`, `flash-cover`, `paint-stroke`, `chromatic-split`, `swivel`, `circle-wipe`, `warp-dissolve`, `lens-flare` — so the transitions land on phrase boundaries instead of on every bar. You record the WebM, scrub it back at quarter speed, and rewrite the transitions that do not land on the breath. The silence between transitions is the work; you want to keep it.

## The surfaces they live in

1. **The ten CSS transitions** are your vocabulary. You serialize them through the Promise queue so two transitions never overlap, and you pick which transition fires on which phrase boundary by hand — never auto-fired, never timer-driven.
2. **The engine's bar grid** is where you mark phrase boundaries manually. The grid is the page you write on; the transitions are the words.
3. **Your library** holds three eight-second clips you shot in the same location at different times of day. The transitions make the time-of-day shift legible.
4. **The MediaRecorder export** captures thirty-second WebMs at each pass. You scrub them at quarter speed in QuickTime and re-cut the transitions that do not land.

## A typical session (90–180 minutes)

You drop the friend's sixty-second instrumental. The engine detects BPM 104 and shows the bar grid. You mark phrase boundaries at bars 8, 16, 24, 32, 40, 48 — six phrases across the track. You assign transitions: bar 8 = `whip-blur` (450 ms), bar 16 = `swivel` (600 ms), bar 24 = `glitch-block` (500 ms), bar 32 = `zoom-through` (500 ms), bar 40 = `paint-stroke` (550 ms), bar 48 = `circle-wipe` (600 ms).

You record a thirty-second WebM via MediaRecorder and scrub it at quarter speed. The `glitch-block` at bar 24 lands a sixteenth after the breath. You rewrite it as `chromatic-split` (500 ms) and re-record. The `paint-stroke` at bar 40 reads like an intertitle; you swap it for `warp-dissolve` (600 ms) and re-record.

You settle on the sequence `whip-blur` → `swivel` → `chromatic-split` → `zoom-through` → `warp-dissolve` → `circle-wipe` and record the final WebM. Six phrases, six transitions, each one chosen by hand.

There is a moment, around the first `glitch-block`, when it looks fine on the engine canvas and you almost ship it. At quarter speed it lands late. You almost did not notice. Then you did.

## What they'd pay for

A per-transition keyframe editor so you can nudge the 450 ms `whip-blur` to 380 ms when the breath is short. You would not pay for cloud rendering; the engine is a sketchpad, not a render farm, and you trust your local scrub loop more than any server-side preview.

## What would make them leave

The ten transitions auto-firing on every bar by default. The silence between transitions is the work, and a metronome that fires for you would erase the silence you spent hours writing into the timeline. You would also leave if a future "smart cut" button appeared — the whole craft is the override.

## Quote

"The 10 transitions are a vocabulary, and the engine's bar grid is the only reason I trust that a `chromatic-split` at bar 24 lands on the breath instead of the beat."