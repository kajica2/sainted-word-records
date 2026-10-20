// client/look-filter-cycler.client.js — Tint + variant look cycler.
//
// T+1..9 apply pre-baked look filters that mix a (tone, tint, variant)
// triple to the engine. T+0 clears everything (no filter).
//
// Why a separate combo (T prefix)? The bare digits are already claimed
// for layer selection, story, remap, FX-presets; we needed somewhere
// that wouldn't collide and read naturally. "T" reads as "tint" which
// matches the operation. The state is held on window.SWR_LOOK_FILTER
// and the UI can read what's applied.

(() => {
  // 9 pre-baked looks. tone = desaturate grade (0..1), temp = colour
  // temperature, variant = the engine variant to flip on (or null to
  // keep current). Numbers map to user-facing slot 1..9.
  const LOOKS = [
    { tone: 0.20, temp: -10, variant: null, label: 'soft' },         // 1
    { tone: 0.35, temp: -25, variant: 'film', label: 'film cool' },   // 2
    { tone: 0.50, temp:  30, variant: null, label: 'sepia warm' },     // 3
    { tone: 0.65, temp: -50, variant: 'chrome', label: 'chrome' },     // 4
    { tone: 0.40, temp:   0, variant: 'glitch', label: 'glitch' },    // 5
    { tone: 0.30, temp:  20, variant: 'aurora', label: 'aurora' },     // 6
    { tone: 0.55, temp: -20, variant: 'pulse', label: 'pulse' },       // 7
    { tone: 0.70, temp:  35, variant: 'void', label: 'void warm' },    // 8
    { tone: 0.80, temp: -45, variant: 'echo-manifold', label: 'echo' },// 9
  ];

  // Apply a look to window.FX + variant-switcher. fire-and-forget, returns true on success.
  function applyLook(slot) {
    if (slot === 0) {
      // Clear: reset tone + temp to 0, leave variant alone
      if (window.FX) {
        try { window.FX.setTone && window.FX.setTone(0); } catch (_) {}
      }
      if (window.setStatus) window.setStatus('look: none', 'ok');
      window.SWR_LOOK_FILTER = { slot: 0, tone: 0, temp: 0, variant: null, label: 'none' };
      try { window.dispatchEvent(new CustomEvent('swr-look-filter', {
        detail: { slot: 0, tone: 0, temp: 0, variant: null, label: 'none' }
      })); } catch (_) {}
      return true;
    }
    const idx = slot - 1;
    if (idx < 0 || idx >= LOOKS.length) return false;
    const look = LOOKS[idx];
    if (window.FX && typeof window.FX.setTone === 'function') {
      try { window.FX.setTone(look.tone); } catch (_) {}
    }
    // Variant switcher: switch if a variant name was provided
    if (look.variant && window.SWR_VARIANTS && typeof window.SWR_VARIANTS.activate === 'function') {
      try { window.SWR_VARIANTS.activate(look.variant); } catch (_) {}
    }
    if (window.setStatus) window.setStatus('look: ' + look.label, 'ok');
    window.SWR_LOOK_FILTER = {
      slot: slot, tone: look.tone, temp: look.temp,
      variant: look.variant, label: look.label
    };
    try { window.dispatchEvent(new CustomEvent('swr-look-filter', {
      detail: Object.assign({ slot: slot }, look)
    })); } catch (_) {}
    return true;
  }

  window.SWR_LOOK_FILTER_CYCLER = {
    list: LOOKS,
    apply: applyLook,
    get current() { return window.SWR_LOOK_FILTER || null; },
  };
})();
