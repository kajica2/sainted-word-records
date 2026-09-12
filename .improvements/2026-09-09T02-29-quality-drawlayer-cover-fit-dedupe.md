# Dedupe `engine.html:drawLayer` cover-fit math (3 copies → 1 helper)

**Cycle**: 2026-09-09T02-29
**Type**: quality (dedupe + bug-surface reduction on a per-frame hot path)
**Priority**: P1
**Estimated effort**: S

## TL;DR

`Renderer.drawLayer` at `engine.html:3961-4107` contains the same 7-line
cover-fit math (compute `ar` = asset aspect ratio, `canvasAR` = canvas aspect
ratio, then branch to set `dw/dh/dx/dy` so the asset covers the canvas while
preserving aspect) repeated **three times** in the function: once for the
hue/brightness/contrast pre-pass (`engine.html:4064-4074`), once for the
rotated fast path (`engine.html:4090-4094`), and once for the non-rotated fast
path (`engine.html:4097-4102`). Each call to `drawLayer` runs 1 to 3 copies of
that block (the hue branch and the rotated branch are mutually exclusive, but
one always runs). For a 5-layer scene at 60 FPS that's **300-900 executions/sec**
of duplicated arithmetic on the main engine, plus the same three copies
emitted into every variant's `drawLayer` fork (see Out of scope).

The dedupe also closes a real bug magnet: the rotated branch (lines 4090-4094)
omits `r.x` and `r.y` from `dx/dy` because the surrounding `cx.translate(cw/2 +
r.x, chh/2 + r.y)` at line 4088 already accounts for them, while the
non-rotated branch (lines 4097-4102) folds `r.x` / `r.y` into `dx/dy`
directly. Anyone editing one branch without noticing the structural
difference risks silently shifting the layer by ±r.x/±r.y pixels. Centralising
the math into one helper that takes an "already translated" flag makes the
invariant obvious to the next editor.

## Why this cycle

**Scan evidence** (Phase 2, this cycle):

- `engine.html:4064-4074` (hue/brightness/contrast pre-pass):
  ```js
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh, dx, dy;
  if (ar > canvasAR) {
    dh = chh; dw = dh * ar; dx = (cw - dw) / 2; dy = 0;
  } else {
    dw = cw; dh = dw / ar; dx = 0; dy = (chh - dh) / 2;
  }
  const scale = r.scale;
  dw *= scale; dh *= scale;
  dx = (cw - dw) / 2 + r.x; dy = (chh - dh) / 2 + r.y;
  ```
- `engine.html:4090-4094` (rotated fast path):
  ```js
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh;
  if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; }
  else { dw = cw * r.scale; dh = dw / ar; }
  ```
  Note: no `dx/dy`, no `(cw - dw)/2`, no `r.x`/`r.y` — the surrounding
  `cx.translate(cw/2 + r.x, chh/2 + r.y)` handles centering.
- `engine.html:4097-4102` (non-rotated fast path):
  ```js
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh, dx, dy;
  if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; dx = (cw - dw) / 2 + r.x; dy = 0 + r.y; }
  else { dw = cw * r.scale; dh = dw / ar; dx = 0 + r.x; dy = (chh - dh) / 2 + r.y; }
  ```

All three blocks compute the same 4 quantities (`dw`, `dh`, and the centered
`dx` / `dy` before `r.x`/`r.y` is added). The differences are mechanical:

| Branch              | `r.x`/`r.y` applied | `dx/dy` returned |
|---------------------|---------------------|------------------|
| hue pre-pass        | added at end        | centered + r.x/r.y |
| rotated fast path   | NOT added (translate handles it) | centered only |
| non-rotated fast    | added inside branch | centered + r.x/r.y |

A helper that returns `{ dw, dh, dxCentered, dyCentered }` (centered meaning
`dx = (cw - dw) / 2`, `dy = (chh - dh) / 2`, scale applied) lets each branch
decide whether to add `r.x`/`r.y` based on its context — and forces the
invariant to live in one place.

**Hot-path frequency** (`engine.html:4367` is the only call site):
```js
const sorted = Layers.list.slice().sort((a, b) => a.z - b.z);
for (const l of sorted) this.drawLayer(l, cx, cx.canvas.width, cx.canvas.height);
```
At 60 FPS with N layers, this loop runs `N` `drawLayer` calls per frame. With
5 typical layers → 300 calls/sec → ~900-1500 redundant arithmetic operations
per second. Negligible CPU compared to the GPU work, but the **clarity win**
is the real prize: the variant pages that fork `drawLayer` (see Out of scope)
currently copy the same triplicated math, and a codemod source for `lib/`
makes the helper importable rather than copy-paste-able.

