# Future-Proof Plan — SWR Architecture 2.0

> Generated: 2026-10-12  
> Source: Linguist analysis (commit 52796033) + codebase audit  
> Status: Draft for review

---

## Executive Summary

This plan addresses technical debt, team scalability, and long-term maintainability. It synthesizes lessons from the Linguist codebase analysis with SWR-specific needs. The goal: make the project maintainable by a team (or future self) without losing the velocity of a single-developer setup.

**Key themes:**
1. **Type safety** — Add gradual TypeScript adoption
2. **Module architecture** — Replace IIFE with ES modules
3. **Code decomposition** — Split the 1052-line `db.js` 
4. **Test infrastructure** — Organize tests from npm scripts to directories
5. **Performance** — WASM for audio, cache improvements
6. **Data-driven design** — Apply Linguist's YAML-for-policy pattern

**Investment:** ~3-4 weeks of focused work  
**Risk:** Low — all changes are additive or refactoring

---

## Priority Matrix

| Priority | Item | Effort | Impact | Team Scalability |
|----------|------|--------|--------|------------------|
| P0 | Split `api/_lib/db.js` | 2 days | High | Enables parallel backend work |
| P0 | Test directory reorganization | 1 day | Medium | Scales to more tests |
| P1 | Add TypeScript to new code | Ongoing | High | Catches bugs early |
| P1 | IIFE → ESM migration (new modules) | 1 week | High | Team-ready architecture |
| P2 | Audio engine WASM | 1 week | Medium | Performance headroom |
| P2 | Cache key refactor | 1 day | Low | Marginal improvement |
| P3 | HTML template engine | 1 week | Low | Maintenance burden |
| P3 | Vercel Blob resolver tests | 1 day | Low | Robustness |

---

## P0: Critical — Code Decomposition

### 1. Split `api/_lib/db.js` (1052 LOC → ~6 modules)

**Current state:** One file handles adapter selection, locks, auth, projects, storage, rate limiting, Stripe Connect, health checks.

**Target state:**

```
api/_lib/
├── db.js              # Adapter selection only (USE_PG, USE_BLOB)
├── stores/
│   ├── auth-store.js  # findUserByEmail, createUser, session management
│   ├── project-store.js # getProject, upsertProject, listProjects
│   ├── storage-store.js # blob put/get/del
│   ├── connect-store.js # Stripe Connect ledger
│   └── rate-limit.js   # rate limiter (can stay in-memory)
├── locks/
│   ├── pg-lock.js     # pg_advisory_xact_lock wrapper
│   └── file-lock.js   # process-local promise chain
└── health.js          # /api/health endpoint logic
```

**Migration path:**

1. Create `api/_lib/stores/` directory
2. Move functions one at a time, updating call sites
3. Keep `db.js` as thin re-export layer for backward compatibility during transition
4. Remove re-exports once all callers updated

**Rationale:** Matches Linguist's "policy is data, mechanism is code" philosophy applied to backend architecture. Each store is independently testable.

---

### 2. Test Directory Reorganization

**Current state:** 100+ npm scripts in `package.json`, no discoverable test runner.

**Target state:**

```
tests/
├── unit/
│   ├── audio-analysis.test.mjs
│   ├── db-auth.test.mjs
│   └── ...
├── smoke/
│   ├── engine-boot.smoke.mjs
│   ├── automix.smoke.mjs
│   └── ...
├── verify/
│   ├── cloud-auth.verify.mjs
│   ├── site-nav.verify.mjs
│   └── ...
└── run.mjs            # Discovers and runs tests
```

**Migration path:**

1. Move existing `verify-*.mjs` → `tests/verify/`
2. Move existing `check-*-unit.mjs` → `tests/unit/`
3. Move existing `check-*-smoke.mjs` → `tests/smoke/`
4. Create `tests/run.mjs` that discovers and runs with `node --test`
5. Update `package.json` scripts to delegate to `node tests/run.mjs`

**Benefits:**
- `node tests/run.mjs --grep "auth"` filters tests
- Coverage reports work natively
- Parallel execution with `--parallel`
- Easier to add new tests (copy template)

---

## P1: High Priority — Type Safety & Module Architecture

