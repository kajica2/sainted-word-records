# Mask Illusions for Sainted Word Records

**Scope:** Beat-driven mask illusions for photographs and footage in the Sainted Word Records engine.
**Primary path:** extend the existing WebGL post-process shader (`fx-postprocess.js`) and the existing persona registry (`personas.js`).
**Secondary path:** SVG filter definitions through the engine’s CSS-filter stack (optional; not shipped yet).

The engine already renders to canvas and exposes `u_bass`, `u_mid`, `u_treble`, and `u_beat` to the fragment shader. Mask illusions reuse those uniforms.

## Photograph = layer → `#render` → `#fx-canvas`

A photograph is a clip or still inside a layer. Layers composite to `#render`, then `fx-postprocess.js` reads that canvas as a texture and writes to `#fx-canvas`. Effects that must appear in the recorded video are GLSL mask algorithms in `fx-postprocess.js` (`mutAlgo` 6–11).

## Algorithms

| Algo | Label | Driver |
|------|-------|--------|
| 6 | Develop | `u_bass` threshold dissolve |
| 7 | Bloom | gooey blobs (`u_bass` size, `u_treble` pops) |
| 8 | Ribbed | slit ripple (`u_mid`) |
| 9 | Fringe | chromatic band (`u_mid`) |
| 10 | Print | halftone dissolve (`u_treble`) |
| 11 | Wedge | kaleidoscope mask (`u_mid` / `u_treble`) |

## Personas

Six entries under `// ---- MASK ILLUSIONS ----` in `personas.js`: `maskThreshold`, `maskGooey`, `maskSlit`, `maskChromaBand`, `maskHalftone`, `maskKaleido`.

## Keyboard

Look-filter slots 0–9 stay on a single `T` + digit. Mask illusions are cycler slots 10–15:

| Chord | Effect |
|-------|--------|
| `T`, `T`, `1` | Develop |
| `T`, `T`, `2` | Bloom |
| `T`, `T`, `3` | Ribbed |
| `T`, `T`, `4` | Fringe |
| `T`, `T`, `5` | Print |
| `T`, `T`, `6` | Wedge |

Bare digits were not remapped: slots 0–9 already own those keys.

## Files

| File | Role |
|------|------|
| `fx-postprocess.js` | `maskIllusion` / `maskColor`, `mutAlgo` 6–11 |
| `personas.js` | MASK persona family |
| `client/look-filter-cycler.client.js` | slots 10–15 |
| `engine-keys.client.js` | `T,T,1..6` |
| `lib/mask-illusions.client.js` | `window.MaskIllusions` |
| `verify-mask-illusions.mjs` | gate (`npm run check:mask-illusions`) |

## Product copy

- Section: **Mask illusions**
- Hint: **A moving mask, not a new image. Bass, mid, and treble reveal different parts.**
- Empty: **Add a still or clip to use mask illusions.**

## Verify

```bash
npm run check:mask-illusions
# or
node verify-mask-illusions.mjs
```
