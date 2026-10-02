#!/usr/bin/env node
// scripts/check-glyph-forge-unit.mjs — pure-logic unit tests for the glyph
// fill's character generator in client/glyph-forge.client.js, plus the pure
// timeline helpers in client/glyph-fill.client.js that schedule them.
//
// The forge is the module's load-bearing claim: every cell of an ~84-cell
// sheet is a DIFFERENT ornament, generated rather than drawn from a catalog,
// and the sheet is reproducible from its seed. Both are properties that look
// fine on one screen and rot quietly, so they are asserted here rather than
// eyeballed.
//
// 5 sections: module+exports, uniqueness, determinism, geometry fit, fill
// timeline. Loaded through node:vm with a bare `window` shim — both modules
// are plain IIFEs that attach window.SWR_GLYPH_FORGE / window.SWR_GLYPH_FILL,
// and neither touches the DOM until mount() is called.
//
// Run:  node scripts/check-glyph-forge-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const FORGE_SRC = path.join(ROOT, 'client/glyph-forge.client.js');
const FILL_SRC = path.join(ROOT, 'client/glyph-fill.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Load the modules ----------------------------------------------------
// One sandbox for both, so the fill sees the forge exactly as the page wires
// them: <script> forge, then fill, both deferred.
const sandbox = {
  window: {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
};
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FORGE_SRC, 'utf8'), sandbox, { filename: 'glyph-forge.client.js' });
vm.runInContext(fs.readFileSync(FILL_SRC, 'utf8'), sandbox, { filename: 'glyph-fill.client.js' });

const F = sandbox.window.SWR_GLYPH_FORGE;
const G = sandbox.window.SWR_GLYPH_FILL;

// Bounding box of a stroke path. Every command this module emits is `M`/`L`
// over a coordinate pair, so walking the numbers two at a time is exact —
// there are no curves, arcs or relative coords to mis-parse.
function bbox(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, pairs: 0 };
  for (let i = 0; i + 1 < nums.length; i += 2) {
    b.minX = Math.min(b.minX, nums[i]);
    b.maxX = Math.max(b.maxX, nums[i]);
    b.minY = Math.min(b.minY, nums[i + 1]);
    b.maxY = Math.max(b.maxY, nums[i + 1]);
    b.pairs += 1;
  }
  return b;
}

// ---- Section 1: module + exports ---------------------------------------

function section1() {
  console.log('\n[1] module + exports');
  assert(F && typeof F === 'object', 'window.SWR_GLYPH_FORGE is exported');
  const expected = ['forge', 'buildGlyph', 'hash32', 'mulberry32'];
  for (const key of expected) {
    assert(typeof F[key] === 'function', `forge exports ${key}`, typeof F[key]);
  }
  assert(Array.isArray(F.FAMILIES) && F.FAMILIES.length >= 9,
    'FAMILIES is the generator catalog', F.FAMILIES.length);
  const bad = F.FAMILIES.filter((f) => !f.id || !f.label || typeof f.make !== 'function');
  assert(bad.length === 0, 'every family has id, label and make()', `${bad.length} malformed`);
  const ids = F.FAMILIES.map((f) => f.id);
  assert(new Set(ids).size === ids.length, 'family ids are unique');

  // Re-running the IIFE must not clobber state (pages load both modules on
  // every navigation of a back/forward cache hit).
  vm.runInContext(fs.readFileSync(FORGE_SRC, 'utf8'), sandbox, { filename: 'glyph-forge.client.js (2nd)' });
  assert(sandbox.window.SWR_GLYPH_FORGE === F, 'module is idempotent on a second run');

  assert(G && typeof G === 'object', 'window.SWR_GLYPH_FILL is exported');
  for (const key of ['normalizeCfg', 'gridLayout', 'cellState', 'toneFor', 'resolveGlyphs', 'mount']) {
    assert(typeof G[key] === 'function', `fill exports ${key}`, typeof G[key]);
  }
  assert(F.MULBERRY !== false && F.mulberry32(1) !== F.mulberry32(1),
    'mulberry32 is exposed and returns a function per seed');
}

