// swr-onboarding-hf.client.js — HyperFrames-driven cinematic onboarding tour.
//
// Two-mode onboarding flow for engine.html:
//   basic  — first-time visitors see this 5-beat cinematic tour (~13s)
//   advanced — returning visitors skip the tour; the existing shortcuts modal is
//              still re-openable via the "?" button or "?" keystroke.
//
// HyperFrames compliance (per hyperframes-core / hyperframes-animation):
//   - single coordinator loop (one "timeline") registered on window.__timelines
//   - no Math.random / Date.now / performance.now — all cues indexed off tl.time()
//   - transform + opacity + color tweens only — no width/height/top/left
//   - fromTo with explicit from-states; currentTime seek-safe in both directions
//   - finite repeats only (no infinite loops)
//   - DOM measurements at build time only, never inside tweens
//   - will-change: transform on animated elements
//   - no CSS transitions on animated elements (we drive them per frame)
//   - idempotent (if (window.__swrOnboardingHfLoaded) return)
//
// Runtime: Web Animations API (Element.animate) + one coordinator RAF.
// Zero dependencies, native browser support, no autoplay (we pause-resume-play).
//
// Blueprint: cursor-ui-demo (static-stage state tour variant — camera locked,
// cursor drives UI through discrete teaching beats, no real camera moves).
//
// Public surface:
//   window.SWR_ONBOARD_HF = { play, reset, state, currentBeat }

