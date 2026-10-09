/**
 * engine-basic-mode.client.js
 *
 * Dual-mode engine: Basic (default for first-timers) and Advanced.
 * Basic mode: minimal UI, floating controls, library drawer.
 * Advanced mode: full power-user layout.
 *
 * All basic controls are wired to the engine's existing IIFE functions:
 *   - window.Audio.loadFile()     — song loading
 *   - window.Audio.play() / .pause() — playback
 *   - Recorder.start() / .stop()  — recording
 *   - Library.addFiles()          — adding clips to the stage
 *
 * Mode preference persists in localStorage under 'swr.engine.mode'.
 * First-time users see a welcome overlay (persisted under 'swr.engine.firstRun').
 */

(function () {
  'use strict';

  var MODE_KEY = 'swr.engine.mode';
  var FIRST_RUN_KEY = 'swr.engine.firstRun';
  var CURRENT_MODE = null;

  // ─────────────────────────────────────────────
  // Mode Management
  // ─────────────────────────────────────────────

  function getMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      return m === 'advanced' ? 'advanced' : 'basic';
    } catch (e) {
      return 'basic';
    }
  }

  function setMode(mode, skipPersist) {
    CURRENT_MODE = mode;
    try {
      if (!skipPersist) localStorage.setItem(MODE_KEY, mode);
    } catch (e) {}
    applyMode();
  }

  function isFirstRun() {
    try {
      return localStorage.getItem(FIRST_RUN_KEY) !== 'false';
    } catch (e) {
      return true;
    }
  }

  function markFirstRunDone() {
    try {
      localStorage.setItem(FIRST_RUN_KEY, 'false');
    } catch (e) {}
  }

  // ─────────────────────────────────────────────
  // Apply Mode to DOM
  // ─────────────────────────────────────────────

  function applyMode() {
    var mode = CURRENT_MODE || getMode();
    var body = document.body;

    body.classList.remove('engine-basic-mode', 'engine-advanced-mode');
    body.classList.add('engine-' + mode + '-mode');

    updateToggleButtons(mode);
    updateWelcomeOverlay(mode);
  }

  function updateToggleButtons(mode) {
    // Update both toggle button sets (transport header + basic header)
    var selectors = [
      'mode-basic-btn',
      'mode-advanced-btn',
      'mode-basic-btn-2',
      'mode-advanced-btn-2'
    ];
    selectors.forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      if (id.indexOf('basic') >= 0) {
        btn.classList.toggle('active', mode === 'basic');
      } else {
        btn.classList.toggle('active', mode === 'advanced');
      }
    });
  }

  function updateWelcomeOverlay(mode) {
    var overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;
    if (!isFirstRun() || mode === 'advanced') {
      overlay.classList.add('hidden');
    } else {
      overlay.classList.remove('hidden');
    }
  }

  // ─────────────────────────────────────────────
  // Welcome Overlay
  // ─────────────────────────────────────────────

  function handleWelcomeStart() {
    markFirstRunDone();
    var overlay = document.getElementById('welcome-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function handleWelcomeAdvanced() {
    markFirstRunDone();
    setMode('advanced');
    var overlay = document.getElementById('welcome-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ─────────────────────────────────────────────
  // Basic Mode — Song Upload
  // ─────────────────────────────────────────────

  function initBasicUpload() {
    var zone = document.getElementById('basic-upload-zone');
    var input = document.getElementById('basic-song-input');
    var badge = document.getElementById('basic-song-badge');
    var title = document.getElementById('basic-song-title');
    var artist = document.getElementById('basic-song-artist');
    var emptyState = document.getElementById('basic-empty-state');

    if (!zone || !input) return;

    zone.addEventListener('click', function () {
      input.click();
    });

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', function () {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
        loadSongFile(file);
      }
    });

    input.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) loadSongFile(file);
    });

    function loadSongFile(file) {
      // Wire to engine's Audio.loadFile (attached by lib/audio.client.js)
      if (window.Audio && typeof window.Audio.loadFile === 'function') {
        window.Audio.loadFile(file);
      } else {
        // Fallback: dispatch through the existing #song-input if available
        var engineInput = document.getElementById('song-input');
        if (engineInput) {
          var dt = new DataTransfer();
          dt.items.add(file);
          engineInput.files = dt.files;
          engineInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Update basic UI badge
      if (badge) badge.classList.remove('hidden');
      if (title) title.textContent = file.name.replace(/\.[^.]+$/, '');
      if (artist) artist.textContent = 'Local file';
      if (emptyState) emptyState.classList.add('hidden');
      if (zone) zone.style.display = 'none';
    }
  }

  // ─────────────────────────────────────────────
  // Basic Mode — Layer Pills + Add Clips
  // ─────────────────────────────────────────────

  var basicLayerCount = 0;
  var basicLayersContainer = null;

  function addBasicLayer(name) {
    basicLayerCount++;
    if (!basicLayersContainer) {
      basicLayersContainer = document.getElementById('basic-layers');
    }
    if (!basicLayersContainer) return;

    var pill = document.createElement('div');
    pill.className = 'basic-layer-pill active';
    pill.textContent = basicLayerCount;
    pill.title = name || ('Layer ' + basicLayerCount);
    basicLayersContainer.appendChild(pill);
  }

  function initBasicClips() {
    var grid = document.getElementById('basic-clips-grid');
    if (!grid) return;

    grid.querySelectorAll('.basic-clip .add-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var clip = btn.closest('.basic-clip');
        var name = clip && (clip.dataset.name || (clip.querySelector('.name') && clip.querySelector('.name').textContent));
        addBasicLayer(name);

        // Also add to the engine's Library (attaches to stage)
        if (clip && clip.querySelector('img')) {
          var img = clip.querySelector('img');
          // For demo clips from picsum, load them as files via fetch → blob
          var src = img && img.src;
          if (src && src.startsWith('http')) {
            fetch(src)
              .then(function (r) { return r.blob(); })
              .then(function (blob) {
                var file = new File([blob], (name || 'clip') + '.jpg', { type: 'image/jpeg' });
                if (window.Library && typeof window.Library.addFiles === 'function') {
                  window.Library.addFiles([file]);
                }
              })
              .catch(function (err) {
                console.warn('[basic-mode] failed to load clip image', err);
              });
          }
        }
      });
    });
  }

  // ─────────────────────────────────────────────
  // Basic Mode — Floating Controls
  // ─────────────────────────────────────────────

  function initBasicControls() {
    var playBtn = document.getElementById('basic-play-btn');
    var recordBtn = document.getElementById('basic-record-btn');
    var libraryBtn = document.getElementById('basic-library-btn');
    var effectsBtn = document.getElementById('basic-effects-btn');
    var libraryDrawer = document.getElementById('basic-library-drawer');
    var libraryClose = document.getElementById('basic-library-close');

    // Play / Pause — wires to engine's Audio.play() / Audio.pause()
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        if (!window.Audio || !window.Audio.audioEl) {
          // No song loaded — trigger the song input
          var engineInput = document.getElementById('song-input');
          if (engineInput) engineInput.click();
          return;
        }
        if (window.Audio.playing) {
          window.Audio.pause();
          playBtn.textContent = '▶';
        } else {
          window.Audio.play();
          playBtn.textContent = '⏸';
        }
      });
    }

    // Record — wires to engine's Recorder.start() / Recorder.stop()
    if (recordBtn) {
      recordBtn.addEventListener('click', function () {
        if (!window.Audio || !window.Audio.audioEl) {
          window.UI && window.UI.setStatus && window.UI.setStatus('load a song first', 'warn');
          return;
        }
        if (window.Recorder && window.Recorder.recording) {
          window.Recorder.stop();
          recordBtn.classList.remove('recording');
          recordBtn.classList.add('primary');
          recordBtn.textContent = '⏺';
        } else {
          // Start recording — auto-play audio first
          if (window.Audio && !window.Audio.playing) {
            window.Audio.play();
          }
          if (window.Recorder && typeof window.Recorder.start === 'function') {
            window.Recorder.start();
          }
          recordBtn.classList.add('recording');
          recordBtn.classList.remove('primary');
          recordBtn.textContent = '⏹';
        }
      });
    }

    // Library drawer open/close
    if (libraryBtn && libraryDrawer) {
      libraryBtn.addEventListener('click', function () {
        libraryDrawer.classList.add('open');
      });
    }
    if (libraryClose && libraryDrawer) {
      libraryClose.addEventListener('click', function () {
        libraryDrawer.classList.remove('open');
      });
    }

    // Effects — open the engine's presets/FX panel via existing toggle
    if (effectsBtn) {
      effectsBtn.addEventListener('click', function () {
        var presetsToggle = document.getElementById('presets-toggle');
        if (presetsToggle) {
          presetsToggle.click();
        } else {
          // Fallback: switch to advanced mode where FX panel lives
          setMode('advanced');
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // Mode Toggle
  // ─────────────────────────────────────────────

  function initModeToggle() {
    // Transport header toggle (both basic and advanced header have these)
    ['mode-basic-btn', 'mode-advanced-btn', 'mode-basic-btn-2', 'mode-advanced-btn-2'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (id.indexOf('basic') >= 0) {
          setMode('basic');
        } else {
          setMode('advanced');
        }
      });
    });

    // Pro banner upgrade button
    var proBtn = document.getElementById('pro-banner-upgrade-btn');
    if (proBtn) {
      proBtn.addEventListener('click', function () {
        setMode('advanced');
      });
    }
  }

  // ─────────────────────────────────────────────
  // Library Drawer — drag & drop
  // ─────────────────────────────────────────────

  function initLibraryDrawer() {
    var uploadArea = document.querySelector('.basic-library-upload');
    if (uploadArea) {
      uploadArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
      });
      uploadArea.addEventListener('dragleave', function () {
        uploadArea.classList.remove('drag-over');
      });
      uploadArea.addEventListener('drop', function (e) {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length && window.Library && typeof window.Library.addFiles === 'function') {
          window.Library.addFiles(Array.prototype.slice.call(files));
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────

  function init() {
    CURRENT_MODE = getMode();
    applyMode();

    initModeToggle();
    initWelcomeOverlay();
    initBasicUpload();
    initBasicClips();
    initBasicControls();
    initLibraryDrawer();

    // Sync play button state with Audio events
    if (window.Audio) {
      var origPlay = window.Audio.play;
      if (origPlay) {
        window.Audio.play = function () {
          var btn = document.getElementById('basic-play-btn');
          if (btn) btn.textContent = '⏸';
          return origPlay.apply(this, arguments);
        };
      }
      var origPause = window.Audio.pause;
      if (origPause) {
        window.Audio.pause = function () {
          var btn = document.getElementById('basic-play-btn');
          if (btn) btn.textContent = '▶';
          return origPause.apply(this, arguments);
        };
      }
    }
  }

  // Run on DOMContentLoaded (engine scripts are deferred, so Audio/Library
  // may not exist yet — defer our init too so they load first)
  function doInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      // Also wait a tick for deferred engine scripts to run
      setTimeout(init, 0);
    }
  }

  doInit();

  // Public API
  window.SWR_ENGINE_MODE = {
    getMode: getMode,
    setMode: setMode,
    isFirstRun: isFirstRun,
    addBasicLayer: addBasicLayer
  };

})();