### 3. TypeScript for New Code

**Current state:** All JavaScript, no types.

**Target state:** New modules in TypeScript, JSDoc for existing modules.

**Migration path:**

1. Configure `tsconfig.json` with `"allowJs": true`, `"checkJs": true`
2. Convert `api/_lib/stores/*` to TypeScript first (backend, less churn)
3. Add `.ts` extension to new client modules
4. Use JSDoc `@type` for gradual typing of existing IIFE modules

**Why not full conversion?** The IIFE-on-window pattern doesn't fit TS modules cleanly. This is a gradual approach:
- New code = TypeScript
- Existing code = JSDoc where valuable, leave as-is otherwise

**Files to convert first:**
- `api/_lib/stores/*.js` (backend, isolated)
- `audio-analysis-v2.js` (core DSP, benefits from types)
- New feature modules

---

### 4. IIFE → ESM for New Modules

**Current state:** Every client module is an IIFE attaching to `window.X`.

**Target state:** New modules use ES modules, existing modules stay IIFE (gradual migration).

**Migration path:**

1. Create new features as ES modules
2. Use dynamic `import()` in `engine.html` for new modules
3. Keep existing IIFE modules as-is; they work
4. Document the pattern: "New code: ESM. Legacy code: IIFE."

**Example — new module as ESM:**

```js
// lib/new-feature.mjs (NOT .client.js)
export function computeSomething(input) {
  // TypeScript would be: export function computeSomething(input: Input): Output
  return { /* ... */ };
}
```

```js
// In engine.html
<script type="module">
  import { computeSomething } from '/lib/new-feature.mjs';
  // Use it
</script>
```

**Benefits:**
- Tree-shaking works for new code
- Explicit dependencies (vs window globals)
- Future-proof: when the last IIFE is removed, full ESM build is possible

**When to use each:**

| Scenario | Use |
|----------|-----|
| Shared utility (used by multiple pages) | ESM |
| Page-specific logic | IIFE (simpler) |
| Global singleton (FX, SWR) | IIFE (documented pattern) |
| New feature | ESM |

---

## P2: Performance & Optimization

### 5. Audio Engine WASM (Optional)

**Current state:** 400-line pure JS FFT/BPM/key detection.

**Target state:** WebAssembly port for 5-10x speedup on long audio files.

**Approach:**

1. **Don't rewrite.** Keep the JS version as the default (works everywhere, simple).
2. **Add WASM as optional accelerator.** Use it when available.
3. **Use an existing library:** `kissfft-js` or similar, rather than writing from scratch.

```js
// audio-analysis-v2.js — conditional WASM
import { FFT } from './fft-wasm.mjs' with { optional: true };

const useWasm = typeof FFT !== 'undefined';
const fft = useWasm ? new FFT(4096) : new JsFFT(4096);
```

**When to do this:** Only if batch analysis of long files (>2 min) becomes a bottleneck. Current JS version is fine for typical use.

---

### 6. Cache Key Refactor

**Current state:** Cache keyed by `versionHash = sha256(JSON.stringify(applyRResult) + assetId)`.

**Target state:** Key by frame counter.

**Migration path:**

1. Add `layerStateVersion` counter to each layer
2. Increment on every `applyR` call
3. Use `layerStateVersion` as cache key
4. Remove hash computation

**Why:** Simpler, no hash collision risk, marginally faster.

```js
// Current
const key = hash(JSON.stringify(applyRResult) + assetId);

// Target
layer.stateVersion = (layer.stateVersion || 0) + 1;
const key = `${assetId}:${layer.stateVersion}`;
```

---

## P3: Maintenance & Robustness

### 7. HTML Template Engine (Optional)

**Current state:** 86 hand-edited HTML files.

**Target state:** Server-side or build-time templates with includes.

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| 11ty | Static, fast, familiar | Another tool |
| Vite plugin | Keep current setup | More complex config |
| Build-time includes | No runtime deps | Limited logic |

**Recommendation:** Don't do this yet. The 86 pages are a *feature*, not a bug — they're SEO-friendly, individually testable, and the marketing team can edit them without touching code. Only reconsider if the burden grows significantly.

