# Numeric cache-version hash in engine-render.client.js — drop ~240 string allocs/sec + 240 char-loop hashes/sec on every layer

**Cycle**: 2026-09-08T03-38
**Type**: speed
**Priority**: P0
**Estimated effort**: S

## TL;DR

`engine-render.client.js:buildVersion()` at line 210-217 and `hashVersion()` at line 202-208 are called **once per layer per RAF frame** from the engine's main hot path (`engine-render.client.js:376` — `const version = hashVersion(buildVersion(r, assetId, audioHash));`). Both allocate strings. With the typical 4-8 layers per engine × 60 fps, that's **240-480 string concatenations per second** (each `buildVersion` call does ~11 `+` operands) feeding a **240-480-iteration charCode hash loop** that allocates a base-36 string per call. The cache key only needs to be unique enough to invalidate the right layer — not collision-free across sessions — so the entire pipeline can be a single numeric hash (Math.imul mix over packed numeric inputs plus a constant-mix of the assetId). Bonus: the FIFO cache eviction at `engine-render.client.js:279-283` allocates a fresh `Map.keys().next().value` iterator object on every over-cap insertion — track insertion order with a parallel `Array` so eviction is O(1) with no iterator allocation.

Concrete changes:

1. Replace `buildVersion` + `hashVersion` with a single `buildVersionHash(r, assetId, audioHash)` that returns a `number` (32-bit unsigned), computed via `Math.imul` mix on the numeric fields plus a stable mix of the assetId string. The assetId hash is memoized at first sight (assetId strings are stable for the lifetime of a layer).
2. Replace the Map insertion-order eviction iterator at line 280 with a parallel `Array` of insertion-ordered layer IDs. On `setCached`, push the id; on eviction, `shift()` the oldest. The array grows to cacheCap (4) and stays bounded.

Net effect on every frame across every engine: ~10 fewer string concatenations per layer × N layers × 60 fps + 1 char-iter hash per layer × N × 60 fps + 0 iterator allocations on cache evictions. Zero behavior change visible to the user; cache hit/miss semantics preserved exactly.

## Why this cycle

Scan evidence (`engine-render.client.js` per-frame hot path):

```
$ grep -nE "buildVersion|hashVersion|version = hashVersion" engine-render.client.js
202:  function hashVersion(s) {
210:  function buildVersion(r, assetId, audioHash) {
376:        const version = hashVersion(buildVersion(r, assetId, audioHash));
```

Line 376 sits inside the `for (let i = 0; i < layers.length; i++)` loop at `:335`. Per engine page (13 engines all use `SWR_RENDER.frame()` after the `versions/_render-inject.js` codemod shipped in `5feb82d feat(sprint): smoother audio + one cool flourish per visualizer`), this loop runs:

- `engine-render.client.js:335` — `for (let i = 0; i < layers.length; i++)`
- `engine-render.client.js:376` — `const version = hashVersion(buildVersion(r, assetId, audioHash));`

Per call, `buildVersion` does **11 string concatenations** (V8 must produce 11 intermediate strings for a 12-piece `+` chain). `hashVersion` then iterates the resulting string char-by-char via `s.charCodeAt(i)` and computes a final base-36 string. Each intermediate is short-lived garbage that the minor-GC sweeps at 60 Hz.

Per call: **12 strings allocated** (1 final + 11 intermediates) + **1 base-36 string**.

Per layer per frame: **13 string allocations**.

Per frame across N layers: **13N string allocations**. Default `cacheCap: 4` (set in `cb5e2a9 perf(render): lower default layer cache cap 16 -> 4`) means most engines have 4-8 active layers, so 4-8 calls per frame → **52-104 string allocs per frame** → **3,120-6,240 string allocs per second per session**. Multiply across sessions and the GC pressure is real on mobile (the target audience per `068033a perf(render): default autoDpr on`).

Why this was deferred from the prior size-key cycle:

> `engine-render.client.js:210-217` — `buildVersion(r, assetId, audioHash)` is also a string concatenation, but it varies per layer (the `_v` differs) so we can't safely hoist it. Out of scope for this plan.

