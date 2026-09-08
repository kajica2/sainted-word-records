# music_video.html — reference

> Gradient preset engine: drop a track, the engine synthesizes a preset and
> shows related anchor presets as reactive neighbours.
>
| **Status:** Phases A (gradient panel renders 19 anchors) + B (current-song
dot) + C (shared `anchor-embed.js`) + D (populated neighbours list) +
Automix (self-evolving toggle) all shipped. See §9 for the post-2026
additions (Layers reset, Tab cycle, library × button).

**Live URL:** `https://sainted-word-records.vercel.app/versions/music_video.html`
**Canonical path:** `versions/music_video.html`
**Shipped in:** PR #4 (gradient foundation) · PR #8 (bug fixes) · PR #9 (automix toggle) · PRs #10–#19 (phases B/C/D + Layer reset + Tab cycle + persistence + video error handling + cache-bust) · PR #23 (library × button) · PR #25 (Solo layer toggle)
**First-merge SHA:** `c1591e3` (PR #4)
**Current production SHA:** see `git log --oneline origin/main -1`

---

## Table of contents

1. [What the page is](#1-what-the-page-is)
2. [Boot sequence](#2-boot-sequence)
3. [Public API surface (window globals)](#3-public-api-surface-window-globals)
4. [Keyboard map](#4-keyboard-map)
5. [On-load flow (the one-shot onboarding)](#5-on-load-flow-the-one-shot-onboarding)
6. [Render loop and the automix override](#6-render-loop-and-the-automix-override)
7. [Test surface](#7-test-surface)
8. [How to extend](#8-how-to-extend)
9. [Post-2026 additions](#9-post-2026-additions)
10. [Cross-references](#10-cross-references)

> **Looking for the system-level architecture?** See
> [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the full repository
> map (engine subsystems, API surface, build pipeline, deployment).
> This doc covers `versions/music_video.html` specifically.

---

## 1. What the page is

`versions/music_video.html` is a neon-cloned engine page (`<body data-page="neon">`
after PR #8) with two additions on top of the standard versions/* surface:
   - A **gradient panel** in the left aside (replacing the standard layers list)
     showing 19 anchor presets as dots on a 2D `warmth × intensity` canvas.
   - A footer **Automix** toggle (also bound to the `A` key) that, while ON,
     re-derives the active GLSL preset every 2s by blending the N nearest
     anchors weighted by live audio features.

The page is **session-private by default** — no curated library auto-loads.
The user must drop a song (saved to IDB via `SWR_LAST_SONG_SAVE`) before any
visual reactivity kicks in. The bundled audio path was deliberately removed
(PR #4, see comment at music_video.html:955).

## 2. Boot sequence

The HTML loads scripts in three layers. **Order matters** — modules in
layer 2 depend on layer 1 being defined, and the page's inline IIFE (layer 3)
defines `window.SWR` last.

### Layer 1 — pure modules (no DOM dependencies, IIFE-bound to `window`)

| Order | Script | Exposes |
|-------|--------|---------|
| 1 | `../client/library-loader.client.js` | `SWR_LIBLOAD` |
| 2 | `../client/visualizer-controller.js` | layer/visualizer state |
| 3 | `../engine-render.client.js` | render-pipeline helpers |
| 4 | **`../client/preset-anchor-map.client.js`** | **`SWR_ANCHOR_MAP`** |
| 5 | **`../client/automix.client.js`** | **`SWR_AUTOMIX`** |
| 6..13 | engine-* subsystems | various engine internals |
| 14 | `../lib/reset-state.client.js` | `SWR_RESET_STATE` |

### Layer 2 — page-local modules

| Script | Exposes |
|--------|---------|
| `./last-song.js` | `SWR_LAST_SONG` (Promise), `SWR_LAST_SONG_SAVE`, `SWR_LAST_SONG_CLEAR`, `SWR_PICK_DEFAULT_SONG` |
| `../lib/persist.client.js` + `persist-wire.client.js` | per-user persistence |

### Layer 3 — inline IIFE (music_video.html:531 onward)

Defines `A` (audio), `Lib` (library), `Layers` (reactor layers), `Recorder`,
`Gradient` (canvas gradient renderer), `HologramState`, and finally:

```js
window.SWR = { Audio: A, Library: Lib, Layers, Recorder, Gradient, HologramState,
               get stage() { return stage; }, get ctx() { return ctx; } };
```

After that point, `window.SWR._fxOverride` may be written by the automix
controller (see §6).

### Layer 4 — post-IIFE scripts

| Script | Role |
|--------|------|
| `../versions-presets.js` | applies the GLSL preset (`neon`) to `#render`; reads `_fxOverride` each frame |
| `./temp-slider.js` | temperature slider override |
| `../engine-genops.client.js` | generative operators (mutate/evolve/randomize) |

## 3. Public API surface (window globals)

These are stable contracts other modules can rely on. Anything not listed here
is internal and may change.

### `window.SWR_AUTOMIX` — `client/automix.client.js`

| Method | Returns | Notes |
|--------|---------|-------|
| `mix(features, neighbours?)` | `{ coords, anchors: [{id, dist}], preset }` \| `null` | Pure. `features = { bass, mid, treble }` (from `SWR.Audio.feat`). `neighbours` defaults to `HologramState.neighbours`. |
| `featuresToCoords(features)` | `{ warmth, intensity }` | Pure. Bass-dominant → warm; treb-dominant → cool. |
| `blendAnchors(anchors)` | `fx_state object` (8 fields) | Pure. Weighted by `1/(dist + ε)`. |
| `drift(preset)` | `fx_state object` | Pure. Bounded ±0.02 step, clamped to `[-1, 1]`. |

### `window.SWR_ANCHOR_MAP` — `client/preset-anchor-map.client.js`

| Method | Returns | Notes |
|--------|---------|-------|
| `list()` | `string[]` | 19 preset ids: `film`, `neon`, `smoke`, `hallucination`, etc. |
| `get(id)` | `{ warmth, intensity, preset }` \| `null` | Rank-blended anchor. |
| `embed(presetObj)` | `{ warmth, intensity }` | Raw embed for synthesized presets. |
| `rawEmbed(presetObj)` | `{ warmth, intensity }` | Same as `embed`, alias. |
| `neighbours(coords, n=4)` | `[{ id, dist, anchor }, …]` | Asc by euclidean dist in (warmth, intensity). |
| `_all()` | anchor map | Diagnostics only. |
| `_rawEmbed(preset)` | `{ warmth, intensity }` | Diagnostics only. |

### `window.SWR_LAST_SONG*` — `versions/last-song.js`

| Symbol | Type | Notes |
|--------|------|-------|
| `SWR_LAST_SONG` | `Promise<{ blob, name, type, savedAt } \| null>` | **Not a function.** Await directly. Resolves to `null` if IDB is unavailable or no song saved. |
| `SWR_LAST_SONG_SAVE(file)` | `Promise<void>` | Persist file to IDB; refreshes `SWR_LAST_SONG` cache. |
| `SWR_LAST_SONG_CLEAR()` | `Promise<void>` | Delete IDB record; resets `SWR_LAST_SONG` to `null`. |
| `SWR_PICK_DEFAULT_SONG(fallbackUrl)` | `Promise<{ blob, name, url, source } \| null>` | Saved song wins, else fetches `fallbackUrl`. |

> **Bug history:** Pre-PR #8 the page called `window.SWR_LAST_SONG()` as a
> function and threw `TypeError`. The fix awaits the Promise directly. See
> `client/automix.client.js:featuresToCoords` for the recommended pattern.

### `window.SWR` — inline IIFE

| Property | Type | Notes |
|----------|------|-------|
| `SWR.Audio` | `A` object | Methods: `load(file)`, `play()`, `pause()`, `stop()`, `unlock()`. **Feeds `feat = { bass, mid, treble, beat, … }` every frame.** |
| `SWR.Library` | `Lib` object | User uploads only — does **not** auto-fetch curated library/. Methods: `addFiles(files)`, `render()`, **`removeItem(id)`** (PR #23, revokes blob URL, drops layers), **`window.SWR_LIB` global** for test access. |
| `SWR.Layers` | `{ list, add(layer), rm(id), reset(), cleanupForAsset(it), **solo(id)**, **soloOff()** }` | Per-layer reactors (mutate, alpha, etc.). `Layers.reset()` clears all layers and wipes the layer-state-store (PR #19). `solo(id)` pins one library video as the only entry in `Layers.list` while leaving the GLSL composer + audio reactivity running; `soloOff()` restores the prior list from an in-memory snapshot (PR #25). |
| `SWR.Recorder` | recorder | MediaRecorder wrapper. |
| `SWR.Gradient` | `{ refresh(), setTrack(coords), setBeatPulse(0/1), setNeighbours([ids]), setAutomixAnchor(0..1) }` | Gradient canvas controls. PR #10 added `setTrack` + `setBeatPulse`; PR #13 added `setNeighbours`. |
| `SWR.HologramState` | `{ depth, neighbours }` | Reactive to sliders + footer. |
| **`SWR._fxOverride`** | `fx_state \| null` | **Written by automix.** Read by `versions-presets.js` render loop each frame. See §6. |

### `window.SWR_LIB` — `versions/music_video.html` (IIFE side-effect)

Exposed by the inline IIFE at PR #23 for test access. Holds the same
`Lib` object exposed as `SWR.Library`. Use `SWR_LIB` from Puppeteer
smokes to inject synthetic items and test the `removeItem` flow
without going through the file picker.

### `window.SWR_PRESET_CYCLE` — `client/preset-cycle.client.js`

Pure cycle over `VersionsPresets.SHORTCUT_PRESETS` (9-item shortcut
list: `pulse, neon, grid, eclipse, smoke, aurora, film, glitch, void`).
PR #17.

| Method | Returns | Notes |
|--------|---------|-------|
| `next(prev)` | `string \| null` | Next shortcut preset, wraps. |
| `prev(prev)` | `string \| null` | Previous, wraps. |
| `first()` | `string` | First entry (`pulse`). |
| `last()` | `string` | Last entry (`void`). |
| `rebuild()` | `void` | Re-reads `SHORTCUT_PRESETS` from the page (call if presets are mutated). |

### `window.SWR_PRESET_PICK` — `client/preset-pick-store.client.js`

Persists the user's last manual preset pick (Tab/Shift+Tab cycle or
neighbour click) to `localStorage['swr.preset.manual.v1']`. PR #18.
Allow `null` and any non-SHORTCUT_PRESETS id (neighbours may include
the 19 anchors, not just the 9 shortcut ones).

### `window.SWR_LAYER_STATE` — `client/layer-state-store.client.js`

Debounced (1 s) wrapper around `localStorage['swr.layers.v1']` that
serialises `Layers.list` (assets stripped — blob URLs die on reload).
On restore, layers have their sliders + reactors but `asset: null`;
the user re-uploads to slot media back in. PR #19.

### `window.SWR_LAST_MIX` — `client/last-mix-store.client.js`

Debounced wrapper around `localStorage['swr.automix.lastMix']`. Holds
the last automix blend snapshot so the gradient-panel ghost dot
survives a reload. Shipped in PR #12.

### `window.SWR_RESET_STATE` — `lib/reset-state.client.js`

Wipes IDB stores. On music_video this clears the saved song and re-shows the
first-visit overlay on next reload.

### `window.SWR_GRADIENT` — inline IIFE

`{ refresh() }`. Forces a redraw of `#gradient` canvas. Currently called once
at boot (music_video.html:1243); no live callers — see Phase B/C/D (§9).

## 4. Keyboard map

| Key | Action | Source |
|-----|--------|--------|
| `A` | Toggle Automix ON/OFF | music_video.html inline IIFE |
| `Tab` / `Shift+Tab` | Cycle presets forward / backward through `SHORTCUT_PRESETS` (9-item list). Skipped when focus is in `<input>` / `<textarea>` / `contenteditable` and when modifier keys are held. | PR #17 |
| `Backspace` | `Layers.reset()` — clears all layers + wipes the layer-state-store. Skipped when focus is in an input / textarea / contenteditable, and when `metaKey` / `ctrlKey` / `altKey` is held (preserves browser back-nav). | PR #15 |
| `Shift+S` | Solo toggle — pins the most-recently-added layer as the only entry in `Layers.list` (calls `Layers.solo(last.id)`); press again to restore the prior list (`Layers.soloOff()`). Skipped when focus is in an input / textarea / contenteditable. | PR #25 |
| `M` | Mutate (engine global) | engine-keys.client.js |
| `E` | Evolve (engine global) | engine-keys.client.js |
| `R` | Randomize (engine global) | engine-keys.client.js |
| `Z` / `Shift+Z` | Undo / Redo (P3.5 performance-control layer) | PR #2 |

The footer has a `↺ Layers` button that calls `Layers.reset()` (PR #15) — same
behaviour as `Backspace` but pointer-driven.

> The `A` binding is suppressed when focus is in an `<input>`, `<textarea>`,
> or `contenteditable` element. The `Tab` binding skips preset cycling
> if focus is anywhere else (inputs, buttons, etc.), and `Backspace`
> is ignored when modifier keys are held.

## 5. On-load flow (the one-shot onboarding)

The page is the only `versions/*.html` that **does not** auto-load the
curated `library/`. The boot sequence is:

1. Page boots with no curated assets. `__swr_libboot()` is a no-op
   (music_video.html:955).
2. If the user has a saved song in IDB → overlay is hidden and the song
   auto-plays. Otherwise the overlay is shown.
3. The overlay prompts: "Drop a song to begin" + "Your uploads stay on this
   device" + "Request demo files" (link to `/library/manifest.json`).
4. User drops or selects a song → `SWR_LAST_SONG_SAVE(file)` persists →
   overlay fades out.
5. On every subsequent visit, the saved song auto-loads. To reset, click ↺
   (Reset) which calls `SWR_RESET_STATE.reset()` and clears the `songs`
   store.

Implementation: `music_video.html:402–528` (overlay IIFE). Auto-start path:
`music_video.html:438` (awaits `SWR_LAST_SONG`).

## 6. Render loop and the automix override

The GLSL render loop lives in **`versions-presets.js:874`** (not in the HTML
file — common confusion). Each frame:

1. Reads `preset.temp`, `preset.mut`, `preset.sepia`, `preset.chroma`,
   `preset.grain`, `preset.glow`, `preset.grayscale`, `preset.posterize` from
   the static page preset (`neon` for this page).
2. If `window.SWR._fxOverride` is set, blends the override on top with a
   60/40 mix (override at 40 %).
3. Writes the result to the GLSL uniforms.

The automix controller (`music_video.html:1284`) writes `_fxOverride` every
2 s via `setInterval`. Toggle OFF freezes the last value (does not clear
`_fxOverride`) — so the user gets a stable still life to inspect.

The blend formula in `versions-presets.js:875` is:

```js
field = field * 0.6 + override.field * 0.4   // per-frame, per uniform
```

## 7. Test surface

Three smoke scripts + nine unit scripts cover this page. All run
against a freshly-built `dist/` (see [test infra caveat](#test-infra-caveat)
below).

| Script | Type | Coverage |
|--------|------|----------|
| `node scripts/check-mv-smoke.mjs` | Puppeteer | 18 assertions: page boot, gradient canvas, anchor map (19 presets), `SWR_ANCHOR_MAP`, `SWR_GRADIENT`, `HologramState`, depth slider. |
| `node scripts/check-automix-unit.mjs` | Node | 15 unit tests: `featuresToCoords`, `blendAnchors`, `mix()`, `drift()` bounds, `HologramState` override. |
| `node scripts/check-automix-smoke.mjs` | Puppeteer | 46 assertions: no console errors at boot, every public API the page exposes (gradient setTrack/setBeatPulse/setAutomixAnchor/setNeighbours/setGhostDot, versions setPresetOverride, automix toggle, layer reset, video error handling, cache-bust on canplay, **library × button**). |

Nine unit suites total (`scripts/check-*-unit.mjs`):

| Script | Coverage | Assertions |
|--------|----------|------------|
| `check-automix-unit.mjs` | `SWR_AUTOMIX.mix`, `featuresToCoords`, `drift(preset, beat)` with BPM scaling | 15 |
| `check-gradient-dot-unit.mjs` | Shared `SWR_ANCHOR_EMBED` math, `SWR_AUTOMIX` delegation | 15 |
| `check-depth-blend-unit.mjs` | Pure `blendFxOverride(preset, ov, depth)` helper | 8 |
| `check-last-mix-unit.mjs` | `SWR_LAST_MIX` debounce + validation + idempotent IIFE | 8 |
| `check-get-preset-unit.mjs` | `__SWR_GET_PRESET` returns normalised fx_state | 6 |
| `check-preset-cycle-unit.mjs` | `SWR_PRESET_CYCLE.next/prev` wrap-around + rebuild | 14 |
| `check-preset-pick-unit.mjs` | `SWR_PRESET_PICK` save/load/clear + non-SHORTCUT_PRESETS ids | 9 |
| `check-layer-state-unit.mjs` | `SWR_LAYER_STATE` debounce + asset stripping + shape validation | 14 |
| `check-with-dist-unit.mjs` | `scripts/with-dist.mjs` skip/build/error paths | 5 |

Run them in order:

```bash
npm run build
npm run check:automix-unit
npm run check:gradient-dot-unit
npm run check:depth-blend-unit
npm run check:last-mix-unit
npm run check:get-preset-unit
npm run check:preset-cycle-unit
npm run check:preset-pick-unit
npm run check:layer-state-unit
npm run check:with-dist-unit
node scripts/test-api.mjs
node scripts/check-mv-smoke.mjs
node scripts/check-automix-smoke.mjs
```

Expected output:

```
ALL 9 UNIT SUITES: ALL GREEN (94 assertions)
TEST API: ALL GREEN
MV SMOKE: ALL GREEN (18 assertions)
AUTOMIX SMOKE: ALL GREEN (46 assertions)
```

### Test infra caveat

Both Puppeteer smokes start a static server on `dist/versions/music_video.html`.
If `dist/` was never built, both fail with 404s. `scripts/with-dist.mjs`
auto-builds `dist/` if missing (PR #16, the `scripts/check-with-dist-unit.mjs`
suite tests the helper itself), so contributors don't need to remember
to `npm run build` first.

## 8. How to extend

Common extension patterns:

### Add a new anchor preset

Edit `client/preset-anchor-map.client.js:62` — the `PRESETS` table. Each
entry needs `{ temp, mut, chroma, sepia, grain, glow, grayscale, posterize }`.
The next `npm run build` rehydrates; `SWR_ANCHOR_MAP.list()` will return the
new entry. **Re-run `check-mv-smoke.mjs`** — assertion `SWR_ANCHOR_MAP
exposes 19 anchor presets` will fail until the count assertion is updated.

### Add a new automix behaviour

`client/automix.client.js` is pure (no DOM, no audio reads outside the
passed-in `features` argument). Add a new exported function, write a unit
test in `scripts/check-automix-unit.mjs`, then wire it into the controller
at `music_video.html:1317` (`automix.tick()`).

### Touch the GLSL render loop

Edit `versions-presets.js:874`. The `_fxOverride` blend is the only mutation
music_video introduced; keep it additive (do not change the static-preset
read path, since other version pages don't have `_fxOverride` and rely on
the static path).

### Add a keyboard shortcut

Edit `music_video.html:1330` — the `document.addEventListener('keydown', …)`.
Follow the existing pattern: lowercase `e.key`, check `!e.metaKey && !e.ctrlKey
&& !e.altKey`, skip if focus is in an input. Update §4 in this doc.

## 9. Post-2026 additions

PR #4's description listed four phases (gradient foundation + B/C/D).
All four shipped (PRs #10, #11, #13). After that, a sprint of post-2026
PRs added further functionality. Each item below is shipped in main
unless marked `**Deferred**`.

### Shipped

- **PR #10 — gradient current-song dot.** `Gradient.setTrack(coords)`
  + `Gradient.setBeatPulse(0/1)`. The user's dropped track shows as a
  coloured dot at `(warmth, intensity)` on the gradient canvas,
  pulsing on beat.
- **PR #11 — shared `anchor-embed.js`.** `featuresToCoords({bass,mid,treb})`
  extracted into `client/anchor-embed.js` (`window.SWR_ANCHOR_EMBED`).
  Both `SWR_AUTOMIX` and the gradient panel import the shared module
  (DRY).
- **PR #13 — populated neighbours list.** `#neighbours-list` is now
  filled with the N nearest anchors to the user's track. Click an
  entry to jump to that preset via `VersionsPresets.setPresetOverride(id)`.
- **PR #12 — last-mix persistence.** `client/last-mix-store.client.js`
  (`window.SWR_LAST_MIX`) debounced-saves the last automix blend
  snapshot so the gradient-panel ghost dot survives a reload.
- **PR #15 — layer reset.** `Layers.reset()` + `Backspace` shortcut
  + `↺ Layers` footer button. Clears all layers and wipes the
  layer-state-store.
- **PR #16 — test infra helper.** `scripts/with-dist.mjs` auto-builds
  `dist/` if missing, so the smokes work without `npm run build`
  as a manual first step.
- **PR #17 — Tab / Shift+Tab preset cycle.** Cycles through
  `SHORTCUT_PRESETS` (9-item shortcut list).
- **PR #18 — manual preset pick persistence.** `client/preset-pick-store.client.js`
  (`window.SWR_PRESET_PICK`) saves the last manual pick (Tab cycle
  or neighbour click).
- **PR #19 — layer state persistence.** `client/layer-state-store.client.js`
  (`window.SWR_LAYER_STATE`) debounced-saves `Layers.list` metadata
  across reloads (assets stripped, blob URLs die).
- **PR #20 — video layer error handling.** `canplay` + `error`
  listeners on `<video>` elements surface status messages for
  unsupported formats.
- **PR #21 — render cache invalidation on `canplay` + 5s stall fallback.**
  Fixes black-video-layer rendering when the asset is mid-decode.
- **PR #23 — library × button.** Small `×` in the top-right of every
  library thumbnail (visible on hover). Confirm-on-delete: first
  click arms, second click within 1.5s fires. `Lib.removeItem(id)`
  revokes the blob URL and drops any layers referencing the asset.
- **PR #25 — Solo layer toggle.** `Layers.solo(id)` pins one library
  video as the only entry in `Layers.list` while leaving the GLSL
  composer + audio reactivity running; `Layers.soloOff()` restores
  the prior list from an in-memory snapshot. Footer `Solo` button +
  `Shift+S` shortcut pick the most-recently-added layer as the solo
  target. Switching solo to a different layer keeps the *original*
  snapshot intact (no layer loss on bounces). Plan:
  `.hermes/plans/2026-09-08_181000-solo-layer-toggle.md`.

### Deferred

- **Per-layer `cover` toggle (object-fit: cover).** Plan drafted
  at `.hermes/plans/2026-09-08_163000-layer-cover-toggle.md` but
  not yet implemented. Would add a `cover` boolean field to
  `Layers.list` (default `false`) and a `Layers.cover(id, true)`
  method. Three-line patch to drawLayer; checkbox in the layer panel.
- **Mirror the × button to all 23 version pages.** PR #23 only
  touched `music_video.html`. The other 22 version pages have
  their own inline `Lib` definitions; same ~30-line change would
  apply. Mechanical.
- **Undo for the layer reset.** Currently destructive — once you
  hit `Backspace`, the layers are gone (well, they're still in
  memory until reload). A 5-second undo window would be nice.

## 10. Cross-references

- **PR #4** — `c1591e3` — P3.7 music_video.html Phase A (gradient foundation)
- **PR #8** — `d91db4a` — fix: await `SWR_LAST_SONG` promise + use `neon` data-page
- **PR #9** — `d7547fb` — feat: self-evolving smart automixer toggle
- **PR #10** — gradient current-song dot
- **PR #11** — refactor: shared `anchor-embed.js`
- **PR #12** — last-mix persistence
- **PR #13** — neighbours list + click-jump
- **PR #15** — Backspace + `↺ Layers` shortcut for `Layers.reset()`
- **PR #16** — `scripts/with-dist.mjs` test infra helper
- **PR #17** — Tab / Shift+Tab preset cycle
- **PR #18** — manual preset pick persistence
- **PR #19** — layer state persistence
- **PR #20** — video layer error handling
- **PR #21** — render cache invalidation on `canplay` + 5s stall fallback
- **PR #22** — `docs/ARCHITECTURE.md` (engineer-facing system map)
- **PR #23** — library × button
- **PR #25** — Solo layer toggle (Layers.solo / soloOff + Shift+S shortcut)
- **PR #2** — `7d8f91a` — P3.5 performance-control layer (M/E/R/Z/? shortcuts)
- **AGENTS.md** — repo conventions (2-space indent, conventional commits, no TS)
- **`.hermes/plans/2026-09-08_163000-layer-cover-toggle.md`** — the deferred `cover` toggle plan
- **`.hermes/plans/2026-09-08_183000-self-evolving-automixer.md`** — the plan that produced PR #9
- **`docs/CROSS-APP-BRIDGE.md`** — how music_video relates to swr-app, make-video, marketplace
- **Related page:** `make-video.html` (the *timeline + export* music-video surface; completely separate feature)