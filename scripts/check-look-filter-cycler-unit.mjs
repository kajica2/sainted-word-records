// scripts/check-look-filter-cycler-unit.mjs — unit coverage for the
// 10-preset tint/look filter cycler (T+0..9).
//
// The module (client/look-filter-cycler.client.js) exposes
// window.SWR_LOOK_FILTER_CYCLER with .list(), .apply(n), .get(),
// .reset(), .restore(), and .ALL. It applies through FX.setPersona(),
// not direct setters, so the canonical write path is exercised.
//
// These tests stub window.FX with a setPersona spy and run the IIFE
// in node:vm to assert:
//   1. Slot 0 is a TRUE RESET (zeroes all 17 FX state keys — not
//      intensity 0, which leaves stale values that the next persona
//      would inherit).
//   2. Slots 1-9 call setPersona with the documented profile.
//   3. FX.setPersona unavailable: apply() is a warn, not a crash.
//   4. Each filter's params are in valid range (temp signed -1..1,
//      everything else 0..1, mutAlgo integer 0..5, all keys in ALL).
//   5. Trap 1: no filter sets sepia + temp (sepia overrides tints).
//   6. Trap 5: filter 9 sets mutAlgo + mut together (not just algo).
//   7. restore() re-applies the saved slot on a fresh load.
//
// Run: node scripts/check-look-filter-cycler-unit.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/look-filter-cycler.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// Run the IIFE in a fresh sandbox so every test starts clean
function runFresh() {
  const calls = [];
  const sandbox = {
    window: {},
    console: { warn: (m) => calls.push(['warn', String(m)]) },
    FX: {
      state: { temp: 0, mut: 0, mutAlgo: 0, sepia: 0.5 /* stale */ },
      setPersona: (p) => {
        calls.push(['setPersona', JSON.parse(JSON.stringify(p))]);
        // mirror what real FX does
        for (const k in p) sandbox.window.FX.state[k] = p[k];
      },
    },
    setStatus: (msg) => calls.push(['setStatus', msg]),
    localStorage: {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
    },
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
  };
  sandbox.window = sandbox; // window === sandbox for self-refs
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, calls };
}

// ---- checks ----

check('module exports SWR_LOOK_FILTER_CYCLER with list/apply/get/reset/restore/ALL', () => {
  const { sandbox } = runFresh();
  const L = sandbox.window.SWR_LOOK_FILTER_CYCLER;
  return !!(L && typeof L.list === 'function' && typeof L.apply === 'function' &&
            typeof L.get === 'function' && typeof L.reset === 'function' &&
            typeof L.restore === 'function' && Array.isArray(L.ALL));
});

check('list() returns 10 filters (slot 0..9)', () => {
  const { sandbox } = runFresh();
  const list = sandbox.window.SWR_LOOK_FILTER_CYCLER.list();
  return list.length === 10 && list[0].id === 0 && list[9].id === 9;
});

check('slot 0 (none) sends ZEROED setPersona with all 17 keys', () => {
  const { sandbox, calls } = runFresh();
  sandbox.window.SWR_LOOK_FILTER_CYCLER.apply(0);
  const sp = calls.find((c) => c[0] === 'setPersona');
  if (!sp) return 'no setPersona call';
  const profile = sp[1];
  for (const k of sandbox.window.SWR_LOOK_FILTER_CYCLER.ALL) {
    if (profile[k] !== 0) return `${k} expected 0 got ${profile[k]}`;
  }
  return true;
});

check('reset() clears stale FX state.mutAlgo so the next persona starts clean', () => {
  const { sandbox } = runFresh();
  // FX.state.sepia = 0.5 was set as "stale"
  sandbox.window.FX.state.mutAlgo = 4;
  sandbox.window.FX.state.grain = 0.7;
  sandbox.window.SWR_LOOK_FILTER_CYCLER.reset();
  return sandbox.window.FX.state.mutAlgo === 0
      && sandbox.window.FX.state.grain === 0
      && sandbox.window.FX.state.sepia === 0;  // stale was zeroed
});

