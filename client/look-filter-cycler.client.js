// client/look-filter-cycler.client.js — Tint + variant look cycler.
//
// Ten filter presets over the FX uniform vocabulary. Applied through
// FX.setPersona(), which writes state only — the intensity multiplier
// k still applies at the render/uniform boundary (fx-postprocess.js),
// so dragging intensity down is an exact restore for every filter
// here. Slot 0 is a true reset (zeros every FX state field) rather
// than intensity 0; intensity 0 hides the effect but leaves stale
// values that the next persona, automix, or LFO would inherit.
//
// Trap fixes applied during authoring:
//   TRAP 1: sepia overrides other tints (fx-postprocess.js:47), so no
//           sepia look sets temp/tone/glow. Sepia looks commit or don't.
//   TRAP 2: temp is SIGNED (-1 cold .. +1 warm). Every other param
//           is 0..1. Schema guard at the bottom asserts on author.
//   TRAP 3: cinematic already does vignette+tone internally
//           (fx-postprocess.js:57), so no filter sets cinematic AND
//           vignette/tone together.
//   TRAP 4: tone is now in the automix blend fxFields list
//           (fx-postprocess.js:640) so tone-based filters CAN be
//           blended over by an automix preset.
//   TRAP 5: mutAlgo is unscaled by intensity (fx-postprocess.js:680),
//           so a look that selects an algorithm also sets mut, or an
//           LFO can't activate it later.
//   TRAP 6: liquid carries a SWR_LIFE coupling (fx-postprocess.js:694-
//           703). Use mut + mutAlgo: 2 (liquid warp) instead —
//           deterministic, same shader path.

