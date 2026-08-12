// media-sets.client.js — curated media subsets organized by persona.
//
// Each set is a list of { name, why } entries that match a persona's
// aesthetic. The user picks a set from a new "set" dropdown in the toolbar;
// the library then filters to show only assets in that set (or all if "all").
//
// Sets are defined by file-name prefix matching against the existing
// library/ contents. No file copying — just metadata + filtering.

(function () {
  if (window.MediaSets) return;  // idempotent

  // ---- Set registry ----
  // Each set lists asset name patterns. Pattern matching:
  //   "p01"        → exact match
  //   "c01-*"      → starts-with
  //   "*.jpg"      → extension match
  //   "*-rooftop"  → suffix
  const SETS = {
    all: {
      label: 'All assets',
      desc:  'Every imported asset — no filtering',
      patterns: [],   // empty = match all
    },

    raw_set: {
      label: 'Raw',
      desc:  'Clean shots that look great untouched. Minimal intervention works.',
      patterns: ['c07-sunrise', 'c08-sunrise', 'p07', 'p08', 'p10', 'p14'],
    },

    poster_set: {
      label: 'Poster',
      desc:  'High-contrast, geometric, simple shapes. Posterization will flatten them.',
      patterns: ['c12-abstract', 'p02', 'p03', 'p05', 'p11', 'p15'],
    },

    mask_set: {
      label: 'Mask',
      desc:  'Atmospheric — smoke, tunnels, security footage. Vignette + glow focuses the eye.',
      patterns: ['c06-smoke', 'c09-security', 'c10-tunnel', 'c11-tunnel', 'p01', 'p04'],
    },

    fx_set: {
      label: 'FX',
      desc:  'Chaotic, motion-heavy. Glitch + chromatic aberration thrives on busy frames.',
      patterns: ['c03-taxi', 'c04-taxi', 'c05-taxi', 'c01-rooftop', 'c02-rooftop', 'p06', 'p09'],
    },

    filter_set: {
      label: 'Filter',
      desc:  'Warms + grain + sepia. Nostalgic footage — anything that already has a vintage cast.',
      patterns: ['c07-sunrise', 'c08-sunrise', 'c12-abstract', 'p02', 'p12', 'p13'],
    },
  };

  // ---- Pattern matching ----
  function matchPattern(filename, pattern) {
    // Convert glob-ish pattern to regex
    const re = new RegExp(
      '^' + pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex chars
        .replace(/\*/g, '.*')                   // * → .*
      + '$'
    );
    return re.test(filename);
  }

  function fileInSet(filename, setKey) {
    const set = SETS[setKey];
    if (!set || set.patterns.length === 0) return true;
    return set.patterns.some(p => matchPattern(filename, p));
  }

  // ---- Filtered asset list ----
  function getSetAssets(setKey) {
    const SWR = window.SWR;
    const Library = SWR && SWR.Library;
    if (!Library || !Library.items) return [];
    if (!SETS[setKey] || setKey === 'all') return Library.items;
    return Library.items.filter(it => fileInSet(it.name, setKey));
  }

  // ---- State ----
  const state = { currentSet: 'all' };

  // ---- Override library render to apply filter ----
  // Library.render() is the IIFE-internal method that paints the library grid.
  // We hook it by intercepting after each render and hiding non-matching cards.
  function applyFilter() {
    const setKey = state.currentSet;
    const cards = document.querySelectorAll('.lib-item');
    if (!cards.length) return;

    if (!SETS[setKey] || setKey === 'all') {
      // No filter — show all
      for (const c of cards) c.style.display = '';
      return;
    }

    let shown = 0;
    for (const c of cards) {
      const id = parseInt(c.dataset.id, 10);
      const SWR = window.SWR;
      const Library = SWR && SWR.Library;
      const asset = Library && Library.byId ? Library.byId(id) : null;
      const matches = asset && fileInSet(asset.name, setKey);
      c.style.display = matches ? '' : 'none';
      if (matches) shown++;
    }

    if (shown === 0 && cards.length > 0) {
      setStatus(`set '${SETS[setKey].label}' has no matching assets — try another set`, 'warn');
    }
  }

  // Use a MutationObserver to re-apply filter whenever library is re-rendered.
  let observer = null;
  function watchLibrary() {
    const grid = document.getElementById('library-grid');
    if (!grid) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      applyFilter();
    });
    observer.observe(grid, { childList: true });
  }

  // ---- UI: dropdown ----
  function buildUI() {
    if (document.getElementById('set-select')) return;

    const sel = document.createElement('select');
    sel.id = 'set-select';
    sel.title = 'Curated media set — filter library by persona';
    sel.style.cssText = 'font:11px -apple-system,sans-serif;';
    for (const [key, set] of Object.entries(SETS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = set.label;
      opt.title = set.desc;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', (e) => {
      state.currentSet = e.target.value;
      applyFilter();
      const set = SETS[state.currentSet];
      if (set && typeof setStatus === 'function') {
        setStatus(`set: ${set.label} — ${set.desc}`, 'ok');
      }
    });

    // Insert next to the persona dropdown
    const personaSel = document.getElementById('persona');
    if (personaSel && personaSel.parentElement) {
      const wrap = document.createElement('span');
      wrap.className = 'gctrl';
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
      const label = document.createElement('span');
      label.textContent = 'set';
      label.style.cssText = 'color:#888;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;';
      wrap.appendChild(label);
      wrap.appendChild(sel);
      personaSel.parentElement.parentElement.insertBefore(
        wrap,
        personaSel.parentElement.nextSibling
      );
    }

    // Re-apply filter when persona changes (cross-link: persona → set)
    if (personaSel) {
      personaSel.addEventListener('change', () => {
        // Don't auto-switch; user may have intentionally chosen a different set.
        // But do re-apply the current filter so the library reflects current state.
        setTimeout(applyFilter, 100);
      });
    }
  }

  // ---- Boot ----
  function boot() {
    buildUI();
    watchLibrary();
    // First filter pass after a small delay so Library has rendered
    setTimeout(applyFilter, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 100);
  }

  // ---- Public API ----
  window.MediaSets = {
    SETS,
    state,
    getSetAssets,
    fileInSet,
    matchPattern,
    applyFilter,
    set(key) {
      state.currentSet = key;
      const sel = document.getElementById('set-select');
      if (sel) sel.value = key;
      applyFilter();
    },
  };
})();