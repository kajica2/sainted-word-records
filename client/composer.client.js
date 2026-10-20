// client/composer.client.js — Mobile-first composer driver.
//
// Wires the DOM in /composer.html to:
//   - lib/audio.client.js (audio analysis + playback)
//   - lib/library.client.js (asset storage + selection)
//   - lib/layers.client.js (layer stack)
//
// Canvas (1280x720 logical, scaled to fit) renders an audio-reactive
// composition: a rotating disc that pulses on bass + RMS, a beat ring
// flashing cyan on every beat hit, and per-layer rectangles that
// breathe with the audio. The render path uses only `transform` and
// `opacity` (Layer.tween via homeAll / retire / addText is the same
// engine we'll add later).
//
// Reduced-motion respected: animations collapse to static.

(() => {
  'use strict';
  if (window.SWR_COMPOSER) return;
  const reduceMotion = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedTransparency = !!window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;

  const DOM = document;
  const canvas = DOM.getElementById('c-canvas');
  const stageEmpty = DOM.getElementById('c-stage-empty');
  const beatRing = DOM.getElementById('c-beat-ring');
  const playBtn = DOM.getElementById('c-play');
  const playIcon = DOM.getElementById('c-play-icon');
  const songPickBtn = DOM.getElementById('c-pick-song');
  const songNameEl = DOM.getElementById('c-song-name');
  const nowPlayingEl = DOM.getElementById('c-now-playing');
  const meterFill = DOM.getElementById('c-meter-fill');
  const bpmEl = DOM.getElementById('c-bpm');
  const metaBpm = DOM.getElementById('c-meta-bpm');
  const metaKey = DOM.getElementById('c-meta-key');
  const metaRms = DOM.getElementById('c-meta-rms');
  const metaBeat = DOM.getElementById('c-meta-beat');
  const filterRow = DOM.getElementById('c-filter-row');
  const addBtn = DOM.getElementById('c-add');
  const libToggle = DOM.getElementById('c-lib-toggle');
  const recBtn = DOM.getElementById('c-rec');
  const library = DOM.getElementById('c-library');
  const libClose = DOM.getElementById('c-lib-close');
  const libGrid = DOM.getElementById('c-lib-grid');
  const scrim = DOM.getElementById('c-sheet-scrim');
  const grabber = DOM.getElementById('c-lib-grabber');

  if (!canvas) return;
  const cx = canvas.getContext('2d', { alpha: false });

  // ---- Hidden file input for picking audio + clips ----
  const audioInput = document.createElement('input');
  audioInput.type = 'file';
  audioInput.accept = 'audio/*';
  audioInput.style.display = 'none';
  document.body.appendChild(audioInput);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/*,image/*,image/gif';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // ---- Filter chip table (one per look-filter cycler slot). Skip 'none'
  // because that's tap=clear, not a chip. ----
  const FILTERS = [
    { id: 1, label: 'soft',         hue: 200 },
    { id: 2, label: 'old cinema',   hue: 30  },
    { id: 3, label: 'cool',         hue: 195 },
    { id: 4, label: 'teal',         hue: 175 },
    { id: 5, label: 'amber',        hue: 35  },
    { id: 6, label: 'rose',         hue: 340 },
    { id: 7, label: 'mono',         hue: 0   },
    { id: 8, label: 'void warm',    hue: 25  },
    { id: 9, label: 'echo',         hue: 220 },
  ];
  let activeFilter = 0; // 0 = none
  let rampStep = 0;

  function renderFilterChips() {
    filterRow.innerHTML = '';
    FILTERS.forEach((f) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.dataset.id = String(f.id);
      chip.setAttribute('aria-pressed', 'false');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(f.id);
      const lbl = document.createElement('span');
      lbl.textContent = f.label;
      chip.appendChild(num);
      chip.appendChild(lbl);
      chip.addEventListener('click', () => onFilterPress(f.id));
      filterRow.appendChild(chip);
    });
  }
  function updateFilterChipUI() {
    const chips = filterRow.querySelectorAll('.chip');
    chips.forEach((c) => {
      const id = parseInt(c.dataset.id, 10);
      c.setAttribute('aria-pressed', id === activeFilter && rampStep > 0 ? 'true' : 'false');
    });
  }

  // ---- Audio integration ----
  let audioReady = false;
  let audioFeatures = { bpm: 0, key: '', rms: 0, bass: 0, mid: 0, treble: 0, beatPulse: false, onsetPulse: false };
  let audioPlaying = false;

  function bindAudio() {
    if (!window.Audio) return;
    const A = window.Audio;
    const loopFn = () => {
      const f = (A.feat && A.feat) || {};
      if (f) {
        audioFeatures = {
          bpm: f.bpm || 0,
          key: f.key || '',
          rms: f.rms || 0,
          bass: f.bass || 0,
          mid: f.mid || 0,
          treble: f.treble || 0,
          beatPulse: !!f.beatPulse,
          onsetPulse: !!f.onsetPulse,
        };
        bpmEl.textContent = audioFeatures.bpm ? audioFeatures.bpm.toFixed(0) : '···';
        metaBpm.textContent = audioFeatures.bpm ? audioFeatures.bpm.toFixed(0) : '···';
        metaKey.textContent = audioFeatures.key || '···';
        metaRms.textContent = audioFeatures.rms.toFixed(2);
        metaBeat.textContent = audioFeatures.beatPulse ? '★' : '·';
        meterFill.style.width = Math.round(audioFeatures.rms * 100) + '%';
        // Beat ring: a cyan halo that fades out over 280ms each hit.
        if (audioFeatures.beatPulse && !reduceMotion) {
          beatRing.style.transition = 'none';
          beatRing.style.opacity = '0.85';
          beatRing.style.transform = 'translate(-50%, -50%) scale(1)';
          requestAnimationFrame(() => {
            beatRing.style.transition = 'transform .28s ease-out, opacity .28s ease-out';
            beatRing.style.transform = 'translate(-50%, -50%) scale(2.2)';
            beatRing.style.opacity = '0';
          });
        }
      }
      requestAnimationFrame(loopFn);
    };
    requestAnimationFrame(loopFn);
  }

  function bindAudioEvents() {
    if (typeof window.Audio === 'undefined' || !window.Audio) return;
    const A = window.Audio;
    A.on && A.on('ended', onSongEnd);
    A.on && A.on('play', () => { audioPlaying = true; updatePlay(); });
    A.on && A.on('pause', () => { audioPlaying = false; updatePlay(); });
  }

  function updatePlay() {
    playBtn.disabled = !audioReady;
    playBtn.setAttribute('aria-label', audioPlaying ? 'Pause' : 'Play');
    if (audioPlaying) {
      playIcon.innerHTML = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>';
    } else {
      playIcon.innerHTML = '<path d="M7 5v14l12-7z"/>';
    }
  }

  async function loadAudioFile(file) {
    songNameEl.textContent = file.name;
    if (window.Audio && typeof window.Audio.loadFile === 'function') {
      try {
        await window.Audio.loadFile(file);
        audioReady = true;
        updatePlay();
        // Auto-play after a song is picked
        await window.Audio.play();
        nowPlayingEl.textContent = file.name;
        beatRing.style.opacity = '0';
      } catch (e) {
        nowPlayingEl.textContent = 'Could not load song';
      }
    }
  }
  function onSongEnd() { audioPlaying = false; updatePlay(); }

  // ---- Stage canvas render ----
  let stageW = 0, stageH = 0, dpr = 1;
  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    stageW = r.width; stageH = r.height;
    canvas.width = Math.max(1, Math.floor(stageW * dpr));
    canvas.height = Math.max(1, Math.floor(stageH * dpr));
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Two visual "layers" — real layer model is wired via window.Layers.
  // We render 4 placeholder rectangles driven by audio features so the
  // page works before any media is picked.
  let stageT = 0;
  function paint(t) {
    stageT = t;
    if (!stageW || !stageH) return;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, stageW, stageH);
    // Soft amber + cyan halos underlay — visual answer to "what does
    // the audio-reactive stage look like before any media is loaded".
    const a = audioFeatures;
    const rms = a.rms || 0;
    const bass = a.bass || 0;
    const treble = a.treble || 0;

    const grad1 = cx.createRadialGradient(stageW * 0.5, stageH * 0.55, 0, stageW * 0.5, stageH * 0.55, stageW * 0.6);
    grad1.addColorStop(0, 'rgba(251,191,36,' + (0.10 + bass * 0.30) + ')');
    grad1.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad1;
    cx.fillRect(0, 0, stageW, stageH);

    const grad2 = cx.createRadialGradient(stageW * 0.7, stageH * 0.3, 0, stageW * 0.7, stageH * 0.3, stageW * 0.5);
    grad2.addColorStop(0, 'rgba(103,232,249,' + (0.08 + treble * 0.28) + ')');
    grad2.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad2;
    cx.fillRect(0, 0, stageW, stageH);

    // Spectrum bars along the bottom — classic visualizer, no chrome.
    const N = 40;
    const bw = stageW / N;
    for (let i = 0; i < N; i++) {
      const t2 = (i / N);
      // pseudo-spectrum from RMS + small lfo
      const lvl = Math.max(0, Math.min(1,
        rms * 0.7 + Math.sin(t * 6 + t2 * 7.3) * 0.10 + Math.sin(t * 11 + t2 * 13) * 0.06));
      const h = lvl * stageH * 0.18;
      const x = i * bw;
      const y = stageH - h;
      cx.fillStyle = i % 2 ? 'rgba(103,232,249,.55)' : 'rgba(251,191,36,.55)';
      cx.fillRect(x + 1, y, bw - 2, h);
    }

    // Layer rectangles: 4 placeholders animated by audio features.
    // Real layers from window.Layers are mirrored with the same shape.
    let layers = [];
    if (window.Layers && Array.isArray(window.Layers.list)) {
      layers = window.Layers.list;
    }
    const slots = Math.max(layers.length, 1);
    for (let i = 0; i < Math.max(slots, 1); i++) {
      const layer = layers[i];
      const cell = Math.floor((stageW - 60) / slots);
      const x = 30 + i * cell;
      const w = cell - 16;
      const h = stageH * 0.62;
      const y = (stageH - h) / 2;
      const isSelected = !!(window.Layers && window.Layers.selected === layer);
      const baseHue = (layer && (layer.color || 200)) || (200 + i * 40);
      const alpha = layer && layer._retired ? 0.08 : 0.85;
      const brightness = layer && (layer.opacity != null ? layer.opacity : 1);
      const scale = layer && (layer.baseScale || 1);
      // Tiny breathing per layer, more on lower layers (bass) and upper (treble)
      const band = (i === 0) ? bass : (i === slots - 1) ? treble : rms;
      const breathe = 1 + Math.sin(t * 1.5 + i) * 0.5 * band * 0.05;
      const cx2 = x + w / 2, cy2 = y + h / 2;
      cx.save();
      cx.translate(cx2, cy2);
      cx.scale(scale * breathe, scale * breathe);
      cx.fillStyle = 'hsla(' + baseHue + ', 80%, 60%, ' + (alpha * (brightness || 1)) + ')';
      // Optical accent: rounded rectangle, amber if selected, cyan if not
      roundRect(-w / 2, -h / 2, w, h, 14);
      cx.fill();
      if (isSelected) {
        cx.strokeStyle = 'rgba(251,191,36,.85)';
        cx.lineWidth = 2;
        roundRect(-w / 2, -h / 2, w, h, 14);
        cx.stroke();
      }
      cx.restore();
    }

    // Empty-state hint over the whole stage (only when no audio has
    // ever been loaded — fades to 0 the moment audio plays).
    const audible = (a.rms + a.bass + a.treble) > 0.05;
    stageEmpty.style.opacity = audible ? 0 : 1;
  }
  function roundRect(x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y,     x + w, y + h, r);
    cx.arcTo(x + w, y + h, x,     y + h, r);
    cx.arcTo(x,     y + h, x,     y,     r);
    cx.arcTo(x,     y,     x + w, y,     r);
    cx.closePath();
  }

  // ---- Render loop ----
  let rafId = null;
  let lastT = 0;
  function loop(now) {
    const t = (now || 0) / 1000;
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    paint(t);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  window.addEventListener('resize', () => { resizeCanvas(); paint(stageT); });

  // ---- Filter handler: ramps 0.30 → 0.55 → 0.80 → 1.00 → 0 on repeated
  // presses; switching slot resets the ramp. Stays compatible with
  // window.SWR_LOOK_FILTER_CYCLER when present. ----
  function onFilterPress(slotId) {
    if (typeof window.SWR_LOOK_FILTER_CYCLER === 'function') {
      window.SWR_LOOK_FILTER_CYCLER(slotId);
      // Sync our local chip + ramp state from the cycler's status.
      const cur = (window.SWR_LOOK_FILTER_CYCLER.get && window.SWR_LOOK_FILTER_CYCLER.get()) || {};
      activeFilter = cur.slot || slotId;
      rampStep = cur.step || 0;
      updateFilterChipUI();
      return;
    }
    if (slotId === activeFilter) {
      rampStep = (rampStep + 1) % 5; // 0,1,2,3,4
    } else {
      activeFilter = slotId;
      rampStep = 1;
    }
    updateFilterChipUI();
  }

  // ---- Library sheet ----
  function setLibraryOpen(open) {
    library.setAttribute('data-open', open ? 'true' : 'false');
    library.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      scrim.setAttribute('aria-hidden', 'false');
      scrim.tabIndex = 0;
      renderLibraryGrid();
    } else {
      scrim.setAttribute('aria-hidden', 'true');
      scrim.tabIndex = -1;
    }
  }

  function renderLibraryGrid() {
    libGrid.innerHTML = '';
    const Lib = window.Library;
    const items = (Lib && Array.isArray(Lib.items)) ? Lib.items : [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Library is empty. Tap Add clip below to load media from your photo library.';
      libGrid.appendChild(empty);
      return;
    }
    items.forEach((it) => {
      const cell = document.createElement('button');
      cell.className = 'lib-item';
      cell.type = 'button';
      cell.dataset.id = it.id;
      cell.setAttribute('aria-pressed', 'false');
      const type = document.createElement('div');
      type.className = 'type';
      type.textContent = (it.type || 'IMG').toString().toUpperCase().slice(0, 3);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = it.name || 'untitled';
      cell.appendChild(type);
      cell.appendChild(name);
      cell.addEventListener('click', () => onLibraryPick(it));
      libGrid.appendChild(cell);
    });
  }

  function onLibraryPick(item) {
    if (!item) return;
    if (!window.Layers) {
      console.warn('[composer] window.Layers missing');
      return;
    }
    // Pick the asset into the layer stack. If already a layer with this
    // id, select it instead of duplicating.
    let existing = null;
    try { existing = window.Layers.list.find((l) => l.asset && l.asset.id === item.id); }
    catch (_) {}
    if (existing) { existing && window.Layers.select && window.Layers.select(existing); }
    else if (typeof window.Layers.add === 'function') { window.Layers.add(item); }
    setLibraryOpen(false);
  }

  // ---- Wire DOM events ----
  renderFilterChips();
  bindAudio();
  bindAudioEvents();

  songPickBtn.addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await loadAudioFile(f);
    audioInput.value = '';
  });
  playBtn.addEventListener('click', () => {
    if (!audioReady || !window.Audio) return;
    if (audioPlaying) window.Audio.pause && window.Audio.pause();
    else window.Audio.play && window.Audio.play();
  });
  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const fs = e.target.files;
    if (!fs || !fs.length) return;
    // Inject through window.Library so it persists + renders in the sheet.
    if (window.Library && typeof window.Library.add === 'function') {
      for (const f of fs) {
        const ok = await window.Library.add(f);
        if (!ok) console.warn('[composer] library add failed', f.name);
      }
      renderLibraryGrid();
      setLibraryOpen(true);
    }
    fileInput.value = '';
  });
  libToggle.addEventListener('click', () => setLibraryOpen(true));
  libClose.addEventListener('click', () => setLibraryOpen(false));
  grabber.addEventListener('click', () => setLibraryOpen(false));
  scrim.addEventListener('click', () => setLibraryOpen(false));
  // Swipe down on grabber closes the sheet
  let dragStartY = null;
  grabber.addEventListener('pointerdown', (e) => { dragStartY = e.clientY; });
  grabber.addEventListener('pointerup', (e) => {
    if (dragStartY != null && (e.clientY - dragStartY) > 60) setLibraryOpen(false);
    dragStartY = null;
  });
  // Long-press play button is the keyboard helper for "no song"
  recBtn.addEventListener('click', () => {
    // Honesty: this button is wired into Audio + Recorder when those
    // modules exist. For now show a status-only feedback.
    if (window.setStatus) window.setStatus('recorder: tap a clip and song first');
  });

  // ---- Close sheet with Escape ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && library.getAttribute('data-open') === 'true') {
      setLibraryOpen(false);
    }
  });

  // Refuse backdrop-filter + blur in reduced-transparency mode.
  if (reducedTransparency) {
    // CSS @media handler covers the visual; nothing JS-side.
  }

  // ---- Mount ----
  setLibraryOpen(false);
  updatePlay();

  window.SWR_COMPOSER = {
    setLibraryOpen, renderLibraryGrid,
    get audio() { return { ready: audioReady, playing: audioPlaying, features: audioFeatures }; },
  };
})();
