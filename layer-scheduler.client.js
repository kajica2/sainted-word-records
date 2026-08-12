// layer-scheduler.client.js
// Main-thread glue between the layer-scheduler Web Worker and the rest of the app.
// Boots the worker, forwards Library.items (videos) as the swap pool, applies the
// worker's swap commands to a Layers list, and adds a tiny UI panel.
//
// Drop-in: include this script after the main app IIFE. It exposes
// `window.LayerScheduler` for manual control.

(function () {
  if (window.LayerScheduler) return;  // idempotent

  // ---- Worker ----
  // Resolve the worker URL relative to this module so Vite can bundle it.
  // `new URL(name, import.meta.url)` is the Vite-recommended pattern for worker
  // loading from a module — it survives both `vite dev` and `vite build`.
  const worker = new Worker(new URL('./layer-scheduler.worker.js', import.meta.url));

  // ---- State ----
  const state = {
    enabled: false,
    minSeconds: 5,
    maxSeconds: 10,
    beatSync: false,
    poolIds: [],
    lastSwapAt: 0,
    swapCount: 0,
  };

  // ---- Helpers ----
  function post(msg) { worker.postMessage(msg); }

  // The main app IIFE exposes its singletons as `window.SWR = { Audio, Library, Layers, Renderer, Recorder, UI }`.
  // Fall back to direct globals only if SWR is missing (older builds).
  function app() { return window.SWR || {}; }
  const getLibrary = () => app().Library;
  const getLayers = () => app().Layers;
  const getAudio = () => app().Audio;

  function refreshPool() {
    const Library = getLibrary();
    const items = (Library && Library.items) || [];
    const ids = items
      .filter(it => it && it.id && it.url)
      .map(it => it.id);
    state.poolIds = ids;
    post({ type: 'setPool', ids });
  }

  function findLayerByIndex(idx) {
    const Layers = getLayers();
    const list = (Layers && Layers.list) || [];
    if (!list.length) return null;
    if (idx < 0 || idx >= list.length) {
      return list[Math.floor(Math.random() * list.length)];
    }
    return list[idx];
  }

  function applySwap({ assetId, layerIndex }) {
    const Layers = getLayers();
    const Library = getLibrary();
    const Audio = getAudio();
    if (!Layers || !Library) return false;
    const items = Library.items || [];
    const asset = items.find(i => i.id === assetId);
    if (!asset) return false;
    const layer = findLayerByIndex(layerIndex === -1 ? -1 : layerIndex);
    if (!layer) return false;
    // Swap the asset in place. Keep existing reactors/blend/scale/opacity so the
    // visual energy signature stays, but the asset changes.
    layer.asset = asset;
    // Refresh reactors to match the new asset's motion/luma profile
    // pickReactors lives in the main IIFE; reach it via SWR if exposed, else skip.
    if (Audio && Audio.feat) {
      // Reuse existing reactors — they were tuned for the role, not the asset,
      // and re-picking every swap would cause visual jitter.
    }
    if (Layers.render) Layers.render();
    state.lastSwapAt = Date.now();
    state.swapCount++;
    // Best-effort status update via SWR.UI if present
    const UI = app().UI;
    if (UI && typeof UI.setStatus === 'function') {
      UI.setStatus('auto-swapped → ' + asset.name, 'ok');
    }
    return true;
  }

  worker.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'swap') applySwap(msg);
  };

  // ---- UI panel ----
  function buildUI() {
    if (document.getElementById('layer-scheduler-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'layer-scheduler-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:14px', 'right:14px', 'z-index:9999',
      'background:rgba(15,15,20,0.92)', 'color:#eee',
      'border:1px solid #333', 'border-radius:10px',
      'padding:10px 12px', 'font:12px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,0.4)', 'user-select:none',
      'min-width:220px', 'max-width:280px'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <strong style="font-size:12px;letter-spacing:0.04em;">⏱ AUTO-SWAP</strong>
        <span id="ls-status" style="margin-left:auto;font-size:10px;color:#888;">off</span>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0;">
        <input type="checkbox" id="ls-enable" />
        <span>Enable (swap layers every 5–10s)</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0;">
        <span style="width:62px;">min s</span>
        <input type="number" id="ls-min" min="1" max="60" step="1" value="5" style="width:60px;">
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0;">
        <span style="width:62px;">max s</span>
        <input type="number" id="ls-max" min="1" max="120" step="1" value="10" style="width:60px;">
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0;">
        <input type="checkbox" id="ls-beat" />
        <span>beat-sync (4 bars)</span>
      </label>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button id="ls-refresh" style="flex:1;padding:4px 8px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;">refresh pool</button>
        <button id="ls-swapnow" style="flex:1;padding:4px 8px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;">swap now</button>
      </div>
      <div id="ls-stats" style="margin-top:6px;font-size:10px;color:#888;">pool: 0 · swaps: 0</div>
    `;

    document.body.appendChild(panel);

    const $ = (id) => document.getElementById(id);
    const enable = $('ls-enable');
    const minIn = $('ls-min');
    const maxIn = $('ls-max');
    const beatIn = $('ls-beat');
    const status = $('ls-status');
    const stats = $('ls-stats');

    function pushConfig() {
      const min = Math.max(1, parseInt(minIn.value, 10) || 5);
      const max = Math.max(min, parseInt(maxIn.value, 10) || 10);
      state.minSeconds = min;
      state.maxSeconds = max;
      state.beatSync = beatIn.checked;
      state.enabled = enable.checked;
      post({
        type: 'config',
        cfg: {
          enabled: state.enabled,
          minMs: state.minSeconds * 1000,
          maxMs: state.maxSeconds * 1000,
          beatSync: state.beatSync,
          bpm: (getAudio() && getAudio().bpm) || 120,
          beatsPerSwap: 16,
        },
      });
      status.textContent = state.enabled ? 'on · ' + state.minSeconds + '–' + state.maxSeconds + 's' : 'off';
      status.style.color = state.enabled ? '#7f7' : '#888';
    }

    enable.addEventListener('change', pushConfig);
    minIn.addEventListener('change', pushConfig);
    maxIn.addEventListener('change', pushConfig);
    beatIn.addEventListener('change', pushConfig);

    $('ls-refresh').addEventListener('click', () => {
      refreshPool();
      updateStats();
    });

    $('ls-swapnow').addEventListener('click', () => {
      // Force a swap immediately by toggling the timer off+on with min/max=0
      post({ type: 'config', cfg: { enabled: true, minMs: 50, maxMs: 50, beatSync: false } });
      setTimeout(pushConfig, 200);  // restore normal config
    });

    function updateStats() {
      stats.textContent = 'pool: ' + state.poolIds.length + ' · swaps: ' + state.swapCount;
    }
    setInterval(updateStats, 1000);

    // Initial pool build — wait a tick so Library is defined
    setTimeout(() => { refreshPool(); updateStats(); }, 300);
  }

  // ---- Public API ----
  window.LayerScheduler = {
    start() {
      enableCheckbox(true);
      pushCurrentConfig();
    },
    stop() {
      enableCheckbox(false);
      pushCurrentConfig();
    },
    refreshPool,
    setRange(minS, maxS) {
      document.getElementById('ls-min').value = minS;
      document.getElementById('ls-max').value = maxS;
      pushCurrentConfig();
    },
    swapNow() {
      document.getElementById('ls-swapnow').click();
    },
    state,
    worker,
  };

  function enableCheckbox(v) {
    const el = document.getElementById('ls-enable');
    if (el) el.checked = v;
  }
  function pushCurrentConfig() {
    const el = document.getElementById('ls-enable');
    if (el) el.dispatchEvent(new Event('change'));
  }

  // ---- Boot UI when DOM is ready ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();