# The Research Data Sonifier

**Slug:** data-sonifier
**Surfaces:** audio-analysis, FX, recorder, library, engine
**One-line:** A research scientist who sonifies climate data by mapping temperature curves to the FX pipeline's chroma uniform and recording the visual as a WebM for a paper.

## Who they are

You have been working with the IPCC for ten years and you have started sonifying datasets because journal supplements are asking for multimedia and the readers are asking for something they can hear. You are not a musician; you read waveforms the way you read error bars. Python and a Jupyter notebook habit are home. You learn one new tool per paper if it survives peer review, and peer review is the only reviewer you trust.

## What they're trying to do

You want to export a thirty-year temperature curve as an audio file via `scipy.io.wavfile.write`, drop it into `/engine`, and read the chromagram from audio analysis v2 to confirm the sonification's harmonic weight matches the temperature anomalies. You push the FX pipeline's `chroma` uniform on each chromagram peak so the visual reads the anomalies; you push `temp` (temperature) to match the data's warming trend. You record a sixty-second WebM and embed it in the paper's multimedia supplement, which is the part of the paper the readers actually open.

## The surfaces they live in

1. **Audio analysis v2** is where the chromagram confirms the sonification's harmonic weight. You treat the twelve-bin chromagram as a sanity check — the bins you mapped to the temperature anomalies should be the dominant three, and if they are not, the sonification needs to be redone.
2. **The FX pipeline** is where you push `chroma` on each chromagram peak and `temp` to match the warming trend. `posterize=3` steps the canvas into a twelve-color palette where the dominant three bins become the dominant three tones. The visual claim is the paper's claim.
3. **The MediaRecorder WebM** is the paper's multimedia supplement. Sixty seconds is enough to cover the thirty-year curve and the three anomaly peaks.
4. **The library** holds twelve stills of glaciers, temperature maps, and weather stations as the layered background. The stills are the visual evidence the visual claims are grounded in.
5. **`/engine`** is the render surface where you stack the twelve stills behind the audio.

## A typical session (90–180 minutes)

You export the thirty-year temperature curve as a WAV file in Jupyter: `scipy.io.wavfile.write('temp-curve.wav', 44100, normalized_curve)`. You drop the WAV into `/engine`. Audio analysis v2 returns BPM 0 (no clear tempo), chromagram weighted on the bins you mapped to the temperature anomalies.

You confirm the chromagram matches the data — the bins you mapped to the 1998, 2010, and 2016 anomalies are the dominant three. You load the twelve stills: `glacier-01.jpg` through `weather-station-12.jpg` into the engine's layers. You push `chroma=0.5` on the chromagram peaks and `temp=0.4` to match the warming trend. You push `posterize=3` so the canvas steps into a twelve-color palette.

You record a sixty-second WebM via MediaRecorder, save as `temp-anomaly-sonification.webm`. You embed the WebM in the paper's multimedia supplement and reference the chromagram JSON in the methods section. The chromagram is reproducible; the methods section has to be reproducible; the WebM is the methods section's exhibit.

There is a moment, around `chroma=0.5`, when the visual looks like a glitch and you almost revert it. You almost did. Then you realized the chromatic offsets are the visual analog of the temperature anomalies, and the paper needs the visual analog to make sense to non-climate readers who have never seen an error bar.

## What they'd pay for

A flat $50/year for an "export chromagram as PNG" feature so you can include a static figure in addition to the WebM. You would not pay for cloud storage; the IPCC's archive has its own infrastructure.

## What would make them leave

The FX pipeline adding a "smart" auto-correction pass that smoothed the chromatic offsets. The offsets are the visual claim, and a smoothing pass would erase the claim and replace it with a generic look. You would also leave if the chromagram rendering ever drifted between sessions; the visualization has to be deterministic or the paper's figure is not a figure.

## Quote

"The audio-analysis chromagram confirms the sonification's harmonic weight, and the FX pipeline's chroma uniform on each peak is the visual analog of the temperature anomalies, which is why /engine became the paper's multimedia supplement."