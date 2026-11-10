# Plan: Animation FX menu (temporal / overlay / type) on the WebGL FX pipeline

## Governing decisions

1. **Recorded path stays WebGL.** Anything that must appear in export lands in `fx-postprocess.js` (or a GLSL chunk it loads). CSS `video-fx.css` / `#stage` filters stay preview-only (`engine.html` captures `FX.outputCanvas`).
2. **Do not invent a 12th+ `mutAlgo` for this menu.** `mutAlgo` 0–5 remain UV mutations; 6–11 remain mask illusions. New work is a parallel **Anim compositor** with at most **three continuous slots**: `base` · `accent` · `beatEvent`.
3. **Reuse existing audio.** Drive from `Audio.feat` + `Audio.fft` / `Audio.time` already filled by one `AnalyserNode` (`lib/audio.client.js`). No second onset detector; no second analyser.
4. **Rule of three is enforced in state, not by hope.** `FX.setAnim({ base, accent, beat })` rejects a fourth continuous id; beat-events may fire as one-shots without counting as a fourth continuous slot.
5. **`fx-postprocess.js` is already ~1074 lines.** New GLSL lives in `lib/fx-anim.glsl.js` (string export) and is concatenated into `FRAG_SOURCE`; JS control lives in `lib/fx-anim.client.js` (`window.SWR_FX_ANIM`). Do not keep growing the monolith.
6. **Sequence after / beside mask beat-drive.** Optional `maskBeat` (bands / beat×band) is orthogonal and lands on `u_maskBeat` inside the mask branch — not as an Anim slot. Prefer shipping mask beat-drive first or in the same PR train so Develop/Bloom stay coherent.
7. **Moiré and invert-flash require opt-out.** Wire through `SWR_MOTION_KILL` + `prefers-reduced-motion`; default moiré off.

Non-goals for v1: reaction-diffusion (1.4), painterly LIC (7.3), full multi-pass bloom FBO chain as a blocking dependency (upgrade `u_glow` later), SVG/CSS-only “masks”.

## Inventory vs menu (reuse first)

| Menu item | Existing seam | Plan action |
|-----------|---------------|-------------|
| Vortex (4.2) | `mutAlgo` 0 + `u_vortexEnabled` (`fx-postprocess.js` mutate branch; kill switch default off) | Expose as Anim **base** id that sets `mutAlgo:0` only when vortex allowed; else no-op |
| Bloom (3.1) | Cheap 4-tap `u_glow` | Phase A: use glow as stand-in; Phase D: optional bright-pass FBO upgrade |
| Chromatic flash (8.1) | Continuous `u_chroma` | New beat-gated one-shot on chroma offset |
| Vignette inhale (8.3) | `u_vignette` + mid | Beat/bass modulation wrapper |
| Masks 6–11 | `maskIllusion` | Stay; Anim stack **composites with** masks, does not replace them |
| Spectrum / waveform | `Audio.fft` / `Audio.time` | New GPU textures; not yet uploaded |
| Type | `versions/typography.html` only (page art) | New canvas→texture atlas for FX |
| Echo / history | none (no FBO) | New ping-pong / ring later phases |

## Architecture shape

```text
Layers → #render → [optional history/ping-pong] → FRAG (grade + mask + anim) → #fx-canvas → recorder
                         ↑
              Audio.feat scalars + optional spectrum/waveform/text textures
```

**Anim state (new):**

```js
// window.FX.state.anim — continuous slots only
{
  base:  null | { id: 'lensPulse'|'curlNoise'|..., amt: 0..1 },
  accent: null | { id: 'waveform'|'spectrumBars'|..., amt: 0..1 },
  beat:  null | { id: 'chromaFlash'|'zoomPunch'|..., amt: 0..1 },
}
```

Shader selects with integer uniforms `u_animBase`, `u_animAccent`, `u_animBeat` + amounts. Beat-events that are one-shots can also be driven by a short `u_flash` envelope written from JS when `feat.beatPulse` rises (no history required).

---

## CU-1: Anim compositor + single-pass beat kit (Phase A)

**Outcome:** Demo / personas can set one base + one accent + one beat-event; export shows them; a fourth continuous assign is refused.

**Current evidence** — `fx-postprocess.js:268-280` (`main` UV/mask branch), `::PERSONA_KEYS` (~510), audio pull `::render` (~839-845), capture `engine.html` (`FX.outputCanvas`).

