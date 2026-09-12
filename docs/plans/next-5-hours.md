# Next 5 hours — Plan

> Time budget: 5 hours. Goal: pick a concrete sequence of tasks that ship the most value-per-minute, with hard verification at each step.

---

## Status snapshot (now)

Shipped on `feat/asset-curator` (3 commits, pushed to origin):
- `b860825` — `lib/variant-picker.mjs` + `scripts/analyze-mp3.mjs` + `scripts/_analyze-stub.html` + `scripts/batch-video.mjs` + `scripts/render-full-song.mjs` (refactored) + `scripts/test-variant-picker.mjs` (15/15 green)
- `8c977d2` — picker `bpmBucket_unknown` weights on `music_video` + `spectrum`; vocal-no-bpm regression test (15/15 green)
- `e004de3` — `docs/BATCH-VIDEO.md` (498 lines, full operator + API reference)

Open:
- Branch is ahead of `origin/feat/asset-curator` by 0 — all pushed
- Main has the 3-batch-video commits behind a PR boundary (none open); they aren't deployed to Vercel yet
- `--parallel` mode is implemented but **not** smoke-tested with real concurrency — `--parallel 1` was the only verified path
- `versions/music_video.html` works at render time but uses **gradient-preset synthesis**; whether the synthesized preset actually produces distinct visuals for different tracks is untested
- The picker is tuned against 2 vocal tracks (`adore`, `ohwow`) plus the fixture set. Real-world coverage: thin.

---

## The plan

### Hour 1 — Picker coverage expansion (~45 min)

**Why first:** the picker is the gating signal. Every other task downstream of it depends on a trustworthy pick. Two real songs isn't enough to call it done.

Tasks:
1. Pull 8-12 more real songs from `/Users/kaidejuricmasscmbook/Downloads` (mixed genres — hip-hop, ballad, electronic, jazz, ambient, vocal-led, instrumental)
2. Run `node scripts/analyze-mp3.mjs <songs...>` on the batch, pipe through the picker, dump `allScores` to a JSON file
3. Read the picks. Flag any case where the picked variant's `<meta description>` mismatches what the song actually is. Each mismatch is either:
   - (a) **picker bug** — retune weights, add fixture, commit
   - (b) **legitimate "your call"** — note it, leave the picker as-is
4. Cap the retune loop at 3 iterations — beyond that, accept current accuracy

**Deliverable:** `out/picker-coverage-<date>.json` (analysis + picks for the test set), commit any picker weight changes (each with a regression test).

**Verification:** `node scripts/test-variant-picker.mjs` exits 0; new fixture cases green.

---

### Hour 2 — Parallel batch smoke test + perf baseline (~40 min)

**Why second:** `--parallel N` is the only realistic path to a usable batch workflow (25 min/song × 10 songs = 4 hours sequential). Need to know if it actually works.

Tasks:
1. Pick 3 short tracks (<30s each, to keep wall time manageable) from `Downloads`
2. Trim them to 20s with ffmpeg
3. Run `node scripts/batch-video.mjs --input <dir> --output out --fps 12 --parallel 2`
4. Capture: actual wall time per song, browser CPU/memory peak, any Puppeteer contention warnings
6. If parallel works: bump to `--parallel 3` with 3 tracks, confirm it scales
7. If parallel has issues: log them; fix only if the issue is small (<15 min). Otherwise document and move on.

**Deliverable:** `docs/plans/batch-perf-baseline.md` with measured wall-times, browser memory peaks, recommendation for `--parallel N` per host memory budget.

**Verification:** all 3 outputs are valid MP4s with correct duration + audio; no orphan `chrome` processes left behind (`pkill -f chrome` cleanup if needed).

---

### Hour 3 — Render-quality investigation: the music_video gradient test (~50 min)

**Why this one matters:** `music_video` is now the picker's primary fallback (vocal tracks, unknown BPM). Its description says "drop a track, the engine synthesizes a preset" — but I haven't verified that the synthesized preset actually produces visually distinct output for different tracks. If music_video always renders the same gradient regardless of input, the picker fallback is hollow.

Tasks:
1. Pick 3 contrasting tracks (a vocal ballad, an electronic banger, a jazz instrumental)
2. Trim each to 15s
3. Render all three with `--variant music_video --fps 12`
4. Extract a frame from each (ffmpeg frame dump as JPEG)
5. Visually compare: are the gradients perceptibly different? Does each track's audio features show up in the output?
6. If gradient looks the same on all three: that's a real bug — flag it, note the finding, don't try to fix music_video.html's preset synthesis (out of scope)
7. If gradients are distinct: document the finding in `docs/BATCH-VIDEO.md` (add a "What 'music_video gradient synthesis' actually does" subsection)

