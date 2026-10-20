// lib/layers.client.js — Layers subsystem extracted from engine.html
// (Sprint B3 of feat/asset-curator burndown).
//
// Public API
//
//   window.Layers  — the Layers IIFE instance, attached on script-eval.
//                    Same surface as the pre-extraction inline object:
//   .list                — array of layer objects
//   .selected            — currently selected layer (or null)
//   .elCache             — Map<layerId, HTMLElement> for the layer panel
//   .add(asset)          — push a new layer from a library asset
//   .remove(id)          — splice a layer out
//   .select(layer)       — mark a layer as selected, refresh UI
//   .updateSelected(p)   — patch properties on the selected layer
//   .render()            — paint the layer panel
//   .autoMap()           — algorithmically assign library assets to layer
//                          roles based on current audio features
//
// Helpers inlined into this module (engine-private; only Layers used them):
//   - readLayerProp / writeLayerProp  — rot slider ↔ layer.rotOffset bridge
//   - pickBlend(i, mode)              — choose globalCompositeOperation
//   - pickScale(i, asset)             — base scale per role
//   - pickReactors(i, asset, feat, mode) — per-layer reactor recipe
//
// Dependencies (read via window.* at call time):
//   window.Library        — lib/library.client.js (Sprint B2) — for autoMap
//   window.Audio          — lib/audio.client.js (Sprint B1) — Audio.feat
//   window.stageEmpty     — engine.html exposed (Sprint B1)
//   window._activePreset  — engine.html applyPreset() writes here
//   window.setStatus, window.escapeHtml, window.trunc
//                            — engine.html exposed
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';

  // Note: don't use `if (window.Layers) return` — Sprint B1 lesson about
  // native-namespace collisions. Use a private marker.
  if (window.__SWR_LAYERS_LOADED) return;
  window.__SWR_LAYERS_LOADED = true;

  // ---- Helpers (engine-private, moved from engine.html) -----------------

  // Layer property helpers — the rot slider in the per-layer panel writes
  // to l.rotOffset (the per-clip persistent tilt), not l.pos.rot (which is
  // audio-driven every frame). The final rotation is pos.rot + rotOffset.
  function readLayerProp(l, prop) {
    if (prop === 'rot') return l.rotOffset || 0;
    return l[prop];
  }
  function writeLayerProp(l, prop, value) {
    if (prop === 'rot') { l.rotOffset = value; return; }
    l[prop] = value;
  }

  function pickBlend(i, mode) {
    if (mode === undefined) mode = 'auto';
    const opts = ['source-over', 'screen', 'lighter', 'overlay', 'soft-light', 'difference'];
    // If a preset is active, use its blend sequence
    if (window._activePreset && window._activePreset.blends) {
      return window._activePreset.blends[i % window._activePreset.blends.length];
    }
    if (mode === 'chaos') return opts[Math.floor(Math.random() * opts.length)];
    if (mode === 'pulse') return i % 2 === 0 ? 'screen' : 'lighter';
    if (mode === 'ambient') return ['source-over', 'soft-light', 'overlay'][i % 3];
    // Auto: shuffle 3 random blends and assign cyclically so each remap = new blend set
    if (!pickBlend._pool) pickBlend._pool = ['source-over', 'screen', 'overlay', 'lighter'];
    pickBlend._pool.push(pickBlend._pool.shift());
    return pickBlend._pool[i % pickBlend._pool.length];
  }

  function pickScale(i, asset) {
    if (!asset) return 1;
    const ar = (asset.w || 1) / (asset.h || 1);
    // base around filling the canvas; tweak per role
    const fills = (window._activePreset && window._activePreset.fills) || [1.0, 0.8, 1.2, 0.5, 1.5, 0.7];
    return fills[i % fills.length] * (ar > 1 ? 0.7 : 1.0);
  }

  function pickReactors(i, asset, feat, mode) {
    if (mode === undefined) mode = 'auto';
    if (!asset) return [];
    // Preset mode: use the curated reactor sequence
    if (window._activePreset && window._activePreset.reactors) {
      return window._activePreset.reactors[i % window._activePreset.reactors.length] || [];
    }
    // Each layer gets 1-3 reactors based on its role index
    const presets = [
      // Layer 0: bass-pumping scale + opacity on beat
      [
        { feature: 'bass', target: 'scale',  scale: 0.6, ease: 'soft' },
        { feature: 'beat', target: 'opacity', scale: 0.4, ease: 'soft' },
      ],
      // Layer 1: mid-driven hue rotation
      [
        { feature: 'mid',  target: 'hue',   scale: 120, ease: 'smooth' },
        { feature: 'rms',  target: 'scale', scale: 0.2, ease: 'soft' },
      ],
      // Layer 2: treble shimmer — position + rotation
      [
        { feature: 'treble', target: 'rot',     scale: 30,  ease: 'smooth' },
        { feature: 'air',    target: 'y',       scale: 60,  ease: 'smooth' },
      ],
      // Layer 3: bass + rms scale
      [
        { feature: 'rms',  target: 'scale',  scale: 0.5, ease: 'soft' },
        { feature: 'onset', target: 'brightness', scale: 0.5, ease: 'sharp' },
      ],
      // Layer 4: centroid hue + treble scale
      [
        { feature: 'centroid', target: 'hue', scale: 180, ease: 'smooth' },
        { feature: 'treble',   target: 'scale', scale: 0.3, ease: 'soft' },
      ],
      // Layer 5: bass thump + beat pulse
      [
        { feature: 'bass',  target: 'scale',  scale: 0.8, ease: 'sharp' },
        { feature: 'beat',  target: 'opacity', scale: 0.7, ease: 'sharp' },
      ],
      // Layer 6: rms + onset flicker
      [
        { feature: 'onset', target: 'opacity', scale: 0.9, ease: 'sharp' },
        { feature: 'rms',   target: 'x',       scale: 30,  ease: 'soft' },
      ],
      // Layer 7: mid + air drift
      [
        { feature: 'mid',  target: 'x', scale: 40, ease: 'smooth' },
        { feature: 'air',  target: 'y', scale: 30, ease: 'smooth' },
      ],
    ];
    return presets[i % presets.length] || [];
  }

  // ---- Dep lookups ------------------------------------------------------
  function setStatus(t, cls) {
    if (typeof window.setStatus === 'function') window.setStatus(t, cls);
  }
  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s);
  }
  function trunc(s, n) {
    if (typeof window.trunc === 'function') return window.trunc(s, n);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function stageEmpty() {
    if (window.stageEmpty) return window.stageEmpty;
    return document.getElementById('stage-empty');
  }
  function layerList() {
    return document.getElementById('layer-list');
  }
  function Library() {
    return window.Library || null;
  }
  function Audio() {
    return window.Audio || null;
  }
  function $(id) { return document.getElementById(id); }

  // ---- Layers IIFE ------------------------------------------------------
    const Layers = {
      list: [],
      selected: null,
      // Fewer layers (host cap): how many layers of the stack are DRAWN —
      // counted from the TOP (the featured clip stays; the deepest background
      // layers drop first). 0 / unset = no cap. Hosts (the engine stepper, a
      // preset, a chapter) call setActiveCount(); the draw walks honor it.
      activeCount: 0,
      setActiveCount(n) {
        this.activeCount = Math.max(0, n | 0);
        return this.activeCount;
      },
    elCache: new Map(),
    add(asset) {
      const z = this.list.length;
      const audio = Audio();
      const layer = {
        id: 'L' + (this.list.length + 1),
        asset,
        blend: pickBlend(this.list.length),
        opacity: 1,
        baseScale: pickScale(this.list.length, asset),
        hue: 0,
        brightness: 1,
        contrast: 1,
        pos: { x: 0, y: 0, rot: 0 },
        rotOffset: 0,         // per-clip persistent tilt (added on top of pos.rot)
        rotationEnabled: true, // gate BOTH manual rot + audio rot reactors; undefined = enabled
        z,
        reactors: pickReactors(this.list.length, asset, audio ? audio.feat : null),
        snapBeat: false,
        // New: high-level audio-reactive algorithm per layer
        // (Pulse / Drift / Spark); intensity 0-1 controls modulation strength.
        algo: 'none',           // 'none' | 'pulse' | 'drift' | 'spark'
        algoIntensity: 0,       // 0..1
      };
      this.list.push(layer);
      this.render();
      this.select(layer);
      if (this.list.length === 1) {
        const se = stageEmpty();
        if (se && se.classList) se.classList.add('hidden');
      }
    },
    remove(id) {
      const i = this.list.findIndex(l => l.id === id);
      if (i < 0) return;
      this.list.splice(i, 1);
      if (this.selected && this.selected.id === id) this.selected = this.list[0] || null;
      this.render();
      if (this.list.length === 0) {
        const se = stageEmpty();
        if (se && se.classList) se.classList.remove('hidden');
      }
    },
    // Retire a layer: tween its opacity → 0 AND baseScale → ~0.4 over
    // RETIRE_MS so it shrinks to a quiet corner of the canvas. The
    // layer is *not* removed from this.list (the user might restore
    // it), but its audio reactors + algo are silenced by setting
    // opacity to 0 and scaling toward 0 — the audio code reads
    // `l.opacity` for the alpha multiplier, so 0 means the layer
    // produces no visible reaction. Other layers can take over the
    // sound reactivity while this one sleeps. After RETIRE_MS, the
    // final state is committed (single rAF tick).
    //
    // This is the contract: retired layers don't pulse, don't drag.
    // Call `Layers.unretire(id)` to wake one back up.
    retire(id, ms) {
      const layer = this.list.find((l) => l.id === id);
      if (!layer) return false;
      const RETIRE_MS = (typeof ms === 'number' && ms > 0) ? ms : 720;
      const T0 = performance.now();
      const start = {
        opacity: layer.opacity != null ? layer.opacity : 1,
        baseScale: layer.baseScale || 1,
      };
      // Both should arrive at zero so the layer is visually + audibly
      // out of the way, but baseScale parks at 0.4 instead of 0 so the
      // asset still resolves to a thumbnail-ish rectangle (it stays in
      // the layer list, see the contract above).
      const target = { opacity: 0, baseScale: 0.4 };
      const step = (now) => {
        let k = (now - T0) / RETIRE_MS;
        if (k >= 1) k = 1;
        const ease = 1 - Math.pow(1 - k, 3); // ease-out cubic
        layer.opacity   = start.opacity   + (target.opacity   - start.opacity)   * ease;
        layer.baseScale = start.baseScale + (target.baseScale - start.baseScale) * ease;
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          layer.opacity = target.opacity;
          layer.baseScale = target.baseScale;
          layer._retired = true;
          this.render();
        }
      };
      requestAnimationFrame(step);
      // Caller might want to add a new layer that takes over; bump the
      // render immediately so the fade is visible from frame 1.
      layer._retired = false;
      this.render();
      return true;
    },
    unretire(id) {
      const layer = this.list.find((l) => l.id === id);
      if (!layer) return false;
      layer._retired = false;
      layer.opacity = 1;
      layer.baseScale = 1;
      this.render();
      return true;
    },
    // Reset every layer to its default transform (pos at origin, opacity
    // 1, hue 0, baseScale from pickScale, etc). Each layer slides back to
    // its home position over HOME_MS ms via a tween — not a snap — so the
    // composition breathes back rather than jumps. The audio-reactive
    // reactors + algo stay as-is (they're not user-set state); only the
    // manual sliders + position snap back.
    homeAll(ms) {
      const HOME_MS = (typeof ms === 'number' && ms > 0) ? ms : 480;
      const T0 = performance.now();
      // Capture start values once (snapshots before the tween).
      const starts = this.list.map((l) => ({
        opacity: l.opacity != null ? l.opacity : 1,
        hue: l.hue || 0,
        brightness: l.brightness != null ? l.brightness : 1,
        contrast: l.contrast != null ? l.contrast : 1,
        x: (l.pos && l.pos.x) || 0,
        y: (l.pos && l.pos.y) || 0,
        rot: (l.pos && l.pos.rot) || 0,
        rotOffset: l.rotOffset || 0,
        baseScale: l.baseScale || 1,
      }));
      const targets = this.list.map((l, i) => ({
        opacity: 1,
        hue: 0,
        brightness: 1,
        contrast: 1,
        x: 0, y: 0, rot: 0,
        rotOffset: 0,
        baseScale: pickScale(i, l.asset),
      }));
      const step = (now) => {
        let k = (now - T0) / HOME_MS;
        if (k >= 1) k = 1;
        const ease = 1 - Math.pow(1 - k, 3); // ease-out cubic
        for (let i = 0; i < this.list.length; i++) {
          const l = this.list[i];
          const s = starts[i];
          const t = targets[i];
          l.opacity    = s.opacity    + (t.opacity    - s.opacity)    * ease;
          l.hue        = s.hue        + (t.hue        - s.hue)        * ease;
          l.brightness = s.brightness + (t.brightness - s.brightness) * ease;
          l.contrast   = s.contrast   + (t.contrast   - s.contrast)   * ease;
          if (l.pos) {
            l.pos.x   = s.x + (t.x - s.x) * ease;
            l.pos.y   = s.y + (t.y - s.y) * ease;
            l.pos.rot = s.rot + (t.rot - s.rot) * ease;
          }
          l.rotOffset = s.rotOffset + (t.rotOffset - s.rotOffset) * ease;
          l.baseScale = s.baseScale + (t.baseScale - s.baseScale) * ease;
        }
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          // Final pass snaps to exact target so floating-point drift is gone.
          for (let i = 0; i < this.list.length; i++) {
            const l = this.list[i];
            const t = targets[i];
            l.opacity = t.opacity; l.hue = t.hue;
            l.brightness = t.brightness; l.contrast = t.contrast;
            if (l.pos) { l.pos.x = t.x; l.pos.y = t.y; l.pos.rot = t.rot; }
            l.rotOffset = t.rotOffset; l.baseScale = t.baseScale;
          }
          this.render();
        }
      };
      requestAnimationFrame(step);
      // Persist the new home state so a reload doesn't bounce back.
      try { saveLib(); } catch (_) {}
      this.render();
    },
    select(layer) {
      this.selected = layer;
      for (const el of this.elCache.values()) el.classList.remove('selected');
      const e = layer ? this.elCache.get(layer.id) : null;
      if (e) e.classList.add('selected');
      const rotBtn = $('rotate-sel');
      if (rotBtn) {
        rotBtn.disabled = !layer;
        rotBtn.style.opacity = layer ? '1' : '0.4';
        rotBtn.style.cursor = layer ? 'pointer' : 'not-allowed';
      }
    },
    updateSelected(patch) {
      if (!this.selected) return;
      Object.assign(this.selected, patch);
      this.render();
    },
    render() {
      const ll = layerList();
      const frag = document.createDocumentFragment();
      this.elCache.clear();
      for (let i = 0; i < this.list.length; i++) {
        const l = this.list[i];
        const el = document.createElement('div');
        el.className = 'layer' + (this.selected === l ? ' selected' : '');
        el.dataset.id = l.id;
        const reactors = l.reactors.map(r =>
          `${r.feature}→${r.target}×${r.scale.toFixed(2)}`
        ).join(' · ') || '—';
        el.innerHTML = `
          <div class="layer-head">
            <span class="num">${i + 1}</span>
            <span class="thumb">${l.asset ? '' : '∅'}</span>
            <span class="name">${l.asset ? escapeHtml(trunc(l.asset.name, 18)) : '(empty)'}</span>
            <span class="layer-audio-pill" title="All layers share the loaded song (one audio source drives every reactor)">♪ shared</span>
            <button class="x-rot clip" title="Rotate this clip +90° (or press R)" aria-label="Rotate clip 90°">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.39-3.89L13.5 5.5"/>
                <path d="M13.5 2.5v3h-3"/>
                <path d="M13.5 8a5.5 5.5 0 0 1-9.39 3.89L2.5 10.5"/>
                <path d="M2.5 13.5v-3h3"/>
              </svg>
            </button>
            <button class="x-rand" title="Randomise pos / rot / scale / blend">🎲</button>
            <button class="x-beat" title="Snap to beat (BPM-locked)">⌐</button>
            <button class="x" title="remove">×</button>
          </div>
          <div class="layer-row">
            <label>react</label>
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--accent-2);">${reactors}</span>${l.rotationEnabled === false ? ' <span class="rot-off-tag" title="ROTATE toggle is off — rot-target reactors are silenced">[rot off]</span>' : ''}
          </div>
          <div class="layer-row">
            <label title="High-level audio-reactive algorithm (Pulse / Drift / Spark)">algo</label>
            <select data-prop="algo">
              <option value="none">none</option>
              <option value="pulse">Pulse</option>
              <option value="drift">Drift</option>
              <option value="spark">Spark</option>
            </select>
            <input type="range" data-prop="algoIntensity" min="0" max="1" step="0.05" style="width:60px" title="Strength of the audio-reactive algorithm" />
          </div>
          <div class="layer-row">
            <label>blend</label>
            <select data-prop="blend">
              <option value="source-over">over</option>
              <option value="screen">screen</option>
              <option value="multiply">multiply</option>
              <option value="lighter">add</option>
              <option value="difference">diff</option>
              <option value="overlay">overlay</option>
              <option value="soft-light">soft</option>
            </select>
          </div>
          <div class="layer-row">
            <label>opacity</label>
            <input type="range" data-prop="opacity" min="0" max="1" step="0.01" />
          </div>
          <div class="layer-row">
            <label>base scale</label>
            <input type="range" data-prop="baseScale" min="0.1" max="3" step="0.01" />
          </div>
          <div class="layer-row">
            <label>hue</label>
            <input type="range" data-prop="hue" min="-180" max="180" step="1" />
          </div>
          <div class="layer-row">
            <label>rot</label>
            <input type="range" data-prop="rot" min="-180" max="180" step="1" />
            <b class="rot-v" style="font-family:var(--font-mono);font-size:9px;color:var(--accent);min-width:30px;text-align:right;margin-left:4px;">0°</b>
          </div>
          <div class="layer-row layer-row-toggle">
            <label title="Gate ALL rotation on this layer (manual slider + audio reactors)">rotate</label>
            <input type="checkbox" data-prop="rotationEnabled" class="rot-enable-toggle" title="On = manual rot + audio rot reactors apply. Off = rotation is suppressed entirely." />
          </div>
        `;
        const sel = el.querySelector('select[data-prop="blend"]');
        sel.value = l.blend;
        // Audio algorithm: select shows the chosen algo, range slider the intensity
        const algoSel = el.querySelector('select[data-prop="algo"]');
        if (algoSel) algoSel.value = l.algo || 'none';
        for (const r of el.querySelectorAll('input[type=range]')) {
          r.value = readLayerProp(l, r.dataset.prop);
        }
        const rotEnable = el.querySelector('input.rot-enable-toggle');
        if (rotEnable) rotEnable.checked = l.rotationEnabled !== false;
        const rotV = el.querySelector('.rot-v');
        if (rotV) {
          const off = l.rotationEnabled === false;
          rotV.textContent = `${Math.round(l.rotOffset || 0)}°${off ? ' (held)' : ''}`;
          rotV.style.opacity = off ? '0.45' : '1';
        }
        if (l.asset && l.asset.thumb) {
          const img = new Image();
          img.src = l.asset.thumb;
          el.querySelector('.thumb').appendChild(img);
        }
        const self = this;
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('x')) { self.remove(l.id); return; }
          if (e.target.classList.contains('x-rot')) {
            // Shift+click = -90° (counter-clockwise), plain click = +90°
            // Mutates the per-clip offset so the user's tilt survives audio drift
            l.rotOffset = (l.rotOffset + (e.shiftKey ? -90 : 90) + 360) % 360;
            // Update the slider + readout in the same layer card
            const rotSlider = el.querySelector('input[data-prop="rot"]');
            const rotV = el.querySelector('.rot-v');
            if (rotSlider) rotSlider.value = l.rotOffset;
            if (rotV) rotV.textContent = `${Math.round(l.rotOffset)}°`;
            e.stopPropagation();
            return;
          }
          if (e.target.classList.contains('x-rand')) {
            if (!l.pos) l.pos = { x: 0, y: 0, rot: 0 };
            l.pos.x = (Math.random() - 0.5) * 200;
            l.pos.y = (Math.random() - 0.5) * 200;
            l.pos.rot = Math.random() * 360;
            l.baseScale = 0.4 + Math.random() * 1.4;
            const blends = ['source-over','screen','multiply','lighter','difference','overlay','soft-light'];
            l.blend = blends[Math.floor(Math.random() * blends.length)];
            e.stopPropagation();
            return;
          }
          if (e.target.classList.contains('x-beat')) {
            l.snapBeat = !l.snapBeat;
            e.target.classList.toggle('active', l.snapBeat);
            e.stopPropagation();
            return;
          }
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
          self.select(l);
        });
        sel.addEventListener('change', () => { l.blend = sel.value; });
        const algoSelRef = el.querySelector('select[data-prop="algo"]');
        if (algoSelRef) algoSelRef.addEventListener('change', () => { l.algo = algoSelRef.value; });
        for (const r of el.querySelectorAll('input[type=range]')) {
          r.addEventListener('input', () => {
            writeLayerProp(l, r.dataset.prop, parseFloat(r.value));
            if (r.dataset.prop === 'rot' && rotV) rotV.textContent = `${Math.round(r.value)}°${l.rotationEnabled === false ? ' (held)' : ''}`;
          });
        }
        // ROTATE checkbox — toggles the layer-wide gate for both manual
        // rot and audio rot reactors. Re-render so the [rot off] hint,
        // the rot readout state, and the slider styling update at once.
        const rotEnableCb = el.querySelector('input.rot-enable-toggle');
        if (rotEnableCb) {
          rotEnableCb.addEventListener('change', () => {
            l.rotationEnabled = rotEnableCb.checked;
            self.render();
          });
        }
        this.elCache.set(l.id, el);
        frag.appendChild(el);
      }
      if (ll) {
        ll.innerHTML = '';
        ll.appendChild(frag);
      }
    },
    // Auto-remap: algorithmically assign assets to layers by classification
    // relative to current audio features.
    autoMap() {
      const library = Library();
      if (!library || !library.items.length) {
        setStatus('lib empty', 'warn');
        return;
      }
      const mode = ($('mode') || {}).value || 'auto';
      const sens = parseFloat(($('sensitivity') || {}).value || '1');
      const audio = Audio();
      const f = (audio && audio.feat) ? audio.feat : { bass: 0, mid: 0, treble: 0, air: 0, rms: 0, onset: 0 };
      // Compute a "score" for each asset for each layer role
      const roles = [
        { name: 'bass',  want: 'motion', weight: 0.6 + f.bass * sens },
        { name: 'mid',   want: 'mid',    weight: 0.4 + f.mid * sens },
        { name: 'treb',  want: 'luma',   weight: 0.3 + f.treble * sens },
        { name: 'air',   want: 'hue',    weight: 0.2 + f.air * sens },
        { name: 'rms',   want: 'motion', weight: 0.5 + f.rms * sens * 2 },
        { name: 'onset', want: 'motion', weight: 0.7 + f.onset * sens * 3 },
      ];
      // Score every asset for every role
      const scored = library.items.map(it => {
        const sc = {};
        // Want keys match roles[i].want exactly
        sc.motion = (it.motion) * 0.7 + (1 - Math.abs(it.luma - 0.5) * 2) * 0.3;   // bass, rms, onset lean on motion
        sc.mid    = (it.luma) * 0.5 + (1 - it.motion) * 0.5;
        sc.luma   = (1 - it.motion) * 0.4 + (it.luma) * 0.6;                       // treble prefers bright & static
        sc.hue    = (it.hue) * 0.5 + (1 - it.motion) * 0.5;                       // air prefers colorful
        return { it, sc };
      });
      // Pick from top-N candidates randomly so each RE-MAP click produces a
      // new visual look. N=1 in 'auto' (still score-driven, but jittered),
      // N=3 in 'chaos' (more variety), N=1 in 'pulse'/'ambient'.
      const topN = { auto: 2, chaos: 4, pulse: 1, ambient: 1 }[mode] || 2;
      const used = new Set();
      const assignments = roles.map(r => {
        // Score unused candidates
        const cands = [];
        for (const s of scored) {
          if (used.has(s.it.id)) continue;
          cands.push({ it: s.it, v: s.sc[r.want] * r.weight });
        }
        if (!cands.length) return { role: r, asset: null };
        // Sort by score, take top N
        cands.sort((a, b) => b.v - a.v);
        const pool = cands.slice(0, Math.min(topN, cands.length));
        // Weight the random pick by score so the best is still most likely
        const total = pool.reduce((s, c) => s + Math.max(c.v, 0.01), 0);
        let r2 = Math.random() * total;
        let pick = pool[0];
        for (const c of pool) {
          r2 -= Math.max(c.v, 0.01);
          if (r2 <= 0) { pick = c; break; }
        }
        used.add(pick.it.id);
        return { role: r, asset: pick.it };
      });
      // Reset and rebuild layers
      this.list = [];
      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (!a.asset) continue;
        const l = {
          id: 'L' + (i + 1),
          asset: a.asset,
          blend: pickBlend(i, mode),
          opacity: 1,
          baseScale: pickScale(i, a.asset),
          hue: (mode === 'chaos') ? (Math.random() * 360 - 180) : 0,
          brightness: 1,
          contrast: 1,
          pos: { x: 0, y: 0, rot: 0 },
          // Keep this shape in step with add(). autoMap() is what builds the
          // default starter layers (client/default-library.client.js →
          // ensureStarterLayers), and it used to omit these three, so every
          // default layer carried rotOffset: undefined — which makes the ↻ ROT
          // affordance and the R key compute `undefined + 90` → NaN — and
          // rotationEnabled: undefined, which verify-rotation-enabled asserts
          // must be true.
          rotOffset: 0,
          rotationEnabled: true,
          snapBeat: false,
          z: i,
          reactors: pickReactors(i, a.asset, audio ? audio.feat : null, mode),
        };
        this.list.push(l);
      }
      this.render();
      if (this.list.length) {
        const se = stageEmpty();
        if (se && se.classList) se.classList.add('hidden');
        this.select(this.list[0]);
      }
      setStatus('mapped ' + this.list.length, 'ok');
    },
  };

  window.Layers = Layers;

  // ---- applyPreset (extracted from engine.html in Sprint B3) -----------
  // Lives in this module because it touches layer helpers (pickBlend /
  // pickScale / pickReactors) that are now lib-private. Engine.html
  // exposes VISUAL_PRESETS on window; this function reads that map and
  // mutates Layers.list to apply the preset's reactors/blends/fills.
  function applyPreset(key) {
    const layers = Layers;
    if (!key || key === 'off') {
      window._activePreset = null;
      const sel = document.getElementById('preset');
      if (sel) sel.value = 'off';
      if (layers && layers.list && layers.list.length && layers.render) layers.render();
      setStatus('preset: off (default mode)', 'ok');
      return;
    }
    const preset = (window.VISUAL_PRESETS || {})[key];
    if (!preset) return;
    window._activePreset = preset;
    // Auto-populate the stage when the user picks a preset on an
    // empty canvas: presets are styled for N layers (the preset's
    // reactors/blends/fills array length). Picking pulse on an empty
    // stage used to do nothing visible because the apply-loop was
    // gated on Layers.list.length > 0. Pick N images from the library
    // and add them as layers so the preset has something to style.
    const library = Library();
    if (layers && layers.list && layers.list.length === 0 && library && library.items && library.items.length) {
      // N = the largest array in the preset (whichever has the most
      // entries); fall back to 4 (the typical preset shape) if no
      // arrays defined.
      const arrs = ['reactors', 'blends', 'fills'].map(k => Array.isArray(preset[k]) ? preset[k].length : 0);
      const N = Math.max(4, ...arrs);
      const images = library.items.filter(it => it && it.type === 'image').slice(0, N);
      for (const it of images) {
        try { layers.add(it); } catch (e) { /* skip broken items */ }
      }
      setStatus('preset: ' + preset.name + ' (' + images.length + ' layers)', 'ok');
    }
    // Re-render layer panel so the new blends/scales show. When the preset
    // defines explicit `reactors` / `blends` / `fills` arrays that match
    // the current layer count, honor them verbatim. Otherwise fall back to
    // the asset-driven heuristics (pickReactors / pickBlend / pickScale).
    // Falls back layer-by-layer so a 4-layer preset applied to a 6-layer
    // scene still works: layers 0..N-1 use the preset; layers N..end use
    // the heuristic.
    const audio = Audio();
    if (layers && layers.list && layers.list.length) {
      const presetReactors = Array.isArray(preset.reactors) ? preset.reactors : null;
      const presetBlends = Array.isArray(preset.blends) ? preset.blends : null;
      const presetFills = Array.isArray(preset.fills) ? preset.fills : null;
      for (let i = 0; i < layers.list.length; i++) {
        const l = layers.list[i];
        if (presetBlends && presetBlends[i % presetBlends.length]) {
          l.blend = presetBlends[i % presetBlends.length];
        } else {
          l.blend = pickBlend(i, 'auto');
        }
        if (presetFills && typeof presetFills[i % presetFills.length] === 'number') {
          l.baseScale = presetFills[i % presetFills.length];
        } else {
          l.baseScale = pickScale(i, l.asset);
        }
        if (presetReactors && presetReactors[i % presetReactors.length]) {
          l.reactors = presetReactors[i % presetReactors.length].slice();
        } else {
          l.reactors = pickReactors(i, l.asset, audio ? audio.feat : null, 'auto');
        }
      }
      if (layers.render) layers.render();
    }
    setStatus('preset: ' + preset.name, 'ok');

    // PRD-019: auto-arm the recommended primary transition for this
    // preset if the transitions module + manifest are loaded. The
    // transitions popover re-renders its recommendation chips via
    // its own listener on the #preset/#persona dropdowns, so we
    // don't need to touch the panel here.
    if (window.SWRPresetTransitions && typeof window.SWRPresetTransitions.applyPresetAutoFire === 'function') {
      window.SWRPresetTransitions.applyPresetAutoFire(key, {
        every: 4,
        bpm: 120,
        peak: 0.85
      });
    }
  }
  window.applyPreset = applyPreset;
})();
