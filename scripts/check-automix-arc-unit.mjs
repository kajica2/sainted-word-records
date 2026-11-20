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

// 10. Collapsed-act regression: boundaries are snapped independently inside
//     overlapping ±12%-of-duration windows, so adjacent picks can land on top
//     of each other. This real case (dur=211s, bpm=194, two quiet bands) left
//     act 2 with a 0.2s span — invisible and effectively unreachable. The
//     bounds are now sorted and enforced to a minimum span.
check('10. snapped boundaries cannot collapse an act to a near-zero span', () => {
  const dur = 211, bpm = 194;
  const bands = [[188.60262021264182, 202.91737661274027], [60.58712103803974, 63.289214163687646]];
  const period = 60 / bpm / 2;
  const onsets = [];
  for (let t = 0.1; t < dur; t += period) {
    if (bands.some(([s, e]) => t >= s && t < e)) continue;
    onsets.push(t);
  }
  const arc = ARC.build({ duration: dur, bpm, onsets, key: 'A' });
  assert(arc && arc.acts.length === 5, 'expected 5 acts, got ' + (arc && arc.acts.length));
  const minSpan = dur / (arc.acts.length * 4);
  for (const a of arc.acts) {
    assert(a.t1 - a.t0 >= minSpan - 1e-6,
      `act span ${(a.t1 - a.t0).toFixed(3)}s < minSpan ${minSpan.toFixed(3)}s`);
  }
  for (let i = 1; i < arc.acts.length; i++) {
    assert(arc.acts[i].t0 > arc.acts[i - 1].t0, `bound ${i} not strictly increasing`);
  }
  assert(arc.acts[arc.acts.length - 1].t1 === dur, 'last act must end at duration');
});

// ---- Act family map + the single fire site --------------------------------
// The arc fires ONE transition per act boundary, from tick() →
// fireActTransition(). The transition it picks argues for a FAMILY (the
// catalog's own `family` tag), and the pick is filtered by the motion
// kill-switch, so a blocked transition can never be the one that fires.
//
// The catalog below mirrors engine-transitions.client.js's real families.
// A name that is NOT in the catalog must be skipped, never rejected —
// firing an unknown name makes SWRTransitions.fire() return a rejected
// promise, and a rejected promise in the tick path is a broken tick.
const TX_CATALOG = {
  'fade-to-black': { kind: 'css', family: 'fade' },
  'pure-crossfade': { kind: 'css', family: 'fade' },
  'warp-dissolve': { kind: 'css', family: 'hybrid' },
  'linear-wipe-lr': { kind: 'css', family: 'wipe' },
  'glitch-burst': { kind: 'fx', family: 'distortion' },
  'chromatic-split': { kind: 'css', family: 'distortion' },
  'glow-burst': { kind: 'fx', family: 'brightness' },
};

function loadArcWithTx(stubMap, opts) {
  opts = opts || {};
  const fired = [];
  const win = {
    SWR_ANCHOR_MAP: stubMap,
    SWRTransitions: {
      _TRANSITIONS: opts.catalog || TX_CATALOG,
      fire(name, o) { fired.push({ name, opts: o || {} }); return Promise.resolve(); },
    },
  };
  if (opts.motionKill) win.SWR_MOTION_KILL = opts.motionKill;
  const sandbox = { window: win, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'automix-arc.client.js' });
  return { ARC: win.SWR_AUTOMIX_ARC, fired, win };
}

// A hand-built three-act arc with names, so the family map is exercised
// without depending on build()'s deterministic act order.
function namedArc(names, coords) {
  const acts = names.map((name, i) => ({
    t0: i * 10,
    t1: (i + 1) * 10,
    name,
    anchorId: 'a' + i,
    coords: (coords && coords[i]) || { warmth: 0.5, intensity: 0.5 },
    preset: { temp: 0, mut: 0 },
    rampMs: 1000,
  }));
  return { duration: 30, acts };
}

check('11. ACT_FAMILY maps every act name to a catalog family', () => {
  const { ARC } = loadArcWithTx(makeMap());
  const F = ARC._internals.ACT_FAMILY;
  assert(F && typeof F === 'object', 'ACT_FAMILY is published on _internals');
  for (const name of ['intro', 'lift', 'peak', 'breakdown', 'outro']) {
    assert(typeof F[name] === 'string' && F[name], `ACT_FAMILY has ${name}`);
  }
  // Every family the map names must exist in the real catalog, or the
  // picker resolves to an empty pool and the act falls back silently.
  for (const name of Object.keys(F)) {
    const fam = F[name];
    const inCatalog = Object.keys(TX_CATALOG).some((n) => TX_CATALOG[n].family === fam);
    assert(inCatalog, `family '${fam}' (act ${name}) exists in the catalog`);
  }
});

check('12. one act boundary fires exactly ONE transition, tagged _src', () => {
  const { ARC, fired } = loadArcWithTx(makeMap());
  const arc = namedArc(['intro', 'peak', 'outro']);
  ARC.tick(arc, 1);   // arms tracking, no boundary
  ARC.tick(arc, 2);   // still act 0
  assert(fired.length === 0, 'no transition before a boundary', fired.length);
  ARC.tick(arc, 12);  // crosses act 0 → act 1
  assert(fired.length === 1, 'exactly one transition per act boundary', fired.length);
  assert(fired[0].opts && fired[0].opts._src === 'automix-arc',
    'the fire is tagged _src:automix-arc', JSON.stringify(fired[0].opts));
  ARC.tick(arc, 13);  // still act 1
  assert(fired.length === 1, 'no second transition inside the same act', fired.length);
  ARC.tick(arc, 22);  // crosses act 1 → act 2
  assert(fired.length === 2, 'the next boundary fires again', fired.length);
});

