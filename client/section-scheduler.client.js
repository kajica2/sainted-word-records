// client/section-scheduler.client.js
//
// Listens for `swr-section-change` events and tweens the engine's
// chapter state from the current chapter to the new one over N beats.
// Chapter schema: { anchors: [string], chroma, grain, glow, motion,
// rotation, bloom }. Scalars interpolate with smoothstep easing (same
// curve as engine-timing.client.js `ease('smooth')`). Anchor weights
// are driven via `window.SWR_ANCHOR_MAP.setWeight(id, w)`. Fires
// `swr-section-applied` when transitionProgress reaches 1.
//
// Public surface — window.SWR_SECTION_SCHEDULER:
//   .init({ getState, setState, transitions })
//   .currentChapter, .targetChapter, .transitionProgress (0..1)
//
// Window knob: window.SWR_TRANSITION_BEATS (default 4).

(function () {
  'use strict';
  if (window.SWR_SECTION_SCHEDULER) return;

  const FIELDS = ['chroma', 'grain', 'glow', 'motion', 'rotation', 'bloom'];
  const DEFAULTS = { beats: 4 };

  let getState = null;
  let setState = null;
  let transitions = null;
  let rafId = null;
  let startMs = 0;
  let durationMs = 0;
  let fromChapter = null;
  let toChapter = null;
  let fromName = null;
  let toName = null;
  let anchorIds = [];
  let active = false;

  const pub = {
    currentChapter: null,
    targetChapter: null,
    transitionProgress: 0,
  };

  function smoothstep(t) {
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function readBpm() {
    const a = window.SWR && window.SWR.Audio;
    return a && a.feat && a.feat.bpm ? a.feat.bpm : 120;
  }

  function beatsToMs(beats) {
    const bpm = readBpm();
    if (!bpm) return beats * 500;
    return (beats * 60 * 1000) / bpm;
  }

  function chapterFor(name) {
    if (!transitions || !name) return null;
    if (typeof transitions === 'function') return transitions(name);
    return transitions[name] || null;
  }

  function applyAnchorWeight(id, w) {
    const map = window.SWR_ANCHOR_MAP;
    if (map && typeof map.setWeight === 'function') {
      try { map.setWeight(id, w); } catch (_) {}
    }
  }

  function snapshotLive() {
    let live = null;
    if (typeof getState === 'function') {
      try { live = getState(); } catch (_) { live = null; }
    }
    const fromAnchors = pub.currentChapter
      ? (chapterFor(pub.currentChapter) || {}).anchors || []
      : (live && live.anchors) || [];
    return {
      anchors: fromAnchors,
      chroma:   live && typeof live.chroma   === 'number' ? live.chroma   : 0,
      grain:    live && typeof live.grain    === 'number' ? live.grain    : 0,
      glow:     live && typeof live.glow     === 'number' ? live.glow     : 0,
      motion:   live && typeof live.motion   === 'number' ? live.motion   : 0,
      rotation: live && typeof live.rotation === 'number' ? live.rotation : 0,
      bloom:    live && typeof live.bloom    === 'number' ? live.bloom    : 0,
    };
  }

  function step() {
    rafId = null;
    if (!active || !fromChapter || !toChapter) return;
    const elapsed = performance.now() - startMs;
    const raw = durationMs > 0 ? elapsed / durationMs : 1;
    const t = raw >= 1 ? 1 : (raw <= 0 ? 0 : raw);
    pub.transitionProgress = t;
    const e = smoothstep(t);

    if (typeof setState === 'function') {
      const blended = {};
      for (let i = 0; i < FIELDS.length; i++) {
        const k = FIELDS[i];
        const a = typeof fromChapter[k] === 'number' ? fromChapter[k] : 0;
        const b = typeof toChapter[k]   === 'number' ? toChapter[k]   : a;
        blended[k] = a + (b - a) * e;
      }
      try { setState(blended); } catch (_) {}
    }

    for (let i = 0; i < anchorIds.length; i++) {
      const id = anchorIds[i];
      const inFrom = fromChapter.anchors && fromChapter.anchors.indexOf(id) !== -1;
      const inTo   = toChapter.anchors   && toChapter.anchors.indexOf(id)   !== -1;
      let w;
      if (inFrom && inTo) w = e;       // shared: ramp by eased t
      else if (inTo)      w = e;       // new in target: fade in 0→1
      else                w = 1 - e;  // exclusive to source: fade out 1→0
      applyAnchorWeight(id, w);
    }

    if (t >= 1) {
      pub.currentChapter = toName;
      pub.targetChapter = toName;
      pub.transitionProgress = 1;
      // Final snap: ensure exact target values, not float drift.
      if (typeof setState === 'function' && toChapter) {
        const snap = {};
        for (let i = 0; i < FIELDS.length; i++) {
          const k = FIELDS[i];
          snap[k] = typeof toChapter[k] === 'number' ? toChapter[k] : 0;
        }
        try { setState(snap); } catch (_) {}
      }
      try {
        window.dispatchEvent(new CustomEvent('swr-section-applied', {
          detail: { from: fromName, to: toName },
        }));
      } catch (_) {}
      active = false;
      fromChapter = null;
      toChapter = null;
      fromName = null;
      toName = null;
      anchorIds = [];
      return;
    }

    rafId = requestAnimationFrame(step);
  }

  function startTransition(name, chapter) {
    if (!chapter) return;
    fromChapter = snapshotLive();
    toChapter = chapter;
    fromName = pub.currentChapter;
    toName = name;

    const beats = (typeof window.SWR_TRANSITION_BEATS === 'number' && window.SWR_TRANSITION_BEATS > 0)
      ? window.SWR_TRANSITION_BEATS
      : DEFAULTS.beats;
    durationMs = Math.max(1, beatsToMs(beats));

    const set = {};
    if (fromChapter.anchors) for (let i = 0; i < fromChapter.anchors.length; i++) set[fromChapter.anchors[i]] = 1;
    if (toChapter.anchors)   for (let i = 0; i < toChapter.anchors.length;   i++) set[toChapter.anchors[i]]   = 1;
    anchorIds = Object.keys(set);

    pub.targetChapter = name;
    pub.transitionProgress = 0;
    startMs = performance.now();
    active = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(step);
  }

  function onSectionChange(ev) {
    const d = ev && ev.detail;
    if (!d || !d.to) return;
    const chapter = chapterFor(d.to);
    if (!chapter) return;
    startTransition(d.to, chapter);
  }

  function init(opts) {
    opts = opts || {};
    getState = typeof opts.getState === 'function' ? opts.getState : null;
    setState = typeof opts.setState === 'function' ? opts.setState : null;
    transitions = opts.transitions || null;
    if (pub.currentChapter == null) {
      pub.currentChapter = 'intro';
      pub.targetChapter = 'intro';
    }
    window.addEventListener('swr-section-change', onSectionChange);
    return window.SWR_SECTION_SCHEDULER;
  }

  window.SWR_SECTION_SCHEDULER = {
    init,
    get currentChapter() { return pub.currentChapter; },
    get targetChapter() { return pub.targetChapter; },
    get transitionProgress() { return pub.transitionProgress; },
    _DEFAULTS: DEFAULTS,
  };
})();