**Working-tree compatibility**:
- `git status` shows `package.json:24-41` as dirty-range (verified this cycle:
  `md5sum` matches HEAD). No real working-tree edits in this area.
- The 9 in-flight proposals from `STATE.json:2026-09-09T00-14` are all in
  unrelated files (`engine.html:4367` z-sort cache, fx-postprocess, etc.).
  None touch the cover-fit math.
- No proposed plan in `.improvements/` (29 plans surveyed) targets this code
  path. The skill's pitfall callout applies: "Before writing a brand-new
  feature plan, grep the page for `Phase [A-Z]|TODO|FIXME|out of scope`
  markers" — `engine.html:4057-4058` doesn't carry a marker, but the
  redundant math is the textbook parity smell the skill spec names
  ("parity test as a permanent regression gate ... ship the dedup").

**Regression coverage**:
- `verify-e2e-media-record.mjs` exercises the full engine bootstrap →
  MediaRecorder cycle. It boots the page, drives the renderer, and asserts
  the recording produces valid bytes. Any mis-alignment in cover-fit math
  would visibly shift the layer positions and the verifier would catch it
  (frame-content hash).
- `verify-rotation-enabled.mjs` (the in-flight master-toggle tests for
  engine-keys.client.js) exercises the rotation branch, which is one of the
  three branches this plan touches.
- For unit-level coverage, add a `check-drawlayer-fit-unit.mjs` that
  imports the helper and asserts it produces bit-identical output to the
  pre-dedupe formulas across a matrix of (asset-aspect, canvas-aspect,
  scale, rot, x, y) combinations — see Step 4.

## Goal

`engine.html:drawLayer` contains **one** cover-fit computation, sourced from a
helper function. The three branches (hue pre-pass, rotated fast path,
non-rotated fast path) call the helper and apply the context-specific
additions (r.x / r.y) inline. After this plan lands, no `let dw, dh` appears
more than once in `drawLayer`. A new `check-drawlayer-fit-unit.mjs` test
guards the helper's contract. `npm run check` passes; `verify-e2e-media-record`
and `verify-rotation-enabled` pass with bit-identical rendered pixels.

## Plan

### Step 1 — Extract the cover-fit helper next to `applyReactors`

- **Files**: `engine.html:3903-3959` (`applyReactors` lives here). Insert a
  new helper function **above** `applyReactors` (before line 3916) inside the
  same renderer object literal.
- **Action**: add a pure helper that takes `(drawW, drawH, cw, chh, scale)`
  and returns `{ dw, dh, dxCentered, dyCentered }` where the centered offsets
  are `(cw - dw) / 2` and `(chh - dh) / 2`. The helper **does not** add
  `r.x` / `r.y` — each call site decides. Exact shape:

  ```js
  // coverFit(drawW, drawH, cw, chh, scale) -> { dw, dh, dxCentered, dyCentered }
  // Returns the centered cover-fit geometry for an asset of aspect drawW/drawH
  // being drawn into a cw×chh canvas at the given scale. Callers that need
  // layer offsets add r.x / r.y to dxCentered / dyCentered (or use cx.translate
  // for rotated paths).
  coverFit(drawW, drawH, cw, chh, scale) {
    const ar = drawW / drawH;
    const canvasAR = cw / chh;
    let dw, dh;
    if (ar > canvasAR) { dh = chh * scale; dw = dh * ar; }
    else { dw = cw * scale; dh = dw / ar; }
    return { dw, dh, dxCentered: (cw - dw) / 2, dyCentered: (chh - dh) / 2 };
  },
  ```
- **Verify**: `grep -n "coverFit" engine.html` returns 4 hits (1 def + 3 use).

### Step 2 — Replace the three duplicated blocks in `drawLayer`

