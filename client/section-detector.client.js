// client/section-detector.client.js — song-section detection for the engine.
//
// WHY THIS FILE WAS REWRITTEN (architecture-audit-2026-10, P1.3)
//
// The audit said "three section-detection implementations in the repo; the
// one wired into the engine is the shallowest". Measured at b31c74e, the
// truth is sharper than that:
//
//   * the file that every page loads, this one, WAS the shallowest. It
//     averaged energy per bar and cut wherever a bar moved more than 15% of
//     full scale against the running section mean. One delta, one bar, one
//     threshold.
//   * the sophisticated detector (chroma self-similarity matrix + Foote
//     checkerboard novelty curve) already existed, in
//     client/storyboard-song.client.js, but only for the OFFLINE storyboard
//     path (it needs a decoded AudioBuffer).
//   * this file's own richer realtime classifier was deleted on 2026-10-01
//     (commit 7a9285c) and its test with it, so
//     client/automix.client.js:439 (`window.SWR_SECTION.detect`) silently
//     fell through to its `'verse'` fallback on every tick of every engine.
//
// So the fix is not "load a better file", it is "make this file the better
// algorithm, and put it back on the live seam". ONE core now serves both:
//
//   live    window.SWR_SECTION.detect(feat)   fed from the engine's live
//          Audio.feat once per frame. Samples are aggregated on the beat
//          clock into one descriptor row per beat, folded into a rolling
//          self-similarity matrix, and section boundaries are the peaks of
//          the Foote checkerboard novelty curve over that matrix.
//
//   batch   window.SWR_SECTION_DETECTOR.detectSections(analysis)  builds the
//          same rows from an AudioAnalysisV2 output and runs the same core in
//          one pass. (dashboard.html and the variant pages load this file.)
//
// WHAT MAKES IT NOT AN ENERGY THRESHOLD
//
// The similarity descriptor is 5 dims: bass, mid, treble, centroid, onset.
// RMS is deliberately excluded from the descriptor and kept per row only for
// the section's energy readout and its label. Every row is L2-normalised
// before cosine, so a row that is twice as loud in every band at once lands
// on the same unit vector. A loudness ramp is therefore invisible to the
// similarity matrix by construction; only a change of TIMBRE or of ONSET
// DENSITY moves it. A boundary needs the material either side of the kernel
// to differ, which is what the checkerboard measures.
//
// Energy still decides a section's NAME (that is a labelling job, not a
// boundary job) and it is normalised against the stream's own running mean,
// so a quiet master and a loud master label the same way.
//
// PUBLIC SURFACE
//
//   window.SWR_SECTION.detect(feat) -> { section, confidence, index,
//        startFrame, startMs, energy, novelty, frames, sections, ready }
//   window.SWR_SECTION.reset()          forget the stream (next detect starts
//                                       a new one; the published sections are
//                                       kept so a UI map survives the reset)
//   window.SWR_SECTION.sections         live section list (getter)
//   window.SWR_SECTION.history          boundary transitions, newest last
//   window.SWR_SECTION.options          read/modify the detector constants
//
//   window.SWR_SECTIONS                 the same list, republished as a fresh
//                                       array on every confirmed boundary
//
//   window.dispatchEvent(CustomEvent('swr-section-change', { detail: {
//     from, to, frame, tMs, novelty, confidence } }))
//     which is exactly what client/section-scheduler.client.js already
//     listens for (it only reads detail.to), so a detected boundary drives
//     the chapter transition with no extra wiring.
//
//   window.SWR_SECTION_DETECTOR.detectSections(analysis, options)
//   window.SWR_SECTION_DETECTOR.sectionsToScenes(sections, layersFactory)
//
// CALLERS / FEATURE SOURCE
//
//   engine.html calls SWR_SECTION.detect(Audio.feat) once per frame from its
//   audio update block. The automix runtime calls it too, per tick, with the
//   same live object. Ingest dedupes on the timestamp, so being called twice
//   per frame cannot double-count. Pass feat.tMs to drive the clock yourself
//   (used by the unit gate); otherwise performance.now() is read.
//
// NO ML, NO NETWORK, NO DECODED BUFFER. Same globals, same event name, no
// page changes required beyond the one engine.html call.

