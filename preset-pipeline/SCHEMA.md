# Visual Preset Spec — v1

A preset spec is the daily pipeline's output and the engine's input. It
describes a single audio-reactive personality — shader, palette, motion, and
the audio bands that drive each parameter.

## Compatibility target

The engine's existing `personas.js` already defines personas as state objects
with `fx`, `motion`, and a `family` string. A preset spec compiles into one
of those state objects, so the engine ingest (Phase 2) is a small adapter,
not a refactor.

## JSON shape

```json
{
  "id": "swr-preset-2026-08-14-aurora-bloom",
  "schema": "swr-preset/v1",
  "created_at": "2026-08-14T10:00:00Z",
  "name": "Aurora Bloom",
  "family": "GENERATIVE",
  "description": "Soft chromatic ribbons with bass-pumped bloom.",
  "inspiration": [
    {"kind": "shader_ref",   "name": "curl-noise", "weight": 0.4},
    {"kind": "palette_ref",  "name": "annihilation-aurora", "weight": 0.3},
    {"kind": "motion_ref",   "name": "slow-drift-orbit", "weight": 0.3}
  ],
  "fx_state": {
    "liquid": 0.40, "pearl": 0.20, "glitch": 0.08,
    "grain": 0.30, "chroma": 0.50, "bloom": 0.60,
    "vignette": 0.30, "sepia": 0.00, "glow": 0.20,
    "grayscale": 0.00, "blur": 0.10, "mut": 0.00,
    "mutAlgo": 0.00, "temp": 0.00, "posterize": 4
  },
  "motion": {
    "rotation_speed": 0.05,
    "scale_pulse": 0.10,
    "pan_x": 0.0,
    "pan_y": 0.0
  },
  "palette": {
    "primary":   "#d462a4",
    "secondary": "#4cd4d4",
    "accent":    "#d4a24c",
    "bg":        "#0a0a0c"
  },
  "audio_reactivity": {
    "bass":   ["chroma", "bloom"],
    "mid":    ["speed"],
    "treble": ["grain"],
    "onset":  ["pulse"]
  },
  "preview": {
    "thumbnail_svg": "<svg width=\"80\" height=\"80\" viewBox=\"0 0 80 80\">...</svg>",
    "tags": ["aurora", "bloom", "soft"]
  }
}
```

## Field rules

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `swr-preset-YYYY-MM-DD-<slug>`. Unique across the corpus. |
| `schema` | yes | `swr-preset/v1` for now. Bump on breaking changes. |
| `created_at` | yes | ISO 8601 UTC. |
| `name` | yes | Display name. ≤ 32 chars, capitalized. |
| `family` | yes | One of: `GENERATIVE`, `MORPHA`, `TRAIN`, `CSSFX`. |
| `description` | yes | One-line. ≤ 120 chars. |
| `inspiration` | yes | 1–5 refs. Each has `kind` and a `weight` 0..1. Weights sum ≤ 1.0. |
| `fx_state` | yes | 15 keys, each 0..1 (or `posterize` 1..16). Must include all 15. |
| `motion` | yes | `rotation_speed`, `scale_pulse`, `pan_x`, `pan_y`. All numbers. |
| `palette` | yes | 4 hex colors. `primary` and `secondary` required. |
| `audio_reactivity` | yes | 4 lists. Names must match the keys in `fx_state` or `motion`. |
| `preview` | yes | `thumbnail_svg` ≤ 4KB inline SVG. `tags` 1..5 lowercase strings. |

## Validation (run on every output)

A preset is **publishable** iff:

- All required fields present
- All `fx_state` keys in the canonical 15
- All `palette` values are valid 6-digit hex
- All `audio_reactivity` names match an `fx_state` or `motion` key
- `thumbnail_svg` is a valid SVG (one `<svg>` root, ≤ 4KB)
- `inspiration` weights sum to ≤ 1.0 (and ≥ 0.5 so it's a meaningful blend)
- `id` matches the regex `^swr-preset-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`
- `created_at` is a valid ISO 8601 string

The pipeline refuses to publish a preset that fails any of these. Verifier
script in `verify.mjs` re-runs the same checks against the live `manifest.json`.

## Why this shape

- **Backwards compatible with `personas.js`** — Phase 2 ingest is a 20-line adapter
- **LLM-friendly** — every field is a flat string or number, no nested objects
  with arbitrary shape, so a model can produce one in a single JSON response
- **Self-contained** — the SVG thumbnail means the engine doesn't need a
  separate asset CDN
- **Versioned** — `schema` lets the engine refuse presets it doesn't understand
