# Changelog — 2026-09-24

---

## FX master intensity control

One knob, `0…1`, that scales the amplitude of every post-process effect and
filter across the engine and all 22 engine pages — engine.html + the 5 core
variants + the 17 artistic variants.

Commits:
- `19e09c3` — `feat(fx): master intensity control for effects and filters`

### How it works

`window.FX.intensity` (default 1) is a **render-time multiplier applied only
at the uniform-write block** of both renderers:

- `fx-postprocess.js` (engine + mosaic/baroque/kraft/phosphor/tape) — owns
  the value; `FX.setIntensity(v)` clamps to 0–1 and persists to
  `localStorage['swr.fx.intensity']`.
- `versions-presets.js` (the other 16 variants) — reads
  `window.FX.intensity` with a `window.SWR_FX_INTENSITY` fallback for pages
  that don't load fx-postprocess.

`FX.state` is **never** mutated by the knob — personas, automix overrides,
LFOs, and the temp slider keep their canonical values, and dragging back to
1 is an exact restore. Scaled: temp, mut, posterize, vignette, chroma,
grain, sepia, glow, grayscale, blur, liquid, pearl, glitch, effect. Never
scaled: `mutAlgo` (an algorithm selector, not an amount) and the audio
feature uniforms.

### Wiring

- `lib/intensity-slider.client.js` (new) — idempotent two-way range client:
  upgrades an existing `input#fx-intensity` or auto-mounts into
  `[data-fx-intensity-mount]`; emits `fx-intensity-change` on document.
- Engine: "fx" slider in the `#global` footer next to temp.
- Variants: mount span in the footer beside the Automix toggle + script
  include (all 22 pages).
- `lib/persist-fx.client.js` saves `intensity` in the fx persona snapshot
  and restores it on boot; `?diag=1` payload now includes `fxIntensity`.

### Verification

- Headless smoke on both renderers (tape + neon): state untouched at
  intensity 0, clamp (7→1, −3→0), persistence, readout.
- `verify-transitions.mjs`: new double-scaling guard — asserts state values
  are byte-identical through `setIntensity` — plus a diag shape check.
- `verify-automix-cross-surface.mjs` min tier asserts the slider mount on
  artistic variants.

---

## Automix made functional on all artistic variants

The automix toggle previously did nothing on 15 of the 16 enabled artistic
variants — three stacked structural gaps.

Commit:
- `26f9fdf` — `feat(automix): make automix functional on all artistic variants`

### The three gaps

1. **No anchor map.** No variant shipped `preset-anchor-map.client.js` +
   `anchor-embed.js`, so `window.SWR_ANCHOR_MAP` was undefined and
   `SWR_AUTOMIX.mix()` had no neighbours — every tick exited before
   `_setTarget`. Both script tags added to all 15 enabled variants.
2. **No preset consumer on the fx-postprocess pipeline.** The automix
   output (`window.SWR._fxOverride`) was only ever read by
   `versions-presets.js`; the 5 fx-postprocess variants had no blend path.
   fx-postprocess now smoothstep-blends the override into the FX state each
   frame (mirroring versions-presets semantics).
3. **tape had no real audio analysis.** Its paint loop synthesised
   `Math.sin` features. New `lib/media-feat.client.js` extracts the
   canonical 12-field feat shape (`bass…bpm`, identical DSP to neon) from
   any media element; tape attaches it on `load()` and keeps the synthetic
   features as the no-audio fallback. `variants/tape.automix.json` flipped
   to `enabled: true` — **16 of 17 wired**.

`echo-manifold` remains the sole opt-out — it has no FX surface at all
(own generative canvas, no fx_state uniforms), so automix presets have
nothing to drive.

### Verifier restructured

`verify-automix-cross-surface.mjs` previously asserted the full engine
stack (hook-detector/stats/mood/scenes panels) on the 17 artistic variants,
which never shipped them — it failed on an unmodified tree. Surfaces now
have three tiers:

- **full** — engine.html + the 5 core variants (11 automix scripts, 5
  runtime scripts, 18 panel IDs, 5 runtime APIs)
- **min** — the 17 artistic variants (4 automix-min scripts + toggle IDs +
  `SWR_ANCHOR_MAP.neighbours` + automix runtime API)
- **off** — echo-manifold's opt-out contract (config `enabled:false`,
  runtime + toggle present, no anchor-map weight), asserted from source
  truth because the config is only inlined at build time, which runs after
  verify in CI

77 checks, exit 0.

---

## Engine audit batch (merged from `fix/audit-critical-batch`)

Earlier work from the same branch, all CI-gated by run `35960503934`:

- `0be2fed` — `lib/media-store.client.js` tolerates a database newer than
  the script (version-agnostic retry on VersionError). Closes the second,
  cache-flavoured `VersionError` incident: an edge-cached pre-v2 module
  meeting a v2 database no longer breaks the media store.
- `af05264` / `65c5318` — onboarding overlay Escape/backdrop handlers:
  attempted fix, evidence-preserved revert (listeners attached after
  `renderModal()`'s `root.innerHTML` replacement never fire). Overlay
  remains dismissable via Skip.
- `ec137b5` — sandboxed iframes drop `allow-same-origin`.
- `9d86a45` — nav consolidation, orphaned pages, 5 text findings.

Verifier hygiene:
- `caa6b0f` — `verify-transitions.mjs` allowlists the sandboxed-iframe
  `serviceWorker` SecurityError (intentional since `ec137b5`).

---

### Stats

- **2 new modules**: `lib/media-feat.client.js` (canonical feat extractor,
  `SWR_MEDIA_FEAT.attach(el)`), `lib/intensity-slider.client.js`.
- **1 behavioural change to shared pipelines**: `fx-postprocess.js` now
  consumes `SWR._fxOverride`; both renderers apply `FX.intensity`.
- **16 variants un-inerted** for automix; 1 genuine opt-out documented.
- **2 verifier contracts fixed** (cross-surface tiers; sandbox allowlist).
- CI on the branch tip: `35960503934` — check:full + verifiers + build +
  size budget, all green. Merged to `main` as `223bb85`.
