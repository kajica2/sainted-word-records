# The Magic-Link Project Saver

**Slug:** auth-projects
**Surfaces:** projects/auth, engine, presets, storyboard, recorder
**One-line:** A touring band's visualist who saves 30 named storyboards per tour via the magic-link login and never trusts a browser session.

## Who they are

You have been on the road for six years with two different indie bands and you treat every show as its own small film. The bus has a MacBook; the venue has a laptop that may or may not be locked down; your own laptop is in a pelican case in the overhead bin. You use QLab for the audio playback and you have a deep distrust of any tool that asks you to make an account with a password. Passwords are a liability on the road. Magic links are not.

## What they're trying to do

You want to log in via the magic-link flow at `/auth/login`, save every storyboard you build for the tour as a named project (`tour-2026-spring-03-14-lyric-set`), and reload the project from the API on the next laptop you sit down at. You do not want to download files; you want to re-render from the saved state on whatever machine is in front of you. When the tour is over, you export the storyboards as WebMs via MediaRecorder and ship them to the band's archive.

## The surfaces they live in

1. **`/api/projects` with magic-link auth** is where the work lives between sessions. You save and reload storyboards across laptops without ever typing a password, which is the only reason you save at all.
2. **`/engine`** is where you load each show's tour footage into the layers and pick the per-show variant.
3. **The presets** lock the visual language per tour leg — `tour-2026-spring` uses `tape`, `tour-2026-fall` uses `hallucination` — so the band's identity is consistent across dates even when the venue's projector is wildly different.
4. **The storyboard engine** saves the per-song storyboard as a project so the next laptop reloads the same bar-aligned cuts. The saves are the point; the rendering is downstream.
5. **The recorder** captures the final WebM per show, which lands on the bus's hard drive and gets uploaded to the band's archive at the end of the leg.

## A typical session (90–180 minutes)

You open `/auth/login` on the venue's laptop and type your email. The magic-link arrives in fourteen seconds — sometimes longer, depending on the venue's email gateway. You click the link and land at `/engine`. You drag today's tour footage (three clips from soundcheck) into the engine's layers.

You lock the variant at `/versions/tape.html` because the tour leg is `tour-2026-spring` and the visual language is `tape`. You run the storyboard engine on the setlist track; the bar-aligned cuts land on the breath. You save the storyboard as a project named `tour-2026-spring-03-14-lyric-set` via `POST /api/projects`; the API responds 200 with project id `p_8x7a`.

You reload the project via `GET /api/projects` on the next laptop — the bus's MacBook — and confirm the storyboard renders identically. You record the WebM via MediaRecorder for tonight's show; the file lands on the bus's hard drive. You close the venue's laptop without signing out, because there is nothing to sign out of.

There is a moment, around the magic-link email, when the venue's corporate gateway almost delays it by twenty minutes. You almost switched to a guest account — meaning no account at all, meaning no saves. Then the email arrived and you remembered why the magic-link is the right answer for touring: it survives the venue's IT department.

## What they'd pay for

$5/month per band for unlimited project saves and a 30-day TTL on the magic-link session — the default TTL is already 30 days, so you would pay the same number but per-band rather than per-account. You would not pay per project; the marginal cost of saving one more storyboard is zero and you would not pretend otherwise.

## What would make them leave

`/api/projects` dropping the magic-link flow in favor of OAuth. OAuth on a venue's locked-down laptop is a non-starter — corporate gateways block the OAuth providers regularly and the redirect URL never resolves cleanly. You would also leave if the magic-link TTL dropped below seven days; the tour schedule is unpredictable and you cannot always log in within twenty-four hours.

## Quote

"The magic-link login and the /api/projects POST are the only reason I can reload a storyboard on the venue's laptop without worrying about passwords, which is the only reason I save storyboards at all."