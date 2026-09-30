// client/gallery-glyphs.client.js
//
// Animated dingbat / ornament glyph stacks for the Glyphs gallery page.
//
// SWR_GLYPHS renders either:
//
//   MODE 'stack' — a stack of SVG pattern layers, each one tiled with a
//   stroke-based dingbat glyph, evolved every frame:
//     - drift       pattern tile offset walks in a per-layer direction
//     - rotation    pattern content turns slowly (per-layer speed + phase)
//     - scale       gentle breathing via sine around the base tile scale
//     - seed        feTurbulence seed advances -> noise field reshuffles
//     - frequency   feTurbulence baseFrequency oscillates -> grain morphs
//     - opacity     layers fade in/out on slow sines so the stack breathes
//
//   MODE 'sheet' — a contact-sheet grid across the full video frame
//   (default). NxM glyph cells (default 9 cols x 3 rows) distributed with
//   an outer margin and inter-cell spacing; the whole sheet rolls through
//   the glyph series one step at a time (the "x+1" animation), each cell
//   showing a different point in the series. A single shared noise
//   feTurbulence -> feDisplacementMap filter displaces the entire sheet.
//
// The displacement pipeline is pure SVG filters:
//   feTurbulence (fractalNoise) -> feDisplacementMap in2="noise"
// applied to the layer/sheet's rect (or group). No canvases, no WebGL, no
// external assets — the whole demo is one <svg> element per layer.
//
// All math is deterministic: given a time t (seconds), layerState() and
// sheetCellState() return the exact values the renderer needs. The rAF
// loop only calls them and writes the returned numbers onto the DOM. This
// keeps the logic pure and unit-testable
// (scripts/check-glyphs-layers-unit.mjs) without a browser.
//
// Honors prefers-reduced-motion: the stage auto-pauses and falls back to a
// static first-frame composition when the user has reduced motion on.
//
// Public surface: window.SWR_GLYPHS = {
//   GLYPHS,                   // glyph catalog (id, name, d, viewBox)
//   DEFAULT_CFG,              // default renderer config
//   FRAME_W, FRAME_H,         // full video frame dimensions (sheet mode)
//   normalizeCfg,             // clamp/sanitize a cfg object
//   layerState,               // pure: (t, index, cfg) -> stack layer state
//   sheetLayout,              // pure: (cfg) -> cell geometry across frame
//   sheetCellState,           // pure: (t, cellIndex, cfg) -> cell state
//   buildLayerConfig,         // pure: (index, cfg) -> svg ids + labels
//   buildSheetLayerConfig,    // pure: (cfg) -> sheet svg id set
//   buildLayer,               // dom: one pattern-layer svg
//   buildSheetLayer,          // dom: one contact-sheet svg
//   glyphForIndex,            // pure: (i, cfg) -> glyph for stack layer
//   mount,                    // (containerEl, cfg?) -> controller
// }

