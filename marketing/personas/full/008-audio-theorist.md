# The Audio Theorist

**Slug:** audio-theorist
**Surfaces touched (3+ minimum):** audio-analysis, engine, presets, FX
**One-line:** A music theorist who reads the BPM, key, and chromagram as a sonification of theory and uses the engine to make the analysis visible.

## Who they are
You are a music theory professor in your mid-forties who teaches a sophomore theory sequence and who has started using visuals in lecture because half the class learns by watching. You have a PhD in Schenkerian analysis and you can hear a modulation before most people can hear the dominant. Your toolbelt is a chalkboard, a copy of Aldwell & Schachter, and an irrational patience for explaining what a secondary dominant is to people who do not care.

## What they're trying to do
You want to drop a piece you are teaching (Bach BWV 846, a Coltrane quartet, a Radiohead B-side) into /engine and read the BPM, key, scale, and 12-bin chromagram that audio-analysis-v2 returns. You want to overlay the chromagram on the visual as a 12-color bar chart so the class can see the F# minor weight when Coltrane modulates to F# minor in the fourth chorus. You save the chromagram as a JSON export and paste it into your lecture notes.

## Which surfaces they actually use, and why
1. **Audio analysis v2** — the surface you spend the most time on; the BPM estimate (autocorrelation), the Krumhansl-Schmuckler key/scale estimate, and the 12-bin chromagram are exactly the features you need to teach.
2. **Engine** — the canvas is where you overlay the chromagram as a 12-bar color chart; the engine's render loop is the only reason the overlay updates in real time.
3. **Presets** — you pick presets by chromagram weight: high F# weight → `void` (warmth 0.1, intensity 0.85), high C weight → `kraft` (warmth 0.7, intensity 0.3).
4. **FX pipeline** — you push `chroma` to 0.4 when you want the chromagram's chromatic offsets to mirror the visual; you push `posterize` to 3 when you want the 12-bin chromagram to step the canvas into 12 colors.

## A typical session (90-180 minutes)
1. You open /engine, drop the Coltrane quartet track, audio-analysis-v2 returns BPM=128, key=F# minor, confidence=0.78, chromagram weighted on F# (0.92), A (0.74), C# (0.61).
2. You open the chromagram panel and pin it to the side of the canvas; the 12 bins show F# at the top, A second, C# third.
3. You push `posterize` to 3, the canvas steps into a 12-color palette where the dominant three bins become the dominant three tones.
4. You push `chroma` to 0.4 — the chromatic offsets split the F# and C# into visible color shifts that the class can read.
5. You click through the variant pages: `/versions/void.html` makes the F# weight read as deep space, `/versions/kraft.html` makes the A weight read as warm cardboard, you pick `void` because the F# weight is the point.
6. You save the chromagram JSON as `coltrane-quarter-fsharp-minor.json` and paste it into your lecture notes for the secondary dominant lesson.
7. You record a 30-second WebM of the chromagram overlay so the lecture recording shows what the class saw.
8. You almost quit at step 3 — `posterize=3` looked like a bug at first (the canvas became too stepped). You almost reverted before realizing the stepping is the point — it makes the 12-bin chromagram legible.

## What they'd pay for
You would pay a flat $50/year for an "export chromagram as PNG" feature so you can paste the 12-bar chart into a PDF without screen-grabbing. You would not pay for anything else.

## What would make them leave
You would leave forever if audio-analysis v2 added an "auto-correct" pass that snapped the detected key to a diatonic default, because the modulation to F# minor is the lesson. You would tolerate the absence of a per-bin pitch-class overlay forever — the 12-bar chart is enough.

## Quote
"The audio-analysis chromagram is what makes the F# minor modulation visible in lecture, and the FX pipeline's posterize is the only reason the 12 bins become 12 colors the class can read."