- **Files**: `engine.html:4058-4105`.
- **Action**: replace each block as follows.

  **Hue/brightness/contrast pre-pass** (lines 4058-4074):
  ```js
  // before:
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh, dx, dy;
  if (ar > canvasAR) {
    dh = chh; dw = dh * ar; dx = (cw - dw) / 2; dy = 0;
  } else {
    dw = cw; dh = dw / ar; dx = 0; dy = (chh - dh) / 2;
  }
  const scale = r.scale;
  dw *= scale; dh *= scale;
  dx = (cw - dw) / 2 + r.x; dy = (chh - dh) / 2 + r.y;
  // after:
  const fit = this.coverFit(drawW, drawH, cw, chh, r.scale);
  const dw = fit.dw, dh = fit.dh;
  const dx = fit.dxCentered + r.x;
  const dy = fit.dyCentered + r.y;
  ```
  Note: the original block recomputes `dx`/`dy` after the scale step
  (`dx = (cw - dw) / 2 + r.x` where `dw` is now `dw * scale`) — the helper
  applies scale first, so the centered offsets are correct without a second
  recompute.

  **Rotated fast path** (lines 4090-4094, inside the `if (r.rot)` arm of the
  fast path):
  ```js
  // before:
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh;
  if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; }
  else { dw = cw * r.scale; dh = dw / ar; }
  // after:
  const fit = this.coverFit(drawW, drawH, cw, chh, r.scale);
  const dw = fit.dw, dh = fit.dh;
  ```
  No `dx/dy` here — the surrounding `cx.translate(cw/2 + r.x, chh/2 + r.y)`
  at line 4088 handles centering, and `cx.drawImage(drawSrc, -dw/2, -dh/2,
  dw, dh)` at line 4095 draws centered around the translated origin.

  **Non-rotated fast path** (lines 4097-4102, the `else` arm):
  ```js
  // before:
  const ar = drawW / drawH;
  const canvasAR = cw / chh;
  let dw, dh, dx, dy;
  if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; dx = (cw - dw) / 2 + r.x; dy = 0 + r.y; }
  else { dw = cw * r.scale; dh = dw / ar; dx = 0 + r.x; dy = (chh - dh) / 2 + r.y; }
  // after:
  const fit = this.coverFit(drawW, drawH, cw, chh, r.scale);
  const dw = fit.dw, dh = fit.dh;
  const dx = fit.dxCentered + r.x;
  const dy = fit.dyCentered + r.y;
  ```

- **Verify**: `grep -nE "let dw, dh" engine.html` returns exactly 0 matches
  inside `drawLayer` (the `let dw, dh` may legitimately appear in the helper
  itself and nowhere else). `grep -n "canvasAR" engine.html` returns only
  the new helper definition, not the three old sites.

### Step 3 — Sanity-check identical output with a manual pixel diff

- **Files**: `engine.html` only — no new files yet.
- **Action**: before/after this plan lands, run the local dev server
  (`npm run dev`), load `http://localhost:5174/engine/`, drop a test asset,
  hit record for 5 seconds, and `screencapture` the stage. After the dedupe,
  repeat. The two recordings should be byte-identical (no visual difference).
  This is a quick eyeball step — `verify-e2e-media-record` (Step 4) is the
  automated form.
- **Verify**: the two screencaptures match exactly (you can `cmp -l` or
  visually inspect via `open`).

### Step 4 — Add a Node-side unit test for the helper

- **Files**: `scripts/check-drawlayer-fit-unit.mjs` (new), `package.json`
  (add the script entry).
- **Action**: extract `coverFit` into a Node-importable test by reading
  the relevant `engine.html` substring via regex (matching the helper
  definition between known unique anchors), stripping the surrounding
  `this.` references, and importing it into a `vm` context. Use the
  same `vm`-based harness pattern as
  `scripts/check-gif-unit.mjs:25-40` and `check-p35-unit.mjs`. Assert
  against a matrix of inputs:

  ```js
  const cases = [
    // [drawW, drawH, cw, chh, scale, expected]
    [16, 9,   1920, 1080, 1.0, { dw: 1920, dh: 1080, dxCentered: 0,   dyCentered: 0   }], // exact match
    [9,  16,  1920, 1080, 1.0, { dw: 607.5, dh: 1080, dxCentered: 656.25, dyCentered: 0 }], // tall asset
    [16, 9,   1080, 1920, 1.0, { dw: 3413.33, dh: 1920, dxCentered: -1166.67, dyCentered: 0 }], // wide canvas
    [16, 9,   1920, 1080, 2.0, { dw: 3840, dh: 2160, dxCentered: -960, dyCentered: -540 }], // scale 2x overflows
    [1920, 1080, 100, 100, 1.0, { dw: 100, dh: 100, dxCentered: 0, dyCentered: 0 }], // tiny canvas
  ];
  ```
  Each case asserts `Math.abs(got.dw - expected.dw) < 0.01` (epsilon for
  float compare). The total count is the number of (passing) test cases.
- **Action**: add the script entry to `package.json:scripts`:

  ```json
  "check:drawlayer-fit-unit": "node scripts/check-drawlayer-fit-unit.mjs",
  ```
  and append ` && npm run check:drawlayer-fit-unit` to the `check` aggregate
  (after the existing `check:with-dist-unit` chain at `package.json:18`).
- **Verify**: `node scripts/check-drawlayer-fit-unit.mjs` exits 0 with the
  green summary line `DRAWLAYER FIT UNIT: ALL GREEN (5 tests)` (or however
  many cases — minimum 5). `npm run check` exits 0.

### Step 5 — Run the existing render regression tests

