# CI failure investigation — 2026-11-02

Source: GitHub Actions CI run 41406925048, job 125151393657 (full logs reviewed).

## Observed result
10/33 `npm run check:full` steps failed, including `check`, `check:verify`, automix smoke/arc, genops, story graph, layer groups, bench, chain view, command center.

## Specific reproduction targets
- `check:command-center`: F5 assumes switch ends true, without checking its previous state. Assertion changed in this branch to require a genuine boolean transition; rerun needed.
- `check:verify`: rotation-enabled fails with `Error: seed layer missing`; diagnose seeding/boot readiness, not merely timeout.
- `check:automix-smoke`: `Layers.swapAsset(next)` mismatch after wrap; log shows initial asset 100, after next 101, after wrap 100, return values 1 and 0. Investigate asserted return semantics versus actual layer selection.
- `verify:genops`: 13/13 variants fail 2/20 assertions; likely shared contract rather than 13 separate visual defects. Capture exact assertion names first.
- `verify:story-graph`: TypeError setting `opacity` on undefined from `seedLayer` accessing `SWR.Layers.list[0]` after `SWR.Layers.add`. Confirm add return and readiness contract before altering production code.
- `check:layer-groups-smoke`: `no card at 0`; identify whether fixture setup, render gating or selector regressed.
- `check:bench-smoke`: page failed to come up within 10 seconds; inspect navigation and server startup before changing dozens of dependent assertions.
- `check:chain-view`: scale reactor does not contribute at characters 10 and 5 (scale remains 1); trace state propagation in chain renderer.
- `check:automix-arc-smoke`: inspect individual failed assertions in logs.
- `npm run check`: inspect its failed inner gates rather than disabling check.

## Engineering policy
Fix root causes at the smallest scope; independently reproduce failures; preserve CI exit codes; never turn failed checks into warnings; no production merges. Avoid increasing timeouts unless measured startup latency warrants it. Record screenshots/traces and exact expected/actual values on every failure. Separate shared-architecture defects from invalid test assumptions.

## Next verification
Run `npm run check:command-center` to validate the switch test correction, then `npm run check:full`. Verify that all 33 constituent steps pass before approval. Keep PR draft until confirmation.
