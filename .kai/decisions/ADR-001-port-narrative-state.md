# ADR-001: Port `narrative-state` from `feat/score-evolution` to main

**Status:** Proposed (research + plan, 2026-09-20)
**Decider:** user (Kai)

## Context

The music_video → all-surfaces automix port (commits `5a1fdba` through `a244d2b`, 2026-09-20) shipped the automix+curator stack to engine + 5 variants + dashboard. The `feat/score-evolution` branch (`6cfa9fb`, 14 ahead / 343 behind main) carries a related but separate feature: **narrative-state**, an emergent-narrative accumulator that makes the visuals *accumulate* over time so they reflect the song's journey, not just its instantaneous features.

The original refactor-advisor analysis (2026-09-20) flagged this branch as "DEFER (porting risk)" because it assumed narrative-state targeted the pre-Phase-1 inline automix runtime and would silently break after the runtime extraction. **That analysis was wrong.** Investigation shows:

- `narrative-state.client.js` is a **pure accumulator** with no dependency on the automix runtime
- It exposes `state` (tension/peak/drift/warmth/age), `init(bpm, dur)`, `step(A)`, `reset()`, `beginRelease()`, `getMicroAmp()`, `onBeat()`, `phaseMultiplier()`, `_config()`
- The wiring in `versions/music_video.html` (Stage 2 commit `e49eb41`) calls `SWR_NARRATIVE.init()` on song-load, `.step({rms, beat, centroid, dt})` per RAF frame, and reads `.state.drift.{x,y}` in `applyR()` to bias layer positions
- **Main never had narrative-state** — main's music_video.html (latest commit `10a1170`) has zero references to `SWR_NARRATIVE`
- The score-evolution branch is a parallel universe where narrative-state was added; nothing was removed when it was branched

So this isn't a porting risk against a runtime change — it's a clean cherry-pick + integration of a never-imported feature.

## What the score-evolution branch actually delivers

Six stages landed across 14 commits:

| Stage | What it adds |
|---|---|
| **1** | `client/narrative-state.client.js` (220 LOC) — pure accumulator; `state`, `init`, `step`, `reset`, `onBeat`, `phaseMultiplier`, `getMicroAmp`, `beginRelease` |
| **2** | Wires narrative-state into `versions/music_video.html`: `A.load()` seeds it, RAF tick calls `.step()`, `applyR()` reads `.drift.{x,y}` to bias layer positions (max ±80px / ±60px) |
| **3** | `phaseMultiplier(dur)` — curve multipliers that fade narrative influence in/out across the song's lifecycle (intro/chorus/outro) |
| **4** | Beat-locked micro-evolution — beat counter + per-beat transient drift-amp boost |
| **5** | End-of-song release taper — `beginRelease()` + `releaseProgress` for smooth fade-out |
| **6** | Integration smoke + polish |

Tests: `scripts/check-narrative-unit.mjs` (281 LOC, 6 unit tests) + `scripts/check-score-evolution-smoke.mjs` (272 LOC, integration smoke).

## Porting plan

### Step 1 — Cherry-pick the pure module (zero risk)

```bash
git checkout feat/score-evolution -- client/narrative-state.client.js
git add client/narrative-state.client.js
git commit -m "feat(narrative): add narrative-state accumulator (cherry-pick from feat/score-evolution)"
```

- The module is self-contained (IIFE, no deps)
- 220 LOC, no conflicts with main
- Pure unit-testable (verified by `scripts/check-narrative-unit.mjs`)
- Loads harmlessly on any surface that includes the script tag; `window.SWR_NARRATIVE` is undefined → `if (window.SWR_NARRATIVE)` guards skip it

### Step 2 — Cherry-pick the test scripts

```bash
git checkout feat/score-evolution -- scripts/check-narrative-unit.mjs scripts/check-score-evolution-smoke.mjs
```

These are test-only and have no dependencies on the branch's other diffs.

### Step 3 — Cherry-pick the music_video.html wiring (real risk)

This is where it gets tricky. The score-evolution branch's music_video.html is on commit `5a7fa06` (2026-09-12); main's music_video.html is on commit `10a1170` (later). The branches have diverged by 343 commits. The narrative-state wiring touches:

