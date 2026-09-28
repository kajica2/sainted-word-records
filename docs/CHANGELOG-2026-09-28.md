# Changelog — 2026-09-28

---

## Automix: fix the defects that silently disabled documented behaviour

An audit of the automix stack (`client/automix-runtime.client.js`,
`client/automix-composition.client.js`, `client/preset-anchor-map.client.js`)
found four behaviour bugs that failed **silently** — the state token read `ON`
while nothing ran, or a documented feature was inert — plus a resource leak and
per-second allocation churn. All are fixed and covered by regression tests.

### Correctness

| Bug | Symptom | Fix |
|---|---|---|
| Arc dropped on stop → start | `start()` set `this.arc = null`, then `_ensureArc()` returned early because `_arcBuiltFor === srcKey` — so toggling automix off/on silently degraded the rest of the song to the legacy realtime path (no macro acts, no act-driven cuts, pill loses `act n/m`). | The arc is a property of the song, not the enabled flag: `start()` no longer discards it. `_ensureArc()` still rebuilds when the element `src` changes. |
| Stale freeze | `frozen` was never reset by `start()`/`stop()`. `freeze` → off → on left `frozen = true` while the UI painted `ON`, and `tick`/`_scheduleNext`/`_onBeatPoll`/`_glideTick` all early-returned. | `start()` clears `frozen` (and the freeze button's active class). |
| Dead bar-nudge | `_applyBarNudge` measured its cadence with `(beatInBar - last) % 4` (delta 0–3) against `beatsPerNudge = round(bpm/30)`, which is ≥ 4 for bpm ≥ ~105 — so the nudge never fired at any ordinary tempo. | Cadence now rides a monotonic `_beatIndex` incremented on each detected beat, so the ~2s nudge works at every tempo. |
| Stale-async arc | `_arcBuiltFor` was stamped before the async analysis resolved, and the `.then` had no re-check: an older song's analysis resolving late clobbered the live arc. A transient failure also disabled the arc for the whole song (empty `.catch`), and the duration fallback read `A._el` instead of the resolved element. | The `.then` bails when `_arcBuiltFor` no longer matches its `srcKey`; `.catch` clears the guard for a bounded retry (3 attempts per song); the duration fallback uses the resolved `el`. |

### Resource + churn

- **Blob-URL leak** (`automix-composition.client.js`): `apply()` built a fresh
  `URL.createObjectURL(m.blob)` for every media item on every act boundary and
  never revoked them. The pool is now cached by content signature and previous
  URLs are revoked on replace.
- **Per-second no-ops**: the 1s glide clock no longer dispatches
  `swr-automix-glide` when the act and its progress are byte-identical (paused
  element), and `_updatePill` skips the DOM write when the text is unchanged.
  The composition layer skips its `setProgress` `postMessage` when the
  interpolated cutting window moved < 0.05s.
- **Anchor lookups** (`preset-anchor-map.client.js`): `neighbours()` rebuilt
  `Object.keys`, a 19-object candidate array and a full sort on every call —
  and it is reached from the 33 ms beat-poll path, `tick()`, the session layer
  and `_findSceneChange`. It now uses flat immutable coordinate columns and a
  partial selection; only the returned rows are allocated. Verified
  byte-identical (ids, `dist`, `anchor`) to the previous implementation over
  4000 random queries across `n = 1..25`.
- **Non-thenable guard**: the composition fallback poll no longer throws when
  `SWR_MEDIA.getUserMedia()` returns a non-promise or throws.

### Verification

- `scripts/check-automix-session-unit.mjs` — new scenarios **21–24** pin the
  four correctness fixes; all four **fail against the pre-fix runtime** and pass
  after (verified by stashing the runtime fix).
- Green: `check:automix-unit` (58), `check:automix-arc-unit`, 
  `check:automix-session-unit` (24), `check:clip-evolution-unit` (22),
  `check:automix-smoke` (90 assertions), `check:automix-arc-smoke`,
  `verify:automix`, `verify:automix-cross-surface`.

---

## Automix: close the engine.html composition-coupling gap

`engine.html` shipped the L3 arc but not `client/automix-composition.client.js`
— the layer that turns an act into a *media* change (cutting cadence, boundary
cuts). All 22 variant pages had it; engine was missed in the same rollout that
originally omitted `automix-arc` (a note in the page already recorded that one).
So on engine the arc drove the colour grade but never the clip cutting.

- `engine.html` — load `automix-composition.client.js` after the runtime.
- `verify-automix-cross-surface.mjs` — the full-tier check now asserts
  `AUTOMIX_SCRIPTS`. That list was **declared but never asserted**, which is
  precisely why the gap was invisible; it now includes
  `automix-composition.client.js` (13 scripts) and also guards the 17 artistic
  variants via `AUTOMIX_MIN_SCRIPTS`.

Proven: with engine reverted, the verifier fails
`engine.html: automix stack: missing: automix-composition.client.js`; after the
fix it reports `full automix stack present (13 scripts)`. A runtime probe on
engine confirms enabling automix now calls `SWR_LAYER_SCHEDULER.setConfig`
(lift fallback → intro act profile).
