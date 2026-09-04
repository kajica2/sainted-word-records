// lib/journey-state.client.js — Hyper Journey runtime state for make-video.html.
//
// Purpose: drive a 4D-tesseract player position from audio features, expose
// it as a single source of truth for downstream consumers (Layer 2 alpha
// experiments, Layer 3 subtle effects). The position itself is NOT drawn.
// Movement drives modulation, not visible geometry.
//
// Audio input:   window.SWR.Audio (existing MVM bus). We add an AnalyserNode
//                tap the first time it's needed and compute FFT-band features.
// State output:  window.JourneyState.get(), window.JourneyState.subscribe(cb)
//
// Idempotent: re-evaluation replaces the existing JourneyState.

(function () {
  'use strict';
  if (window.JourneyState && window.JourneyState.__v1) return;

  // --- Public API ---
  const JourneyState = {
    __v1: true,

    // Read-only snapshot. Mutate via setState() only.
    _state: {
      active: false,
      timeSec: 0,
      player: {
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        heading: 0,
        speed: 0,
      },
      audio: {
        bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0,
        rms: 0, energy: 0, spectralCentroid: 0,
        beatPulse: false, onsetPulse: false,
      },
      user: {
        steer: { x: 0, y: 0 },   // mouse delta from canvas, decays
        steerHeld: false,
      },
    },

    _subscribers: new Set(),
    _rafId: 0,
    _lastFrameTime: 0,
    _analyser: null,
    _freqBuf: null,
    _audioReady: false,

    get() {
      return this._state;
    },

    set(patch) {
      // Shallow merge for top-level keys, but replace player/audio/user
      // objects entirely when patched to keep consumers' spread-safe.
      Object.assign(this._state, patch);
      this._notify();
      return this._state;
    },

    subscribe(cb) {
      this._subscribers.add(cb);
      return () => this._subscribers.delete(cb);
    },

    _notify() {
      for (const cb of this._subscribers) {
        try { cb(this._state); } catch (e) { console.warn('[journey-state] subscriber error', e); }
      }
    },

    // ---- Audio analysis: lazily attach an AnalyserNode to the MVM bus. ----
    _ensureAnalyser() {
      if (this._audioReady) return;
      const Audio = window.SWR && window.SWR.Audio;
      if (!Audio || !Audio.unlock) return;
      try {
        Audio.unlock();
        if (!Audio.ctx) return;
        const ctx = Audio.ctx;
        // Insert analyser between source and gain.
        if (!this._analyser) {
          this._analyser = ctx.createAnalyser();
          this._analyser.fftSize = 1024;
          this._analyser.smoothingTimeConstant = 0.65;
          this._freqBuf = new Float32Array(this._analyser.frequencyBinCount);
        }
        if (Audio.source && !this._analyser._wired) {
          try {
            Audio.source.disconnect();
            Audio.source.connect(this._analyser);
            this._analyser.connect(Audio.gain);
            this._analyser._wired = true;
          } catch (e) {
            // Source may not exist yet (no file loaded). Try on next frame.
            return;
          }
        }
        this._audioReady = true;
      } catch (e) {
        console.warn('[journey-state] analyser init failed', e);
      }
    },

    _computeFeatures() {
      if (!this._analyser || !this._freqBuf) return null;
      this._analyser.getFloatFrequencyData(this._freqBuf);
      const data = this._freqBuf;
      const len = data.length;
      // 5 bands. Bin ranges assume 44.1kHz / fftSize 1024 → 22050Hz max, bin = ~21.5Hz.
      const bands = [
        [1, 6],       // bass ~ 21-130Hz
        [6, 18],      // lowMid
        [18, 60],     // mid
        [60, 180],    // highMid
        [180, 600],   // treble
      ];
      let rmsSum = 0, centroidSum = 0, centroidWeight = 0;
      for (let i = 1; i < len; i++) {
        const v = data[i]; // dB, typically -100..0
        if (v < -100) continue;
        const lin = Math.pow(10, v / 20);
        rmsSum += lin * lin;
        centroidSum += i * lin;
        centroidWeight += lin;
      }
      const rms = Math.sqrt(rmsSum / len);
      const bandVals = bands.map(([lo, hi]) => {
        let s = 0, n = 0;
        for (let i = lo; i < Math.min(hi, len); i++) {
          const v = data[i];
          if (v < -100) continue;
          s += Math.pow(10, v / 20);
          n++;
        }
        return n > 0 ? Math.min(s / n, 1) : 0;
      });
      const centroid = centroidWeight > 0 ? (centroidSum / centroidWeight) / len : 0;
      // Beat detection: simple energy-based onset. Compare current bass to rolling avg.
      const bassNow = bandVals[0];
      const wasBeat = this._state.audio.beatPulse;
      const beatPulse = bassNow > 0.18 && bassNow > (this._lastBass || 0) * 1.35;
      this._lastBass = (this._lastBass || 0) * 0.92 + bassNow * 0.08;
      return {
        audio: {
          bass: bandVals[0],
          lowMid: bandVals[1],
          mid: bandVals[2],
          highMid: bandVals[3],
          treble: bandVals[4],
          rms,
          energy: Math.min(rms * 2.5, 1),
          spectralCentroid: centroid,
          beatPulse,
          onsetPulse: beatPulse && !wasBeat,
        },
      };
    },

    // ---- Per-frame tick: compute features, advance player, notify. ----
    _tick(now) {
      if (!this._state.active) return;
      if (!this._lastFrameTime) this._lastFrameTime = now;
      const dt = Math.min((now - this._lastFrameTime) / 1000, 0.1); // cap at 100ms
      this._lastFrameTime = now;
      this._state.timeSec += dt;

      this._ensureAnalyser();
      const feat = this._computeFeatures();
      if (feat) Object.assign(this._state.audio, feat.audio);

      // Decay user steer
      const decay = Math.exp(-dt / 0.4);
      this._state.user.steer.x *= decay;
      this._state.user.steer.y *= decay;

      // Audio-driven baseline motion (always present, even in silence).
      const a = this._state.audio;
      const t = this._state.timeSec;
      const dx = a.bass * 0.04 * (Math.sin(t * 0.13) + 1)
               + (a.spectralCentroid - 0.5) * 0.03
               + this._state.user.steer.x * 0.06;
      const dy = (a.energy - 0.3) * 0.02
               + a.treble * 0.015
               + this._state.user.steer.y * 0.06;
      const dz = a.lowMid * 0.05 - a.energy * 0.02;

      // Beat onset → velocity pulse (impulse)
      const beatImpulse = a.beatPulse ? 0.06 : 0;

      this._state.player.velocity.x = dx + beatImpulse * (this._state.player.velocity.x >= 0 ? 1 : 0);
      this._state.player.velocity.y = dy + beatImpulse * (this._state.player.velocity.y >= 0 ? 1 : 0);
      this._state.player.velocity.z = dz;
      this._state.player.speed = Math.hypot(dx, dy, dz) + (a.beatPulse ? 0.3 : 0);

      // Position integrates velocity with a soft clamp so the tesseract stays bounded.
      const SOFT_LIMIT = 0.85;
      this._state.player.position.x = this._softBound(this._state.player.position.x + dx * dt * 8, SOFT_LIMIT);
      this._state.player.position.y = this._softBound(this._state.player.position.y + dy * dt * 8, SOFT_LIMIT);
      this._state.player.position.z = this._softBound(this._state.player.position.z + dz * dt * 8, SOFT_LIMIT);
      this._state.player.heading = Math.atan2(this._state.user.steer.y, this._state.user.steer.x + 0.001);

      this._notify();
      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },

    _softBound(v, limit) {
      // tanh-style soft clamp: returns v for |v| < limit, asymptotes beyond.
      if (v > limit) return limit + Math.tanh((v - limit) * 2) * 0.15;
      if (v < -limit) return -limit + Math.tanh((v + limit) * 2) * 0.15;
      return v;
    },

    start() {
      if (this._state.active) return;
      this._state.active = true;
      this._lastFrameTime = 0;
      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },

    stop() {
      this._state.active = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    },

    // User-steer hook: call from a pointer event with normalized dx/dy in [-1, 1].
    setUserSteer(dx, dy) {
      this._state.user.steer.x += dx;
      this._state.user.steer.y += dy;
      this._state.user.steerHeld = (dx !== 0 || dy !== 0);
    },
  };

  window.JourneyState = JourneyState;
})();
