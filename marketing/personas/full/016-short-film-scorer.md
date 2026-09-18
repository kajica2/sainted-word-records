# The Short-Film Scorer

**Slug:** short-film-scorer
**Surfaces:** engine, presets, storyboard, recorder, auth
**One-line:** A short-film composer who authors a named storyboard per cue sheet, locks the variant per cue via the anchor map, and ships the temp reel as WebMs.

## Who they are

You score two short films a year for director friends and you have started using the engine for the temp reel because the directors want to see something before the orchestra is booked. Logic is home; the engine is the new tool that let you stop sending rough cuts as reference clips and start sending them as bar-aligned storyboards. You deliver a temp cut the same day the director calls. Same-day delivery is the reputation you have built, and same-day delivery is what keeps you in the room.

## What they're trying to do

You want to drop each cue into `/engine`, run the storyboard pipeline, and save one named storyboard per cue (`film-01-cue-opening`, `film-01-cue-stalk`, `film-01-cue-violin-solo`, `film-01-cue-chase`, `film-01-cue-resolution`) via the magic-link login. You lock the variant per cue via the anchor map (`void` for the opening, `pulse` for the stalk, `gallery` for the violin solo) and record a WebM per cue. You ship the five WebMs as the temp reel and the director picks the cues that need re-cutting — which is most of them, and which is the point.

## The surfaces they live in

1. **The storyboard engine** is the surface you spend the most time on. One named storyboard per cue with bar-aligned cuts is the contract; the contract is what survives the director's first reaction.
2. **`/engine`** is the compositor where you stack the fog, hands, and water clips per cue.
3. **The anchor map** is where you assign one anchor per cue and the visual language follows the cue's emotional arc. The mapping is in your spotting notebook and it is not negotiable.
4. **The MediaRecorder WebM** is the file you ship per cue for the temp reel.
5. **`/api/projects` with magic-link auth** is where each cue saves as a named project so the director can reload the storyboard on their laptop during the spotting session. The login is a single email.
6. **Audio analysis v2** is where you read the chromagram of each cue and align the bar grid to the cue's downbeat. The grid matches the downbeat or the grid is wrong.

## A typical session (90–180 minutes)

You open `/auth/login`. The magic-link arrives. You land at `/engine`. You drop the cue-violin-solo audio. Audio analysis v2 returns BPM 68, key D major, chromagram weighted on D, F#, A.

You run the storyboard pipeline; the bar-aligned cuts land on the eight-bar phrase boundaries. You assign the `gallery` preset at warmth 0.5, intensity 0.4 because the chromagram's D/F#/A weight reads as warm. You stack three clips: `c01-fog.jpg`, `c02-violin-hands.mp4`, `c03-water-light.mp4`. You record a thirty-second WebM via MediaRecorder for the temp reel.

You save the storyboard as a project named `film-01-cue-violin-solo` via `POST /api/projects`. You ship the WebM to the director and reload the project on their laptop to walk them through the cuts.

There is a moment, around the violin solo, when the auto-picker's first shot is a clip of streetlamps, which is wrong for the cue. You almost kept it before remembering you came here to override the auto-picker, not to accept it.

## What they'd pay for

$10/month for unlimited project saves and a per-project version history — so you can keep the first pass and the director's-note pass as separate versions. You would not pay for cloud rendering; you have the Logic pipeline and a faster laptop than any serverless function would give you.

## What would make them leave

The storyboard engine starting to hide the auto-picker's logic behind a "trust the AI" button. The override workflow is the work; you came here to disagree with the auto-picker and ship your disagreement as a director's cut. You would also leave if the magic-link login ever switched to OAuth; the director's laptop is a stranger's laptop and OAuth on a stranger's laptop is a non-starter.

## Quote

"The storyboard engine saves one named project per cue, the magic-link login lets the director reload on their laptop, and the audio-analysis chromagram is the only reason the bar grid matches the cue's downbeat."