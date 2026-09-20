# Automix v2 — follow-up plan (3-hour session)

> For: `versions/music_video.html` + `versions/music_video_mtv.html`
> Date: 2026-09-20
> Parent: [`2026-09-20-automix-v2.md`](./2026-09-20-automix-v2.md) (already shipped as `f1c060c`)

Closes out the two open items from the v2 plan:

1. **Phase 2.4 — BPM-locked anchor cycling** (was the only "deferred" item).
2. **URL deep-links** for support tickets + verify suite.

## Phase 2.4 — BPM-locked anchor cycling

**Why it was deferred**: it's purely cosmetic evolution. With section-aware pooling already in place (Phase 2.2), the visual moves when the song changes sections. BPM-locked cycling adds movement *between* section changes — at high BPM the visual was locking on the dominant anchor for stretches of 8+ beats.

**What it does**:
- On every detected downbeat (`Audio.feat.beatPulse` rising edge), if `feat.beatInBar` has advanced ≥ `N` beats since the last nudge, nudge the blend.
- `N = round(bpm / 30)` so the nudge cadence scales with tempo:
  - 60 BPM → 2 beats per nudge (~2s)
  - 120 BPM → 4 beats per nudge (~2s)
  - 180 BPM → 6 beats per nudge (~2s)
- Nudge target = a random anchor from the 8 nearest that's NOT the current dominant.
- Nudge strength = 25% lerp toward that anchor's preset.
- Render-loop smoothstep interpolates the rest over RAMP_MS.

**Wired into the orchestrator**:
- New method `_applyBarNudge(feat)` on the `automix` IIFE.
- Called from `_onBeatPoll()` alongside `_applyBeatDrift()`.
- Skipped when `frozen`, `locked`, or BPM unknown.
- Reset state (`_lastNudgeBeatInBar`) on `start()`.

**Why this is safe**:
- The render-loop smoothstep means the nudge doesn't snap — it ramps in over 1s.
- 25% lerp is gentle enough that it can't surprise the user.
- Locked mode bypasses this entirely (uses single-anchor preset).
- Disabled when audio features are null (cold start).

## URL deep-links

For support tickets ("send me the URL with the panel open") and for the verify suite to test state without simulating clicks.

**Params**:
| Param | Effect | Mutually exclusive? |
|---|---|---|
| `?automix=1` | Enable automix on load | No |
| `?automix-debug=1` | Open debug panel | No |
| `?automix-frozen=1` | Start in frozen state (implies enable) | No |
| `?automix-locked=1` | Start locked to nearest anchor (implies enable) | No |

Combine freely: `?automix=1&automix-debug=1&automix-frozen=1` boots the page with automix on, frozen, and the debug panel open — perfect for showing a static blend for analysis.

**Why these specific flags**:
- `automix=1` is the most useful — turns it on without any user action.
- `automix-debug=1` is for support: lets the helper see what's happening without clicking around.
- `automix-frozen=1` is for capturing a specific blend state.
- `automix-locked=1` is for users who want a single anchor for a section.
- We deliberately omit `?automix-section=` because sections are auto-detected from audio — there's no useful way to lock them from a URL.

**Wired into the orchestrator**:
- Reads `window.location.search` at IIFE init.
- Applies state via the existing public methods (`start()`, `freeze()`, `lockToNearest()`, `_toggleDebug()`).
- Wrapped in try/catch — old browsers without `URLSearchParams` just no-op.

## Out of scope (deferred to next session)

These were considered and not picked:

- **A "Tour" overlay** for first-time users — would walk through the 4 new buttons. Marketing-heavy, not critical.
- **A blend comparator** that shows 2 saved presets side-by-side with diff metrics. Cool, but `swrc.presets.user.v1` only saves blends since v2 shipped, so there's no corpus to compare against yet.
- **Auto-mix on other engines** (neon, film, grid, etc.) — the cross-engine refactor is its own multi-day project.
- **A `verify-automix` real-audio subtest** that synthesizes a tone via `OfflineAudioContext`. The current Puppeteer test drives `Audio.feat` directly, which is faster and more deterministic. Real-audio synthesis adds flakiness without catching new bugs in this v2 plan; can add when the next phase needs it.

## Files touched in this follow-up

- `versions/music_video.html` — added `_applyBarNudge()` + URL param block.
- `versions/music_video_mtv.html` — same.
- `verify-automix.mjs` — extended with deep-link render checks (TBD).
- `docs/plans/2026-09-20-automix-v2-followup.md` (this file).

## Verify plan

- `npm run check:syntax` ✅ 344 files + 116 inline scripts.
- `npm run check:verify` ✅ 5/5 green (existing).
- `npm run verify:automix` ✅ 14/14 (existing) + new deep-link checks.
- `npm run check:automix-unit` ✅ 33/33 (existing — no new unit tests; Phase 2.4 logic lives in the orchestrator IIFE which the Puppeteer suite covers).