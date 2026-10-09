// client/looks-menu.client.js — one grouped "look" dropdown for the engine's
// top bar, so every visual identity the project actually ships is reachable
// from a single control.
//
// Before this there were three unsynchronised catalogues and no way to see
// them together:
//
//   1. #variant  — 5 entries (neon, film, grid, smoke, hallucination), the
//      only ones client/variant-switcher.client.js can drive, because it
//      fetch()es /versions/<id>.html and compiles that page's drawFx verbatim.
//   2. #preset   — 5 entries (pulse, drift, strobe, warp, mosh) backed by
//      engine.html's own VISUAL_PRESETS (reactors/blends, not a colour grade).
//   3. versions-presets.js — 23 grade presets (FILM, GRID, AURORA, ...)
//      that the version pages read but NO engine control exposed.
//
// This module adds group 3 to the top bar, grouped so the two kinds of
// "preset" never blur together:
//
//   Variant looks   — compiled render passes from /versions/<id>.html
//   Grade presets   — FX colour grades from versions-presets.js
//   Motion presets  — engine.html's VISUAL_PRESETS (the old #preset set)
//
// Deliberate non-goals:
//   - It does NOT invent entries for the 17 artistic variants that
//     variant-switcher cannot drive. Those pages ship their own
//     drawFx and automix wiring; adding them to #variant means authoring
//     17 new VARIANTS records, which is a separate change.
//   - It does NOT sync with #variant / #preset. Those selects keep their
//     own change handlers and their own tests; this control is additive.
//     Both directions are mirrored (see below) but neither replaces.
//
// Apply paths, and why each is what it is:
//   Grade presets go through window.FX.setPersona() — the same call
//     personas.js uses. FX.setPersona only assigns the 15/17 fields it
//     knows, so passing the raw PRESETS entry (which carries extra keys
//     like label/desc/effect/tint) is safe and stays the single source of
//     truth rather than a hand-copied subset.
//   Variant looks delegate to window.SWR_VARIANTS.activate(id) — the
//     switcher owns fetching + compiling the page's drawFx; we only call it.
//   Motion presets set #preset.value and dispatch 'change' so the engine's
//     existing handler runs unchanged.
//
// Public API on window.SWR_LOOKS:
//   .list()      -> [{group, id, name, desc}] in display order
//   .apply(id)   -> apply by id across groups; returns the group or null
//   .current()   -> currently selected id or null
//   .groups()    -> [{id, label, items: [...]}, ...]

