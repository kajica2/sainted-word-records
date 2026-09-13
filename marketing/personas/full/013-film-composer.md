# The Film Composer

**Slug:** film-composer
**Surfaces touched (3+ minimum):** storyboard, library, auth, presets, audio-analysis, engine
**One-line:** A film composer who saves a storyboard per cue sheet via the magic-link login and reloads the bar-aligned cuts on every spotting session.

## Who they are
You are a film composer in your late forties who has scored 14 features and who treats every cue sheet as a small film. You work in Logic and you have started using the engine for the temp music video the director wants to see before the orchestra is booked. Your toolbelt is Logic, a spotting notebook, and a willingness to deliver a temp cut the same day the director calls.

## What they're trying to do
You want to drop a friend's short film cue into the engine, run the storyboard pipeline, and save one named storyboard per cue (`cue-01-opening`, `cue-02-stalk`, `cue-03-violin-solo`, `cue-04-chase`, `cue-05-resolution`) via the magic-link login. Each storyboard's bar-aligned cuts match the cue sheet's spotting notes. When the director calls with a note on cue 03, you reload the project from the API and re-cut the second chorus's shots on the same laptop you used to author them.

## Which surfaces they actually use, and why
1. **Storyboard engine (planned)** — the surface you spend the most time on; one named storyboard per cue, bar-aligned cuts.
2. **Library** — your library is 90 clips of fog, hands, water, and streetlamps you shot for the film's temp reel, tagged by mood.
3. **/api/projects + magic-link auth** — you log in via magic-link, save each cue as a named project, reload across spotting sessions.
4. **Presets** — you assign one anchor per cue: `void` (warmth 0.1, intensity 0.85) for `cue-01-opening`, `pulse` (warmth 0.3, intensity 0.7) for `cue-02-stalk`, `gallery` (warmth 0.5, intensity 0.4) for `cue-03-violin-solo`.
5. **Audio analysis v2** — you read the chromagram of each cue and align the bar grid to the cue's downbeat.
6. **Engine** — the compositor where you stack the fog/hands/water clips per cue.

## A typical session (90-180 minutes)
1. You open /auth/login, the magic-link arrives, you land at /engine.
2. You drop the cue-03 audio (the violin solo), audio-analysis v2 returns BPM=68, key=D major, chromagram weighted on D, F#, A.
3. You run the storyboard pipeline; the bar-aligned cuts land on the 8-bar phrase boundaries.
4. You assign the `gallery` preset at warmth=0.5, intensity=0.4 to the cue because the chromagram's D/F#/A weight reads as warm.
5. You stack three clips: `c01-fog.jpg`, `c02-violin-hands.mp4`, `c03-water-light.mp4`.
6. You save the storyboard as a project named `cue-03-violin-solo` via POST /api/projects.
7. You reload the project on the director's laptop via GET /api/projects and the bar-aligned cuts render identically.
8. The director asks for a slower cut at the modulation to B minor at bar 32; you re-pick the ShotPicker output for bars 32-48 by hand.
9. You save the updated storyboard; the API responds 200.
10. You almost quit at step 8 — the auto-picker's first shot for bars 32-48 was a clip of streetlamps, which is wrong for the modulation to B minor. You almost kept it before remembering you came here to override.

## What they'd pay for
You would pay $10/month for unlimited project saves and a per-project version history (so you can keep the first pass and the director's-note pass as separate versions). You would not pay for cloud rendering.

## What would make them leave
You would leave forever if the storyboard engine started hiding the auto-picker's logic, because the override workflow is the work. You would tolerate the magic-link delay forever — you have a spotting session to attend.

## Quote
"The storyboard engine saves one named project per cue, the magic-link login lets me reload on the director's laptop, and the audio-analysis chromagram is the only reason the bar grid matches the cue's downbeat."
