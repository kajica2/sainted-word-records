# Engine ↔ Neon parity: one shared contract, two surfaces

Compares `engine.html` (the app) against `versions/neon.html` (variant v1), enumerates every
function they share, and fixes the first slice of the drift that comparison exposes.

| | `/engine` | `/versions/neon.html` |
|---|---|---|
| Source file | `engine.html` (9,449 lines, 428 KB) | `versions/neon.html` (1,859 lines, 98 KB) |
| Inline `<script>` blocks | 14 (5,936 lines of inline JS) | 3 (1,269 lines of inline JS) |
| External scripts | 107 | 64 |
| External stylesheets | 6 | 2 |
| DOM ids | 262 (225 unique) | 58 (21 unique) |
| Visible controls | ~130 | ~35 |
| Shared external modules | **53** | **53** |
| Globals published under a common name | **1** (`window.SWR`) | **1** (`window.SWR`) |

Measured with a tokenizer that skips HTML comments and reads `<script>` bodies verbatim
(naive regex stripping of `<!-- … -->` mis-counts the shared modules as 13 because the
engine's comment blocks swallow real `<script src>` tags).

> The deployed `/engine` is **not** byte-identical to `engine.html`: it is the Vite build,
> and the `inline-targeting-rules` plugin appends 863 lines of persona→variant rules
> (`<script type="application/json" id="swrc-targeting-rules">`) that do not exist in source.
> All numbers above are source numbers.

---

## Part 1 — What the two pages actually share

### 1.1 The shared module layer (53 modules, identical on both pages)

**Automix stack (13)** — `automix.client`, `automix-arc`, `automix-composition`,
`automix-runtime`, `automix-session-store`, `anchor-embed`, `asset-curator`,
`preset-anchor-map`, `preset-cycle`, `preset-pick-store`, `layer-state-store`,
`last-mix-store`, `section-detector`.

**Run-time feature stacks (7)** — `capture-runtime`, `hook-detector`, `stats`, `mood`,
`scenes`, `narrative-state`, `looks-menu`.

**Engine subsystems (8)** — `engine-automap`, `engine-keys`, `engine-lfos`,
`engine-lfo-panel`, `engine-settings`, `engine-timing`, `engine-timing-panel`,
`engine-transitions`.

**Core plumbing (6)** — `fx-postprocess`, `layer-scheduler`, `project.client`,
`versions-presets`, `lib/recorder.client`, `lib/media-store.client`.

**Lib infrastructure (20)** — `adaptive-guard`, `app-version`, `app-version-bust`,
`auth`, `drive-modal`, `google-drive`, `home-link`, `intensity-slider`, `look-variant`,
`persist`, `persist-wire`, `reset-state`, `swr-natural`, `tier-runtime`, `tone-slider`,
`version-badge`, `version-watcher`, `watermark`, plus `lib/recorder.client` and
`lib/media-store.client` counted above.

**One shared stylesheet** — `lib/drive-modal.css`.

### 1.2 The shared capability matrix

| Capability | Engine | Neon | Where it comes from |
|---|:--:|:--:|---|
| Load a song (file picker) | ✓ | ✓ | `lib/audio.client.js` / inline `A.load` |
| Play · pause · time readout | ✓ | ✓ | `#play` `#time` |
| Spectrum meter | ✓ | ✓ | `#meter` |
| Beat + onset LEDs | ✓ | ✓ | `#beat-led` `#onset-led` |
| Media library: add · thumbnail · delete · drag-drop | ✓ | ✓ | `lib/library.client.js` / inline `Lib` |
| Layer stack: add · remove · select | ✓ | ✓ | `lib/layers.client.js` / inline `Layers` |
| Per-layer opacity · scale · rotation · hue · brightness · contrast · blend | ✓ | ✓ | both |
| Reactor assignment + RE-MAP | ✓ | ✓ | both |
| Global sensitivity · gate · decay | ✓ | ✓ | `#sensitivity`+`#beat-gate` / `#sens`+`#gate`+`#decay` |
| Record → MP4 / WebM export | ✓ | ✓ | inline `Recorder` + `lib/recorder.client.js` |
| Auto-stop duration selector | ✓ | ✓ | `#rec-dur` |
| Automix toggle · freeze · save · lock · debug | ✓ | ✓ | `client/automix-runtime.client.js` |
| Hook export (teaser 3s · hook 5s · clip 15s) | ✓¹ | ✓ | `client/hook-detector.client.js` |
| Stats modal | ✓ | ✓ | inline UI / `lib/variant-curator-wiring.client.js` |
| Mood board (reference image → mapping) | ✓ | ✓ | `client/mood.client.js` |
| Scene pads (4) | ✓ | ✓ | `client/scenes.client.js` |
| FX intensity + tone | ✓ | ✓ | `#fx-intensity`/`#fx-tone` / `lib/intensity-slider`+`lib/tone-slider` |
| Watermark overlay | ✓ | ✓ | `lib/watermark.client.js` |
| Google Drive import + auth session | ✓ | ✓ | `lib/drive-modal`+`lib/google-drive` |
| Keyboard help (`?`) | ✓ | ✓ | `engine-keys.client.js` |
| 23 grade presets (data) | ✓ | ✓ | `versions-presets.js` |
| Capture runtime · narrative state · looks menu | ✓ | ✓ | shared modules |
| PWA shell · version badge · tier · adaptive guard | ✓ | ✓ | `lib/*` |
| Responsive layout · icons-only mobile header | ✓ | ✓ | per-page CSS |

¹ the button existed but could never succeed — see D3.

**Engine only (24 surfaces)** — Basic↔Advanced mode; preset dropdown + personal presets +
preset evolve/preview/panel; the 20-effect CSS FX library; Storyboard/Story mode;
the transitions panel (`swr-tx-*`); persona targeting + banner; MIDI learn/auto-map;
cloud library; library packs + default library + hygiene + My Media + library sheet;
3D primitive layers; timeline + TRIM + reel + share + `.swr-set` import/export;
Hero frames + Edit Data + Review export; personas + onboarding + wizard + invites;
Daily Practice (20 challenges + streak); `?diag=1` diagnostics; BPM/key pills; version
navigation (12-version dropdown, `← ver` / `ver →`, Shift+arrows).

**Neon only (10 surfaces)** — the Media panel (Library/Used tabs, grid/list toggle,
search, assign-to-layer, clear, reset-state); the shared render core
`engine-render.client.js` (`SWR_RENDER.fit/frame/imageEvolve/invalidate`); GPU grade
(`lib/gpu-grade.client.js`) + audio damping (`lib/audio-damp.client.js`) + the shared
easing curve (`lib/ease.js`); GenOps (`engine-genops.client.js` + `.css`); library
persistence (`lib/library-persist.client.js`) + library loader; the variant-curator
binding layer (`lib/variant-curator-wiring.client.js`); recording format/fps/quality
selects; the temp slider; the visualizer controller.

### 1.3 The contract table — who publishes what

The 53 shared modules are written against page globals. Each page satisfies a
**different subset**, and every module that misses a dependency is written defensively
(`if (!x) return`), so the drift never surfaced as an error — it surfaced as features
that quietly did nothing.

| Global a shared module expects | Engine | Neon | Consequence on the side that lacks it |
|---|:--:|:--:|---|
| `window.Audio` | ✓ (`lib/audio.client.js:581`) | ✗ (page-scope `const A` only) | `project.client.js:99` → saved projects carry no song; `versions-presets.js:1144` → grade presets render statically |
| `window.Library` | ✓ (`lib/library.client.js:1021`) | ✗ | `client/library-packs.client.js:111` falls back to `window.SWR.Library` → OK |
| `window.Layers` | ✓ (`lib/layers.client.js:689`) | ✗ | `engine-keys.client.js:164` → layer-remap keys stay suppressed |
| `window.setStatus` | ✓ (`engine.html:3933`) | ✗ | `client/scenes.client.js:24`, `engine-settings.client.js:75` → no status feedback |
| `window.A` | ✓ (`engine.html:7289`) | ✗ | the `SWR_*` blocks that read `A.el` find nothing |
| `window.SWR_LAST_SONG` | ✗ | ✓ (`versions/last-song.js:128`) | `client/hook-detector.client.js:47` → the engine's Hooks button always answers *"no song loaded"* |
| `window.SWR_GRADE` | ✗ | ✓ (`lib/gpu-grade.client.js`) | `lib/watermark.client.js:131` falls back to `FX.outputCanvas` → OK |
| `window.SWR_VARIANTS` | ✓ (`client/variant-switcher.client.js:361`) | ✗ | `client/looks-menu.client.js:38` → the looks menu has no variant group |

Two naming conventions are in play for the same object:

- engine — `Audio.audioEl`, `Audio.loadFile`, `Audio.seek`, `Audio._updateKeyPill`
  (`lib/audio.client.js`).
- neon / music_video — `A.el`, `A.load` (`versions/neon.html:693`).

Modules are written against both: `project.client.js:102` reads `A.audioEl`,
`lib/library-switcher.client.js:69` and `lib/music-video-maker.client.js:154` read `A.el`.

### 1.4 Divergence ledger

| # | Finding | Evidence | Impact |
|---|---|---|---|
| D1 | Neon carries an inline **fork** of the engine's audio core (8 methods vs 15; `load` vs `loadFile`; no `seek`, no key pill, no song persistence) | `versions/neon.html:693` vs `lib/audio.client.js:567` | Every audio-facing shared module has to guess a convention |
| D2 | Neon published **no core globals at all** — only `window.SWR` | `versions/neon.html:1764` | 21 of the 53 shared modules had ≥1 unmet dependency on neon |
| D3 | The engine's Hooks button could only ever answer *"no song loaded"* | `client/hook-detector.client.js:47` reads `window.SWR_LAST_SONG`; the bridge was loaded by every versions page but not the engine, while the engine's own writer stored the identical record (`lib/audio.client.js:342`) | A visible, advertised feature was dead |
| D4 | The engine defines `SWR_HOOK_DETECTOR` / `SWR_STATS` / `SWR_MOOD` / `SWR_SCENES` **inline** and then loads the modules that redefine them — deferred scripts run after parse, so the inline copies are overwritten | `engine.html:7754, 7896, 7962, 8177` vs `engine.html:8545–8548` | ~500 lines of dead code, and a trap for the next editor |
| D5 | The variant binding layer is not shared: `lib/variant-curator-wiring.client.js` (232 lines) wires `#stats-btn`/`#hook-btn`/`#mood-btn`/`#scenes-btn` for the variants; the engine wires the same four buttons inline | `lib/variant-curator-wiring.client.js:70,105,127,177` vs `engine.html:8340+` | Two binding layers for one module set |
| D6 | Both pages define an inline `Recorder` **and** load `lib/recorder.client.js`; the engine has no `#rec-format`/`#rec-fps`/`#rec-quality` selects (it has `#rec-dur`, `#rec-size`, `#rec-wm` and an `#mp4-chooser` modal) | `engine.html:2724–2738`, `versions/neon.html` header | Export format/fps/bitrate are fixed on the engine, user-selectable on neon |
| D7 | Two render cores: neon uses `engine-render.client.js` + GPU grade + damping + shared `ease`; the engine uses its own inline loop, its own `ease`, and `fx-postprocess.js` | `lib/gpu-grade.client.js`, `lib/ease.js` vs `engine.html` inline | The same feature behaves differently on the two surfaces |
| D8 | The engine's "+ 3D" button has **no click handler** and `window.SWR_3D` is published by nothing in the repo | `engine.html:3383`; `engine-keys.client.js:1562` expects `SWR_3D` | A dead affordance on both pages |

---

## Part 2 — What this PR changes (slice 1)

Slice 1 is the smallest change that makes the shared-module contract real on both
pages. No UI, no render path, and no feature scope changes.

### 2.1 `engine.html` — load the saved-song bridge

```html
+  <script src="/versions/last-song.js" defer></script>
   <script src="/client/hook-detector.client.js" defer></script>
```

`client/hook-detector.client.js:47` reads `window.SWR_LAST_SONG`. The bridge
(`versions/last-song.js`) is loaded by every versions page but was missing from the
engine — while `lib/audio.client.js:342` was already writing the exact record the bridge
reads (DB `sainted-word-records` v4, store `songs`, key `current`, fields
`{blob,name,type,savedAt}`; `versions/last-song.js:161` writes the same shape).

### 2.2 `lib/audio.client.js` — refresh the bridge on every song load

```js
+        if (typeof window.SWR_LAST_SONG_SAVE === 'function') {
+          try { await window.SWR_LAST_SONG_SAVE(file); } catch (_) {}
+        }
```

`versions/last-song.js:128` caches `window.SWR_LAST_SONG` once at load time and only
re-reads the fresh file when its own `SWR_LAST_SONG_SAVE` runs. The version pages call it
from their song-input handler; this module is the single choke point for **every** load
path (file picker, drag-and-drop, generated audio), so the refresh belongs here. The
bridge re-writes the same record — same key, same shape — so the extra write is idempotent.

### 2.3 `versions/neon.html` — publish the core globals the shared modules read

```js
+    window.Audio = A;
+    window.Library = Lib;
+    window.Layers = Layers;
+    window.setStatus = setStatus;
+    window.A = A;
```

and one alias on the audio object:

```js
+      get audioEl() { return this.el; },
```

so a module written against the engine convention (`A.audioEl`) finds the same element a
module written against the music_video convention (`A.el`) finds.

### 2.4 Before / after, measured in Chrome against a local static server

| | `main` (unmodified) | this branch |
|---|---|---|
| `window.SWR_LAST_SONG` | `undefined` | `Promise` |
| bridge sees the song picked *this session* | `null` | `"slice1-tone.wav"` (176,444 B — byte-identical to the loaded file) |
| `SWR_HOOK_DETECTOR.detect()` | `no song loaded` | `no drop detected (no spike > 2× intro)` → it decoded the audio and ran the drop heuristic |
| neon `window.Audio` | `undefined` | `object`, `audioEl` → `<audio>`, `audioEl === el` |
| neon `window.Layers` / `window.Library` / `window.setStatus` | `undefined` | `object` / `object` / `function` |

The synthetic test signal is a flat 220 Hz tone, so *"no drop detected"* is the correct
answer for it — the point is that the detector now reaches that answer instead of
short-circuiting at *"no song loaded"*.

---

## Part 3 — The remaining slices (not in this PR)

Each slice is independently shippable; this PR deliberately stops at slice 1.

| Slice | Change | Files | Acceptance |
|---|---|---|---|
| **2** | Delete the 4 dead inline copies; add a `check:engine-parity` gate that fails when a page loads a module whose `window.*` dependency the page does not publish | `engine.html`, `scripts/check-engine-parity.mjs` | Gate green on all shipped pages; the 4 globals keep their module implementations |
| **3** | Adopt `lib/audio.client.js` on neon; drop the inline fork | `versions/neon.html`, `lib/audio.client.js` | One audio contract: `loadFile`, `seek`, `audioEl`, song persistence on both pages |
| **4** | One render core: either bring `engine-render.client.js` + `lib/ease.js` + `lib/audio-damp.client.js` to the engine, or declare the engine's 2D path canonical and move the variants onto it | `engine.html`, `versions/*.html` | Identical layer transform maths on both surfaces |
| **5** | One recorder: fold the inline `Recorder` into `lib/recorder.client.js`, give both pages the same format/fps/quality selects | `lib/recorder.client.js`, both pages | Same export controls and bitrate ladder on both |
| **6** | One binding layer: load `lib/variant-curator-wiring.client.js` on the engine, delete the inline equivalents | `engine.html` | One place wires `#stats-btn`/`#hook-btn`/`#mood-btn`/`#scenes-btn` |

---

## How to verify

```bash
npm ci                # note: `npm ci --ignore-scripts` skips the Puppeteer browser download
npm run check         # 71/86 pass; the same 15 steps fail on unmodified main (see below)
npm run build
```

The 15 pre-existing failures are identical before and after this change — measured by
running the gate on a clean `main` clone (`6e1b244`) and on this branch:
`check:engine-mobile`, `check:ver-picker`, `check:svg-grade-integration`,
`check:webgl-default-off`, `check:webgl-no-invalid-op`, `check:score-evolution-smoke`,
`test:asset-curator`, `check:doc-truth`, `check:dashboard`,
`check:variant-switcher-smoke`, `check:photo-slideshow`, `check:default-library`,
`check:grade-smoke`, `check:site-chrome`, `check:sitemap`.

Manual, against a local static server (`python3 -m http.server` at the repo root):

1. Open `/engine.html` → Advanced mode → load a song → press **Hooks**.
   Expect a drop analysis, not *"no song loaded"*.
2. Open `/versions/neon.html` → in the console: `window.Audio.audioEl.tagName` → `AUDIO`;
   `window.Layers === window.SWR.Layers` → `true`; `typeof window.setStatus` → `function`.
3. Open `/versions/neon.html` → load a song → **Save project** → the saved project
   contains the song (it did not before: `project.client.js:99` found no `window.Audio`).

## Risks and non-goals

- **Partial contract by design.** After this PR neon publishes `window.Audio`, but that
  object still has no `loadFile` (its loader is `load`) — slice 3 closes that. Any module
  that calls `Audio.loadFile` keeps its `typeof … === 'function'` guard and no-ops.
- **One extra IndexedDB write per song load** (the engine writes the record, the bridge
  re-writes it). Same key, same shape, idempotent; verified byte-identical in-browser.
- **No render-path change.** No canvas, shader, grade, or recorder code was touched.
- **Not verified here:** `npm run check:full` (needs a Puppeteer browser and a built
  `dist/`), the Vercel deploy, and the 21 other variant pages — the same bridge and
  global contract applies to them, but they were not exercised.

## Checklist

- [x] `npm run check` — no new failures vs the `main` baseline (same 15 pre-existing)
- [ ] `npm run check:full` — not run (Puppeteer browser not installed in this environment)
- [ ] New unit test (`scripts/check-*.mjs`) — deferred to slice 2, which adds the parity gate
- [x] `CHANGELOG.md` "Unreleased" updated
- [ ] `.env.example` — no new env var
- [ ] `site-map.json` / `vercel.json` — no page added
- [x] No new chunks / no debug logs
