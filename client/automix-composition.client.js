// client/automix-composition.client.js — L3 composition coupling
//
// The arc (client/automix-arc.client.js) owns the macro FX direction.
// This layer extends the act into the MEDIA composition: each act carries
// a cutting profile — how often the layer scheduler swaps clips — so the
// arrangement of clips on screen changes with the song, not just the
// colour grade. Peak acts cut fast (2.5–5s), breakdowns hold one mood
// (12–20s), intros establish slowly.
//
// Listens for the runtime's swr-automix-tick events (which carry
// mixed.arc when the arc is engaged) and re-configures the layer
// scheduler on act changes. Defensive throughout: no scheduler, no arc,
// or no act info → no-op, and the page's manual scheduler settings win
// whenever the user touches the panel (act changes re-apply on the next
// act boundary, not on every knob move).
//
// Act → cutting profile (seconds between clip swaps):
//   intro      9–14   establishing, slow
//   lift       6–10   building
//   peak       2.5–5  fast cutting
//   breakdown  12–20  one long mood
//   outro      8–14   settling
// Unknown act names fall back to 6–10.

(function () {
  'use strict';

  if (window.SWR_AUTOMIX_COMPOSITION) return;
  window.SWR_AUTOMIX_COMPOSITION = true;

  var PROFILES = {
    intro:     { minSeconds: 9,    maxSeconds: 14 },
    lift:      { minSeconds: 6,    maxSeconds: 10 },
    peak:      { minSeconds: 2.5,  maxSeconds: 5 },
    breakdown: { minSeconds: 12,   maxSeconds: 20 },
    outro:     { minSeconds: 8,    maxSeconds: 14 },
  };
  var DEFAULT_PROFILE = { minSeconds: 6, maxSeconds: 10 };

  var lastActIndex = null;
  var lastApplied = null;
  var lastProgress = null;

  // ---- Grouping helpers for automix ----
  // Extract name prefix for grouping (e.g. "intro_clip_01.mp4" -> "intro_clip")
  function getNamePrefix(name) {
    if (!name) return '_';
    // Strip common extensions and trailing numbers
    var base = name.replace(/\.(mp4|mov|webm|mkv|avi|m4v|jpg|jpeg|png|gif|webp)$/i, '');
    // Strip trailing _01, _02, -01, -02 etc
    base = base.replace(/[_-]?\d+$/, '');
    // Strip trailing v1, v2 etc
    base = base.replace(/v\d+$/i, '');
    return base.toLowerCase() || '_';
  }

  // Group items by name prefix, separate videos from static images
  function groupItemsByName(items) {
    var groups = {};
    var images = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || !item.url) continue;
      // Collect all static images separately
      if (item.type === 'image') {
        images.push(item);
        continue;
      }
      // Group videos by name prefix
      var prefix = getNamePrefix(item.name);
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(item);
    }
    return { groups: groups, images: images };
  }

  // Build layer pool: videos stay grouped by name, all images in one pool
  function buildGroupedPool(items) {
    var grouped = groupItemsByName(items || []);
    var pool = [];
    // Add video groups first (each group becomes a separate layer candidate)
    var prefixes = Object.keys(grouped.groups).sort();
    for (var i = 0; i < prefixes.length; i++) {
      var groupItems = grouped.groups[prefixes[i]];
      if (groupItems && groupItems.length) {
        pool.push.apply(pool, groupItems);
      }
    }
    // Add all static images at the end (they'll be assigned to one layer)
    if (grouped.images.length) {
      pool.push.apply(pool, grouped.images);
    }
    return pool;
  }

  // Media-store pool wrappers are cached by content signature: apply() runs
  // on every act boundary and on the 10s fallback, and building a fresh
  // object URL per media item per call leaked one blob URL each time (the
  // URLs were never revoked). Rebuild only when the store contents change,
  // revoking the previous URLs first.
  var mediaCache = { sig: null, wraps: [] };
  function mediaSig(items) {
    var s = '';
    for (var i = 0; i < items.length; i++) s += items[i].id + ',';
    return items.length + ':' + s;
  }
  function mediaWraps() {
    var items = window.__SWR_COMPOSITION_MEDIA || [];
    var sig = mediaSig(items);
    if (mediaCache.sig === sig) return mediaCache.wraps;
    for (var r = 0; r < mediaCache.wraps.length; r++) {
      try { URL.revokeObjectURL(mediaCache.wraps[r].url); } catch (_) {}
    }
    var wraps = [];
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var url = null;
      try { url = URL.createObjectURL(m.blob); } catch (_) {}
      if (!url) continue;
      wraps.push({
        id: m.id, name: m.name,
        type: (m.mime && m.mime.indexOf('video/') === 0) ? 'video' : 'image',
        url: url, blob: m.blob,
      });
    }
    mediaCache.sig = sig;
    mediaCache.wraps = wraps;
    return wraps;
  }

  function apply(actName, reason) {
    var sched = window.SWR_LAYER_SCHEDULER;
    if (!sched || typeof sched.setConfig !== 'function') return false;

    // Auto-populate the stage: variants don't auto-add library items as
    // layers (that's engine-only behaviour), so a user with clips in the
    // library but nothing on stage had NOTHING for the scheduler to
    // swap — the #1 cause of "automix isn't evolving my clips". Add up
    // to 3 layers from EITHER store (engine Library or the '+ ADD'
    // media store), once per session.
    // Grouping: videos grouped by name prefix, all static images together.
    var SWR = window.SWR;
    var Layers = SWR && SWR.Layers;
    var Library = SWR && SWR.Library;
    if (Layers && typeof Layers.add === 'function' &&
        (!Layers.list || !Layers.list.length)) {
      var engineItems = ((Library && Library.items) || []).filter(function (i) { return i && i.url; });
      var rawPool = engineItems.length ? engineItems : mediaWraps();
      // Use grouped pool: videos stay grouped by name, images together
      var pool = buildGroupedPool(rawPool);
      // Add up to 3 layers, respecting grouping
      for (var li = 0; li < Math.min(3, pool.length); li++) {
        try { Layers.add(pool[li]); } catch (_) {}
      }
    }

    var profile = PROFILES[actName] || DEFAULT_PROFILE;
    var minSeconds = profile.minSeconds;
    var maxSeconds = profile.maxSeconds;
    // Global invariant: a clip never stays visible longer than 8 bars.
    // Bars are tempo-dependent — 8 bars = 32 beats = 32·60/bpm seconds —
    // so the cap is computed from a SANITIZED bpm: the realtime beat
    // estimator can produce garbage (e.g. 1000+ on synthetic tones),
    // which once clamped every profile to 1s. Outside 30–250 BPM the
    // value is not trusted and 120 is used.
    var bpm = (SWR && SWR.Audio && SWR.Audio.feat && SWR.Audio.feat.bpm) || 0;
    if (!(bpm >= 30 && bpm <= 250)) bpm = 120;
    var cap8 = (32 * 60 / bpm);
    if (maxSeconds > cap8) maxSeconds = cap8;
    if (minSeconds > maxSeconds) minSeconds = maxSeconds;
    var same = lastApplied &&
      lastApplied.minSeconds === minSeconds &&
      lastApplied.maxSeconds === maxSeconds;
    if (same) return true;
    sched.setConfig({
      enabled: true,
      minSeconds: minSeconds,
      maxSeconds: maxSeconds,
      beatSync: true, // fades land on the beat — visibly tighter cuts
    });
    lastApplied = { minSeconds: minSeconds, maxSeconds: maxSeconds };
    try {
      document.dispatchEvent(new CustomEvent('swr-composition-change', {
        detail: { act: actName, profile: { minSeconds: minSeconds, maxSeconds: maxSeconds }, reason: reason || 'act-change' },
      }));
    } catch (_) {}
    return true;
  }

  // Belt-and-braces fallback: act ticks may never emit (FX mix failing,
  // arc missing) — clip evolution must not depend on them. When automix
  // is enabled but nothing has been applied yet, apply the default
  // profile on a slow poll. The arc, when it arrives, takes over.
  setInterval(function () {
    var am = window.automix;
    if (!am || !am.enabled) return;
    var M = window.SWR_MEDIA;
    var p;
    try {
      p = (M && typeof M.getUserMedia === 'function') ? Promise.resolve(M.getUserMedia()) : Promise.resolve([]);
    } catch (_) { p = Promise.resolve([]); }
    p.catch(function () { return []; }).then(function (items) {
      window.__SWR_COMPOSITION_MEDIA = (items || []).filter(function (it) { return it && it.id && it.blob; });
      if (lastActIndex !== null) return; // act stream is driving
      apply('lift', 'no-arc-fallback');
    });
  }, 10000);

  // The runtime's _emit dispatches on window (not document) — listen there.
  // Tick events only carry the no-arc fallback: act boundaries are tracked
  // on the 1s glide clock (tighter than the 8-20s tick cadence — cuts land
  // on the section change, not whenever the next tick happens to fire).
  window.addEventListener('swr-automix-tick', function (ev) {
    var arc = ((ev.detail || {}).mixed || {}).arc;
    if (!arc && lastActIndex !== 'no-arc') {
      lastActIndex = 'no-arc';
      apply('lift', 'no-arc-default');
    }
  });

  // 1s glide clock (runtime's _glideTick / music_video's graft): drives
  // the within-act cutting envelope and act-boundary cuts.
  window.addEventListener('swr-automix-glide', function (ev) {
    var g = ev.detail || {};
    if (typeof g.actIndex !== 'number') return;
    var sched = window.SWR_LAYER_SCHEDULER;
    if (g.actIndex !== lastActIndex) {
      lastActIndex = g.actIndex;
      lastProgress = null;
      apply(g.actName, 'act-change');
      // Section boundary → the composition changes WITH the music. The
      // swap flows through the normal applySwap path (crossfade +
      // beat-snap), so the cut lands on the next downbeat.
      if (sched && typeof sched.swapNow === 'function') sched.swapNow();
      return;
    }
    // Within-act cadence envelope: interpolate this act's cutting window
    // toward the next act's profile by actProgress — cuts tighten into a
    // peak, release into a breakdown, settle in the outro, instead of
    // stepping flat between per-act constants.
    if (!sched || typeof sched.setProgress !== 'function') return;
    var cur = PROFILES[g.actName] || DEFAULT_PROFILE;
    var nextName = g.nextActName || null;
    var nxt = (nextName && PROFILES[nextName]) || cur;
    var p = Math.max(0, Math.min(1, g.actProgress || 0));
    var pmin = cur.minSeconds + (nxt.minSeconds - cur.minSeconds) * p;
    var pmax = cur.maxSeconds + (nxt.maxSeconds - cur.maxSeconds) * p;
    // setProgress forwards a postMessage to the scheduler worker; skip it
    // when the interpolated window has not moved enough to matter.
    if (lastProgress &&
        Math.abs(lastProgress[0] - pmin) < 0.05 &&
        Math.abs(lastProgress[1] - pmax) < 0.05) return;
    lastProgress = [pmin, pmax];
    sched.setProgress(pmin, pmax);
  });

  // Re-apply when the arc rebuilds (new song) — resets act tracking.
  window.addEventListener('swr-automix-arc', function () {
    lastActIndex = null;
    lastApplied = null;
    lastProgress = null;
  });

  // Manual API for the debug panel / power users.
  window.SWR_AUTOMIX_COMPOSITION = {
    apply: apply,
    PROFILES: PROFILES,
  };
})();
