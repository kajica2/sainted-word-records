// lib/swr-natural.client.js — the natural-evolution render pass, shared.
//
// Four frame-level / audio-level effects for the whole versions/ lineage
// (22 variants + music_video + music_video_mtv) and engine.html, so no
// page's inline renderer has to carry its own copy:
//
//  1. Envelope followers on Audio.feat — every numeric feature gets an
//     attack/release follower (rise τ≈80ms, fall τ≈420ms, frame-rate
//     independent). Reactors, fx-postprocess and the automix all read the
//     smoothed value through a Proxy, so pulses breathe instead of
//     twitching. bpm/beatInBar and anything outside a [0,1.6] magnitude
//     window passes through unsmoothed; beatPulse (boolean) stays crisp
//     for beat-sync.
//  2. Filmic grade — CSS filter on the VISIBLE canvas only:
//     saturate(0.45) contrast(0.85) brightness(1.05). 55% desaturation,
//     contrast pivoted at mid → blacks lifted to soft gray AND highlights
//     rolled off before clipping. Muted pastel/filmic; no neon, no pure
//     black, no pure white. Applied to the fx-postprocess overlay when it
//     is up (it composites the stage), else the stage canvas — never both
//     (the grade must not double).
//  3. Feedback trail — a HALF-RES self-decaying echo buffer (decay 0.82,
//     feed 0.30, out 0.22) blended under each frame: motion smears into
//     the next frame instead of snapping. Compounding gain stays bounded
//     (0.82×0.30 ≈ 0.25) so nothing blooms.
//  4. Rotating vertical-axis mirror — two ghost passes of the frame (from
//     the same half-res buffer) reflected across slowly orbiting axes
//     (±14° and ±10° at different rates), soft-light 0.16 + screen 0.09,
//     source re-angled inside the mirror — symmetry without stasis.
//
// Quality adapts: sustained <24fps sheds the second ghost, then the whole
// frame pass; live counters on window.SWR_NATURAL.stats.
//
// Everything degrades independently: no Audio → no followers, no canvas →
// no frame pass. `window.SWR_NATURAL.setEnabled(false)` bypasses the
// follower (installed Proxies read through) and stops the frame pass;
// persisted in localStorage under 'swr.natural'.

