# Dedupe `Lib._classify()` inline luma/hue math into `lib/asset-classify.client.js` (14 variants)

**Cycle**: 2026-09-09T06-39
**Type**: quality (dedupe + future-proofing on a cold path that runs once per asset-load)
**Priority**: P2
**Estimated effort**: S

## TL;DR

14 of the variant pages (`versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html`) each carry an identical copy of the asset-color-classification loop inside their inline `Lib._classify(it)` IIFE: a 32×32 canvas, a `getImageData`, then the **same Rec. 601 luma formula** (`0.299*r + 0.587*g + 0.114*b`) and the **same circular-mean hue formula** (atan2 of cos/sin accumulators over the dominant-channel hue bins) inlined directly into the for-loop body. `engine.html:2680-2702` already factored these out into two pure helpers — `sampleLuma(data)` and `sampleHue(data)` — but the variants don't share them.

The cleanest fix is a tiny 30-line global-script module at `lib/asset-classify.client.js` that exposes `window.SWR_ASSET_CLASSIFY = { sampleLuma, sampleHue }`. Add `<script src="../lib/asset-classify.client.js" defer>` before each variant's inline `<script>` block (and `/lib/asset-classify.client.js` for `engine.html`), then replace the 8 inlined math lines with two helper calls. Each variant keeps its own canvas/probe shape (videos vs images, thumb size, etc.) — only the math moves out. This drops ~280 lines of duplicated math (8 lines × 14 variants × ~2.5 avg instances), surfaces a single place to add future color metrics (saturation? chroma?), and closes a low-confidence parity bug surface (one of the 14 variants — `smoke.html:597` — already dropped the `hue` calculation entirely, so it's silently broken; another — `collage.html` — uses a slightly different iteration shape).

