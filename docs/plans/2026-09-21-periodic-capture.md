# Periodic Frame Capture (Download-to-Device)

> Generated: 2026-09-21
> Status: **draft, executing via subagent-driven-development**
> Base: `main` @ `06e159c` (post PRs #97, #98, #99)

---

## Goal & Scope

Add a feature allowing users to capture a screenshot of the engine canvas every `N` seconds and download each frame to their device. **Disabled by default** (zero behavior change unless the user enables it).

### Macro decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Output destination | **Download to user's device** (zero server cost, zero storage limits, user controls retention) |
| Surface scope | **`engine.html` + 5 done variants** (neon, film, grid, smoke, hallucination) — not the 17 ported artistic variants; not music_video |
| Interval configuration | **UI numeric input + localStorage** (`swr.capture.intervalSec`), default 5 seconds, range 1-300; URL param override `?capture=N` |
| Architecture | **New `client/capture-runtime.client.js`** (own state, own UI, own localStorage key) — not an extension of `client/automix-runtime.client.js` |

---

## Architecture

New dedicated client script `client/capture-runtime.client.js`:

```
- Loads after the engine variant's main runtime (after client/automix-runtime.client.js).
- Self-contained IIFE.
- Own state: { enabled: boolean, intervalSec: number, iv: setInterval timer handle }.
- On boot: read localStorage 'swr.capture.enabled' + 'swr.capture.intervalSec'; parse URL '?capture' param.
- Toolbar UI: appended to a designated mount point (e.g. #swr-toolbar or document.body tail).
  - Toggle button: 'Capture' (with visual indicator when enabled)
  - Numeric input: 'Every [5] seconds' (1-300 range)
  - On any change: persist to localStorage; restart timer if enabled
- When enabled: setInterval every (intervalSec * 1000) ms → canvas.toBlob → download
- Filename: 'swr-frame-{YYYY-MM-DDTHH-mm-ss}.png'
- Object URL revoked 1s after download trigger.
- Visual indicator: red dot / badge on the toggle button when enabled.

Canvas selection: prefers `document.getElementById('stage')` (engine.html convention); falls back to first `<canvas>` in DOM.
```

### localStorage keys

- `swr.capture.enabled` — `'1'` or `'0'` (default: `'0'` / disabled)
- `swr.capture.intervalSec` — JSON number, clamped to 1-300 (default: 5)

### URL param

- `?capture=10` — sets interval to 10 seconds and enables on page load. Persists in localStorage.
- `?capture=0` or absent — does not auto-enable.

---

## Files added

- `client/capture-runtime.client.js` — the runtime (~150-200 lines)
- `scripts/check-capture-unit.mjs` — unit tests for the runtime logic
- `scripts/check-capture-smoke.mjs` — Puppeteer smoke test for the integration
- `docs/CHANGELOG-2026-09-21.md` — append entry (file already exists from PRs #98, #99)

## Files modified

- `versions/engine.html` — add `<script src="../client/capture-runtime.client.js"></script>` after the existing `client/automix-runtime.client.js` tag
- `versions/film.html` — same
- `versions/grid.html` — same
- `versions/smoke.html` — same
- `versions/hallucination.html` — same
- `versions/neon.html` — same
- `AGENTS.md` — note the new client script in the Project layout section
- `scripts/check-syntax.mjs` — no change (script count is auto-discovered)
- `package.json` — add `check:capture-unit` and `check:capture-smoke` npm scripts

## Files NOT touched (deliberate non-changes)

- `versions/aurora.html` through `versions/watercolor.html` (17 artistic variants) — out of scope per the brainstorming decision
- `versions/music_video.html`, `versions/music_video_mtv.html` — out of scope
- `client/automix-runtime.client.js`, `client/automix.client.js` — feature is decoupled from automix
- The 22 surfaces' existing toolbar markup — capture-runtime appends its own UI block; no markup changes to toolbar buttons

---

## Verification

- `node scripts/check-syntax.mjs` — passes (372 + 120 baseline + 6 new script tags inline + 1 new client script)
- `npm run build` — exits 0; dist within budget
- `node scripts/check-capture-unit.mjs` — passes; covers: URL param parsing, localStorage persistence, interval clamping, enable/disable state transitions, blob download trigger
- `node scripts/check-capture-smoke.mjs` — passes in CI; covers: page.goto, canvas rendering, click toggle, wait N seconds, verify download triggered (intercepted), verify interval change restart, verify disable stops

---

## Risk

| Risk | Mitigation |
|---|---|
| Canvas tainted by cross-origin media (can't toBlob tainted canvases) | If `canvas.toBlob` returns null, log a warning to console; surface a non-blocking UI hint ("Capture disabled: cross-origin media present"). Don't crash. |
| Many rapid downloads trigger browser "this site is trying to download multiple files" prompts | Default interval is 5s; for intervals ≤2s, show a single confirmation on first download. Document the trade-off in code comments. |
| Filename collisions at high capture rates | Use millisecond precision in the timestamp suffix; collisions essentially impossible at human-paced capture. |
| localStorage corruption / quota exceeded | Wrap localStorage access in try/catch; gracefully fall back to in-memory state with a console warning. |

---

## Implementation tasks (subagent-driven)

### Task 1 — Capture runtime script
Create `client/capture-runtime.client.js`. Pure logic: URL param parsing, localStorage persistence, enable/disable, setInterval, canvas.toBlob → download. No UI rendering yet.

### Task 2 — UI toolbar block + injection
Extend `client/capture-runtime.client.js` with a self-contained UI block (toggle button + numeric input + visual indicator) appended to the toolbar mount point. Inject after a `setTimeout(0)` so the DOM is settled.

### Task 3 — HTML edits + npm scripts
Add `<script src="../client/capture-runtime.client.js"></script>` to `engine.html` + the 5 done variants (in the same `<script>` block as `client/automix-runtime.client.js`). Add `check:capture-unit` and `check:capture-smoke` to `package.json`.

### Task 4 — Unit tests
Create `scripts/check-capture-unit.mjs`. Cover: URL param parsing (valid/invalid/edge cases), localStorage round-trip, interval clamping (1-300), enable/disable state machine, blob download trigger (mocked), visual indicator state class.

### Task 5 — Smoke test
Create `scripts/check-capture-smoke.mjs`. Cover: page.goto, click toggle, wait 5s, verify file downloaded (intercepted via Playwright/CDP download event), change interval to 2s, verify timing of next download, disable, verify no further downloads after 5s.

### Task 6 — Docs
Append entry to `docs/CHANGELOG-2026-09-21.md`. Update `AGENTS.md` to mention `client/capture-runtime.client.js` in the Project layout section.

### Task 7 — Verify + push + open PR
Run `node scripts/check-syntax.mjs`, `npm run build`. Commit with conventional commits. Push. Open PR. Wait for CI.

---

## Global constraints (binding for all tasks)

1. **Don't break existing automix+curator stack.** PR #97 wiring stays intact.
2. **Don't touch the 17 artistic variants.** Out of scope per brainstorming decision.
3. **Disabled by default.** Zero behavior change for users who don't enable.
4. **Build size budget ≤ 130MB.** Current ~114MB, delta < 5MB.
5. **Conventional commits.** `feat(capture):` prefix; sub-scope per task. This task scope: `feat(capture): periodic frame capture + download`.
6. **PR & commit conventions from AGENTS.md apply.** Use `-c user.name='Kajica Djuric' -c user.email='kai.djuric@gmail.com' --author='Kajica Djuric <kai.djuric@gmail.com>'` flags on every commit.

---

## Pending tweaks

_(To be filled in by user if any of sections need adjustments.)_

## Close-out

All 5 implementation tasks landed on `feat/periodic-capture` and reviewed:

| Task | Commit | Outcome |
|---|---|---|
| 1 — runtime | `5f14e73` | PASS, 0 critical, 0 important, 5 minor observational |
| 2 — toolbar UI | `011f355` | PASS, 0 critical, 0 important, 4 minor observational |
| 3 — HTML wiring + npm scripts | `2fdcfde` (+ follow-up `3d3da2c`) | PASS with minor (chain wiring deferred to Task 4 for green-commit discipline) |
| 4 — tests + chain wiring | `beb7d80` | PASS, 56/56 unit assertions green, smoke syntax-clean |
| 5 — docs (this commit) | `a610096` | n/a |

PR opened after Task 5 lands.
