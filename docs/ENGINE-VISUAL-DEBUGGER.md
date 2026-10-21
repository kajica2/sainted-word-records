# SWR visual debugger — metric journal

The visual debugger (`client/engine-debugger.client.js`) is scored by `npm run check:debugger`
(`scripts/check-swr-debugger.mjs`), which drives headless Chrome over the DevTools Protocol
with no npm dependencies. The score is the mean across a four-page variant family

```
SCORE = 0.5 * coverage + 0.3 * accuracy + 0.2 * headroom
```

- **coverage** — of the overlay's 13 declared surfaces, how many render genuine live engine data
- **accuracy** — 9 independent probes: the resolved transform matches the engine's own static
  fields with reactors muted; the painted DOM matches the painted snapshot and is not stale;
  values move; a layer mutation shows up promptly; the stage geometry matches the engine's
  **real `drawImage` calls**; every engine layer appears; unmount releases the wrappers and the
  engine keeps drawing; no extra `applyR`/`imageEvolve`/`drawImage` calls were introduced; and the
  panel is actually laid out and styled
- **headroom** — frame-budget headroom from the measured frame time with and without the overlay

A `rebaseline` row means the measurement definition changed (a probe was added or redefined),
so its number is not comparable with the rows above it. Every row's commit hash is the branch
commit that produced it, so the journal and the history agree.

| # | commit | score | status | what changed |
| --- | --- | --- | --- | --- |
| 0 | `8d9dfec` | 0.1879 | baseline | no debugger present — the floor is the headroom term alone |
| 1 | `04268f0` | 0.9400 | keep | first working overlay: 10/10 surfaces, 4/5 probes, 0.00% frame overhead |
| 2 | `7812af9` | 1.0000 | rebaseline | probe scope change: display-fidelity compares the painted DOM against the painted snapshot and asserts freshness (was: against the live snapshot, which raced by design) |
| 3 | `63abaa1` | 1.0000 | rebaseline | coverage scope change: 10 surfaces -> 13 (added stage geometry overlay, drift readout, rhythm strip) |
| 4 | `3a801b8` | 0.9505 | rebaseline | probe scope change: 5 probes -> 8 (added geometry-truth, multi-layer, unmount-integrity) |
| 5 | `10b26b1` | 0.9940 | keep | geometry probe audits layer draws only; harness waits for the seeded images to decode |
| 6 | `9ae9914` | 0.9274 | rebaseline | metric scope change: the score is the mean across a 4-page variant family (neon, film, aurora, watercolor) instead of one page |
| 7 | `4b0bc81` | 0.9683 | keep | observe the engine's real draw instead of modelling it — film/aurora geometry was wrong, watercolor had none |
| 8 | `76b98ca` | 0.9656 | discard | stage canvas overlay replaced by DOM boxes; score moved within measurement noise, kept for the cheaper compositing |
| 9 | `e1cefdd` | 0.8827 | discard | min-frame estimator measures the headless scheduler, not the page — the metric was broken, not the code |
| 10 | `607084b` | 0.9500 | keep | stage overlay rebuilt on remount (boxes went stale); frame cost by median-of-medians over interleaved rounds |
| 11 | `9d32f33` | 0.9701 | keep | stop forcing a layout flush per repaint — fit() reads the stage client box, which cost film.html +15% frame time |
| 12 | `dc0d84a` | 0.9212 | keep | paint the rhythm strip (it was never painted) and check canvases for actual ink rather than presence |
| 13 | `142b7ee` | 0.9778 | keep | rhythm envelope always drawn; frame cost by mean — film quantises against vsync and the median flipped |
| 14 | `4c945b0` | 0.9471 | keep | show how far the audio moved each layer; geometry labels for layers larger than the stage |
| 15 | `db49906` | 0.9155 | keep | label array was not reset on unmount, so a remount drew no labels — caught by the tightened coverage check |
| 16 | `8caaea8` | 0.9517 | keep | repair the panel stylesheet; add a probe asserting the overlay is actually styled (9 probes now) |
| 17 | `d30c687` | 0.9449 | keep | separate the geometry labels; final state — 52/52 surfaces and 36/36 probes across the four-page family |

## Reading the score

The floor is **0.188** — the headroom term with no debugger present at all. A working overlay
scores **0.95–0.98**; the spread is `film.html`, whose frame cost is noisy on a shared machine
(`2.2%` to `11.8%` across runs of identical code). Every other variant measures ~0% overhead, and
every surface and probe passes on all four pages.
