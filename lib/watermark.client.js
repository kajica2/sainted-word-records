// lib/watermark.client.js — the SWR mark is forced onto every recorded frame.
//
// Recorded media carries the mark, always, on every engine surface:
//
//   * recording from any canvas is redirected through a compositor — a hidden
//     canvas that mirrors the live frame every rAF with the mark already on
//     it. HTMLCanvasElement.prototype.captureStream is wrapped, so the version
//     renderers need no per-page wiring, and SWR_WATERMARK.frameSource(canvas)
//     serves the WebCodecs path (lib/recorder.client.js), which builds
//     VideoFrames straight off a canvas.
//
// Why a compositor and not a paint onto the live canvas: the renderers draw
// with WebGL, where a 2D drawImage is impossible. Copying the frame works for
// both context types — the copy is made in the same rAF turn as the renderer's
// own draw, so a WebGL buffer is still readable. On-screen watermark overlays
// are left alone: they are the preview of the mark that lands in the file.
//
// The slot comes from the page: #rec-wm (a/b/c) when a page offers the
// selector, otherwise the mark the page already shows, otherwise the monogram.
//
// There is deliberately no opt-out here and none is read from a licence.
(function () {
  if (window.SWR_WATERMARK) return;

  function overlayImg() {
    return document.querySelector('.swr-watermark img');
  }
  function overlaySrc() {
    var el = overlayImg();
    return (el && el.getAttribute('src')) || '/watermark-monogram.svg';
  }
  function markSrc() {
    var sel = document.querySelector('#rec-wm');
    var key = sel && sel.value && sel.value !== 'none' ? sel.value : null;
    if (!key) return overlaySrc();
    var el = overlayImg();
    var base = el ? String(el.getAttribute('src') || '').replace(/[^/]*$/, '') : '/';
    return base + 'swr-watermark-' + key + '.svg';
  }

  var img = new Image();
  img.crossOrigin = 'anonymous'; // keep the copy untainted for captureStream
  img.src = markSrc();
  img.onerror = function () { img.src = overlaySrc(); }; // slot asset missing → page's own mark

  // Toggled by lib/invite-unlock.client.js when a valid invite code is
  // redeemed. Default ON — the mark is forced onto every export. The
  // compositor stays alive across the toggle so re-enabling is instant;
  // drawMark is the only thing that becomes a no-op.
  var enabled = true;

  var compositors = new WeakMap(); // source canvas -> { canvas, ctx }
  var own = new WeakSet();         // canvases we created — never re-wrap them

  function drawMark(ctx, w, h) {
    if (!enabled) return false;
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return false;
    // Scale 18% of frame width and a 3.3% margin — the geometry swr-watermark-plan.md
    // specifies for recorded output; the engine's own painter used the same numbers.
    var targetW = Math.round(w * 0.18);
    var targetH = Math.round(targetW * (img.naturalHeight / img.naturalWidth));
    var margin = Math.round(Math.min(w, h) * 0.033);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img, w - targetW - margin, h - targetH - margin, targetW, targetH);
    ctx.restore();
    return true;
  }

  // The canvas a recorder should capture: source frame + forced mark.
  function frameSource(source) {
    if (!source || !source.width || !source.height) return null;
    var entry = compositors.get(source);
    if (entry && entry.canvas.width === source.width && entry.canvas.height === source.height) return entry.canvas;

    var canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    own.add(canvas);

    var live = true;
    (function tick() {
      if (!live) return;
      if (!source.isConnected) { live = false; return; }
      try {
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height); // same-turn WebGL read
        drawMark(ctx, canvas.width, canvas.height);
      } catch (e) { /* never break a recording */ }
      requestAnimationFrame(tick);
    })();

    entry = { canvas: canvas, ctx: ctx };
    compositors.set(source, entry);
    return canvas;
  }

  var proto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  if (proto && proto.captureStream && !proto.captureStream.__swrForced) {
    var original = proto.captureStream;
    var forced = function () {
      if (own.has(this)) return original.apply(this, arguments); // our compositor
      // Capture the top composited surface: when a GPU grade pass is running
      // (lib/gpu-grade.client.js on the set pages, fx-postprocess.js in the
      // engine) it owns the final pixels, so compositing the 2D stage beneath
      // it would record ungraded frames. Verified: the overlay matches a CSS
      // ctx.filter render of the same frame to max 1/255.
      var src = this;
      try {
        var grade = window.SWR_GRADE && window.SWR_GRADE.outputCanvas;
        var fx = window.FX && window.FX.outputCanvas;
        var top = (grade && grade.width > 0) ? grade : ((fx && fx.width > 0) ? fx : null);
        if (top && top !== this) src = top;
      } catch (e) { /* fall back to the page's canvas */ }
      return original.apply(frameSource(src) || src, arguments);
    };
    forced.__swrForced = true;
    proto.captureStream = forced;
  }

  function setEnabled(next) {
    enabled = !!next;
  }
  function isEnabled() {
    return enabled;
  }

  window.SWR_WATERMARK = {
    frameSource: frameSource,
    src: img.src,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
  };
})();
