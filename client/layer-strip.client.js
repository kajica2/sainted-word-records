// client/layer-strip.client.js — sibling UI to the main layer panel.
//
// A compact layer strip with thumbnail + visual rotate toggle + remove
// button per item. Sits next to the existing layer panel (or mounts as
// a floating element via the toggle button). Purely a view-side helper:
// the rotate is a CSS class toggle on the thumb (no impact on
// l.rotOffset or reactor output); the remove button delegates to the
// Layers.remove(...) so the deletion is book-keeping-safe.
//
// Loads after lib/layers.client.js so window.Layers is available.
//
// Public surface:
//
//   window.SWR_LAYER_STRIP = {
//     mount(parentEl?),     // insert strip into parent (default: #layers)
//     unmount(),            // remove from DOM
//     refresh(),            // re-render with current Layers.list
//     open() / close(),      // show / hide the panel
//     isOpen() { return open; },
//   };

(function () {
  if (window.SWR_LAYER_STRIP) return;

  // ---- styles (scoped via .layer-strip prefix; no global rules) ----
  function ensureStyles() {
    if (document.getElementById('layer-strip-css')) return;
    const s = document.createElement('style');
    s.id = 'layer-strip-css';
    s.textContent = `
.layer-strip { display:flex; flex-direction:column; gap:6px; padding:6px; }
.layer-strip .ls-head { display:flex; align-items:center; gap:8px; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-2,#aaa); padding:0 4px; }
.layer-strip .ls-list { display:flex; flex-direction:column; gap:4px; max-height:300px; overflow-y:auto; }
.layer-strip .li { display:grid; grid-template-columns:48px 1fr auto; align-items:center; gap:6px; padding:6px 8px; border:1px solid var(--border,#333); border-radius:6px; background:rgba(255,255,255,.02); cursor:pointer; transition:background .15s ease; }
.layer-strip .li:hover { background:rgba(255,255,255,.06); }
/* A layer whose group is hidden does not draw — dim its row so the
   strip agrees with the layer panel and the stage. */
.layer-strip .li.hidden { opacity:.42; }
.layer-strip .li.hidden .nm { text-decoration:line-through; }
.layer-strip .li .thumb { width:48px; height:36px; object-fit:cover; border-radius:4px; background:var(--surface-2,#222); transform:rotate(0deg); transition:transform .15s ease; display:block; }
.layer-strip .li .thumb.rotated { transform:rotate(90deg); }
/* Placeholder when no thumb/coverUrl exists — a subtle dash on the
   panel surface so the row layout is intact and the user knows the
   slot is there (asset missing or pruned). */
.layer-strip .li .thumb.placeholder {
  display:flex;
  align-items:center;
  justify-content:center;
  color: var(--text-2, #888);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  background: var(--surface-2, #222);
  cursor: pointer;
  transform: rotate(0deg) !important;  /* don't rotate the dash */
}
.layer-strip .li .thumb.placeholder.rotated { transform: rotate(0deg) !important; }
.layer-strip .li .nm { font-size:11px; color:var(--text-1,#eee); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.layer-strip .li .act { display:flex; gap:4px; }
.layer-strip .li .act span { width:24px; height:22px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--border,#333); border-radius:4px; background:transparent; color:var(--text-2,#aaa); cursor:pointer; font-size:14px; line-height:1; user-select:none; }
.layer-strip .li .act span:hover { color:var(--text-1,#eee); border-color:var(--accent,#f0c); }
.layer-strip .li .act span.rot.on { color:var(--accent); border-color:var(--accent); }
.layer-strip .ls-empty { color:var(--text-2,#888); font-size:11px; padding:8px; text-align:center; }
    `.trim();
    document.head.appendChild(s);
  }

  // ---- DOM helpers ----
  function el(tag, cls, htmlContent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (htmlContent != null) e.innerHTML = htmlContent;
    return e;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- render one item ----
  function buildItem(layer, thumbnail) {
    const item = el('div', 'li');
    item.dataset.id = layer.id;
    // A hidden layer (its group is hidden) does not draw on the stage.
    // The strip mirrors the layer panel, so it dims those rows too —
    // otherwise a hidden layer still looks like it is on the stage.
    if (layer.hidden) item.classList.add('hidden');

    // Thumbnail cell. When the asset has a real thumb/coverUrl, render
    // an <img class="thumb">. Otherwise render a placeholder cell so the
    // layout doesn't collapse and the user doesn't see a broken-image
    // icon. The cell is still a tap target for the layer card.
    let thumbCell;
    if (thumbnail) {
      thumbCell = el('img');
      thumbCell.src = thumbnail;
      thumbCell.alt = '';
      thumbCell.className = 'thumb';
      thumbCell.loading = 'lazy';
    } else {
      // Empty asset (no asset yet, or the asset was pruned). The asset
      // name + tag are the only signal the user has — show a clean
      // placeholder so the row isn't visually broken.
      thumbCell = el('div', 'thumb placeholder');
      thumbCell.setAttribute('aria-hidden', 'true');
      thumbCell.textContent = '—';
    }

    const name = el('span', 'nm', escapeHtml(layer.name || '(empty)'));

    const actWrap = el('span', 'act');

    // Rotate: visual toggle. Click anywhere on .li to also focus the layer.
    const rotBtn = el('span', 'rot');
    rotBtn.dataset.id = layer.id;
    rotBtn.title = 'Rotate';
    rotBtn.textContent = '↻';
    // Track whether currently rotated (mirrors thumbCell.rotated class).
    // The CSS only animates when thumbCell is an <img>; the placeholder
    // div has no visual rotation but the class toggle is harmless.
    let rotatedOn = false;
    rotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rotatedOn = !rotatedOn;
      thumbCell.classList.toggle('rotated', rotatedOn);
      rotBtn.classList.toggle('on', rotatedOn);
      // Optional: also toggle a preview video if the layer has one.
      // Layers don't currently expose `previewVideo`, so this is a
      // future-proof hook — kept null-safe.
      if (layer && layer.previewVideo) {
        layer.previewVideo.classList.toggle('rotated', rotatedOn);
      }
    });

    // Remove: delegate to the Layers.remove() which is book-keeping safe
    // (refuses if the layer is on stage; user removes the layer first).
    const rmBtn = el('span', 'rm');
    rmBtn.dataset.id = layer.id;
    rmBtn.title = 'Remove';
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const L = window.Layers;
      if (L && typeof L.remove === 'function') L.remove(layer.id);
    });

    // Build the action row in the order: rotate, remove (matching the
    // user's snippet where `rot` precedes `rm`).
    actWrap.appendChild(rotBtn);
    actWrap.appendChild(rmBtn);

    // 3-column grid: thumb | name | actions
    item.appendChild(thumbCell);
    item.appendChild(name);
    item.appendChild(actWrap);

    // Click on the row (but not in the act cells) — focus the layer.
    item.addEventListener('click', () => {
      const L = window.Layers;
      if (L && typeof L.select === 'function') L.select(layer);
    });

    return item;
  }

  // ---- main module ----
  let host = null;        // outer container
  let listEl = null;      // .ls-list
  let open = false;
  let toggleBtn = null;   // floating toggle button (created by mount)
  let layersHook = null;   // Layers.render interception

  function refresh() {
    if (!listEl) return;
    listEl.innerHTML = '';
    const L = window.Layers;
    const layers = (L && Array.isArray(L.list)) ? L.list : [];
    if (!layers.length) {
      listEl.appendChild(el('div', 'ls-empty', 'no layers yet — drop an asset on the stage'));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const layer of layers) {
      // Pull the thumbnail from the asset (if any). Use coverUrl first
      // (matches library.client.js precedence: cover > thumb > bare video).
      const it = layer.asset || {};
      const thumbnail = it.coverUrl
                        || it.thumb
                        || (it.url ? it.url : '');
      frag.appendChild(buildItem(layer, thumbnail));
    }
    listEl.appendChild(frag);
  }

  function buildHost() {
    const h = el('div', 'layer-strip');
    const head = el('div', 'ls-head');
    head.appendChild(el('span', null, `LAYER STRIP · ${countLayers()} layers`));
    const refreshBtn = el('button');
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Refresh';
    refreshBtn.style.cssText = 'background:transparent;border:1px solid var(--border,#333);color:var(--text-2);padding:1px 6px;border-radius:3px;cursor:pointer;';
    refreshBtn.addEventListener('click', refresh);
    head.appendChild(refreshBtn);
    listEl = el('div', 'ls-list');
    h.appendChild(head);
    h.appendChild(listEl);
    return h;
  }

  function countLayers() {
    const L = window.Layers;
    return (L && Array.isArray(L.list)) ? L.list.length : 0;
  }

  function mount(parentEl) {
    ensureStyles();
    if (host && host.isConnected) {
      // Already mounted — just refresh.
      refresh();
      return host;
    }
    host = buildHost();
    parentEl = parentEl || document.getElementById('layers') || document.body;
    parentEl.appendChild(host);
    refresh();
    // Subscribe to Layers.render so the strip stays live.
    hookLayers();
    return true;
  }

  function unmount() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    listEl = null;
    if (toggleBtn && toggleBtn.parentNode) toggleBtn.parentNode.removeChild(toggleBtn);
    toggleBtn = null;
    if (layersHook) {
      const L = window.Layers;
      if (L && typeof L.render === 'function') {
        L.render = layersHook.original || L.render;
      }
      layersHook = null;
    }
  }

  function openPanel() {
    if (!host || !host.isConnected) mount();
    if (host) host.style.display = '';
    open = true;
    refresh();
  }

  function closePanel() {
    if (host && host.isConnected) host.style.display = 'none';
    open = false;
  }

  // Wrap Layers.render so any per-frame render triggers a strip refresh.
  // The strip is light (a handful of short labels) — refreshing every frame
  // is fine.
  function hookLayers() {
    const L = window.Layers;
    if (!L || typeof L.render !== 'function') return;
    if (L.render.__swr_layer_strip_wrapped) return;
    const orig = L.render.bind(L);
    L.render = function wrapped() {
      const r = orig.apply(null, arguments);
      try { refresh(); } catch (_) {}
      return r;
    };
    L.render.__swr_layer_strip_wrapped = true;
    layersHook = { original: orig };
  }

  // Floating toggle button — the strip mounts into #layers by default,
  // but the toggle button can sit anywhere (typically the engine header).
  function ensureToggleBtn() {
    if (toggleBtn && toggleBtn.isConnected) return toggleBtn;
    toggleBtn = el('button');
    toggleBtn.textContent = '≡ Layers';
    toggleBtn.title = 'Toggle the layer strip (thumbnails + remove)';
    toggleBtn.style.cssText = 'background:var(--surface,#222);border:1px solid var(--border,#333);color:var(--text-1,#eee);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:var(--font-mono);';
    toggleBtn.addEventListener('click', () => open ? closePanel() : openPanel());
    // The engine.html doesn't have a dedicated header slot — mount the
    // toggle into the keys-help button's row when available.
    const helpBtn = document.getElementById('swr-keys-help-btn');
    if (helpBtn && helpBtn.parentNode) {
      helpBtn.parentNode.insertBefore(toggleBtn, helpBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }
    return toggleBtn;
  }

  window.SWR_LAYER_STRIP = {
    mount,
    unmount,
    refresh,
    open: openPanel,
    close: closePanel,
    isOpen: () => open,
    _ensureToggle: ensureToggleBtn,
  };

  // Auto-attach when the engine loads if #layers exists. The toggle
  // button is opt-in — call SWR_LAYER_STRIP._ensureToggle() explicitly.
  function autoMount() {
    if (!document.getElementById('layers')) return false;
    mount();
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoMount, 200));
  } else {
    setTimeout(autoMount, 200);
  }
})();