(function () {
  'use strict';
  if (window.SWR_LOOKS) return;

  const GROUP_VARIANT = 'variant';
  const GROUP_GRADE = 'grade';
  const GROUP_MOTION = 'motion';

  // The engine's own motion presets, keyed exactly as #preset's values.
  // Duplicated as literals rather than scraped from VISUAL_PRESETS because
  // that object is a private const inside engine.html's module scope and
  // is not reachable from here. Adding a VISUAL_PRESETS key means adding
  // it here too — a one-line omission shows up as a missing dropdown entry
  // rather than a runtime error, which is the failure mode we want.
  const MOTION = [
    { id: 'pulse', name: 'Pulse', desc: 'Bass-thumping, beat-pulsing. Dark, heavy, club-energy.' },
    { id: 'drift', name: 'Drift', desc: 'Slow float and sway. Calm, weightless, ambient.' },
    { id: 'strobe', name: 'Strobe', desc: 'Hard flashes on the beat. Aggressive, cutting.' },
    { id: 'warp', name: 'Warp', desc: 'Depth-pushed zoom on transients. Hypnotic pull.' },
    { id: 'mosh', name: 'Mosh', desc: 'Chopped and resampled frames. Chaotic, tactile.' },
  ];

  // Preset keys that must NOT be listed even if present in the catalogue.
  // `gallery` is an art-direction grade for versions/gallery.html and
  // `mtv` is the 90s ident cut; both are reachable from their own pages and
  // neither reads naturally as an engine-wide grade. Kept out of the list
  // deliberately rather than by accident.
  const GRADE_EXCLUDE = new Set(['gallery', 'mtv']);

  function gradeEntries() {
    const table = window.__SWR_PRESETS;
    if (!table || typeof table !== 'object') return [];
    const out = [];
    for (const id of Object.keys(table)) {
      if (GRADE_EXCLUDE.has(id)) continue;
      const p = table[id];
      if (!p) continue;
      out.push({
        id,
        name: p.label || id.toUpperCase(),
        desc: p.desc || '',
      });
    }
    return out;
  }

  function variantEntries() {
    if (!window.SWR_VARIANTS || typeof window.SWR_VARIANTS.list !== 'function') return [];
    return window.SWR_VARIANTS.list().map((v) => ({ id: v.id, name: v.name, desc: v.desc || '' }));
  }

  function buildGroups() {
    return [
      { id: GROUP_VARIANT, label: 'Variant looks', items: variantEntries() },
      { id: GROUP_GRADE, label: 'Grade presets', items: gradeEntries() },
      { id: GROUP_MOTION, label: 'Motion presets', items: MOTION.slice() },
    ].filter((g) => g.items.length > 0);
  }

  // ---- Apply -------------------------------------------------------------

  function applyGrade(id) {
    const preset = window.__SWR_PRESETS && window.__SWR_PRESETS[id];
    if (!preset) return false;
    if (!window.FX || typeof window.FX.setPersona !== 'function') return false;
    // setPersona reads only the fields it knows, so the full entry is safe
    // to hand over and keeps versions-presets.js the only place a grade is
    // defined.
    window.FX.setPersona(preset);
    mirrorIntoSliders(preset);
    return true;
  }

  // personas.js writes the slider positions so the user can see what the
  // preset changed. Grade presets would otherwise move the FX uniforms with
  // no visible response from the toolbar, which reads as a broken control.
  //
  // The FX state keys and the DOM ids do not match: FX calls them `temp` and
  // `mut`, the inputs are #temperature and #mutations. The pair list is
  // [presetKey, inputId, labelId] so both spellings stay visible.
  function mirrorIntoSliders(preset) {
    const pairs = [
      ['temp', 'temperature', 'temperature-v'],
      ['mut', 'mutations', 'mutations-v'],
      ['posterize', 'posterize', 'posterize-v'],
      ['chroma', 'chroma', 'chroma-v'],
      ['grain', 'grain', 'grain-v'],
      ['sepia', 'sepia', 'sepia-v'],
      ['glow', 'glow', 'glow-v'],
      ['blur', 'blur', 'blur-v'],
      ['grayscale', 'grayscale', 'grayscale-v'],
      ['vignette', 'vignette-fx', 'vignette-fx-v'],
      ['liquid', 'liquid', 'liquid-v'],
      ['pearl', 'pearl', 'pearl-v'],
      ['glitch', 'glitch', 'glitch-v'],
    ];
    for (const [key, inputId, labelId] of pairs) {
      const v = preset[key];
      if (typeof v !== 'number') continue;
      const input = document.getElementById(inputId);
      if (input) input.value = String(v);
      const label = document.getElementById(labelId);
      if (label) label.textContent = v.toFixed(2);
    }
  }

  function applyVariant(id) {
    if (!window.SWR_VARIANTS || typeof window.SWR_VARIANTS.activate !== 'function') return false;
    // Activate is async (it fetches the page); a rejected fetch must not
    // surface as an unhandled rejection, and the UI already shows the pick.
    window.SWR_VARIANTS.activate(id).catch((e) => {
      console.warn('looks: variant activate failed', id, e && e.message);
    });
    // Keep #variant in step so the two controls never disagree.
    const sel = document.getElementById('variant');
    if (sel) sel.value = id;
    return true;
  }

  function applyMotion(id) {
    const sel = document.getElementById('preset');
    if (!sel) return false;
    sel.value = id;
    // The engine listens for 'change'; dispatching keeps one apply path.
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Accepts either a group-qualified key ("grade:film") from the dropdown
  // or a bare id from `apply(id)` programmatic callers. The bare-id form
  // is only unambiguous when the id is unique across the catalogues; for
  // collisions (film, grid, neon, smoke, hallucination + 8 others appear
  // in both Variant and Grade), callers MUST pass the group-qualified
  // form. The UI handler in wire() always does; programmatic callers can
  // reach for `applyIn(gid, id)` if they know the group.
  function apply(idOrQualified) {
    const { group, id } = splitKey(idOrQualified);
    if (!id) return null;
    if (group) return applyIn(group, id);
    // Bare id — find the first group that owns it. Order matters: variant
    // is checked first, then grade, then motion. Programmatic callers
    // that need a specific group must use applyIn.
    for (const g of buildGroups()) {
      if (g.items.some((it) => it.id === id)) return applyIn(g.id, id);
    }
    return null;
  }

  function applyIn(group, id) {
    let ok = false;
    if (group === GROUP_VARIANT) ok = applyVariant(id);
    else if (group === GROUP_GRADE) ok = applyGrade(id);
    else if (group === GROUP_MOTION) ok = applyMotion(id);
    return ok ? group : null;
  }

  // Parse the group-qualified option value. Returns `{ group, id }`; if
  // the input has no group prefix (bare id), group is null and id is the
  // input itself.
  function splitKey(raw) {
    const s = String(raw || '');
    const idx = s.indexOf(':');
    if (idx < 0) return { group: null, id: s };
    return { group: s.slice(0, idx), id: s.slice(idx + 1) };
  }

  function current() {
    const sel = document.getElementById('looks');
    if (!sel || !sel.value || sel.value === 'off') return null;
    return sel.value;
  }

  // ---- UI ----------------------------------------------------------------

  function buildSelect() {
    const sel = document.createElement('select');
    sel.id = 'looks';
    sel.title = 'Every shipped look — variant render passes, grade presets and motion presets';

    const off = document.createElement('option');
    off.value = 'off';
    off.textContent = '— none —';
    sel.appendChild(off);

    for (const g of buildGroups()) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const it of g.items) {
        const opt = document.createElement('option');
        // Group-qualified so an id that exists in two groups (film, grid,
        // neon, smoke and hallucination are BOTH a variant and a grade)
        // still resolves to exactly one entry.
        opt.value = g.id + ':' + it.id;
        opt.textContent = it.name;
        if (it.desc) opt.title = it.desc;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    return sel;
  }

  function mount() {
    const host = document.getElementById('variant') && document.getElementById('variant').closest('.gctrl');
    if (!host || document.getElementById('looks')) return;
    const wrap = document.createElement('span');
    wrap.className = 'gctrl';
    const label = document.createElement('span');
    label.textContent = 'looks';
    wrap.appendChild(label);
    wrap.appendChild(buildSelect());
    host.parentNode.insertBefore(wrap, host.nextSibling);
  }

  function wire() {
    const sel = document.getElementById('looks');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const raw = sel.value;
      if (!raw || raw === 'off') return;
      // Pass the group-qualified key ("grade:film", "motion:pulse",
      // "variant:aurora") straight through to apply() so a colliding
      // id ("film" exists in both Variant and Grade) routes to the
      // group the user actually picked. Bare ids fall through apply()'s
      // first-match scan; this UI handler never produces a bare id.
      if (raw.indexOf(':') < 0) return;
      apply(raw);
    });
  }

  function boot() {
    mount();
    wire();
  }

  window.SWR_LOOKS = {
    list() {
      return buildGroups().flatMap((g) => g.items.map((it) => ({ group: g.id, id: it.id, name: it.name, desc: it.desc })));
    },
    groups: buildGroups,
    apply,
    current,
    /** Re-read the catalogues and rebuild the option list. */
    refresh() {
      const sel = document.getElementById('looks');
      if (!sel) return;
      const prev = sel.value;
      sel.replaceWith(buildSelect());
      wire();
      const next = document.getElementById('looks');
      if (next && prev) next.value = prev;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();