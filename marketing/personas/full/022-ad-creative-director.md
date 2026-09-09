# The Ad Agency Creative Director

**Slug:** ad-creative-director
**Surfaces touched (3+ minimum):** presets, transitions, engine, auth, versions, library
**One-line:** An ad agency creative director who authors three anchor-locked variants per brief, fires `flash-cover` between them, and ships client review links via the magic-link login.

## Who they are
You are a creative director at a mid-size ad agency in your mid-forties who has been directing campaigns for twenty years and who has started using the engine for client review because the agency's traditional review tool is slow. You are not a coder and you have never opened After Effects. Your toolbelt is a folder of brand books, a stack of client brief decks, and a willingness to learn one new tool per year if it survives the agency's procurement process.

## What you're trying to do
You want to drop the client's jingle into /engine, author three anchor-locked variants per brief (`kraft` for the safe take, `phosphor` for the modern take, `void` for the edgy take), fire `flash-cover` transitions between them, and record three WebMs via MediaRecorder. You log in via magic-link, save each take as a project named after the client and the brief (`client-acme-brief-2026-09-take-01`), and share the project via the magic-link-protected review link so the client can comment without an account.

## Which surfaces they actually use, and why
1. **Presets (anchor map)** — you assign one of the 19 anchors per take; `kraft`, `phosphor`, and `void` are the three the client usually picks from.
2. **Transitions** — `flash-cover` between takes so the client sees the shift, not a hard cut.
3. **Engine** — the compositor where you stack the client's brand stills behind the jingle.
4. **/api/projects + magic-link auth** — you save each take as a named project and share the project link with the client.
5. **Versions** — you lock the variant per take via the version pages (`/versions/kraft.html`, `/versions/phosphor.html`, `/versions/void.html`).
6. **Library** — your library is the client's brand stills, tagged by usage rights.

## A typical session (90-180 minutes)
1. You open /engine, drop the client's jingle, audio-analysis v2 returns BPM=120, key=G major.
2. You lock /versions/kraft.html, push `sepia=0.5`, `grain=0.4` (warm, safe).
3. You lock /versions/phosphor.html, push `glow=0.5`, `bloom=0.4` (cool, modern).
4. You lock /versions/void.html, push `chroma=0.6`, `posterize=4` (cold, edgy).
5. You fire `flash-cover` between the three takes; the transition resolves at 500ms.
6. You record three 30-second WebMs via MediaRecorder.
7. You log in via magic-link, save each take as a named project via POST /api/projects.
8. You share the project links with the client; the client comments without an account.
9. You almost quit at step 7 — the magic-link almost failed because the agency's email gateway delayed it. You almost gave up before the email arrived 18 seconds later.

## What they'd pay for
You would pay $50/month per client for unlimited project saves and per-project version history (so you can keep the first pass and the client's note pass as separate versions). You would not pay per take.

## What would make them leave
You would leave forever if the magic-link flow dropped in favor of OAuth, because the client's procurement process does not support OAuth. You would tolerate the magic-link delay forever — you have a client call to attend.

## Quote
"The /versions/kraft.html safe take and the /versions/void.html edgy take are the client's choice, and the magic-link review link is the only reason the client can comment without an account."
