// lib/video-thumb.client.js
//
// Poster frame for a video thumbnail.
//
// Frame 0 is black on anything that fades in — which is most real
// footage — so a thumbnail captured at t=0 is a black rectangle, and the
// luma/hue read from that frame is wrong too. The engine already knows
// this: lib/library.client.js seeks to a poster frame before grabbing
// the thumb, and lib/media-store.client.js makeVideoThumb uses the same
// rule.
//
// The poster frame is 1s, or the middle of anything shorter. A
// proportional 10% still lands inside a short clip's fade-in; the middle
// of a short clip is the safest single frame available.
//
// Usage:
//   SWR_VIDEO_THUMB.atPoster(src, function () { ...draw the thumb... });
//
// `src` may be a video or an image; for an image the callback fires as
// soon as the image is decoded.
(function () {
  if (window.SWR_VIDEO_THUMB) return;

  function posterTime(src) {
    var d = (src && src.duration && isFinite(src.duration) && src.duration > 0) ? src.duration : 1;
    return Math.min(1, Math.max(0.1, d * 0.5));
  }

  function atPoster(src, done) {
    if (!src || !done) return;
    if (src.tagName !== 'VIDEO') {
      // Still image — the caller waits for its own load event.
      done();
      return;
    }

    var fired = false;
    var finish = function () {
      if (fired) return;
      fired = true;
      done();
    };

    src.addEventListener('loadedmetadata', function () {
      var d = (src.duration && isFinite(src.duration) && src.duration > 0) ? src.duration : 1;
      var at = posterTime(src);
      try {
        src.currentTime = Math.min(at, Math.max(0, d - 0.05));
      } catch (e) {
        finish();
      }
    }, { once: true });

    src.addEventListener('seeked', finish, { once: true });
    // A clip with no seekable range (or a decode error) never fires
    // 'seeked'. Fall back to whatever frame we have rather than leaving
    // the library card blank forever.
    src.addEventListener('error', finish, { once: true });
    setTimeout(finish, 4000);
  }

  window.SWR_VIDEO_THUMB = { atPoster: atPoster, posterTime: posterTime };
})();