**Verification:** frame JPEGs visibly different per track (manual eyeball), OR a documented finding that says they aren't.

---

### Hour 4 — Operator UX: analyze-only mode + batch retry (~35 min)

**Why:** the current `batch-video.mjs` is all-or-nothing — one bad song and the rest of the batch may stall. Also there's no way to dry-run a batch (analyze all + show picks without rendering).

Tasks:
1. Add `--analyze-only` flag to `batch-video.mjs`: run analysis + picker for every input, print picks as a table to stdout, exit before any rendering
2. Add `--skip-existing` flag: if `<output>/<song>.<variant>.mp4` already exists and is valid, skip the render
3. Add per-song try/catch in the sequential path (already there in `parallel` mode; check the `parallel=1` path matches)
4. Add `--retry N` flag: retry failed renders up to N times before giving up (default 0)
5. Smoke-test all four: analyze-only (fast), skip-existing (run twice, second run is instant), retry (force a failure by passing a non-WAV)

**Verification:** each flag produces the documented behavior in the test run; `summary.json` reflects skip / retry decisions.

---

### Hour 5 — Ship: PR + audit + commit the work (~30 min)

**Why:** the work on `feat/asset-curator` won't reach production until the PR is opened and merged. The current state is "3 commits ahead of main, no PR, no Vercel deploy."

Tasks:
1. Open PR from `feat/asset-curator` → `main` via `gh pr create`. Title: `feat(batch-video): batch auto video creator with audio-driven variant picker`. Body: links to `docs/BATCH-VIDEO.md`, lists the 3 commits, surfaces the known caveats (CDP-screenshot bottleneck, music_video gradient uncertainty, picker thin on real-world tracks)
2. Wait for any CI checks (likely none on this branch — there's no CI per AGENTS.md)
3. Note: Vercel auto-deploys on merge. Don't merge unilaterally — leave the PR open and report to user
4. Update `docs/BATCH-VIDEO.md` with any learnings from hours 1-4 (e.g. the music_video gradient finding, the perf baseline)
5. Final commit if anything was added; otherwise stop

**Verification:** PR URL returned; commits listed in PR body match `git log origin/main..feat/asset-curator`; docs updated.

---

## Total: ~4h 20min

Buffer: ~40 min for overruns on any hour. If hour 3 (music_video gradient test) shows the bug is real and worth fixing, that eats the buffer and the hour 5 PR gets shorted — that's the right trade-off (real bug > paperwork).

---

## What this plan does NOT do

- **No UI surface.** No `/batch` page, no in-page picker. CLI-only. The picker module is pure and reusable later.
- **No edits to engine variant pages.** `versions/*.html` stay untouched.
- **No cloud rendering.** Local-only.
- **No new dependencies.** Puppeteer, ffmpeg, ffprobe only.
- **No merge without user approval.** PR is opened, not merged.
- **No GPU server.** All in headless swiftshader.

---

## Hard constraints surfaced up front

1. **CDP-screenshot capture is the bottleneck** (~5 fps in headless swiftshader). Every render takes ~6× the song duration at 24fps. Hour 2 will measure this explicitly so the next iteration knows what to optimize.
2. **music_video gradient synthesis is unverified** until hour 3. The picker routes vocal tracks there but the variant may not actually produce distinct output per track. Hour 3 surfaces this either as "works" or "doesn't, document it."
3. **Picker coverage is currently 2 songs + 15 fixtures.** Real-world accuracy is unknown until hour 1. If many mismatches appear, hour 5's PR will note the picker is "beta" and recommend the user manually override with `--variant` until more data is collected.

---

## Decision points

- **After hour 1**: if the picker needs >3 weight retunes, scale back hour 4 to fit. Picker accuracy is gating; UX is secondary.
- **After hour 3**: if music_video gradient is the same on every track, surface this as a known limitation in `docs/BATCH-VIDEO.md` and the PR body. Don't try to fix `versions/music_video.html` — that's a different scope (engine team territory).
- **After hour 4**: if `--parallel` didn't work, document and skip. The user can re-enable later.
- **At hour 5**: stop at "PR opened, awaiting review." Do not merge without user approval.