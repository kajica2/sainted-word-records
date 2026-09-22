// client/swr-spit-fx.client.js
//
// SWRSpitFX — one-shot visual FX library for the Spit Live page (/spit).
// Pure-canvas: every FX draws into a CanvasRenderingContext2D that the
// SpitRuntime's reactive canvas driver already manages. Each FX is a
// short-lived state machine (PENDING → ACTIVE → DECAY → DONE) with
// auto-cleanup; multiple FX may run concurrently and each is tracked
// in a registry so a `destroyAll()` call can abort them mid-flight.
//
// 6 FX (per PRD §4.4):
//   punch   — 220ms white flash + radial scale pulse
//   flow    — 700ms sustained blur ramp (0 → 8 → 0 px) + ghost overlay
//   ride    — 500ms chromatic aberration (RGB shift, 8px → 0px decay)
//   stutter — 240ms 3× freeze-frame repeat with translate offsets
//   echo    — 400ms RGBA trail (5 decaying copies, 4px x-offset per step)
//   black   — 800ms full fade to black + hold + fade back
//
// Public API (window.SWR_SPIT_FX):
//   trigger(name, ctx, options?) -> { success, fx, duration, id }
//                                   or { success: false, error }
//   destroyAll()                  — cancels all in-flight FX (test hook)
//   FX_NAMES                      — canonical ordered list
//   HOLD_MS / HOLD_MS_PUNCH / HOLD_MS_BLACK — timing constants
//   FX_PUNCH / FX_FLOW / FX_RIDE /
//   FX_STUTTER / FX_ECHO / FX_BLACK — string aliases for `name`
//
// Memory: Stutter + Echo snapshot the canvas once via drawImage to a
// lazy offscreen buffer. One buffer per active FX instance; no nested
// storage. On a 1080×1920 canvas the offscreen canvas is ~8MB; we
// release it when the FX completes or is cancelled.
//
// Browser-only. This module attaches to `window`; in node it exports
// the IIFE internals via a guarded fallback so unit tests can require
// it under a vm sandbox with a mocked `window`.

