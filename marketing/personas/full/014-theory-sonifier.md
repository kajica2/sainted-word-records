# The Theory Sonifier

**Slug:** theory-sonifier
**Surfaces:** audio-analysis, FX, versions, recorder, engine
**One-line:** A music theorist who sonifies chord progressions by pushing the FX pipeline's chroma uniform on each chromagram peak and recording the visual as a WebM for a paper.

## Who they are

You write about voice-leading in rock harmony and you have started including visuals in your papers because the journals you submit to are asking for multimedia supplements. You know Schenker; you know GLSL; you have never put them in the same room. Your LaTeX workflow is home. Your JSTOR account is the only social network you keep up. You test every claim with three examples, because one example is an anecdote and three is a result.

## What they're trying to do

You want to drop three chord progressions (a I–IV–V–I in C, a vi–IV–I–V in A minor, a bVI–bVII–I in E dorian) into `/engine` and read each chromagram from audio analysis v2. You push the FX pipeline's `chroma` uniform on each chromagram peak — the C peak in the I chord, the F peak in the IV chord — and you pick the variant at `/versions/spectrum.html` because the spectrum variant renders the twelve-bin chromagram as a visible twelve-bar chart. You record a thirty-second WebM of each progression and embed the WebM in your paper's multimedia supplement, which is the part of the paper the readers actually look at.

## The surfaces they live in

1. **Audio analysis v2** is the surface you spend the most time on. The twelve-bin chromagram is the data you cite in the paper, and the algorithm's accuracy is what you can defend in peer review.
2. **The FX pipeline** is where you push `chroma` (chromatic aberration) on each chromagram peak so the visual reads the harmonic weight; you push `posterize=3` to step the twelve bins into twelve colors. Both moves are claims you can defend in the paper's caption.
3. **`/versions/spectrum.html`** is the variant that renders the twelve-bin chromagram as a visible twelve-bar chart. It is the only variant that makes the chromagram legible to a non-theorist reader, and the paper has non-theorist readers.
4. **The MediaRecorder WebM** is the multimedia supplement. You record a thirty-second WebM per progression and embed it in the LaTeX source as a `\video` reference.
5. **`/engine`** is the render surface where you stack the chord-progression audio.

## A typical session (90–180 minutes)

You drop the I–IV–V–I in C. Audio analysis v2 returns chromagram weighted on C (0.95), F (0.81), G (0.74). You open `/versions/spectrum.html`; the twelve-bar chart renders with C at the top, F second, G third.

You push `chroma=0.6` so the chromatic offsets split the C, F, and G peaks visibly. You push `posterize=3` so the canvas steps into a twelve-color palette where the dominant three bins become the dominant three tones. You record a thirty-second WebM via MediaRecorder, save as `I-IV-V-I-C-spectrum.webm`.

You repeat for the vi–IV–I–V in A minor (chromagram weighted on A, F, C, G) and the bVI–bVII–I in E dorian (chromagram weighted on E, C, D, G). You paste the WebM file paths into your LaTeX source as `\video` references for the multimedia supplement.

There is a moment, around `chroma=0.6`, when the visual looks like a glitch and you almost revert it. You almost did. Then you realized the chromatic offsets are the visual analog of the harmonic weight, and the paper needs the visual analog to make sense to readers who have never read a Schenkerian analysis in their lives.

## What they'd pay for

A flat $50/year for an "export chromagram as PNG" feature so you can include a static figure in addition to the WebM. You would not pay for cloud storage; the LaTeX workflow has its own archive.

## What would make them leave

The FX pipeline adding a "smart" auto-correction pass that smoothed the chromatic offsets. The offsets are the visual claim, and a smoothing pass would erase the claim and replace it with a generic look. You would also leave if the chromagram rendering ever changed between sessions; the visualization has to be deterministic or it stops being a figure.

## Quote

"The audio-analysis chromagram is the data, and the FX pipeline's chroma uniform on each peak is the visual analog, which is why /versions/spectrum.html is the only variant that makes the paper's multimedia supplement legible."