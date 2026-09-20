// client/dashboard-engine-bridge.client.js
//
// Bridges the dashboard's `window.__SWR_ENGINE` runtime to the music_video
// automix stack. The dashboard has its own WebGL engine that exposes
// `features()` returning { bass, mid, high, rms, onset, level } and `bpm()`
// returning a rolling BPM estimate. The automix runtime (loaded on every
// dashboard page via the Phase 3 setup) expects `window.SWR.Audio.feat` in
// the engine-runtime shape (beat / onset / beatPulse / rms / centroid / bpm).
//
// This bridge:
//   1. Polls __SWR_ENGINE.features() + bpm() at ~10Hz.
//   2. Synthesizes a centroid value (1D spectrum mass from bass/mid/high
//      bands; not present on dashboard's runtime).
//   3. Detects onset pulses (rising-edge on the `onset` band; the automix
//      runtime expects beatPulse to flip high on each detected beat).
//   4. Writes the synthesized shape into `window.SWR = { Audio: { feat: ... }}`
//      so automix.runtime can consume it.
//   5. Tracks an internal `enabled` flag — when true, automix.runtime is
//      expected to be running (the toggle button controls this). When
//      false, the bridge still updates SWR.Audio.feat (cheap) but doesn't
//      mutate the runtime.
//
// Usage:
//
//     bridge = window.SWR_DASHBOARD_BRIDGE;
//     bridge.start();    // turns the bridge on; user must also click
//                         // the Automix toggle to start the runtime.
//     bridge.stop();     // stops the poller + clears the synth features.
//     bridge.synthesizedFeatures();  // returns the current shape
//                                    // (handy for tests / debugging).
//
// The bridge is no-op if `window.__SWR_ENGINE` isn't loaded yet (the
// dashboard engine script may still be loading). Callers should wait for
// `window.__SWR_DASHBOARD_BRIDGE.ready()` to resolve before starting.

(function () {
  'use strict';
  if (window.SWR_DASHBOARD_BRIDGE) return;

  var POLL_MS = 100;
  var lastOnset = 0;
  var lastRms = 0;
  var synth = {
    beat: 0,
    beatPulse: false,
    onset: 0,
    rms: 0,
    centroid: 0.5,
    bpm: 0,
    bass: 0,
    mid: 0,
    treb: 0,
    high: 0,
    level: 0,
    beatInBar: null,
  };

  var timer = null;
  var enabled = false;
  var lastEmitTs = 0;
  var listeners = [];

  function readSWR() {
    return (window.SWR && window.SWR.Audio) ? window.SWR.Audio : null;
  }

  function tick() {
    var eng = window.__SWR_ENGINE;
    if (!eng) return;
    var f = (typeof eng.features === 'function') ? eng.features() : null;
    if (!f) return;

    // Map dashboard fields to automix shape.
    var bass = num(f.bass);
    var mid = num(f.mid);
    var high = num(f.high);
    var rms = num(f.rms);
    var onset = num(f.onset);
    var level = (typeof f.level === 'number') ? f.level : Math.max(bass, mid, high, rms);
    var bpm = 0;
    if (typeof eng.bpm === 'function') {
      var b = eng.bpm();
      bpm = (typeof b === 'number' && isFinite(b) && b > 0) ? b : 0;
    }

    // Centroid: 1D spectrum mass. Map (bass=low, mid=mid, high=high) to
    // [0..1] where 0 = bass-heavy, 1 = treble-heavy. This is a crude
    // approximation of the audio-analysis-v2 chroma centroid but it's
    // enough for automix's anchor-map to pick varied presets.
    var total = bass + mid + high;
    var centroid = total > 0.01 ? (high + 0.5 * mid) / total : 0.5;

    // Beat pulse: rising-edge on the onset band. automix expects
    // `beatPulse` to flip from false to true on each detected beat.
    var now = Date.now();
    var pulse = false;
    if (onset > 0.4 && now - lastOnset > 200) {
      pulse = true;
      lastOnset = now;
    }

    synth.bass = bass;
    synth.mid = mid;
    synth.treb = high;
    synth.high = high;
    synth.rms = rms;
    synth.level = level;
    synth.onset = onset;
    synth.centroid = centroid;
    synth.bpm = bpm;
    synth.beatPulse = pulse;
    // `beat` is the smoothed beat strength — automix uses this for the
    // drift amplitude on every pulse. Use onset as the proxy.
    synth.beat = onset;
    // beatInBar is set by audio-analysis-v2's beat tracker; we don't
    // have that on dashboard so leave it null. automix falls back to
    // the simpler bar-nudge path when null.
    synth.beatInBar = null;

    // Publish to window.SWR.Audio.feat so the automix runtime can read it.
    var swrAudio = readSWR();
    if (swrAudio) {
      swrAudio.feat = synth;
    }

    // Notify in-process subscribers (e.g. the runtime's hook listeners).
    if (pulse && now - lastEmitTs > 100) {
      lastEmitTs = now;
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](synth); } catch (_) {}
      }
    }
  }

  function num(x) {
    return (typeof x === 'number' && isFinite(x)) ? Math.max(0, Math.min(1, x)) : 0;
  }

  function start() {
    if (timer) return;
    enabled = true;
    timer = setInterval(tick, POLL_MS);
    // Fire one immediately so consumers see a fresh synth shape.
    tick();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    enabled = false;
    // Clear the synth so automix falls back to its idle state.
    synth.beat = 0;
    synth.beatPulse = false;
    synth.onset = 0;
    synth.rms = 0;
    synth.centroid = 0.5;
    var swrAudio = readSWR();
    if (swrAudio) swrAudio.feat = synth;
  }

  function ready() {
    return new Promise(function (resolve) {
      if (window.__SWR_ENGINE) return resolve();
      var i = 0;
      var id = setInterval(function () {
        if (window.__SWR_ENGINE) { clearInterval(id); resolve(); return; }
        if (++i > 50) { clearInterval(id); resolve(); } // give up after 5s
      }, 100);
    });
  }

  function onPulse(handler) {
    if (typeof handler !== 'function') return function () {};
    listeners.push(handler);
    return function () {
      var i = listeners.indexOf(handler);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  window.SWR_DASHBOARD_BRIDGE = {
    start: start,
    stop: stop,
    ready: ready,
    onPulse: onPulse,
    synthesizedFeatures: function () { return Object.assign({}, synth); },
    get enabled() { return enabled; },
  };
})();