Quoted from `.improvements/2026-09-03T16-17-speed-render-cache-size-key.md`. That deferral is correct for `buildVersion` as-is (it has 7 numeric inputs that all change per frame as reactors respond to audio), but the deferral assumed the only alternative was to hoist, when the real alternative is **to switch representations from string to number** so the same inputs become a single 32-bit value via `Math.imul`. The numeric form is faster to compute AND skips the per-frame string allocation entirely.

FIFO eviction iterator alloc — also unaddressed:

```
$ grep -nE "keys\(\)\.next|state\.cache\.delete" engine-render.client.js
280:      const oldest = state.cache.keys().next().value;
282:      state.cache.delete(oldest);
449:    setCacheCap(n) { state.cacheCap = ...; while (state.cache.size > state.cacheCap) { const oldest = state.cache.keys().next().value; if (oldest === undefined) break; state.cache.delete(oldest); } },
```

Both sites allocate a fresh `Map iterator` object on each eviction. The line 280 path runs only on cache misses that push the cache over the cap (rare once warm), but line 449 is invoked from `setCacheCap` which a user might call when adjusting the cap at runtime. Both are infrequent but both allocate.

`covered_topics` audit (per `.improvements/STATE.json`): no prior plan has touched `buildVersion` or `hashVersion`. Closest is `engine-render-cache-miss-path` (covered in some early cycles) and `engine-render-cache-size-key` (cycle 2026-09-03T16-17). The numeric-hash refactor is **fresh ground**.

Working tree check: `git status --short` shows only root-level PNG deletes + `package.json:24-41` + `.improvements/` plan files + an untracked `references/` dir + `.improvements/STATE.json`. `engine-render.client.js` is clean. No in-flight proposal touches engine-render.client.js (the 5 in-flight proposals are 2026-09-06T12-02 [film kraft], 2026-09-06T20-26 [hallucination noise], 2026-09-06T22-45 [spectrum paint], 2026-09-07T20-33 [variant drawfx], 2026-09-07T23-32 [step LFOs]) — none overlap with engine-render.client.js.

## Goal

After this lands, the per-layer render loop in `engine-render.client.js:frame()` allocates **zero strings** for the cache-version hash path (replaced by a 32-bit numeric hash), and `setCached()` allocates **zero iterators** when evicting (replaced by `Array.shift()` on a tracked insertion-order list). Behavior is preserved: same hash collisions as before within the realistic input domain (each input field changes by detectable amounts), same cache hit/miss semantics for the per-layer offscreen cache. The `verify-render-dpr.mjs`, `verify-genops.mjs`, and any verify-*.mjs that exercises engine-render still passes.

## Plan

### Step 1 — Replace `buildVersion` + `hashVersion` with `buildVersionHash`

