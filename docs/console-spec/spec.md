# Console — Design Spec

The visual language for `/dashboard`, made to sit alongside Neon, Film, Grid, Spectrum, Aurora, Smoke, Hallucination, Collage, Typography.

## The one-liner

> **Console** — a precision oscilloscope aesthetic for audio-reactive video.
> Black canvas, single accent, geometric primitives, persistent data overlay.

## Why this name

The existing version names are all **single evocative words** for a visual phenomenon or art movement. "Console" fits the pattern and signals the aesthetic: **pro audio / control room / oscilloscope** — Teenage Engineering OP-1, Ableton, a modular synth panel. Not a club VJ, not a film grain, not an art print.

Pair it with **IDM, experimental, industrial, modular synth, glitch** — the genres where "the visualizer looks like an instrument" is the whole point.

## The rules

These are non-negotiable. Break one and it's not Console anymore.

| Rule | Why |
|---|---|
| One accent color only | "Signal" — like a real oscilloscope trace. Use the orange `#FF6B1A` everywhere. No secondary hue. |
| Pure black background | `#0A0A0B`, never anything else. No gradients, no atmospheric haze. |
| Geometric primitives only | Lines, dots, grids, bars, sine waves, rectangles. No particles, no glow, no film grain, no chromatic aberration. |
| Mono numerics on canvas | `JetBrains Mono`, 11–14px, in the accent color. Tiny numbers tick next to reacting elements. |
| BPM + KEY + WAVEFORM always visible | The data IS the design. Hide them and the language collapses. |
| Beat response = single hard flash | One full-frame orange flash on each kick, 50ms in, 150ms decay. No bloom, no smear. |
| Max 3 layers visible | 1 hero element + 1 waveform + 1 number overlay. Restraint is the point. |
| No atmospheric effects | No fog, no dust, no "energy". The canvas is a control surface, not a mood. |

## Color tokens (pull into the engine's CSS root)