---

### 8. Vercel Blob Resolver Tests

**Current state:** 50-line function with edge cases, no tests.

**Target state:** Test suite covering prefix variations.

```js
// tests/unit/vercel-blob-resolver.test.mjs
test('uppercase BLOB outranks lowercase blob', () => {
  const result = resolveBlobCredentials({
    BLOB_READ_WRITE_TOKEN: '...',
    blob_READ_WRITE_TOKEN: '...',
  });
  expect(result.prefix).toBe('BLOB');
});

test('bare BLOB outranks BLOB2', () => {
  const result = resolveBlobCredentials({
    BLOB_READ_WRITE_TOKEN: '...',
    BLOB2_READ_WRITE_TOKEN: '...',
  });
  expect(result.prefix).toBe('BLOB');
});
```

---

## Data-Driven Design Principles (from Linguist)

Apply these patterns to new code:

### 9. Policy as YAML

**When:** Any decision matrix that might grow (feature flags, persona mappings, variant configs).

**Example:**

```js
// Before: hardcoded in JS
const VARIANT_AFFINITY = {
  'creative-pro': ['neon', 'film', 'aurora'],
  'music-lover': ['pulse', 'spectrum'],
};

// After: YAML + loader
const VARIANT_AFFINITY = loadYaml('/data/variant-affinity.yaml');
```

**Existing candidates:**
- `targeting/rules.json` — already JSON, could be YAML
- `variants/*.automix.json` — already JSON, fine as-is

---

### 10. Cascade over Voting

**When:** Any "which thing matches this input" decision.

**Linguist pattern:** Strategy chain → candidate passes → terminates on single match.

**SWR candidate:** Audio feature classification.

```js
// Before: score all, pick best
const scores = candidates.map(c => ({ candidate: c, score: score(input, c) }));
return scores.sort((a, b) => b.score - a.score)[0];

// After: cascade, stop early
for (const strategy of strategies) {
  const result = strategy.test(input);
  if (result.confidence >= THRESHOLD) return result;
}
```

---

### 11. Confidence as Return Value

**When:** Any classification or detection function.

```js
// Before
function detectLanguage(blob) { return 'Ruby'; }

// After
function detectLanguage(blob) {
  const result = runStrategyChain(blob);
  return { language: result.language, confidence: result.confidence };
}
```

---

## Implementation Timeline

| Week | Focus | Deliverable |
|------|-------|--------------|
| 1 | P0: db.js split | 6 new store modules |
| 1 | P0: Test reorganization | `tests/` directory with runner |
| 2 | P1: TypeScript setup | `tsconfig.json`, first `.ts` files |
| 2 | P1: ESM for new code | New feature as ESM |
| 3 | P2: Cache refactor | Simpler cache keys |
| 3 | P2: Blob resolver tests | Test coverage |
| 4 | P2: Audio WASM (optional) | Optional WASM fallback |

---

## Success Metrics

- [ ] `api/_lib/db.js` < 200 LOC
- [ ] `tests/run.mjs --grep "auth"` runs only auth tests
- [ ] New modules use TypeScript or ESM
- [ ] No regression in `npm run check:full`
- [ ] Cache hit rate unchanged after refactor

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing API routes | Keep re-exports in `db.js` during transition |
| Test discovery breaks | Run full suite after each move |
| TypeScript friction | Start with `.ts` files only, no conversion of existing JS |
| IIFE ↔ ESM interop | Use dynamic `import()` for ESM → IIFE communication |

---

## Appendix: Linguist Patterns to Adopt

| Pattern | SWR Application | Status |
|---------|-----------------|--------|
| YAML for policy | Variant configs, targeting rules | Partially done (JSON) |
| Cascade classifier | Audio feature detection | Not done |
| Confidence return | All detection functions | Not done |
| Override system | User preferences, project settings | Done |
| Content-hash cache | Media asset caching | Done |
| C extension for hot path | Audio engine WASM | Optional |

---

# Section B: Version Chrome & Cache Invalidation

> Refined 2026-10-13. Focused, decisive implementation plan. All code shown is the actual code to ship; code is intentionally short so the review load stays low.

## TL;DR

