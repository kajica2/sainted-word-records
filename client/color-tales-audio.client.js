/* global window, document */
(function () {
  let ctx = null;
  let dest = null;
  let srcNode = null;
  let wiredEl = null;

  function ensureContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    window.SWR_COLOR_TALES_AUDIO_CTX = ctx;
    return ctx;
  }

  /** Wire uploaded soundtrack: speakers + reusable recorder destination (once per element). */
  function attachSoundtrack(audioEl) {
    if (!audioEl) return null;
    const c = ensureContext();
    if (wiredEl !== audioEl) {
      try { srcNode?.disconnect(); } catch { /* ok */ }
      wiredEl = audioEl;
      srcNode = c.createMediaElementSource(audioEl);
      dest = c.createMediaStreamDestination();
      srcNode.connect(dest);
      srcNode.connect(c.destination);
      if (!audioEl.dataset.ctAudioPlayBound) {
        audioEl.dataset.ctAudioPlayBound = '1';
        audioEl.addEventListener('play', () => { void c.resume(); });
      }
    }
    window.SWR_COLOR_TALES_AUDIO_DEST = dest;
    return dest;
  }

  function recordAudioTrack() {
    const track = dest?.stream?.getAudioTracks?.()?.[0];
    return track && track.readyState !== 'ended' ? track : null;
  }

  function resumeOnGesture() {
    return ctx?.resume?.() ?? Promise.resolve();
  }

  window.SWR_COLOR_TALES_AUDIO = {
    attachSoundtrack,
    recordAudioTrack,
    resumeOnGesture,
    get context() { return ctx; },
    get destination() { return dest; },
  };
})();
