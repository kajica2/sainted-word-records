# Changelog — 2026-09-24

---

## FX master intensity control

One knob, `0…1`, that scales the amplitude of every post-process effect and
filter across the engine and all 22 engine pages — engine.html + the 5 core
variants + the 17 artistic variants.

Commits:
- `19e09c3` — `feat(fx): master intensity control for effects and filters`

### How it works

`window.FX.intensity` (default 1) is a **render-time multiplier applied only
at the uniform-write block** of both renderers:

- `fx-postprocess.js` (engine + mosaic/baroque/kraft/phosphor/tape) — owns
  the value; `FX.setIntensity(v)` clamps to 0–1 and persists to
  `localStorage['swr.fx.intensity']`.
- `versions-presets.js` (the other 16 variants) — reads
  `window.FX.intensity` with a `window.SWR_FX_INTENSITY` fallback for pages
  that don't load fx-postprocess.

`FX.state` is **never** mutated by the knob — personas, automix overrides,
LFOs, and the temp slider keep their canonical values, and dragging back to
1 is an exact restore. Scaled: temp, mut, posterize, vignette, chroma,
grain, sepia, glow, grayscale, blur, liquid, pearl, glitch, effect. Never
scaled: `mutAlgo` (an algorithm selector, not an amount) and the audio
feature uniforms.

### Wiring

- `lib/intensity-slider.client.js` (new) — idempotent two-way range client:
  upgrades an existing `input#fx-intensity` or auto-mounts into
  `[data-fx-intensity-mount]`; emits `fx-intensity-change` on document.
- Engine: "fx" slider in the `#global` footer next to temp.
- Variants: mount span in the footer beside the Automix toggle + script
  include (all 22 pages).
- `lib/persist-fx.client.js` saves `intensity` in the fx persona snapshot
  and restores it on boot; `?diag=1` payload now includes `fxIntensity`.

### Verification

- Headless smoke on both renderers (tape + neon): state untouched at
  intensity 0, clamp (7→1, −3→0), persistence, readout.
- `verify-transitions.mjs`: new double-scaling guard — asserts state values
  are byte-identical through `setIntensity` — plus a diag shape check.
- `verify-automix-cross-surface.mjs` min tier asserts the slider mount on
  artistic variants.

---

## Automix made functional on all artistic variants

The automix toggle previously did nothing on 15 of the 16 enabled artistic
variants — three stacked structural gaps.

Commit:
- `26f9fdf` — `feat(automix): make automix functional on all artistic variants`

### The three gaps

1. **No anchor map.** No variant shipped `preset-anchor-map.client.js` +
   `anchor-embed.js`, so `window.SWR_ANCHOR_MAP` was undefined and
   `SWR_AUTOMIX.mix()` had no neighbours — every tick exited before
   `_setTarget`. Both script tags added to all 15 enabled variants.
2. **No preset consumer on the fx-postprocess pipeline.** The automix
   output (`window.SWR._fxOverride`) was only ever read by
   `versions-presets.js`; the 5 fx-postprocess variants had no blend path.
   fx-postprocess now smoothstep-blends the override into the FX state each
   frame (mirroring versions-presets semantics).
3. **tape had no real audio analysis.** Its paint loop synthesised
   `Math.sin` features. New `lib/media-feat.client.js` extracts the
   canonical 12-field feat shape (`bass…bpm`, identical DSP to neon) from
   any media element; tape attaches it on `load()` and keeps the synthetic
   features as the no-audio fallback. `variants/tape.automix.json` flipped
   to `enabled: true` — **16 of 17 wired**.

`echo-manifold` remains the sole opt-out — it has no FX surface at all
(own generative canvas, no fx_state uniforms), so automix presets have
nothing to drive.

### Verifier restructured

`verify-automix-cross-surface.mjs` previously asserted the full engine
stack (hook-detector/stats/mood/scenes panels) on the 17 artistic variants,
which never shipped them — it failed on an unmodified tree. Surfaces now
have three tiers:

