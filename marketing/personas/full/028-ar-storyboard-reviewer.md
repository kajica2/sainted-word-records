# The AR Storyboard Reviewer

**Slug:** ar-storyboard-reviewer
**Surfaces touched (3+ minimum):** AR, storyboard, recorder, auth, presets
**One-line:** A film director who reviews the composer's storyboard as a markerless AR loop in the spotting session and records the AR scene as a WebM for the studio's archive.

## Who they are
You are a film director in your mid-fifties who has been directing features for twenty-five years and who has started using visuals in spotting sessions because the composer wants to see the cue rendered before the orchestra is booked. You are not a coder and you have never opened After Effects. Your toolbelt is a spotting notebook, a folder of reference frames, and a willingness to learn one new tool per film if it survives pre-production.

## What you're trying to do
You want to log in via magic-link, reload the composer's saved storyboard (one per cue sheet), and drop the storyboard's WebM into /ar-loop on your phone so you can walk around the cue in the spotting session. You record the AR scene as a 5-second WebM via the AR scene's built-in recorder and ship it to the studio's archive so the producer can see what you saw.

## Which surfaces they actually use, and why
1. **/ar-loop** — the entry point; the composer's storyboard WebM floats in the spotting room.
2. **Storyboard engine (planned)** — the composer's bar-aligned cuts render in the AR scene.
3. **Recorder** — the AR scene records its own 5-second WebM, which you ship to the studio's archive.
4. **/api/projects + magic-link auth** — you log in via magic-link and reload the composer's saved storyboard on your phone.
5. **Presets** — the composer's per-cue anchors (`void` for the opening, `gallery` for the violin solo) render in the AR scene.

## A typical session (90-180 minutes)
1. You open /auth/login on your phone, the magic-link arrives, you land at /engine.
2. You reload the composer's saved project `film-01-cue-violin-solo` via GET /api/projects.
3. The storyboard renders, the `gallery` preset (warmth 0.5, intensity 0.4) applies, the chromagram's D/F#/A weight reads as warm.
4. You drop the storyboard's WebM into /ar-loop on your phone; the AR scene loads and the loop floats in the spotting room.
5. You walk around the loop, the bar-aligned cuts land on the 8-bar phrase boundaries.
6. You record a 5-second WebM of the AR scene via the AR scene's built-in recorder.
7. You ship the WebM to the studio's archive.
8. You almost quit at step 1 — the magic-link almost failed because the studio's email gateway delayed it. You almost gave up before the email arrived 20 seconds later.

## What they'd pay for
You would pay $20/month per film for unlimited project reloads and per-project version history (so you can compare the first spotting pass and the second). You would not pay per cue.

## What would make them leave
You would leave forever if /ar-loop required a login to view, because the studio's firewall does not support OAuth. You would tolerate the 5-second AR record limit forever — it is enough for a take-home.

## Quote
"The composer's storyboard engine saves one named project per cue, the magic-link login lets me reload on my phone, and the /ar-loop share link is the only reason I can walk around the cue in the spotting room."
