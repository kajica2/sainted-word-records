# The FX Surgeon

**Slug:** fx-surgeon
**Surfaces:** FX, presets, audio-analysis, recorder
**One-line:** A colorist who treats the 14-FX pipeline as a single WebGL fullscreen quad and pushes every uniform to its limit.

## Who they are

You learned DaVinci Resolve before you learned Premiere and you still think in nodes and uniforms more than in sliders and dropdowns. You take color passes for music videos and you keep a private folder of FX recipes you have been building for ten years. Your reference monitor is calibrated. You have pushed `chroma` past 1.0 just to see what happens, and you have opinions about what happens.

## What they're trying to do

You want to drop a friend's track into `/engine`, freeze the variant at `/versions/film.html`, and walk every one of the fourteen FX uniforms — `chroma`, `grain`, `glow`, `temp`, `sepia`, `grayscale`, `posterize`, `mut`, `mutAlgo`, `bloom`, `vignette`, `liquid`, `pearl`, `blur` — up and down while watching the chromagram from audio analysis v2 in the side panel. You color to the chromagram, not to the waveform; the chromagram tells you what is happening harmonically, and the harmonics are what the eye wants to see. When you find a stack that feels right, you record a WebM, copy the FX state as JSON, and paste it into a recipe file you keep in Obsidian.

## The surfaces they live in

1. **The 14-FX pipeline** is where you live. You push each uniform in isolation, then in pairs, then in triples, and you keep notes on which combinations read as "film" and which read as "video." The distinction matters to you and to almost no one else.
2. **Audio analysis v2** puts the chromagram in the side panel. You align your FX moves to the chromagram peaks rather than to the onsets — a chromatic aberration pulse on a chromagram peak reads differently than a pulse on an onset, and the difference is the whole point.
3. **The presets** are starting recipes, not destinations. Each preset's `fx_state` block is where you begin; the `midsommar-voronoi-lateral` preset's `chroma=0.4`, `bloom=0.4`, `vignette=0.3` is your usual starting point.
4. **The recorder** captures ten-second WebMs of each FX stack so you can compare them side-by-side on your reference monitor the next morning, when your eyes are fresh.

## A typical session (90–180 minutes)

You drop the friend's track. Audio analysis v2 returns BPM 92, key D dorian, chromagram weighted on D, F, A. You open the FX panel and zero out everything — `chroma=0.0`, `grain=0.0`, `glow=0.0`, `temp=0.0`, `sepia=0.0`, `grayscale=0.0`, `posterize=0`, `mut=0.0`, `mutAlgo=0.0`, `bloom=0.0`, `vignette=0.0`, `liquid=0.0`, `pearl=0.0`, `blur=0.0`. A clean state.

You push `chroma` to 0.8 and watch the chromagram peaks. The F-major third at bar 14 splits cleanly. You drop `chroma` to 0.3, push `grain` to 0.4, push `temp` to −0.2. The cold grain stack reads like a 16mm print. You add `posterize=4` (mid-range) and watch the chromagram — posterize steps the warm tones in a way that makes the F peaks feel painterly.

You push `sepia` to 0.6. Sepia overrides the warm tones and reads as a hand-tinted print. You revert. You settle on `chroma=0.3`, `grain=0.4`, `temp=−0.2`, `posterize=0` and record a ten-second WebM. You paste the FX state JSON into Obsidian under "Friend — Track 03 — cold grain."

There is a moment, around the sepia pass, when the image looks good for two seconds and then the chromagram peaks lose their meaning. You almost kept the sepia. Then you remembered you color to the chromagram, not to the eye.

## What they'd pay for

A per-FX-uniform keyframe export so you can author FX moves in the engine and bake them into a recipe file you can drop into Resolve's OFX pipeline. You would not pay for cloud rendering; you have a calibrated monitor and a faster machine than any serverless function.

## What would make them leave

A "smart" auto-correction pass that nudges your uniforms toward a "balanced" state. The imbalance is the work. You would also leave if the FX pipeline hid a uniform behind a "recommended" badge — every uniform should be reachable by hand, with no opinion attached.

## Quote

"The 14-FX pipeline's chroma uniform is what I trust, and the audio-analysis chromagram is what tells me when to push it — those two together are why I record WebMs at every state."