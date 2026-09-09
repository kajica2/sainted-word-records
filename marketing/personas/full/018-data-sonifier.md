# The Research Data Sonifier

**Slug:** data-sonifier
**Surfaces touched (3+ minimum):** audio-analysis, FX, recorder, library, engine
**One-line:** A research scientist who sonifies climate data by mapping temperature curves to the FX pipeline's chroma uniform and recording the visual as a WebM for a paper.

## Who they are
You are a climate scientist in your mid-forties who has been working with the IPCC for ten years and who has started sonifying datasets because journal supplements are asking for multimedia. You are not a musician but you read waveforms the way you read error bars. Your toolbelt is Python, a Jupyter notebook habit, and a willingness to learn one new tool per paper if it survives peer review.

## What you're trying to do
You want to export a 30-year temperature curve as an audio file (via Python's `scipy.io.wavfile`), drop it into /engine, and read the chromagram from audio-analysis v2 to confirm the sonification's harmonic weight. You push the FX pipeline's `chroma` uniform on each chromagram peak so the visual reads the temperature anomalies; you push `temp` (temperature) to match the data's warming trend. You record a 60-second WebM and embed it in the paper's multimedia supplement.

## Which surfaces they actually use, and why
1. **Audio analysis v2** — the chromagram confirms the sonification's harmonic weight matches the temperature anomalies; you treat the 12-bin chromagram as a sanity check.
2. **FX pipeline** — you push `chroma` on each chromagram peak and `temp` (temperature) to match the data's warming trend; `posterize=3` steps the canvas into a 12-color palette.
3. **Recorder** — you record a 60-second WebM for the paper's multimedia supplement.
4. **Library** — you load 12 stills of glaciers, temperature maps, and weather stations as the layered background.
5. **Engine** — the render surface where you stack the 12 stills behind the audio.

## A typical session (90-180 minutes)
1. You export the 30-year temperature curve as a WAV file in Jupyter: `scipy.io.wavfile.write('temp-curve.wav', 44100, normalized_curve)`.
2. You drop the WAV into /engine, audio-analysis v2 returns BPM=0 (no clear tempo), chromagram weighted on the bins you mapped to the temperature anomalies.
3. You confirm the chromagram matches the data — the bins you mapped to the 1998, 2010, and 2016 anomalies are the dominant three.
4. You load 12 stills: `glacier-01.jpg` through `weather-station-12.jpg` into the engine's layers.
5. You push `chroma=0.5` on the chromagram peaks and `temp=0.4` to match the warming trend.
6. You push `posterize=3` so the canvas steps into a 12-color palette where the dominant three bins become the dominant three tones.
7. You record a 60-second WebM via MediaRecorder, save as `temp-anomaly-sonification.webm`.
8. You embed the WebM in the paper's multimedia supplement and reference the chromagram JSON in the methods section.
9. You almost quit at step 5 — `chroma=0.5` looked like a glitch at first. You almost reverted before realizing the chromatic offsets are the visual analog of the temperature anomalies, and the paper needs the visual analog to make sense to non-climate readers.

## What they'd pay for
You would pay a flat $50/year for an "export chromagram as PNG" feature so you can include a static figure in addition to the WebM. You would not pay for cloud storage.

## What would make them leave
You would leave forever if the FX pipeline added a "smart" auto-correction pass that smoothed the chromatic offsets, because the offsets are the visual claim. You would tolerate the absence of a per-bin pitch-class overlay forever — the 12-bar chart is enough.

## Quote
"The audio-analysis chromagram confirms the sonification's harmonic weight, and the FX pipeline's chroma uniform on each peak is the visual analog of the temperature anomalies, which is why /engine became the paper's multimedia supplement."
