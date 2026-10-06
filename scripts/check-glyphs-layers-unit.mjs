#!/usr/bin/env node
// scripts/check-glyphs-layers-unit.mjs — pure-logic + DOM-shape unit tests
// for the animated dingbat glyph system: client/gallery-glyphs.client.js
// (window.SWR_GLYPHS).
//
// Two modes:
//   stack — SVG pattern layers with per-layer drift/rotation/scale + a
//           feTurbulence -> feDisplacementMap pipeline
//   sheet — a full-frame contact-sheet grid (default 9 cols x 3 rows) that
//           rolls through the glyph series one step at a time ("x+1"),
//           cells distributed with margin + spacing, one shared noise
//           displacement filter over the whole sheet
//
// Covers: glyph catalog integrity, config normalization/clamping, the pure
// layer + sheet math (determinism, bounds, series roll), and DOM-shape
// assertions for the built SVG (filter pipeline present, cell count).
//
// Run:    node scripts/check-glyphs-layers-unit.mjs
// Exit:   0 = all pass, 1 = any failure, 2 = crashed.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SRC = path.join(ROOT, 'client/gallery-glyphs.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Minimal DOM shims for the SVG DOM builders ----------------------

class MockNode {
  constructor(name) {
    this.nodeName = name;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
  }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  getElementById() { return null; }
}

const documentShim = {
  createElementNS(ns, tag) { return new MockNode(tag); },
  getElementById(id) { return null; }, // ensureGlyphDefs() will create fresh
  body: new MockNode('body'),
  head: new MockNode('head'),
};

const windowShim = {
  document: documentShim,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  matchMedia: () => ({ matches: false }),
  SWR_GLYPHS: undefined,
};

const context = {
  window: windowShim,
  document: documentShim,
  requestAnimationFrame: windowShim.requestAnimationFrame,
  cancelAnimationFrame: windowShim.cancelAnimationFrame,
  performance: windowShim.performance,
  Math, Number, String, Object, Array, console,
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), context, { filename: SRC });

const G = context.window.SWR_GLYPHS;
assert(!!G && typeof G === 'object', 'SWR_GLYPHS module loaded');
if (!G) { process.exit(2); }

// ---- Glyph catalog -----------------------------------------------------
assert(G.GLYPHS.length >= 10, 'catalog has at least 10 glyphs', String(G.GLYPHS.length));
const ids = G.GLYPHS.map((g) => g.id);
assert(new Set(ids).size === ids.length, 'glyph ids are unique');
assert(G.GLYPHS.every((g) => g.id && /^[a-z0-9-]+$/.test(g.id) && g.name && g.d && g.viewBox === '0 0 64 64'),
  'every glyph has id/name/path data/64x64 viewBox');

// ---- Config normalization ---------------------------------------------
const def = G.normalizeCfg(null);
assert(def.mode === 'sheet', 'default mode is sheet (contact sheet), not stack');
assert(def.cols === 9 && def.rows === 3, 'default sheet is 9 cols x 3 rows', `${def.cols}x${def.rows}`);
assert(def.layers === 4 && def.displacement === 26 && def.speed === 1, 'default stack/displacement/speed');

const clamped = G.normalizeCfg({ mode: 'stack', layers: 99, displacement: 999, speed: -3, cols: 0, rows: 400, margin: -5, spacing: 90 });
assert(clamped.layers === 6, 'layers clamped to max 6', String(clamped.layers));
assert(clamped.displacement === 80, 'displacement clamped to 80', String(clamped.displacement));
assert(clamped.speed === 0.25, 'speed clamped to 0.25', String(clamped.speed));
assert(clamped.cols === 1, 'cols clamped to min 1', String(clamped.cols));
assert(clamped.rows === 12, 'rows clamped to max 12', String(clamped.rows));
assert(clamped.margin === 0 && clamped.spacing === 80, 'margin/spacing clamped');

// ---- Stack layer state (pure) -----------------------------------------
const stackCfg = G.normalizeCfg({ mode: 'stack', layers: 4 });
const s1 = G.layerState(1.0, 2, stackCfg);
const s2 = G.layerState(1.0, 2, stackCfg);
assert(JSON.stringify(s1) === JSON.stringify(s2), 'layerState is deterministic');
assert(s1.tx >= 0 && s1.tx < stackCfg.tile && s1.ty >= 0 && s1.ty < stackCfg.tile,
  'stack drift wraps inside tile bounds', `tx=${s1.tx.toFixed(1)} ty=${s1.ty.toFixed(1)}`);
assert(s1.rot >= 0 && s1.rot < 360, 'stack rotation wraps under 360');
assert(Number.isInteger(s1.seed), 'noise seed is an integer');
assert(s1.displacement >= 0 && s1.displacement <= 80, 'stack displacement bounded');
assert(s1.opacity >= 0.05 && s1.opacity <= 1, 'stack opacity bounded');

