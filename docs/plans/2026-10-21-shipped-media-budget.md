# Shipped-media budget — plan

**Date:** 2026-10-21
**Status:** plan + tooling landed; the media itself is awaiting a go-ahead (slice 2+)
**Why now:** the CI build-size gate went over. `main` measured 154.8M on 2026-10-19 (a
155M ceiling) and 173.1M on 2026-10-21 — an 18M drift that nobody saw, because the gate
only runs on pull requests and the drift was spread across media directories.

## What the build actually ships

Measured on the 2026-10-21 build (`dist/` = 173.1M in CI):

| shipped media | MB | notes |
|---|---:|---|
| audios | 39.9 | 28 mp3 — 7 "slip-set" tracks are 3–11M each; the 19 variant demo tracks are already 128 kbps |
| packs | 39.6 | 582 files — already shrunk once (896/q50 webp, 2026-10-19) |
| videos | 30.3 | 19 files — 1024×574 clips at **2.3 Mbps** |
| portfolio | 14.6 | 11 files — one 832×464 clip at **5.5 Mbps** |
| keyart | 9.4 | 58 files |
| gallery-vintage | 8.1 | 57 files |
| docs/atlas-assets | 5.0 | 26 files |
| verify-screenshots | 4.4 | 13 PNGs — these are the version gallery's thumbnails, not junk |
| shop-designs | 2.7 | 24 files |
| default-library | 1.2 | the engine's 7 default textures — load-bearing |
| press / icons / media | 0.8 | |
| **media total** | **156.2** | of a 173.1M build |
| code, pages, fonts, docs | 16.9 | |

Separately, the **git pack is 446 MiB** — the repo carries 190.9M of tracked media
(`audios` 39.9, `packs` 39.5, `videos` 30.3, `assets` 21.3, `portfolio` 14.6,
`photo-art-bw` 11.2, `keyart` 9.4, `gallery-vintage` 8.1, `promo` 5.8, `docs` 5.0 …),
all of it tracked. `assets/`, `promo/`, `photo-art-bw/` and `screenshots/` do **not**
ship — they are source material that only bloats the clone. 27 duplicate groups
(42 redundant files, 3.6M) are tracked, including a 1.6M `test-dancefloor.png` beside
the real `dancefloor-loop.png`.

## The finding

**The shipped media is encoded far above delivery quality.** A browser cannot show the
difference, but the deploy pays for it on every request:

| file | source | measured | at a delivery cap |
|---|---|---|---|
| `videos/stage-take-2026-09-29.mp4` | 1024×574 @ 2.3 Mbps | 11.8M | 5.7M (-51%) |
| `portfolio/portfolio-morning-haunt-v2.mp4` | 832×464 @ 5.5 Mbps | 3.3M | 0.5M (-83%) |
| `audios/slip-sets-1/slip-03-bebop-in-f-long.mp3` | 320 kbps | 11.0M | 7.3M (-33%) |
| `packs/audio-loops/tribalismo.mp3` | 320 kbps | 5.7M | 3.7M (-34%) |

A CRF pass is the wrong tool: CRF 28 on `videos/meadow.mp4` (896 kbps source) produced a
**larger** file (4.1M → 4.7M). The rule that works is a bitrate cap with "never make it
bigger" as a hard floor.

## The slices

### Slice 1 — make the growth visible (code only) ✅ in this PR

- `scripts/media-budget.mjs` — a per-directory budget for the shipped media, measured
  the way CI measures the build. It names the offender, which the single global budget
  cannot. Wired into the CI after the build.
- `scripts/media-optimize.mjs` — the re-encoder. Dry run by default; `--apply` writes.
  Per-file bitrate cap (video 1000 kbps + AAC 128k, audio 128 kbps), in place, same
  filename and extension so no page, manifest or URL changes. It refuses any output
  that is larger, or that drifts in duration or dimensions.

### Slice 2 — re-encode the shipped video and audio (~32M) ⏳ needs a go-ahead

`node scripts/media-optimize.mjs --apply` over `videos/`, `portfolio/`, `promo/`,
`audios/`, `packs/audio-loops/`. Same paths, same names, smaller files.

**This is the slice that touches the artist's own work**, so it is a go/no-go, not a
mechanical step. Before it runs: play the affected files and look at them.

### Slice 3 — PNG → webp for the image media (~15M) ⏳

`keyart` 9.4M, `gallery-vintage` 8.1M, `verify-screenshots` 4.4M, `shop-designs` 2.7M,
`docs/atlas-assets` 5.0M. Needs the referencing pages updated (the gallery, the landing
page and engine-demos point at `verify-screenshots/*.png`).

### Slice 4 — the packs, second pass (~15–20M) ⏳

`packs/` was already shrunk once (896/q50, 2026-10-19). 582 files at 39.6M: either a
second pass (768/q60) or fewer, better-chosen files per pack. The packs are product
content — the choice of which photos to keep is not a build decision.

### Slice 5 — stop shipping what the deploy does not need ⏳

`assets/` (21.3M), `promo/` (5.8M), `photo-art-bw/` (11.2M) and `screenshots/` (1.2M)
are tracked but never shipped. They still cost a full clone in every CI run and every
Vercel build. Moving them out of git (or into a release bucket the build pulls from)
takes ~40M off the clone without touching the site.

### Slice 6 — the bulk behind the media store (structural) ⏳

The repo already has `api/storage/` (signed upload/download) and
`lib/media-store.client.js`. Serving `audios/` and `packs/` from the bucket at runtime
instead of shipping them takes the deploy to code-plus-pages size (~17M) and makes the
media budget a non-issue. This is the real fix; slices 2–4 are the cheap path to it.

### Slice 7 — git history hygiene (Kai's call) ⏳

The pack is 446 MiB because old versions of the re-encoded media are still in history.
`git gc --aggressive` is safe and free; dropping the old blobs from history is a
rewrite (`git filter-repo`) and is not something to do without a decision.

## Target

Slices 1–4 together: **173.1M → ~100M**, comfortably under the original 155M ceiling,
with the per-directory budgets then set *below* the current numbers so the next drift
fails the gate immediately.

## What is not changing

No page, URL, filename or manifest moves. The re-encoder writes in place, refuses
larger outputs, and checks duration and dimensions. The default-library textures and
the pack images are the media the product actually shows — they are not the target.
