// client/section-detector.client.js — pure-DSP song-section classifier.
//
// USAGE
//   <script src="../client/section-detector.client.js" defer></script>
//   window.SWR_SECTION.detect(audioFeat)   // poll each beat / frame
//   window.SWR_SECTION.on('swr-section-change', (ev) => …)
//   window.SWR_SECTION.history             // last N transitions
//
// AUDIO INPUT (per SWARM_BRIEF)
//   A.feat = { beat, onset, rms, centroid, bpm, bass, mid, treble }
//
// SECTIONS
//   'intro' | 'verse' | 'prechorus' | 'chorus' | 'breakdown' | 'outro'
//
// ALGORITHM
//   intro      — first 8 bars OR 16 beats (whichever ends later)
//   verse      — median RMS + low onset density
//   prechorus  — RMS rising + onset density trending up over recent bars
//   chorus     — high RMS + high onset density sustained >4 bars
//                OR a one-shot RMS lift >50% that holds >2 bars
//   breakdown  — sudden RMS drop >50% vs recent median, or onset density collapse
//   outro      — last 8 bars OR sustained RMS drop with low spectral centroid
//
// CONFIDENCE
//   0..1 score per call. If confidence stays <0.5 for >4 beats, fall back to 'verse'.
//
// Pure DSP — no ML, no remote calls.