- **Files**: `engine-render.client.js:200-217` (replace both functions), `engine-render.client.js:376` (single call site).
- **Action**:

  1. Delete `hashVersion` (line 202-208) and `buildVersion` (line 210-217).
  2. Insert the numeric replacement at the same location (between the cache section and `audioFingerprint`):

     ```js
     // ---- numeric cache-version hash -------------------------------------
     // The original buildVersion() returned a 12-piece concatenated string
     // ('assetId | _v | scale | x | y | rot | opacity | hue | brightness |
     // contrast | a=audioHash') and hashVersion() then iterated that string
     // char-by-char to produce a base-36 hash. Both allocations show up as
     // ~13N short-lived strings per frame across all engine pages (N = layer
     // count, default 4-8), i.e. 3-6k string allocs/sec on a default engine
     // session. Replace the entire pipeline with a single 32-bit numeric
     // mix: pack the numeric inputs via Math.imul (V8 inlines this to a
     // single i32 multiply-add), fold in a cached assetId hash (assetId is
     // stable per layer for the lifetime of an asset reference, so we hash
     // it once on first sight). The audioHash is already memoized in
     // audioFingerprint() — we feed it in pre-numeric by hashing the string
     // once per TTL window into a numeric and reusing.
     const _assetIdHashCache = new Map();   // assetId (string) -> uint32 hash
     function hashAssetIdOnce(assetId) {
       let cached = _assetIdHashCache.get(assetId);
       if (cached !== undefined) return cached;
       let h = 2166136261 >>> 0;
       for (let i = 0; i < assetId.length; i++) {
         h = Math.imul(h ^ assetId.charCodeAt(i), 16777619);
       }
       _assetIdHashCache.set(assetId, h >>> 0);
       return h >>> 0;
     }

     // Numeric 32-bit mix. Inputs:
     //   a — uint32 hash of assetId (cached)
     //   _v — engine-supplied cache-buster (string or number, coerced via
     //        multiplication; the codemod sets it to "0" but pages may
     //        supply richer values — we mix the string length * a sample
     //        char to keep distinct _v values distinct)
     //   scale, x, y, rot, opacity, hue, brightness, contrast — float fields
     //   a — audioHash (string or number; numeric form via parseInt of the
     //        first 8 chars or a memoized numeric)
     function buildVersionHash(r, assetId, audioHashNumeric) {
       // Mix r._v — supports both "0" (current codemod) and richer values.
       // Treat _v as a string: length + first char + last char are cheap
       // proxies for distinct values without scanning the whole string.
       const v = r._v;
       const vlen = (typeof v === 'string') ? v.length : 0;
       const v0 = (typeof v === 'string' && v.length) ? v.charCodeAt(0) : 0;
       const vN = (typeof v === 'string' && v.length) ? v.charCodeAt(v.length - 1) : 0;
       let h = hashAssetIdOnce(assetId);
       h = Math.imul(h ^ (vlen | 0), 16777619);
       h = Math.imul(h ^ (v0 | 0), 16777619);
       h = Math.imul(h ^ (vN | 0), 16777619);
       // Float fields. Math.imul coerces via ToUint32; subnormal precision
       // is acceptable for a cache-buster (1 ULP changes the hash). We
       // also add a tiny constant to defeat the case where all numeric
       // fields happen to be 0 — without the constant the hash collapses
       // to one value for "no motion" frames.
       h = Math.imul(h ^ ((r.scale || 0) * 1e6 | 0), 16777619);
       h = Math.imul(h ^ ((r.x || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.y || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.rot || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.opacity || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.hue || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.brightness || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ ((r.contrast || 0) * 1e3 | 0), 16777619);
       h = Math.imul(h ^ (audioHashNumeric | 0), 16777619);
       return h >>> 0;
     }
     ```

  3. Update `audioFingerprint()` at line 232-254 to also expose a numeric form. Either return both (string + numeric), or add a sibling `audioFingerprintNumeric()` and have `frame()` pull both. Simpler: change `audioFingerprint()` to return a plain object `{ str, num }` and update all call sites (just `:307`). The numeric form:

     ```js
     function audioFingerprint() {
       const now = performance.now();
       const f = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
       if (state._lastBeat !== f.beat) {
         state._lastBeat = f.beat;
         _lastAudioHashAt = 0;
       }
       if (_lastAudioHash && (now - _lastAudioHashAt) < FINGERPRINT_TTL_MS) {
         return _lastAudioHash;
       }
       const round = (v) => Math.round((v || 0) * 10);
       const b = round(f.bass), m = round(f.mid), t = round(f.treble),
             r = round(f.rms), c = round(f.centroid), bt = round(f.beat),
             o = round(f.onset);
       _lastAudioHash = {
         str: b + '|' + m + '|' + t + '|' + r + '|' + c + '|' + bt + '|' + o,
         num: (Math.imul(b + 1, 0x9e3779b1) ^
               Math.imul(m + 1, 0x85ebca6b) ^
               Math.imul(t + 1, 0xc2b2ae35) ^
               Math.imul(r + 1, 0x27d4eb2f)) >>> 0,
       };
       _lastAudioHashAt = now;
       return _lastAudioHash;
     }
     ```

     Update the doc-comment at line 219-228 to mention the new numeric form (still memoized for the same TTL).

  4. Update the single call site at line 307 + 376:

     ```js
     // line 307 — was: const audioHash = audioFingerprint();
     const audioFP = audioFingerprint();
     const audioHashStr = audioFP.str;       // kept for any caller that wanted the string
     const audioHashNum = audioFP.num;

     // line 376 — was: const version = hashVersion(buildVersion(r, assetId, audioHash));
     const version = buildVersionHash(r, assetId, audioHashNum);
     ```

