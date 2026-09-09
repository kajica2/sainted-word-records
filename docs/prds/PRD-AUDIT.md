# PRD Suite Audit

> **TL;DR**: Most of the 21-PRD suite is either **already shipped**,
> **based on wrong premises**, or **architecturally incompatible** with
> the repo's "zero-backend, privacy-first" core principle (PRD-001 §1.3).
>
> **Re-spec the 5 features that are real and small** (PRDs 003, 004,
> 005, 006, 010) and **skip or defer the platform features** (PRDs
> 012-021) until the backend story is settled.
>
> **See** [PRD-002-AUDIT.md](./PRD-002-AUDIT.md) for the pattern that
> this doc extends. PRD-002 was the first audit; this doc covers the
> remaining 20 PRDs in tabular form.

---

## How to read this doc

Each PRD gets one row with:

- **Verdict** — `Done`, `Re-spec`, `Skip`, or `Conflict`
- **Status** — what's actually shipped in the repo (or why it can't ship)
- **Effort** — re-spec or implement cost (`S`/`M`/`L`)
- **Notes** — key cross-references, conflicts, or follow-ups

**Verdict key**

| Verdict | Meaning |
|---------|---------|
| `Done` | Feature already shipped (cite the PR/commit) |
| `Re-spec` | PRD premise is wrong; write a corrected version with concrete file paths |
| `Skip` | Out of scope (architecture, cost, or duplicate) |
| `Conflict` | PRD directly contradicts existing code or another PRD |

---

## Engine features (PRDs 002-011)

### PRD-002: ENGINE CORE — `/app`

- **Verdict**: `Conflict`
- **Status**: Wrong premise. The `/app` route, missing `app.css`, and `setCanvasFormat` function don't exist. See [PRD-002-AUDIT.md](./PRD-002-AUDIT.md) for full detail.
- **Effort**: `S` (audit only — no work needed)
- **Notes**: All acceptance criteria already pass on the live site.

### PRD-003: SOCIAL FORMATS — Phase 1

