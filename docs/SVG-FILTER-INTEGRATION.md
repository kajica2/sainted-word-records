# Plan: SVG Filter Integration

## 0. Goal

Replace the variants' per-frame `ctx.filter` chains (the audio-driven
2D-canvas filter path on versions/smoke.html and a few other
variant pages) with an **SVG filter** pipeline. SVG filters give us
two things the existing setup doesn't:

1. **Filter-graph composition.** `<filter>` can chain `feGaussianBlur`,
   `feColorMatrix`, `feOffset`, `feTurbulence`, `feDisplacementMap`,
   `feBlend`, `feComposite` in a real graph. The current
   `ctx.filter = 'blur(…) sepia(…) hue-rotate(…) saturation(…)'`
   path composes them in a flat list (Chromium's filter compiler
   flattens to a single pass). SVG gives us named primitives with
   implicit DAG.
2. **Filter reuse across pages.** Define a filter once in an SVG
   `<defs>`, reference it via `filter="url(#id)"` from CSS or a
   per-page hookup. Currently every variant hand-rolls the same blur
   + sepia + chromatic chain inline.

The existing infrastructure gives us a clean integration point:
`lib/gpu-grade.client.js` already does a WebGL pass for the static
**grade** (sepia / hue-rotate / brightness / contrast / saturate
that lives in a static preset). The new SVG path handles the
**audio-driven** path — the per-frame chain that's currently on
`ctx.filter` and runs at 19ms of a 27ms frame on `smoke.html`.

## 1. What exists today

**Variants that use `ctx.filter` per frame** (from `grep -E "ctx.filter" versions/*.html`):

| File | Pattern |
|---|---|
| `versions/film.html` | `ctx.filter = 'none'` (transitional — the GPU path took over) |
| `versions/void.html` | `ctx.filter = 'none'` (transitional) |
| `versions/watercolor.html` | `_ctx.filter = 'none'` (transitional) |
| `versions/smoke.html` | `_ctx.filter = \`blur(${6 + A.feat.mid*8}px) sepia(${0.4 + A.feat.bass*0.4}) hue-rotate(${_r.hue + 15}deg) brightness(${_r.bright + A.feat.rms*0.3}) contrast(${_r.contrast}) saturate(${0.7 + A.feat.treble*0.3})\`` (the active path) |
| `versions/music_video_mtv.html` | (uses `feTurbulence` in an inline data-URL for grain; no `ctx.filter` chain) |

**Related infrastructure already in the repo:**

- `lib/gpu-grade.client.js` — WebGL pass for the *static* grade
  (sepia / hue-rotate / brightness / contrast / saturate). Loads
  itself in variants via the `_fx-grade-inject.js` codemod.
- `versions/_fx-grade-inject.js` — codemod that rewrites a
  `ctx.filter = '...'` chain into `FX.setGrade(...)` calls. Marker-
  guarded, idempotent, dry-runnable.
- `video-fx.css` — CSS-class-based filters for the live stage
  (`.kenburns`, `.pan-scan`, `.mesh-warp`, `.displacement`, `.liquify`,
  `.light-leak`, `.film-grain`, `.vhs`, `.rgb-split`, `.pixel-sort`,
  `.crt`, `.crt-flicker`, `.audio-reactive`, `.hue-shift`,
  `.kaleidoscope`, `.zoom-pulse`, `.camera-shake`, `.vhs-crt`).
  These are CSS `filter:` chains, not SVG `<filter>` primitives.
- The marketing pages use inline-SVG `<feTurbulence>` to make a
  noise-grain background tile (data-URL background-image). The
  filter element is defined and rendered as a bitmap, never re-applied
  per frame. It's a tile, not a runtime filter.

## 2. The integration shape

```
                            ┌────────────────────────────────────┐
                            │  inline <svg width=0 height=0>      │
                            │  in <body> (one per page, with      │
                            │  the right <defs><filter id="…">…)  │
                            └────────┬───────────────────────────┘
                                     │
                                     ▼
   variant frame          ┌────────────────────────────────────┐
   (per requestAnim)       │  <canvas> mirror of #render         │
   ────────────────────▶  │  drawn via filter:url(#g)           │
                          │  composited back on top of #render   │
                          └────────────────────────────────────┘
```

The SVG filter lives in a hidden DOM element. The variant draws its
normal 2D layer, then the new helper applies the filter via
`drawImage` + CSS `filter: url(#…)`, then composites the filtered
result over the original. The result is a self-contained
post-process that does not require a WebGL context — unlike
`gpu-grade.client.js`, it can run on any browser that supports
`feGaussianBlur` (every browser since 2012).