| What | Where | New file? |
|------|-------|-----------|
| Version constant (single source of truth) | `lib/app-version.js` | NEW |
| Version dropdown on every page | `client/looks-menu.client.js` + `data-looks-mount` | Edit existing |
| Bottom-right home link | `lib/home-link.client.js` | NEW |
| Version badge (bottom-right, left of home link) | `lib/version-badge.client.js` | NEW |
| Auto-clear cache on version change | `lib/app-version-bust.js` | NEW |
| Roll out the 4 scripts to every page | `scripts/migrate-html.mjs` (extend) | Edit existing |
| Test | `tests/unit/app-version-bust.test.mjs` + `tests/smoke/version-chrome.smoke.mjs` | NEW |

**Net new code:** ~120 lines across 5 small files. **No build step changes** — Vite `copyStatic` already handles `lib/*.js`.

## Goals

1. **One version dropdown** in the engine and every `versions/*.html` page.
2. **Homepage link in the bottom-right corner** on every page.
3. **Version number visible on every page** (small, unobtrusive, clickable to changelog).
4. **Auto-clear user cache when version changes** so old state never lingers.

## Design decisions (decisive, not "we'll see")

- **Replace** the top-left `← Site` link in `versions/*.html` and `#nav-home` in `engine.html` with the new bottom-right link. Top-left and bottom-right duplicates serve no one.
- **Bottom-right home link is the only chrome** on every page. No second placement.
- **Version badge is a link to `/changelog.html#v<version>`** — gives users a place to read what changed. `pointer-events: none` would waste the affordance.
- **Sync from `package.json`:** read the version at build time so the constant can never drift. The Vite plugin inlines `package.json#version` into `dist/lib/app-version.js` on each build. The hand-set `2026.10.13.1` lives in `package.json`, not in the JS file.
- **Cache bust clears local + session storage + IndexedDB** for keys prefixed `swr.`, `swr_`, or matching the existing `airlock_*` set. User data is never touched.
- **Reload loop protection** is mandatory — without it, a misconfigured version can lock users out. 3 reloads in 60 seconds, then give up and show the (potentially stale) page.

## Current state

| Area | Status |
|------|--------|
| Engine version dropdown (`#looks`) | ✅ Exists, mounted by `client/looks-menu.client.js` |
| Version pages dropdown | ❌ Each `versions/*.html` has its own scattered controls (e.g. `→ grid` in `film.html`) |
| Bottom-right home link | ❌ `#nav-home` is top-left in engine; `swr-site-exit` is top-left in versions |
| Version display on page | ❌ No version constant exists |
| Cache invalidation on user-side | ⚠️ `sw.js` has `CACHE_VERSION = 'swr-v4'` (SW-side only) but no client-side auto-clear |
| `swr-site-exit` on all pages | ⚠️ 4 pages missing: `console.html`, `gallery.html`, `index.html`, `music-video-gallery.html` |

## Implementation

### B.1 — `lib/app-version.js` (single source of truth)

**Build-time inlined from `package.json#version`.** A Vite plugin (`inline-app-version` in `vite.config.js`) reads `package.json` on each build and writes a fresh `dist/lib/app-version.js`. The constant in source is the placeholder; the real value lives in `package.json`.

```js
// lib/app-version.js — single source of truth for the app version.
// Vite plugin `inline-app-version` regenerates this file on every build
// from package.json#version. The source-of-truth lives in package.json;
// this file is the build artifact, not something to hand-edit.
//
// On cache-bust: window.SWR_APP_VERSION is read by app-version-bust.js
// BEFORE any other script runs. The cache-bust script clears stale
// local state and forces a hard reload when the version changes.
window.SWR_APP_VERSION = '__INLINED_APP_VERSION__';
window.SWR_APP_VERSION_BUILD = '__INLINED_BUILD_TIME__';
```

**Versioning scheme:** `YYYY.MM.DD.N` (e.g. `2026.10.13.1`). Date + daily sequence. Set `package.json#version` once per deploy via the `npm version` wrapper script in `scripts/bump-version.mjs`:

