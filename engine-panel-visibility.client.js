// engine-panel-visibility.client.js — shared hide/show for the 3 floating
// panels (LFO, TIMING, AUTO-SWAP / layer-scheduler). Loaded BEFORE the
// individual panel builders so they can read the initial state.
//
// State lives in localStorage['swr.panels-hidden']:
//   '1' (default) = panels hidden by default
//   '0'           = panels visible
//
// All three panels opt in by listening for the 'swr:panels-visibility' event
// or by calling window.SWR_PANEL_VISIBILITY.apply() after they mount.
//
// Exposes:
//   window.SWR_PANEL_VISIBILITY = {
//     isHidden()           — current state (boolean)
//     setHidden(bool)      — persist + apply + broadcast
//     apply()              — toggle display on every .ls-panel and the layer-scheduler panel
//     toggle()             — flip state
//     onChange(fn)         — subscribe to changes
//   }
//
// Idempotent: safe to load multiple times.

(function () {
  if (window.SWR_PANEL_VISIBILITY) return;

  const KEY = 'swr.panels-hidden';
  // Selector covers all known floating panels. Add new ones here as they appear.
  const SELECTOR = [
    '#ls-panel-lfo',
    '#ls-panel-timing',
    '#layer-scheduler-panel',
    '.ls-panel'  // belt-and-braces for any future ls-panel-* panels
  ].join(', ');

  const listeners = new Set();

  function readStored() {
    try {
      const v = localStorage.getItem(KEY);
      // Default to hidden ('1') when nothing is stored.
      if (v === null) return true;
      return v === '1';
    } catch (_) {
      return true;
    }
  }

  function writeStored(hidden) {
    try {
      localStorage.setItem(KEY, hidden ? '1' : '0');
    } catch (_) {
      // Private mode / disabled storage — fall through silently.
    }
  }

  function apply() {
    const hidden = readStored();
    document.documentElement.setAttribute('data-panels-hidden', hidden ? '1' : '0');
    const nodes = document.querySelectorAll(SELECTOR);
    nodes.forEach((el) => {
      el.style.display = hidden ? 'none' : '';
    });
    return hidden;
  }

  function broadcast(hidden) {
    listeners.forEach((fn) => {
      try { fn(hidden); } catch (_) { /* swallow listener errors */ }
    });
    // Custom event for inline handlers.
    try {
      window.dispatchEvent(new CustomEvent('swr:panels-visibility', { detail: { hidden } }));
    } catch (_) { /* CustomEvent unavailable in ancient browsers — fine */ }
  }

  // Re-apply whenever the DOM changes (new panels may mount after us).
  // Use a throttled observer so a flurry of mutations doesn't thrash.
  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  function attachObserver() {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(scheduleApply);
    mo.observe(document.body, { childList: true, subtree: false });
  }

  window.SWR_PANEL_VISIBILITY = {
    isHidden: readStored,
    setHidden(hidden) {
      const h = !!hidden;
      writeStored(h);
      apply();
      broadcast(h);
    },
    apply,
    toggle() {
      const next = !readStored();
      writeStored(next);
      apply();
      broadcast(next);
      return next;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    SELECTOR
  };

  // Apply on every page load (panels that mount BEFORE this script ran
  // will already exist; panels that mount AFTER will be picked up by the
  // MutationObserver).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(); attachObserver(); });
  } else {
    apply();
    attachObserver();
  }
})();
