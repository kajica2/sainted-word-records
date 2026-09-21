# Automix v2 — Cross-Variant Port (17 variants, single mega-PR)

> Generated: 2026-09-20
> Status: **draft, executing via subagent-driven-development**
> Closes: cross-cutting decision #2 from `docs/plans/2026-09-20-automix-v2.md`

---

## Goal & Scope

Port the automix + curator stack to the 17 engine variants that don't yet have it:
`aurora, baroque, chrome, collage, echo-manifold, eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, tape, typography, void, watercolor`.

Already ported (do **not** touch): `film, grid, hallucination, neon, smoke`.
Originator (do **not** touch): `music_video.html`, `music_video_mtv.html`.

Rollout: **single mega-PR.** Per-variant opt-out lives in the config (`enabled: false`) for variants where automix doesn't make sense — verified during implementation, not pre-decided.

---

## Macro decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Rollout | Single mega-PR (all 17) |
| Default state | Opt-in toggle, off by default (matches music_video) |
| Variant tuning | Per-variant config map (`variants/<name>.automix.json`) |
| Test coverage | Shared unit + smoke; `verify:automix-cross-surface` extended |
| Config loading | JSON files inlined at build via new Vite plugin (Approach A) |

---

## Architecture (single source of truth)

Per variant, three additions:
```
versions/<name>.html
  ├── <script type="application/json" id="swrc-automix-config">{…}</script>  ← inlined by Vite
  ├── <script src="../client/automix-runtime.client.js"></script>            ← runtime (matches film.html:296 pattern, no defer)
  └── <label class="tbtn" id="automix-toggle" style="cursor:pointer;">Automix <span id="automix-state" style="color:var(--m);">OFF</span></label>  ← toggle (matches film.html:407)
```

The toggle pattern matches the existing done variant `film.html` — same `<label class="tbtn">` + `<span id="automix-state">` structure. Don't introduce a new button class. The runtime's existing handlers (registered in `client/automix-runtime.client.js`) read these IDs.