// ---- Section 2: uniqueness ----------------------------------------------

function section2() {
  console.log('\n[2] uniqueness — every cell is a different character');
  // The headline requirement. A sheet of 12 catalog glyphs on 84 cells repeats
  // seven times; the forge must not, at any seed or any count.
  const seeds = [0, 1, 2, 7, 42, 999, 123456];
  const counts = [1, 2, 12, 56, 84, 200];
  let distinctOk = true;
  let detail = '';
  for (const seed of seeds) {
    for (const n of counts) {
      const paths = new Set(F.forge(n, seed).map((g) => g.d));
      if (paths.size !== n) {
        distinctOk = false;
        detail = `seed ${seed}, n=${n}: ${paths.size}/${n} unique`;
      }
    }
  }
  assert(distinctOk, `${seeds.length} seeds × ${counts.length} counts all distinct`,
    distinctOk ? 'up to 200 glyphs' : detail);

  const sheet = F.forge(84, 1);
  assert(sheet.length === 84, 'forge(84) returns 84 glyphs', sheet.length);
  assert(sheet.every((g) => g && typeof g.d === 'string' && g.d.length > 16),
    'every glyph carries a non-trivial path');
  assert(new Set(sheet.map((g) => g.id)).size === 84, 'ids are unique too');
  assert(sheet.every((g, i) => g.index === i), 'index records the cell it was minted for');
  assert(sheet.every((g) => g.seed === '1'), 'seed is recorded on each glyph');

  // Count is a function of the argument, including the degenerate ones.
  assert(F.forge(0, 1).length === 0, 'forge(0) → empty');
  assert(F.forge(-5, 1).length === 0, 'forge(-5) → empty, no throw');
  assert(F.forge(84.9, 1).length === 84, 'forge floors a fractional count', 84);
  assert(F.forge('12', 1).length === 12, 'forge coerces a numeric string', 12);
  assert(F.forge(NaN, 1).length === 0, 'forge(NaN) → empty, no throw');

  // Every family must actually be reachable, or a dead branch quietly shrinks
  // the space the uniqueness guarantee rests on.
  const used = new Set();
  for (let s = 0; s < 80; s++) for (const g of F.forge(84, s)) used.add(g.family);
  assert(used.size === F.FAMILIES.length,
    'every family is drawn over 80 sheets', `${used.size}/${F.FAMILIES.length}`);

  // buildGlyph is the funnel every family passes through, so its own inputs
  // need covering — including the ones that must be rejected, not rendered.
  assert(F.buildGlyph([]) === null, 'buildGlyph([]) → null');
  assert(F.buildGlyph(null) === null, 'buildGlyph(null) → null');
  assert(F.buildGlyph([{ pts: [], close: true }]) === null,
    'a segment with no points is dropped');
  assert(F.buildGlyph([{ pts: [[0, 0]], close: true }]) === null,
    'a single-point segment cannot describe a stroke');
  assert(F.buildGlyph([{ pts: [[1, 1], [1, 1]], close: false }]) === null,
    'a zero-extent segment → null, not a divide-by-zero');
}

// ---- Section 3: determinism ---------------------------------------------

