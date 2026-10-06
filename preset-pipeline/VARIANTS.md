# Preset Variants: Clean vs Artistic

Inspired by Lightroom filter design — every preset has two render variants that share the same color identity but differ in texture, contrast, grain, and grading strength.

## Naming Structure

For every preset, create two variants:

- **PresetName — Clean** (high-end, commercial, sharp)
- **PresetName — Film** (artistic, moody, grainy)

Example:
- `aurora-bloom — Clean`
- `aurora-bloom — Film`

## Shared Base

Every preset starts with a shared base that defines its **color identity**:

```js
{
  id: "aurora-bloom",
  family: "GENERATIVE",
  // Color identity (shared between Clean and Film)
  base: {
    temperature: "warm",      // warm | cool | neutral
    tint: 0,                  // -10 to +10
    hueShift: {
      shadows: 210,           // teal shadows
      highlights: 40           // amber highlights
    },
    skinTone: "preserve",     // preserve | warm | cool
    palette: {
      primary: "#d462a4",      // main accent
      secondary: "#4cd4d4",  // complementary
      accent: "#d4a24c",      // pop color
      bg: "#0a0a0c"          // background
    }
  },
  // ... variants below
}
```

## Variant A — Clean / High-End

Use for sharp, premium, commercial, natural-looking results.

| Control | SWR fx_state | Range |
|---------|--------------|-------|
| Contrast | `contrast` (via glow) | 0.8–1.0 |
| Sharpening | `pearl` + `liquid` | 0.2–0.4 |
| Texture | `pearl` | 0.2–0.5 |
| Clarity | `liquid` | 0.1–0.3 |
| Grain | `grain` | 0 |
| Vignette | `vignette` | 0.1–0.2 |
| Saturation | `mut: 0` | minimal |
| Color grade | subtle hue shifts | minimal |

**Checklist:**
- No grain
- High sharpening on edges
- Vibrant but not oversaturated
- Clean blacks (not lifted)
- Subtle vignette

## Variant B — Artistic / Film

Use for mood, character, film emulation, editorial, or social content.

| Control | SWR fx_state | Range |
|---------|--------------|-------|
| Contrast | `contrast` (via glow) | 0.6–0.9 |
| Sharpening | `pearl` + `liquid` | 0–0.2 |
| Texture | `pearl` | 0–0.2 |
| Clarity | `liquid` | 0–0.1 (negative = softness) |
| Grain | `grain` | 0.15–0.35 |
| Vignette | `vignette` | 0.2–0.4 |
| Fade | `posterize` + `temp` | lifted blacks |
| Color grade | stronger splits | teal/orange or amber |

**Checklist:**
- Visible grain (15–35%)
- Lifted/faded blacks
- Lower clarity for softness
- Stronger split toning
- Vignette for focus

## Mapping to SWR fx_state

```js
// Clean variant
{
  temp: 0,           // neutral temperature
  mut: 0,            // no desaturation
  mutAlgo: 0,
  posterize: 0,       // no fade
  vignette: 0.15,    // subtle
  chroma: 0.3,
  grain: 0,           // no grain
  sepia: 0,
  glow: 0.4,         // subtle glow = contrast
  grayscale: 0,
  blur: 0,
  liquid: 0.2,        // slight texture
  pearl: 0.3,         // sharpening
  glitch: 0
}

// Artistic variant  
{
  temp: 0.05,        // slight warm
  mut: 0.1,         // slight desat
  mutAlgo: 0,
  posterize: 0.1,    // slight fade
  vignette: 0.3,     // stronger
  chroma: 0.5,
  grain: 0.25,       // visible grain
  sepia: 0.08,       // warm tint
  glow: 0.2,
  grayscale: 0,
  blur: 0,
  liquid: 0.1,       // softer
  pearl: 0.1,        // less sharpening
  glitch: 0.05       // subtle
}
```

## Per-Filter Example: Aurora Bloom

**Shared base:**
- Temperature: warm
- Hue: teal shadows, amber highlights
- Primary: pink/magenta

| Control | Clean | Film |
|---------|-------|------|
| liquid | 0.25 | 0.1 |
| pearl | 0.35 | 0.1 |
| grain | 0 | 0.25 |
| vignette | 0.15 | 0.3 |
| chroma | 0.3 | 0.5 |
| sepia | 0 | 0.1 |
| glow | 0.45 | 0.2 |
| posterize | 0 | 0.15 |

## Implementation

Add variants to preset generation:

```python
def generate_with_variants(base_preset):
    clean = apply_variant(base_preset, "clean")
    film = apply_variant(base_preset, "artistic")
    return [clean, film]
```

Where `apply_variant` maps the generic settings to Clean or Film ranges.

## Future: VSCO-Style App

If building a filter app similar to VSCO, structure the config as:

```js
{
  id: "portrait-01",
  base: {
    temperature: 0.1,
    tint: 0.02,
    hueShift: { shadows: 200, highlights: 40 }
  },
  clean: {
    contrast: 1.08,
    saturation: 1.02,
    sharpness: 0.4,
    grain: 0,
    vignette: 0.05
  },
  artistic: {
    contrast: 0.92,
    saturation: 0.9,
    sharpness: 0.15,
    grain: 0.25,
    vignette: 0.18,
    fade: 0.15
  }
}
```
