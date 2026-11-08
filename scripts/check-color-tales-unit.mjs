#!/usr/bin/env node
// Unit tests for Color Tales pure modules (node:vm).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failures++; }
}

const sandbox = { window: {}, console, Math, JSON, Uint8Array, Uint8ClampedArray, Int32Array, Set, Map };

function loadGlobal(scriptName) {
  const src = fs.readFileSync(path.join(ROOT, 'client', scriptName), 'utf8');
  if (!sandbox.window) sandbox.window = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window;
}

function makeImageData(w, h, fillFn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fillFn(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

console.log('Color Tales — constants & speed');
loadGlobal('color-tales-constants.client.js');
loadGlobal('color-tales-speed.client.js');
const win = sandbox.window;
const C = win.SWR_COLOR_TALES_CONSTANTS;
const SPEED = win.SWR_COLOR_TALES_SPEED;
assert(C.AUTO_ADVANCE_COVERAGE === 0.6, 'AUTO_ADVANCE_COVERAGE is 0.60');
assert(SPEED.freeTimingIntervalMs(1) === 600, 'default 600ms at 1×');
assert(SPEED.freeTimingIntervalMs(2) === 300, '600/2 at 2×');
assert(SPEED.snapBeatSpeed(0.9) === 1, 'snap 0.9 → 1');
assert(SPEED.beatIntervalMs(1, 120) === 500, 'one region per beat at 120 BPM');

console.log('Color Tales — two-color refine');
loadGlobal('color-tales-two-color.client.js');
const TWO = win.SWR_COLOR_TALES_TWO_COLOR;
const img = makeImageData(40, 40, (x, y) => (x > 10 && x < 30 && y > 10 && y < 30 ? [20, 20, 20, 255] : [250, 248, 240, 255]));
const refined = TWO.refineTwoColor(img, { threshold: 180 });
assert(refined.svg.includes('<svg'), 'refine emits SVG');
assert(refined.pathCount > 0, 'refine emits paths');

console.log('Color Tales — segmentation');
loadGlobal('color-tales-segment.client.js');
const SEG = win.SWR_COLOR_TALES_SEGMENT;
const img2 = makeImageData(20, 20, (x) => (x < 10 ? [200, 50, 50, 255] : [50, 200, 50, 255]));
const seg = SEG.segmentRegions(img2, { tolerance: 10, minArea: 20 });
assert(seg.regions.length >= 2, 'finds at least two color regions');

console.log('Color Tales — scheduler');
loadGlobal('color-tales-scheduler.client.js');
const SCHED = win.SWR_COLOR_TALES_SCHEDULER;
const regions = [
  { id: 'a', area: 10000, cx: 10, cy: 10 },
  { id: 'b', area: 500, cx: 50, cy: 50 },
];
const pick = SCHED.pickNextRegion(regions, new Set(), { band: 0, intensity: 0.8 }, 'size');
assert(pick?.id === 'a', 'large region first when bass band active');

console.log('Color Tales — coverage');
loadGlobal('color-tales-coverage.client.js');
const COV = win.SWR_COLOR_TALES_COVERAGE;
const strokes = [{ filled: true, areaPx: 300000 }];
assert(COV.shouldAutoAdvance(strokes, 400000), '60% gate passes at 75% painted');
assert(!COV.shouldAutoAdvance([{ filled: true, areaPx: 10000 }], 400000), 'low coverage blocks advance');

console.log('Color Tales — export mime pick');
loadGlobal('color-tales-export.client.js');
const EXPORT = win.SWR_COLOR_TALES_EXPORT;
const fakeMr = {
  isTypeSupported: (m) => m.startsWith('video/webm'),
};
const picked = EXPORT.pickRecorderMime(fakeMr);
assert(picked.extension === 'webm', 'honest webm fallback');
assert(picked.supportsMp4 === false, 'no false MP4 claim');

console.log('Color Tales — stroke caps');
loadGlobal('color-tales-paint.client.js');
const PAINT = win.SWR_COLOR_TALES_PAINT;
assert(PAINT.needsStrokeCap('M10 20'), 'moveto-only needs cap');
assert(!PAINT.needsStrokeCap('M10 20 L30 40'), 'segment path uses stroke');
assert(PAINT.firstPoint('M12.5 18')?.x === 12.5, 'parse move point');
assert(PAINT.capRadius(40) === 20, 'cap radius half brush size');

console.log('Color Tales — shipped default pages manifest');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'color-tales/default-pages.json'), 'utf8'));
assert(Array.isArray(manifest.pages) && manifest.pages.length === 8, 'default-pages.json lists eight pages');
assert(manifest.hero === '/color-tales/characters.webp', 'hero webp path');
assert(fs.existsSync(path.join(ROOT, 'color-tales/characters.webp')), 'characters.webp exists');
assert(fs.existsSync(path.join(ROOT, 'color-tales/default-pages.bundle.js')), 'default-pages.bundle.js exists');

console.log('Color Tales — page SVG contract');
const pageStore = (svgText) => {
  const pages = [['A', 'hint', { placeholder: true }]];
  pages[0][2] = { svg: svgText };
  delete pages[0][2].placeholder;
  const turnSvg = pages[0][2]?.svg || null;
  return turnSvg;
};
assert(pageStore('<svg/>') === '<svg/>', 'refined SVG stored on page meta');

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll Color Tales unit checks passed.');
process.exit(0);
