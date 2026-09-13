# Plan — Config-Driven Variant Pages

> Survey + plan document. **No code has been written.** Read this through,
> suggest changes, then ask me to execute the chosen phase(s).

---

## TL;DR

The "single SPA, modular components, per-page config JSON" idea is **partially already true** in the codebase and **partially unsafe to push further**. The variants already share ~18 external scripts. What's NOT shared is the bespoke canvas-paint algorithm in each variant's inline JS — that's the thing different. A config-driven refactor is real work, has real risk, and the payoff is data-driven palette/metadata, not algorithm consolidation.

**Recommendation:** ship **Phase 1** (palette-only config JSON, applied via a 30-line shared inline script) and stop there. Phases 2-3 are bigger investments with diminishing returns.

---

## Survey — what's actually different across variants

I measured 23 variants. Three observable groups:

| Group | Count | Examples | Description |
|---|---|---|---|
| **A. Full engine** (Group A: full engine shape) | 14 | aurora, chrome, eclipse, film, fractal, glitch, grid, hallucination, music_video, neon, pulse, smoke, void, watercolor | Use full Audio (FFT/beat) + Library + Layers. ~18 shared external scripts. The variant is mostly chrome + inline paint. |
| **B. Shader-style** | 4 | collage, spectrum, typography, phosphor | Custom audio pull + custom paint. Different engine shape. |
| **C. CSS-only / minimal** | 3 | gallery, tape, mosaic, kraft, (tape counted) | No audio. Just CSS animation or a tiny paint loop. |

The per-variant file size varies wildly (tape.html: 13.7KB / 312 lines, music_video.html: 183KB / 3,223 lines).

**Per-variant differences that I verified by reading 5 variants:**

1. **CSS `:root` palette variables** (the page chrome color scheme). Always present, always inline, ~6-8 vars.
3. **`<title>` and `<meta name="description">`** (browser tab + SEO).
4. **`<body data-page="<name>">`** attribute.
5. **`DEFAULT_SONG = '../audios/<name>.mp3'`** — one line in the inline auto-start JS.
6. **Inline canvas paint algorithm** (the actual visual) — 100-1,200 lines per variant, **completely different** across variants. Spectrum's FFT bars ≠ Grid's perspective cells ≠ Tape's concentric rings.

**What's already shared (verified):**

- 18 external scripts loaded by every Group A variant: `engine-render.client.js`, `engine-timing.client.js`, `engine-timing-panel.client.js`, `engine-lfos.client.js`, `engine-lfo-panel.client.js`, `engine-automap.client.js`, `engine-settings.client.js`, `engine-keys.client.js`, `project.client.js`, `layer-scheduler.client.js`, `lib/reset-state.client.js`, `lib/recorder.client.js`, `versions-presets.js`, `temp-slider.js`, `engine-genops.client.js`, `engine-transitions.client.js`, `client/library-loader.client.js`, `client/visualizer-controller.js`.
- `window.Audio`, `window.Library`, `window.Layers`, `window.SWR` — published globally by the engine.
- The HTML body chrome (`#app > header > main > footer`) is structurally identical — only text/color differs.

---

## Honest assessment of "single SPA, modular components, config-driven"

What works:
- **Palette config** is trivially data-driven. Move the `:root` CSS variables into a JSON, apply via a 30-line shared inline script. Zero visual change.
- **Audio default + title + description + data-page** are trivially data-driven. Same approach.
- **Variant metadata** (name, mood, family, target audience) could be a single manifest entry per variant.

What does NOT work without rewriting the variants:
- **The paint algorithm** is bespoke per variant. You cannot "config-drive" `spectrum.html`'s FFT bars without making them not be FFT bars. Some variants are defined by their paint, not their palette.
- **The audio pipeline** differs — full FFT (Group A), custom `pullAudioFeatures` (Group B), none (Group C). One shared engine can't satisfy all three without normalizing them, which loses fidelity.
- **music_video.html's** 3,223 lines include `Layer`, `Story`, `Visual Presets`, `Library`, UI wiring — it's a full app, not just a paint loop.

So a config-driven refactor must respect:
- The Group A variants stay as they are functionally, but **chrome config moves to JSON**.
- The Group B/C variants are kept as-is (bespoke shaders).
- No version gets "downgraded" to a more general engine.

---

## Phased plan

### Phase 1 — Palette + audio + metadata config JSON (RECOMMENDED — ship this)

**Scope:** Each variant loads a `versions/configs/<name>.json` that holds palette, audio, title, description, data-page. A 30-line shared inline bootstrap script applies the JSON to the page.

