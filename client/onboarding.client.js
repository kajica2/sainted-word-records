// client/onboarding.client.js - feedback + progressive next-step guide.
//
// Two surfaces, both opt-in via presence of #c-onboard on the page:
//
//   1. Toast stack / a transient bottom-centered slot for action
//      feedback ("clip added", "filter applied", "audio loaded").
//      Each toast auto-dismisses after 2.2s. Errors stay until
//      manually dismissed. The slot is appended to document.body.
//
//   2. Next-step pill / a small persistent card (positioned top-right
//      on mobile, below the HUD) that says what the user should do
//      next. Tapping it executes the suggested action. The pill
//      progress-tracks: each completed step adds a checkmark.
//
// State model (window.SWR_ONBOARD.state):
//   {
//     audioLoaded,      // song loadFile completed
//     firstLayerAdded,  // at least one layer in the stack
//     filterApplied,    // SWR_LOOK_FILTER_CYCLER.apply(n>0) observed
//     presetSaved,      // user saved a preset (via toast / event)
//     librarySaved,     // user saved the library (toast / event)
//   }
//
// When all five are true, the pill collapses to "all set" and stops
// prompting. State persists in localStorage under swr.onboard.v1 so
// the tour only fires once per device.

(function () {
  'use strict';
  if (window.SWR_ONBOARD) return;
  const STORAGE_KEY = 'swr.onboard.v1';

  // ---- State ----
  const subscribers = new Set();
  let state = loadState();
  function loadState() {
    const fallback = {
      audioLoaded: false,
      firstLayerAdded: false,
      filterApplied: false,
      presetSaved: false,
      librarySaved: false,
    };
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return fallback;
      // Merge so a new step type on this page doesn't blank existing
      // state.
      return Object.assign({}, fallback, raw);
    } catch (_) { return fallback; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function set(patch) {
    const prev = state;
    const next = Object.assign({}, prev, patch);
    // Only commit if something actually changed
    let changed = false;
    for (const k in patch) {
      if (prev[k] !== next[k]) { changed = true; break; }
    }
    if (!changed) return false;
    state = next;
    saveState();
    for (const fn of subscribers) {
      try { fn(state, prev); } catch (_) {}
    }
    return true;
  }

  // ---- Toast stack ----
  // The toast system is its own concern. Each toast is a small bottom
  // bar that animates in, holds for 2.2s, then animates out. Errors
  // stick until tapped (because the user needs to see what broke).
  const toasts = []; // active toasts
  let toastHost = null;
  function ensureToastHost() {
    if (toastHost) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'swr-toasts';
    toastHost.setAttribute('aria-live', 'polite');
    toastHost.setAttribute('aria-atomic', 'false');
    toastHost.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(env(safe-area-inset-bottom,0px) + 96px)',
      'display:flex', 'flex-direction:column-reverse', 'gap:6px',
      'z-index:60', 'pointer-events:none',
      'max-width:calc(100vw - 24px)', 'width:max-content',
    ].join(';');
    document.body.appendChild(toastHost);
    return toastHost;
  }
  function toast(message, kind) {
    if (!message) return null;
    ensureToastHost();
    const el = document.createElement('div');
    el.className = 'swr-toast' + (kind ? ' swr-toast--' + kind : '');
    el.style.cssText = [
      'pointer-events:auto',
      'background:rgba(8,8,12,.94)', 'color:#f6f6fa',
      'border:1px solid rgba(255,255,255,.10)',
      'border-radius:10px', 'padding:10px 14px',
      'font:600 12px/1.3 system-ui',
      'display:flex', 'align-items:center', 'gap:8px',
      'max-width:calc(100vw - 32px)', 'white-space:pre-wrap',
      'box-shadow:0 8px 28px rgba(0,0,0,.45)',
      'opacity:0', 'transform:translateY(8px)', 'transition:opacity .2s, transform .2s',
    ].join(';');
    if (kind === 'success') {
      el.style.borderColor = 'rgba(251,191,36,.55)';
      el.innerHTML = '<span aria-hidden="true" style="color:#fbbf24">\u2713</span> ' + escapeHtml(message);
    } else if (kind === 'error') {
      el.style.borderColor = 'rgba(248,113,113,.55)';
      el.style.background = 'rgba(60,18,18,.94)';
      el.innerHTML = '<span aria-hidden="true" style="color:#f87171">\u26A0</span> ' + escapeHtml(message);
    } else {
      el.innerHTML = '<span aria-hidden="true" style="color:#67e8f9">\u2022</span> ' + escapeHtml(message);
    }
    toastHost.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    const isError = kind === 'error';
    if (!isError) {
      setTimeout(() => dismiss(el), 2200);
    } else {
      // Errors stay until tapped.
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => dismiss(el));
    }
    toasts.push(el);
    return el;
  }
  function dismiss(el) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      const i = toasts.indexOf(el);
      if (i !== -1) toasts.splice(i, 1);
    }, 220);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Next-step pill ----
  // The pill text and CTA come from the current state. A "next step" is
  // a label + an action id; tapping the pill runs the registered
  // action (the page registers handlers in init({actions:{...}})).
  //
  // Steps are listed in priority order. The first step whose
  // `isDone()` returns false is the active one.
  //
  // All-done state: pill collapses to "Set up: complete" + dismisses
  // on tap (persists dismissed=true in localStorage).
  const DEFAULT_STEPS = [
    {
      id: 'audioLoaded',
      title: 'Pick a song',
      body: 'Tap "Add a song" below to load an MP3. The BPM and key appear once audio plays.',
      cta: 'Pick',
      match: function (s) { return !s.audioLoaded; },
      do: function (cb) { if (cb && cb.pickSong) cb.pickSong(); },
      done: function (s) { return !!s.audioLoaded; },
    },
    {
      id: 'firstLayerAdded',
      title: 'Add a clip',
      body: 'Tap "Add clip" to drop a photo or video on the stage. Pick anything from your camera roll.',
      cta: 'Add',
      match: function (s) { return s.audioLoaded && !s.firstLayerAdded; },
      do: function (cb) { if (cb && cb.addClip) cb.addClip(); },
      done: function (s) { return !!s.firstLayerAdded; },
    },
    {
      id: 'filterApplied',
      title: 'Try a look filter',
      body: 'Tap any chip (1-9) on the filter row. Each one tints the stage differently.',
      cta: 'soft',
      do: function (cb) { if (cb && cb.applyFilter) cb.applyFilter(1); },
      match: function (s) { return s.firstLayerAdded && !s.filterApplied; },
      done: function (s) { return !!s.filterApplied; },
    },
    {
      id: 'presetSaved',
      title: 'Save the look as a preset',
      body: 'Lock the current filter + layer combo so the studio opens the same way tomorrow.',
      cta: 'Save',
      do: function (cb) { if (cb && cb.savePreset) cb.savePreset(); },
      match: function (s) { return s.filterApplied && !s.presetSaved; },
      done: function (s) { return !!s.presetSaved; },
    },
    {
      id: 'librarySaved',
      title: 'Save the library',
      body: 'Bundle clips + song + preset into one .swr-set zip you can drop back in any time.',
      cta: 'Save',
      do: function (cb) { if (cb && cb.saveLibrary) cb.saveLibrary(); },
      match: function (s) { return s.presetSaved && !s.librarySaved; },
      done: function (s) { return !!s.librarySaved; },
    },
  ];

  let pageActions = null;
  let currentPill = null;
  let currentProgressEl = null;
  let dismissed = false;

  function nextStep() {
    for (const s of DEFAULT_STEPS) {
      if (!s.done(state)) return s;
    }
    return null;
  }

  function mountPill(target) {
    if (!target || currentPill) return;
    dismissed = false;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'swr-next-pill';
    pill.style.cssText = [
      'position:fixed',
      'left:50%', 'transform:translateX(-50%)',
      'top:calc(env(safe-area-inset-top, 0px) + 64px)',
      'max-width:calc(100vw - 32px)',
      'min-width:240px',
      'padding:10px 14px',
      'background:rgba(8,8,12,.92)',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:14px',
      'color:#f6f6fa', 'text-align:left',
      'font:600 12px/1.4 system-ui',
      'box-shadow:0 6px 18px rgba(0,0,0,.45)',
      'display:flex', 'align-items:center', 'gap:10px',
      'cursor:pointer', 'z-index:50',
      'pointer-events:auto',
    ].join(';');
    pill.setAttribute('aria-live', 'polite');
    pill.addEventListener('click', onPillClick);
    document.body.appendChild(pill);
    currentPill = pill;
    renderPill();
  }

  function unmountPill() {
    if (currentPill && currentPill.parentNode) {
      currentPill.parentNode.removeChild(currentPill);
    }
    currentPill = null;
  }

  function renderPill() {
    if (!currentPill || dismissed) return;
    const step = nextStep();
    if (!step) {
      // All done. Render the success pill, then auto-collapse on tap.
      currentPill.innerHTML =
        '<span aria-hidden="true" style="color:#fbbf24;font-size:14px;">\u2713</span>' +
        '<div style="display:flex;flex-direction:column;gap:2px;">' +
        '<span style="font:700 12px/1.2 system-ui;color:#fbbf24;">All set</span>' +
        '<span style="font:500 11px/1.2 system-ui;color:rgba(255,255,255,.55);">Your studio is ready.</span>' +
        '</div>';
      return;
    }
    const remaining = DEFAULT_STEPS.length - DEFAULT_STEPS.findIndex(function (s) { return s === step; });
    currentPill.innerHTML =
      '<span aria-hidden="true" style="color:#67e8f9;font-size:14px;">' + (DEFAULT_STEPS.findIndex(function (s) { return s === step; }) + 1) + '/' + DEFAULT_STEPS.length + '</span>' +
      '<div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;">' +
        '<span style="font:700 12px/1.2 system-ui;">' + escapeHtml(step.title) + '</span>' +
        '<span style="font:500 11px/1.3 system-ui;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(step.body) + '</span>' +
      '</div>' +
      '<span style="background:rgba(251,191,36,.16);color:#fbbf24;font:700 10px/1 ui-monospace,monospace;padding:5px 8px;border-radius:5px;letter-spacing:.04em;">' + escapeHtml(step.cta) + '</span>';
  }

  function onPillClick() {
    const step = nextStep();
    if (!step) {
      // All set: tap collapses the pill (next session may show it again).
      dismissed = true;
      unmountPill();
      return;
    }
    if (pageActions) {
      try { step.do(pageActions); } catch (e) { toast('Could not run: ' + step.title, 'error'); }
    } else {
      toast('Action not wired: ' + step.title, 'error');
    }
  }

  // ---- Public API ----
  function init(opts) {
    pageActions = (opts && opts.actions) || null;
    const target = (opts && opts.target) || null;
    if (target) {
      // Page hosts a designated slot.
      if (!target.contains(document.querySelector('.swr-next-pill'))) {
        target.innerHTML = '';
        const slot = document.createElement('div');
        slot.className = 'swr-next-pill-slot';
        slot.style.cssText = 'width:100%;';
        target.appendChild(slot);
        mountPill(slot);
      }
    } else {
      mountPill(null);
    }
  }

  function destroy() {
    unmountPill();
  }

  // ---- Auto-detection hooks (pages can also fire them manually) ----
  function markStep(stepId) {
    if (DEFAULT_STEPS.some(function (s) { return s.id === stepId; })) {
      const updated = set({});
      const patch = {};
      patch[stepId] = true;
      set(patch);
      if (updated || state[stepId] === true) {
        toast('Saved: ' + DEFAULT_STEPS.find(function (s) { return s.id === stepId; }).title, 'success');
        renderPill();
      }
    }
  }
  function markAudioLoaded() { set({ audioLoaded: true }); renderPill(); }
  function markLayerAdded() { set({ firstLayerAdded: true }); renderPill(); }
  function markFilterApplied() { set({ filterApplied: true }); renderPill(); }
  function markPresetSaved()   { set({ presetSaved: true });   renderPill(); }
  function markLibrarySaved()   { set({ librarySaved: true });  renderPill(); }
  function reset() {
    set({
      audioLoaded: false, firstLayerAdded: false, filterApplied: false,
      presetSaved: false, librarySaved: false,
    });
    renderPill();
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return function () { subscribers.delete(fn); };
  }

  function getState() { return Object.assign({}, state); }

  // ---- Boot (only if the page has the #c-onboard sentinel) ----
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('c-onboard') && !currentPill) {
      // Page is responsible for calling init(actions). We don't auto-mount
      // because the actions object is page-specific.
    }
  });

  window.SWR_ONBOARD = {
    init, destroy, toast, subscribe, getState, setState: set,
    markStep, markAudioLoaded, markLayerAdded, markFilterApplied,
    markPresetSaved, markLibrarySaved, reset,
    nextStep: function () { return nextStep(); },
    steps: DEFAULT_STEPS,
  };
})();
