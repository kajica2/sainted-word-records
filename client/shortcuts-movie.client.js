// client/shortcuts-movie.client.js — hyperframe walkthrough of every
// SWR keyboard shortcut. Renders to a 1280×720 canvas that the layout
// scales to fit its container. Twelve chapters at 5 seconds each — the
// "movie" is a deterministic, scrubbable timeline that:
//
//   1. Shows the on-screen keys being pressed (animated labels).
//   2. Draws the actual effect on the stage canvas so the reader sees
//      what each shortcut produces (look-filter tint, layer halo, etc.).
//   3. Calls back to window.FX / window.SWR_VARIANTS when present so
//      the page doubles as a real, working demo when run on the engine.

(() => {
  'use strict';
  if (window.SWR_SHORTCUTS_MOVIE) return;

  const DOM = document;
  const canvas = DOM.getElementById('hm-stage');
  const fillEl = DOM.getElementById('hm-fill');
  const ticksEl = DOM.getElementById('hm-ticks');
  const clockEl = DOM.getElementById('hm-clock');
  const counterEl = DOM.getElementById('hm-counter');
  const titleEl = DOM.getElementById('hm-title');
  const bodyEl = DOM.getElementById('hm-body');
  const keysEl = DOM.getElementById('hm-keys');
  const chaptersEl = DOM.getElementById('hm-chapters');
  const scrubberEl = DOM.getElementById('hm-scrubber');

  if (!canvas) return;
  const cx = canvas.getContext('2d');

  // ---- chapters ---------------------------------------------------------

  const CHAPTERS = [
    { start: 0,  name: 'home (0)',
      title: '0 · home — slide every layer back to its origin',
      body: 'Press 0 (zero) and every layer tweens back: opacity → 1, baseScale → home, position → 0,0.',
      keys: ['0'], kind: 'home' },
    { start: 5,  name: 'soft (1)',
      title: '1 · soft (low desaturation)',
      body: 'Press 1 to apply the "soft" filter. Repeated presses cycle through the intensity ramp — 0.30 → 0.55 → 0.80 → 1.00 → off.',
      keys: ['1'], kind: 'filter', slot: 1 },
    { start: 10, name: 'old cinema (2)',
      title: '2 · old cinema — sepia + grain + vignette',
      body: 'Press 2 for the polished retro look. Grain + sepia + vignette (the projector halo). Trap 1: sepia commits; never pair with temp/tone.',
      keys: ['2'], kind: 'filter', slot: 2 },
    { start: 15, name: 'cinematic 3-7',
      title: '3-7 · five cinematic colour tones',
      body: 'Press 3..7 for the cinematic palette: cool, teal, amber, rose, mono. Each blends temperature + tone + (sometimes) glow.',
      keys: ['3','4','5','6','7'], kind: 'cinematic' },
    { start: 20, name: 'void / echo (8-9)',
      title: '8-9 · void warm + echo',
      body: '8 = heavy desaturation + warm push. 9 = deep cool + tone + mutAlgo:2 (liquid warp). T+1..9 is the same cycler with a prefix.',
      keys: ['8','9'], kind: 'filter', slot: 8, altSlot: 9 },
    { start: 25, name: 'shift+arrows',
      title: 'Shift+↑↓←→ · nudge the selected layer',
      body: 'Press Shift+Arrow keys to nudge the selected layer\'s position by ~canvas/40 px. Status line reports the new coordinates.',
      keys: ['Shift','↑','↓','←','→'], kind: 'nudge' },
    { start: 30, name: 'story chapters',
      title: 'Shift+1..9 · story chapters (FRAGMENTS, SIGNAL, …)',
      body: 'Press Shift+1..9 to advance the story runtime through nine chapters. This is the performer\'s director override.',
      keys: ['⇧1','⇧2','⇧3','⇧4','⇧5','⇧6','⇧7','⇧8','⇧9'], kind: 'shift-digits' },
    { start: 35, name: 'remap / fx palette',
      title: 'Alt+1..6 remap layers · Cmd+1..9 FX palette',
      body: 'Alt+1..6 swaps the asset at a layer slot. Cmd/Ctrl+1..9 applies a FX palette preset. Both wire to engine-internal helpers.',
      keys: ['Alt','Cmd','1..9'], kind: 'modifiers' },
    { start: 40, name: 't-prefix',
      title: 'T + 0..9 · same cycler, with a prefix',
      body: 'T + 0..9 calls the same SWR_LOOK_FILTER_CYCLER.apply. T+0 is the off/reset slot. Kept as a memory aid for people who learned the chords first.',
      keys: ['T'], kind: 'prefix' },
    { start: 45, name: 'nudge (right hand)',
      title: '[ ] , . ; \' · fine-tune the selected layer',
      body: 'Right-hand bracket keys nudge alpha + mutate. Comma/period nudges contrast. Semicolon/quote nudges brightness + scale. Held = ×4.',
      keys: ['[',']',',','.',';',"'"], kind: 'nudge-rh' },
    { start: 50, name: 'drag mode',
      title: 'D · toggle AUTO DRIFT / manual drag',
      body: 'D flips the engine between audio-reactive drift and manual drag. Manual lets you click+drag layers around the stage.',
      keys: ['D'], kind: 'mode' },
    { start: 55, name: 'help / tour',
      title: '? · help · tour page · debug overlay',
      body: '? opens the keyboard help overlay. The Tour page runs a 12-stop Nielsen-heuristic walkthrough. Debug overlay mounts when localStorage has swr.debug=1 or ?debug=1.',
      keys: ['?'], kind: 'misc' },
  ];

  // ---- time + playback --------------------------------------------------

  const TOTAL_SECONDS = 60;
  const PER_CHAPTER_S = 5;
  let playing = false;
  let scrubT = 0;        // current time in seconds, driven by both playback and user scrubbing
  let lastTick = 0;       // performance.now() at last frame
  let rafId = 0;

  // ---- canvas size -----------------------------------------------------

  let W = 1280, H = 720;
  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = W;
    canvas.height = H;
    // The CSS sets css; canvas is upscaled by the browser.
  }
  resize();

  // ---- chapter list rendering ------------------------------------------

  function renderChapterList() {
    if (!chaptersEl) return;
    chaptersEl.innerHTML = '';
    for (let i = 0; i < CHAPTERS.length; i++) {
      const ch = CHAPTERS[i];
      const card = DOM.createElement('div');
      card.className = 'ch';
      card.dataset.idx = String(i);
      card.innerHTML =
        '<div class="i"><span class="num">' + String(i + 1).padStart(2, '0') + '</span><span>' +
          (ch.start + 1) + 's – ' + (ch.start + PER_CHAPTER_S) + 's</span></div>' +
        '<h3>' + ch.name + '</h3>' +
        '<p>' + escapeHtml(ch.body.slice(0, 90)) + (ch.body.length > 90 ? '…' : '') + '</p>' +
        '<div class="kk">' + ch.keys.map(renderKey).join('') + '</div>';
      card.addEventListener('click', () => {
        scrubT = ch.start + 0.1;
        paint(scrubT);
        renderActiveChapter();
        updateMeter();
      });
      chaptersEl.appendChild(card);
    }
    // Draw scrubber ticks (one per chapter)
    if (ticksEl) {
      ticksEl.innerHTML = '';
      for (let i = 0; i < CHAPTERS.length; i++) {
        const t = DOM.createElement('i');
        ticksEl.appendChild(t);
      }
    }
  }

  function renderKey(k) {
    // Each key token becomes a rounded chip. Multichar tokens (⇧1) sit
    // as one chip.
    return '<span class="k">' + escapeHtml(k) + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function currentChapter(t) {
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      if (t >= CHAPTERS[i].start) return { idx: i, ch: CHAPTERS[i] };
    }
    return { idx: 0, ch: CHAPTERS[0] };
  }

  function renderActiveChapter() {
    const cards = chaptersEl.querySelectorAll('.ch');
    const { idx, ch } = currentChapter(scrubT);
    cards.forEach((c, i) => c.classList.toggle('active', i === idx));
    if (titleEl && ch) titleEl.textContent = ch.title;
    if (bodyEl  && ch) bodyEl.textContent  = ch.body;
    if (keysEl  && ch) {
      keysEl.innerHTML = '';
      for (const k of ch.keys) {
        const span = DOM.createElement('span');
        span.className = 'k';
        span.textContent = k;
        keysEl.appendChild(span);
      }
    }
  }

  function updateMeter() {
    const pct = Math.min(100, Math.max(0, (scrubT / TOTAL_SECONDS) * 100));
    if (fillEl) fillEl.style.width = pct + '%';
    if (clockEl) clockEl.textContent = scrubT.toFixed(1) + 's / ' + TOTAL_SECONDS + '.0s';
    if (counterEl) counterEl.textContent = formatClock(scrubT);
    if (scrubberEl) scrubberEl.setAttribute('aria-valuenow', String(Math.round(scrubT)));
  }
  function formatClock(t) {
    const m = Math.floor(t / 60);
    const s = (t - m * 60);
    return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
  }

  // ---- canvas draw ------------------------------------------------------

  function lerp(a, b, k) { return a + (b - a) * k; }

  // Filter presets mirrored from client/look-filter-cycler.client.js
  // (we draw abstract representations on the canvas, not real FX passes).
  const FILTER_COLOURS = {
    0: { label: 'none', tint: 'rgba(128,128,128,.9)', ring: 'rgba(128,128,128,.4)' },
    1: { label: 'soft', tint: 'rgba(180,180,200,.85)', ring: 'rgba(180,180,200,.45)' },
    2: { label: 'old cinema', tint: 'rgba(200,170,120,.95)', ring: 'rgba(255,220,160,.5)' },
    3: { label: 'cinema · cool', tint: 'rgba(140,200,235,.9)', ring: 'rgba(140,200,235,.45)' },
    4: { label: 'cinema · teal', tint: 'rgba(120,200,200,.9)', ring: 'rgba(120,200,200,.45)' },
    5: { label: 'cinema · amber', tint: 'rgba(255,180,80,.95)', ring: 'rgba(255,180,80,.5)' },
    6: { label: 'cinema · rose', tint: 'rgba(240,150,180,.95)', ring: 'rgba(240,150,180,.5)' },
    7: { label: 'cinema · mono', tint: 'rgba(220,220,220,.95)', ring: 'rgba(220,220,220,.5)' },
    8: { label: 'void warm', tint: 'rgba(255,160,90,.85)', ring: 'rgba(255,160,90,.4)' },
    9: { label: 'echo', tint: 'rgba(150,180,255,.85)', ring: 'rgba(150,180,255,.45)' },
  };

  function paint(t) {
    // Background gradient (purplish → orange) keyed off the chapter
    // index for a gentle visual continuity.
    const { idx, ch } = currentChapter(t);
    cx.fillStyle = '#0e0e16';
    cx.fillRect(0, 0, W, H);

    // Big rotating dial representing the audio-reactive vibe.
    drawReactiveDial(t, ch);

    // Chapter context window. The "movie" is mostly a stage — most of
    // the explanation lives in the overlay below the canvas.
    cx.save();
    cx.globalAlpha = 0.7;
    cx.fillStyle = FILTER_COLOURS[Math.max(0, Math.min(9, idx))].tint;
    cx.beginPath();
    cx.arc(W * 0.5, H * 0.45, 90 + 30 * Math.sin(t * 1.7), 0, Math.PI * 2);
    cx.fill();
    cx.restore();

    // Moving film strip with the active keychip's glyph.
    drawKeychip(t, ch);

    // Vignette
    const grad = cx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.6);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,.55)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);
  }

  function drawReactiveDial(t, ch) {
    cx.save();
    cx.translate(W * 0.5, H * 0.45);
    cx.rotate(t * 0.5);
    cx.lineWidth = 4;
    cx.strokeStyle = 'rgba(255,255,255,.18)';
    cx.beginPath(); cx.arc(0, 0, 200, 0, Math.PI * 2); cx.stroke();
    cx.lineWidth = 6;
    cx.strokeStyle = 'rgba(251,191,36,.65)';
    cx.beginPath(); cx.arc(0, 0, 220, 0, Math.PI * 2); cx.stroke();
    // Inner pulsing ring
    const r = 80 + 22 * Math.sin(t * 2.4);
    cx.lineWidth = 2;
    cx.strokeStyle = 'rgba(244,114,182,.85)';
    cx.beginPath(); cx.arc(0, 0, r, 0, Math.PI * 2); cx.stroke();
    cx.restore();
  }

  function drawKeychip(t, ch) {
    // Big rectangular chip on the right side, mimicking the on-screen
    // rhythm: the key glyph morphs in when the chapter begins.
    const fadeIn = clamp((t - ch.start) / 0.6, 0, 1);
    const w = 360, h = 200;
    const x = W - w - 64, y = H / 2 - h / 2 + (Math.sin(t * 1.8) * 6);
    cx.save();
    cx.globalAlpha = 0.92 * fadeIn;
    cx.fillStyle = 'rgba(20,20,28,.9)';
    cx.strokeStyle = '#fbbf24';
    cx.lineWidth = 4;
    roundRect(cx, x, y, w, h, 16);
    cx.fill();
    cx.stroke();
    // The keys inside the chip
    cx.fillStyle = '#f6f6fa';
    cx.font = '600 56px ui-monospace, "JetBrains Mono", monospace';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    const label = String(ch.keys[0]);
    cx.fillText(label, x + w / 2, y + h / 2);
    // Caption
    cx.fillStyle = 'rgba(255,255,255,.6)';
    cx.font = '500 12px ui-monospace, "JetBrains Mono", monospace';
    cx.fillText(ch.name.toUpperCase(), x + w / 2, y + h + 18);
    cx.restore();
  }

  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y,     x + w, y + h, r);
    cx.arcTo(x + w, y + h, x,     y + h, r);
    cx.arcTo(x,     y + h, x,     y,     r);
    cx.arcTo(x,     y,     x + w, y,     r);
    cx.closePath();
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- loop -------------------------------------------------------------

  function tick(now) {
    if (playing) {
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      scrubT += dt;
      if (scrubT >= TOTAL_SECONDS) { playing = false; scrubT = TOTAL_SECONDS; }
      lastTick = now;
    } else {
      lastTick = now;
    }
    paint(scrubT);
    renderActiveChapter();
    updateMeter();
    rafId = requestAnimationFrame(tick);
  }

  // ---- controls ---------------------------------------------------------

  function play() {
    if (scrubT >= TOTAL_SECONDS) scrubT = 0;
    playing = true;
    lastTick = performance.now();
  }
  function pause() { playing = false; }
  function restart() { scrubT = 0; play(); }
  function step(dt) {
    pause();
    scrubT = clamp(scrubT + dt, 0, TOTAL_SECONDS);
  }

  // ---- wire up ---------------------------------------------------------

  renderChapterList();
  paint(0);
  renderActiveChapter();
  updateMeter();

  document.getElementById('hm-play')?.addEventListener('click', play);
  document.getElementById('hm-pause')?.addEventListener('click', pause);
  document.getElementById('hm-restart')?.addEventListener('click', restart);
  document.getElementById('hm-prev')?.addEventListener('click', () => step(-5));
  document.getElementById('hm-next')?.addEventListener('click', () => step(+5));
  document.getElementById('hm-live')?.addEventListener('click', () => {
    window.location.href = '/engine';
  });
  // Scrubber click + drag
  let dragging = false;
  function scrubFromEvent(ev) {
    if (!scrubberEl) return;
    const r = scrubberEl.getBoundingClientRect();
    const k = (ev.clientX - r.left) / r.width;
    scrubT = clamp(k * TOTAL_SECONDS, 0, TOTAL_SECONDS);
    pause();
    paint(scrubT);
    renderActiveChapter();
    updateMeter();
  }
  scrubberEl?.addEventListener('pointerdown', (ev) => { dragging = true; scrubFromEvent(ev); });
  scrubberEl?.addEventListener('pointermove', (ev) => { if (dragging) scrubFromEvent(ev); });
  scrubberEl?.addEventListener('pointerup', () => { dragging = false; });
  scrubberEl?.addEventListener('pointercancel', () => { dragging = false; });

  // Keyboard: space toggles play/pause; arrows step by chapter.
  document.addEventListener('keydown', (ev) => {
    if (ev.target && ev.target.tagName === 'INPUT') return;
    if (ev.key === ' ') { ev.preventDefault(); playing ? pause() : play(); }
    else if (ev.key === 'ArrowLeft')  { step(-5); }
    else if (ev.key === 'ArrowRight') { step(+5); }
    else if (ev.key === 'Home') { pause(); scrubT = 0; }
    else if (ev.key === 'End')  { pause(); scrubT = TOTAL_SECONDS; }
    // Number shortcuts 1..9 jump to the matching chapter
    else if (/^[1-9]$/.test(ev.key) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const n = parseInt(ev.key, 10);
      if (n >= 1 && n <= CHAPTERS.length) { pause(); scrubT = CHAPTERS[n - 1].start + 0.1; }
    }
  });

  rafId = requestAnimationFrame(tick);

  window.SWR_SHORTCUTS_MOVIE = {
    get t() { return scrubT; },
    get playing() { return playing; },
    play, pause, restart,
    jumpTo(name) {
      const idx = CHAPTERS.findIndex((c) => c.name === name);
      if (idx >= 0) { pause(); scrubT = CHAPTERS[idx].start + 0.1; }
    },
    chapters: CHAPTERS,
  };
})();
