# Changelog — 2026-09-09

> Two new surfaces landed today: a public **AR Animation Loop** page
> anyone can drop a GIF into, and the **Smart Pattern Storyboard
> engine** — five reusable client modules that turn a song + a media
> library into an editor-shaped storyboard. The storyboard engine
> ships as library code only; the mount page is the next phase.

## AR Animation Loop (5 commits, ~480 LOC)

A new `/ar-loop` page lets a visitor drop a GIF or static image,
see it loop in markerless AR via the device camera, record a 5s
WebM, and share a `?demo=1` link. Built on A-Frame 1.5.0 + AR.js 3.x +
`aframe-gif-shader` (graceful-degrade if the CDN blocks the shader).
No backend, no auth, no AI call — the GIF *is* the animation.

Commits:

- `chore(ar-loop): add /ar-loop route + version card` — 2 rewrites in
  `vercel.json`, 1 `style-card` in `versions.html`.
- `feat(ar-loop): HTML page shell` — `engine-ar-loop.html` (95 LOC),
  no-camera fallback, CDN scripts pinned.
- `feat(ar-loop): upload + record + reset controller` —
  `client/ar-loop-app.client.js` (270 LOC), IIFE global-script
  pattern, `window.SWR_AR_LOOP = { state, reset, share,
  pickMimeType }`. State machine: `idle → uploading → ready →
  recording → exporting → done` (or `error`).
- `test(ar-loop): puppeteer smoke + npm script` —
  `verify-ar-loop.mjs` (111 LOC). Spins up preview, grants fake
  camera + mic, uploads a 1×1 PNG, asserts the state round-trip.
  Wired as `npm run verify:ar-loop`.
- `docs(ar-loop): user-facing doc for the new page` —
  `docs/AR-LOOP.md` (now comprehensive: overview, user flow,
  architecture diagram, state machine, file map, configuration,
  browser support, limitations, dev commands, future work).

See `docs/AR-LOOP.md` for the full reference.

## Smart Pattern Storyboard engine (5 modules, ~1525 LOC + 744 LOC of tests)

A library-grade composition pipeline that turns a song + a media
library into a deterministic, editor-shaped storyboard. The plan
called out eight phases; five of them are now shippable as
reusable browser modules, each with its own Node smoke test.

Modules + tests:

- `client/storyboard-song.client.js` (541 LOC) — **Emotional
  Analysis.** Wraps `audio-analysis-v2.js` and adds loudness /
  centroid / chroma-frames / Foote-novelty segmentation / mood
  arc / drops + breakdowns. `SWR_SONG.analyze(audioBuffer)` →
  `SongProfile`. Test: `scripts/check-storyboard-song.mjs`
  (149 LOC).
- `client/storyboard-structure.client.js` (239 LOC) — **Scene
  Identification.** Splits sections into scenes at loudness
  troughs, tags them with mood / motion / palette, assigns a
  suggested cut rate per scene kind. `SWR_STRUCTURE.segment(profile)`
  → `Scene[]`. Test: `scripts/check-storyboard-structure.mjs`
  (128 LOC).
- `client/storyboard-transitions.client.js` (193 LOC) — **Transition
  Deconstruction.** Per-scene-boundary transition type + duration
  via a `fromKind → toKind` matrix, plus sub-resolution cuts every
  N bars. `SWR_TRANSITIONS_PLANNER.plan(scenes, profile)` →
  `{ sceneList, cuts }`. Test: `scripts/check-storyboard-transitions.mjs`
  (171 LOC).
- `client/storyboard-shots.client.js` (313 LOC) — **Shot
  Documentation.** For each scene, scores the library by
  `mood × energy × palette × recency × kind × jitter`, picks one
  asset per layer-slot in the per-kind template, applies the FX
  preset + blend mode + transform. Seeded mulberry32 RNG →
  deterministic. `SWR_SHOTS.pick(scenes, library, profile)` →
  `StagedScene[]` with `layers[]`. Test:
  `scripts/check-storyboard-shots.mjs` (180 LOC).
- `client/storyboard.client.js` (239 LOC) — **Storyboard
  Creation** orchestrator. `SWR_STORYBOARD.build({ audioBuffer,
  library, opts })` → `{ storyboard, profile }`. Also
  `regenerate` / `refine` / `list` / `load` / `save` / `delete` /
  `buildSeed` (FNV-1a hash). IndexedDB + localStorage fallback.
  E2E test: `scripts/check-storyboard-e2e.mjs` (116 LOC) loads
  all four modules in a VM context and asserts a full pipeline
  build against a 12-second buffer.

Pattern Recognition, Database Organization, and Original Application
(the last 3 of the 8 phases from the plan) are scaffolded via
`SWR_PATTERNS.learn`, `applyPatterns`, and the localStorage fallback
in `storyboard.client.js`. The dedicated modules + the
`engine-storyboard.html` mount page ship in the next phase.

See `docs/STORYBOARD-ENGINE.md` for the per-module reference
(public API, data shapes, algorithms, performance notes).

## Stats

- **5 new engine-side files**: 1 HTML page, 5 client modules,
  5 Node smoke tests, 1 Puppeteer smoke test.
- **2 wire-up files**: `vercel.json` (2 rewrites),
  `versions.html` (1 style-card), `vite.config.js` (2 entries),
  `package.json` (1 verify script).
- **2 new docs**: `docs/AR-LOOP.md` (rewrite, now comprehensive),
  `docs/STORYBOARD-ENGINE.md` (new, comprehensive).
- **No edits** to existing engine subsystems (`engine-core.client.js`,
  `engine-render.client.js`, `engine-transitions.client.js`,
  `engine-timing.client.js`, `audio-analysis-v2.js`). The storyboard
  modules compose around them; they don't touch them.
