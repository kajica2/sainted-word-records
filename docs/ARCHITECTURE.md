# Architecture

> A map of the codebase for engineers joining the project. Read this
> before changing anything. Updated as the system grows; if you find
> something missing or wrong, fix it here.

This document is **engineer-facing** — it describes the system as it
exists in the code, not the product roadmap. For *what the product
is*, see `README.md`. For *why we built it this way*, see
`PRODUCTION-PLAN.md`. For the contributor guide, see `AGENTS.md`.

---

## 1. One-paragraph summary

A browser-native, zero-backend WebGL video engine. The user drops
in an audio file + a library of images and video clips; the engine
analyses the audio (BPM, key, beats, onsets, chromagram), maps the
features to per-layer visual reactors (scale / opacity / hue / …),
and renders a real-time WebGL composition. Everything runs in the
browser. The server is a thin Vercel layer that hosts static files
and a small set of API endpoints for auth + project save/load.

The product is sold as three tiers (see `README.md`); the engine
itself is MIT-licensed and free. The code you have in front of you is
the engine.

---

## 2. Repository layout

```
sainted-word-records/
├── engine.html              # legacy single-page engine (still served, no auth)
├── swr-app.html              # current SPA at /engine/ (PWA install target)
├── landing.html              # marketing splash at /
├── versions/                 # 23 preset pages (neon, film, grid, …)
│   ├── music_video.html      # the gradient-panel + automix page (post-2026 work)
│   └── _*.js                # 10 build-time inject scripts (recorder, layout, mobile, etc.)
├── engine-*.client.js        # 11 engine subsystems, all loadable as IIFEs
├── client/                   # new modules written post-2026
│   ├── preset-anchor-map.client.js   # 19 named presets → 2D warmth/intensity coords
│   ├── anchor-embed.js               # audio features → warmth/intensity (shared)
│   ├── automix.client.js             # feature-weighted preset blender
│   ├── last-mix-store.client.js      # debounced localStorage (last blend)
│   ├── layer-state-store.client.js   # debounced localStorage (Layers.list)
│   ├── preset-cycle.client.js        # Tab / Shift+Tab cycle helper
│   ├── preset-pick-store.client.js   # persisted manual pick
│   ├── visualizer-controller.js      # gradient panel IIFE
│   └── library-loader.client.js      # auto-load /library/manifest.json
├── lib/                      # ~27 shared utilities (auth, media, recorder, …)
├── api/                      # Vercel serverless handlers (12 route files + 4 _lib helpers)
│   ├── _lib/                 # db, http, session, email
│   ├── auth/                 # magic-link, verify, session (3 files)
│   ├── storage/              # signed upload/download, object streaming (3 files)
│   ├── projects/             # CRUD + share-by-id (3 files: index, [id], share/[shareId])
│   ├── manifest.js           # curated library/manifest.json builder
│   ├── health.js             # liveness probe
│   └── hf-upload.js          # Magenta DSP procedural asset upload
```

The Vercel deployment is static files plus 12 serverless endpoints
(see §8). The build is a custom Vite config that strips
`type="module"` from scripts tagged with absolute paths
(`/pwa-bootstrap.js` etc.) so they load as plain `defer`'d scripts.

---

## 3. The render pipeline

This is the heart of the engine. The data flow is:

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│ audio file  │───▶│ AudioContext │───▶│ Audio.feat   │
│  (mp3/wav)   │    │ + Analyser   │    │ {bass,mid,   │
└─────────────┘    └──────────────┘    │  treble,beat,│
                                        │  …}         │
                                        └──────┬───────┘
                                               │ every animation frame
                                               ▼
┌────────────────┐  ┌──────────────┐  ┌─────────────────────┐
│ Layer (user)   │  │  Reactor     │  │  applyR(layer)     │
│ {id, asset,    │─▶│  {feature,   │─▶│  returns {scale,   │
│  blend, …}     │  │   target,    │  │   x, y, rot, …}    │
└───────┬────────┘  │   scale,     │  └─────────┬───────────┘
        │           │   ease}      │            │
        │           └──────────────┘            │
        ▼                                        ▼