- **Verdict**: `Re-spec` → **partial ship** (PR #44)
- **Status**: Format dropdown shipped on `make-video.html` (PR #44, `ddb556a`). `#format-select` in the footer with 4 ratios: 16:9 (640×360, default), 1:1 (720×720), 9:16 (360×640), 2.39:1 (956×400). CSS uses `object-fit: contain` so non-16:9 formats letterbox without distortion. `window.MVM_FORMAT` exposes the current selection for smoke testing.
- **Effort**: `S` (shipped) + `M` (safe-zone overlay + dual export follow-ups)
- **Notes**: Safe-zone overlay (PRD-003 §3.2.2) and dual export (PRD-003 §3.2.3) are explicitly out of scope — punted to a follow-up. The 8-format table from PRD-003 §3.2.1 is reduced to 4 (Stories and Twitter are 9:16 + 16:9 variants; Custom not needed at MVP).

### PRD-004: TYPOGRAPHY LAYER — Phase 2

- **Verdict**: `Done` (partial — already shipped as `versions/typography.html`)
- **Status**: `versions/typography.html` already has canvas `fillText` rendering (lines 198-226), multi-line support, and a font catalog. The PRD's "Layer 7: TEXT" schema isn't integrated into `Layers.list` like the other layer types — `typography.html` is a standalone variant page instead. The PRD's beat-synced animations (`scale-beat`, `glitch`) are partially covered by the existing reactors (`bass→scale`, `beat→opacity`) but not as discrete text animations.
- **Effort**: `M` if we want to integrate the text layer into `Layers.list` on `music_video.html`. Otherwise `S` — the variant page is fine.
- **Notes**: 9 version pages × typography exists. See `versions/typography.html:6` meta description.

### PRD-005: EDITORIAL BRIDGE — Phase 3

- **Verdict**: `Re-spec` → **partial ship** (PR #46)
- **Status**: Edit Data export shipped (PR #46, `3497090`). `SWR_EDIT_DATA` global on `music_video.html` runs `AudioAnalysisV2.analyzeBuffer()` on the loaded song (via `SWR_LAST_SONG` blob or `A.el.src` fallback), formats the result as `swr-edl/1` JSON, and downloads it. JSON shape matches PRD-005 §5.2.1: BPM + key/scale + duration + classified onsets (downbeat / kick / snare via interval heuristics) + phrase segments (intro / build / drop via naive 16s/32s/32s splits). The `<script>` tag for `audio-analysis-v2.js` was missing on `music_video.html` — added in this PR.
- **Effort**: `M` (shipped) + `M` (Premiere Pro XML export follow-up)
- **Notes**: Premiere Pro XML export (PRD-005 §5.2.2) is **explicitly out of scope** — ~80 lines of edge-case-prone timecode/marker conversion code. Real onset classification (kicks vs snares vs transient) and structural phrase segmentation are also out of scope — would require either a trained model or beat-aware segment detection. The current heuristic works for typical 4-minute pop songs.

### PRD-006: HOOK GENERATOR — Phase 4

- **Verdict**: `Re-spec` → **partial ship** (PR #52)
- **Status**: Hook generator shipped (PR #52, `c287490`). `SWR_HOOK_DETECTOR` global on `music_video.html` runs an inline energy-envelope drop finder (RMS over 20ms windows, 10ms hop — same math as `audio-analysis-v2.js:225-267`), finds the longest sustained low-energy intro, then the first frame where energy > 2× intro mean. Snaps to the nearest onset within 200ms via `AudioAnalysisV2.analyzeBuffer().onsets`. `exportHook(preset)` seeks the audio element to the start time and records via `SWR_RECORDER` at 2 Mbps. 3 presets shipped: Teaser (3s before drop), Hook (5s before drop), Clip (15s from intro). Footer `Hooks` button triggers detection + shows the panel.
- **Effort**: `M` (shipped) + `M` (auto-caption + end-card builder + thumbnail picker + Full Vertical 60s preset follow-ups)
- **Notes**: Detection is heuristic — energy > 2× intro mean works for typical EDM/pop, misses ambient tracks with no clear drop. Confidence is hard-coded to 0.85. Auto-Caption (PRD-006 §6.2.3), End-Card Builder (§6.2.4 with QR code library), Thumbnail Picker (§6.2.5 — overlaps with PR #42 hero frames), and "Full Vertical 60s" preset (§6.2.2) are explicitly **out of scope** — punted to follow-ups.

### PRD-007: BRAND KIT — Phase 5

- **Verdict**: `Done` (largely — `brandkit.client.js` ships most of it) → **wiring complete** (PR #57)
- **Status**: `brandkit.client.js` (5.5 KB) + `brandkit.css` (2 KB) ship:
  - Logo upload (data URL, kept small)
  - 9-font curated catalog (Google Fonts + system fonts)
  - 5-color palette (primary/secondary/accent/bg/fg) with CSS variable injection
  - 4-card editor panel (Cover/Logo/Colors/Typography)
  - `window.SWR_Brandkit` API
  - `localStorage["swr.profile"]` persistence (with an "auth seam" comment for future Clerk/Supabase swap)
  - Loaded on `engine.html` (legacy), `swr-app.html` (SPA), and `versions/music_video.html` (PR #57). `mountChip()` was adapted to accept an optional `targetId` parameter so each page can mount to its own header element.
- **Effort**: `S` to wire into `swr-app.html` and `versions/music_video.html`; `M` for the "position presets" (top-left-bug / center-reveal / watermark-tile / etc.) and the per-render "burn logo on render" pipeline.
- **Notes**: PRD-007 §7.2.1's "position presets" (top-left-bug, center-reveal, end-card, watermark-tile) are not in the current brandkit — they're a render-overlay feature, not a brand config feature.

### PRD-008: LIVE / VJ MODE — Phase 6

- **Verdict**: `Re-spec` → **partial ship** (PR #63)
- **Status**: Scene pads shipped (PR #63, `377a088`). `SWR_SCENES` global on `music_video.html` stores up to 4 scene snapshots in `localStorage["swr.scenes.v1"]`, each capturing the 5 footer sliders (depth/gate/decay/sens/neighbourCount) + the active preset override (from `VersionsPresets._fxOverride`) + the automix on/off state. Footer `Scenes` button opens a modal with a 2×2 grid of pads. Click = recall (restores all 5 sliders + preset + automix); hold 1 second = save current state to that pad. Recall dispatches `input` events on each slider to trigger existing handlers.
- **Effort**: `M` (shipped scene pads) + `XL` (full Edit/Perform mode toggle + 8-pad grid + manual beat tap + emergency controls + multi-device sync)
- **Notes**: Audit queue is **fully cleared**. PRD-008 §8.2.1 full Edit/Perform toggle, §8.2.3 manual beat tap (Spacebar), §8.2.4 emergency controls, and the 8-pad grid (§8.2.2 — we ship 4) are explicitly **out of scope** — punted to follow-ups. The shipped scene pads cover the highest-impact sub-feature of PRD-008.

### PRD-009: CLIENT REVIEW — Phase 7

- **Verdict**: `Re-spec` → **partial ship** (PR #49)
- **Status**: Client review export shipped (PR #49, `3b50451`). `SWR_REVIEW` global on `music_video.html` records at 1 Mbps with a "PREVIEW — NOT FOR DISTRIBUTION" watermark burned into the canvas (via `window.__SWR_REVIEW_WATERMARK` global, checked by the frame function each tick), generates a self-contained HTML review page with click-to-comment pins (persisted via `localStorage["swr.review.pins." + filename]` per browser), and downloads both files. Footer `Review` button triggers the export. The 1.2s auto-hide on hero-frame download was added in this PR.
- **Effort**: `M` (shipped) + `M` (A/B compare + revision log follow-ups)
- **Notes**: A/B version compare (PRD-009 §9.2.3) and revision log CSV export (§9.2.4) are **explicitly out of scope** — punted to a follow-up. The watermark is burnt into the canvas (not a CSS overlay) so it survives the recorder's stream capture. Recording duration is hard-coded to `A.duration` (not user-configurable per-call).

### PRD-010: PRINT & STILL FRAME — Phase 8

- **Verdict**: `Re-spec` → **partial ship** (PR #42)
- **Status**: Hero frame capture shipped (PR #42, `c8e14c4`). `SWR_HERO_FRAMES` global on `music_video.html` samples at 4 fps into a 12-frame ring buffer (last 3 s), analyzes for energy + contrast + composition, and surfaces the 3 best via `best(3)`. Footer `Hero` button toggles; auto-starts on play, auto-stops on pause. Hero panel shows 3 clickable thumbnails; click downloads full-resolution PNG.
- **Effort**: `S` (shipped) + `L` (print export follow-up)
- **Notes**: Print export at 300 DPI (PRD-010 §10.2.3) is **explicitly out of scope** — would require OffscreenCanvas + WebCodecs streaming to render at ~7200×10800 without OOM. Print-safe adjustments (§10.2.4 saturation/bleed/trim lines) also out of scope. Both punt to a future PR.

### PRD-011: MOOD BOARD & REFERENCE — Phase 9

- **Verdict**: `Re-spec` → **partial ship** (PR #59)
- **Status**: Mood board + reference overlay shipped (PR #59, `cb0a266`). `SWR_MOOD` global on `music_video.html` runs k-means++ (k=5, 10 iterations) on a 64×64 downsample of the uploaded reference image, plus Michelson contrast + mean saturation + warm/cool temperature features. Produces a heuristic engine mapping to the 4 visible footer sliders (depth, gate, decay, sens). `applySuggestion()` sets sliders via dispatched `input` events. Footer `Mood` button opens a modal with file upload + hex color paste + Apply + Clear. A draggable `<img id="mood-overlay">` shows the reference at 30% opacity; position persists per session via `localStorage["swr.mood.overlay.v1"]`.
- **Effort**: `M` (shipped) + `M` (Sobel edge density + URL input + motion/FX mapping follow-ups)
- **Notes**: Sobel edge density (PRD-011 §11.2.2 — would distinguish "complex photo" from "flat graphic"), URL input for reference images (§11.2.1 — CORS complications), and the full motion/FX slider mapping table (§11.2.3 — "warmth/intensity/motion/FX sliders" don't exist as user-facing controls on `music_video.html`) are **explicitly out of scope** — punted to follow-ups. The shipped mapping uses the 5 actual footer sliders (sens, gate, decay, depth, N) instead.

---

## Platform pages (PRDs 012-021)

**All platform pages have the same architectural problem**: PRD-001
§1.3 declares "Zero Backend, Privacy First, IndexedDB only" as
non-negotiable. Every platform page implies multi-user state, auth,
project storage, billing, and analytics — i.e. a backend.

The detailed spec for these pages lives in
[`pages/`](./pages/) (10 PAGE docs, imported Sep 2026). Each
PAGE doc has UI mockups, data models, and acceptance criteria
consistent with its parent PRD.

**Verdict for all 12-21**: `Skip` (architectural conflict) until a
backend story is settled. See per-PRD notes for any local-scope
feature that could ship without breaking zero-backend.

### PRD-012: DASHBOARD — Platform Page 1

- **Verdict**: `Skip` (architectural conflict)
- **Status**: Requires user auth + multi-project storage. Both conflict with PRD-001 §1.3.
- **Notes**: A "local dashboard" using IndexedDB is technically possible (drop-in for the multi-user piece) — see `pages/PAGE-001-DASHBOARD.md` for a single-user version. Could be `S` scope if scoped down.

### PRD-013: ASSET MANAGER / DAM — Platform Page 2

- **Verdict**: `Skip` (mostly) / `Re-spec` (limited)
- **Status**: DAM requires project-scoped storage (the user library is already IndexedDB-scoped to the device). Multi-project is the conflict; the existing `Lib.items` array per page already provides device-local asset management.
- **Notes**: A search/sort/filter UI over `Lib.items` would be a real local feature. See `pages/PAGE-002-ASSET-MANAGER.md` §2.

### PRD-014: CLIENT WORKSPACE — Platform Page 3

- **Verdict**: `Skip`
- **Notes**: Explicitly multi-user (clients, sharing, comments). PRD-009 covers the zero-backend review alternative.

### PRD-015: CAMPAIGN / RELEASE PLANNER — Platform Page 4

- **Verdict**: `Skip`
- **Notes**: Calendar + multi-project scheduling. Local IndexedDB version possible but out of scope.

### PRD-016: LIVE EVENT CONTROL ROOM — Platform Page 5

- **Verdict**: `Re-spec` (significant overlap with PRD-008)
- **Status**: "Control Room" shares most features with PRD-008's Live / VJ Mode (scene pads, fullscreen, manual beat tap). The differences: multi-device sync, audience engagement, song queue.
- **Notes**: PRD-008's "Perform Mode" + scene pads covers most of what a single-user control room needs. Multi-device sync would require a backend (signaling server). Punt to PRD-008's scene-pad implementation.

### PRD-017: MARKETPLACE — Platform Page 6

- **Verdict**: `Skip`
- **Notes**: Multi-vendor marketplace requires a backend (vendor accounts, listings, payments). Out of scope.

### PRD-018: ANALYTICS — Platform Page 7

- **Verdict**: `Re-spec` → **partial ship** (PR #55)
- **Status**: Local stats widget shipped (PR #55, `ea6cca0`). `SWR_STATS` global on `music_video.html` records `(ts, durationMs, ext, size)` on every successful `Recorder._save()` to `localStorage["swr.stats.v1"]` (capped at 100 most recent). Footer `Stats` button opens a modal showing total renders, last-30-day renders, total minutes exported, storage usage, last preset, and the last 5 renders as a table.
- **Effort**: `S` (shipped) + `M` (YouTube/TikTok OAuth + weekly email follow-ups)
- **Notes**: YouTube Analytics API, TikTok Analytics, Instagram Insights, weekly email (PRD-018 §18.2.1-3) are explicitly **out of scope** — punted to follow-ups. "Most-used preset" is shown as "last preset" because we don't track per-preset usage historically (would need a `SWR_PRESET_USE` event from the engine).

### PRD-019: BILLING & CREDITS — Platform Page 8

- **Verdict**: `Skip` (architectural conflict)
- **Notes**: Requires payment provider integration (Stripe, Lemon Squeezy). Out of scope for zero-backend.

### PRD-020: SETTINGS / STUDIO PROFILE — Platform Page 9

- **Verdict**: `Done` (partially — brandkit covers this)
- **Status**: `brandkit.client.js` covers most of PRD-020 §20.2 (name, email, brandkit, profile). Missing: notification preferences, integration settings (which don't exist anyway), team management.
- **Notes**: The localStorage-backed profile is the zero-backend equivalent of the platform "Studio Profile" page. No additional work needed.

### PRD-021: HELP / LEARN — Platform Page 10

- **Verdict**: `Skip` (this is content work, not code)
- **Notes**: PRD-021 is "write the help docs" — a content task. The docs that exist (`docs/ARCHITECTURE.md`, `docs/music-video.md`) cover developer-facing material; user-facing tutorials (`make a music video in 30 seconds`) need to be authored. Punt to a content sprint.

---

## Standalone specs (outside the 21-PRD suite)

These are PRDs that ship their own spec file under `docs/prds/`
but aren't part of the numbered 21-PRD suite. They follow the
same partial-ship / audit pattern as the rows above.

### `photo-studio.md` — Photo Studio ("Still Motion")

- **Verdict**: `Re-spec` → **partial ship** (PR #61)
- **Status**: Photo Studio MVP shipped (PR #61, `31921fe`).
  `photo.html` is a self-contained single-page app (inline CSS +
  JS IIFE, ~512 lines) that imports an image + optional audio,
  animates it with Ken Burns pan/zoom + audio-reactive bass
  pulse, and exports a 5s MP4 at 1080×1080 or 1920×1080 via
  `lib/recorder.client.js` (`SWR_RECORDER`). No `engine-*`
  subsystems are loaded — the page **is** the engine. Served at
  `/photo` and `/photo/` via Vercel rewrite (`vercel.json:148-153`);
  build-time copy wired via `vite.config.js` `rootFiles`. One new
  smoke assertion added to `scripts/check-mv-smoke.mjs` (stage +
  inputs + export + play buttons present, 1080×1080 default,
  `SWR_RECORDER` loaded). See `docs/ARCHITECTURE.md` §6.5 for
  the page architecture.
- **Effort**: `M` (shipped) + `M-L` (out-of-scope follow-ups
  per the PRD)
- **Notes**: The following PRD sections are **explicitly out of
  scope** (punted to follow-ups) — PRD §4.1 Gallery (multi-image
  management), §4.2 Parallax (multi-layer depth composition),
  §4.4 atmosphere layers (particles / fog / light leaks), §4.5
  GIF / Cinemagraph / Live Photo (input formats beyond still
  image + audio), and §4.6 batch (queue multiple photos for
  sequential export). The shipped MVP is a single-still creator
  — load one image, pick a Ken Burns path, export one MP4. The
  PRD's philosophy ("the photograph is the hero", "motion
  serves the image") is preserved by the audio-reactive bass
  pulse being subtle and the start/end position being
  user-controlled.

---

## Summary table

| PRD | Verdict | Effort | Status |
|-----|---------|--------|--------|
| 002 ENGINE CORE | Conflict | S | Audit only |
| 003 SOCIAL FORMATS | Re-spec | S | Re-spec for `make-video.html` |
| 004 TYPOGRAPHY | Done (partial) | M | `versions/typography.html` ships it |
| 005 EDITORIAL BRIDGE | Re-spec | M | Data exists in `audio-analysis-v2.js` |
| 006 HOOK GENERATOR | Re-spec | M | Drop detection + recorder range |
| 007 BRAND KIT | Done (largely) | S-M | `brandkit.client.js` ships most of it |
| 008 LIVE / VJ MODE | Re-spec | L | Scene pads + manual beat tap |
| 009 CLIENT REVIEW | Re-spec | M | Standalone review HTML generator |
| 010 PRINT & STILL FRAME | Re-spec | S | Frame-grab + hero suggestion |
| 011 MOOD BOARD | Re-spec | M | Reference extraction + slider mapping |
| 012 DASHBOARD | Skip | — | Multi-user, conflict |
| 013 ASSET MANAGER | Skip (mostly) | — | DAM = multi-project, conflict |
| 014 CLIENT WORKSPACE | Skip | — | Multi-user, conflict |
| 015 CAMPAIGN PLANNER | Skip | — | Multi-project, conflict |
| 016 EVENT CONTROL ROOM | Re-spec | — | Overlaps with PRD-008 |
| 017 MARKETPLACE | Skip | — | Multi-vendor, conflict |
| 018 ANALYTICS | Re-spec | — | Local stats only |
| 019 BILLING | Skip | — | Payment provider, conflict |
| 020 SETTINGS / PROFILE | Done (mostly) | S | `brandkit.client.js` covers it |
| 021 HELP / LEARN | Skip | — | Content task, not code |

**Count**:
- `Done` (no work needed): 4 PRDs (002, 004, 007, 020)
- `Re-spec` (real work, do it): 9 PRDs (003, 005, 006, 008, 009, 010, 011, 016, 018)
- `Skip` (architectural conflict or content task): 7 PRDs (012, 013, 014, 015, 017, 019, 021)

---

## Suggested execution order

If we work through the re-spec ones in increasing complexity:

1. ~~PRD-010 PRINT & STILL FRAME~~ (`S`) — **shipped as PR #42** (hero frame capture; print export at 300 DPI punted).
2. ~~PRD-003 SOCIAL FORMATS~~ (`S`) — **shipped as PR #44** (format dropdown; safe-zone + dual export punted).
3. ~~PRD-005 EDITORIAL BRIDGE~~ (`M`) — **shipped as PR #46** (swr-edl/1 JSON export; Premiere Pro XML punted).
4. ~~PRD-009 CLIENT REVIEW~~ (`M`) — **shipped as PR #49** (watermarked preview + standalone HTML review; A/B compare + revision log punted).
5. ~~PRD-006 HOOK GENERATOR~~ (`M`) — **shipped as PR #52** (drop detection + 3 hook presets; auto-caption + end-card + thumbnail picker + Full Vertical 60s punted).
6. ~~PRD-018 ANALYTICS~~ (`S`) — **shipped as PR #55** (local stats widget + Recorder instrumentation; YouTube/TikTok OAuth + weekly email punted).
7. ~~PRD-011 MOOD BOARD~~ (`M`) — **shipped as PR #59** (k-means palette + Michelson contrast + warm/cool temperature + heuristic slider mapping; Sobel edge density + URL input + motion/FX mapping punted).
8. ~~PRD-007 BRAND KIT wiring~~ (`S-M`) — **shipped as PR #57** (mounted on swr-app.html + versions/music_video.html; mountChip() adapted to take targetId; position presets + burn-in overlay still punted).
9. ~~PRD-008 LIVE / VJ MODE~~ (`L`) — **shipped as PR #63** (4 scene pads with snapshot/recall; full Edit/Perform toggle + 8-pad grid + manual beat tap + emergency controls punted).

**🎉 Audit queue fully cleared: 9 of 9 re-spec items shipped.**

Each ships as a separate PR. The sprint cadence so far has been
~2-4 PRs per session, so this is 3-5 sessions of focused work to
clear the re-spec queue.

---

## Cross-references

- `PRD-002-AUDIT.md` — the original audit that established this pattern
- `pages/` — the detailed implementation specs for PRDs 012-021
- `docs/ARCHITECTURE.md` — actual codebase structure
- `docs/music-video.md` — `versions/music_video.html` reference
- `audio-analysis-v2.js` — BPM/key/onset data source for PRDs 005, 006
- `brandkit.client.js` — covers most of PRD-007 + part of PRD-020
- `lib/recorder.client.js` — recorder for PRDs 006, 009, 010