```bash
# scripts/bump-version.mjs (NEW)
# Reads today's date, asks for the sequence number (default: last+1),
# writes package.json#version, commits, prints the new value.
# One command, no manual editing of package.json.
```

### B.2 — `client/looks-menu.client.js` — single change to accept a `data-looks-mount` host

**The existing `mount()` requires `#variant` to be present.** Version pages don't have `#variant`. One small change lets the same module drive the engine and every version page.

```js
// In mount() — change the host lookup to accept either:
function mount() {
  let host = document.querySelector('[data-looks-mount]');
  if (!host) {
    const variant = document.getElementById('variant');
    if (variant) host = variant.closest('.gctrl');
  }
  if (!host || document.getElementById('looks')) return;
  // ... rest unchanged
}
```

**Each version page gets the mount point** injected by `scripts/migrate-html.mjs`. The mount sits in the page header; the script is loaded with the rest of the page.

```html
<!-- Injected into the <header> by the codemod. -->
<span class="gctrl" data-looks-mount></span>
<script src="/client/looks-menu.client.js" defer></script>
```

### B.3 — `lib/home-link.client.js` — bottom-right home link

**Single-purpose module, no IIFE-on-window pattern pollution** (it just appends one DOM node, no global needed).

```js
// lib/home-link.client.js — fixed bottom-right home link, mounted on
// every page. Self-contained; pages load it via <script defer>.
// Layer order (z-index):
//   9999 — this link
//   9998 — version badge (sits 8px to the LEFT of the link)
//   9997 — airlock debug toggle (tools/airlock-debug.html only)
(function () {
  'use strict';
  if (document.getElementById('swr-home-link')) return;
  const a = document.createElement('a');
  a.id = 'swr-home-link';
  a.href = '/';
  a.title = 'Sainted Word Records — home';
  a.setAttribute('aria-label', 'Back to home');
  a.textContent = '← Home';
  // Default styling — pages may override via the swr-home-link class.
  a.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9999',
    'font:600 10px/1 ui-monospace,monospace',
    'color:var(--muted,#888)', 'text-decoration:none',
    'border:1px solid var(--line,#333)', 'border-radius:3px',
    'padding:6px 10px', 'background:rgba(0,0,0,0.55)',
    'backdrop-filter:blur(4px)', 'white-space:nowrap',
  ].join(';');
  // Defer to DOMContentLoaded so the page's own <body> exists.
  if (document.body) document.body.appendChild(a);
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(a));
})();
```

**Migration rule (decisive):** on every page that has `swr-site-exit` or `#nav-home`, **remove** it when adding the new link. Two exit affordances is one too many. The codemod handles this.

### B.4 — `lib/version-badge.client.js` — version display, clickable

