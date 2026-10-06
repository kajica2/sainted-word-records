# Testing Conventions

Sources of truth for everything below: `scripts/run-steps.mjs` (the group
lists), `scripts/check-verify-smoke.mjs` (the curated 5), `.github/workflows/ci.yml`
(CI) and AGENTS.md → "Testing instructions". Re-measure rather than trusting
this file: `node scripts/run-steps.mjs <group> --list`.

## Gates

`check`, `check:full` and `check:storyboard` all route through
`scripts/run-steps.mjs`, which runs every step in the named group and exits
non-zero if **any** step failed. They are deliberately not `&&` chains — a
chain short-circuits, so the first failure used to hide every later step
(`check:full` once truncated at `check:verify` and silently skipped seven
suites).

| Command | Group | Steps |
| --- | --- | --- |
| `npm run check` | `check` | 49 |
| `npm run check:full` | `full` | 18 |
| `npm run check:storyboard` | `storyboard` | 5 |

- `npm run check` — the quick gate. `check:syntax`, `check:bundle`, the
  `check:*-unit.mjs` / `test:*` suites, `scripts/test-api.mjs`, and the browser
  smokes that need no interaction (`check:dashboard`,
  `check:variant-switcher-smoke`, `check:grade-smoke`, `check:site-chrome`,
  `check:sitemap`, …).
  Run it before every commit.
- `npm run check:full` — `check` plus `check:verify`, `check:automix-smoke`,
  `check:automix-arc-smoke`, `check:invite-redemption-smoke`,
  `check:storyboard`, `verify:automix`, `verify:genops`, `verify:story-graph`,
  `check:capture-smoke`, `check:targeting-smoke`, `check:media-input-smoke`,
  `check:spit-live-smoke`, `check:tiktok-smoke`, `check:clip-poster-smoke`,
  `verify:engine-boot`, `check:dist-links` and `verify:site-nav`.
  Run it before opening a PR.
- `npm run check:storyboard` — the five `scripts/check-storyboard-*.mjs`
  (song, structure, transitions, shots, e2e).
- `STEPS_ONLY=check:syntax,check:bpm-unit node scripts/run-steps.mjs check`
  runs a subset of a group.

`check:dist-links` (`scripts/check-dist-links.mjs`) is the deploy-surface
integrity gate: every `vercel.json` rewrite, every root-relative link in a
shipped page and every `site-map.json` entry must resolve in `dist/`. It needs a
built `dist/` — `ensureDist()` from `scripts/with-dist.mjs` builds one when dist
is missing or stale.

## The curated 5

`npm run check:verify` → `scripts/check-verify-smoke.mjs` boots a Vite dev server
on `:5175` with a temp `SWRC_DATA_DIR` and runs exactly five verifiers:

| Name | Script | Covers |
| --- | --- | --- |
| `cloud-auth` | `verify-cloud-auth.mjs` | auth + storage + projects API loop |
| `hf-publish` | `verify-hf-publish.mjs` | admin panel UI + bundle/push dry-run |
| `rotation-enabled` | `verify-rotation-enabled.mjs` | engine mount + per-layer ROTATE |
| `autoplay` | `verify-autoplay.mjs` | auto-play last loaded song |
| `e2e-media-record` | `verify-e2e-media-record.mjs` | bootstrap → MediaRecorder cycle |

Default per-script timeout is 60 s (90 s for `cloud-auth`), overridable with
`VERIFY_TIMEOUT_<NAME>_MS` (e.g. `VERIFY_TIMEOUT_E2EMEDIARECORD_MS=120000`).
The list is fixed in `scripts/check-verify-smoke.mjs`. **Every other
`verify-*.mjs` is a developer aid run on demand — it is in no gate.**

## CI

`.github/workflows/ci.yml` is the only workflow. It runs on PRs against `main`
and on pushes to non-`main` branches (a direct push to `main` does not trigger
it), `timeout-minutes: 20`:

1. `npm ci`
2. `npm run check:full`
3. `npm run targeting:verify`
4. `npm run check:automix-arc-smoke`
5. `npm run verify:transitions`
6. `npm run verify:automix-cross-surface`
7. `npm run build`
8. build-size budget: `dist/` must stay ≤ 130 MB (136,314,880 bytes),
   measured as `find dist -type f -printf '%s\n' | awk '{s+=$1} END {print s}'`

Vercel deploys on push to `main` independently of this job.

## Raising a failure

- Read the step output; `run-steps` reports each step and a group summary.
- A flake is re-run once, not weakened. Known flake: `verify:automix` has timed
  out on a loaded runner while passing locally.
- Env-skip pattern: a test that needs a resource outside this repo (e.g.
  `verify:hf-publish` needs the sibling
  `~/Documents/autodashboard/magenta-dsp-procedural` source,
  `check:bundle` the same) must print `(env skip: <reason>)` literally and exit
  0 — matching `scripts/build-magenta-dsp-bundle.sh`. Keep the marker literal so
  a real failure still surfaces.

## Adding a test

- E2E: add `verify-<feature>.mjs` at repo root, wire it as
  `npm run verify:<feature>` in `package.json`. Add it to a `run-steps` group or
  to `ci.yml` if it should gate; otherwise document it as an on-demand aid.
- Unit / smoke: add `scripts/check-<feature>-<unit|smoke>.mjs`, wire it in
  `package.json`, then add it to a group in `scripts/run-steps.mjs`.
- Each `verify-*.mjs` and `scripts/check-*.mjs` is standalone (no shared
  harness; `scripts/lib/verify-runner.mjs` provides timeouts and `before` hooks
  for the curated 5 only). No shared discovery — a script that is in no group is
  never run.

## Not covered

- Visual regression: no Percy/Chromatic. Review is manual or against the curated
  screenshots in `verify-screenshots/`.
- Cross-browser: Puppeteer runs on Chromium only.
- Performance budgets: no Lighthouse CI.
