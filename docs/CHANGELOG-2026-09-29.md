# Changelog — 2026-09-29

---

## `/dashboard` (Console): meet the remaining acceptance criteria

`docs/console-spec/console-spec.md` §Acceptance criteria listed five unmet items
on the live surface, and several on-page affordances were decorative. All ten
criteria now hold and every control does something.

### Correctness

| Bug | Symptom | Fix |
|---|---|---|
| HUD readouts never updated | `dashboard-engine.client.js` resolved its BPM/KEY targets with `document.querySelectorAll('span.tabular.text-white.font-medium')` — that matched only the two *header* spans (seeded with fabricated `235` / `08`), so the canvas HUD (`#hud-bpm` / `#hud-key`) stayed `—` forever and the header showed a value no audio ever produced. | Both readouts are addressed by id (`#hud-bpm`/`#hud-key`/`#hdr-bpm`/`#hdr-key`), are seeded `—` and are written by one `updateHud()`; `estimateKey()` returns `-1` (not `0`) for silence so a silent buffer never reports the key "C". |
| Beat produced no visible response | The GL shader drew three concentric rings, and the engine's beat path only called `triggerTransition()`, which early-returns for the default `transition === 'cut'` — so a kick changed nothing. | Shader rings deleted; the engine paints the spec's single hard full-frame flash (50ms hold, 150ms decay) on the overlay canvas, so GL and 2D flash identically. |
| 2D fallback drew off-palette colours | The fallback used crimson glows, blue spectrum bars and white dots/markers, while the GL path is `u_signal`/`u_bg` only. | Every 2D colour is now the `--signal` orange (hue 26 / `rgba(255,107,26,…)`). |
| `prefers-reduced-motion` ignored | The RAF loop ran regardless. | With the media query set the engine renders one static frame, then only ticks the HUD once a second; the page also flattens CSS transitions. |
| Empty state was a generic music note | Not the Console hero the spec asks for. | Static #empty-hero oscilloscope SVG (sine + bars + corner ticks) above the CTA; `#canvas-hud` supplies the live BPM/K readouts. |
| "Try a 30-second sample" was mouse-dead | The button sits inside a `pointer-events-none` wrapper, so clicks landed on the drop zone instead — the CTA never fired. | `pointer-events-auto` on the button. |
| No mobile layout at all | No `@media` rule existed; the 240/300px rails squeezed the stage. | ≤860px: stage owns the viewport, both rails are fixed full-width bottom sheets that boot as 32px strips, stack (layers above library) and open one at a time — both toggles verified hittable while a sheet is open. |
| Transport buttons did nothing | "Mic", "Cam" and "Load Song" had no ids and no handlers. | Load Song opens the engine's audio input; Mic drives `SWR_MEDIA_INPUT` into the engine's analysis path (analyser-only — never wired to `destination`); Cam feeds a live `<video>` into the engine as the canvas base. |
| Layer Save/Load/Clear were orphaned | `client/dashboard-presets.client.js` was loaded by no page, its 4 DOM hooks did not exist, and its `window.__SWR_PRESETS` global collided with the preset *catalogue* published by `versions-presets.js`. | Controls added to the Layers header, module loaded, global renamed `window.__SWR_LAYER_PRESETS`, `DEFAULT.layers` renamed to the Console vocabulary and its sliders aligned to the page's 0–100 domain (`base`/`scale` were sub-1 floats against `min=0 max=100` inputs, so they read 0 and could not round-trip). |
| `client/dashboard-recorder.client.js` was dead | Referenced by no page and no test; it expected `#rec-indicator`/`#rec-time` (which do not exist) and duplicated the working `#rec-btn` → `__SWR_ENGINE.record()` path. | Deleted. |

### Engine surface (camera / photos)

- New base-source slot behind the Console overlays: `setVideoSource(el)` (camera)
  or `setPhotos(urls)` (deck), whichever was set last wins. GL uploads the element
  into a `u_base` sampler (cover-fit via `u_baseAspect`, `0` = pure-black
  background); the 2D fallback cover-fits with `drawImage`. A refused element
  upload falls back to a 2D-canvas copy so the picture still shows.
