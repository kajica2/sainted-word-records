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
//  3. Feedback trail — a persistent echo buffer blended under each frame
//     (self-decay 0.82 with a 2px inset drift, fresh feed 0.30, out 0.22):
//     motion smears into the next frame instead of snapping. Compounding
//     gain stays bounded (0.82×0.30 ≈ 0.25) so nothing blooms.
//  4. Rotating vertical-axis mirror — two ghost passes of the frame
//     reflected across slowly orbiting axes (±14° and ±10° at different
//     rates), soft-light 0.16 + screen 0.09, with the source re-angled
//     inside the mirror so the reflection reads as coming from a changing
//     angle — symmetry without stasis.
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
    return S.stage || document.getElementById('stage') ||
           document.getElementById('render') || null;
  }

  function gradeTopmost(stage) {
    var fx = document.getElementById('fx-canvas');
    var visible = fx && fx.offsetParent !== null;
    var top = visible ? fx : stage;
    if (top.__swrNatGrade !== GRADE) {
      top.style.filter = GRADE;
      top.__swrNatGrade = GRADE;
    }
    var other = top === stage ? fx : stage;
    if (other && other.__swrNatGrade) {
      other.style.filter = 'none';
      other.__swrNatGrade = null;
    }
  }

  // ---- 4. rotating vertical-axis mirror -----------------------------------
  function axisMirror(ctx, src, W, H, axis, alpha, comp) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = comp;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(axis);            // orbit the mirror axis
    ctx.scale(-1, 1);            // reflect across the tilted vertical axis
    ctx.rotate(-axis * 0.5);     // source enters at a different angle than the frame
    ctx.drawImage(src, -W / 2, -H / 2, W, H);
    ctx.restore();
  }

  // ---- frame loop ----------------------------------------------------------
  var fb = null, fbCtx = null;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!state.enabled) return;
    var S = window.SWR || {};
    if (S.Audio) installFollower(S.Audio);
    var stage = getStage();
    if (!stage || !stage.width || !stage.height) return;
    gradeTopmost(stage);
    var W = stage.width, H = stage.height;
    var ctx = stage.getContext('2d');
    if (!ctx) return;
    if (!fb || fb.width !== W || fb.height !== H) {
      fb = document.createElement('canvas');
      fb.width = W; fb.height = H;
      fbCtx = fb.getContext('2d');
    }

    // 3. feedback trail under the fresh frame (echo buffer, self-drifting)
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(fb, 0, 0, W, H);
    ctx.restore();

    // 4. mirror ghosts of the trailed frame
    var t = (now || 0) * 0.00004;
    axisMirror(ctx, stage, W, H, Math.sin(t) * 0.24, 0.16, 'soft-light');
    axisMirror(ctx, stage, W, H, Math.sin(t * 0.63 + 2.1) * 0.17, 0.09, 'screen');

    // 3b. feed the buffer for the next frame
    fbCtx.save();
    fbCtx.globalAlpha = 0.82;
    fbCtx.drawImage(fb, 2, 2, W - 4, H - 4);
    fbCtx.globalAlpha = 0.30;
    fbCtx.drawImage(stage, 0, 0);
    fbCtx.restore();
  }
  requestAnimationFrame(frame);

  // ---- public surface -------------------------------------------------------
  window.SWR_NATURAL = {
    GRADE: GRADE,
    // Test/diagnostic hook: install the envelope follower on a given
    // Audio-shaped object (same path the frame loop uses each rAF).
    __wrap: installFollower,
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
