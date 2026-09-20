# Changelog — 2026-09-21

> The automix + curator stack ports from `music_video.html` to 20 of the 22 engine
> variants via a per-variant config map. The toggle stays off by default to
> preserve the existing UX; `echo-manifold` and `tape` opt out because their
> audio-feature extraction diverges from the canonical path.

## Cross-variant automix rollout (9 commits, 22 surfaces)

The 17 artistic variants (`aurora, baroque, chrome, collage, echo-manifold,
eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, tape,
typography, void, watercolor`) now load the same `client/automix-runtime.client.js`
that `music_video.html` and the 5 core variants (neon, film, grid, smoke,
hallucination) already ship. Tuning lives in `variants/<name>.automix.json`,
inlined into the matching `versions/<name>.html` at build time by a new Vite
plugin (`vite.config.js` `inline-automix-config`). 15 of the 17 artistic variants
are `enabled: true`; `echo-manifold` and `tape` are `enabled: false` opt-outs.

- `feat(automix): port automix+curator stack to 17 engine variants (aurora,
  baroque, …, watercolor) via per-variant config map; off-by-default toggle
  matching music_video UX`

Commits (mega-PR chain, oldest first):

- `49e275a` — `docs(plan): automix v2 cross-variant port (17 variants, mega-PR)`
- `9482db8` — `feat(automix): runtime config-loader for cross-variant port` (Task 1)
- `c25ca94` — `feat(automix): runtime config-loader replaces drift amplitudes (round 1 fix)`
- `098ab53` — `feat(automix): runtime config-loader parity for tuning + label tests (round 2 fix)`
- `f59ea82` — `feat(automix): 17 variant configs + vite inline plugin` (Task 2)
- `6848752` — `feat(automix): cross-variant UI hook (17 toggle buttons + script tags)` (Task 3)
- `22dad03` — `feat(automix): opt out echo-manifold + tape (no automix stack)` (Task 3 round 1)
- `b2a9c6a` — `feat(automix): test coverage for cross-variant port` (Task 4)
- `f23b84d` — `feat(automix): smoke assertion now checks _fxOverride evolution (round 1 fix)`
- `<this commit>` — `docs(automix): changelog + AGENTS.md + plan close-out` (Task 5)

## Stats

- **17 new files**: `variants/<name>.automix.json` (one per artistic variant).
- **17 HTML edits**: `versions/<name>.html` (toggle + script tag injection).
- **1 runtime refactor**: `client/automix-runtime.client.js` gains a `loadConfig()`
  validator + applier; existing constants stay as the defaults.
- **1 Vite plugin**: `vite.config.js` `inline-automix-config` reads
  `variants/<name>.automix.json` at build time and inserts a
  `<script type="application/json" id="swrc-automix-config">` tag before `</head>`.
- **Test coverage**: `scripts/check-automix-unit.mjs` (55 → 58 scenarios),
  `scripts/check-automix-smoke.mjs` (15 enabled + 2 disabled variant checks),
  `verify-automix-cross-surface.mjs` (7 → 24 surfaces in the matrix).
- **No edits** to `music_video.html`, the 5 core variants, or any of the
  pre-existing engine subsystems (`engine-core.client.js`,
  `engine-render.client.js`, `engine-transitions.client.js`,
  `engine-timing.client.js`, `audio-analysis-v2.js`). The runtime composes
  around them.