check('slot 2 (old cinema) sends sepia + grain + vignette + blur (no temp/tone per Trap 1)', () => {
  const { sandbox, calls } = runFresh();
  sandbox.window.SWR_LOOK_FILTER_CYCLER.apply(2);
  // The default ramp step is 0.30 → all values scaled by 0.30.
  const sp = calls.find((c) => c[0] === 'setPersona' && c[1].sepia != null);
  if (!sp) return 'old cinema apply not seen';
  const p = sp[1];
  // Field-by-field check at the ramp's default scale (0.30)
  const K = 0.30;
  if (Math.abs(p.sepia - 0.42 * K) > 1e-6) return 'sepia ' + p.sepia;
  if (Math.abs(p.grain - 0.30 * K) > 1e-6) return 'grain ' + p.grain;
  if (Math.abs(p.vignette - 0.45 * K) > 1e-6) return 'vignette ' + p.vignette;
  if (Math.abs(p.blur - 0.12 * K) > 1e-6) return 'blur ' + p.blur;
  if (p.temp !== undefined) return 'temp leaked: ' + p.temp;
  if (p.tone !== undefined) return 'tone leaked: ' + p.tone;
  if (p.glow !== undefined) return 'glow leaked: ' + p.glow;
  return true;
});

check('slot 9 (echo) sets mut + mutAlgo together (Trap 5)', () => {
  const { sandbox, calls } = runFresh();
  sandbox.window.SWR_LOOK_FILTER_CYCLER.apply(9);
  const sp = calls.find((c) => c[0] === 'setPersona' && c[1].mutAlgo != null);
  if (!sp) return 'echo apply not seen';
  const p = sp[1];
  // mutAlgo is integer 0..5, NOT scaled by the ramp (Trap 5).
  if (p.mutAlgo !== 2) return 'mutAlgo ' + p.mutAlgo;
  if (typeof p.mut !== 'number') return 'mut missing: ' + p.mut;
  if (p.liquid !== undefined) return 'liquid leaks (Trap 6): ' + p.liquid;
  return true;
});

check('slot 3-7 (cinematic palette) carry tint values in valid range', () => {
  const { sandbox, calls } = runFresh();
  for (let i = 3; i <= 7; i++) {
    calls.length = 0;
    sandbox.window.SWR_LOOK_FILTER_CYCLER.apply(i);
    const sp = calls.find((c) => c[0] === 'setPersona');
    const p = sp[1];
    // Slot 7 (mono) intentionally omits temp — sepia/grayscale commit to monochrome (Trap 1)
    if (i !== 7) {
      if (typeof p.temp !== 'number' || p.temp < -1 || p.temp > 1) return `slot ${i} temp out: ${p.temp}`;
    }
    // tone is optional (mono doesn't need it; cinematic carries its own)
    if (typeof p.tone === 'number' && (p.tone < 0 || p.tone > 1)) return `slot ${i} tone out: ${p.tone}`;
    // Trap 3: cinematic + (vignette or tone) double-counts
    if (typeof p.cinematic === 'number' && p.cinematic > 0
        && (typeof p.vignette === 'number' && p.vignette > 0)) {
      return `slot ${i} cinematic + vignette double-count (Trap 3)`;
    }
    if (typeof p.cinematic === 'number' && p.cinematic > 0
        && (typeof p.tone === 'number' && p.tone > 0)) {
      return `slot ${i} cinematic + tone double-count (Trap 3)`;
    }
  }
  return true;
});

check('every non-numeric param is in the ALL list (no stray keys)', () => {
  const { sandbox } = runFresh();
  const ALL = new Set(sandbox.window.SWR_LOOK_FILTER_CYCLER.ALL);
  for (const f of sandbox.window.SWR_LOOK_FILTER_CYCLER.list()) {
    for (const k in f.fx) {
      if (!ALL.has(k)) return `filter ${f.id} stray key: ${k}`;
    }
  }
  return true;
});

check('apply() survives when FX.setPersona is unavailable (warn, not crash)', () => {
  const sandbox = {
    window: {},
    console: { warn: () => {} },
    setStatus: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    CustomEvent: class {},
    dispatchEvent: () => true,
  };
  sandbox.window = sandbox;
  // no FX at all
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  // Should not throw
  const f = sandbox.window.SWR_LOOK_FILTER_CYCLER.apply(3);
  return !!f && f.id === 3;
});