function section3() {
  console.log('\n[3] determinism — a sheet is a pure function of its seed');
  assert(JSON.stringify(F.forge(84, 1)) === JSON.stringify(F.forge(84, 1)),
    'same seed → byte-identical sheet');
  assert(F.forge(84, 1)[0].d !== F.forge(84, 2)[0].d,
    'a different seed → a different sheet');

  // The property that makes the column slider tolerable: cell N's character
  // depends on N alone, so growing or shrinking the grid leaves the ornaments
  // already on screen untouched instead of reshuffling the whole page.
  const wide = F.forge(84, 7);
  const narrow = F.forge(56, 7);
  assert(wide.slice(0, 56).every((g, i) => g.d === narrow[i].d),
    'resize keeps the first 56 glyphs identical');
  const taller = F.forge(24, 7);
  assert(wide.slice(0, 24).every((g, i) => g.d === taller[i].d),
    'same guarantee shrinking the count');

  // Seed plumbing: the fill's resolveGlyphs is what the page actually calls,
  // and it must return the forge's sheet rather than the (absent) catalog.
  const viaFill = G.resolveGlyphs(84, 3);
  assert(viaFill.length === 84, 'resolveGlyphs(84) returns 84 glyphs', viaFill.length);
  assert(JSON.stringify(viaFill) === JSON.stringify(F.forge(84, 3)),
    'resolveGlyphs defers to the forge with the same seed');
  assert(G.resolveGlyphs(84, 3)[0].d === G.resolveGlyphs(84, 3)[0].d,
    'resolveGlyphs is itself deterministic');
  assert(new Set(G.resolveGlyphs(84, 3).map((g) => g.d)).size === 84,
    'the sheet the page renders is 84 distinct characters');
}

// ---- Section 4: geometry fit --------------------------------------------

function section4() {
  console.log('\n[4] geometry — normalised to the 64-unit box');
  // The generators compose amplitudes (rotating a squashed ellipse puts a
  // corner at RAD*sqrt(2)), so any of them can emit ink outside the box. One
  // shared pass in buildGlyph is what holds the line — so assert the line
  // rather than the reason it moved.
  const MAX = F.MAX_EXTENT;
  const MIN = F.MIN_EXTENT;
  let outside = 0;
  let offExtent = 0;
  let offCentre = 0;
  let degenerate = 0;
  let total = 0;

  for (let s = 0; s < 30; s++) {
    for (const g of F.forge(84, s)) {
      total++;
      const b = bbox(g.d);
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const extent = Math.max(w, h);
      if (b.minX < 5 || b.maxX > 59 || b.minY < 5 || b.maxY > 59) outside++;
      if (extent < MIN - 0.5 || extent > MAX + 0.5) offExtent++;
      if (Math.abs((b.minX + b.maxX) / 2 - 32) > 1) offCentre++;
      if (Math.abs((b.minY + b.maxY) / 2 - 32) > 1) offCentre++;
      if (b.pairs < 4 || extent <= 0) degenerate++;
    }
  }
  assert(outside === 0, `ink stays inside the box (5..59)`, `${outside}/${total} strays`);
  assert(offExtent === 0, `ink extent held to [${MIN}, ${MAX}]`, `${offExtent}/${total} outliers`);
  assert(offCentre === 0, `every glyph centred on (32,32)`, `${offCentre} axes off`);
  assert(degenerate === 0, 'no degenerate glyphs', `${degenerate}/${total}`);

  // A tiny amplitude must not leave a speck among 51 substantial neighbours —
  // that is why buildGlyph normalises to a floor as well as a ceiling.
  const tiny = [];
  for (let s = 0; s < 12; s++) {
    for (const g of F.forge(84, s)) {
      const b = bbox(g.d);
      if (Math.max(b.maxX - b.minX, b.maxY - b.minY) < MIN) tiny.push(g);
    }
  }
  assert(tiny.length === 0, 'the min-extent floor scales up weak shapes', `${tiny.length} specks`);

  // Multi-ring families must emit independent subpaths, not one polyline that
  // chords between unrelated segments.
  const multi = F.forge(200, 11).filter((g) => (g.d.match(/M/g) || []).length > 1);
  assert(multi.length > 0, 'multi-segment shapes survive the build',
    `${multi.length} of 200 have >1 subpath`);

  // Coordinates are rounded, so the strings stay hashable and storable; the
  // value is a multiple of 0.01 and finite everywhere.
  let round = true;
  for (let s = 0; s < 6; s++) {
    for (const g of F.forge(84, s)) {
      for (const n of g.d.match(/-?\d+(\.\d+)?/g).map(Number)) {
        if (!Number.isFinite(n) || Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) round = false;
      }
    }
  }
  assert(round, 'every coordinate is finite and rounded to 2dp');

  // Only M and L, so the unit test's coordinate walk above cannot silently
  // mis-parse a curve. Multi-ring families emit several subpaths per glyph, so
  // the pattern has to allow a subpath to start mid-string.
  const SUB = /M[-\d.]+ [-\d.]+(?:L[-\d.]+ [-\d.]+)*Z?/;
  const pathShape = F.forge(400, 5).every((g) => new RegExp('^(?:' + SUB.source + ')+$').test(g.d));
  assert(pathShape, 'paths are M/L subpaths only — no curves to mis-parse');
}

