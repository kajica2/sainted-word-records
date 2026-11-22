// lib/waveform-scrub.client.js — a scrolling waveform that follows the
// timeline. Public API (attached to window.SWR_WAVEFORM):
//
//   .peaksFromBuffer(audioBuffer, buckets)
//       — the PURE part. Decodes nothing, touches no DOM: reduces a
//         decoded AudioBuffer to one min/max pair per bucket. This is
//         what the unit gate drives.
//
//   .mount(el, opts)   — attach to an element (opts: {media, window,
//                         mode, onSeek}). Returns the instance.
//   .define(tag)       — define the custom element under another name.
//
//   .version           — bumped when the drawing contract changes.
//
// The element is <swr-waveform>:
//
//   <swr-waveform for="audioEl" window="20" mode="scroll"></swr-waveform>
//
// WHAT IT DOES. The waveform is a TAPE. The playhead is FIXED at the
// centre of the strip and the wave scrolls under it as the song plays,
// so the strip always shows what is coming next. That is the opposite
// of the usual scrub bar (the whole song visible, the playhead moving),
// and it is the shape that reads when a track is long: the next twenty
// seconds are always on screen.
//
// mode="fit" draws the whole song instead, for when the shape of the
// track matters more than what is coming.
//
// Click or drag anywhere on the strip to seek.
//
// THE CLOCK. SWR's rule is that the media element carries the clock
// and nothing ever reads a wall clock (see lib/audio.client.js). So
// the position comes from window.Audio.clock when the engine is on the
// page, and from the media element's own currentTime otherwise. If
// neither is available the strip holds still rather than drifting.
//
// Zero dependencies. Loaded via defer. Idempotent: re-evaluating the
// script returns the cached singleton.
//
// Style: the colours come from the site's design tokens (--accent,
// --line-2, --ink), read at paint time so the strip follows the theme
// without this file knowing anything about it.

