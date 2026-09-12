# Batch Performance Baseline

Measured on macOS, headless Chrome with ANGLE+swiftshader, 640×360 viewport.

## Wall-time per song (sequential, single worker)

| Song | Variant picked | Duration | @12fps frames | Wall time | Notes |
|---|---|---|---|---|---|
| ador (57s, E major vocal) | music_video | 57s | 684 | 377s | original test |
| ohwow (129s, F minor vocal) | film | 129s | 1548 | (estimated ~700s) | not measured — projected from capture rate |

**Capture rate:** ~5 fps in headless swiftshader (CDP bottleneck). Per-second frame time ≈ ~200ms CDP overhead.

**Wall time scaling:** wall time ≈ song_duration × 6 at 12fps. Roughly: a 3-minute song = 18 minutes per worker.

## Parallel batch test (3 songs, --parallel 2, --fps 12)

Input: 3 trimmed 20s tracks (Broken Sun, Ode-di-ra-nats, The Radiance Within). Each ~20s × 6 = ~120s per song when sequential.

| Job | Variant | Wall (s) | Speedup observed |
|---|---|---|---|
| Ode-di-ra-nats | film | 94.7 | finished first |
| The Radiance Within | aurora | 161.5 | ran with film in parallel for 94.7s, then solo for 66.8s |
| Broken Sun | neon | 187.0 | longest pole |
| **max wall (batch)** | | **187.0** | |
| **sum wall (sequential would be)** | | **443.1** | |
| **speedup** | | **2.37x** | |

**With 3 songs and --parallel 2:**
- Slots 1 and 2 start Ode-di-ra-nats and Radiance/Within (or Broken Sun — order is FIFO)
- Ode-di-ra-nats finishes at 94.7s; slot 1 picks up Broken Sun (still running)
- Radiance Within finishes at 161.5s; slot 2 picks up nothing (queue drained)
- Broken Sun finishes at 187.0s — longest pole

Speedup of 2.37x is slightly less than the ideal 2x for parallel=2 with 3 jobs because the film job finished quickly (94.7s) and the third job took the freed slot. The throughput is the same as parallel=2 (you can never go faster than 2 songs at a time), but the tail (Broken Sun at 187s) extends the wall.

**Predicted scaling for --parallel N:**
- Each worker consumes ~200ms per CDP screenshot regardless of which song
- N workers = N× throughput up to N=CPU count
- Wall time = max(per-song wall) when parallel >= song count
- For a 10-song batch at 12fps with --parallel 4: ~max(song times) × ceil(10/4) ≈ 200s × 3 = ~10 min (vs ~30 min sequential)

## Recommendation

**For real-world batches:**
- `--parallel 4` on a 16GB Mac is comfortable (~2 GB per Chrome process). 10-song batch ~10-15 min.
- `--parallel 2` if memory-constrained. 10-song batch ~20-30 min.
- `--parallel 1` (default) only for debugging — sequential is fine for verifying a single render.

**Browser contention:** none observed at --parallel 2. CDP screenshots are independent across browser instances. Each worker launches its own ephemeral Chromium process; no shared state to corrupt.

## Memory observations

- Single worker: ~500 MB peak (Chromium + Node + WebGL backbuffer)
- --parallel 2: ~1 GB combined (no shared memory; 2 separate processes)
- --parallel 4 (projected): ~2 GB combined — fits in 16 GB Mac with headroom

## Known limitation

The `batch-video.mjs` orchestrator spawns N child Node processes via `child_process.spawn`. Each child is a `render-full-song.mjs` invocation with `--variant <picked>`. The CLI shim at the bottom of `render-full-song.mjs` accepts `--variant` since the parallel fix in this batch.

Without `--variant` (the pre-fix shim), the orchestrator's parallel renders all used `hallucination` regardless of the pick — output filenames were correct but the rendered video was always hallucination. **This is fixed.**

## Variance in per-song wall time

Wall times varied from 94s to 187s for 20s songs. The variance comes from:
- Per-song CDP screenshot variance (swiftshader frame render time depends on the page content)
- Engine-specific render cost (film has heavy grain; aurora has bloom — different WebGL cost)
- Browser warm-up vs. steady-state

A worker pool at --parallel 4 will smooth this variance — the longest pole sets the wall time.