`client/automix-runtime.client.js` gains:
- Private `_config = null`
- `loadConfig()` — reads `document.getElementById('swrc-automix-config').textContent`, parses JSON, validates against schema, applies fields to existing constants
- IIFE init calls `loadConfig()` BEFORE any state is read; missing/invalid → log warning, fall back to defaults (graceful degradation matching v2 cross-cutting decision #3)

---

## Config schema (`variants/aurora.automix.json`)

```json
{
  "version": 1,
  "variant": "aurora",
  "enabled": true,
  "defaultState": "off",
  "poolBias": {
    "intro":     { "warmth": [0.4, 0.6], "intensity": [0.0, 0.4] },
    "verse":     { "warmth": [0.3, 0.7], "intensity": [0.3, 0.6] },
    "prechorus": { "warmth": [0.4, 0.7], "intensity": [0.5, 0.8] },
    "chorus":    { "warmth": [0.2, 0.8], "intensity": [0.6, 1.0] },
    "breakdown": { "warmth": [0.5, 0.9], "intensity": [0.0, 0.3] },
    "outro":     { "warmth": [0.3, 0.6], "intensity": [0.2, 0.5] }
  },
  "driftAmplitude": { "base": 0.01, "beatScale": 0.02 },
  "tuning": { "minTickMs": 500, "maxTickMs": 3000 },
  "anchorMap": "all",
  "ui": { "toggleLabel": "Auto-Mix", "toggleShortcut": "a" }
}
```

All fields optional except `variant` and `version`. Defaults come from the runtime.

Field semantics:
- `enabled: false` → per-variant kill-switch (toggle button hidden)
- `defaultState` — `"on"` would override global opt-in default; defaults to `"off"`
- `poolBias` — partial override; unlisted sections fall back to global
- `driftAmplitude` — replaces runtime `base` / `beatScale`
- `tuning` — replaces `TICK_MIN_MS` / `TICK_MAX_MS`
- `anchorMap` — `"all"` uses full map (only value for now; reserved for `"gradient:<id>"` slices)
- `ui` — `toggleLabel`, `toggleShortcut` override per-variant UI strings

---

## Vite plugin

New entry in `vite.config.js`'s custom plugin list:

```js
{
  name: 'inline-automix-config',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      const match = ctx.filename.match(/versions\/([^.]+)\.html$/);
      if (!match) return html;
      const variant = match[1];
      const jsonPath = path.resolve(__dirname, `variants/${variant}.automix.json`);
      if (!fs.existsSync(jsonPath)) return html;
      const json = fs.readFileSync(jsonPath, 'utf8');
      const tag = `<script type="application/json" id="swrc-automix-config">${json}</script>`;
      return html.replace('</head>', `${tag}\n</head>`);
    }
  }
}
```

The 17 JSON files in `variants/` are the single source of truth; the plugin inlines them at build so the runtime never needs a network round-trip (offline-first, matches the PWA shell ethos).

---

## Test strategy

**Unit (`scripts/check-automix-unit.mjs`):**
- For each of 17 variants: parse `<name>.automix.json`, validate against schema, bounds-check numeric fields.
- `loadConfig()` unit tests: applies `poolBias`, `driftAmplitude`, `tuning`, `enabled`; falls back to defaults on missing/invalid JSON.

**Smoke (`scripts/check-automix-smoke.mjs`):**
- For each of 17 variants: navigate, wait for `#swrc-automix-config` in DOM, click `#automix-toggle`, verify `_fxOverride` evolves within 5s.
- Existing music_video + 5 done variants still pass.

**E2E (`verify-automix-cross-surface.mjs`):**
- Already covers music_video + 5 done variants. Add 17 new surface entries to the matrix — same test body, different `page.goto()` URL.

**CI gate:** `npm run check:full` already runs `check:automix-unit` + `check:automix-smoke` + `verify:automix` (per `package.json:16`). Mega-PR extends the same gate — no new scripts in CI.

---

## Build pipeline impact

- New Vite plugin: one synchronous fs read per HTML during build (negligible).
- Output: 17 HTML files gain ~3KB script tags + ~1KB inlined config ≈ 70KB raw. Bundled dist delta < 2MB.
- Current budget 130MB, current usage ~114MB → **16MB margin.**

---

## Risk & Rollback

**Risks.**
1. Audio features divergence — `tape.html` uses fake audio features; `enabled: false` is the kill-switch.
2. Toggle UX consistency — 17 variants each get a button; z-index, color, and mobile touch-target match the existing toolbar pattern; verified by `verify:site-nav` (already in CI).
3. Config schema drift — adding a new field later means every variant's JSON needs the new field. Mitigated by making all fields optional with sensible defaults — old configs keep working.

**Rollback.**
- Mega-PR = single revert point: `git revert <commit>` restores the unported state.
- Per-variant kill-switch: flip `enabled: false` in `<name>.automix.json` (one-line config change, no code deploy).
- Runtime fallback: if config fails to parse, runtime logs and uses defaults.

**`enabled: false` candidates** (to verify during implementation, not pre-decided):
- `tape.html` — fake audio features
- Any variant where the smoke test reveals the runtime can't honor the config

---

## Out of scope (deferred)

- Per-variant UX labels (we ship `"Auto-Mix"` everywhere — same as music_video)
- Auto-enable on first song detection
- Real-audio synthesis verify (`OfflineAudioContext`)
- Cross-tab sync hardening (already shipped `5af3e19`)
- Cross-engine anchor map sharing

---

## Implementation tasks

Each task is a subagent-driven implementation step. Order matters: runtime refactor (Task 1) must land before the HTML edits (Task 3) and config files (Task 2) can be tested. Tests (Task 4) and docs (Task 5) come last.

### Task 1 — Runtime config-loader

**Files:** `client/automix-runtime.client.js` (refactor)

**Contract:**
- Add `_config` private field; `loadConfig()` parses `#swrc-automix-config`, validates, applies fields.
- IIFE init calls `loadConfig()` before any state read.
- Missing/invalid JSON → `console.warn`, fall back to defaults (existing constants stay untouched).
- `enabled: false` → hide `#automix-toggle` if present.
- `defaultState: "on"` → call `start()` after load.
- `poolBias` partial override — merge with existing `POOL_BIAS` map (sections not listed keep global defaults).
- `driftAmplitude` / `tuning` — replace constants in place.
- `anchorMap: "all"` — no-op for now (reserved).
- `ui.toggleLabel` / `ui.toggleShortcut` — applied to the toggle button after `loadConfig()`.

**Acceptance:**
- Existing music_video + 5 done variants still pass all tests.
- Adding `enabled: false` to any config hides the toggle.
- Unit tests cover: parse success, parse failure (graceful fallback), each optional field, bounds-check on numeric fields.

**Tests:** `scripts/check-automix-unit.mjs` (additions only, no breaking changes).

---

### Task 2 — 17 variant config files + Vite plugin

**Files:**
- `variants/aurora.automix.json` … `variants/watercolor.automix.json` (17 files)
- `vite.config.js` (add `inline-automix-config` plugin)

**Contract:**
- Each JSON file is valid per the schema in §"Config schema"; defaults to `enabled: true` unless implementation finds reason to opt out (see "enabled: false candidates").
- `version: 1`, `variant: "<name>"` match the filename.
- The 17 files are byte-identical except for `variant` (defaults are uniform — per-variant overrides come in a follow-up if needed).

**Vite plugin contract:**
- Plugin reads `variants/<variant>.automix.json` from disk relative to `vite.config.js` location.
- Only operates on HTML files in `versions/` directory.
- Inserts `<script type="application/json" id="swrc-automix-config">{…}</script>` immediately before `</head>`.

**Acceptance:**
- `npm run build` succeeds; `dist/versions/<name>.html` contains the inlined JSON.
- `npm run dev` (port 5174) serves variants with the JSON in DOM.
- Each JSON file parses without error; the 17 files together form a clean set (no duplicates, all 17 variants covered).

**Tests:** `scripts/check-automix-unit.mjs` validates each of the 17 JSONs against the schema.

---

### Task 3 — 17 HTML edits

**Files:** `versions/aurora.html` … `versions/watercolor.html` (17 files)

**Contract (per HTML):**
- Add `<script src="../client/automix-runtime.client.js"></script>` (no `defer`, matching `film.html:296`).
- Add `<label class="tbtn" id="automix-toggle" style="cursor:pointer;">Automix <span id="automix-state" style="color:var(--m);">OFF</span></label>` (matching `film.html:407` exactly — same class, same span structure).
- Place both inside the existing toolbar block (typically near other audio-reactive controls). Implementer should grep for existing `tbtn` usage in each variant to find the natural insertion point.
- The `<label>` (not `<button>`) matches what `client/automix-runtime.client.js` already binds to (it reads `document.getElementById('automix-toggle')` and toggles the inner text).

**Acceptance:**
- All 17 variants open without console errors.
- Toggle button appears in DOM after `loadConfig()` resolves.
- Clicking toggle starts/stops `_fxOverride` evolution (verified by smoke test).

**Tests:** `scripts/check-automix-smoke.mjs` (matrix of 17 variants × {toggle on, _fxOverride evolves}).

---

### Task 4 — Test coverage

**Files:**
- `scripts/check-automix-unit.mjs` (additions)
- `scripts/check-automix-smoke.mjs` (additions)
- `verify-automix-cross-surface.mjs` (additions)

**Contract:**

Unit additions:
- New helper `validateAutomixConfig(json, variantName)` returns `{ok, errors[]}`.
- Loop over the 17 known variant names; for each, parse the JSON, call `validateAutomixConfig`, fail with errors if any.
- `loadConfig()` unit tests: stub `document.getElementById` to return a fake `<script>` with various JSON payloads; assert behavior matches each spec branch.

Smoke additions:
- New loop over the 17 variants; for each, `page.goto()`, wait for `#swrc-automix-config`, click `#automix-toggle`, wait 5s, assert `_fxOverride` changed ≥ 1 time.
- Preserve existing music_video + 5 done variant assertions.

E2E additions (`verify-automix-cross-surface.mjs`):
- Extend the existing surface matrix to include all 17 new variants.
- Same test body, parameterized URL.

**Acceptance:**
- All three test files pass.
- `npm run check:full` exits clean.
- Coverage of all 22 automix-enabled surfaces (music_video + 5 done + 17 new).

---

### Task 5 — Docs

**Files:**
- `docs/CHANGELOG.md` (entry)
- `AGENTS.md` (variant section update)
- `docs/plans/2026-09-20-automix-v2-port.md` (this file — close it out)

**Contract:**

CHANGELOG entry:
- One bullet: "feat(automix): port automix+curator stack to 17 engine variants (aurora, baroque, …, watercolor) via per-variant config map; off-by-default toggle matching music_video UX".

AGENTS.md update:
- Update the "5 core variants" sentence (the engine subsystem description) to acknowledge the cross-variant rollout.
- Note the new `variants/<name>.automix.json` config convention.

This plan file:
- Append a "Shipped" section with the final commit hash once Task 4 completes.

**Acceptance:**
- CHANGELOG entry parses in the same format as recent entries.
- AGENTS.md update is consistent with the rest of the file.
- No other docs require touching.

---

## Global constraints (binding for all tasks)

1. **Don't break the existing 5 done variants or music_video.** All tasks must pass the existing `npm run check:full` before adding new test coverage.
2. **Build size budget ≤ 130MB.** Current 114MB, delta should be < 5MB. CI asserts the budget.
3. **Offline-first.** Configs are inlined at build, never fetched at runtime.
4. **Per-variant opt-out via `enabled: false`.** No code-level kill-switches; config is the single source of truth.
5. **Conventional commits.** `feat(automix):` prefix; sub-scope per task (e.g. `feat(automix): runtime config-loader`, `feat(automix): 17 variant configs`, `feat(automix): cross-variant UI hook`).
6. **PR & commit conventions from AGENTS.md apply.** Use `-c user.name='Kajica Djuric' -c user.email='kai.djuric@gmail.com' --author='Kajica Djuric <kai.djuric@gmail.com>'` flags on every commit (the repo has no local git config; the global identity is correct for Vercel deploys).

---

## Pending tweaks

_(To be filled in by user if any of sections 1–4 of the brainstormed design need adjustments.)_

---

## Shipped

- Branch: `feat/automix-v2-port`
- Final commit hash: `4559525`
- Mega-PR commit chain (oldest → newest, matches `git log 49e275a~1..feat/automix-v2-port`):
  - `49e275a` docs(plan): automix v2 cross-variant port (17 variants, mega-PR)
  - `9482db8` feat(automix): runtime config-loader for cross-variant port (Task 1 initial)
  - `c25ca94` feat(automix): runtime config-loader replaces drift amplitudes (Task 1 round 1 fix)
  - `098ab53` feat(automix): runtime config-loader parity for tuning + label tests (Task 1 round 2 fix)
  - `f59ea82` feat(automix): 17 variant configs + vite inline plugin (Task 2)
  - `6848752` feat(automix): cross-variant UI hook (17 toggle buttons + script tags) (Task 3)
  - `22dad03` feat(automix): opt out echo-manifold + tape (no automix stack) (Task 3 round 1)
  - `b2a9c6a` feat(automix): test coverage for cross-variant port (Task 4)
  - `f23b84d` feat(automix): smoke assertion now checks _fxOverride evolution (Task 4 round 1 fix)
  - `4559525` docs(automix): changelog + AGENTS.md + plan close-out (Task 5)

### Surface coverage at ship time

- 23 surfaces total: 1 reference (`music_video`) + 5 core (neon, film, grid, smoke, hallucination) + 17 artistic presets.
- 15 enabled (toggle ships + toggles runtime): aurora, baroque, chrome, collage, eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, typography, void, watercolor.
- 2 opt-out (`enabled: false`, toggle hidden): echo-manifold, tape.
- `music-video-gallery.html` deliberately not wired (gallery, not a single-variant engine).

### Docs deliverables (Task 5)

- `docs/CHANGELOG-2026-09-21.md` — new dated changelog with the cross-variant rollout summary. Created following the project's established `docs/CHANGELOG-YYYY-MM-DD.md` convention (the brief referenced `docs/CHANGELOG.md`, which doesn't exist in the repo). See Task 5 report for rationale.
- `AGENTS.md` — appended a sentence to the `versions/` line acknowledging the cross-variant rollout + the `enabled: false` opt-outs; added a new `variants/` line describing the per-variant config convention; added `inline-automix-config` to the `vite.config.js` plugin list.
- This plan file — appended "Shipped" section (this section).