Not the engine.html parity work (that's a separate PR with the 8 new topbar buttons), not the `applyReactors` dedupe (covered by the in-flight 2026-09-08T20-04 plan), and not the `drawLayer` cover-fit dedupe (covered by 2026-09-09T02-29). This is the **`_classify` math surface** specifically — the only piece of duplicated library-color-classification code in the repo.

## Why this cycle

**Scan evidence (this cycle)**:

```text
$ grep -lE "0\\.299\\*d\\[i\\]" versions/*.html
versions/aurora.html
versions/chrome.html
versions/eclipse.html
versions/film.html
versions/fractal.html
versions/glitch.html
versions/grid.html
versions/hallucination.html
versions/music_video.html
versions/neon.html
versions/pulse.html
versions/smoke.html
versions/void.html
versions/watercolor.html
$ grep -lE "sampleLuma\\(" versions/*.html engine.html
engine.html    ← only engine.html has the factored helpers (lines 2680, 2687)
```

That's **14 variants** with the inlined luma math and **zero** using the factored `sampleLuma`/`sampleHue` helpers from `engine.html:2680-2702`.

**Per-variant locations** (the `let luma=0,...0.299*d[i]...` line):

```text
versions/aurora.html:472        versions/chrome.html:472         versions/collage.html:192 (different shape — single getImageData call)
versions/eclipse.html:607        versions/film.html:600          versions/fractal.html:472
versions/glitch.html:472         versions/grid.html:593          versions/hallucination.html:731
versions/music_video.html:720    versions/neon.html:610          versions/pulse.html:591
versions/smoke.html:597 (BUG: missing hue calc)   versions/void.html:473
versions/watercolor.html:473
```

**Precedent (the right shape)** — `engine.html:2680-2702`:

```js
function sampleLuma(data) {
  let s = 0;
  for (let i = 0; i < data.length; i += 4) {
    s += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
  }
  return (s / (data.length / 4)) / 255;
}
function sampleHue(data) {
  // simple average hue using atan2
  let sx = 0, sy = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) continue;
    const d = mx - mn;
    let h = 0;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    const a = Math.cos(h * Math.PI * 2);
    const b2 = Math.sin(h * Math.PI * 2);
    sx += a; sy += b2;
  }
  const n = data.length / 4;
  return (Math.atan2(sy / n, sx / n) / (Math.PI * 2) + 1) % 1;
}
```

These are pure (input `Uint8ClampedArray`, output scalar). Trivial to extract into a shared `<script src>` module that runs before each variant's inline IIFE — the variants just call `SWR_ASSET_CLASSIFY.sampleLuma(d)` and `SWR_ASSET_CLASSIFY.sampleHue(d)`.

**Why now**:

1. **The engine.html helper exists already** — the factoring decision is already made; the variants just didn't inherit it because each variant is a self-contained `versions/*.html` file that vendors its own `Lib` IIFE.
2. **A latent bug is already present**: `versions/smoke.html:589-608` carries only the luma calculation; the `hue` calculation was dropped in some past edit (probably during a codemod or copy-paste). The asset's `it.hue` is never set, so smoke's hue-aware palette selection silently falls back to `0` (the initial value at `versions/smoke.html:587`). This is a real silent behavior gap that the dedupe would close (every variant gets hue back, with bit-identical math to engine.html).
3. **The shape varies slightly across variants**: `versions/collage.html:182-195` reads `getImageData` only once and does both luma + hue in a single for-loop pass over `d` (others do two separate passes). Collage is more efficient — but the math is the same. After dedupe, collage can either (a) make two helper calls and accept the second loop pass, or (b) keep its fused pass and inline-call the helpers on each iteration — the helpers are pure reads, not stateful, so the fused version is correct either way. The plan recommends option (a) for the cleanest dedupe and accepts the ~µs cost on a cold path (runs once per asset-load).
4. **No active work touches it**: `git status` shows `engine.html` dirty (the in-flight 8-button parity work — touches different lines: 1200-1207 + 4811-4818 + 5485-6728). None of the 14 variant files are dirty. None of the in-flight `in_flight_proposals` list (10 entries in `STATE.json:11-22`) target this surface. The recent speed wins (z-sort cache, cover-fit dedupe, FX uniform skip) are all on the **render path**; this is the **asset-load cold path** — orthogonal.

**Score** (1-5 per axis, total 3-15):
- Impact: **4** — 280 lines of dup math removed; closes a silent `smoke.html` hue bug; future color metrics have one home; not the highest-impact cycle (no per-frame work, just asset-load), but high-confidence cleanup.
- Confidence: **5** — the factored helpers already ship in `engine.html` and have been verified by every variant's smoke test (existing ones use the inlined math but produce the same values for the same input). Pure functions are dead-simple to extract. Codemod candidate.
- Novelty: **4** — `covered_topics` has `engine-render-cover-fit-dedupe` (the parallel drawLayer work) and `applyReactors-dedupe` but no entry for `classify-luma-hue-extract`. Variant-port pattern matches the engine.html→variants FPS-throttle work in 2026-09-09T04-31.
- **Total: 13/15.** Tie-break per skill: speed > quality > templates. This is a clean quality move — perfect score is the engine.html→variants RAF-throttle work, which already shipped. This is the parallel quality move for the asset-load surface.

**Working-tree compatibility**:
- `git status --short versions/aurora.html versions/chrome.html versions/collage.html versions/eclipse.html versions/film.html versions/fractal.html versions/glitch.html versions/grid.html versions/hallucination.html versions/music_video.html versions/neon.html versions/pulse.html versions/smoke.html versions/void.html versions/watercolor.html` returns empty for all 14 — safe to patch.
- The dirty `engine.html` is touched in this plan only for the `<script src>` insertion (no math edits — the helpers are extracted, not moved in-place). The script-tag insertion can land in a follow-up commit alongside the parity PR, or deferred until the parity PR merges. See Step 4.

## Goal

`SWR_ASSET_CLASSIFY.sampleLuma(data)` and `SWR_ASSET_CLASSIFY.sampleHue(data)` are defined in `lib/asset-classify.client.js`. All 14 variants (and `engine.html`) load the script and call the helpers instead of inlining the math. The 14 inline luma loops and the 14 inline hue loops are gone. `versions/smoke.html` regains its `hue` computation as a side-effect (because all variants call the same `sampleHue` helper). `npm run check` passes; the existing variant smoke tests pass with bit-identical `it.luma` and `it.hue` values for the same input assets.

## Plan

### Step 1 — create `lib/asset-classify.client.js`

- **Files**: new `lib/asset-classify.client.js` at repo root.
- **Action**: copy the two factored functions from `engine.html:2680-2702` verbatim, wrap in a `(function () { ... })()` IIFE that assigns `window.SWR_ASSET_CLASSIFY = { sampleLuma, sampleHue };`. Follow the existing `lib/*.client.js` style (header comment block, idempotent guard, `'use strict'` not needed for ESM-in-defer — match `lib/storage.client.js`).
- **Content sketch**:
  ```js
  // lib/asset-classify.client.js — shared asset-color-classification helpers.
  //
  // Used by every engine page's `Lib._classify()` to compute Rec. 601 luma
  // and circular-mean hue from a 32×32 RGBA probe. Pure functions, take a
  // Uint8ClampedArray (the .data from canvas.getImageData), return a scalar
  // in [0, 1].
  //
  // Extracted from engine.html:2680-2702 so the 14 variants don't each
  // carry a copy of the same math (and so a future color metric — e.g.
  // saturation or chroma — has a single home).

  (function () {
    if (window.SWR_ASSET_CLASSIFY) return;

    function sampleLuma(data) {
      let s = 0;
      for (let i = 0; i < data.length; i += 4) {
        s += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      }
      return (s / (data.length / 4)) / 255;
    }

    function sampleHue(data) {
      let sx = 0, sy = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx === mn) continue;
        const d = mx - mn;
        let h = 0;
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
        const a = Math.cos(h * Math.PI * 2);
        const b2 = Math.sin(h * Math.PI * 2);
        sx += a; sy += b2;
      }
      const n = data.length / 4;
      return (Math.atan2(sy / n, sx / n) / (Math.PI * 2) + 1) % 1;
    }

    window.SWR_ASSET_CLASSIFY = { sampleLuma, sampleHue };
  })();
  ```
- **Verify**: file exists, opens with no syntax errors. `grep -c "sampleLuma\\|sampleHue" lib/asset-classify.client.js` returns ≥4 (function defs + window export).

### Step 2 — register the new file in `vite.config.js`

- **Files**: `vite.config.js`.
- **Action**: add `'lib/asset-classify.client.js'` to the `rootFiles` array. Place it next to the other `lib/*.client.js` entries (search for `'lib/auth.client.js'` and add the new line below it for grouping). The build copy plugin already handles `lib/*.client.js` via the generic directory walk — explicit registration in `rootFiles` is required because `copyDirRecursive` in `vite.config.js:14` only copies entries listed in `rootFiles` at the buildStart phase.
- **Verify**: `grep -n "asset-classify" vite.config.js` returns 1 hit.

### Step 3 — replace inline math with helper calls in each variant

- **Files**: 14 variants. Per file, find the `let luma=0,...0.299*d[i]...` line (locations in "Scan evidence" above) and replace the luma + hue math blocks with helper calls.

  The replacement shape for each variant is:
  ```js
  // before (example: aurora.html:472)
  let luma=0,hue=0; for (let i=0;i<d.length;i+=4) luma += 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  it.luma = (luma/(d.length/4))/255;
  let sx=0,sy=0; for (let i=0;i<d.length;i+=4){
    const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);
    if (mx===mn) continue; const df=mx-mn; let h=0;
    if (mx===d[i]) h=((d[i+1]-d[i+2])/df)%6;
    else if (mx===d[i+1]) h=(d[i+2]-d[i])/df+2;
    else h=(d[i]-d[i+1])/df+4;
    h/=6; sx+=Math.cos(h*Math.PI*2); sy+=Math.sin(h*Math.PI*2);
  }
  it.hue = (Math.atan2(sy/(d.length/4), sx/(d.length/4))/(Math.PI*2)+1)%1;

  // after
  it.luma = SWR_ASSET_CLASSIFY.sampleLuma(d);
  it.hue  = SWR_ASSET_CLASSIFY.sampleHue(d);
  ```

- **Special cases**:
  - **`versions/collage.html:182-195`** uses a single fused pass over `d`. Replace the body of that fused loop with helper calls (option a from "Why this cycle"): make two separate calls — one `sampleLuma(d)`, one `sampleHue(d)`. Cost: one extra ~1 KiB loop pass on a 32×32 probe, runs once per asset-load, ~50µs. Net win in code clarity.
  - **`versions/smoke.html:589-608`** is missing the hue calculation entirely. After this plan, it gains `it.hue = SWR_ASSET_CLASSIFY.sampleHue(d);` — **this is a deliberate behavior fix**, not a regression. The previous "missing hue" was a silent bug; restoring it matches what the other 13 variants and `engine.html` do. Document in the commit message.
  - **The 13 variants with both luma + hue** get the replacement verbatim from the example above.
- **Verify**: `grep -c "0\\.299\\*d\\[i\\]" versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html` returns 0 across all 14 files. (Engine.html still has 1 hit, by design — the helpers stay defined there as a fallback OR get deleted in Step 5.)

### Step 4 — add `<script src>` for the new module in each variant

- **Files**: 14 variants. Each variant already has a script-tag block at the top of `<body>` that loads `client/library-loader.client.js` and `engine-render.client.js` and others — search for the line `<script src="../engine-render.client.js"></script>` in any variant to find the spot.
- **Action**: insert `<script src="../lib/asset-classify.client.js" defer></script>` **before** the inline `<script>` IIFE that contains `Lib._classify` (so the helper is defined by the time the IIFE runs). The inline IIFE is at the bottom of each `<body>` (typically near `requestAnimationFrame(loop)`); insert the `<script src>` in the head-area tag list, near `<script src="../lib/reset-state.client.js"></script>`.
- **Special**: `versions/music_video.html` and `versions/film.html` use `/lib/` (absolute path) in some script tags; check and use the same style — search for `<script src="/lib/` and match. Both actually use `../lib/` for these — verify by grep.
- **Verify**: `grep -c "asset-classify.client.js" versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html` returns 1 per file.

### Step 5 — handle `engine.html` (optional, deferred)

- **Files**: `engine.html`.
- **Status**: engine.html is on the dirty tree (8-button parity work + SWR_HOOK_DETECTOR + SWR_HERO_FRAMES + 6 other parity modules, all in PR-reviewable form). Adding `<script src="/lib/asset-classify.client.js">` + replacing the inline `sampleLuma`/`sampleHue` definitions at `engine.html:2680-2702` with calls to `SWR_ASSET_CLASSIFY.sampleLuma(d)` / `sampleHue(d)` would be a clean dedupe — **but the dirty baseline makes this step risky**. Recommend deferring Step 5 to a follow-up commit after the parity PR merges. The 14 variants work standalone once Step 1-4 land; engine.html continues to use its inlined helpers and ignores `SWR_ASSET_CLASSIFY` (which is harmless — the helpers are pure functions, the engine.html versions are byte-identical, and the unused module adds ~30 lines to the served bundle, masked by the existing service-worker cache).
- **Future work**: a small follow-up plan after the parity PR merges to swap engine.html to the helpers (deletes ~22 lines from engine.html, gains ~50 bytes from the new module — net ~21 lines saved repo-wide).

### Step 6 — add a smoke verifier

- **Files**: new `verify-asset-classify.mjs` at repo root.
- **Action**: open `/versions/aurora.html` (or any variant), stub `SWR_ASSET_CLASSIFY` if missing, drop a synthetic 1×1 image asset (a 4-channel red pixel via `Image` + `URL.createObjectURL`), wait for `_classify` to fire, read `window.SWR.lastLib.items[0].luma` and `.hue`. Assert:
  - `luma === 0.299` (the Rec. 601 contribution from pure red, ±0.001)
  - `hue === 0` (red is at the 0° hue bin, with the `(atan2(...)+1)%1` mapping, ±0.001)
  - The same assertions pass for `/versions/smoke.html` after the smoke-bug fix (it.hue is no longer undefined).
- **Verify**: `npm run verify:asset-classify` exits 0; smoke and the original 5 variant smokes all still pass.

### Step 7 — codemod template stays clean

- **Files**: `versions/_render-inject.js` (the draw-loop codemod, lines 141-213).
- **Action**: **no change**. The codemod rewrites the draw-loop body only — `Lib._classify` lives in the IIFE before the loop and is untouched. Re-running `node versions/_render-inject.js` after Step 3 lands must produce zero `git diff` lines.
- **Verify**: `node versions/_render-inject.js` on each patched variant returns `git diff` empty.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes (the new `lib/asset-classify.client.js` is in the build output — `ls dist/lib/asset-classify.client.js`).
- `npm run verify:asset-classify` passes (new verifier from Step 6).
- `npm run verify:autoplay`, `npm run verify:hallucination-story`, `npm run verify:music-video-maker` still pass — they exercise variant library loads but don't assert specific color values.
- `grep -rn "0\\.299\\*d\\[i\\]" versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html` returns zero matches.
- `grep -rn "SWR_ASSET_CLASSIFY" versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html` returns exactly 1 hit per file (the helper call).
- `grep -rn "asset-classify.client.js" versions/{aurora,chrome,collage,eclipse,film,fractal,glitch,grid,hallucination,music_video,neon,pulse,smoke,void,watercolor}.html` returns exactly 1 hit per file (the script tag).
- Manual smoke: load `/versions/smoke.html` and `/versions/aurora.html`, drop the same asset (e.g. a JPEG of a sunset — strong red/orange dominance) into each, verify the asset card thumbnail strip shows the same luma/hue classification values (the on-screen display only shows it.luma / it.hue in the persona-recipe context; check via DevTools `$0.dataset.luma` if no UI surface).

## Risks / gotchas

- **`smoke.html` regains hue computation** — this is a deliberate fix, but downstream persona-recipe logic may have been written assuming `it.hue === 0` for unclassified assets. Spot-check: search `versions/smoke.html` for `\.hue\b` to see what reads it. If any recipe branches on hue, verify the new value (≈0 for a uniform-gray probe, or asset-specific for real assets) doesn't trigger a different render path that visually regresses. The existing `verify:hallucination-story` exercises smoke (which is the same render family as hallucination) — if that smoke passes after the dedupe, the visual parity is sufficient.
- **`collage.html` fused-pass perf** — swapping the single-pass loop for two helper calls costs one extra ~1 KiB Uint8ClampedArray scan per asset-load (~50µs on a modern desktop, more on mobile). The probe is 32×32 RGBA = 4096 bytes / 1024 pixels = 1024 loop iterations. Negligible on a cold path that runs once per file-drop, but worth noting for very-large batch drops (e.g. dropping 50 assets at once via a multi-file input).
- **`<script>` tag ordering** — the new `<script src="../lib/asset-classify.client.js" defer>` must load before the inline IIFE that defines `Lib._classify`. Both have `defer`/`async`-off semantics so order is preserved, but verify by adding `console.assert(window.SWR_ASSET_CLASSIFY)` at the top of each variant's inline IIFE (or just remove after first successful run). The variants don't use `<script type="module">` for the inline IIFE, so `defer` keeps order. If a variant uses `type="module"`, the inline IIFE is implicitly deferred regardless — order still preserved by source order in the DOM.
- **PWA service worker cache** — `sw.js` precaches the app shell (lines 17-32). Adding a new file means a SW update + bump to `CACHE_VERSION` (line 4: `'swr-v2'` → `'swr-v3'`). Without the bump, existing PWA users get the old SW that doesn't know about the new file; their browsers fall through to the network for `/lib/asset-classify.client.js` (same-origin cache-first handler at `sw.js:114-135` handles this gracefully — first load fetches + caches). So a CACHE_VERSION bump is **not strictly required** for first deploy — but recommend bumping to `'swr-v3'` for the offline-shell guarantee.
- **`engine.html` math dedupe** — Step 5 is deferred because of the dirty tree. The duplication lives for one more release cycle; the win is small (~22 lines) and bounded by Step 5's follow-up. No regression.
- **`_classify` is fire-and-forget** (callback-driven via `loadeddata`/`load` event + `{ once: true }`) — the new helper calls run synchronously inside the callback. No promise / async complications. Pure functions.

## Out of scope

- **`engine.html:2680-2702` inline `sampleLuma`/`sampleHue` deletion** — deferred to Step 5 / follow-up PR. Engine.html currently uses its inlined helpers and ignores `SWR_ASSET_CLASSIFY` (harmless).
- **The 8-button parity work** (in-flight, dirty tree at `engine.html:1200-1207`, `engine.html:4811-4818`, `engine.html:5485-6728`) — separate PR, separate cycle. This plan's Step 4 does NOT touch engine.html.
- **Other `Lib.*` IIFEs in the variants** — `removeItem`, `addFiles`, `render` etc. all carry minor shape variation per variant (smoke has a slightly different thumb size 160×120 vs others' 120×120). The shape is intentional per-variant; the dedupe is **only** the math. Future cycles can extract more (`createProbeCanvas()`, `buildThumb(src, w, h)`), but those need per-variant decision.
- **`personas.json` / `library/manifest.json` color metadata** — the dedupe targets the runtime classification path, not the static manifest. The static manifest is curated by hand and doesn't carry per-asset luma/hue. No interaction.
- **The 4 engine.html non-variant pages** (engine.html, landing.html, etc.) — none have a `Lib._classify`; the only one that classifies is engine.html itself (which this plan defers). Nothing to dedupe.
- **Removing the inline `Math.cos(h * Math.PI * 2)` micro-optimization** — `engine.html:2700` uses a local `const a = Math.cos(...)` to skip the second multiply (saves ~50ns/iteration × 1024 iterations = 50µs/asset). Variants don't have this micro-opt. Restoring it would require either re-inlining (defeats the dedupe) or adding a third helper (`sampleHueAccum`) — not worth the complexity for a 50µs gain on a cold path. The plan accepts the minor perf delta in exchange for the dedupe win.

## Follow-ups (for next cycle, NOT this one)

- Step 5: swap `engine.html:2680-2702` to call `SWR_ASSET_CLASSIFY.sampleLuma/sampleHue` and delete the local helpers. Net ~22 lines saved. Defer until the parity PR merges.
- Bump `sw.js:CACHE_VERSION` from `'swr-v2'` to `'swr-v3'` (and re-test offline-shell). Optional for this PR; recommended as part of the Step 5 follow-up.
- Extract a third helper `sampleChroma(data)` for future palette-overlay work. The dedupe sets up the home; the metric can be added in one PR instead of 14.
- Consider extracting `createProbeCanvas()` (the `document.createElement('canvas') + c.width=32 + c.getContext('2d')` triple) — repeats across all 14 variants. Same dedupe shape, smaller win.