(function () {
  'use strict';

  if (window.__SWR_WAVEFORM_LOADED) return;
  window.__SWR_WAVEFORM_LOADED = true;

  var TAG = 'swr-waveform';

  // ---------------------------------------------------------------------------
  // The pure part.
  //
  // One min/max pair per bucket. The buckets are EQUAL LENGTH IN TIME,
  // not equal length in samples, so a track with a quiet intro and a
  // loud chorus gets the same number of columns either way — and a
  // column always means the same span of time, which is what makes the
  // strip honest.
  //
  // The channel data is mixed to MONO first (the average of the
  // channels), because a waveform that shows only the left channel
  // hides everything panned right.
  function peaksFromBuffer(audioBuffer, buckets) {
    var out = { min: null, max: null, duration: 0, buckets: 0 };
    if (!audioBuffer) return out;
    // An explicit 0 must clamp to 1, not fall through to the default —
    // `buckets || 512` treats 0 as "not given".
    var asked = (buckets === undefined || buckets === null) ? 512 : buckets;
    var n = Math.max(1, Math.floor(asked));
    var channels = audioBuffer.numberOfChannels || 0;
    var length = audioBuffer.length || 0;
    var sampleRate = audioBuffer.sampleRate || 44100;
    out.duration = audioBuffer.duration || (length / sampleRate);
    out.buckets = n;
    if (!channels || !length) {
      out.min = new Float32Array(n);
      out.max = new Float32Array(n);
      return out;
    }

    var mins = new Float32Array(n);
    var maxs = new Float32Array(n);
    var data = [];
    for (var c = 0; c < channels; c++) {
      var ch = audioBuffer.getChannelData(c);
      data.push(ch);
    }

    for (var b = 0; b < n; b++) {
      var start = Math.floor((b * length) / n);
      var end = Math.floor(((b + 1) * length) / n);
      if (end <= start) end = start + 1;
      if (end > length) end = length;
      var lo = Infinity;
      var hi = -Infinity;
      for (var i = start; i < end; i++) {
        var v = 0;
        for (var c2 = 0; c2 < data.length; c2++) v += data[c2][i];
        v /= data.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo === Infinity) { lo = 0; hi = 0; }
      mins[b] = lo;
      maxs[b] = hi;
    }
    out.min = mins;
    out.max = maxs;
    return out;
  }

  // ---------------------------------------------------------------------------
  // The drawing contract — pure, so it can be tested without a canvas.
  //
  //   timeToX(t, clock, canvasWidth, windowSeconds, mode)
  //       — where a moment in the song lands on the strip.
  //
  // In 'scroll' mode the playhead is pinned at the centre and the
  // window moves; in 'fit' mode the whole song is on the strip and the
  // playhead moves across it.
  function timeToX(t, clock, width, windowSeconds, mode) {
    if (mode === 'fit') {
      // The whole song across the strip. The caller passes the song
      // duration as windowSeconds in this mode.
      var px = width / (windowSeconds || 1);
      return t * px;
    }
    var pxPerSec = width / (windowSeconds || 1);
    return width / 2 + (t - clock) * pxPerSec;
  }

  function xToTime(x, clock, width, windowSeconds, mode, duration) {
    if (mode === 'fit') {
      var px = width / (windowSeconds || 1);
      var tt = x / (px || 1);
      if (duration && tt > duration) tt = duration;
      if (tt < 0) tt = 0;
      return tt;
    }
    var pxPerSec = width / (windowSeconds || 1);
    var t = clock + (x - width / 2) / (pxPerSec || 1);
    if (duration && t > duration) t = duration;
    if (t < 0) t = 0;
    return t;
  }

  // ---------------------------------------------------------------------------
  // The component.
  //
  // Built on the ES5 Reflect.construct subclassing pattern, because the
  // repo's other Web Components (lib/nav.client.js) use it and because
  // customElements.define rejects a plain object.
  var Waveform = (function () {
    function Waveform() {
      return Reflect.construct(HTMLElement, [], Waveform);
    }

    Waveform.prototype = Object.create(HTMLElement.prototype);
    Waveform.prototype.constructor = Waveform;

    Object.setPrototypeOf(Waveform, HTMLElement);

    Waveform.prototype.connectedCallback = function () {
      var self = this;
      this._peaks = null;
      this._duration = 0;
      this._media = null;
      this._clockSource = null;
      this._raf = 0;
      this._buckets = 2048;
      this._windowSeconds = 20;
      this._mode = 'scroll';
      this._peaksToken = 0;
      this._dragging = false;

      var mediaId = this.getAttribute('for');
      if (mediaId && !this._media) {
        this._media = document.getElementById(mediaId);
      }
      var win = parseFloat(this.getAttribute('window'));
      if (win > 0) this._windowSeconds = win;
      var mode = this.getAttribute('mode');
      if (mode === 'fit' || mode === 'scroll') this._mode = mode;

      this._canvas = document.createElement('canvas');
      this._canvas.className = 'swr-waveform__canvas';
      this._canvas.style.cssText = 'display:block;width:100%;height:100%;';
      this.style.cssText = this.style.cssText || '';
      if (!this.style.display) this.style.display = 'block';
      if (!this.style.height) this.style.height = '56px';
      this.appendChild(this._canvas);
      this._ctx = this._canvas.getContext ? this._canvas.getContext('2d') : null;

      // Click and drag to seek.
      var seekFromEvent = function (ev) {
        var rect = self._canvas.getBoundingClientRect();
        if (!rect.width) return;
        var x = (ev.clientX - rect.left);
        var t = xToTime(x, self.now(), rect.width, self.visibleSeconds(), self._mode, self._duration);
        self._seek(t);
      };
      this._canvas.addEventListener('pointerdown', function (ev) {
        self._dragging = true;
        if (self._canvas.setPointerCapture) {
          try { self._canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        }
        seekFromEvent(ev);
        ev.preventDefault();
      });
      this._canvas.addEventListener('pointermove', function (ev) {
        if (self._dragging) seekFromEvent(ev);
      });
      var endDrag = function () { self._dragging = false; };
      this._canvas.addEventListener('pointerup', endDrag);
      this._canvas.addEventListener('pointercancel', endDrag);

      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(function () { self._resize(); self.render(); });
        this._ro.observe(this);
      } else {
        this._onResize = function () { self._resize(); self.render(); };
        window.addEventListener('resize', this._onResize);
      }

      this._resize();
      this._loop();
    };

    Waveform.prototype.disconnectedCallback = function () {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      if (this._ro) this._ro.disconnect();
      if (this._onResize) window.removeEventListener('resize', this._onResize);
    };

    // -- public ---------------------------------------------------------------

    Waveform.prototype.setMedia = function (el) {
      this._media = el || null;
      this._peaksToken++;
      return this;
    };

    // The clock. The engine's rule: the media element carries the clock,
    // never a wall clock.
    Waveform.prototype.setClockSource = function (fn) {
      this._clockSource = typeof fn === 'function' ? fn : null;
      return this;
    };

    Waveform.prototype.setPeaks = function (peaks, duration) {
      this._peaks = peaks || null;
      this._duration = duration != null ? duration : (peaks && peaks.duration) || 0;
      return this;
    };

    Waveform.prototype.setWindow = function (seconds) {
      if (seconds > 0) this._windowSeconds = seconds;
      return this;
    };

    Waveform.prototype.setMode = function (mode) {
      if (mode === 'fit' || mode === 'scroll') this._mode = mode;
      return this;
    };

    Waveform.prototype.setBuckets = function (n) {
      if (n > 0) this._buckets = Math.floor(n);
      return this;
    };

    // The clock, in seconds.
    Waveform.prototype.now = function () {
      if (this._clockSource) {
        var t = this._clockSource();
        if (typeof t === 'number' && isFinite(t)) return t;
      }
      // The engine's clock when the engine is on the page.
      if (window.Audio && typeof window.Audio.clock === 'number' && isFinite(window.Audio.clock)) {
        return window.Audio.clock;
      }
      if (this._media && typeof this._media.currentTime === 'number') {
        return this._media.currentTime;
      }
      return 0;
    };

    // How many seconds of the song the strip shows.
    Waveform.prototype.visibleSeconds = function () {
      if (this._mode === 'fit') return this._duration || this._windowSeconds;
      return this._windowSeconds;
    };

    Waveform.prototype.seek = function (t) {
      this._seek(t);
    };

    Waveform.prototype._seek = function (t) {
      if (!this._media) return;
      try {
        this._media.currentTime = Math.max(0, t);
      } catch (e) {}
      if (typeof this.onseek === 'function') this.onseek(t);
    };

    // -- internals ------------------------------------------------------------

    Waveform.prototype._resize = function () {
      if (!this._canvas) return;
      var rect = this.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width || this.clientWidth || 300));
      var h = Math.max(1, Math.round(rect.height || this.clientHeight || 56));
      var dpr = window.devicePixelRatio || 1;
      this._w = w;
      this._h = h;
      this._canvas.width = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
      this._dpr = dpr;
      if (this._ctx && this._ctx.setTransform) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    Waveform.prototype._loop = function () {
      var self = this;
      this._raf = requestAnimationFrame(function () {
        self.render();
        self._loop();
      });
    };

    // The colours are a CHAIN: the first custom property the page
    // actually defines wins. That way the strip sits correctly on the
    // shared design tokens (--accent / --line-2 / --ink) AND on the app
    // page's own set (--lime / --line / --text), and a page can
    // override the lot with --swr-wave-accent and friends.
    Waveform.prototype._token = function (names, fallback) {
      var list = typeof names === 'string' ? [names] : names;
      var cs = getComputedStyle(this);
      for (var i = 0; i < list.length; i++) {
        var v = cs.getPropertyValue(list[i]);
        if (v && v.trim()) return v.trim();
      }
      return fallback;
    };

    Waveform.prototype.render = function () {
      var ctx = this._ctx;
      if (!ctx) return;
      var w = this._w || 1;
      var h = this._h || 1;
      ctx.clearRect(0, 0, w, h);
      if (!this._peaks) return;

      var clock = this.now();
      var vis = this.visibleSeconds();
      var mid = h / 2;
      var accent = this._token(['--swr-wave-accent', '--accent', '--lime'], '#d7ff3d');
      var dim = this._token(['--swr-wave-dim', '--line-2', '--text-mute', '--line'], '#6a6860');
      var ink = this._token(['--swr-wave-ink', '--ink', '--text'], '#eceae3');

      // The window, in song-time.
      var t0;
      var t1;
      if (this._mode === 'fit') {
        t0 = 0;
        t1 = this._duration || vis;
      } else {
        t0 = clock - vis / 2;
        t1 = clock + vis / 2;
      }

      var peaks = this._peaks;
      var n = peaks.min.length;
      var dur = this._duration || peaks.duration || 0;

      // One column per pixel: the bucket a pixel covers is read out of
      // the peaks array.
      var pxPerSec = w / (vis || 1);
      var cols = Math.max(1, Math.round(w));

      ctx.fillStyle = dim;
      for (var x = 0; x < cols; x++) {
        var ta = t0 + x / pxPerSec;
        var tb = t0 + (x + 1) / pxPerSec;
        if (tb < 0 || ta > dur) continue;
        var b0 = Math.floor((ta / (dur || 1)) * n);
        var b1 = Math.ceil((tb / (dur || 1)) * n);
        if (b1 <= b0) b1 = b0 + 1;
        if (b0 < 0) b0 = 0;
        if (b1 > n) b1 = n;
        if (b1 <= b0) continue;
        var lo = 0;
        var hi = 0;
        for (var b = b0; b < b1; b++) {
          if (peaks.min[b] < lo) lo = peaks.min[b];
          if (peaks.max[b] > hi) hi = peaks.max[b];
        }
        var yTop = mid - hi * mid * 0.92;
        var yBot = mid - lo * mid * 0.92;
        if (yBot - yTop < 1) { yTop = mid - 0.5; yBot = mid + 0.5; }
        ctx.fillRect(x, yTop, 1, yBot - yTop);
      }

      // The played part, in the accent.
      var headX = this._mode === 'fit'
        ? timeToX(clock, clock, w, vis, 'fit')
        : w / 2;
      ctx.fillStyle = accent;
      for (var x2 = 0; x2 < cols; x2++) {
        var xa = t0 + x2 / pxPerSec;
        if (xa > clock) break;
        var xb = t0 + (x2 + 1) / pxPerSec;
        var b0b = Math.floor((xa / (dur || 1)) * n);
        var b1b = Math.ceil((xb / (dur || 1)) * n);
        if (b0b < 0) b0b = 0;
        if (b1b > n) b1b = n;
        if (b1b <= b0b) b1b = b0b + 1;
        var lo2 = 0;
        var hi2 = 0;
        for (var b2 = b0b; b2 < b1b; b2++) {
          if (peaks.min[b2] < lo2) lo2 = peaks.min[b2];
          if (peaks.max[b2] > hi2) hi2 = peaks.max[b2];
        }
        var yt = mid - hi2 * mid * 0.92;
        var yb = mid - lo2 * mid * 0.92;
        if (yb - yt < 1) { yt = mid - 0.5; yb = mid + 0.5; }
        ctx.fillRect(x2, yt, 1, yb - yt);
      }

      // The playhead. In scroll mode it is pinned at the centre.
      ctx.fillStyle = accent;
      if (this._mode === 'fit') {
        ctx.fillRect(Math.round(headX), 0, 1.5, h);
      } else {
        ctx.fillRect(Math.round(w / 2), 0, 1.5, h);
        ctx.beginPath();
        ctx.moveTo(w / 2 - 5, 0);
        ctx.lineTo(w / 2 + 5, 0);
        ctx.lineTo(w / 2, 7);
        ctx.closePath();
        ctx.fill();
      }
      // A hairline in ink so the head reads on a light strip too.
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = ink;
      ctx.fillRect(Math.round(this._mode === 'fit' ? headX : w / 2) - 1, 0, 1, h);
      ctx.globalAlpha = 1;
    };

    return Waveform;
  })();

  // ---------------------------------------------------------------------------

  var api = {
    version: '1.0.0',
    peaksFromBuffer: peaksFromBuffer,
    timeToX: timeToX,
    xToTime: xToTime,
    define: function (tag) {
      var name = tag || TAG;
      if (!window.customElements || window.customElements.get(name)) return api;
      window.customElements.define(name, Waveform);
      return api;
    },
    mount: function (el, opts) {
      opts = opts || {};
      var inst = el;
      if (typeof el === 'string') inst = document.querySelector(el);
      if (!inst) return null;
      if (typeof inst.setMedia === 'function' && opts.media) inst.setMedia(opts.media);
      if (opts.window && typeof inst.setWindow === 'function') inst.setWindow(opts.window);
      if (opts.mode && typeof inst.setMode === 'function') inst.setMode(opts.mode);
      if (opts.onSeek) inst.onseek = opts.onSeek;
      return inst;
    },
    TAG: TAG,
    Waveform: Waveform
  };

  window.SWR_WAVEFORM = api;
  api.define(TAG);
})();
