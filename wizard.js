// wizard.js — auto-adjusts FX (temperature + mutations + algorithm + preset) to
// match the loaded song. Listens for a new song load, then samples ~10 seconds of
// audio features, classifies the song into a "vibe profile", and smoothly tweens
// the temperature / mutations / algorithm / palette / preset values to match.
//
// Exposes window.Wizard with .analyze(), .apply(), .status().
//
// Profiles:
//   - "ambient"  : low RMS, low bass, high centroid (airy pads, atmospheric)
//   - "techno"   : high BPM (>120), strong beat, low-mid centroid
//   - "jazz"     : mid BPM (90-130), mid centroid, moderate RMS
//   - "rock"     : high bass + rms, mid BPM, low-mid centroid
//   - "classical": low BPM (<90), mid-high centroid, low rms
//   - "lofi"     : low BPM (60-90), low-mid centroid, low-mid rms
//   - "dnb"      : very high BPM (>150), strong bass

(function () {
  if (window.Wizard) return;  // idempotent

  const PROFILES = {
    ambient: {
      temp:  0.15,   // slightly warm
      mut:   0.45,   // medium mutations (liquid)
      algo:  2,      // liquid
      palette: 'solar',
      preset:  'drift',
      label: 'Ambient',
      desc:  'slow liquid warp, warm pastel tint',
    },
    techno: {
      temp: -0.25,   // cool / electric
      mut:   0.55,   // moderate-high (vortex + glitch)
      algo:  1,      // glitch
      palette: 'neon',
      preset:  'pulse',
      label: 'Techno',
      desc:  'beat-locked glitch, cool neon',
    },
    jazz: {
      temp:  0.30,   // warm
      mut:   0.20,   // low mutations (chromatic noise)
      algo:  5,      // chromatic noise
      palette: 'solar',
      preset:  'mosh',
      label: 'Jazz',
      desc:  'warm tint, gentle chromatic sway',
    },
    rock: {
      temp:  -0.10,
      mut:   0.40,
      algo:  1,      // glitch
      palette: 'mono',
      preset:  'mosh',
      label: 'Rock',
      desc:  'hard-hitting glitch, monochrome',
    },
    classical: {
      temp:  0.10,
      mut:   0.10,
      algo:  0,      // vortex (gentle)
      palette: 'ocean',
      preset:  'drift',
      label: 'Classical',
      desc:  'minimal vortex, ocean palette',
    },
    lofi: {
      temp:  0.40,   // warm
      mut:   0.25,
      algo:  2,      // liquid
      palette: 'solar',
      preset:  'drift',
      label: 'Lo-Fi',
      desc:  'warm liquid drift, slow tempo',
    },
    dnb: {
      temp: -0.30,
      mut:   0.70,
      algo:  4,      // ripple
      palette: 'neon',
      preset:  'strobe',
      label: 'Drum & Bass',
      desc:  'high BPM ripple, cool strobe',
    },
    unknown: {
      temp:  0.0,
      mut:   0.30,
      algo:  0,
      palette: 'neon',
      preset:  'pulse',
      label: 'Auto',
      desc:  'default auto-map',
    },
  };

  // ---- State ----
  const state = {
    analyzing: false,
    samples: [],
    sampleStart: 0,
    bpmAccum: [], centroidAccum: [], rmsAccum: [], bassAccum: [], midAccum: [], trebleAccum: [],
    lastProfile: null,
    tween: null,         // {fromTemp, toTemp, fromMut, toMut, fromAlgo, toAlgo, fromPalette, toPalette, fromPreset, toPreset, t0, dur}
    enabled: true,
    confidence: 0,
  };

  // ---- Classification rules (in priority order) ----
  // Returns a profile key + confidence.
  function classify({ bpm, centroid, rms, bass, mid, treble }) {
    // 1. BPM bucketing — strongest signal
    if (bpm >= 150)                       return { key: 'dnb',        conf: 0.85 };
    if (bpm >= 120 && bass > 0.20)        return { key: 'techno',     conf: 0.80 };
    if (bpm >= 100 && rms < 0.10)         return { key: 'classical',  conf: 0.65 };
    if (bpm >= 90  && rms >= 0.10)        return { key: 'jazz',       conf: 0.55 };
    if (bpm < 90) {
      if (treble > 0.18 && rms < 0.10)    return { key: 'ambient',    conf: 0.70 };
      if (mid > 0.20 && centroid < 0.30)  return { key: 'rock',       conf: 0.50 };
      return                                 { key: 'lofi',       conf: 0.60 };
    }
    // Fallback: signal-shape based
    if (centroid > 0.45 && rms < 0.08)    return { key: 'ambient',    conf: 0.50 };
    if (bass > 0.30)                      return { key: 'techno',     conf: 0.50 };
    return                                    { key: 'unknown',    conf: 0.30 };
  }

  // ---- Sampling: pull features from SWR.Audio every animation frame ----
  function startSampling(durationSec = 8) {
    state.analyzing = true;
    state.samples = [];
    state.bpmAccum = [];
    state.centroidAccum = [];
    state.rmsAccum = [];
    state.bassAccum = [];
    state.midAccum = [];
    state.trebleAccum = [];
    state.sampleStart = performance.now();
    state.duration = durationSec * 1000;
  }

  function tickSampling() {
    if (!state.analyzing) return;
    const Audio = (window.SWR && window.SWR.Audio) || null;
    if (Audio && Audio.feat) {
      if (Audio.feat.bpm > 0) state.bpmAccum.push(Audio.feat.bpm);
      state.centroidAccum.push(Audio.feat.centroid || 0);
      state.rmsAccum.push(Audio.feat.rms || 0);
      state.bassAccum.push(Audio.feat.bass || 0);
      state.midAccum.push(Audio.feat.mid || 0);
      state.trebleAccum.push(Audio.feat.treble || 0);
    }
    const elapsed = performance.now() - state.sampleStart;
    if (elapsed >= state.duration) {
      finishSampling();
    }
  }

  function finishSampling() {
    state.analyzing = false;
    const median = (arr) => {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const bpm = state.bpmAccum.length ? median(state.bpmAccum) : 0;
    // Round BPM to nearest 0.5 for stability
    const bpmRounded = Math.round(bpm * 2) / 2;
    const centroid = mean(state.centroidAccum);
    const rms = mean(state.rmsAccum);
    const bass = mean(state.bassAccum);
    const mid = mean(state.midAccum);
    const treble = mean(state.trebleAccum);

    const result = classify({ bpm: bpmRounded, centroid, rms, bass, mid, treble });
    state.lastProfile = result.key;
    state.confidence = result.conf;

    const profile = PROFILES[result.key] || PROFILES.unknown;
    state.status = {
      profile: result.key,
      confidence: result.conf,
      bpm: bpmRounded,
      centroid, rms, bass, mid, treble,
      label: profile.label,
      desc: profile.desc,
    };

    apply(profile, result.conf);
    if (window.setStatus) {
      window.setStatus(`wizard → ${profile.label} (${bpmRounded||'—'}bpm, conf ${(result.conf*100).toFixed(0)}%)`, 'ok');
    }
  }

  // ---- Apply profile: tween sliders + set FX + set preset/palette ----
  function apply(profile, confidence = 1.0) {
    if (!window.FX) return;
    if (!state.enabled) return;

    const tempSlider = document.getElementById('temperature');
    const mutSlider  = document.getElementById('mutations');
    const algoSel    = document.getElementById('mut-algo');
    const paletteSel = document.getElementById('palette');
    const presetSel  = document.getElementById('preset');

    const fromTemp = tempSlider ? parseFloat(tempSlider.value) : window.FX.state.temp;
    const fromMut  = mutSlider  ? parseFloat(mutSlider.value)  : window.FX.state.mut;
    const fromAlgo = algoSel    ? parseInt(algoSel.value, 10)  : window.FX.state.mutAlgo;
    const fromPalette = paletteSel ? paletteSel.value : null;
    const fromPreset  = presetSel  ? presetSel.value  : null;

    state.tween = {
      fromTemp, toTemp: profile.temp,
      fromMut,  toMut:  profile.mut,
      fromAlgo, toAlgo: profile.algo,
      fromPalette, toPalette: profile.palette,
      fromPreset,  toPreset:  profile.preset,
      t0: performance.now(),
      dur: 1500 + (1 - confidence) * 2000,  // less confident = slower tween
      confidence,
    };

    // Set palette + preset directly (no tween — they snap)
    if (paletteSel && profile.palette) {
      paletteSel.value = profile.palette;
      paletteSel.dispatchEvent(new Event('change'));
    }
    if (presetSel && profile.preset) {
      presetSel.value = profile.preset;
      presetSel.dispatchEvent(new Event('change'));
    }
  }

  // Per-frame: advance the tween, write to sliders + FX uniforms
  function tickTween() {
    const tw = state.tween;
    if (!tw) return;
    const t = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // smoothstep
    const temp = tw.fromTemp + (tw.toTemp - tw.fromTemp) * eased;
    const mut  = tw.fromMut  + (tw.toMut  - tw.fromMut)  * eased;
    // Algo is integer; flip at midpoint
    const algo = eased < 0.5 ? tw.fromAlgo : tw.toAlgo;

    const tempSlider = document.getElementById('temperature');
    const mutSlider  = document.getElementById('mutations');
    const algoSel    = document.getElementById('mut-algo');
    const tempVal    = document.getElementById('temperature-v');
    const mutVal     = document.getElementById('mutations-v');

    if (tempSlider) { tempSlider.value = String(temp); if (tempVal) tempVal.textContent = temp.toFixed(2); }
    if (mutSlider)  { mutSlider.value  = String(mut);  if (mutVal)  mutVal.textContent  = mut.toFixed(2); }
    if (algoSel)    { algoSel.value = String(algo); }
    if (window.FX) {
      window.FX.setTemp(temp);
      window.FX.setMut(mut);
      window.FX.setAlgo(algo);
    }

    if (t >= 1) state.tween = null;
  }

  // Hook into the main loop: sample if analyzing, tween if active
  function tick() {
    if (state.analyzing) tickSampling();
    if (state.tween) tickTween();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- Trigger: when a new song loads, start sampling ----
  function hookSongLoad() {
    const songInput = document.getElementById('song-input');
    if (songInput) {
      songInput.addEventListener('change', () => {
        // 1.5s delay so the analyser has time to start producing features
        setTimeout(() => startSampling(8), 1500);
        if (window.setStatus) window.setStatus('wizard: listening…', 'info');
      });
    }
    // Also expose manual trigger
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === 'W') {
        startSampling(8);
        if (window.setStatus) window.setStatus('wizard: manual re-listen', 'info');
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookSongLoad);
  } else {
    setTimeout(hookSongLoad, 200);
  }

  // ---- Public API ----
  window.Wizard = {
    PROFILES,
    state,
    analyze: () => startSampling(8),
    apply: (key) => apply(PROFILES[key] || PROFILES.unknown, 1),
    setEnabled(on) { state.enabled = !!on; },
    status: () => state.status,
    profile: () => state.lastProfile,
  };
})();