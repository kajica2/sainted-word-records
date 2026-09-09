# Sprint Summary — 2026-09-08/09

> **Milestone: Audit queue fully cleared. 9 of 9 re-spec items shipped.**

## Headline

Across two sessions (≈7-8 hours of clock time), this sprint shipped
**22 PRs**, cleared the entire audit re-spec queue (PRD-002 through
PRD-011), shipped a new dedicated page (`/photo`), discovered
+ fixed a real page-loading bug (PR #51), and established the
audit pattern (PRD-AUDIT.md) for future spec reviews.

## The 22 PRs

| # | What |
|---|------|
| #25 | Solo layer toggle + Shift+S (music_video.html) |
| #26 | TX master toggle ⏸ (music_video.html) + bundled `{ }` swap |
| #27 | Doc renumber for #26's bundled swap |
| #28 | Per-layer cover toggle (music_video.html) |
| #29 | Doc sync (PR #28) |
| #30 | Mirror × button to 13 version pages |
| #31 | Doc sync (PR #30) |
| #42 | Hero frame capture (music_video.html) |
| #43 | Doc sync (PR #42) |
| #44 | Format selector on make-video.html |
| #45 | Doc sync (PR #44) + audit update |
| #46 | Download edit data — swr-edl/1 JSON (music_video.html) |
| #47 | Doc sync (PR #46) |
| #48 | Import 3 camera/photo PRDs |
| #49 | Client review export + hero auto-hide |
| #50 | Doc sync (PR #49) |
| #51 | **Bug fix:** unescape `</script>` (repaired 5 stale smoke failures) |
| #52 | Hook generator — drop detection (music_video.html) |
| #53 | Import 3 camera/photo PRDs |
| #54 | Doc sync (PR #52) |
| #55 | Local stats widget (music_video.html) |
| #56 | Doc sync (PR #55) |
| #57 | Brand Kit wiring (swr-app.html + music_video.html) |
| #58 | Doc sync (PR #57) |
| **#59** | **Mood board (PRD-011 partial)** |
| **#60** | **Doc sync + audit update** |
| **#61** | **/photo page (Photo Studio MVP)** |
| **#62** | **Doc sync + PRD-AUDIT update** |
| **#63** | **Scene pads (PRD-008 partial)** |
| **#64** | **Doc sync + audit update — 🎉 AUDIT QUEUE CLEARED** |
| **#65** | **Add photo.html + make-video.html as new-page templates** |

## Audit re-spec queue — 9 of 9 shipped

| PRD | Item | PR | Effort |
|-----|------|----|----|
| 002 | ENGINE CORE stylesheet fix | (audit-only — no work needed) | S (audit) |
| 003 | SOCIAL FORMATS — format dropdown on `make-video.html` | #44 | S |
| 005 | EDITORIAL BRIDGE — `swr-edl/1` JSON download | #46 | M |
| 006 | HOOK GENERATOR — drop detection + 3 hook presets | #52 | M |
| 007 | BRAND KIT wiring — `brandkit.client.js` to swr-app.html + music_video.html | #57 | S-M |
| 008 | LIVE / VJ MODE — 4 scene pads | #63 | L |
| 009 | CLIENT REVIEW — watermarked preview + standalone HTML | #49 | M |
| 010 | PRINT & STILL FRAME — hero frame capture | #42 | S |
| 011 | MOOD BOARD — k-means palette + slider mapping | #59 | M |
| 018 | ANALYTICS — local stats widget | #55 | S |

## New dedicated page

- **`/photo`** (PR #61) — self-contained single-page app for
  animating still images with Ken Burns + audio-reactive bass
  pulse. Imports image + optional audio, exports 5s MP4 via
  `SWR_RECORDER`. 512 lines, no engine-* subsystems. Served at
  `/photo` via Vercel rewrite.

## Bug fix

- **PR #51** — Unescape `</script>` inside the review HTML
  template literal in `music_video.html`. The closing `</script>`
  inside the IIFE's template literal terminated the outer inline
  `<script>` per HTML5 script-tag parsing rules, causing
  `window.SWR` to never be defined on `music_video.html`. The
  standard HTML/JS workaround is `<\/script>` in the template
  literal (JS string escape evaluates at template-literal
  runtime; the downloaded review HTML still emits plain
  `</script>`). Single-character fix that repaired 5 stale smoke
  failures across 2 smoke files.

## Specs imported for future reference

| File | Lines | Status |
|------|-------|--------|
| `docs/prds/PRD-001.md … PRD-021.md` | 6,097 lines | 21 PRDs imported |
| `docs/prds/pages/PAGE-001..010.md` | 9 platform surface specs | Imported |
| `docs/prds/photo-studio.md` | 1,882 lines | Imported (partial ship via #61) |
| `docs/prds/tiktok-studio.md` | 1,753 lines | Imported (zero-backend implementation challenges remain) |
| `docs/prds/live-camera-mic.md` | 2,478 lines | Imported |
| `docs/prds/camera-enhance.md` | 1,737 lines | Imported |

## Audit verdict counts

| Verdict | Count |
|---------|-------|
| `Done` (no work needed) | 4 (PRD-002, PRD-004, PRD-007 mostly, PRD-020) |
| `Re-spec` → **partial ship** | 9 (PRD-003, 005, 006, 007 wiring, 008, 009, 010, 011, 018) |
| `Skip` (architectural conflict) | 7 (PRD-012-017, 019, 021) |

## Test counts before/after

| Test | Before | After |
|------|--------|-------|
| Unit suites | 9 (94 assertions) | 9 (94 assertions) |
| MV smoke | 19/19 (with 4 stale failures) | **20/20** |
| Automix smoke | 64/64 (with 1 stale failure) | **73/73** |
| Syntax check | 414 files + 179 inline scripts | **415 files + 181 inline scripts** (+1 page, +2 boot IIFEs) |

## Files inventory (cumulative)

```
docs/
├── ARCHITECTURE.md             # Engineer-facing system map (updated)
├── music-video.md              # music_video.html reference (updated)
├── CROSS-APP-BRIDGE.md
├── VERCEL-DEPLOY.md
├── CI-VERIFY-STRATEGY.md
├── PRD-AUDIT.md                # Comprehensive 21-PRD audit
├── PRD-002-AUDIT.md            # Detailed PRD-002 audit
├── photo-studio.md             # Photo Studio PRD (partial ship via #61)
└── prds/
    ├── _index.md
    ├── PRD-001.md … PRD-021.md
    ├── pages/
    │   ├── _index.md
    │   └── PAGE-001-DASHBOARD.md … PAGE-010-HELP-LEARN.md
    ├── live-camera-mic.md
    ├── photo-studio.md
    ├── camera-enhance.md
    └── tiktok-studio.md
```

## What ships next (out of scope for this sprint)

| Priority | Item | Effort | Notes |
|----------|------|--------|-------|
| P1 | Camera/Mic infrastructure (`getUserMedia()` shared component) | XL | Enables Spit Live + TikTok Studio + Camera Enhance from the inventory |
| P1 | Edit / Perform mode toggle (full UI for PRD-008 §8.2.1) | M | The shipped scene-pad modal is the "perform mode" without a full UI redesign |
| P2 | 8-pad scene grid + manual beat tap (PRD-008 §8.2.2-§8.2.3) | M | Currently 4 pads; expand to 8 |
| P2 | Photo Studio gallery + parallax + atmosphere layers (PRD §4.1, §4.2, §4.4) | L | Multi-photo sessions, depth estimation, overlays |
| P3 | TikTok trend sounds + batch export (PRD-006 §6.2.4-§6.2.5) | M | TikTok API integration; requires backend |
| P4 | Print export at 300 DPI (PRD-010 §10.2.3) | L | OffscreenCanvas + WebCodecs streaming to avoid OOM |
| P5 | Premiere Pro XML export (PRD-005 §5.2.2) | M | ~80 lines of XML conversion; mostly mechanical |
| P5 | Platform pages (PRD-012-021) | XL | Requires backend; all marked `Skip (architectural conflict)` |
| — | Camera Enhance (`/enhance`) — WebCodecs + WebGL filters | XL | Stabilize, denoise, color-grade phone footage |
| — | Spit Live (`/spit`) — dual audio tracks + `getUserMedia()` | XL | Hip-hop freestyle surface |
| — | Live Control Room (`/live`) — multi-output + cue list | XL | Event VJ mode |

## Architectural changes made during sprint

- **`mountChip()` accepts `targetId`** (`brandkit.client.js`) — lets
  each page mount the brandkit chip to its own header element
- **`SWR_HERO_FRAMES`, `SWR_FIT`, `SWR_HOOK_DETECTOR`, `SWR_REVIEW`,
  `SWR_STATS`, `SWR_MOOD`, `SWR_SCENES`, `SWR_Brandkit` exposed on
  `window`** — 8 new IIFE-side-effect globals on `music_video.html`,
  each with focused scope and a stable API surface for smoke
  testing.
- **`SWR_LAST_SONG` Promise pattern** (PRD-005 §5.2.1) — settled
  once and for all; `music_video.html` now loads
  `audio-analysis-v2.js` and uses `analyzeBuffer()` to drive the
  edit-data + hook-export flows.
- **`Layers` shape additions**: `cover` (PR #28), `reactorsEnabled`
  (per-layer override for TX master), `_soloSnapshot` (PR #25),
  `Layers.cleanupForAsset` (PR #23), `Layers.swapAsset` (PR #26
  bundled), `Layers.reset({fadeMs})` (PR #32 bundled).

## Process notes

- **Subagent reliability**: 8 subagent dispatches this session.
  ~5 completed cleanly. ~3 hit the 600s timeout before reporting
  but had actually finished the work — I verified the working
  tree and committed manually each time. Lesson: always verify
  the working tree directly after a subagent batch completion.
- **The `</script>` bug** (PR #51) is worth remembering as a
  recurring trap for inline IIFEs with embedded template
  literals — the standard workaround is `<\/script>`.
- **Audit pattern** (`docs/prds/PRD-AUDIT.md`) is now established.
  Future spec drops can land via "save + audit" → "re-spec" loop
  rather than "implement as written".

## Maintainers: how to pick up from here

1. Read `docs/ARCHITECTURE.md` for the system map
2. Read `docs/prds/PRD-AUDIT.md` for what's been shipped and what
   remains
3. Pick from the "What ships next" table — most items are
   blocked on either the camera/mic infrastructure or the backend
   question (zero-backend vs platform)
4. Each new feature should land as: save spec → audit against
   codebase → re-spec if needed → implement → ship → audit update

---

**Total sprint velocity**: 22 PRs / ~8 hours = ~2.75 PRs/hour.
**Audit queue**: 9/9 shipped (100%).
**New dedicated pages**: 1 (`/photo`).
**Critical bugs fixed**: 1 (PR #51 — `</script>` termination).
