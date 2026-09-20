# Coding Style

Source: AGENTS.md + `.editorconfig` (auto-detected 2026-09-20).

## Indentation & Whitespace

- **2-space indent**, LF line endings, UTF-8, final newline, **trim trailing whitespace**
- Exemptions (per `.editorconfig`):
  - `*.md` — trailing whitespace is intentional (Markdown line breaks); do **not** strip
  - `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` — do not touch at all
  - `Makefile` — literal tabs in recipes

## Module System

- **ESM only** (`"type": "module"` in `package.json`). No CommonJS, no TypeScript.
- `'use strict'` not needed (ESM is always strict).
- Prefer `const`/`let` over `var`. **Async/await** over callbacks/promise chains where readable.
- **Single quotes** for strings.

## Linting / Formatting

- **No ESLint, no Prettier.** Follow the surrounding style in each file.
- Lint discipline is enforced by `npm run check:syntax` (parses 354 files + 135 inline scripts)
  and the per-feature `verify-*.mjs` smoke + unit scripts. **Do not** add `.eslintrc` /
  `.prettierrc` files without an ADR.

## File Conventions

- File names: descriptive **kebab-case** (`audio-analysis-v2.js`, `verify-agi-bg.mjs`).
- Engine subsystems use `engine-<subsystem>.client.js` convention.
- **`<name>.client.js`** files are **global-script** design (attach to `window`), loaded
  via `defer`. Shared helpers live in `lib/`.
- **Serverless handlers** live in `api/<route>.js`; shared code in `api/_lib/`.
- HTML pages reference scripts with **absolute paths** (e.g. `/pwa-bootstrap.js`); a Vite
  plugin (`strip-absolute-module-scripts` in `vite.config.js`) strips `type="module"` from
  those so they load as plain defer'd scripts. **Do not** re-add `type="module"` to
  absolute-path scripts in any `*.html`.

## Module Pattern Cheat Sheet

| Surface              | Location                          | Convention                                       |
| -------------------- | --------------------------------- | ------------------------------------------------ |
| Engine subsystem     | `engine-*.client.js` (root)       | global script, attaches to `window`, `defer`     |
| Shared browser code  | `lib/<name>.client.js`            | global script, attaches to `window`, `defer`     |
| Serverless handler   | `api/<route>.js`                  | ESM `export default async function handler(...)` |
| API shared code      | `api/_lib/<name>.js`              | ESM, imported by handlers                        |
| E2E script           | `verify-<feature>.mjs` (root)     | standalone Node + Puppeteer, no shared harness   |
| Unit/smoke script    | `scripts/check-<feature>.mjs`     | standalone Node, no shared harness               |
| Build/dev script     | `scripts/<name>.mjs` or `.sh`     | ESM Node or POSIX shell                          |