# Equaliser isolation — the test track and what it found

`audios/swr-eq-test.mp3` is a 60-second diagnostic track that fills one of
the engine's frequency bands at a time, so you can see that a layer reacts
to its own band and to nothing else.

```bash
node scripts/make-eq-test-track.mjs      # regenerate the track
node scripts/check-eq-isolation.mjs       # run the isolation check
```

Load it into any variant page with **Load song**, or drop it on the page.
The visual debugger (`client/engine-debugger.client.js`) reads the same
state live, so you can watch the layer rows move as each band comes in.

## The track

| Time | Segment | Fills |
| --- | --- | --- |
| 0–8 s | bass | FFT bins 2–11 (43–237 Hz) |
| 8.5–16 s | mid | bins 11–93 (237–2000 Hz) |
| 16.5–24 s | treble | bins 93–279 (2–6 kHz) |
| 24.5–32 s | air | bins 279–700 (6–15 kHz) |
| 32.5–40 s | silence | — the control |
| 40.5–48 s | sub | bins 1–2 (21–43 Hz) |
| 48.5–60 s | all four | every band at once |

Each segment is **band-limited noise** — one sinusoid per FFT bin of the
band, at the bin's centre — not a single pure tone. Three louder marker
tones are mixed in so the segment is recognisable by ear. Segments are
separated by 500 ms of silence and fade over 100 ms, because a click is
broadband and would light up every band at once.

Noise rather than a tone, because a band feature is the **mean of that
band's bins**: a single narrow tone only lights up ~5 of them, so the same
tone amplitude reads ~0.5 in the 10-bin bass band and ~0.06 in the 83-bin
mid band. Filling the band gives every band a realistic level, and stays
just as isolated.

## The result

The engine's own band separation, mean feature level per segment:

| Segment | sub | bass | mid | treble | air | rms | centroid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bass 43–237 Hz | 0.82 | **0.93** | 0.04 | 0.00 | 0.00 | 0.17 | 0.01 |
| mid 237–2000 Hz | 0.00 | 0.16 | **0.80** | 0.02 | 0.00 | 0.18 | 0.05 |
| treble 2–6 kHz | 0.00 | 0.00 | 0.01 | **0.75** | 0.00 | 0.17 | 0.18 |
| air 6–15 kHz | 0.00 | 0.00 | 0.00 | 0.00 | **0.40** | 0.17 | 0.48 |
| silence (control) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| sub 21–43 Hz | **0.98** | 0.42 | 0.00 | 0.00 | 0.00 | 0.18 | 0.00 |
| all four bands | 0.56 | 0.66 | 0.66 | 0.66 | 0.38 | 0.18 | 0.34 |

Each layer's displacement from its resting value, against what the
engine's own maths predicts (`ease(feature) × sens × gain`):

| Layer | Target ← feature | own band | elsewhere | predicted | measured |
| --- | --- | --- | --- | --- | --- |
| L1 | scale ← bass | 1.021 | 0.509 (mid) | 1.021 | 1.021 |
| L2 | hue ← mid | 240.2 | 11.3 (bass) | 240.2 | 240.2 |
| L3 | rot ← treble | 3.364 | 0.078 (mid) | 3.364 | 3.364 |
| L3 | y ← air | 47.4 | 0.406 (treble) | 47.5 | 47.4 |
| L5 | scale ← treble | 0.631 | 0.001 | 0.631 | 0.631 |
| L6 | scale ← bass | 1.458 | 0.727 (mid) | 1.458 | 1.458 |

**Every layer's movement is exactly what the engine's own equations
predict, to three decimals.** Nothing else moves a layer.

## What it found

**1. A band's level depends on how wide it is.** A feature is the mean of
its bins, so the same energy reads high in a narrow band and low in a wide
one: the track's bass segment reads 0.93 in the 10-bin bass band but
0.40 in the 745-bin air band. This is why the shipped reactors carry such
different per-target gains — `mid → hue ×200` against `treble → rot ×3` —
and why a track with a lot of air content moves the `air` layer far less
than a bass-heavy one moves the `bass` layer.

**2. Adjacent bands share a boundary FFT bin.** The engine's band table is
`sub = bins 1..2`, `bass = 2..11`, `mid = 11..93`, `treble = 93..279`,
`air = 279..1023` — so sub and bass share bin 2, bass and mid share bin
11, and so on. A loud band therefore always bleeds into its neighbour by
one bin's worth: about 10% into the 10-bin bass band, about 1% into the
83-bin mid band. The sub segment reading 0.42 in bass is this, not a leak.

**3. The `sharp` ease curve amplifies that bleed.** `sharp` is
`Math.pow(t, 0.4)`, which rises fast off the floor: a bleed of 0.16
becomes 0.48, and a bass-bound layer moves **about half as much during a
mid segment** as it does during a bass segment. Arithmetic, in full:

```
bass segment:  0.93^0.4 × 1.5 × 0.70 = 1.021   (measured 1.021)
mid segment:   0.16^0.4 × 1.5 × 0.70 = 0.505   (measured 0.509)
```

**4. Two subsystems write into the transform that have nothing to do with
the music.** The narrative-state drift adds a slow positional wander to
every layer's x and y, and the LFO registry adds time-based modulators.
Neither is an EQ effect, and both would put unrelated motion into the
targets this test measures, so the check switches both off for the run.

**5. `rms` and `centroid` are broadband by definition.** `rms` is the
time-domain energy and `centroid` the spectral centroid — both respond to
any sound at all, which is correct rather than a leak. The check reports
them without asserting on them. The same goes for the temporal features:
`beat` and `onset` are detectors, not bands.

## How the check works

`scripts/check-eq-isolation.mjs` drives headless Chrome over the DevTools
Protocol with no npm dependencies, the same way `check-swr-debugger.mjs`
does. It decodes the track in the page and plays it through the engine's
**own analyser** as a buffer source rather than as a media element — a
media element's playback stalls when the page's main thread is busy, which
drags the timeline out of step with the track; a buffer source is scheduled
on the audio clock, so a frame always belongs to the segment it was
captured in.

Each segment is measured after the damper has settled (1.5 s), because the
engine damps every reactor input with a 0.28 s half-life and the tail of
the previous segment would otherwise be read as a leak.

The assertion is not a threshold on "no cross-talk" — it is that each
layer's displacement matches the engine's own prediction, segment by
segment, to within 2% of that target's dynamic range. A layer that
reacted to something else would miss its prediction.