- `#photo-advance` ("Advance on beat", checked by default) now advances the deck
  on each detected kick; the Photo tab pushes its object URLs into the engine.

### Tests

`scripts/check-dashboard.mjs` grew from 21 to 53 checks. Beyond HUD binding +
live values after a sample, beat-flash paint/decay, presets, base-source
switching, the 390px sheet layout (strips, reachable toggles, one open at a
time), reduced motion and inert-without-device Mic/Cam clicks, the gate now
covers the two paths that were only verifiable by hand before:

- **Mic / Cam success path** — a second Puppeteer browser launched with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` asserts the
  granted stream becomes the engine's analysis source (`micActive()`, button
  state), that the camera frame actually becomes the canvas base (region-mean
  brightness) and that toggling off clears the stream, the `<video>` and the
  base slot. The fake mic is only a tone where the host can open a capture
  backend, so the `features().level > 0` assertion is reported as an
  `(env skip: …)` on hosts that deliver silence (the Linux CI container) instead
  of failing — the wiring assertions still run there.
- **Layer-preset file path** — Save's download is captured through CDP and
  parsed (format, 5 rows, the mutated value), then handed back through the real
  `#lib-load` file picker to prove the file round-trips.

It also pins a 1280×900 desktop viewport (Puppeteer's 800×600 default is inside
the mobile breakpoint) and accepts `BASE_URL=<origin>` to run the same gate
against a deployed site (skipping the local static server).

---

## VJ mode: the camera is now opt-in

