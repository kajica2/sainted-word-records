# batch-video — context for merging PR #73

When you come back to merge PR #73 (`feat(batch-video): batch auto video creator with audio-driven variant picker`), here's what you need to know in one place.

## What's in the PR

9 commits on `feat/asset-curator` (12 new files):

- `lib/variant-picker.mjs` — pure picker, hand-tuned weights, 15/15 unit tests
- `scripts/analyze-mp3.mjs`, `scripts/_analyze-stub.html` — headless wrapper around `audio-analysis-v2.js`
- `scripts/batch-video.mjs` — orchestrator with `--analyze-only`, `--skip-existing`, `--retry N`, `--parallel N`, `--manifest <file>` flags
- `scripts/render-full-song.mjs` — refactored to export `renderVariant({...})`
- `scripts/test-variant-picker.mjs` — 15 unit tests
- `scripts/diag-gradient-diff.mjs` — hour-3 verification that gradient engine actually differentiates per track
- `verify-batch-video.mjs` — 6/6 smoke test for the CLI surface
- `docs/BATCH-VIDEO.md` — full operator + API reference
- 3 plan docs (`batch-auto-video-creator.md`, `batch-perf-baseline.md`, `next-5-hours.md`)

## What's NOT in this PR

**`feat/asset-curator` has 414 file changes vs `main`.** 12 are batch-video (above). The other ~400 files are unrelated work from prior parallel sessions on the same branch. Reviewers should focus on the 12 batch-video files.

## Engine bugs blocking clean deploy

These were diagnosed during the work and filed as issues, but **not fixed** because they are engine-team territory. The batch-video pipeline works around both:

- **#75 — `canvas.captureStream()` returns black on swiftshader.**
  The engine creates its render canvas with `willReadFrequently: true`. In headless Chrome on macOS with ANGLE+swiftshader, that flag leaves the CPU readback buffer empty even though the compositor paints correctly. So `canvas.captureStream()` (used by every in-page REC button) returns black. The batch-video pipeline uses CDP `Page.captureScreenshot` per frame instead, which reads the compositor and bypasses the bug. **Suggested fix:** drop `willReadFrequently: true` from the render canvas creation in `engine-render.client.js`.

- **#76 — `audio-analysis-v2.js` BPM detection returns 0 for every vocal-led track.**
  Raw inter-onset intervals on vocal material land at ~230-260ms (implying ~230-260 BPM), which the analyzer's 60-180 BPM fold discards. So `bpm` is 0 for every vocal track. The picker works around this via `bpmBucket_unknown` weights and `bucketize()` distinguishes `hasSignal` from `hasBpm`. **Suggested fix:** accept double-time / half-time interpretations in `estimateBPM`, or run multi-resolution tempo estimation.

**Until #75 is fixed, the in-page REC button on every `versions/*.html` page produces black videos.** This is the same bug the batch-video pipeline works around. Fixing it requires editing `engine-render.client.js` — small change, but in engine-team scope.

## Known caveats for production use

1. **CDP-screenshot capture is ~5 fps in headless swiftshader.** A 3-min song ≈ 25 min per worker. With `--parallel 4` on a 16GB Mac, 10 songs ≈ 60-70 min. **Real-world workaround:** use GPU-accelerated Chrome (Linux + NVIDIA + `--use-gl=egl --enable-unsafe-webgpu`) for ~20-50× speedup. No fix for macOS without GPU hardware.

2. **The rendered MP4 is valid for the song duration but frame timing is at the capture rate, not 30 fps.** If a downstream consumer needs 30 fps output, post-process with ffmpeg's `fps` filter. The audio is sample-accurate (original WAV re-muxed).

3. **Browser memory per worker: ~500MB.** `--parallel 4` needs ~2GB. Comfortable on 16GB Mac, tight on 8GB.

## Verification gates

- `node scripts/test-variant-picker.mjs` → 15/15 unit tests
- `npm run verify:batch-video` → 6/6 smoke test (picker, --analyze-only, --help, unknown-flag, --manifest override, --manifest validation)
- Both gates green on this branch.

The new `verify:batch-video` script follows the project's `verify-*` convention — it's discovered by `npm run check:full` if that's wired up.

## Suggested merge path

1. **Squash merge with a clean message** is preferable to merge-commit (would tie this PR's 9 commits together). Or keep them separate for traceability.
2. **Resolve the 414-file drift separately.** Other parallel sessions' work on `feat/asset-curator` may have their own PRs or have been merged directly to main. Rebase onto current main before merging to drop the unrelated 400 files.
3. **Engine bugs #75 and #76 are non-blocking for batch-video (workarounds committed).** They block the in-page REC button, which is a separate concern. Address when the engine team has bandwidth.
4. **Do not auto-deploy** — verify the deploy doesn't break anything by running `npm run check:full` after merge.

## Files to review (priority order)

1. `lib/variant-picker.mjs` — the core algorithm. Read this first.
2. `scripts/batch-video.mjs` — the orchestrator. The `--manifest`, `--parallel`, and `--retry` paths are the most complex.
3. `scripts/render-full-song.mjs` — the renderVariant function. The CLI shim has the most recent changes (--fps/--width/--height/--quiet).
4. `docs/BATCH-VIDEO.md` — operator-facing reference.
5. `verify-batch-video.mjs` — the regression net.

Everything else is support code that's exercised by these.