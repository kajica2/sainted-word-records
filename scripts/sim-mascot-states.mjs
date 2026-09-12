// scripts/sim-mascot-states.mjs
// Headless simulation of swr-mascot-camera.client.js state machine against
// synthetic frame streams. Proves each branch of the state hierarchy
// fires on the right input pattern WITHOUT requiring a browser.
//
// Run: node scripts/sim-mascot-states.mjs

const SAMPLE_W = 160, SAMPLE_H = 90;

// --- Synthetic frame generators (luma-only, W*H arrays) ---------------
function emptyFrame() {
  return new Uint8ClampedArray(SAMPLE_W * SAMPLE_H);
}
function uniformFrame(luma) {
  const f = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H);
  f.fill(luma);
  return f;
}
function faceInFrame(cx, cy, radius = 25, luma = 220) {
  const f = uniformFrame(30);
  for (let y = 0; y < SAMPLE_H; y++) {
    for (let x = 0; x < SAMPLE_W; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < radius * radius) f[y * SAMPLE_W + x] = luma;
    }
  }
  return f;
}

// --- Mascot state machine (mirror of swr-mascot-camera.client.js) ----
class Sim {
  constructor() {
    this._motion = 0; this._depth = 0;
    this._motionPeak = 0;
    this._motionScaleHistory = [];
    this._centroid = { x: 0.5, y: 0.5 };
    this._stateHistory = []; this._currentState = null;
    this._hasBeenActive = false;
  }
  static diff(cur, prev) {
    let motionSum = 0, weightedX = 0, weightedY = 0, weightSum = 0;
    const w = SAMPLE_W, h = SAMPLE_H;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const d = Math.abs(cur[idx] - prev[idx]);
        if (d > 12) {
          motionSum += d;
          weightedX += x * d;
          weightedY += y * d;
          weightSum += d;
        }
      }
    }
    const motionRaw = weightSum > 0 ? motionSum / (w * h * 255) : 0;
    return { motionScale: Math.min(1, motionRaw * 40), weightedX, weightedY, weightSum };
  }
  tick(cur, prev) {
    const { motionScale, weightedX, weightedY, weightSum } = Sim.diff(cur, prev);
    this._motion = this._motion * 0.5 + motionScale * 0.5;
    this._motionScaleHistory.push(motionScale);
    if (this._motionScaleHistory.length > 3) this._motionScaleHistory.shift();
    this._motionPeak = this._motionScaleHistory.reduce((m, v) => Math.max(m, v), 0);
    this._depth = this._depth * 0.97 + motionScale * 0.03;
    if (motionScale > 0.1 || this._motion > 0.15) this._hasBeenActive = true;
    if (weightSum > 0) {
      this._centroid.x = weightedX / weightSum / SAMPLE_W;
      this._centroid.y = weightedY / weightSum / SAMPLE_H;
    }
    let next;
    if (this._depth > 0.30 && this._motion > 0.10) next = 'lean-in';
    else if (this._motionPeak > 0.40) next = 'wave';
    else if (this._centroid.y < 0.36) next = 'look-up';
    else if (this._hasBeenActive && this._depth < 0.08 && this._motion < 0.05) next = 'back-away';
    else next = 'idle';
    this._stateHistory.push(next);
    if (this._stateHistory.length > 3) this._stateHistory.shift();
    const counts = {};
    for (const s of this._stateHistory) counts[s] = (counts[s] || 0) + 1;
    let winner = next, max = 0;
    for (const [s, n] of Object.entries(counts)) {
      if (n > max) { max = n; winner = s; }
    }
    if (winner !== this._currentState) {
      const from = this._currentState;
      this._currentState = winner;
      return { transition: true, from, to: winner, motion: this._motion, depth: this._depth, cy: this._centroid.y };
    }
    return { transition: false, state: this._currentState, motion: this._motion, depth: this._depth, cy: this._centroid.y };
  }
}

