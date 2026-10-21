// lib/video-sync.client.js
//
// Drive a media element from the transport without trusting `paused`.
//
// The obvious two-line version breaks on video in two ways:
//
//   if (playing && el.paused) el.play();
//   if (!playing && !el.paused) el.pause();
//
//  1. A video paused while it is still loading has its media pipeline
//     suspended by Chrome: the element drops back to readyState 1 and
//     stops fetching. The next play() restarts the load from scratch, so
//     the element can sit at readyState 1 for good — and the render
//     gate (readyState < 2) then skips the layer, so the clip never
//     reaches the stage.
//  2. While a play() promise is pending, `paused` stays true, so the
//     next frame calls play() again — and a second play() on a pending
//     element resets it to readyState 1 (same dead end).
//
// So: keep at most one play in flight, and re-arm a stalled element at
// most once a second. load() restarts the fetch; the play follows on
// the next frame, once the load has had a moment to make progress.
//
// Usage: window.SWR_VIDEO_SYNC(el, wantPlay)
(function () {
  if (window.SWR_VIDEO_SYNC) return;

  function sync(el, wantPlay) {
    if (!el) return;

    if (!wantPlay) {
      if (!el.paused) { try { el.pause(); } catch (_) {} }
      return;
    }

    // Already playing, or a play is still in flight.
    if (!el.paused || el._swrPlayPending) return;

    var stalled = el.readyState < 2 && el.currentTime === 0;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (stalled && (!el._swrRearmAt || now - el._swrRearmAt > 1000)) {
      el._swrRearmAt = now;
      try { el.load(); } catch (_) {}
      return;
    }

    el._swrPlayPending = true;
    var done = function () { el._swrPlayPending = false; };
    try {
      var pr = el.play();
      if (pr && typeof pr.then === 'function') pr.then(done, done);
      else done();
    } catch (_) {
      done();
    }
  }

  window.SWR_VIDEO_SYNC = sync;
})();
