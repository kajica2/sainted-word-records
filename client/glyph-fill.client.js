// glyph-fill.client.js — sequential glyph fill (window.SWR_GLYPH_FILL).
//
// Characters appear one by one, left→right then top→bottom, each one followed
// by a short tone, until the whole frame is filled — then the sheet holds
// before looping. Cells are spaced by a configurable gap so it reads as a
// laid-out sheet rather than a solid block of ink.
//
// The reveal is a sheet of PROCEDURALLY GENERATED ornaments — one distinct
// character per cell — from glyph-forge.client.js (window.SWR_GLYPH_FORGE).
// A catalog of 12 cannot fill an 84-cell sheet without repeating seven times
// over, and "characters appear one by one" only means something if each one
// is new. The forge is deterministic in its seed, so a sheet is reproducible;
// window.SWR_GLYPHS.GLYPHS is kept as a fallback for a page that loads this
// module without the forge.
//
// Determinism, matching the gallery module: given a time t (seconds) and a
// cell index, cellState() returns the exact opacity/scale the cell needs.
// The rAF loop only reads those numbers and writes them to the DOM, and fires
// a tone when the timeline crosses a cell's start. That keeps the logic pure
// and unit-testable without a browser or an AudioContext.
//
// Geometry. The sheet is laid out in a frame 100 units wide and 100/aspect
// tall, so it fills the container at any shape instead of letterboxing a
// square into a wide stage. Spacing is a RATIO of gap to cell (0 = cells
// touch, 0.18 = a light gutter, 1.0 = as much gap as glyph), which is
// scale-free and stays valid for any column count — an absolute gap would
// need clamping and can go negative on a dense grid.
//
// The glyph paths are authored centred on 32,32 in a 64-unit box with ink
// spanning most of it, so translate(cx cy) scale(k) translate(-32 -32) drops
// the ink centre on the cell centre. A few catalog glyphs (crescent, flourish,
// spiral) sit a few units off that centre — that is the ornament's own shape,
// not a layout error, and it reads as character rather than as misalignment.
//
// Audio: one short WebAudio tone per character, pitched up a pentatonic
// scale as the sheet fills so the fill plays as a rising run. Browsers
// block audio until a user gesture, so the controller starts SILENT and the
// caller must invoke ctl.arm() from a click/keydown — which is also what
// starts playback. Nothing here can autoplay with sound.
//
// Honors prefers-reduced-motion: the sheet fills instantly to its final
// state and never plays a tone.
//
// Public surface: window.SWR_GLYPH_FILL = {
//   DEFAULT_CFG,
//   normalizeCfg,   // pure: clamp/sanitize
//   gridLayout,     // pure: (cfg, aspect?) -> cell rects across the frame
//   cellState,      // pure: (t, i, cfg) -> { progress, opacity, scale, arrived }
//   glyphIdFor,     // pure: (i, glyphs) -> glyph id for a cell
//   toneFor,        // pure: (i, cfg) -> { freq, dur, gain, type }
//   resolveGlyphs,  // (count, seed) -> generated glyphs, one per cell
//   mount,          // (containerEl, cfg?) -> controller
// }