// --- Scenarios + assertions ------------------------------------------
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// 1. Idle baseline — never transitions out of idle (the initial null → idle
//    on frame 0 is expected and doesn't count as a "real" transition).
console.log('\n=== idle baseline ===');
{
  const sim = new Sim();
  let prev = emptyFrame();
  let realTransitions = 0;
  // Skip frame 0 — the null → idle first-frame transition is expected.
  sim.tick(emptyFrame(), prev); prev = emptyFrame();
  for (let i = 1; i < 20; i++) {
    const r = sim.tick(emptyFrame(), prev);
    if (r.transition && r.from !== null) realTransitions++;
    prev = emptyFrame();
  }
  check('stays idle (no real transitions)', realTransitions === 0,
    `realTransitions=${realTransitions}, final=${sim._currentState}`);
}

// 2. Wave burst — the mascot should react to a face appearing by waving.
//    In real use, the first frame after camera activation shows a huge motion
//    spike (camera initializes → face appears → big diff). The mascot
//    responds with wave. We assert that wave fires at any point during
//    active camera input.
console.log('\n=== wave on face appearance ===');
{
  const sim = new Sim();
  let prev = uniformFrame(30); // empty scene
  let sawWave = false;
  let sawAnyNonIdle = false;
  // Feed 12 frames of a stable face — first frame is the burst
  for (let i = 0; i < 12; i++) {
    const f = faceInFrame(80, 45);
    const r = sim.tick(f, prev);
    if (r.transition && r.to === 'wave') sawWave = true;
    if (r.transition && r.to !== 'idle' && r.from !== null) sawAnyNonIdle = true;
    prev = f;
  }
  check('reaches wave on face appearance', sawWave,
    `sawWave=${sawWave}, final=${sim._currentState}, sawAnyNonIdle=${sawAnyNonIdle}`);
}

// 3. Lean-in — sustained motion
console.log('\n=== lean-in sustained ===');
{
  const sim = new Sim();
  let prev = uniformFrame(30);
  for (let i = 0; i < 40; i++) {
    const cur = faceInFrame(i % 2 === 0 ? 40 : 120, 45);
    const r = sim.tick(cur, prev);
    prev = cur;
  }
  check('reaches lean-in via depth', sim._currentState === 'lean-in',
    `final=${sim._currentState}, motion=${sim._motion.toFixed(3)}, depth=${sim._depth.toFixed(3)}`);
}

// 4. Look-up — face in upper region
console.log('\n=== look-up ===');
{
  const sim = new Sim();
  let prev = uniformFrame(30);
  const f = faceInFrame(80, 15);
  let sawLookUp = false;
  for (let i = 0; i < 12; i++) {
    const r = sim.tick(f, prev);
    if (r.transition && r.to === 'look-up') sawLookUp = true;
    prev = f;
  }
  check('reaches look-up', sawLookUp, `final=${sim._currentState}, cy=${sim._centroid.y.toFixed(2)}`);
}

// 5. Back-away — quiet after warmup
console.log('\n=== back-away after warmup ===');
{
  const sim = new Sim();
  let prev = uniformFrame(30);
  for (let i = 0; i < 10; i++) {
    const cur = faceInFrame(40 + (i % 2) * 80, 45);
    sim.tick(cur, prev); prev = cur;
  }
  const quiet = uniformFrame(30);
  let sawBackAway = false;
  for (let i = 0; i < 80; i++) {
    const r = sim.tick(quiet, prev);
    if (r.transition && r.to === 'back-away') sawBackAway = true;
    prev = quiet;
  }
  check('reaches back-away', sawBackAway, `final=${sim._currentState}, motion=${sim._motion.toFixed(3)}, depth=${sim._depth.toFixed(3)}`);
}

// --- Summary ---------------------------------------------------------
const failed = results.filter(r => !r.pass).length;
console.log(`\n=== summary === ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);