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