(function () {
  'use strict';

  const NAMESPACE = 'SWR_SECTION';
  const VALID = ['intro', 'verse', 'prechorus', 'chorus', 'breakdown', 'outro'];
  const EVENT_NAME = 'swr-section-change';

  // Bar length in beats (4/4). Beats per bar.
  const BEATS_PER_BAR = 4;
  const HISTORY_MAX = 64;

  // Detection thresholds. Tuned for normalized audio (rms 0..1, onset 0..1).
  const TH = {
    rmsHigh: 0.55,        // chorus RMS floor
    rmsMedianLow: 0.18,   // below this is "quiet" (verse / breakdown candidate)
    rmsMedianHigh: 0.30,  // above this is "active" (verse / prechorus)
    onsetHigh: 0.45,      // chorus / prechorus onset density floor
    onsetLow: 0.18,       // verse / breakdown onset ceiling
    centroidLow: 0.30,    // outro floor (dull / fading)
    riseWindowBars: 2,    // prechorus trend window
    chorusSustainBars: 4, // chorus held-N-bars rule
    chorusLiftBars: 2,    // one-shot lift must hold this long
    chorusLiftRatio: 1.5, // 50% RMS jump
    breakdownDropRatio: 0.5, // 50% drop from median
    breakdownWindowBeats: 8, // lookback for the median
    outroDropRatio: 0.4,  // sustained drop for outro candidate
    outroWindowBars: 2,
    fallbackBeats: 4,     // low-confidence hold before forcing 'verse'
    introBars: 8,
    introBeats: 16,
    outroBars: 8,
  };

  // Per-call state. Reset by reset().
  const state = {
    beatNumber: 0,
    rmsHistory: [],   // ring buffer of per-beat RMS samples
    onsetHistory: [],
    centroidHistory: [],
    beatTimesMs: [],  // ms timestamp per beat (for sinceMs)
    rmsBars: [],      // averaged per bar
    onsetBars: [],
    centroidBars: [],
    barsElapsed: 0,
    beatsInBar: 0,
    section: 'intro',
    sinceMs: 0,
    sinceBeat: 0,
    confidence: 0.5,
    lowConfStreak: 0,
    history: [],
    onsetsPerBar: [], // counts per bar for "density collapse" detection
  };

  // Event handlers (tiny pub-sub; engine hosts the real DOM event).
  const handlers = Object.create(null);
  function on(event, handler) {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(handler);
    return () => off(event, handler);
  }
  function off(event, handler) {
    const list = handlers[event];
    if (!list) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }
  function emit(event, detail) {
    const list = handlers[event];
    if (!list || !list.length) return;
    const ev = { type: event, detail };
    for (let i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (_) { /* swallow listener errors */ }
    }
  }

  // ---------- helpers ----------
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function mean(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function safe(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function pushBounded(arr, v, cap) {
    arr.push(v);
    if (arr.length > cap) arr.splice(0, arr.length - cap);
  }

  // ---------- detection ----------
  function detect(audioFeat) {
    const f = audioFeat || {};
    const nowMs = safe(f.tMs, (typeof performance !== 'undefined' ? performance.now() : 0));
    const rms = safe(f.rms, 0);
    const onset = safe(f.onset, 0);
    const centroid = safe(f.centroid, 0);

    // Advance beat counter on each new beat pulse from A.feat.
    // We treat each call where beat flips 0→1 (or any rise) as a beat tick.
    // For frame-level polling we still count by BEATS_PER_BAR cadence using f.beat.
    const beatFlag = safe(f.beat, 0);
    const isBeatTick = beatFlag > 0.5;
    if (isBeatTick) {
      state.beatNumber += 1;
      state.beatsInBar += 1;
      pushBounded(state.rmsHistory, rms, 64);
      pushBounded(state.onsetHistory, onset, 64);
      pushBounded(state.centroidHistory, centroid, 64);
      state.beatTimesMs.push(nowMs);
      if (state.beatTimesMs.length > 64) state.beatTimesMs.splice(0, state.beatTimesMs.length - 64);
    } else {
      // Continuously update the latest in-progress beat's running values via
      // a moving tail so non-beat frames still inform bar aggregation.
      if (state.rmsHistory.length) state.rmsHistory[state.rmsHistory.length - 1] = rms;
      if (state.onsetHistory.length) state.onsetHistory[state.onsetHistory.length - 1] = onset;
      if (state.centroidHistory.length) state.centroidHistory[state.centroidHistory.length - 1] = centroid;
    }

    // Bar rollup.
    if (state.beatsInBar >= BEATS_PER_BAR) {
      state.barsElapsed += 1;
      const tail = state.rmsHistory.slice(-BEATS_PER_BAR);
      pushBounded(state.rmsBars, mean(tail), 16);
      const otail = state.onsetHistory.slice(-BEATS_PER_BAR);
      pushBounded(state.onsetBars, mean(otail), 16);
      pushBounded(state.centroidBars, mean(state.centroidHistory.slice(-BEATS_PER_BAR)), 16);
      pushBounded(state.onsetsPerBar, otail.filter((v) => v > TH.onsetHigh).length, 16);
      state.beatsInBar = 0;
    }

    const { section: nextSection, confidence: nextConfidence } = classify();
    const from = state.section;
    state.confidence = nextConfidence;
    if (nextSection !== from || state.sinceMs === 0) {
      // First call (sinceMs===0) seeds the initial section without firing
      // an event. Subsequent transitions fire.
      if (state.sinceMs !== 0) {
        const tMs = nowMs;
        const beatNumber = state.beatNumber;
        state.section = nextSection;
        state.sinceMs = tMs;
        state.sinceBeat = beatNumber;
        const detail = { from, to: nextSection, beatNumber, tMs, confidence: nextConfidence };
        pushBounded(state.history, detail, HISTORY_MAX);
        // Notify listeners and (when available) the DOM.
        emit(EVENT_NAME, detail);
        try {
          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
          }
        } catch (_) { /* no-op outside the browser */ }
      } else {
        state.section = nextSection;
        state.sinceMs = nowMs;
        state.sinceBeat = state.beatNumber;
      }
    }

    return { current: state.section, confidence: state.confidence, sinceMs: state.sinceMs };
  }

  function classify() {
    const beats = state.beatNumber;
    const bars = state.barsElapsed;

    // ----- intro: first 8 bars OR first 16 beats, whichever ends later.
    const introEndByBars = TH.introBars * BEATS_PER_BAR;
    const introEndByBeats = TH.introBeats;
    const introEnd = Math.max(introEndByBars, introEndByBeats);
    if (beats <= introEnd) {
      return { section: 'intro', confidence: 0.7 };
    }

    const rmsMed = median(state.rmsHistory.slice(-16));
    const onsetMed = median(state.onsetHistory.slice(-16));
    const centroidMed = median(state.centroidHistory.slice(-16));
    const rmsRecent = mean(state.rmsHistory.slice(-4));

    // ----- outro: last 8 bars OR sustained RMS drop + low centroid.
    // We don't know song length, so outro is heuristic on signal alone:
    // sustained low RMS + low centroid for several bars.
    if (bars >= 4) {
      const lastBars = state.rmsBars.slice(-TH.outroWindowBars);
      const refBars = state.rmsBars.slice(0, Math.max(1, state.rmsBars.length - TH.outroWindowBars));
      const dropRatio = lastBars.length >= 2 && refBars.length >= 1
        ? 1 - (mean(lastBars) / Math.max(median(refBars), 0.0001))
        : 0;
      const centroidRecent = mean(state.centroidBars.slice(-TH.outroWindowBars));
      if (dropRatio >= TH.outroDropRatio && centroidRecent <= TH.centroidLow + 0.05) {
        return { section: 'outro', confidence: 0.65 };
      }
    }

    // ----- breakdown: sudden RMS drop >50% vs recent median, OR onset density collapse.
    const window = state.rmsHistory.slice(-TH.breakdownWindowBeats);
    if (window.length >= 4) {
      const wMed = median(window);
      if (wMed > 0 && rmsRecent < wMed * (1 - TH.breakdownDropRatio)) {
        return { section: 'breakdown', confidence: 0.7 };
      }
    }
    if (state.onsetsPerBar.length >= 3) {
      const recent = mean(state.onsetsPerBar.slice(-2));
      const prior = mean(state.onsetsPerBar.slice(-4, -2));
      if (prior >= 2 && recent <= Math.max(1, prior * 0.3)) {
        return { section: 'breakdown', confidence: 0.6 };
      }
    }

    // ----- chorus: high RMS + high onset sustained >4 bars OR one-shot lift >50% held >2 bars.
    if (rmsMed >= TH.rmsHigh && onsetMed >= TH.onsetHigh) {
      const recentBars = state.rmsBars.slice(-TH.chorusSustainBars);
      const allHigh = recentBars.length >= TH.chorusSustainBars
        && recentBars.every((v) => v >= TH.rmsHigh - 0.05);
      if (allHigh) return { section: 'chorus', confidence: 0.8 };
    }
    if (state.rmsBars.length >= 3) {
      const prev = median(state.rmsBars.slice(-6, -2));
      const curr = mean(state.rmsBars.slice(-TH.chorusLiftBars));
      if (prev > 0 && curr >= prev * TH.chorusLiftRatio && onsetMed >= TH.onsetHigh * 0.8) {
        return { section: 'chorus', confidence: 0.7 };
      }
    }

    // ----- prechorus: rising RMS + rising onset density over recent bars.
    if (state.rmsBars.length >= TH.riseWindowBars + 1) {
      const rmsTrend = state.rmsBars[state.rmsBars.length - 1]
        - state.rmsBars[state.rmsBars.length - 1 - TH.riseWindowBars];
      const onsetTrend = state.onsetBars[state.onsetBars.length - 1]
        - state.onsetBars[state.onsetBars.length - 1 - TH.riseWindowBars];
      if (rmsTrend > 0.04 && onsetTrend > 0.03 && rmsMed >= TH.rmsMedianLow) {
        return { section: 'prechorus', confidence: 0.65 };
      }
    }

    // ----- verse: median RMS + low onset density.
    if (rmsMed >= TH.rmsMedianLow && rmsMed < TH.rmsHigh && onsetMed < TH.onsetHigh) {
      return { section: 'verse', confidence: 0.6 };
    }

    // Quiet fallback. We refuse to leave outro on this rule alone — a quiet
    // outro tail shouldn't get yanked back into 'verse' just because the
    // RMS is below the active threshold.
    if (rmsMed < TH.rmsMedianLow) {
      if (state.section === 'outro') return { section: 'outro', confidence: 0.6 };
      return { section: 'verse', confidence: 0.5 };
    }

    return { section: 'verse', confidence: 0.55 };
  }

  function reset() {
    state.beatNumber = 0;
    state.rmsHistory.length = 0;
    state.onsetHistory.length = 0;
    state.centroidHistory.length = 0;
    state.beatTimesMs.length = 0;
    state.rmsBars.length = 0;
    state.onsetBars.length = 0;
    state.centroidBars.length = 0;
    state.onsetsPerBar.length = 0;
    state.barsElapsed = 0;
    state.beatsInBar = 0;
    state.section = 'intro';
    state.sinceMs = 0;
    state.sinceBeat = 0;
    state.confidence = 0.5;
    state.lowConfStreak = 0;
    state.history.length = 0;
  }

  // ---------- low-confidence fallback handler ----------
  // Called externally on each beat tick from the consumer. If confidence stays
  // <0.5 for >TH.fallbackBeats beats, force the section to 'verse'.
  function tickConfidence() {
    if (state.confidence < 0.5) {
      state.lowConfStreak += 1;
      if (state.lowConfStreak > TH.fallbackBeats && state.section !== 'verse') {
        const from = state.section;
        state.section = 'verse';
        state.confidence = 0.55;
        state.sinceMs = state.beatTimesMs.length ? state.beatTimesMs[state.beatTimesMs.length - 1] : state.sinceMs;
        state.sinceBeat = state.beatNumber;
        const detail = { from, to: 'verse', beatNumber: state.beatNumber, tMs: state.sinceMs, confidence: state.confidence };
        pushBounded(state.history, detail, HISTORY_MAX);
        emit(EVENT_NAME, detail);
        try {
          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
          }
        } catch (_) { /* no-op */ }
      }
    } else {
      state.lowConfStreak = 0;
    }
  }

  // ---------- public API ----------
  const api = {
    detect,
    on,
    off,
    reset,
    tickConfidence,
    get lastSection() { return state.section; },
    get history() { return state.history.slice(); },
    SECTIONS: VALID.slice(),
  };

  window[NAMESPACE] = api;
})();
