# Automix Architecture — the evolution stack

*As of 2026-09-24. Implementation: `client/automix-runtime.client.js` (orchestrator),
`client/automix.client.js` (mix engine), `client/automix-arc.client.js` (L3 arc),
`client/automix-composition.client.js` (composition coupling), `layer-scheduler.client.js` +
`layer-scheduler.worker.js` (clip swaps). Plan of record: session artifact `automix-evolution-plan.md`.*

## The layer chain

`tick()` is a composable chain of modulators — each a `{ id, apply(mix, feat, ctx) }`
reduced in priority order. New evolution ideas are a layer object, never another edit
to `tick()`.

| Layer | Owns | Timescale |
|---|---|---|
| `base` | legacy realtime pick / lock-mode | per tick (8 bars) |
| `arc` | **macro direction** — replaces the mix when a song arc exists | whole song, 3–5 acts |

`_lastMixedVia` reports `'arc'` or `'legacy'` for the debug panel.

## L3 song arc

Built per song from `AudioAnalysisV2.analyzeBuffer` (async, at load; t=0 runs on
realtime features — no dead air). Deterministic per song (seeded PRNG over
duration/BPM/onset-count): 3–5 acts whose boundaries snap to onset-flux valleys,
each act targeting an anchor region (≥0.25 anchor-map displacement enforced —
"changes over time are visible") with a full-range baseline blended 50/50 with the
anchor preset. Fallback: analysis failure or >15 min → realtime-only mode.

## Composition coupling

Each act drives the layer scheduler's cutting rhythm: intro 9–14s, lift 6–10s,
**peak 2.5–5s**, breakdown 12–20s, outro 8–14s, beat-snapped. The scheduler
resolves clips from BOTH stores (engine `Library` + `SWR_MEDIA` "+ ADD" flow —
fresh blob URLs per swap; stored URLs die across page loads). Mirror mode
(togglable, persisted) alternates `layer.__mirrored` per swap → horizontal flip in
the shared renderer (`r.flipX`, part of the draw-cache version hash).

Watchdogs: the worker reschedules only on timing-param changes (no-op configs used
to reset the timer); `setPool` starts the timer if enabled+populated; a 5s client
poll re-posts stale pools and kicks a dead timer chain (>60s no swap).

## Preset pipeline

23 presets in `versions-presets.js` (verified-write apply — JSON-serialized,
re-parsed + deep-compared before writing). Each has a characteristic GLSL motif
(`*_Effect`, u_page 0–22; film = screen square, collage = polaroids, spectrum =
rainbow sweep, typography = type columns). `FX.intensity` (0–1) is a render-time
multiplier — **never written into state**; scale at the uniform-write block only.
Anchor map + arc baselines derive from the same table.

## Silence → alpha

No sound (element-state check ONLY — the `A.playing` flag goes stale and once
inverted the whole fade; multi-source: engine/stub element + any DOM
`<audio>/<video>`) → `#fx-canvas` opacity eases to 0 over ~3s, revealing the raw
stage; restores in ~1s.

## PWA cache contract

`sw.js` `CACHE_VERSION` must be **bumped on every deploy that changes assets** —
it was stale at v3 all day once and pinned the morning's JS through every hard
refresh. Assets are stale-while-revalidate: one load to converge, offline intact.

## Verification seams

- `scripts/check-automix-arc-unit.mjs` (node:vm, 9 checks) — determinism, movement
  budget, sampling, degenerate/null contracts. In `npm run check`.
- `verify-transitions.mjs` — 58 checks incl. `?diag=1` payload + intensity invariant
  (setIntensity never mutates `FX.state`).
- `verify-automix-cross-surface.mjs` — 77 checks, three tiers: full (engine + 5
  core), min (17 artistic), off (echo-manifold opt-out).
- Live-probe counters: `__SCHED_SWAPS`, `__SCHED_POSTS`, `__SWR_SILENCE_FADE`.

## Parked (each is one layer object now)

Hue-bias per act (warm acts pick warm clips — needs pool metadata in the worker),
session memory (novelty across songs via last-mix-store), transition-cadence
coupling (acts choose transition families).
