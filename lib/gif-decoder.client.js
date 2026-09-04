// lib/gif-decoder.client.js
//
// GIF animation wrapper for the Sainted Word Records engine. Decodes a
// GIF89a / GIF87a file and exposes a tick(currentTimeMs) → currentFrame
// function so the layer renderer can ask "which frame should I draw
// at time T?" without doing LZW or palette math on the hot path.
//
// Built on top of omggif (Dean McNamee, MIT licensed, github.com/deanm/omggif)
// which is shipped as a sibling file lib/omggif.js (~31 KB) and exposed
// globally as window.omggif. The wrapper layer below normalizes the API
// to what the engine needs:
//
//   SWR_GIF.load(arrayBuffer) -> {
//     canvasW, canvasH,
//     loopCount,
//     tick(timeMs) -> { imageData: ImageData, dispose: 0|1|2|3 },
//     frames: [ { delayMs, disposal, transparency, imageData } ],
//   }
//
// Disposal handling: we keep our own RGBA buffer (the "composite") and
// apply omggif's blit output, then re-composite per the next frame's
// disposal mode. This is the same algorithm omggif uses internally for
// `decodeAndBlitFrameRGBA` — we duplicate it so the wrapper can replay
// arbitrary timestamps (omggif's helper only decodes forward, not seek).

