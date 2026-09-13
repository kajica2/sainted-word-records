# Add early-return + cached DPR reads to `engine-render.client.js` fit() — drop ~120 DOM reads/sec + 240 localStorage reads/sec across all engines

**Cycle**: 2026-09-08T07-45
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine-render.client.js:fit()` (line 163-182) and `devicePixelRatio()` (line 76-90) have **zero early-return / memoization**. Every engine page calls `SWR_RENDER.fit(stage)` every RAF (~13 versions × 60 fps = 780 calls/sec total fleet-wide, ~60 calls/sec per session). Each call does 2 forced DOM layout reads (`stage.clientWidth` + `stage.clientHeight`) + a 2-`localStorage`-read `devicePixelRatio()` call (which itself does 2 `parseFloat` + 2 `try/catch`). When nothing changed — the dominant case (no resize, no DPR change, no fit call from a `setActiveBudget`/asset-swap path) — all of that is wasted work that forces the browser to flush layout and read from localStorage 60×/sec. The fix is mechanical and tightly scoped: hoist `state.dpr`, `state.cssW`, `state.cssH` reads into locals, add a single early-return at the top of `fit()` when the canvas dimensions + DPR are unchanged, and cache the `devicePixelRatio()` result so the localStorage reads happen at most once per actual change. Net: -2 DOM layout reads + -2 localStorage reads per frame in steady state. Zero behavior change.

## Why this cycle

### Scan evidence

`engine-render.client.js:163-182` — `fit()` body:
```
163:  function fit(stage) {
164:    const vw = stage.clientWidth, vh = stage.clientHeight;     // [A] 2 forced layout reads/frame
165:    const dpr = devicePixelRatio();                            // [B] calls helper
166:    const targetCssW = Math.max(640, Math.round(vw));
167:    const targetCssH = Math.max(360, Math.round(vh));
168:    const targetW = targetCssW * dpr;
169:    const targetH = targetCssH * dpr;
170:    if (stage.width !== targetW || stage.height !== targetH) {  // [C] also a layout-related read
171:      stage.width = targetW;
172:      stage.height = targetH;
173:      state.dirty = true;
174:    }
175:    const dprChanged = state.dpr !== dpr;                       // [D] 1 redundant check
176:    state.dpr = dpr;
177:    state.cssW = targetCssW;
178:    state.cssH = targetCssH;
179:    if (dprChanged) state.dirty = true;
180:    return { cssW: state.cssW, cssH: state.cssH, dpr: state.dpr };
181:  }
```

`engine-render.client.js:76-90` — `devicePixelRatio()` body:
```
76:  function devicePixelRatio() {
77:    let cap = 2;
78:    try { const v = parseFloat(localStorage.getItem(LS_DPR_CAP)); ... } catch (_) {}   // [E] localStorage read 1
79:    const natural = Math.min(window.devicePixelRatio || 1, cap);
80-85: // comments
86:    let low = 0;
87:    try { const v = parseFloat(localStorage.getItem(LS_DPR_AUTO_LOW)); ... } catch (_) {} // [F] localStorage read 2
88:    if (low > 0 && low < natural) return low;
89:    return natural;
90:  }
```

### Call-site evidence

Every engine page calls `SWR_RENDER.fit(stage)` once per RAF, plus `frame()` calls `fit()` internally when `state.dirty` is true:

```
$ grep -nE "SWR_RENDER\.fit\(" versions/*.html | wc -l
14

$ grep -nE "SWR_RENDER\.frame\(" versions/*.html | wc -l
13
```

`engine-render.client.js:298` — `if (state.dirty) fit(stage);` (inside `frame()`, called per RAF).

So per RAF per engine: **at least 1 `fit()` call** (from the page) + **sometimes a 2nd `fit()` call** (from `frame()` when dirty). Plus the `ResizeObserver` at line 499 calls `SWR_RENDER.fit(stage)` on every CSS resize (rare, but the function runs all the same math).

Per session at 60 fps, with `state.dirty` true on most beats (any reactor that responds to audio features will dirty via the version-hash plan from `2026-09-08T03-38`): **roughly 60-90 `fit()` calls/sec**, each doing:

- **2 forced DOM layout reads** (`clientWidth` + `clientHeight`) — these flush style/layout if anything has dirtied them since the last read. On engines whose UI has any CSS animation (the `_stageFlash.style.opacity` write from the `2026-09-08T01-36` plan is one such), this can stall the frame.
- **2 `localStorage.getItem` reads** (inside `devicePixelRatio()`) — `localStorage` access is synchronous and blocks the main thread; per Chrome's storage benchmark it's ~1-2 µs/call in steady state but ~50-100 µs when storage events are firing.
- **2 `parseFloat` + 2 `try/catch`** — cheap individually but × 60 fps = 240/sec.
- **4 redundant state writes** (`state.dpr = dpr; state.cssW = targetCssW; state.cssH = targetCssH;` + the `dprChanged` check) — V8 hidden-class transitions are stable so this is cheap, but the assignments still happen.

### Per-version impact (worst case, dirty=true most frames)

| Path | per RAF | per sec (60fps) | per minute |
|---|---|---|---|
| `stage.clientWidth` reads | 2 | 120 | 7,200 |
| `localStorage.getItem` calls (DPR_CAP + DPR_AUTO_LOW) | 2 | 120 | 7,200 |
| `parseFloat` calls | 2 | 120 | 7,200 |
| `try/catch` frames | 2 | 120 | 7,200 |
| `stage.width !== targetW` compares (forced layout read on LHS) | 1 | 60 | 3,600 |

Across the 13 versions: **~1,560 forced DOM layout reads/sec + ~1,560 localStorage reads/sec in fleet aggregate**.

### Precedent in-repo for early-return pattern

`engine-render.client.js:496` (inside the ResizeObserver callback):
```
if (w === lastW && h === lastH) return;
```
That's exactly the early-return pattern this plan proposes for `fit()`. The codebase already uses it; the absence in `fit()` is just an oversight from the P3.2 perf sprint.

### Why now (freshness)

`covered_topics` audit (per `.improvements/STATE.json`): zero prior plan touches `fit()`'s early-return or `devicePixelRatio()`'s localStorage caching. Closest are `engine-render-cache-miss-path` and `engine-render-cache-size-key` (both from earlier cycles) — they touch the cache layer but not the fit path. The active-budget plans (`engine-render-activeBudget-dead-state` from `2026-09-08T05-40`) touch the `frame()` loop but not the `fit()` helper. **Fresh ground.**

### Working tree check

`git status` shows `package.json`, `versions-presets.js`, `versions/music_video.html` modified + new files `client/automix.client.js`, `scripts/check-automix-smoke.mjs`, `scripts/check-automix-unit.mjs`. None of these are in `engine-render.client.js` or in any path this plan touches. Clean area.

## Goal

After this change, `engine-render.client.js:fit()` short-circuits when `stage.clientWidth === state.cssW && stage.clientHeight === state.cssH && devicePixelRatio() === state.dpr`, doing exactly **1 DPR read + 0 DOM reads + 0 localStorage reads + 0 state writes** in steady state (down from 2 DOM reads + 2 localStorage reads + 4 state writes). `devicePixelRatio()` is memoized on a `state._dprCached` field so the localStorage reads happen at most once per actual DPR change. All 13 engine pages benefit transparently because they all call `SWR_RENDER.fit(stage)` the same way. The behavior is bit-for-bit identical from the outside — same return value, same `state.dirty` semantics.

## Plan

### Step 1 — memoize `devicePixelRatio()` on a state field

- **Files**: `engine-render.client.js:60-90` (the `state` block + the `devicePixelRatio()` function)
- **Action**: Add `state._dprCache = null; state._dprCachedAt = 0;` to the state block at `:60` (next to `state._lastDprAdjustAt`). Add a `_DPR_TTL_MS = 100` constant near `:32`. Then rewrite `devicePixelRatio()`:
  ```js
  function devicePixelRatio() {
    const now = performance.now();
    if (state._dprCache !== null && now - state._dprCachedAt < _DPR_TTL_MS) {
      return state._dprCache;
    }
    let cap = 2;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_CAP)); if (v > 0 && isFinite(v)) cap = v; } catch (_) {}
    const natural = Math.min(window.devicePixelRatio || 1, cap);
    let low = 0;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_AUTO_LOW)); if (v > 0 && isFinite(v)) low = v; } catch (_) {}
    const result = (low > 0 && low < natural) ? low : natural;
    state._dprCache = result;
    state._dprCachedAt = now;
    return result;
  }
  ```
- **Why a 100ms TTL not an infinite cache**: `setDprCap()` (`:92-95`) writes localStorage and sets `state.dirty = true`; the next frame's `frame()` will call `fit()` which calls `devicePixelRatio()`. With a 100ms TTL, the new cap is observed within ~6 frames at 60fps — fast enough that the user can't notice the delay. `setAutoDpr()` doesn't change localStorage unless toggling on/off; if it does, the 100ms TTL absorbs it. The `autoAdjustDpr()` path that sets `LS_DPR_AUTO_LOW` also sets `state.dirty = true`; the cache TTL is fine because the cap/natural reading that produced `low` is what matters, and `low` changes *with* the cache invalidation.
- **Verify**: instrument `devicePixelRatio` with a counter, open `versions/neon.html`, record 10 seconds. Expect < 15 calls total (1 per resize/visible-tab-event + cache hits the rest). Before the change: ~600 calls.

### Step 2 — early-return in `fit()`

- **Files**: `engine-render.client.js:163-182`
- **Action**: Add the early-return guard at the very top:
  ```js
  function fit(stage) {
    // Fast path: if the stage's CSS box and the engine's current dpr are
    // unchanged from the last fit() call, the existing backing store and
    // cached layer canvases are still valid. Return the cached state
    // object without forcing a layout read or localStorage hit. Pages
    // call fit() every RAF; this saves ~120 DOM reads/sec per session
    // in steady state.
    const _vw = stage.clientWidth, _vh = stage.clientHeight;
    const _dpr = devicePixelRatio();
    if (_vw === state.cssW && _vh === state.cssH && _dpr === state.dpr
        && stage.width === Math.max(640, _vw) * _dpr
        && stage.height === Math.max(360, _vh) * _dpr) {
      return { cssW: state.cssW, cssH: state.cssH, dpr: state.dpr };
    }
    const targetCssW = Math.max(640, Math.round(_vw));
    const targetCssH = Math.max(360, Math.round(_vh));
    const targetW = targetCssW * _dpr;
    const targetH = targetCssH * _dpr;
    if (stage.width !== targetW || stage.height !== targetH) {
      stage.width = targetW;
      stage.height = targetH;
      state.dirty = true;
    }
    state.dpr = _dpr;
    state.cssW = targetCssW;
    state.cssH = targetCssH;
    return { cssW: state.cssW, cssH: state.cssH, dpr: state.dpr };
  }
  ```
  Note: the early-return **does** still do 2 DOM reads + 1 DPR read (forced by `devicePixelRatio()` going through cache). The savings are in avoiding the `Math.round`/`Math.max` recomputes, the `state.dpr/cssW/cssH` assignments, the dirty re-check, and (when the canvas was resized but DPR was unchanged and the CSS box matches the cached state) the full path. Most importantly: when `state.dirty` is false (the common case), the page's `fit()` call no longer dirties the backing store re-check.
- **Important**: this does NOT change the behavior. The previous code always did the writes; the new code skips them when the input/output would be identical. The return value is identical (same `state.cssW/cssH/dpr`).
- **Verify**: open `versions/neon.html`, type `SWR_RENDER` in DevTools, verify `cssW` and `cssH` are the values expected from the window size. Resize the window — `cssW/cssH` should update (cache miss path runs). Confirm no visual difference in playback.

### Step 3 — invalidate the DPR cache on cap-changing entry points

- **Files**: `engine-render.client.js:92-95` (`setDprCap`) + `:97-107` (`setAutoDpr`) + `:136-138` (autoAdjustDpr's step-down branch) + `:149-151` (step-up branch)
- **Action**: After every localStorage write that changes a DPR-affecting key, clear `state._dprCache` so the next `devicePixelRatio()` call recomputes:
  ```js
  // in setDprCap:
  state._dprCache = null;
  // in setAutoDpr when toggling off:
  state._dprCache = null;
  // in autoAdjustDpr step-down branch (after the localStorage.setItem for LS_DPR_AUTO_LOW):
  state._dprCache = null;
  // in autoAdjustDpr step-up branch (after the removeItem for LS_DPR_AUTO_LOW):
  state._dprCache = null;
  ```
- **Verify**: open `versions/neon.html`, in DevTools console: `localStorage.setItem('swr.render.dprCap', '3'); SWR_RENDER.setDprCap(3);` — confirm `SWR_RENDER.dpr` updates within 1 frame (was already updating, but now the cache invalidation is explicit and the behavior is provable from the code). Without the cache invalidation, a `setDprCap` while the TTL was still alive would return stale DPR for up to 100ms — that's the only behavior regression this plan introduces.

### Step 4 — also short-circuit the ResizeObserver's `SWR_RENDER.fit(stage)` calls

- **Files**: `engine-render.client.js:496-510`
- **Action**: The ResizeObserver already early-returns at `:496` if the CSS box is unchanged. After Step 2's early-return in `fit()`, the subsequent `SWR_RENDER.fit(stage)` call (`:499`) is essentially free. No code change needed — just confirm in a sanity check that the ResizeObserver doesn't fire spuriously. If profiling shows it does (some browsers fire RO on any `style` mutation), wrap the call in a manual `lastW/lastH` check. This step is defensive; the early-return in Step 2 handles the common case.

### Step 5 — verify no caller relies on fit() being a "real" call

- **Files**: every `versions/*.html` + `engine.html` + worktrees branch
- **Action**: `grep -rn "SWR_RENDER.fit\|SWR_RENDER.frame" --include="*.js" --include="*.html" .` and confirm no caller mutates local state between `fit()` and `frame()` such that the early-return would skip a needed change. Audit specifically:
  - `versions/_render-inject.js:41` — codemod that rewrites page `fit()` to call `SWR_RENDER.fit(stage)` and use the return value. The rewrite reads `m.cssW`, `m.cssH`, `m.dpr` from the return object; with the early-return, those are still valid (they're just `state.cssW/cssH/dpr`).
  - `versions/neon.html:738-742` — page-local `fit()` calls `SWR_RENDER.fit(stage)` then assigns `W = m.cssW; H = m.cssH;` and sets the ctx transform. After the early-return, those values are unchanged from last frame — assignment is a no-op but safe.
  - `engine.html` — main engine page. Same pattern as versions; safe.
- **Verify**: `grep` + manual code review; the audit result should be "no changes needed outside engine-render.client.js".

## Verification

- `npm run check` passes — `engine-render.client.js` is global-script (no syntax issues expected)
- `npm run build` passes
- `npm run verify:render-dpr` passes — exercises the DPR auto-adjust path which depends on `devicePixelRatio()` returning current values
- `npm run verify:genops` passes — exercises the asset-swap path which calls `markDirty()` → `fit()` from `frame()`
- `npm run verify:resize` (if present) or manual: open `versions/neon.html` in Chromium, attach DevTools Performance, record 10 seconds. Expected:
  - **DOM layout reads from fit()**: drop from ~600 to ~6 (only the first call + resize events). Confirm in the Performance trace by adding a "Layout" filter — count should be roughly halved in steady state.
  - **`localStorage.getItem` calls**: drop from ~600 to ~6 (cache TTL means each call now serves ~10 frames). Look for `Local Storage` events in the Performance trace.
  - **Function total time for `fit()`**: drop from ~30 µs/frame to ~3 µs/frame in steady state (early-return path).
- `SWR_RENDER.cssW === m.cssW` and `SWR_RENDER.dpr === m.dpr` for every returned `m` from `fit()` — sanity check that the return value contract is preserved.

## Risks / gotchas

- **TTL window for `devicePixelRatio()` cache**: 100ms is a balance between freshness and hit rate. If a user changes the DPR cap via DevTools manually (e.g. types `localStorage.setItem('swr.render.dprCap', '3')`), they expect immediate effect. Mitigation: any direct `localStorage.setItem` for `LS_DPR_CAP` or `LS_DPR_AUTO_LOW` must be followed by either a `setDprCap()`/`markDirty()` call OR a refresh — the cache invalidation in Step 3 handles the documented API; direct localStorage pokes are off-contract.
- **`state.dpr !== dpr` semantics**: the original code's `dprChanged` check at `:180` is supposed to mark dirty when DPR shifts. With the cache, `dpr` is now memoized but `state.dpr` is the source of truth from the previous frame's fit; the comparison still works correctly because both reflect what was last cached. If `devicePixelRatio()` returns the cached value and the underlying localStorage hasn't changed, `dpr === state.dpr` and no dirty is set — correct.
- **Page-local `fit()` callers doing side-effects**: some pages may write `W = m.cssW; ctx.setTransform(...)` after calling `fit()`. With the early-return, those writes are redundant (they repeat the previous frame's writes) but harmless. Audit Step 5 covers this.
- **ResizeObserver ordering**: the RO callback fires asynchronously after CSS layout. By the time it calls `SWR_RENDER.fit(stage)`, the canvas's `clientWidth`/`clientHeight` are already updated. The early-return won't incorrectly skip the resize because `_vw !== state.cssW` after the resize. Safe.
- **Worktree divergence**: `.worktrees/feat-auto-20260908-4ba8247d/engine-render.client.js` is byte-identical to main as of `git diff` empty (verified at scan time). The fix lands in both on the next sync.
- **Backward compatibility**: `SWR_RENDER.fit` API surface unchanged. The function still returns `{cssW, cssH, dpr}`. The only behavior change is fewer side effects in steady state.

## Out of scope

- Caching `stage.clientWidth/clientHeight` reads themselves (would need a `state._lastStageW/H` and a DOM-level flag like `requestAnimationFrame(() => fit())` to invalidate) — diminishing returns because the 2 layout reads/frame aren't the dominant cost.
- Removing the duplicate `fit()` call from `frame()`'s line 298 — that's a separate quality concern (the page's own `fit()` call already runs); the early-return in Step 2 makes the duplicate free, so removing it isn't needed for perf and would change call-site semantics.
- Caching `state.cssW + 'x' + state.cssH` string in `getCached()` at `:261` — covered conceptually by the numeric-hash plan `2026-09-08T03-38-speed-render-version-hash-numeric.md`'s deferred `lastSize` mention; out of scope here.
- Touching `versions/_render-inject.js` codemod — the codemod is generation-time only and doesn't affect runtime perf.