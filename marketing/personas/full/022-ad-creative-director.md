# The Ad Agency Creative Director

**Slug:** ad-creative-director
**Surfaces:** presets, transitions, engine, auth, versions, library
**One-line:** An ad agency creative director who authors three anchor-locked variants per brief, fires `flash-cover` between them, and ships client review links via the magic-link login.

## Who they are

You have been directing campaigns for twenty years and you have started using the engine for client review because the agency's traditional review tool is slow in the way that twenty-year-old review tools are slow. You are not a coder and you have never opened After Effects. A folder of brand books is home. A stack of client brief decks is the queue. You learn one new tool per year if it survives the agency's procurement process, and procurement is not generous.

## What they're trying to do

You want to drop the client's jingle into `/engine`, author three anchor-locked variants per brief (`kraft` for the safe take, `phosphor` for the modern take, `void` for the edgy take), fire `flash-cover` transitions between them, and record three WebMs via MediaRecorder. You log in via magic-link, save each take as a project named after the client and the brief (`client-acme-brief-2026-09-take-01`), and share the project via the magic-link-protected review link so the client can comment without an account. The account is the agency's; the client gets a comment thread and a vote.

## The surfaces they live in

1. **The anchor map** is where you assign one of the nineteen anchors per take. `kraft`, `phosphor`, and `void` are the three the client usually picks from; the other sixteen are too loud, too cold, or too warm.
2. **The transitions** carry the choice between takes. `flash-cover` between takes so the client sees the shift, not a hard cut.
3. **`/engine`** is the compositor where you stack the client's brand stills behind the jingle.
4. **`/api/projects` with magic-link auth** is where each take saves as a named project and where the share link lives. The link is the deliverable.
5. **The `/versions/` pages** are where you lock the variant per take — `/versions/kraft.html`, `/versions/phosphor.html`, `/versions/void.html`.
6. **The library** holds the client's brand stills, tagged by usage rights.

## A typical session (90–180 minutes)

You open `/engine` and drop the client's jingle. Audio analysis v2 returns BPM 120, key G major. You lock `/versions/kraft.html`, push `sepia=0.5`, `grain=0.4` — warm, safe, the take the procurement committee always wants to see first.

You lock `/versions/phosphor.html`, push `glow=0.5`, `bloom=0.4` — cool, modern, the take the creative director actually wants to win. You lock `/versions/void.html`, push `chroma=0.6`, `posterize=4` — cold, edgy, the take the client will not pick but the one the agency should win an award with.

You fire `flash-cover` between the three takes; the transition resolves at 500 ms. You record three thirty-second WebMs via MediaRecorder. You log in via magic-link, save each take as a named project via `POST /api/projects`. You share the project links with the client; the client comments without an account.

There is a moment, around the magic-link, when the agency's email gateway delays it. You almost gave up before the email arrived eighteen seconds later. You almost went back to the slow review tool. Then you remembered the slow review tool was the reason you started using the engine.

## What they'd pay for

$50/month per client for unlimited project saves and per-project version history — so you can keep the first pass and the client's note pass as separate versions. You would not pay per take; per-take pricing would punish you for sending three takes per brief and three takes is what survives the client's first reaction.

## What would make them leave

The magic-link flow dropping in favor of OAuth. The client's procurement process does not support OAuth; OAuth on a client's laptop is a non-starter; the agency's enterprise SSO does not talk to the engine's OAuth. You would also leave if the share link ever required the client to log in to comment — the comment thread is the deliverable, and a logged-in comment thread is a comment thread the client will not use.

## Quote

"The /versions/kraft.html safe take and the /versions/void.html edgy take are the client's choice, and the magic-link review link is the only reason the client can comment without an account."