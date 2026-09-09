# The Storyboard-First Editor

**Slug:** storyboard-editor
**Surfaces touched (3+ minimum):** storyboard, library, audio-analysis, presets, auth
**One-line:** A music video editor who treats bar-aligned auto-edits as a starting point and re-cuts the first chorus by hand.

## Who they are
You are a freelance music video editor in your early thirties who came up cutting TV promos before streaming killed the format. You work in Premiere and DaVinci Resolve for paying clients, but you also keep a personal project for bands you like, where you can be slower. Your toolbelt is Resolve's color page, a notebook of timing notes, and a long-running habit of breaking songs into 4- and 8-bar chunks before you cut.

## What they're trying to do
You want to drop an unreleased track from a friend into the storyboard engine, watch it auto-segment into intro/verse/pre-chorus/chorus/bridge/outro with bar-aligned cuts, then override the second chorus's shots because the auto-picker chose a library asset that did not match the singer's intent. The first chorus you keep; the second you re-cut by hand on the scene list. You save the resulting Storyboard JSON to your account so you can come back next week and re-cut the bridge when the band sends a revised mix.

## Which surfaces they actually use, and why
1. **Storyboard engine (planned)** — the entry point; the 8-phase pipeline that turns audio + library into a bar-aligned Storyboard is exactly the first pass you used to do in your notebook.
2. **Library** — your library is 60 short clips you shot on a Bolex, tagged by mood (tense, tender, restless) so the shot-picker's mood match has something real to choose from.
3. **Audio analysis v2** — you read the BPM, key, and chromagram the engine surfaces before you override anything; if the auto-picker's key estimate disagrees with what you hear, that is a signal something is wrong upstream.
4. **Presets (anchor map)** — you pick the per-scene FX preset by hovering the anchor map; you keep the chorus on `void` (warmth 0.1, intensity 0.85) and the verses on `kraft` (warmth 0.7, intensity 0.3) so the visual arc tracks the emotional arc.
5. **/api/projects + auth** — you log in with the magic-link flow, save the Storyboard JSON as a project named after the song, and reload it across sessions.

## A typical session (90-180 minutes)
1. You log in via /auth/login, the magic-link email arrives in 12 seconds, you click and land back at /engine.
2. You drag the friend's unreleased MP3 into the engine; audio-analysis-v2 returns BPM=84, key=F# minor, confidence=0.71, chromagram heavily weighted on F# and A.
3. The storyboard pipeline runs while you read the auto-segment: intro (bars 1-8), verse A (bars 9-24), pre-chorus (25-32), chorus (33-48), verse A' (49-64), chorus (65-80), bridge (81-96), outro (97-104).
4. You open the ShotPicker log and see the second chorus was assigned three library clips with motion="fast" — you swap them by hand for three slower clips tagged motion="slow", because the band wants the second chorus to feel like it is exhaling.
5. You change the chorus FX preset from the auto-picked `pulse` to `void` via the anchor map, dragging the cursor to warmth=0.1, intensity=0.85.
6. You preview the result: the cuts land on bar 33 (chorus entry) and bar 49 (verse A' entry), the transition between them is `glitch-block` for the chorus hit and `whip-blur` for the verse reset.
7. You save the Storyboard as a project named "Friend — Track 03 — first cut", the API responds 200 with the project id.
8. You almost quit at step 4 — the auto-picker's first shot for the second chorus was a clip of city traffic, which is a fine clip but not what the song is asking for. You almost left the storyboard as-is before remembering you came here to override the auto-picker, not to accept it.

## What they'd pay for
You would pay for unlimited project saves and the ability to fork a project (so you can keep the auto-picker's first pass alongside your hand-edited second pass). You would not pay for cloud rendering — your laptop is faster than a serverless function and you trust your local export pipeline.

## What would make them leave
You would leave forever if the storyboard engine started hiding the auto-picker's logic behind a "trust the AI" button, because the override workflow is the whole reason you came. You would tolerate the deterministic seed forever — same song, same library, same seed, same storyboard — because that is what makes iteration possible.

## Quote
"The storyboard engine's second chorus was wrong about my friend's song, but the BPM and key detection told me exactly where it went wrong, which is the whole reason I use /api/projects to save the override."
