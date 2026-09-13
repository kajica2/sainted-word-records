# The Online Music Teacher

**Slug:** online-music-teacher
**Surfaces touched (3+ minimum):** engine, versions, recorder, storyboard, presets
**One-line:** A music teacher running an online course who builds lesson plans as bar-aligned storyboards, picks the variant per concept, and ships lesson WebMs.

## Who they are
You are an online music teacher in your mid-thirties who runs a subscription course on modal jazz and who has started using visuals in lessons because half the students learn by watching. You work in Logic for the audio and you have learned just enough of the engine to deliver a lesson WebM per concept. Your toolbelt is Logic, a folder of reference recordings, and a willingness to deliver a lesson WebM the same day the concept is taught.

## What you're trying to do
You want to drop a reference recording (a Coltrane quartet on "Impressions," a Dorian-mode exercise) into /engine, run the storyboard pipeline, and author a bar-aligned lesson plan per concept. You pick the variant per concept (`/versions/spectrum.html` for the chromagram lesson, `/versions/grid.html` for the rhythm lesson), record a 60-second WebM via MediaRecorder, and embed the WebM in the course's lesson page.

## Which surfaces they actually use, and why
1. **Storyboard engine (planned)** — the surface you spend the most time on; one named storyboard per concept with bar-aligned cuts.
2. **Engine** — the compositor where you stack the reference recording and the lesson visuals.
3. **Versions** — you pick the variant per concept; `/versions/spectrum.html` for the chromagram lesson, `/versions/grid.html` for the rhythm lesson.
4. **Recorder** — you record a 60-second WebM per concept for the course's lesson page.
5. **Presets** — you assign one anchor per concept: `gallery` for the Dorian lesson, `phosphor` for the Lydian lesson.

## A typical session (90-180 minutes)
1. You open /engine, drop the Coltrane quartet on "Impressions," audio-analysis v2 returns BPM=128, key=D dorian, chromagram weighted on D, F, A.
2. You run the storyboard pipeline; the bar-aligned cuts land on the 16-bar chorus repetitions.
3. You lock /versions/spectrum.html for the chromagram lesson; the 12-bar chart renders with D, F, A at the top.
4. You push `posterize=3` so the canvas steps into a 12-color palette where the dominant three bins become the dominant three tones.
5. You record a 60-second WebM via MediaRecorder for the course's lesson page.
6. You embed the WebM in the lesson page and reference the chromagram JSON in the lesson notes.
7. You almost quit at step 4 — `posterize=3` looked like a bug at first. You almost reverted before realizing the stepping makes the 12 bins legible to students who have never read a chromagram.

## What they'd pay for
You would pay $10/month for unlimited lesson saves and per-lesson version history (so you can keep the first pass and the student's-note pass as separate versions). You would not pay for cloud rendering.

## What would make them leave
You would leave forever if the storyboard engine started hiding the auto-picker's logic behind a "trust the AI" button, because the override workflow is the work. You would tolerate the magic-link delay forever — you have a lesson to record.

## Quote
"The storyboard engine saves one named project per concept, /versions/spectrum.html renders the chromagram for the lesson, and the MediaRecorder WebM is what the course page embeds, which is why my students learn Dorian by watching."
