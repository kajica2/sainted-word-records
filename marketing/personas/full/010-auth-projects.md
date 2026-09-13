# The Magic-Link Project Saver

**Slug:** auth-projects
**Surfaces touched (3+ minimum):** projects/auth, engine, presets, storyboard, recorder
**One-line:** A touring band's visualist who saves 30 named storyboards per tour via the magic-link login and never trusts a browser session.

## Who they are
You are a touring band's visualist in your early thirties who has been on the road for six years with two different indie bands and who treats every show as its own small film. You have a laptop, a hard drive of tour footage, and a deep distrust of any tool that asks you to make an account with a password. Your toolbelt is QLab, a folder of tour footage, and the willingness to log in via magic-link every time because passwords are a liability on the road.

## What they're trying to do
You want to log in via the magic-link flow at /auth/login, save every storyboard you build for the tour as a named project (`tour-2026-spring-03-14-lyric-set`), and reload the project from the API on the next laptop you sit down at. You do not want to download files — you want to re-render from the saved state on whatever machine is in front of you. When the tour is over, you export the storyboards as WebMs via MediaRecorder and ship them to the band's archive.

## Which surfaces they actually use, and why
1. **/api/projects + magic-link auth** — the surface you spend the most time on; you save and reload storyboards across laptops via the magic-link login.
2. **Engine** — you load each show's tour footage into the engine's layers and pick the per-show variant.
3. **Presets** — you lock the visual language per tour leg (`tour-2026-spring` uses `tape`, `tour-2026-fall` uses `hallucination`) so the band's identity is consistent across dates.
4. **Storyboard engine (planned)** — you save the per-song storyboard as a project so the next laptop reloads the same bar-aligned cuts.
5. **Recorder** — you record a final WebM per show and upload to the band's archive.

## A typical session (90-180 minutes)
1. You open /auth/login on the venue's laptop, type your email, the magic-link arrives in 14 seconds, you click it and land at /engine.
2. You drag today's tour footage (three clips from soundcheck) into the engine's layers.
3. You lock the variant at /versions/tape.html because the tour leg is `tour-2026-spring` and the visual language is `tape`.
4. You run the storyboard engine on the setlist track, the bar-aligned cuts land on the breath.
5. You save the storyboard as a project named `tour-2026-spring-03-14-lyric-set` via POST /api/projects, the API responds 200 with project id `p_8x7a`.
6. You reload the project via GET /api/projects on the next laptop (the bus's MacBook) and confirm the storyboard renders identically.
7. You record the WebM via MediaRecorder for tonight's show, the file lands on the bus's hard drive.
8. You almost quit at step 1 — the venue's laptop had a corporate email gateway that almost delayed the magic-link by 20 minutes. You almost switched to a guest account before the email arrived.

## What they'd pay for
You would pay $5/month per band for unlimited project saves and a 30-day TTL on the magic-link session (currently 30 days is the default — you would pay for the same TTL but per-band). You would not pay per project.

## What would make them leave
You would leave forever if /api/projects dropped the magic-link flow in favor of OAuth, because OAuth on a venue's locked-down laptop is a non-starter. You would tolerate the 20-minute magic-link delay forever — you have a soundcheck to set up while you wait.

## Quote
"The magic-link login and the /api/projects POST are the only reason I can reload a storyboard on the venue's laptop without worrying about passwords, which is the only reason I save storyboards at all."
