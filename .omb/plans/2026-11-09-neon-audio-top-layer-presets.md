# Plan: NEON audio-reactive top layer + few presets

**Status:** draft  
**Scope:** `versions/neon.html` / `neon.html` only (not every variant)  
**Foundation already shipped:** `client/wave-lines.client.js` (`window.SWR_WAVE_LINES`)

---

## 1. Goal

Give NEON a **dedicated audio-reactive top layer** (above the media stack and grade) with a **small, switchable preset set** — not more media layers, not reactors on `Layers.list`.

Users change the *look of the reactive overlay* in a few taps; the picture underneath stays the same.

## 2. What already exists (do not rebuild)

| Piece | Evidence | Role today |
|-------|----------|------------|
| Wave sheet module | `client/wave-lines.client.js` → `SWR_WAVE_LINES` | SVG polyline overlay, 7 presets, per-preset `audio` feature + `audioAmt` |
| Frame hook | `versions/neon.html` loop ≈L1723 | `SWR_WAVE_LINES.frame(dt, A.feat, W, H)` every rAF |
| Mount | same file script tag ≈L2241; module `mount(section.stage)` | Inserts `#swr-wave-lines` after `#render`, `z-index: 3` |
| Preset UI | `client/neon-demo-panel.client.js` ≈L989–1004 | Demo “Wave lines” grid → `setPreset(id)` |
| Gate | `scripts/check-wave-lines-unit.mjs` | Path motion + band response per preset |
| Media layers | `Layers` inline in neon | Separate stack (max 3, lock, reactors) — **orthogonal** |

**Implication:** This plan **evolves** `SWR_WAVE_LINES` into a clearer **Audio Top Layer** product surface. It does not invent a second overlay engine.

## 3. Product shape

### 3.1 One top layer, few presets

Curate **4–5 named looks** (not 7 raw wave kinds exposed as peer equals). Map from today’s presets:

| New preset id | Label | Builds on | Audio driver | Feel |
|---------------|-------|-----------|--------------|------|
| `pulse` | Pulse | current `pulse` | `bass` | Soft neon throb |
| `spike` | Spike | current `spike` | `onset` | Hit flashes |
| `scan` | Scan | current `scan` | `rms` | Horizontal energy sweep |
| `ribbon` | Ribbon | current `ribbon` | `mid` | Wide body sway |
| `off` | Off | — | — | Hide sheet (`display:none` / no paint) |

Keep Tide / Ripple / Stack as **internal** variants or fold into the four (e.g. Ripple → high-treble mode of Scan) so the UI stays “few presets.”

### 3.2 Separation rules (HARD)

1. Top layer **never** mutates `Layers.list` media, lock, or remap.
2. Top layer reads **only** `A.feat` (+ optional `A.params.sens` multiplier) — same clock as the stage.
3. Top layer draws **above** `#render` and `#fx-canvas` (keep / re-assert z-index after FX mount — already fixed once in CHANGELOG).
4. Export: decide explicitly — **include** SVG in capture (preferred for “what you see”) **or** document “preview-only.” Default plan: **include** via compositor or draw-to-canvas mirror (see §5.3).

### 3.3 Preset changing (UX)

Minimum viable controls (all call one API: `SWR_AUDIO_TOP.setPreset(id)` aliasing wave API):

1. **Demo panel** — rename section “Audio top layer”; 4–5 buttons + Off (extend existing wave grid).
2. **Keyboard** — cycle with a free key (e.g. `W` / `Shift+W`) in `engine-keys` / neon key map; avoid colliding with look filters 1–9.
3. **Persist** — `localStorage` key `swr.neon.audioTop.preset` (restore on boot).
4. Optional later: footer chip / looks-menu group — out of v1.

## 4. Technical change shape

### Phase A — Productize the existing sheet (small, shippable)

**Files**

- `client/wave-lines.client.js`  
  - Add `OFF` / `enabled` flag; `setEnabled(bool)`; `setPreset('off')`.  
  - Expose alias `window.SWR_AUDIO_TOP = SWR_WAVE_LINES` (or thin wrapper) so neon/demo speak “audio top,” not “wave lines.”  
  - Apply `A.params.sens` (or a dedicated `audioTop.sens`) to `audioAmt` so Sensitivity already on the demo panel affects the sheet.  
  - Cap curated `PRESETS_PUBLIC` (4 + off); keep full `PRESETS` for tests.
