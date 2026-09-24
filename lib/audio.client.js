// lib/audio.client.js — Audio subsystem extracted from engine.html
// (Sprint B1 of feat/asset-curator burndown).
//
// Public API
//
//   window.Audio  — the Audio IIFE instance, attached on script-eval.
//                   Same surface as the pre-extraction inline object:
//   .ctx, .analyser, .source, .gain, .audioEl, .fft, .time
//   .feat         — per-frame features (bass, mid, treble, air, sub, rms,
//                   centroid, beat, onset, beatPulse, onsetPulse, bpm)
//   .history      — beat detection state (prev fft, averages)
//   .beatTimes    — recent beat timestamps for BPM estimation
//   .playing      — bool
//   .bar          — getter for the bar counter (Story runtime uses it)
//   .unlock()     — lazily create AudioContext
//   .loadFile(f)  — load an audio/video File as the current song
//   .play()       — start playback
//   .pause()      — pause playback
//   .seek(frac)   — jump to a fractional position
//   .sample()     — per-frame feature extraction (call from rAF loop)
//   .analyzeFull()— decode + analyze the whole song via audio-analysis-v2
//   ._saveCurrentSong(f), ._loadCurrentSong(), ._clearCurrentSong()
//                 — IndexedDB-backed persistence
//   ._isVideoFile(f)  — video mime / extension check
//   ._lastAudioError  — read by the ?diag=1 dump surface (Sprint A1)
//
// Dependencies (read via window.* at call time):
//   window.AudioContext / window.webkitAudioContext
//   window.AudioAnalysisV2      — audio-analysis-v2.js
//   window.SWRTransitions       — engine-transitions.client.js (for onBeat)
//   window.Library              — Library.db.getAll/put/delete (engine.html)
//   window.UI                   — engine.html UI IIFE
//   window.setStatus, window.escapeHtml, window.clamp, window.lerp
//   window.stageEmpty           — #stage-empty DOM ref
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';

  // Note: don't use `if (window.Audio) return` — browsers expose a native
  // Audio constructor on window that shadows our namespace. Use a private
  // marker instead.
  if (window.__SWR_AUDIO_LOADED) return;
  window.__SWR_AUDIO_LOADED = true;

  // ---- Dependency lookups ----------------------------------------------
  // All deps are read at call time (not at IIFE-init time) so the order
  // of script evaluation doesn't matter. If a dep isn't loaded yet, the
  // helper returns a safe fallback.
  function getCtx() {
    return window.AudioContext || window.webkitAudioContext;
  }
  function setStatus(t, cls) {
    if (typeof window.setStatus === 'function') window.setStatus(t, cls);
  }
  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s);
  }
  function clamp(v, lo, hi) {
    if (typeof window.clamp === 'function') return window.clamp(v, lo, hi);
    return Math.max(lo, Math.min(hi, v));
  }
  function lerp(a, b, t) {
    if (typeof window.lerp === 'function') return window.lerp(a, b, t);
    return a + (b - a) * t;
  }
  function stageEmpty() {
    if (window.stageEmpty) return window.stageEmpty;
    return document.getElementById('stage-empty');
  }
  function UI() {
    return window.UI || null;
  }
  function $(id) { return document.getElementById(id); }

  // ---- Audio IIFE ------------------------------------------------------
  const Audio = {
    ctx: null,
    analyser: null,
    source: null,
    gain: null,
    audioEl: null,
    fft: null,
    time: null,
    // Last audio decode/playback error. Read by the ?diag=1 dump surface.
    // Shape: { t: <ms epoch>, code: <MediaError.code>, reason: <string>, fileName: <string> } | null
    _lastAudioError: null,
    // Per-frame features
    feat: {
      bass: 0, mid: 0, treble: 0, air: 0, sub: 0,
      rms: 0, centroid: 0,
      beat: 0,         // 0..1 envelope (decays)
      onset: 0,        // 0..1 envelope (decays)
      beatPulse: false, // fires on each beat
      onsetPulse: false,
      bpm: 0,
    },
    history: { prev: null, bassAvg: 0, fluxAvg: 0 },
    beatTimes: [],
    playing: false,
    // Bar counter for the Story runtime (and any other time-aware code).
    // 1 bar = Audio.feat.bpm / 60 seconds. When BPM is unknown (no song
    // loaded), bar stays at 0 and never advances; the Story runtime treats
    // that as "no timing, use the fallback maxBars timer instead".
    _bar: 0,
    _barStartedAt: 0, // performance.now() at the start of the current bar
    _barsSinceSongStart: 0,
    get bar() { return this._bar; },
    // Resets the bar counter — call from Story.enter() so each chapter
    // gets its own fresh bar count.
    resetBarCounter() {
      this._bar = 0;
      this._barStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    },
    // Advance the bar counter based on elapsed wall time + current BPM.
    // Cheap enough to call once per animation frame; clamps to integer.
    _tickBar() {
      const bpm = (this.feat && this.feat.bpm) || 0;
      if (!bpm) return;
      const secPerBar = 60 / bpm;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = (now - (this._barStartedAt || now)) / 1000;
      const newBar = Math.floor(elapsed / secPerBar);
      if (newBar > this._bar) this._bar = newBar;
    },
    unlock() {
      if (this.ctx) return;
      const Ctx = getCtx();
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.analyser = this.ctx.createAnalyser();
      // FFT size + smoothing come from the device tier when present
      // (lib/tier-runtime.js): weaker devices get a smaller transform and a
      // longer analyser window, which is less per-frame work for the same
      // perceptual result. Falls back to the long-standing 2048/0.65.
      const tierProfile = (window.__TIER__ && window.__TIER__.profile) || null;
      this.analyser.fftSize = (tierProfile && tierProfile.fftSize) || 2048;
      this.analyser.smoothingTimeConstant =
        (tierProfile && typeof tierProfile.analyserSmoothing === 'number')
          ? tierProfile.analyserSmoothing : 0.65;
      this.fft = new Uint8Array(this.analyser.frequencyBinCount);
      this.time = new Uint8Array(this.analyser.fftSize);
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1.0;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      setStatus('audio live', 'ok');
    },
    // True for any file we should decode through a <video> element.
    // Both <audio> and <video> support createMediaElementSource identically,
    // so the rest of the engine doesn't care which element backs the source.
    _isVideoFile(file) {
      if (!file) return false;
      if (file.type && file.type.startsWith('video/')) return true;
      return /\.(mp4|m4v|webm|mov|mkv|m3u8|ogv)$/i.test(file.name || '');
    },
    loadFile(file) {
      this.unlock();
      if (this.source) try { this.source.disconnect(); } catch (e) {}
      if (this.audioEl) {
        this.audioEl.pause();
        // For <video>, removeAttribute is needed (no `src = ''` resets state the same way)
        this.audioEl.removeAttribute('src');
        try { this.audioEl.load(); } catch (e) {}
      }
      // Persist the song blob so it survives reloads. Fire-and-forget — a
      // failed save should not block the user from playing music.
      this._saveCurrentSong(file);
      const isVideo = this._isVideoFile(file);
      // Use a <video> element for video files so the browser decodes the
      // MP4/MOV/etc container (and its audio track). The element is kept
      // off-screen but rendered (display:none would pause audio in some
      // browsers — use opacity:0 + 1×1px positioning instead).
      const el = isVideo ? document.createElement('video') : document.createElement('audio');
      el.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      if (isVideo) {
        // Plays inline on iOS Safari, allow autoplay once user interacts
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
      }
      el.src = URL.createObjectURL(file);
      this.audioEl = el;
      const ui = UI();
      this.audioEl.addEventListener('ended', () => { if (ui && ui.onSongEnd) ui.onSongEnd(); });
      this.audioEl.addEventListener('timeupdate', () => { if (ui && ui.updateTime) ui.updateTime(); });
      // Decode-error feedback: a corrupt / unsupported / unsupported-codec
      // file silently fails otherwise (no console error visible to the
      // user, just a "loaded" status with no playback). Surface it.
      this.audioEl.addEventListener('error', () => {
        const err = this.audioEl.error;
        const code = err ? err.code : 0;
        // 1 = MEDIA_ERR_ABORTED, 2 = MEDIA_ERR_NETWORK, 3 = MEDIA_ERR_DECODE,
        // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
        const reason = code === 3 ? 'decode failed (corrupt or unsupported codec)'
                        : code === 4 ? 'format not supported by this browser'
                        : code === 2 ? 'network error'
                        : 'audio element error';
        setStatus(`✕ can't play ${file.name}: ${reason}`, 'err');
        // Disable the play button so the user doesn't repeatedly click
        // into silence.
        const playBtn = $('play');
        if (playBtn) playBtn.disabled = true;
        const recBtn = $('rec');
        if (recBtn) recBtn.disabled = true;
        // Diagnostic snapshot for ?diag=1 dump (Sprint A1 of
        // feat/asset-curator burndown). Read-only; no other consumer.
        this._lastAudioError = {
          t: Date.now(),
          code: code,
          reason: reason,
          fileName: file.name,
        };
      });
      // Mark element type so the recorder knows what to display
      this.audioEl.dataset.kind = isVideo ? 'video' : 'audio';
      this.source = this.ctx.createMediaElementSource(this.audioEl);
      this.source.connect(this.analyser);
      // Render the song name with a small badge for video source
      const badge = isVideo
        ? '<span class="song-badge" title="Loaded from a video file — audio extracted in-browser">VIDEO</span> '
        : '';
      const saved = '<span class="song-badge" title="Saved to this browser — will auto-restore on next visit" style="background:#1f3;color:#0f0;">SAVED</span> ';
      const songName = $('song-name');
      if (songName) songName.innerHTML = saved + badge + '<b>' + escapeHtml(file.name) + '</b>';
      const playEl = $('play'); if (playEl) playEl.disabled = false;
      const recEl = $('rec'); if (recEl) recEl.disabled = false;
      const evEl = $('export-video'); if (evEl) evEl.disabled = false;
      this.history = { prev: null, bassAvg: 0, fluxAvg: 0 };
      this.beatTimes = [];
      this.feat.bpm = 0;
      const bpmPill = $('bpm-pill'); if (bpmPill) bpmPill.textContent = '— bpm';
      if (isVideo) {
        // Helpful status so the user knows what's happening (no video frame will appear)
        setStatus('loaded MP4 audio · click play', 'ok');
      }
    },
    play() {
      this.unlock();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      if (this.audioEl) this.audioEl.play();
      this.playing = true;
      const playEl = $('play');
      if (playEl) {
        playEl.textContent = '❚❚ Pause';
        playEl.classList.remove('primary');
        playEl.classList.add('danger');
      }
      const se = stageEmpty();
      if (se && se.classList) se.classList.add('hidden');
    },
    // === Persistent song storage (IndexedDB 'songs' store, key 'current') ===
    // The latest loaded song survives reloads so the user doesn't have to
    // re-pick a file every time they open the engine. Saving is fire-and-
    // forget; loading is async and used at boot.
    async _saveCurrentSong(file) {
      if (!file) return;
      try {
        // Library.db may not be open yet (loadFile can fire before Library.init
        // completes during boot). Wait briefly for it.
        let tries = 0;
        while ((!window.Library || !window.Library.db) && tries < 50) {
          await new Promise(r => setTimeout(r, 20));
          tries++;
        }
        if (!window.Library || !window.Library.db) return;
        await window.Library.db.put('songs', {
          id: 'current',
          blob: file,
          name: file.name,
          type: file.type,
          savedAt: Date.now(),
        });
        setStatus('song saved', 'ok');
      } catch (e) {
        console.warn('saveCurrentSong', e);
      }
    },
    async _loadCurrentSong() {
      try {
        if (!window.Library || !window.Library.db) return false;
        const all = await window.Library.db.getAll('songs');
        const rec = (all || []).find(r => r && r.id === 'current');
        if (!rec || !rec.blob) return false;
        // Rebuild a File so the existing loadFile path handles it (and we
        // get the same VIDEO badge, MP4 chooser, etc.).
        const file = new File([rec.blob], rec.name, { type: rec.type || rec.blob.type || 'audio/mpeg' });
        this.loadFile(file);
        return true;
      } catch (e) {
        console.warn('loadCurrentSong', e);
        return false;
      }
    },
    async _clearCurrentSong() {
      try {
        if (!window.Library || !window.Library.db) return;
        await window.Library.db.delete('songs', 'current');
      } catch (e) { console.warn('clearCurrentSong', e); }
    },
    pause() {
      if (this.audioEl) this.audioEl.pause();
      this.playing = false;
      const playEl = $('play');
      if (playEl) {
        playEl.textContent = '▶ Play';
        playEl.classList.add('primary');
        playEl.classList.remove('danger');
      }
    },
    seek(frac) {
      if (!this.audioEl) return;
      this.audioEl.currentTime = this.audioEl.duration * clamp(frac, 0, 1);
    },
    // returns true if a beat was detected this frame
    sample() {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(this.fft);
      this.analyser.getByteTimeDomainData(this.time);
      const N = this.fft.length;            // 1024
      const sr = this.ctx.sampleRate;
      const hzPerBin = sr / (this.analyser.fftSize); // ~21.5 Hz per bin
      // sub 20-60 Hz
      // bass 60-250 Hz
      // mid 250-2000 Hz
      // treble 2000-6000 Hz
      // air 6000+ Hz
      const ranges = {
        sub:   [Math.floor(20/hzPerBin),    Math.floor(60/hzPerBin)],
        bass:  [Math.floor(60/hzPerBin),    Math.floor(250/hzPerBin)],
        mid:   [Math.floor(250/hzPerBin),   Math.floor(2000/hzPerBin)],
        treble:[Math.floor(2000/hzPerBin),  Math.floor(6000/hzPerBin)],
        air:   [Math.floor(6000/hzPerBin),  N - 1],
      };
      const mean = (lo, hi) => {
        if (hi <= lo) return 0;
        let s = 0, c = 0;
        for (let i = lo; i <= hi; i++) { s += this.fft[i]; c++; }
        return s / c / 255; // 0..1
      };
      this.feat.sub   = mean(ranges.sub[0],   ranges.sub[1]);
      this.feat.bass  = mean(ranges.bass[0],  ranges.bass[1]);
      this.feat.mid   = mean(ranges.mid[0],   ranges.mid[1]);
      this.feat.treble= mean(ranges.treble[0],ranges.treble[1]);
      this.feat.air   = mean(ranges.air[0],   ranges.air[1]);
      // RMS
      let rms = 0;
      for (let i = 0; i < this.time.length; i++) {
        const v = (this.time[i] - 128) / 128;
        rms += v * v;
      }
      this.feat.rms = Math.sqrt(rms / this.time.length);
      // Spectral centroid
      let num = 0, den = 0;
      for (let i = 1; i < N; i++) {
        num += i * this.fft[i];
        den += this.fft[i];
      }
      this.feat.centroid = den > 0 ? (num / den) / N : 0;
      // ----- Onset (spectral flux) -----
      let flux = 0;
      if (this.history.prev) {
        for (let i = 1; i < N; i++) {
          const d = this.fft[i] - this.history.prev[i];
          if (d > 0) flux += d;
        }
      }
      flux /= (255 * N);
      this.history.fluxAvg = lerp(this.history.fluxAvg, flux, 0.08);
      const beatGateEl = $('beat-gate');
      const onsetGate = beatGateEl ? parseFloat(beatGateEl.value) : 1.4;
      const onsetHit = flux > this.history.fluxAvg * onsetGate && flux > 0.02;
      // ----- Beat (bass energy) -----
      this.history.bassAvg = lerp(this.history.bassAvg, this.feat.bass, 0.06);
      const beatGate = onsetGate;
      const beatHit = this.feat.bass > this.history.bassAvg * beatGate && this.feat.bass > 0.18;
      // BPM estimate (lock to a stable tempo)
      const now = this.ctx.currentTime;
      if (beatHit) {
        this.beatTimes.push(now);
        while (this.beatTimes.length > 0 && this.beatTimes[0] < now - 8) this.beatTimes.shift();
        if (this.beatTimes.length >= 4) {
          let total = 0;
          for (let i = 1; i < this.beatTimes.length; i++) total += this.beatTimes[i] - this.beatTimes[i-1];
          const avg = total / (this.beatTimes.length - 1);
          if (avg > 0) this.feat.bpm = Math.round(60 / avg);
        }
      }
      // Decay envelopes
      const decayEl = $('decay');
      const decay = decayEl ? parseFloat(decayEl.value) : 0.9;
      this.feat.beat  = beatHit ? 1 : this.feat.beat * decay;
      this.feat.onset = onsetHit ? 1 : this.feat.onset * decay;
      this.feat.beatPulse  = beatHit;
      this.feat.onsetPulse = onsetHit;
      this.history.prev = Uint8Array.from(this.fft);
      const beatLed = $('beat-led');   if (beatLed && beatLed.classList)   beatLed.classList.toggle('on', beatHit);
      const onsetLed = $('onset-led'); if (onsetLed && onsetLed.classList) onsetLed.classList.toggle('on', onsetHit);
      if (this.feat.bpm) {
        const bpmPill = $('bpm-pill');
        if (bpmPill) bpmPill.textContent = this.feat.bpm + ' bpm';
      }
      // Hook for engine-transitions: feed live beat + BPM into the auto-fire
      // subsystem. Idempotent — SWRTransitions may not be loaded yet (e.g.
      // on persona-preview pages without the transitions script).
      if (window.SWRTransitions && typeof window.SWRTransitions.onBeat === 'function') {
        window.SWRTransitions.onBeat(this.feat.bpm || 0, !!beatHit);
      }
      // v2: enhanced analysis
      if (window.AudioAnalysisV2 && this.audioEl) {
        // Track recent onsets for BPM autocorrelation
        if (beatHit) this._onsetHistory = this._onsetHistory || [];
        if (beatHit) {
          this._onsetHistory.push(now);
          while (this._onsetHistory.length > 0 && this._onsetHistory[0] < now - 8) {
            this._onsetHistory.shift();
          }
          if (this._onsetHistory.length >= 6) {
            const v2bpm = window.AudioAnalysisV2.estimateBPM(this._onsetHistory);
            if (v2bpm > 0) this.feat.bpm = v2bpm;
          }
        }
        // Beat phase (assumes 4/4)
        if (this.feat.bpm > 0 && this._downbeatTime !== undefined) {
          const beatDur = 60 / this.feat.bpm;
          const barDur = beatDur * 4;
          this.feat.beatPhase = ((now - this._downbeatTime) % barDur) / barDur;
          this.feat.beatInBar = Math.floor(((now - this._downbeatTime) % barDur) / beatDur) + 1; // 1-4
        }
      }
    },
    // One-shot full analysis using audio-analysis-v2 (decode whole buffer offline)
    async analyzeFull() {
      if (!this.audioEl) return null;
      if (!this.ctx) this.unlock();
      // Need decoded buffer; decode from the audioEl's src
      const resp = await fetch(this.audioEl.src);
      const arr = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      if (!window.AudioAnalysisV2) return null;
      const result = window.AudioAnalysisV2.analyzeBuffer(buf);
      // Apply: update bpm (if better than current), set key/scale/confidence
      if (result.bpm > 0 && (this.feat.bpm === 0 || Math.abs(result.bpm - this.feat.bpm) < 3)) {
        this.feat.bpm = result.bpm;
      }
      this.feat.key = result.key;
      this.feat.scale = result.scale;
      this.feat.confidence = result.confidence;
      // Derive downbeat + beatGrid from onsets array (v2 returns onsets not beatGrid)
      const onsets = result.onsets || [];
      const downbeat = onsets.length ? onsets[0] : 0;
      const beatGrid = [];
      if (result.bpm > 0 && result.duration > 0) {
        const beatSec = 60 / result.bpm;
        let t = downbeat;
        while (t < result.duration && beatGrid.length < 1024) {
          beatGrid.push(t);
          t += beatSec;
        }
      }
      this.feat.downbeat = downbeat;
      this._downbeatTime = downbeat;
      this._beatGrid = beatGrid;
      // Update UI
      this._updateKeyPill();
      return result;
    },
    _updateKeyPill() {
      if (!this.feat.key) return;
      const k = this.feat.key;
      const s = this.feat.scale || 'major';
      const el = $('key-pill');
      if (el) {
        el.textContent = k + ' ' + s;
        el.classList.remove('major', 'minor');
        el.classList.add(s);
      }
    },
  };

  window.Audio = Audio;
})();
