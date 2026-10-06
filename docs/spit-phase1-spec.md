# Spit Live — Phase 1: library write path + functional gate

Locked spec, 2026-09-29. Executable as-is when worker capacity returns.

## Context (verified by reading, not assumed)

- `spit.html` is complete UI (~526 lines) and loads `client/swr-spit-runtime.client.js` (631 lines) + `client/swr-spit-fx.client.js`. The comment at `spit.html:516-518` claiming those modules "don't exist yet" is STALE — remove it as part of this work.
- The runtime already has: state machine `LOADING → READY → RECORDING → SAVED`, `_initDOMElements()` binding ~25 controls by id, MediaInput/Camera/Mic wiring, beat analysis (BPM/key), `spitSave` handler.
- `check:spit-live-smoke` is SURFACE-ONLY and runs in 0.9s. It asserts only: page boots, canvas is 1080x1920, 6 `.spit-fx-btn` exist, `SWR_SPIT.create`/`SWR_SPIT_FX.trigger` are functions. It never loads a beat, mic, records, or checks a pixel.
- Write path already exists and is sound: `lib/storage.client.js` → `uploadFile(file, keyPrefix)` / `uploadBlob` / `downloadAsFile(key, name)`, all `credentials: 'include'`. `api/storage/sign-upload.js` is `requireUser()`-gated, 60/min/user, keys scoped per userId. `lib/auth.client.js` → `session()`, `renderChip()`, `onChange()`.

## Phase 1 scope

1. **Wire `spit-save` to the library.** Signed in → `SWR_STORAGE.uploadFile(blob, 'spit/<timestamp>')`, surface the returned key. Signed out → local `.webm` download + a sign-in prompt. Add a save-mode indicator (e.g. `spit-save-mode` badge) so the user always knows where the take went.
2. **Functional gate — REPLACE the surface-only smoke.** Must drive, deterministically, with auth/storage stubbed but the BEHAVIOUR asserted:
   - synthetic beat loads
   - BPM + key populate
   - canvas actually changes (pixel/sample comparison, not just "exists")
   - FX moves pixels
   - record returns a Blob
   - signed-in path calls `uploadFile` and surfaces the returned key
   - signed-out path falls back to local download + shows the sign-in prompt
3. Remove the stale `spit.html:516-518` comment.

## Phase 2 (natural follow-up, NOT a separate product)

Library read path: pick a saved beat/take, `downloadAsFile`, load into the beat picker / `#mic-source`. Ship Phase 1 first if capacity is short, but **do not design the API or UI to preclude read** — storage keys under `spit/` and the save-mode indicator should be shaped so Phase 2 adds a picker, not a redesign.

## Phase 3

Polish + error states (upload failure, offline, quota/429 from sign-upload, permission denied on mic).

## Gates for the PR

- `node scripts/check-spit-live-smoke.mjs` (rewritten) green, and fast — if it takes >30s it is not deterministic enough.
- `npm run check` all steps pass.
- `npm run build` ok.
- Stubs must be per-test in page context, never module-level, so a leak cannot make the suite pass falsely.

## Non-negotiable

Do not merge the write path without the functional gate. The gate is what turns "it saves" into a fact.