- `client/neon-demo-panel.client.js`  
  - Section title + buttons from `PRESETS_PUBLIC`; wire Off; verify controls update.
- `versions/neon.html` + `npm run neon:sync`  
  - Comment the loop call as “audio top layer”; optional `localStorage` restore after mount.
- `scripts/check-wave-lines-unit.mjs` (or rename `check-neon-audio-top-unit.mjs`)  
  - Assert Off paints nothing / hides; public preset ids stable; sens scales amplitude.

**Acceptance**

- Switching Pulse → Spike → Off → Pulse visibly changes the overlay only.
- Locked media layers untouched.
- `check:wave-lines-unit` + `check:neon-demo-panel-verify` green.

### Phase B — Stronger audio reactivity (still SVG / same host)

Without a second renderer:

1. **Multi-band mix** per preset: e.g. Pulse = `0.7*bass + 0.3*beat`, Spike = onset with short decay envelope (module-local, not damper double-call).
2. **Beat snap** option on Pulse/Spike: phase nudge on `feat.beat` rising edge.
3. **Opacity breathe** from `rms` so the sheet softens in quiet sections.
4. Optional second stroke style (dashed / glow via `filter` SVG) as a preset field — keep path math one place (`yAt` / `buildPaths`).

Still no Python in the page. Offline toolkit (`tools/python-audio-toolkit/`) stays CLI-only; optional later: “Analyze song” button → `/api` local bridge — **not** in this plan’s critical path.

### Phase C — Export parity (only if A/B look good)

Problem: `#swr-wave-lines` is DOM SVG; `Recorder` / MediaRecorder typically grab canvas.

Options (pick one in implementation):

| Option | Pros | Cons |
|--------|------|------|
| C1. Mirror paths onto `#render` after media (2D ctx strokes) when `recording` | Exact pixels in export | Duplicate draw path |
| C2. `html2canvas` / capture stream of stage element | One composition | Heavy, flaky |
| C3. Document overlay as preview-only | Cheap | Breaks “WYSIWYG” |

**Plan default: C1** behind `SWR_AUDIO_TOP.paintCanvas(ctx, feat, w, h)` called from neon’s `extraDraws` or recorder start hook.

## 5. Out of scope

- Porting Matin Python toolkit into neon.html.
- Adding a 4th media layer for reactivity.
- Automix rewriting top-layer presets every act (unless a later `swr-section-change` cue — separate plan).
- Rolling the top layer out to all 22 variants (neon-first).

## 6. Risks

| Risk | Mitigation |
|------|------------|
| FX canvas covers waves again | Keep z-index regression in unit/smoke; insert after FX mount if needed |
| Demo verify flakes on new controls | Register `audioTop:*` with same unlock/skip patterns as wave |
| Too many presets again | Hard-cap public list at 5 including Off |
| Export missing overlay | Phase C only after A ships |

## 7. Test plan

| Gate | What |
|------|------|
| `check:wave-lines-unit` (extend) | Off; sens scaling; public ids; path moves with feat |
| `check:neon-demo-panel-verify` | New buttons invoke + restore |
| Manual | Play neon demo song; cycle presets; lock a media layer; confirm only overlay changes |
| Optional smoke | Puppeteer: preset A vs B pixel sample of stage corner differs; Off matches no-SVG baseline |

## 8. Execution tasks (handoff)

1. **A1** — `wave-lines.client.js`: Off + sens + `PRESETS_PUBLIC` + `SWR_AUDIO_TOP` alias.  
2. **A2** — Demo panel rename/wire + persist preset.  
3. **A3** — neon loop comment + boot restore; `neon:sync`.  
4. **A4** — Extend unit gate; run demo verify.  
5. **B1** — Multi-band + onset decay + opacity breathe on Pulse/Spike/Scan.  
6. **C1** — Canvas mirror for record (if product wants export parity).

## 9. Success metric

On `/versions/neon`, a user can change **≤5** audio-top presets and immediately see a different reactive sheet, with media layers and locks unchanged — gated by unit + demo verify.