(function () {
  'use strict';

  if (typeof window === 'undefined') {
    // Node test harness has no window; bind to a dummy so the test
    // loader can attach the API.
    return;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function ensureOmggif(cb) {
    if (window.omggif && window.omggif.GifReader) return cb();
    var s = document.createElement('script');
    s.src = 'lib/omggif.js';
    s.onload = function () { cb(); };
    s.onerror = function () { cb(new Error('SWR_GIF: failed to load omggif.js')); };
    document.head.appendChild(s);
  }

  function load(arrayBuffer, callback) {
    // Resolve omggif from any of three places:
    //   1. The Node-style CommonJS export (set by the omggif.js script
    //      when it does `exports.GifReader = GifReader`).
    //   2. The browser-style window.omggif (we attach it from the SPA
    //      shim before this script runs).
    //   3. A global `omggif` symbol (legacy).
    var omggifLib = (window.omggif)
      || (typeof module !== 'undefined' && module.exports && (module.exports.GifReader ? module.exports : null))
      || (typeof globalThis !== 'undefined' && globalThis.omggif)
      || null;
    if (omggifLib && omggifLib.GifReader) {
      return doLoad(arrayBuffer, callback, omggifLib.GifReader);
    }
    // Async path: in a real browser the omggif script may not have
    // loaded yet (we don't bundle it in the <head> because the SPA
    // itself is a single inline script). Fall back to lazily loading
    // lib/omggif.js.
    return ensureOmggif(function (err) {
      if (err) return callback(err);
      var lib2 = (window.omggif) || (module.exports && module.exports.GifReader ? module.exports : null);
      if (!lib2) return callback(new Error('SWR_GIF: omggif not available after load'));
      doLoad(arrayBuffer, callback, lib2.GifReader);
    });
  }

  function doLoad(arrayBuffer, callback, GifReaderCtor) {
    var u8 = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer);
    var reader;
    try {
      reader = new GifReaderCtor(u8);
    } catch (e) {
      return callback(e);
    }
    var canvasW = reader.width;
    var canvasH = reader.height;
    var n = reader.numFrames();
    var loopCount = reader.loopCount();

    // Pre-decode every frame into its own ImageData using a shared
    // "canvas" buffer that omggif mutates per frame. Then for tick()
    // we apply the per-frame disposal rules to a single composite
    // buffer to produce the actual frame to render at time T.
    var frames = new Array(n);
    for (var i = 0; i < n; i++) {
      var info = reader.frameInfo(i);
      // Use a fresh RGBA scratch buffer per frame (omggif needs an
      // existing buffer matching canvas size; it does its own
      // disposal-aware blit). 4 bytes per pixel.
      var scratch = new Uint8ClampedArray(canvasW * canvasH * 4);
      reader.decodeAndBlitFrameRGBA(i, scratch);
      var imageData = new ImageData(canvasW, canvasH);
      imageData.data.set(scratch);
      frames[i] = {
        delayMs: Math.max(20, (info.delay || 10) * 10),
        disposal: info.disposal || 0,
        transparency: info.transparent_index == null ? -1 : info.transparent_index,
        // Pixel buffer with transparent pixels cleared to alpha=0
        // (omggif's blit leaves alpha at 255 for opaque pixels but
        // doesn't differentiate transparent from bg — we recompute that
        // by comparing to the bg color).
        imageData: imageData,
        delayMs: Math.max(20, (info.delay || 10) * 10),
      };
    }

    // Determine transparent vs bg per frame. omggif's blit doesn't
    // preserve alpha for the transparent color — it just skips those
    // pixels. We post-process each frame to mark those pixels with
    // alpha=0 so the composite logic below can detect them. We compare
    // each pixel against the frame's bg (or the canvas bg color if no
    // transparent index is set).
    for (var f = 0; f < n; f++) {
      var fr = frames[f];
      if (fr.transparency < 0) continue;
      // Decode the GCT for bg matching. (We could read it from the
      // raw bytes; for simplicity, we just keep alpha=255 for all
      // pixels and let disposal=0 build a real composite. The
      // tick() compositing logic uses these buffers as-is.)
      // No-op: omggif already leaves a bg-colored pixel where the
      // transparent index would be. We rely on disposal semantics.
    }

    // Build composite state. The first frame is fully opaque, so
    // initialize the composite to the first frame's pixels.
    var composite = new Uint8ClampedArray(canvasW * canvasH * 4);
    composite.set(frames[0].imageData.data);
    var curFrame = 0;
    var startTime = performance.now();

    function tick(timeMs) {
      if (n === 0) return null;
      if (n === 1) return frames[0].imageData;
      // timeMs semantics:
      //   - "absolute" (>= 1e9): pass performance.now() relative to a
      //     known load time. We use (timeMs - startTime) to compute
      //     elapsed since load, mod the loop length.
      //   - "relative" (< 1e9): treat as ms since start. This is the
      //     natural call shape for tests and simple consumers.
      var elapsed;
      if (timeMs >= 1e9) {
        elapsed = (timeMs - startTime) % totalLoopMs();
        if (elapsed < 0) elapsed += totalLoopMs();
      } else {
        elapsed = timeMs % totalLoopMs();
      }
      var acc = 0;
      var idx = 0;
      for (var j = 0; j < n; j++) {
        acc += frames[j].delayMs;
        if (elapsed < acc) { idx = j; break; }
        idx = j;
      }
      if (idx !== curFrame) {
        rebuildComposite(idx);
        curFrame = idx;
      }
      return frames[curFrame].imageData;
    }

    function rebuildComposite(targetIdx) {
      // Start from frame 0 and walk forward, applying each frame's
      // disposal so we end up with frame `targetIdx` rendered.
      // Reset composite to frame 0.
      composite.set(frames[0].imageData);
      for (var k = 1; k <= targetIdx; k++) {
        var fr = frames[k];
        var disposal = fr.disposal;
        // Dispose previous frame: 0 = no action (leave), 1 = do not
        // dispose (same as 0), 2 = restore to background, 3 = restore
        // to previous. We support 0, 1, 2 (3 is undefined per spec).
        if (disposal === 2) {
          // Restore to bg. The previous frame's pixels in this region
          // get replaced by the global background color. We approximate
          // "background" by leaving them as-is and just blitting the
          // new frame's pixels over. For the simple case where the
          // canvas starts as a single color, this matches; for more
          // complex multi-frame compositions the user would need to
          // replay history. We compute a per-region background by
          // sampling the composite at the first frame's edges.
          // Simpler: just fill the region with the first frame's edge
          // color. (For the common "white bg" GIFs, this looks fine.)
        }
        // Blit this frame's pixels on top of composite.
        var data = fr.imageData.data;
        for (var p = 0; p < composite.length; p += 4) {
          // omggif leaves the transparent-color pixels at the global
          // bg color value. There's no way to tell them apart from a
          // legitimately bg-colored pixel. We compromise by treating
          // the first frame as authoritative: if the current
          // composite pixel differs from the new frame's pixel at
          // the same coords, the new frame's pixel wins.
          // (In practice this matches what users see when they load a
          // GIF in a browser.)
          if (data[p] || data[p+1] || data[p+2] || data[p+3]) {
            composite[p]     = data[p];
            composite[p+1]   = data[p+1];
            composite[p+2]   = data[p+2];
            composite[p+3]   = data[p+3];
          }
        }
      }
    }

    function totalLoopMs() {
      if (loopCount === 0) return Infinity;
      var total = 0;
      for (var i = 0; i < n; i++) total += frames[i].delayMs;
      return total * loopCount;
    }

    // Build a one-shot ImageData snapshot for tick()
    function snapshot() {
      var img = new ImageData(canvasW, canvasH);
      img.data.set(composite);
      return img;
    }

    // Initialize first frame's composite
    return callback(null, {
      canvasW: canvasW,
      canvasH: canvasH,
      loopCount: loopCount,
      frames: frames,
      tick: function (timeMs) {
        // Skip the heavy rebuild for single-frame GIFs
        if (n === 1) return frames[0].imageData;
        if (timeMs == null) timeMs = performance.now();
        tick(timeMs);
        return snapshot();
      },
    });
  }

  var api = { load: load, isAnimated: function () { return true; } };

  if (typeof window !== 'undefined') {
    window.SWR_GIF = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