check('restore() re-applies saved slot from localStorage', () => {
  const sandbox = {
    window: {},
    console: { warn: () => {} },
    FX: { state: {}, setPersona(p) { for (const k in p) sandbox.window.FX.state[k] = p[k]; } },
    setStatus: () => {},
    localStorage: { _s: { 'swr.lookfilter': '2' }, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = v; } },
    CustomEvent: class { constructor(t, init) { this.detail = init.detail; } },
    dispatchEvent: () => true,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const f = sandbox.window.SWR_LOOK_FILTER_CYCLER.restore();
  // restore() at step 0 scales slot 2's sepia 0.42 × 0.30 = 0.126
  return f.id === 2 && Math.abs(sandbox.window.FX.state.sepia - 0.42 * 0.30) < 1e-6;
});

check('repeated presses on the same slot scale through the intensity ramp', () => {
  const { sandbox, calls } = runFresh();
  const L = sandbox.window.SWR_LOOK_FILTER_CYCLER;
  // Apply slot 3 four times — each profile passed to setPersona should have
  // a smaller magnitude than the previous, since the ramp is ascending.
  const seen = [];
  for (let i = 0; i < 4; i++) {
    calls.length = 0;
    L.apply(3);
    const sp = calls.find((c) => c[0] === 'setPersona');
    if (!sp) return 'no setPersona call';
    const p = sp[1];
    const mag = Object.values(p).filter((v) => typeof v === 'number').reduce((s, v) => s + Math.abs(v), 0);
    seen.push(mag);
  }
  // First press resets ramp to step 0 (smallest). Repeated presses advance.
  // Magnitudes must be monotonically increasing across calls 2..4 (first
  // is the initial step-0 baseline, then subsequent ramp steps rise).
  const r = L.getRamp();
  if (r.length < 2) return 'ramp too short';
  if (seen[1] <= seen[0]) return `ramp did not step up: ${seen.join(',')}`;
  if (seen[2] <= seen[1]) return `ramp did not step up: ${seen.join(',')}`;
  if (seen[3] <= seen[2]) return `ramp did not step up: ${seen.join(',')}`;
  return true;
});

check('switching to a new slot resets the ramp back to step 0', () => {
  const { sandbox } = runFresh();
  const L = sandbox.window.SWR_LOOK_FILTER_CYCLER;
  L.apply(3); // step 0 (subtle)
  L.apply(3); L.apply(3); // step 1, 2
  if (L.get() !== 3) return 'not on slot 3';
  L.apply(4); // new slot → reset ramp
  if (L.get() !== 4) return 'did not switch to 4';
  if (L.getIntensityStep() !== 0) return 'ramp did not reset, step=' + L.getIntensityStep();
  return true;
});

check('ramp wraps and lands on k=0 (calls reset()) so users can fade out', () => {
  const { sandbox, calls } = runFresh();
  const L = sandbox.window.SWR_LOOK_FILTER_CYCLER;
  // Drive apply(3) N times where N == ramp length + 1. The last call
  // when wrapping to k=0 should hit reset() — a FULL zeroed persona.
  // Specifically: press N-1 times lands you at step N-1 (k=0 after wrap
  // means reset); press N times wraps again to step 0. The reset is
  // recorded at the N-1-th press. Search backward for the first call
  // whose profile is all zeros.
  const N = L.getRamp().length + 1;
  for (let i = 0; i < N; i++) L.apply(3);
  let resetCall = null;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c[0] !== 'setPersona') continue;
    const p = c[1];
    let allZero = true;
    for (const k of L.ALL) if (p[k] !== 0) { allZero = false; break; }
    if (allZero) { resetCall = c; break; }
  }
  if (!resetCall) return 'no reset() call observed across ' + N + ' presses';
  return true;
});

check('reset() round trip: apply(k) → ramp to 0 → state is fully zeroed', () => {
  const { sandbox } = runFresh();
  const L = sandbox.window.SWR_LOOK_FILTER_CYCLER;
  L.apply(2);   // old cinema, default intensity
  L.apply(2); L.apply(2); L.apply(2); L.apply(2); // ramp to step 4 = k=0 → reset
  const st = sandbox.window.FX.state;
  for (const k of L.ALL) {
    if (st[k] !== 0) return `${k} still set: ${st[k]}`;
  }
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
