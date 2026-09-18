# The Film Composer

**Slug:** film-composer
**Surfaces:** storyboard, library, auth, presets, audio-analysis, engine
**One-line:** A film composer who saves a storyboard per cue sheet via the magic-link login and reloads the bar-aligned cuts on every spotting session.

## Who they are

You have scored fourteen features and you treat every cue sheet as a small film. You work in Logic; the spotting notebook is a separate object you carry in a leather folio. You have started using the engine for the temp music video the director wants to see before the orchestra is booked — the temp reel is no longer a stack of reference clips and a tempo chart; it is a storyboard the director can walk through on the spotting room laptop. You deliver a temp cut the same day the director calls. Same-day delivery is your reputation.

## What they're trying to do

You want to drop a friend's short film cue into the engine, run the storyboard pipeline, and save one named storyboard per cue (`cue-01-opening`, `cue-02-stalk`, `cue-03-violin-solo`, `cue-04-chase`, `cue-05-resolution`) via the magic-link login. Each storyboard's bar-aligned cuts match the cue sheet's spotting notes. When the director calls with a note on cue 03, you reload the project from the API and re-cut the second chorus's shots on the same laptop you used to author them.

## The surfaces they live in

1. **The storyboard engine** is the surface you spend the most time on. One named storyboard per cue, bar-aligned cuts that match the spotting notes — that is the contract between you and the director, and the contract is the only reason the temp reel survives pre-production.
2. **The library** holds ninety clips of fog, hands, water, and streetlamps you shot for the film's temp reel, tagged by mood. The tags are what the ShotPicker reads; the ShotPicker is what the director sees first.
3. **`/api/projects` with magic-link auth** is the round-trip. You log in via magic-link, save each cue as a named project, reload across spotting sessions. The login is a single email; the project saves under the cue's name.
4. **The presets** give you one anchor per cue: `void` (warmth 0.1, intensity 0.85) for `cue-01-opening`, `pulse` (warmth 0.3, intensity 0.7) for `cue-02-stalk`, `gallery` (warmth 0.5, intensity 0.4) for `cue-03-violin-solo`. The mapping is in your spotting notebook.
5. **Audio analysis v2** gives you the chromagram of each cue, and the chromagram is what you align the bar grid to. The grid matches the downbeat or the grid is wrong.
6. **`/engine`** is the compositor where you stack the fog/hands/water clips per cue.

## A typical session (90–180 minutes)

You open `/auth/login`. The magic-link arrives. You land at `/engine`. You drop the cue-03 audio (the violin solo). Audio analysis v2 returns BPM 68, key D major, chromagram weighted on D, F#, A.

You run the storyboard pipeline; the bar-aligned cuts land on the eight-bar phrase boundaries. You assign the `gallery` preset at warmth 0.5, intensity 0.4 to the cue because the chromagram's D/F#/A weight reads as warm. You stack three clips: `c01-fog.jpg`, `c02-violin-hands.mp4`, `c03-water-light.mp4`. You save the storyboard as a project named `cue-03-violin-solo` via `POST /api/projects`.

You reload the project on the director's laptop via `GET /api/projects` and the bar-aligned cuts render identically. The director asks for a slower cut at the modulation to B minor at bar 32; you re-pick the ShotPicker output for bars 32–48 by hand. You save the updated storyboard. The API responds 200.

There is a moment, around the modulation to B minor, when the auto-picker's first shot for bars 32–48 is a clip of streetlamps, which is wrong for the modulation. You almost kept it before remembering you came here to override the auto-picker, not to accept it.

## What they'd pay for

$10/month for unlimited project saves and a per-project version history — so you can keep the first pass and the director's-note pass as separate versions. You would not pay for cloud rendering; you have the Logic pipeline and a faster laptop than any serverless function would give you.

## What would make them leave

The storyboard engine starting to hide the auto-picker's logic. The override workflow is the work; you came here to disagree with the auto-picker and ship your disagreement as a director's cut. You would also leave if the magic-link login ever switched to OAuth; the director's laptop is a stranger's laptop and OAuth on a stranger's laptop is a non-starter.

## Quote

"The storyboard engine saves one named project per cue, the magic-link login lets me reload on the director's laptop, and the audio-analysis chromagram is the only reason the bar grid matches the cue's downbeat."