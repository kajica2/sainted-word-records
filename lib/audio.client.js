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
//
//   ---- Media Source (the audio source, the sync and the offset) ----
//
//   .audioSource  — 'video' (the media element's own track) | 'external'
//                   (a separate audio file) | 'none' (silent)
//   .externalEl   — the <audio> element behind the external file
//   .sync         — bool: keep the picture locked to the music
//   .offsetMs     — picture/audio trim in ms. Positive delays the audio.
//   .clock        — THE clock, in seconds. Whatever element carries the
//                   audio is the clock: the media element when the video
//                   carries its own track, the external element when an
//                   external file is loaded. The bar counter, the beat
//                   timestamps and the beat phase all read it, so the
//                   visuals, the beat detection and the music can never
//                   disagree about where the song is. Never a wall clock.
//   .setAudioSource(mode)  — 'video' | 'external' | 'none'
//   .loadExternalAudio(f)  — load a separate audio file (becomes the clock)
//   .clearExternalAudio()  — drop the external file, back to the video's
//   .setSync(bool) / .setOffsetMs(n)
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

  // Blob URL currently backing Audio.audioEl.src. Kept module-private so the
  // previous URL can be revoked when a new song replaces it — otherwise every
  // loadFile() call leaks the prior blob and its orphaned media element.
  var _lastBlobUrl = null;
  // Blob URL backing the external audio element (the Media Source's
  // "External audio file"). Revoked when it is replaced or cleared.
  var _lastExternalBlobUrl = null;

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
    // ---- Media Source ---------------------------------------------------
    // Which element carries the audio:
    //   'video'    — the media element's own track (one element, one clock)
    //   'external' — a separate audio file; the media element is the picture
    //   'none'     — no audio at all
    audioSource: 'video',
    externalEl: null,      // the <audio> element behind the external file
    externalFile: null,
    externalName: '',
    // The loaded media's name + whether it is a video (the Media Source
    // panel shows both).
    mediaName: '',
    mediaIsVideo: false,
    // Keep the picture locked to the music. Only meaningful when the audio
    // comes from a separate file: with the video's own track both are the
    // same element and are locked by construction.
    sync: true,
    // Picture/audio trim in milliseconds. Positive delays the audio: the
    // picture runs ahead by this much, so the music is heard later.
    offsetMs: 0,
    // element -> MediaElementAudioSourceNode. createMediaElementSource()
    // may only be called ONCE per element (the second call throws
    // InvalidStateError), so the node is cached and reused when the audio
    // source switches back and forth.
    _sourceNodes: new WeakMap(),
    // Bar counter for the Story runtime (and any other time-aware code).
    // 1 bar = Audio.feat.bpm / 60 seconds. When BPM is unknown (no song
    // loaded), bar stays at 0 and never advances; the Story runtime treats
    // that as "no timing, use the fallback maxBars timer instead".
    // The counter is paced by the MEDIA clock (Audio.clock), not by a wall
    // clock: a bar is a musical position, so it has to come from the
    // music. A discontinuity (a seek) rebases the counter so it stays
    // monotonic instead of jumping or running backwards.
    _bar: 0,
    _barClockBase: 0,   // the clock value the current bar count started at
    _barLastClock: null, // the clock value seen on the previous tick
    _barsSinceSongStart: 0,
    get bar() { return this._bar; },
    // Resets the bar counter — call from Story.enter() so each chapter
    // gets its own fresh bar count.
    resetBarCounter() {
      this._bar = 0;
      this._barClockBase = this.clock;
      this._barLastClock = null;
    },
    // Advance the bar counter from the media clock + current BPM.
    // Cheap enough to call once per animation frame; clamps to integer.
    _tickBar() {
      if (!this.playing) return;
      const bpm = (this.feat && this.feat.bpm) || 0;
      if (!bpm) return;
      const secPerBar = 60 / bpm;
      const t = this.clock;
      // A discontinuity — a seek, a source swap, a stall — rebases the
      // counter: the bar count stays monotonic, but the musical position
      // still comes from the media.
      if (t < this._barClockBase ||
          (this._barLastClock !== null && t - this._barLastClock > 2)) {
        this._barClockBase = t - this._bar * secPerBar;
      }
      this._barLastClock = t;
      const elapsed = t - this._barClockBase;
      const newBar = Math.floor(elapsed / secPerBar);
      if (newBar > this._bar) this._bar = newBar;
    },
    // ---- The clock ------------------------------------------------------
    // The element that carries the audio. It IS the clock: the media
    // element when the video carries its own track, the external element
    // when a separate file is loaded.
    clockElement() {
      if (this.audioSource === 'external' && this.externalEl) return this.externalEl;
      return this.audioEl || this.externalEl || null;
    },
    // The single clock, in seconds. Everything musical reads this.
    get clock() {
      const el = this.clockElement();
      if (el && isFinite(el.currentTime)) return el.currentTime;
      if (this.ctx && isFinite(this.ctx.currentTime)) return this.ctx.currentTime;
      return 0;
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
    // ---- Audio source routing -------------------------------------------
    // The source node for an element. createMediaElementSource() may only
    // be called once per element, so the node is cached and reused.
    _sourceNode(el) {
      if (!el || !this.ctx) return null;
      let node = this._sourceNodes.get(el);
      if (node) return node;
      try {
        node = this.ctx.createMediaElementSource(el);
      } catch (e) {
        // The element is already wired to a source node (e.g. it was
        // attached elsewhere) — there is nothing this module can do.
        return null;
      }
      this._sourceNodes.set(el, node);
      return node;
    },
    // Re-route once the element's media is ready. The MediaElementSourceNode
    // of the ACTIVE source is created and connected on loadedmetadata /
    // canplay, so the graph is built from the media's own timeline rather
    // than from an element that has no data yet.
    _whenReady(el) {
      if (!el) return;
      if (el.readyState >= 1) { this._routeAudio(); return; }
      if (el.__swrRouteHook) return;
      el.__swrRouteHook = true;
      const onReady = () => {
        el.__swrRouteHook = false;
        el.removeEventListener('loadedmetadata', onReady);
        el.removeEventListener('canplay', onReady);
        this._routeAudio();
      };
      el.addEventListener('loadedmetadata', onReady);
      el.addEventListener('canplay', onReady);
    },
    // Point the analyser at the element that currently carries the audio.
    // The analyser is the only audio input the engine (and the export)
    // reads, so switching the source is a matter of moving that one
    // connection.
    _routeAudio() {
      if (!this.analyser) return;
      if (this.source) {
        try { this.source.disconnect(this.analyser); } catch (e) {}
        this.source = null;
      }
      const mode = this.audioSource;
      const srcEl = mode === 'external' ? this.externalEl : this.audioEl;
      const otherEl = mode === 'external' ? this.audioEl : this.externalEl;
      // Whatever is NOT the audio source must not reach the speakers: an
      // element with a MediaElementSourceNode sends its audio into the
      // graph only, so an unconnected node is what makes it silent.
      if (otherEl) this._sourceNode(otherEl);
      if (mode === 'none' || !srcEl) {
        if (this.audioEl) this._sourceNode(this.audioEl);
        return;
      }
      if (srcEl.readyState < 1) { this._whenReady(srcEl); return; }
      const node = this._sourceNode(srcEl);
      if (!node) return;
      try { node.connect(this.analyser); } catch (e) {}
      this.source = node;
    },
    // Choose where the audio comes from: 'video' (the media element's own
    // track), 'external' (a separate file) or 'none' (silent).
    setAudioSource(mode) {
      const m = (mode === 'external' || mode === 'none') ? mode : 'video';
      this.audioSource = m;
      this._routeAudio();
      this._announceMediaSource();
      return m;
    },
    // Tell the Media Source panel (and anything else that mirrors this
    // state) that the source, the sync or the offset changed.
    _announceMediaSource() {
      try {
        window.dispatchEvent(new CustomEvent('swr:media-source', {
          detail: {
            audioSource: this.audioSource,
            sync: !!this.sync,
            offsetMs: this.offsetMs || 0,
            externalName: this.externalName || '',
            mediaName: this.mediaName || '',
          },
        }));
      } catch (e) { /* no CustomEvent support — the panel polls on focus */ }
    },
    // Load a separate audio file. It becomes the audio source and the
    // master clock; the media element (the picture) is slaved to it.
    async loadExternalAudio(file) {
      if (!file) return false;
      this.unlock();
      const old = this.externalEl;
      if (old) {
        old.pause();
        old.removeAttribute('src');
        try { old.load(); } catch (e) {}
      }
      const el = document.createElement('audio');
      el.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.dataset.kind = 'audio';
      if (_lastExternalBlobUrl) { URL.revokeObjectURL(_lastExternalBlobUrl); _lastExternalBlobUrl = null; }
      el.src = URL.createObjectURL(file);
      _lastExternalBlobUrl = el.src;
      this.externalEl = el;
      this.externalFile = file;
      this.externalName = file.name || '';
      this.audioSource = 'external';
      const ui = UI();
      el.addEventListener('ended', () => {
        if (this.clockElement() !== el) return;
        if (ui && ui.onSongEnd) ui.onSongEnd();
      });
      el.addEventListener('timeupdate', () => { if (ui && ui.updateTime) ui.updateTime(); });
      // Wait for the media to be ready before the graph is built on it.
      await new Promise((resolve) => {
        let done = false;
        const onReady = () => {
          if (done) return;
          done = true;
          el.removeEventListener('loadedmetadata', onReady);
          el.removeEventListener('error', onReady);
          resolve();
        };
        el.addEventListener('loadedmetadata', onReady, { once: true });
        el.addEventListener('error', onReady, { once: true });
        setTimeout(onReady, 4000);
      });
      this._routeAudio();
      this._announceMediaSource();
      // The music changed, so the analysis (BPM/key/downbeat) has to be
      // redone against the new file.
      this.history = { prev: null, bassAvg: 0, fluxAvg: 0 };
      this.beatTimes = [];
      this.feat.bpm = 0;
      Promise.resolve().then(() => this.analyzeFull().catch(() => {}));
      if (this.playing) {
        try { el.play().catch(() => {}); } catch (e) {}
      }
      return true;
    },
    // Drop the external file and go back to the media element's own track.
    clearExternalAudio() {
      const el = this.externalEl;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        try { el.load(); } catch (e) {}
      }
      this.externalEl = null;
      this.externalFile = null;
      this.externalName = '';
      if (_lastExternalBlobUrl) { URL.revokeObjectURL(_lastExternalBlobUrl); _lastExternalBlobUrl = null; }
      this.setAudioSource('video');
    },
    // Keep the picture locked to the music.
    setSync(on) {
      this.sync = !!on;
      this._announceMediaSource();
      return this.sync;
    },
    // Picture/audio trim in milliseconds. Positive delays the audio.
    setOffsetMs(ms) {
      const n = Number(ms);
      this.offsetMs = isFinite(n) ? Math.round(n) : 0;
      this._announceMediaSource();
      return this.offsetMs;
    },
    // Keep the picture locked to the music. The AUDIO is the master (it is
    // what the user hears and what the visuals react to); the media
    // element — the picture — is corrected onto it. A positive offset puts
    // the picture ahead, which is the same thing as delaying the audio.
    _syncMedia() {
      if (!this.sync) return;
      if (this.audioSource !== 'external') return;  // one element = locked already
      const a = this.externalEl, m = this.audioEl;
      if (!a || !m || a.paused || m.paused) return;
      const target = a.currentTime + this.offsetMs / 1000;
      if (Math.abs(m.currentTime - target) > 0.08) {
        const max = isFinite(m.duration) ? m.duration : target;
        try { m.currentTime = Math.max(0, Math.min(target, max)); } catch (e) {}
      }
    },
    // True for any file we should decode through a <video> element.
    // Both <audio> and <video> support createMediaElementSource identically,
    // so the rest of the engine doesn't care which element backs the source.
    _isVideoFile(file) {
      if (!file) return false;
      if (file.type && file.type.startsWith('video/')) return true;
      return /\.(mp4|m4v|webm|mov|mkv|m3u8|ogv)$/i.test(file.name || '');
    },
    // True for a Standard MIDI File. A `.mid` is loaded as a note-event source
    // rather than an <audio> element — see lib/midi-feat.client.js.
    _isMidiFile(file) {
      if (!file) return false;
      if (file.type && /midi/i.test(file.type)) return true;
      return /\.(mid|midi)$/i.test(file.name || '');
    },
    // Load a `.mid` as the current song. There is no audio to decode: the note
    // timeline is synthesised into the canonical 12-field feat shape by
    // SWR_MIDI_FEAT, and sample() delegates to it — so every variant keeps
    // reading Audio.feat unchanged. Beat and onset are exact here (they come
    // off the tempo map and the note-on times), so the visuals track the score
    // rather than guessing at it. The recorder stays disabled: there is no
    // audio to record.
    async loadMidi(file) {
      this.unlock();
      if (this.source) try { this.source.disconnect(); } catch (e) {}
      this.source = null;
      // A MIDI has no media element, so there is nothing for an external
      // audio file to sit next to.
      if (this.externalEl) this.clearExternalAudio();
      if (this.audioEl) {
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        try { this.audioEl.load(); } catch (e) {}
      }
      this.audioEl = null;
      this._saveCurrentSong(file);
      if (this.midi) { this.midi.detach(); this.midi = null; }
      const MF = window.SWR_MIDI_FEAT;
      if (!MF) {
        setStatus('✕ MIDI support not loaded (lib/midi-feat.client.js)', 'err');
        return;
      }
      try {
        this.midi = MF.attach(await file.arrayBuffer());
      } catch (e) {
        setStatus(`✕ can't read ${file.name}: ${e.message}`, 'err');
        return;
      }
      this.playing = false;
      this.history = { prev: null, bassAvg: 0, fluxAvg: 0 };
      this.beatTimes = [];
      this.feat.bpm = this.midi.feat.bpm;
      const saved = '<span class="song-badge" title="Saved to this browser — will auto-restore on next visit" style="background:#1f3;color:#0f0;">SAVED</span> ';
      const badge = '<span class="song-badge" title="MIDI — visuals driven by note events, no audio">MIDI</span> ';
      const songName = $('song-name');
      if (songName) songName.innerHTML = saved + badge + '<b>' + escapeHtml(file.name) + '</b>';
      const playEl = $('play'); if (playEl) playEl.disabled = false;
      const evEl = $('export-video'); if (evEl) evEl.disabled = false;
      const bpmPill = $('bpm-pill');
      if (bpmPill) bpmPill.textContent = `${this.midi.feat.bpm} bpm`;
      setStatus(`loaded MIDI · ${this.midi.parsed.notes.length} notes · ${this.midi.feat.bpm} bpm · click play`, 'ok');
    },
    loadFile(file) {
      this.unlock();
      if (this._isMidiFile(file)) return this.loadMidi(file);
      if (this.source) try { this.source.disconnect(); } catch (e) {}
      // A new song means a new media element: the external file belonged to
      // the previous one, so the source goes back to the video's own track.
      if (this.externalEl) this.clearExternalAudio();
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
      if (_lastBlobUrl) { URL.revokeObjectURL(_lastBlobUrl); _lastBlobUrl = null; }
      el.src = URL.createObjectURL(file);
      _lastBlobUrl = el.src;
      this.audioEl = el;
      const ui = UI();
      // The song ends when the CLOCK ends — with an external audio file the
      // master is the external element, not this one.
      this.audioEl.addEventListener('ended', () => {
        if (this.clockElement() !== this.audioEl) return;
        if (ui && ui.onSongEnd) ui.onSongEnd();
      });
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
      // The name of the loaded media, for the Media Source panel.
      this.mediaName = file.name || '';
      this.mediaIsVideo = isVideo;
      // The graph is built on loadedmetadata / canplay: the source node of
      // the active audio source is created and connected then, so the
      // analyser and the scheduler run off the media's own timeline.
      this.source = null;
      this._routeAudio();
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
        // The picture of a video song is not thrown away: it is put on the
        // stage as a layer by lib/song-video-layer.client.js, which shares
        // this very element so the picture and the sound are one clock.
        setStatus('loaded video song · click play', 'ok');
      }
      // Fire-and-forget full-buffer analysis. Decodes the whole song
      // (offline), runs AudioAnalysisV2 for BPM/key/scale/onsets, and
      // updates feat + the key-pill. Skips MIDI songs (MIDI provides
      // its own feature source) and is a no-op if V2 isn't loaded.
      // Errors are silent — a failed analysis just leaves the key-pill
      // empty, which is the same state as before this was wired.
      if (!isVideo || true) {
        Promise.resolve().then(() => this.analyzeFull().catch(() => {}));
      }
      // Song-loaded seam. The contract was documented in
      // lib/auto-setup.client.js ("loadFile() ends with a single line:
      // if (typeof window.__swrOnSongLoaded === 'function')
      // window.__swrOnSongLoaded(file)") but the call was never written,
      // so no subscriber ever ran. The second argument is the Audio
      // namespace, so a subscriber can reach audioEl without re-deriving it.
      try {
        if (typeof window.__swrOnSongLoaded === 'function') {
          window.__swrOnSongLoaded(file, this);
        }
      } catch (e) {
        console.warn('[audio] song-loaded hook failed', e);
      }
    },
    play() {
      this.unlock();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      if (this.midi) {
        this.midi.play();
      } else {
        // The picture and the music are two elements when an external audio
        // file is loaded: both have to run, or the picture would freeze.
        if (this.audioEl) this.audioEl.play().catch(() => {});
        if (this.externalEl && this.audioSource === 'external') {
          this.externalEl.play().catch(() => {});
        }
      }
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
        // Keep the saved-song bridge in sync when the page exposes it.
        // versions/last-song.js caches window.SWR_LAST_SONG once at load
        // time; it only re-reads the fresh file when its own
        // SWR_LAST_SONG_SAVE runs. Without this, a song picked in THIS
        // session stays invisible to every consumer of the bridge
        // (client/hook-detector.client.js reads it at detect() time) until
        // the next reload. The version pages call SWR_LAST_SONG_SAVE from
        // their song-input handler; this module is the single choke point
        // for every load path (file picker, drag-and-drop, generated
        // audio), so it refreshes here. The bridge re-writes the same
        // record — same key, same shape — so the extra write is idempotent.
        if (typeof window.SWR_LAST_SONG_SAVE === 'function') {
          try { await window.SWR_LAST_SONG_SAVE(file); } catch (_) {}
        }
        setStatus('song saved', 'ok');
      } catch (e) {
        console.warn('saveCurrentSong', e);
      }
    },
    async _loadCurrentSong() {
      try {
        if (!window.Library || !window.Library.db) return false;
        const rec = await window.Library.db.get('songs', 'current');
        if (!rec || rec.id !== 'current' || !rec.blob) return false;
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
      if (this.midi) this.midi.pause();
      if (this.audioEl) this.audioEl.pause();
      if (this.externalEl) this.externalEl.pause();
      this.playing = false;
      const playEl = $('play');
      if (playEl) {
        playEl.textContent = '▶ Play';
        playEl.classList.add('primary');
        playEl.classList.remove('danger');
      }
    },
    seek(frac) {
      if (this.midi) {
        this.midi.seek(this.midi.duration * clamp(frac, 0, 1));
        return;
      }
      // The master (whatever carries the audio) is the one that is seeked.
      const master = this.clockElement();
      if (!master || !isFinite(master.duration)) return;
      const f = clamp(frac, 0, 1);
      try { master.currentTime = master.duration * f; } catch (e) {}
      // The picture follows the music (with the offset) so a seek never
      // leaves the two on different frames.
      const slave = this.audioSource === 'external' ? this.audioEl : null;
      if (slave && isFinite(slave.duration)) {
        const target = master.currentTime + this.offsetMs / 1000;
        try { slave.currentTime = Math.max(0, Math.min(target, slave.duration)); } catch (e) {}
      }
    },
    // returns true if a beat was detected this frame
    sample() {
      // A loaded `.mid` is the feature source: SWR_MIDI_FEAT synthesises the
      // canonical feat from note events, so this is a copy into the same feat
      // object the variants read.
      if (this.midi) {
        Object.assign(this.feat, this.midi.sample());
        return this.feat.beatPulse;
      }
      if (!this.analyser) return;
      // Keep the picture locked to the music before the features are read,
      // so a frame is always analysed against the picture it is drawn on.
      this._syncMedia();
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
      // The timestamps live on the MEDIA clock, the same one the offline
      // analysis uses, so the live estimate and the analysed downbeat
      // describe the same timeline.
      const now = this.clock;
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
        // The downbeat comes from the offline analysis of the SAME media, so
        // it is a position on the media clock — subtracting it from the
        // AudioContext clock (as this used to) mixed two timelines and
        // produced a phase that had nothing to do with the music.
        if (this.feat.bpm > 0 && this._downbeatTime !== undefined) {
          const beatDur = 60 / this.feat.bpm;
          const barDur = beatDur * 4;
          const inBar = (((now - this._downbeatTime) % barDur) + barDur) % barDur;
          this.feat.beatPhase = inBar / barDur;
          this.feat.beatInBar = Math.floor(inBar / beatDur) + 1; // 1-4
        }
      }
    },
    // One-shot full analysis using audio-analysis-v2 (decode whole buffer offline)
    async analyzeFull() {
      // Analyse whatever carries the audio — the media element, or the
      // external file when one is loaded. The BPM/key/downbeat have to
      // describe the music that is actually playing.
      const el = this.clockElement();
      if (!el) return null;
      if (!this.ctx) this.unlock();
      // Need decoded buffer; decode from the element's src
      const resp = await fetch(el.src);
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
