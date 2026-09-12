# Wiggum learning diary — GRID landing polish

Cross-iteration lessons. Appending, not rewriting.

## 2026-09-10 → 2026-09-11 — grid polish run (13 tasks, 13 commits)

1. **Don't add CSS `transition` to JS-driven opacity values.** The IIFE writes `opacity = String(flash)` per frame where `flash = beat*0.6 + onset*0.7`. A `transition: opacity 40ms` smooths the per-frame value and visibly dampens the beat pulse — the JS is already producing continuous values. Reserve `transition` for *CSS-only* opacity changes (e.g. hover states). If the value is driven from JS, leave the transition off and let the JS decide the curve. *(caught + corrected same iteration — reverted the `transition` line)*

2. **CSS cascade order is a real footgun for "the later one wins" claims.** When two single-class + single-element selectors have equal specificity, source order decides — and the order may not match the logical priority. Example: `.bpm-readout b { color: #fff }` (line 116) vs `.gc b { color: var(--accent) }` (line 121). The BPM number lives inside `<span class="gc bpm-readout">`, so `.gc b` wins and the number renders orange, not white. Fix: bump specificity to `.gc.bpm-readout b` so it wins regardless of where it's declared in source. **Discipline**: when adding a new selector that needs to override an existing one with the same specificity, NEVER rely on placement — bump specificity with `.<parent>.<child>` so the override is order-independent.

3. **Review claims must survive a grep.** I claimed "the -v spans are NEVER updated by JS" — wrong. They update on slider input at line 997 (`out.textContent = v.toFixed(2)`). Cost: one wasted audit commit that ended up being "verification only, no edit." Save the round-trip: when reviewing for absence, run the grep FIRST.

4. **TODO descriptions can be wrong.** Task #10 said "The `#bpm` element shows BPM in monospace" — but `#bpm` did not exist in the file. The engine computed `A.feat.bpm` but never surfaced it. The fix was to add the DOM and wire it from `loop()` with change-detection (`_lastBpm` cache) so the per-frame read doesn't churn DOM. Discipline: every TODO item that names an element must be verified with grep before shipping — if the element is missing, the fix is to add it, not to assume it exists.

5. **Dead `color:` declarations inside the same selector are harmless but cost the next reader a minute.** `.v small { color: var(--accent); ...; color: #fff; }` — the first declaration is overwritten by the second. Two of these were left over from earlier CSS passes. Trimming them is a one-line cleanup that pays back in clarity.

6. **Reviewer subagent caught one real CSS bug and two dead declarations that I had shipped as "correct."** Cost: one subagent dispatch (~75s, ~12 API calls). Value: a cascade bug that would have shipped to production and rendered the BPM number in the wrong color forever. The integration-reviewer step is worth its weight every time on multi-commit polish runs, even when each individual commit looks clean. The single reviewer at the end caught what per-commit review would not have.

7. **Wiggum config schema is `[loop]/[git]/[security]/[learning]`** in v0.11, NOT `[agent]/[diary]`. The skill's `.wiggum.toml` template is wrong for v0.11. The config validator prints "Unknown config section" warnings if you follow the older template. Fix: read `wiggum.agents.get_available_agents()` keys via `grep CONFIG_SCHEMA wiggum/config.py` to find the right section names.

## Future patterns

- When a TODO says "the X element shows Y," grep for `id="X"` first. If missing, the task is "add the X element to surface Y from the engine," not "polish the X element."
- Any per-frame DOM write that depends on engine state should cache the last value and skip the write when unchanged. `_lastBpm` is the right pattern; FPS does NOT do this (writes every frame, which is fine because it changes every frame).
- Inline `<style>` blocks at the top of variant HTML files tend to accumulate dead declarations across multiple polish passes. Worth a one-pass audit at the start of any "polish" run.
