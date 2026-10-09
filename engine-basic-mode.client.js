/**
 * engine-basic-mode.client.js
 * 
 * Dual-mode engine: Basic (default for first-timers) and Advanced.
 * Basic mode: minimal UI, floating controls, library drawer.
 * Advanced mode: full power-user layout.
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

    // Remove old classes
    body.classList.remove('engine-basic-mode', 'engine-advanced-mode');

    // Add new class
    body.classList.add('engine-' + mode + '-mode');

    // Update toggle buttons
    updateToggleButtons(mode);

    // Show/hide welcome overlay
    updateWelcomeOverlay(mode);
  }

  function updateToggleButtons(mode) {
    var basicBtn = document.getElementById('mode-basic-btn');
    var advancedBtn = document.getElementById('mode-advanced-btn');
    if (basicBtn) basicBtn.classList.toggle('active', mode === 'basic');
    if (advancedBtn) advancedBtn.classList.toggle('active', mode === 'advanced');
  }

  function updateWelcomeOverlay(mode) {
    var overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;

    // Show welcome if first run AND in basic mode
    if (!isFirstRun() || mode === 'advanced') {
      overlay.classList.add('hidden');
    } else {
      overlay.classList.remove('hidden');
    }
  }

  // ─────────────────────────────────────────────
  // Welcome Overlay Handlers
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
  // Basic Mode UI — Song Upload
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
      // Trigger the engine's existing song loader
      if (typeof loadSongFileIntoEngine === 'function') {
        loadSongFileIntoEngine(file);
      }

      // Update basic UI
      if (badge) badge.classList.remove('hidden');
      if (title) title.textContent = file.name.replace(/\.[^.]+$/, '');
      if (artist) artist.textContent = 'Local file';
      if (emptyState) emptyState.classList.add('hidden');
      if (zone) zone.style.display = 'none';
    }
  }

  // ─────────────────────────────────────────────
  // Basic Mode UI — Clip Selection
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

    // Also add to the engine's layer system
    if (typeof addLayerToEngine === 'function') {
      addLayerToEngine(name || ('Layer ' + basicLayerCount));
    }
  }

  function initBasicClips() {
    var grid = document.getElementById('basic-clips-grid');
    if (!grid) return;

    grid.querySelectorAll('.basic-clip .add-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var clip = btn.closest('.basic-clip');
        var name = clip && (clip.dataset.name || clip.querySelector('.name') && clip.querySelector('.name').textContent);
        addBasicLayer(name);
      });
    });
  }

  // ─────────────────────────────────────────────
  // Basic Mode UI — Floating Controls
  // ─────────────────────────────────────────────

  function initBasicControls() {
    var playBtn = document.getElementById('basic-play-btn');
    var recordBtn = document.getElementById('basic-record-btn');
    var libraryBtn = document.getElementById('basic-library-btn');
    var effectsBtn = document.getElementById('basic-effects-btn');
    var libraryDrawer = document.getElementById('basic-library-drawer');
    var libraryClose = document.getElementById('basic-library-close');

    // Play toggle
    if (playBtn) {
      var playing = false;
      playBtn.addEventListener('click', function () {
        playing = !playing;
        playBtn.textContent = playing ? '⏸' : '▶';
        if (typeof enginePlay === 'function') enginePlay();
      });
    }

    // Record toggle
    if (recordBtn) {
      var recording = false;
      recordBtn.addEventListener('click', function () {
        recording = !recording;
        recordBtn.classList.toggle('recording', recording);
        recordBtn.classList.toggle('primary', !recording);
        if (typeof engineRecord === 'function') engineRecord(recording);
      });
    }

    // Library drawer
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

    // Effects button (placeholder)
    if (effectsBtn) {
      effectsBtn.addEventListener('click', function () {
        // Open effects panel or show message
        if (typeof openEffectsPanel === 'function') {
          openEffectsPanel();
        } else if (typeof window.SWR_FX !== 'undefined') {
          // Try to open presets panel as fallback
          var presetsToggle = document.getElementById('presets-toggle');
          if (presetsToggle) presetsToggle.click();
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // Mode Toggle — Header Buttons
  // ─────────────────────────────────────────────

  function initModeToggle() {
    var basicBtn = document.getElementById('mode-basic-btn');
    var advancedBtn = document.getElementById('mode-advanced-btn');
    var proBannerBtn = document.getElementById('pro-banner-upgrade-btn');

    if (basicBtn) {
      basicBtn.addEventListener('click', function () {
        setMode('basic');
      });
    }

    if (advancedBtn) {
      advancedBtn.addEventListener('click', function () {
        setMode('advanced');
      });
    }

    if (proBannerBtn) {
      proBannerBtn.addEventListener('click', function () {
        setMode('advanced');
      });
    }
  }

  // ─────────────────────────────────────────────
  // Welcome Overlay Init
  // ─────────────────────────────────────────────

  function initWelcomeOverlay() {
    var startBtn = document.getElementById('welcome-start-btn');
    var advancedBtn = document.getElementById('welcome-advanced-btn');

    if (startBtn) {
      startBtn.addEventListener('click', handleWelcomeStart);
    }

    if (advancedBtn) {
      advancedBtn.addEventListener('click', handleWelcomeAdvanced);
    }
  }

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────

  function init() {
    // Set initial mode
    CURRENT_MODE = getMode();

    // Apply mode class to body
    applyMode();

    // Init all components
    initModeToggle();
    initWelcomeOverlay();
    initBasicUpload();
    initBasicClips();
    initBasicControls();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API for engine integration
  window.SWR_ENGINE_MODE = {
    getMode: getMode,
    setMode: setMode,
    isFirstRun: isFirstRun,
    addBasicLayer: addBasicLayer
  };

})();
