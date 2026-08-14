// presets-evolve.client.js — Phase 3 of the self-evolving engine roadmap.
// Generates personalized preset variants on-device based on the user's actual
// audio + persona usage. After N uses of a single persona, a variant is
// computed from the running average of BPM, dominant musical key, and the
// base persona's FX state. The variant is saved to localStorage and surfaces
// in the same "N new personalities" pill as the daily pipeline.
//
// Public API on window.SWR_PRESETS_EVOLVE:
//   .recordUsage(personaKey)     — call when a persona is applied
//   .getUsage()                  — { personaKey: { count, bpmAvg, dominantKey, dominantScale, ... } }
//   .getVariants()               — [variant, ...]
//   .dismissVariant(id)          — remove a variant from localStorage
//   .evolveNow(personaKey)       — force-generate a variant (test/inspect)
//   .threshold                   — current uses-to-evolve threshold (3 by default)
//
// Events:
//   swr-preset-variant-new  — { variant }
//   swr-preset-variant-applied — { id, variant }  (forwarded from SWR_PRESETS.apply)

(function () {
  'use strict';
  if (window.SWR_PRESETS_EVOLVE) return;

  const LS_USAGE    = 'swr.persona.usage';
  const LS_VARIANTS = 'swr.persona.variants';
  const THRESHOLD   = 3;  // uses per persona before a variant is generated

  // --- localStorage helpers -------------------------------------------------

  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }
  function readUsage()    { return readJSON(LS_USAGE, {}); }
  function writeUsage(u)  { writeJSON(LS_USAGE, u); }
  function readVariants() { return readJSON(LS_VARIANTS, []); }
  function writeVariants(v) { writeJSON(LS_VARIANTS, v); }

  // --- audio feature access -------------------------------------------------

  function getAudioFeat() {
    const swr = window.SWR;
    if (!swr || !swr.Audio || !swr.Audio.feat) return {};
    return swr.Audio.feat;
  }

  // --- usage tracking -------------------------------------------------------

  function recordUsage(personaKey) {
    if (!personaKey) return;
    if (personaKey === 'off' || personaKey === 'none' || personaKey === '— none —') return;
    const usage = readUsage();
    if (!usage[personaKey]) {
      usage[personaKey] = {
        count: 0,
        firstUsedAt: Date.now(),
        lastUsedAt: 0,
        bpmSum: 0, bpmCount: 0,
        keyCounts: {},
        scaleCounts: { major: 0, minor: 0 },
      };
    }
    const u = usage[personaKey];
    u.count += 1;
    u.lastUsedAt = Date.now();
    const feat = getAudioFeat();
    if (typeof feat.bpm === 'number' && feat.bpm > 0) {
      u.bpmSum += feat.bpm;
      u.bpmCount += 1;
    }
    if (typeof feat.key === 'string' && feat.key) {
      u.keyCounts[feat.key] = (u.keyCounts[feat.key] || 0) + 1;
    }
    if (feat.scale === 'major' || feat.scale === 'minor') {
      u.scaleCounts[feat.scale] += 1;
    }
    writeUsage(usage);

    if (u.count === THRESHOLD) {
      const variant = generateVariant(personaKey, u);
      if (variant) {
        const variants = readVariants();
        // dedupe by basePersona+key — only one active variant per (persona, key)
        const filtered = variants.filter(v =>
          !(v._meta && v._meta.basePersona === personaKey));
        filtered.push(variant);
        writeVariants(filtered);
        window.dispatchEvent(new CustomEvent('swr-preset-variant-new', { detail: { variant } }));
        // Also re-emit swr-presets-loaded so the panel refreshes
        if (window.SWR_PRESETS && window.SWR_PRESETS.load) {
          window.SWR_PRESETS.load().catch(() => {});
        }
        return variant;
      }
    }
  }

  // --- variant generation ---------------------------------------------------

  // Map a hex color to HSL, rotate hue by deg, return hex.
  function shiftHue(hex, deg) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
        case gN: h = (bN - rN) / d + 2; break;
        case bN: h = (rN - gN) / d + 4; break;
      }
      h /= 6;
    }
    h = (h * 360 + deg) % 360; if (h < 0) h += 360;
    s = Math.max(0.4, Math.min(0.85, s));
    const l2 = Math.max(0.15, Math.min(0.7, l));
    // hsl → rgb
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    let r2, g2, b2;
    if (s === 0) { r2 = g2 = b2 = l2; }
    else {
      const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
      const p = 2 * l2 - q;
      r2 = hue2rgb(p, q, h / 360 + 1/3);
      g2 = hue2rgb(p, q, h / 360);
      b2 = hue2rgb(p, q, h / 360 - 1/3);
    }
    const to = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + to(r2) + to(g2) + to(b2);
  }

  function generateVariant(personaKey, usage) {
    const reg = (window.Personas && window.Personas.PERSONAS) || {};
    const base = reg[personaKey];
    if (!base) return null;

    const bpmAvg = usage.bpmCount > 0 ? usage.bpmSum / usage.bpmCount : 0;
    const keyEntries = Object.entries(usage.keyCounts || {});
    const dominantKey = keyEntries.length
      ? keyEntries.sort((a, b) => b[1] - a[1])[0][0]
      : null;
    const dominantScale = (usage.scaleCounts.minor || 0) > (usage.scaleCounts.major || 0)
      ? 'minor' : 'major';

    // Mutate FX state based on audio profile.
    // Baseline: same as base persona. Then:
    //   - BPM > 120 → +0.15 scale_pulse, +0.10 rotation_speed
    //   - BPM < 80  → -0.10 scale_pulse, -0.05 rotation_speed
    //   - minor     → +0.10 vignette, +0.05 sepia
    //   - major     → +0.10 chroma
    //   - dominant key → shift palette primary by +1 step (key index) on the color wheel
    const KEY_HUE = { C: 0, 'C#': 30, D: 60, 'D#': 90, E: 120, F: 150,
                      'F#': 180, G: 210, 'G#': 240, A: 270, 'A#': 300, B: 330 };
    const hueShift = dominantKey ? (KEY_HUE[dominantKey] || 0) : 0;

    const basePalette = {
      primary:   base.primary   || '#d4a24c',
      secondary: base.secondary || '#4cd4d4',
      accent:    base.accent    || '#d462a4',
      bg:        base.bg        || '#0a0a0c',
    };
    const palette = {
      primary:   hueShift ? shiftHue(basePalette.primary,   hueShift) : basePalette.primary,
      secondary: hueShift ? shiftHue(basePalette.secondary, hueShift + 30) : basePalette.secondary,
      accent:    hueShift ? shiftHue(basePalette.accent,    hueShift - 30) : basePalette.accent,
      bg:        basePalette.bg,
    };

    // Motion is derived from BPM
    let scalePulse = 0.10;
    let rotationSpeed = 0.05;
    let panX = 0.0, panY = 0.0;
    if (bpmAvg > 120) { scalePulse = 0.25; rotationSpeed = 0.12; }
    else if (bpmAvg > 100) { scalePulse = 0.18; rotationSpeed = 0.08; }
    else if (bpmAvg < 80 && bpmAvg > 0) { scalePulse = 0.05; rotationSpeed = 0.02; }

    // FX state — start from base values, apply scale-driven shifts
    const fx_state = {
      liquid:    num(base.liquid,    0, 1, 0),
      pearl:     num(base.pearl,     0, 1, 0),
      glitch:    num(base.glitch,    0, 1, 0),
      grain:     num(base.grain,     0, 1, 0),
      chroma:    clamp(num(base.chroma, 0, 1, 0) + (dominantScale === 'major' ? 0.10 : 0)),
      bloom:     0,  // engine has no setBloom yet — left for a future enhancement
      vignette:  clamp(num(base.vignette, 0, 1, 0) + (dominantScale === 'minor' ? 0.10 : 0)),
      sepia:     clamp(num(base.sepia, 0, 1, 0) + (dominantScale === 'minor' ? 0.05 : 0)),
      glow:      num(base.glow,      0, 1, 0),
      grayscale: num(base.grayscale, 0, 1, 0),
      blur:      num(base.blur,      0, 1, 0),
      mut:       num(base.mut,       0, 1, 0),
      mutAlgo:   Math.round(num(base.mutAlgo, 0, 5, 0)),
      temp:      num(base.temp,     -1, 1, 0),
      posterize: Math.round(num(base.posterize, 0, 1, 0) * 16),
    };
    // posterize is 0..1 on persona, 1..16 on spec; 0 → 1, 1 → 16
    if (fx_state.posterize === 0) fx_state.posterize = 1;

    const motion = {
      rotation_speed: rotationSpeed,
      scale_pulse:    scalePulse,
      pan_x:          panX,
      pan_y:          panY,
    };

    // audio_reactivity — bias toward the same bands as the base persona
    // (we don't know what the base uses, so default to the canonical swr-set)
    const audio_reactivity = {
      bass:   ['chroma', 'bloom'],
      mid:    ['rotation_speed'],
      treble: ['grain'],
      onset:  ['scale_pulse'],
    };

    const id = `swr-variant-${personaKey}-${(bpmAvg ? Math.round(bpmAvg) : 'na')}-${dominantKey || 'X'}-${Date.now() % 100000}`;
    const name = bpmAvg
      ? `${base.label || personaKey} · ${Math.round(bpmAvg)} BPM${dominantKey ? ' ' + dominantKey + ' ' + dominantScale : ''}`
      : `${base.label || personaKey} · personal`;
    const description = bpmAvg
      ? `Personalized from ${usage.count} sessions of ${base.label || personaKey}, tuned to your ${Math.round(bpmAvg)} BPM and ${dominantKey || 'no detected'} ${dominantScale} key.`
      : `Personalized from ${usage.count} sessions of ${base.label || personaKey}.`;

    return {
      id, schema: 'swr-preset/v1', created_at: new Date().toISOString(),
      name, family: 'GENERATIVE', description,
      inspiration: [
        { kind: 'persona_ref', name: personaKey, weight: 0.6 },
        { kind: 'usage_ref',  name: `${usage.count} uses`, weight: 0.4 },
      ],
      fx_state, motion, palette, audio_reactivity,
      preview: {
        thumbnail_svg: makeVariantThumb(palette, personaKey, dominantKey, dominantScale, bpmAvg),
        tags: [personaKey.toLowerCase(), 'personal', dominantScale, ...(dominantKey ? [dominantKey.toLowerCase()] : [])].filter(Boolean).slice(0, 5),
      },
      _meta: {
        basePersona: personaKey,
        usageCount: usage.count,
        bpmAvg: bpmAvg,
        dominantKey: dominantKey,
        dominantScale: dominantScale,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  function num(v, lo, hi, dflt) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(lo, Math.min(hi, n));
    return dflt;
  }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  function makeVariantThumb(palette, personaKey, key, scale, bpm) {
    const w = 80, h = 80;
    const label = (personaKey || '?').toUpperCase().slice(0, 4);
    const sub = key ? `${key} ${scale[0].toUpperCase()}` : scale ? scale[0].toUpperCase() : '·';
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="${palette.bg}"/>
      <circle cx="40" cy="40" r="30" fill="${palette.primary}" opacity="0.65"/>
      <circle cx="56" cy="28" r="14" fill="${palette.secondary}" opacity="0.7"/>
      <circle cx="28" cy="52" r="10" fill="${palette.accent}" opacity="0.7"/>
      <text x="40" y="44" text-anchor="middle" fill="${palette.bg}" font-family="ui-monospace, monospace" font-size="9" font-weight="700">${label}</text>
      <text x="40" y="74" text-anchor="middle" fill="${palette.accent}" font-family="ui-monospace, monospace" font-size="6">${sub}</text>
    </svg>`;
  }

  // --- public API -----------------------------------------------------------

  function getUsage()    { return readUsage(); }
  function getVariants() { return readVariants(); }
  function dismissVariant(id) {
    writeVariants(readVariants().filter(v => v.id !== id));
  }
  function evolveNow(personaKey) {
    const usage = readUsage();
    if (!usage[personaKey]) {
      usage[personaKey] = {
        count: THRESHOLD, firstUsedAt: Date.now(), lastUsedAt: Date.now(),
        bpmSum: getAudioFeat().bpm || 0, bpmCount: getAudioFeat().bpm > 0 ? 1 : 0,
        keyCounts: getAudioFeat().key ? { [getAudioFeat().key]: 1 } : {},
        scaleCounts: getAudioFeat().scale === 'minor' ? { major: 0, minor: 1 } : { major: 1, minor: 0 },
      };
      writeUsage(usage);
    }
    const v = generateVariant(personaKey, usage[personaKey]);
    if (v) {
      const variants = readVariants().filter(x => !(x._meta && x._meta.basePersona === personaKey));
      variants.push(v);
      writeVariants(variants);
      window.dispatchEvent(new CustomEvent('swr-preset-variant-new', { detail: { variant: v } }));
      if (window.SWR_PRESETS && window.SWR_PRESETS.load) {
        window.SWR_PRESETS.load().catch(() => {});
      }
    }
    return v;
  }

  // --- wiring ---------------------------------------------------------------

  function init() {
    // Hook the persona dropdown
    const sel = document.getElementById('persona');
    if (sel) {
      sel.addEventListener('change', (e) => {
        setTimeout(() => recordUsage(e.target.value), 50);
      });
    }
    // Also hook window.Personas.apply for programmatic use
    if (window.Personas && window.Personas.apply) {
      const orig = window.Personas.apply.bind(window.Personas);
      window.Personas.apply = function (key) {
        const r = orig(key);
        recordUsage(key);
        return r;
      };
    }
  }

  window.SWR_PRESETS_EVOLVE = {
    recordUsage, getUsage, getVariants, dismissVariant, evolveNow,
    threshold: THRESHOLD,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
