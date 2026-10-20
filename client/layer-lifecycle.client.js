// client/layer-lifecycle.client.js — Driver for /layer-lifecycle.html.
//
// Adds layers from the default library, draws them on a small canvas
// stage, and exposes Retire / Unretire / Home so the user can see the
// layer lifecycle without firing up the full engine. The actual layer
// model is the same `Layers` IIFE from lib/layers.client.js — we
// only differ in (a) using a canvas instead of WebGL postFX and
// (b) showing a layer list panel on the right.
//
// Contract preserved exactly:
//   - ret = Layers.retire(id, ms?)        → fades opacity → 0, scale → 0.4
//   - unr = Layers.unretire(id)            → restores opacity = 1, scale = 1
//   - home = Layers.homeAll(ms?)           → slides every layer to defaults
//   - add = Layers.add(asset)              → pushes a new layer onto the stack

(() => {
  'use strict';
  if (window.SWR_LL_PAGE) return;

  const DOM = window.document;
  const Layers = window.Layers;

  // ---- DOM -----------------------------------------------------------
  const canvas       = DOM.getElementById('ll-stage-canvas');
  const listEl       = DOM.getElementById('ll-list');
  const countEl      = DOM.getElementById('ll-count');
  const statusEl     = DOM.getElementById('ll-status');
  const addBtn       = DOM.getElementById('ll-add');
  const retireOldest = DOM.getElementById('ll-retire-oldest');
  const retireAll    = DOM.getElementById('ll-retire-all');
  const unretireAll  = DOM.getElementById('ll-unretire-all');
  const clearBtn     = DOM.getElementById('ll-clear');
  const homeBtn      = DOM.getElementById('ll-home');

  let statusTimer = 0;

  function status(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 1800);
  }

  // ---- Asset pool (cycled, not loaded from disk) ---------------------
  // 7 deterministic placeholder image blobs drawn into a tiny canvas.
  // We don't fetch the default library on this page — it's a self-
  // contained walkthrough, so an offline sandbox with empty network
  // would still show the lifecycle.
  const POOL = ['wave', 'grid', 'bar', 'dot', 'line', 'frame', 'trace'];
  let poolCursor = 0;
  function nextAsset() {
    const name = POOL[poolCursor++ % POOL.length];
    return makeHoloAsset(name);
  }
  // Build a 200×200 holo-style canvas and wrap it as a Blob-backed asset.
  function makeHoloAsset(name) {
    const c = DOM.createElement('canvas');
    c.width = 200; c.height = 200;
    const cx = c.getContext('2d');
    // background gradient with the asset's accent
    const hue = (POOL.indexOf(name) * 53) % 360;
    const g = cx.createLinearGradient(0, 0, 200, 200);
    g.addColorStop(0, 'hsl(' + (hue + 320) + ',80%,15%)');
    g.addColorStop(1, 'hsl(' + hue + ',80%,55%)');
    cx.fillStyle = g; cx.fillRect(0, 0, 200, 200);
    cx.fillStyle = 'rgba(255,255,255,.85)';
    cx.font = '600 28px monospace';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(name.toUpperCase(), 100, 100);
    const data = c.toDataURL('image/png');
    // Convert to a pseudo-URL the asset module accepts. We pass the
    // dataURL through `Layers.add`'s `asset.url` path — the engine
    // would cache as a Blob; here we keep it a string.
    return { id: 'll-' + name + '-' + Date.now(), name: name, type: 'image', url: data };
  }

  // ---- Stage render --------------------------------------------------
  let stage = { w: 0, h: 0 };
  function sizeStage() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * (window.devicePixelRatio || 1)));
    canvas.height = Math.max(1, Math.floor(r.height * (window.devicePixelRatio || 1)));
    stage = { w: r.width, h: r.height };
  }
  sizeStage();
  window.addEventListener('resize', () => { sizeStage(); render(); });

  function render() {
    if (!canvas.getContext) return;
    const cx = canvas.getContext('2d');
    cx.fillStyle = '#08080c';
    cx.fillRect(0, 0, canvas.width, canvas.height);
    if (!Layers || !Layers.list) return;
    // Draw layers z-order (lowest first; highest on top).
    const ordered = Layers.list.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const l of ordered) {
      const op = (l.opacity != null ? l.opacity : 1);
      if (op <= 0.001) continue;
      cx.globalAlpha = Math.max(0, Math.min(1, op));
      const sc = (l.baseScale || 1);
      const w = stage.w * 0.4 * sc;
      const h = stage.h * 0.4 * sc;
      const x = stage.w / 2 - w / 2 + (l.pos && l.pos.x ? l.pos.x : 0);
      const y = stage.h / 2 - h / 2 + (l.pos && l.pos.y ? l.pos.y : 0);
      // Draw the asset's image (or a placeholder rect if not loaded)
      if (l.asset && l.asset._img && l.asset._img.complete) {
        cx.drawImage(l.asset._img, x, y, w, h);
      } else {
        cx.fillStyle = '#3a3a4a';
        cx.fillRect(x, y, w, h);
      }
      cx.strokeStyle = op < 0.5 ? 'rgba(245,158,11,.6)' : 'rgba(56,189,248,.6)';
      cx.lineWidth = (op < 0.5 ? 1 : 1.5) * (window.devicePixelRatio || 1);
      cx.strokeRect(x, y, w, h);
    }
    cx.globalAlpha = 1;
  }
  // Cache Image elements so canvas drawImage works without flicker
  function hydrateImages() {
    if (!Layers || !Layers.list) return;
    for (const l of Layers.list) {
      if (!l.asset || l.asset.type !== 'image') continue;
      if (!l.asset._img) {
        const img = new Image();
        img.src = l.asset.url;
        img.onload = render;
        l.asset._img = img;
      }
    }
  }

  // Resync the panel view after Layers mutations
  function refresh() {
    if (!Layers || !Layers.list) return;
    countEl.textContent = '(' + Layers.list.length + ')';
    listEl.innerHTML = '';
    hydrateImages();
    for (let i = 0; i < Layers.list.length; i++) {
      const l = Layers.list[i];
      const div = DOM.createElement('div');
      div.className = 'layer-item' + (l._retired ? ' retired' : '');
      div.dataset.id = l.id;
      const num = DOM.createElement('span');
      num.className = 'num'; num.textContent = '#' + (i + 1);
      const name = DOM.createElement('span');
      name.className = 'name'; name.textContent = l.asset && l.asset.name || '?';
      const status = DOM.createElement('span');
      status.className = 'status ' + (l._retired ? 'retired' : 'live');
      status.textContent = l._retired ? 'RETIRED' : 'LIVE';
      div.appendChild(num); div.appendChild(name); div.appendChild(status);
      const meta = DOM.createElement('div');
      meta.className = 'meta';
      const op = (l.opacity || 0).toFixed(2);
      const sc = (l.baseScale || 0).toFixed(2);
      meta.textContent = 'opacity=' + op + ' baseScale=' + sc;
      div.appendChild(meta);
      listEl.appendChild(div);
    }
    render();
  }

  // ---- Action handlers -----------------------------------------------
  addBtn.addEventListener('click', () => {
    if (!Layers) return;
    Layers.add(nextAsset());
    status('added 1 layer');
    refresh();
  });
  retireOldest.addEventListener('click', () => {
    if (!Layers || !Layers.list || !Layers.list.length) { status('no layers'); return; }
    // Retire the bottom-most z (oldest in the stack)
    const oldest = Layers.list.slice().sort((a, b) => (a.z || 0) - (b.z || 0))[0];
    Layers.retire(oldest.id, 720);
    status('retired oldest layer');
    refresh();
  });
  retireAll.addEventListener('click', () => {
    if (!Layers || !Layers.list || !Layers.list.length) { status('no layers'); return; }
    for (const l of Layers.list) Layers.retire(l.id, 720);
    status('retired ' + Layers.list.length + ' layers');
    refresh();
  });
  unretireAll.addEventListener('click', () => {
    if (!Layers || !Layers.list || !Layers.list.length) { status('no layers'); return; }
    let n = 0;
    for (const l of Layers.list) if (l._retired) { Layers.unretire(l.id); n++; }
    status('unretired ' + n + ' layer(s)');
    refresh();
  });
  clearBtn.addEventListener('click', () => {
    if (!Layers) return;
    while (Layers.list && Layers.list.length) {
      Layers.remove(Layers.list[Layers.list.length - 1].id);
    }
    status('cleared');
    refresh();
  });
  homeBtn.addEventListener('click', () => {
    if (!Layers) return;
    Layers.homeAll(480);
    status('home: slide back to origin');
    refresh();
  });

  // Keyboard: 0 = home (per number-key-assignment plan)
  DOM.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.shiftKey) return;
    if (ev.key === '0' && !Layers._lockKeyNav) {
      homeBtn.click();
      ev.preventDefault();
    }
  });

  // ---- Hook into the existing render-loop so layer.tween updates paint
  // immediately, without waiting for another user action. We watch
  // rafCount and refresh every frame while a tween is in progress.
  let inTween = false;
  const watchTween = () => {
    const wasInTween = inTween;
    inTween = !!DOM.querySelector('.layer-item.retired') ? true :
              Layers.list.some((l) => l._animating) || (wasInTween && !document.hidden);
    // Actually simplest: just re-render every animation frame.
    if (Layers && Layers.list && Layers.list.length) {
      refresh();
    }
    requestAnimationFrame(watchTween);
  };
  Layers._lockKeyNav = false;
  requestAnimationFrame(watchTween);

  // Status line lives outside the engine's status manager, so use a
  // custom setter that the engine keys handler can call (cheap; doesn't
  // conflict with engine.html).
  window.SWR_LL_PAGE = { refresh, status };
})();