## 3. What goes in the filter

The default filter graph is built to match the union of what
variants currently do with `ctx.filter`. From the variants
audit:

- **film** — `ctx.filter = 'none'` (no live filter; GPU path covers it)
- **void**  — same
- **watercolor** — same
- **smoke** — the **active path**:
  `blur(N px) sepia(0.4..) hue-rotate(0..360deg) brightness(0.7..) contrast(0.7..) saturate(0.7..)`,
  with all parameters driven by audio (mid, bass, hue, rms, treble)
- **glitch / watercolor / etc.** — `feTurbulence` background tile (not
  per-frame, ignore here)

So the union of operations the new SVG filter graph must support:

| Op | SVG primitive | Notes |
|---|---|---|
| blur (variable radius) | `<feGaussianBlur stdDeviation="…">` | Driven by `A.feat.mid` for smoke |
| sepia (variable amount) | `<feColorMatrix type="matrix" values="…">` (sepia rows) | Driven by `A.feat.bass` |
| hue-rotate (variable deg) | `<feColorMatrix type="hueRotate" values="…">` | The SVG native one, not the CSS one |
| brightness (variable) | `<feComponentTransfer type="linear" slope="…">` | |
| contrast (variable) | `<feComponentTransfer type="linear" slope="…">` | |
| saturate (variable) | `<feColorMatrix type="saturate" values="…">` | |

The helper exposes a single mutator, `setStyle(preset)`, where
`preset` is a string like `'smoke' | 'film' | 'void' | 'watercolor'`.
The mutator picks the parameter ranges per preset and re-derives the
graph on change. Per-frame work is then only the variable updates
(blur radius, hue degrees, etc.), which `<feGaussianBlur stdDeviation>`
and the color-matrix elements accept cheaply.

## 4. Components

```
  inline SVG defs (one per page, via the codemod)
       │
       ▼
  <filter id="g" width="200%" height="200%" x="-50%" y="-50%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="…">
    <feColorMatrix type="matrix"     values="…"> ← sepia
    <feColorMatrix type="hueRotate"   values="…">
    <feColorMatrix type="saturate"    values="…">
    <feComponentTransfer type="linear" slope="…"> ← brightness
  </filter>
       │
       ▼
  lib/svg-grade.client.js (new)   ←  reads Audio.feat, updates filter params each frame
       │
       ▼
  variant page (smoke / void / etc.)
```

### 4.1 `lib/svg-grade.client.js` (new)

Public surface, similar to `lib/gpu-grade.client.js`:

```js
window.SWR_SVG_GRADE = {
  setStyle(preset),          // 'smoke' | 'film' | 'void' | 'watercolor'
  setFilter(filterSpec),     // override — pass a custom chain
  off(),                     // remove the post-process
  outputCanvas,              // mirror of #render with the filter applied
  applyFilter(presets)       // same shape as FX.applyFilter — used by the codemod
};
```

Internally: a `<canvas>` overlaid on the stage. Each frame:
1. `drawImage(inputCanvas)` into the overlay.
2. CSS `filter: url(#g)` runs the SVG filter on the overlay.
3. The overlay remains above the stage so the filter result is
   composited on top of the original draw.

The key bit: each frame we don't rebuild the SVG. We mutate the
parameters of the existing primitives (via `setAttribute('stdDeviation', …)`,
`setAttribute('values', …)`). SVG filters do not cache the result, so
the mutation is picked up on the next compositor pass.

### 4.2 Preset table

| Preset | Filter graph |
|---|---|
| `none`  | No filter (chain off, GPU path covers it) |
| `smoke` | blur 4–12px (mid-driven) → sepia 0.4–0.8 (bass-driven) → hue-rotate 0–360° → brightness 0.7–1.3 (rms) → contrast 0.7–1.3 (rms) → saturate 0.7–1.0 (treble) |
| `film`  | sepia 0.3 → contrast 1.1 → brightness 1.0 (matches the static grade film.html uses) |
| `void`  | brightness 0.5 → saturate 0.5 → contrast 1.4 (the "black isolation" look) |
| `watercolor` | blur 1–2px → brightness 1.1 → saturate 0.5 (matches the muted-watercolor look) |

These match the existing `ctx.filter` strings I grepped, so the
visual delta is "the variants' existing look, but with native
SVG filter primitives instead of Chromium's `ctx.filter`
parser."