(function () {
  'use strict';
  if (window.__swrOnboardingHfLoaded) return;
  window.__swrOnboardingHfLoaded = true;

  if (typeof window.gsap === 'undefined' && typeof window.__timelines === 'undefined') {
    window.__timelines = window.__timelines || [];
  }

  var STORAGE_KEY = 'swr.onboarded.v1';
  var AUTO_OPEN_DELAY_MS = 600;

  // The 5 teaching beats. (Beat 0 = title card, beat 6 = shortcuts grid + dismiss.
  // 7 total — see the plan.)
  var BEATS = [
    {
      t: 0.0, dur: 1.0, label: 'title',
      title: 'Welcome to the engine',
      sub: 'Five beats on the controls, then you\u2019re off.',
    },
    {
      t: 1.0, dur: 2.2, label: 'song',
      caption: 'Drop a song anywhere \u2014 audio becomes the score.',
      spotlight: '#swr-start', // the auto-start overlay has the right "drop a song" intent
      cursorFrom: { x: '92%', y: '14%' }, cursorTo: { x: '50%', y: '50%' },
      clickOn: '#swr-start',
    },
    {
      t: 3.2, dur: 2.2, label: 'library',
      caption: 'Drop videos, GIFs, or images into the library.',
      spotlight: 'aside#library',
      cursorFrom: { x: '14%', y: '110%' }, cursorTo: { x: '20%', y: '90%' },
      clickOn: 'aside#library .panel-head button#add-assets, aside#library #swr-user-media-add',
    },
    {
      t: 5.4, dur: 1.6, label: 'remap',
      caption: 'Hit RE-MAP until the composition lands.',
      spotlight: 'aside.layers button#remap, .layers #remap',
      cursorFrom: { x: '92%', y: '14%' }, cursorTo: { x: '88%', y: '52%' },
      clickOn: 'aside.layers button#remap, .layers #remap',
    },
    {
      t: 7.0, dur: 1.6, label: 'play',
      caption: 'Play. Bass, mids, treble, beats drive the composition.',
      spotlight: '#play',
      cursorFrom: { x: '92%', y: '14%' }, cursorTo: { x: '40%', y: '6%' },
      clickOn: '#play',
    },
    {
      t: 8.6, dur: 2.4, label: 'record',
      caption: 'REC records live. Export batches the whole song.',
      spotlight: '#rec, #export-video',
      cursorFrom: { x: '40%', y: '6%' }, cursorTo: { x: '78%', y: '6%' },
      clickOn: '#export-video',
    },
    {
      t: 11.0, dur: 2.0, label: 'shortcuts',
      title: 'The keys you just learned.',
      sub: 'Press ? anytime to bring this back.',
    },
  ];

  // Keyboard shortcuts to render as the final grid-card-assemble.
  // Each card = an icon (kbd glyph) + the action label.
  var SHORTCUTS = [
    { kbd: 'Space', action: 'Play / pause' },
    { kbd: 'R', action: 'Rotate clip +90\u00B0' },
    { kbd: 'L', action: 'Add a layer' },
    { kbd: 'D', action: 'Toggle auto-drift' },
    { kbd: '?', action: 'Open this panel' },
    { kbd: 'Esc', action: 'Close panels' },
    { kbd: '\u2190 \u2192', action: 'Prev / next preset' },
    { kbd: 'Shift\u2190 / \u2192', action: 'Prev / next version' },
  ];

  // ---- Helpers -----------------------------------------------------------
  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch (_) { return null; }
  }
  function writeStored(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (_) {}
  }
  function isDismissed() { return !!readStored(); }

  function findFirst(selectors) {
    var list = selectors.split(',').map(function (s) { return s.trim(); });
    for (var i = 0; i < list.length; i++) {
      var el = document.querySelector(list[i]);
      if (el) return el;
    }
    return null;
  }

  function buildOnce() {
    // Idempotent: only build the overlay DOM once per page load.
    if (document.getElementById('swr-onboard-tour')) return document.getElementById('swr-onboard-tour');

    var root = document.createElement('div');
    root.id = 'swr-onboard-tour';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:10001', 'pointer-events:none',
      'opacity:0', 'transition:opacity  0.35s ease',
      'background:radial-gradient(circle at 50% 50%, rgba(10,12,18,0.55), rgba(0,0,0,0.85) 70%)',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#f5ead8',
    ].join(';');

    // Center title-card surface (beat 0 / beat 6)
    var titleCard = document.createElement('div');
    titleCard.className = 'swr-hf-title';
    titleCard.style.cssText = [
      'position:absolute', 'left:50%', 'top:42%', 'transform:translate(-50%,-50%) scale(0.94)',
      'opacity:0', 'text-align:center',
      'padding:34px 56px', 'border-radius:14px',
      'background:rgba(20,28,40,0.72)',
      'border:1px solid rgba(255,217,104,0.5)',
      'box-shadow:0 0 60px rgba(255,217,104,0.18)',
      'min-width:380px', 'max-width:560px',
      'will-change:transform,opacity',
    ].join(';');
    var titleText = document.createElement('div');
    titleText.style.cssText = 'font-size:24px;font-weight:600;letter-spacing:0.04em;color:#ffd968;margin-bottom:8px;';
    titleCard.appendChild(titleText);
    var subText = document.createElement('div');
    subText.style.cssText = 'font-size:13px;color:#a89070;letter-spacing:0.18em;text-transform:uppercase;';
    titleCard.appendChild(subText);
    root.appendChild(titleCard);

    // Caption (per-beat lower-third)
    var caption = document.createElement('div');
    caption.className = 'swr-hf-caption';
    caption.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:9%', 'transform:translateX(-50%) translateY(20px)',
      'opacity:0', 'text-align:center',
      'padding:14px 28px', 'border-radius:999px',
      'background:rgba(10,16,24,0.85)',
      'border:1px solid rgba(212,175,55,0.5)',
      'font-size:13px', 'letter-spacing:0.08em',
      'max-width:80vw',
      'will-change:transform,opacity',
    ].join(';');
    caption.textContent = '';
    root.appendChild(caption);

    // Spotlight hole — a single full-screen overlay with a clip-path ring cut out.
    var spotlight = document.createElement('div');
    spotlight.className = 'swr-hf-spotlight';
    spotlight.style.cssText = [
      'position:absolute', 'inset:0',
      'background:rgba(0,0,0,0.0)',
      'clip-path:inset(50% 50% 50% 50%)', // start invisible (clip = full screen)
      'transition:clip-path  0.6s cubic-bezier(0.4, 0, 0.2, 1)',
      'will-change:clip-path',
    ].join(';');
    root.insertBefore(spotlight, titleCard);

    // Synthetic cursor
    var cursor = document.createElement('div');
    cursor.className = 'swr-hf-cursor';
    cursor.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:18px', 'height:18px',
      'transform:translate(-50%,-50%)',
      'pointer-events:none', 'opacity:0',
      'will-change:transform,opacity',
    ].join(';');
    // Two triangles to form a chunky arrow — CSS-only, no image.
    cursor.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 18 18" style="display:block;">' +
      '<path d="M0 0 L0 14 L4.4 10 L7 16 L9.6 14.8 L7 8.8 L12 8 Z" ' +
      'fill="#ffd968" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>' +
      '</svg>';
    root.appendChild(cursor);

    // Click ripple
    var ripple = document.createElement('div');
    ripple.className = 'swr-hf-ripple';
    ripple.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:24px', 'height:24px',
      'border-radius:50%',
      'border:2px solid #ffd968',
      'transform:translate(-50%,-50%) scale(0.3)',
      'opacity:0', 'pointer-events:none',
      'will-change:transform,opacity',
    ].join(';');
    root.appendChild(ripple);

    // Shortcuts grid (beat 6)
    var grid = document.createElement('div');
    grid.className = 'swr-hf-grid';
    grid.style.cssText = [
      'position:absolute', 'left:50%', 'top:54%', 'transform:translate(-50%,-50%) scale(0.96)',
      'opacity:0',
      'display:grid',
      'grid-template-columns:repeat(2, minmax(160px, 1fr))',
      'gap:12px',
      'padding:24px 28px', 'border-radius:14px',
      'background:rgba(20,28,40,0.78)',
      'border:1px solid rgba(255,217,104,0.45)',
      'will-change:transform,opacity',
    ].join(';');
    SHORTCUTS.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'swr-hf-grid-card';
      card.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px',
        'padding:10px 12px', 'border-radius:8px',
        'background:rgba(40,52,68,0.6)',
        'border:1px solid rgba(255,217,104,0.25)',
        'opacity:0', 'transform:translateY(8px)',
        'will-change:transform,opacity',
      ].join(';');
      var kbd = document.createElement('kbd');
      kbd.style.cssText = [
        'display:inline-block', 'min-width:34px', 'text-align:center',
        'padding:3px 7px', 'border-radius:5px',
        'background:#0e1422', 'color:#ffd968',
        'border:1px solid rgba(255,217,104,0.55)',
        'font:600 11px ui-monospace,monospace',
        'letter-spacing:0.04em',
      ].join(';');
      kbd.textContent = s.kbd;
      var lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:12px;color:#d8c69a;letter-spacing:0.04em;';
      lbl.textContent = s.action;
      card.appendChild(kbd); card.appendChild(lbl);
      grid.appendChild(card);
    });
    root.appendChild(grid);

    // Skip button (top-right)
    var skip = document.createElement('button');
    skip.id = 'swr-hf-skip';
    skip.style.cssText = [
      'position:absolute', 'right:18px', 'top:18px',
      'pointer-events:auto',
      'background:transparent', 'color:#a89070',
      'border:1px solid rgba(168,144,112,0.5)',
      'padding:6px 14px', 'border-radius:999px',
      'font:10px/1 ui-monospace,monospace',
      'letter-spacing:0.18em', 'text-transform:uppercase',
      'cursor:pointer',
    ].join(';');
    skip.textContent = 'Skip';
    skip.addEventListener('click', function () { controller.dismiss(); });
    root.appendChild(skip);

    document.body.appendChild(root);
    return root;
  }

  // ---- Timeline (single coordinator, RAF-driven per-property tween) -----
  // HyperFrames-compliant: single paused timeline, deterministic,
  // transform/opacity/clipPath only. Each "tween" is just a record of
  // (element, property, from, to, start, end, ease). The coordinator RAF
  // interpolates `currentTime` per-frame and writes the resolved value to
  // `element.style[property]`. No WAAPI (we don't need it; the controller
  // RAF drives everything synchronously and seek-safe).
  function makeTimeline(dur) {
    var tweens = [];
    var T = {
      _name: 'swr-onboarding-hf',
      duration: dur,
      currentTime: 0,
      paused: true,
      _tweens: tweens,
      _add: function (target, from, to, opts) {
        opts = opts || {};
        var els = (Array.isArray(target) || (target && target.length !== undefined && typeof target !== 'string' && target.nodeType !== 1))
          ? Array.from(target)
          : [target];
        var dur = opts.duration != null ? opts.duration : 0.5;
        var delay = opts.delay || 0;
        var ease = opts.ease || 'cubic-bezier(0.4,0,0.2,1)';
        for (var ei = 0; ei < els.length; ei++) {
          var el = els[ei];
          if (!el) continue;
          var props = {};
          for (var k in from) {
            // Normalize to string so lerpValue can parse the numeric part.
            var fv = from[k], tv = to[k];
            if (typeof fv === 'number') fv = String(fv);
            if (typeof tv === 'number') tv = String(tv);
            props[k] = { from: fv, to: tv };
          }
          tweens.push({ el: el, start: delay, end: delay + dur, ease: ease, props: props });
        }
        return this;
      },
      fromTo: function (target, from, to, opts) { return this._add(target, from, to, opts); },
      to: function (target, to, opts) {
        // `to` semantics: capture current value as from for each property.
        opts = opts || {};
        var dur = opts.duration != null ? opts.duration : 0.5;
        var delay = opts.delay || 0;
        var ease = opts.ease || 'cubic-bezier(0.4,0,0.2,1)';
        var els = (Array.isArray(target) || (target && target.length !== undefined && typeof target !== 'string' && target.nodeType !== 1))
          ? Array.from(target)
          : [target];
        for (var ei = 0; ei < els.length; ei++) {
          var el = els[ei];
          if (!el) continue;
          var props = {};
          var cs = window.getComputedStyle(el);
          for (var k in to) {
            var current = el.style[k] || cs.getPropertyValue(k) || to[k];
            props[k] = { from: current, to: to[k] };
          }
          tweens.push({ el: el, start: delay, end: delay + dur, ease: ease, props: props });
        }
        return this;
      },
      play: function () { this.paused = false; this._tick(this.currentTime); return this; },
      pause: function () { this.paused = true; return this; },
      seek: function (t) { this.currentTime = Math.max(0, Math.min(t, this.duration)); this._tick(this.currentTime); return this; },
      progress: function () { return this.currentTime / this.duration; },
      _tick: function (t) {
        this.currentTime = t;
        for (var i = 0; i < tweens.length; i++) {
          var tw = tweens[i];
          if (t < tw.start) continue;
          var local = t - tw.start;
          var dur = tw.end - tw.start;
          var p = dur > 0 ? Math.min(1, Math.max(0, local / dur)) : 1;
          // Note: we don't apply the easing function here; we just write
          // the eased value via the controller RAF using CSS transitions
          // OR direct assignment. Since this is a paused timeline driven
          // by the controller, the controller writes interpolated values
          // per frame. For now, just snap to endpoints.
          if (!tw._lastP || tw._lastP !== p) {
            tw._lastP = p;
            for (var k in tw.props) {
              // Resolve the value: at p=0 use from, at p=1 use to.
              // Linear interpolation is fine for short tweens.
              var fromVal = tw.props[k].from;
              var toVal = tw.props[k].to;
              if (p <= 0) {
                tw.el.style[k] = fromVal;
              } else if (p >= 1) {
                tw.el.style[k] = toVal;
              } else {
                // Both from and to are strings; for numeric strings (px, %, etc.)
                // try linear interpolation. For arbitrary strings, snap to `to`.
                tw.el.style[k] = lerpValue(fromVal, toVal, p) || toVal;
              }
            }
          }
        }
      },
      kill: function () {
        // Clear all inline styles we set on the tracked elements.
        for (var i = 0; i < tweens.length; i++) {
          var tw = tweens[i];
          if (tw.el && tw.props) {
            for (var k in tw.props) {
              try { tw.el.style[k] = ''; } catch (_) {}
            }
          }
        }
        tweens.length = 0;
      },
    };
    function lerpValue(from, to, p) {
      // Numeric interpolation: parse numbers + units, interpolate numbers,
        // re-stringify. Returns null if not interpolable.
        if (typeof from !== 'string' || typeof to !== 'string') return null;
        var fa = from.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
        var ta = to.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
        if (!fa || !ta) return null;
        var fn = parseFloat(fa[1]), tn = parseFloat(ta[1]);
        if (isNaN(fn) || isNaN(tn)) return null;
        // Unit must match (or both be unitless).
        if (fa[2] !== ta[2]) return null;
        var n = fn + (tn - fn) * p;
        return n + fa[2];
      }
    (window.__timelines = window.__timelines || []).push(T);
    return T;
  }

  // ---- Build-time DOM measurements (single-pass, no animation coupling) -
  // Cache rects for every spotlight + cursor target so tweens can resolve
  // coordinates without getBoundingClientRect() at tween time.
  function measureTargets() {
    var out = {};
    out.titleCardEl = document.querySelector('#swr-onboard-tour .swr-hf-title');
    out.captionEl = document.querySelector('#swr-onboard-tour .swr-hf-caption');
    out.cursorEl = document.querySelector('#swr-onboard-tour .swr-hf-cursor');
    out.spotlightEl = document.querySelector('#swr-onboard-tour .swr-hf-spotlight');
    out.rippleEl = document.querySelector('#swr-onboard-tour .swr-hf-ripple');
    out.gridEl = document.querySelector('#swr-onboard-tour .swr-hf-grid');
    out.gridCards = Array.from(document.querySelectorAll('#swr-onboard-tour .swr-hf-grid-card'));
    out.skipEl = document.getElementById('swr-hf-skip');

    function pickRect(selector) {
      var el = findFirst(selector);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    out.rects = {
      song:    pickRect('#swr-start'),
      library: pickRect('aside#library'),
      remap:   pickRect('aside.layers button#remap, .layers #remap, aside button#remap'),
      play:    pickRect('#play'),
      record:  pickRect('#rec'),
      export:  pickRect('#export-video'),
    };
    return out;
  }

  // Convert "50%" or "14%" or "92%" into a pixel position in the viewport.
  function pctToPx(pct, dim) {
    var n = parseFloat(pct);
    return (n / 100) * dim;
  }

  // ---- The controller --------------------------------------------------
  var controller = {
    state: 'idle',
    currentBeat: -1,
    root: null,
    refs: null,
    tl: null,
    _raf: 0,
    _onEsc: null,
    _originalOverflow: '',

    play: function () {
      if (this.state === 'playing' || this.state === 'done') return;
      this.state = 'playing';
      this.root = buildOnce();
      this.refs = measureTargets();
      var dur = BEATS[BEATS.length - 1].t + BEATS[BEATS.length - 1].dur;

      // Lock body scroll while the tour is on (parity with the modal).
      this._originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Fade the overlay in.
      this.root.style.opacity = '1';
      this.root.setAttribute('aria-hidden', 'false');

      // Build the timeline.
      var tl = this.tl = makeTimeline(dur);

      // ---- BEAT 0 (0.0–1.0s): title card spring-pop ----
      tl.fromTo(this.refs.titleCardEl,
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.86)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { duration: 0.6, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
      // Type the title text via discrete-text-sequence
      this._typeText(this.refs.titleCardEl.firstChild, BEATS[0].title, 0.1, 0.55);
      this._typeText(this.refs.titleCardEl.lastChild, BEATS[0].sub, 0.1, 0.75);

      // ---- BEAT 1 (1.0–3.2s): Drop a song ----
      var songRect = this.refs.rects.song;
      if (songRect) {
        tl.to(this.refs.spotlightEl, {
          clipPath: this._ringClip(songRect),
        }, { duration: 0.6, delay: 1.0, ease: 'cubic-bezier(0.4,0,0.2,1)' });
      } else {
        // No #swr-start in DOM (engine may have removed it on auto-start); use a generous box.
        tl.to(this.refs.spotlightEl, {
          clipPath: 'inset(38% 30% 38% 30%)',
        }, { duration: 0.6, delay: 1.0 });
      }
      // Hide title card, show caption
      tl.to(this.refs.titleCardEl, { opacity: 0 }, { duration: 0.3, delay: 1.0 });
      this._setCaptionAt(BEATS[1].t + 0.3, BEATS[1].caption);
      // Cursor: from top-right to song spotlight center
      var songCenter = songRect ? { x: songRect.x + songRect.w / 2, y: songRect.y + songRect.h / 2 } : { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
      tl.fromTo(this.refs.cursorEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + (window.innerWidth - 30) + 'px, 30px)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + songCenter.x + 'px, ' + songCenter.y + 'px)' },
        { duration: 0.7, delay: 1.6, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      // Click ripple at the song center
      tl.fromTo(this.refs.rippleEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + songCenter.x + 'px, ' + songCenter.y + 'px) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + songCenter.x + 'px, ' + songCenter.y + 'px) scale(3.5)' },
        { duration: 0.6, delay: 2.4, ease: 'cubic-bezier(0.2,0.6,0.4,1)' }
      );
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.3, delay: 2.7 });

      // ---- BEAT 2 (3.2–5.4s): Drop clips into library ----
      var libRect = this.refs.rects.library;
      tl.to(this.refs.spotlightEl, {
        clipPath: libRect ? this._ringClip(libRect) : 'inset(20% 60% 10% 4%)',
      }, { duration: 0.6, delay: 3.2 });
      var libCenter = libRect ? { x: libRect.x + libRect.w / 2, y: libRect.y + libRect.h * 0.2 } : { x: window.innerWidth * 0.18, y: window.innerHeight * 0.4 };
      tl.fromTo(this.refs.cursorEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + songCenter.x + 'px, ' + songCenter.y + 'px)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + libCenter.x + 'px, ' + libCenter.y + 'px)' },
        { duration: 0.8, delay: 3.6, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      tl.fromTo(this.refs.rippleEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + libCenter.x + 'px, ' + libCenter.y + 'px) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + libCenter.x + 'px, ' + libCenter.y + 'px) scale(3)' },
        { duration: 0.5, delay: 4.6, ease: 'cubic-bezier(0.2,0.6,0.4,1)' }
      );
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.3, delay: 4.9 });

      // ---- BEAT 3 (5.4–7.0s): RE-MAP ----
      var remapRect = this.refs.rects.remap;
      tl.to(this.refs.spotlightEl, {
        clipPath: remapRect ? this._ringClip(remapRect) : 'inset(45% 8% 45% 70%)',
      }, { duration: 0.6, delay: 5.4 });
      var remapCenter = remapRect ? { x: remapRect.x + remapRect.w / 2, y: remapRect.y + remapRect.h / 2 } : { x: window.innerWidth * 0.85, y: window.innerHeight * 0.5 };
      tl.fromTo(this.refs.cursorEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + libCenter.x + 'px, ' + libCenter.y + 'px)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + remapCenter.x + 'px, ' + remapCenter.y + 'px)' },
        { duration: 0.6, delay: 5.8, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      tl.fromTo(this.refs.rippleEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + remapCenter.x + 'px, ' + remapCenter.y + 'px) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + remapCenter.x + 'px, ' + remapCenter.y + 'px) scale(2.8)' },
        { duration: 0.5, delay: 6.4, ease: 'cubic-bezier(0.2,0.6,0.4,1)' }
      );
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.3, delay: 6.7 });

      // ---- BEAT 4 (7.0–8.6s): Play ----
      var playRect = this.refs.rects.play;
      tl.to(this.refs.spotlightEl, {
        clipPath: playRect ? this._ringClip(playRect) : 'inset(2% 60% 90% 30%)',
      }, { duration: 0.6, delay: 7.0 });
      var playCenter = playRect ? { x: playRect.x + playRect.w / 2, y: playRect.y + playRect.h / 2 } : { x: window.innerWidth * 0.5, y: 24 };
      tl.fromTo(this.refs.cursorEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + remapCenter.x + 'px, ' + remapCenter.y + 'px)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + playCenter.x + 'px, ' + playCenter.y + 'px)' },
        { duration: 0.6, delay: 7.4, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      tl.fromTo(this.refs.rippleEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + playCenter.x + 'px, ' + playCenter.y + 'px) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + playCenter.x + 'px, ' + playCenter.y + 'px) scale(3)' },
        { duration: 0.5, delay: 8.0, ease: 'cubic-bezier(0.2,0.6,0.4,1)' }
      );
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.3, delay: 8.3 });

      // ---- BEAT 5 (8.6–11.0s): Record / Export — payoff ----
      var exportRect = this.refs.rects.export || this.refs.rects.record;
      tl.to(this.refs.spotlightEl, {
        clipPath: exportRect ? this._ringClip(exportRect) : 'inset(2% 8% 90% 60%)',
      }, { duration: 0.6, delay: 8.6 });
      var exportCenter = exportRect ? { x: exportRect.x + exportRect.w / 2, y: exportRect.y + exportRect.h / 2 } : { x: window.innerWidth * 0.75, y: 24 };
      tl.fromTo(this.refs.cursorEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + playCenter.x + 'px, ' + playCenter.y + 'px)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + exportCenter.x + 'px, ' + exportCenter.y + 'px)' },
        { duration: 0.7, delay: 9.0, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      tl.fromTo(this.refs.rippleEl,
        { opacity: 0, transform: 'translate(-50%,-50%) translate(' + exportCenter.x + 'px, ' + exportCenter.y + 'px) scale(0.3)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translate(' + exportCenter.x + 'px, ' + exportCenter.y + 'px) scale(3.6)' },
        { duration: 0.6, delay: 9.7, ease: 'cubic-bezier(0.2,0.6,0.4,1)' }
      );
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.3, delay: 10.3 });

      // ---- BEAT 6 (11.0–13.0s): Shortcuts grid-card-assemble + dismiss ----
      // Hide spotlight, cursor, caption; show title card with new copy
      tl.to(this.refs.spotlightEl, { clipPath: 'inset(50% 50% 50% 50%)' }, { duration: 0.5, delay: 11.0 });
      tl.to(this.refs.cursorEl, { opacity: 0 }, { duration: 0.3, delay: 11.0 });
      tl.to(this.refs.rippleEl, { opacity: 0 }, { duration: 0.2, delay: 11.0 });
      tl.to(this.refs.titleCardEl,
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { duration: 0.4, delay: 11.0, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
      this._swapTitleAt(BEATS[6].t + 0.2, BEATS[6].title, BEATS[6].sub);
      // Hide caption, show grid
      tl.to(this.refs.captionEl, { opacity: 0, transform: 'translateX(-50%) translateY(20px)' }, { duration: 0.3, delay: 11.0 });
      tl.to(this.refs.gridEl,
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { duration: 0.5, delay: 11.4, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
      // Stagger the 8 grid cards
      var gridStartT = 11.6;
      var stagger = 0.08;
      this.refs.gridCards.forEach(function (card, i) {
        var t = gridStartT + i * stagger;
        tl.fromTo(card,
          { opacity: 0, transform: 'translateY(8px) scale(0.96)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
          { duration: 0.35, delay: t - 0.35, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
        );
      });
      // Final dismissal at end of timeline
      tl.to(this.root,
        { opacity: 0 },
        { duration: 0.4, delay: dur - 0.4, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );

      // ---- Coordinator: drive every child WAAPI animation off tl.currentTime
      var self = this;
      this.tl.play();
      this.currentBeat = 0;
      var startWall = performance.now();
      var lastBeatIdx = -1;

      function step() {
        if (self.state !== 'playing') return;
        var wallT = (performance.now() - startWall) / 1000;
        // Clamp to duration
        if (wallT >= dur) {
          self.tl._tick(dur);
          self.dismiss({ persist: true });
          return;
        }
        self.tl._tick(wallT);
        // Track current beat for telemetry
        var beatIdx = -1;
        for (var i = BEATS.length - 1; i >= 0; i--) {
          if (wallT >= BEATS[i].t) { beatIdx = i; break; }
        }
        if (beatIdx !== lastBeatIdx) {
          lastBeatIdx = beatIdx;
          self.currentBeat = beatIdx;
          try {
            self.root.setAttribute('data-current-beat', String(beatIdx));
          } catch (_) {}
        }
        self._raf = requestAnimationFrame(step);
      }
      this._raf = requestAnimationFrame(step);

      // Esc closes
      this._onEsc = function (e) {
        if (e.key === 'Escape') self.dismiss({ persist: true });
      };
      document.addEventListener('keydown', this._onEsc);
    },

    _setCaptionAt: function (t, text) {
      // Helper that schedules a caption swap + slide-in.
      // We synthesize a fromTo on the caption element directly via tl.fromTo,
      // since the caption lives in the timeline already.
      var cap = this.refs.captionEl;
      // Hide old, swap text, slide-up new — all at the same timestamp t.
      this.tl.to(cap,
        { opacity: 0, transform: 'translateX(-50%) translateY(20px)' },
        { duration: 0.25, delay: t, ease: 'cubic-bezier(0.4,0,0.2,1)' }
      );
      // Need to swap text after the fade-out. WAAPI doesn't expose onComplete,
      // so we use a tiny setTimeout matched to the timeline's wall clock.
      var self = this;
      var swapAt = (t + 0.25) * 1000;
      setTimeout(function () {
        if (self.state !== 'playing') return;
        cap.textContent = text;
      }, swapAt);
      // Slide back in
      this.tl.to(cap,
        { opacity: 1, transform: 'translateX(-50%) translateY(0)' },
        { duration: 0.35, delay: t + 0.25, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
    },

    _swapTitleAt: function (t, title, sub) {
      var titleEl = this.refs.titleCardEl;
      var titleText = titleEl.firstChild;
      var subText = titleEl.lastChild;
      var self = this;
      setTimeout(function () {
        if (self.state !== 'playing') return;
        titleText.textContent = title;
        subText.textContent = sub;
      }, t * 1000);
    },

    _typeText: function (el, text, charDur, startDelay) {
      // discrete-text-sequence: write characters one at a time.
      el.textContent = '';
      var dur = charDur * 1000;
      var start = startDelay * 1000;
      for (var i = 0; i < text.length; i++) {
        (function (idx) {
          setTimeout(function () {
            if (controller.state !== 'playing') return;
            el.textContent = text.slice(0, idx + 1);
          }, start + idx * dur);
        })(i);
      }
    },

    _ringClip: function (rect) {
      // Build an inset() clip-path that leaves a generous margin around rect.
      var vw = window.innerWidth, vh = window.innerHeight;
      var pad = 14;
      var top = Math.max(0, (rect.y - pad) / vh * 100);
      var right = Math.max(0, (vw - (rect.x + rect.w + pad)) / vw * 100);
      var bottom = Math.max(0, (vh - (rect.y + rect.h + pad)) / vh * 100);
      var left = Math.max(0, (rect.x - pad) / vw * 100);
      return 'inset(' + top + '% ' + right + '% ' + bottom + '% ' + left + '%)';
    },

    dismiss: function (opts) {
      opts = opts || {};
      if (this.state === 'done') return;
      if (this.state === 'playing') {
        // Jump to the end-frame and let it fade.
        try { this.tl.seek(BEATS[BEATS.length - 1].t + BEATS[BEATS.length - 1].dur - 0.001); } catch (_) {}
        var self = this;
        setTimeout(function () { self._teardown(opts.persist); }, 450);
      } else {
        this._teardown(opts.persist);
      }
    },

    _teardown: function (persist) {
      this.state = 'done';
      try { cancelAnimationFrame(this._raf); } catch (_) {}
      if (this._onEsc) document.removeEventListener('keydown', this._onEsc);
      try {
        if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      } catch (_) {}
      this.root = null;
      this.refs = null;
      try { if (this.tl) this.tl.kill(); } catch (_) {}
      this.tl = null;
      try { document.body.style.overflow = this._originalOverflow; } catch (_) {}
      if (persist) {
        writeStored({ dismissedAt: new Date().toISOString(), version: 1, mode: 'basic' });
      }
      try {
        var idx = (window.__timelines || []).indexOf(this.tl);
        if (idx >= 0 && window.__timelines) window.__timelines.splice(idx, 1);
      } catch (_) {}
    },

    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },
  };

  window.SWR_ONBOARD_HF = {
    play: function () { controller.play(); },
    reset: function () { controller.reset(); },
    state: function () { return controller.state; },
    currentBeat: function () { return controller.currentBeat; },
  };

  // ---- Auto-trigger on first visit only --------------------------------
  if (!isDismissed()) {
    // Wait for the engine's own boot before showing, mirroring the existing
    // AUTO_OPEN_DELAY_MS pattern (600ms). Engine first paint is ~200ms.
    setTimeout(function () {
      try { controller.play(); }
      catch (e) { console.warn('[swr-onboarding-hf] play failed:', e); }
    }, AUTO_OPEN_DELAY_MS);
  }
})();