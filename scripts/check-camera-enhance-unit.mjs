#!/usr/bin/env node
// scripts/check-camera-enhance-unit.mjs — pure-logic unit tests for Camera
// Enhance (PR 4 of 4): client/swr-camera-enhance.client.js.
//
// The module is loaded in node:vm with browser shims; only its pure helpers
// are exercised — the grade mapping, the auto-exposure maths, the stabiliser
// estimator/smoother, the format geometry, the overlay alpha caps and the
// painted-layer scales. The renderer itself is verified in the browser.
//
// Run:  node scripts/check-camera-enhance-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const RUNTIME_SRC = path.join(ROOT, 'client/swr-camera-enhance.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- browser shims ----------------------------------------------------------
function makeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    canvas: { width: 720, height: 405 },
    globalAlpha: 1,
    filter: 'none',
    measureText: () => ({ width: 120 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return () => undefined; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 720, height: 405, getContext: () => makeCtx(), captureStream: () => ({ getTracks: () => [] }) };
}

const sandbox = {
  console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, TypeError, Promise,
  isFinite, isNaN, parseFloat, parseInt, Uint8Array, Uint8ClampedArray, Float32Array, Int16Array, ArrayBuffer,
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  document: {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {}, remove() {} }),
    getElementById: () => null,
    querySelector: () => null,
  },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const code = fs.readFileSync(RUNTIME_SRC, 'utf8');
let CE;
try {
  vm.runInNewContext(code, sandbox, { filename: 'swr-camera-enhance.client.js' });
  CE = sandbox.window.SWR_CAMERA_ENHANCE;
} catch (e) {
  console.error('✗ module failed to load:', e.message);
  process.exit(2);
}

console.log('1 · module surface');
assert(!!CE && typeof CE.create === 'function', 'SWR_CAMERA_ENHANCE.create exists');
const NEEDED = ['LOOKS', 'PARAM_KEYS', 'FORMAT_ASPECT', 'QUALITY_LONG_EDGE', 'FIX_NAMES', 'OVERLAY_MODES',
  'buildFilter', 'effectiveParams', 'autoExposureBias', 'grainAlpha', 'vignetteAlpha',
  'estimateShift', 'smoothPath', 'stabilizerOffset', 'audioFeatures', 'formatRect', 'outputLongEdge', 'overlayAlpha'];
const missing = NEEDED.filter((k) => CE[k] === undefined);
assert(missing.length === 0, 'every documented helper is exported', missing.length ? `missing: ${missing.join(',')}` : 'none');

console.log('\n2 · presets (§5 of the PRD)');
const LOOK_IDS = ['clean', 'film', 'warm', 'cool', 'mono', 'vintage', 'neon', 'custom'];
assert(Object.keys(CE.LOOKS).length === 8, 'exactly 8 looks', Object.keys(CE.LOOKS).join(','));
assert(LOOK_IDS.every((id) => !!CE.LOOKS[id]), 'the 8 ids match the PRD', LOOK_IDS.join(','));
const PARAMS = ['brightness', 'contrast', 'saturation', 'highlights', 'shadows', 'temperature', 'tint', 'grain', 'vignette'];
let paramGaps = [];
LOOK_IDS.forEach((id) => {
  PARAMS.forEach((p) => { if (typeof CE.LOOKS[id][p] !== 'number') paramGaps.push(`${id}.${p}`); });
});
assert(paramGaps.length === 0, 'every look carries all 9 params', paramGaps.join(',') || 'none');
assert(CE.LOOKS.film.contrast === 15, 'film contrast is 15', String(CE.LOOKS.film.contrast));
assert(CE.LOOKS.mono.saturation === -100, 'mono saturation is -100 (grayscale)', String(CE.LOOKS.mono.saturation));
assert(CE.LOOKS.vintage.grain === 45, 'vintage grain is 45', String(CE.LOOKS.vintage.grain));
assert(CE.LOOKS.neon.temperature === -10, 'neon temperature is -10', String(CE.LOOKS.neon.temperature));
assert(CE.PARAM_KEYS.length === 9, 'PARAM_KEYS lists the 9 sliders', String(CE.PARAM_KEYS.length));