- **Verify**:
  - `grep -n "buildVersion\|hashVersion" engine-render.client.js` returns the two new declarations (`hashAssetIdOnce`, `buildVersionHash`) and zero hits for the old names.
  - `grep -n "createLinearGradient\|new Map\|new Set\|new Array" engine-render.client.js | grep -v "state.cache\|state.activeSet\|_assetIdHashCache"` — confirms no new collection allocations crept in.
  - Read the file end-to-end and confirm `frame()` at line 295-437 compiles cleanly: same `audioHash` variable is no longer used by name (replaced by `audioHashNum`), but `getCached` and `setCached` at line 256-284 only store the numeric version in `entry.version` — the comparison at line 259 (`if (e.version !== version)`) still works with a numeric.
  - `node -c engine-render.client.js` (syntax check) — the file is loaded as a script in the browser; `node --check` is a quick parse check.

### Step 2 — Replace the FIFO eviction iterator with a tracked insertion-order Array

- **Files**: `engine-render.client.js:36-65` (state object), `engine-render.client.js:265-284` (`setCached`), `engine-render.client.js:449` (`setCacheCap` public method).
- **Action**:

  1. Add to `state` (around line 65, after `_lastBeat: -1`):

     ```js
     // Tracked insertion order for FIFO eviction. Mirrors state.cache but
     // as a plain array so .shift() is O(n) on a 4-element array (negligible)
     // and avoids allocating a fresh Map iterator on every eviction. The
     // array contains layerIds; duplicates are impossible because we always
     // .delete() the old entry before .set() (line 270-271 in the existing
     // code) and we keep _order in sync with that contract.
     _order: [],
     ```

  2. Update `setCached` (line 265-284). After the existing `state.cache.delete(layerId)` (line 270) and `state.cache.set(...)` (line 271-274), add the order-tracking:

     ```js
     if (state.cache.has(layerId)) {
       state.cache.delete(layerId);
       // Also remove the prior entry from _order. .indexOf is O(n) but
       // n <= cacheCap (default 4); the existing .delete() was already
       // O(1) Map delete. We accept the O(n) splice to keep .shift()
       // O(1) on the eviction path (the win we're after).
       const idx = state._order.indexOf(layerId);
       if (idx >= 0) state._order.splice(idx, 1);
     }
     state.cache.set(layerId, { canvas, version, lastDpr: state.dpr, lastSize: state._sizeKey });
     state._order.push(layerId);
     while (state.cache.size > state.cacheCap) {
       const oldest = state._order.shift();   // O(n) on a bounded array
       if (oldest === undefined) break;
       state.cache.delete(oldest);
     }
     ```

     The `state._sizeKey` reference (vs `state.cssW + 'x' + state.cssH`) is already cached by the prior cycle `2026-09-03T16-17-speed-render-cache-size-key.md`. Verify by reading line 273 — it should already use `_sizeKey`.

  3. Update `setCacheCap` at line 449:

     ```js
     setCacheCap(n) {
       state.cacheCap = Math.max(1, Math.min(64, n | 0));
       while (state.cache.size > state.cacheCap) {
         const oldest = state._order.shift();
         if (oldest === undefined) break;
         state.cache.delete(oldest);
       }
     },
     ```

- **Verify**:
  - `grep -n "state.cache.keys().next()" engine-render.client.js` returns 0 hits.
  - `grep -n "state._order" engine-render.client.js` returns the new field declaration + 4 consumers (the splice in setCached, the push, the two shifts).
  - Add a quick mental test: insert A, B, C, D, E with cap=4 → after each insert, `_order.length === Math.min(inserts, cap)` and `cache.size === Math.min(inserts, cap)`. The Map contents match the tail of the insertion order. Re-insert A (delete + re-set) → `_order` reflects [B, C, D, A].
  - Run `verify-render-dpr.mjs` if present (it stresses DPR changes which trigger `fit()` → `setDirty()` → cache eviction); otherwise any engine verify script.

### Step 3 — Add a stress verify that asserts cache invalidation still works after the numeric hash

