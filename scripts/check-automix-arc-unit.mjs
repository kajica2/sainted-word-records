// scripts/check-automix-arc-unit.mjs — unit coverage for the L3 song arc.
//
// Uses the node:vm trick from check-capture-unit.mjs: evaluate
// client/automix-arc.client.js in a sandbox with a stub SWR_ANCHOR_MAP
// (the real one needs the full PRESETS table — stub with 8 synthetic
// presets spread across the 2D map), then assert the arc contract:
//   1. build() is deterministic (same analysis → same acts)
//   2. acts count within 3..5, boundaries monotonic, t0/t1 cover duration
//   3. movement budget: consecutive act anchors ≥ 0.25 apart (×0.9 slack)
//   4. sampleAt() returns the right act at boundary-ε, monotone progress
//   5. movement budget REJECTS pathological maps (all anchors identical)
//   6. flux snapping: a quiet gap in the onset flux pulls the boundary
//   7. short tracks (<45s) skip snapping
//   8. null contract: missing map / zero duration

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'automix-arc.client.js'), 'utf8');

// 8 synthetic anchors spread across the map with distinct fx baselines.
function makeMap(spread = true) {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const anchors = {};
  ids.forEach((id, i) => {
    const w = spread ? i / (ids.length - 1) : 0.5;
    const it = spread ? (i % 2 === 0 ? 0.2 : 0.8) : 0.5;
    anchors[id] = {
      warmth: w, intensity: it,
      preset: {
        temp: w * 0.6 - 0.3, mut: it, posterize: it * 0.5, chroma: w * 0.8,
        grain: it * 0.7, sepia: w * 0.9, glow: 1 - it, grayscale: it * 0.3,
        mutAlgo: i % 5,
      },
    };
  });
  return {
    list: () => ids,
    get: (id) => anchors[id] || null,
    neighbours: (coords, n) => {
      n = n || 4;
      return ids
        .map((id) => {
          const a = anchors[id];
          const dx = a.warmth - coords.warmth;
          const dy = a.intensity - coords.intensity;
          return { id, dist: Math.sqrt(dx * dx + dy * dy), anchor: a };
        })
        .sort((x, y) => x.dist - y.dist)
        .slice(0, n);
    },
  };
}

function loadArc(stubMap) {
  const sandbox = {
    window: { SWR_ANCHOR_MAP: stubMap },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.SWR_AUTOMIX_ARC;
}

// Synthetic song: 240s, 120 BPM → onsets every 0.5s, with a quiet valley
// at t=96..120 (flux 0) so boundary snapping has something to find.
function makeAnalysis() {
  const onsets = [];
  for (let t = 0.25; t < 240; t += 0.5) {
    if (t >= 96 && t < 120) continue; // breakdown valley
    onsets.push(t);
  }
  return { duration: 240, bpm: 120, onsets, key: 'A' };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const ARC = loadArc(makeMap());

check('1. build() is deterministic', () => {
  const a = ARC.build(makeAnalysis());
  const b = ARC.build(makeAnalysis());
  assert(JSON.stringify(a) === JSON.stringify(b), 'two builds differ');
});

check('2. acts 3..5, boundaries monotonic, full coverage', () => {
  const arc = ARC.build(makeAnalysis());
  assert(arc.acts.length >= 3 && arc.acts.length <= 5, `acts=${arc.acts.length}`);
  assert(arc.acts[0].t0 === 0, 'first act starts at 0');
  assert(arc.acts[arc.acts.length - 1].t1 === 240, 'last act ends at duration');
  for (let i = 1; i < arc.acts.length; i++) {
    assert(arc.acts[i].t0 >= arc.acts[i - 1].t1 - 0.001, `boundary ${i} not monotonic`);
  }
});

check('3. movement budget: consecutive acts ≥ 0.25 apart', () => {
  const arc = ARC.build(makeAnalysis());
  for (let i = 1; i < arc.acts.length; i++) {
    const dx = arc.acts[i].coords.warmth - arc.acts[i - 1].coords.warmth;
    const dy = arc.acts[i].coords.intensity - arc.acts[i - 1].coords.intensity;
    const d = Math.sqrt(dx * dx + dy * dy);
    assert(d >= ARC.ARC_MIN_DISPLACEMENT * 0.9, `act ${i - 1}→${i} displacement ${d.toFixed(3)} < 0.225`);
  }
});

check('4. sampleAt(): right act at boundary-ε, monotone progress', () => {
  const arc = ARC.build(makeAnalysis());
  const first = arc.acts[0], second = arc.acts[1];
  const s1 = ARC.sampleAt(arc, first.t1 - 0.5);
  const s2 = ARC.sampleAt(arc, second.t0 + 0.5);
  assert(s1.actIndex === 0 && s2.actIndex === 1, `indices ${s1.actIndex}/${s2.actIndex}`);
  assert(s1.actProgress > 0.9, `progress before boundary ${s1.actProgress}`);
  assert(s2.actProgress < 0.1, `progress after boundary ${s2.actProgress}`);
  const sEnd = ARC.sampleAt(arc, 99999);
  assert(sEnd.actIndex === arc.acts.length - 1, 'past-end clamps to last act');
  // Mid-act monotonicity
  const mid = ARC.sampleAt(arc, (first.t0 + first.t1) / 2);
  assert(mid.actIndex === 0 && mid.actProgress > 0.4 && mid.actProgress < 0.6, 'mid-act progress ~0.5');
});

check('5. degenerate map (all anchors identical) → build returns null', () => {
  const ARC2 = loadArc(makeMap(false));
  const arc = ARC2.build(makeAnalysis());
  assert(arc === null, 'expected null for zero-spread map, got acts=' + (arc && arc.acts.length));
});

check('6. flux valley pulls the boundary', () => {
  const arc = ARC.build(makeAnalysis());
  // The 96..120s valley should attract a boundary near 96 or 120.
  const near = arc.acts.some(a =>
    (a.t0 > 80 && a.t0 < 136) || (a.t1 > 80 && a.t1 < 136));
  assert(near, `no boundary in 80..136: ${arc.acts.map(a => a.t0.toFixed(0)).join(',')}`);
});

check('7. short track (<45s) skips snapping, still builds', () => {
  const onsets = [];
  for (let t = 0.25; t < 40; t += 0.5) onsets.push(t);
  const arc = ARC.build({ duration: 40, bpm: 120, onsets, key: 'C' });
  assert(arc && arc.acts.length >= 3, 'short track built ' + (arc && arc.acts.length));
});

check('8. null contract: zero duration / empty onsets', () => {
  assert(ARC.build({ duration: 0, bpm: 120, onsets: [] }) === null, 'zero duration');
  const arc = ARC.build({ duration: 100, bpm: 0, onsets: [] });
  // No onsets = flat flux; arc may still build (boundaries = fifths).
  if (arc) assert(arc.acts.length >= 3, 'flat-song arc acts=' + arc.acts.length);
});

check('9. no anchor map → null (realtime-only fallback contract)', () => {
  const ARC3 = loadArc(null);
  assert(ARC3.build(makeAnalysis()) === null, 'expected null without map');
});

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL ARC CHECKS PASS');
process.exit(failures ? 1 : 0);
