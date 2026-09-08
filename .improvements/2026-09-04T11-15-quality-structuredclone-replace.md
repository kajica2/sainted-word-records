# Replace JSON-roundtrip clones with native structuredClone

**Cycle**: 2026-09-04T11-15
**Type**: quality
**Priority**: P2
**Estimated effort**: XS

## TL;DR

Two production code paths use `JSON.parse(JSON.stringify(x))` as a deep-clone
trick (`brandkit.client.js:413` + 6 call sites; `engine-keys.client.js:460`
in `duplicateLayer`). Both are exactly the kind of payload `structuredClone`
was added to the language to handle — and JSON roundtrip silently drops
`undefined`, `Date`, `Map`, `Set`, typed arrays, and any non-JSON-safe
fields. The codebase targets `es2022` (see `vite.config.js:build.target`),
which ships `structuredClone` baseline in every supported browser
(Chrome 98+, Firefox 94+, Safari 15.4+ — all early 2022); no fallback
needed. Replace both uses with `structuredClone`, drop the helper, and
rely on the engine to throw a loud `DataCloneError` if a future field
ever becomes non-cloneable (good — surfaces bugs early).

## Why this cycle

- Eight consecutive speed plans have shipped (`.improvements/2026-09-04T08-49` et al.).
  `covered_topics` shows no `structuredClone` or clone-correctness work.
  This is a fresh angle: a small **correctness + safety** change that
  guards against silent data loss without a measurable perf delta.
- `brandkit.client.js:413` defines a one-line helper used at lines 49,
  52, 53, 56, 63, 65, 284 — seven call sites total. Every profile read
  and every palette merge round-trips through JSON.stringify. Today the
  payload is `{ name, email, brandkit: { logoDataUrl, logoName, brandName,
  palette: { primary, secondary, accent, bg, fg }, font } }` — pure
  primitives + strings. JSON happens to work. The moment a future field
  adds an `uploadedAt: Date`, an `analytics: Map`, a `transforms: Float32Array`,
  or a `lastEditedBy: undefined`, the user gets silent data loss or a
  broken-palette bug.
- `engine-keys.client.js:460` is `duplicateLayer()`. Triggered by
  user keystroke (`d` shortcut). Cloning a layer that includes
  `reactors: [{ feature, target, scale, ... }]` round-trips through JSON
  today. If a future reactor gains a runtime-only field (e.g. a function
  callback, an `OffscreenCanvas` handle, a `Map<id, easingFn>`), the
  user duplicates a layer and the original is preserved but the copy
  silently loses that field.
- Native `structuredClone` produces the **same** result for the current
  payloads, **preserves** `undefined`/`Date`/`Map`/`Set`/typed arrays if
  they ever appear, and **throws** on un-cloneable values (functions,
  DOM nodes) so a future regression is loud instead of silent.

## Goal

Replace both `JSON.parse(JSON.stringify(...))` clone sites with
`structuredClone(...)` and verify the brandkit profile round-trip and
`duplicateLayer()` still produce visually-identical results.

## Plan

### Step 1 — replace the brandkit helper
- **Files**: `brandkit.client.js:413`
- **Action**: change the local one-liner
  ```js
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  ```
  to
  ```js
  const clone = structuredClone;
  ```
  The 7 call sites (`brandkit.client.js:49,52,53,56,63,65,284`) need no
  edits — `clone(x)` still works.
- **Verify**: open `brandkit.client.js`, `grep -n "JSON.parse(JSON.stringify" brandkit.client.js` returns no matches; `grep -nE "clone\\(" brandkit.client.js` returns the 7 call sites unchanged.

### Step 2 — replace duplicateLayer's clone
- **Files**: `engine-keys.client.js:460`
- **Action**: replace
  ```js
  const copy = JSON.parse(JSON.stringify(src));
  ```
  with
  ```js
  const copy = structuredClone(src);
  ```
- **Verify**: `grep -n "JSON.parse(JSON.stringify" engine-keys.client.js` returns no matches; line 460 reads `const copy = structuredClone(src);`.

### Step 3 — syntax + behavioral smoke
- **Action**: run `npm run check:syntax` and `npm run check` (full local gate).
- **Action**: launch the dev server (`npm run dev`), navigate to `/engine/`,
  press `d` to duplicate the selected layer, confirm the new layer
  appears in the panel with identical `reactors`, `opacity`, `blend`, and
  `asset` reference. Open DevTools → Application → Local Storage and
  confirm `swr.profile` still parses after a brandkit color edit.
- **Verify**: visible duplicate + persisted brandkit profile.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `grep -rn "JSON.parse(JSON.stringify" --include="*.js" --exclude-dir=node_modules .` returns zero hits in repo source (the only remaining matches were the two we just replaced).
- Browser smoke: dev server, duplicate a layer (`d` key), edit a brandkit color, reload — both changes persist.
- **No regression on legacy profiles**: existing localStorage with a
  brandkit JSON-stringified payload round-trips identically (structuredClone
  preserves primitives and arrays the same way JSON.parse did).

## Risks / gotchas

- **structuredClone throws on non-cloneable values** (functions, DOM
  nodes, WeakMap). The current JSON-roundtrip path **silently dropped**
  these. If any layer object or brandkit profile today contains a
  function reference that JSON was stripping, the swap will turn the
  silent loss into a loud `DataCloneError`. Mitigation: a quick
  `Object.keys(src).filter(k => typeof src[k] === 'function')` audit
  on both layers and the brandkit profile before the swap. If a function
  is found, drop it with `delete` first or migrate the field to an
  ID-only reference.
- **Cross-realm safety**: structuredClone works across realms (e.g.
  cross-origin iframes). The codebase doesn't have cross-realm layer
  sharing today, but this is a strict improvement, not a regression.
- **Performance**: structuredClone on small objects (~10–50 fields) is
  in the same order of magnitude as JSON roundtrip; both are sub-ms.
  No hot-path concern. brandkit's `clone` is called at most once per
  `readProfile()` and `writeProfile()`, not per frame.
- **Date fields**: if any future field becomes a `Date`, JSON.stringify
  coerces it to ISO string and JSON.parse brings it back as a string.
  structuredClone preserves the `Date` instance. This is a behavior
  change — but it's the intended correctness fix.

## Out of scope

- Migrating `lib/mp4-muxer.js`'s hand-rolled `deepClone` (lines 127–134).
  That lives in a vendored muxer and is exercised once per MP4 finalization,
  not per frame. Leaving it alone keeps this change tight and avoids
  touching a vendored module's tested code path.
- Migrating `sw.js` `Response.clone()` calls (lines 77, 107, 125, 139) —
  those are the Streams API `Response.clone()`, not a deep clone. Different
  mechanism, different concerns.
- Refactoring the duplicateLayer flow to use spread + explicit field
  copying. structuredClone is the surgical fix; a bigger refactor is a
  separate cycle.