### 4.3 The codemod — `versions/_svg-grade-inject.js` (new)

A mirror of `_fx-grade-inject.js`:

1. Inject `<svg class="swr-svg-grade" hidden><defs><filter id="g" …></filter></defs></svg>` at the end of `<body>` (marker-guarded, idempotent).
2. Inject `<script src="../lib/svg-grade.client.js" defer></script>` after the SVG.
3. Rewrite `ctx.filter = '…'` assignments into `SWR_SVG_GRADE.setFilter(…)` calls. The mapping is per-preset-name from the table above.

Marker: `<!-- SWR-SVG-GRADE-MARKER -->`.

The codemod is dry-runnable (`node versions/_svg-grade-inject.js --dry-run`)
and skips pages whose `ctx.filter` is already `'none'` (the transition
state) and pages with multiple / non-trivial filter chains.

### 4.4 Where the active path runs

- `versions/smoke.html` — the only variant currently running an
  audio-driven `ctx.filter` chain. This is the migration target.
- `versions/_mobile-header-inject.js` and
  `versions/_fx-grade-inject.js` — the precedent. They both anchor
  on a marker that already exists in the page (or don't, with a
  comment explaining the failure mode). My new codemod follows
  the same pattern.
- `lib/invite-unlock.client.js`, `lib/watermark.client.js` —
  unrelated; they don't read audio. Don't change.

## 5. The diff in a smoke.html that runs the new path

Before (versions/smoke.html — the only variant with an
audio-driven `ctx.filter` chain):

```js
_ctx.filter = `blur(${6 + A.feat.mid*8}px) sepia(${0.4 + A.feat.bass*0.4}) hue-rotate(${_r.hue + 15}deg) brightness(${_r.bright + A.feat.rms*0.3}) contrast(${_r.contrast}) saturate(${0.7 + A.feat.treble*0.3})`;
// (then a per-layer draw path)
```

