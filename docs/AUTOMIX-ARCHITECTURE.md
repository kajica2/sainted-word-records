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
| `session` | L4 novelty — reroutes to an unused neighbour when the picked anchor appears in recent songs | per song |

`_lastMixedVia` reports `'arc'` or `'legacy'` for the debug panel.

## L3 song arc

Built per song from `AudioAnalysisV2.analyzeBuffer` (async, at load; t=0 runs on
realtime features — no dead air). Deterministic per song (seeded PRNG over
duration/BPM/onset-count): 3–5 acts whose boundaries snap to onset-flux valleys,
each act targeting an anchor region (≥0.25 anchor-map displacement enforced —
"changes over time are visible") with a full-range baseline blended 50/50 with the
anchor preset. Fallback: analysis failure or >15 min → realtime-only mode.

**The glide.** A static per-act baseline converges inside the 1s ramp and stays
there — measured Δ=0.000 over a 47s act. So the act baseline glides continuously
toward the next act's baseline (last act wraps to the first — the outro drifts
back toward the intro feel) on a **1s glide clock** (`_glideTick`), decoupled from
`computeTickInterval`'s bars-based cadence: at low feat energy the tick cadence
stretches to ~20s, which would teleport the whole act-to-act displacement into
one invisible step. The ramp machinery smooths each 1s glide write.

**Engine FX fast-path.** fx-postprocess's zero-FX skip (`!anyFxActive()`) must
not skip while `SWR._fxOverride` is set: on zero-persona pages (engine.html)
state can only become non-zero *through* the override-consumption block, so the
skip would lock automix out forever. Variants never noticed (personas start
non-zero).

## L4 session memory

`client/automix-session-store.client.js` keeps the last 5 songs' used anchors
(`localStorage["swr.automix.session.v1"]`). The runtime accumulates anchors per
tick and flushes them in `_ensureArc()` when `el.src` changes — the only
recording hook, so mic-only/no-element pages stay inert. The `session` layer
reroutes to the nearest unused neighbour when the picked anchor is in `recent()`;
if every nearby anchor is a repeat, the current one stands.

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

## Natural look (all versions)

`lib/swr-natural.client.js` (engine + all 22 versions pages) enforces the
look contract: (1) envelope followers on every numeric `Audio.feat` field
(attack τ≈80ms, release τ≈420ms, Proxy read-side, frame-rate independent;
bpm/beatInBar and |v|>1.6 pass raw, `beatPulse` stays crisp for beat-sync) —
reactors breathe instead of twitching; (2) filmic grade — CSS filter
`saturate(0.45) contrast(0.85) brightness(1.05)` on the TOPMOST visible
canvas only (the fx-postprocess overlay when up, else the stage) — 55%
desaturation, contrast pivoted at mid so blacks lift to soft gray and
highlights roll off before clipping; (3) feedback trail — self-decaying echo
buffer (0.82 decay, 0.30 feed, 0.22 out) blended under each frame; (4)
rotating vertical-axis mirror — two ghost passes (±14°/±10° orbiting axes,
soft-light 0.16 + screen 0.09) with the source re-angled inside the mirror.
`SWR_NATURAL.setEnabled(false)` bypasses everything (persisted). Clip
dissolves are ~2.2s ease-in-out: `engine-timing` `step()` tracks an analytic
fade segment (from/t0/duration) through smoothstep instead of the old
exponential approach, and `eventSwap` widened to 950/1250ms — no hard cuts.

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
- `scripts/check-automix-session-unit.mjs` (node:vm, 20 checks) — store caps/corruption,
  session-layer reroute/passthrough, pill format, song-change flush, glide math,
  engine-shape `audioEl` transport. In `npm run check`.
- `verify-automix-arc-displacement.mjs` — the runtime regression contract: samples
  14 FX fields every 5s for 80–180s on engine.html and requires ≥0.3 absolute
  movement of at least one field per fully-observed arc act, plus the pill's
  act-context format. Sprint gate (too slow for check:full).
- `verify-transitions.mjs` — 58 checks incl. `?diag=1` payload + intensity invariant
  (setIntensity never mutates `FX.state`).
- `verify-automix-cross-surface.mjs` — 77 checks, three tiers: full (engine + 5
  core), min (17 artistic), off (echo-manifold opt-out).
- Live-probe counters: `__SCHED_SWAPS`, `__SCHED_POSTS`, `__SWR_SILENCE_FADE`.

## Parked (each is one layer object now)

Hue-bias per act (warm acts pick warm clips — needs pool metadata in the worker),
transition-cadence coupling (acts choose transition families).