```css
:root {
  /* — surface — */
  --bg:           #0A0A0B;  /* canvas + page */
  --bg-panel:     #111114;  /* sidebars */
  --bg-panel-2:   #16161B;  /* nested surface */
  --bg-elev:      #1C1C22;  /* hovered control */
  --line:         #232328;  /* 1px divider */
  --line-strong:  #2E2E36;  /* emphasized divider */

  /* — text — */
  --fg:        #E5E5E7;
  --fg-mute:   #8A8A92;
  --fg-faint:  #5A5A62;

  /* — signal — */
  --signal:      #FF6B1A;   /* THE accent */
  --signal-soft: #FF6B1A33; /* 20% — fills */
  --signal-line: #FF6B1A14; /*  8% — grid */
  --signal-glow: #FF6B1A08; /*  3% — halos */
  --warn:        #FFD600;
  --error:       #FF3355;
  --ok:          #34D399;

  /* — type — */
  --f-ui:   'Inter', system-ui, sans-serif;
  --f-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

The shader reads these at boot:

```js
const cs = getComputedStyle(document.documentElement);
u_signal = hexToVec3(cs.getPropertyValue('--signal')); // 1.0, 0.42, 0.10
u_bg     = hexToVec3(cs.getPropertyValue('--bg'));     // 0.04, 0.04, 0.04
```

## Type system

| Use | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| UI body | Inter | 13–14px | 400–500 | 0 |
| UI label | Inter | 10–11px | 600 | 0.12em, uppercase |
| Data / numbers | JetBrains Mono | 11px | 500 | 0 |
| HUD on canvas | JetBrains Mono | 11px | 500 | 0.04em |
| Big numbers | JetBrains Mono | 24px | 700 | -0.02em |

Two families, no more. Adding a third (serif, etc.) breaks the precision.

## The new nav — version selector

Replace the current `Engine / Enhance / Photo / Transitions / More ▾` tab bar with a **version selector pill**. This makes `/dashboard` (or any other version) feel like one option among many, not a multi-tool hub.

```
┌─────────────────────────────────────────────────────────────────────┐
│ SW SAINTED  │ Neon │ Film │ Grid │ Spectrum │ Aurora │ │ Console ● │ ▶ 0:21 ... │
│ WORD REC.   │                                                       │   ← Back │
└─────────────────────────────────────────────────────────────────────┘
```

Active version gets the orange dot prefix. The separator before "Console" is intentional — it's the "new / experimental" track. Future versions land there before graduating to the main row.

### Why a selector, not tabs

- The **page is a version**, not a tool. Tabs imply "I'm in the engine, switching views." A selector implies "I'm picking a version of the engine."
- Users can deep-link to `/dashboard?from=neon` and the selector stays accurate.
- New versions are additive — drop a `<a>` in. No multi-tool UX to redesign.

## Layer vocabulary (renamed)

The current `/dashboard` layers are film/photo vocabulary: `SHARED, AURA, GRAIN, HALO, MARKER`. That doesn't match the precision aesthetic. Rename to:

| Old | New | What it does |
|---|---|---|
| SHARED | **WAVEFORM** | Hero time-domain signal |
| AURA | **SPECTRUM** | Frequency-domain bar array |
| GRAIN | **LFO** | Low-frequency oscillator (modulator) |
| HALO | **KEY** | Pitch-class / scale overlay |
| MARKER | **METER** | Peak/RMS level readout |

This vocabulary is **musical**, **technical**, and matches what audio engineers actually call these things. It tells the user: this is an instrument, not a graphics toy.

## Library asset names (renamed)

Same logic for the 8 thumbnails. Replace `Crystal, Drift, Glow, Halo, Lattice, Mist, Neon, Pulse` with **geometric primitives**:

`Wave · Grid · Bar · Dot · Line · Frame · Trace · LFO`

Each renders as a tiny SVG showing exactly what it is. No mystery — the name matches the visual.

## Empty state

Currently the empty stage shows a music note icon with "DROP AUDIO · OR CLICK TO BROWSE." Replace with:

- A static rendering of the **Console hero** (a sine wave + spectrum bars + corner ticks + BPM/K HUDs).
- A single CTA: **"Drop a song — or pick from the library"**.
- A **"Try a 30-second sample"** button that loads a bundled track so the user sees motion within 1 second.

The current "music note icon" feels like every other generic editor. The Console empty state should feel like switching on an oscilloscope and seeing a clean baseline trace waiting for input.

## Files in this delivery

| File | Purpose |
|---|---|
| `/workspace/hunt-workspace/console.html` | Full working prototype. Open in browser to see the editor, version-selector nav, and live canvas demo. |
| `/workspace/hunt-workspace/console-shader.glsl` | Drop-in GLSL fragment shader for the canvas output. |
| `/workspace/hunt-workspace/console-spec.md` | This document. |

## How to integrate

1. **Copy the CSS variables** from `console.html` into the engine's root stylesheet. Rename to fit your naming (`--bg-1` etc.).
2. **Replace the top nav** in `/engine` (and any future `/versions/*`) with the `.versions` component from `console.html`. The active version gets `aria-current="page"` and the orange dot.
3. **Drop `console-shader.glsl` into your shader pipeline** as the "console" variant. Bind `u_signal` and `u_bg` from CSS variables at boot.
4. **Rename the layers + library assets** in the engine data model. If layers are stored as `grain/halo/...` in a JSON manifest, add a `displayName` field and ship Console's mapping first.
5. **Add a "Console" card** to the home page "5 visual languages" grid (replace Smoke or Hallucination — both currently 404).
6. **Fix `/versions/neon` etc.** so they don't 404. Either render the same editor with swapped CSS vars and shader, or accept `?v=neon` as a query param.

## Acceptance criteria

- [ ] Top nav shows all 6 named versions, with Console as the current page (orange dot).
- [ ] Canvas uses the orange `#FF6B1A` accent on pure black. No other colors on the canvas itself.
- [ ] BPM, KEY, and waveform visible at all times — even with no audio loaded.
- [ ] Beat response is a single hard flash, not a bloom or smear.
- [ ] Empty state shows a static Console rendering, not a generic music note icon.
- [ ] Library cards are named `Wave / Grid / Bar / Dot / Line / Frame / Trace / LFO` (or whatever you choose), matching the geometric aesthetic.
- [ ] Layer types renamed to `Waveform / Spectrum / LFO / Key / Meter`.
- [ ] Mobile: stage takes full viewport, sidebars become bottom-sheet drawers.
- [ ] `prefers-reduced-motion` opts out of the canvas animations.
- [ ] Focus rings designed (orange, 2px, 2px offset), not browser default.