**What changes:**
- New file per variant: `versions/configs/<name>.json` (~20 lines each).
- Tiny inline `<script>` at the top of each variant loads the JSON, applies CSS vars via `document.documentElement.style.setProperty('--bg', ...)`, sets title/meta, and stashes the audio path on `window.__swrVariant`.
- The `DEFAULT_SONG` inline value disappears; the auto-start overlay reads `window.__swrVariant.audio`.
- The inline CSS `:root { ... }` block in each variant shrinks to a small set of unchanged palette vars, or is removed entirely.
- No changes to external scripts, no changes to vite.config.js beyond adding the `versions/configs/` directory to the existing `versions/` copy-static rule.

**Files affected:**
- 23 new JSONs (`versions/configs/<name>.json`)
- 23 variant HTMLs (each gets a ~30-line bootstrap script inserted, ~6-8 CSS vars removed from `:root`)
- 1 new shared helper (`variant-config.client.js`, ~50 lines, exposed on `window.SWRVariant`)

**What's NOT touched:** paint algorithms, external scripts, audio pipeline. Variants remain visually identical.

**Risk:** Low. The bootstrap script is idempotent, fetch errors fall back to inline defaults. Each variant has the same shape so the JSON schema is uniform.

**Reversibility:** Each variant can revert by re-inlining its `:root` + `DEFAULT_SONG`. Two files to touch per variant.

**Effort:** ~1-2 hours including a verifier pass.

### Phase 2 — Per-variant shader config (NOT RECOMMENDED for first ship)

**Scope:** Pull the per-variant paint algorithm out into a shared `engine-shader.client.js` that takes a config object describing what to draw.

**What changes:**
- New shared script that knows how to draw: concentric rings, perspective grid, spectrum bars, film vignette + grain, smoke particles, neon rings, etc. Each is a "shader mode" that reads config.
- Each variant's inline paint becomes `window.SWRShader.render(ctx, audio, config)` instead of bespoke code.

**What gets lost:**
- Each variant's bespoke visual quirks — the things that make spectrum.html feel different from film.html. spectrum's specific peak-hold decay math, grid's specific horizon position, etc. — all flatten into "shader modes" with a few parameters.
- The variants become variants-in-name-only. Look-and-feel converges.

**Risk:** High. This is a creative regression. Each variant was hand-tuned.

**Recommendation:** Don't ship this unless you're willing to lose per-variant identity.

### Phase 3 — Single SPA, demote variants to stubs (BIGGER — don't ship without explicit OK)

**Scope:** Make `swr-app.html` the single entry. Each variant becomes a thin page that loads swr-app with `?variant=neon`. swr-app reads the variant config and renders.

**What changes:**
- swr-app.html gains a "single-shot mode" that takes a variant config and renders the variant's chrome + paint.
- Each variant HTML becomes ~20 lines: a redirect + config load + a minimal page shell.
- The 18 shared external scripts are deduplicated into swr-app's bundle.
- vercel.json rewrites the variants to point at the SPA with the variant slug.

**What gets lost:**
- Each variant's bespoke `<head>` / `<body>` markup (header layout, library panel, footer chrome) collapses to a single template with config-driven copies.
- The "variant is its own page" mental model breaks. URLs no longer correspond to a specific file.

**Risk:** Highest. Touches every variant, changes every URL, requires that swr-app can express every variant's chrome — which it currently can't (per-variant layouts vary).

**Recommendation:** Don't ship unless you want a fundamental product rewrite.

---

## Decision matrix

| Phase | Effort | Risk | Payoff | Reversible? |
|---|---|---|---|---|
| **1 — config JSON for chrome** | 1-2h | Low | Palette/metadata becomes data | Yes |
| **2 — shared shader module** | 1-2 days | High (visual regression) | Code dedup, but loses identity | Partial |
| **3 — single SPA** | 1-2 weeks | Very high (touches everything) | URL consolidation | No (URLs change) |

---

## What I'm NOT going to do without explicit instruction

- Touch any variant's inline paint algorithm.
- Touch any external script (engine-*.client.js, lib/*, etc.).
- Touch vite.config.js rootFiles beyond what's needed for Phase 1.
- Touch swr-app.html.
- Touch vercel.json rewrites.
- Change any URL.

---

## Recommendation

**Phase 1 only.** Ship the config-driven chrome (palette + audio + metadata) without touching algorithms. Each variant becomes a clean "chrome-from-data, paint-from-code" pattern. The data drives the metadata; the code still drives the look.

If you want to talk about Phase 2 or Phase 3 after seeing Phase 1 land, we can. But the per-variant visual identity is the product's USP — collapsing it into a single shader engine is a different project, not a refactor.