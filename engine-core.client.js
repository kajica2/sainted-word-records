// engine-core.client.js
//
// Extracted from engine.html's inline <script type="module"> (was L1648-L5453,
// 3,804 lines). The body is verbatim — same helpers (clamp, lerp, fmt,
// escapeHtml, setStatus), same classes (Audio, Library, Layers, Renderer,
// Recorder, UI, CSSFX, Story, VISUAL_PRESETS, applyPreset), same boot
// sequence. The original was a <script type="module">; this is now a
// <script defer>, which means module-local declarations become global-
// script declarations. To preserve the same observable behavior, we
// wrap the body in an IIFE so internal symbols (e.g. const UI, internal
// helpers) stay module-private and the public surface (Audio, Library,
// Renderer, Recorder, UI, CSSFX, Story, VISUAL_PRESETS, applyPreset, plus
// window.setStatus / window.fmt / window.escapeHtml / window.trunc) lands
// on window.
//
// Load order in engine.html: must come AFTER lib/storage.client.js (which
// Audio._saveCurrentSong depends on) and BEFORE project.js / camera.client.js
// / engine-*.client.js / etc that read window.Audio / window.Library.

(function () {
  'use strict';

    // ======================================================================
    // SAINTED-WORD RECORDS — Algorithmic audio-reactive video engine
    // ======================================================================
    // Architecture
    //   AudioEngine   : Web Audio graph + per-frame feature extraction
    //   BeatTracker   : adaptive-threshold bass-energy beat detection
    //   OnsetTracker  : spectral-flux onset detection
    //   Library       : persistent asset store (IndexedDB) + classification
    //   AutoMapper    : assigns library assets to layers based on
    //                   motion / brightness / hue + current audio features
    //   Layer         : one slot in the composition stack
    //   Renderer      : requestAnimationFrame loop, draws layers to canvas
    //   Recorder      : canvas + audio MediaRecorder export
    // ======================================================================

    // ---------- util ----------
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    // currentFadeMs(default = 200) — reads the live "fade ms" slider from
    // the global footer (id="fade-ms") so the user can tune RE-MAP and
    // layer-add/remove transition times without re-deploying. Returns the
    // default if the slider is absent (older engine.html, before the
    // slider was added) or its value is missing/invalid. Cached at call
    // time — the engine reads it on every fade it sets up, so the user
    // sees the new duration the next time they press RE-MAP.
    function currentFadeMs(def) {
      const v = parseFloat($('fade-ms') ? $('fade-ms').value : '');
      return isFinite(v) && v > 0 ? v : (def || 200);
    }

    // ---------- DOM refs ----------
    const $ = (id) => document.getElementById(id);
    const stageCanvas = $('render');
    const stageCtx = stageCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const meterCanvas = $('meter');
    const meterCtx = meterCanvas.getContext('2d');
    const stageEmpty = $('stage-empty');
    const stageFlash = $('stage-flash');
    const libGrid = $('library-grid');
    const layerList = $('layer-list');

    // ======================================================================
    // AUDIO ENGINE
    // ======================================================================

    // Module-scope helpers — moved out of the boot IIFE so any function in
    // this module (including Audio.loadFile, Library.addFiles, etc.) can
    // call them. Previously these were defined inside the IIFE body, which
    // made them invisible to module-level code and caused
    // "setStatus is not defined" errors.
    function fmt(s) {
      if (!isFinite(s) || s < 0) s = 0;
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
    function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    // Layer property helpers — the rot slider in the per-layer panel writes
    // to l.rotOffset (the per-clip persistent tilt), not l.pos.rot (which is
    // audio-driven every frame). The final rotation is pos.rot + rotOffset.
    function readLayerProp(l, prop) {
      if (prop === 'rot') return l.rotOffset || 0;
      return l[prop];
    }
    function writeLayerProp(l, prop, value) {
      if (prop === 'rot') { l.rotOffset = value; return; }
      l[prop] = value;
    }
    function setStatus(t, cls) {
      const p = $('status-pill');
      p.textContent = t;
      p.classList.remove('ok', 'live');
      if (cls) p.classList.add(cls);
    }
    // Expose setStatus + small helpers on window so the other <script type="module">
    // files (project.js, camera.client.js, mic-input.client.js, etc.) can call
    // them. They live in separate module scopes and can't see module-level
    // declarations via the scope chain. Some of them already use the guarded
    // form `typeof setStatus === 'function' && setStatus(...)` — those still
    // work. This is a no-op for module-internal callers (which Vite renames
    // the function to `k` in the minified bundle anyway).
    window.setStatus = setStatus;
    window.fmt = fmt;
    window.escapeHtml = escapeHtml;
    window.trunc = trunc;

    const Audio = {
      ctx: null,
      analyser: null,
      source: null,
      gain: null,
      audioEl: null,
      fft: null,
      time: null,
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
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.65;
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
        if (this.source) try { this.source.disconnect(); } catch {}
        // Capture the old <audio> BEFORE we reassign this.audioEl so we
        // can fade it out under the new song. Otherwise the old element
        // is gone and the user hears an abrupt cut.
        const oldEl = this.audioEl;
        if (oldEl) {
          // Fade the old song out over 600ms (matches the "song-end"
          // tail). We don't pause() it directly — the gain ramp will
          // silence it naturally, and we can disconnect the source
          // safely after the ramp finishes.
          const fadeMs = 600;
          this.fadeOut(fadeMs).then(() => {
            try { oldEl.pause(); } catch {}
            try { oldEl.removeAttribute('src'); } catch {}
            try { oldEl.load(); } catch {}
          });
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
        // Single ended-listener that handles the fade-out + play-state
        // update. Replaces the previous bug where every loadFile() added
        // another ended-listener and an old song's `ended` event could
        // fire UI.onSongEnd() → Audio.pause() while the new song was
        // already playing (a real bug, not just an abrupt-cut issue).
        this.audioEl.addEventListener('ended', () => this.fadeOutAndPause(600));
        this.audioEl.addEventListener('timeupdate', () => UI.updateTime());
        // Mark element type so the recorder knows what to display
        this.audioEl.dataset.kind = isVideo ? 'video' : 'audio';
        this.source = this.ctx.createMediaElementSource(this.audioEl);
        this.source.connect(this.analyser);
        // If we were playing before the swap, keep playing the new song.
        // Otherwise leave the play state as the user had it. The user
        // expects "load a new song" to either swap-in-place (if playing)
        // or just sit ready (if paused).
        if (this.playing) {
          // Fade in the new song over 250ms (slightly longer than the
          // play() default — gives a sense of "settling in" after a swap).
          this.fadeIn(250);
          this.audioEl.play().catch(() => {});
        } else {
          // Start the new song at 0 gain so when the user hits play, the
          // existing fadeIn(150) ramps it up cleanly.
          this.gain.gain.value = 0;
        }
        // Render the song name with a small badge for video source
        const badge = isVideo
          ? '<span class="song-badge" title="Loaded from a video file — audio extracted in-browser">VIDEO</span> '
          : '';
        const saved = '<span class="song-badge" title="Saved to this browser — will auto-restore on next visit" style="background:#1f3;color:#0f0;">SAVED</span> ';
        $('song-name').innerHTML = saved + badge + '<b>' + escapeHtml(file.name) + '</b>';
        $('play').disabled = false;
        $('rec').disabled = false;
        const ev = $('export-video');
        if (ev) ev.disabled = false;
        this.history = { prev: null, bassAvg: 0, fluxAvg: 0 };
        this.beatTimes = [];
        this.feat.bpm = 0;
        $('bpm-pill').textContent = '— bpm';
        if (isVideo) {
          // Helpful status so the user knows what's happening (no video frame will appear)
          setStatus('loaded MP4 audio · click play', 'ok');
        }
      },
      play() {
        this.unlock();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        // Start the gain at 0, fade up to 1.0 over 150ms — removes the
        // click/pop that the previous hard-cut playback had. If the gain
        // is already mid-fade (e.g. user paused then immediately played),
        // cancelScheduledValues inside fadeTo handles the transition.
        this.fadeIn(150);
        this.audioEl.play();
        this.playing = true;
        $('play').textContent = '❚❚ Pause';
        $('play').classList.remove('primary');
        $('play').classList.add('danger');
        stageEmpty.classList.add('hidden');
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
          if (typeof setStatus === 'function') setStatus('song saved', 'ok');
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
        // Smooth fade-out so the user hears a 200ms release instead of a
        // hard cut. We pause() inside the fade so the underlying element
        // stops producing new samples during the tail.
        if (this.audioEl) {
          this.fadeOut(200).then(() => {
            if (this.audioEl) this.audioEl.pause();
          });
        }
        this.playing = false;
        $('play').textContent = '▶ Play';
        $('play').classList.add('primary');
        $('play').classList.remove('danger');
      },
      // ---- Gain envelope (fade-in / fade-out helper) ----
      // Single point of control for the master audio level. Wraps the
      // existing Web Audio GainNode with a small `fadeTo(target, ms)` API
      // that uses AudioParam linearRampToValueAtTime (with cancelScheduled
      // Values first to avoid overlapping ramps). All song transitions
      // (load / play / pause / end / promoteToSong) flow through this
      // helper, so a single tuning point controls every audible change.
      //
      // Default durations (the user-perceived "no abrupt" target):
      //   fadeIn(play)  → 150ms  (removes the click on play)
      //   fadeOut(pause)→ 200ms  (smooth on pause)
      //   fadeOut(end)  → 600ms  (gentle tail when the song ends)
      //   fadeIn(load)  → 250ms  (audio comes up under the new song)
      //   fadeOut(load) → 600ms  (old song fades before disconnect)
      //
      // `setStatus` and `UI.updateTime` are referenced as globals — they're
      // defined in the same IIFE and resolve at call time.
      fadeTo(target, ms) {
        if (!this.gain || !this.ctx) {
          // No audio context yet — fall back to a direct set. Avoids a
          // crash on the very first call (e.g. before the user clicks).
          if (this.gain) this.gain.gain.value = target;
          return Promise.resolve();
        }
        const t = this.ctx.currentTime;
        const param = this.gain.gain;
        // Cancel any in-flight ramp so back-to-back fades don't compound
        // (e.g. play() → 150ms fade-in → pause() → 200ms fade-out
        // would otherwise fight the in-flight ramp).
        try { param.cancelScheduledValues(t); } catch (_) {}
        // Clamp target to a sane range. Web Audio tolerates overshoot, but
        // the user might not appreciate a 200% gain from a buggy caller.
        const safeTarget = Math.max(0, Math.min(1.5, target));
        // If ms is 0 (or very small), snap — AudioParam ramps need
        // a non-zero duration to take effect.
        if (!ms || ms < 1) {
          param.setValueAtTime(safeTarget, t);
          return Promise.resolve();
        }
        const sec = ms / 1000;
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(safeTarget, t + sec);
        // Return a Promise that resolves when the ramp finishes. Useful
        // for callers that want to chain actions (e.g. disconnect the
        // old <audio> element after a fade-out completes).
        return new Promise((res) => setTimeout(res, ms + 16));
      },
      fadeIn(ms) { return this.fadeTo(1.0, ms || 150); },
      fadeOut(ms) { return this.fadeTo(0.0, ms || 200); },
      // When a song ends, fade out over a longer tail before pausing —
      // prevents the abrupt "track cuts at the end" feeling.
      async fadeOutAndPause(ms) {
        await this.fadeOut(ms || 600);
        if (this.audioEl) this.audioEl.pause();
        this.playing = false;
        $('play').textContent = '▶ Play';
        $('play').classList.add('primary');
        $('play').classList.remove('danger');
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
        const onsetGate = parseFloat($('beat-gate').value);
        const onsetHit = flux > this.history.fluxAvg * onsetGate && flux > 0.02;
        // ----- Beat (bass energy) -----
        this.history.bassAvg = lerp(this.history.bassAvg, this.feat.bass, 0.06);
        const beatGate = parseFloat($('beat-gate').value);
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
        const decay = parseFloat($('decay').value);
        this.feat.beat  = beatHit ? 1 : this.feat.beat * decay;
        this.feat.onset = onsetHit ? 1 : this.feat.onset * decay;
        this.feat.beatPulse  = beatHit;
        this.feat.onsetPulse = onsetHit;
        this.history.prev = Uint8Array.from(this.fft);
        $('beat-led').classList.toggle('on', beatHit);
        $('onset-led').classList.toggle('on', onsetHit);
        if (this.feat.bpm) $('bpm-pill').textContent = this.feat.bpm + ' bpm';
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

    // ======================================================================
    // LIBRARY (asset store + classification)
    // ======================================================================
    // Asset shape:
    //   { id, name, type, blob, url, w, h, duration?, motion, luma, hue, added }
    // type: 'video' | 'image'
    // motion: 0..1 (variance of pixel diffs over a short probe; videos only)
    // luma:   0..1 (mean luminance of first frame)
    // hue:    0..1 (mean hue of first frame, 0=red, 0.33=green, 0.66=blue)
    const Library = {
      items: [],          // {id, name, type, blob, url, w, h, duration, motion, luma, hue, added, thumb}
      nextId: 1,
      db: null,
      async init() {
        this.db = await openDb('sainted-word-records', 4, (db) => {
          if (!db.objectStoreNames.contains('assets')) {
            const s = db.createObjectStore('assets', { keyPath: 'id' });
            s.createIndex('added', 'added');
          }
          if (!db.objectStoreNames.contains('songs')) {
            // Single-record store for the currently-loaded song. Key is always 'current'.
            // When the user loads a new song, we overwrite 'current' so only the latest
            // survives. The blob itself is large (could be 100MB+ for an MP4 song) so we
            // keep it in IDB and not in localStorage.
            db.createObjectStore('songs', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('sets')) {
            // Installed .swr-set documents (marketplace page)
            db.createObjectStore('sets', { keyPath: 'id' });
          }
        });
        // Load existing assets
        const all = await this.db.getAll('assets');
        for (const rec of all) {
          const item = await this._fromRecord(rec);
          if (item) this.items.push(item);
        }
        // Migration: rebuild thumbs that were generated under the old
        // 120×120 canvas. We detect by reading the JPEG header — the new
        // 320×180 thumbs are noticeably larger (>3 KB typically) AND carry
        // a `_thumbW` marker. If the saved thumb is suspiciously small OR
        // missing the marker, regenerate. Catches: users with existing
        // 120×120 thumbs from before this upgrade.
        let needsRender = false;
        for (const it of this.items) {
          if (it._thumbW !== 320 || it._thumbH !== 180) {
            // Old thumb (or none) — kick a rebuild in the background.
            this._buildThumb(it);
            needsRender = true;
          }
        }
        this.render();
        if (needsRender) {
          // _buildThumb sets item.thumb synchronously for images, async
          // for videos. The render() above will repaint once the video
          // seeked events resolve.
          setStatus(`migrated ${this.items.length} thumbs to 320×180`, 'ok');
        } else {
          setStatus(this.items.length ? 'lib ' + this.items.length : 'idle', this.items.length ? 'ok' : '');
        }
      },
      // Remove a single asset with a 5-second undo window.
      //
      // UI path: user clicks the × button on a Library thumbnail. The asset
      // leaves the visible grid immediately (optimistic), persists removal
      // to IDB, and surfaces a status-bar undo affordance. If the user
      // doesn't click the undo prompt within 5 s, the underlying blob is
      // revoked and forgotten forever. If they do, the blob URL is re-issued
      // from a stored buffer and the asset is put back at the original index.
      //
      // Why optimistic + undo rather than confirm() modals: the user already
      // has a global Clear-All (which does confirm()) for the dangerous case;
      // per-item × should be one click. The 5 s window is short enough that
      // a stray click is recoverable, long enough that any deliberate click
      // has time to land.
      async removeItem(id, opts) {
        opts = opts || {};
        const idx = this.items.findIndex(i => i.id === id);
        if (idx < 0) return false;
        const it = this.items[idx];
        // Snapshot for potential undo. Buffer is cheap (we're not in the
        // hot path; the asset was just sitting on disk).
        const snapshot = { index: idx, item: it };
        // If this asset is currently used as a layer on stage, refuse quietly
        // (setStatus='err') — the user must remove the layer first. The
        // global Clear-All handles the bulk case where they accept losing refs.
        if (window.Layers && Array.isArray(window.Layers.list)) {
          const usedAsLayer = window.Layers.list.some(l => l.asset === it);
          if (usedAsLayer) {
            if (typeof setStatus === 'function') setStatus('remove it from the stage first', 'err');
            return false;
          }
        }
        // Optimistic UI removal
        this.items.splice(idx, 1);
        try { URL.revokeObjectURL(it.url); } catch {}
        if (it._el) { try { it._el.src = ''; } catch {} }
        this.render();
        // Persist removal to IDB
        if (this.db) {
          try { await this.db.delete('assets', it.id); }
          catch (e) { console.warn('remove asset', e); }
        }
        // Surface the undo prompt
        if (typeof setStatus === 'function' && !opts.skipUndo) {
          // Use the engine's status pill with a click target embedded as a
          // CSS-classed child — setStatus() in this codebase takes a string
          // (or DOM node). Build the pill inline.
          const pill = document.createElement('span');
          pill.appendChild(document.createTextNode(`removed ${it.name} · `));
          const undo = document.createElement('a');
          undo.href = '#';
          undo.textContent = 'undo';
          undo.style.cssText = 'color: var(--accent-2); text-decoration: underline; cursor: pointer; margin-left: 4px;';
          pill.appendChild(undo);
          const armed = { done: false };
          const restore = async () => {
            if (armed.done) return;
            armed.done = true;
            // Put the blob back at its original index.
            try { it.url = URL.createObjectURL(it.blob); } catch {}
            this.items.splice(Math.min(snapshot.index, this.items.length), 0, it);
            if (this.db) {
              try { await this.db.put('assets', {
                id: it.id, name: it.name, type: it.type, blob: it.blob,
                added: it.added, motion: it.motion, luma: it.luma, hue: it.hue,
                w: it.w, h: it.h, duration: it.duration || 0, rotation: it.rotation || 0,
              }); } catch (e) { console.warn('undo save', e); }
            }
            this.render();
            this._buildThumb(it);
          };
          undo.addEventListener('click', (ev) => {
            ev.preventDefault();
            restore().then(() => {
              if (typeof setStatus === 'function') setStatus(`restored ${it.name}`, 'ok');
            });
          });
          if (typeof setStatus === 'function') setStatus(pill, 'ok');
          // After 5 s the unguarded path finalizes the removal (blob URL is
          // already revoked; the asset is already gone from IDB; nothing to do
          // except clear `armed` so an undo arriving in the post-window race
          // doesn't re-add a stale item).
          setTimeout(() => { armed.done = true; }, 5000);
        }
        return true;
      },

      // Wipe everything: library assets + saved song. Used by the Clear All
      // button (with a confirm() prompt — the per-item × button on each
      // thumbnail has its own optimistic-delete + 5s undo flow and does not
      // ask for confirmation). After this, both the on-screen library and the
      // IndexedDB 'songs'/'assets' stores are empty, and the song-name pill
      // goes back to "no song".
      async clearAll() {
        // 1. In-memory items + their blob URLs
        for (const it of this.items) {
          try { URL.revokeObjectURL(it.url); } catch {}
        }
        this.items = [];
        // NOTE: we intentionally do NOT reset the swr-manifest-loaded flag here.
        // Once the demo library has been seeded, the user has seen it — Clear
        // means "wipe everything I uploaded and remember nothing", not "reset
        // the engine to factory state". To re-seed the demo library the user
        // would have to clear localStorage manually.
        // 2. IndexedDB 'assets' store (the wrapper exposes clear())
        if (this.db) {
          try { await this.db.clear('assets'); } catch (e) { console.warn('clear assets', e); }
        }
        // 3. Saved song
        if (window.Audio) await window.Audio._clearCurrentSong();
        // 4. UI
        this.render();
        const sn = document.getElementById('song-name');
        if (sn) sn.innerHTML = '<i style="opacity:.5">no song</i>';
        const play = document.getElementById('play');
        if (play) { play.disabled = true; play.textContent = '▶ Play'; play.classList.add('primary'); play.classList.remove('danger'); }
        const rec = document.getElementById('rec');
        if (rec) rec.disabled = true;
        if (window.Audio) { window.Audio.pause(); window.Audio.audioEl = null; window.Audio.source = null; }
        if (typeof setStatus === 'function') setStatus('cleared', 'ok');
      },
      async addFiles(files) {
        setStatus('importing…', '');
        const arr = Array.from(files);
        const knownKeys = new Set(this.items.map(i => i.name + ':' + (i.blob ? i.blob.size : 0)));
        for (const f of arr) {
          if (!f.type) continue;
          const isVid = f.type.startsWith('video/');
          const isImg = f.type.startsWith('image/');
          if (!isVid && !isImg) continue;
          // Dedupe by name+size
          const key = f.name + ':' + f.size;
          if (knownKeys.has(key)) continue;
          knownKeys.add(key);
          const id = this.nextId++;
          const item = {
            id,
            name: f.name,
            type: isVid ? 'video' : 'image',
            blob: f,
            url: URL.createObjectURL(f),
            added: Date.now(),
            thumb: null,
            motion: 0, luma: 0.5, hue: 0, w: 0, h: 0, duration: 0,
            rotation: 0,   // overridden by _detectRotation() once metadata loads
          };
          this.items.push(item);
          this.render();
          // Build thumb + classify in background
          this._buildThumb(item);
          this._classify(item).then(() => {
            this._save(item);
            this.render();
          }).catch(err => console.warn('classify', item.name, err));
        }
        setStatus('lib ' + this.items.length, 'ok');
      },
      async _save(item) {
        if (!this.db) return;
        const rec = {
          id: item.id, name: item.name, type: item.type,
          blob: item.blob, added: item.added,
          motion: item.motion, luma: item.luma, hue: item.hue,
          w: item.w, h: item.h, duration: item.duration || 0,
          rotation: item.rotation || 0,   // 0/90/180/270 — user-set asset orientation override
        };
        await this.db.put('assets', rec);
      },
      async _fromRecord(rec) {
        try {
          const item = {
            id: rec.id, name: rec.name, type: rec.type,
            blob: rec.blob, added: rec.added,
            url: URL.createObjectURL(rec.blob),
            thumb: null,
            motion: rec.motion, luma: rec.luma, hue: rec.hue,
            w: rec.w, h: rec.h, duration: rec.duration || 0,
            rotation: rec.rotation || 0,
          };
          // Build thumb
          this._buildThumb(item);
          return item;
        } catch (e) { console.warn(e); return null; }
      },
      _buildThumb(item) {
        // 16:9 thumbnail, 320×180 — enough resolution for the library
        // grid and the layer chip, and matches the stage aspect so the
        // video preview reads as a real frame instead of a square crop.
        const w = 320, h = 180;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const cx = c.getContext('2d');
        const onThumb = () => {
          if (typeof Layers !== 'undefined') Layers.render();
        };
        // drawRotated: writes `src` into `cx` fitting the 320×180 canvas
        // with object-fit:cover semantics (the source is centered, scaled
        // to fill, and any excess is cropped). Pre-rotates by `deg`
        // (0/90/180/270) using the tkhd/EXIF value. Same approach for
        // thumbs and stage draw.
        const drawRotated = (src, deg) => {
          cx.save();
          cx.clearRect(0, 0, w, h);
          // Black background so a letterbox/pillarbox read on transparent
          // sources looks intentional.
          cx.fillStyle = '#000';
          cx.fillRect(0, 0, w, h);
          if (!deg) {
            // Cover-fit: scale to fill, crop the overflow
            const sw = src.videoWidth || src.naturalWidth || w;
            const sh = src.videoHeight || src.naturalHeight || h;
            const sRatio = sw / sh;
            const dRatio = w / h;
            let dw, dh, dx, dy;
            if (sRatio > dRatio) {
              // source is wider — fit by height
              dh = h;
              dw = h * sRatio;
              dx = (w - dw) / 2;
              dy = 0;
            } else {
              dw = w;
              dh = w / sRatio;
              dx = 0;
              dy = (h - dh) / 2;
            }
            cx.drawImage(src, dx, dy, dw, dh);
          } else {
            // Rotated 90/270: source has swapped aspect. We still cover-fit
            // the rotated frame into the 320×180 canvas.
            const swap = (deg === 90 || deg === 270);
            const sW = swap ? (src.videoHeight || src.naturalHeight || h) : (src.videoWidth || src.naturalWidth || w);
            const sH = swap ? (src.videoWidth || src.naturalWidth || w) : (src.videoHeight || src.naturalHeight || h);
            const sRatio = sW / sH;
            const dRatio = w / h;
            let dw, dh, dx, dy;
            if (sRatio > dRatio) {
              dh = h; dw = h * sRatio; dx = (w - dw) / 2; dy = 0;
            } else {
              dw = w; dh = w / sRatio; dx = 0; dy = (h - dh) / 2;
            }
            cx.translate(cx.canvas.width / 2, cx.canvas.height / 2);
            cx.rotate(deg * Math.PI / 180);
            cx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
          }
          cx.restore();
        };
        if (item.type === 'video') {
          const v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.preload = 'metadata';
          v.src = item.url;
          v.addEventListener('loadedmetadata', () => {
            // Seek to t=1s, or 10% into the clip if it's shorter than 10s.
            // Capturing at 1s is the user's spec — it's far enough into the
            // clip that the first frame isn't a black screen or title card,
            // but early enough that the video has barely started.
            const seekT = Math.min(1.0, (v.duration || 1) * 0.1);
            try { v.currentTime = seekT; } catch {}
          });
          v.addEventListener('seeked', () => {
            try {
              item.w = v.videoWidth; item.h = v.videoHeight;
              item.duration = v.duration;
              drawRotated(v, item.rotation || 0);
              // Slightly higher JPEG quality (0.82) for the larger canvas —
              // data URLs inflate fast at high quality, so this is the
              // balance point that keeps storage reasonable without
              // obvious macroblocking at 320×180.
              item.thumb = c.toDataURL('image/jpeg', 0.82);
              item._thumbW = w; item._thumbH = h;
              this.render();
              onThumb();
            } catch {}
          });
          // Detect tkhd rotation if we haven't already (one-shot, lazy).
          if (!item.rotationProbeDone) {
            item.rotationProbeDone = true;
            detectMp4Rotation(item.blob).then(deg => {
              if (deg && !item.rotationUserSet) {
                item.rotation = deg;
                // Re-render thumb + save to IDB once the seeked event has run.
                // (If thumb is already built, we just re-mark it dirty.)
                item.thumb = null;
                this._buildThumb(item);
                // _save runs after _classify; if rotation was discovered after classification,
                // persist explicitly.
                if (item.id) this._save(item).catch(() => {});
              }
            }).catch(() => {});
          }
        } else {
          const img = new Image();
          img.onload = () => {
            item.w = img.naturalWidth; item.h = img.naturalHeight;
            drawRotated(img, item.rotation || 0);
            item.thumb = c.toDataURL('image/jpeg', 0.82);
            item._thumbW = w; item._thumbH = h;
            this.render();
            onThumb();
            // Detect EXIF orientation for JPEGs (very common on phone photos).
            if (item.type === 'image' && !item.rotationProbeDone) {
              item.rotationProbeDone = true;
              detectImageOrientation(item.blob).then(deg => {
                if (deg && !item.rotationUserSet) {
                  item.rotation = deg;
                  item.thumb = null;
                  this._buildThumb(item);
                  if (item.id) this._save(item).catch(() => {});
                }
              }).catch(() => {});
            }
          };
          img.src = item.url;
        }
      },
      async _classify(item) {
        // Probe 4 frames (video) or 1 frame (image), sample to 32x32 grayscale
        const w = 32, h = 32;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const cx = c.getContext('2d', { willReadFrequently: true });
        const samples = [];
        let lumaSum = 0, hueSum = 0;
        const tryGet = (source, t) => new Promise(res => {
          if (item.type === 'video') {
            source.currentTime = t;
            source.addEventListener('seeked', () => {
              cx.drawImage(source, 0, 0, w, h);
              const d = cx.getImageData(0, 0, w, h).data;
              const luma = sampleLuma(d);
              const hue = sampleHue(d);
              samples.push(luma);
              lumaSum += luma; hueSum += hue;
              res();
            }, { once: true });
          } else {
            cx.drawImage(source, 0, 0, w, h);
            const d = cx.getImageData(0, 0, w, h).data;
            lumaSum += sampleLuma(d);
            hueSum += sampleHue(d);
            res();
          }
        });
        const source = item.type === 'video'
          ? Object.assign(document.createElement('video'), { src: item.url, muted: true, playsInline: true, crossOrigin: 'anonymous', preload: 'metadata' })
          : Object.assign(new Image(), { src: item.url });
        await new Promise(res => {
          if (source.readyState >= 2) res();
          else source.addEventListener(source.tagName === 'VIDEO' ? 'loadeddata' : 'load', res, { once: true });
        });
        if (item.type === 'video') {
          const dur = source.duration || 0;
          item.duration = dur;
          for (const t of [0.05, 0.3, 0.55, 0.8].map(f => f * dur)) {
            try { await tryGet(source, Math.min(t, Math.max(0, dur - 0.05))); } catch {}
          }
          if (samples.length >= 2) {
            let v = 0;
            for (let i = 1; i < samples.length; i++) v += Math.abs(samples[i] - samples[i-1]);
            item.motion = clamp(v / (samples.length - 1) * 4, 0, 1);
          }
        } else {
          await tryGet(source, 0);
        }
        item.luma = clamp(lumaSum, 0, 1);
        item.hue = ((hueSum % 1) + 1) % 1;
      },
      render() {
        if (!this.items.length) {
          libGrid.innerHTML = '<div class="lib-empty">Drop videos, GIFs, or images<br/>anywhere on the page</div>';
          return;
        }
        const frag = document.createDocumentFragment();
        for (const it of this.items) {
          const d = document.createElement('div');
          d.className = 'lib-item';
          d.draggable = true;
          d.dataset.id = it.id;
          const tag = it.type === 'video' ? 'VID' :
                   it.type === 'camera' ? 'CAM' :
                   (it.name.toLowerCase().endsWith('.gif') ? 'GIF' : 'IMG');
          // Video items get a "use as song" button so users can promote a
          // library clip to the audio source. Other types just get the tag + name.
          const songBtn = (it.type === 'video')
            ? '<button class="lib-use-as-song" title="Use this clip as the song (audio only)">♪</button>'
            : '';
          // Rotate-the-asset button. This is the (orthogonal) "fix sideways"
          // control — the per-layer `↻ ROT` button tilts the layer on stage.
          // The asset rotation persists in IDB and shows the rotation badge.
          const rotBadge = it.rotation ? `<span class="lib-rot-badge">${it.rotation}°</span>` : '';
          const rotBtn = '<button class="lib-rot" title="Rotate this asset 90° clockwise">↻</button>';
          // Per-asset remove (top-right ×). Distinct from the global Clear
          // All button — this deletes one item, with a 5s undo window via
          // the existing setStatus() helper. Hover-revealed to keep the
          // card clean; always-visible on touch devices (see CSS).
          const delBtn = '<button class="lib-del" aria-label="Remove this asset" title="Remove this asset (5s undo via status bar)">×</button>';
          d.innerHTML = `
            <span class="tag">${tag}</span>
            <span class="name">${escapeHtml(it.name)}</span>
            ${rotBadge}
            ${rotBtn}
            ${delBtn}
            ${songBtn}
          `;
          if (it.thumb) {
            const img = new Image();
            img.src = it.thumb;
            d.appendChild(img);
          } else if (it.type === 'video') {
            const v = document.createElement('video');
            v.src = it.url; v.muted = true; v.playsInline = true;
            d.appendChild(v);
          } else {
            const img = new Image();
            img.src = it.url;
            d.appendChild(img);
          }
          d.addEventListener('click', (e) => {
            // If the user clicked the "use as song" button, route there instead
            // of adding a layer. (Stop event from bubbling to the layer handler.)
            if (e.target && e.target.classList && e.target.classList.contains('lib-use-as-song')) {
              e.stopPropagation();
              Library.promoteToSong(it);
              return;
            }
            // Asset rotate: flips through 0/90/180/270, marks user-set so the
            // EXIF/tkhd auto-detect won't clobber it, rebuilds the thumb, and
            // persists to IDB. Sideways-phone clips → click ↻ until right-side up.
            if (e.target && e.target.classList && e.target.classList.contains('lib-rot')) {
              e.stopPropagation();
              it.rotation = (((it.rotation || 0) + 90) % 360);
              it.rotationUserSet = true;          // protect from detection clobber
              it.thumb = null;
              it._rotated = null;                // invalidate stage cache too
              this._buildThumb(it);
              this._save(it).catch(() => {});
              if (typeof setStatus === 'function') setStatus(`${it.name}: ${it.rotation}°`, 'ok');
              return;
            }
            // Per-asset × (top-right). One-click optimistic delete with a 5s
            // undo window surfaced via setStatus — see Library.removeItem for
            // the IDB + layer-ref safety details. Refuses (toast=err) if the
            // asset is currently a layer on stage; user removes the layer first.
            if (e.target && e.target.classList && e.target.classList.contains('lib-del')) {
              e.stopPropagation();
              e.preventDefault();
              this.removeItem(it.id);
              return;
            }
            // Add a new layer using this asset
            Layers.add(it);
          });
          d.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/sainted-id', String(it.id));
            e.dataTransfer.effectAllowed = 'copy';
          });
          frag.appendChild(d);
        }
        libGrid.innerHTML = '';
        libGrid.appendChild(frag);
      },
      byId(id) { return this.items.find(i => i.id === id); },
      // List every already-known asset name (used to detect new ones in folder)
      knownNames() { return new Set(this.items.map(i => i.name)); },
      // Promote a library video item to the song slot. Re-fetches the blob from
      // the (object URL) source so the Audio module can decode it the same way
      // it would any user-picked file.
      async promoteToSong(item) {
        if (!item) return;
        try {
          const resp = await fetch(item.url);
          if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
          const blob = await resp.blob();
          const file = new File([blob], item.name, { type: blob.type || 'video/mp4' });
          Audio.loadFile(file);
          setStatus(`♪ ${item.name} loaded as song`, 'ok');
        } catch (e) {
          setStatus('could not load as song: ' + (e.message || e), 'err');
        }
      },
    };

    // ------------------------------------------------------------------
    // Orientation detection — used to auto-rotate videos / images whose
    // display orientation is encoded in the file metadata (phone-recorded
    // portrait clips ship sideways without it). The rotate button in the
    // library overrides the detected value with a user-chosen 0/90/180/270.
    // ------------------------------------------------------------------

    // Walk an MP4 / MOV box tree. Yields every box whose type is `name`.
    // Returns nothing; calls cb(boxStart, boxSize) for each match.
    async function _walkMp4Boxes(blob, name, cb, _opts) {
      // Read up to 16 MiB — enough for tkhd in the moov.trak.tkhd location
      // for any reasonable file. Larger uploads fall back to "0 deg".
      const MAX = 16 * 1024 * 1024;
      const size = Math.min(blob.size, MAX);
      const buf = await blob.slice(0, size).arrayBuffer();
      const dv = new DataView(buf);
      const dec = new TextDecoder('latin1');
      const parse = (off, end) => {
        let p = off;
        while (p + 8 <= end) {
          let boxSize = dv.getUint32(p);
          const type = dec.decode(buf.slice(p + 4, p + 8));
          if (boxSize === 0) return;          // box extends to EOF
          if (boxSize === 1 && p + 16 <= end) { // 64-bit largesize
            const hi = dv.getUint32(p + 8), lo = dv.getUint32(p + 12);
            boxSize = hi * 0x100000000 + lo;
          }
          if (type === name) cb(p, boxSize, dv);
          // Recurse into container boxes (moov, trak, mdia, minf, stbl, edts, udta).
          const containers = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'];
          if (containers.indexOf(type) >= 0 && boxSize > 8 && p + boxSize <= end) {
            parse(p + 8, p + boxSize);
          }
          if (boxSize < 8) return;
          p += boxSize;
        }
      };
      parse(0, dv.byteLength);
    }

    // Read the QuickTime display matrix out of the first 'tkhd' box.
    // The matrix is 36 bytes of signed 16.16 fixed-point at content offset 36.
    // Returns 0/90/180/270 clockwise as the user would see when played.
    async function detectMp4Rotation(blob) {
      if (!blob) return 0;
      try {
        return await new Promise(resolve => {
          let found = 0;
          _walkMp4Boxes(blob, 'tkhd', (off, size, dv) => {
            if (found) return;
            found = 1;
            // tkhd layout (QuickTime / ISO-BMFF, version 0):
            //   version(1) flags(3) creation(4) modification(4)
            //   track_id(4) reserved(4) duration(4) reserved(8)
            //   layer(2) alternate_group(2) volume(2) reserved(2)
            //   matrix(36) width(4) height(4)
            // That's 40 bytes of header before the matrix.
            // We also account for the 8-byte box header (size + 'tkhd') passed
            // in `off` (which points at the start of the size field).
            const m = off + 8 + 40;
            if (size < 48 + 36) return;
            const a = dv.getInt32(m + 0) / 65536;   // matrix[0][0]
            const b = dv.getInt32(m + 4) / 65536;   // matrix[1][0]
            if (!isFinite(a) || !isFinite(b)) return;
            // For a pure 2D screen transform, the rotation θ satisfies
            // matrix[0][0] = a = cos θ, matrix[1][0] = b = sin θ (CW positive).
            const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI / 90) * 90;
            const norm = ((deg % 360) + 360) % 360;
            resolve(norm);
          });
          // If we never hit a tkhd (rare), resolve 0 after the file is scanned.
          setTimeout(() => { if (!found) resolve(0); }, 50);
        });
      } catch {
        return 0;
      }
    }

    // Minimal EXIF orientation reader for JPEGs. We only need the IFD0
    // orientation tag (0x0112). Returns 0/90/180/270.
    function detectImageOrientation(blob) {
      return new Promise(resolve => {
        if (!blob || blob.type !== 'image/jpeg') return resolve(0);
        // Node and very-old browsers won't have FileReader; treat that as "no EXIF".
        if (typeof FileReader === 'undefined') return resolve(0);
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const dv = new DataView(reader.result);
            if (dv.getUint16(0) !== 0xFFD8) return resolve(0); // not JPEG
            let p = 2;
            while (p < dv.byteLength) {
              const markerSize = dv.getUint16(p + 2);
              if (dv.getUint16(p) === 0xFFE1) { // APP1 (EXIF)
                // EXIF starts with "Exif\0\0" then 'MM' (big) or 'II' (little).
                const tiff = p + 4 + 6;
                const little = dv.getUint16(tiff) === 0x4949;
                const get16 = o => dv.getUint16(o + (little ? 0 : 0), little);
                const get32 = o => dv.getUint32(o + (little ? 0 : 0), little);
                if (get16(tiff) === 0x002A) {
                  const ifd0 = tiff + get32(tiff + 4);
                  const entries = get16(ifd0);
                  for (let i = 0; i < entries; i++) {
                    const ent = ifd0 + 2 + i * 12;
                    if (get16(ent) === 0x0112) {
                      // orientation is a SHORT in the value field (first 2 bytes).
                      const raw = get16(ent + 8);
                      const map = { 1: 0, 3: 180, 6: 90, 8: 270 };
                      return resolve(map[raw] || 0);
                    }
                  }
                }
              }
              p += 2 + markerSize;
            }
            return resolve(0);
          } catch { return resolve(0); }
        };
        reader.onerror = () => resolve(0);
        // Only read first 64 KiB — EXIF is always in the first segment.
        reader.readAsArrayBuffer(blob.slice(0, 65536));
      });
    }

    function sampleLuma(data) {
      let s = 0;
      for (let i = 0; i < data.length; i += 4) {
        s += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      }
      return (s / (data.length / 4)) / 255;
    }
    function sampleHue(data) {
      // simple average hue using atan2
      let sx = 0, sy = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx === mn) continue;
        const d = mx - mn;
        let h = 0;
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
        const a = Math.cos(h * Math.PI * 2);
        const b2 = Math.sin(h * Math.PI * 2);
        sx += a; sy += b2;
      }
      const n = data.length / 4;
      return (Math.atan2(sy / n, sx / n) / (Math.PI * 2) + 1) % 1;
    }

    // Tiny IndexedDB wrapper
    function openDb(name, ver, upgrade) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, ver);
        req.onupgradeneeded = (e) => upgrade(e.target.result);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const api = {
            getAll: (store) => new Promise((r, rj) => {
              const t = db.transaction(store, 'readonly').objectStore(store).getAll();
              t.onsuccess = () => r(t.result);
              t.onerror = () => rj(t.error);
            }),
            put: (store, val) => new Promise((r, rj) => {
              const t = db.transaction(store, 'readwrite').objectStore(store).put(val);
              t.onsuccess = () => r();
              t.onerror = () => rj(t.error);
            }),
            delete: (store, key) => new Promise((r, rj) => {
              const t = db.transaction(store, 'readwrite').objectStore(store).delete(key);
              t.onsuccess = () => r();
              t.onerror = () => rj(t.error);
            }),
            clear: (store) => new Promise((r, rj) => {
              const t = db.transaction(store, 'readwrite').objectStore(store).clear();
              t.onsuccess = () => r();
              t.onerror = () => rj(t.error);
            }),
          };
          resolve(api);
        };
        req.onerror = () => reject(req.error);
      });
    }

    // ======================================================================
    // LAYERS
    // ======================================================================
    // Layer shape:
    //   {
    //     id, asset, blend, opacity, baseScale, hue, brightness,
    //     reactors: [{feature, target, scale, easing}],  // e.g. bass->scale
    //     pos: {x, y, rot},  // base position
    //     z: int
    //   }
    const Layers = {
      list: [],
      selected: null,
      elCache: new Map(),
      add(asset) {
        const z = this.list.length;
        const layer = {
          id: 'L' + (this.list.length + 1),
          asset,
          blend: pickBlend(this.list.length),
          opacity: 1,
          baseScale: pickScale(this.list.length, asset),
          hue: 0,
          brightness: 1,
          contrast: 1,
          pos: { x: 0, y: 0, rot: 0 },
          rotOffset: 0,         // per-clip persistent tilt (added on top of pos.rot)
          rotationEnabled: true, // gate BOTH manual rot + audio rot reactors; undefined = enabled
          z,
          reactors: pickReactors(this.list.length, asset, Audio.feat),
          snapBeat: false,
        };
        this.list.push(layer);
        // Fade the new layer in over 200ms instead of popping in at
        // full opacity. The tickFades() loop in the renderer will animate
        // it up; drawLayer() honors _fadeState over the reactor's opacity
        // output for the duration of the fade.
        this.fadeIn(layer, currentFadeMs(200));
        this.render();
        this.select(layer);
        if (this.list.length === 1) stageEmpty.classList.add('hidden');
      },
      // Fade a layer's opacity in or out. Internally sets up a
      // _fadeState that Renderer.tickFades() advances each frame, and
      // drawLayer() reads to override the reactor's opacity output.
      // Multiple fades compose naturally: calling fadeIn(200) on a
      // layer that's mid-fadeOut will start a fresh fade from the
      // current opacity to 1.0 (the fromOpacity is read from
      // _fadeState.currentOpacity if present, else layer.opacity).
      //
      // `onComplete` fires when the fade ends. RE-MAP uses this to
      // remove old layers from Layers.list once they've faded out.
      fadeIn(layer, ms, target) {
        if (!layer) return;
        const cur = (layer._fadeState && layer._fadeState.currentOpacity != null)
          ? layer._fadeState.currentOpacity
          : (layer.opacity != null ? layer.opacity : 1);
        layer._fadeState = {
          startedAt: performance.now(),
          durationMs: ms || 200,
          fromOpacity: cur,
          toOpacity: target != null ? target : 1,
          currentOpacity: cur,
          onComplete: null,
        };
      },
      fadeOut(layer, ms) {
        if (!layer) return;
        const cur = (layer._fadeState && layer._fadeState.currentOpacity != null)
          ? layer._fadeState.currentOpacity
          : (layer.opacity != null ? layer.opacity : 1);
        layer._fadeState = {
          startedAt: performance.now(),
          durationMs: ms || 200,
          fromOpacity: cur,
          toOpacity: 0,
          currentOpacity: cur,
          onComplete: null,
        };
      },
      remove(id) {
        const i = this.list.findIndex(l => l.id === id);
        if (i < 0) return;
        const layer = this.list[i];
        // === Phase 4: fade-out before splice ===
        // Splicing immediately pops the layer out of the visual. Instead,
        // set a fade-out state and let tickFades() drive the opacity to
        // 0 over 200ms. The onComplete callback removes the layer from
        // this.list when the fade finishes. Same pattern as the autoMap
        // cross-fade in Phase 2 — keeps the visible transition smooth.
        const self = this;
        layer._fadeState = layer._fadeState || {};
        layer._fadeState.startedAt = performance.now();
        layer._fadeState.durationMs = currentFadeMs(200);
        layer._fadeState.fromOpacity = (layer._fadeState.currentOpacity != null)
          ? layer._fadeState.currentOpacity
          : (layer.opacity != null ? layer.opacity : 1);
        layer._fadeState.toOpacity = 0;
        layer._fadeState.currentOpacity = layer._fadeState.fromOpacity;
        layer._fadeState.onComplete = function () {
          const i2 = self.list.findIndex((l) => l.id === id);
          if (i2 >= 0) self.list.splice(i2, 1);
          if (self.selected && self.selected.id === id) self.selected = self.list[0] || null;
          self.render();
          if (self.list.length === 0) stageEmpty.classList.remove('hidden');
        };
      },
      select(layer) {
        this.selected = layer;
        for (const el of this.elCache.values()) el.classList.remove('selected');
        const e = this.elCache.get(layer.id);
        if (e) e.classList.add('selected');
        const rotBtn = $('rotate-sel');
        if (rotBtn) {
          rotBtn.disabled = !layer;
          rotBtn.style.opacity = layer ? '1' : '0.4';
          rotBtn.style.cursor = layer ? 'pointer' : 'not-allowed';
        }
      },
      updateSelected(patch) {
        if (!this.selected) return;
        Object.assign(this.selected, patch);
        this.render();
      },
      render() {
        const frag = document.createDocumentFragment();
        this.elCache.clear();
        for (let i = 0; i < this.list.length; i++) {
          const l = this.list[i];
          const el = document.createElement('div');
          el.className = 'layer' + (this.selected === l ? ' selected' : '');
          el.dataset.id = l.id;
          const reactors = l.reactors.map(r =>
            `${r.feature}→${r.target}×${r.scale.toFixed(2)}`
          ).join(' · ') || '—';
          el.innerHTML = `
            <div class="layer-head">
              <span class="num">${i + 1}</span>
              <span class="thumb">${l.asset ? '' : '∅'}</span>
              <span class="name">${l.asset ? escapeHtml(trunc(l.asset.name, 18)) : '(empty)'}</span>
              <span class="layer-audio-pill" title="All layers share the loaded song (one audio source drives every reactor)">♪ shared</span>
              <button class="x-rot clip" title="Rotate this clip +90° (or press R)" aria-label="Rotate clip 90°">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                  <path d="M2.5 8a5.5 5.5 0 0 1 9.39-3.89L13.5 5.5"/>
                  <path d="M13.5 2.5v3h-3"/>
                  <path d="M13.5 8a5.5 5.5 0 0 1-9.39 3.89L2.5 10.5"/>
                  <path d="M2.5 13.5v-3h3"/>
                </svg>
              </button>
              <button class="x-rand" title="Randomise pos / rot / scale / blend">🎲</button>
              <button class="x-beat" title="Snap to beat (BPM-locked)">⌐</button>
              <button class="x" title="remove">×</button>
            </div>
            <div class="layer-row">
              <label>react</label>
              <span style="font-family:var(--font-mono);font-size:9px;color:var(--accent-2);">${reactors}</span>${l.rotationEnabled === false ? ' <span class="rot-off-tag" title="ROTATE toggle is off — rot-target reactors are silenced">[rot off]</span>' : ''}
            </div>
            <div class="layer-row">
              <label>blend</label>
              <select data-prop="blend">
                <option value="source-over">over</option>
                <option value="screen">screen</option>
                <option value="multiply">multiply</option>
                <option value="lighter">add</option>
                <option value="difference">diff</option>
                <option value="overlay">overlay</option>
                <option value="soft-light">soft</option>
              </select>
            </div>
            <div class="layer-row">
              <label>opacity</label>
              <input type="range" data-prop="opacity" min="0" max="1" step="0.01" />
            </div>
            <div class="layer-row">
              <label>base scale</label>
              <input type="range" data-prop="baseScale" min="0.1" max="3" step="0.01" />
            </div>
            <div class="layer-row">
              <label>hue</label>
              <input type="range" data-prop="hue" min="-180" max="180" step="1" />
            </div>
            <div class="layer-row">
              <label>rot</label>
              <input type="range" data-prop="rot" min="-180" max="180" step="1" />
              <b class="rot-v" style="font-family:var(--font-mono);font-size:9px;color:var(--accent);min-width:30px;text-align:right;margin-left:4px;">0°</b>
            </div>
            <div class="layer-row layer-row-toggle">
              <label title="Gate ALL rotation on this layer (manual slider + audio reactors)">rotate</label>
              <input type="checkbox" data-prop="rotationEnabled" class="rot-enable-toggle" title="On = manual rot + audio rot reactors apply. Off = rotation is suppressed entirely." />
            </div>
          `;
          const sel = el.querySelector('select[data-prop="blend"]');
          sel.value = l.blend;
          for (const r of el.querySelectorAll('input[type=range]')) {
            r.value = readLayerProp(l, r.dataset.prop);
          }
          const rotEnable = el.querySelector('input.rot-enable-toggle');
          if (rotEnable) rotEnable.checked = l.rotationEnabled !== false;
          const rotV = el.querySelector('.rot-v');
          if (rotV) {
            const off = l.rotationEnabled === false;
            rotV.textContent = `${Math.round(l.rotOffset || 0)}°${off ? ' (held)' : ''}`;
            rotV.style.opacity = off ? '0.45' : '1';
          }
          if (l.asset && l.asset.thumb) {
            const img = new Image();
            img.src = l.asset.thumb;
            el.querySelector('.thumb').appendChild(img);
          }
          el.addEventListener('click', (e) => {
            if (e.target.classList.contains('x')) { this.remove(l.id); return; }
            if (e.target.classList.contains('x-rot')) {
              // Shift+click = -90° (counter-clockwise), plain click = +90°
              // Mutates the per-clip offset so the user's tilt survives audio drift
              l.rotOffset = (l.rotOffset + (e.shiftKey ? -90 : 90) + 360) % 360;
              // Update the slider + readout in the same layer card
              const rotSlider = el.querySelector('input[data-prop="rot"]');
              const rotV = el.querySelector('.rot-v');
              if (rotSlider) rotSlider.value = l.rotOffset;
              if (rotV) rotV.textContent = `${Math.round(l.rotOffset)}°`;
              e.stopPropagation();
              return;
            }
            if (e.target.classList.contains('x-rand')) {
              l.pos.x = (Math.random() - 0.5) * 200;
              l.pos.y = (Math.random() - 0.5) * 200;
              l.pos.rot = Math.random() * 360;
              l.baseScale = 0.4 + Math.random() * 1.4;
              const blends = ['source-over','screen','multiply','lighter','difference','overlay','soft-light'];
              l.blend = blends[Math.floor(Math.random() * blends.length)];
              e.stopPropagation();
              return;
            }
            if (e.target.classList.contains('x-beat')) {
              l.snapBeat = !l.snapBeat;
              e.target.classList.toggle('active', l.snapBeat);
              e.stopPropagation();
              return;
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            this.select(l);
          });
          sel.addEventListener('change', () => { l.blend = sel.value; });
          for (const r of el.querySelectorAll('input[type=range]')) {
            r.addEventListener('input', () => {
              writeLayerProp(l, r.dataset.prop, parseFloat(r.value));
              if (r.dataset.prop === 'rot' && rotV) rotV.textContent = `${Math.round(r.value)}°${l.rotationEnabled === false ? ' (held)' : ''}`;
            });
          }
          // ROTATE checkbox — toggles the layer-wide gate for both manual
          // rot and audio rot reactors. Re-render so the [rot off] hint,
          // the rot readout state, and the slider styling update at once.
          const rotEnableCb = el.querySelector('input.rot-enable-toggle');
          if (rotEnableCb) {
            rotEnableCb.addEventListener('change', () => {
              l.rotationEnabled = rotEnableCb.checked;
              this.render();
            });
          }
          this.elCache.set(l.id, el);
          frag.appendChild(el);
        }
        layerList.innerHTML = '';
        layerList.appendChild(frag);
      },
      // Auto-remap: algorithmically assign assets to layers by classification
      // relative to current audio features.
      autoMap() {
        return this.autoMapLayer(-1);  // -1 = all layers
      },
      // Per-layer remap (Phase 3 / H4). index = -1 (default) reworks every
      // layer; index = 0..5 swaps just that slot. The "swapped" layers fade
      // in via the standard cross-fade; the untouched ones stay put.
      // `autoMapLayer(-1)` is the original "RE-MAP everything" path.
      // Last-used-asset memory: a sliding window of 8 ids, so two RE-MAPs
      // in a row don't pick the same top-3. Reset when the library changes
      // (Library._lastUsedAssets) so a fresh upload doesn't get penalized
      // by stale state.
      autoMapLayer(index) {
        // === H2: RE-MAP undo (Phase 3 follow-up) ===
        // Wrap the entire remap in genops withHistory so the user can
        // undo a bad remap with Ctrl+Z. If genops is not loaded
        // (engine.html loads it before engine-core, so this is a safety
        // net only), the noop fallback runs the remap without history.
        const __withHist = (window.SWR_GENOPS && window.SWR_GENOPS.withHistory);
        if (__withHist) {
          __withHist('remap', () => {

        if (!Library.items.length) {
          setStatus('lib empty', 'warn');
          return;
        }
        const mode = $('mode').value;
        const sens = parseFloat($('sensitivity').value);
        const f = Audio.feat;
        // === Phase 3 / H3: audio-driven mode bias ===
        // The user's chosen mode is a strong default, but a 90 BPM slow
        // ballad deserves different asset picks than a 140 BPM house
        // track. We bias the topN + a hue/saturation weight without
        // overriding the user's choice — auto → 'pulse' for fast BPM,
        // 'ambient' for slow; chaos is chaos; pulse/pulse stay pulse.
        const bpm = f.bpm || 0;
        const isFast = bpm > 110;
        const isSlow = bpm > 0 && bpm < 80;
        let effectiveMode = mode;
        let effectiveTopN = { auto: 2, chaos: 4, pulse: 1, ambient: 1 }[mode] || 2;
        if (mode === 'auto') {
          // Tilt auto toward pulse on fast tracks, ambient on slow.
          effectiveMode = isFast ? 'pulse' : (isSlow ? 'ambient' : 'auto');
          effectiveTopN = 1;
        }
        // === Phase 3 / M1: freshness / cooldown ===
        // Sliding window of the last 8 asset ids used. The picker subtracts
        // a penalty from candidates that were just used, so repeated
        // RE-MAPs rotate through the library instead of locking onto
        // top-3. Window size = 8 = ~3 RE-MAPs worth of assets, enough to
        // feel different without stranding good assets.
        const usedRecently = this._lastUsedAssets = this._lastUsedAssets || new Set();
        const FRESHNESS_PENALTY = 0.6;  // 0..1; 1 = block, 0 = no penalty
        // Compute a "score" for each asset for each layer role.
        // === Phase 3 / H3: BPM-derived brightness weight ===
        // Fast tracks look better with bright, punchy assets; slow
        // tracks want darker / lower-saturation picks. Apply a multiplier
        // to luma + hue based on the audio's BPM.
        const bpmEnergy = bpm > 0 ? clamp((bpm - 60) / 100, 0, 1.2) : 0.5;  // 0..1
        // Compute a "score" for each asset for each layer role
        const roles = [
          { name: 'bass',  want: 'motion', weight: 0.6 + f.bass * sens },
          { name: 'mid',   want: 'mid',    weight: 0.4 + f.mid * sens },
          { name: 'treb',  want: 'luma',   weight: 0.3 + f.treble * sens },
          { name: 'air',   want: 'hue',    weight: 0.2 + f.air * sens },
          { name: 'rms',   want: 'motion', weight: 0.5 + f.rms * sens * 2 },
          { name: 'onset', want: 'motion', weight: 0.7 + f.onset * sens * 3 },
        ];
        // Score every asset for every role, with freshness penalty.
        const scored = Library.items.map(it => {
          const sc = {};
          sc.motion = (it.motion) * 0.7 + (1 - Math.abs(it.luma - 0.5) * 2) * 0.3;
          sc.mid    = (it.luma) * 0.5 + (1 - it.motion) * 0.5;
          // BPM-tilted luma: fast tracks push brighter, slow tracks push
          // darker. Mid-range (bpm around 80-100) stays neutral.
          sc.luma   = ((1 - it.motion) * 0.4 + (it.luma) * 0.6)
                      * (0.85 + bpmEnergy * 0.3);
          sc.hue    = (it.hue) * (0.7 + bpmEnergy * 0.6);
          // Freshness penalty: a recently-used asset scores lower. We
          // apply a flat multiplier so the asset can still win if its
          // raw score is far above the alternatives, just less likely.
          if (usedRecently.has(it.id)) {
            for (const k of Object.keys(sc)) sc[k] *= (1 - FRESHNESS_PENALTY);
          }
          return { it, sc };
        });
        const topN = effectiveTopN;
        const used = new Set();
        const assignments = roles.map(r => {
          // Score unused candidates
          const cands = [];
          for (const s of scored) {
            if (used.has(s.it.id)) continue;
            cands.push({ it: s.it, v: s.sc[r.want] * r.weight });
          }
          if (!cands.length) return { role: r, asset: null };
          // Sort by score, take top N
          cands.sort((a, b) => b.v - a.v);
          const pool = cands.slice(0, Math.min(topN, cands.length));
          // Weight the random pick by score so the best is still most likely
          const total = pool.reduce((s, c) => s + Math.max(c.v, 0.01), 0);
          let r2 = Math.random() * total;
          let pick = pool[0];
          for (const c of pool) {
            r2 -= Math.max(c.v, 0.01);
            if (r2 <= 0) { pick = c; break; }
          }
          used.add(pick.it.id);
          return { role: r, asset: pick.it };
        });
        // === Phase 3 / H4: per-layer remap ===
        // If `index` is 0..5, keep the existing layers in place EXCEPT
        // for the one at `index`, which we replace with a new pick from
        // the assignment. The cross-fade swap machinery below handles the
        // visual transition; the user just sees one slot change.
        let slotsToReplace;
        if (index >= 0 && index < this.list.length) {
          // Single-slot remap. We need exactly `index + 1` new assets
          // (skip the unused ones). Build a partial assignment.
          const partial = assignments.filter((_, i) => i <= index);
          slotsToReplace = [{ idx: index, asset: partial[index] && partial[index].asset }];
        } else {
          // Full remap: every layer replaced.
          slotsToReplace = assignments.map((a, idx) => ({ idx, asset: a.asset }));
        }
        // Cross-fade swap: mark every current layer to fade out
        // (except the ones we're keeping in a per-slot remap) and
        // every new layer to fade in. Same machinery as the original
        // autoMap() in Phase 2.
        const oldList = this.list.slice();
        // Track which slot indices are being replaced in per-slot mode.
        // A Set of indices makes the "is this layer being replaced?"
        // check O(1) instead of O(n).
        const replacedIndices = new Set();
        if (index >= 0) replacedIndices.add(index);
        for (const oldL of oldList) {
          // In per-slot mode, leave layers that aren't being replaced
          // alone (they keep their current opacity / fade state).
          if (index >= 0) {
            const slot = this.list.indexOf(oldL);
            if (!replacedIndices.has(slot)) continue;  // untouched slot
          }
          const id = oldL.id;
          const self = this;
          oldL._fadeState = oldL._fadeState || {};
          oldL._fadeState.startedAt = performance.now();
          oldL._fadeState.durationMs = currentFadeMs(200);
          oldL._fadeState.fromOpacity = (oldL._fadeState.currentOpacity != null)
            ? oldL._fadeState.currentOpacity
            : (oldL.opacity != null ? oldL.opacity : 1);
          oldL._fadeState.toOpacity = 0;
          oldL._fadeState.currentOpacity = oldL._fadeState.fromOpacity;
          oldL._fadeState.onComplete = function () {
            const i = self.list.findIndex((l) => l.id === id);
            if (i >= 0) self.list.splice(i, 1);
          };
        }
        // For per-slot remap, we DON'T reset this.list — just splice the
        // replaced slot's old layer out via the onComplete above. The
        // remaining layers stay put (no fade for them). The new asset
        // gets inserted at the same slot in the build loop below.
        // For full remap, reset the list.
        if (index < 0) this.list = [];
        // Build the new layers. For per-slot, we update the existing
        // layer in place; for full, we push a new layer.
        // Track the assets we picked this round, so the freshness
        // window updates for the next RE-MAP.
        const pickedIds = [];
        for (let s = 0; s < slotsToReplace.length; s++) {
          const slot = slotsToReplace[s];
          if (!slot.asset) continue;
          const a = slot.asset;
          pickedIds.push(a.id);
          if (index >= 0 && slot.idx < this.list.length) {
            // Replace in place. Update the existing layer's fields.
            const target = this.list[slot.idx];
            target.asset = a;
            target.blend = pickBlend(slot.idx, effectiveMode);
            target.opacity = 0;
            target.baseScale = pickScale(slot.idx, a);
            target.hue = (effectiveMode === 'chaos') ? (Math.random() * 360 - 180) : 0;
            target.brightness = 1;
            target.contrast = 1;
            target.reactors = pickReactors(slot.idx, a, Audio.feat, effectiveMode);
            this.fadeIn(target, currentFadeMs(250));
          } else {
            const l = {
              id: 'L' + (this.list.length + 1),
              asset: a,
              blend: pickBlend(this.list.length, effectiveMode),
              opacity: 0,
              baseScale: pickScale(this.list.length, a),
              hue: (effectiveMode === 'chaos') ? (Math.random() * 360 - 180) : 0,
              brightness: 1,
              contrast: 1,
              pos: { x: 0, y: 0, rot: 0 },
              z: this.list.length,
              reactors: pickReactors(this.list.length, a, Audio.feat, effectiveMode),
              snapBeat: false,
            };
            this.list.push(l);
            this.fadeIn(l, currentFadeMs(250));
          }
        }
        // Update the freshness window: keep last 8 picked ids.
        for (const id of pickedIds) {
          usedRecently.add(id);
          if (usedRecently.size > 8) {
            // The Set is unordered; convert to array, drop the oldest.
            const arr = Array.from(usedRecently);
            while (arr.length > 8) arr.shift();
            this._lastUsedAssets = new Set(arr);
          }
        }
        this.render();
        if (this.list.length) { stageEmpty.classList.add('hidden'); this.select(this.list[0]); }
        setStatus('mapped ' + pickedIds.length + (index >= 0 ? ' (layer ' + (index + 1) + ')' : ''), 'ok');
          });
        }
      },
    };

    function pickBlend(i, mode='auto') {
      const opts = ['source-over', 'screen', 'lighter', 'overlay', 'soft-light', 'difference'];
      // If a preset is active, use its curated blend sequence
      if (window._activePreset && window._activePreset.blends) {
        return window._activePreset.blends[i % window._activePreset.blends.length];
      }
      if (mode === 'chaos') return opts[Math.floor(Math.random() * opts.length)];
      if (mode === 'pulse') return i % 2 === 0 ? 'screen' : 'lighter';
      if (mode === 'ambient') return ['source-over', 'soft-light', 'overlay'][i % 3];
      // === Phase 3 / M3: adjacency-aware shuffle ===
      // "Hard" blends (screen, lighter, overlay, difference) sit
      // together when the pool is `[source-over, screen, overlay,
      // lighter]` — layer 0 = source-over (soft), layer 1 = screen
      // (hard), layer 2 = overlay (hard), layer 3 = lighter (hard).
      // The user sees three consecutive bright stacks, which jitters
      // visually. Shuffle the pool each remap but never put two hard
      // blends next to each other.
      if (!pickBlend._pool || pickBlend._pool[0] === undefined) {
        pickBlend._pool = ['source-over', 'screen', 'overlay', 'lighter', 'soft-light'];
      }
      // Rotate the pool (cheap: shift+push) so each remap feels new.
      pickBlend._pool.push(pickBlend._pool.shift());
      // If the slot we'd return is the same "hard family" as the
      // previous assignment, return a different slot from the same pool
      // for this one call only — don't mutate the pool. The next call
      // sees the rotated pool and decides fresh.
      const HARD = new Set(['screen', 'lighter', 'overlay', 'difference']);
      const slot = i % pickBlend._pool.length;
      let chosen = pickBlend._pool[slot];
      const prev = pickBlend._lastChosen;
      if (prev && HARD.has(chosen) && HARD.has(prev)) {
        // Try the next 4 slots; pick the first non-hard.
        for (let k = 1; k < pickBlend._pool.length; k++) {
          const j = (slot + k) % pickBlend._pool.length;
          if (!HARD.has(pickBlend._pool[j])) {
            chosen = pickBlend._pool[j];
            break;
          }
        }
      }
      pickBlend._lastChosen = chosen;
      return chosen;
    }
    function pickScale(i, asset) {
      if (!asset) return 1;
      const ar = (asset.w || 1) / (asset.h || 1);
      // base around filling the canvas; tweak per role
      const fills = (window._activePreset && window._activePreset.fills) || [1.0, 0.8, 1.2, 0.5, 1.5, 0.7];
      return fills[i % fills.length] * (ar > 1 ? 0.7 : 1.0);
    }
    function pickReactors(i, asset, feat, mode='auto') {
      if (!asset) return [];
      // Preset mode: use the curated reactor sequence
      if (window._activePreset && window._activePreset.reactors) {
        return window._activePreset.reactors[i % window._activePreset.reactors.length] || [];
      }
      // Each layer gets 1-3 reactors based on its role index
      const presets = [
        // Layer 0: bass-pumping scale + opacity on beat
        [
          { feature: 'bass', target: 'scale',  scale: 0.6, ease: 'soft' },
          { feature: 'beat', target: 'opacity', scale: 0.4, ease: 'soft' },
        ],
        // Layer 1: mid-driven hue rotation
        [
          { feature: 'mid',  target: 'hue',   scale: 120, ease: 'smooth' },
          { feature: 'rms',  target: 'scale', scale: 0.2, ease: 'soft' },
        ],
        // Layer 2: treble shimmer — position + rotation
        [
          { feature: 'treble', target: 'rot',     scale: 30,  ease: 'smooth' },
          { feature: 'air',    target: 'y',       scale: 60,  ease: 'smooth' },
        ],
        // Layer 3: bass + rms scale
        [
          { feature: 'rms',  target: 'scale',  scale: 0.5, ease: 'soft' },
          { feature: 'onset', target: 'brightness', scale: 0.5, ease: 'sharp' },
        ],
        // Layer 4: centroid hue + treble scale
        [
          { feature: 'centroid', target: 'hue', scale: 180, ease: 'smooth' },
          { feature: 'treble',   target: 'scale', scale: 0.3, ease: 'soft' },
        ],
        // Layer 5: bass thump + beat pulse
        [
          { feature: 'bass',  target: 'scale',  scale: 0.8, ease: 'sharp' },
          { feature: 'beat',  target: 'opacity', scale: 0.7, ease: 'sharp' },
        ],
        // Layer 6: rms + onset flicker
        [
          { feature: 'onset', target: 'opacity', scale: 0.9, ease: 'sharp' },
          { feature: 'rms',   target: 'x',       scale: 30,  ease: 'soft' },
        ],
        // Layer 7: mid + air drift
        [
          { feature: 'mid',  target: 'x', scale: 40, ease: 'smooth' },
          { feature: 'air',  target: 'y', scale: 30, ease: 'smooth' },
        ],
      ];
      return presets[i % presets.length] || [];
    }

    // ======================================================================
    // VISUAL PRESETS — 5 curated looks. Each preset overrides reactors/blends/
    // scale-fills for ALL layers so the look is consistent. Reactor values are
    // tuned with `soft` / `release` eases for visual smoothness.
    // ======================================================================
    const VISUAL_PRESETS = {
      pulse: {
        name: 'Pulse',
        desc: 'Bass-thumping, beat-pulsing. Dark, heavy, club-energy.',
        reactors: [
          [{ feature: 'bass', target: 'scale',   scale: 0.55, ease: 'soft' },
           { feature: 'beat', target: 'opacity', scale: 0.35, ease: 'soft' },
           { feature: 'rms',  target: 'scale',   scale: 0.15, ease: 'release' }],
          [{ feature: 'bass', target: 'scale',   scale: 0.35, ease: 'soft' },
           { feature: 'beat', target: 'brightness', scale: 0.4, ease: 'release' }],
          [{ feature: 'beat', target: 'rot',     scale: 6,   ease: 'release' },
           { feature: 'rms',  target: 'y',       scale: 24,  ease: 'soft' }],
        ],
        blends: ['screen', 'screen', 'lighter', 'screen'],
        fills:  [1.0, 0.9, 1.1, 0.7, 1.3, 0.8],
      },
      drift: {
        name: 'Drift',
        desc: 'Slow continuous motion. Mid + air, soft-light, ambient.',
        reactors: [
          [{ feature: 'mid',  target: 'x',     scale: 28,  ease: 'smooth' },
           { feature: 'air',  target: 'y',     scale: 22,  ease: 'smooth' }],
          [{ feature: 'mid',  target: 'hue',   scale: 90,  ease: 'smooth' },
           { feature: 'rms',  target: 'scale', scale: 0.15, ease: 'soft' }],
          [{ feature: 'air',  target: 'rot',   scale: 18,  ease: 'smooth' },
           { feature: 'treble', target: 'scale', scale: 0.2, ease: 'soft' }],
        ],
        blends: ['source-over', 'soft-light', 'overlay', 'soft-light'],
        fills:  [0.9, 1.1, 0.7, 1.0, 0.8, 1.2],
      },
      strobe: {
        name: 'Strobe',
        desc: 'Sharp onset flicker, x/y jitter, lighter blend. Chaotic.',
        reactors: [
          [{ feature: 'onset', target: 'opacity', scale: 0.7, ease: 'sharp' },
           { feature: 'rms',   target: 'x',       scale: 60,  ease: 'release' }],
          [{ feature: 'onset', target: 'brightness', scale: 0.8, ease: 'sharp' },
           { feature: 'rms',   target: 'y',       scale: 45,  ease: 'release' }],
          [{ feature: 'onset', target: 'scale',  scale: 0.4, ease: 'sharp' },
           { feature: 'beat',  target: 'rot',    scale: 14,  ease: 'sharp' }],
        ],
        blends: ['lighter', 'difference', 'lighter', 'screen'],
        fills:  [0.7, 1.2, 0.9, 1.4, 0.6, 1.1],
      },
      warp: {
        name: 'Warp',
        desc: 'Hue rotation, smoothstep, overlay. Psychedelic, slow.',
        reactors: [
          [{ feature: 'centroid', target: 'hue', scale: 220, ease: 'smooth' },
           { feature: 'mid',      target: 'scale', scale: 0.2, ease: 'soft' }],
          [{ feature: 'mid',  target: 'hue',   scale: 160, ease: 'smooth' },
           { feature: 'rms',  target: 'scale', scale: 0.15, ease: 'soft' }],
          [{ feature: 'centroid', target: 'hue', scale: 200, ease: 'smooth' },
           { feature: 'treble',   target: 'scale', scale: 0.25, ease: 'soft' }],
        ],
        blends: ['overlay', 'overlay', 'soft-light', 'overlay'],
        fills:  [1.0, 0.85, 1.15, 0.95, 1.05, 0.9],
      },
      mosh: {
        name: 'Mosh',
        desc: 'Bass + rms thump, rotation, sharp attack. Live-show energy.',
        reactors: [
          [{ feature: 'bass', target: 'scale', scale: 0.7, ease: 'release' },
           { feature: 'rms',  target: 'rot',   scale: 22,  ease: 'release' }],
          [{ feature: 'bass', target: 'rot',   scale: 18,  ease: 'release' },
           { feature: 'rms',  target: 'x',     scale: 40,  ease: 'release' }],
          [{ feature: 'bass', target: 'scale', scale: 0.5, ease: 'release' },
           { feature: 'rms',  target: 'y',     scale: 30,  ease: 'release' }],
        ],
        blends: ['source-over', 'source-over', 'overlay', 'multiply'],
        fills:  [1.1, 0.95, 1.2, 0.85, 1.05, 1.0],
      },
    };

    function applyPreset(key) {
      if (!key || key === 'off') {
        window._activePreset = null;
        const sel = document.getElementById('preset');
        if (sel) sel.value = 'off';
        if (Layers && Layers.list && Layers.list.length && Layers.render) Layers.render();
        if (typeof setStatus === 'function') setStatus('preset: off (default mode)', 'ok');
        return;
      }
      const preset = VISUAL_PRESETS[key];
      if (!preset) return;
      window._activePreset = preset;
      // Auto-populate the stage when the user picks a preset on an
      // empty canvas: presets are styled for N layers (the preset's
      // reactors/blends/fills array length). Picking pulse on an empty
      // stage used to do nothing visible because the apply-loop was
      // gated on Layers.list.length > 0. Pick N images from the library
      // and add them as layers so the preset has something to style.
      if (Layers && Layers.list && Layers.list.length === 0 && Library && Library.items && Library.items.length) {
        // N = the largest array in the preset (whichever has the most
        // entries); fall back to 4 (the typical preset shape) if no
        // arrays defined.
        const arrs = ['reactors', 'blends', 'fills'].map(k => Array.isArray(preset[k]) ? preset[k].length : 0);
        const N = Math.max(4, ...arrs);
        const images = Library.items.filter(it => it && it.type === 'image').slice(0, N);
        for (const it of images) {
          try { Layers.add(it); } catch (_) { /* skip broken items */ }
        }
        if (typeof setStatus === 'function') setStatus('preset: ' + preset.name + ' (' + images.length + ' layers)', 'ok');
      }
      // Re-render layer panel so the new blends/scales show. When the preset
      // defines explicit `reactors` / `blends` / `fills` arrays that match
      // the current layer count, honor them verbatim. Otherwise fall back to
      // the asset-driven heuristics (pickReactors / pickBlend / pickScale).
      // Falls back layer-by-layer so a 4-layer preset applied to a 6-layer
      // scene still works: layers 0..N-1 use the preset; layers N..end use
      // the heuristic.
      if (Layers && Layers.list && Layers.list.length) {
        const presetReactors = Array.isArray(preset.reactors) ? preset.reactors : null;
        const presetBlends = Array.isArray(preset.blends) ? preset.blends : null;
        const presetFills = Array.isArray(preset.fills) ? preset.fills : null;
        for (let i = 0; i < Layers.list.length; i++) {
          const l = Layers.list[i];
          if (presetBlends && presetBlends[i % presetBlends.length]) {
            l.blend = presetBlends[i % presetBlends.length];
          } else {
            l.blend = pickBlend(i, 'auto');
          }
          if (presetFills && typeof presetFills[i % presetFills.length] === 'number') {
            l.baseScale = presetFills[i % presetFills.length];
          } else {
            l.baseScale = pickScale(i, l.asset);
          }
          if (presetReactors && presetReactors[i % presetReactors.length]) {
            l.reactors = presetReactors[i % presetReactors.length].slice();
          } else {
            l.reactors = pickReactors(i, l.asset, Audio.feat, 'auto');
          }
        }
        if (Layers.render) Layers.render();
      }
      if (typeof setStatus === 'function') setStatus('preset: ' + preset.name, 'ok');
    }
    // Expose for debugging from devtools / puppeteer
    window.VISUAL_PRESETS = VISUAL_PRESETS;
    // Back-compat alias: the Story runtime and external scripts sometimes
    // call applyVisualPreset by name. Keep the legacy entrypoint working.
    window.applyVisualPreset = applyPreset;


    // ======================================================================
    // STORY GRAPH
    // ======================================================================
    //
    // A 9-chapter narrative that wraps the existing layer / preset system.
    // Each chapter says: start here, change only within these boundaries,
    // move to <next> when the music or the user earns it.
    //
    // Public API on window.SWR.Story:
    //   .current            — id of the active chapter ('fragments' | …)
    //   .history            — array of chapter ids in order of entry
    //   .mode               — 'manual' | 'guided' | 'auto' | 'generative'
    //   .state              — { current, history, mode, lastEnterAt, evoSeed }
    //   .STORY              — read-only view of the chapter graph
    //   .ORDER              — ['fragments', 'signal', …] (slot for Shift+1..9)
    //   .enter(id, reason?) — snapshot → transition → activate chapter
    //   .evolve()           — everyBars-driven bounded mutation
    //   .tick(audio, transport) — advance bar + advance if shouldAdvance()
    //   .shouldAdvance(audio, transport) — boolean, never side-effects
    //   .renderStrip()      — repaint the STORY UI strip
    //   .hold() / .next() / .branch() / .reset() — UI buttons
    //
    // Chapters:
    //   fragments  → signal    → pursuit   → fracture
    //   revelation → overload  → afterimage → memory → loop (→ fragments)
    //
    // Each chapter's `state` references a VISUAL_PRESETS key (or inline
    // parameters). `locks` freezes hero-layer fields; `evolve.preserve`
    // declares what NOT to mutate. Transitions are bloom / crossfade / morph
    // wrappers over the existing engine primitives.

    const STORY_ORDER = ['fragments', 'signal', 'pursuit', 'fracture',
                         'revelation', 'overload', 'afterimage', 'memory', 'loop'];

    const STORY_DEFAULTS = {
      // Common params every chapter inherits unless overridden
      _common: {
        evolve: { enabled: true, everyBars: 4, amount: 0.12, targets: ['opacity','hue','x','y'],
                  preserve: ['assets','mappings','blend'], seed: 0xA17 },
        transition: { when: { type: 'energyAbove', value: 0.55, holdBars: 2 },
                      to: 'signal', style: 'bloom', maxBars: 64 },
      },
    };

    const STORY = {
      fragments: {
        id: 'fragments',
        label: '01 · FRAGMENTS',
        index: 1,
        desc: 'Sparse, dim, restrained. The opening image.',
        state: { preset: 'drift', opacity: 0.55, assetDensity: 0.3 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 8, amount: 0.08,
                  targets: ['opacity','hue','x','y'],
                  preserve: ['assets','mappings','blend'], seed: 481201 },
        transition: { when: { type: 'energyAbove', value: 0.42, holdBars: 2 },
                      to: 'signal', style: 'bloom', maxBars: 64 },
      },
      signal: {
        id: 'signal', label: '02 · SIGNAL', index: 2,
        desc: 'Beat reveals layers and color. The first sign of life.',
        state: { preset: 'pulse', opacity: 0.75, assetDensity: 0.55 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 4, amount: 0.12,
                  targets: ['opacity','hue','x','y','scale'],
                  preserve: ['assets','mappings','blend'], seed: 4901 },
        transition: { when: { type: 'energyAbove', value: 0.58, holdBars: 2 },
                      to: 'pursuit', style: 'bloom', maxBars: 56 },
      },
      pursuit: {
        id: 'pursuit', label: '03 · PURSUIT', index: 3,
        desc: 'Faster x/y drift, rotation, contrast. The chase begins.',
        state: { preset: 'drift', opacity: 0.85, assetDensity: 0.7, motionScale: 1.6 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 4, amount: 0.18,
                  targets: ['opacity','hue','x','y','rot','scale','contrast'],
                  preserve: ['assets','mappings','blend'], seed: 77003 },
        transition: { when: { type: 'onsetBurst', value: 4 },
                      to: 'fracture', style: 'crossfade', maxBars: 48 },
      },
      fracture: {
        id: 'fracture', label: '04 · FRACTURE', index: 4,
        desc: 'Stronger mutation, unstable blends, asset swaps permitted.',
        state: { preset: 'mosh', opacity: 1.0, assetDensity: 1.0, motionScale: 2.0 },
        locks: ['layer[0].asset', 'layer[0].blend'],
        evolve: { enabled: true, everyBars: 2, amount: 0.32,
                  targets: ['opacity','hue','x','y','rot','scale','brightness','contrast'],
                  preserve: ['layer[0].asset'], seed: 911 },
        transition: { when: { type: 'afterBars', value: 24 },
                      to: 'revelation', style: 'morph', maxBars: 32 },
      },
      revelation: {
        id: 'revelation', label: '05 · REVELATION', index: 5,
        desc: 'Subject becomes legible; reduce chaos. The hero appears.',
        state: { preset: 'warp', opacity: 1.0, assetDensity: 0.6, motionScale: 0.6 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 4, amount: 0.10,
                  targets: ['hue','brightness','contrast'],
                  preserve: ['assets','mappings','blend'], seed: 22442 },
        transition: { when: { type: 'energyAbove', value: 0.75, holdBars: 2 },
                      to: 'overload', style: 'bloom', maxBars: 40 },
      },
      overload: {
        id: 'overload', label: '06 · OVERLOAD', index: 6,
        desc: 'Maximum density and reactivity. The climax.',
        state: { preset: 'strobe', opacity: 1.0, assetDensity: 1.0, motionScale: 2.5 },
        locks: [],
        evolve: { enabled: true, everyBars: 1, amount: 0.45,
                  targets: ['opacity','hue','x','y','rot','scale','brightness','contrast'],
                  preserve: [], seed: 88 },
        transition: { when: { type: 'energyBelow', value: 0.30, holdBars: 4 },
                      to: 'afterimage', style: 'crossfade', maxBars: 48 },
      },
      afterimage: {
        id: 'afterimage', label: '07 · AFTERIMAGE', index: 7,
        desc: 'Fade, slow hue travel, trails. The comedown.',
        state: { preset: 'warp', opacity: 0.7, assetDensity: 0.5, motionScale: 0.4 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 8, amount: 0.06,
                  targets: ['opacity','hue','brightness'],
                  preserve: ['assets','mappings','blend'], seed: 12099 },
        transition: { when: { type: 'afterBars', value: 16 },
                      to: 'memory', style: 'morph', maxBars: 24 },
      },
      memory: {
        id: 'memory', label: '08 · MEMORY', index: 8,
        desc: 'Selected motifs from earlier chapters return.',
        state: { preset: 'drift', opacity: 0.85, assetDensity: 0.4, motionScale: 0.8 },
        locks: [],
        evolve: { enabled: true, everyBars: 12, amount: 0.08,
                  targets: ['hue','opacity'],
                  preserve: ['assets','mappings','blend'], seed: 7741 },
        transition: { when: { type: 'afterBars', value: 12 },
                      to: 'loop', style: 'crossfade', maxBars: 20 },
      },
      loop: {
        id: 'loop', label: '09 · LOOP', index: 9,
        desc: 'Return to the opening. The cycle completes.',
        state: { preset: 'drift', opacity: 0.55, assetDensity: 0.3 },
        locks: ['layer[0].asset'],
        evolve: { enabled: true, everyBars: 8, amount: 0.06,
                  targets: ['opacity','hue'],
                  preserve: ['assets','mappings','blend'], seed: 2025 },
        transition: { when: { type: 'afterBars', value: 8 },
                      to: 'fragments', style: 'crossfade', maxBars: 16 },
      },
    };

    // ---- Story runtime -------------------------------------------------
    function makeStoryRuntime() {
      const LS_KEY = 'swr.story';

      function persist() {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({
            current: state.current,
            history: state.history.slice(-32),
            mode: state.mode,
            lastEnterAt: state.lastEnterAt,
            evoSeed: state.evoSeed,
          }));
        } catch (_) {}
      }
      function restore() {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (!raw) return null;
          return JSON.parse(raw);
        } catch (_) { return null; }
      }

      const state = {
        current: 'fragments',
        history: [],
        mode: 'manual',       // 'manual' | 'guided' | 'auto' | 'generative'
        lastEnterAt: 0,
        evoSeed: 0xA17,
        // Per-chapter bar counter, reset on enter()
        _barsInNode: 0,
        _lastEvoBar: 0,
        // morph transition state (only used during style === 'morph')
        _morph: null,
      };

      // Initialize from localStorage if present
      const r = restore();
      if (r && STORY[r.current]) {
        state.current = r.current;
        state.history = Array.isArray(r.history) ? r.history : [];
        state.mode = r.mode || 'manual';
        state.lastEnterAt = r.lastEnterAt || 0;
        state.evoSeed = r.evoSeed || 0xA17;
      }

      // ---- small RNG (mulberry32) for deterministic mutation ----
      function hashSeed(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = (h * 16777619) >>> 0;
        }
        return h >>> 0;
      }
      function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
          a = (a + 0x6D2B79F5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

      // ---- mutate helper: bounded, preserves locks/preserve fields ----
      function mutate(opts) {
        // opts: { amount, allowedParams, preserve, seed, scope }
        // preserve: array of strings ('assets','mappings','blend', or 'layer[N].field')
        // scope: 'visuals only' | 'all' (currently both behave the same)
        const preserve = new Set(opts.preserve || []);
        const preserveAssets = preserve.has('assets');
        const preserveMappings = preserve.has('mappings');
        const preserveBlend = preserve.has('blend');
        // Build per-bar seed
        const bar = (Audio && typeof Audio.bar === 'number') ? Audio.bar : 0;
        const baseSeed = (typeof opts.seed === 'number') ? opts.seed : state.evoSeed;
        const seed = hashSeed(String(baseSeed) + ':' + String(bar) + ':' + String(opts.tag || ''));
        const rng = mulberry32(seed);
        // Iterate layers, mutate numeric params only (we never touch assets/mappings/blend here)
        if (!Layers || !Layers.list) return;
        for (let i = 0; i < Layers.list.length; i++) {
          const l = Layers.list[i];
          // Skip locked fields (e.g. layer[0].asset is in the chapter's locks)
          for (const param of (opts.allowedParams || ['opacity','hue','x','y','scale'])) {
            const range = PARAM_RANGE[param];
            if (!range) continue;
            const jitter = (rng() - 0.5) * 2 * opts.amount * range.amp;
            // Skip this param if it's in the per-layer lock path (e.g.
            // 'layer[0].blend' — covered by preserveBlend above for all layers)
            l[param] = clamp((l[param] || 0) + jitter, range.lo, range.hi);
          }
        }
        if (Layers.render) Layers.render();
      }

      // Range + amplitude for each allowed mutate param. `amp` scales
      // how much an `amount` of 1.0 is allowed to nudge the value.
      const PARAM_RANGE = {
        opacity:   { lo: 0,    hi: 1,    amp: 1 },
        hue:       { lo: -180, hi: 180,  amp: 60 },
        x:         { lo: -300, hi: 300,  amp: 80 },
        y:         { lo: -300, hi: 300,  amp: 80 },
        scale:     { lo: 0.1,  hi: 3,    amp: 0.6 },
        rot:       { lo: -180, hi: 180,  amp: 60 },
        brightness:{ lo: 0.1,  hi: 2.5,  amp: 0.6 },
        contrast:  { lo: 0.1,  hi: 2.5,  amp: 0.6 },
      };

      // ---- transition implementations ----
      // bloom: stagger layers' opacity 0→target over durationMs.
      function transitionBloom(node, durationMs) {
        if (!Layers || !Layers.list || !Layers.list.length) return Promise.resolve();
        const targets = Layers.list.map((l) => l.opacity);
        // Save originals, then animate from 0
        const originals = targets.slice();
        for (const l of Layers.list) l.opacity = 0;
        const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        return new Promise((resolve) => {
          function step() {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const t = clamp((now - startedAt) / Math.max(1, durationMs), 0, 1);
            // ease-out cubic
            const e = 1 - Math.pow(1 - t, 3);
            for (let i = 0; i < Layers.list.length; i++) {
              Layers.list[i].opacity = originals[i] * e;
            }
            if (Layers.render) Layers.render();
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          }
          requestAnimationFrame(step);
        });
      }
      // crossfade: schedule a swap to the new state after a half-period
      // pause (simple stand-in — the engine's real crossfade is in
      // engine-keys.client.js; here we just let the new state land and
      // call Layers.render()).
      function transitionCrossfade(_node, durationMs) {
        if (Layers && Layers.render) Layers.render();
        return new Promise((resolve) => setTimeout(resolve, Math.min(800, durationMs || 600)));
      }
      // morph: animate numeric params (opacity, scale, x, y, hue, brightness,
      // contrast) from current layer values to the chapter's `state` over
      // `durationMs`. Skips locked fields.
      function transitionMorph(node, durationMs) {
        if (!Layers || !Layers.list) return Promise.resolve();
        const targets = Layers.list.map((l) => ({
          opacity: node.state.opacity != null ? node.state.opacity : l.opacity,
          // x/y/scale/hue/brightness/contrast stay as-is unless node.state
          // overrides them explicitly (it doesn't in the default chapters;
          // morph is reserved for future chapter-specific overrides).
        }));
        const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const start = Layers.list.map((l) => ({ opacity: l.opacity }));
        return new Promise((resolve) => {
          function step() {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const t = clamp((now - startedAt) / Math.max(1, durationMs || 1200), 0, 1);
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
            for (let i = 0; i < Layers.list.length; i++) {
              const l = Layers.list[i];
              if (typeof targets[i].opacity === 'number') {
                l.opacity = start[i].opacity + (targets[i].opacity - start[i].opacity) * e;
              }
            }
            if (Layers.render) Layers.render();
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          }
          requestAnimationFrame(step);
        });
      }

      function applyState(node) {
        if (!node || !node.state) return;
        if (node.state.preset && typeof applyPreset === 'function') {
          applyPreset(node.state.preset);
        }
        if (!Layers || !Layers.list) return;
        // Apply opacity override uniformly (unless layer is locked)
        const opacityTarget = (typeof node.state.opacity === 'number') ? node.state.opacity : null;
        if (opacityTarget != null) {
          for (const l of Layers.list) l.opacity = opacityTarget;
        }
        if (Layers.render) Layers.render();
      }

      // Snapshot current state for the undo/redo system (if available) so
      // the user can roll back a story advance.
      function snapshotCurrentState() {
        try {
          if (window.SWR && window.SWR.UI && typeof window.SWR.UI.historyPush === 'function') {
            window.SWR.UI.historyPush();
          }
        } catch (_) {}
      }

      // ---- enter(nodeId, reason?) ----
      async function enter(nodeId, reason) {
        const node = STORY[nodeId];
        if (!node) {
          if (typeof setStatus === 'function') setStatus('story: unknown ' + nodeId, 'err');
          return false;
        }
        if (state.current === nodeId) return false;
        reason = reason || 'manual';
        snapshotCurrentState();
        // Reset per-chapter bar counter so trigger conditions re-evaluate
        if (Audio && typeof Audio.resetBarCounter === 'function') Audio.resetBarCounter();
        state._barsInNode = 0;
        state._lastEvoBar = 0;
        // Remember where we came from for history
        state.history.push(state.current);
        if (state.history.length > 32) state.history.splice(0, state.history.length - 32);
        state.current = nodeId;
        state.lastEnterAt = Date.now();
        // Apply the chapter's visual state
        applyState(node);
        // Run the transition
        const style = (node.transition && node.transition.style) || 'bloom';
        const dur = style === 'morph' ? 1600 : style === 'crossfade' ? 600 : 1200;
        try {
          if (style === 'bloom') await transitionBloom(node, dur);
          else if (style === 'crossfade') await transitionCrossfade(node, dur);
          else if (style === 'morph') await transitionMorph(node, dur);
        } catch (_) {}
        persist();
        renderStrip();
        if (typeof setStatus === 'function') {
          setStatus('story: ' + node.label + (reason ? ' (' + reason + ')' : ''), 'ok');
        }
        try {
          window.dispatchEvent(new CustomEvent('swr-story-enter', {
            detail: { id: nodeId, reason: reason, history: state.history.slice() }
          }));
        } catch (_) {}
        return true;
      }

      // ---- evolve() — bounded mutation per the chapter's evolve rules ----
      function evolve() {
        const node = STORY[state.current];
        if (!node || !node.evolve || !node.evolve.enabled) return false;
        const bar = (Audio && typeof Audio.bar === 'number') ? Audio.bar : 0;
        // Don't evolve if we don't have a beat clock yet (BPM unknown).
        if (!bar) return false;
        const every = node.evolve.everyBars || 4;
        if (bar - state._lastEvoBar < every) return false;
        state._lastEvoBar = bar;
        mutate({
          allowedParams: node.evolve.targets || ['opacity','hue','x','y'],
          preserve: node.evolve.preserve || [],
          amount: node.evolve.amount || 0.12,
          seed: (node.evolve.seed || state.evoSeed) ^ state.current.length,
          tag: state.current,
        });
        return true;
      }

      // ---- shouldAdvance(audio, transport) ----
      // Pure: takes a snapshot of current audio + transport, returns true
      // if the chapter's `transition.when` rule fires. Also returns true
      // if the chapter's maxBars timer fires (fallback for quiet songs).
      function shouldAdvance(audio, transport) {
        const node = STORY[state.current];
        if (!node || !node.transition) return false;
        const t = node.transition.when;
        if (!t) return false;
        const a = audio || (typeof window !== 'undefined' && window.Audio && window.Audio.feat) || {};
        const tp = transport || { bar: Audio && Audio.bar, barsInNode: state._barsInNode };
        let fired = false;
        if (t.type === 'energyAbove') {
          fired = (a.rms || 0) > t.value && (tp.barsInNode || 0) >= (t.holdBars || 0);
        } else if (t.type === 'energyBelow') {
          fired = (a.rms || 0) < t.value && (tp.barsInNode || 0) >= (t.holdBars || 0);
        } else if (t.type === 'afterBars') {
          fired = (tp.barsInNode || 0) >= t.value;
        } else if (t.type === 'onsetBurst') {
          fired = (a.onsetsInLastBar || 0) >= t.value;
        }
        // Fallback: maxBars timer (defaults to 64 if not set)
        const maxBars = node.transition.maxBars || 64;
        const maxFired = (tp.barsInNode || 0) >= maxBars;
        return fired || maxFired;
      }

      // ---- tick() — called once per audio frame to advance internal counters ----
      function tick(audio, transport) {
        // Mirror Audio.bar into our local counter so shouldAdvance() can
        // use barsInNode without the runtime needing to read Audio every time.
        const bar = (Audio && typeof Audio.bar === 'number') ? Audio.bar : 0;
        if (bar > state._barsInNode) state._barsInNode = bar;
        // Run evolution if it's time
        evolve();
        // Auto-mode: advance if shouldAdvance() fires
        if (state.mode === 'auto' || state.mode === 'generative') {
          if (shouldAdvance(audio, transport)) {
            const node = STORY[state.current];
            const next = (node && node.transition && node.transition.to) || 'fragments';
            if (state.mode === 'generative' && STORY[next] && STORY[next].transition) {
              // Generative mode: small chance to fork to a different valid
              // successor if there are multiple paths defined. Currently the
              // graph is linear (one `to` per chapter); we honour the chosen
              // path but reseed evolution for variety.
              state.evoSeed = (state.evoSeed * 1103515245 + 12345) >>> 0;
            }
            enter(next, state.mode === 'generative' ? 'generative' : 'auto').catch(() => {});
          }
        }
      }

      // ---- UI ----
      function renderStrip() {
        const strip = document.getElementById('story-strip');
        if (!strip) return;
        const chaptersEl = document.getElementById('story-chapters');
        if (chaptersEl) {
          chaptersEl.innerHTML = STORY_ORDER.map((id) => {
            const node = STORY[id];
            if (!node) return '';
            const cls = 'story-chapter' + (id === state.current ? ' active' : '') +
                       (state.history.indexOf(id) >= 0 ? ' past' : '');
            return '<button type="button" class="' + cls + '" data-node="' + id + '" ' +
                   'title="' + (node.desc || node.label) + '">' +
                   '<span class="story-ch-num">' + (node.index || '') + '</span>' +
                   '<span class="story-ch-label">' + node.label.replace(/^\d+\s*·\s*/, '') + '</span>' +
                   '</button>';
          }).join('');
          // Click to enter (manual override)
          chaptersEl.querySelectorAll('.story-chapter').forEach((el) => {
            el.addEventListener('click', () => {
              const id = el.getAttribute('data-node');
              if (id) enter(id, 'click').catch(() => {});
            });
          });
        }
        const curEl = document.getElementById('story-current');
        if (curEl) {
          const cur = STORY[state.current];
          curEl.textContent = cur ? cur.label : '— none —';
        }
        const modeSel = document.getElementById('story-mode');
        if (modeSel && modeSel.value !== state.mode) modeSel.value = state.mode;
        const autoBox = document.getElementById('story-auto');
        if (autoBox) autoBox.checked = (state.mode === 'auto' || state.mode === 'generative');
        const histEl = document.getElementById('story-history');
        if (histEl) {
          const path = state.history.concat([state.current]).map((id) => {
            const n = STORY[id];
            return n ? n.label.replace(/^\d+\s*·\s*/, '') : id;
          });
          histEl.textContent = path.join(' → ');
        }
      }

      // ---- public action buttons ----
      function hold() {
        // Snapshot mode to manual so the runtime stops advancing on its own
        state.mode = 'manual';
        persist();
        renderStrip();
        if (typeof setStatus === 'function') setStatus('story: hold (manual)', 'ok');
      }
      function next() {
        const node = STORY[state.current];
        if (!node || !node.transition || !node.transition.to) return;
        // Manual confirm: in 'guided' mode, always honor; in 'manual',
        // next() is the explicit user action.
        enter(node.transition.to, 'next').catch(() => {});
      }
      function branch(targetId) {
        if (!STORY[targetId]) return;
        enter(targetId, 'branch').catch(() => {});
      }
      function reset() {
        state.current = 'fragments';
        state.history = [];
        state._barsInNode = 0;
        state._lastEvoBar = 0;
        if (Audio && typeof Audio.resetBarCounter === 'function') Audio.resetBarCounter();
        persist();
        applyState(STORY.fragments);
        renderStrip();
        if (typeof setStatus === 'function') setStatus('story: reset → fragments', 'ok');
      }
      function setMode(m) {
        if (['manual','guided','auto','generative'].indexOf(m) === -1) return;
        state.mode = m;
        persist();
        renderStrip();
        if (typeof setStatus === 'function') setStatus('story mode: ' + m, 'ok');
      }

      return {
        // state (read-only views)
        get current() { return state.current; },
        get history() { return state.history.slice(); },
        get mode() { return state.mode; },
        get state() { return { current: state.current, history: state.history.slice(),
                                mode: state.mode, lastEnterAt: state.lastEnterAt,
                                evoSeed: state.evoSeed }; },
        STORY,
        ORDER: STORY_ORDER,
        // actions
        enter,
        evolve,
        tick,
        shouldAdvance,
        hold,
        next,
        branch,
        reset,
        setMode,
        renderStrip,
      };
    }

    const Story = makeStoryRuntime();
    window.Story = Story;
    // Also expose on window.SWR — set after window.SWR is populated below.

    // Apply the current chapter's visual state on boot so the engine
    // starts in story mode. Only does work if the story persistence has
    // a saved state OR the default chapter has a preset.
    try {
      // Defer so all engine subsystems (Layers, Audio, Layers.render, etc.)
      // are constructed before we try to apply.
      setTimeout(() => {
        try {
          const cur = STORY[Story.current];
          if (cur) Story.enter(Story.current, 'boot');
        } catch (e) { /* silent */ }
      }, 50);
    } catch (_) {}


    // ======================================================================
    // RENDERER
    // ======================================================================
    const Renderer = {
      // offscreen canvas for hue/brightness/contrast pre-pass
      proc: document.createElement('canvas'),
      procCtx: null,
      running: false,
      fps: 0,
      lastFrame: 0,
      // Smoothed features
      smooth: { bass: 0, mid: 0, treble: 0, air: 0, rms: 0, beat: 0, onset: 0, centroid: 0 },
      // Drag / drift system
      dragMode: 'auto',     // 'auto' = continuous drift, 'manual' = user-controlled
      dragging: false,
      selectedLayer: null,
      dragStart: null,      // mouse pos at mousedown
      layerStart: null,     // layer.pos at mousedown
      _t: 0,                // seconds since start, for drift math
      init() {
        this.proc.width = stageCanvas.width;
        this.proc.height = stageCanvas.height;
        this.procCtx = this.proc.getContext('2d', { willReadFrequently: false });
      },
      fit() {
        // Fit stage to viewport while preserving 16:9
        const vw = stageCanvas.clientWidth, vh = stageCanvas.clientHeight;
        const targetAR = stageCanvas.width / stageCanvas.height;
        const viewAR = vw / vh;
        if (Math.abs(viewAR - targetAR) < 0.02) {
          // already there
        }
        // Resample internal resolution to a sensible size
        const maxW = 1920;
        if (vw > maxW) {
          const scale = maxW / vw;
          stageCanvas.width = Math.round(vw * scale);
          stageCanvas.height = Math.round(vh * scale);
        } else {
          stageCanvas.width = Math.round(vw);
          stageCanvas.height = Math.round(vh);
        }
        this.proc.width = stageCanvas.width;
        this.proc.height = stageCanvas.height;
      },
      // Resize the stage + FX output canvas to a target width × height.
      // Used by the size-preset recorder (Square / Reel / YouTube / TikTok)
      // so the exported MP4 matches the chosen aspect ratio at full quality
      // — independent of the on-screen viewport. The FX canvas (outputCanvas)
      // is matched next, since the recorder captures from it.
      // Returns the actual {width, height} used (clamped to sane bounds).
      fitToSize(w, h) {
        // Clamp to sane recording bounds. Below 360 wide is illegible; above
        // 4K is wasted (8 Mbps target bitrate looks like garbage at 2160p).
        const minW = 360, maxW = 3840, minH = 360, maxH = 2160;
        const aw = Math.min(maxW, Math.max(minW, Math.round(w)));
        const ah = Math.min(maxH, Math.max(minH, Math.round(h)));
        stageCanvas.width = aw;
        stageCanvas.height = ah;
        this.proc.width = aw;
        this.proc.height = ah;
        // Sync the FX overlay canvas (#fx-canvas) so the captureStream
        // picks up the new size. The fx-postprocess module resizes it via
        // a ResizeObserver tied to #render, but we resize it explicitly too
        // so the next captured frame is the right size.
        try {
          const fx = (window.FX && window.FX.outputCanvas) || document.getElementById('fx-canvas');
          if (fx) { fx.width = aw; fx.height = ah; }
        } catch (e) {}
        // One synchronous redraw so captureStream sees the new frame.
        // The renderer's main rAF loop will keep updating after this.
        try { this.draw && this.draw(); } catch (e) {}
        return { width: aw, height: ah };
      },
      getFeature(react) {
        const s = this.smooth;
        const raw = Audio.feat[react.feature] ?? 0;
        if (react.feature === 'beat' || react.feature === 'onset') return raw; // already 0..1 envelope
        if (react.feature === 'centroid') return raw;
        return raw;
      },
      ease(name, t) {
        if (name === 'sharp') return Math.pow(t, 0.4);
        if (name === 'soft') return smoothstep(0, 1, t);
        if (name === 'release') return 1 - Math.pow(1 - t, 2);  // ease-out (fast attack, soft release)
        return t;
      },
      // Cross-fade engine: each layer may carry a `_fadeState` set by
      // Layer.fadeIn() / Layer.fadeOut(). We advance those fades here once
      // per frame and clear the state when complete. The actual
      // `cx.globalAlpha` override happens inside drawLayer() — drawLayer
      // reads `layer._fadeState.currentOpacity` and uses it INSTEAD OF the
      // reactor's opacity output for the duration of the fade.
      //
      // We also handle layer removal: a fading-out layer with
      // `_fadeState.onComplete` gets removed from Layers.list when its
      // fade finishes. Old layers from a RE-MAP don't hang around in
      // memory; they clean themselves up exactly when the fade ends.
      tickFades() {
        // Read Layers.list via the closure; we walk the array each frame.
        // Cheap — typical 6 layers, no allocations.
        const list = Layers.list;
        const now = performance.now();
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          if (!l._fadeState) continue;
          const f = l._fadeState;
          const t = clamp((now - f.startedAt) / f.durationMs, 0, 1);
          // easeOutCubic — feels natural for a UI fade; fast initial drop,
          // gentle landing. Same easing the audio engine uses elsewhere.
          const e = 1 - Math.pow(1 - t, 3);
          f.currentOpacity = f.fromOpacity + (f.toOpacity - f.fromOpacity) * e;
          if (t >= 1) {
            // Snap to exact target (in case of float drift) and clear state.
            f.currentOpacity = f.toOpacity;
            l.opacity = f.toOpacity;  // also write to canonical field
            const onDone = f.onComplete;
            l._fadeState = null;
            if (typeof onDone === 'function') {
              try { onDone(); } catch (e) { console.warn('[fade] onComplete:', e); }
            }
          }
        }
      },
      applyReactors(layer) {
        // returns {scale, x, y, rot, opacity, hue, brightness, contrast}
        // rot = audio-driven base + per-clip persistent offset (if rotationEnabled)
        // rotationEnabled defaults to true (undefined === true); when false,
        // both manual rotOffset and any rot-target reactors are silenced.
        const enabled = layer.rotationEnabled !== false;
        const out = {
          scale: layer.baseScale,
          x: layer.pos.x, y: layer.pos.y,
          rot: enabled ? (layer.pos.rot || 0) + (layer.rotOffset || 0) : 0,
          opacity: layer.opacity,
          hue: layer.hue,
          brightness: layer.brightness,
          contrast: layer.contrast,
        };
        if (!enabled) {
          // Still apply every non-rot reactor (scale/x/y/opacity/hue/etc) — only
          // rotation is gated by the layer-wide toggle.
          for (const r of (layer.reactors || [])) {
            let v = this.getFeature(r);
            v = this.ease(r.ease, clamp(v, 0, 1)) * r.scale;
            if (r.target === 'scale') out.scale += v;
            else if (r.target === 'x') out.x += v;
            else if (r.target === 'y') out.y += v;
            else if (r.target === 'opacity') out.opacity = clamp(out.opacity + v, 0, 1.5);
            else if (r.target === 'hue') out.hue += v;
            else if (r.target === 'brightness') out.brightness = clamp(out.brightness + v, 0.1, 2.5);
            else if (r.target === 'contrast') out.contrast = clamp(out.contrast + v, 0.1, 2.5);
          }
          return out;
        }
        for (const r of (layer.reactors || [])) {
          let v = this.getFeature(r);
          v = this.ease(r.ease, clamp(v, 0, 1)) * r.scale;
          if (r.target === 'scale') out.scale += v;
          else if (r.target === 'x') out.x += v;
          else if (r.target === 'y') out.y += v;
          else if (r.target === 'rot') out.rot += v;
          else if (r.target === 'opacity') out.opacity = clamp(out.opacity + v, 0, 1.5);
          else if (r.target === 'hue') out.hue += v;
          else if (r.target === 'brightness') out.brightness = clamp(out.brightness + v, 0.1, 2.5);
          else if (r.target === 'contrast') out.contrast = clamp(out.contrast + v, 0.1, 2.5);
        }
        return out;
      },
      drawLayer(layer, cx, w, h) {
        const a = layer.asset;
        if (!a) return;
        let src;
        if (a.type === 'video' || a.type === 'camera') {
          // For video we need an HTMLVideoElement cached on the asset.
          // 'camera' type uses _el.srcObject (a MediaStream) instead of _el.src.
          if (!a._el) {
            a._el = document.createElement('video');
            a._el.muted = true; a._el.loop = true; a._el.playsInline = true;
            a._el.preload = 'auto';
            if (a.type === 'video') a._el.src = a.url;
          }
          src = a._el;
          // Video with a blob URL: drive playback from main audio play state.
          // Camera: srcObject drives its own playback (autoplay); don't pause it.
          if (a.type === 'video') {
            if (Audio.playing && src.paused) src.play().catch(()=>{});
            if (!Audio.playing && !src.paused) src.pause();
          }
          // Camera: ensure playing
          if (a.type === 'camera' && src.paused) src.play().catch(()=>{});
          // Apply trim (in/out points + playback rate) for file videos only.
          // Cameras don't have a meaningful duration to trim against.
          if (a.type === 'video' && a.trim && src.duration) {
            const t = a.trim;
            // Set playbackRate (cheap, idempotent)
            const rate = (t.rate || 1.0);
            if (Math.abs(src.playbackRate - rate) > 0.001) src.playbackRate = rate;
            // Loop inside [in, out] when audio is playing
            if (Audio.playing) {
              const inT  = Math.max(0, t.in  || 0);
              const outT = Math.min(src.duration, t.out || src.duration);
              if (outT > inT + 0.05) {
                if (src.currentTime < inT || src.currentTime >= outT) {
                  // Wrap or jump
                  src.currentTime = inT;
                }
              }
            }
          }
        } else {
          if (!a._el) {
            a._el = new Image();
            a._el.src = a.url;
          }
          src = a._el;
        }
        if ((a.type === 'video' || a.type === 'camera') && src.readyState < 2) return;
        // Image guard: skip drawImage if the Image hasn't finished
        // decoding yet. Without this, drawImage throws
        // "HTMLImageElement in 'broken' state" for one frame after
        // the asset is added (the engine's catch block handles the
        // throw but logs a warning). _el.complete becomes true after
        // load; naturalWidth > 0 means the decode succeeded (not an
        // error result).
        if (a.type === 'image' && (!a._el.complete || !a._el.naturalWidth)) return;
        // Apply the asset's intrinsic rotation (0/90/180/270) to a scratch surface
        // before the layer's reactor-driven draw. CSS/HTML don't honor tkhd or EXIF
        // orientation so we have to compensate here and in _buildThumb().
        let drawSrc = src;
        let drawW = a.w || src.naturalWidth || src.videoWidth || 1;
        let drawH = a.h || src.naturalHeight || src.videoHeight || 1;
        if (a.rotation && (a.rotation === 90 || a.rotation === 270)) {
          // Swap w/h so downstream cover-fit math uses the rotated footprint.
          const tmp = drawW; drawW = drawH; drawH = tmp;
          // Pre-rotate into the existing proc canvas so we don't allocate.
          const p = this.proc, pc = this.procCtx;
          // Don't stomp a hue/brightness/contrast pre-pass — but we only get here
          // if those aren't being used, because the swapped-w fit math below
          // assumes the source matches the swapped dims.  Keeping it simple:
          // we always render the raw rotated asset into proc when rotation is set,
          // and the hue branch (further down) draws `drawSrc = src` through `r`.
          // To keep behavior symmetric across both branches, we cache a CSS-style
          // pre-rotated Image once per asset per rotation change.
          if (!a._rotated || a._rotated.deg !== a.rotation) {
            const sw = drawW, sh = drawH;
            const r = document.createElement('canvas');
            r.width = sw; r.height = sh;
            const rc = r.getContext('2d');
            rc.translate(sw / 2, sh / 2);
            rc.rotate(a.rotation * Math.PI / 180);
            // drawImage uses the ORIGINAL source dimensions because that's the
            // un-rotated intrinsic content; rotation happens around the center.
            const ow = src.naturalWidth || src.videoWidth || drawH;
            const oh = src.naturalHeight || src.videoHeight || drawW;
            rc.drawImage(src, -ow / 2, -oh / 2);
            a._rotated = { deg: a.rotation, canvas: r };
          }
          drawSrc = a._rotated.canvas;
        }
        const r = this.applyReactors(layer);
        cx.save();
        cx.globalCompositeOperation = layer.blend || 'source-over';
        // If a fade is in progress on this layer, override the reactor's
        // opacity output with the fade's current value. This is what
        // makes RE-MAP swap smoothly — old layers fade out, new layers
        // fade in, all while the rest of the engine keeps running.
        let finalOpacity = clamp(r.opacity, 0, 1);
        if (layer._fadeState) {
          finalOpacity = clamp(layer._fadeState.currentOpacity, 0, 1);
        }
        cx.globalAlpha = finalOpacity;
        const cw = cx.canvas.width, chh = cx.canvas.height;
        // Hue/brightness/contrast pre-pass: draw asset into proc, then composite with filter
        if (Math.abs(r.hue) > 0.5 || Math.abs(r.brightness - 1) > 0.01 || Math.abs(r.contrast - 1) > 0.01) {
          const p = this.proc;
          const pc = this.procCtx;
          pc.clearRect(0, 0, p.width, p.height);
          pc.filter = `hue-rotate(${r.hue}deg) brightness(${r.brightness}) contrast(${r.contrast})`;
          // cover-fit (uses swapped w/h so the pre-rotated asset fits the canvas)
          const ar = drawW / drawH;
          const canvasAR = cw / chh;
          let dw, dh, dx, dy;
          if (ar > canvasAR) {
            dh = chh; dw = dh * ar; dx = (cw - dw) / 2; dy = 0;
          } else {
            dw = cw; dh = dw / ar; dx = 0; dy = (chh - dh) / 2;
          }
          const scale = r.scale;
          dw *= scale; dh *= scale;
          dx = (cw - dw) / 2 + r.x; dy = (chh - dh) / 2 + r.y;
          if (r.rot) {
            pc.translate(cw / 2 + r.x, chh / 2 + r.y);
            pc.rotate(r.rot * Math.PI / 180);
            pc.drawImage(drawSrc, -dw / 2, -dh / 2, dw, dh);
          } else {
            pc.drawImage(drawSrc, dx, dy, dw, dh);
          }
          pc.filter = 'none';
          cx.drawImage(p, 0, 0);
        } else {
          // Fast path: draw directly (uses swapped w/h so the pre-rotated asset fits)
          cx.save();
          if (r.rot) {
            cx.translate(cw / 2 + r.x, chh / 2 + r.y);
            cx.rotate(r.rot * Math.PI / 180);
            const ar = drawW / drawH;
            const canvasAR = cw / chh;
            let dw, dh;
            if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; }
            else { dw = cw * r.scale; dh = dw / ar; }
            cx.drawImage(drawSrc, -dw / 2, -dh / 2, dw, dh);
          } else {
            const ar = drawW / drawH;
            const canvasAR = cw / chh;
            let dw, dh, dx, dy;
            if (ar > canvasAR) { dh = chh * r.scale; dw = dh * ar; dx = (cw - dw) / 2 + r.x; dy = 0 + r.y; }
            else { dw = cw * r.scale; dh = dw / ar; dx = 0 + r.x; dy = (chh - dh) / 2 + r.y; }
            cx.drawImage(drawSrc, dx, dy, dw, dh);
          }
          cx.restore();
        }
        cx.restore();
      },
      drawPaletteOverlay(cx) {
        // Soft vignette + palette tint based on centroid
        const c = Audio.feat.centroid;
        const w = cx.canvas.width, h = cx.canvas.height;
        const grad = cx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w, h) * 0.7);
        const palette = $('palette').value;
        const colors = {
          neon:  ['rgba(255, 61, 146, 0.18)', 'rgba(0, 229, 255, 0.10)'],
          solar: ['rgba(255, 210, 74, 0.18)', 'rgba(255, 122, 61, 0.10)'],
          ocean: ['rgba(0, 229, 255, 0.16)', 'rgba(80, 0, 255, 0.10)'],
          mono:  ['rgba(255, 255, 255, 0.10)', 'rgba(0, 0, 0, 0.20)'],
        }[palette];
        grad.addColorStop(0, colors[0]);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        cx.save();
        cx.globalCompositeOperation = 'screen';
        cx.fillStyle = grad;
        cx.fillRect(0, 0, w, h);
        // subtle vignette
        const vg = cx.createRadialGradient(w/2, h/2, Math.max(w, h) * 0.3, w/2, h/2, Math.max(w, h) * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.55)');
        cx.globalCompositeOperation = 'multiply';
        cx.fillStyle = vg;
        cx.fillRect(0, 0, w, h);
        cx.restore();
      },
      drawFlash(cx) {
        const beat = Audio.feat.beat;
        if (beat < 0.05) return;
        cx.save();
        cx.globalCompositeOperation = 'screen';
        cx.fillStyle = `rgba(255, 255, 255, ${beat * 0.3})`;
        cx.fillRect(0, 0, cx.canvas.width, cx.canvas.height);
        cx.restore();
      },
      drawMeter() {
        const w = meterCanvas.width, h = meterCanvas.height;
        const cx = meterCtx;
        cx.fillStyle = '#0d0918';
        cx.fillRect(0, 0, w, h);
        // Draw 5 vertical bars
        const sens = parseFloat($('sensitivity').value);
        const vals = [
          Audio.feat.sub * sens, Audio.feat.bass * sens, Audio.feat.mid * sens,
          Audio.feat.treble * sens, Audio.feat.air * sens,
        ];
        const barW = w / vals.length;
        for (let i = 0; i < vals.length; i++) {
          const v = clamp(vals[i], 0, 1);
          const bh = v * h;
          const x = i * barW + 2;
          const y = h - bh;
          const g = cx.createLinearGradient(0, y, 0, h);
          if (i < 2) { g.addColorStop(0, '#ff3d92'); g.addColorStop(1, '#ffd24a'); }
          else if (i < 3) { g.addColorStop(0, '#ffd24a'); g.addColorStop(1, '#00e5ff'); }
          else { g.addColorStop(0, '#00e5ff'); g.addColorStop(1, '#00ffa3'); }
          cx.fillStyle = g;
          cx.fillRect(x, y, barW - 4, bh);
        }
        // BPM line
        if (Audio.feat.bpm) {
          cx.fillStyle = '#00ffa3';
          cx.font = '10px ui-monospace';
          cx.fillText(Audio.feat.bpm + 'bpm', 4, 10);
        }
      },
      // v2: draw BPM + key in the bottom-right corner when recording,
      // so the exported video carries the analysis metadata.
      drawRecordingOverlay(cx) {
        const w = cx.canvas.width, h = cx.canvas.height;
        const f = Audio.feat;
        const parts = [];
        if (f.bpm) parts.push('BPM ' + f.bpm);
        if (f.key) parts.push(f.key + ' ' + (f.scale || 'major'));
        if (!parts.length) return;
        const text = parts.join(' · ');
        cx.save();
        cx.font = '600 18px ui-monospace, Menlo, monospace';
        const metrics = cx.measureText(text);
        const padX = 14, padY = 8;
        const boxW = metrics.width + padX * 2;
        const boxH = 30;
        const x = w - boxW - 16;
        const y = h - boxH - 16;
        cx.fillStyle = 'rgba(5, 3, 8, 0.72)';
        cx.fillRect(x, y, boxW, boxH);
        cx.strokeStyle = 'rgba(255, 61, 146, 0.55)';
        cx.lineWidth = 1;
        cx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
        cx.fillStyle = '#f5e9ff';
        cx.textBaseline = 'middle';
        cx.fillText(text, x + padX, y + boxH / 2);
        // Tiny red dot to mark recording
        cx.fillStyle = '#ff7a3d';
        cx.beginPath();
        cx.arc(x + boxW - 12, y + boxH / 2, 4, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
      },
      // ============================================================
      // DRAG / DRIFT INTERACTION
      // ============================================================
      // Convert a mouse/pointer event to canvas coordinates
      eventToCanvas(e) {
        const rect = stageCanvas.getBoundingClientRect();
        const sx = stageCanvas.width / rect.width;
        const sy = stageCanvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * sx,
          y: (e.clientY - rect.top) * sy,
        };
      },
      // Find the topmost layer under a canvas-space point.
      // Hit test uses a centered circle of radius R, ignoring rotation.
      pickLayer(cx, cy) {
        const sorted = Layers.list.slice().sort((a, b) => b.z - a.z);
        for (const l of sorted) {
          if (!l.asset) continue;
          const r = this.applyReactors(l);
          const cxw = stageCanvas.width, chh = stageCanvas.height;
          const lx = cxw / 2 + r.x;
          const ly = chh / 2 + r.y;
          // Estimate visible radius from baseScale
          const w = (l.asset.w || 1) * r.scale;
          const h = (l.asset.h || 1) * r.scale;
          const rad = Math.max(w, h) * 0.4;
          const dx = cx - lx, dy = cy - ly;
          if (dx * dx + dy * dy < rad * rad) return l;
        }
        return null;
      },
      // Draw a draggable selection box around a layer
      drawSelection(cx, layer) {
        const r = this.applyReactors(layer);
        const cw = stageCanvas.width, chh = stageCanvas.height;
        const lx = cw / 2 + r.x;
        const ly = chh / 2 + r.y;
        const w = (layer.asset?.w || 100) * r.scale * 0.55;
        const h = (layer.asset?.h || 100) * r.scale * 0.55;
        cx.save();
        cx.strokeStyle = '#ff2d8a';
        cx.lineWidth = 2;
        cx.setLineDash([8, 6]);
        cx.strokeRect(lx - w, ly - h, w * 2, h * 2);
        cx.fillStyle = '#ff2d8a';
        cx.setLineDash([]);
        cx.beginPath();
        cx.arc(lx, ly, 4, 0, Math.PI * 2);
        cx.fill();
        // "DRAG" label
        cx.font = '11px ui-monospace';
        cx.fillStyle = '#ff2d8a';
        cx.textBaseline = 'top';
        cx.fillText('● DRAG', lx + w + 6, ly - 6);
        cx.restore();
      },
      onPointerDown(e) {
        if (this.dragMode !== 'manual') return;
        if (e.button !== 0) return;
        const { x, y } = this.eventToCanvas(e);
        const hit = this.pickLayer(x, y);
        if (hit) {
          this.selectedLayer = hit;
          this.dragging = true;
          this.dragStart = { x, y };
          this.layerStart = { x: hit.pos.x, y: hit.pos.y };
          stageCanvas.setPointerCapture(e.pointerId);
          e.preventDefault();
        }
      },
      onPointerMove(e) {
        if (!this.dragging || !this.selectedLayer) return;
        const { x, y } = this.eventToCanvas(e);
        this.selectedLayer.pos.x = this.layerStart.x + (x - this.dragStart.x);
        this.selectedLayer.pos.y = this.layerStart.y + (y - this.dragStart.y);
        e.preventDefault();
      },
      onPointerUp(e) {
        if (!this.dragging) return;
        this.dragging = false;
        this.selectedLayer = null;
        this.dragStart = null;
        this.layerStart = null;
        try { stageCanvas.releasePointerCapture(e.pointerId); } catch {}
      },
      // Set dragMode and update UI button label
      setDragMode(mode) {
        this.dragMode = mode;
        const btn = $('drag-mode');
        if (btn) {
          btn.textContent = mode === 'auto' ? 'AUTO DRIFT' : 'MANUAL DRAG';
          btn.classList.toggle('primary', mode === 'manual');
        }
        // Reset selection when switching back to auto
        if (mode === 'auto') {
          this.dragging = false;
          this.selectedLayer = null;
        }
      },
      loop(t) {
        if (!this.running) return;
        const dt = (t - this.lastFrame) / 1000;
        this.lastFrame = t;
        this.fps = lerp(this.fps, 1 / Math.max(dt, 0.0001), 0.05);
        $('fps-v').textContent = Math.round(this.fps) + ' fps';
        // Sample audio features
        if (Audio.playing) Audio.sample();
        // Smooth features
        const a = Audio.feat, s = this.smooth;
        const k = 0.18;
        s.bass = lerp(s.bass, a.bass, k);
        s.mid = lerp(s.mid, a.mid, k);
        s.treble = lerp(s.treble, a.treble, k);
        s.air = lerp(s.air, a.air, k);
        s.rms = lerp(s.rms, a.rms, k);
        s.beat = lerp(s.beat, a.beat, 0.22);          // decay so opacity doesn't latch on
        s.onset = lerp(s.onset, a.onset, 0.30);        // snappier decay for strobey hits
        s.centroid = lerp(s.centroid, a.centroid, k);
        // Auto-drift: gentle continuous motion when in auto mode.
        // Each layer gets a phase offset so they don't all move in sync.
        this._t += Math.max(dt, 0.0001);
        // Advance the bar counter for the Story runtime. Cheap (a single
        // division + floor); no-op when BPM unknown.
        if (Audio && typeof Audio._tickBar === 'function') Audio._tickBar();
        // Drive the Story runtime: evolve on everyBars, advance on trigger.
        if (typeof Story !== 'undefined' && typeof Story.tick === 'function') {
          try { Story.tick(); } catch (_) { /* don't crash the rAF on story errors */ }
        }
        if (this.dragMode === 'auto') {
          for (let i = 0; i < Layers.list.length; i++) {
            const l = Layers.list[i];
            const ph = i * 1.37;  // per-layer phase
            const t = this._t;
            // Smooth slow drift, scaled by audio energy (mid → x, treble → y, beat → rot kick)
            const eMid = s.mid, eTre = s.treble, eBeat = s.beat;
            l.pos.x = Math.sin(t * 0.35 + ph) * 22 + eMid * 18;
            l.pos.y = Math.cos(t * 0.28 + ph * 0.7) * 18 + eTre * 14;
            l.pos.rot = Math.sin(t * 0.22 + ph * 0.5) * 3.2 + eBeat * 6;
            // v2: snap-to-beat (compute nearest beat for layers that opted in)
            if (l.snapBeat && Audio._beatGrid && Audio._beatGrid.length) {
              const now = Audio.ctx ? Audio.ctx.currentTime : 0;
              const grid = Audio._beatGrid;
              let nearest = grid[0];
              let bestDist = Math.abs(grid[0] - now);
              for (let g = 1; g < grid.length; g++) {
                const d = Math.abs(grid[g] - now);
                if (d < bestDist) { bestDist = d; nearest = grid[g]; }
              }
              l._beatOffset = nearest;
            }
          }
        }
        // Clear
        const cx = stageCtx;
        cx.fillStyle = '#000';
        cx.fillRect(0, 0, cx.canvas.width, cx.canvas.height);
        // Advance any layer opacity fades (RE-MAP swap, layer add, etc).
        // Cheap — one pass over Layers.list per frame; each layer's
        // _fadeState is just 5 numbers and a done callback.
        this.tickFades();
        // Advance any 3D layers: each 3D layer's WebGL output canvas
        // is re-rendered with the current audio features baked into the
        // mesh transforms. Runs BEFORE the draw loop so drawLayer can
        // drawImage(asset._el) against the freshly-rendered canvas.
        // Safe no-op if SWR_3D isn't loaded (older engine.html / variants).
        if (window.SWR_3D && typeof window.SWR_3D.tickAll === 'function') {
          window.SWR_3D.tickAll(t || 0);
        }
        // Draw layers in z order
        const sorted = Layers.list.slice().sort((a, b) => a.z - b.z);
        for (const l of sorted) this.drawLayer(l, cx, cx.canvas.width, cx.canvas.height);
        // Selection outline (in manual mode, when a layer is being dragged)
        if (this.dragMode === 'manual' && this.selectedLayer) {
          this.drawSelection(cx, this.selectedLayer);
        }
        // Palette + flash
        this.drawPaletteOverlay(cx);
        this.drawFlash(cx);
        this.drawMeter();
        // v2: recording overlay — burn BPM + key into the captured video
        if (Recorder.recording) {
          this.drawRecordingOverlay(cx);
        }
        // DOM flash
        if (Audio.feat.beat > 0.3) {
          stageFlash.style.opacity = String(Audio.feat.beat * 0.4);
        } else {
          stageFlash.style.opacity = '0';
        }
        requestAnimationFrame((tt) => this.loop(tt));
      },
      start() {
        if (this.running) return;
        this.running = true;
        this.lastFrame = performance.now();
        requestAnimationFrame((t) => this.loop(t));
      },
    };

    // ======================================================================
    // SIZE PRESETS — exported video dimensions
    // ======================================================================
    // 4 presets covering the platforms musicians actually post to. The
    // engine re-fits the stage + FX canvas to the preset on record start,
    // so the exported MP4 actually matches the chosen aspect ratio at
    // full quality (was: capture whatever size fit() last set, which
    // depended on the browser window).
    //
    // Why these specific resolutions:
    //   - YouTube 16:9: 1920×1080 is the canonical "1080p" target. YouTube
    //     accepts anything but encodes best at multiples of 1080. 1920 is
    //     also the max for the on-screen viewport in this engine.
    //   - Square 1:1: 1080×1080 — Instagram feed, also a nice preview
    //     size that works on every platform.
    //   - Reel/TikTok 9:16: 1080×1920 — both platforms use the same
    //     dimensions. Single preset covers both, with a label that hints
    //     at the target. 1920 is the height the user sees on a phone.
    //   - Instagram 4:5: 1080×1350 — IG's preferred portrait/feed aspect
    //     (max that doesn't get cropped to 1:1 in the feed).
    window.SIZE_PRESETS = {
      landscape: { w: 1920, h: 1080, label: 'YouTube 16:9' },
      square:    { w: 1080, h: 1080, label: 'Square 1:1' },
      portrait:  { w: 1080, h: 1350, label: 'Instagram 4:5' },
      reel:      { w: 1080, h: 1920, label: 'Reel / TikTok 9:16' },
    };
    // Aliases so the UI can use either name.
    window.SIZE_PRESETS.youtube = window.SIZE_PRESETS.landscape;
    window.SIZE_PRESETS.instagram = window.SIZE_PRESETS.portrait;
    window.SIZE_PRESETS.tiktok = window.SIZE_PRESETS.reel;

    // ======================================================================
    // RECORDER
    // ======================================================================
    const Recorder = {
      rec: null,
      chunks: [],
      recording: false,
      mime: 'video/webm',
      mediaDest: null,
      autoStopAt: 0,    // ms timestamp at which to auto-stop
      autoStopTimer: null,
      progressTimer: null,
      progressEl: null,
      startedAt: 0,
      watermarkImg: null,  // preloaded HTMLImageElement (or null)
      watermarkKey: 'none',// 'a' | 'b' | 'c' | 'none'
      _watermarkFrame: 0,  // throttle to ~30fps inside rAF

      // Preload watermark image based on the current #rec-wm selector value.
      _loadWatermark(key) {
        if (key === 'none' || !key) {
          this.watermarkImg = null;
          this.watermarkKey = 'none';
          return;
        }
        const img = new Image();
        // Use the PNG render (engine bundles same path as the SVG fallback).
        // CrossOrigin anonymous to avoid tainting the canvas during captureStream.
        img.crossOrigin = 'anonymous';
        img.src = `./swr-watermark-${key}.png`;
        img.onload = () => {
          this.watermarkImg = img;
          this.watermarkKey = key;
        };
        img.onerror = () => {
          // Fallback: try SVG
          const svg = new Image();
          svg.crossOrigin = 'anonymous';
          svg.src = `./swr-watermark-${key}.svg`;
          svg.onload = () => { this.watermarkImg = svg; this.watermarkKey = key; };
        };
      },

      // Draw watermark on the capture canvas (called every frame during recording).
      // Placed bottom-right with safe-area margins; opacity 0.6 to read on any background.
      // PT-licensed users: watermark is suppressed (consumes 1 credit/min).
      _drawWatermark(ctx, w, h) {
        // PT license suppresses the watermark — the user paid for the watermark removal
        if (window.SWR_PT && window.SWR_PT.isActive && window.SWR_PT.isActive()) {
          return;
        }
        if (!this.watermarkImg || !this.watermarkImg.complete || this.watermarkImg.naturalWidth === 0) return;
        const img = this.watermarkImg;
        // Scale: 18% of frame width (per swr-watermark-plan.md), preserving aspect ratio.
        // Watermarks: A=720x240 (3:1), B=1440x400 (3.6:1), C=720x960 (3:4)
        const targetW = Math.round(w * 0.18);
        const aspect = img.naturalHeight / img.naturalWidth;
        const targetH = Math.round(targetW * aspect);
        // Position: bottom-right with 24px margin (out of 720p frame), scaled proportionally
        const margin = Math.round(Math.min(w, h) * 0.033);  // ~24px @ 720p
        const x = w - targetW - margin;
        const y = h - targetH - margin;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.drawImage(img, x, y, targetW, targetH);
        ctx.restore();
      },
      start() {
        if (!Audio.audioEl) return;
        // Compute auto-stop deadline from #rec-dur selector
        const durSel = $('rec-dur') ? $('rec-dur').value : '0';
        let durMs = 0;
        if (durSel === 'song' && Audio.audioEl && Audio.audioEl.duration) {
          const remaining = (Audio.audioEl.duration - Audio.audioEl.currentTime) * 1000;
          durMs = Math.max(0, remaining);
        } else if (durSel !== '0' && durSel !== 'manual') {
          durMs = parseInt(durSel) * 1000;
        }
        this.autoStopAt = durMs > 0 ? Date.now() + durMs : 0;
        // ---- WebCodecs path (off by default; opt in with SWR_RECORDER_WORKER=1)
        // The encode moves to a Web Worker; the main thread keeps producing
        // rAF frames via VideoFrame. Video-only for now; audio lands in a
        // follow-up. Falls back to the MediaRecorder path on any failure.
        if (window.SWR_RECORDER_WORKER && window.SWR_RECORDER && window.SWR_RECORDER.canUseWebCodecs()) {
          return this._startWebCodecs();
        }
        const fps = 24;

        // ---- SIZE PRESET: re-fit the canvas to the chosen export resolution
        // so the recorded MP4/WebM actually matches the chosen aspect ratio
        // (was previously: capture whatever size fit() last set, which
        // depended on the browser window — exported files were often
        // stretched or at the wrong aspect ratio). The on-screen view
        // visibly resizes for the duration of recording, then we restore
        // it on stop.
        const sizeKey = $('rec-size') ? $('rec-size').value : 'landscape';
        const preset = (window.SIZE_PRESETS && window.SIZE_PRESETS[sizeKey]) || window.SIZE_PRESETS.landscape;
        const prevSize = { w: stageCanvas.width, h: stageCanvas.height };
        const newSize = Renderer.fitToSize(preset.w, preset.h);
        // Stash so stop() can restore the on-screen size
        this._prevCanvasSize = prevSize;
        this._exportSize = newSize;
        this._sizeLabel = preset.label;
        this._sizeKey = sizeKey;

        // Capture from FX canvas if present (it includes temperature/mutations/GLSL),
        // otherwise fall back to the raw 2D stage.
        const captureCanvas = (window.FX && window.FX.outputCanvas) || stageCanvas;
        const vstream = captureCanvas.captureStream(fps);
        // Audio routing for the recorder. Previously this connected the
        // analyser DIRECTLY to a MediaStreamDestination, bypassing
        // Audio.gain — which meant a gain-only fade would fix the speakers
        // but leave the exported file clipping. Re-route through Audio.gain
        // (the same node that drives the speakers) so the exported MP4/WebM
        // captures the same fade envelope the user hears.
        if (typeof Audio.gain === 'undefined' || !Audio.ctx) {
          setStatus('audio context not ready — start playback first', 'err');
          return;
        }
        if (!Audio.gain._recTee) {
          // Lazily create a permanent MediaStreamDestination on the gain
          // node. We keep one instance for the recorder's lifetime so we
          // don't connect/disconnect on every start/stop (avoids clicks).
          Audio.gain._recTee = Audio.ctx.createMediaStreamDestination();
          Audio.gain.connect(Audio.gain._recTee);
        }
        this.mediaDest = Audio.gain._recTee;
        const astream = this.mediaDest.stream;
        const tracks = [...vstream.getVideoTracks(), ...astream.getAudioTracks()];
        const stream = new MediaStream(tracks);
        // Stash the session's MediaStream so stop() can release its tracks
        // without disconnecting the underlying gain graph (which would
        // kill the speakers — see the routing note in start()).
        this._recStream = stream;
        if (typeof setStatus === 'function') {
          setStatus(`recording · ${this._sizeLabel} · ${newSize.width}×${newSize.height}`, 'ok');
        }
        // Pick the best supported codec. Prefer real MP4 (H.264 + AAC) when
        // available — Chrome 126+ and Safari 14.5+ ship it natively and
        // it matches the .mp4 extension in the filename. Fall back to WebM
        // and save with the matching .webm extension so the file is actually
        // playable in the user's editor.
        const mime = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=h264,aac',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ].find(m => {
          try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
        }) || 'video/webm';
        this.mime = mime;
        // Bitrate scales with resolution to keep quality consistent across
        // presets. 8 Mbps was the old single value (1080p); square/portrait
        // need roughly the same bitrate per pixel, so we adjust.
        const pixels = newSize.width * newSize.height;
        const refPixels = 1920 * 1080;     // 2,073,600 — old reference
        const refBits  = 8_000_000;
        const bits = Math.max(4_000_000, Math.round(refBits * pixels / refPixels));
        try {
          this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
        } catch (err) {
          setStatus(`recorder error: ${err.message || err}`, 'err');
          return;
        }
        this.chunks = [];
        this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        this.rec.onstop = () => this._save();
        this.rec.onerror = (e) => {
          setStatus(`recorder error: ${e.error && e.error.message || 'unknown'}`, 'err');
          this.stop();
        };
        try {
          this.rec.start(500);
        } catch (err) {
          setStatus(`recorder start failed: ${err.message || err}`, 'err');
          return;
        }
        this.recording = true;
        this.startedAt = Date.now();
        $('rec').classList.add('live');
        $('rec').textContent = '■ STOP';
        // Preload the watermark image based on the user's selector choice
        const wmSel = $('rec-wm') ? $('rec-wm').value : 'none';
        this._loadWatermark(wmSel);
        // PT watermark-free status indicator (no credit consumed at start —
        // the engine charges the renderer on stop, with a final cost based
        // on actual duration; for 'song' mode we know it up front).
        if (window.SWR_PT && window.SWR_PT.isActive && window.SWR_PT.isActive()) {
          const lic = window.SWR_PT.load();
          setStatus(`recording · watermark removed · ${lic.credits} credits left`, 'live');
          if (window.SWR_PT_Panel && window.SWR_PT_Panel.renderChip) window.SWR_PT_Panel.renderChip();
        }
        // Start a dedicated rAF that draws the watermark on the capture canvas every frame.
        // This is decoupled from the engine's main render loop so watermark style can be
        // changed per-render without touching the FX/Stage code.
        if (this._wmRaf) cancelAnimationFrame(this._wmRaf);
        const drawOne = () => {
          if (!this.recording) return;
          if (this.watermarkImg && this.watermarkImg.complete) {
            try {
              const ctx = captureCanvas.getContext('2d');
              if (ctx) this._drawWatermark(ctx, captureCanvas.width, captureCanvas.height);
            } catch (e) {
              // captureStream may have failed; silently skip
            }
          }
          this._wmRaf = requestAnimationFrame(drawOne);
        };
        this._wmRaf = requestAnimationFrame(drawOne);
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const totalSec = durMs > 0 ? Math.round(durMs / 1000) : 0;
        // Initial status
        setStatus(totalSec > 0
          ? `recording · ${ext.toUpperCase()} · 0 / ${totalSec}s · 0.0 MB`
          : `recording · ${ext.toUpperCase()}`,
          'live');
        // Live progress ticker
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = setInterval(() => {
          if (!this.recording) return;
          const elapsedSec = Math.floor((Date.now() - this.startedAt) / 1000);
          const totalBytes = this.chunks.reduce((s, c) => s + c.size, 0);
          const mb = (totalBytes / (1024 * 1024)).toFixed(1);
          if (totalSec > 0) {
            setStatus(`recording · ${ext.toUpperCase()} · ${elapsedSec} / ${totalSec}s · ${mb} MB`, 'live');
          } else {
            setStatus(`recording · ${ext.toUpperCase()} · ${elapsedSec}s · ${mb} MB`, 'live');
          }
        }, 1000);
        if (this.autoStopAt > 0) {
          this.autoStopTimer = setTimeout(() => {
            if (this.recording) this.stop();
          }, Math.max(50, this.autoStopAt - Date.now()));
        }
      },
      // ---- WebCodecs recording path (P2) -------------------------------
      // Encode runs in a Web Worker; the main thread sends VideoFrame
      // objects per rAF. The orchestrator resolves with a single MP4
      // blob on stop. Audio is not yet wired — this path is video-only.
      async _startWebCodecs() {
        const sizeKey = $('rec-size') ? $('rec-size').value : 'landscape';
        const preset = (window.SIZE_PRESETS && window.SIZE_PRESETS[sizeKey]) || window.SIZE_PRESETS.landscape;
        const prevSize = { w: stageCanvas.width, h: stageCanvas.height };
        const newSize = Renderer.fitToSize(preset.w, preset.h);
        this._prevCanvasSize = prevSize;
        this._exportSize = newSize;
        this._sizeLabel = preset.label;
        this._sizeKey = sizeKey;
        const captureCanvas = (window.FX && window.FX.outputCanvas) || stageCanvas;
        this.mime = 'video/mp4';
        this.chunks = [];
        this._wcActive = true;
        this._wcResult = null;
        const pixels = newSize.width * newSize.height;
        const refPixels = 1920 * 1080;
        const refBits  = 8_000_000;
        const bits = Math.max(4_000_000, Math.round(refBits * pixels / refPixels));
        if (typeof setStatus === 'function') {
          setStatus(`recording · ${this._sizeLabel} · ${newSize.width}×${newSize.height} · WebCodecs`, 'ok');
        }
        try {
          this._wcStartPromise = window.SWR_RECORDER.start({
            canvas: captureCanvas,
            width: newSize.width,
            height: newSize.height,
            fps: 24,
            videoBitsPerSecond: bits,
          });
        } catch (e) {
          if (e && e.unsupported) {
            setStatus('WebCodecs unsupported, falling back to MediaRecorder', 'warn');
            this._wcActive = false;
            // Re-enter the standard path. SWR_RECORDER_WORKER is toggled off
            // for the recursive call so start() takes the MediaRecorder
            // branch instead of bouncing back into _startWebCodecs (which
            // would throw unsupported again and infinite-loop). The flag
            // is restored in `finally` so the next visit still opts in.
            const prevFlag = window.SWR_RECORDER_WORKER;
            window.SWR_RECORDER_WORKER = false;
            this._prevCanvasSize = null;
            try { this.start(); } finally { window.SWR_RECORDER_WORKER = prevFlag; }
            return;
          }
          setStatus(`recorder start failed: ${e.message || e}`, 'err');
          this._wcActive = false;
          return;
        }
        this.recording = true;
        this.startedAt = Date.now();
        $('rec').classList.add('live');
        $('rec').textContent = '■ STOP';
        // Preload watermark
        const wmSel = $('rec-wm') ? $('rec-wm').value : 'none';
        this._loadWatermark(wmSel);
        // PT license chip
        if (window.SWR_PT && window.SWR_PT.isActive && window.SWR_PT.isActive()) {
          const lic = window.SWR_PT.load();
          setStatus(`recording · WebCodecs · watermark removed · ${lic.credits} credits left`, 'live');
          if (window.SWR_PT_Panel && window.SWR_PT_Panel.renderChip) window.SWR_PT_Panel.renderChip();
        }
        // Live progress ticker (size unknown until stop; show duration only)
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = setInterval(() => {
          if (!this.recording) return;
          const elapsedSec = Math.floor((Date.now() - this.startedAt) / 1000);
          const totalSec = Math.max(0, Math.round((this.autoStopAt - Date.now()) / 1000));
          if (this.autoStopAt > 0) {
            setStatus(`recording · WebCodecs · ${elapsedSec}/${totalSec}s`, 'live');
          } else {
            setStatus(`recording · WebCodecs · ${elapsedSec}s`, 'live');
          }
        }, 1000);
        // Auto-stop
        if (this.autoStopAt > 0) {
          this.autoStopTimer = setTimeout(() => {
            if (this.recording) this.stop();
          }, Math.max(50, this.autoStopAt - Date.now()));
        }
      },
      stop() {
        // WebCodecs path (P2): the orchestrator owns the encode worker
        // and the stop handshake. _save() needs the same (chunks, mime)
        // shape it always consumed, so we materialize the final blob as
        // a single-entry chunks array and re-enter the standard _save
        // pipeline.
        if (this._wcActive) {
          if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
          if (this.progressTimer) { clearInterval(this.progressTimer); this.progressTimer = null; }
          if (this._wmRaf) { cancelAnimationFrame(this._wmRaf); this._wmRaf = null; }
          this._wcActive = false;
          this.recording = false;
          $('rec').classList.remove('live');
          $('rec').textContent = '● REC';
          if (this._prevCanvasSize) {
            try { Renderer.fitToSize(this._prevCanvasSize.w, this._prevCanvasSize.h); } catch (e) {}
            this._prevCanvasSize = null;
          }
          window.SWR_RECORDER.stop().then((res) => {
            this.chunks = [res.blob];
            this.mime = res.mime;
            this._save();
          }).catch((err) => {
            setStatus(`recorder stop failed: ${err.message || err}`, 'err');
          });
          return;
        }
        if (!this.rec) return;
        if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
        if (this.progressTimer) { clearInterval(this.progressTimer); this.progressTimer = null; }
        if (this._wmRaf) { cancelAnimationFrame(this._wmRaf); this._wmRaf = null; }
        try {
          this.rec.stop();
        } catch (err) {
          setStatus(`recorder stop failed: ${err.message || err}`, 'err');
        }
        this.recording = false;
        $('rec').classList.remove('live');
        $('rec').textContent = '● REC';
        // Restore the on-screen canvas to the size it had before we re-fitted
        // for recording — otherwise the engine would stay at the export
        // resolution (e.g. 1080×1920) until the next window resize.
        if (this._prevCanvasSize) {
          try { Renderer.fitToSize(this._prevCanvasSize.w, this._prevCanvasSize.h); }
          catch (e) {}
          this._prevCanvasSize = null;
          this._exportSize = null;
          this._sizeLabel = null;
        }
        // Show honest "rendering" status; the blob is finalized in onstop,
        // which fires asynchronously after this method returns.
        const totalBytes = this.chunks.reduce((s, c) => s + c.size, 0);
        setStatus(`finalizing · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB captured…`, 'live');
        // End the MediaStream tracks but DO NOT disconnect the gain node
        // (which would also kill the speakers). The new architecture
        // uses a permanent tee on Audio.gain (Audio.gain._recTee) — the
        // recorder's MediaStream is derived from that tee's stream. Each
        // recording session gets a fresh MediaStream, so we end the
        // session's tracks here without touching the gain graph.
        if (this._recStream) {
          try {
            this._recStream.getTracks().forEach((t) => {
              try { t.stop(); } catch (_) {}
            });
          } catch (_) {}
          this._recStream = null;
        }
      },
      _save() {
        const blob = new Blob(this.chunks, { type: this.mime });
        if (blob.size === 0) {
          setStatus('export failed: 0 bytes captured', 'err');
          return;
        }
        // SWR_STATS instrumentation (engine parity with music_video.html).
        try {
          if (window.SWR_STATS && this.startedAt) {
            const durationMs = Date.now() - this.startedAt;
            const size = (this.chunks || []).reduce((a, c) => a + c.size, 0);
            window.SWR_STATS.record(durationMs, this.mime || 'video/webm', size);
          }
        } catch (_) {}
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        // Include the size preset key in the filename so users can tell
        // exports apart at a glance when they drop multiple in the same
        // folder:  sainted-word-reel-2026-08-23T01-30-12.mp4
        const sizeTag = this._sizeKey || (this._sizeLabel ? this._sizeLabel.toLowerCase().split(' ')[0] : null) || 'landscape';
        a.download = `sainted-word-${sizeTag}-${ts}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        // Charge PT credits for the export (1 credit / minute at 1080p).
        // Free users pay nothing — they just get the watermark.
        if (window.SWR_PT && window.SWR_PT.isActive && window.SWR_PT.isActive()) {
          const durationSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
          const res = window.SWR_PT.consumeForRender(durationSec, '1080p');
          if (res.ok) {
            setStatus(`exported · ${ext.toUpperCase()} · ${mb} MB · ${res.creditsAfter} credits left`, 'ok');
          } else {
            setStatus(`exported · ${ext.toUpperCase()} · ${mb} MB · ${res.error || 'credit error'}`, 'warn');
          }
          if (window.SWR_PT_Panel && window.SWR_PT_Panel.renderChip) window.SWR_PT_Panel.renderChip();
        } else {
          setStatus(`exported · ${ext.toUpperCase()} · ${mb} MB`, 'ok');
        }
      },
    };

    // ======================================================================
    // UI WIRING
    // ======================================================================
    const UI = {
      init() {
        // Transport
        $('load-song').addEventListener('click', () => $('song-input').click());
        $('song-input').addEventListener('change', (e) => {
          if (e.target.files[0]) Audio.loadFile(e.target.files[0]);
        });
        $('play').addEventListener('click', () => {
          if (!Audio.audioEl) return;
          if (Audio.playing) Audio.pause(); else Audio.play();
        });
        $('rec').addEventListener('click', () => {
          if (Recorder.recording) Recorder.stop(); else Recorder.start();
        });
      // === Export video (one-click 30s WebM) ===
      $('export-video').addEventListener('click', () => {
        if (Recorder.recording) { Recorder.stop(); return; }
        if (!Audio.audioEl) { UI.setStatus && UI.setStatus('load a song first', 'warn'); return; }
        // Auto-play so the recording has audio, then stop after the song's
        // full duration (or 30s cap if 'manual' is selected)
        if (!Audio.playing) Audio.play();
        const durSel = $('rec-dur');
        const dur = durSel ? durSel.value : '30';
        const ms = (dur === 'song' && Audio.audioEl.duration)
          ? Math.max(1000, Math.floor(Audio.audioEl.duration * 1000))
          : (dur === '0' ? 0 : (parseInt(dur, 10) || 30) * 1000);
        Recorder.start(ms);
        UI.setStatus && UI.setStatus(`exporting · ${Math.round(ms/1000)}s · WebM`, 'live');
        if (ms > 0) {
          setTimeout(() => {
            if (Recorder.recording) {
              Recorder.stop();
              UI.setStatus && UI.setStatus('export done · ↓ last video', 'ok');
            }
          }, ms + 200);
        }
      });
      // Show "↓ last video" link after every recording stops
      const _origStop = Recorder.stop.bind(Recorder);
      Recorder.stop = function () {
        _origStop();
        // The original _save() already auto-downloads. Also keep a link visible
        // so the user can re-download.
        setTimeout(() => {
          if (this.lastBlobUrl && $('last-video')) {
            const a = $('last-video');
            a.href = this.lastBlobUrl;
            a.download = this.lastFilename || 'sainted-word.webm';
            const mb = (this.lastBlobSize || 0) / (1024 * 1024);
            a.textContent = `↓ ${this.lastFilename || 'last video'} (${mb.toFixed(1)} MB)`;
            a.hidden = false;
          }
        }, 200);
      };
      const _origSave = Recorder._save.bind(Recorder);
      Recorder._save = function () {
        _origSave();
        // Stash the blob URL so the link can stay available
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(this.chunks, { type: this.mime }));
        this.lastBlobUrl = a.href;
        this.lastFilename = a.download;
        this.lastBlobSize = this.chunks.reduce((s, c) => s + c.size, 0);
      };
        // Library
        $('add-assets').addEventListener('click', () => $('asset-input').click());
        // The 'clear-all' button is now wired by /lib/reset-state.client.js,
        // which wipes assets + songs + sets across every IDB the product
        // uses and reloads the page. The old inline Library.clearAll() path
        // is gone — see lib/reset-state.client.js for the full scope.
        // .swr-set save / import (marketplace v1: file-based)
        $('save-set').addEventListener('click', async () => {
          if (!window.SWR_SETS) {
            alert('swr-sets module not loaded; refresh the page.');
            return;
          }
          try {
            setStatus('exporting set…', 'busy');
            const doc = await window.SWR_SETS.exportState({});
            window.SWR_SETS.download(doc);
            setStatus('set exported · ' + doc.name, 'ok');
          } catch (e) {
            console.error('export set', e);
            setStatus('export failed: ' + e.message, 'warn');
          }
        });
        $('import-set').addEventListener('click', () => $('set-input').click());
        $('set-input').addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          e.target.value = '';
          try {
            setStatus('importing ' + file.name + '…', 'busy');
            const set = await window.SWR_SETS.importSet(file);
            const result = await window.SWR_SETS.applySet(set);
            const okCount = (result.log || []).filter(l => l.ok).length;
            setStatus('imported "' + (set.meta.name || file.name) + '" · ' + okCount + ' step(s)', 'ok');
          } catch (err) {
            console.error('import set', err);
            setStatus('import failed: ' + err.message, 'warn');
          }
        });
        $('asset-input').addEventListener('change', (e) => {
          Library.addFiles(e.target.files);
          e.target.value = '';
        });
        // Layers
        $('add-layer').addEventListener('click', () => {
          if (Library.items.length) Layers.add(Library.items[0]);
        });
        $('re-map').addEventListener('click', () => Layers.autoMap());
        // Global sliders
        for (const id of ['sensitivity', 'beat-gate', 'decay', 'temperature', 'mutations', 'posterize', 'vignette', 'chroma', 'grain', 'sepia', 'glow', 'grayscale', 'blur']) {
          const inp = $(id);
          const out = $(id + '-v');
          inp.addEventListener('input', () => { out.textContent = parseFloat(inp.value).toFixed(2); });
        }
        // FX slider → WebGL uniform bindings (defensive: FX may not be loaded yet)
        const tempInp = $('temperature');
        const mutInp = $('mutations');
        const algoSel = $('mut-algo');
        if (tempInp) tempInp.addEventListener('input', () => window.FX && window.FX.setTemp(parseFloat(tempInp.value)));
        if (mutInp)  mutInp.addEventListener('input',  () => window.FX && window.FX.setMut(parseFloat(mutInp.value)));
        if (algoSel) algoSel.addEventListener('change', () => window.FX && window.FX.setAlgo(parseInt(algoSel.value, 10)));
        // Persona uniform bindings
        const posterizeInp = $('posterize');
        const vignetteInp  = $('vignette');
        const chromaInp    = $('chroma');
        const grainInp     = $('grain');
        const sepiaInp     = $('sepia');
        const glowInp      = $('glow');
        if (posterizeInp) posterizeInp.addEventListener('input', () => window.FX && window.FX.setPosterize(parseFloat(posterizeInp.value)));
        if (vignetteInp)  vignetteInp.addEventListener('input',  () => window.FX && window.FX.setVignette(parseFloat(vignetteInp.value)));
        if (chromaInp)    chromaInp.addEventListener('input',    () => window.FX && window.FX.setChroma(parseFloat(chromaInp.value)));
        if (grainInp)     grainInp.addEventListener('input',     () => window.FX && window.FX.setGrain(parseFloat(grainInp.value)));
        if (sepiaInp)     sepiaInp.addEventListener('input',     () => window.FX && window.FX.setSepia(parseFloat(sepiaInp.value)));
        if (glowInp)      glowInp.addEventListener('input',      () => window.FX && window.FX.setGlow(parseFloat(glowInp.value)));
        const grayInp = $('grayscale');
        const blurInp = $('blur');
        if (grayInp) grayInp.addEventListener('input', () => window.FX && window.FX.setGrayscale(parseFloat(grayInp.value)));
        if (blurInp) blurInp.addEventListener('input',  () => window.FX && window.FX.setBlur(parseFloat(blurInp.value)));
        // Distortion sliders (from flexible-smart-videomaker preset system)
        const liquidInp = $('liquid');
        const pearlInp  = $('pearl');
        const glitchInp = $('glitch');
        if (liquidInp) liquidInp.addEventListener('input', () => window.FX && window.FX.setLiquid(parseFloat(liquidInp.value)));
        if (pearlInp)  pearlInp.addEventListener('input',  () => window.FX && window.FX.setPearl(parseFloat(pearlInp.value)));
        if (glitchInp) glitchInp.addEventListener('input', () => window.FX && window.FX.setGlitch(parseFloat(glitchInp.value)));
        // Drop targets
        window.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            document.body.classList.add('drag-files');
          }
        });
        window.addEventListener('dragleave', (e) => {
          if (e.target === document.documentElement) document.body.classList.remove('drag-files');
        });
        window.addEventListener('drop', async (e) => {
          e.preventDefault();
          document.body.classList.remove('drag-files');
          if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
          const files = Array.from(e.dataTransfer.files);
          // Smart routing: if exactly one video file is dropped and there's no
          // song loaded yet, show a chooser banner. Otherwise route to library.
          const isVideo = (f) => (f.type || '').startsWith('video/') || /\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(f.name || '');
          if (files.length === 1 && isVideo(files[0]) && !Audio.audioEl) {
            UI.showMp4Chooser(files[0]);
            return;
          }
          await Library.addFiles(files);
        });
        // Keyboard
        window.addEventListener('keydown', (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
          if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
          if (e.key === 'r' || e.key === 'R') {
            // Context-sensitive: rotate the selected clip's offset by ±90° if
            // one is selected; otherwise trigger RE-MAP. The offset is the
            // sticky per-clip tilt that survives audio-driven drift.
            const sel = (window.Layers && window.Layers.selected) || null;
            if (sel) {
              const delta = e.shiftKey ? -90 : 90;
              sel.rotOffset = (sel.rotOffset + delta + 360) % 360;
              // Sync the layer card's rot slider + readout
              const card = document.querySelector('.layer.selected');
              if (card) {
                const slider = card.querySelector('input[data-prop="rot"]');
                const readout = card.querySelector('.rot-v');
                if (slider) slider.value = sel.rotOffset;
                if (readout) readout.textContent = `${Math.round(sel.rotOffset)}°`;
              }
              if (window.Layers && typeof window.Layers.render === 'function') window.Layers.render();
            } else {
              $('re-map').click();
            }
          }
          if (e.key === 'l' || e.key === 'L') { $('add-layer').click(); }
          if (e.key === 'd' || e.key === 'D') { $('drag-mode').click(); }
        });
        // Resize
        window.addEventListener('resize', () => Renderer.fit());
        // Drag mode toggle
        $('drag-mode').addEventListener('click', () => {
          Renderer.setDragMode(Renderer.dragMode === 'auto' ? 'manual' : 'auto');
        });
        // Rotate selected clip button (Shift+click = -90°).
        // Mutates the per-clip rotOffset (sticky tilt), NOT pos.rot
        // (which is overwritten by audio every frame in auto drag mode).
        const rotateBtn = $('rotate-sel');
        if (rotateBtn) {
          rotateBtn.addEventListener('click', (e) => {
            const sel = (window.Layers && window.Layers.selected) || null;
            if (!sel) return;
            sel.rotOffset = (sel.rotOffset + (e.shiftKey ? -90 : 90) + 360) % 360;
            // Sync the layer card's rot slider + readout
            const card = document.querySelector('.layer.selected');
            if (card) {
              const slider = card.querySelector('input[data-prop="rot"]');
              const readout = card.querySelector('.rot-v');
              if (slider) slider.value = sel.rotOffset;
              if (readout) readout.textContent = `${Math.round(sel.rotOffset)}°`;
            }
            if (window.Layers && typeof window.Layers.render === 'function') window.Layers.render();
          });
        }
        Renderer.setDragMode('auto');
        // Canvas pointer events for manual drag
        stageCanvas.addEventListener('pointerdown', (e) => Renderer.onPointerDown(e));
        stageCanvas.addEventListener('pointermove', (e) => Renderer.onPointerMove(e));
        stageCanvas.addEventListener('pointerup',   (e) => Renderer.onPointerUp(e));
        stageCanvas.addEventListener('pointercancel', (e) => Renderer.onPointerUp(e));
        // Cursor hint
        const updateCursor = () => {
          stageCanvas.style.cursor = Renderer.dragMode === 'manual' ? 'grab' : 'default';
        };
        $('drag-mode').addEventListener('click', updateCursor);
        updateCursor();
        stageCanvas.addEventListener('pointerdown', () => {
          if (Renderer.dragging) stageCanvas.style.cursor = 'grabbing';
        });
        stageCanvas.addEventListener('pointerup', updateCursor);
      },
      onSongEnd() {
        Audio.pause();
      },
      updateTime() {
        if (!Audio.audioEl) return;
        const t = Audio.audioEl.currentTime || 0;
        const d = Audio.audioEl.duration || 0;
        $('time').innerHTML = `${fmt(t)} <b>/ ${fmt(d)}</b>`;
      },
      // MP4 drop chooser: a small banner with 2 buttons (use as song / use as
      // library) shown when a single video file is dropped and no song is loaded.
      showMp4Chooser(file) {
        // If a chooser is already up, just update its text + handlers
        let banner = document.getElementById('mp4-chooser');
        if (banner) banner.remove();
        banner = document.createElement('div');
        banner.id = 'mp4-chooser';
        banner.className = 'mp4-chooser';
        const fname = escapeHtml(file.name);
        banner.innerHTML = `
          <div class="mp4-chooser__text">
            <div class="mp4-chooser__title">Use <b>${fname}</b> as…</div>
            <div class="mp4-chooser__sub">It's a video file. Pick how you want to load it.</div>
          </div>
          <div class="mp4-chooser__actions">
            <button class="mp4-chooser__btn primary" data-act="song">♪ Song (audio only)</button>
            <button class="mp4-chooser__btn" data-act="library">▤ Library (visual)</button>
            <button class="mp4-chooser__btn" data-act="both">Both (audio + visual)</button>
            <button class="mp4-chooser__btn ghost" data-act="cancel" title="Dismiss">×</button>
          </div>
        `;
        document.body.appendChild(banner);
        // Animate in
        requestAnimationFrame(() => banner.classList.add('show'));
        const close = () => {
          banner.classList.remove('show');
          setTimeout(() => banner.remove(), 180);
        };
        banner.addEventListener('click', async (e) => {
          const act = e.target?.dataset?.act;
          if (!act) return;
          if (act === 'cancel') { close(); return; }
          if (act === 'song' || act === 'both') {
            Audio.loadFile(file);
          }
          if (act === 'library' || act === 'both') {
            await Library.addFiles([file]);
          }
          close();
        });
      },
    };

    // ======================================================================
    // CSSFX — 20 stackable CSS video filters applied to #stage
    // ======================================================================
    // Each filter is a class on the stage element. They composite with the
    // WebGL post-process: WebGL draws to the canvas, CSS transforms/filter
    // properties apply to the whole stage subtree at the DOM layer.
    // Persisted in localStorage under 'swr-cssfx-active' so the user
    // doesn't lose their stack on reload.
    const CSSFX = {
      // 20 curated CSS classes from video-fx.css that work standalone on
      // a single element. Skipped: parallax-layer-* (needs layered DOM),
      // rgb-split-img (needs SVG filter injection), loop-pingpong (no
      // animation of its own), particles (just a comment).
      catalog: [
        { name: 'kenburns',     label: 'Ken Burns' },
        { name: 'pan-scan',     label: 'Pan & Scan' },
        { name: 'mesh-warp',    label: 'Mesh Warp' },
        { name: 'displacement', label: 'Displace' },
        { name: 'liquify',      label: 'Liquify' },
        { name: 'light-leak',   label: 'Light Leak' },
        { name: 'film-grain',   label: 'Film Grain' },
        { name: 'vhs',          label: 'VHS' },
        { name: 'rgb-split',    label: 'RGB Split' },
        { name: 'pixel-sort',   label: 'Pixel Sort' },
        { name: 'crt',          label: 'CRT' },
        { name: 'crt-flicker',  label: 'CRT Flicker' },
        { name: 'audio-reactive', label: 'Audio React' },
        { name: 'hue-shift',    label: 'Hue Shift' },
        { name: 'kaleidoscope', label: 'Kaleido' },
        { name: 'zoom-pulse',   label: 'Zoom Pulse' },
        { name: 'camera-shake', label: 'Cam Shake' },
        { name: 'vhs-crt',      label: 'VHS·CRT' },
        { name: 'dreamy',       label: 'Dreamy' },
        { name: 'retro',        label: 'Retro' },
      ],
      active: new Set(),
      stageEl: null,
      panelEl: null,
      gridEl: null,
      countEl: null,
      toggleEl: null,

      init() {
        this.stageEl = $('stage');
        this.panelEl = $('css-fx-panel');
        this.gridEl  = $('css-fx-grid');
        this.countEl = $('css-fx-count');
        this.toggleEl = $('css-fx-toggle');
        if (!this.stageEl || !this.gridEl) return;

        // Render chips
        const frag = document.createDocumentFragment();
        for (const fx of this.catalog) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'css-fx-chip';
          chip.dataset.fx = fx.name;
          chip.setAttribute('aria-pressed', 'false');
          chip.innerHTML = `<span class="css-fx-chip__dot"></span><span class="css-fx-chip__name">${fx.label}</span>`;
          chip.addEventListener('click', () => this.toggle(fx.name));
          frag.appendChild(chip);
        }
        this.gridEl.appendChild(frag);

        // Toggle popup
        if (this.toggleEl) {
          this.toggleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setOpen(this.panelEl.hasAttribute('hidden'));
          });
        }
        // Click outside closes
        document.addEventListener('click', (e) => {
          if (!this.panelEl || this.panelEl.hasAttribute('hidden')) return;
          if (this.panelEl.contains(e.target)) return;
          if (this.toggleEl && this.toggleEl.contains(e.target)) return;
          this.setOpen(false);
        });
        // Escape closes
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && this.panelEl && !this.panelEl.hasAttribute('hidden')) {
            this.setOpen(false);
          }
        });
        // Clear-all
        const clearBtn = $('css-fx-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clear());

        // Restore persisted state
        try {
          const saved = JSON.parse(localStorage.getItem('swr-cssfx-active') || '[]');
          if (Array.isArray(saved)) {
            for (const name of saved) {
              if (this.catalog.find((f) => f.name === name)) this._apply(name, true);
            }
          }
        } catch (_) { /* noop */ }
        this._syncUI();
      },

      setOpen(open) {
        if (!this.panelEl) return;
        if (open) {
          this.panelEl.removeAttribute('hidden');
          requestAnimationFrame(() => this.panelEl.classList.add('show'));
        } else {
          this.panelEl.classList.remove('show');
          setTimeout(() => this.panelEl.setAttribute('hidden', ''), 180);
        }
      },

      toggle(name) {
        if (this.active.has(name)) this._apply(name, false);
        else this._apply(name, true);
        this._syncUI();
        this._persist();
      },

      _apply(name, on) {
        if (on) {
          this.active.add(name);
          this.stageEl.classList.add(name);
        } else {
          this.active.delete(name);
          this.stageEl.classList.remove(name);
        }
      },

      clear() {
        for (const name of [...this.active]) this._apply(name, false);
        this._syncUI();
        this._persist();
      },

      _syncUI() {
        // Update chips
        if (this.gridEl) {
          for (const chip of this.gridEl.querySelectorAll('.css-fx-chip')) {
            const on = this.active.has(chip.dataset.fx);
            chip.classList.toggle('on', on);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        }
        // Update count badge
        const n = this.active.size;
        if (this.countEl) this.countEl.textContent = String(n);
        if (this.toggleEl) this.toggleEl.dataset.count = String(n);
      },

      _persist() {
        try {
          localStorage.setItem('swr-cssfx-active', JSON.stringify([...this.active]));
        } catch (_) { /* noop */ }
      },
    };

    // ======================================================================
    // BOOT
    // ======================================================================
    (async function boot() {
      UI.init();
      Renderer.init();
      Renderer.fit();
      Renderer.start();
      CSSFX.init();
      await Library.init();
      // Expose on window EARLY so _loadCurrentSong (called below) can see
      // window.Library.db. The previous order had window.Library = Library
      // set AFTER _loadCurrentSong, so the song-restore path saw undefined
      // and silently bailed. Now exposed before any deferred work.
      window.SWR = { Audio, Library, Layers, Renderer, Recorder, UI, VISUAL_PRESETS, applyPreset };
      // M1 of story-graph: also expose Story on window.SWR so callers that
      // only know the SWR.* namespace (tests, devtools snippets) can reach it.
      try { window.SWR.Story = Story; } catch (_) {}
      window.Audio = Audio;
      window.Layers = Layers;
      window.Library = Library;
      window.CSSFX = CSSFX;
      // Auto-apply a pending .swr-set if the marketplace page queued one.
      // Marketplace stores the full set doc in localStorage under
      // 'swr.pending-set'; engine.html reads it on boot and applies via
      // swr-sets.js. Cleared after apply so a refresh doesn't re-apply.
      try {
        const pending = localStorage.getItem('swr.pending-set');
        if (pending && window.SWR_SETS && window.SWR_SETS.applySet) {
          localStorage.removeItem('swr.pending-set');
          // Slight delay so Library finishes its init() pass
          setTimeout(() => {
            window.SWR_SETS.applySet(JSON.parse(pending))
              .then(result => {
                const okCount = (result.log || []).filter(l => l.ok).length;
                setStatus('set applied · ' + okCount + ' step(s)', 'ok');
              })
              .catch(err => setStatus('set apply failed: ' + err.message, 'warn'));
          }, 200);
        }
      } catch (e) { /* localStorage unavailable, ignore */ }
      // Mount the timeline (waveform + beat markers). timeline.client.js
      // self-mounts on DOMContentLoaded if a canvas with id=timeline-canvas
      // exists, so no explicit mount call is required here.
      // Restore the last-loaded song from IndexedDB (silent restore, no user
      // gesture needed — the user has to click play anyway since browsers gate
      // audio playback on a real gesture).
      try {
        const restored = await Audio._loadCurrentSong();
        if (restored) {
          setStatus('song restored', 'ok');
          // Auto-play if the browser allows it (user previously interacted
          // with the page in this tab) or queue for the first user gesture.
          // Without this the user reloads the engine expecting audio to
          // resume, but stays silent until they manually press Play.
          const tryPlay = () => Audio.play();
          tryPlay();
          document.addEventListener('pointerdown', function _autoplayOnGesture() {
            document.removeEventListener('pointerdown', _autoplayOnGesture);
            tryPlay();
          }, { once: true });
        }
      } catch (e) { console.warn('song restore', e); }
      // Auto-load any pre-seeded assets from ./library/ on the first run per
      // browser. We use a localStorage flag so the manifest only seeds once:
      // if the user has uploaded their own assets, the manifest skips; if
      // they later Clear, the next visit stays empty (no manifest surprise).
      //
      // Two-phase load:
      //   Phase 1 (boot): fetch the manifest + first 8 image thumbs (cheap).
      //     First paint is no longer blocked on 5 videos decoding; user can
      //     drop a song and start playing immediately.
      //   Phase 2 (idle): videos + remaining thumbs in a requestIdleCallback
      //     slice. By the time the user opens the library tab, the rest is
      //     already in IDB.
      if (Library.items.length === 0 && !localStorage.getItem('swr-manifest-loaded')) {
        try {
          const r = await fetch('./library/manifest.json', { cache: 'no-cache' });
          if (r.ok) {
            const m = await r.json();
            const files = m.files || [];
            // Partition by type. Images decode fast; videos are the bottleneck.
            const imageFiles = files.filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f));
            const videoFiles = files.filter(f => /\.(mp4|webm|mov)$/i.test(f));
            const phase1 = imageFiles.slice(0, 8);
            const phase1Blobs = await Promise.all(phase1.map(async f => {
              const fr = await fetch('./library/' + f);
              return { name: f, blob: await fr.blob() };
            }));
            await Library.addFiles(phase1Blobs.map(({ name, blob }) => new File([blob], name, { type: blob.type })));
            // Phase 2 — defer to idle time. If rIC isn't available, fall back
            // to a short setTimeout so we still don't block first paint.
            const phase2Files = [...imageFiles.slice(8), ...videoFiles];
            let phase2Resolve;
            window.__swrPhase2Done = new Promise((res) => { phase2Resolve = res; });
            if (phase2Files.length) {
              const runPhase2 = async () => {
                const blobs = await Promise.all(phase2Files.map(async f => {
                  const fr = await fetch('./library/' + f);
                  return { name: f, blob: await fr.blob() };
                }));
                await Library.addFiles(blobs.map(({ name, blob }) => new File([blob], name, { type: blob.type })));
                localStorage.setItem('swr-manifest-loaded', '1');
                phase2Resolve();
              };
              if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => { runPhase2().catch(() => phase2Resolve()); }, { timeout: 5000 });
              } else {
                setTimeout(() => { runPhase2().catch(() => phase2Resolve()); }, 100);
              }
            } else {
              localStorage.setItem('swr-manifest-loaded', '1');
              phase2Resolve();
            }
          }
        } catch (e) {
          // No library folder, that's fine
        }
      }
      // Wire preset dropdown
      const presetSel = document.getElementById('preset');
      if (presetSel) presetSel.addEventListener('change', (e) => applyPreset(e.target.value));
      // Wire STORY controls (mode select, AUTO checkbox, action buttons).
      // The chapter pills inside #story-chapters are populated by Story.renderStrip()
      // itself (which has access to the private state closure).
      try {
        const storyMode = document.getElementById('story-mode');
        if (storyMode) storyMode.addEventListener('change', (e) => {
          if (Story && typeof Story.setMode === 'function') Story.setMode(e.target.value);
        });
        const storyAuto = document.getElementById('story-auto');
        if (storyAuto) storyAuto.addEventListener('change', (e) => {
          if (!Story) return;
          Story.setMode(e.target.checked ? 'auto' : 'manual');
        });
        const storyHold = document.getElementById('story-hold');
        if (storyHold) storyHold.addEventListener('click', () => {
          if (Story && typeof Story.hold === 'function') Story.hold();
        });
        const storyNext = document.getElementById('story-next');
        if (storyNext) storyNext.addEventListener('click', () => {
          if (Story && typeof Story.next === 'function') Story.next();
        });
        const storyReset = document.getElementById('story-reset');
        if (storyReset) storyReset.addEventListener('click', () => {
          if (Story && typeof Story.reset === 'function') Story.reset();
        });
        // First paint of the chapter pills + path
        if (Story && typeof Story.renderStrip === 'function') Story.renderStrip();
      } catch (_) { /* silent */ }
      // Set up canvas sample song for instant demo if no song loaded
      setStatus('ready', 'ok');
    })();
  

})();
