# The Storyboard-First Editor

**Slug:** storyboard-editor
**Surfaces:** storyboard, library, audio-analysis, presets, auth
**One-line:** A music video editor who treats bar-aligned auto-edits as a starting point and re-cuts the first chorus by hand.

## Who they are

You cut TV promos for a living, or you used to — streaming killed the format and you moved into music videos before the dust settled. Resolve's color page is home. You keep a personal project for bands you like, where the deadlines are slower and the cuts can think. You still carry a notebook of timing notes from the promos days, and you still break songs into four- and eight-bar chunks before you touch the timeline.

## What they're trying to do

You want to drop an unreleased track from a friend into the storyboard engine, watch it auto-segment into intro, verse, pre-chorus, chorus, bridge, outro with bar-aligned cuts, and then override the second chorus by hand because the auto-picker chose a library clip that did not match the singer's intent. You keep the first chorus as the auto-picker gave it to you. You re-cut the second on the scene list. You save the resulting Storyboard JSON as a named project so you can come back next week and re-cut the bridge when the band sends a revised mix.

## The surfaces they live in

1. **The storyboard engine** is the entry point. The eight-phase pipeline that turns audio and library into a bar-aligned Storyboard is exactly the first pass you used to do in your notebook, only now it is faster and the second pass is also faster.
2. **The library** holds sixty short clips you shot on a Bolex, tagged by mood — tense, tender, restless — so the shot-picker's mood match has something real to choose from.
3. **Audio analysis v2** surfaces BPM, key, and chromagram before you override anything. If the auto-picker's key estimate disagrees with what you hear, that is a signal something is wrong upstream, and you want to know.
4. **The anchor map** is where you pick the per-scene FX preset. The chorus stays on `void` (warmth 0.1, intensity 0.85); the verses stay on `kraft` (warmth 0.7, intensity 0.3). The visual arc tracks the emotional arc, which is the whole point.
5. **`/api/projects` with magic-link auth** is where the Storyboard JSON lives between sessions. The login is a single email link; the project saves under the song's name.

## A typical session (90–180 minutes)

You open `/auth/login`, type your email, the magic-link arrives in twelve seconds, you click through and land at `/engine`. You drag the friend's unreleased MP3 onto the canvas. Audio analysis v2 returns BPM 84, key F# minor, confidence 0.71, chromagram weighted heavily on F# and A.

The storyboard pipeline runs while you read the auto-segment: intro (bars 1–8), verse A (9–24), pre-chorus (25–32), chorus (33–48), verse A' (49–64), chorus (65–80), bridge (81–96), outro (97–104). You open the ShotPicker log and see the second chorus was assigned three library clips with motion = `fast`. You swap them by hand for three slower clips tagged `slow`, because the band wants the second chorus to feel like it is exhaling.

You change the chorus FX preset from the auto-picked `pulse` to `void` by dragging the cursor on the anchor map to warmth 0.1, intensity 0.85. You preview: the cuts land on bar 33 (chorus entry) and bar 49 (verse A' entry); the transition between them is `glitch-block` on the chorus hit and `whip-blur` on the verse reset. You save the Storyboard as `Friend — Track 03 — first cut`. The API responds 200 with a project id.

There is a moment, around the second chorus, where you almost accept the auto-picker's first take. The city traffic clip is a fine clip, just not what the song is asking for. You almost left the storyboard as-is before remembering you came here to override the auto-picker, not to accept it.

## What they'd pay for

Unlimited project saves and the ability to fork a project — so you can keep the auto-picker's first pass alongside your hand-edited second pass. You would not pay for cloud rendering; your laptop is faster than a serverless function and you trust your local export pipeline more than you trust anyone else's.

## What would make them leave

A "trust the AI" button that hides the auto-picker's logic. The override workflow is the whole reason you came. You would also leave if the deterministic seed changed — same song, same library, same seed, same storyboard is what makes iteration possible, and you would not trade that for any feature.

## Quote

"The storyboard engine's second chorus was wrong about my friend's song, but the BPM and key detection told me exactly where it went wrong, which is the whole reason I use /api/projects to save the override."