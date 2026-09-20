# Naming Conventions

## Files & Directories

- **kebab-case** for everything: `audio-analysis-v2.js`, `verify-agi-bg.mjs`,
  `engine-autoplay.client.js`, `marketplace/curated/`.
- **Engine subsystem prefix**: anything that lives in the engine runtime uses
  `engine-<subsystem>.client.js` (e.g. `engine-stage.client.js`,
  `engine-presets.client.js`, `engine-tour.client.js`).
- **`.client.js` suffix** marks global-script files that attach to `window`.
  Anything **without** that suffix is treated as an ES module.
- **`.mjs`** on scripts/tools explicitly signals ESM at the file level (even when
  the calling context is unclear).
- **Backup branches** use the prefix `backup/<name>-YYYYMMDD` — created during
  the 2026-09-19 worktree-merge sweep. Treat as historical snapshots; do **not**
  resurrect unless an investigation demands it.

## Identifiers

- **Variables & functions**: `camelCase` (`renderStage`, `currentPreset`, `safeKey`).
- **Constants**: `SCREAMING_SNAKE_CASE` for true constants (`MAX_LAYERS`,
  `RATE_LIMIT_PER_MIN`).
- **Classes / constructors**: `PascalCase` (`VisualizerController`, `MediaStore`).
- **DOM IDs**: `kebab-case` with semantic prefix (`swr-user-media-grid`,
  `decay-v`, `lib`).
- **Custom elements**: `kebab-case` with at least one dash (`<swr-nav>`,
  `<swr-user-media>`).
- **CSS variables**: `--kebab-case` (`--accent`, `--font-display`,
  `--space-md`).

## Branches

- Conventional prefixes:
  - `feat/<scope>-<short-slug>` for features
  - `fix/<scope>-<short-slug>` for bug fixes
  - `refactor/<scope>-<short-slug>` for refactors
  - `docs/<scope>` for documentation-only
  - `chore/<scope>` for tooling/infra
  - `focus/<short-slug>` for exploratory work-in-progress
  - `integration/<short-slug>` for pre-merge integration branches
  - `sprint/YYYY-MM-DD` for time-boxed sprints
- **Never push to `main` directly.** Branch from `main`; open a PR.

## Commits

- **Conventional commits** only: `feat:`, `fix:`, `refactor:`, `docs:`,
  `chore:`, `perf:`, `test:`. Scope is encouraged: `fix(engine): …`,
  `feat(automix): …`.
- Subject ≤ 72 chars; imperative mood; no trailing period.
- Body wraps at 100 cols; explain *why*, not *what*.