(function () {
  'use strict';
  if (window.SWR_GLYPH_FILL) return; // idempotent

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Every glyph in the catalog is authored in a 64x64 box centred on 32,32.
  const BOX = 64;
  // Stroke width in glyph units. The paths carry no width of their own, and
  // at a fitted scale of ~0.06 a default stroke of 1 unit would render under
  // a pixel — the ornament would read as a hairline, not a dingbat.
  const STROKE = 3.5;

  const DEFAULT_CFG = {
    cols: 12,
    rows: 7,
    margin: 4,       // outer margin, % of each frame axis
    spacing: 0.18,   // gap as a ratio of cell size
    rate: 14,        // characters revealed per second
    reveal: 0.16,    // seconds each character takes to arrive
    hold: 1.6,       // seconds the filled sheet holds before looping
    sizeScale: 0.9,  // glyph size within its cell (the rest is margin)
  };

  // ---- pure helpers -------------------------------------------------------

  function clamp(v, lo, hi) {
    if (!Number.isFinite(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeCfg(raw) {
    const c = Object.assign({}, DEFAULT_CFG, raw || {});
    return {
      cols: Math.round(clamp(num(c.cols, DEFAULT_CFG.cols), 1, 40)),
      rows: Math.round(clamp(num(c.rows, DEFAULT_CFG.rows), 1, 40)),
      margin: clamp(num(c.margin, DEFAULT_CFG.margin), 0, 24),
      spacing: clamp(num(c.spacing, DEFAULT_CFG.spacing), 0, 1.5),
      rate: clamp(num(c.rate, DEFAULT_CFG.rate), 0.5, 120),
      reveal: clamp(num(c.reveal, DEFAULT_CFG.reveal), 0.01, 2),
      hold: clamp(num(c.hold, DEFAULT_CFG.hold), 0, 30),
      sizeScale: clamp(num(c.sizeScale, DEFAULT_CFG.sizeScale), 0.05, 1.6),
    };
  }

  const FRAME_W = 100;

  // Pure: cell rects in reading order. Deriving the cell from the ratio
  // (cell + gap*cell*(n-1) = usable) keeps every cell positive for any
  // column count, which an absolute gap cannot promise.
  function gridLayout(cfg, aspect) {
    const c = normalizeCfg(cfg);
    const a = Number(aspect) > 0 ? Number(aspect) : 16 / 9;
    const frameW = FRAME_W;
    const frameH = FRAME_W / a;
    const m = c.margin / 100;
    const usableW = frameW * (1 - m * 2);
    const usableH = frameH * (1 - m * 2);
    const cellW = usableW / (c.cols + c.spacing * (c.cols - 1));
    const cellH = usableH / (c.rows + c.spacing * (c.rows - 1));
    const gapW = cellW * c.spacing;
    const gapH = cellH * c.spacing;
    const cells = [];
    for (let r = 0; r < c.rows; r++) {
      for (let col = 0; col < c.cols; col++) {
        cells.push({
          r, c: col,
          x: frameW * m + col * (cellW + gapW),
          y: frameH * m + r * (cellH + gapH),
          w: cellW,
          h: cellH,
          // Cell centre + the scale that fits the glyph box into the cell.
          cx: frameW * m + col * (cellW + gapW) + cellW / 2,
          cy: frameH * m + r * (cellH + gapH) + cellH / 2,
          k: (Math.min(cellW, cellH) * c.sizeScale) / BOX,
        });
      }
    }
    return {
      cols: c.cols, rows: c.rows, margin: c.margin, spacing: c.spacing,
      cellW, cellH, gapW, gapH, cells, count: cells.length,
      frameW, frameH, aspect: a,
    };
  }

  // The glyph for a cell. With one glyph per cell this is a straight lookup;
  // the modulo only matters for the catalog fallback, where the list is
  // shorter than the sheet and has to cycle.
  function glyphIdFor(i, glyphs) {
    const list = glyphs && glyphs.length ? glyphs : [{ id: 'star' }];
    return list[((i % list.length) + list.length) % list.length].id;
  }

  // The character set for a sheet of `count` cells: one procedurally
  // generated ornament per cell, every one distinct. Falls back to the
  // gallery catalog only if the forge is absent, which cannot satisfy
  // "all different" on a sheet larger than the catalog.
  function resolveGlyphs(count, seed) {
    const forge = window.SWR_GLYPH_FORGE;
    if (forge && typeof forge.forge === 'function') return forge.forge(count, seed);
    const catalog = (window.SWR_GLYPHS && window.SWR_GLYPHS.GLYPHS) || [];
    return catalog;
  }

  // Pure: per-cell state at time t. A cell is invisible until its start, then
  // eases in with a slight overshoot so each character lands with weight.
  function cellState(t, i, cfg) {
    const c = normalizeCfg(cfg);
    const start = i / c.rate;
    let p = (t - start) / c.reveal;
    if (p <= 0) return { progress: 0, opacity: 0, scale: 0.55, arrived: false };
    if (p >= 1) return { progress: 1, opacity: 1, scale: 1, arrived: true };
    const s = 1.70158; // ease-out-back
    const e = 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
    return {
      progress: p,
      opacity: Math.min(1, p * 1.6),
      scale: 0.55 + 0.45 * e,
      arrived: false,
    };
  }

  // Pentatonic minor on A — a run that climbs as the sheet fills instead of
  // drifting, so a long fill stays musical rather than turning into a siren.
  const PENTA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];

  // Pure: the tone for a character. Pitch climbs with the fill then settles;
  // gain falls off so a full sheet doesn't stack into a wall of noise.
  function toneFor(i, cfg) {
    const c = normalizeCfg(cfg);
    const step = PENTA[Math.min(PENTA.length - 1, Math.floor(i / 4))];
    const total = Math.max(1, c.cols * c.rows);
    return {
      freq: step,
      dur: 0.13,
      gain: 0.16 * (1 - (i / total) * 0.55),
      type: 'triangle',
    };
  }

  // ---- dom ----------------------------------------------------------------

  // Glyphs go in <defs> as plain <path>, NOT <symbol>. A <use> pointing at a
  // <symbol> establishes a viewport sized by the use's width/height (100% of
  // ours), and the symbol's own viewBox is then fitted into it — so every
  // glyph gets drawn centred in that viewport, offset by half of it, and the
  // cell transform has to compensate. A plain <path> has no viewport: its
  // authored coordinates ARE the use's user units, so
  // translate(cx cy) scale(k) translate(-32 -32) puts the ink centre
  // (32,32) exactly on the cell centre.
  function buildDefs(glyphs, idPrefix) {
    const defs = document.createElementNS(SVG_NS, 'defs');
    (glyphs || []).forEach((g) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('id', idPrefix + g.id);
      path.setAttribute('d', g.d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      // In glyph units, so it scales with the glyph. NOT non-scaling-stroke:
      // a screen-space stroke would ignore the fit scale.
      path.setAttribute('stroke-width', String(STROKE));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      defs.appendChild(path);
    });
    return defs;
  }

  // ---- audio --------------------------------------------------------------

  // Lazily created on arm() so no AudioContext exists until a gesture, and so
  // pages that never play never allocate one.
  function makeAudio() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    let ctx;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    const master = ctx.createGain();
    master.gain.value = 0.9;
    // A gentle lowpass keeps 14 tones/second from sounding like a buzz.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.Q.value = 0.6;
    master.connect(lp);
    lp.connect(ctx.destination);
    return {
      ctx,
      master,
      blip(freq, dur, gain, type, when) {
        const t0 = when || ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      },
      close() {
        try { ctx.close(); } catch { /* already closed */ }
      },
    };
  }

  // ---- mount --------------------------------------------------------------

  function mount(containerEl, rawCfg, seed) {
    if (!containerEl || !containerEl.appendChild) return null;
    const masterSeed = seed == null ? 1 : seed;
    let cfg = normalizeCfg(rawCfg);
    let layout = gridLayout(cfg, aspectOf(containerEl));
    // One generated ornament per cell, so no cell can repeat another.
    const glyphs = resolveGlyphs(layout.count, masterSeed);
    if (!glyphs.length) return null;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + layout.frameW + ' ' + layout.frameH);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'gff-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      'Generated ornament characters appearing one by one until the frame is filled');
    svg.appendChild(buildDefs(glyphs, 'gff-'));

    const root = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(root);

    // One <use> per cell, created once; only attributes change per frame. The
    // cell transform scales about the cell centre: the glyph box is centred on
    // the transform origin, so the ink centre rides the cell centre.
    const nodes = layout.cells.map((cell, i) => {
      const gEl = document.createElementNS(SVG_NS, 'g');
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', '#gff-' + glyphIdFor(i, glyphs));
      gEl.appendChild(use);
      gEl.setAttribute('opacity', '0');
      root.appendChild(gEl);
      return { g: gEl, use, cell };
    });

    containerEl.appendChild(svg);

    const controller = {
      cfg,
      layout,
      playing: false,
      armed: false,
      _t: 0,
      _rafId: 0,
      _last: 0,
      _fired: -1,      // last cell index that played a tone
      _audio: null,
      _muted: false,
      seed: masterSeed,
      glyphs,
      svg,
      nodes,
    };

    // Fill duration for the current cfg — when the timeline passes this plus
    // the hold, the sheet is complete and the loop restarts.
    function fillDuration() {
      return (layout.count - 1) / cfg.rate + cfg.reveal;
    }

    function paint() {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const st = reduced
          ? { opacity: 1, scale: 1, arrived: true }
          : cellState(controller._t, i, cfg);
        node.g.setAttribute('opacity', st.opacity.toFixed(3));
        node.g.setAttribute('transform',
          'translate(' + node.cell.cx.toFixed(3) + ' ' + node.cell.cy.toFixed(3) +
          ') scale(' + (node.cell.k * st.scale).toFixed(5) + ') translate(-32 -32)');
        node.use.setAttribute('opacity', '1');
      }
    }

    // Fire one tone per character as the timeline crosses its start. Only the
    // newly-crossed indices fire, so pausing/resuming never replays a chord.
    function fireTones() {
      if (reduced || controller._muted || !controller._audio) return;
      const maxFired = Math.min(Math.floor(controller._t * cfg.rate), layout.count - 1);
      if (maxFired <= controller._fired) return;
      for (let i = controller._fired + 1; i <= maxFired; i++) {
        const tone = toneFor(i, cfg);
        controller._audio.blip(tone.freq, tone.dur, tone.gain, tone.type);
      }
      controller._fired = maxFired;
    }

    function frame(now) {
      const dt = controller._last ? (now - controller._last) / 1000 : 0;
      controller._last = now;
      if (dt > 0 && controller.playing) {
        controller._t += dt;
        if (controller._t >= fillDuration() + cfg.hold) {
          controller._t = 0;
          controller._fired = -1;
        }
      }
      paint();
      fireTones();
      controller._rafId = requestAnimationFrame(frame);
    }

    controller._rafId = requestAnimationFrame(frame);

    // Re-lay the sheet in place. Aspect changes never rebuild the DOM: the
    // frame follows the container and the existing nodes are restated.
    function relayout() {
      layout = gridLayout(cfg, aspectOf(containerEl));
      controller.layout = layout;
      svg.setAttribute('viewBox', '0 0 ' + layout.frameW + ' ' + layout.frameH);
      layout.cells.forEach((cell, i) => {
        if (nodes[i]) nodes[i].cell = cell;
      });
      paint();
    }

    controller.relayout = relayout;

    // Watch the container so the sheet keeps filling its stage on resize
    // instead of letterboxing a stale frame.
    if (typeof window.ResizeObserver === 'function') {
      const ro = new window.ResizeObserver(() => relayout());
      ro.observe(containerEl);
      controller._ro = ro;
    } else if (window.addEventListener) {
      window.addEventListener('resize', relayout);
    }

    // Call from a user gesture: creates the AudioContext (browsers block it
    // before one) and resumes it if it starts suspended.
    controller.arm = function () {
      if (controller.armed) return controller;
      controller.armed = true;
      try {
        controller._audio = makeAudio();
        if (controller._audio && controller._audio.ctx.state === 'suspended') {
          controller._audio.ctx.resume();
        }
      } catch {
        controller._audio = null;
      }
      return controller;
    };

    controller.play = function () {
      controller.playing = true;
      controller._last = 0;
      return controller;
    };

    controller.pause = function () {
      controller.playing = false;
      return controller;
    };

    controller.toggle = function () {
      controller.playing = !controller.playing;
      return controller.playing;
    };

    controller.reset = function () {
      controller._t = 0;
      controller._fired = -1;
      paint();
      return controller;
    };

    controller.replay = function () {
      controller.reset();
      controller.play();
      return controller;
    };

    controller.setMuted = function (m) {
      controller._muted = !!m;
      return controller;
    };

    // Re-lay the sheet in place. A cols/rows change alters the cell COUNT, so
    // that case rebuilds the DOM (the caller receives the new controller);
    // spacing/margin/size only restate geometry on the existing nodes.
    // The seed rides along either way, so the ornaments already on screen are
    // stable across a resize — cell N's character never depends on the grid.
    controller.rebuild = function (patch) {
      const next = normalizeCfg(Object.assign({}, cfg, patch || {}));
      if (next.cols * next.rows !== layout.count) {
        cancelAnimationFrame(controller._rafId);
        if (controller._audio) controller._audio.close();
        if (controller._ro) controller._ro.disconnect();
        // Remove only our own svg. Clearing the container would take any
        // overlay the caller layered into the stage with it.
        if (svg.parentNode) svg.parentNode.removeChild(svg);
        const remounted = mount(containerEl, next, masterSeed);
        if (remounted) {
          if (controller.armed) remounted.arm();
          if (controller._muted) remounted.setMuted(true);
          if (controller.playing) remounted.play();
        }
        return remounted;
      }
      cfg = next;
      controller.cfg = cfg;
      relayout();
      return controller;
    };

    // Mint a completely different sheet: a new master seed re-rolls every
    // ornament, still one distinct character per cell. Returns a fresh
    // controller, so the caller must re-read its reference.
    controller.regenerate = function (newSeed) {
      cancelAnimationFrame(controller._rafId);
      if (controller._audio) controller._audio.close();
      if (controller._ro) controller._ro.disconnect();
      if (svg.parentNode) svg.parentNode.removeChild(svg);
      const remounted = mount(containerEl, cfg, newSeed);
      if (remounted) {
        if (controller.armed) remounted.arm();
        if (controller._muted) remounted.setMuted(true);
        if (controller.playing) remounted.play();
      }
      return remounted;
    };

    // Progress of the fill, 0..1 — drives the readout.
    controller.progress = function () {
      return reduced ? 1 : clamp(controller._t / fillDuration(), 0, 1);
    };

    controller.filledCount = function () {
      if (reduced) return layout.count;
      let n = 0;
      for (let i = 0; i < layout.count; i++) {
        if (cellState(controller._t, i, cfg).arrived) n++;
      }
      return n;
    };

    controller.stop = function () {
      cancelAnimationFrame(controller._rafId);
      if (controller._ro) controller._ro.disconnect();
      if (controller._audio) controller._audio.close();
      return controller;
    };

    paint();
    return controller;
  }

  // Container shape drives the frame, so the sheet fills a wide stage instead
  // of letterboxing a square into it. Falls back to 16:9 before layout.
  function aspectOf(el) {
    const w = el && el.clientWidth;
    const h = el && el.clientHeight;
    if (w > 0 && h > 0) return w / h;
    return 16 / 9;
  }

  window.SWR_GLYPH_FILL = {
    DEFAULT_CFG,
    normalizeCfg,
    gridLayout,
    cellState,
    glyphIdFor,
    toneFor,
    resolveGlyphs,
    mount,
  };
})();