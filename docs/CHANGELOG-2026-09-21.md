# Changelog — 2026-09-21

> The automix + curator stack ports from `music_video.html` to 20 of the 22 engine
> variants via a per-variant config map. The toggle stays off by default to
> preserve the existing UX; `echo-manifold` and `tape` opt out because their
> audio-feature extraction diverges from the canonical path.

## Cross-variant automix rollout (10 commits, 23 surfaces)

The 17 artistic variants (`aurora, baroque, chrome, collage, echo-manifold,
eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, tape,
typography, void, watercolor`) now load the same `client/automix-runtime.client.js`
that `music_video.html` and the 5 core variants (neon, film, grid, smoke,
hallucination) already ship. Tuning lives in `variants/<name>.automix.json`,
inlined into the matching `versions/<name>.html` at build time by a new Vite
plugin (`vite.config.js` `inline-automix-config`). 15 of the 17 artistic variants
are `enabled: true`; `echo-manifold` and `tape` are `enabled: false` opt-outs.

- `feat(automix): port automix+curator stack to 17 engine variants (aurora,
  baroque, …, watercolor) via per-variant config map; off-by-default toggle
  matching music_video UX`

Commits (mega-PR chain, oldest first):

- `49e275a` — `docs(plan): automix v2 cross-variant port (17 variants, mega-PR)`
- `9482db8` — `feat(automix): runtime config-loader for cross-variant port` (Task 1)
- `c25ca94` — `feat(automix): runtime config-loader replaces drift amplitudes (round 1 fix)`
- `098ab53` — `feat(automix): runtime config-loader parity for tuning + label tests (round 2 fix)`
- `f59ea82` — `feat(automix): 17 variant configs + vite inline plugin` (Task 2)
- `6848752` — `feat(automix): cross-variant UI hook (17 toggle buttons + script tags)` (Task 3)
- `22dad03` — `feat(automix): opt out echo-manifold + tape (no automix stack)` (Task 3 round 1)
- `b2a9c6a` — `feat(automix): test coverage for cross-variant port` (Task 4)
- `f23b84d` — `feat(automix): smoke assertion now checks _fxOverride evolution (round 1 fix)`
- `4559525` — `docs(automix): changelog + AGENTS.md + plan close-out` (Task 5)

## Stats

- **17 new files**: `variants/<name>.automix.json` (one per artistic variant).
- **17 HTML edits**: `versions/<name>.html` (toggle + script tag injection).
- **1 runtime refactor**: `client/automix-runtime.client.js` gains a `loadConfig()`
  validator + applier; existing constants stay as the defaults.
- **1 Vite plugin**: `vite.config.js` `inline-automix-config` reads
  `variants/<name>.automix.json` at build time and inserts a
  `<script type="application/json" id="swrc-automix-config">` tag before `</head>`.
- **Test coverage**: `scripts/check-automix-unit.mjs` (55 → 58 scenarios),
  `scripts/check-automix-smoke.mjs` (15 enabled + 2 disabled variant checks),
  `verify-automix-cross-surface.mjs` (7 → 24 surfaces in the matrix).
- **No edits** to `music_video.html`, the 5 core variants, or any of the
  pre-existing engine subsystems (`engine-core.client.js`,
  `engine-render.client.js`, `engine-transitions.client.js`,
  `engine-timing.client.js`, `audio-analysis-v2.js`). The runtime composes
  around them.

## Visual Language Index (Console + marketing routes)

Adds **Console** as the 6th visual language and a marketing-style index that
surfaces all 6 languages at a dedicated route. The existing `/versions` route
keeps its release-history purpose (mapped to `versions.html` at repo root); the
new `/visual-languages` route serves the index. Wired via Vercel rewrite
(`/visual-languages` → `/versions/index.html`) and a new nav entry under Engine.

- `feat(versions): add Console as the 6th visual language + shared stylesheet
  + visual-language index at /visual-languages`

---

## Periodic frame capture

Adds a **disabled-by-default** periodic frame capture feature. Users can
opt in via a small toolbar overlay (bottom-right of the engine surfaces)
or via the URL param `?capture=N`. When enabled, the runtime captures a
PNG of the canvas every N seconds (default 5; range 1-300) and triggers
a browser download for each frame. Filenames are `swr-frame-<UTC-timestamp>.png`.

- `feat(capture): periodic frame capture runtime`
- `feat(capture): add toolbar UI (toggle + interval input + visual indicator)`
- `feat(capture): wire runtime into engine.html + 5 variants, add npm scripts`
- `fix(capture): defer check:capture-unit chain wiring to Task 4`
- `test(capture): add unit + smoke coverage, wire check chains`

### Stats

- **1 new file**: `client/capture-runtime.client.js` (436 lines, IIFE
  pattern matching `automix-runtime.client.js`).
- **6 HTML edits**: `<script>` tag added to `engine.html` + the 5 done
  variants (`versions/{neon,film,grid,smoke,hallucination}.html`),
  immediately after the corresponding `automix-runtime.client.js` tag
  so the runtime boots in the same lifecycle phase (no `defer`).
- **2 new npm scripts**: `check:capture-unit` (56 assertions, node:vm
  sandbox) and `check:capture-smoke` (Puppeteer against built
  `dist/engine`). Both wired into the appropriate `package.json` chains.
- **No edits** to `versions/music_video.html`, the 17 ported artistic
  variants, or any of the existing engine subsystems. The runtime is
  purely additive.

### Public API (window.SWR_CAPTURE)

- `enable()` / `disable()` / `isEnabled()`
- `setIntervalSec(n)` / `getIntervalSec()` (clamped 1-300)
- `getState()` → `{ enabled, intervalSec, lastCaptureAt, captureCount }`
- `captureNow()` (async via `canvas.toBlob`)
- `reset()` (clears `swr.capture.*` localStorage keys)
- Test hooks: `getToolbarEl()`, `getToggleBtn()`, `getIntervalInput()`

### Persistence keys

- `swr.capture.enabled` — `'1'` | `'0'` (default `'0'`)
- `swr.capture.intervalSec` — integer string (default `'5'`)

### URL opt-in

- `?capture=N` (1 ≤ N ≤ 300, integer) → set interval + auto-enable + persist.
- Invalid values (NaN, out-of-range, non-integer) silently fall through
  to localStorage — they do NOT auto-enable.

### Known minor: `_clampInterval` non-finite fallback

The internal `_clampInterval(NaN | 'abc' | undefined)` returns
`DEFAULT_INTERVAL` (5) rather than preserving the current value. The
unit test asserts this actual behavior. The toolbar's `<input>` handler
already guards with `if (!isFinite(n)) n = _intervalSec;` so the UI path
preserves the value — only the bare-API path snaps to default. Tracked
as a possible follow-up; not blocking this PR.

### Out of scope (intentionally)

- Capture destinations other than download (e.g. server upload, clipboard)
- Pre-capture region selection / cropping
- The 17 ported artistic variants (`aurora, baroque, chrome, collage,
  echo-manifold, eclipse, fractal, glitch, kraft, mosaic, phosphor,
  pulse, spectrum, tape, typography, void, watercolor`) and
  `versions/music_video.html` — these don't load the capture runtime
  yet; a follow-up PR can extend coverage once a use case appears.
