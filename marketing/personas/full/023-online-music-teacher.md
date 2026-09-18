# The Online Music Teacher

**Slug:** online-music-teacher
**Surfaces:** engine, versions, recorder, storyboard, presets
**One-line:** A music teacher running an online course who builds lesson plans as bar-aligned storyboards, picks the variant per concept, and ships lesson WebMs.

## Who they are

You run a subscription course on modal jazz and you have started using visuals in lessons because half the students learn by watching and the other half pretends to. Logic is home; the course's lesson page is the deliverable. You have learned just enough of the engine to deliver a lesson WebM per concept. A folder of reference recordings is your source material. You deliver a lesson WebM the same day the concept is taught, because same-day delivery is the only way the lesson survives the student's attention span.

## What they're trying to do

You want to drop a reference recording (a Coltrane quartet on "Impressions," a Dorian-mode exercise) into `/engine`, run the storyboard pipeline, and author a bar-aligned lesson plan per concept. You pick the variant per concept (`/versions/spectrum.html` for the chromagram lesson, `/versions/grid.html` for the rhythm lesson), record a sixty-second WebM via MediaRecorder, and embed the WebM in the course's lesson page. The lesson page is where the student watches; the lesson WebM is what the student sees.

## The surfaces they live in

1. **The storyboard engine** is where you spend most of your time. One named storyboard per concept with bar-aligned cuts is the lesson plan; the lesson plan is what the student can read without you narrating it.
2. **`/engine`** is the compositor where you stack the reference recording and the lesson visuals.
3. **The `/versions/` pages** are where you pick the variant per concept. `/versions/spectrum.html` for the chromagram lesson (so the twelve bins are visible); `/versions/grid.html` for the rhythm lesson (so the bar grid reads as structure).
4. **The MediaRecorder WebM** is the sixty-second file per concept for the lesson page. The page embeds the WebM; the student watches the WebM.
5. **The anchor map** is where you assign one anchor per concept: `gallery` for the Dorian lesson, `phosphor` for the Lydian lesson. The mapping is in your course outline.

## A typical session (90–180 minutes)

You open `/engine` and drop the Coltrane quartet on "Impressions." Audio analysis v2 returns BPM 128, key D dorian, chromagram weighted on D, F, A.

You run the storyboard pipeline; the bar-aligned cuts land on the sixteen-bar chorus repetitions. You lock `/versions/spectrum.html` for the chromagram lesson; the twelve-bar chart renders with D, F, A at the top. You push `posterize=3` so the canvas steps into a twelve-color palette where the dominant three bins become the dominant three tones.

You record a sixty-second WebM via MediaRecorder for the course's lesson page. You embed the WebM in the lesson page and reference the chromagram JSON in the lesson notes.

There is a moment, around `posterize=3`, when the canvas becomes too stepped and you almost revert it as a bug. You almost did. Then you realized the stepping makes the twelve bins legible to students who have never read a chromagram in their lives — and the lesson is the chromagram.

## What they'd pay for

$10/month for unlimited lesson saves and per-lesson version history — so you can keep the first pass and the student's-note pass as separate versions. You would not pay for cloud rendering; the course's CDN has its own pipeline.

## What would make them leave

The storyboard engine starting to hide the auto-picker's logic behind a "trust the AI" button. The override workflow is the work; you came here to disagree with the auto-picker on behalf of the student and ship your disagreement as a lesson plan. You would also leave if the chromagram rendering ever drifted between sessions — students need to see the same Dorian the previous cohort saw.

## Quote

"The storyboard engine saves one named project per concept, /versions/spectrum.html renders the chromagram for the lesson, and the MediaRecorder WebM is what the course page embeds, which is why my students learn Dorian by watching."