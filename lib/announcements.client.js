// lib/announcements.client.js — the auto-post feed.
//
// One data file: the `announcements` array in site-map.json. Publishing a
// post is adding an entry there and deploying: it then appears in the
// footer's bottom bar on every page that mounts <swr-footer>, on the
// changelog and on the marketplace. No HTML is edited to publish.
//
// The data comes from the inlined #swr-footer-data slice the build writes
// into every page that mounts the footer (offline-first, no fetch), and
// falls back to /site-map.json when the slice is absent — the dev server,
// where the inlining plugin does not run.
//
// Contract:
//   window.SWR_ANNOUNCEMENTS.list(limit?)   → the posts, newest first
//   window.SWR_ANNOUNCEMENTS.latest()       → the newest post, or null
//   window.SWR_ANNOUNCEMENTS.render(el, o?) → paint the posts into a node
//   window.SWR_ANNOUNCEMENTS.load()         → resolve the posts (async)
//   every [data-announcements] element is painted automatically
//
// A post is { date, title, body, href, label }. Only `title` is required.
// The array order IS the published order: the first entry is the newest,
// so a new post goes to the top. The date is displayed, never used to
// reorder — two posts on the same day must not swap places by accident.

(function () {
  'use strict';
  if (window.SWR_ANNOUNCEMENTS) return;

  const SLICE_ID = 'swr-footer-data';
  const MAX = 12;

  // --- data ------------------------------------------------------------

  let cache = null;      // the resolved posts
  let sliceCache;        // the parsed inlined slice, parsed once
  let sliceTried = false;

  function sliceData() {
    if (sliceTried) return sliceCache;
    sliceTried = true;
    sliceCache = null;
    let node = null;
    try {
      node = document.getElementById(SLICE_ID);
    } catch (e) {
      node = null;
    }
    if (!node) return null;
    try {
      sliceCache = JSON.parse(node.textContent || '{}');
    } catch (e) {
      sliceCache = null;
    }
    return sliceCache;
  }

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = String(item.title || '').trim();
      if (!title) continue;
      out.push({
        date: String(item.date || '').trim(),
        title: title,
        body: String(item.body || '').trim(),
        href: String(item.href || '').trim(),
        label: String(item.label || '').trim(),
      });
    }
    return out.slice(0, MAX);
  }

  function fromSlice() {
    const data = sliceData();
    if (!data || !Array.isArray(data.announcements)) return null;
    return normalize(data.announcements);
  }

  async function load() {
    const sliced = fromSlice();
    if (sliced) {
      cache = sliced;
      return cache;
    }
    try {
      const res = await fetch('/site-map.json', { cache: 'no-cache' });
      const data = await res.json();
      cache = normalize(data && data.announcements);
    } catch (e) {
      cache = [];
    }
    return cache;
  }

  function list(limit) {
    const items = cache || fromSlice() || [];
    const n = Number(limit);
    if (Number.isFinite(n) && n > 0) return items.slice(0, n);
    return items.slice();
  }

  function latest() {
    return list(1)[0] || null;
  }

  // --- rendering -------------------------------------------------------

  function makeEl(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function isExternal(href) {
    return /^https?:/i.test(String(href || ''));
  }

  function render(target, opts) {
    const o = opts || {};
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return 0;
    const items = list(o.limit);
    container.textContent = '';
    if (!items.length) {
      if (o.empty) container.appendChild(makeEl('p', o.emptyClass || 'announcements__empty', o.empty));
      return 0;
    }
    for (const item of items) {
      const card = makeEl('article', o.itemClass || 'announcement');
      if (item.date) card.appendChild(makeEl('p', o.dateClass || 'announcement__date', item.date));
      card.appendChild(makeEl('h3', o.titleClass || 'announcement__title', item.title));
      if (item.body) card.appendChild(makeEl('p', o.bodyClass || 'announcement__body', item.body));
      if (item.href) {
        const a = makeEl('a', o.linkClass || 'announcement__link', item.label || item.title);
        a.href = item.href;
        if (isExternal(item.href)) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        card.appendChild(a);
      }
      container.appendChild(card);
    }
    return items.length;
  }

  // Paint every [data-announcements] container on the page. The attribute
  // value is the limit; `data-announcements-empty` is the text shown when
  // there is nothing to post.
  function mountAll() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[data-announcements]');
    } catch (e) {
      return 0;
    }
    let painted = 0;
    nodes.forEach(node => {
      const raw = parseInt(node.getAttribute('data-announcements'), 10);
      const limit = Number.isFinite(raw) && raw > 0 ? raw : undefined;
      const empty = node.getAttribute('data-announcements-empty') || '';
      painted += render(node, { limit: limit, empty: empty });
    });
    return painted;
  }

  window.SWR_ANNOUNCEMENTS = {
    list: list,
    latest: latest,
    render: render,
    load: load,
    mountAll: mountAll,
  };

  // The slice is available at parse time, so the common case paints
  // synchronously. Without it, resolve the data and paint again.
  if (fromSlice()) mountAll();
  else load().then(mountAll);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  }
})();
