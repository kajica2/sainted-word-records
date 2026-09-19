// client/dashboard-presets.client.js — .SMR-SET save/load for the layer
// accordion on the dashboard. Wired via <script src> defer.
//
// Public API on window.__SWR_PRESETS:
//   .get()         -> object  current layer state as a serializable obj
//   .set(obj)      -> void    applies a preset to the live accordion
//   .download()    -> void    triggers a download of the current preset
//   .applyFile(f)  -> Promise<void>  loads a .smr-set.json File
//   .DEFAULT       -> object  hardcoded default (matches the dashboard's
//                              initial 5-layer setup)
//
// File format (.smr-set.json):
//   {
//     "format": "smr-set",
//     "version": 1,
//     "name": "My preset",
//     "layers": [
//       { "name": "SHARED", "open": true,
//         "react": "bass-scale*0.68 . b64-opacity*0.48",
//         "blend": "over",
//         "opacity": 100, "base": 50, "scale": 100, "hue": 0, "rot": 0,
//         "rotate": false },
//       ...
//     ]
//   }

(function () {
  'use strict';

  const DEFAULT = {
    format: 'smr-set', version: 1, name: 'Default',
    layers: [
      { name: 'SHARED', open: true,  react: 'bass-scale*0.68 . b64-opacity*0.48', blend: 'over',     opacity: 100, base: 50, scale: 100, hue: 0,  rot: 0, rotate: false },
      { name: 'AURA',   open: false, react: 'mid-energy*0.72 . hue-drift*0.34',   blend: 'overlay',  opacity: 80,  base: 40, scale: 96,  hue: 12, rot: 0, rotate: false },
      { name: 'GRAIN',  open: false, react: 'rms*0.30 . seed*42',                blend: 'screen',   opacity: 60,  base: 20, scale: 104, hue: 0,  rot: 0, rotate: false },
      { name: 'HALO',   open: false, react: 'lfo*0.18 . radial*0.55',            blend: 'over',     opacity: 70,  base: 30, scale: 110, hue: 6,  rot: 0, rotate: false },
      { name: 'MARKER', open: false, react: 'onset*0.90 . decay*0.20',           blend: 'multiply', opacity: 50,  base: 10, scale: 100, hue: 0,  rot: 0, rotate: false },
    ],
  };

  function readRows() {
    const rows = Array.from(document.querySelectorAll('#layers-list > details'));
    return rows.map((row) => {
      const inputs = row.querySelectorAll('input[type=range]');
      const text = row.querySelector('input[type=text], input:not([type])');
      const select = row.querySelector('select');
      const checkbox = row.querySelector('input[type=checkbox]');
      const name = (row.querySelector('span.text-white.font-medium') || {}).textContent || '';
      return {
        name,
        open: row.open,
        react: text ? text.value : '',
        blend: select ? select.value : 'over',
        opacity: parseFloat(inputs[0] && inputs[0].value || 100),
        base:    parseFloat(inputs[1] && inputs[1].value || 50),
        scale:   parseFloat(inputs[2] && inputs[2].value || 100),
        hue:     parseFloat(inputs[3] && inputs[3].value || 0),
        rot:     parseFloat(inputs[4] && inputs[4].value || 0),
        rotate:  checkbox ? checkbox.checked : false,
      };
    });
  }

  function applyRows(layers) {
    const rows = Array.from(document.querySelectorAll('#layers-list > details'));
    rows.forEach((row, i) => {
      const L = layers[i] || layers[0] || {};
      if (typeof L.open === 'boolean') row.open = L.open;
      const inputs = row.querySelectorAll('input[type=range]');
      if (L.opacity != null && inputs[0]) inputs[0].value = L.opacity;
      if (L.base    != null && inputs[1]) inputs[1].value = L.base;
      if (L.scale   != null && inputs[2]) inputs[2].value = L.scale;
      if (L.hue     != null && inputs[3]) inputs[3].value = L.hue;
      if (L.rot     != null && inputs[4]) inputs[4].value = L.rot;
      const text = row.querySelector('input[type=text], input:not([type])');
      if (L.react != null && text) text.value = L.react;
      const select = row.querySelector('select');
      if (L.blend != null && select) select.value = L.blend;
      const checkbox = row.querySelector('input[type=checkbox]');
      if (L.rotate != null && checkbox) checkbox.checked = !!L.rotate;
      // Update the displayed numeric value next to each slider
      const labels = row.querySelectorAll('div.flex.justify-between.label.mb-1 span:last-child');
      const vals = [L.opacity, L.base, L.scale, L.hue, L.rot];
      labels.forEach((lab, idx) => {
        if (lab && vals[idx] != null) {
          const v = vals[idx];
          lab.textContent = (typeof v === 'number' && v < 10) ? v.toFixed(2) : Math.round(v);
        }
      });
    });
  }

  function get() {
    return {
      format: 'smr-set',
      version: 1,
      name: 'Dashboard preset',
      exportedAt: new Date().toISOString(),
      layers: readRows(),
    };
  }

  function set(obj) {
    if (!obj || !Array.isArray(obj.layers)) return;
    applyRows(obj.layers);
  }

  function download() {
    const data = get();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.name || 'preset').replace(/\W+/g, '-').toLowerCase() + '.smr-set.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function applyFile(file) {
    if (!file) return;
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { console.warn('[smr-set] invalid JSON'); return; }
    if (!data || data.format !== 'smr-set' || !Array.isArray(data.layers)) {
      console.warn('[smr-set] not an smr-set file');
      return;
    }
    set(data);
  }

  // Wire DOM
  const saveBtn = document.getElementById('lib-save');
  const loadBtn = document.getElementById('lib-load');
  const fileInput = document.getElementById('lib-file');
  const clearBtn = document.getElementById('lib-clear');

  if (saveBtn) saveBtn.addEventListener('click', () => download());
  if (loadBtn && fileInput) {
    loadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) applyFile(f);
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', () => set(DEFAULT));

  window.__SWR_PRESETS = { get, set, download, applyFile, DEFAULT };
})();