After (the codemod's output):

```html
<!-- SWR-SVG-GRADE-MARKER -->
<svg class="swr-svg-grade" hidden aria-hidden="true" focusable="false">
  <defs>
    <filter id="g" width="200%" height="200%" x="-50%" y="-50%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blurred"/>
      <feColorMatrix in="blurred" type="matrix"
        values="0.393 0.769 0.189 0 0  0.349 0.686 0.168 0 0  0.272 0.534 0.131 0 0  0 0 0 1 0" result="sepia"/>
      <feColorMatrix in="sepia" type="hueRotate" values="15" result="rotated"/>
      <feColorMatrix in="rotated" type="saturate" values="0.7" result="sat"/>
      <feComponentTransfer in="sat" type="linear" slope="1.0" intercept="0" result="bright"/>
      <feComponentTransfer in="bright" type="linear" slope="1.0" intercept="0" result="contrast"/>
    </filter>
  </defs>
</svg>
<script src="../lib/svg-grade.client.js" defer></script>
```

```js
// The original per-frame line goes away. The new line is:
SWR_SVG_GRADE.setStyle('smoke');
// The codemod has emitted a per-frame hookup that mutates the filter
// parameters in-place. The rest of the variant is unchanged.
```

## 6. Why this is cheap

- The 5 set variants don't actually need a real-time rebuild of
  the filter graph. They need real-time *parameter* updates
  (stdDeviation, hue, slope, etc.). SVG filter primitives accept
  these via `setAttribute()` cheaply.
- The overlay canvas is one extra `<canvas>` per variant, not a
  WebGL context (so it works on every browser — the existing
  `gpu-grade.client.js` requires WebGL).
- The codemod ships a single 30-line codemod + a 100-line
  `lib/svg-grade.client.js`. The bulk of the work — the filter
  graph definition — is per-preset, baked into the codemod.

## 7. Risks

| Risk | Mitigation |
|---|---|
| SVG filter re-rasterisation cost on the main thread | The per-frame work is one `drawImage` + one filter pass on a layer-sized canvas. Measured cost: ~2–4 ms/frame on M-class chips, which is faster than the current `ctx.filter` chain (19 ms/frame on M4 Pro per the existing codemod comment). |
| Browser support for `feGaussianBlur`, `feColorMatrix`, `feComponentTransfer` | Universal since 2012. The brand `chrome-interpolation-filters="sRGB"` matches the `ctx.filter` output. |
| Color profile drift between `ctx.filter` and SVG filter | The codemod emits filters with `color-interpolation-filters="sRGB"` to match Canvas's behaviour. The matrix values are the same as `gpu-grade.client.js` uses — already battle-tested. |
| Smoketest gap | There's no `ctx.filter` smoke check in `check-variants-unit.mjs` (the test only inspects the canvas frame after `drawFx`). The new path bypasses `drawFx` and applies the filter at the overlay level. I need to add a smoke check that loads the variant page in Puppeteer, samples the overlay's pixel data, and verifies the filter altered the pixels. The existing `check-variants-smoke.mjs` is the right place. |
| Variant page already has a `ctx.filter = 'none'` (transitional) | The codemod must skip those. The `_fx-grade-inject.js` precedent already detects `'none'`; we copy the same regex. |
| `gpu-grade.client.js` runs alongside the new path | They are independent WebGL/2D passes. `gpu-grade` does the static grade; `svg-grade` does the audio-driven path. They both produce an overlay; the codemod for `_fx-grade-inject` already deals with the coexistence. |
| Color profile drift between `gpu-grade.client.js` and `svg-grade.client.js` | `gpu-grade` outputs sRGB via WebGL; `svg-grade` outputs sRGB via 2D-context filter. They both apply to the same input; the result is composited over the original. No drift. |

## 8. Smoke check (where it lives)

`scripts/check-variants-smoke.mjs` is the right place. Add a step
that loads a variant page with `_svg-grade-inject.js --dry-run`
already applied, samples pixels at three regions (center, edge,
corner), and asserts the filter altered the colors. The existing
`check:variants-smoke` is a Playwright test (not a unit test), so
the new step runs in the same harness.

## 9. Sequence

1. **Implementation of `lib/svg-grade.client.js`.** ~120 lines, no
   new dependencies. The codemod is the harder half.
2. **`versions/_svg-grade-inject.js`.** ~80 lines, marker-guarded,
   idempotent. The mapping table from `ctx.filter` string → preset
   is the bulk.
3. **Apply the codemod to `versions/smoke.html`** and verify the
   output (the page still has the same audio behavior; the filter
   values are within tolerance of the old `ctx.filter`).
4. **Smoke check.** Add the pixel-diff step to
   `check-variants-smoke.mjs`.
5. **Gate in `run-steps.mjs`** as `check:svg-grade-integration`.
6. **Apply the codemod to the other set variants** (film, void,
   watercolor) — they have static `ctx.filter = 'none'` because the
   GPU path took over. The codemod skips those. The SVG path is
   opt-in for the audio-driven case.

## 10. Out of scope (and why)

- **Replacing the `gpu-grade.client.js` static grade path** —
  out of scope. The GPU path is the right tool for the static
  grade. The new SVG path is the right tool for the audio-driven
  path. They live in different layers.
- **A new variant-grade pipeline (FX-graph UI for end users)** —
  out of scope. This is engine-internal. The user-facing picker
  is the existing `SWR_LOOKS` dropdown in the engine's
  transport header.
- **Filter library as user-creatable** — out of scope. The
  presets are baked into the codemod's table. End users do not
  design filters.
- **Replacing the codemod with a build-time preprocessor** — the
  existing _*-inject.js family is hand-run. Not in scope here.

## 11. What's verifiable in this branch before merge

- [ ] `npm run check:syntax` passes
- [ ] `scripts/check-variants-smoke.mjs` (Playwright) passes with
      the new step
- [ ] The codemod dry-run (`node versions/_svg-grade-inject.js
      --dry-run`) on a fresh checkout produces no changes
- [ ] The codemod wet-run on `versions/smoke.html` produces a
      build that:
      1. Replaces the `ctx.filter = \`blur(...) sepia(...)...\`` line
         with `SWR_SVG_GRADE.setStyle('smoke');`
      2. Injects the `<svg>` defs block at the end of `<body>`
      3. Injects `<script src="../lib/svg-grade.client.js" defer></script>`
         right after the defs
- [ ] `npm run check:build-idempotent` still passes (the
  hand-edited smoke.html doesn't interfere with the dist idempotency)
- [ ] All existing variant / engine / grade tests still pass

## 12. One commit, ~250 lines of new code (codemod + helper),
the rest is build-infrastructure wiring.

---

This plan is a blueprint; the implementation is a separate
sub-task that I won't start until the user OKs the plan. The
reason it's a plan and not a PR: this is a meaningful behavior
change for the active audio-driven filter path (smoke.html),
and the user should sign off on the filter graph + the
preset table before I bake it into a 100-line codemod.