check('13. the transition picked for an act belongs to that act\'s family', () => {
  const { ARC, fired } = loadArcWithTx(makeMap());
  const arc = namedArc(['intro', 'peak', 'outro']);
  const F = ARC._internals.ACT_FAMILY;
  ARC.tick(arc, 1);
  ARC.tick(arc, 12); // enters the 'peak' act
  assert(fired.length === 1, 'one transition fired', fired.length);
  const entry = TX_CATALOG[fired[0].name];
  assert(!!entry, 'the fired name is in the catalog', fired[0].name);
  assert(entry.family === F.peak,
    `a peak act fires the ${F.peak} family (got ${entry.family})`, fired[0].name);
});

check('14. a name missing from the catalog is skipped, never fired', () => {
  // The catalog holds only fade-family entries, so neither the peak family
  // nor the subtle/dynamic fallback names resolve. The arc must skip the
  // fire and must not throw — an unknown name makes fire() reject.
  const { ARC, fired } = loadArcWithTx(makeMap(), {
    catalog: { 'fade-to-black': { kind: 'css', family: 'fade' } },
  });
  const arc = namedArc(['intro', 'peak', 'outro']);
  ARC.tick(arc, 1);
  ARC.tick(arc, 12);
  assert(fired.length === 0, 'an unknown transition name is never fired', fired.length);
});

check('15. the motion kill-switch filters the family pool', () => {
  // The kill-switch says only 'fade-to-black' may fire. The peak act's
  // family pool must be filtered down to it — a blocked transition that
  // fires anyway is a visible motion the user switched off.
  const { ARC, fired } = loadArcWithTx(makeMap(), {
    motionKill: {
      // Mirrors lib/motion-kill-switch.client.js's real contract: it takes a
      // pool and returns ONE allowed name (a string), not a filtered pool.
      pickAllowedTransition(pool) {
        const allowed = (pool || []).filter((n) => n === 'fade-to-black');
        return allowed.length ? allowed[0] : 'fade-to-black';
      },
    },
  });
  const arc = namedArc(['intro', 'peak', 'outro']);
  ARC.tick(arc, 1);
  ARC.tick(arc, 12);
  assert(fired.length === 1, 'the transition still fires', fired.length);
  assert(fired[0].name === 'fade-to-black',
    'the kill-switch decides which name survives', fired[0].name);
});

// ---- Phase 4: act-aware shaping of the within-act glide -----------------
//
// The glide from one act's baseline to the next is not one curve for the
// whole song. Each act archetype gets its own shape: an intro eases in,
// a peak holds then releases, a breakdown releases early. The shape is a
// PURE function of (actName, progress) so the arc unit can pin it and the
// runtime can call it in one line.

check('16. shapeActProgress exists and maps [0,1] onto [0,1]', () => {
  const ARC2 = loadArc(makeMap());
  assert(typeof ARC2.shapeActProgress === 'function', 'shapeActProgress is not exposed');
  for (const act of ['intro', 'lift', 'peak', 'breakdown', 'outro']) {
    assert(Math.abs(ARC2.shapeActProgress(act, 0)) < 1e-9,
      `${act} must start at 0, got ${ARC2.shapeActProgress(act, 0)}`);
    assert(Math.abs(ARC2.shapeActProgress(act, 1) - 1) < 1e-9,
      `${act} must end at 1, got ${ARC2.shapeActProgress(act, 1)}`);
  }
});

check('17. shapeActProgress is monotonic within an act', () => {
  const ARC2 = loadArc(makeMap());
  for (const act of ['intro', 'lift', 'peak', 'breakdown', 'outro']) {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = ARC2.shapeActProgress(act, p);
      assert(v >= prev - 1e-9, `${act} went backwards at p=${p.toFixed(2)} (${v} < ${prev})`);
      prev = v;
    }
  }
});

check('18. each act has its own shape (the curve is act-aware)', () => {
  const ARC2 = loadArc(makeMap());
  const at = (act) => ARC2.shapeActProgress(act, 0.5);
  const shapes = new Set(['intro', 'lift', 'peak', 'breakdown', 'outro'].map(at));
  assert(shapes.size >= 3,
    `expected distinct shapes per act, got ${shapes.size} distinct midpoints`);
});

check('19. a peak holds its baseline then releases late', () => {
  const ARC2 = loadArc(makeMap());
  // A peak is the act that should STAY at its own baseline for most of
  // its span and then move — the release is late, not even.
  const early = ARC2.shapeActProgress('peak', 0.25);
  const late = ARC2.shapeActProgress('peak', 0.9);
  assert(early < 0.25, `a peak must still hold at 25%, got ${early}`);
  assert(late > 0.75, `a peak must have released by 90%, got ${late}`);
});

check('20. an unknown act falls back to the linear progress', () => {
  const ARC2 = loadArc(makeMap());
  assert(Math.abs(ARC2.shapeActProgress('not-an-act', 0.4) - 0.4) < 1e-9,
    'an unknown act must be linear');
  assert(Math.abs(ARC2.shapeActProgress(null, 0.4) - 0.4) < 1e-9,
    'no act must be linear');
});

check('21. shapeActProgress clamps out-of-range progress', () => {
  const ARC2 = loadArc(makeMap());
  assert(ARC2.shapeActProgress('peak', -1) === 0, 'negative progress clamps to 0');
  assert(ARC2.shapeActProgress('peak', 2) === 1, 'progress above 1 clamps to 1');
});

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL ARC CHECKS PASS');
process.exit(failures ? 1 : 0);
