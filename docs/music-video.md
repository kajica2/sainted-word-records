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
| `SWR.Layers` | `{ list, add(layer), rm(id), reset(opts), cleanupForAsset(it), solo(id), soloOff(), swapAsset(direction), cover(id, value) }` | Per-layer reactors (mutate, alpha, etc.). `Layers.reset(opts)` clears all layers and wipes the layer-state-store (PR #19); accepts `{ fadeMs }` to fade each layer to 0 before clearing (PR #32). `solo(id)` pins one library video as the only entry in `Layers.list` while leaving the GLSL composer + audio reactivity running; `soloOff()` restores the prior list from an in-memory snapshot (PR #25). `swapAsset('next'|'prev')` cycles the topmost layer's `asset` through `Lib.items` (wraps modulo `Lib.items.length`) via `SWR_TIMING.crossfade` (fadeOut → swap at midpoint → fadeIn, ~600ms total — PR #32); the layer's reactors, baseScale, hue, opacity, blend, alpha, brightness, contrast, and cover stay untouched — only the `asset` reference swaps (PR #27). `cover(id, value)` flips the per-layer `cover` boolean (PR #28): when `true`, drawLayer scales the asset uniformly to fill the entire stage edge-to-edge (CSS `object-fit: cover`); when `false` (default), the existing letterbox behaviour holds. |
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

### `window.SWR_FIT` — `versions/music_video.html` (IIFE side-effect)

Exposes a `Fit` toggle that flips the `#render` canvas's CSS
`object-fit` between `fill` (default, browser default — backing-store
pixels stretched to the CSS box) and `cover` (PR #36). When `cover`
is on, the canvas content fills the section edge-to-edge and crops
overflow. Same semantics as the per-layer `cover` flag (PR #28) but
at the canvas level. Default off.

| Method | Returns | Notes |
|--------|---------|-------|
| `toggle(value?)` | `boolean` | Flips `enabled` (or sets to `value` if passed). Updates `body[data-fit]` and `refreshFitBtn()`. |
| `isOn` (getter) | `boolean` | The current state. |
| `enabled` | `boolean` | The current state (mutable directly). |

Body has a `data-fit="on"` attribute when the toggle is on; CSS rules
of the form `body[data-fit="on"] canvas { object-fit: cover; }`
apply. Footer has a `Fit` button; keyboard `F` (no shift) toggles.
Shift+F remains the existing browser-fullscreen shortcut.

### `window.SWR_HERO_FRAMES` — `versions/music_video.html` (IIFE side-effect)

Hero frame capture (PR #42, partial implementation of PRD-010).
While audio plays, samples the `#render` canvas at 4 fps into a
12-frame ring buffer (last 3 seconds). Each frame is analyzed for
energy (sum of audio features), contrast (luminance variance on a
32×32 downsample), and composition (centroid of bright pixels vs.
canvas center). `best(3)` ranks frames by `score = energy*0.4 +
contrast*0.4 + comp*0.2` and returns the top 3 by timestamp.

| Method | Returns | Notes |
|--------|---------|-------|
| `start()` | `void` | Starts the 4-fps sampler (auto-called on `A.play`). |
| `stop()` | `void` | Stops the sampler (auto-called on `A.pause`). |
| `best(n=3)` | `Frame[]` | Top-n frames sorted by timestamp. |
| `captureNow()` | `boolean` | Immediate single-frame capture, downloads as PNG. |
| `downloadFrame(entry)` | `boolean` | Re-captures at full resolution (not the buffer thumbnail) and downloads. |
| `buffer` | `Frame[]` | Read-only ring of `{dataURL, energy, contrast, comp, t}`. |

Footer `Hero` button toggles the sampler manually. The hero panel
opens automatically on pause, showing 3 clickable thumbnails.
Clicking a thumbnail downloads it as PNG. Print export at 300 DPI
(PRD-010 §10.2.3) is out of scope — would require OffscreenCanvas +
WebCodecs streaming to render at ~7200×10800 without OOM.

### `window.SWR_EDIT_DATA` — `versions/music_video.html` (IIFE side-effect)

Editorial bridge (PR #46, partial implementation of PRD-005). Runs
`AudioAnalysisV2.analyzeBuffer()` on the currently loaded song
(via `SWR_LAST_SONG` blob or `A.el.src` fallback), formats the
result as the `swr-edl/1` JSON shape (PRD-005 §5.2.1), and downloads
it. The script tag for `audio-analysis-v2.js` is now loaded on
`music_video.html` (was missing — only `engine.html` had it).

| Method | Returns | Notes |
|--------|---------|-------|
| `downloadEditData(filename?)` | `Promise<boolean>` | Async. Fetches blob → decodeAudioData → analyzeBuffer → formatEDL → download. |
| `lastAnalysis` | `object \| null` | The most recent `analyzeBuffer` result. Read-only. |

The downloaded JSON has this shape (PRD-005 §5.2.1):

```json
{
  "version": "swr-edl/1",
  "song": "filename.mp3",
  "duration": 187.5,
  "bpm": 124,
  "key": "A minor",
  "timecode": "00:00:00:00",
  "markers": [
    {"time": 0.0, "type": "downbeat", "label": "1.1", "confidence": 1.0},
    {"time": 0.484, "type": "kick", "label": "", "confidence": 0.95}
  ],
  "drops": [],
  "phrases": [
    {"start": 0, "end": 16, "type": "intro"},
    {"start": 16, "end": 48, "type": "build"},
    {"start": 48, "end": 80, "type": "drop"}
  ]
}
```

Footer `Edit Data` button triggers the analysis. Premiere Pro XML
export (PRD-005 §5.2.2) is out of scope — punted to a follow-up.
Onset classification (downbeat / kick / snare) uses inter-onset
interval heuristics; real onset classification is a follow-up.

### `window.SWR_REVIEW` — `versions/music_video.html` (IIFE side-effect)

Client review export (PR #49, partial implementation of PRD-009).
Records at 1 Mbps with a "PREVIEW — NOT FOR DISTRIBUTION"
watermark burned into the canvas via `window.__SWR_REVIEW_WATERMARK`
(the frame function checks it each tick). Generates a self-contained
HTML review page with click-to-comment pins (persisted via
localStorage per browser) and downloads both files. Pure export
feature — fits zero-backend (no comment server, the HTML file
contains the video as a `data:` URL).

| Method | Returns | Notes |
|--------|---------|-------|
| `exportReview(filename?)` | `Promise<boolean>` | Async. Sets watermark → records → generates review HTML → downloads both. |

The review HTML (PRD-009 §9.2.2) has:

- Embedded `<video>` of the watermarked MP4
- Click anywhere on the video to drop a comment pin
- Pins positioned at `% x/y` of the video's bounding box
- Pins persisted via `localStorage["swr.review.pins." + filename]`
- Each pin stores `{id, x, y, note, t}` where `t` is the
  video's `currentTime` in ms at the time of the click

Footer `Review` button triggers the export. A/B version compare
(PRD-009 §9.2.3) and revision log CSV export (§9.2.4) are
explicitly **out of scope** — punted to follow-ups.

### `window.SWR_HOOK_DETECTOR` — `versions/music_video.html` (IIFE side-effect)

Hook generator (PR #52, partial implementation of PRD-006).
Runs an inline energy-envelope drop finder (RMS over 20ms
windows, 10ms hop — same math as `audio-analysis-v2.js:225-267`)
on the loaded song's decoded PCM. Finds the longest sustained
low-energy intro, then the first frame where energy > 2× intro
mean, snaps to the nearest onset within 200ms (via
`AudioAnalysisV2.analyzeBuffer().onsets`). `exportHook(preset)`
seeks the audio element to the hook start time and records via
`SWR_RECORDER` at 2 Mbps.

| Method | Returns | Notes |
|--------|---------|-------|
| `detect()` | `Promise<{ok, result?, reason?}>` | Async. Decodes blob → runs drop detector → sets `lastResult`. |
| `exportHook(preset)` | `Promise<{ok, filename?, reason?}>` | Async. Seeks audio → starts recorder → records for `preset.duration` → stops + downloads. |
| `lastResult` | `{time, confidence, energy, label, introMean}` | Read-only. The most recent detection. |

Hook presets:

| Preset | Start | Duration |
|---------|-------|-----------|
| `teaser` | drop - 3s | 3s |
| `hook` | drop - 5s | 5s |
| `clip` | 0 (intro) | 15s |

Footer `Hooks` button triggers detection + shows the hook panel
(Teaser / Hook / Clip buttons). Detection is heuristic — energy
> 2× intro mean — works for typical EDM/pop, misses ambient
tracks with no clear drop. Confidence is hard-coded to 0.85.
Auto-Caption (PRD-006 §6.2.3), End-Card Builder (§6.2.4),
Thumbnail Picker (§6.2.5), and "Full Vertical 60s" preset
(§6.2.2) are explicitly **out of scope** — punted to follow-ups.

### `window.SWR_STATS` — `versions/music_video.html` (IIFE side-effect)

Local stats widget (PR #55, partial implementation of PRD-018).
Records `(ts, durationMs, ext, size)` on every successful
`Recorder._save()` to `localStorage["swr.stats.v1"]` (capped at
100 most recent renders). Footer `Stats` button opens a modal
showing total renders, last-30-day renders, total minutes
exported, storage usage, last preset, and the last 5 renders
as a table. All data is local-only — no backend.

| Method | Returns | Notes |
|--------|---------|-------|
| `record(durationMs, ext, size)` | `object` | Called from `Recorder._save()`. Pushes a render entry + caps buffer at 100. |
| `summary()` | `{totalRenders, last30Count, totalMinutes, last30Minutes, totalSizeMB, lastPreset, recent[]}` | Aggregates stats for the modal. |
| `setPreset(presetId)` | `void` | Tracks the most-recent preset for display. |
| `reset()` | `void` | Wipes stats. Wired to the modal's "Clear stats" button. |
| `STORAGE_KEY` | `'swr.stats.v1'` | Read-only constant. |

PRD-018 §18.2.1-3 (YouTube OAuth, TikTok API, weekly email) are
explicitly **out of scope** — punted to follow-ups. "Most-used
preset" is shown as "last preset" because we don't have a
per-preset counter (would need a `SWR_PRESET_USE` event from
the engine).

### `window.SWR_MOOD` — `versions/music_video.html` (IIFE side-effect)

Mood board + reference overlay (PR #59, partial implementation
of PRD-011). `analyze(img)` runs k-means++ (k=5, 10 iterations)
on a 64×64 downsample of the reference image, plus Michelson
contrast + mean saturation + warm/cool temperature features,
then produces a heuristic engine mapping to the 4 visible
footer sliders (depth, gate, decay, sens). `applySuggestion()`
sets the sliders to the suggested values via dispatched `input`
events (so existing slider handlers run).

| Method | Returns | Notes |
|--------|---------|-------|
| `analyze(img)` | `Promise<{palette, features, suggestion}>` | Async. Sample + k-means + features + suggestion. |
| `applySuggestion()` | `boolean` | Sets depth/gate/decay/sens to the last suggestion. |
| `setOverlayVisible(v)` | `void` | Toggle the corner reference overlay. |
| `setOverlayImage(dataUrl)` | `void` | Update the overlay image. |
| `saveOverlayPos(x, y)` | `void` | Persist overlay position to localStorage. |
| `loadOverlayPos()` | `{x, y, visible}` | Read the persisted position. |
| `_kmeans(pixels, k, maxIter)` | `{centroids, sizes}` | Internal — exposed for smoke tests. |
| `_features(pixels)` | `{meanBright, meanSat, contrast, temperature}` | Internal — exposed for smoke tests. |
| `_suggest(features)` | `{depth, gate, decay, sens, warmth, contrast, saturation}` | Internal — heuristic mapping. |

Footer `Mood` button opens a modal with file upload + hex color
paste + Apply suggestion + overlay toggle + Clear. A draggable
`<img id="mood-overlay">` shows the reference image in the
corner at 30% opacity; position persists per session via
`localStorage["swr.mood.overlay.v1"]`. Sobel edge density
(PRD-011 §11.2.2), URL input (§11.2.1), and motion/FX
mapping (§11.2.3) are explicitly **out of scope** — punted to
follow-ups.

## 4. Keyboard map

| Key | Action | Source |
|-----|--------|--------|
| `A` | Toggle Automix ON/OFF | music_video.html inline IIFE |
| `Tab` / `Shift+Tab` | Cycle presets forward / backward through `SHORTCUT_PRESETS` (9-item list). Skipped when focus is in `<input>` / `<textarea>` / `contenteditable` and when modifier keys are held. | PR #17 |
| `Backspace` | `Layers.reset()` — clears all layers + wipes the layer-state-store. Skipped when focus is in an input / textarea / contenteditable, and when `metaKey` / `ctrlKey` / `altKey` is held (preserves browser back-nav). | PR #15 |
| `Shift+S` | Solo toggle — pins the most-recently-added layer as the only entry in `Layers.list` (calls `Layers.solo(last.id)`); press again to restore the prior list (`Layers.soloOff()`). Skipped when focus is in an input / textarea / contenteditable. | PR #25 |
| `{` / `}` | Swap the topmost layer's asset to the previous / next `Lib.items` entry (calls `Layers.swapAsset('prev'|'next')`); wraps modulo `Lib.items.length`. The layer's reactors + sliders stay untouched — only the `asset` swaps. Skipped when focus is in an input / textarea / contenteditable, and when `metaKey` / `ctrlKey` / `altKey` is held (so `Cmd+{` doesn't collide with macOS app shortcuts). | PR #27 |
| `F` (no shift) | Fit to screen — toggles `SWR_FIT` (canvas-level `object-fit: cover`). Default `fill`; when on, the canvas content fills the section edge-to-edge and crops overflow. Skipped when focus is in an input / textarea / contenteditable, and when `shiftKey` / `metaKey` / `ctrlKey` / `altKey` is held (so `Shift+F` remains the browser-fullscreen shortcut). | PR #36 |
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
- **PR #27 — `{` / `}` swap topmost layer's asset.**
  `Layers.swapAsset('next' | 'prev')` cycles the topmost layer's
  `asset` reference through `Lib.items`, wrapping modulo
  `Lib.items.length`. The layer's reactors, baseScale, hue, opacity,
  blend, alpha, brightness, contrast, and cover flag are preserved
  — only the `asset` swaps. Music audio + GLSL composer keep running
  (instant cut, no fade). Keys `{` and `}` are bound with focus +
  modifier guards; the existing `[ ]` / `Shift+[ ]` keys (used by
  `engine-keys.client.js` for alpha / mutate nudges) are untouched.
  Plan: `.hermes/plans/2026-09-08_183000-swap-asset-bracket-keys.md`.
- **PR #26 — Master transformations toggle.** `window.SWR_TX_MASTER`
  gates the entire reactor loop in `applyR()` across all 14 version
  pages (aurora, chrome, eclipse, film, fractal, glitch, grid,
  hallucination, music_video, neon, pulse, smoke, void, watercolor).
  When OFF the audio reactors stop writing to `out.scale/x/y/rot/
  opacity/hue/brightness/contrast` and layers render at their
  static `baseScale`/etc — useful for the "more standard" visual
  (just media composited with the GLSL preset, no audio chaos).
  Pairs with Solo to give "one layer, no audio motion". Per-layer
  override `l.reactorsEnabled = true` re-enables reactors for that
  layer even when the master is OFF. `⏸` button sits to the left
  of the existing `↻` button in the help/keys area. State persists
  in `localStorage` under `swr.txMaster.enabled` (defaults to `true`).
  3 new smoke assertions (54 total). Plan:
  `.hermes/plans/2026-09-08_182000-tx-master-toggle.md`.
- **PR #28 — per-layer cover toggle.** `Layers.cover(id, value)`
  + a per-layer checkbox in the layer panel. When `cover: true`,
  the asset is uniformly scaled (`max(W/assetW, H/assetH)`) to
  fill the entire stage edge-to-edge (CSS `object-fit: cover`).
  Ignores `r.scale` so the layer always fills regardless of audio
  reactor activity. Default `false` preserves the existing
  letterbox behaviour. 2 new smoke assertions (56 total). Plan:
  `.hermes/plans/2026-09-08_163000-layer-cover-toggle.md`.
- **PR #30 — mirror × button to 13 version pages.** Mechanical
  mirror of PR #23 (the music_video.html × button) to aurora,
  chrome, eclipse, film, fractal, glitch, grid, hallucination,
  neon, pulse, smoke, void, watercolor. Each gets the same five
  patches (Lib.removeItem, Layers.cleanupForAsset, × button in
  render(), window.SWR_LIB, CSS rules) via the
  `scripts/mirror-library-remove.mjs` driver which handles three
  innerHTML format variants (with/without V/I tag prefix, with/
  without name truncation). Pages without a thumbnail-based
  library (collage's panels, the 8 audio-only/showcase pages)
  are correctly skipped.
- **PR #32 — smooth clip transitions + fade on layer clear.**
  `Layers.swapAsset(direction)` now uses `SWR_TIMING.crossfade`
  (fadeOut → swap at midpoint → fadeIn, ~600ms total) instead
  of an instant cut. `Layers.reset(opts)` accepts `{ fadeMs }`
  (default 0, instant); the Backspace key handler and the
  `↺ Layers` footer button pass `{ fadeMs: 600 }` so layers
  fade out smoothly before the list is cleared. Backward-
  compatible — callers without options behave as before. 2 new
  smoke assertions (58 total).
- **PR #34 — extend mirror script with F1/F2 patches.** Adds
  `patchSwapAsset` (rewrites hard-swap to `SWR_TIMING.crossfade`)
  and `patchResetFade` (rewrites `Layers.reset()` to accept
  `{ fadeMs }`) to `scripts/mirror-library-remove.mjs`. The 13
  non-`music_video` pages don't have `swapAsset` or `reset`
  methods (those shipped only on `music_video.html`), so the
  patches correctly no-op on them. Future-proofs the script:
  any page that adds those methods will get smooth transitions
  on the next mirror run. 1 new smoke assertion (59 total)
  verifies the skip shape via `page.goto('/versions/neon.html')`.
- **PR #36 — fit-to-screen toggle.** `window.SWR_FIT` flips the
  `#render` canvas between `object-fit: fill` (default, browser
  default) and `object-fit: cover` (fills the section
  edge-to-edge, crops overflow). Footer `Fit` button + `F` key
  (no shift). `body[data-fit="on"]` is the CSS hook. Same
  semantics as the per-layer `cover` flag (PR #28) but at the
  canvas level. 2 new smoke assertions (61 total). `Shift+F`
  remains the browser-fullscreen shortcut.
- **PR #42 — hero frame capture (PRD-010 partial).** `window
  .SWR_HERO_FRAMES` samples the `#render` canvas at 4 fps into a
  12-frame ring buffer (last 3 s), analyzes each frame for
  energy + contrast + composition, and surfaces the 3 best
  via `best(3)`. Footer `Hero` button toggles the sampler
  manually; auto-start/stop hooks into `A.play` / `A.pause`.
  Hero panel shows 3 clickable thumbnails; click downloads
  full-resolution PNG. Sampler captures at 32×32 downsample
  (small thumbnail PNG) and `downloadFrame()` re-captures at
  full resolution on click to avoid ~60 MB memory pressure.
  1 new smoke assertion (62 total). Print export at 300 DPI
  (PRD-010 §10.2.3) is explicitly **out of scope** — would
  require OffscreenCanvas + WebCodecs streaming to render at
  ~7200×10800 without OOM.
- **PR #46 — download edit data (PRD-005 partial).** Adds the
  `<script>` tag for `audio-analysis-v2.js` to `music_video.html`
  (was missing — only `engine.html` had it) and `SWR_EDIT_DATA`
  global that runs `analyzeBuffer()` on the loaded song and
  downloads a `swr-edl/1` JSON file with BPM + key/scale +
  duration + classified onsets + phrase segments. Footer
  `Edit Data` button triggers the analysis. JSON shape matches
  PRD-005 §5.2.1. Onset classification uses inter-onset interval
  heuristics; phrase segmentation is naive (16s/32s/32s splits).
  2 new smoke assertions (64 total). Premiere Pro XML export
  (PRD-005 §5.2.2) is explicitly **out of scope** — punted
  to a follow-up.
- **PR #49 — client review export (PRD-009 partial) + hero
  auto-hide.** Adds `SWR_REVIEW.exportReview()` that records at
  1 Mbps with a "PREVIEW — NOT FOR DISTRIBUTION" watermark
  burned into the canvas (via the new
  `window.__SWR_REVIEW_WATERMARK` global) and generates a
  self-contained HTML review page with click-to-comment pins
  (persisted via localStorage per browser). Footer `Review`
  button triggers the export. Also adds a 1.2s auto-hide to
  the hero panel after a download so it doesn't linger. A/B
  version compare (PRD-009 §9.2.3) and revision log CSV
  export (§9.2.4) are explicitly **out of scope**. Note:
  `check-mv-smoke.mjs` has 4 pre-existing failures and
  `check-automix-smoke.mjs` has 1 pre-existing failure
  (SWR._fxOverride) that pre-date this PR; both are
  stale-smoke issues from earlier `music_video.html`
  refactors.
- **PR #52 — hook generator (PRD-006 partial).** `SWR_HOOK_DETECTOR`
  detects the song's drop via inline energy-envelope analysis
  (RMS over 20ms windows, 10ms hop — same math as
  `audio-analysis-v2.js:225-267`), snaps to the nearest onset
  within 200ms via `analyzeBuffer().onsets`. `exportHook(preset)`
  seeks the audio to the start time and records via
  `SWR_RECORDER` at 2 Mbps. 3 presets: Teaser (3s before
  drop), Hook (5s before drop), Clip (15s from intro).
  Footer `Hooks` button triggers detection + shows the
  panel. Detection is heuristic (energy > 2× intro mean);
  confidence is hard-coded to 0.85. Auto-Caption
  (§6.2.3), End-Card Builder (§6.2.4), Thumbnail Picker
  (§6.2.5), and "Full Vertical 60s" preset (§6.2.2) are
  explicitly **out of scope**. 2 new smoke assertions
  (68 total).
- **PR #55 — local stats widget (PRD-018 partial).** `SWR_STATS`
  records `(ts, durationMs, ext, size)` on every successful
  `Recorder._save()` to `localStorage["swr.stats.v1"]` (capped
  at 100 most recent). Footer `Stats` button opens a modal
  showing total renders, last-30-day renders, total minutes
  exported, storage usage, last preset, and the last 5
  renders as a table. All data is local-only. PRD-018
  §18.2.1-3 (YouTube OAuth, TikTok API, weekly email) are
  explicitly **out of scope** — punted to follow-ups. 1 new
  smoke assertion (69 total).
- **PR #59 — mood board (PRD-011 partial).** `SWR_MOOD.analyze()`
  runs k-means++ (k=5, 10 iterations) on a 64×64 downsample
  of a reference image, plus Michelson contrast + mean
  saturation + warm/cool temperature features, then produces
  a heuristic engine mapping to the 4 visible footer sliders
  (depth, gate, decay, sens). `applySuggestion()` sets the
  sliders via dispatched `input` events. Footer `Mood` button
  opens a modal with file upload + hex paste + Apply + Clear.
  A draggable `<img id="mood-overlay">` shows the reference
  at 30% opacity; position persists per session via
  `localStorage["swr.mood.overlay.v1"]`. Sobel edge density
  (§11.2.2), URL input (§11.2.1), and motion/FX mapping
  (§11.2.3) are explicitly **out of scope**. 1 new smoke
  assertion (72 total).

### Deferred

- **Add `swapAsset` + `reset` methods to the other 13 version
  pages with thumbnail libraries** (aurora, chrome, eclipse,
  film, fractal, glitch, grid, hallucination, neon, pulse,
  smoke, void, watercolor), then run the F1/F2 mirror patches.
  This is a feature addition (the methods don't exist there
  yet), not a mechanical mirror. PR #34 sets up the script;
  the actual method addition is a separate PR.
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
- **PR #27** — `{` / `}` swap topmost layer's asset (Layers.swapAsset + keyboard binding)
- **PR #28** — per-layer cover toggle (Layers.cover + per-layer checkbox + uniform-scale fill)
- **PR #30** — mirror library × button to 13 version pages via `scripts/mirror-library-remove.mjs`
- **PR #32** — smooth clip transitions + fade on layer clear (SWR_TIMING.crossfade + reset({fadeMs}))
- **PR #34** — extend mirror script with F1/F2 patches (smooth transitions future-proofing)
- **PR #36** — fit-to-screen toggle (SWR_FIT + F key + canvas object-fit: cover)
- **PR #42** — hero frame capture (SWR_HERO_FRAMES + ring buffer + best(3) ranking)
- **PR #46** — download edit data (SWR_EDIT_DATA + audio-analysis-v2.js + swr-edl/1 JSON)
- **PR #49** — client review export (SWR_REVIEW + watermark + self-contained HTML review page)
- **PR #52** — hook generator (SWR_HOOK_DETECTOR + drop detection + 3 hook presets)
- **PR #55** — local stats widget (SWR_STATS + Recorder._save() instrumentation + stats modal)
- **PR #59** — mood board (SWR_MOOD + k-means palette + feature extraction + slider mapping)
- **PR #2** — `7d8f91a` — P3.5 performance-control layer (M/E/R/Z/? shortcuts)
- **AGENTS.md** — repo conventions (2-space indent, conventional commits, no TS)
- **`.hermes/plans/2026-09-09_005000-hero-frame-capture.md`** — the hero frame plan (now shipped as PR #42, partial — print export at 300 DPI punted to a follow-up)
- **`.hermes/plans/2026-09-09_013000-edit-data-export.md`** — the edit data plan (now shipped as PR #46, partial — Premiere Pro XML punted to a follow-up)
- **`.hermes/plans/2026-09-08_163000-layer-cover-toggle.md`** — the per-layer cover toggle plan (now shipped as PR #28)
- **`.hermes/plans/2026-09-08_183000-self-evolving-automixer.md`** — the plan that produced PR #9
- **`docs/CROSS-APP-BRIDGE.md`** — how music_video relates to swr-app, make-video, marketplace
- **Related page:** `make-video.html` (the *timeline + export* music-video surface; completely separate feature)