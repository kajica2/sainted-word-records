# CI verify strategy

Date: 2026-08-25

## The shape we picked

The repo had ~80 `verify-*.mjs` scripts accumulated from M1 work. Running
them all on every push is ~2 hours of CI on a small runner and most are
redundant or stale — the value of "verifier green" collapses the moment
the verifier stops being run.

So we drew a line: **5 verifiers gate PRs**, the rest are developer aids
that run on demand.

## The 5 that gate CI

Run by `npm run check:verify` and `.github/workflows/ci.yml#full`:

| # | Script | What it asserts |
|---|---|---|
| 1 | `verify-cloud-auth.mjs` | API loop: magic link → session → project create → storage round-trip → cross-user 403 → path-traversal 400 |
| 2 | `verify-hf-publish.mjs` | `/tools/hf-publish` admin UI mounts + bundle dry-run prints the canonical `hf upload` command |
| 3 | `verify-rotation-enabled.mjs` | Per-layer ROTATE toggle gates `applyR().rot` on every engine page |
| 4 | `verify-autoplay.mjs` | Engine auto-plays last loaded song on reload (headless autoplay granted) |
| 5 | `verify-e2e-media-record.mjs` | Engine bootstrap → all layers decoded → 4s `MediaRecorder` cycle → valid MP4 header |

Total budget: ~15s locally, ~30s in CI on `ubuntu-latest`.

## Why this 5

- API correctness (#1) — every other surface depends on auth/storage.
- Page mount (#2, #3, #4) — three different pages, three different
  features. If one breaks, the engine is half-broken.
- End-to-end pipeline (#5) — proves the canvas + Web Audio +
  MediaRecorder chain still records a decodable blob.

Each one of the 5 was already in the repo, already passing locally, and
already self-contained (own static server, own Puppeteer boot).

## How `npm run check` and `check:full` differ

```
npm run check         # fast, no Puppeteer — runs on every commit
  ↳ check:syntax       — node --check on every JS/MJS file
  ↳ check:manifest     — library/manifest.json schema + cross-refs
  ↳ check:bundle       — bundle dry-run, skips cleanly if sibling repo absent
  ↳ test-api.mjs       — db + handler unit tests (16 cases)

npm run check:full    # check + Puppeteer — gates PRs in CI
  ↳ … everything above …
  ↳ check:verify       — runs the 5 smokes above
```

CI uses `check:full` after `check` passes (sequential, ~30s).

## The remaining ~75 verify-*.mjs

These are kept in place for the next year. They were written for specific
features at specific moments and still have value when debugging that
feature. Three options were considered:

1. **Move to `verify-archive/`** — rejected. Renames break any docs,
   READMEs, or local muscle memory that reference them. The 5 above are
   the only ones the *project* needs; the rest are owned by whoever
   wrote them.
2. **Delete** — rejected. Some are still useful one-offs (e.g.
   `verify-rot-canvas.mjs` for canvas-specific debugging).
3. **Keep, document, don't run in CI** — chosen. This file is the
   documentation. Run them on demand with `node verify-<name>.mjs`.

If we ever need to retire one, the convention is: add it to the archive
list below with a one-line "why retired" and remove from root.

## Archive candidates (not moved yet)

These have been replaced or superseded by something in the 5:

- `verify-agi-bg.mjs` — replaced by parts of #3 + #5
- `verify-clip-*.mjs` (3) — superseded by parts of #5
- `verify-campaign.mjs` — landing/campaign page snapshot, not engine surface
- `verify-eclipse.mjs`, `verify-rot.mjs`, `verify-rot-canvas.mjs`,
  `verify-rot-slider.mjs` — superseded by #3
- `verify-mvm-*.mjs` (10) — phased music-video-maker work; check on demand
- `verify-personas-*.mjs`, `verify-personas-gallery.mjs` — landing surface,
  not engine surface
- `verify-tutorial-30s.mjs`, `verify-weddings.mjs`, `verify-profit-plan.mjs`,
  `verify-market-study.mjs` — marketing pages, not engine surface
- `verify-story-graph.mjs`, `verify-hallucination-story.mjs` — feature
  smokes, not engine surface

If we want to physically move these into `verify-archive/` next, the
migration is straightforward (rename + ignore update), but we deferred
it to keep this PR focused on *wiring* CI rather than *renaming* files.

## Files added in this change

- `scripts/lib/verify-runner.mjs` — shared runner (server boot,
  per-script timeout, sequential orchestration, env passthrough)
- `scripts/check-verify-smoke.mjs` — the 5-verifier orchestrator
- `.github/workflows/ci.yml` — gates PRs with `check` + `check:full`
- `puppeteer` — added as devDep; bundled Chromium via `postinstall`
- `verify-hf-publish.mjs` — patched to drop a hardcoded sibling-repo
  puppeteer path so CI can resolve it from `node_modules`