(function () {
  'use strict';
  if (window.SWR_NATURAL) return;

  var GRADE = 'saturate(0.45) contrast(0.85) brightness(1.05)';
  var LS_KEY = 'swr.natural';
  var SKIP_KEYS = { bpm: 1, beatInBar: 1 };

  var state = {
    enabled: (function () {
      try { return localStorage.getItem(LS_KEY) !== '0'; } catch (_) { return true; }
    })(),
  };

  // ---- 1. Envelope follower on Audio.feat --------------------------------
  var featTarget = null;      // the raw object currently behind the proxy
  var env = Object.create(null); // key -> { v, t }

  function installFollower(Audio) {
    var raw = Audio && Audio.feat;
    if (!raw || typeof raw !== 'object' || raw === featTarget) return;
    featTarget = raw;
    var prox = new Proxy(raw, {
      get: function (t, k) {
        var v = t[k];
        if (!state.enabled || typeof v !== 'number' || SKIP_KEYS[k]) return v;
        var st = env[k];
        var now = performance.now();
        if (!st) { env[k] = { v: v, t: now }; return v; }
        var dt = (now - st.t) / 1000;
        st.t = now;
        if (dt <= 0) return st.v;
        if (dt > 0.25) dt = 0.25;           // tab-switch clamp
        if (Math.abs(v) > 1.6 || Math.abs(st.v) > 1.6) { st.v = v; return v; }
        var a = 1 - Math.exp(-dt / (v > st.v ? 0.08 : 0.42)); // attack / release
        st.v += (v - st.v) * a;
        return st.v;
      },
    });
    try { Audio.feat = prox; } catch (_) { featTarget = null; }
  }

  // ---- canvas + grade -----------------------------------------------------
  function getStage() {
    var S = window.SWR || {};
    var cands = [S.stage, document.getElementById('stage'),
      document.getElementById('render')];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c && typeof c.getContext === 'function' && c.width > 0 && c.height > 0) return c;
    }
    return null;
  }

  // Grade can be switched off at runtime by the adaptive guard
  // (lib/adaptive-guard.js rung 1) — a CSS filter is a GPU pass we keep on
  // capable devices and drop under sustained pressure.
  var gradeOn = true;

  function adaptiveState() {
    try { return (window.SWR_ADAPTIVE && window.SWR_ADAPTIVE.state()) || null; } catch (_) { return null; }
  }

  function gradeTopmost(stage) {
    var wantGrade = gradeOn && (!adaptiveState() || adaptiveState().cssFilters !== false);
    var fx = document.getElementById('fx-canvas');
    var visible = fx && fx.offsetParent !== null;
    var top = visible ? fx : stage;
    var want = wantGrade ? GRADE : 'none';
    if (top.__swrNatGrade !== want) {
      top.style.filter = want;
      top.__swrNatGrade = want;
    }
    var other = top === stage ? fx : stage;
    if (other && other.__swrNatGrade) {
      other.style.filter = 'none';
      other.__swrNatGrade = null;
    }
  }

  // ---- 4. rotating vertical-axis mirror -----------------------------------
  // The mirror axis can be flipped between the vertical and the horizontal
  // and switched off entirely ("rotkey", `R`). `axisFlip` is the sign of the
  // horizontal component of the reflection: -1 keeps the canonical
  // vertical-axis mirror, +1 mirrors across the horizontal instead.
  var MIRROR_MODES = ['vertical', 'horizontal', 'off'];
  var mirrorMode = (function () {
    try {
      var saved = localStorage.getItem('swr.mirror.mode');
      if (MIRROR_MODES.indexOf(saved) !== -1) return saved;
    } catch (_) {}
    return 'vertical';
  })();

  function mirrorAxisSign() { return mirrorMode === 'horizontal' ? 1 : -1; }
  function mirrorEnabled() { return mirrorMode !== 'off'; }

  function axisMirror(ctx, src, W, H, axis, alpha, comp) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = comp;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(axis);                          // orbit the mirror axis
    ctx.scale(-1, mirrorAxisSign());           // vertical (or horizontal) reflection
    ctx.rotate(-axis * 0.5);                   // source enters at a different angle than the frame
    ctx.drawImage(src, -W / 2, -H / 2, W, H);
    ctx.restore();
  }

  // ---- frame loop ----------------------------------------------------------
  // Perf shape (checklist #2/#3/#9): the echo buffer runs at HALF res
  // (trail + ghosts are intentionally soft — 1/4 the pixels, no visible
  // difference), the mirror ghosts read the same half-res buffer instead
  // of two extra full-res stage captures, and quality adapts: sustained
  // <24fps sheds the second ghost, then the whole frame pass, before the
  // page would drop frames; <50fps sustained recovers a level. Stats
  // ride on window.SWR_NATURAL.stats for profiling.
  var fb = null, fbCtx = null, fbW = 0, fbH = 0;
  var lastNow = 0, dtEma = 16, quality = 2, slowRun = 0, fastRun = 0;
  var stats = { frames: 0, msEma: 0, dtEma: 16, quality: 2, halfRes: true };

  // The trail + mirror must land AFTER the page has drawn its frame. Ordering
  // by rAF registration does NOT guarantee that: pages that re-register at
  // the END of their callback and pages that re-register at the START end up
  // on opposite sides of us, and the ones that clear the stage at the top of
  // their frame simply wipe the ghosts (engine.html did exactly this — the
  // pass ran 281 frames and left zero pixels). So the pages that own a render
  // loop dispatch `swr-frame-end` when they finish, and the pass runs there.
  // A page without the hook falls back to this module's own rAF (see frame()).
  var lastFrameEnd = 0;

  function compositePass(now) {
    var stage = getStage();
    if (!stage || !stage.width || !stage.height) return;
    if (!quality) return;
    var W = stage.width, H = stage.height;
    var ctx = stage.getContext('2d');
    if (!ctx) return;
    // Feedback buffer scale: half-res by default, smaller when the adaptive
    // guard has traded trail softness for frame time (rung 2).
    var ad = adaptiveState();
    var fbScale = (ad && ad.feedbackRes) ? ad.feedbackRes : 0.5;
    var wantW = Math.max(2, Math.round(W * fbScale));
    var wantH = Math.max(2, Math.round(H * fbScale));
    if (!fb || fbW !== wantW || fbH !== wantH) {
      fbW = wantW; fbH = wantH;
      fb = document.createElement('canvas');
      fb.width = fbW; fb.height = fbH;
      fbCtx = fb.getContext('2d');
    }

    // 3. feedback trail from the (half-res) echo buffer
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(fb, 0, 0, W, H);
    ctx.restore();

    // 4. rotating mirror ghosts — same half-res source, no extra stage read
    if (mirrorEnabled()) {
      var t = (now || 0) * 0.00004;
      axisMirror(ctx, fb, W, H, Math.sin(t) * 0.24, 0.16, 'soft-light');
      if (quality >= 2) {
        axisMirror(ctx, fb, W, H, Math.sin(t * 0.63 + 2.1) * 0.17, 0.09, 'screen');
      }
    }

    // 3b. feed the buffer (every other frame while degraded)
    if (quality >= 2 || (stats.frames & 1) === 0) {
      fbCtx.save();
      fbCtx.globalAlpha = 0.82;
      fbCtx.drawImage(fb, 1, 1, fbW - 2, fbH - 2);
      fbCtx.globalAlpha = 0.30;
      fbCtx.drawImage(stage, 0, 0, fbW, fbH);
      fbCtx.restore();
    }
    stats.composites = (stats.composites || 0) + 1;
  }

  // End-of-frame hook: page render loops dispatch this when their frame is
  // complete. Runs synchronously, so the ghosts always land on finished art.
  window.addEventListener('swr-frame-end', function (ev) {
    lastFrameEnd = performance.now();
    if (!state.enabled) return;
    var stage = getStage();
    if (stage) gradeTopmost(stage);
    compositePass(lastFrameEnd);
    void ev;
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!state.enabled) return;
    var t0 = performance.now();

    var dt = lastNow ? now - lastNow : 16;
    lastNow = now;
    dtEma += (Math.min(250, dt) - dtEma) * 0.1;
    if (dtEma > 42) { slowRun++; fastRun = 0; }
    else if (dtEma < 20) { fastRun++; slowRun = 0; }
    else { slowRun = 0; fastRun = 0; }
    if (slowRun > 30 && quality > 0) { quality--; slowRun = 0; }
    if (fastRun > 60 && quality < 2) { quality++; fastRun = 0; }

    var S = window.SWR || {};
    if (S.Audio) installFollower(S.Audio);
    var stage = getStage();
    if (!stage || !stage.width || !stage.height) return;
    gradeTopmost(stage);

    // Fallback for pages whose render loop does not dispatch swr-frame-end
    // (the own-loop persona variants): if no end-of-frame hook has fired in
    // the last 250ms, composite here. On hooked pages this stays idle so the
    // pass is never applied twice per frame.
    if (performance.now() - lastFrameEnd > 250) compositePass(now);

    stats.frames++;
    stats.quality = quality;
    stats.dtEma = dtEma;
    stats.msEma += ((performance.now() - t0) - stats.msEma) * 0.1;
  }
  requestAnimationFrame(frame);

  // ---- public surface -------------------------------------------------------
  window.SWR_NATURAL = {
    GRADE: GRADE,
    stats: stats,   // live probe: frames, msEma, dtEma, quality (0-2)
    // Test/diagnostic hook: install the envelope follower on a given
    // Audio-shaped object (same path the frame loop uses each rAF).
    __wrap: installFollower,
    // Test/diagnostic hook: pin the internal quality level (0-2). Headless
    // Puppeteer runs ~15fps, so the adaptive logic correctly degrades to 0
    // (trail + mirror skipped) before any assertion can observe them —
    // verification needs a way to hold the level. Runtime-only.
    _forceQuality: function (n) {
      quality = Math.max(0, Math.min(2, Math.floor(Number(n))));
      slowRun = 0; fastRun = 0;
      return quality;
    },
    // Adaptive-guard rung 1: drop the filmic grade without touching the
    // persisted enable flag (a reload restores the user's choice).
    setGrade: function (on) { gradeOn = !!on; },
    // Mirror axis control (the `R` rotkey cycles these). 'vertical' is the
    // canonical reflection across the vertical axis; 'horizontal' flips it
    // to the horizontal axis; 'off' removes both ghost passes (a real
    // frame-time saving — the cheapest mirror rung).
    mirror: function () { return mirrorMode; },
    setMirror: function (mode) {
      if (MIRROR_MODES.indexOf(mode) === -1) return mirrorMode;
      mirrorMode = mode;
      try { localStorage.setItem('swr.mirror.mode', mode); } catch (_) {}
      return mirrorMode;
    },
    cycleMirror: function () {
      return window.SWR_NATURAL.setMirror(
        MIRROR_MODES[(MIRROR_MODES.indexOf(mirrorMode) + 1) % MIRROR_MODES.length]);
    },
    isEnabled: function () { return !!state.enabled; },
    setEnabled: function (on) {
      state.enabled = !!on;
      try { localStorage.setItem(LS_KEY, state.enabled ? '1' : '0'); } catch (_) {}
      if (!state.enabled) {
        [getStage(), document.getElementById('fx-canvas')].forEach(function (c) {
          if (c && c.style) { c.style.filter = 'none'; c.__swrNatGrade = null; }
        });
      }
    },
  };
})();