┌──────────────────────────────────────────────────────────┐
│  drawToCtx(layer, r, ctx, w, h)                          │
│  → ctx.globalCompositeOperation = layer.blend              │
│  → ctx.globalAlpha = r.opacity                            │
│  → ctx.drawImage(asset._el, transform(r), …)              │
│  → 2D canvas blitted into WebGL `stage` (texture)          │
│  → fragment shader applies 19-preset GLSL post-process     │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Where the audio features come from

`Audio` (defined inline in each version page; `audio-analysis-v2.js`
ships a parallel zero-deps path for embedded use) owns:

- `AudioContext` + `AnalyserNode` (fftSize 2048, smoothing 0.6)
- `feat = { bass, mid, treble, air, sub, rms, centroid, beat, onset, … }`
  recomputed every audio frame (~60Hz at the analyser rate)
- `beat` decays smoothly (1 → 0 over `params.decay`), so a single
  hit doesn't snap the whole composition to silence
- `beats[]` is a rolling 8-second window of recent beat timestamps;
  the BPM estimator reads it (`beats.length >= 4` → average interval
  → `bpm`)

### 3.2 Where the visual features come from

Each layer in `Layers.list` is a plain object with reactor mappings.
```js
{
  id: 'L1',
  asset: { type: 'video' | 'image', url, w, h, _el: <HTMLVideoElement|Image> },
  blend: 'screen' | 'multiply' | …,
  opacity: 0.5, baseScale: 1.2, hue: 0, brightness: 1, contrast: 1,
  reactors: [
    { feature: 'bass',  target: 'scale',    scale: 0.7, ease: 'sharp' },
    { feature: 'beat',  target: 'opacity',  scale: 0.6, ease: 'sharp' },
  ],
}
```

`applyR(layer)` (defined inline in each version page's IIFE, e.g.
`versions/music_video.html:833`)
returns `{ scale, x, y, rot, opacity, hue, brightness, contrast, _v }`
by walking `layer.reactors`, fetching the matching `audio.feat`
field, and applying `ease` to the result. The output `r._v` is a
content hash the engine uses for render-cache invalidation.

### 3.3 Where the LFO modulators come from

`engine-lfos.client.js` exposes `window.SWR_LFOS.apply(dt, layer, r)`
which adds per-frame LFO modulators to `r` after `applyR`. The LFO
registry reads `.sample()` and writes back into `r` via a per-target
merger that mirrors `applyR`'s math. LFO cadence uses `window.SWR_FRAME_DT`
so it's frame-rate independent.

### 3.4 The render cache

`engine-render.client.js:frame()` walks `Layers.list`, calls
`applyR`, `T.step(dt, l, r)`, `SWR_LFOS.apply(...)`, computes a content
hash from `r` + `l.asset.id` + the audio fingerprint, and
**caches the rendered offscreen canvas by `(layerId, version)`**.

The cache key components:

- `version` = `hashVersion(r._v + r.scale + r.x + r.y + r.rot + …)` —
  changes on any reactor or audio change
- `lastDpr` = `state.dpr` — invalidates on DPR change
- `lastSize` = `state.cssW + 'x' + state.cssH` — invalidates on resize

`invalidate(layerId)` deletes one entry. `state.dirty = true`
invalidates everything (set on resize, layout change, asset swap).
The cache lets the engine hit 60fps with multiple video layers —
without it, every frame re-decodes every video.