- **Files**: `verify-e2e-media-record.mjs`, `verify-rotation-enabled.mjs`.
- **Action**: run both after the dedupe lands. Both must remain green.
- **Verify**: both scripts exit 0 with no Puppeteer console errors. If
  either surfaces a pixel-level diff (likely nothing — the math is
  bit-identical), re-check Step 2 for an off-by-one in the `r.x`/`r.y`
  application.

## Verification

- `npm run check` passes (adds the new `check:drawlayer-fit-unit` step).
- `npm run build` passes (no template or copy-static regressions).
- `node scripts/check-drawlayer-fit-unit.mjs` passes with the helper
  producing identical output to the pre-dedupe formulas across a matrix
  of (aspect ratio, canvas ratio, scale) combinations — at least 5 cases.
- `node verify-rotation-enabled.mjs` passes (rotated branch path).
- `node verify-e2e-media-record.mjs` passes (full render cycle).
- Visual sanity: 5-second screencapture of the stage before and after the
  dedupe is byte-identical.

## Risks / gotchas

- **The hue branch recomputes `dx`/`dy` after the scale multiplication**
  (`dx = (cw - dw) / 2 + r.x` where `dw` is `dw * scale`). The helper
  applies scale first and returns `(cw - dw) / 2` after scale. These are
  mathematically equivalent, but a careful reviewer should re-check Step 2's
  hue-branch replacement to confirm the centered offset is computed against
  the **scaled** `dw`/`dh`, not the pre-scale values.
- **The pre-rotate + hue interaction** (lines 4024-4050 set up `drawSrc`
  with swapped dimensions before `applyReactors` is called). The helper
  receives the **swapped** `drawW`/`drawH` because the caller passes them
  in. The dedupe doesn't change this — `drawW` and `drawH` are local
  variables computed at lines 4022-4023 — but a future refactor that
  changes the swap point needs to be aware that `coverFit` is downstream
  of the swap.
- **`cx.translate` is idempotent inside a `cx.save()`/`cx.restore()`**
  block (lines 4086-4104 already save/restore correctly). The dedupe
  doesn't touch the save/restore boundaries; verified by reading lines
  4053 (`cx.save()`) and 4104-4106 (`cx.restore(); cx.restore();`).
- **The variant pages** (`versions/*.html`) each fork `drawLayer` and
  contain their own copy of the same triplicated math (see Out of scope
  for the plan boundary). This plan touches only `engine.html`. The
  variant codemod (a separate, larger plan) is the right next step.

## Out of scope

- **Variant `drawLayer` forks** in `versions/neon.html`, `film.html`, etc.
  Each variant's `drawLayer` duplicates the same math; touching them is
  a separate codemod plan (see `.improvements/2026-09-05T08-06-speed-z-sort-cache-and-apply-r-reuse.md`
  for the existing codemod-pattern reference). The variant math is
  subtly different per variant (some don't apply hue, some don't apply
  rotation) and dedupe needs a per-variant audit. This plan is
  `engine.html` only.
- **The `applyReactors` scratch-object refactor** flagged in the
  2026-09-08T20-04 plan. That plan dedupes the two reactor-target
  dispatcher branches; this plan dedupes the cover-fit math. Both touch
  `engine.html` but in non-overlapping regions (applyReactors at 3916-3959;
  cover-fit at 4058-4105). They can ship in either order; both are P1.
- **Caching the `coverFit` result across frames** for a given
  (drawW, drawH, cw, chh, scale). The inputs change whenever the canvas
  resizes or the asset swaps; in practice that's rare enough that the
  per-call cost is fine. If a future benchmark shows it's a bottleneck,
  add a memo keyed on `(drawW<<16 | drawH, cw<<16 | chh, scale)` —
  mentioned for context, not part of this plan.
- **Extracting `coverFit` to `lib/`** as an importable module. Today
  it's a method on the renderer object literal inside `engine.html`.
  Extracting requires either (a) making it a global on `window`, (b)
  inlining it into a `<script src="/lib/cover-fit.js">` and pre-loading
  it from `engine.html`, or (c) a build-time codemod. None of those
  belongs in this plan — the win is the dedupe itself; the export is a
  follow-up once the variant codemod lands and wants a shared import.

## Self-contained checklist

A fresh agent picking this up cold should be able to:

1. Open `engine.html:3903-4107` and locate the renderer object literal
   containing `applyReactors` and `drawLayer`.
2. Insert the `coverFit` helper above `applyReactors` (Step 1).
3. Replace each of the three cover-fit blocks in `drawLayer` with the
   helper call (Step 2).
4. Create `scripts/check-drawlayer-fit-unit.mjs` from the harness in
   `scripts/check-gif-unit.mjs:25-40`, with the test matrix in Step 4.
5. Add the script entry to `package.json` (Step 4).
6. Run `npm run check` + `npm run build` + the two `verify-*.mjs`
   scripts (Step 5) and confirm all green.
