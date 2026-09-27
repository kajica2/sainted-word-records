# Testing Conventions

## Layer Cake

| Layer        | Runner              | Pattern                              | Where                          |
| ------------ | ------------------- | ------------------------------------ | ------------------------------ |
| Syntax gate  | `node`              | parses every `.js` + inline scripts  | `scripts/check-syntax.mjs`     |
| IA / deploy gate | `node`          | every rewrite, link and site-map entry resolves in `dist/` | `scripts/check-dist-links.mjs` |
| Bundle gate  | `node`              | smoke-build with dummy env           | `scripts/check-bundle.mjs`     |
| API unit     | `node`              | per-route assertions, no Puppeteer   | `scripts/check-auth-unit.mjs`, etc. |
| API smoke    | `node`              | hits running dev API                 | `scripts/test-api.mjs`         |
| Browser unit | `node` + jsdom-ish  | DOM-bound module logic               | `scripts/check-*-unit.mjs`     |
| Browser smoke| `node` + Puppeteer  | headless Chromium drives real engine | `scripts/check-*-smoke.mjs`    |
| E2E          | `node` + Puppeteer  | full user journeys, auto-login       | `verify-*.mjs` (root)          |

## Pre-PR Gates

Grouped lists live in `scripts/run-steps.mjs` and are executed by
`npm run check` / `check:storyboard` / `check:full`. They are deliberately not
`&&` chains: a chain short-circuits, so the first failure used to hide every
later step (CI run 36323771785 truncated `check:full` at `check:verify` and
silently skipped seven suites). Counts as of 2026-09-27; verify with
`node scripts/run-steps.mjs <group> --list` rather than trusting this table.

- **Quick gate** — `npm run check` (**40 steps**)
  Syntax + bundle check + the unit suites (automix, narrative, storyboard
  render/keys, auth, bpm, storage/db, capture, media-input, spit-live, …) +
  `scripts/test-api.mjs` + the browser smokes that need no interaction.
  Expected time: ~50s. **Always run before committing.**

- **Full gate** — `npm run check:full` (**12 steps**)
  `check` + `check:verify` + `check:automix-smoke` + `check:automix-arc-smoke` +
  `check:storyboard` + `verify:automix` + `verify:genops` +
  `verify:story-graph` + `check:capture-smoke` + `check:media-input-smoke` +
  `check:spit-live-smoke` + `check:dist-links`. **Run before opening a PR.**

- **`check:verify`** — the curated 5-verifier smoke that actually gates PRs, fixed
  in `scripts/check-verify-smoke.mjs`: `cloud-auth`, `hf-publish`,
  `rotation-enabled`, `autoplay`, `e2e-media-record`. Bootstraps a Vite dev
  server on `:5175` with a temp `SWRC_DATA_DIR`; see
  `docs/CI-VERIFY-STRATEGY.md`. Every other `verify-*.mjs` is a developer aid
  run on demand (about half the npm scripts are in no gate at all).

- **`check:dist-links`** — deploy-surface integrity (`scripts/check-dist-links.mjs`):
  every `vercel.json` rewrite, every root-relative link in a shipped page, and
  every `site-map.json` entry must resolve to something in `dist/`. Run it after
  editing `vite.config.js` copy lists or `site-map.json`.

- **Per-sprint E2E** — every non-trivial change should run the relevant
  `verify-*` script. **Typecheck + build do NOT catch runtime bugs** (Canvas/WebGL/PWA,
  audio permission flows, infinite re-render loops, IndexedDB persistence, Vercel
  deploy quirks). See AGENTS.md "Testing instructions".

## Script Discovery

Each `verify-*.mjs` and `scripts/check-*.mjs` is **standalone** (no shared harness).
They're discovered and run individually. To add a new test:

- E2E: add `verify-<feature>.mjs` at repo root, wire as `npm run verify:<feature>`
  in `package.json`.
- Unit/smoke: add `scripts/check-<feature>-<unit|smoke>.mjs`, wire accordingly.

## Auto-Login Pattern

Puppeteer tests that touch authenticated surfaces (`/api/storage/*`, `/api/projects/*`)
use stored cookies set by `tools/agentic-set.mjs` or the test's own `login()` helper.
Never bake credentials into a verify script.

## Env-Skip Pattern

Tests that need resources outside this repo (e.g. `verify:hf-publish` requires the
sibling `~/Documents/autodashboard/magenta-dsp-procedural` source) **must**:

1. Print `(env skip: <reason>)` literally when the resource is absent.
2. Exit 0 (pass) — matching the design intent of
   `scripts/build-magenta-dsp-bundle.sh:74-88`.
3. Keep the marker literal so a real failure still surfaces.

## Coverage Targets

- **API handlers**: every route must have at least one unit test in `scripts/check-*-unit.mjs`.
  Every error path returns 4xx with the documented `code`.
- **Engine subsystems**: each `engine-*.client.js` should have a smoke test in
  `scripts/check-<subsystem>-smoke.mjs`.
- **Per-feature surfaces** (variant switcher, photo slideshow, default library, etc.):
  a `verify-*` script covering the happy path + the failure modes documented in the
  feature's `*.md`.

## What We Do NOT Test

- **Visual regressions**: there is no Percy/Chromatic. Visual review is manual or
  via the curated screenshots in `verify-screenshots/`.
- **Cross-browser matrix**: smoke tests run on Chromium only (Puppeteer default).
  Firefox/Safari coverage is opportunistic.
- **Performance budgets**: no Lighthouse CI. Performance regressions are caught by
  manual review + the `verify:engine-boot` boot-time script.