# Contributing to Sainted Word Records

Thanks for the help. SWR is the source-code repo behind
[sainted-word-records.vercel.app](https://sainted-word-records.vercel.app)
— an audio-reactive video engine plus a swarm of derivative tools.

## Quick start

```bash
npm install
npm run dev                # http://localhost:5174 (engine)
                           # http://localhost:5175  (5174 occupied)
npm test                   # the curated 63-step unit group
npm run check              # check + check:full + check:storyboard
npm run build              # vite build → dist/
```

The full pre-PR gate is `npm run check:full` (20 steps). CI on every PR
runs it via `.github/workflows/ci.yml`.

## Repo map

- **`engine.html`** — the only Rollup input in `vite.config.js`. Every
  other page ships as a static copy via `copy-static`.
- **`lib/` (51 files)** — engine primitives: audio, layers, FX, library,
  intensity slider, etc.
- **`client/` (54+ files)** — feature stacks: automix, mesh, capture,
  looks-menu, presets panel, storyboard, debug overlay, the cloud-library
  FAB + module, the shortcuts-movie driver, the tour driver.
- **`api/`** — Vercel serverless routes: auth (magic + Google OAuth),
  projects (Firestore-aware with local-FS default), kits (zip
  distribution), library (manifest + zops), storage (signed URLs).
- **`docs/PLANS/`** — design docs that double as audit trails (number-key
  assignment, firestore user library menu, layer-lifecycle).
- **`scripts/`** (98+ files) — 63-step `npm run check`, standalone
  `verify-*.mjs` E2E Puppeteer suites, codemod injectors, build
  helpers.
- **`tools/`** — `deploy-vercel.sh`, `local-dns.mjs`, HF publish tool,
  mobile preview, etc.

## Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(engine): add Layers.addText(text, opts)
fix(invite): auto-migrate v1 schema marker → v2
refactor(layers): pull retire/unretire out into a pair
docs(tour): add Nielsen heuristic tags
test(keys): extensive digit→filter coverage
chore(deps): bump abc to 1.2.3
```

Recent examples live in `git log --oneline -20`.

`feat:` lands on the user-visible surface. `fix:` is for surface or
runtime bugs. `refactor:` is internal-only. `docs:` is documentation-
only. `test:` adds or edits tests without shipping behavior. `chore:`
is the catch-all (deps, config).

## Test surface

- **63-step unit suite** (`npm run check`): syntax + bundle + util +
  API + curated smokes. ~110 tests across 70+ files. Green on every
  push to `main` is the bar.
- **20-step full pre-PR gate** (`npm run check:full`): adds Puppeteer
  smokes, Vercel-style health checks, and the curated 5 verifier
  smoke (`scripts/check-verify-smoke.mjs`).
- **Standalone `verify-*.mjs`** Puppeteer E2E: each page / surface
  gets its own. Run on demand before claiming a feature done.

If you're submitting a substantial change, also wire a `check:*.mjs`
suite so the new surface ships with at least unit coverage + an
on-demand E2E. Many `check:*.mjs` files follow the same template —
copy one from `scripts/check-*` and rename.

## Where things live in the engine

| Concern              | Files                                                  |
|----------------------|--------------------------------------------------------|
| Audio features       | `lib/audio.client.js`, `audio-analysis-v2.js`          |
| Layer model          | `lib/layers.client.js`                                 |
| FX / shaders         | `fx-postprocess.js`, `engine.html` (drawLayer)         |
| Library              | `lib/library.client.js`, `lib/library-hygiene.client.js` |
| Cloud library / Firestore | `client/cloud-library*.client.js`, `api/library/`, `api/_lib/firestore.js` |
| Keyboard             | `engine-keys.client.js`                               |
| Variant switcher     | `client/variant-switcher.client.js`                    |
| Audio algo (Pulse/Drift/Spark) | `client/layer-audio-algos.client.js`    |
| Canvas / WebGL       | `engine.html`, `client/engine-render.client.js`       |
| Theme + tokens       | `lib/design-tokens.css`, `lib/components.css`         |
| Install + boot       | `engine-bootstrap.client.js` (per `<script>` tag order) |

## Style

- Vanilla JavaScript, ESM (`"type": "module"` in `package.json`).
  **No TypeScript.**
- 2-space indent, LF, UTF-8, final newline, no trailing whitespace
  (`.editorconfig` is the source of truth; `*.md` files exempt).
- Single quotes, `'use strict'` not needed (ESM), `const`/`let` over
  `var`, async/await over callbacks.
- File names are descriptive kebab-case. Engine subsystems use the
  `engine-<subsystem>.client.js` convention. Helper modules for `<name>` in
  `lib/`. Feature stacks for `<name>` in `client/`.
- Add shared chrome/chrome.css via `migrate-html.mjs --include-apps`
  (the script is idempotent). Don't hand-edit the nav / footer markup
  on shipped pages.
- Don't add `type="module"` to absolute-path `<script>` tags in any
  `*.html` — there's a Vite plugin that strips them. Adding it back
  breaks the bundle.

## Pull-request checklist

Before pushing:

- [ ] `npm run check:full` is green locally.
- [ ] If you added a new module, add a `check:*.mjs` under `scripts/`.
- [ ] If you added a page, run `node scripts/generate-site-manifest.mjs`
  + `node scripts/generate-vercel-rewrites.mjs` so the new page is
  reachable.
- [ ] If you added a new env var, document it in `.env.example`.
- [ ] If you touched the engine render loop, run
  `node scripts/check-verify-smoke.mjs`.
- [ ] Changelog: extend `CHANGELOG.md` "Unreleased" section
  (`feat:` / `fix:` / `refactor:` etc.).

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Please don't open a public issue
for suspected vulnerabilities — use the disclosure channel listed
there. API rate-limits, session TTLs, and key-leak prevention are all
described in that doc.

## Code of conduct

[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — short version: don't be
unkind, accept feedback gracefully, ship working code over clever
code.

## Versioning

We follow semver. Once we hit 1.0, the same contract applies to
published tags. Until then, every push to `main` is the latest and
greatest.

## License

By contributing, you agree your contributions are licensed under the
project's MIT License — see [`LICENSE`](./LICENSE).