- **full** — engine.html + the 5 core variants (11 automix scripts, 5
  runtime scripts, 18 panel IDs, 5 runtime APIs)
- **min** — the 17 artistic variants (4 automix-min scripts + toggle IDs +
  `SWR_ANCHOR_MAP.neighbours` + automix runtime API)
- **off** — echo-manifold's opt-out contract (config `enabled:false`,
  runtime + toggle present, no anchor-map weight), asserted from source
  truth because the config is only inlined at build time, which runs after
  verify in CI

77 checks, exit 0.

---

## Engine audit batch (merged from `fix/audit-critical-batch`)

Earlier work from the same branch, all CI-gated by run `35960503934`:

- `0be2fed` — `lib/media-store.client.js` tolerates a database newer than
  the script (version-agnostic retry on VersionError). Closes the second,
  cache-flavoured `VersionError` incident: an edge-cached pre-v2 module
  meeting a v2 database no longer breaks the media store.
- `af05264` / `65c5318` — onboarding overlay Escape/backdrop handlers:
  attempted fix, evidence-preserved revert (listeners attached after
  `renderModal()`'s `root.innerHTML` replacement never fire). Overlay
  remains dismissable via Skip.
- `ec137b5` — sandboxed iframes drop `allow-same-origin`.
- `9d86a45` — nav consolidation, orphaned pages, 5 text findings.

Verifier hygiene:
- `caa6b0f` — `verify-transitions.mjs` allowlists the sandboxed-iframe
  `serviceWorker` SecurityError (intentional since `ec137b5`).

---

### Stats

- **2 new modules**: `lib/media-feat.client.js` (canonical feat extractor,
  `SWR_MEDIA_FEAT.attach(el)`), `lib/intensity-slider.client.js`.
- **1 behavioural change to shared pipelines**: `fx-postprocess.js` now
  consumes `SWR._fxOverride`; both renderers apply `FX.intensity`.
- **16 variants un-inerted** for automix; 1 genuine opt-out documented.
- **2 verifier contracts fixed** (cross-surface tiers; sandbox allowlist).
- CI on the branch tip: `35960503934` — check:full + verifiers + build +
  size budget, all green. Merged to `main` as `223bb85`.

---

# Session 2 — same day, later block (19 commits, `afa3239..e8cd282`)

Continues on `fix/audit-critical-batch`. Started as the plan of record's
remaining automix items; grew a look contract, a perf pass, a device-tier
system, a mirror control, two media packs, and five gate repairs.

## Automix evolution — phases 3 + 5 + the displacement contract

Commits:
- `ca6bb55` — `feat(automix): session-memory store (L4 novelty layer)`
- `0c79b2c` — `feat(automix): session layer + pill act context + arc glide clock`
- `d265590` — `fix(engine): wire automix arc + unblock FX consumption`
- `bc058cd` — `fix(check): align stale assertions with shipped state`
- `5d6ca0d` — `test(automix): session unit checks + arc displacement verifier`

### What shipped

**Phase 3 remainder** — the `#synth-pill` now carries act context on the arc
path via a `_updatePill(mixed, section)` helper:
`auto · act 1/3 · verse · kraft`. Legacy mode keeps the short form.

**Phase 5 (L4)** — `client/automix-session-store.client.js`: the last 5 songs'
used anchors (8 each) in `localStorage['swr.automix.session.v1']`. The runtime
accumulates anchors per tick and flushes them in `_ensureArc()` when `el.src`
changes — the only recording hook, so mic-only/no-element pages stay inert. A
`session` layer in the LAYERS chain reroutes to the nearest unused neighbour
when the picked anchor is in `recent()`; if every nearby anchor is a repeat,
the current one stands.

**The regression contract** — `verify-automix-arc-displacement.mjs` samples
the 14 FX fields every 5s for 80–180s on engine.html and requires ≥0.3
absolute movement of at least one field per fully-observed act, plus the pill
format. Sprint gate, deliberately not in `check:full` (80–180s).

### Three product bugs the contract caught

1. **engine.html never loaded `automix-arc.client.js`.** The f582f56 rollout
   wired all 22 variants and skipped engine — so the L3 layer was a permanent
   passthrough on the *primary* surface. `_ensureArc` also no-oped there
   because the runtime reads `Audio.el || A._el` while the engine's transport
   exposes `audioEl` (fixed with a third fallback at all four read sites).
2. **fx-postprocess locked automix out on zero-persona pages.** The
   `!anyFxActive()` fast-path skipped the override-consumption block — which
   on engine is the only thing that can make state non-zero. A self-lockout.
   Variants never noticed: their personas start non-zero, keeping the loop hot.
3. **The arc's act baselines were static, and the cadence teleported them.**
   Measured Δ=0.000 across a 47s act: the preset converged inside the 1s ramp,
   and `computeTickInterval`'s bars-based cadence stretches to ~20s at low feat
   energy — so the whole act-to-act displacement landed as one invisible step
   per tick. Fixed with a within-act glide (baseline lerps toward the next
   act's by `actProgress`; the last act wraps to the first) running on a
   dedicated **1s glide clock**, decoupled from the musical tick cadence.

### Verification

- `verify-automix-arc-displacement.mjs` exit 0 — act 1 chroma Δ=0.952,
  act 2 Δ=0.873, pill matches, no pageerrors.
- `check-automix-session-unit.mjs` — 20 checks in `npm run check`.
- Session memory proven in-browser: a song change writes the documented
  `{key, ts, anchorIds}` shape and `recent()` returns it.
- Cross-surface 77/77; engine verifier 12 scripts.

## Natural clip evolution (the look contract)

Commits:
- `353f21d` — `feat(clips): natural evolution pipeline + arc graft on music_video`
- `0c4c49f` — `feat(look): natural clip evolution — dissolves, envelope followers, filmic grade, rotating mirror, feedback trail`

### Pipeline — cuts follow the song

`versions/music_video.html` was the last pipeline page with no arc wiring and
no composition coupling. It now carries the full L3 graft (arc layer in its
inline tick, 1s glide clock, act-context pill) plus:

- **Worker**: a glide-progress swap window consumed **at re-arm only** — a 1s
  update must never reschedule the pending timer, or 10–20s waits starve. New
  `swapNow` message for act-boundary cuts.
- **Scheduler client**: round-robin layer rotation (random pick let one layer
  churn while another never moved), a natural-cut guard (never crossfade a
  layer to the clip it already shows), `setProgress`, direct `swapNow`.
- **Composition**: act boundaries tracked on the 1s glide (cuts land on the
  section change, beat-snapped through the normal crossfade path); the
  within-act envelope interpolates the current act's cutting profile toward
  the next — cuts tighten into peaks, release into breakdowns. `nextActName`
  rides on the glide event so no page reaches into another's internals
  (music_video's orchestrator is IIFE-private).

### Look — `lib/swr-natural.client.js` on all 23 pipeline pages

One shared module instead of 23 inline copies:

- **Dissolves, not cuts** — `engine-timing` `step()` rewritten from a
  fraction-of-remaining exponential (pop at the start, creep at the end) to an
  analytic ease-in-out segment; `eventSwap` widened to 950/1250ms (~2.2s).
- **Envelope followers** on `Audio.feat` — attack τ≈80ms / release τ≈420ms,
  Proxy read-side, frame-rate independent; `bpm`/`beatInBar` pass raw, |v|>1.6
  passthrough, `beatPulse` stays crisp so beat-sync keeps working.
- **Filmic grade** — `saturate(.45) contrast(.85) brightness(1.05)`, applied
  to the **topmost visible canvas only** (fx overlay when up, else the stage —
  never both, or the grade doubles): 55% desaturation, blacks lifted, highlights
  rolled off before clipping.
- **Feedback trail** — bounded-gain echo buffer (0.82 decay / 0.30 feed /
  0.22 out).
- **Rotating vertical-axis mirror** — two ghost passes on slowly orbiting axes
  (±14°/±10°), soft-light 0.16 + screen 0.09, source re-angled inside the
  mirror. `SWR_NATURAL.setEnabled(false)` bypasses everything (persisted).

Verified by screenshot A/B on music_video (harsh magenta + crushed black →
muted lavender, soft gray shadows, trail smear, symmetric ghosts) and on tape
(grade correctly on the WebGL overlay, no double-grade, 0 pageerrors).

## Profile-first perf pass

Commit: `1e2f3b6` — `perf(render): profile-first opt pass — half-res trail, adaptive quality, invisible-layer skip`

**Profiling first paid for itself immediately:** the very first probe showed
the natural-look frame pass was a **silent no-op on engine.html** —
`getStage()` returned `<section id="stage">` (a section, not a canvas), so the
whole pass returned before its first `drawImage`. On music_video it happened to
win the rAF race, which is why the earlier screenshots looked right and hid it.
`getStage()` now requires an actual canvas with `width>0`.

Then the real savings:

- **Half-resolution echo buffer** — trail + both mirror ghosts read one
  half-res source (two extra full-res stage captures eliminated).
- **Adaptive quality** — sustained dt>42ms sheds the second ghost, then the
  whole frame pass; dt<20ms recovers; counters on `SWR_NATURAL.stats`.
- **`engine-timing` steady-state passthrough** — `return r` unchanged when
  `r.opacity === tgt`, removing one allocation per layer per frame.
- **Invisible-layer skip** — `r.opacity ≤ 0.004` skips the offscreen render +
  blit and pauses the `<video>` (resumed on reappearance by both lineages).

Measured on engine.html (headless, 1280×800, 3 layers, automix on):
**module ON 29.9fps vs OFF 23.4fps**, self-time 0.068ms/frame.

Deliberately **not** applied, with reasons recorded in the commit: FFT size
stays 2048 (frequency resolution + arc tuning; the follower covers the temporal
axis for less cost); no single-shader fold for Canvas2D effects (only helps the
5 fx-pipeline variants and duplicates the logic); no AudioWorklet ring buffer
(deeper refactor than the ask); no video preload on `swapPending` (would
duplicate drawLayer's lifecycle).

## Device tier + adaptive frame-budget guard

Commit: `f01cfe8` — `feat(perf): device tier + adaptive frame-budget guard`

- **`lib/tier-runtime.js`** — synchronous first-in-`<head>` script (blocks
  parse, so the tier exists before any page rAF starts; one file, not 23
  inlined copies). Three tiers from `hardwareConcurrency` / `deviceMemory` /
  `saveData` / `prefers-reduced-motion` → a profile table (`renderScale`,
  `maxDPR`, `cssFilters`, `feedbackRes`, `fftSize`, `analyserSmoothing`,
  `maxClips`, `minCutMs`). `?tier=low|medium|high` overrides detection for QA.
  Deliberately excluded: GPU-string regexes (stale every release) and a
  persisted "last good tier" (masks thermal throttling on the next visit).
- **`lib/adaptive-guard.js`** — the correction. Watches rAF deltas; sustained
  >40ms steps work down a ladder, sustained <20ms climbs back at 2× the window
  and never above the detected tier. Rungs, cheapest + least visible first:
  css filters off → feedback resolution down → **overlay frame-skip** → fewer
  concurrent clips → slower cut cadence → tier step down.
- Consumers read pull-based (`SWR_ADAPTIVE.state()` per frame), so nothing has
  to be pushed into 22 separate rAF loops.
- `verify-tier-runtime.mjs` — 8 checks including the real analyser wiring
  (`?tier=low` → `fftSize=512` observed on the Audio object) and a 4× CPU-
  throttled step-down via CDP `Emulation.setCPUThrottlingRate`.

### The overlay rung incident

The first version of that rung was `FX.setEnabled(false)` — and
`verify-automix-arc-displacement.mjs` went red immediately. On engine the
overlay **is** the composite: disabling it blanks the look *and* freezes
`FX.state`, which is the displacement contract's signal. Replaced with
`FX.setFrameSkip(n)`, which runs the GPU pass every Nth frame while `state`
keeps advancing. Contract back to chroma Δ=0.95/0.87. The general lesson,
recorded in the module header: every ladder rung must be non-destructive,
because headless rAF (~15fps off-screen) makes the guard fire essentially
always.

## Mirror rotkey + the rAF ordering race

Commits:
- `8effb9e` — `feat(keys): V rotkey cycles the mirror axis (vertical -> horizontal -> off)`
- `57a96b4` — `fix(render): composite the natural-look pass at end of frame, not on a racing rAF`

The rotating mirror shipped without a control. It now has three states in the
central keymap (`engine-keys.client.js`): **V** cycles vertical → horizontal →
off, **Shift+V** returns straight to vertical. `off` skips both ghost passes,
so the key doubles as the cheapest manual perf rung. State persists in
`localStorage['swr.mirror.mode']` and survives a corrupt value.

Verifying it exposed a **second silent no-op**: pixel signatures were byte-
identical for vertical, horizontal and off. Root cause was an rAF **ordering
race** — pages that re-register at the end of their callback and pages that
re-register at the start land on opposite sides of the module, and engine.html
clears the stage at the top of its frame, so the ghosts were wiped. Measured:
the pass ran 281 frames and left zero pixels.

Fixed with an explicit end-of-frame hook: `engine-render.client.js` `frame()`
(15 variants + music_video + mtv) and engine.html's `Renderer.loop` dispatch
`swr-frame-end`, and the module composites synchronously there. Pages with no
hook fall back to their own rAF via a 250ms freshness check, so the 7 own-loop
persona variants keep working and hooked pages never composite twice.
Verified with real content: composites 0 → 277+, vertical ≠ horizontal,
`off` measurably darkest, 0 pageerrors.

## Media packs (dancers + dance clips)

Commits:
- `fa82a1a` — `feat(packs): first media pack (dancers) + shippable pack pipeline`
- `e8cd282` — `feat(packs): dance video pack — 13 looping clips, 26MB -> 2.0MB`

`library/` could not hold these: it is **gitignored and stripped from the
build** (`vite.config.js` closeBundle plus the `.gitignore` entry), so anything
under it is local-only by design. Created `packs/` as the tracked home, copied
into `dist` alongside `default-library/`.

- `packs/dancers/` — 8 stage-lit B&W dancer silhouettes (1456×816 webp).
- `packs/dancers-video/` — 13 looping clips (832×464, 5s, h264).
- `packs/manifest.json` — schema `swr-library-packs/v1` with a `base` field.
- `client/library-packs.client.js` — manifest resolution now tries
  `/library/manifest.json` (local dev) then falls back to
  `/packs/manifest.json` (shipped), and asset URLs follow the winning
  manifest's `base`.

The video pack was **26MB raw** — a fifth of the entire 130MB build budget for
one pack — so every clip was re-encoded before landing:

```
ffmpeg -crf 30 -preset slow -pix_fmt yuv420p -an -movflags +faststart
```

Result: **2.0MB for 13 clips (8–14× smaller)**. Audio stripped (visual plates;
the engine supplies the track) and `+faststart` so a clip can begin playing
before it is fully fetched — which matters because the scheduler swaps clips
mid-song. One encode was checked against the source frames first (strobe
silhouettes keep clean edges, no banding on the white highlights) before the
set was batch-encoded.

Verified in a browser (music_video.html): the PACKS toolbar shows both new
buttons, `load('dancers')` reports 8 items and `load('dancer-video')` 13, all
landing with correct folders, real URLs, decodable elements (readyState 4,
832×464), then compositing on stage — 0 pageerrors.

## Gate hygiene — five repairs

Commits:
- `bc058cd` / `d38df0b` / `3f26ade` — stale contracts + missing `.html` fallback
- `28882d8` — `fix(gates): smoke servers fail loud on a busy port instead of hanging`
- `8608fe5` — `fix(gates): media-input smoke survives the service-worker claim reload`

Every one was **pre-existing at the branch tip** (confirmed by stashing this
session's changes and reproducing), and each was fixed at the root cause rather
than by re-pinning:

| Symptom | Root cause | Fix |
|---|---|---|
| `check:automix-unit` red | tape pinned `enabled:false`; enabled since `26f9fdf` | moved to `ENABLED_VARIANTS` |
| `check:get-preset-unit` red | pinned `neon mut=0.55`; the daily preset pipeline regenerated it to `0.2` | assert against the table itself; exposed `window.__SWR_PRESETS` |
| `verify-engine-automix` red | expected `track-analyzer.client.js`, which engine never shipped | entry dropped; 404 noise filtered per cross-surface convention |
| smoke cover test flaky | fixed 250ms wait vs. chain load | poll the final pixel state (≤4s) |
| smoke evolution test flaky | 5s window vs. 8-bars-per-tick cadence (16–20s) | force a tick pair when the window misses one |
| `capture`/`media-input`/`spit` smoke | assumed `dist/engine/` directory; build is flat | `.html` fallback (mirrors the Vercel rewrite) |
| chain hung 30 min silently | orphan held :5182; `listen()` failed with no handler | `server.on('error')` → exit 1 with a message |
| `media-input` crashed the chain | SW claim force-reload destroyed the evaluate context | wait for `serviceWorker.ready` + retrying evaluate wrapper |

---

## Stats (session 2)

- **19 commits**, 81 files changed, **+3040 / −170**.
- **4 new modules**: `client/automix-session-store.client.js`,
  `lib/swr-natural.client.js`, `lib/tier-runtime.js`, `lib/adaptive-guard.js`
  — plus 22 pack assets (`packs/manifest.json`, 8 webp, 13 mp4).
- **4 new test artifacts**: `check-automix-session-unit.mjs` (20 checks),
  `check-clip-evolution-unit.mjs` (22 checks),
  `verify-automix-arc-displacement.mjs` (the displacement contract),
  `verify-tier-runtime.mjs` (8 checks).
- **6 product bugs found by writing the contract first**, not by reading code:
  engine missing the arc module; the FX fast-path self-lockout; static act
  baselines + teleporting cadence; `getStage()` returning a `<section>`; the
  mirror pass being wiped by an rAF ordering race; the overlay-off rung
  freezing the displacement signal.
- **Media**: 26MB of source video → 2.0MB shipped (+2.5MB packs total).
- Gates on the tip: `npm run check` exit 0 (0 failures); transitions 60 checks
  ALL CHECKS PASS; cross-surface 77/77; automix smoke 91/91; displacement
  contract exit 0; tier verifier 8/8.

### Known-open at session end

- `scripts/with-dist.mjs` rebuilds only when `dist/` is **missing**, so a stale
  dist silently tests old code (this cost a hang and a misdiagnosis). A
  source-newer-than-dist staleness guard was next.
- The 7 own-loop persona variants (tape, baroque, mosaic, phosphor, collage,
  spectrum, typography) do not consume the tier profile and do not dispatch
  `swr-frame-end`; they rely on the module's fallback path.
- A sitewide keyboard-shortcut layer (`lib/site-keys.client.js`) is planned but
  not built — 113 HTML pages, 70 load `nav.client.js`, only 5 have any keydown
  handler. Awaiting a decision on rollout scope and the `G`-prefix targets.
