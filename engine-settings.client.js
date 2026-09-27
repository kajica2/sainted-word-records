// engine-settings.client.js — key-driven settings helpers for the engine pages.
//
// Formerly the floating ⚙ gear + dropdown menu (AUTO-SWAP / TIMING / LFOs
// toggles, AUTO-MAP recipe picker, SAVE / LOAD PROJECT, RESET ALL PANELS).
// That surface was removed: the gear sat in the top-right corner over the
// canvas, and its one "panel" toggle for AUTO-SWAP pointed at #ls-panel-swap,
// an element no page has ever built (the real AUTO-SWAP panel is
// #layer-scheduler-panel, force-hidden in layer-scheduler.client.js). Half the
// menu was decoration over behaviour the keymap already owns.
//
// What remains is the non-UI half that engine-keys.client.js needs, so no page
// carries a widget it does not need:
//
//   window.SWR_SETTINGS = {
//     togglePanel(id)   — flip a floating panel's visibility (persisted)
//     saveProject()     — download the current state as a .swr-project file
//     openProject()     — file picker → restore a .swr-project
//     resetPanels()     — clear every panel's saved position/visibility
//   }
//
// Panel visibility is per-page state persisted in localStorage under
// 'swr.settings.visible' so preferences survive reloads. Every helper degrades
// to a no-op when its dependency module is absent, so the module is safe on any
// page that loads it.
//
// Idempotent: loading twice keeps the first instance.

(function () {
  'use strict';
  if (window.SWR_SETTINGS) return;

  const LS_VIS   = 'swr.settings.visible';
  // The floating panels this module owns the visibility of. AUTO-SWAP is
  // deliberately absent: it has no element (see the header note), so toggling
  // it would write a preference nothing reads.
  const PANELS = [
    { id: 'ls-panel-timing', label: 'TIMING', store: 'swr.timingVisible' },
    { id: 'ls-panel-lfo',    label: 'LFOs',   store: 'swr.lfoVisible'    },
  ];

  function readVisibility() {
    try {
      const raw = localStorage.getItem(LS_VIS);
      const obj = raw ? JSON.parse(raw) : {};
      return {
        // Timing + LFO default HIDDEN — advanced, opt-in.
        'ls-panel-timing': obj['ls-panel-timing'] === true,
        'ls-panel-lfo':    obj['ls-panel-lfo']    === true,
      };
    } catch (_) {
      return {
        'ls-panel-timing': false,
        'ls-panel-lfo':    false,
      };
    }
  }

  function writeVisibility(v) {
    try { localStorage.setItem(LS_VIS, JSON.stringify(v)); } catch (_) {}
  }

  function applyVisibility(v) {
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (!el) continue;
      el.style.display = v[p.id] ? '' : 'none';
    }
  }

  function toggleVisibility(panelId) {
    const v = readVisibility();
    v[panelId] = !v[panelId];
    writeVisibility(v);
    applyVisibility(v);
    if (typeof window.setStatus === 'function') {
      window.setStatus('panel: ' + panelId.replace('ls-panel-', '') + ' ' + (v[panelId] ? 'shown' : 'hidden'), 'ok');
    }
  }

  function resetPanels() {
    for (const k of ['swr-layer-scheduler-pos', 'swr-layer-scheduler.pos', 'swr.timing-panel.pos', 'swr.lfo-panel.pos', LS_VIS]) {
      try { localStorage.removeItem(k); } catch (_) {}
    }
    // Reset visibility to defaults (advanced panels hidden).
    applyVisibility({ 'ls-panel-timing': false, 'ls-panel-lfo': false });
    // Move panels back to their CSS default positions by clearing inline box
    // offsets.
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (!el) continue;
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
    }
    if (typeof window.setStatus === 'function') {
      window.setStatus('settings: panels reset to defaults', 'ok');
    }
  }

  // ---- project save / load --------------------------------------------
  // Two project modules exist with overlapping but different APIs:
  //   - project.js (loaded on engine.html) exports window.Project =
  //     { download(), loadFile(file), ... }
  //   - project.client.js (loaded on versions/*.html) exports
  //     window.SWR_PROJECT = { save(), loadFromFile(file), ... }
  // Each helper returns the bound function for the module that is actually
  // present (or null), so one caller works on both page families.
  function projectSave() {
    if (window.Project && typeof window.Project.download === 'function') {
      return window.Project.download.bind(window.Project);
    }
    if (window.SWR_PROJECT && typeof window.SWR_PROJECT.save === 'function') {
      return window.SWR_PROJECT.save.bind(window.SWR_PROJECT);
    }
    return null;
  }
  function projectLoadFile(file) {
    if (window.Project && typeof window.Project.loadFile === 'function') {
      return window.Project.loadFile.bind(window.Project);
    }
    if (window.SWR_PROJECT && typeof window.SWR_PROJECT.loadFromFile === 'function') {
      return window.SWR_PROJECT.loadFromFile.bind(window.SWR_PROJECT);
    }
    return null;
  }

  function saveProject() {
    const fn = projectSave();
    if (!fn) {
      if (typeof window.setStatus === 'function') window.setStatus('project module not loaded', 'err');
      return false;
    }
    try {
      const ok = fn();
      if (ok === false) {
        if (typeof window.setStatus === 'function') window.setStatus('project save failed', 'err');
        return false;
      }
      if (typeof window.setStatus === 'function') window.setStatus('project saved', 'ok');
      return true;
    } catch (e) {
      if (typeof window.setStatus === 'function') window.setStatus('project save error: ' + e.message, 'err');
      return false;
    }
  }

  // Lazy-initialized <input type="file">, appended on first use, hidden,
  // reused. The change handler resolves the right loader at file-pick time
  // because the page may have either project module.
  let fileInput = null;
  function ensureFileInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.cssText = 'display:none;position:absolute;left:-9999px;';
    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';  // reset so the same file can be picked again
      const loader = projectLoadFile();
      if (!f || !loader) {
        if (!loader && typeof window.setStatus === 'function') {
          window.setStatus('project module not loaded', 'err');
        }
        return;
      }
      try {
        const r = await loader(f);
        // Both modules return { ok, applied, missing, errors } but with
        // slightly different field names — handle both.
        if (r && r.ok !== false) {
          if (typeof window.setStatus === 'function') {
            window.setStatus('project loaded (' + (r.applied || '?') + ' layers, ' + (r.missing || 0) + ' missing)', 'ok');
          }
        } else {
          const why = r && r.errors ? r.errors.join('; ') : 'unknown';
          if (typeof window.setStatus === 'function') window.setStatus('project load failed: ' + why, 'err');
        }
      } catch (e) {
        if (typeof window.setStatus === 'function') window.setStatus('project load threw: ' + e.message, 'err');
      }
    });
    document.body.appendChild(fileInput);
    return fileInput;
  }

  function openProject() {
    const loader = projectLoadFile();
    if (!loader) {
      if (typeof window.setStatus === 'function') window.setStatus('project module not loaded', 'err');
      return false;
    }
    ensureFileInput().click();
    return true;
  }

  // ---- boot -----------------------------------------------------------
  // Deferred so the timing + LFO panel modules (loaded just before this one)
  // have appended their panels to the DOM. Without this, applyVisibility()
  // runs before those elements exist and the saved preference is a no-op for
  // that load.
  function boot() { applyVisibility(readVisibility()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
  } else {
    setTimeout(boot, 50);
  }

  window.SWR_SETTINGS = {
    togglePanel: toggleVisibility,
    saveProject: saveProject,
    openProject: openProject,
    resetPanels: resetPanels,
  };
})();
