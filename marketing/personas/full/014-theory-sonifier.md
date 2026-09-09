# The Theory Sonifier

**Slug:** theory-sonifier
**Surfaces touched (3+ minimum):** audio-analysis, FX, versions, recorder, engine
**One-line:** A music theorist who sonifies chord progressions by pushing the FX pipeline's chroma uniform on each chromagram peak and recording the visual as a WebM for a paper.

## Who they are
You are a music theorist in your mid-thirties who writes about voice-leading in rock harmony and who has started including visuals in your papers because journals are asking for multimedia supplements. You know Schenker and you know GLSL but you have never put them in the same room. Your toolbelt is a LaTeX workflow, a JSTOR account, and a habit of testing every claim with three examples.

## What they're trying to do
You want to drop three chord progressions (a I-IV-V-I in C, a vi-IV-I-V in A minor, a bVI-bVII-I in E dorian) into /engine and read each chromagram from audio-analysis v2. You push the FX pipeline's `chroma` uniform on each chromagram peak (the C peak in the I chord, the F peak in the IV chord) and pick the variant at /versions/spectrum.html because the spectrum variant renders the 12-bin chromagram as a visible 12-bar chart. You record a 30-second WebM of each progression and embed the WebM in your paper's multimedia supplement.

## Which surfaces they actually use, and why
1. **Audio analysis v2** — the surface you spend the most time on; the 12-bin chromagram is the data you cite in the paper.
2. **FX pipeline** — you push `chroma` (chromatic aberration) on each chromagram peak so the visual reads the harmonic weight; you push `posterize=3` to step the 12 bins into 12 colors.
3. **/versions/spectrum.html** — the variant that renders the 12-bin chromagram as a visible 12-bar chart; this is the only variant that makes the chromagram legible to a non-theorist reader.
4. **Recorder** — you record a 30-second WebM per progression for the paper's multimedia supplement.
5. **Engine** — the render surface where you stack the chord-progression audio.

## A typical session (90-180 minutes)
1. You drop the I-IV-V-I in C, audio-analysis v2 returns chromagram weighted on C (0.95), F (0.81), G (0.74).
2. You open /versions/spectrum.html; the 12-bar chart renders with C at the top, F second, G third.
3. You push `chroma=0.6` so the chromatic offsets split the C, F, and G peaks visibly.
4. You push `posterize=3` so the canvas steps into a 12-color palette where the dominant three bins become the dominant three tones.
5. You record a 30-second WebM via MediaRecorder, save as `I-IV-V-I-C-spectrum.webm`.
6. You repeat for the vi-IV-I-V in A minor (chromagram weighted on A, F, C, G) and the bVI-bVII-I in E dorian (chromagram weighted on E, C, D, G).
7. You paste the WebM file paths into your LaTeX source as `\video` references for the multimedia supplement.
8. You almost quit at step 3 — `chroma=0.6` looked like a glitch at first. You almost reverted before realizing the chromatic offsets are the visual analog of the harmonic weight, and the paper needs the visual analog to make sense to non-theorists.

## What they'd pay for
You would pay a flat $50/year for an "export chromagram as PNG" feature so you can include a static figure in addition to the WebM. You would not pay for cloud storage.

## What would make them leave
You would leave forever if the FX pipeline added a "smart" auto-correction pass that smoothed the chromatic offsets, because the offsets are the visual claim. You would tolerate the absence of a per-bin pitch-class overlay forever — the 12-bar chart is enough.

## Quote
"The audio-analysis chromagram is the data, and the FX pipeline's chroma uniform on each peak is the visual analog, which is why /versions/spectrum.html is the only variant that makes the paper's multimedia supplement legible."
