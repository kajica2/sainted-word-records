// client/media-grouping.client.js — group media by name, keep graphics together.
//
// The media panel is flat: every asset the user dropped sits in one list
// in upload order. Once a folder of clips is in there, the list stops
// being scannable — "which three are the intro shots?" becomes a
// filename-reading exercise.
//
// This module gives the panel a name-aware grouping:
//   • Videos with a shared name prefix form a group
//     (intro_clip_01.mp4, intro_clip_02.mp4 -> "intro clip").
//   • Every static graphic lands in ONE group ("Graphics"), so the
//     stills never scatter between the clips.
//
// The same rules already drive the automix layer pool
// (client/automix-composition.client.js), so what the user sees grouped
// in the panel is what the engine later stacks.
//
// Public API on window.SWR_MEDIA_GROUPING:
//   .prefixOf(name)   -> 'intro clip' (the group label for a file name)
//   .isStatic(item)   -> true for images
//   .groupItems(items)-> [{ key, label, kind, items: [...] }] — ordered
//   .sortItems(items) -> the flat list, grouped + sorted
//
// Public API on window.SWR_MEDIA_GROUPING_UI (the toggle state a page
// renders from):
//   .isOn() / .setOn(bool) / .toggle()
//   .onChange(fn)     — subscribe to state changes
//
// Idempotent: safe to load twice.

(() => {
  'use strict';
  if (window.SWR_MEDIA_GROUPING) return;

  const EXT = /\.(mp4|mov|webm|mkv|avi|m4v|ogv|jpg|jpeg|png|gif|webp|avif|bmp)$/i;

  // 'intro_clip_01.mp4' -> 'intro clip'
  // 'Beach Day 2.mov'    -> 'beach day'
  // 'loop_v3.webm'      -> 'loop'
  function prefixOf(name) {
    if (!name) return 'untitled';
    let base = String(name).replace(EXT, '');
    // Trailing version markers first: v2, _v3, ver4. Stripping the
    // counter first would leave the "v" behind ("loop_v3" -> "loop v").
    base = base.replace(/[\s._-]*v(er)?\d+$/i, '');
    // Trailing counters: _01, -2, .3, " 4"
    base = base.replace(/[\s._-]*\d+$/, '');
    // Collapse separators into single spaces, trim, lowercase.
    base = base.replace(/[\s._-]+/g, ' ').trim().toLowerCase();
    return base || 'untitled';
  }

  function isStatic(item) {
    if (!item) return false;
    if (item.type) return item.type === 'image';
    const mt = item.mime || item.mimeType || '';
    if (mt) return mt.indexOf('image/') === 0;
    const n = String(item.name || '');
    return /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(n);
  }

  // Natural-ish compare: 'clip 2' sorts before 'clip 10'.
  function byName(a, b) {
    const an = String(a.name || '');
    const bn = String(b.name || '');
    const ax = an.match(/(\d+)|(\D+)/g) || [];
    const bx = bn.match(/(\d+)|(\D+)/g) || [];
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
      const x = ax[i];
      const y = bx[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const xn = /^\d+$/.test(x);
      const yn = /^\d+$/.test(y);
      if (xn && yn) {
        const d = parseInt(x, 10) - parseInt(y, 10);
        if (d) return d;
      } else {
        const d = x.toLowerCase().localeCompare(y.toLowerCase());
        if (d) return d;
      }
    }
    return an.localeCompare(bn);
  }

  const GRAPHICS_KEY = 'graphics';
  const GRAPHICS_LABEL = 'graphics';

  // Ordered groups: video groups alphabetically, the static-graphics
  // group last (it is the catch-all, not a sequence).
  function groupItems(items) {
    const list = (items || []).filter(Boolean);
    const byKey = new Map();
    for (const it of list) {
      if (isStatic(it)) {
        if (!byKey.has(GRAPHICS_KEY)) {
          byKey.set(GRAPHICS_KEY, { key: GRAPHICS_KEY, label: GRAPHICS_LABEL, kind: 'graphics', items: [] });
        }
        byKey.get(GRAPHICS_KEY).items.push(it);
        continue;
      }
      const key = prefixOf(it.name);
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: key, kind: 'video', items: [] });
      }
      byKey.get(key).items.push(it);
    }
    const groups = Array.from(byKey.values());
    for (const g of groups) g.items.sort(byName);
    groups.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'graphics' ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }

  function sortItems(items) {
    const out = [];
    for (const g of groupItems(items)) {
      for (const it of g.items) out.push(it);
    }
    return out;
  }

  window.SWR_MEDIA_GROUPING = {
    prefixOf,
    isStatic,
    groupItems,
    sortItems,
    byName,
    GRAPHICS_KEY,
    GRAPHICS_LABEL,
  };

  // ---- toggle state -------------------------------------------------
  // A page renders from this; the module owns the state so the button,
  // the keyboard shortcut and the list render can never disagree.
  const ui = {
    on: false,
    _subs: [],
    isOn() { return ui.on; },
    setOn(v) {
      const next = !!v;
      if (next === ui.on) return ui.on;
      ui.on = next;
      for (const fn of ui._subs) {
        try { fn(ui.on); } catch (_) {}
      }
      return ui.on;
    },
    toggle() { return ui.setOn(!ui.on); },
    onChange(fn) {
      if (typeof fn === 'function') ui._subs.push(fn);
    },
  };
  window.SWR_MEDIA_GROUPING_UI = ui;
})();
