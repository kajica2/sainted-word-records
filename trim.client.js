// trim.client.js — per-asset trim points + playback rate editor.
// Opens a popover when a library card is right-clicked or long-pressed.
// Stores data on asset.trim = { in: seconds, out: seconds, rate: 1.0 }.
//
// The engine itself doesn't apply trim automatically yet — that's a separate
// engine change. This module is the UI + persistence: user defines the trim,
// asset.trim is populated, and downstream code (Recorder export, future
// playback loop) can read it.

(function () {
  if (window.TrimEditor) return;  // idempotent

  // ---- State ----
  const state = {
    activeAssetId: null,
    popover: null,
    peaks: null,         // Float32Array for the trim preview waveform
    duration: 0,
  };

  function getAsset(id) {
    const SWR = window.SWR;
    const Library = SWR && SWR.Library;
    return Library && Library.byId ? Library.byId(id) : null;
  }

  function getAudioEl() {
    const SWR = window.SWR;
    const Audio = SWR && SWR.Audio;
    return Audio && Audio.audioEl ? Audio.audioEl : null;
  }

  function ensureTrim(asset) {
    if (!asset.trim) {
      asset.trim = {
        in:  0,
        out: asset.duration || 0,
        rate: 1.0,
      };
    }
    return asset.trim;
  }

  // ---- Popover ----
  function buildPopover() {
    if (state.popover) return state.popover;
    const p = document.createElement('div');
    p.id = 'trim-popover';
    p.style.cssText = [
      'position:absolute', 'z-index:10000',
      'background:rgba(15,15,20,0.97)', 'color:#eee',
      'border:1px solid #444', 'border-radius:8px',
      'padding:12px 14px', 'min-width:280px', 'max-width:340px',
      'box-shadow:0 6px 24px rgba(0,0,0,0.6)',
      'font:11px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'display:none',
    ].join(';');
    p.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <strong style="font-size:11px;letter-spacing:0.04em;">✂  TRIM</strong>
        <span id="trim-name" style="color:#888;font-size:10px;margin-left:6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
        <button id="trim-close" title="Close" style="background:transparent;border:0;color:#888;cursor:pointer;font-size:14px;line-height:1;">×</button>
      </div>
      <canvas id="trim-canvas" style="display:block;width:100%;height:48px;background:#000;border-radius:4px;cursor:crosshair;"></canvas>
      <div id="trim-times" style="display:flex;justify-content:space-between;font-family:monospace;font-size:10px;color:#aaa;margin-top:4px;">
        <span id="trim-in-t">in: 0.00s</span>
        <span id="trim-dur-t">dur: —</span>
        <span id="trim-out-t">out: —</span>
      </div>
      <div style="margin-top:10px;">
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:60px;">rate</span>
          <input type="range" id="trim-rate" min="0.25" max="2" step="0.05" value="1" style="flex:1;">
          <b id="trim-rate-v" style="font-family:monospace;width:42px;text-align:right;">1.00×</b>
        </label>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        <button id="trim-reset" style="flex:1;padding:5px;background:#222;color:#ddd;border:1px solid #444;border-radius:5px;cursor:pointer;">Reset</button>
        <button id="trim-preview" style="flex:1;padding:5px;background:#222;color:#ddd;border:1px solid #444;border-radius:5px;cursor:pointer;">Preview</button>
      </div>
      <div style="margin-top:8px;font-size:10px;color:#888;">
        Click waveform to set IN. Shift-click to set OUT.
      </div>
    `;
    document.body.appendChild(p);

    // Close button
    p.querySelector('#trim-close').addEventListener('click', closePopover);

    // Drag handles for in/out on the waveform
    const canvas = p.querySelector('#trim-canvas');
    canvas.addEventListener('click', (e) => {
      if (!state.activeAssetId) return;
      const asset = getAsset(state.activeAssetId);
      if (!asset) return;
      const t = ensureTrim(asset);
      const dur = state.duration || (asset.duration || 1);
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = (x / rect.width) * dur;
      if (e.shiftKey) {
        t.out = Math.max(t.in + 0.05, Math.min(dur, time));
      } else {
        t.in = Math.max(0, Math.min(t.out - 0.05, time));
      }
      updatePopoverUI();
    });

    // Rate slider
    p.querySelector('#trim-rate').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      const valEl = p.querySelector('#trim-rate-v');
      if (valEl) valEl.textContent = v.toFixed(2) + '×';
      if (state.activeAssetId) {
        const asset = getAsset(state.activeAssetId);
        if (asset) ensureTrim(asset).rate = v;
      }
    });

    // Reset
    p.querySelector('#trim-reset').addEventListener('click', () => {
      if (!state.activeAssetId) return;
      const asset = getAsset(state.activeAssetId);
      if (!asset) return;
      asset.trim = { in: 0, out: asset.duration || 0, rate: 1.0 };
      updatePopoverUI();
    });

    // Preview — seek audioEl to in-point, play
    p.querySelector('#trim-preview').addEventListener('click', () => {
      const audioEl = getAudioEl();
      if (!audioEl || !state.activeAssetId) return;
      const asset = getAsset(state.activeAssetId);
      if (!asset) return;
      const t = ensureTrim(asset);
      audioEl.currentTime = t.in;
      audioEl.play().catch(() => {});
      // Auto-pause at out-point
      const check = () => {
        if (audioEl.currentTime >= t.out) {
          audioEl.pause();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });

    state.popover = p;
    return p;
  }

  function updatePopoverUI() {
    if (!state.popover || !state.activeAssetId) return;
    const asset = getAsset(state.activeAssetId);
    if (!asset) return;
    const t = ensureTrim(asset);

    const p = state.popover;
    p.querySelector('#trim-name').textContent = asset.name;
    p.querySelector('#trim-rate').value = String(t.rate);
    p.querySelector('#trim-rate-v').textContent = t.rate.toFixed(2) + '×';

    // Update time labels
    const dur = state.duration || (asset.duration || 0);
    p.querySelector('#trim-in-t').textContent  = `in: ${t.in.toFixed(2)}s`;
    p.querySelector('#trim-out-t').textContent = `out: ${t.out.toFixed(2)}s`;
    p.querySelector('#trim-dur-t').textContent = `dur: ${dur.toFixed(2)}s`;

    // Redraw waveform with handles
    drawWaveform();
  }

  function drawWaveform() {
    if (!state.popover || !state.activeAssetId) return;
    const canvas = state.popover.querySelector('#trim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 280;
    const H = canvas.clientHeight || 48;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const asset = getAsset(state.activeAssetId);
    if (!asset) return;
    const t = ensureTrim(asset);
    const dur = state.duration || (asset.duration || 1);

    // Waveform (downsampled state.peaks or fallback flat)
    const peaks = state.peaks;
    const midY = H / 2;
    if (peaks && peaks.length) {
      const step = peaks.length / W;
      ctx.fillStyle = '#7e6cff';
      for (let x = 0; x < W; x++) {
        const i0 = Math.floor(x * step);
        const i1 = Math.floor((x + 1) * step);
        let max = 0;
        for (let i = i0; i < i1 && i < peaks.length; i++) {
          if (peaks[i] > max) max = peaks[i];
        }
        const h = Math.max(1, max * (H * 0.45));
        ctx.fillRect(x, midY - h, 1, h * 2);
      }
    } else {
      // Fallback: flat mid line so user can still see in/out
      ctx.fillStyle = '#333';
      ctx.fillRect(0, midY - 1, W, 2);
    }

    // Dimmed out-of-trim regions
    const inX  = (t.in  / dur) * W;
    const outX = (t.out / dur) * W;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0,     0, inX,  H);
    ctx.fillRect(outX,  0, W - outX, H);

    // In / Out handles
    ctx.strokeStyle = '#7f7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(inX, 0); ctx.lineTo(inX, H); ctx.stroke();
    ctx.strokeStyle = '#f77';
    ctx.beginPath(); ctx.moveTo(outX, 0); ctx.lineTo(outX, H); ctx.stroke();
  }

  function openPopover(asset, clickEvent) {
    const p = buildPopover();
    state.activeAssetId = asset.id;
    p.style.display = 'block';

    // Position near the clicked card
    let left = clickEvent.clientX + 12;
    let top = clickEvent.clientY + 12;
    const rect = p.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 14;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 14;
    p.style.left = left + 'px';
    p.style.top = top + 'px';

    ensureTrim(asset);
    // Use the song's audioEl duration if asset has no duration of its own
    const audioEl = getAudioEl();
    state.duration = asset.duration || (audioEl ? audioEl.duration : 0) || 0;
    // For waveform display, reuse the song's peaks (we don't decode the asset).
    // If you want per-asset peaks later, decode each asset separately.
    if (window.Timeline && window.Timeline.state && window.Timeline.state.peaks) {
      state.peaks = window.Timeline.state.peaks;
    }

    updatePopoverUI();
  }

  function closePopover() {
    if (state.popover) state.popover.style.display = 'none';
    state.activeAssetId = null;
  }

  // ---- Hook library cards: right-click or long-press ----
  function hookLibrary() {
    const grid = document.getElementById('library-grid');
    if (!grid) return;
    // Delegate so we don't re-bind on every render
    grid.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.lib-item');
      if (!card) return;
      e.preventDefault();
      const asset = getAsset(parseInt(card.dataset.id, 10));
      if (asset) openPopover(asset, e);
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!state.popover || state.popover.style.display === 'none') return;
      if (state.popover.contains(e.target)) return;
      if (e.target.closest('.lib-item')) return;
      closePopover();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.popover && state.popover.style.display !== 'none') {
        closePopover();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookLibrary);
  } else {
    setTimeout(hookLibrary, 100);
  }

  window.TrimEditor = { state, getTrim: ensureTrim, open: openPopover, close: closePopover };
})();