(() => {
  if (window.SWR_LOOK_FILTER_CYCLER) return;

  // Every key FX state carries. Slot 0 must zero ALL of them — setting
  // intensity to 0 is not a reset (intensity 0 hides the effect but
  // leaves the values in state, so the next persona/automix/LFO would
  // inherit whatever was last set).
  const ALL = [
    'temp', 'mut', 'mutAlgo', 'posterize', 'vignette', 'chroma',
    'grain', 'sepia', 'glow', 'grayscale', 'tone', 'blur',
    'liquid', 'pearl', 'glitch', 'sharp', 'cinematic'
  ];

  // T+0..9. fx shape is consumed verbatim by FX.setPersona().
  const FILTERS = [
    { id: 0, label: '— none —',        fx: {} },                              // reset only
    { id: 1, label: 'soft',            fx: { grayscale: 0.22, temp: -0.18, tone: 0.15 } },
    // Old cinema (polished). Sepia MUST commit — no temp/tone/glow per Trap 1.
    { id: 2, label: 'old cinema',      fx: { sepia: 0.42, grain: 0.30, vignette: 0.45, blur: 0.12 } },
    // Cinematic tone ramp (slots 3-7). Each carries its own (temp, tone).
    // Slot 7 is mono: sepia + grain + grayscale, no temp/tone (Trap 1).
    { id: 3, label: 'cinema · cool',   fx: { temp: -0.55, tone: 0.35, vignette: 0.30 } },
    { id: 4, label: 'cinema · teal',   fx: { temp: -0.30, tone: 0.45, vignette: 0.25 } },
    { id: 5, label: 'cinema · amber',  fx: { temp:  0.48, tone: 0.25, glow: 0.20 } },
    { id: 6, label: 'cinema · rose',   fx: { temp:  0.22, tone: 0.30, glow: 0.15 } },
    { id: 7, label: 'cinema · mono',   fx: { sepia: 0, grayscale: 1.0, grain: 0.35, vignette: 0.35 } },
    // Slot 8: warm void — soft focus + warm desat.
    { id: 8, label: 'void warm',       fx: { grayscale: 0.70, temp: 0.60, vignette: 0.55, grain: 0.20, blur: 0.08 } },
    // Slot 9: echo. mut + mutAlgo: 2 = liquid warp (Trap 6). "echo-manifold"
    // is the /versions/echo-manifold.html page (applied via the looks
    // menu, not the FX filter table); the filter is its FX twin.
    { id: 9, label: 'echo',            fx: { temp: -0.40, tone: 0.70, pearl: 0.28, mut: 0.18, mutAlgo: 2 } },
  ];

  // Schema guard for Trap 2 + Trap 5. Catches "all-positive temp" slips
  // at author time rather than as a warm-looking "cool" filter in
  // production. Console warn only — does not block.
  for (const f of FILTERS) {
    for (const k in f.fx) {
      if (ALL.indexOf(k) < 0) {
        console.warn('[look-filter] filter ' + f.id + ' sets unknown param:', k);
      }
      const v = f.fx[k];
      if (k === 'temp') {
        if (!(v >= -1 && v <= 1)) console.warn('[look-filter] filter ' + f.id + ' temp out of -1..1:', v);
      } else if (k === 'mutAlgo') {
        if (!Number.isInteger(v) || v < 0 || v > 5) console.warn('[look-filter] filter ' + f.id + ' bad mutAlgo:', v);
      } else if (!(v >= 0 && v <= 1)) {
        console.warn('[look-filter] filter ' + f.id + ' ' + k + ' out of 0..1:', v);
      }
    }
  }

  // True reset. FX.setPersona({}) is a no-op by construction: every key
  // is guarded by `if (profile.X !== undefined)`, so an empty profile
  // writes nothing. We must send every key explicitly to actually zero
  // state. Temp's 0 is neutral.
  function reset() {
    const p = {};
    for (const k of ALL) p[k] = 0;
    if (window.FX && typeof window.FX.setPersona === 'function') {
      window.FX.setPersona(p);
    }
    return p;
  }

  // Intensity ramps. Press the SAME number key repeatedly and the active
  // filter's effect scales through these values, then wraps. Different
  // numbers reset the ramp. Each ramp is per-slot so the user can leave
  // one filter at "barely there" and another at "all the way" without
  // them interfering.
  //
  // Order is intentionally monotonic — the first press is gentle, the
  // last is full-strength — so users get a clear "more please" gesture
  // without thinking about it. Cycling past the final step wraps to 0,
  // letting T+1 (×5) + T+1 (×6) act as off.
  const INTENSITY_RAMP = [0.30, 0.55, 0.80, 1.00, 0.00]; // 0.00 = off
  let current = 0;
  let intensityStep = 0; // index into INTENSITY_RAMP per active slot

  // Apply a filter. Behavior:
  //   n === 0       → clear (always)
  //   n === current → advance the ramp and re-apply with that scale
  //   n !== current → switch to n at the default intensity (step 0)
  function apply(n) {
    const num = Number(n);
    const f = FILTERS.find(x => x.id === num) || FILTERS[0];
    if (!window.FX || typeof window.FX.setPersona !== 'function') {
      console.warn('[look-filter] FX.setPersona unavailable; filter not applied');
      return f;
    }
    if (f.id === 0) {
      // Clear always wins — pressing T+0 is the explicit off gesture.
      reset();
      current = 0;
      intensityStep = 0;
    } else if (current !== f.id) {
      // Switching to a new filter: reset the ramp so each filter starts
      // at its first intensity.
      current = f.id;
      intensityStep = 0;
      applyScaled(f, INTENSITY_RAMP[0]);
    } else {
      // Same filter as last time: advance the ramp. After the last
      // step, wrap so the user can fade out by tapping the same key.
      intensityStep = (intensityStep + 1) % INTENSITY_RAMP.length;
      const k = INTENSITY_RAMP[intensityStep];
      applyScaled(f, k);
    }
    try { localStorage.setItem('swr.lookfilter', String(current)); } catch (_) {}
    return f;
  }

  // Scale every numeric FX field in `f.fx` by `k`. 0 collapses to a no-op
  // reset so the user can fade a filter out by tapping its key past
  // the end of the ramp (step 4 → k=0 → reset).
  function applyScaled(f, k) {
    if (!window.FX || typeof window.FX.setPersona !== 'function') return;
    if (k <= 0.001) { reset(); return; }
    const profile = {};
    for (const key in f.fx) {
      const v = f.fx[key];
      if (typeof v !== 'number') continue;
      // Trap 5: mutAlgo is an algorithm selector (0..5, integer), not an
      // amount. The FX pipeline doesn't scale it (see
      // fx-postprocess.js around line 680), and we shouldn't either.
      if (key === 'mutAlgo') { profile[key] = v; continue; }
      profile[key] = (key === 'temp')
        ? Math.max(-1, Math.min(1, v * k))
        : Math.max(0, Math.min(1, v * k));
    }
    window.FX.setPersona(profile);
    const intensityLabel = (k >= 1) ? 'max' : (k <= 0.5 ? 'subtle' : 'med');
    if (window.setStatus) window.setStatus('look: ' + f.label + ' · ' + intensityLabel, 'ok');
    window.SWR_LOOK_FILTER = Object.assign({ slot: f.id, intensity: k, step: intensityStep }, f);
    try {
      window.dispatchEvent(new CustomEvent('swr-look-filter', {
        detail: Object.assign({ slot: f.id, intensity: k, step: intensityStep }, f)
      }));
    } catch (_) {}
  }

  function list() { return FILTERS.slice(); }
  function get() { return current; }
  function getIntensityStep() { return intensityStep; }
  function getRamp() { return INTENSITY_RAMP.slice(); }

  function restore() {
    let n = 0;
    try { n = parseInt(localStorage.getItem('swr.lookfilter') || '0', 10) || 0; } catch (_) {}
    if (n < 0 || n >= FILTERS.length) n = 0;
    return apply(n);
  }

  window.SWR_LOOK_FILTER_CYCLER = { list, apply, get, restore, reset, ALL,
                                  getIntensityStep, getRamp };
})();