| Location in score-evolution | What | Risk |
|---|---|---|
| `<head>` (~line 272) | Add `<script src="client/narrative-state.client.js" defer>` | Low — additive |
| `A.load()` (~line 590) | Call `SWR_NARRATIVE.init(120, dur)` after metadata loads | Low — additive (guarded by `if (!window.SWR_NARRATIVE) return`) |
| RAF tick (~line 953) | Re-seed bpm when beat detector locks; call `SWR_NARRATIVE.step(...)` | Low — additive |
| `applyR()` (~line 810) | Read `.drift.{x,y}` + `phaseMultiplier` + `getMicroAmp` to bias positions | Medium — modifies render math |
| Stage 5 hook (`beginRelease`) | Triggered on song-end | Low — additive |

The applyR() insertion is the only risk point: it's modifying a function that already has 343 commits of divergence. Need to either:

- **Option A (low risk)**: Cherry-pick just the `<script>` tag + Stage 1 wiring (init + step), defer applyR() integration to a follow-up. This gives users the narrative accumulator state machine without changing visuals yet.
- **Option B (medium risk)**: Cherry-pick the entire Stage 2 wiring including applyR(). Risk: applyR() function may have other recent edits that conflict with the score-evolution version.
- **Option C (high risk)**: Cherry-pick everything (Stages 1-6) including Stages 3-6 polish. Highest risk, highest payoff.

**Recommendation: Option A** — minimal-risk, gives users a working narrative accumulator they can attach later, defers visual changes to a follow-up commit.

### Step 4 — Surface exposure (Phase 1-4 spirit)

Per the user's earlier guidance ("use music_video as the functional demo, translate to all other versions"), narrative-state should eventually ship to all surfaces. But that's a multi-step rollout:

1. **music_video.html only** (Step 3 — this commit)
2. **engine.html** in a follow-up (the wiring fits the engine-runtime structure similarly)
3. **5 variants** in another follow-up (each variant has its own RAF tick + applyR)
4. **dashboard.html** last (different render math entirely)

Each surface needs its own variant of the cherry-pick. This ADR scopes Step 3 only.

### Step 5 — Wiring via npm scripts

Add to `package.json`:

```json
"check:narrative-unit": "node scripts/check-narrative-unit.mjs",
"check:score-evolution-smoke": "node scripts/check-score-evolution-smoke.mjs"
```

(Wired into `check:unit` so existing pre-PR gates pick them up.)

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Score-evolution branch's music_video.html has diverged 343 commits from main | High for Option C, low for Option A | Cherry-pick only the pure module + wiring of `<script>` tag + `A.load()` + RAF tick. Defer applyR() |
| Narrative-state drift could be too aggressive (visible motion = nausea) | Medium | Half-life constants are tunable in `client/narrative-state.client.js` lines 14-21; already documented inline |
| `audio-analysis-v2.js` exposes `bpm` differently between music_video and engine | Low | wiring uses `A.feat.bpm` which is the standard shape |
| Hooks into `audio.feat` which doesn't exist on engine's runtime yet (was added in Phase 1) | N/A — we only target music_video.html in Step 3 |
| Music_video.html is the only "score-evolution variant" — but music_video IS the reference implementation, so other variants can use music_video as the source of truth | Low | Documented in the .kai/conventions/architecture.md already |

## Decision

**Adopt Option A: ship narrative-state as a pure module + minimal wiring (music_video.html only).** Defer applyR() visual integration to a follow-up. Surface rollout (engine + 5 variants + dashboard) deferred until the music_video integration is validated in production.

## Consequences

- Adds `client/narrative-state.client.js` (220 LOC) — new module on main
- Adds the `<script>` tag to `versions/music_video.html` only
- Adds `A.load()` + RAF-tick calls to music_video.html (3-4 line changes, additive)
- No visual change yet (applyR() not wired)
- Two new unit/smoke test scripts under `scripts/`
- `verify:automix` (music_video regression) continues to pass — narrative-state is opt-in (guarded by `if (window.SWR_NARRATIVE)`)
- `npm run check:full` adds `check:narrative-unit` + `check:score-evolution-smoke` to the unit suite

## Out of scope (deferred)

- applyR() drift integration (Stage 2's actual visual change)
- Engine + 5 variants + dashboard rollout
- Stage 3-6 polish (phase multipliers, beat-locked micro-evolution, release taper)
- Re-architecting the branch's `feat-parallel-snapshot`-style decisions