(function () {
  'use strict';
  if (window.SWR_SECTION && window.SWR_SECTION_DETECTOR) return;

  // ---- descriptor ---------------------------------------------------------
  // rms is not a dim. See WHAT MAKES IT NOT AN ENERGY THRESHOLD above.
  const DIMS = 5;
  const DIM_SRC = ['bass', 'mid', 'treble', 'centroid', 'onset'];
  // Fixed per-dim weights: centroid and onset are bounded and noisy, the
  // bands are the strongest cue for "same material, different level".
  const DIM_W = [1.0, 0.9, 0.9, 0.7, 0.6];

  // Rolling self-similarity matrix. MAX_ROWS^2 Float32 = 256 KB, allocated
  // once. The kernel only ever reads a (2K+1) band, so slots are reused
  // safely as long as MAX_ROWS >= 4 * kernelHalf.
  const MAX_ROWS = 256;
  const MAX_HISTORY = 64;
  const SIM = new Float32Array(MAX_ROWS * MAX_ROWS);

  const LABELS = ['intro', 'verse', 'prechorus', 'chorus', 'breakdown', 'outro'];

  const DEFAULTS = {
    kernelHalf: 8,       // Foote kernel half-width in frames (~4 s at 120 BPM)
    zThreshold: 0.75,    // a peak must clear mean + z * sigma of its own history
    minNovelty: 0.045,   // and an absolute floor, so a flat history cannot fire
    minSectionFrames: 8, // no two boundaries closer than this (2 bars @ 120)
    minFrames: 16,       // frames of history before any boundary is allowed
    frameMs: 0,          // 0 = derive from bpm (one beat), else explicit hop
    gapMs: 2500,         // a longer silence than this starts a new stream
  };

  // Label bands, on energy normalised against the stream's running mean
  // (1.0 = the stream's average level, so 0.85 means ~1.7x average).
  const BAND_CHORUS = 0.85;
  const BAND_INTRO = 0.62;
  const BAND_BREAKDOWN = 0.5;
  const BAND_OUTRO = 0.55;
  const RISE_PRECHORUS = 0.1;
  const DROP_BREAKDOWN = 0.45;

  // ---- small helpers ------------------------------------------------------
  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : (fallback || 0);
  }

  // Weighted, L2-normalised descriptor row. Scale-invariant: doubling every
  // dim leaves the returned vector identical, which is the property that
  // makes a loudness ramp invisible to the matrix.
  function unitVector(values) {
    const out = new Float64Array(DIMS);
    let norm = 0;
    for (let d = 0; d < DIMS; d++) {
      const w = num(values[d]) * DIM_W[d];
      norm += w * w;
    }
    if (norm < 1e-9) return out; // silence: zeros, and cosine() guards below
    const inv = 1 / Math.sqrt(norm);
    for (let d = 0; d < DIMS; d++) out[d] = (num(values[d]) * DIM_W[d]) * inv;
    return out;
  }

  // Both operands are unit vectors, so cosine is the dot product.
  function cosine(u, v) {
    if (!u || !v) return 0;
    let any = false;
    let dot = 0;
    for (let d = 0; d < DIMS; d++) {
      if (u[d] !== 0 || v[d] !== 0) any = true;
      dot += u[d] * v[d];
    }
    return any ? dot : 0;
  }

  // ---- the rolling state (shared by the live path and the batch path) -----
  function makeState(overrides) {
    const state = {
      rows: [],        // { u, e, tMs } one per frame, L2-normalised descriptor
      novelty: [],     // novelty per frame, filled K frames late
      sections: [],
      history: [],
      base: 0,         // absolute index of rows[0] (ring position)
      meanE: 0,        // running mean of frame energy (the loudness reference)
      primed: false,
      lastTMs: -1,
      frameStartMs: 0,
      acc: null,
      accN: 0,
      options: Object.assign({}, DEFAULTS, overrides || {}),
    };
    return state;
  }

  function slot(abs) {
    return abs % MAX_ROWS;
  }

  // Fill the new row's off-diagonal band of the self-similarity matrix. Every
  // pair the kernel can need for a novelty at index i has max(a, b) <= i + K,
  // and every commit writes the 2K+1 band behind itself, so the band a novelty
  // reads is always the band that was written most recently.
  function fillMatrix(state, n) {
    const rows = state.rows;
    const K = state.options.kernelHalf;
    const iAbs = state.base + n;
    const iSlot = slot(iAbs);
    const from = Math.max(0, n - 2 * K);
    for (let j = from; j < n; j++) {
      const s = cosine(rows[n].u, rows[j].u);
      const jAbs = state.base + j;
      const jSlot = slot(jAbs);
      SIM[iSlot * MAX_ROWS + jSlot] = s;
      SIM[jSlot * MAX_ROWS + iSlot] = s;
    }
  }

  function simAt(aAbs, bAbs) {
    return SIM[slot(aAbs) * MAX_ROWS + slot(bAbs)];
  }

  // Foote checkerboard kernel at the anti-diagonal point (i, i).
  //   ++ and -- quadrants : material on the same side of i  -> reward (+1)
  //   +- and -+ quadrants : material either side of i       -> penalise (-1)
  // Gaussian weight in dx^2 + dy^2. A boundary is a POSITIVE peak, because
  // both same-side quadrants are internally similar while both cross-side
  // quadrants are not. (A kernel with the opposite sign puts the peak on the
  // homogoneity maxima instead, which is a different, wrong, curve.)
  function noveltyAt(state, n) {
    const K = state.options.kernelHalf;
    const iAbs = state.base + n;
    const sigma = Math.max(1e-6, K / 2);
    const inv = 1 / (2 * sigma * sigma);
    let sum = 0;
    let wsum = 0;
    for (let dx = -K; dx <= K; dx++) {
      for (let dy = -K; dy <= K; dy++) {
        if (dx === 0 || dy === 0) continue;
        const w = Math.exp(-(dx * dx + dy * dy) * inv);
        const sign = (dx * dy > 0) ? 1 : -1;
        sum += sign * w * simAt(iAbs + dx, iAbs + dy);
        wsum += w;
      }
    }
    return wsum > 0 ? sum / wsum : 0;
  }

  // Adaptive peak threshold: mean + z * sigma over the trailing novelty
  // history. Self-calibrating, so a loud master and a near-silent one need
  // the same constants.
  function adaptiveThreshold(state, n) {
    const floor = state.options.minNovelty;
    const win = Math.min(state.novelty.length, 64);
    const from = Math.max(0, n - win);
    let sum = 0;
    let count = 0;
    for (let k = from; k <= n; k++) {
      const v = state.novelty[k];
      if (typeof v === 'number' && isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count < 8) return floor;
    const mean = sum / count;
    let vs = 0;
    for (let k = from; k <= n; k++) {
      const v = state.novelty[k];
      if (typeof v === 'number' && isFinite(v)) {
        const d = v - mean;
        vs += d * d;
      }
    }
    const std = Math.sqrt(vs / count);
    return Math.max(floor, mean + state.options.zThreshold * std);
  }

  // The one boundary rule, shared by both paths.
  //  - rising into the peak (the peak itself is checked one frame later)
  //  - above the absolute floor
  //  - above the adaptive threshold
  //  - enough history behind it
  //  - far enough from the previous boundary
  function acceptPeak(state, n) {
    if (n < 1) return false;
    const cur = state.novelty[n];
    const prev = state.novelty[n - 1];
    if (typeof cur !== 'number' || typeof prev !== 'number') return false;
    if (!(cur > prev)) return false;
    if (!(cur > state.options.minNovelty)) return false;
    if (cur < adaptiveThreshold(state, n)) return false;
    if (n < state.options.minFrames) return false;
    const last = state.sections.length
      ? state.sections[state.sections.length - 1].startFrame
      : 0;
    if (n - last < state.options.minSectionFrames) return false;
    return true;
  }

  // Energy statistics over frames [from, to). `rise` compares the last third
  // of the window with the first third; `dev` is the mean absolute deviation
  // from the mean (how steady the section is).
  function rangeStats(state, from, to) {
    const rows = state.rows;
    const a = Math.max(0, from);
    const b = Math.min(rows.length, Math.max(from, to));
    const n = Math.max(0, b - a);
    if (n === 0) {
      return { energy: state.meanE, dev: 0, onset: 0, rise: 0, frames: 0 };
    }
    let sum = 0;
    let onset = 0;
    for (let i = a; i < b; i++) {
      sum += rows[i].e;
      onset += rows[i].onset;
    }
    const mean = sum / n;
    let dev = 0;
    let firstSum = 0;
    let firstN = 0;
    let lastSum = 0;
    let lastN = 0;
    const third = Math.max(1, Math.floor(n / 3));
    for (let i = a; i < b; i++) {
      dev += Math.abs(rows[i].e - mean);
      if (i < a + third) {
        firstSum += rows[i].e;
        firstN++;
      }
      if (i >= b - third) {
        lastSum += rows[i].e;
        lastN++;
      }
    }
    const ref = Math.max(state.meanE, 1e-6);
    return {
      energy: mean / ref,                 // 1.0 = the stream's average level
      dev: dev / n / ref,                 // steadiness, same scale
      onset: onset / n,
      rise: (lastSum / Math.max(lastN, 1) - firstSum / Math.max(firstN, 1)) / ref,
      frames: n,
    };
  }

  // Section name. Energy decides the name; the boundary itself was decided by
  // timbre. Order matters: a build is a prechorus even at chorus level, a
  // collapse is a breakdown even late in the track.
  function classify(stats, index, prevEnergy) {
    if (index === 0 && stats.energy < BAND_INTRO) return 'intro';
    if (stats.energy >= BAND_CHORUS) return 'chorus';
    if (stats.rise >= RISE_PRECHORUS) return 'prechorus';
    if (prevEnergy != null &&
        prevEnergy - stats.energy > DROP_BREAKDOWN &&
        stats.energy < BAND_BREAKDOWN) return 'breakdown';
    if (index >= 2 && stats.energy < BAND_OUTRO && stats.frames >= 16) return 'outro';
    return 'verse';
  }

  // Confidence: how far the section's energy sits from the nearest band edge
  // AND how steady it has been, damped while the section is still young so a
  // caller with its own hysteresis (automix) is not handed a fresh label on
  // the first frame after a boundary.
  function confidence(stats, frames) {
    const edges = [0, BAND_BREAKDOWN, BAND_OUTRO, BAND_INTRO, BAND_CHORUS, 1];
    let margin = 1;
    for (let i = 0; i < edges.length - 1; i++) {
      const lo = edges[i];
      const hi = edges[i + 1];
      if (stats.energy >= lo && stats.energy <= hi) {
        margin = Math.min(stats.energy - lo, hi - stats.energy) / 0.2;
        break;
      }
    }
    const steadiness = clamp01(1 - stats.dev / 0.18);
    const age = clamp01(0.6 + 0.4 * Math.min(1, stats.frames / 4));
    const raw = 0.55 * clamp01(margin) + 0.45 * steadiness;
    return clamp01(raw * age) * 0.98;
  }

  // ---- section bookkeeping ------------------------------------------------
  function sealPrevious(state, endFrame) {
    const secs = state.sections;
    if (secs.length === 0) return;
    const last = secs[secs.length - 1];
    const stats = rangeStats(state, last.startFrame, endFrame);
    last.endFrame = endFrame;
    last.bars = endFrame - last.startFrame;
    last.energy = stats.energy;
    last.dev = stats.dev;
    last.rise = stats.rise;
    last.name = classify(stats, secs.length - 1, last.prevEnergy);
  }

  function activeStats(state) {
    if (state.sections.length === 0) return { energy: 1, dev: 0, onset: 0, rise: 0, frames: 0 };
    const last = state.sections[state.sections.length - 1];
    return rangeStats(state, last.startFrame, state.rows.length);
  }

  function commitBoundary(state, n) {
    sealPrevious(state, n);
    const prev = state.sections.length ? state.sections[state.sections.length - 1] : null;
    const prevEnergy = prev ? prev.energy : null;
    const stats = rangeStats(state, n, state.rows.length);
    const index = state.sections.length;
    state.sections.push({
      index: index,
      startFrame: n,
      endFrame: null,
      bars: 0,
      name: classify(stats, index, prevEnergy),
      energy: stats.energy,
      dev: stats.dev,
      rise: stats.rise,
      prevEnergy: prevEnergy,
      startMs: state.rows[n] ? state.rows[n].tMs : 0,
      novelty: state.novelty[n],
    });
    const from = prev ? prev.name : 'silence';
    const to = state.sections[state.sections.length - 1].name;
    const conf = confidence(stats, stats.frames);
    state.history.push({
      from: from,
      to: to,
      frame: n,
      tMs: state.rows[n] ? state.rows[n].tMs : 0,
      novelty: state.novelty[n],
      confidence: conf,
    });
    while (state.history.length > MAX_HISTORY) state.history.shift();
    publish(state);
    try {
      window.dispatchEvent(new CustomEvent('swr-section-change', {
        detail: {
          from: from,
          to: to,
          frame: n,
          tMs: state.rows[n] ? state.rows[n].tMs : 0,
          novelty: state.novelty[n],
          confidence: conf,
        },
      }));
    } catch (e) { /* no DOM / no CustomEvent: boundaries still publish */ }
  }

  function publish(state) {
    const out = [];
    for (let i = 0; i < state.sections.length; i++) {
      const s = state.sections[i];
      out.push({
        index: s.index,
        name: s.name,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
        bars: s.bars,
        energy: s.energy,
        novelty: s.novelty,
        startMs: s.startMs,
      });
    }
    window.SWR_SECTIONS = out;
    return out;
  }

  function resetState(state) {
    state.rows.length = 0;
    state.novelty.length = 0;
    state.sections.length = 0;
    state.history.length = 0;
    state.base = 0;
    state.meanE = 0;
    state.primed = false;
    state.lastTMs = -1;
    state.frameStartMs = 0;
    state.acc = null;
    state.accN = 0;
  }

  function freshAccumulator() {
    return {
      bass: 0, mid: 0, treble: 0, centroid: 0, onset: 0, rms: 0,
    };
  }

  function frameDurationMs(state, feat) {
    const forced = state.options.frameMs;
    if (forced > 0) return Math.max(50, forced);
    const bpm = num(feat && feat.bpm, 0);
    if (bpm > 0) return Math.max(120, 60000 / bpm); // one beat
    return 500;
  }

  function nowMs(feat) {
    const t = feat && feat.tMs;
    if (typeof t === 'number' && isFinite(t)) return t;
    if (typeof performance !== 'undefined' && performance && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  // Commit one descriptor row: normalise, push, fill the matrix band, then
  // compute the novelty for the frame that just became computable (K frames
  // back, because the kernel needs K frames of lookahead) and ask the one
  // boundary rule about it.
  function commitFrame(state, values, tMs) {
    const rows = state.rows;
    const row = {
      u: unitVector(values),
      e: num(values.rms),
      onset: num(values.onset),
      tMs: tMs,
    };
    rows.push(row);
    state.novelty.push(NaN);

    // Loudness reference: running mean with a 12-frame time constant.
    if (!state.primed) {
      state.meanE = row.e;
      state.primed = true;
    } else {
      state.meanE += (row.e - state.meanE) * 0.08;
    }

    fillMatrix(state, rows.length - 1);
    if (rows.length > MAX_ROWS) {
      rows.shift();
      state.novelty.shift();
      state.base++;
      for (let i = 0; i < state.sections.length; i++) {
        state.sections[i].startFrame -= 1;
        state.sections[i].endFrame =
          state.sections[i].endFrame == null ? null : state.sections[i].endFrame - 1;
      }
    }

    const K = state.options.kernelHalf;
    const cand = rows.length - 1 - K;
    if (cand >= 1) {
      state.novelty[cand] = noveltyAt(state, cand);
      if (acceptPeak(state, cand)) commitBoundary(state, cand);
    }
  }

  // ---- live path ----------------------------------------------------------
  // One streaming state, fed by detect() and reset() by the engine.
  const live = makeState();

  function detect(feat) {
    const f = feat || {};
    const tMs = nowMs(f);

    // Same frame, called twice (engine loop + automix tick both pass the live
    // Audio.feat): ingest once. The second call still returns current state.
    if (tMs !== live.lastTMs) {
      live.lastTMs = tMs;

      // A pause, a seek or a song swap leaves a hole in the stream. Start a
      // new one instead of computing novelty across the hole. The published
      // sections survive so a UI map does not vanish under the user.
      if (live.frameStartMs > 0 && tMs - live.frameStartMs > live.options.gapMs) {
        resetState(live);
        live.lastTMs = tMs;
      }

      if (live.acc === null) {
        live.acc = freshAccumulator();
        live.accN = 0;
        live.frameStartMs = tMs;
      }

      live.acc.bass += num(f.bass);
      live.acc.mid += num(f.mid);
      live.acc.treble += num(f.treble);
      live.acc.centroid += num(f.centroid);
      live.acc.onset += (f.onsetPulse != null ? (f.onsetPulse ? 1 : 0) : num(f.onset));
      live.acc.rms += num(f.rms);
      live.accN++;

      const dur = frameDurationMs(live, f);
      if (tMs - live.frameStartMs >= dur && live.accN > 0) {
        const inv = 1 / live.accN;
        const a = live.acc;
        commitFrame(live, {
          bass: a.bass * inv,
          mid: a.mid * inv,
          treble: a.treble * inv,
          centroid: a.centroid * inv,
          onset: a.onset * inv,
          rms: a.rms * inv,
        }, tMs);
        live.acc = freshAccumulator();
        live.accN = 0;
        live.frameStartMs = tMs;
      }
    }

    // Sections exist as soon as there is one frame to describe.
    if (live.sections.length === 0 && live.rows.length > 0) {
      const stats = rangeStats(live, 0, live.rows.length);
      live.sections.push({
        index: 0,
        startFrame: 0,
        endFrame: null,
        bars: 0,
        name: classify(stats, 0, null),
        energy: stats.energy,
        dev: stats.dev,
        rise: stats.rise,
        prevEnergy: null,
        startMs: live.rows[0].tMs,
        novelty: 0,
      });
      publish(live);
    }

    const active = live.sections.length
      ? live.sections[live.sections.length - 1]
      : null;
    const stats = activeStats(live);
    // Re-label the live section every frame: the name is a function of the
    // statistics so far, so a build becomes a prechorus before it becomes a
    // chorus. Committed sections keep the label they were sealed with.
    if (active && stats.frames > 0) {
      active.name = classify(stats, active.index, active.prevEnergy);
      active.energy = stats.energy;
      active.rise = stats.rise;
      active.dev = stats.dev;
    }

    return {
      section: active ? active.name : 'verse',
      confidence: active ? confidence(stats, stats.frames) : 0,
      index: active ? active.index : 0,
      startFrame: active ? active.startFrame : 0,
      startMs: active ? active.startMs : 0,
      energy: stats.energy,
      novelty: active ? active.novelty : 0,
      frames: stats.frames,
      sections: live.sections.length,
      ready: live.rows.length >= live.options.minFrames,
    };
  }

  // ---- batch path ---------------------------------------------------------
  // Same kernel, same boundary rule. The only difference is where the rows
  // come from: an AudioAnalysisV2 output has energy + onsets, no band
  // features, so the offline descriptor is the bar's energy SHAPE, which is
  // scale-invariant in exactly the same way the live descriptor is (a bar
  // played twice as loud normalises to the same vector).
  function detectSections(analysis, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const a = analysis || {};
    const energy = Array.isArray(a.energy) ? a.energy : [];
    const onsets = Array.isArray(a.onsets) ? a.onsets : [];
    const bpm = num(a.bpm, 0) || 120;
    const beatsPerBar = 4;
    const secondsPerBar = (60 / bpm) * beatsPerBar;
    const duration = num(a.duration, 0);
    const totalBars = Math.max(0, Math.floor(duration / secondsPerBar));

    // Not enough to say anything: one honest section instead of two invented
    // boundaries (which is what the old fallback returned).
    if (energy.length < 16 || totalBars < 4) {
      return [{
        startBar: 0,
        bars: Math.max(1, totalBars),
        name: 'full',
        energy: 0.5,
        novelty: 0,
      }];
    }

    const state = makeState(opts);
    const barCount = Math.min(totalBars, 128);
    const perBar = Math.max(1, Math.floor(energy.length / barCount));
    for (let bar = 0; bar < barCount; bar++) {
      const from = bar * perBar;
      const to = Math.min(from + perBar, energy.length);
      const n = Math.max(0, to - from);
      if (n === 0) break;
      let sum = 0;
      const quarters = [0, 0, 0, 0];
      const qn = [0, 0, 0, 0];
      for (let i = from; i < to; i++) {
        const v = num(energy[i]);
        sum += v;
        const q = Math.min(3, Math.floor(((i - from) / n) * 4));
        quarters[q] += v;
        qn[q]++;
      }
      const mean = sum / n;
      // Four sub-frame levels, divided by the bar mean: the shape, not the
      // level. A louder bar is the same vector as a quieter one.
      const shape = [0, 0, 0, 0];
      for (let q = 0; q < 4; q++) shape[q] = qn[q] ? (quarters[q] / qn[q]) / (mean || 1e-6) : 0;
      // Onset density inside the bar, in the same 0..-ish units.
      const barStart = bar * secondsPerBar;
      const barEnd = barStart + secondsPerBar;
      let hits = 0;
      for (let i = 0; i < onsets.length; i++) {
        if (onsets[i] >= barStart && onsets[i] < barEnd) hits++;
      }
      state.rows.push({
        u: unitVector([shape[0], shape[1], shape[2], shape[3], hits / beatsPerBar]),
        e: mean,
        onset: hits / beatsPerBar,
        tMs: barStart * 1000,
      });
      state.novelty.push(NaN);
      if (!state.primed) {
        state.meanE = mean;
        state.primed = true;
      } else {
        state.meanE += (mean - state.meanE) * 0.08;
      }
    }

    // Full novelty curve in one pass, then the shared boundary rule.
    const K = state.options.kernelHalf;
    for (let i = 0; i < state.rows.length; i++) fillMatrix(state, i);
    for (let i = 1; i + K < state.rows.length; i++) {
      state.novelty[i] = noveltyAt(state, i);
    }
    for (let i = 1; i + K < state.rows.length; i++) {
      if (acceptPeak(state, i)) commitBoundary(state, i);
    }
    // The trailing section is only sealed once the track ends.
    sealPrevious(state, state.rows.length);
    state.sections[state.sections.length - 1].bars =
      state.sections[state.sections.length - 1].endFrame - state.sections[state.sections.length - 1].startFrame;

    const out = [];
    for (let i = 0; i < state.sections.length; i++) {
      const s = state.sections[i];
      out.push({
        startBar: s.startFrame,
        bars: s.bars || 1,
        name: s.name,
        energy: s.energy,
        novelty: s.novelty,
        startSec: (s.startMs || 0) / 1000,
      });
    }
    return out;
  }

  // Unchanged contract: [{ startBar, name, energy }] -> Scene director format.
  function sectionsToScenes(sections, layersFactory) {
    const scenes = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      scenes.push({
        id: s.name + '_' + i,
        startBar: s.startBar,
        bars: s.bars || 4,
        layers: layersFactory ? layersFactory(s, i) : [],
        energy: s.energy,
      });
    }
    return scenes;
  }

  // ---- globals ------------------------------------------------------------
  window.SWR_SECTION = {
    detect: detect,
    reset: function () {
      resetState(live);
      publish(live);
    },
    get sections() {
      return live.sections;
    },
    get history() {
      return live.history;
    },
    get lastSection() {
      return live.sections.length
        ? live.sections[live.sections.length - 1].name
        : null;
    },
    get novelty() {
      return live.novelty.slice();
    },
    options: DEFAULTS,
    LABELS: LABELS,
    DIM_SRC: DIM_SRC,
    _internals: {
      unitVector: unitVector,
      cosine: cosine,
      noveltyAt: noveltyAt,
      adaptiveThreshold: adaptiveThreshold,
      acceptPeak: acceptPeak,
      rangeStats: rangeStats,
      classify: classify,
      confidence: confidence,
      makeState: makeState,
      resetState: resetState,
    },
  };

  window.SWR_SECTION_DETECTOR = {
    detectSections: detectSections,
    sectionsToScenes: sectionsToScenes,
    get sections() {
      return window.SWR_SECTION ? window.SWR_SECTION.sections : [];
    },
    LABELS: LABELS,
  };

  // Published from the start so a page that reads it before the first frame
  // gets an array, not undefined.
  window.SWR_SECTIONS = [];
})();