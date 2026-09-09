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

- **Verdict**: `Re-spec`
- **Status**: The data exists (`audio-analysis-v2.js` provides BPM, key, scale, chromagram, onsets, duration). The "Download Edit Data" UI doesn't exist. The Premiere XML export is new work. Pure export feature — fits zero-backend.
- **Effort**: `M`
- **Notes**: Add a "Download Edit Data" button next to the existing recorder (`versions/music_video.html:303`). JSON shape is well-specified in PRD-005 §5.2.1.

### PRD-006: HOOK GENERATOR — Phase 4

- **Verdict**: `Re-spec`
- **Status**: Drop detection algorithm is straightforward (energy envelope + onset detection — both available in `audio-analysis-v2.js`). Hook export presets (3s/5s/15s/60s) build on the existing recorder's range. End-card builder + auto-caption are new.
- **Effort**: `M`
- **Notes**: The recorder exists at `lib/recorder.client.js`; the hook feature is essentially "record a sub-range" with the existing recorder + a configurable stop time. The end-card builder + QR code generation are the only new infra.

### PRD-007: BRAND KIT — Phase 5

- **Verdict**: `Done` (largely — `brandkit.client.js` ships most of it)
- **Status**: `brandkit.client.js` (5.5 KB) + `brandkit.css` (2 KB) ship:
  - Logo upload (data URL, kept small)
  - 9-font curated catalog (Google Fonts + system fonts)
  - 5-color palette (primary/secondary/accent/bg/fg) with CSS variable injection
  - 4-card editor panel (Cover/Logo/Colors/Typography)
  - `window.SWR_Brandkit` API
  - `localStorage["swr.profile"]` persistence (with an "auth seam" comment for future Clerk/Supabase swap)
  - Loaded on `engine.html:5438` and applied at boot (line 5440)
  - **Not** loaded on `swr-app.html` or `versions/music_video.html` — only the legacy `engine.html`
- **Effort**: `S` to wire into `swr-app.html` and `versions/music_video.html`; `M` for the "position presets" (top-left-bug / center-reveal / watermark-tile / etc.) and the per-render "burn logo on render" pipeline.
- **Notes**: PRD-007 §7.2.1's "position presets" (top-left-bug, center-reveal, end-card, watermark-tile) are not in the current brandkit — they're a render-overlay feature, not a brand config feature.

### PRD-008: LIVE / VJ MODE — Phase 6

- **Verdict**: `Re-spec`
- **Status**: Some sub-features are shipped as scattered footguns:
  - `Shift+F` browser fullscreen (engine-layout.client.js:10)
  - `F` fit-to-screen (PR #36)
  - `{}` swap asset (PR #26 bundled)
  - `Tab`/`Shift+Tab` cycle presets (PR #17)
  - `Backspace` layer reset (PR #15)
  - `S`/`Shift+S` Solo (PR #25)
  The PRD's `Perform Mode` toggle, scene pads (8-button 2×4 grid),
  and manual beat tap are net-new.
- **Effort**: `L` (the scene pad state is the meaty part — saves/restores engine state per pad)
- **Notes**: Scene pads require a state-snapshot mechanism that doesn't exist today. Build it as `Layers.sceneState` (preset + library subset + active reactor targets) plus `VersionsPresets.scene(id)` to recall. Beat tap is small — `spacebar` already exists as a keybind candidate.

### PRD-009: CLIENT REVIEW — Phase 7

- **Verdict**: `Re-spec`
- **Status**: No client-review UI. The PRD's "Self-Contained Review Page" (generate a standalone HTML with embedded watermarked MP4) is a clever zero-backend approach — generate the HTML on render, download as `.html`, email the link. The watermarking is a `Recorder` config change (lower bitrate + burn "PREVIEW" text).
- **Effort**: `M` (Recorder config + HTML generator)
- **Notes**: Genuinely zero-backend (no comments server, just an `.html` file with `<video>` + comment pins in JS). Aligns with PRD-001 §1.3.

### PRD-010: PRINT & STILL FRAME — Phase 8

- **Verdict**: `Re-spec` → **partial ship** (PR #42)
- **Status**: Hero frame capture shipped (PR #42, `c8e14c4`). `SWR_HERO_FRAMES` global on `music_video.html` samples at 4 fps into a 12-frame ring buffer (last 3 s), analyzes for energy + contrast + composition, and surfaces the 3 best via `best(3)`. Footer `Hero` button toggles; auto-starts on play, auto-stops on pause. Hero panel shows 3 clickable thumbnails; click downloads full-resolution PNG.
- **Effort**: `S` (shipped) + `L` (print export follow-up)
- **Notes**: Print export at 300 DPI (PRD-010 §10.2.3) is **explicitly out of scope** — would require OffscreenCanvas + WebCodecs streaming to render at ~7200×10800 without OOM. Print-safe adjustments (§10.2.4 saturation/bleed/trim lines) also out of scope. Both punt to a future PR.

### PRD-011: MOOD BOARD & REFERENCE — Phase 9

- **Verdict**: `Re-spec` (medium)
- **Status**: Reference image upload + k-means color extraction is feasible client-side (5 colors from a thumbnail). Engine mapping (warm temp → warmth slider, etc.) requires new sliders on `music_video.html`. The "feature extraction" stats (Michelson contrast, edge density via Sobel) are computable on a 32×32 thumbnail.
- **Effort**: `M`
- **Notes**: Adds new sliders to `music_video.html`. Could be opt-in via a "Mood Match" button next to the gradient panel.

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

- **Verdict**: `Re-spec` (limited — local analytics only)
- **Status**: "Renders this month: 47, Export minutes: 89" is computable from IndexedDB. Multi-user analytics (per-org, per-team) requires a backend.
- **Notes**: A local-only "Stats" widget on the engine page would satisfy the user-facing piece. Track render count + duration via `Recorder` instrumentation.

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
3. **PRD-005 EDITORIAL BRIDGE** (`M`) — "Download Edit Data" button + JSON export. Builds on `audio-analysis-v2.js`.
4. **PRD-009 CLIENT REVIEW** (`M`) — watermarked preview + standalone HTML generator.
5. **PRD-006 HOOK GENERATOR** (`M`) — drop detection + hook export.
6. **PRD-018 ANALYTICS** (limited) — local stats widget.
7. **PRD-011 MOOD BOARD** (`M`) — reference extraction + slider mapping.
8. **PRD-007 BRAND KIT wiring** (`S-M`) — wire `brandkit.client.js` into `swr-app.html` and `music_video.html`.
9. **PRD-008 LIVE / VJ MODE** (`L`) — scene pad state-snapshot mechanism + perform mode UI.

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
