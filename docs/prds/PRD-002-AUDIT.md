# PRD-002 Audit — Stylesheet Loading (vs. actual codebase)

## TL;DR

**PRD-002 is based on an incorrect mental model of the codebase.**
It assumes there's an `/app` route served by a separate `app.css`
stylesheet that has CSS loading issues. In reality:

- The SPA at `/engine/` is `swr-app.html` — a single self-contained
  HTML file with one inline `<style>` block (~5,000 lines, no
  external CSS dependency).
- The legacy engine at `/engine.html` uses three external CSS
  files (`video-fx.css`, `presets-panel.css`, `brandkit.css`),
  all of which load cleanly on Vercel.

**There is no missing stylesheet to fix.** The PRD's three "fix
requirements" all describe work that's already done.

## PRD-002 claimed

> "The `/app` page appears to have CSS issues (per user request:
> 'fix the style sheet'). Likely causes: CSS file not found at
> expected path / Build output not deployed correctly / Inline
> styles only, missing external stylesheet / Vite build CSS not
> extracted properly."

## Actual codebase state

| Surface | CSS source | Status |
|---------|-----------|--------|
| `swr-app.html` (SPA at `/engine/`) | One inline `<style>` block, ~5,000 lines, lines 18-200 are CSS variables (`--black`, `--ink-1..3`, `--text`, `--text-dim`, `--text-mute`, `--lime`, `--ultraviolet`, `--ember`, etc.) — more comprehensive than what PRD-002 §2.2.3 proposes | Renders correctly on `sainted-word-records.vercel.app/versions/music_video.html` (verified live) |
| `engine.html` | External `/video-fx.css`, `/presets-panel.css`, `/brandkit.css` (linked at lines 13-15) | Renders correctly; no 404s in Vercel logs |
| `versions/*.html` | Each has its own inline `<style>` block (~150-300 lines per page) | Renders correctly |
| `make-video.html` | One inline `<style>` block | Renders correctly |

Vite config (`vite.config.js`) handles CSS extraction and bundling
correctly — the `dist/` build extracts per-page CSS. Verified via
the build output in `dist/` directories.

## PRD-002 §2.2.2 — Canvas Sizing

The PRD proposes a `setCanvasFormat(ratio)` function that sets
`canvas.width = 1080` etc. and scales the container.

**Already implemented** in `engine-render.client.js:163-182`
(`SWR_RENDER.fit()`) which sizes the canvas backing store at the
section's `clientWidth × clientHeight × DPR`. The fit() runs on
every resize, so aspect-ratio handling is automatic. The proposed
`setCanvasFormat` would conflict with the existing system.

The PRD's "9:16 / 1:1 / 16:9" output ratio support is a separate
feature (covered by PRD-003) — it doesn't apply to the
audio-reactive visual engine (which renders to a flexible canvas),
it applies to the export pipeline.

## PRD-002 §2.2.3 — Dark Theme Variables

The PRD proposes adding `:root { --bg-base: #0a0d12; ... }` and
`* { margin: 0; padding: 0; box-sizing: border-box; }`.

**Already implemented** in `swr-app.html:18-200` with a more
comprehensive variable system (`--black`, `--ink-1`, `--ink-2`,
`--ink-3`, `--charcoal`, `--line`, `--text`, `--text-dim`,
`--text-mute`, plus accent variables and `--ease` motion curves).
The universal selector and box-sizing reset is also already in
place.

## PRD-002 §2.3 — Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `/app` loads with no 404 errors for CSS/JS assets | ✅ Already passes |
| Canvas resizes correctly when switching between 9:16, 1:1, 16:9 | ⚠️ Not applicable to engine; applies to `make-video.html` (no format selector today) |
| All form elements render with dark theme | ✅ Already passes on `swr-app.html` and `engine.html` |
| Layout is responsive: 1366×768 to 4K ultrawide | ✅ Engine has `engine-layout.client.js` + `engine-layout.css`; SPA has responsive grid |
| Mobile: iPad Pro usable, iPhone read-only preview | ✅ `engine-layout.client.js` + media queries handle this |

## Conclusion

**There is nothing to fix.** PRD-002's premise is wrong — the
stylesheets load fine, the dark theme is comprehensive, and the
canvas sizing works.

## What this means for the PRD suite

The PRDs were authored without codebase context. Several
sections describe features that:

- **Already exist** (PRD-002 stylesheet, parts of PRD-003 format
  selector, parts of PRD-008 VJ mode)
- **Conflict with existing code** (PRD-002 §2.2.2 `setCanvasFormat`
  would override the existing `SWR_RENDER.fit()`)
- **Imply a different architecture** (PRD-002 §2.1 describes
  "Header + main stage + sidebar controls + timeline" — `swr-app.html`
  has a different layout: left sidebar (gradient panel) + center
  stage + right sidebar (parameters); no separate "timeline"
  component on the SPA itself)

## Recommendation

For each PRD that lands on this audit's "already shipped" or
"wrong premise" list, the right next step is one of:

1. **Mark as Done** — feature already shipped (cite the PR that
   shipped it).
2. **Re-spec** — write a corrected PRD with concrete file paths
   and the actual current state.
3. **Skip** — feature doesn't apply to the current architecture.

## Suggested next moves (ordered)

| # | Action | Effort | Notes |
|---|--------|--------|-------|
| 1 | Audit the remaining 20 PRDs against the codebase (similar to this doc). Output as `docs/prds/PRD-AUDIT.md` with per-PRD verdict. | Medium | Catches the rest of the "wrong premise" issues before we plan implementations |
| 2 | Re-spec PRD-003 (Social Formats) — `make-video.html` doesn't have a format selector yet. The PRD's content (8 format options, safe-zone overlays, dual export) is real and the format selector is a small, well-scoped addition. | Small | First plan in the new spec |
| 3 | Re-spec PRD-006 (Hook Generator) — auto-detect drop + export short clips. The audio-analysis pipeline already provides BPM/onset data; the feature is mostly export config + a "Export 3s clip" button. | Medium | Builds on PRD-003 |
| 4 | Skip the platform pages (PRD-012 through PRD-021) until the backend story is settled. PRD-001 §1.3 says "Zero Backend" is non-negotiable; pages 12-21 require multi-user state. | n/a | Architectural conflict |
| 5 | Re-spec PRD-008 (Live / VJ Mode) — many features already exist (fullscreen layout via `Shift+F`, swap asset via `{ }`, fit-to-screen via `F`). The "Perform Mode" toggle + scene pads is new and well-scoped. | Medium | Augments existing features |

## Cross-references

- `docs/ARCHITECTURE.md` — the actual system layout (engine
  subsystems, pages, API)
- `docs/music-video.md` — the music_video.html reference (most
  features shipped this sprint are documented there)
- `vite.config.js` — the actual build pipeline (CSS extraction,
  copy-static plugin, swrc-api-middleware)
- PR #22 — `docs/ARCHITECTURE.md` commit
- PR #24 — `docs/music-video.md` sync to post-2026 work