**Implementation shape:**
- Create `lib/fx-anim.glsl.js` exporting `ANIM_GLSL` (ids 1..N for Phase A only).
- Create `lib/fx-anim.client.js` → `window.SWR_FX_ANIM` with `list()`, `setSlot(slot, id, amt)`, `clear()`, `applyCombo(comboId)`.
- Modify `fx-postprocess.js` to append `ANIM_GLSL` into `FRAG_SOURCE`, add uniforms, apply after grade / after mask blend (order: mutate → grade → mask → **anim** → fade).
- Persist `swr.fx.anim` JSON; include in `setPersona` only via explicit `anim` key (do not smash into every grade persona).
- Wire `SWR_MOTION_KILL`: when motion killed, zero `u_animBase/Accent` ids that are UV-warps; allow static accents optionally.

**Phase A effect ids (shader-only, no FBO):**

| Slot role | Ids |
|-----------|-----|
| base | `lensPulse`, `curlNoise`, `pixelate`, `dihedral`, `pointRipple` |
| accent | *(none yet — wait for spectrum tex)* OR reuse `glowBoost` (amt→`u_glow`) |
| beat | `chromaFlash`, `invertFlash`, `vignetteInhale`, `zoomPunch`, `strobeHold` |

`strobeHold` / beat-freeze v1: on `beatPulse`, skip `texImage2D` updates for N ms (freeze last GPU texture) + optional white flash — **no history buffer**.

**Tests** — extend / add:
1. `scripts/check-fx-anim-unit.mjs` — `setSlot` fourth continuous → reject; clear restores; vortex base respects motion kill.
2. `verify-mask-illusions.mjs` still green (masks unchanged when anim null).
3. Headless: with `u_beat=1` and `chromaFlash`, R/B sample offset differs from `u_beat=0`.

Commands: `node scripts/check-fx-anim-unit.mjs`; `npm run check:mask-illusions`; wire `check:fx-anim-unit` into `scripts/run-steps.mjs` `check` group.

---

## CU-2: Spectrum + waveform textures (Phase B)

**Outcome:** Waveform line, spectrum bars, and radial spectrum ring run as Anim **accent** ids using the existing analyser buffers.

**Current evidence** — `lib/audio.client.js` fills `this.fft` / `this.time` in `sample()` (~869-870); FX today only copies scalars (~841-845).

**Implementation shape:**
- Each FX frame (throttled ok): upload 1×N `u_spectrum` and 1×M `u_waveform` `LUMINANCE` textures from `Audio.fft` / `Audio.time`.
- Accents: `waveformLine`, `spectrumBars`, `spectrumRing`.
- Cap texture upload cost under adaptive guard (skip upload when accent slot empty).

**Tests:**
1. Unit: with fake fft ramp, bars mask leaves bottom black / top open for a mid column.
2. Smoke on `dist/engine`: with audio playing + accent `spectrumBars`, `#fx-canvas` pixel variance > threshold.

---

## CU-3: Typographic masks (Phase C) — brand

**Outcome:** Word reveal + beat highlight on recorded canvas; letter-grid optional follow-up in same phase if atlas ships.

**Current evidence** — no FX text atlas; typography lives on `versions/typography.html` as its own draw path.

**Implementation shape:**
- `lib/fx-text-atlas.client.js`: `bake(word, {size})` → canvas → WebGL texture `u_textMask`.
- Accents / bases: `typeReveal`, `wordBeat`; later `letterGrid` needs glyph atlas sheet.
- Personas: `typeSainted`, `typeCustom` with default word from `site-map` / brand string.
- Demo + engine: text field next to Anim menu (“SAINTED”).

**Tests:** baked texture non-empty; with `typeReveal`, center luminance differs when mask tex is white vs black.

---

## CU-4: Ping-pong echo trail (Phase D)

**Outcome:** Moving subjects leave bass-scaled ghost trails in the recorded frame.

**Current evidence** — single `texImage2D` from `#render`; no `createFramebuffer` in `fx-postprocess.js`.

**Implementation shape:**
- Two FBOs + textures; after main pass, copy output → `u_prev` for next frame.
- Accent/base id `echoTrail`: `mix(col, prev, decay * bass)`.
- Disable under motion-kill / reduced-motion (vestibular).
- Soft-gate GPU memory via adaptive-guard.

**Tests:** synthetic moving bar across frames → trail residual with echo on, none with echo off.

---

## CU-5: History ring + slit-scan (Phase E, optional)

**Outcome:** Horizontal time displacement (1.3) using 4-frame history.

Defer until D is stable. Beat-freeze already covered in A via upload hold.

---

## CU-6: Product wiring — keys, demo, personas, docs

**Outcome:** Operators can pick combos without editing GLSL.

