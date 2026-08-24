// lib/mvm-audio-bus.client.js — minimal audio bus for /make-video.html.
//
// The full engine defines a feature-rich window.SWR.Audio with a Web Audio
// analyser, beat detection, BPM tracking, and captureStream(). The MVM
// page doesn't need all of that — it just needs an HTMLAudioElement +
// a load/play/pause surface + captureStream() for the MediaRecorder
// pipeline. This module ships that minimal bus, exposed on
// window.SWR.Audio, so make-video.html can run without the full engine.
//
//   window.SWR = window.SWR || {};
//   window.SWR.Audio = {
//     el, ctx, gain, source,            // HTMLAudioElement + Web Audio (lazy)
//     playing,                         // boolean
//     feat: { rms, bass, ... },         // zeros (the MVM doesn't read features)
//     load(file),                      // load a File into el
//     play(), pause(),                 // audio transport
//     captureStream(),                 // for MediaRecorder (may return null)
//   }
//
// Idempotent: re-evaluating replaces the existing Audio bus.

(function () {
  'use strict';
  if (window.SWR && window.SWR.Audio && window.SWR.Audio.__mvm) return;

  const Audio = {
    __mvm: true,
    el: null,
    ctx: null,
    gain: null,
    source: null,
    mediaDest: null,
    playing: false,
    feat: {
      bass: 0, mid: 0, treble: 0, air: 0, sub: 0,
      rms: 0, centroid: 0, beat: 0, onset: 0,
      beatPulse: false, onsetPulse: false, bpm: 0,
    },

    unlock() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.gain.connect(this.ctx.destination);
    },

    load(file) {
      this.unlock();
      if (this.el) {
        try { this.el.pause(); } catch (_) {}
        try { this.el.removeAttribute('src'); this.el.load(); } catch (_) {}
      }
      this.el = document.createElement('audio');
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'auto';
      // Track the blob URL we just created so we can revoke it on the
      // next load(). The MVM page may call Audio.load() many times.
      this.el.__swr_blob_url = URL.createObjectURL(file);
      this.el.src = this.el.__swr_blob_url;
      this.playing = false;
    },

    play() {
      this.unlock();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      if (this.el) {
        this.el.play().catch(() => { /* autoplay gated, no-op */ });
        this.playing = true;
      }
    },

    pause() {
      if (this.el) this.el.pause();
      this.playing = false;
    },

    captureStream() {
      // Web Audio captureStream via a MediaStreamDestination. Connect the
      // audio source to it so MediaRecorder can pick it up. Only wire
      // it up once per load to avoid doubling the audio output.
      if (!this.el || !this.ctx) return null;
      this.unlock();
      if (this.source) {
        try { this.source.disconnect(); } catch (_) {}
      }
      if (this.mediaDest) {
        try { this.mediaDest.disconnect(); } catch (_) {}
      }
      this.source = this.ctx.createMediaElementSource(this.el);
      this.mediaDest = this.ctx.createMediaStreamDestination();
      this.source.connect(this.gain);    // existing audible path
      this.source.connect(this.mediaDest); // + recorder path
      return this.mediaDest.stream;
    },
  };

  window.SWR = window.SWR || {};
  window.SWR.Audio = Audio;
})();