**Clickable link to the changelog anchor.** Sits 8px to the LEFT of the home link. `pointer-events: auto` (so clicks work), `user-select: none` (so double-click doesn't select text).

```js
// lib/version-badge.client.js — fixed bottom-right version display.
// Reads window.SWR_APP_VERSION (set by lib/app-version.js).
// Links to the changelog at /changelog.html#v<version>.
(function () {
  'use strict';
  if (document.getElementById('swr-version-badge')) return;
  const v = (window.SWR_APP_VERSION || 'unknown');
  const a = document.createElement('a');
  a.id = 'swr-version-badge';
  a.href = '/changelog.html#v' + v;
  a.textContent = 'v' + v;
  a.title = 'SWR ' + v + ' — see what changed';
  a.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:78px',  // 8px gap + ~54px home-link width
    'z-index:9998',
    'font:9px/1 ui-monospace,monospace',
    'color:var(--muted,#666)', 'text-decoration:none',
    'border:1px solid var(--line,#333)', 'border-radius:3px',
    'padding:6px 8px', 'background:rgba(0,0,0,0.4)',
    'white-space:nowrap', 'user-select:none',
  ].join(';');
  if (document.body) document.body.appendChild(a);
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(a));
})();
```

**Max-width protection:** The version string is always ≤ 14 chars (`v2026.10.13.99`). The fixed `right: 78px` reserves room without overlap. If a future version is longer, bump the offset.

### B.5 — `lib/app-version-bust.js` — auto-clear on version change

**Synchronous script in `<head>`, runs BEFORE any other script.** Order matters and is documented in the script comment.

**Critical fix vs the original plan:** the script must load AFTER `lib/app-version.js`. The order in HTML is `<script src="app-version.js">` then `<script src="app-version-bust.js">` — both synchronous, both in `<head>`, so the constant is set when the bust runs.

```js
// lib/app-version-bust.js — runs synchronously in <head>, AFTER
// app-version.js. If the user has a stale version in localStorage,
// we clear all SWR-owned state and reload once.
//
// Reload-loop protection: 3 reloads in 60s max, then we give up.
// Better to show a stale page than to lock the user out.
//
// Order in <head>:
//   <script src="/lib/app-version.js"></script>      <!-- 1. sets window.SWR_APP_VERSION -->
//   <script src="/lib/app-version-bust.js"></script> <!-- 2. checks + reloads if stale -->
(function () {
  'use strict';

  var current = window.SWR_APP_VERSION;
  if (!current) return;  // app-version.js didn't load — bail, don't break the page

  // ----- loop protection -----
  var LOOP_KEY = 'swr_app_version_reload_count';
  var LOOP_MAX = 3;
  var LOOP_WINDOW_MS = 60000;
  var count = 0;
  try { count = parseInt(localStorage.getItem(LOOP_KEY) || '0', 10); } catch (_) {}
  if (count >= LOOP_MAX) {
    console.warn('[swr] version-bust: reload loop detected, breaking out');
    try { localStorage.removeItem(LOOP_KEY); } catch (_) {}
    return;  // load anyway, stale is better than locked out
  }
  try { localStorage.setItem(LOOP_KEY, String(count + 1)); } catch (_) {}
  setTimeout(function () { try { localStorage.removeItem(LOOP_KEY); } catch (_) {} }, LOOP_WINDOW_MS);

  // ----- version check -----
  var SEEN_KEY = 'swr_app_version_seen';
  var prev = null;
  try { prev = localStorage.getItem(SEEN_KEY); } catch (_) {}
  if (prev === current) return;  // up to date — most common path

  // ----- stale: clear + reload -----
  try {
    // Clear SWR-owned localStorage keys. Match the airlock pattern:
    // prefix-based, plus the well-known airlock keys.
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('swr.') === 0 || k.indexOf('swr_') === 0 ||
          k === 'airlock_logs' || k === 'airlock_version' ||
          k === SEEN_KEY || k === LOOP_KEY) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}

  // Clear session storage (always safe; it's tab-scoped)
  try { sessionStorage.clear(); } catch (_) {}

  // Clear SW caches — the service worker registers later, but its old
  // caches are still readable. We can't wait for the SW to do it on
  // activate (this is the page that's about to reload), so we delete
  // them directly. Best-effort; no-op if SW not yet registered.
  if (window.caches) {
    caches.keys().then(function (names) {
      names.forEach(function (n) {
        // Delete any cache that isn't the current version. The SW will
        // re-create its own cache on next install.
        if (n.indexOf('swr-') === 0 && n !== 'swr-v5') {
          caches.delete(n).catch(function () {});
        }
      });
    }).catch(function () {});
  }

  // ----- record + reload -----
  try { localStorage.setItem(SEEN_KEY, current); } catch (_) {}
  // Hard reload — bypasses the SW cache for this navigation.
  window.location.reload();
})();
```

**`sw.js` CACHE_VERSION bump (one-time, when the version chrome first ships):** `'swr-v4'` → `'swr-v5'`. This is the value the bust script uses to decide which SW caches to delete.

### B.6 — Roll out via `scripts/migrate-html.mjs` (extend existing)

**One codemod, four idempotent injections.** Add a new subcommand `--add-version-chrome` that runs all four in sequence. Each step is a no-op if the relevant markup is already present.

```js
// In scripts/migrate-html.mjs, add a new branch:
//   if (args.includes('--add-version-chrome')) {
//     // 1. inject <script src="/lib/app-version.js"></script> in <head>
//     // 2. inject <script src="/lib/app-version-bust.js"></script> after it
//     // 3. inject <script src="/lib/home-link.client.js" defer></script>
//     // 4. inject <script src="/lib/version-badge.client.js" defer></script>
//     // 5. remove existing #nav-home, .swr-site-exit, and SWR-SITE-EXIT
//     // 6. for versions/*.html, inject <span data-looks-mount></span> in <header>
//     // 7. inject <script src="/client/looks-menu.client.js" defer></script>
//   }
```

**Idempotency:** each step checks for the marker before injecting. Re-running `--add-version-chrome` is a no-op.

**Page list:** every shipped page per `site-map.json`. Already has a `getShippedPages()` helper (or equivalent). The codemod reuses it.

### B.7 — Vite plugin: `inline-app-version`

```js
// In vite.config.js — new plugin:
{
  name: 'inline-app-version',
  buildStart() {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const version = pkg.version;  // e.g. '2026.10.13.1'
    const buildTime = new Date().toISOString();
    const source = `// AUTO-GENERATED by vite-plugin-inline-app-version. Do not edit.
// Source: package.json#version = ${version}
// Build: ${buildTime}
window.SWR_APP_VERSION = ${JSON.stringify(version)};
window.SWR_APP_VERSION_BUILD = ${JSON.stringify(buildTime)};
`;
    writeFileSync('lib/app-version.js', source);
  }
}
```

The plugin runs on every build. The `lib/app-version.js` in source is the placeholder; the build artifact is what ships. `copyStatic` then copies it to `dist/lib/app-version.js`.

**Why in the build, not at runtime?** Build-time inlining matches the existing pattern (`inlineAutomixConfig`, `inlineTargetingRules`, `inlineFooterNav`). One file, one source of truth (`package.json`), zero risk of drift.

### B.8 — Tests

**Unit (`tests/unit/app-version-bust.test.mjs`):**

```js
// Stub localStorage, window.SWR_APP_VERSION, window.location, window.caches
// Run the bust script in a node:vm sandbox
import { test } from 'node:test';
import test from 'node:assert/strict';

// 1. Same version → no reload, no clear
// 2. Different version → localStorage cleared, reload called once
// 3. Loop: 3 reloads in 60s → 4th call bails, console.warn
// 4. localStorage unavailable (throws) → no crash, reload still attempted
// 5. window.caches missing → no crash
// 6. SWR-owned keys cleared; non-SWR keys preserved
// 7. airlock_logs and airlock_version cleared (well-known keys)
```

**Smoke (`tests/smoke/version-chrome.smoke.mjs`):**

```js
// 1. Boot dist/engine via serveDist()
// 2. Assert #swr-home-link exists, href='/', text='← Home'
// 3. Assert #swr-version-badge exists, href matches /changelog.html#v\d+/
// 4. Assert localStorage.swr_app_version_seen === window.SWR_APP_VERSION
// 5. Repeat for dist/versions/film.html, dist/landing.html
// 6. Click #looks <select>, pick a value, assert navigation to /versions/<id>.html
// 7. Click #swr-home-link, assert navigation to /
// 8. Click #swr-version-badge, assert navigation to /changelog.html
```

**Add to gate groups:** `tests/unit/app-version-bust.test.mjs` → `check` (1 step). `tests/smoke/version-chrome.smoke.mjs` → `check:full` (1 step). Update the count in `AGENTS.md` to reflect the additions.

### B.9 — Mobile considerations

- **Bottom-right link vs gesture bar:** iOS Safari and Android Chrome both reserve a small swipe area at the bottom. The link sits at `bottom: 16px` which is above the gesture zone. Test on iPhone 14 / Pixel 7.
- **Badge width:** the version string is up to 14 chars. At 9px monospace, that's ~85px. `right: 78px` plus the home link's ~54px gives the badge ~140px of room. Safe on every modern viewport.
- **Touch targets:** the link is `6px 10px` padding, ~26px tall — meets the 44px iOS HIG recommendation if we bump to `padding: 12px 14px`. The badge is 9px text + 6px×2 padding = 21px, below the 44px bar but it's an info display, not a primary action.

**Decision:** bump link padding to `12px 14px` (meets HIG) and leave badge as-is. Update B.3's `cssText` accordingly.

### B.10 — Migration order (10 steps, with verification)

1. **Add `inline-app-version` plugin to `vite.config.js`.** *Verify:* `npm run build` writes the expected `dist/lib/app-version.js` with the right version.
2. **Create `lib/app-version-bust.js`.** *Verify:* unit test in `tests/unit/app-version-bust.test.mjs` passes (TDD — write the test first).
3. **Create `lib/home-link.client.js` and `lib/version-badge.client.js`.** *Verify:* manual load `dist/landing.html` and confirm both elements appear at bottom-right.
4. **Update `client/looks-menu.client.js`** to accept `data-looks-mount`. *Verify:* `npm run check:variants-unit` still passes.
5. **Extend `scripts/migrate-html.mjs` with `--add-version-chrome`.** *Verify:* `--dry-run` on one page shows the expected diffs; no changes written.
6. **Run `--apply` on every shipped page** (re-using the codemod's existing page discovery). *Verify:* `git diff --stat` shows the expected files modified.
7. **Add `tests/smoke/version-chrome.smoke.mjs` and wire into `check:full`.** *Verify:* `npm run check:full` passes.
8. **Bump `CACHE_VERSION` in `sw.js`** from `'swr-v4'` to `'swr-v5'`. *Verify:* `npm run check` passes; the bust script's cache filter matches.
9. **Manual test in production:** deploy to Vercel preview, open `/engine/`, observe version badge; bump version in `package.json`, rebuild, reload — confirm cache clears and badge updates.
10. **Run `npm run check:full`** and `npm run verify:site-nav`. *Verify:* all gates green.

### B.11 — Release workflow

**One command bumps the version for everyone.** `scripts/bump-version.mjs`:

```bash
$ node scripts/bump-version.mjs
Current version: 2026.10.13.1
Today's date: 2026-10-13
New version: 2026.10.13.2? [Y/n/custom]: y
✓ package.json updated
✓ Git committed as "chore(version): 2026.10.13.2"
```

**On every push to `main`:** the `inline-app-version` plugin runs at build time, `dist/lib/app-version.js` is regenerated, and every user who has the previous version in localStorage will trigger the bust script on their next visit.

### B.12 — Risks & mitigations (consolidated)

| Risk | Mitigation |
|------|------------|
| Reload loop on misconfigured version | 3-reload / 60s cap, then give up |
| `app-version.js` fails to load → bust silently bails | Script returns early if `window.SWR_APP_VERSION` is undefined; page loads normally |
| Bottom-right link conflicts with mobile gesture bar | Link is at `bottom: 16px`, well above the gesture zone; bump padding to 12px×14px for HIG |
| Bottom-right link conflicts with airlock toggle | Z-index layering: home link 9999, badge 9998, airlock 9997 |
| `localStorage` unavailable (private mode, quota) | Every `localStorage` call is wrapped in try/catch; bust continues even if a step throws |
| Version drift between `package.json` and runtime | Build-time inlining from `package.json#version`; the JS file is regenerated every build |
| Cache bust clears user data | Only clears `swr.*` / `swr_*` / `airlock_*` keys; everything else preserved |
| `data-looks-mount` collides with existing variant pages | Test on `film.html` (has its own grid link), `neon.html` (core), `aurora.html` (artistic) |
| Codemod double-injects on re-run | Each step checks for its marker before injecting; idempotent |
| `sw.js` CACHE_VERSION bump breaks offline users | The bust script deletes `swr-v*` caches other than the current one; SW re-installs on next load |

### B.13 — Success metrics

- [ ] Every shipped page shows the version badge (linked to changelog)
- [ ] Every shipped page has the bottom-right home link
- [ ] Every `versions/*.html` has a working `#looks` dropdown
- [ ] Top-left `← Site` / `#nav-home` removed from all pages (no duplicates)
- [ ] Bumping `package.json#version` forces a clean reload on next visit
- [ ] Reload loop protection verified by unit test
- [ ] No new test failures in `npm run check:full`
- [ ] Smoke test verifies dropdown navigates to the right page
- [ ] Mobile (iOS Safari, Android Chrome) renders the link above the gesture bar

---

*This section is a living document. Update as implementation proceeds.*
