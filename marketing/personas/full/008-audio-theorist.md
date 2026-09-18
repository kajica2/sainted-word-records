# The Audio Theorist

**Slug:** audio-theorist
**Surfaces:** audio-analysis, engine, presets, FX
**One-line:** A music theorist who reads the BPM, key, and chromagram as a sonification of theory and uses the engine to make the analysis visible.

## Who they are

You teach a sophomore theory sequence and you have started using visuals in lecture because half the class learns by watching and the other half pretends to. You have a PhD in Schenkerian analysis and you can hear a modulation before most people can hear the dominant. Your chalkboard is home. Aldwell & Schachter is the textbook. You have an irrational patience for explaining what a secondary dominant is to people who do not care, and you have started wondering whether the right visual might do the explaining for you.

## What they're trying to do

You want to drop a piece you are teaching — Bach BWV 846, a Coltrane quartet, a Radiohead B-side — into `/engine` and read the BPM, key, scale, and twelve-bin chromagram that audio analysis v2 returns. You want to overlay the chromagram on the visual as a twelve-color bar chart so the class can see the F# minor weight when Coltrane modulates to F# minor in the fourth chorus. You save the chromagram as a JSON export and paste it into your lecture notes, and the next lecture's slide deck finally has something the class can read without you narrating it.

## The surfaces they live in

1. **Audio analysis v2** is where you spend most of your time. The BPM estimate via autocorrelation, the Krumhansl–Schmuckler key/scale estimate, and the twelve-bin chromagram are exactly the features you need to teach, and you have verified by hand that the algorithm agrees with your ear.
2. **`/engine`** is the canvas. You overlay the chromagram as a twelve-bar color chart pinned to the side; the engine's render loop is the only reason the overlay updates in real time, which is the difference between a static slide and a lecture that breathes.
3. **The presets** are picked by chromagram weight. High F# weight → `void` (warmth 0.1, intensity 0.85); high C weight → `kraft` (warmth 0.7, intensity 0.3). The mapping is yours and you have not seen anyone argue with it.
4. **The FX pipeline** is where you push `chroma` to 0.4 when you want the chromagram's chromatic offsets to mirror the visual, and `posterize` to 3 when you want the twelve-bin chromagram to step the canvas into twelve colors. Both moves are pedagogical; neither is decorative.

## A typical session (90–180 minutes)

You open `/engine` and drop the Coltrane quartet track. Audio analysis v2 returns BPM 128, key F# minor, confidence 0.78, chromagram weighted on F# (0.92), A (0.74), C# (0.61). You open the chromagram panel and pin it to the side of the canvas. The twelve bins show F# at the top, A second, C# third.

You push `posterize` to 3 and the canvas steps into a twelve-color palette where the dominant three bins become the dominant three tones. You push `chroma` to 0.4; the chromatic offsets split the F# and C# into visible color shifts that the class can read without you pointing.

You click through the variant pages: `/versions/void.html` makes the F# weight read as deep space, `/versions/kraft.html` makes the A weight read as warm cardboard. You pick `void` because the F# weight is the point of the lesson.

You save the chromagram JSON as `coltrane-quarter-fsharp-minor.json` and paste it into your lecture notes for the secondary dominant lesson. You record a thirty-second WebM of the chromagram overlay so the lecture recording shows what the class saw.

There is a moment, around `posterize=3`, when the canvas becomes too stepped and you almost revert it as a bug. You almost did. Then you realized the stepping is the point — it makes the twelve-bin chromagram legible at the back row of a 200-seat lecture hall.

## What they'd pay for

A flat $50/year for an "export chromagram as PNG" feature so you can paste the twelve-bar chart into a PDF without screen-grabbing. You would not pay for anything else; the engine does the thing you need and you are not in the market for more things.

## What would make them leave

An "auto-correct" pass that snapped the detected key to a diatonic default. The modulation to F# minor is the lesson, and an auto-correction that hid the modulation would tell you the engine had stopped believing in the analysis. You would also leave if the chromagram rendering ever shifted by an octave or a key — the visualization has to agree with the analysis or it stops being trustworthy.

## Quote

"The audio-analysis chromagram is what makes the F# minor modulation visible in lecture, and the FX pipeline's posterize is the only reason the 12 bins become 12 colors the class can read."