// ---- Sheet layout (pure) ----------------------------------------------
const sheetCfg = G.normalizeCfg({ mode: 'sheet', cols: 9, rows: 3, margin: 40, spacing: 22 });
const layout = G.sheetLayout(sheetCfg);
assert(layout.cells.length === 27, '9x3 sheet lays out 27 cells', String(layout.cells.length));
assert(layout.frameW === 1600 && layout.frameH === 900, 'sheet spans the full 1600x900 frame');
const first = layout.cells[0];
const last = layout.cells[26];
assert(first.x === sheetCfg.margin && first.y === sheetCfg.margin, 'first cell sits at the margin');
assert(last.x + last.w <= layout.frameW - sheetCfg.margin + 0.001
  && last.y + last.h <= layout.frameH - sheetCfg.margin + 0.001,
  'last cell stays inside margins');
// No cell overlaps another (spacing respected): cell stride must leave a gap
assert(layout.cells[1].x - (first.x + first.w) === sheetCfg.spacing, 'horizontal spacing between columns');
assert(layout.cells[9].y - (first.y + first.h) === sheetCfg.spacing, 'vertical spacing between rows');

const portrait = G.sheetLayout(G.normalizeCfg({ mode: 'sheet', cols: 3, rows: 9 }));
assert(portrait.cells.length === 27, '3x9 (portrait) also lays out 27 cells');
assert(portrait.cellH < portrait.cellW, 'portrait: cells are taller than wide', `w=${portrait.cellW.toFixed(0)} h=${portrait.cellH.toFixed(0)}`);

// ---- Sheet cell state (the x+1 roll) ----------------------------------
const c0 = G.sheetCellState(0, 0, sheetCfg);
const c0b = G.sheetCellState(2.0, 0, sheetCfg); // rollRate 0.5 -> roll += 1
assert(c0.glyphId === G.GLYPHS[0].id, 'cell 0 at t=0 shows series glyph 0', c0.glyphId);
assert(c0b.seriesPos === (c0.seriesPos + 1) % G.GLYPHS.length, 'sheet animates x+1 each roll step');
const c1 = G.sheetCellState(0, 1, sheetCfg);
assert(c1.glyphId === G.GLYPHS[1].id, 'cell 1 at t=0 shows series glyph 1', c1.glyphId);
assert(c0.cx === first.x + first.w / 2 && c0.cy === first.y + first.h / 2, 'cell 0 centered in its box');
assert(c0.scale > 0, 'cell scale positive');
assert(c0.opacity >= 0.2 && c0.opacity <= 1, 'cell opacity bounded');
assert(G.GLYPHS.some((g) => g.id === c0.glyphId), 'sheet glyphId resolves in catalog');

// offset rotates the whole sheet's glyph assignment
const offsetCfg = G.normalizeCfg({ mode: 'sheet', cols: 9, rows: 3, offset: 1 });
const co = G.sheetCellState(0, 0, offsetCfg);
assert(co.glyphId === G.GLYPHS[1].id, 'offset 1 shifts cell 0 onto series glyph 1', co.glyphId);

// ---- DOM shape: sheet layer -------------------------------------------
const sheetBuilt = G.buildSheetLayer(sheetCfg, layout);
assert(sheetBuilt.cells.length === 27, 'built sheet has 27 cell groups', String(sheetBuilt.cells.length));
assert(sheetBuilt.svg.nodeName === 'svg', 'sheet root is <svg>');
assert(sheetBuilt.group.getAttribute('filter') === 'url(#' + sheetBuilt.cfg.filterId + ')',
  'sheet group carries the displacement filter');
const filterEl = sheetBuilt.filter;
assert(filterEl.children.some((c) => c.nodeName === 'feTurbulence'), 'filter has feTurbulence');
assert(filterEl.children.some((c) => c.nodeName === 'feDisplacementMap'), 'filter has feDisplacementMap');

// ---- DOM shape: stack layer -------------------------------------------
const layerBuilt = G.buildLayer(G.buildLayerConfig(0, stackCfg), G.GLYPHS[0], stackCfg.displacement);
assert(layerBuilt.svg.nodeName === 'svg', 'stack layer root is <svg>');
assert(filterEl && filterEl.children.length >= 2, 'stack layer has the noise pipeline');
assert(layerBuilt.rect.getAttribute('fill') === 'url(#' + layerBuilt.cfg.patternId + ')',
  'stack rect fills with the pattern');
assert(layerBuilt.rect.getAttribute('filter') === 'url(#' + layerBuilt.cfg.filterId + ')',
  'stack rect displaces through the filter');

// ---- glyphForIndex -----------------------------------------------------
assert(G.glyphForIndex(0, G.normalizeCfg(null)).id === G.GLYPHS[0].id, 'glyphForIndex base');
assert(G.glyphForIndex(0, G.normalizeCfg({ offset: 5 })).id === G.GLYPHS[5].id, 'glyphForIndex offset');

console.log(failures ? `\n✗ ${failures} glyph-layers assertion(s) failed` : `\n✓ glyph-layers unit: all assertions passed`);
process.exit(failures ? 1 : 0);