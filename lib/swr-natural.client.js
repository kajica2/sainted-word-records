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
//  2. House grade — CSS filter chain on the VISIBLE canvas only, derived from
//     the house grading rules (docs/grade-house-rules.md): contrast +
//     brightness set the tone curve (blacks lifted 0.03, whites parked at
//     0.93 — inside the rules' 90–95 IRE band, not the old flat 0.85 lift),
//     saturation is a ~8% filmic trim rather than a blanket 55% desaturation,
//     and the composite gains a 5% grain floor to hide the banding the lift
//     creates. Applied to the fx-postprocess overlay when it is up (it
//     composites the stage), else the stage canvas — never both (the grade
//     must not double), and never to the DOM chrome (the rules grade graphics
//     and footage separately). The rules' per-hue half — vibrance, skin-tone
//     protection, selective colour, clarity — needs per-pixel work and stays a
//     finishing-stage step; the measurements behind that call are in the doc.
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

  // ---- 2. House grade (grading-rules refactor) ----------------------------
  // Numbers come from the house grading rules (docs/grade-house-rules.md):
  //   * the tone curve is set by contrast + brightness: blacks lifted a touch
  //     ("lift blacks slightly... don't wash them out") and whites parked just
  //     below clipping (the rules' 90-95 IRE whites) instead of the old
  //     0.85-contrast lift that flattened both ends
  //   * saturation is a trim, not a boost: the rules cap *boosts* at +8, and
  //     the house trims ~8% for the filmic read ("if you notice the
  //     saturation, it's too high") — the old blanket 0.45 desaturation is one
  //     of the things the rules call out
  //   * 5% film grain over the composite hides the banding the lift creates
  // The rules' per-hue half (vibrance, skin protection, selective colour,
  // clarity) needs per-pixel work; an SVG-filter chain measured 4-9x the frame
  // cost of this chain on the variants, so those stay a finishing-stage step.
  var GRADE = {
    saturation: 0.92,     // trim; a boost would be capped at 1.08
    contrast: 0.9375,     // pivot 0.5, faded-side
    brightness: 0.96,     // with contrast: black 0.030, white 0.930
    grain: 0.05,          // overlay alpha of the noise tile
    grainTile: 64,        // tile edge, px
    grainSpread: 32,      // noise band around mid grey, +/- levels
  };

  // Mirror of the CSS chain's tone half (contrast -> brightness, clamped after
  // each step) so the rules' black/white targets are read off the shipped
  // numbers instead of being written twice.
  function gradeTone(v) {
    var t = Math.min(1, Math.max(0, (v - 0.5) * GRADE.contrast + 0.5));
    return Math.min(1, Math.max(0, t * GRADE.brightness));
  }
  GRADE.black = gradeTone(0);
  GRADE.white = gradeTone(1);

  var GRADE_CSS = 'saturate(' + GRADE.saturation + ') contrast(' + GRADE.contrast + ') brightness(' + GRADE.brightness + ')';
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
  var FOLLOWER_MARK = '__swrNaturalFollower';   // lives on the target, never wrapped twice

  // One follower update per key per animation frame, implemented as a minimum
  // step between advances.
  //
  // The getter runs on every property read, and consumers read features
  // hundreds of times per frame (reactors, FX uniforms, the automix, the layer
  // math). It used to advance the smoother on every one of those reads, with
  // dt measured from the previous read of that key — usually well under a
  // millisecond — so one frame applied dozens of micro-steps to a value that is
  // meant to move once per frame, each paying performance.now() + Math.exp.
  //
  // A clock bucket (floor(now / 16.7)) would coalesce the same way but is
  // phase-sensitive: two real frames can land in one bucket and lose an update.
  // A minimum step cannot: reads a fraction of a millisecond apart return the
  // value already computed, and any read at least MIN_STEP_MS later advances by
  // the true elapsed dt. That keeps the documented "frame-rate independent"
  // curve exact, at one evaluation per key per frame instead of hundreds.
  var MIN_STEP_MS = 4;

  function installFollower(Audio) {
    var raw = Audio && Audio.feat;
    if (!raw || typeof raw !== 'object' || raw === featTarget) return;
    // Never wrap a proxy twice. The guard above compares against the last
    // *target*, but a re-install sees Audio.feat === the previous proxy, so it
    // never matched and every install stacked another Proxy around the last
    // one. Reads then walked the whole stack — a CPU profile of
    // versions/hallucination showed 94% of samples inside this getter with
    // `get` as its own top caller, and frame rate fell as the stack grew
    // (20 → 13 → 8 fps across three consecutive samples). The marker lives on
    // the target, so it is visible straight through the proxy and
    // non-enumerable for consumers.
    if (raw[FOLLOWER_MARK] === true) return;
    featTarget = raw;
    var prox = new Proxy(raw, {
      get: function (t, k) {
        var v = t[k];
        if (!state.enabled || typeof v !== 'number' || SKIP_KEYS[k]) return v;
        var st = env[k];
        var now = performance.now();
        if (st) {
          var dtMs = now - st.t;
          if (dtMs < MIN_STEP_MS) return st.v;   // sub-frame read: value is current
          var dt = dtMs / 1000;
          st.t = now;
          if (dt <= 0) return st.v;
          if (dt > 0.25) dt = 0.25;           // tab-switch clamp
          if (Math.abs(v) > 1.6 || Math.abs(st.v) > 1.6) { st.v = v; return v; }
          var a = 1 - Math.exp(-dt / (v > st.v ? 0.08 : 0.42)); // attack / release
          st.v += (v - st.v) * a;
          return st.v;
        }
        env[k] = { v: v, t: now };
        return v;
      },
    });
    try {
      Object.defineProperty(raw, FOLLOWER_MARK, { value: true, enumerable: false, configurable: true });
      Audio.feat = prox;
    } catch (_) { featTarget = null; }
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
    var want = wantGrade ? GRADE_CSS : 'none';
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
  var grainPattern = null;
  var grainTileCanvas = null;
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
    // 2b. grain floor — 5% overlay of a fixed noise tile (part of the house
    // grade). Flat gradients are where the grade's black lift shows banding,
    // and one fillRect with a repeating pattern costs ~nothing next to the
    // three draws above. Static, not animated: banding is static too, and
    // animated noise would need a per-frame tile rebuild.
    var gt = grainTile();
    if (gt) {
      if (!grainPattern) grainPattern = ctx.createPattern(gt, 'repeat');
      if (grainPattern) {
        ctx.save();
        ctx.globalAlpha = GRADE.grain;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
    stats.composites = (stats.composites || 0) + 1;
  }

  function grainTile() {
    if (grainTileCanvas) return grainTileCanvas;
    var t = document.createElement('canvas');
    var n = GRADE.grainTile;
    t.width = n; t.height = n;
    var tc = t.getContext('2d');
    if (!tc) return null;
    var img = tc.createImageData(n, n);
    var mid = 128, spread = GRADE.grainSpread;
    for (var i = 0; i < n * n; i++) {
      var v = mid + Math.round((Math.random() * 2 - 1) * spread);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    grainTileCanvas = t;
    return grainTileCanvas;
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
    // House-grade spec (saturation/contrast/brightness/grain + the derived
    // black and white tone points) and the CSS chain built from it.
    GRADE: GRADE,
    gradeCSS: GRADE_CSS,
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