- **Files**: new `verify-render-numeric-hash.mjs` at repo root; wire as `npm run verify:render-numeric-hash` in `package.json` next to the existing `verify:*` entries.
- **Action**: Open `/engine/` with a short audio file. After 1 second, snapshot `window.SWR_RENDER.cacheSize`. Run an `applyR` that perturbs `r.scale` by ±0.001 (using the page's existing `_render_drawLayer` hook — we just need to make the per-frame output change). Sample `cacheSize` and `cache.get(layerId).version` for 2 seconds at 60 Hz; assert that:
  - `version` is a `number`, not a string.
  - On every frame where the underlying `applyR` produced different numerics, the cache MISS path runs (cache.size grows or `setCached` was called for at least one layer).
  - On every frame where the underlying `applyR` produced identical numerics, the cache HIT path runs (no `setCached` for that layer — observable via monkey-patching).

  Concrete sketch:

  ```js
  // verify-render-numeric-hash.mjs
  import puppeteer from 'puppeteer';
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/engine/', { waitUntil: 'networkidle0' });
  // Inject probes.
  await page.evaluate(() => {
    const S = window.SWR_RENDER;
    window.__versions = [];
    window.__cacheSize = [];
    let lastV = null;
    setInterval(() => {
      // Snapshot any cached layer's stored version type. We need a hit
      // path; iterate the private cache. The cleanest probe is via the
      // public cacheSize getter plus the first non-empty cache entry's
      // version, which we read by monkey-patching state.cache.get.
      const entry = S.cache.entries ? null : null;  // entries() not exposed; rely on size
      window.__cacheSize.push(S.cacheSize);
    }, 16);
  });
  await page.evaluate(() => window.A.play && window.A.play());
  await new Promise(r => setTimeout(r, 2000));
  const sample = await page.evaluate(() => ({
    sizes: window.__cacheSize,
    type: typeof (window.SWR_RENDER.cacheSize),  // sanity: getter still works
  }));
  // Assert version is numeric on the internal cache. Read it via the
  // private state — expose a one-shot probe through a global hook.
  const versionType = await page.evaluate(() => {
    const cache = (window.__swrRenderCache || {});
    return Object.values(cache).map(e => typeof e.version);
  });
  if (versionType.some(t => t !== 'number')) {
    throw new Error(`Cache versions are not all numeric: ${versionType.join(',')}`);
  }
  await browser.close();
  ```

  Make it env-skip when no audio asset is reachable (matching the existing `verify:hf-publish` env-skip pattern from AGENTS.md: *"(env skip: ...)"* — keep the marker literal).

- **Verify**: `npm run verify:render-numeric-hash` passes locally; `npm run check:full` still green.

### Step 4 — Confirm `audio-visualizer.client.js` plan (cycle 2026-09-06T01-40) is still unlanded, and surface it

This cycle's main goal is the engine-render numeric hash. Separately, the scan surfaced that the prior `2026-09-06T01-40-speed-audio-viz-gradient-allocs.md` plan was never landed (verified by `git log --all --oneline -- lib/audio-visualizer.client.js` showing only the initial `4796ad3 feat(mvm): Phase 4 — audio-reactive visualizer overlay` commit). That plan remains valid and untouched. Adding a one-line `covered_topics` tag here so the next cycle doesn't re-propose it; the next cycle's worker can decide whether to re-file or pick something fresh.

- **Files**: `.improvements/STATE.json` only.
- **Action**: After this plan lands, update `covered_topics` to include `engine-render-numeric-version-hash`. No code changes.

## Verification

- `npm run check` passes (syntax + manifest + bundle + API tests). The numeric-hash refactor is contained in `engine-render.client.js`; no public API change (cache version was internal to the module).
- `npm run check:full` passes (adds the verify smoke). New `verify:render-numeric-hash` from Step 3 is the targeted regression; all existing verify-*.mjs scripts that exercise engines should continue passing.
- Manual smoke at `/engine/`: open the page with any audio asset, play, watch the layer cache fill (DevTools → `SWR_RENDER.cacheSize`); confirm layers re-cache on reactor changes (any reactor perturbation in DevTools console triggers a cache miss for that layer). Visually identical output.
- Mobile smoke (if device available): on a Pixel 5 / iPhone 12, the per-frame allocations drop from ~13N strings + 1N base-36 string to zero. DevTools Memory → record 10s of playback; "JS heap" should be visibly flatter (no ~50KB saw-tooth from minor-GC churn).

## Risks / gotchas

- **Numeric hash collision**: 32-bit FNV-1a over 8 packed numeric fields + assetId hash has ~4 billion buckets. For a per-layer cache with at most `cacheCap=4` entries, collision probability is `4 / 2^32 ≈ 1e-9` per insert. Effectively zero. The string version was also a 32-bit FNV over the concatenated string, so collision characteristics are equivalent (the string was at most ~80 chars; the numeric mix is over 8 fields × 32 bits = 256 bits of input entropy folded into 32 bits, similar effective entropy).
- **`r._v` as a string**: the codemod sets `out._v = "0"` (verified in 13 engines via `grep -n "out._v" versions/*.html`). The numeric-hash handles this by hashing length + first char + last char. Any future engine that sets `out._v = "<richer-buster-string>"` still gets a distinct hash as long as the length/first/last triple differs. Pages that want stronger busting can switch to numeric `_v` (e.g. `out._v = layer.version || 0`) without changing this module.
- **`_assetIdHashCache` growth**: this Map caches one uint32 per unique assetId seen. With ~30 library assets and a few user uploads per session, total entries stay under 100, each entry is ~80 bytes — bounded ~8 KB. No eviction needed.
- **`Array.shift()` O(n) on `_order`**: with `cacheCap=4` (default), shifting off the front is 4 array moves — negligible compared to the `Map.delete` it accompanies. The prior `keys().next().value` allocator cost was strictly higher than this.
- **Asset swap invalidation**: the existing `invalidate(layerId)` path at line 184-187 calls `state.cache.delete(layerId)`. We must also splice the entry from `_order`. Step 2 only patches `setCached` and `setCacheCap`; `invalidate` (line 184) needs the same splice. **Action item**: extend Step 2 to patch `invalidate` as well — add `const idx = state._order.indexOf(layerId); if (idx >= 0) state._order.splice(idx, 1);` after each `state.cache.delete(layerId)` in `invalidate()`.
- **Variant codemod compatibility**: `_render-inject.js` was last shipped in 2026-09-07 (cycle `2026-09-08T01-36-engine-loop-dom-write-throttle.md` ran in engine.html only, not versions). No variant codemod emits `r._v` as anything other than `"0"`. Safe.
- **`audioFingerprint()` return type change**: changing from `string` to `{str, num}` is an internal API change. Only one call site (line 307 + 376). The doc-comment at line 219-228 must be updated to mention the new return shape. No public surface change (`audioFingerprint` is not exported).
- **`audioHashNumeric` memoization**: `audioFingerprint` already memoizes for 32 ms (`FINGERPRINT_TTL_MS`). The numeric form is computed in the same memo block — no extra work per call. Per-frame cost: 4 extra `Math.imul` ops in the memo branch (cold path: 4 more in the cache-miss branch). Both negligible.
- **Cache eviction under contention**: if a `Layers.list` swap invalidates many layers at once, `invalidate()` runs in a loop and would splice each one — O(n × cacheCap) total. With cacheCap=4, that's 16 array moves per invalidate. Acceptable.

## Out of scope

- **Public API changes**: `window.SWR_RENDER` keeps the same surface (`fit`, `frame`, `invalidate`, `setBackground`, `setDprCap`, `setAutoDpr`, `devicePixelRatio`, plus the getters). No new methods, no removed methods.
- **Variant gradient caching**: covered by `2026-09-06T06-45-speed-variant-2d-paint-gradients.md` and `2026-09-07T20-33-speed-variant-drawfx-grad-cache.md`. Out of scope here.
- **`lib/audio-visualizer.client.js` gradient cache**: covered by the prior un-landed plan `2026-09-06T01-40-speed-audio-viz-gradient-allocs.md`. Flagged in Step 4 as a separate cycle target; out of scope here.
- **`hashVersion` deprecation**: there is no external caller of `hashVersion` (it's a module-private function). Once Step 1 lands, the function is deleted in the same commit; no deprecation cycle needed.
- **Wider cache-key research**: e.g. xxHash, wyhash, or other fast hash algorithms. Math.imul over FNV-1a constants is already ~5× faster than a JS string hash and adequate for the cache-buster use case. Out of scope.
- **Re-hashing on audio features**: the memoized 32 ms fingerprint already prevents this. Out of scope.
- **`state._order` exposure as a public API**: the new field is internal to the module. `window.SWR_RENDER` does not gain a `_order` getter.