(function () {
  'use strict';
  if (window.SWR_GLYPHS) return; // idempotent

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ======================================================================
  // GLYPH CATALOG — original geometric ornaments, authored from scratch.
  // Every glyph is stroke-based (fill none) so it reads as a single ink
  // line at any scale, matching the gallery's "one ink-line" language.
  // All paths live in a 64x64 viewBox with the origin at the centre.
  // ======================================================================
  const GLYPHS = [
    {
      id: 'star',
      name: 'Star',
      viewBox: '0 0 64 64',
      d: 'M32 6 L38.96 24.06 L58 24.06 L42.62 35.31 L49.53 53.06 L32 42.25 L14.47 53.06 L21.38 35.31 L6 24.06 L25.04 24.06 Z',
    },
    {
      id: 'cross',
      name: 'Greek Cross',
      viewBox: '0 0 64 64',
      d: 'M24 8 H40 V24 H56 V40 H40 V56 H24 V40 H8 V24 H24 Z',
    },
    {
      id: 'fleuron',
      name: 'Fleuron',
      viewBox: '0 0 64 64',
      d: 'M32 8 C40 4 44 8 42 14 C40 20 36 22 32 22 C28 22 24 20 22 14 C20 8 24 4 32 8 Z M32 56 C24 60 20 56 22 50 C24 44 28 42 32 42 C36 42 40 44 42 50 C44 56 40 60 32 56 Z M8 32 C4 24 8 20 14 22 C20 24 22 28 22 32 C22 36 20 40 14 42 C8 44 4 40 8 32 Z M56 32 C60 24 56 20 50 22 C44 24 42 28 42 32 C42 36 44 40 50 42 C56 44 60 40 56 32 Z M32 26 C35 33 31 33 32 40 C33 33 29 33 32 26 Z',
    },
    {
      id: 'spiral',
      name: 'Spiral',
      viewBox: '0 0 64 64',
      d: 'M32 32 C32 26 37 22 42 24 C46 26 47 31 44 34 C40 38 33 38 30 33 C27 27 30 20 37 19 C45 18 52 24 51 32 C50 41 42 47 33 45 C23 43 16 34 18 24 C20 13 31 6 42 9',
    },
    {
      id: 'knot',
      name: 'Square Knot',
      viewBox: '0 0 64 64',
      d: 'M32 14 L50 32 L32 50 L14 32 Z M23 14 L41 32 L23 50 L5 32 Z M41 14 L59 32 L41 50 L23 32 Z',
    },
    {
      id: 'crescent',
      name: 'Crescent',
      viewBox: '0 0 64 64',
      d: 'M42 8 A26 26 0 1 0 42 56 A20 20 0 1 1 42 8 Z',
    },
    {
      id: 'lozenge',
      name: 'Lozenge',
      viewBox: '0 0 64 64',
      d: 'M32 6 L56 32 L32 58 L8 32 Z M32 16 L46 32 L32 48 L18 32 Z',
    },
    {
      id: 'flourish',
      name: 'Flourish',
      viewBox: '0 0 64 64',
      d: 'M10 44 C10 24 26 12 44 10 C50 9 54 12 52 16 C50 20 45 21 42 19 C38 16 37 11 40 8 C44 4 52 5 56 9 C60 13 61 21 57 26 C52 33 43 37 33 36 C23 35 15 29 13 22',
    },
    {
      id: 'sunburst',
      name: 'Sunburst',
      viewBox: '0 0 64 64',
      d: 'M32 14 L34 20 L38 17 L37 24 L44 22 L40 28 L47 29 L41 33 L46 37 L38 36 L40 43 L33 39 L32 46 L31 39 L24 43 L26 36 L18 37 L23 33 L17 29 L24 28 L20 22 L27 24 L26 17 L30 20 Z M32 24 A8 8 0 1 0 32 40 A8 8 0 1 0 32 24 Z',
    },
    {
      id: 'chevrons',
      name: 'Chevron Stack',
      viewBox: '0 0 64 64',
      d: 'M8 20 L32 8 L56 20 L56 26 L32 14 L8 26 Z M8 32 L32 20 L56 32 L56 38 L32 26 L8 38 Z M8 44 L32 32 L56 44 L56 50 L32 38 L8 50 Z',
    },
    {
      id: 'triquetra',
      name: 'Triquetra',
      viewBox: '0 0 64 64',
      d: 'M32 50 A18 18 0 1 0 32 14 M32 50 A18 18 0 1 1 32 14 M32 50 C32 50 41 46 45 37 M32 50 C32 50 23 46 19 37 M32 14 C32 14 23 18 19 27 M32 14 C32 14 41 18 45 27',
    },
    {
      id: 'ring',
      name: 'Ring + Spokes',
      viewBox: '0 0 64 64',
      d: 'M32 10 A22 22 0 1 0 32 54 A22 22 0 1 0 32 10 Z M32 6 L32 12 M32 52 L32 58 M6 32 L12 32 M52 32 L58 32 M14.2 14.2 L18.5 18.5 M45.5 45.5 L49.8 49.8 M49.8 14.2 L45.5 18.5 M18.5 45.5 L14.2 49.8 M32 26 L38 32 L32 38 L26 32 Z',
    },
  ];

  // ======================================================================
  // CONFIG
  // ======================================================================
  const DEFAULT_CFG = {
    mode: 'sheet',      // 'stack' (pattern layers) | 'sheet' (contact sheet)
    layers: 4,          // how many stacked pattern layers (1..6) — stack mode
    tile: 220,          // pattern tile size in user units — stack mode
    displacement: 26,   // feDisplacementMap scale (0..80)
    speed: 1,           // global time multiplier (0.25..2)
    opacity: 0.9,       // base layer opacity on top of per-layer sines
    seedRate: 0.7,      // noise seed advances per second (boiling speed)
    offset: 0,          // glyph assignment offset (rotates the stack/sheet)
    // Contact-sheet mode: a full-frame grid of glyphs that rolls through
    // the series (x+1 per roll step) with margins + spacing between cells.
    cols: 9,            // sheet columns (1..12); flip rows/cols for portrait
    rows: 3,            // sheet rows (1..12)
    margin: 40,         // outer frame margin (0..120)
    spacing: 22,        // gap between cells (0..80)
    rollRate: 0.5,      // series steps per second — the x+1 animation cadence
  };

  const FRAME_W = 1600;
  const FRAME_H = 900;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Number-cast that preserves 0 (Number(v) || fallback swallows 0, which
  // is a valid value for displacement/margin/spacing and the clamp target
  // for cols/rows). Falls back only on undefined/null/''/NaN.
  function num(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // Sanitize a caller-supplied config. Every field is clamped to a
  // plausible range so a bad config can never produce NaN or a huge
  // layer count. Pure — no DOM.
  function normalizeCfg(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const mode = c.mode === 'stack' ? 'stack' : 'sheet';
    return {
      mode,
      layers: clamp(Math.round(num(c.layers, DEFAULT_CFG.layers)), 1, 6),
      tile: clamp(num(c.tile, DEFAULT_CFG.tile), 64, 640),
      displacement: clamp(num(c.displacement, DEFAULT_CFG.displacement), 0, 80),
      speed: clamp(num(c.speed, DEFAULT_CFG.speed), 0.25, 2),
      opacity: clamp(num(c.opacity, DEFAULT_CFG.opacity), 0.3, 1),
      seedRate: clamp(num(c.seedRate, DEFAULT_CFG.seedRate), 0.05, 5),
      offset: Math.max(0, Math.floor(num(c.offset, 0))),
      cols: clamp(Math.round(num(c.cols, DEFAULT_CFG.cols)), 1, 12),
      rows: clamp(Math.round(num(c.rows, DEFAULT_CFG.rows)), 1, 12),
      margin: clamp(num(c.margin, DEFAULT_CFG.margin), 0, 120),
      spacing: clamp(num(c.spacing, DEFAULT_CFG.spacing), 0, 80),
      rollRate: clamp(num(c.rollRate, DEFAULT_CFG.rollRate), 0.05, 4),
    };
  }

  // ======================================================================
  // PURE LAYER STATE
  // ======================================================================
  // Golden-angle phase separation keeps layers visually uncorrelated even
  // when their speeds are similar.
  const PHASE = 2.399963229728653; // golden angle (radians)

  // Layer i of N. t is time in seconds. Returns a plain object with every
  // value the renderer needs. Deterministic: same (t, i, cfg) -> same output.
  function layerState(t, i, cfg) {
    const n = cfg.layers;
    const phase = i * PHASE;
    const speed = cfg.speed;

    // Per-layer personality: back layers are big, slow, faint and heavily
    // displaced; front layers are smaller, faster, crisper.
    const depth = i / Math.max(1, n - 1); // 0 = back, 1 = front
    const baseDrift = 8 + depth * 26;      // px/s along each axis
    const baseRot = 2 + (1 - depth) * 4;   // deg/s
    const basePulse = 0.5 + depth * 0.5;   // scale breathing rate

    const tt = t * speed;
    const tx = ((tt * baseDrift * Math.cos(phase) + i * 37) % cfg.tile + cfg.tile) % cfg.tile;
    const ty = ((tt * baseDrift * Math.sin(phase) + i * 73) % cfg.tile + cfg.tile) % cfg.tile;
    const rot = (tt * baseRot * 14 + i * 90) % 360;
    const scale = 0.8 + 0.35 * (0.5 + 0.5 * Math.sin(tt * basePulse * 0.8 + phase));

    // Noise: seed advances in discrete steps so the field reshuffles
    // ("boils") instead of sliding; baseFrequency oscillates so the grain
    // morphs between coarse and fine.
    const seed = Math.floor(tt * cfg.seedRate) + i * 137;
    const freq = 0.008 + 0.006 * (0.5 + 0.5 * Math.sin(tt * 0.23 + phase * 2));

    // Opacity: slow layered sines, front layers more present.
    const opacity = cfg.opacity * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tt * 0.11 + phase)));

    return {
      tx, ty, rot, scale, seed, freq,
      displacement: cfg.displacement * (0.55 + depth * 0.45),
      opacity: clamp(opacity, 0.05, 1),
    };
  }

  // Per-layer identity (svg ids) — pure, so tests can assert the wiring
  // without a DOM.
  function buildLayerConfig(i, cfg) {
    const layerId = 'swr-glyph-layer-' + i;
    const glyph = GLYPHS[i % GLYPHS.length];
    return {
      index: i,
      glyph: glyph.id,
      glyphName: glyph.name,
      tile: cfg.tile,
      layerId,
      filterId: layerId + '-noise',
      turbulenceId: layerId + '-turb',
      patternId: layerId + '-pat',
      rectId: layerId + '-rect',
      groupId: layerId + '-group',
    };
  }

  // ======================================================================
  // CONTACT-SHEET MODE
  // ======================================================================
  // A full-frame grid of glyph cells. Every cell shows one glyph from the
  // series; the whole sheet rolls through the series one step at a time
  // (the "x+1" animation), so after GLYPHS.length steps every cell has
  // cycled back. Cells are spaced with outer margin + inter-cell spacing.

  // Pure: layout of the sheet across the full video frame. Returns cell
  // geometry (x, y, w, h) plus the frame, so tests can assert margins and
  // count without a DOM.
  function sheetLayout(cfg) {
    const cols = cfg.cols;
    const rows = cfg.rows;
    const margin = cfg.margin;
    const spacing = cfg.spacing;
    const usableW = FRAME_W - margin * 2;
    const usableH = FRAME_H - margin * 2;
    const gapW = (cols - 1) * spacing;
    const gapH = (rows - 1) * spacing;
    const cellW = (usableW - gapW) / cols;
    const cellH = (usableH - gapH) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          r, c,
          x: margin + c * (cellW + spacing),
          y: margin + r * (cellH + spacing),
          w: cellW,
          h: cellH,
        });
      }
    }
    return { cols, rows, margin, spacing, cellW, cellH, cells, frameW: FRAME_W, frameH: FRAME_H };
  }

  // Pure: per-cell animation state at time t. cellIndex counts left→right,
  // top→bottom (0..cols*rows-1). Returns the glyph id that cell shows,
  // its transform, and a per-cell phase used for breathing.
  function sheetCellState(t, cellIndex, cfg) {
    const cell = sheetLayout(cfg).cells[cellIndex] || { x: 0, y: 0, w: 64, h: 64 };
    const tt = t * cfg.speed;
    // The roll: series position advances one glyph per rollRate-second
    // step. base positions each cell at a different point in the series
    // (left→right then top→bottom), offset rotates the whole sheet.
    const seriesLen = GLYPHS.length;
    const roll = Math.floor(tt * cfg.rollRate) % seriesLen;
    const base = (cellIndex % seriesLen + (cfg.offset % seriesLen)) % seriesLen;
    const seriesPos = (base + roll) % seriesLen;
    const glyph = GLYPHS[seriesPos];
    // Fit the 64x64 glyph into the cell with padding, centered.
    const pad = 0.72;
    const scale = Math.min((cell.w * pad) / 64, (cell.h * pad) / 64);
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    // Per-cell breathing: subtle scale + rotation wobble off a shared slow
    // clock so neighbouring cells do not move in lockstep.
    const phase = (cellIndex % 5) * 1.2566370614359172; // ~2π/5
    const breathe = 1 + 0.05 * Math.sin(tt * 0.6 + phase);
    const rot = 6 * Math.sin(tt * 0.35 + phase);
    // Opacity drifts gently per cell; the front line of cells stays crisp.
    const opacity = clamp(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tt * 0.2 + phase)), 0.2, 1);
    // Noise values live on the sheet filter (shared), but each cell reports
    // them so a single paint loop can drive both modes uniformly.
    const seed = Math.floor(tt * cfg.seedRate) + cfg.cols * 7;
    const freq = 0.008 + 0.006 * (0.5 + 0.5 * Math.sin(tt * 0.23 + 1.7));

    return {
      glyphId: glyph.id,
      glyphName: glyph.name,
      seriesPos,
      scale: scale * breathe,
      rot,
      cx,
      cy,
      opacity,
      seed,
      freq,
      displacement: cfg.displacement,
    };
  }

  function buildSheetLayerConfig(cfg) {
    const layerId = 'swr-glyph-sheet';
    return {
      index: 0,
      tile: 0,
      layerId,
      filterId: layerId + '-noise',
      turbulenceId: layerId + '-turb',
      patternId: layerId + '-pat',
      rectId: layerId + '-rect',
      groupId: layerId + '-group',
    };
  }

  // ======================================================================
  // DOM BUILDING
  // ======================================================================
  function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, String(attrs[k]));
    return node;
  }

  // One stacked layer: a defs block (turbulence filter + pattern) and a
  // pattern-filled rect with the displacement filter applied. The glyph
  // sits inside the pattern under <g id="...-group"> so the rAF loop only
  // rewrites that one group's transform each frame.
  function buildLayer(layerCfg, glyph, displacement) {
    const layerId = layerCfg.layerId;

    const svg = el('svg', {
      class: 'swr-glyph-layer',
      xmlns: SVG_NS,
      viewBox: '0 0 1600 900',
      preserveAspectRatio: 'xMidYMid slice',
      'aria-hidden': 'true',
    });

    const defs = el('defs', {});

    // Noise -> displacement pipeline
    const filter = el('filter', { id: layerCfg.filterId, x: '-20%', y: '-20%', width: '140%', height: '140%' });
    const turb = el('feTurbulence', {
      id: layerCfg.turbulenceId,
      type: 'fractalNoise', baseFrequency: '0.014', numOctaves: '3', seed: '0',
      result: 'noise',
    });
    const disp = el('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'noise',
      scale: String(displacement || 26),
      xChannelSelector: 'R', yChannelSelector: 'G',
    });
    filter.appendChild(turb);
    filter.appendChild(disp);
    defs.appendChild(filter);

    // Glyph tile
    const pattern = el('pattern', {
      id: layerCfg.patternId,
      patternUnits: 'userSpaceOnUse',
      width: String(layerCfg.tile),
      height: String(layerCfg.tile),
    });
    const group = el('g', { id: layerCfg.groupId });
    const use = el('use', {
      href: '#' + glyph.id,
      x: String(layerCfg.tile / 2),
      y: String(layerCfg.tile / 2),
      transform: 'translate(-32 -32) scale(1.5)',
    });
    group.appendChild(use);
    pattern.appendChild(group);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    const rect = el('rect', {
      id: layerCfg.rectId,
      x: '0', y: '0', width: '1600', height: '900',
      fill: 'url(#' + layerCfg.patternId + ')',
      filter: 'url(#' + layerCfg.filterId + ')',
    });
    svg.appendChild(rect);

    return { svg, filter, turb, disp, group, rect, cfg: layerCfg };
  }

  // Contact-sheet layer: one SVG with a shared noise->displacement filter
  // over the whole grid group, and one <g> per cell holding a <use> of the
  // glyph it currently shows. The rAF loop rewrites each cell's <use> href +
  // transform, plus the shared filter attributes.
  function buildSheetLayer(cfg, layout) {
    const sheetCfg = buildSheetLayerConfig(cfg);
    const svg = el('svg', {
      class: 'swr-glyph-layer swr-glyph-sheet',
      xmlns: SVG_NS,
      viewBox: '0 0 ' + FRAME_W + ' ' + FRAME_H,
      preserveAspectRatio: 'xMidYMid slice',
      'aria-hidden': 'true',
    });
    const defs = el('defs', {});
    const filter = el('filter', { id: sheetCfg.filterId, x: '-20%', y: '-20%', width: '140%', height: '140%' });
    const turb = el('feTurbulence', {
      id: sheetCfg.turbulenceId,
      type: 'fractalNoise', baseFrequency: '0.014', numOctaves: '3', seed: '0',
      result: 'noise',
    });
    const disp = el('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'noise',
      scale: String(cfg.displacement || 26),
      xChannelSelector: 'R', yChannelSelector: 'G',
    });
    filter.appendChild(turb);
    filter.appendChild(disp);
    defs.appendChild(filter);
    svg.appendChild(defs);

    const group = el('g', { id: sheetCfg.groupId, filter: 'url(#' + sheetCfg.filterId + ')' });
    const cells = [];
    for (let i = 0; i < layout.cells.length; i++) {
      const cell = layout.cells[i];
      // keep the cell's glyph <use> node; repaint rewrites href + transform
      const cellGroup = el('g', { id: sheetCfg.groupId + '-cell-' + i });
      const use = el('use', { transform: 'translate(-32 -32)' });
      cellGroup.appendChild(use);
      group.appendChild(cellGroup);
      cells.push({ index: i, group: cellGroup, use });
    }
    svg.appendChild(group);

    return { svg, filter, turb, disp, group, cells, cfg: sheetCfg };
  }

  // ======================================================================
  // MOUNT + CONTROLLER
  // ======================================================================
  // GLYPH_DEFS_KEY: the shared <symbol> defs element is created once per
  // page. The <use> elements reference it; the glyph paths are authored
  // above and never leave the catalog.
  function ensureGlyphDefs() {
    let defs = document.getElementById('swr-glyph-defs');
    if (defs) return defs;
    defs = document.createElementNS(SVG_NS, 'svg');
    defs.setAttribute('id', 'swr-glyph-defs');
    defs.style.position = 'absolute';
    defs.style.width = '0';
    defs.style.height = '0';
    for (const g of GLYPHS) {
      const sym = document.createElementNS(SVG_NS, 'symbol');
      sym.setAttribute('id', g.id);
      sym.setAttribute('viewBox', g.viewBox);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', g.d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      sym.appendChild(path);
      defs.appendChild(sym);
    }
    document.body.appendChild(defs);
    return defs;
  }

  // Glyph assignment rotates as the stack re-tiles. 0 just uses catalog
  // order; higher offsets pivot which glyph leads the front layer.
  function glyphForIndex(i, cfg) {
    const off = Number(cfg.offset) || 0;
    return GLYPHS[(i + off) % GLYPHS.length];
  }

  // Builds and mounts the full stage. Returns a live controller; rebuilds
  // reuse the same controller by swapping the DOM under it — the rAF loop
  // keeps running and re-reads this.layers each frame.
  function mount(containerEl, rawCfg) {
    if (!containerEl || !containerEl.appendChild) return null;
    const cfg = normalizeCfg(rawCfg);
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    ensureGlyphDefs();

    const controller = {
      cfg,
      layers: [],
      containerEl,
      playing: false,
      _rafId: 0,
      _t: 0,
      _last: 0,
    };

    function buildStage() {
      containerEl.textContent = '';
      const stage = document.createElementNS(SVG_NS, 'svg');
      stage.setAttribute('class', 'swr-glyph-stage');
      stage.setAttribute('viewBox', '0 0 1600 900');
      stage.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      stage.setAttribute('role', 'img');
      stage.setAttribute('aria-label', 'Animated dingbat glyph stack with noise displacement');
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
      bg.setAttribute('width', '1600'); bg.setAttribute('height', '900');
      bg.setAttribute('class', 'swr-glyph-stage-bg');
      stage.appendChild(bg);

      if (controller.cfg.mode === 'sheet') {
        const layout = sheetLayout(controller.cfg);
        const built = buildSheetLayer(controller.cfg, layout);
        controller._layout = layout;
        stage.appendChild(built.svg);
        containerEl.appendChild(stage);
        return [built];
      }

      const builtLayers = [];
      for (let i = 0; i < controller.cfg.layers; i++) {
        const layerCfg = buildLayerConfig(i, controller.cfg);
        const glyph = glyphForIndex(i, controller.cfg);
        const built = buildLayer(layerCfg, glyph, controller.cfg.displacement);
        builtLayers.push(built);
        stage.appendChild(built.svg);
      }
      containerEl.appendChild(stage);
      return builtLayers;
    }

    controller.layers = buildStage();

    function paintNow(tSec) {
      if (controller.cfg.mode === 'sheet') {
        const sheet = controller.layers[0];
        if (!sheet) return;
        const s = sheetCellState(tSec, 0, controller.cfg);
        sheet.turb.setAttribute('seed', String(s.seed));
        sheet.turb.setAttribute('baseFrequency', s.freq.toFixed(4));
        sheet.disp.setAttribute('scale', s.displacement.toFixed(1));
        // Every cell: swap glyph + transform.
        for (const cell of sheet.cells) {
          const c = sheetCellState(tSec, cell.index, controller.cfg);
          cell.use.setAttribute('href', '#' + c.glyphId);
          cell.use.setAttribute('xlink:href', '#' + c.glyphId);
          cell.group.setAttribute(
            'transform',
            'translate(' + c.cx.toFixed(2) + ' ' + c.cy.toFixed(2) + ') rotate(' + c.rot.toFixed(2) + ') scale(' + c.scale.toFixed(4) + ')'
          );
          cell.group.setAttribute('opacity', c.opacity.toFixed(3));
        }
        return;
      }
      for (let i = 0; i < controller.layers.length; i++) {
        const s = layerState(tSec, i, controller.cfg);
        const layer = controller.layers[i];
        layer.group.setAttribute(
          'transform',
          'translate(' + s.tx.toFixed(2) + ' ' + s.ty.toFixed(2) + ') rotate(' + s.rot.toFixed(2) + ') scale(' + s.scale.toFixed(3) + ')'
        );
        layer.turb.setAttribute('seed', String(s.seed));
        layer.turb.setAttribute('baseFrequency', s.freq.toFixed(4));
        layer.disp.setAttribute('scale', s.displacement.toFixed(1));
        layer.svg.style.opacity = String(s.opacity);
      }
    }

    function frame(now) {
      const dt = (now - controller._last) / 1000;
      controller._last = now;
      if (dt > 0 && controller.playing) controller._t += dt;
      paintNow(controller._t);
      controller._rafId = requestAnimationFrame(frame);
    }

    controller.play = function () { controller.playing = true; };
    controller.pause = function () { controller.playing = false; };
    controller.toggle = function () { controller.playing = !controller.playing; return controller.playing; };
    controller.isPlaying = function () { return controller.playing; };

    controller.rebuild = function (nextCfg) {
      controller.cfg = normalizeCfg(nextCfg);
      controller.layers = buildStage();
      paintNow(controller._t); // repaint immediately with new topology
      return controller.cfg;
    };

    controller.destroy = function () {
      cancelAnimationFrame(controller._rafId);
      containerEl.textContent = '';
    };

    // Kick off
    if (reduced) {
      controller.playing = false;
      paintNow(4.2); // static equilibrium frame
    } else {
      controller.playing = true;
      controller._last = performance.now();
      controller._rafId = requestAnimationFrame(frame);
    }

    return controller;
  }

  window.SWR_GLYPHS = {
    GLYPHS,
    DEFAULT_CFG,
    FRAME_W,
    FRAME_H,
    normalizeCfg,
    layerState,
    sheetLayout,
    sheetCellState,
    buildLayerConfig,
    buildSheetLayerConfig,
    buildLayer,
    buildSheetLayer,
    glyphForIndex,
    mount,
  };
})();