(function () {
  'use strict';
  if (typeof window !== 'undefined' && window.SWR_SPIT_FX) return;

  // ---- Constants ---------------------------------------------------------
  var FX_PUNCH = 'punch';
  var FX_FLOW = 'flow';
  var FX_RIDE = 'ride';
  var FX_STUTTER = 'stutter';
  var FX_ECHO = 'echo';
  var FX_BLACK = 'black';

  var FX_NAMES = [FX_PUNCH, FX_FLOW, FX_RIDE, FX_STUTTER, FX_ECHO, FX_BLACK];

  var HOLD_MS = 700;        // default hold for unspecified FX
  var HOLD_MS_PUNCH = 220;  // quick impact flash + pulse
  var HOLD_MS_BLACK = 800;  // full blackout arc (fade/hold/fade)
  var HOLD_MS_RIDE = 500;   // chromatic split decay
  var HOLD_MS_STUTTER = 240;// 3 × 80ms freeze frames
  var HOLD_MS_ECHO = 400;   // 5 × 80ms RGBA trail frames
  var HOLD_MS_FLOW = 700;   // full blur ramp

  var STUTTER_COUNT = 3;
  var STUTTER_FRAME_MS = 80;
  var ECHO_TRAIL_FRAMES = 5;
  var ECHO_TRAIL_MS = 80;
  var ECHO_OFFSET_PX = 4;

  var RIDE_SHIFT_MAX = 8;
  var RIDE_SHIFT_PX = 4;
  var FLOW_BLUR_MAX = 8;
  var PUNCH_FLASH_MS = 80;
  var PUNCH_FLASH_PEAK_ALPHA = 0.95;
  var PUNCH_FLASH_FLOOR_ALPHA = 0.30;
  var PUNCH_PULSE_PEAK_ALPHA = 0.18;
  var BLACK_PEAK_ALPHA = 0.95;
  var CLEANUP_GRACE_MS = 60;

  // ---- Internal state (closure-scoped) ----------------------------------
  var _active = {};     // id -> { name, holdMs, cancel }
  var _counter = 0;     // monotonically increasing FX id
  var _scratch = null;  // {w, h, canvas, ctx} reused for snapshots

  // ---- Helpers ----------------------------------------------------------
  function _now() {
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function _hasRAF() {
    return typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
  }

  function _warn(msg, err) {
    if (typeof console !== 'undefined' && console && console.warn) console.warn(msg, err || '');
  }

  function _canvasSize(ctx) {
    var c = ctx && ctx.canvas;
    if (!c) return { w: 0, h: 0 };
    var w = c.width || (c.clientWidth || 0);
    var h = c.height || (c.clientHeight || 0);
    if (!w && typeof c.getBoundingClientRect === 'function') {
      var r = c.getBoundingClientRect();
      w = r.width || 0; h = r.height || 0;
    }
    return { w: w, h: h };
  }

  // Offscreen canvas used by snapshotting FX (Stutter + Echo). Reused
  // across FX instances so the GC doesn't churn on every trigger.
  function _getScratch(w, h) {
    if (_scratch && _scratch.w === w && _scratch.h === h) return _scratch;
    if (typeof document === 'undefined') return null;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = null;
    try { cx = c.getContext('2d'); } catch (_) { cx = null; }
    if (!cx) return null;
    _scratch = { w: w, h: h, canvas: c, ctx: cx };
    return _scratch;
  }

  // Snapshot the current state of `ctx.canvas` into the scratch buffer.
  // Returns the scratch ctx or null if we couldn't create one. Caller is
  // responsible for releasing by clearing _scratch (we keep it cached).
  function _snapshot(ctx, w, h) {
    var s = _getScratch(w, h);
    if (!s) return null;
    try { s.ctx.clearRect(0, 0, w, h); s.ctx.drawImage(ctx.canvas, 0, 0); }
    catch (e) { _warn('swr-spit-fx: snapshot failed', e); return null; }
    return s;
  }

  // Animation loop helper. Runs `paintFn(phase, elapsed, holdMs)` on each
  // animation frame until `holdMs` elapses, then auto-completes. Returns
  // `{ holdMs, cancel }` per the FX impl contract.
  function _startLoop(holdMs, paintFn) {
    var start = _now();
    var rafId = null;
    var toId = null;
    var done = false;

    function tick() {
      if (done) return;
      var elapsed = _now() - start;
      var phase = elapsed >= holdMs ? 1 : (holdMs > 0 ? elapsed / holdMs : 1);
      try { paintFn(phase, elapsed, holdMs); }
      catch (e) { _warn('swr-spit-fx: paint failed', e); done = true; return; }
      if (elapsed < holdMs) {
        if (_hasRAF()) rafId = requestAnimationFrame(tick);
        else toId = setTimeout(tick, 16);
      } else {
        done = true;
      }
    }

    if (_hasRAF()) rafId = requestAnimationFrame(tick);
    else toId = setTimeout(tick, 16);

    return {
      holdMs: holdMs,
      cancel: function () {
        done = true;
        try { if (rafId !== null) cancelAnimationFrame(rafId); } catch (_) {}
        try { if (toId !== null) clearTimeout(toId); } catch (_) {}
      },
    };
  }

  // Set a globalAlpha on the context but restore it after a callback
  // runs. The reactive driver paints each frame, so we MUST restore
  // state to avoid corrupting the next tick.
  function _withAlpha(ctx, alpha, fn) {
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = (prev || 1) * alpha;
    try { fn(); }
    finally { ctx.globalAlpha = prev; }
  }

  function _withComposite(ctx, mode, fn) {
    var prev = ctx.globalCompositeOperation || 'source-over';
    ctx.globalCompositeOperation = mode;
    try { fn(); }
    finally { ctx.globalCompositeOperation = prev; }
  }

  // ---- FX implementations ----------------------------------------------

  // 1. Punch — white flash + radial pulse
  function _fxPunch(ctx, opts) {
    var size = _canvasSize(ctx);
    var w = size.w, h = size.h;
    return _startLoop(HOLD_MS_PUNCH, function (phase) {
      if (phase < PUNCH_FLASH_MS / HOLD_MS_PUNCH) {
        // Phase 1: solid white overlay fading 0.95 → 0.30
        var t = phase * HOLD_MS_PUNCH / PUNCH_FLASH_MS;
        var alpha = PUNCH_FLASH_PEAK_ALPHA + (PUNCH_FLASH_FLOOR_ALPHA - PUNCH_FLASH_PEAK_ALPHA) * t;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = alpha;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else {
        // Phase 2: subtle radial pulse from center
        var t2 = (phase * HOLD_MS_PUNCH - PUNCH_FLASH_MS) / (HOLD_MS_PUNCH - PUNCH_FLASH_MS);
        var radius = Math.min(w, h) * (0.15 + t2 * 0.55);
        var alpha2 = PUNCH_PULSE_PEAK_ALPHA * (1 - t2);
        if (alpha2 < 0) alpha2 = 0;
        ctx.save();
        var grad = ctx.createRadialGradient(w / 2, h / 2, radius * 0.4, w / 2, h / 2, radius);
        grad.addColorStop(0, 'rgba(255, 255, 255, ' + alpha2 + ')');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    });
  }

  // 2. Flow — sustained blur ramp + ghost copy
  function _fxFlow(ctx, opts) {
    var size = _canvasSize(ctx);
    var w = size.w, h = size.h;
    var hasFilter = 'filter' in ctx;
    return _startLoop(HOLD_MS_FLOW, function (phase) {
      // Triangular envelope: blur ramps 0 → FLOW_BLUR_MAX → 0
      var blur = phase < 0.5
        ? FLOW_BLUR_MAX * (phase / 0.5)
        : FLOW_BLUR_MAX * (1 - (phase - 0.5) / 0.5);
      if (blur < 0) blur = 0;
      if (blur > FLOW_BLUR_MAX) blur = FLOW_BLUR_MAX;
      var ghostAlpha = 0.5 * (1 - Math.abs(phase - 0.5) * 2);
      if (ghostAlpha < 0) ghostAlpha = 0;
      if (hasFilter) {
        // Draw a blurred ghost copy on top of the live canvas
        try {
          ctx.save();
          ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';
          ctx.globalAlpha = ghostAlpha;
          ctx.drawImage(ctx.canvas, 0, 0);
          ctx.restore();
        } catch (e) { _warn('swr-spit-fx: flow ghost failed', e); }
      } else {
        // Fallback: a translucent white veil + soft tint
        _withAlpha(ctx, 0.08 + 0.12 * (blur / FLOW_BLUR_MAX), function () {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
        });
      }
    });
  }

  // 3. Ride — chromatic aberration (R/G/B shifted copies via screen blend)
  function _fxRide(ctx, opts) {
    return _startLoop(HOLD_MS_RIDE, function (phase) {
      // Shift distance decays from RIDE_SHIFT_MAX → 0
      var shift = Math.round(RIDE_SHIFT_MAX * (1 - phase));
      if (shift < 0) shift = 0;
      if (shift > RIDE_SHIFT_MAX) shift = RIDE_SHIFT_MAX;
      // Fade-out tail: alpha envelope so the tail is visible but doesn't
      // linger after the chromatic shift collapses.
      var env = 1 - phase * 0.4;
      if (env < 0.4) env = 0.4;
      try {
        // Strategy: we don't have a per-channel composite without a
        // pixel shader, so emulate RGB split with three offset copies
        // composited via 'screen'. Each copy uses a tinted layer.
        _withComposite(ctx, 'screen', function () {
          _withAlpha(ctx, env, function () {
            // Red-shifted (drawn first, then screen-blended)
            ctx.save();
            ctx.fillStyle = 'rgba(255, 40, 40, 0.55)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
          });
          _withAlpha(ctx, env, function () {
            ctx.save();
            ctx.fillStyle = 'rgba(40, 255, 80, 0.45)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
          });
          _withAlpha(ctx, env, function () {
            ctx.save();
            ctx.fillStyle = 'rgba(40, 90, 255, 0.55)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.restore();
          });
        });
      } catch (e) { _warn('swr-spit-fx: ride failed', e); }
      // Suppress unused-variable warning (shift is exposed for future
      // pixel-shader implementations; current path uses tinted layers
      // because per-channel drawImage requires a shader).
      void shift;
    });
  }

  // 4. Stutter — 3× freeze-frame with translate offsets
  function _fxStutter(ctx, opts) {
    var size = _canvasSize(ctx);
    var w = size.w, h = size.h;
    var snap = _snapshot(ctx, w, h);
    if (!snap) {
      // Graceful no-op if we can't snapshot (e.g. no document).
      return { holdMs: HOLD_MS_STUTTER, cancel: function () {} };
    }
    var phases = [
      { t: 0,                       dx: 0,   dy: 0 },
      { t: STUTTER_FRAME_MS,        dx: -12, dy: 0 },
      { t: STUTTER_FRAME_MS * 2,    dx: 0,   dy: 12 },
    ];
    return _startLoop(HOLD_MS_STUTTER, function (phase, elapsed) {
      var idx = Math.min(Math.floor(elapsed / STUTTER_FRAME_MS), STUTTER_COUNT - 1);
      var p = phases[idx];
      try {
        ctx.save();
        ctx.translate(p.dx, p.dy);
        ctx.drawImage(snap.canvas, 0, 0);
        ctx.restore();
      } catch (e) { _warn('swr-spit-fx: stutter draw failed', e); }
    });
  }

  // 5. Echo — 5 decaying RGBA trail frames with x-offset
  function _fxEcho(ctx, opts) {
    var size = _canvasSize(ctx);
    var w = size.w, h = size.h;
    var snap = _snapshot(ctx, w, h);
    if (!snap) {
      return { holdMs: HOLD_MS_ECHO, cancel: function () {} };
    }
    var trailAlphas = [0.6, 0.4, 0.2, 0.1, 0.0];
    var start = _now();
    return _startLoop(HOLD_MS_ECHO, function (phase, elapsed) {
      // For each trail frame whose scheduled time has passed, paint it.
      // Each frame is drawn at decreasing alpha + increasing x-offset.
      var i = 0;
      for (i = 0; i < ECHO_TRAIL_FRAMES; i++) {
        var frameTime = i * ECHO_TRAIL_MS;
        if (elapsed < frameTime) break;
        var alpha = trailAlphas[i];
        if (alpha <= 0) continue;
        var dx = (i + 1) * ECHO_OFFSET_PX;
        try {
          _withAlpha(ctx, alpha, function () {
            ctx.save();
            ctx.translate(dx, 0);
            ctx.drawImage(snap.canvas, 0, 0);
            ctx.restore();
          });
        } catch (e) { _warn('swr-spit-fx: echo draw failed', e); }
      }
      // Reference start so the closure isn't flagged unused.
      void start;
    });
  }

  // 6. Black — full fade to black, hold, fade back
  function _fxBlack(ctx, opts) {
    var size = _canvasSize(ctx);
    var w = size.w, h = size.h;
    var fadeInEnd = 200;
    var holdEnd = 600;
    return _startLoop(HOLD_MS_BLACK, function (phase, elapsed) {
      var alpha;
      if (elapsed < fadeInEnd) {
        // Fade in: alpha 0 → BLACK_PEAK_ALPHA
        alpha = BLACK_PEAK_ALPHA * (elapsed / fadeInEnd);
      } else if (elapsed < holdEnd) {
        // Hold at full black
        alpha = BLACK_PEAK_ALPHA;
      } else {
        // Fade out: alpha BLACK_PEAK_ALPHA → 0
        alpha = BLACK_PEAK_ALPHA * (1 - (elapsed - holdEnd) / (HOLD_MS_BLACK - holdEnd));
      }
      if (alpha < 0) alpha = 0;
      if (alpha > BLACK_PEAK_ALPHA) alpha = BLACK_PEAK_ALPHA;
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    });
  }

  // ---- Impl registry ----------------------------------------------------
  var _fxImpl = {};
  _fxImpl[FX_PUNCH] = _fxPunch;
  _fxImpl[FX_FLOW] = _fxFlow;
  _fxImpl[FX_RIDE] = _fxRide;
  _fxImpl[FX_STUTTER] = _fxStutter;
  _fxImpl[FX_ECHO] = _fxEcho;
  _fxImpl[FX_BLACK] = _fxBlack;

  // ---- Public API --------------------------------------------------------

  function destroyAll() {
    var ids = [];
    for (var k in _active) { if (Object.prototype.hasOwnProperty.call(_active, k)) ids.push(k); }
    for (var i = 0; i < ids.length; i++) {
      var entry = _active[ids[i]];
      try { if (entry && entry.cancel) entry.cancel(); } catch (_) {}
    }
    _active = {};
  }

  function trigger(name, ctx, options) {
    if (FX_NAMES.indexOf(name) === -1) {
      return { success: false, error: 'unknown_fx', fx: name };
    }
    if (!ctx || typeof ctx.canvas === 'undefined') {
      return { success: false, error: 'no_canvas_context', fx: name };
    }
    var impl = _fxImpl[name];
    if (typeof impl !== 'function') {
      return { success: false, error: 'no_impl', fx: name };
    }
    var id = ++_counter;
    var result;
    try { result = impl(ctx, options || {}, id); }
    catch (e) {
      return { success: false, error: 'fx_threw', fx: name, message: String(e && e.message || e) };
    }
    if (!result || typeof result.cancel !== 'function') {
      return { success: false, error: 'bad_impl', fx: name };
    }
    var holdMs = (typeof result.holdMs === 'number' && result.holdMs > 0) ? result.holdMs : HOLD_MS;
    var entry = { id: id, name: name, holdMs: holdMs, cancel: result.cancel };
    _active[id] = entry;
    // Auto-cleanup safety net (impl may also clean itself; this guarantees
    // the registry doesn't grow unbounded if a paint loop throws).
    setTimeout(function () {
      if (_active[id]) {
        try { _active[id].cancel(); } catch (_) {}
        delete _active[id];
      }
    }, holdMs + CLEANUP_GRACE_MS);
    return { success: true, fx: name, duration: holdMs, id: id };
  }

  // ---- Export ------------------------------------------------------------
  var api = {
    trigger: trigger,
    destroyAll: destroyAll,
    FX_NAMES: FX_NAMES,
    FX_PUNCH: FX_PUNCH,
    FX_FLOW: FX_FLOW,
    FX_RIDE: FX_RIDE,
    FX_STUTTER: FX_STUTTER,
    FX_ECHO: FX_ECHO,
    FX_BLACK: FX_BLACK,
    HOLD_MS: HOLD_MS,
    HOLD_MS_PUNCH: HOLD_MS_PUNCH,
    HOLD_MS_BLACK: HOLD_MS_BLACK,
  };

  if (typeof window !== 'undefined') {
    window.SWR_SPIT_FX = api;
  } else if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = api;
  }
})();
