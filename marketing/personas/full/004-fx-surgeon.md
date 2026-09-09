# The FX Surgeon

**Slug:** fx-surgeon
**Surfaces touched (3+ minimum):** FX, presets, audio-analysis, recorder
**One-line:** A colorist who treats the 14-FX pipeline as a single WebGL fullscreen quad and pushes every uniform to its limit.

## Who they are
You are a freelance colorist in your mid-thirties who learned DaVinci Resolve before you learned Premiere and who thinks in terms of nodes and uniforms more than in terms of sliders and dropdowns. You take color passes for music videos and you keep a personal folder of FX recipes you have built over ten years. Your toolbelt is Resolve's color page, a calibrated reference monitor, and a willingness to push `chroma` past 1.0 just to see what happens.

## What they're trying to do
You want to drop a friend's track into /engine, freeze the variant at /versions/film.html, and walk every one of the 14 FX uniforms (chroma, grain, glow, temp, sepia, grayscale, posterize, mut, mutAlgo, bloom, vignette, liquid, pearl, blur) up and down while watching the chromagram from audio-analysis v2 in the side panel — you color to the chromagram, not to the waveform, because the chromagram tells you what is happening harmonically. When you find a stack that feels right, you record a WebM, capture the FX state as JSON, and paste it into a recipe file you keep in Obsidian.

## Which surfaces they actually use, and why
1. **14-FX pipeline (fx-postprocess.js)** — the surface you spend the most time on; you push each uniform in isolation, then in pairs, then in triples, and you keep notes on which combinations read as "film" vs "video."
2. **Audio analysis v2** — the chromagram tells you where the harmonic weight is, and you align your FX moves to the chromagram peaks rather than to the onsets; a chromatic aberration pulse on a chromagram peak reads differently than a pulse on an onset.
3. **Presets** — you treat each preset's `fx_state` block as a starting recipe and edit from there; the `midsommar-voronoi-lateral` preset's chroma=0.4, bloom=0.4, vignette=0.3 is your usual starting point.
4. **Recorder** — you record 10-second WebMs of each FX stack so you can compare them side-by-side in your review monitor the next morning.

## A typical session (90-180 minutes)
1. You drop the friend's track, audio-analysis-v2 returns BPM=92, key=D dorian, chromagram weighted on D, F, A.
2. You open the FX panel and set `chroma=0.0`, `grain=0.0`, `glow=0.0`, `temp=0.0`, `sepia=0.0`, `grayscale=0.0`, `posterize=0`, `mut=0.0`, `mutAlgo=0.0`, `bloom=0.0`, `vignette=0.0`, `liquid=0.0`, `pearl=0.0`, `blur=0.0` — a clean state.
3. You push `chroma` to 0.8 and watch the chromagram peaks; the F-major third at bar 14 splits cleanly.
4. You drop `chroma` to 0.3, push `grain` to 0.4, push `temp` to -0.2 — the cold grain stack reads like a 16mm print.
5. You add `posterize=4` (mid-range) and watch the chromagram — posterize steps the warm tones in a way that makes the F peaks feel painterly.
6. You push `sepia` to 0.6 — sepia overrides the warm tones and reads as a hand-tinted print. You revert.
7. You settle on `chroma=0.3, grain=0.4, temp=-0.2, posterize=0` and record a 10-second WebM.
8. You paste the FX state JSON into Obsidian under "Friend — Track 03 — cold grain."
9. You almost quit at step 6 — sepia looked good for two seconds and then the chromagram peaks lost their meaning. You almost kept it before remembering you color to the chromagram, not to the eye.

## What they'd pay for
You would pay for a per-FX-uniform keyframe export so you can author FX moves in the engine and bake them into a recipe file you can drop into Resolve's OFX pipeline. You would not pay for cloud rendering — you have a calibrated monitor.

## What would make them leave
You would leave forever if the FX pipeline added a "smart" auto-correction pass that nudges your uniforms toward a "balanced" state, because the imbalance is the work. You would tolerate the absence of a per-frame keyframe UI forever — you can author keyframes in Resolve, you do not need them in the engine.

## Quote
"The 14-FX pipeline's chroma uniform is what I trust, and the audio-analysis chromagram is what tells me when to push it — those two together are why I record WebMs at every state."
