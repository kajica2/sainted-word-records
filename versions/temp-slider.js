// versions/temp-slider.js — temperature slider injected into every
// visual-style page (versions/*.html). Reads the page's preset temp from
// VersionsPresets (when present) or from FX.state (when the page uses the
// fx-postprocess.js pipeline), then wires a <input type=range> in the
// page footer to live-update the FX uniform.
//
// IDEMPOTENT: if the script is included twice on a page, the second run
// replaces the existing slider with a fresh one (so the latest initial
// value wins). The DOM-id check at the top of install() handles this.
//
// DISCOVERY: tries VersionsPresets first (13 preset-driven pages), then
// window.FX.setTemp (5 hardcoded-persona pages: baroque/kraft/mosaic/
// phosphor/tape). If neither exists, the slider still appears but is
// inert — it tracks the page's own FX bootstrap once it loads.
//
// USAGE: drop <script src="./temp-slider.js"></script> after the page's
// own FX bootstrap. Auto-injects on DOMContentLoaded.

(function () {
  function fmt(v) {
    // Show signed value with one decimal: "+0.30" / "-0.25" / " 0.00"
    var s = (v >= 0 ? '+' : '') + v.toFixed(2);
    return s.replace('+-', '-');
  }

  function findFooter() {
    var f = document.querySelector('footer');
    return f;
  }

  function findHost(f) {
    // Prefer an existing <span class="gc"> (the slider convention used in
    // film/aurora/grid/etc.), so the slider inherits .gc input width 80px.
    // Fall back to the footer itself for pages that don't use .gc.
    var gc = f.querySelector('span.gc');
    if (gc) return gc.parentElement;
    return f;
  }

  function getInitialTemp() {
    // VersionsPresets pages: preset temp is in the PRESETS dict — read directly.
    if (window.VersionsPresets && window.VersionsPresets.PRESETS) {
      var body = document.body || document.documentElement;
      var key = (body.dataset && body.dataset.page) ||
                (document.title || '').toLowerCase().split(' ')[0];
      if (key && window.VersionsPresets.PRESETS[key]) {
        if (typeof window.VersionsPresets.getTemp === 'function') {
          return window.VersionsPresets.getTemp(key);
        }
        return window.VersionsPresets.PRESETS[key].temp || 0;
      }
    }
    // FX pages: return whatever FX.state.temp is right now. The reconcile()
    // loop in install() handles the case where FX hasn't been initialized
    // yet (this script ran before the page's onload callback finished).
    if (window.FX && window.FX.state && typeof window.FX.state.temp === 'number') {
      return window.FX.state.temp;
    }
    return 0;
  }

  function setTemp(v) {
    v = Math.max(-1, Math.min(1, v));
    // VersionsPresets path
    if (window.VersionsPresets && typeof window.VersionsPresets.setTemp === 'function') {
      var body = document.body || document.documentElement;
      var key = (body.dataset && body.dataset.page) ||
                (document.title || '').toLowerCase().split(' ')[0];
      window.VersionsPresets.setTemp(key, v);
      return;
    }
    // FX module path
    if (window.FX && typeof window.FX.setTemp === 'function') {
      window.FX.setTemp(v);
    }
  }

  function install() {
    var footer = findFooter();
    if (!footer) {
      console.warn('[temp-slider] no <footer> found — skipping');
      return;
    }
    // Replace existing slider if re-running, so updated initial value wins.
    var existing = document.getElementById('swr-temp-slider');
    if (existing) existing.remove();

    // Render with whatever we can read RIGHT NOW. For VersionsPresets pages
    // this is the correct preset value immediately. For FX pages where the
    // page calls setPersona() in a dynamic-script onload callback, FX.state
    // may not have the persona values yet — install() will render 0, then
    // the reconcile() loop below will update the slider once FX populates.
    var initial = getInitialTemp();
    renderSlider(footer, initial);

    // Reconcile loop: keep polling until the slider matches the actual
    // page state. Stops automatically once the values agree (or after 40
    // ticks × 100ms = 4s). This handles the async-bootstrap case for the
    // 5 hardcoded-persona pages where FX.setPersona() runs in a dynamic-
    // script onload callback AFTER this script first executes.
    var reconcileTicks = 0;
    function reconcile() {
      reconcileTicks++;
      var target = getInitialTemp();
      var inp = document.getElementById('temp');
      var valEl = document.getElementById('temp-v');
      if (inp && valEl) {
        var cur = parseFloat(inp.value);
        if (cur !== target) {
          inp.value = String(target);
          valEl.textContent = fmt(target);
        }
      }
      if (reconcileTicks < 40) setTimeout(reconcile, 100);
    }
    reconcile();
  }

  function renderSlider(footer, initialTemp) {
    // Build the slider. Use a <span class="gc"> so the 13 preset pages
    // pick up the existing .gc input{width:80px} styling. On the 5
    // hardcoded pages we still ship the same structure — it just won't
    // pick up .gc rules, so we inline our own width.
    var span = document.createElement('span');
    span.className = 'gc';
    span.id = 'swr-temp-slider';
    span.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';

    var label = document.createElement('span');
    label.textContent = 'temp';
    label.style.cssText = 'font:inherit;color:inherit;opacity:0.85;';

    var input = document.createElement('input');
    input.type = 'range';
    input.id = 'temp';
    input.min = '-1';
    input.max = '1';
    input.step = '0.05';
    input.value = String(initialTemp);
    input.style.cssText = 'width:90px;accent-color:currentColor;cursor:pointer;';

    var val = document.createElement('b');
    val.id = 'temp-v';
    val.textContent = fmt(initialTemp);
    val.style.cssText = 'font:inherit;color:inherit;min-width:42px;text-align:right;';

    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      if (isNaN(v)) return;
      setTemp(v);
      val.textContent = fmt(v);
    });

    span.appendChild(label);
    span.appendChild(input);
    span.appendChild(val);

    // Insert at the start of the footer so it's visually first. Putting it
    // last would land on the static <span class="pill">●</span> LED on some
    // pages, which is a worse UX placement.
    var host = findHost(footer);
    host.insertBefore(span, host.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();