The Console rules call for a pure black canvas, and the camera feed was the one
source that broke it unconditionally. The camera now composites only in **VJ
mode**, toggled with `C` (or the header's `VJ` button) and shown in the canvas
HUD (`VJ OFF/ON`), so the shipped look stays pure black until the operator goes
live. A composited base also dims the grid (`u_gridDim` 1.0 → 0.35) so the
picture reads through the overlays; the photo deck stays ungated because
dropping files into the Photo tab is already an explicit content action.

- Engine: `setVJMode(on)` / `vjMode()`; the base-source test is now
  `baseVisible()` (camera needs VJ mode, photos do not) and both render paths
  (GL sampler + 2D `drawImage`) go through it. An armed-but-gated camera still
  runs — leaving VJ mode restores the black canvas without killing the stream,
  and the Cam button's title says which state it is in.
- The `C` binding ignores modifiers, so `Cmd/Ctrl+C` stays copy (the same guard
  now covers the existing `[`, `]`, `A` shortcuts, which previously fired on
  `Cmd+A`).
- Fixed on the way: with `prefers-reduced-motion` (no RAF loop) a base-source
  change never repainted, so a photo or camera would never appear — the engine
  now repaints that single frame on `setVJMode`/`setVideoSource`/`setPhotos`,
  including when the image or first video frame arrives.

Gate: 54 → 64 checks (VJ default/C toggle/`Cmd+C`/typing guards, photos
composite while ungated, grid dim A/B on the same pixels, the reduced-motion
repaint, and — with the fake camera — armed-but-off-canvas → `C` composites →
leaving VJ returns to pure black while the stream stays armed; measured region
mean 11 → 82 → 11).

---

## House grade: the shared filmic grade now follows the grading rules

The grade in `lib/swr-natural.client.js` (22 variants + `engine.html`) was a
blanket 55% desaturation — `saturate(0.45) contrast(0.85) brightness(1.05)`.
Measured on real frames it crushed saturation to ~28% of the source and lifted
the black floor to 0.079, which is the "washed out" case the grading rules call
out. It is now derived from one spec block (`GRADE`) that the applied CSS chain
is built from:

| Constant | Value | Rule it satisfies |
|---|---|---|
| `saturation` | 0.92 | the rules cap boosts at +8; the house keeps a ~8% trim ("if you notice the saturation, it's too high") |
| `contrast` / `brightness` | 0.9375 / 0.96 | pivot-symmetric tone curve; the derived `GRADE.black` = 0.030 ("lift blacks slightly, don't wash them out") and `GRADE.white` = 0.930 (rules' 90–95 IRE whites) |
| `grain` | 0.05 | 5% film grain to hide the banding the lift creates — one `overlay` fill of a 64px noise tile in the module's existing composite pass |

`GRADE.black` / `.white` are computed from `contrast` + `brightness`, so the
rules' tone targets cannot drift from what the browser applies. `SWR_NATURAL`
now exposes the spec, the CSS chain and those points for consumers and tests.

Measured on identical frames (canvas-2D `ctx.filter` over the same captured
patch, so the comparison is content-independent):

| Surface | Metric | Raw | Old grade | New grade |
|---|---|---|---|---|
| `versions/hallucination.html` (fx-canvas) | saturation | 90.1% | 31.4% | **71.7%** |
| | black p2 | 4.5 | 23.8 | **10.1** |
| | white p98 | 30.2 | 46.8 | **33.5** |
| `engine.html` (render) | saturation | 77.3% | 25.1% | **59.6%** |
| | black p2 | 8.2 | 26.7 | **13.6** |

The rules' per-hue half — vibrance ordering, skin-tone protection, selective
colour, clarity — stays a finishing-stage step, because it needs per-pixel work
and the only presentational way to express it (an SVG filter chain) measured
15 fps for the colour matrices alone, 8.6 with clarity and 6.7 with grain on a
variant page, against 30 fps for the CSS chain and 59.9 unfiltered. The full
rule → implementation map and those measurements are in
`docs/grade-house-rules.md`.

Gate: `npm run check:grade-smoke` (new, wired into the `check` group) asserts the
spec sits inside the rules' ranges, the chain lands on exactly one canvas (never
doubled), the grain floor really reaches the stage pixels (spatial HF energy 2.6
on vs 0.0 off, inside a subtle amplitude band), and a real variant page grades
exactly its topmost canvas.
---

### TikTok Studio (`/tiktok`)

PR 3 of 4 in the studio sequence (live-camera-mic → spit-live → **tiktok** → camera-enhance),
built from `docs/plans/2026-09-24-tiktok-studio.md`.

- **`tiktok.html`** — hero + upload (picker or drop), 3-tab vibe picker (12 presets), trim bar,
  four export buttons, a Free/Creator/Pro card, and a sticky 1080×1920 preview.
- **`client/swr-tiktok-runtime.client.js`** — state machine (idle → loading → ready →
  previewing/exporting), the audio graph, the six-layer 9:16 renderer (gradient ground, bass
  rings, mid waveform ribbon, treble particles, hook burst, and the always-on `SWR · tiktok`
  mark), plus buffer analysis: the hook is the strongest energy rise in the first 60 s, and
  BPM/key come from the repo's `audio-analysis-v2.js`.
- **`client/swr-tiktok-export.client.js`** — teaser 3 s / hook 5 s / clip 15 s / behind 60 s via
  `canvas.captureStream` + `MediaRecorder`, audio routed through a single shared `AudioContext`
  graph (the runtime's, so `createMediaElementSource` is called once per element), handed off as
  `sainted-word-tiktok-<type>-<timestamp>.webm`. The recorder starts one frame after the stream,
  because a canvas capture sampled in the same task can hand the encoder a pre-paint frame.
- **Wiring** — `/tiktok` nav entry + the two rewrites, the sitemap URL, and the site-map tool entry.
- **Tests** — `check:tiktok-unit` (node:vm, 48 assertions: presets, factory, state, persistence,
  trim, the analysis over a synthetic 120 BPM click track with a 12 s lift, and the export
  pipeline against a stubbed recorder) and `check:tiktok-smoke` (13 Puppeteer checks against
  built `dist/tiktok.html`). Unit in `check`, smoke in `check:full`.

**Measured on the synthetic signal**: hook detection lands at 11.98 s for a lift at 12 s, and BPM
reads 117 for a 120 BPM click train. Both are heuristics — best-effort on clean signals, as the
plan says; no ML-grade accuracy is claimed.

**Known-open**: the 12 presets are subjective (user-uploadable presets are a future PR); batch
export (7 clips from one song), trending sounds and direct upload need a backend and stay out of
scope per the plan.
