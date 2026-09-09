# The Short-Film Scorer

**Slug:** short-film-scorer
**Surfaces touched (3+ minimum):** engine, presets, storyboard, recorder, auth
**One-line:** A short-film composer who authors a named storyboard per cue sheet, locks the variant per cue via the anchor map, and ships the temp reel as WebMs.

## Who they are
You are a composer in your late thirties who scores two short films a year for director friends and who has started using the engine for the temp reel because the directors want to see something before the orchestra is booked. You work in Logic for the score and you have learned just enough of the engine to deliver a temp cut the same day. Your toolbelt is Logic, a spotting notebook, and a willingness to deliver something rough that the director can react to.

## What they're trying to do
You want to drop each cue into /engine, run the storyboard pipeline, and save one named storyboard per cue (`film-01-cue-opening`, `film-01-cue-stalk`, `film-01-cue-violin-solo`, `film-01-cue-chase`, `film-01-cue-resolution`) via the magic-link login. You lock the variant per cue via the anchor map (`void` for the opening, `pulse` for the stalk, `gallery` for the violin solo) and record a WebM per cue. You ship the five WebMs as the temp reel and the director picks the cues that need re-cutting.

## Which surfaces they actually use, and why
1. **Storyboard engine (planned)** — the surface you spend the most time on; one named storyboard per cue with bar-aligned cuts.
2. **Engine** — the compositor where you stack fog, hands, and water clips per cue.
3. **Presets (anchor map)** — you assign one anchor per cue and the visual language follows the cue's emotional arc.
4. **Recorder** — you record one WebM per cue for the temp reel.
5. **/api/projects + auth** — you log in via magic-link and save each cue as a named project so the director can reload the storyboard on their laptop.
6. **Audio analysis v2** — you read the chromagram of each cue and align the bar grid to the cue's downbeat.

## A typical session (90-180 minutes)
1. You open /auth/login, the magic-link arrives, you land at /engine.
2. You drop the cue-violin-solo audio, audio-analysis v2 returns BPM=68, key=D major, chromagram weighted on D, F#, A.
3. You run the storyboard pipeline; the bar-aligned cuts land on the 8-bar phrase boundaries.
4. You assign the `gallery` preset at warmth=0.5, intensity=0.4 because the chromagram's D/F#/A weight reads as warm.
5. You stack three clips: `c01-fog.jpg`, `c02-violin-hands.mp4`, `c03-water-light.mp4`.
6. You record a 30-second WebM via MediaRecorder for the temp reel.
7. You save the storyboard as a project named `film-01-cue-violin-solo` via POST /api/projects.
8. You ship the WebM to the director and reload the project on their laptop to walk them through the cuts.
9. You almost quit at step 5 — the auto-picker's first shot for the violin solo was a clip of streetlamps, which is wrong for the cue. You almost kept it before remembering you came here to override the auto-picker.

## What they'd pay for
You would pay $10/month for unlimited project saves and per-project version history (so you can keep the first pass and the director's-note pass as separate versions). You would not pay for cloud rendering.

## What would make them leave
You would leave forever if the storyboard engine started hiding the auto-picker's logic behind a "trust the AI" button, because the override workflow is the work. You would tolerate the magic-link delay forever — you have a spotting session to attend.

## Quote
"The storyboard engine saves one named project per cue, the magic-link login lets the director reload on their laptop, and the audio-analysis chromagram is the only reason the bar grid matches the cue's downbeat."