// ---- Section 5: fill timeline -------------------------------------------

function section5() {
  console.log('\n[5] fill timeline — the sequential reveal');
  const cfg = G.normalizeCfg({});
  assert(cfg.cols > 0 && cfg.rows > 0 && cfg.rate > 0, 'defaults are sane',
    `${cfg.cols}×${cfg.rows} @ ${cfg.rate}/s`);
  assert(G.normalizeCfg({ cols: 0, rows: -3, rate: 0 }).cols >= 1,
    'a degenerate grid is clamped to at least one cell');

  // The sheet must fill in order, one character at a time — that is the whole
  // premise. At any t the arrived set is a prefix, with a bounded number of
  // cells mid-flight.
  const count = cfg.cols * cfg.rows;
  let prefix = true;
  let maxInFlight = 0;
  let reached = 0;
  const dur = (count - 1) / cfg.rate + cfg.reveal;
  for (let t = 0; t <= dur + cfg.reveal; t += dur / 400) {
    const states = [];
    for (let i = 0; i < count; i++) states.push(G.cellState(t, i, cfg));
    let seenPending = false;
    let inFlight = 0;
    for (let i = 0; i < count; i++) {
      if (states[i].arrived) {
        reached = Math.max(reached, i + 1);
        if (seenPending) prefix = false;
      } else {
        seenPending = true;
        if (states[i].opacity > 0) inFlight++;
      }
    }
    maxInFlight = Math.max(maxInFlight, inFlight);
  }
  assert(prefix, 'the arrived set is always a prefix — no holes in the fill');
  assert(reached === count, 'every cell arrives by the end of the timeline', `${reached}/${count}`);

  // "Spaced" is a property of the TIMING, not of the cell count: consecutive
  // characters start a fixed 1/rate apart, so the overlap is set by reveal×rate
  // and stays put whether the sheet holds 24 cells or 84. At the defaults that
  // is a 160ms arrival against a 71ms cadence — three in flight, each further
  // along than the last, which reads as a sequence rather than a wash.
  const step = 1 / cfg.rate;
  let strideOk = true;
  let startsOrdered = true;
  for (const i of [0, 1, 17, count - 2]) {
    // One microstep before its turn, nothing shows; one microstep after, it does.
    if (G.cellState(i * step - 1e-4, i, cfg).opacity !== 0) startsOrdered = false;
    if (!(G.cellState(i * step + 1e-4, i, cfg).opacity > 0)) startsOrdered = false;
    // At any instant an earlier cell is strictly further along than a later
    // one — that is what makes the fill read as a sequence.
    for (const f of [0.25, 0.5, 0.75]) {
      const t = (i + f) * step;
      if (!(G.cellState(t, i, cfg).progress > G.cellState(t, i + 1, cfg).progress)) startsOrdered = false;
    }
  }
  assert(startsOrdered, `consecutive characters start exactly 1/${cfg.rate}s apart, in order`,
    `${(step * 1000).toFixed(0)}ms stride`);
  const bound = Math.ceil(cfg.reveal * cfg.rate) + 1;
  assert(maxInFlight <= bound, 'overlap is bounded by reveal×rate, not the sheet size',
    `${maxInFlight} in flight, bound ${bound}`);

  // Same rate on a much smaller sheet must not change the pacing at all.
  const small = G.normalizeCfg({ cols: 6, rows: 4 });
  let smallMax = 0;
  const sCount = small.cols * small.rows;
  const sDur = (sCount - 1) / small.rate + small.reveal;
  for (let t = 0; t <= sDur + small.reveal; t += sDur / 400) {
    let inFlight = 0;
    for (let i = 0; i < sCount; i++) {
      const st = G.cellState(t, i, small);
      // Count only cells still arriving — a settled cell is part of the
      // finished sheet, not of the overlap.
      if (!st.arrived && st.opacity > 0) inFlight++;
    }
    smallMax = Math.max(smallMax, inFlight);
  }
  assert(smallMax === maxInFlight, 'a 24-cell sheet paces identically to an 84-cell one',
    `${smallMax} vs ${maxInFlight} in flight`);

  // Nothing may be visible before its turn, and everything settled after it.
  const before = G.cellState(0, 3, cfg);
  assert(before.opacity === 0 && before.scale === 0.55 && before.arrived === false,
    'cell 3 is invisible at t=0');
  const after = G.cellState(dur + cfg.reveal * 2, 3, cfg);
  assert(after.opacity === 1 && after.scale === 1 && after.arrived === true,
    'cell 3 is fully landed well after the run');
  assert(G.cellState(-1, 0, cfg).opacity === 0, 'negative t does not reveal anything');
  assert(G.cellState(dur * 10, 0, cfg).progress === 1, 'progress saturates at 1');

  // One note per character, climbing a scale rather than sliding past it.
  const tones = [];
  for (let i = 0; i < count; i++) tones.push(G.toneFor(i, cfg));
  assert(tones.every((t) => t.freq > 0 && t.dur > 0 && t.gain >= 0),
    'every cell has an audible tone', `${count} tones`);
  const freqs = [...new Set(tones.map((t) => t.freq))].sort((a, b) => a - b);
  assert(freqs.length >= 3, 'tones span a scale, not one pitch', `${freqs.length} distinct`);
  assert(tones[count - 1].freq >= tones[0].freq,
    'the run climbs as the sheet fills',
    `${tones[0].freq.toFixed(0)} → ${tones[count - 1].freq.toFixed(0)} Hz`);
  // Gain has to fall off across the fill, or 84 notes stack into clipping.
  assert(tones[count - 1].gain <= tones[0].gain, 'gain falls off across the fill',
    `${tones[0].gain.toFixed(3)} → ${tones[count - 1].gain.toFixed(3)}`);

  // Spacing is a ratio of gap to cell, so the fit stays positive at any
  // column count — an absolute gap went negative and collapsed the grid.
  let positive = true;
  for (let cols = 1; cols <= 40; cols++) {
    for (const spacing of [0, 0.05, 0.25, 0.5, 1]) {
      const l = G.gridLayout(G.normalizeCfg({ cols, spacing }), 0.8);
      if (!(l.cellW > 0) || !(l.cellH > 0)) positive = false;
    }
  }
  assert(positive, 'cell size stays positive from 1 to 40 columns across the spacing range');
  const wide = G.gridLayout(G.normalizeCfg({ cols: 4, spacing: 0 }), 1);
  const spaced = G.gridLayout(G.normalizeCfg({ cols: 4, spacing: 0.5 }), 1);
  assert(spaced.cellW < wide.cellW, 'spacing actually narrows the cells',
    `${wide.cellW.toFixed(1)} → ${spaced.cellW.toFixed(1)}`);
  assert(G.gridLayout(cfg, 0.5).aspect === 0.5, 'the frame takes the container aspect');
}

// ---- Run ----------------------------------------------------------------

function main() {
  section1();
  section2();
  section3();
  section4();
  section5();

  console.log('\n' + (failures === 0
    ? 'GLYPH FORGE UNIT: all assertions passed'
    : `GLYPH FORGE UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
}
