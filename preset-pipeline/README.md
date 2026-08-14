# Visual Preset Pipeline

Daily generator for the Sainted Word Records self-evolving engine. Produces
**preset specs** — JSON files describing a single audio-reactive personality
(shader, palette, motion, audio-reactivity rules). The engine ingests them
on load (Phase 2) and offers them as opt-in updates.

> **Phase 1 of 5** in the self-evolving engine roadmap.
> Status: **shipped**. The pipeline generates 1-2 valid presets per run and
> the verifier confirms schema compliance end-to-end.

## Pipeline

```
inspiration seeds (7 shaders, 8 palettes, 7 motions)
   ↓
generate.py (template blender, deterministic per seed)
   ↓
presets/YYYY-MM-DD-<slug>.json      ← one file per preset
   ↓
manifest.json                       ← append-only, versioned index
   ↓
verify.mjs (swr-preset/v1 schema)   ← CI gate
   ↓
engine ingest (Phase 2)             ← PWA service worker delta
```

## Usage

```bash
# Generate 2 new presets (default), write to presets/ + manifest.json
./cron.sh

# Or directly:
python3 generate.py --count 3 --seed 20260814
node verify.mjs
```

`./cron.sh` is the canonical entry point — it generates, then verifies. Exit
code 0 = ready to ship. Non-zero = schema violation, do not push.

## Cron

```bash
# 09:00 every day, log to out/cron.log
0 9 * * *  cd /Users/kajicadjuric/Documents/daily/visual-preset-pipeline && ./cron.sh >> out/cron.log 2>&1
```

The seed defaults to `$(date +%Y%m%d)` so each day produces a different
sequence. Re-running on the same day produces the same presets (idempotent).

## Output shape

See [SCHEMA.md](./SCHEMA.md) for the full swr-preset/v1 spec. The TL;DR:

- **id** — `swr-preset-YYYY-MM-DD-<slug>`, unique
- **fx_state** — all 15 canonical keys (matches engine's `personas.js`)
- **motion** — 4 motion params
- **palette** — 4 hex colors
- **audio_reactivity** — 4 bands, names must match `fx_state`/`motion` keys
- **preview** — inline SVG thumbnail ≤ 4KB + ≤ 5 tags
- **inspiration** — 3 weighted refs (shader/palette/motion), sum ∈ [0.5, 1.0]

The output is directly compilable into the engine's persona state object
via a 20-line adapter in Phase 2.

## Phase roadmap

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | **Daily research pipeline (this)** | ✅ shipped | 7×8×7 = 392 preset combos possible per day. Currently produces 2/day. |
| 2 | Engine ingest + new-preset pill | ⏳ next | Engine fetches `manifest.json` on load, diffs against `localStorage['swr.presets.known']`, shows "N new personalities" pill with 10s preview render. |
| 3 | Self-evolution from local usage | ⏳ queued | Engine tracks persona use locally; after N uses of one, suggests a personalized variant mutated from the song's actual BPM/key. |
| 4 | PWA service worker delta | ⏳ queued | SW pre-caches `presets.json` + new GLSL chunks on update, offline-installable. |
| 5 | Verifier suite | ⏳ queued | Puppeteer E2E: new-preset diff, usage-threshold mutation, SW cache hit on the live engine. |

## Roadmap beyond v1

- **LLM novelty pass** — once v1 is running and the engine can ingest
  presets, add a daily "novelty" pass that takes the top 5 user favorites
  (anonymized) and asks the LLM to mutate one into a fresh variant.
  Same JSON output, just a more interesting inspiration blend.
- **Curated external feeds** — pull from shadertoy featured weekly,
  p5.js generative-art gallery, and a curated Vimeo music-video channel.
  Seed the inspiration pool from what's already shipping in the wild.
- **A/B voting** — engine uploads anonymized "I used preset X 4 times"
  signals. Pipeline uses those to bias the next day's seed selection.

## Files

```
visual-preset-pipeline/
├── README.md         — this file
├── SCHEMA.md         — swr-preset/v1 spec
├── generate.py       — template-based blender
├── verify.mjs        — schema verifier
├── cron.sh           — daily entry point
├── presets/          — output: YYYY-MM-DD-<slug>.json
└── manifest.json     — append-only index
```

## Inspiration seeds (current)

- **Shaders (7):** curl-noise, halftone-grid, reaction-diffusion, metaball-blob,
  ascii-rain, voronoi-cells, fractal-mandel
- **Palettes (8):** annihilation-aurora, barry-lyon-gold, dune-arrakis,
  matrix-mono, akira-red, midsommar-bloom, blade-rainbow, vapor-mono
- **Motions (7):** slow-drift-orbit, snap-pan-x, snap-pan-y, breath-scale,
  static-grid, counter-spin, lateral-drift

To add a new seed, append to the appropriate list in `generate.py`. The
verifier doesn't care about the seed catalog — it just checks output shape.
