// lib/preset-browser.client.js — prompt-conditioned preset browser.
// Classic script. Load on any engine surface to get a floating browser.

(function () {
  'use strict';
  if (window.SWR_PRESET_BROWSER) return;

  var FX_SETTER = {
    liquid: 'setLiquid', pearl: 'setPearl', glitch: 'setGlitch',
    grain: 'setGrain', chroma: 'setChroma', vignette: 'setVignette',
    sepia: 'setSepia', glow: 'setGlow', grayscale: 'setGrayscale',
    blur: 'setBlur', mut: 'setMut', mutAlgo: 'setAlgo',
    temp: 'setTemp', posterize: 'setPosterize'
  };

  var KEYWORDS = {
    bass:      { energy: 0.2,  sens: { bass: 0.3 }, fx: ['bloom', 'glow'] },
    sub:       { energy: 0.15, sens: { bass: 0.35 }, fx: ['bloom'] },
    club:      { energy: 0.3,  sens: { bass: 0.25, onset: 0.2 }, fx: ['chroma', 'glow'], motion: 'snap' },
    ambient:   { energy: -0.2, sens: { mid: 0.15 }, fx: ['vignette', 'blur'], motion: 'slow' },
    cinematic: { energy: -0.1, sens: { bass: 0.1, mid: 0.1 }, fx: ['vignette', 'glow'], motion: 'slow' },
    glitch:    { energy: 0.1,  sens: { onset: 0.3, treble: 0.15 }, fx: ['glitch', 'grain'] },
    warm:      { palette: 'warm' },
    cold:      { palette: 'cold' },
    dark:      { palette: 'dark', fx: ['vignette'] },
    bright:    { palette: 'bright', energy: 0.1 },
    slow:      { motion: 'slow', energy: -0.15 },
    fast:      { motion: 'snap', energy: 0.2 },
    organic:   { fx: ['liquid', 'pearl'], motion: 'breath' },
    analog:    { fx: ['grain', 'sepia'] }
  };

  var PALETTES = {
    warm:   { primary: '#d4a24c', secondary: '#1a1a1a', accent: '#f5e6c0', bg: '#0a0a0c' },
    cold:   { primary: '#4cd4d4', secondary: '#1a2a3a', accent: '#a0d4f5', bg: '#0a0d12' },
    dark:   { primary: '#c45a5a', secondary: '#1a1a1a', accent: '#f5a0a0', bg: '#050505' },
    bright: { primary: '#ff3d92', secondary: '#00e5ff', accent: '#f5a524', bg: '#0a0d12' },
    default:{ primary: '#d462a4', secondary: '#4cd4d4', accent: '#d4a24c', bg: '#0a0a0c' }
  };

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function condition(prompt) {
    var p = (prompt || '').toLowerCase();
    var energy = 0.5;
    var sens = { bass: 0.5, mid: 0.4, treble: 0.4, onset: 0.5 };
    var fx = { liquid: 0.2, pearl: 0.1, glitch: 0.05, grain: 0.2, chroma: 0.4,
               bloom: 0.4, vignette: 0.3, sepia: 0.0, glow: 0.3, grayscale: 0,
               blur: 0.05, mut: 0, mutAlgo: 0, temp: 0, posterize: 6 };
    var motion = { rotation_speed: 0.05, scale_pulse: 0.12, pan_x: 0, pan_y: 0 };
    var palette = PALETTES.default;
    var motionFeel = 'slow';

    Object.keys(KEYWORDS).forEach(function (k) {
      if (p.indexOf(k) === -1) return;
      var rule = KEYWORDS[k];
      if (rule.energy) energy = Math.max(0, Math.min(1, energy + rule.energy));
      if (rule.sens) Object.keys(rule.sens).forEach(function (b) {
        sens[b] = Math.max(0, Math.min(1, sens[b] + rule.sens[b]));
      });
      if (rule.fx) rule.fx.forEach(function (name) {
        if (fx[name] != null) fx[name] = Math.min(1, fx[name] + 0.25);
      });
      if (rule.palette && PALETTES[rule.palette]) palette = PALETTES[rule.palette];
      if (rule.motion) motionFeel = rule.motion;
    });

    if (motionFeel === 'snap') { motion.scale_pulse = 0.28; motion.pan_x = 0.2; }
    else if (motionFeel === 'breath') { motion.scale_pulse = 0.22; }
    else if (motionFeel === 'slow') { motion.rotation_speed = 0.03; motion.scale_pulse = 0.08; }

    fx.bloom = Math.min(1, fx.bloom * (0.6 + energy));
    fx.chroma = Math.min(1, fx.chroma * (0.7 + sens.treble));

    var slug = p.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'prompt';
    return {
      id: 'swr-prompt-' + Date.now().toString(36) + '-' + slug,
      schema: 'swr-preset/v1',
      created_at: new Date().toISOString(),
      name: prompt.slice(0, 32) || 'Prompt preset',
      family: 'GENERATIVE',
      description: 'Conditioned from prompt: ' + prompt.slice(0, 80),
      fx_state: fx,
      motion: motion,
      palette: palette,
      audio_reactivity: {
        bass: ['scale_pulse', 'bloom'],
        mid: ['rotation_speed'],
        treble: ['grain', 'chroma'],
        onset: ['pan_x', 'glow']
      },
      suno_prompt: prompt
    };
  }

  function applyFx(preset) {
    if (!window.FX) return { applied: 0 };
    var applied = 0;
    var fx = preset.fx_state || {};
    Object.keys(fx).forEach(function (k) {
      var method = FX_SETTER[k];
      if (!method || typeof window.FX[method] !== 'function') return;
      try {
        var v = Number(fx[k]);
        if (k === 'posterize') window.FX[method](Math.max(0, Math.min(1, v / 16)));
        else window.FX[method](v);
        applied++;
      } catch (_) {}
    });
    if (preset.palette) {
      var root = document.documentElement;
      if (preset.palette.bg) root.style.setProperty('--bg-1', preset.palette.bg);
      if (preset.palette.primary) root.style.setProperty('--accent', preset.palette.primary);
    }
    return { applied: applied };
  }

  function applyPreset(preset) {
    if (window.SWR_PRESETS && typeof window.SWR_PRESETS.apply === 'function' && preset.id && preset.id.indexOf('swr-prompt-') !== 0) {
      return window.SWR_PRESETS.apply(preset.id);
    }
    return applyFx(preset);
  }

  var state = { index: 0, lastPrompt: '' };

  function currentList() {
    var conditioned = state.lastPrompt ? [condition(state.lastPrompt)] : [];
    var catalog = (window.SWR_PRESETS && window.SWR_PRESETS.getAll) ? window.SWR_PRESETS.getAll() : [];
    return conditioned.concat(catalog);
  }

  function show(idx) {
    var list = currentList();
    if (!list.length) return;
    state.index = (idx + list.length) % list.length;
    var p = list[state.index];
    applyPreset(p);
    var label = document.querySelector('[data-pb-label]');
    if (label) label.textContent = (state.index + 1) + ' / ' + list.length + '  ·  ' + (p.name || p.id);
  }

  function buildUI() {
    if (document.getElementById('swr-preset-browser')) return;
    var bar = document.createElement('div');
    bar.id = 'swr-preset-browser';
    bar.style.cssText = 'position:fixed;bottom:72px;right:16px;z-index:10070;display:flex;flex-direction:column;gap:6px;width:280px;padding:10px;border-radius:10px;background:rgba(12,9,6,.92);border:1px solid rgba(255,176,102,.3);color:#f4e7d6;font:12px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    bar.innerHTML = '<div>Preset browser</div>';
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Suno prompt (cinematic, club, glitch…)';
    input.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,176,102,.3);background:#1b130c;color:#f4e7d6;font-size:11px';
    input.setAttribute('data-pb-input', '');
    bar.appendChild(input);
    var cond = document.createElement('button');
    cond.type = 'button';
    cond.textContent = 'Condition';
    cond.style.cssText = 'padding:6px;border-radius:6px;border:0;background:#ff9a4d;color:#1a0f06;font-weight:700;cursor:pointer';
    cond.addEventListener('click', function () {
      state.lastPrompt = input.value.trim();
      state.index = 0;
      show(0);
    });
    bar.appendChild(cond);
    var nav = document.createElement('div');
    nav.style.cssText = 'display:flex;gap:6px;align-items:center';
    var prev = document.createElement('button');
    var next = document.createElement('button');
    prev.textContent = '◀';
    next.textContent = '▶';
    [prev, next].forEach(function (b) {
      b.type = 'button';
      b.style.cssText = 'width:32px;height:28px;border-radius:6px;border:1px solid rgba(255,176,102,.4);background:transparent;color:#f4e7d6;cursor:pointer';
    });
    prev.addEventListener('click', function () { show(state.index - 1); });
    next.addEventListener('click', function () { show(state.index + 1); });
    var label = document.createElement('span');
    label.setAttribute('data-pb-label', '');
    label.textContent = '—';
    label.style.cssText = 'flex:1;text-align:center;font-size:10px;opacity:.8';
    nav.appendChild(prev);
    nav.appendChild(label);
    nav.appendChild(next);
    bar.appendChild(nav);
    document.body.appendChild(bar);
  }

  function init() {
    buildUI();
    if (window.SWR_PRESETS && window.SWR_PRESETS.load) window.SWR_PRESETS.load().catch(function () {});
  }

  window.SWR_PRESET_BROWSER = { condition: condition, apply: applyPreset, show: show, open: init };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 300);
})();