console.log('\n3 · buildFilter');
const clean = CE.buildFilter(CE.effectiveParams('clean', {}, 0));
assert(clean === CE.buildFilter(CE.effectiveParams('clean', {}, 0)), 'deterministic for the same input');
assert(/^brightness\(1\.000\) contrast\(1\.000\) saturate\(1\.000\)/.test(clean), 'clean is identity', clean);
const mono = CE.buildFilter(CE.effectiveParams('mono', {}, 0));
assert(mono.includes('saturate(0.000)'), 'mono collapses saturation to 0', mono);
const warm = CE.buildFilter(CE.effectiveParams('warm', {}, 0));
assert(warm.includes('sepia(') && /hue-rotate\(-\d/.test(warm), 'warm adds sepia + a negative hue-rotate', warm);
const cool = CE.buildFilter(CE.effectiveParams('cool', {}, 0));
assert(cool.includes('hue-rotate(180deg)') && cool.includes('hue-rotate(-180deg)'), 'cool uses the 180-degree dance', cool);
const brightOf = (s) => Number(/brightness\(([\d.]+)\)/.exec(s)[1]);
assert(brightOf(warm) > brightOf(clean), 'warm is brighter than clean', `${brightOf(warm)} > ${brightOf(clean)}`);
assert(CE.buildFilter(CE.LOOKS.warm) === CE.buildFilter(CE.effectiveParams('warm', {}, 0)), 'a raw preset maps brightness→exposure (same filter as the production path)', CE.buildFilter(CE.LOOKS.warm));
assert(/brightness\(1\.050\)/.test(CE.buildFilter({ brightness: 5 })), 'a bare brightness key becomes exposure', CE.buildFilter({ brightness: 5 }).slice(0, 24));
const tinted = CE.buildFilter(Object.assign({}, CE.LOOKS.clean, { tint: 20 }));
assert(/hue-rotate\(\d/.test(tinted) || /hue-rotate\(-/.test(tinted), 'tint nudges hue', tinted);
const extreme = CE.buildFilter({ exposure: 999, contrast: 999, saturation: 999 });
assert(extreme.includes('brightness(3.000)') && extreme.includes('contrast(3.000)') && extreme.includes('saturate(3.000)'), 'extreme inputs clamp at 3', extreme);
const floor = CE.buildFilter({ exposure: -999, contrast: -999, saturation: -999 });
assert(floor.includes('brightness(0.200)') && floor.includes('contrast(0.200)') && floor.includes('saturate(0.000)'), 'extreme negatives clamp at the floor', floor);

console.log('\n4 · effectiveParams');
const filmParams = CE.effectiveParams('film', { exposure: 50 }, 0);
assert(filmParams.exposure === CE.LOOKS.film.brightness, 'custom params are ignored for a non-custom look', String(filmParams.exposure));
const customParams = CE.effectiveParams('custom', { exposure: 12, grain: 40 }, 0);
assert(customParams.exposure === 12 && customParams.grain === 40, 'custom params apply for the custom look');
const biased = CE.effectiveParams('clean', {}, 120);
assert(biased.exposure === 60, 'auto bias folds into exposure and clamps at +60', String(biased.exposure));
const biasedDown = CE.effectiveParams('clean', {}, -900);
assert(biasedDown.exposure === -60, 'auto bias clamps at -60', String(biasedDown.exposure));

console.log('\n5 · autoExposureBias');
const dark = CE.autoExposureBias({ mean: 0.2, low: 0, high: 0 });
assert(dark > 5 && dark <= 25, 'a dark frame gets a positive bias', dark.toFixed(1));
const bright = CE.autoExposureBias({ mean: 0.9, low: 0, high: 0 });
assert(bright < -5 && bright >= -25, 'a bright frame gets a negative bias', bright.toFixed(1));
assert(Math.abs(CE.autoExposureBias({ mean: 0.5, low: 0, high: 0 })) < 0.001, 'a balanced frame gets ~0');
const clipped = CE.autoExposureBias({ mean: 0.8, low: 0, high: 0.10 });
assert(clipped <= CE.autoExposureBias({ mean: 0.8, low: 0, high: 0 }), 'highlight clipping pulls the bias down', clipped.toFixed(1));
const crushed = CE.autoExposureBias({ mean: 0.2, low: 0.10, high: 0 });
assert(crushed >= CE.autoExposureBias({ mean: 0.2, low: 0, high: 0 }), 'shadow crushing lifts the bias', crushed.toFixed(1));
assert(CE.autoExposureBias({ mean: 0, low: 1, high: 0 }) <= 25, 'bias never exceeds +25');
assert(CE.autoExposureBias({ mean: 1, low: 0, high: 1 }) >= -25, 'bias never drops below -25');

console.log('\n6 · estimateShift');
const gw = 16;
const gh = 8;
const prev = new Float32Array(gw * gh);
for (let i = 0; i < prev.length; i++) prev[i] = ((i * 37) % 101) / 101;
const cur = new Float32Array(gw * gh);
for (let y = 0; y < gh; y++) {
  for (let x = 0; x < gw; x++) cur[y * gw + x] = prev[y * gw + (x + 2 < gw ? x + 2 : x)];
}
const shift = CE.estimateShift(prev, cur, gw, gh, 3);
assert(shift.dx === 2 && shift.dy === 0, 'recovers a known positive x shift', JSON.stringify(shift));
const still = CE.estimateShift(prev, prev, gw, gh, 3);
assert(still.dx === 0 && still.dy === 0, 'identical grids report no motion', JSON.stringify(still));
const noArgs = CE.estimateShift(null, null, 0, 0);
assert(noArgs.dx === 0 && noArgs.dy === 0, 'degenerate input reports no motion');

console.log('\n7 · smoothPath');
assert(CE.smoothPath([]).length === 0, 'empty in → empty out');
const spike = CE.smoothPath([0, 0, 0, 20, 0, 0, 0], 0.12);
assert(spike.length === 7, 'output length matches input', String(spike.length));
assert(Math.abs(spike[3] - 2.4) < 0.2, 'a one-frame spike lands at 0.12 × 20', spike[3].toFixed(3));
const flat = CE.smoothPath([5, 5, 5, 5], 0.12);
assert(flat.every((v) => Math.abs(v - 5) < 1e-9), 'a constant path stays constant', flat.join(','));
const ramp = CE.smoothPath([0, 1, 2, 3], 0.12);
assert(ramp.length === 4 && ramp[3] > ramp[0] && ramp[3] < 3, 'a rising path keeps its direction, lagging', `${ramp[0].toFixed(2)}→${ramp[3].toFixed(2)}`);

console.log('\n7b · stabilizerOffset');
assert(CE.stabilizerOffset([], 0.12) === 0, 'empty series → 0');
assert(CE.stabilizerOffset(null) === 0, 'null series → 0');
const juke = CE.stabilizerOffset([0, 1, 0], 0.12);
assert(juke < 0, 'a rightward juke gets a negative (opposing) offset at the last index', juke.toFixed(3));
// The draw offset is raw − smoothed; the content's own displacement is already
// in the frame, so the NET painted excursion is raw − offset. (raw + offset
// would double-count the camera's own movement — the inverted-sign bug.)
const jitter = [0, 1, 0, -1, 0, 1, -1, 0];
const offsets = jitter.map((_, i) => CE.stabilizerOffset(jitter.slice(0, i + 1), 0.12));
const net = jitter.map((v, i) => v - offsets[i]);
const variance = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
};
const varRaw = variance(jitter);
const varNet = variance(net);
assert(varNet * 2 < varRaw, 'the corrected counter-move cuts excursion variance by more than 2×',
  `var(raw) ${varRaw.toFixed(4)} → var(net) ${varNet.toFixed(4)} (${(varRaw / varNet).toFixed(1)}×)`);
assert(offsets.every((v) => Number.isFinite(v)), 'every prefix yields a finite offset', offsets.map((v) => v.toFixed(2)).join(','));

console.log('\n8 · formatRect');
const f916 = CE.formatRect('9:16', 1920, 1080, 1920);
assert(f916.sw === 608 && f916.sh === 1080 && f916.sx === 656 && f916.sy === 0, '9:16 centre-crops the sides', JSON.stringify(f916));
assert(f916.outW === 1080 && f916.outH === 1920, '9:16 output is 1080×1920', `${f916.outW}×${f916.outH}`);
const f169 = CE.formatRect('16:9', 1920, 1080, 1920);
assert(f169.sw === 1920 && f169.sh === 1080 && f169.sx === 0 && f169.sy === 0, '16:9 on a 16:9 source crops nothing');
const f11 = CE.formatRect('1:1', 1920, 1080, 1920);
assert(f11.sw === 1080 && f11.outW === 1920 && f11.outH === 1920, '1:1 squares the long edge', `${f11.outW}×${f11.outH}`);
const f45 = CE.formatRect('4:5', 1920, 1080, 1920);
assert(f45.sw === 864 && f45.sx === 528 && f45.outW === 1536, '4:5 crops and shapes correctly', JSON.stringify(f45));
const f239 = CE.formatRect('2.39:1', 1920, 1080, 1920);
assert(f239.sh === 803 && f239.sy === 139, '2.39:1 letterboxes from the top/bottom', JSON.stringify(f239));
assert(f239.outW % 2 === 0 && f239.outH % 2 === 0, 'output dims are even (encoder-safe)', `${f239.outW}×${f239.outH}`);
const portrait = CE.formatRect('16:9', 1080, 1920, 1920);
assert(portrait.sh === 608 && portrait.sy === 656 && portrait.sw === 1080, 'a portrait source crops top/bottom for 16:9', JSON.stringify(portrait));

console.log('\n9 · outputLongEdge');
assert(CE.outputLongEdge('1080', 3840, 2160) === 1920, '1080p caps a 4K source at 1920');
assert(CE.outputLongEdge('4K', 3840, 2160) === 3840, '4K keeps a 4K source at 3840');
assert(CE.outputLongEdge('4K', 1280, 720) === 1280, 'a smaller source is never upscaled');
assert(CE.outputLongEdge(undefined, 1920, 1080) === 1920, 'unknown quality falls back to the 1080 cap');

console.log('\n10 · overlay alpha caps');
assert(CE.overlayAlpha('off', 100) === 0, 'off is exactly 0');
assert(CE.overlayAlpha('subtle', 100) === 0.18, 'subtle peaks at 0.18', String(CE.overlayAlpha('subtle', 100)));
assert(CE.overlayAlpha('mood', 100) === 0.26, 'mood peaks at 0.26', String(CE.overlayAlpha('mood', 100)));
assert(CE.overlayAlpha('energy', 100) === 0.3, 'energy peaks at 0.3', String(CE.overlayAlpha('energy', 100)));
assert(CE.overlayAlpha('subtle', 50) < CE.overlayAlpha('subtle', 100), 'intensity scales the alpha');
assert(CE.overlayAlpha('subtle', 100) <= 0.3 && CE.overlayAlpha('mood', 100) <= 0.3 && CE.overlayAlpha('energy', 100) <= 0.3, 'no mode ever exceeds 30%');
assert(CE.overlayAlpha('subtle', 500) === 0.18, 'intensity above 100 clamps');
assert(CE.overlayAlpha('subtle', -50) === 0, 'intensity below 0 clamps to 0');

console.log('\n11 · painted-layer scales');
assert(CE.grainAlpha({ grain: 0 }) === 0, 'grain 0 → no grain layer');
assert(CE.grainAlpha({ grain: 100 }) === 0.5, 'grain 100 → 0.5 peak', String(CE.grainAlpha({ grain: 100 })));
assert(CE.grainAlpha({ grain: 25 }) < CE.grainAlpha({ grain: 50 }), 'grain is monotone');
assert(CE.vignetteAlpha({ vignette: 0 }) === 0, 'vignette 0 → no vignette layer');
assert(CE.vignetteAlpha({ vignette: 100 }) === 0.8, 'vignette 100 → 0.8 peak', String(CE.vignetteAlpha({ vignette: 100 })));
assert(CE.vignetteAlpha({ vignette: 50 }) === 0.4, 'vignette scales linearly', String(CE.vignetteAlpha({ vignette: 50 })));

console.log('\n12 · audioFeatures');
assert(CE.audioFeatures(null) === null, 'no audio → null');
const featObj = CE.audioFeatures({ energy: 0.4, bass: 0.5, mid: 0.2, high: 0.1 });
assert(featObj.energy === 0.4 && featObj.bass === 0.5, 'a features object passes through', JSON.stringify(featObj));
assert(CE.audioFeatures({ energy: 5, bass: -3 }).energy === 1 && CE.audioFeatures({ energy: 5, bass: -3 }).bass === 0, 'features are clamped to 0..1');
// A raw AnalyserNode has no energy/bass/mid/high — reading them used to paint NaN.
const fakeAnalyser = (() => {
  const bins = new Uint8Array(128).fill(200);
  return { fftSize: 256, frequencyBinCount: 128, getByteFrequencyData: (a) => a.set(bins) };
})();
const fromAnalyser = CE.audioFeatures(fakeAnalyser);
assert(!!fromAnalyser && Number.isFinite(fromAnalyser.energy) && fromAnalyser.energy > 0.5, 'an AnalyserNode is read into real bands',
  fromAnalyser ? JSON.stringify(fromAnalyser) : 'null');
assert(Object.values(fromAnalyser).every((v) => Number.isFinite(v) && v >= 0 && v <= 1), 'every derived band is a finite 0..1 value');
const dumbObject = CE.audioFeatures({});
assert(dumbObject === null, 'an object with neither bands nor an analyser → null');
const throwing = CE.audioFeatures({ frequencyBinCount: 128, getByteFrequencyData: () => { throw new Error('nope'); } });
assert(throwing === null, 'an analyser that throws on read → null, never NaN');

console.log('\n13 · renderFrame geometry');
// A recording 2D context: renderFrame must sample exactly the rect formatRect
// computed, at exactly its outW/outH.
function makeRecordingCtx() {
  const rec = { draws: [], fills: [], filters: [] };
  const grad = { addColorStop() {} };
  const ctx = {
    _f: 'none',
    canvas: { width: 0, height: 0 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingQuality: '',
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0,
    drawImage(...a) { rec.draws.push(a); },
    fillRect(...a) { rec.fills.push(a); },
    clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillText() {}, strokeText() {},
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => ({}), measureText: () => ({ width: 120 }),
  };
  Object.defineProperty(ctx, 'filter', {
    get() { return this._f; },
    set(v) { this._f = v; rec.filters.push(v); },
  });
  return { ctx, rec };
}
const stageRt = CE.create({ video: { videoWidth: 1920, videoHeight: 1080, paused: true, currentTime: 0 } });
['9:16', '16:9'].forEach((format) => {
  stageRt.setFormat(format);
  const { ctx, rec } = makeRecordingCtx();
  const out = stageRt.renderFrame(ctx, { longEdge: 1920 });
  const r = CE.formatRect(format, 1920, 1080, 1920);
  assert(!!out && out.outW === r.outW && out.outH === r.outH, `${format}: output dims equal formatRect's`,
    out ? `${out.outW}×${out.outH} vs ${r.outW}×${r.outH}` : 'null');
  assert(!!out && out.outW % 2 === 0 && out.outH % 2 === 0, `${format}: dims are even`, out ? `${out.outW}×${out.outH}` : 'null');
  const d = rec.draws[0];
  assert(!!d && d[1] === r.sx && d[2] === r.sy && d[3] === r.sw && d[4] === r.sh, `${format}: drawn source rect equals formatRect's`,
    d ? JSON.stringify(d.slice(1, 5)) : 'no drawImage');
  assert(rec.filters.some((f) => typeof f === 'string' && f.includes('brightness(')), `${format}: a grade filter string was written`);
});

console.log(failures === 0 ? '\nALL CAMERA ENHANCE UNIT CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
