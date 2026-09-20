# Testing Conventions

## Layer Cake

| Layer        | Runner              | Pattern                              | Where                          |
| ------------ | ------------------- | ------------------------------------ | ------------------------------ |
| Syntax gate  | `node`              | parses every `.js` + inline scripts  | `scripts/check-syntax.mjs`     |
| Manifest gate| `node`              | validates `site-map.json` invariants | `scripts/generate-site-manifest.mjs` |
| Bundle gate  | `node`              | smoke-build with dummy env           | `scripts/check-bundle.mjs`     |
| API unit     | `node`              | per-route assertions, no Puppeteer   | `scripts/check-auth-unit.mjs`, etc. |
| API smoke    | `node`              | hits running dev API                 | `scripts/test-api.mjs`         |
| Browser unit | `node` + jsdom-ish  | DOM-bound module logic               | `scripts/check-*-unit.mjs`     |
| Browser smoke| `node` + Puppeteer  | headless Chromium drives real engine | `scripts/check-*-smoke.mjs`    |
| E2E          | `node` + Puppeteer  | full user journeys, auto-login       | `verify-*.mjs` (root)          |

## Pre-PR Gates

- **Quick gate** — `npm run check`
  Runs: `check:syntax` + `check:manifest` + `check:bundle` + `scripts/test-api.mjs`.
  Expected time: ~30s. **Always run before committing.**

- **Full gate** — `npm run check:full`
  All of the above + `check:verify` (verify smoke).
  Expected time: ~2min. **Run before opening a PR.**

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