**Implementation shape:**
- `personas.js`: six combo personas matching the shipping table (below), each setting `anim` + optional mask/`mutAlgo`.
- `client/look-filter-cycler.client.js`: do **not** burn digit slots 0–9; expose combos under persona select + Neon Demo “Anim FX” section (parallel to Look filters).
- `engine-keys.client.js`: optional `T,T,Shift+1..6` **or** a dedicated `A` arm + digit for anim combos — decide at implement time; do not collide with mask `T,T,1..6`.
- `client/neon-demo-panel.client.js`: section “Anim FX” with Base / Accent / Beat grids + combo presets; register `data-demo-anim-*` for verify.
- `docs/MASK-ILLUSIONS.md` sibling `docs/ANIM-FX.md`; AGENTS.md one-liner on `SWR_FX_ANIM` + rule of three.
- `check:doc-truth` / `check:fx-doc-drift` updates.

**Recommended combo personas (from menu):**

| Persona key | Base | Accent | Beat | Feel |
|-------------|------|--------|------|------|
| `animMvPortrait` | lensPulse | waveformLine | chromaFlash | Music-video portrait |
| `animBigRoom` | glowBoost | spectrumBars | vignetteInhale | Big-room |
| `animOrganic` | curlNoise | *(mask Fringe or chroma)* | zoomPunch | Organic |
| `animBrand` | comicInk* | typeReveal | invertFlash | Brand-loud |
| `animHypnotic` | dihedral | *(moire opt-in)* | zoomPunch | Symmetric |
| `animLoFi` | pixelate | waveformLine | strobeHold | Arcade |

\* `comicInk` = Phase A+ Sobel (8 taps) — ship as base id in A if budget allows; else Phase B.

---

## Deferred / avoid

| Item | Reason |
|------|--------|
| Reaction-diffusion (1.4) | Dual FBO + expensive; after echo |
| Painterly LIC (7.3) | Cost + noise tex; not in first three phases |
| True 2-pass bloom (3.1 full) | Upgrade path on `u_glow`; not blocking |
| Moiré without opt-out | Nausea; default off + motion-kill |
| Stacking >3 continuous | Product rule; enforce in `setSlot` |
| CSS-only beat masks | Breaks record path |
| Seventh mask algo | Rejected; use Anim + `maskBeat` |

---

## Execution Structure

| # | Task | Domain | Depends | Verify |
|---|------|--------|---------|--------|
| 1 | Extract `lib/fx-anim.glsl.js` + empty `SWR_FX_ANIM` API; wire uniforms with all ids=0 (no visual change) | ui / engine | — | `check:fx-fallback-unit`; `check:mask-illusions` |
| 2 | Implement Phase A bases + beat-events; enforce 3-slot cap; motion-kill hooks | ui / engine | 1 | `check:fx-anim-unit` (new) |
| 3 | Neon Demo + persona combos for Phase A–only (accents = glowBoost) | ui | 2 | Demo invoke + headless pixel check |
| 4 | Upload spectrum/waveform textures; accents waveform/spectrum/ring | ui / engine | 2 | unit + engine smoke |
| 5 | Text atlas + typeReveal / wordBeat; brand persona | ui / brand | 2 | atlas + mask pixel tests |
| 6 | Ping-pong echoTrail | ui / engine | 2 | trail residual test |
| 7 | Docs (`docs/ANIM-FX.md`), AGENTS blurb, `check:fx-doc-drift`, changelog | docs | 3+ | `check:doc-truth` / drift gate |
| 8 | (Optional) history slit-scan; bloom FBO upgrade; RD / LIC | ui | 6 | separate plan amendment |

First end-to-end slice = **Task 1→2→3**: lensPulse + chromaFlash on a still with audio, visible in `#fx-canvas` and in a short record.

---

## Risks

- **File size / shader compile time:** keep Phase A GLSL under a measured budget (mirror mask 3 KB soft cap per family); fail `check:fx-anim-unit` if minified anim block > 4 KB without justification.
- **Vortex double-bind:** Anim must not fight `SWR_MOTION_KILL.coerceMutAlgo`.
- **Automix `_fxOverride`:** decide whether anim slots are automix-writable (default: **no** in v1 — grade only).
- **Mobile GPU:** echo + spectrum upload behind adaptive-guard; default anim off on low tier if needed.

## Proof commands (repo-valid today + new)

```bash
npm run check:fx-fallback-unit
npm run check:mask-illusions
npm run check:fx-doc-drift
npm run check:no-rotate-zoom
node scripts/check-fx-anim-unit.mjs   # after Task 1–2
```