The known sharp edge: if a layer's `drawToCtx` early-returns (e.g.
video asset's `readyState < 2`), the engine still caches the
**empty** offscreen. The fix in `versions/music_video.html`'s
`drawLayer` is to wire `canplay` → `SWR_RENDER.invalidate(l.id)` so
the cache is busted once the video finally loads. See `docs/`
release notes (PR #21) for the full story.

### 3.5 The GLSL post-process

`versions-presets.js` defines 19 named presets in a JS table
(PRESETS = { neon, film, grid, … }). Each entry has the 8 FX
parameters (temp, mut, chroma, sepia, grain, glow, grayscale,
posterize) plus `tint`, `effect`, `vignette`, `mutAlgo`. The page
maps to a specific preset via `<body data-page="neon">` (or falls
back to `detectPageFromTitle()`).

The GLSL fragment shader takes the rendered 2D canvas as a texture
and applies the preset's FX parameters as a post-process pass. The
`mutAlgo` field controls which mutation algorithm is in use
(many-body, swarms, particles, …).

The audio-reactive override path: `music_video.html` reads
`window.SWR._fxOverride` (set by the automix tick) and blends the 8
FX fields with the static page preset at a `HologramState.depth`-
weighted ratio. So:
  - depth=0 → pure static neon (override ignored)
  - depth=0.4 → 60/40 mix (PR #9 default, fallback when no slider)
  - depth=1 → override fully dominates

---

## 4. The engine subsystems

All eleven `engine-*.client.js` files are IIFE scripts that
register on `window.SWR_*` namespaces. They depend on each other in a
specific order; `swr-app.html` and the version pages load them with
explicit `<script>` tags. Dependency order is roughly:

```
visualizer-controller.js   ← no deps, runs first
audio-analysis-v2.js       ← no deps
engine-render.client.js    ← canvas, setBackground
engine-timing.client.js     ← crossfade
engine-lfos.client.js      ← audio features (consumes Audio.feat)
engine-automap.client.js   ← recipes
engine-genops.client.js     ← mutators, lockable fields
engine-keys.client.js      ← keyboard shortcuts (M/E/R/Z/?/A)
engine-settings.client.js  ← panel UI
engine-layout.client.js    ← dock/fullscreen
```

### 4.1 Subsystem responsibilities

| Subsystem | Exposes | Responsibility |
|---|---|---|
| `engine-render` | `window.SWR_RENDER` | 2D canvas → WebGL texture → GLSL post-process; render cache |
| `engine-timing` | `window.SWR_TIMING` | Crossfade between presets, fade-in/fade-out curves |
| `engine-lfos` | `window.SWR_LFOS` | Per-layer LFO modulators on top of `applyR` |
| `engine-automap` | `window.SWR_AUTOMAP` | "Auto-map audio features to layer params" recipes |
| `engine-genops` | `window.SWR_GENOPS` | Generative operators (mutate, evolve, randomize) + seeded RNG |
| `engine-keys` | `window.SWR_KEYS` | Keyboard shortcuts (M/E/R/Z/?/A + Cmd+1..9 preset map + brackets/comma/period/semicolon/quote nudges) |
| `engine-settings` | (panel UI) | User-facing settings drawer |
| `engine-layout` | `window.SWR_LAYOUT` | Floating engine window: drag, resize, fullscreen, dock, minimize |
| `engine-timing-panel` | (panel UI) | Timing curve editor |
| `engine-lfo-panel` | (panel UI) | LFO editor |
| `engine-panel-visibility` | (panel UI) | Panel show/hide |
| `audio-analysis-v2` | (self-contained) | Zero-deps BPM/key/chromagram for embedded use |

### 4.2 The `client/` modules (post-2026 work)

These are smaller, single-purpose modules written after the initial
release. They have explicit, narrow contracts:

| Module | Window global | What it does |
|---|---|---|
| `preset-anchor-map.client.js` | `window.SWR_ANCHOR_MAP` | Maps the 19 GLSL presets to 2D `(warmth, intensity)` coordinates; exposes `list()`/`get(id)`/`neighbours(coords, n)`/`embed(presetObj)` |
| `anchor-embed.js` | `window.SWR_ANCHOR_EMBED` | Pure function `featuresToCoords({bass,mid,treb}) → {warmth, intensity}`. Shared by the gradient panel and the automix mixer. |
| `automix.client.js` | `window.SWR_AUTOMIX` | `mix(features, neighbours)` → blended preset + neighbour list. `drift(preset, beat)` adds BPM-scaled mutation. |
| `last-mix-store.client.js` | `window.SWR_LAST_MIX` | Debounced localStorage wrapper for the last automix blend (so the "ghost dot" on the gradient panel survives a reload). |
| `layer-state-store.client.js` | `window.SWR_LAYER_STATE` | Debounced localStorage wrapper for `Layers.list` metadata (assets stripped — Blob URLs die on reload). |
| `preset-cycle.client.js` | `window.SWR_PRESET_CYCLE` | Pure cycle over `VersionsPresets.SHORTCUT_PRESETS` (9-item shortcut list). `next(prev)`, `prev(prev)`, `first()`, `last()`, `rebuild()`. |
| `preset-pick-store.client.js` | `window.SWR_PRESET_PICK` | Plain localStorage wrapper for the user's last manual preset pick. |
| `library-loader.client.js` | (no global) | Auto-loads `/library/manifest.json` on boot and seeds `Lib.items` (skipped on `music_video.html` — see §6). |
| `visualizer-controller.js` | (no global) | The gradient-panel IIFE on `music_video.html`. Manages `#gradient` canvas, anchor rendering, ghost dot, automix ring, neighbours list, click-jump. |

All of these are pure-ish (no DOM, no audio, no engine mutation) and
unit-testable under Node. The unit tests live in `scripts/check-*.mjs`
and run via `npm run check:*` (see §7 for the test surface).

---

## 5. The data model

The single most important data structure is **`Layers.list`**:

```js
[
  {
    id: 'L1',                          // unique within the page
    asset: { type, url, w, h, _el },   // media reference
    blend: 'screen',                    // composite mode
    opacity: 0.5,                       // 0..1.5
    baseScale: 1.2,                     // initial transform scale
    hue: 0,                             // degrees, additive
    brightness: 1, contrast: 1,         // multipliers
    alpha: 1, mutate: 0,                // legacy compat (alpha, mutate)
    reactors: [                         // 0..N reactor mappings
      { feature: 'bass', target: 'scale', scale: 0.7, ease: 'sharp' },
      { feature: 'beat', target: 'opacity', scale: 0.6, ease: 'sharp' },
    ],
  },
  …
]
```

A layer is "live" if `asset._el` is a loaded `<video>` or `<img>`
element. **Asset references are not persisted** — Blob URLs die on
reload, and the music_video page is session-private. The
`layer-state-store.client.js` strips the `asset` field on save;
on restore, the layer has its sliders + reactors but `asset: null`.
The user re-uploads via `+` to slot media back in. See PR #19.

Other key state:

| State | Owner | Persisted? | Notes |
|---|---|---|---|
| `Audio` (`feat`, `gain`, `el`, `beats[]`) | inline IIFE per page | no | Rebuilt from file on load |
| `HologramState = { depth, neighbours }` | inline IIFE (music_video) | no | Per-session; restored via gradient anchor ring on reload |
| `Layers.list` | inline IIFE per page | **yes** (PR #19) | Metadata only, debounced 1s |
| `lib.items` (uploaded library) | inline IIFE per page | no (IDB) | `lib/persist.client.js`. `Lib.removeItem(id)` (PR #23) revokes the blob URL, calls `Layers.cleanupForAsset(it)`, and re-renders. |
| `SWR_AUTOMIX` state | inline IIFE (music_video) | partial | Last mix snapshot persists (`last-mix-store`); current cycle state doesn't |
| `SWR_PRESET_PICK` | `preset-pick-store.client.js` | **yes** (PR #18) | Last manual Tab/Shift+Tab pick |
| `SWR_LAST_MIX` | `last-mix-store.client.js` | **yes** (PR #12) | Last automix blend snapshot |
| `SWR_LAST_SONG` | `versions/last-song.js` | **yes** (IDB) | Last uploaded audio file (engine.html + version pages) |

---

## 6. Pages and what they do

There are **23 version pages** in `versions/` plus the SPA at
`swr-app.html` plus the engine at `engine.html`. They share the
engine subsystems but have different page-specific presets and
onboarding flows.

### 6.1 The 23 `versions/*.html` pages

Each one is a `<body data-page="X">` + an inline IIFE that sets up
audio, layers, and the engine. The preset comes from `versions-presets.js`
table; the GLSL shader is the same for all (one fragment shader,
19 presets). Differences are the page-specific FX parameters, the
library (curated or session-private), and the onboarding.

Notable: **`music_video.html`** is a fork with extra UI:

- Replaces the layers panel with a **gradient panel** (canvas +
  neighbours list) — see `client/visualizer-controller.js`
- Has the **Automix** toggle (PR #9) which re-derives the FX blend
  from audio features every 2s
- Has the **Tab / Shift+Tab** preset cycle (PR #16)
- Has a **Backspace** shortcut + `↺ Layers` button to reset all
  layers (PR #15)
- Auto-restores the last manual preset pick (PR #18) and the last
  layer state (PR #19)
- Each library thumbnail has a **small `×` button** in the top-right
  corner (PR #23) for deletion: click once to arm, click again
  within 1.5 s to confirm. `Lib.removeItem(id)` revokes the blob
  URL and drops any layers referencing the asset.
- Does **not** auto-load `library/manifest.json` (session-private)

### 6.2 `swr-app.html` — the SPA

The current PWA install target. Loads the full engine subsystems,
plus the persistence and recorder modules. Has the
`/versions/music_video.html` route mounted inline as a PWA
deep-link. 5-tab sidebar (Presets / Layers / Media / Brand / Social).

### 6.3 `engine.html` — the legacy page

The pre-SPA engine. Still served at `/engine` via Vercel rewrite
and at `/engine.html` directly. No auth, no sidebar, no SPA shell.
Maintained for compatibility with existing deep links.

### 6.4 Onboarding

Every page that needs audio shows an auto-start overlay
(`#swr-start`) that requires one user gesture (browser autoplay
policy). Click → opens the file picker → loads the file → fades
the overlay out over 600ms. The page remembers the last-loaded
audio file in IDB (`SWR_LAST_SONG`) and auto-plays it on next
visit (until the user clicks ↺ to reset).

---

## 7. Testing

The test surface is the script-of-scripts `scripts/`, not a
`tests/` directory. The convention is `check-*.mjs` for unit/smoke
tests and `verify-*.mjs` for end-to-end Puppeteer scripts that need
a real session (login, cookies, project state).

### 7.1 The unit suites (run via `npm run check:*-unit`)

Two waves of unit tests:

**Older tests** (pre-this-session, exercise the core engine):

| Script | Coverage | Assertions |
|---|---|---|
| `check-p35-unit.mjs` | P3.5 performance-control layer (M/E/R/Z/?/A shortcuts, undo/redo, scope filtering) | 48 |
| `check-gif-unit.mjs` | GIF decoder (`lib/gif-decoder.client.js`) | 8 |

**Post-2026 unit tests** (this session, exercise the new
music_video surface and the `client/` modules):

| Script | Coverage | LOC |
|---|---|---|
| `check-automix-unit.mjs` | `SWR_AUTOMIX.mix`, `featuresToCoords`, `drift(preset, beat)` with BPM scaling | 169 |
| `check-gradient-dot-unit.mjs` | Shared `SWR_ANCHOR_EMBED` math, `SWR_AUTOMIX` delegation | 106 |
| `check-depth-blend-unit.mjs` | Pure `blendFxOverride(preset, ov, depth)` helper | 155 |
| `check-last-mix-unit.mjs` | `SWR_LAST_MIX` debounce + validation + idempotent IIFE | 156 |
| `check-get-preset-unit.mjs` | `__SWR_GET_PRESET` returns normalised fx_state | 121 |
| `check-preset-cycle-unit.mjs` | `SWR_PRESET_CYCLE.next/prev` wrap-around + rebuild | 40 |
| `check-preset-pick-unit.mjs` | `SWR_PRESET_PICK` save/load/clear + non-SHORTCUT_PRESETS ids | 154 |
| `check-layer-state-unit.mjs` | `SWR_LAYER_STATE` debounce + asset stripping + shape validation | 241 |
| `check-with-dist-unit.mjs` | `scripts/with-dist.mjs` skip/build/error paths | 172 |

**Total: 56 + 94 = 150 unit assertions** across 11 suites, plus
`check-syntax.mjs` (every JS file parses) and `check-manifest.mjs`
(`library/manifest.json` is valid).

### 7.2 The smoke tests (run via `node scripts/check-*-smoke.mjs`)

Both newer smoke tests require a built `dist/`. `scripts/with-dist.mjs`
auto-builds if missing (PR #14), so contributors don't need to
remember to run `npm run build` first.

**Post-2026 smokes** (exercise the music_video surface):

| Script | Coverage | Assertions |
|---|---|---|
| `check-mv-smoke.mjs` | `versions/music_video.html` boot, gradient panel, anchor map, sliders | 18 |
| `check-automix-smoke.mjs` | Music_video + automix + layer state + preset cycle + video error handling + library remove (PR #23) | 46 |

`check-automix-smoke.mjs` is the comprehensive regression test for
the post-2026 work — it exercises every public API the music_video
page exposes (gradient setTrack/setBeatPulse/setAutomixAnchor/
setNeighbours/setGhostDot, versions setPresetOverride, automix
toggle, layer reset, video error handling, cache-bust on canplay).

**Older smokes** (pre-this-session, not gated by `check:full`):

| Script | Coverage |
|---|---|
| `check-p35-smoke.mjs` | P3.5 keyboard surface on the swr-app SPA |
| `check-gif-smoke.mjs` | Animated GIF layer path (requires full media context) |

### 7.3 The `verify-*.mjs` scripts

There are **74** Puppeteer end-to-end scripts at the repo root
(not in `scripts/`). Only 5 of them gate PRs (per
`docs/CI-VERIFY-STRATEGY.md`); the rest are developer aids that
run on demand against a live deployment. They cover everything
from `verify-cloud-auth` (auth round-trip) to `verify-film-audio`
(per-version film audio reaction) to `verify-clip-tools` (image
upload + drag-and-drop).

### 7.4 Test infrastructure

- `scripts/with-dist.mjs` exports `ensureDist()` and `serveDist(port)`.
  Both smoke tests call `ensureDist()` so a missing `dist/`
  auto-rebuilds. `serveDist()` is available for future scripts.
- The `check` npm script chains: syntax → manifest → bundle →
  all 9 unit suites → API tests. `check:full` adds the verify
  smoke + automix smoke.

### 7.5 The `engine-improvement-worker` skill

There's a `skill_view('engine-improvement-worker')` registered for
autonomous scan-and-improve loops. It walks the engine for
performance wins, writes long-running integration plans to
`.improvements/`. Use it when you want a long session of background
optimization.

---

## 8. API surface (server-side)

`api/_lib/` is the shared helper layer:

| Module | Purpose |
|---|---|
| `db.js` | Tiny key-value wrapper over Vercel KV in production, in-memory map in dev. Used by all `api/*` routes. |
| `http.js` | Response helpers (`send(res, status, body)`), CORS, request ID, rate-limit accounting. |
| `session.js` | `swrc_session` HttpOnly cookie + 30-day rolling TTL. Magic-link issuance + verification. |
| `email.js` | Resend wrapper for magic-link emails. `process.env.RESEND_API_KEY`. |

The `api/` routes:

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/magic` | none | Rate-limited 10/min/IP. Sends magic link via Resend. |
| `GET /api/auth/verify` | none | Consumes the magic-link token, sets the session cookie, redirects. |
| `GET /api/auth/session` | cookie | Returns `{ user, isAdmin }` or 401. |
| `POST /api/auth/session` | cookie | Destroys the session. |
| `POST /api/storage/sign-upload` | session | Rate-limited 60/min/user. Returns a signed URL for Vercel Blob. |
| `POST /api/storage/sign-download` | session | Rate-limited 120/min/user. |
| `GET /api/storage/object` | signed URL | Streams from Vercel Blob. |
| `GET/POST /api/projects` | session | List / create user projects. |
| `GET/PUT/DELETE /api/projects/[id]` | session | Read / update / delete one project. Rate-limited 30/min/user on writes. |
| `GET /api/projects/share/[shareId]` | none | Anonymous public-share read. 404 if `share: false` or unknown. |
| `GET /api/manifest?action=*` | optional | Builds `/library/manifest.json` from the curated library. Used by `library-loader.client.js`. |
| `GET /api/health` | none | Liveness probe. Returns `{ status: 'ok', counts: … }`. |
| `POST /api/hf-upload` | none (HF token) | Magenta DSP procedural asset upload. Used by `tools/hf-publish.html`. |

All storage paths go through `safeKey()` which rejects `..`, leading
`/`, and `\` to prevent traversal. The path format is
`userId/...` — never escaped from the userId scope. Trust
boundaries (rate limits, signed URLs) are at the route layer, not
in the helper layer.

See `SECURITY.md` for the full threat model and `docs/CROSS-APP-BRIDGE.md`
for how the SPA, version pages, and engine all share the same auth
cookies.

---

## 9. The build

`npm run build` → `prebuild` (fetches the library from
`LIBRARY_BLOB_URL`) → `vite build` → `dist/`.

Vite is configured to NOT bundle `api/` (they're serverless
functions, not browser code). The custom `strip-absolute-module-scripts`
Vite plugin rewrites `<script src="/foo.js">` (absolute path) to
`<script src="foo.js">` and **removes the `type="module"` attribute**
so the script loads as a plain `defer`'d script. This is what lets
the engine's IIFE-based subsystems (`window.SWR = {…}`) work
without a module bundler.

The build's output target is `dist/`. `dist/index.html` doesn't
exist on purpose — the project intentionally has no root index
(see `PR-site-structure.md`).

`npm run dev` → Vite dev server on `:5174`. `npm run preview` → static
served from `dist/` on `:4173`. `npm run build:vercel` → same as
`build` but with the library-fetch prebuild forced on.

---

## 10. Deployment

Pushed to `main` → Vercel auto-deploys. The build is fast (Vite + the
copy-static plugin).

Vercel-specific gotchas:

- `LIBRARY_BLOB_URL` is a Vercel project env var. Without it, the
  build skips library hydration and the engine ships without demo
  assets. Locally, this is fine (the engine has no library to
  demo). On Vercel, the env var must be set or the engine is
  empty in production.
- `RESEND_API_KEY` is set on Vercel only. Magic-link emails don't
  work locally.
- The `LIBRARY_BLOB_URL` URL must be a Vercel Blob public URL; the
  prebuild script downloads the tarball and unpacks it into
  `library/`.

See `docs/VERCEL-DEPLOY.md` for the deploy pipeline and
`docs/CI-VERIFY-STRATEGY.md` for the 5 verifiers that gate PRs.

---

## 11. Where to start when changing something

| You want to | Read this | Touch this |
|---|---|---|
| Fix a bug in the render pipeline | §3 + `engine-render.client.js` | `engine-render.client.js`, maybe `versions-presets.js` |
| Add a new audio feature | §3.1 + `audio-analysis-v2.js` | `audio-analysis-v2.js`, then the `feat` consumers (`anchor-embed.js`, `automix.client.js`) |
| Add a new GLSL preset | `versions-presets.js:PRESETS` | Add to the table; if it should be in the shortcut cycle, append to `SHORTCUT_PRESETS` too |
| Add a new engine subsystem | §4.1 — pick the closest existing one, copy its shape | New `engine-foo.client.js` + new `window.SWR_FOO` global + script tag in all the page templates |
| Add a new page | `versions/neon.html` is the canonical one (or `versions/music_video.html` for the gradient panel variant) | Copy + edit `data-page` + inline IIFE |
| Add a server endpoint | §8 | New `api/foo.js` exporting a default handler; helpers in `api/_lib/` |
| Add a new store (persisted state) | `client/last-mix-store.client.js` or `client/layer-state-store.client.js` are the templates | New `client/foo-store.client.js`; use a versioned localStorage key (`swr.foo.v1`) |
| Improve the smoke tests | `scripts/check-automix-smoke.mjs` (most comprehensive) | Add assertion at the bottom, before the `await browser.close()` |
| Speed up the render | `engine-render.client.js` (cache key, DPR, offscreen recycling); `versions-presets.js:1187` (preset heavy ops); check `.improvements/` for past analyses | The `.improvements/` directory holds journal entries from prior improvement loops |
| Add a Puppeteer end-to-end check | `verify-cloud-auth.mjs` (auth check), `verify-rotation-enabled.mjs` (engine interaction) | New `verify-foo.mjs` at repo root; wire into `package.json` `verify:*` if it should gate PRs |

---

## 12. What this doc deliberately doesn't cover

- **The product roadmap.** That's `PRODUCTION-PLAN.md`.
- **Sprint-by-sprint changelogs.** Use `git log --oneline` for the canonical
  record; the post-2026 work is ~22 PRs in this session.
- **The marketing surface.** `landing.html`, `campaign.html`, etc. are
  products, not the engine. They have their own data and styles.
- **The audio analysis internals.** `audio-analysis-v2.js` is
  self-contained and zero-deps; read it directly if you need to
  change it. The Web Audio path is inline in the page IIFEs.
- **The GLSL fragment shader.** Lives in `versions-presets.js`
  between lines 419 and 730 (~310 lines of GLSL, heavily commented
  in the source). The shader is a single fragment shader with a
  per-page `u_effect` switch; the per-page effects are baked
  inline (not separate shader programs).

If this doc is wrong about something, fix the doc. If the doc is
missing something you needed, add it. The next person who joins
this project should be able to answer "where does the audio data
go?" in under a minute by reading this file.