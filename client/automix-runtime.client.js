// client/automix-runtime.client.js
//
// Self-evolving smart automixer runtime + UI wiring. Extracted from
// versions/music_video.html (lines 3232–3620) so it can be loaded by
// any surface that ships the #automix-* DOM.
//
// Depends on:
//   - client/preset-anchor-map.client.js (window.SWR_ANCHOR_MAP)
//   - client/automix.client.js          (window.SWR_AUTOMIX)
//   - client/last-mix-store.client.js   (window.SWR_LAST_MIX, optional)
//   - window.SWR.Audio.feat             (live audio features)
//   - window.SWR._fxOverride            (target fx_state being blended)
//
// Public API:
//   window.automix.toggle()       // start or stop
//   window.automix.start()
//   window.automix.stop()
//   window.automix.freeze()       // toggle freeze
//   window.automix.saveBlend()
//   window.automix.lockToNearest()// toggle lock
//   window.SWR_AUTOMIX_RUNTIME    // { automix, version, ui: { wire, unwire } }
//
// UI wiring is auto-attached when the script loads if any of the
// expected elements (#automix-toggle, #automix-debug, etc.) exist.
// Call `window.SWR_AUTOMIX_RUNTIME.ui.wire()` manually if you build
// the UI dynamically.

(function () {
  'use strict';
  if (window.SWR_AUTOMIX_RUNTIME) return;

  // ---- Constants (mirror music_video's behavior) --------------------------
  var TICK_DEFAULT_MS = 1500;
  var FADE_MS = 200;
  var DRIFT_BASE_DEFAULT = 0.01;
  var DRIFT_BEAT_DEFAULT = 0.02;
  var TICK_MIN_DEFAULT = 500;
  var TICK_MAX_DEFAULT = 3000;

  // ---- Helpers -----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function setStatus(msg, kind) {
    if (typeof window.setStatus === 'function') window.setStatus(msg, kind);
  }

  // ---- Config state (Task 1 — cross-variant port) -------------------------
  // Populated by loadConfig() from #swrc-automix-config. Private to the
  // IIFE closure; exposed via SWR_AUTOMIX_RUNTIME accessor functions so
  // tests can inspect without breaking encapsulation.
  var _config = null;
  var _driftAmplitude = null;   // { base, beatScale } when config overrides defaults
  var _tuning = null;           // { minTickMs, maxTickMs } when config overrides defaults
  var _toggleShortcut = null;   // string (single char, lowercased) when config overrides 'a'

  // ---- Validation helpers ------------------------------------------------
  function _validateBias(bias) {
    if (!bias || typeof bias !== 'object') return false;
    if (!Array.isArray(bias.warmth) || bias.warmth.length !== 2) return false;
    if (!Array.isArray(bias.intensity) || bias.intensity.length !== 2) return false;
    if (bias.warmth[0] > bias.warmth[1]) return false;
    if (bias.intensity[0] > bias.intensity[1]) return false;
    for (var i = 0; i < 2; i++) {
      var w = bias.warmth[i];
      var inten = bias.intensity[i];
      if (typeof w !== 'number' || !isFinite(w) || w < 0 || w > 1) return false;
      if (typeof inten !== 'number' || !isFinite(inten) || inten < 0 || inten > 1) return false;
    }
    return true;
  }
  function _validateDriftAmplitude(amp) {
    if (!amp || typeof amp !== 'object') return false;
    if (typeof amp.base !== 'number' || !isFinite(amp.base) || amp.base < 0 || amp.base > 1) return false;
    if (typeof amp.beatScale !== 'number' || !isFinite(amp.beatScale) || amp.beatScale < 0 || amp.beatScale > 1) return false;
    return true;
  }
  function _validateTuning(t) {
    if (!t || typeof t !== 'object') return false;
    if (typeof t.minTickMs !== 'number' || !isFinite(t.minTickMs) || t.minTickMs < 1 || t.minTickMs > 10000) return false;
    if (typeof t.maxTickMs !== 'number' || !isFinite(t.maxTickMs) || t.maxTickMs < 1 || t.maxTickMs > 10000) return false;
    if (t.minTickMs > t.maxTickMs) return false;
    return true;
  }

  // ---- Runtime drift (uses config amplitudes when set) --------------------
  // Mirrors SWR_AUTOMIX.drift() but with config-driven amplitudes. Applied
  // on top of A.mix()'s output when _driftAmplitude is set; compound effect
  // is bounded because both drift passes clamp to [-1, 1] per field.
  function _runtimeDrift(preset, beat) {
    if (!preset) return preset;
    var b = (typeof beat === 'number' && isFinite(beat)) ? Math.max(0, Math.min(1, beat)) : 0;
    var base = _driftAmplitude ? _driftAmplitude.base : DRIFT_BASE_DEFAULT;
    var beatScale = _driftAmplitude ? _driftAmplitude.beatScale : DRIFT_BEAT_DEFAULT;
    var amplitude = base + beatScale * b;
    var out = {};
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      var delta = (Math.random() - 0.5) * 2 * amplitude;
      out[k] = Math.max(-1, Math.min(1, preset[k] + delta));
    }
    return out;
  }

  // ---- Custom computeTickInterval (uses config tuning when set) ----------
  function _runtimeComputeTickInterval(features) {
    var f = features || {};
    var rms = (typeof f.rms === 'number') ? f.rms : 0;
    var onset = (typeof f.onset === 'number') ? f.onset : 0;
    var intensity = Math.max(0, Math.min(1, rms * 1.5 + onset * 0.8));
    var min = _tuning ? _tuning.minTickMs : TICK_MIN_DEFAULT;
    var max = _tuning ? _tuning.maxTickMs : TICK_MAX_DEFAULT;
    return Math.round(max - intensity * (max - min));
  }

  // ---- Toggle label updater (preserves inner #automix-state span) --------
  function _applyToggleLabel(label) {
    try {
      var el = document.getElementById('automix-toggle');
      if (!el) return;
      var span = document.getElementById('automix-state');
      var stateText = (span && span.textContent) || 'OFF';
      if (span && span.parentNode === el) {
        // Preserve the existing <span id="automix-state"> child structure.
        // Find the leading text node before the span and update it; if
        // there's no text node, prepend one. Falls back to plain text if
        // the DOM is too simple to walk safely.
        var textNode = null;
        var nodes = el.childNodes;
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].nodeType === 3) { textNode = nodes[i]; break; }
          if (nodes[i] === span) break;
        }
        if (textNode) {
          textNode.textContent = label + ' ';
        } else {
          el.insertBefore(document.createTextNode(label + ' '), span);
        }
        span.textContent = stateText;
      } else {
        el.textContent = label;
      }
    } catch (_) {}
  }

  // ---- Config loader (Task 1) ---------------------------------------------
  // Reads #swrc-automix-config (or `jsonOverride` if provided for tests),
  // parses JSON, validates each optional field, applies valid entries to
  // runtime state. Missing or invalid JSON → console.warn + defaults.
  function loadConfig(jsonOverride) {
    var json;
    if (typeof jsonOverride === 'string') {
      json = jsonOverride;
    } else {
      try {
        var el = document.getElementById('swrc-automix-config');
        json = el ? el.textContent : null;
      } catch (_) {
        json = null;
      }
    }
    if (!json || typeof json !== 'string') return null;
    var cfg;
    try {
      cfg = JSON.parse(json);
    } catch (err) {
      if (typeof console !== 'undefined' && console && console.warn) {
        console.warn('automix: invalid config JSON, using defaults', err);
      }
      return null;
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      if (typeof console !== 'undefined' && console && console.warn) {
        console.warn('automix: config must be a plain object, using defaults');
      }
      return null;
    }

    _config = cfg;

    // enabled: false → hide toggle (and skip remaining config so the
    // variant stays inert until someone ships a real kill-switch).
    if (cfg.enabled === false) {
      try {
        var toggle = document.getElementById('automix-toggle');
        if (toggle && toggle.style) toggle.style.display = 'none';
      } catch (_) {}
      return cfg;
    }

    // poolBias partial override — merge into SWR_AUTOMIX.POOL_BIAS
    if (cfg.poolBias && typeof cfg.poolBias === 'object' &&
        window.SWR_AUTOMIX && window.SWR_AUTOMIX.POOL_BIAS) {
      for (var section in cfg.poolBias) {
        if (!Object.prototype.hasOwnProperty.call(cfg.poolBias, section)) continue;
        var bias = cfg.poolBias[section];
        if (_validateBias(bias)) {
          window.SWR_AUTOMIX.POOL_BIAS[section] = {
            warmth: bias.warmth.slice(),
            intensity: bias.intensity.slice(),
          };
        }
      }
    }

    // driftAmplitude
    if (cfg.driftAmplitude && typeof cfg.driftAmplitude === 'object') {
      if (_validateDriftAmplitude(cfg.driftAmplitude)) {
        _driftAmplitude = {
          base: cfg.driftAmplitude.base,
          beatScale: cfg.driftAmplitude.beatScale,
        };
      }
    }

    // tuning (minTickMs, maxTickMs)
    if (cfg.tuning && typeof cfg.tuning === 'object') {
      if (_validateTuning(cfg.tuning)) {
        _tuning = {
          minTickMs: cfg.tuning.minTickMs,
          maxTickMs: cfg.tuning.maxTickMs,
        };
      }
    }

    // anchorMap: "all" → no-op (reserved for future gradient:<id> slicing)

    // ui.toggleLabel / ui.toggleShortcut
    if (cfg.ui && typeof cfg.ui === 'object') {
      if (typeof cfg.ui.toggleLabel === 'string') {
        _applyToggleLabel(cfg.ui.toggleLabel);
      }
      if (typeof cfg.ui.toggleShortcut === 'string' && cfg.ui.toggleShortcut.length > 0) {
        _toggleShortcut = cfg.ui.toggleShortcut.toLowerCase();
      }
    }

    // defaultState: "on" → start (off is the no-op default)
    if (cfg.defaultState === 'on' && window.SWR_AUTOMIX) {
      try { automix.start(); } catch (_) {}
    }

    return cfg;
  }

  // ---- The automix runtime ------------------------------------------------
  var automix = {
    iv: null,
    beatIv: null,
    enabled: false,
    frozen: false,
    locked: false,
    lastBeatPulse: false,
    lastPreset: null,
    lastChangeTs: 0,
    flatSinceTs: 0,
    lastAntiPatternTs: 0,
    tickCount: 0,
    sectionState: { current: 'verse', pending: null, pendingCount: 0 },
    _fxFrom: null,
    _fxT0: 0,
    _lastNudgeBeatInBar: null,
    _lastCoords: null,
    _lastAnchorId: null,
    _firstTickTs: 0,
    _lastIntervalMs: 0,

    toggle() {
      if (this.enabled) this.stop(); else this.start();
    },

    start() {
      if (this.enabled || !window.SWR_AUTOMIX) return;
      this.enabled = true;
      var now = Date.now();
      this.lastChangeTs = now;
      this.flatSinceTs = now;
      this.lastAntiPatternTs = now;
      this.tick();
      this._scheduleNext();
      this._startBeatPoll();
      this._updateUI('ON');
      try { localStorage.setItem('swr.automix.enabled', '1'); } catch (_) {}
    },

    stop() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.iv) { clearTimeout(this.iv); this.iv = null; }
      if (this.beatIv) { clearInterval(this.beatIv); this.beatIv = null; }
      if (window.SWR && window.SWR.Gradient && window.SWR.Gradient.setAutomixAnchor) {
        window.SWR.Gradient.setAutomixAnchor(null);
      }
      this._updateUI('OFF');
      try { localStorage.setItem('swr.automix.enabled', '0'); } catch (_) {}
    },

    _scheduleNext() {
      if (!this.enabled || this.frozen) return;
      if (this.iv) clearTimeout(this.iv);
      var feat = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
      // Use runtime computeTickInterval when config overrides tuning,
      // else delegate to SWR_AUTOMIX (default behaviour).
      var interval;
      if (_tuning) {
        interval = _runtimeComputeTickInterval(feat);
      } else if (window.SWR_AUTOMIX && window.SWR_AUTOMIX.computeTickInterval) {
        interval = window.SWR_AUTOMIX.computeTickInterval(feat);
      } else {
        interval = TICK_DEFAULT_MS;
      }
      this._lastIntervalMs = interval;
      this.iv = setTimeout(function () {
        this.tick();
        if (this.enabled && !this.frozen) this._scheduleNext();
      }.bind(this), interval);
    },

    _startBeatPoll() {
      if (this.beatIv) return;
      this.beatIv = setInterval(this._onBeatPoll.bind(this), 33);
    },

    _onBeatPoll() {
      if (!this.enabled || this.frozen) return;
      var feat = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
      var pulse = !!feat.beatPulse;
      if (pulse && !this.lastBeatPulse) {
        this._applyBeatDrift(feat);
        if (typeof feat.beatInBar === 'number') this._applyBarNudge(feat);
      }
      this.lastBeatPulse = pulse;
    },

    _applyBeatDrift(feat) {
      if (!window.SWR || !window.SWR._fxOverride) return;
      var intensity = (typeof feat.onset === 'number') ? Math.max(0, Math.min(1, feat.onset)) : 0;
      var newPreset = window.SWR_AUTOMIX.drift(window.SWR._fxOverride, intensity);
      this._setTarget(newPreset);
    },

    _applyBarNudge(feat) {
      if (!window.SWR || !window.SWR._fxOverride) return;
      if (typeof feat.beatInBar !== 'number') return;
      if (typeof feat.bpm !== 'number' || feat.bpm <= 0) return;
      if (!window.SWR_ANCHOR_MAP || !window.SWR_ANCHOR_MAP.neighbours) return;
      var beatsPerNudge = Math.max(2, Math.round(feat.bpm / 30));
      if (!this._lastNudgeBeatInBar || this._lastNudgeBeatInBar === 0) {
        this._lastNudgeBeatInBar = feat.beatInBar;
        return;
      }
      var delta = ((feat.beatInBar - this._lastNudgeBeatInBar) % 4 + 4) % 4;
      if (delta < beatsPerNudge) return;
      var coords = window.SWR_AUTOMIX.featuresToCoordsV2(feat);
      var nn = window.SWR_ANCHOR_MAP.neighbours(coords, 8);
      if (!nn || nn.length < 2) return;
      var others = nn.filter(function (a) { return a.id !== this._lastAnchorId; }.bind(this));
      var pool = (others.length > 0) ? others : nn;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (!pick || !pick.anchor || !pick.anchor.preset) return;
      var lerped = window.SWR_AUTOMIX.lerpPreset(window.SWR._fxOverride, pick.anchor.preset, 0.25);
      this._setTarget(lerped);
      this._lastNudgeBeatInBar = feat.beatInBar;
    },

    _setTarget(preset) {
      if (!preset) return;
      var SWR = window.SWR;
      if (!SWR) return;
      if (SWR._fxOverride) this._fxFrom = Object.assign({}, SWR._fxOverride);
      this._fxT0 = performance.now();
      SWR._fxOverride = preset;
    },

    tick() {
      if (this.frozen) return;
      var SWR = window.SWR; if (!SWR || !SWR.Audio) return;
      var feat = SWR.Audio.feat || {};

      var sectionResult = window.SWR_AUTOMIX.tickSection(feat, this.sectionState);
      this.sectionState = sectionResult;
      var section = sectionResult.current;

      var centroidVar = (typeof feat.centroidVar === 'number') ? feat.centroidVar : 1;
      if (centroidVar < window.SWR_AUTOMIX.FLAT_CENTROID_VAR) {
        if (!this.flatSinceTs) this.flatSinceTs = Date.now();
      } else {
        this.flatSinceTs = 0;
      }

      var n = (window.HologramState && window.HologramState.neighbours) || 4;
      var mixed;

      if (this.locked) {
        var coords = window.SWR_AUTOMIX.featuresToCoordsV2(feat);
        var nn = (window.SWR_ANCHOR_MAP && window.SWR_ANCHOR_MAP.neighbours)
          ? window.SWR_ANCHOR_MAP.neighbours(coords, 1) : [];
        if (nn && nn[0]) {
          mixed = { coords: coords, anchors: [nn[0]], preset: nn[0].anchor.preset, section: section };
        }
      } else {
        mixed = window.SWR_AUTOMIX.mix(feat, n, { section: section });
      }

      if (!mixed || !mixed.preset) return;

      // When config overrides drift amplitudes, re-apply drift on top of
      // A.mix()'s drift using the config-driven amplitudes. The compound
      // is bounded: both passes clamp to [-1, 1] per field, and the
      // combined amplitude stays well within the safe preset range.
      if (_driftAmplitude && mixed.preset) {
        mixed.preset = _runtimeDrift(mixed.preset, feat.beat);
      }

      var now = Date.now();
      if (window.SWR_AUTOMIX.isStuck(this.lastPreset, mixed.preset, now - this.lastChangeTs)) {
        var sceneChange = this._findSceneChange(mixed.coords);
        if (sceneChange && sceneChange.anchor && sceneChange.anchor.preset) {
          mixed.preset = Object.assign({}, mixed.preset, sceneChange.anchor.preset);
          mixed.anchors = [sceneChange];
        }
        this.lastChangeTs = now;
      } else if (this.lastPreset &&
          window.SWR_AUTOMIX.presetDistance(this.lastPreset, mixed.preset) > 0.05) {
        this.lastChangeTs = now;
      }
      this.lastPreset = Object.assign({}, mixed.preset);

      this._setTarget(mixed.preset);

      if (this.flatSinceTs && (now - this.flatSinceTs) >= window.SWR_AUTOMIX.FLAT_DURATION_MS
          && (now - this.lastAntiPatternTs) >= window.SWR_AUTOMIX.ANTI_PATTERN_INTERVAL_MS) {
        var tweak = this._antiPatternMutation();
        if (tweak) {
          this._setTarget(window.SWR_AUTOMIX.lerpPreset(mixed.preset, tweak, 0.5));
          this.lastAntiPatternTs = now;
        }
      }

      var pill = $('synth-pill');
      if (pill && mixed.anchors[0]) pill.textContent = 'auto · ' + mixed.anchors[0].id;
      if (SWR.Gradient && mixed.anchors[0]) {
        SWR.Gradient.setAutomixAnchor(mixed.anchors[0].id);
      }

      this._lastCoords = mixed.coords;
      this._lastAnchorId = mixed.anchors[0] ? mixed.anchors[0].id : null;

      if (window.SWR_LAST_MIX) {
        window.SWR_LAST_MIX.save({
          ts: now,
          coords: mixed.coords,
          anchors: mixed.anchors,
          preset: mixed.preset,
          section: section,
        });
      }

      this.tickCount += 1;
      this._emit('swr-automix-tick', { mixed: mixed, section: section });
    },

    _findSceneChange(coords) {
      if (!window.SWR_ANCHOR_MAP || !window.SWR_ANCHOR_MAP.neighbours) return null;
      var nn = window.SWR_ANCHOR_MAP.neighbours(coords, 1);
      if (!nn || !nn[0]) return null;
      var target = nn[0].anchor;
      if (typeof target.warmth !== 'number') return null;
      var targetCoords = { warmth: target.warmth, intensity: target.intensity };
      var hopNeighbours = window.SWR_ANCHOR_MAP.neighbours(targetCoords, 3);
      if (!hopNeighbours || hopNeighbours.length < 2) return null;
      var pickIdx = 1 + Math.floor(Math.random() * (hopNeighbours.length - 1));
      return hopNeighbours[pickIdx];
    },

    _antiPatternMutation() {
      if (!window.SWR || !window.SWR._fxOverride) return null;
      var cur = window.SWR._fxOverride;
      var presets = [
        // Chromatic bloom
        { temp: cur.temp || 0, mut: Math.min(1, (cur.mut || 0) + 0.3),
          sepia: cur.sepia || 0, chroma: Math.min(1, (cur.chroma || 0) + 0.4),
          grain: cur.grain || 0, glow: Math.min(1, (cur.glow || 0) + 0.3),
          grayscale: cur.grayscale || 0, posterize: cur.posterize || 0 },
        // Dense grain
        { temp: cur.temp || 0, mut: cur.mut || 0, sepia: cur.sepia || 0,
          chroma: cur.chroma || 0, grain: Math.min(1, (cur.grain || 0) + 0.4),
          glow: cur.glow || 0, grayscale: Math.min(1, (cur.grayscale || 0) + 0.2),
          posterize: Math.min(1, (cur.posterize || 0) + 0.15) },
        // Strong glow + temp shift
        { temp: Math.max(-1, Math.min(1, (cur.temp || 0) + 0.25)), mut: cur.mut || 0,
          sepia: cur.sepia || 0, chroma: cur.chroma || 0, grain: cur.grain || 0,
          glow: Math.min(1, (cur.glow || 0) + 0.5),
          grayscale: cur.grayscale || 0, posterize: cur.posterize || 0 },
      ];
      return presets[Math.floor(Math.random() * presets.length)];
    },

    freeze() {
      this.frozen = !this.frozen;
      if (this.frozen) {
        if (this.iv) { clearTimeout(this.iv); this.iv = null; }
      } else if (this.enabled) {
        this._scheduleNext();
      }
      this._updateUI(this.frozen ? 'FROZEN' : (this.enabled ? 'ON' : 'OFF'));
      this._emit('swr-automix-freeze', { frozen: this.frozen });
      return this.frozen;
    },

    saveBlend() {
      if (!window.SWR || !window.SWR._fxOverride) return null;
      var saved = {
        ts: Date.now(),
        preset: Object.assign({}, window.SWR._fxOverride),
        name: 'auto-' + new Date().toISOString().slice(11, 19).replace(/:/g, ''),
      };
      try {
        var KEY = 'swrc.presets.user.v1';
        var list = JSON.parse(localStorage.getItem(KEY) || '[]');
        list.push(saved);
        while (list.length > 16) list.shift();
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch (_) {}
      if (typeof window.setStatus === 'function') window.setStatus('saved blend · ' + saved.name, 'ok');
      this._emit('swr-automix-save', saved);
      return saved;
    },

    lockToNearest() {
      this.locked = !this.locked;
      this._updateUI(this.locked ? 'LOCKED' : (this.enabled ? 'ON' : 'OFF'));
      this._emit('swr-automix-lock', { locked: this.locked });
      return this.locked;
    },

    _updateUI(state) {
      var lab = $('automix-state');
      if (lab) {
        lab.textContent = state;
        lab.style.color = state === 'OFF' ? 'var(--m)' : 'var(--g)';
      }
    },

    _emit(name, detail) {
      try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
    },
  };

  // ---- UI wiring ----------------------------------------------------------
  function _setBtnActive(btn, on) {
    if (!btn) return;
    btn.classList.toggle('active', !!on);
  }

  function _renderDebug() {
    var body = $('automix-debug-body');
    if (!body) return;
    var f = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
    var last = automix.lastPreset || {};
    var tickRate = automix.tickCount > 1
      ? (automix.tickCount / ((Date.now() - (automix._firstTickTs || Date.now())) / 60000)).toFixed(1)
      : '0.0';
    var coords = automix._lastCoords || { warmth: 0.5, intensity: 0.5 };
    var lines = [
      'section    ' + automix.sectionState.current + ' (' + ((f.sectionConfidence || 0).toFixed(2)) + ')',
      'coords     w=' + coords.warmth.toFixed(2) + ' i=' + coords.intensity.toFixed(2),
      'anchor     ' + (automix._lastAnchorId || '\u2014'),
      'tickRate   ' + tickRate + ' / min',
      'interval   ' + (automix._lastIntervalMs || '\u2014') + ' ms',
      'frozen     ' + (automix.frozen ? 'yes' : 'no') + '    locked ' + (automix.locked ? 'yes' : 'no'),
      'preset     temp=' + (last.temp || 0).toFixed(2) + ' mut=' + (last.mut || 0).toFixed(2) + ' chroma=' + (last.chroma || 0).toFixed(2),
      '           glow=' + (last.glow || 0).toFixed(2) + ' grain=' + (last.grain || 0).toFixed(2) + ' sepia=' + (last.sepia || 0).toFixed(2),
    ];
    body.textContent = lines.join('\n');
  }

  function _toggleDebug() {
    var panel = $('automix-debug-panel');
    var btn = $('automix-debug');
    if (!panel) return;
    var open = !panel.hidden;
    panel.hidden = open;
    _setBtnActive(btn, !open);
    try { localStorage.setItem('swr.automix.debugOpen', open ? '0' : '1'); } catch (_) {}
    if (!open) {
      automix._firstTickTs = Date.now();
      _renderDebug();
    }
  }

  var _wired = false;
  var _listener = null;

  function wire() {
    if (_wired) return;
    var toggleBtn = $('automix-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', function () { automix.toggle(); });

    var freezeBtn = $('automix-freeze');
    if (freezeBtn) freezeBtn.addEventListener('click', function () {
      var wasEnabled = automix.enabled;
      if (!wasEnabled) automix.start();
      automix.freeze();
      _setBtnActive(freezeBtn, automix.frozen);
    });

    var saveBtn = $('automix-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var result = automix.saveBlend();
      saveBtn.classList.add('active');
      setTimeout(function () { saveBtn.classList.remove('active'); }, 350);
    });

    var lockBtn = $('automix-lock');
    if (lockBtn) lockBtn.addEventListener('click', function () {
      automix.lockToNearest();
      _setBtnActive(lockBtn, automix.locked);
    });

    var debugBtn = $('automix-debug');
    if (debugBtn) debugBtn.addEventListener('click', _toggleDebug);
    var debugClose = $('automix-debug-close');
    if (debugClose) debugClose.addEventListener('click', function () {
      var panel = $('automix-debug-panel');
      if (panel) panel.hidden = true;
      _setBtnActive($('automix-debug'), false);
      try { localStorage.setItem('swr.automix.debugOpen', '0'); } catch (_) {}
    });

    _listener = function () {
      var panel = $('automix-debug-panel');
      if (panel && !panel.hidden) _renderDebug();
    };
    window.addEventListener('swr-automix-tick', _listener);

    // Persisted debug-open state
    try {
      if (localStorage.getItem('swr.automix.debugOpen') === '1' && $('automix-debug-panel')) {
        $('automix-debug-panel').hidden = false;
        _setBtnActive($('automix-debug'), true);
      }
    } catch (_) {}

    // Keyboard shortcuts: A/F/B/K/D
    document.addEventListener('keydown', _onKey);

    // URL deep-links: ?automix=1, ?automix-debug=1, ?automix-frozen=1, ?automix-locked=1
    _parseURL();

    // Persisted enabled state
    try {
      if (localStorage.getItem('swr.automix.enabled') === '1' && window.SWR_AUTOMIX) {
        automix.start();
      }
    } catch (_) {}

    _wired = true;
  }

  function _onKey(ev) {
    if (!ev || ev.defaultPrevented) return;
    var k = ev.key;
    var lower = typeof k === 'string' ? k.toLowerCase() : '';
    var toggleKey = _toggleShortcut || 'a';
    if (lower === toggleKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      automix.toggle();
      ev.preventDefault();
    } else if (lower === 'f' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      automix.freeze();
      ev.preventDefault();
    } else if (lower === 'b' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      automix.saveBlend();
      ev.preventDefault();
    } else if (lower === 'k' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      automix.lockToNearest();
      ev.preventDefault();
    } else if (lower === 'd' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      _toggleDebug();
      ev.preventDefault();
    }
  }

  function _parseURL() {
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get('automix') === '1' && window.SWR_AUTOMIX) {
        automix.start();
      }
      if (q.get('automix-frozen') === '1' && !automix.enabled) automix.start();
      if (q.get('automix-frozen') === '1') automix.freeze();
      if (q.get('automix-locked') === '1' && !automix.enabled) automix.start();
      if (q.get('automix-locked') === '1') automix.lockToNearest();
      if (q.get('automix-debug') === '1') {
        var panel = $('automix-debug-panel');
        if (panel) {
          panel.hidden = false;
          _setBtnActive($('automix-debug'), true);
        }
      }
    } catch (_) {}
  }

  function unwire() {
    if (!_wired) return;
    document.removeEventListener('keydown', _onKey);
    if (_listener) window.removeEventListener('swr-automix-tick', _listener);
    _wired = false;
  }

  // ---- Public API ---------------------------------------------------------
  window.automix = automix;
  window.SWR_AUTOMIX_RUNTIME = {
    automix: automix,
    version: '1.0.0',
    ui: { wire: wire, unwire: unwire, renderDebug: _renderDebug },
    // Task 1 — config-loader hooks for tests + diagnostics.
    loadConfig: loadConfig,
    _config: function () { return _config; },
    _driftAmplitude: function () { return _driftAmplitude; },
    _tuning: function () { return _tuning; },
    _toggleShortcut: function () { return _toggleShortcut; },
  };

  // ---- IIFE init ----------------------------------------------------------
  // Load config BEFORE wire() runs so defaultState + poolBias + drift
  // overrides take effect before any state is read or persisted state is
  // restored (localStorage 'swr.automix.enabled'). Wrapped in try/catch so
  // a malformed config can never block the runtime from wiring up.
  try { loadConfig(); } catch (_) {}

  // Auto-wire on DOMContentLoaded (or immediately if already past it)
  function _boot() { wire(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();