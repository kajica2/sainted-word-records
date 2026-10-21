// client/library-sheet.client.js — mobile-first bottom-sheet wrapper
// for the library panel.
//
// On phones (≤768px), the existing `<aside id="library">` (a flexbox
// sidebar in the engine grid) is unusable: it's narrow, scrolls
// poorly, and the asset thumbnails are too small to inspect.
//
// This module wraps the library as a draggable bottom sheet on mobile:
//   - adds a "≡ Library" toggle button (44×44 tap target)
//   - on open: backdrop + bottom sheet (rounded top corners, drag handle)
//   - on close: slide back down + backdrop fade
//   - safe-area-aware (home indicator padding)
//   - respects prefers-reduced-motion
//   - close on Escape, on backdrop tap, on route-change
//
// On tablet/desktop (≥769px), the toggle button is hidden and the
// library stays in its existing side-rail position — no behavior change.
//
// Public surface:
//
//   SWR_LIBRARY_SHEET = {
//     open(), close(), toggle(),
//     isOpen(), mount(), unmount(),
//     _ensureToggle(),   // helper to insert the toggle button
//   }

(function () {
  if (window.SWR_LIBRARY_SHEET) return;

  // ─── styles ────────────────────────────────────────────────────────────

  function ensureStyles() {
    if (document.getElementById('library-sheet-css')) return;
    const s = document.createElement('style');
    s.id = 'library-sheet-css';
    s.textContent = `
/* Mobile-first: library sheet. Desktop (≥769px) keeps the existing
   side-rail layout — these rules only fire on phones / small tablets. */

#library-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg, #e8e8f0);
  background: var(--panel-2, #1c1c22);
  border: 1px solid var(--line, #2a2a35);
  border-radius: 4px;
  padding: 0 12px;
  min-height: 44px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
#library-toggle:hover { background: rgba(255,255,255,0.05); border-color: var(--accent-2, #ff3d92); }
#library-toggle.is-open { background: var(--accent, #ff3d92); color: #fff; border-color: var(--accent); }

@media (max-width: 768px) {
  #library-toggle { display: inline-flex; }

  /* Pull the existing library out of the engine grid and pin it as a
     sheet. !important overrides the desktop grid-area / display rules
     that place the library as a side rail. */
  aside#library {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: auto !important;
    max-width: none !important;
    max-height: 78dvh !important;
    height: auto !important;
    aspect-ratio: auto !important;
    border-radius: 16px 16px 0 0 !important;
    border-left: none !important;
    border-top: 1px solid var(--line, #2a2a35) !important;
    border-right: none !important;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.5) !important;
    transform: translateY(100%) !important;
    transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
    z-index: 9990 !important;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  body.is-shown-library aside#library {
    transform: translateY(0) !important;
  }

  /* Backdrop overlay (mounted when sheet opens) */
  .swr-lib-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    z-index: 9989;
    animation: swr-lib-fade 0.2s ease-out;
  }
  @keyframes swr-lib-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Drag-handle pill on the library panel-head — mobile affordance */
  body.is-shown-library aside#library .panel-head {
    position: relative;
    padding-top: 22px;
  }
  body.is-shown-library aside#library .panel-head::before {
    content: '';
    position: absolute;
    top: 8px; left: 50%;
    transform: translateX(-50%);
    width: 40px; height: 4px;
    border-radius: 2px;
    background: rgba(255,255,255,0.2);
  }

  /* When the sheet is open, hide the engine grid behind it via a
     class on <body>; the backdrop CSS handles the dimming. */

  /* Touch-friendly bumps for the existing library controls */
  .lib-item { min-height: 96px; }                    /* thumbnails on mobile */
  .lib-item .name { font-size: 11px; padding: 4px 6px; }
  .lib-item .tag  { font-size: 9px; padding: 2px 5px; }
  .lib-use-as-song, .lib-rot, .lib-del { min-height: 44px; min-width: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  #library-toggle { transition: none; }
  aside#library { transition: none !important; }
  .swr-lib-backdrop { animation: none; }
}

/* A small badge on the toggle button shows the asset count */
#library-toggle .count {
  background: var(--accent, #ff3d92);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}
`.trim();
    document.head.appendChild(s);
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function isPhoneViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  }

  function backdrop_() {
    let bd = document.querySelector('.swr-lib-backdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.className = 'swr-lib-backdrop';
      bd.setAttribute('aria-hidden', 'true');
      bd.addEventListener('click', () => close());
      document.body.appendChild(bd);
    }
    return bd;
  }

  // ─── state ──────────────────────────────────────────────────────────────

  let open = false;
  let toggleBtn = null;
  let lastFocus = null;

  // ─── public API ────────────────────────────────────────────────────────

  function showSheet() {
    if (open) return;
    if (!isPhoneViewport()) return; // desktop uses the side rail as-is
    lastFocus = document.activeElement;
    open = true;
    backdrop_();
    document.body.classList.add('is-shown-library');
    if (toggleBtn) toggleBtn.classList.add('is-open');
    // Move focus into the sheet for keyboard users
    setTimeout(() => {
      const closeBtn = document.querySelector('aside#library [data-sheet-close]');
      if (closeBtn) closeBtn.focus();
    }, 50);
  }

  function hideSheet() {
    if (!open) return;
    open = false;
    document.body.classList.remove('is-shown-library');
    if (toggleBtn) toggleBtn.classList.remove('is-open');
    const bd = document.querySelector('.swr-lib-backdrop');
    if (bd) bd.remove();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function toggle() { open ? hideSheet() : showSheet(); }

  function isOpen() { return open; }

  // ─── toggle button ─────────────────────────────────────────────────────

  function ensureToggleBtn() {
    if (toggleBtn && toggleBtn.isConnected) return toggleBtn;
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'library-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-haspopup', 'dialog');
    toggleBtn.setAttribute('aria-label', 'Open library');
    toggleBtn.innerHTML = '<span aria-hidden="true">≡</span> Library <span class="count" data-lib-count></span>';
    toggleBtn.addEventListener('click', () => {
      if (!isPhoneViewport()) return;
      toggle();
    });
    refreshCount();
    // Place next to the layer-strip toggle if present (engine-keys.client.js
    // inserts one near #swr-keys-help-btn). Otherwise mount in body.
    const helpBtn = document.getElementById('swr-keys-help-btn');
    if (helpBtn && helpBtn.parentNode) {
      helpBtn.parentNode.insertBefore(toggleBtn, helpBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }
    return toggleBtn;
  }

  function refreshCount() {
    if (!toggleBtn) return;
    const span = toggleBtn.querySelector('[data-lib-count]');
    if (!span) return;
    const L = window.Library;
    const n = (L && Array.isArray(L.items)) ? L.items.length : 0;
    span.textContent = n > 0 ? String(n) : '';
  }

  // ─── lifecycle ────────────────────────────────────────────────────────

  function mount() {
    ensureStyles();
    if (!isPhoneViewport()) return; // desktop: side rail stays
    ensureToggleBtn();
    refreshCount();
    // Re-evaluate on viewport changes (rotation, resize across 768px)
    if (!window.__swrLibSheetViewportWatch) {
      window.__swrLibSheetViewportWatch = true;
      const mq = window.matchMedia('(max-width: 768px)');
      const onChange = () => {
        if (!isPhoneViewport()) {
          // Phone → desktop transition: close the sheet and unmount
          if (open) close();
          if (toggleBtn) toggleBtn.remove();
          toggleBtn = null;
        } else {
          ensureToggleBtn();
          refreshCount();
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      window.addEventListener('resize', onChange);
    }
    // Close on Escape
    if (!window.__swrLibSheetKey) {
      window.__swrLibSheetKey = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open) close();
      });
    }
  }

  function unmount() {
    if (toggleBtn) toggleBtn.remove();
    toggleBtn = null;
    if (open) close();
  }

  // ─── expose ──────────────────────────────────────────────────────────

  window.SWR_LIBRARY_SHEET = {
    open: showSheet,
    close: hideSheet,
    toggle, isOpen,
    mount, unmount,
    _ensureToggle: ensureToggleBtn,
  };

  // ─── auto-mount ──────────────────────────────────────────────────────

  function autoMount() {
    if (!document.getElementById('library')) return false;
    mount();
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoMount, 200));
  } else {
    setTimeout(autoMount, 200);
  }
})();