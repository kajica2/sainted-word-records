/* global window */
(function () {
  const C = () => window.SWR_COLOR_TALES_CONSTANTS;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  /** Nearest beat-sync speed snap (0.25× … 4×). */
  function snapBeatSpeed(speed) {
    const snaps = C().BEAT_SPEED_SNAP;
    let best = snaps[0];
    let dist = Math.abs(speed - best);
    for (const s of snaps) {
      const d = Math.abs(speed - s);
      if (d < dist) { dist = d; best = s; }
    }
    return best;
  }

  /** Free-timing interval between region fills (ms). */
  function freeTimingIntervalMs(speed) {
    const base = C().DEFAULT_FILL_INTERVAL_MS;
    return clamp(base / speed, 150, 2400);
  }

  /** Ms between fills in beat-sync mode at given BPM. */
  function beatIntervalMs(speed, bpm) {
    const beatMs = 60000 / Math.max(30, bpm || 120);
    const snapped = snapBeatSpeed(speed);
    return beatMs / snapped;
  }

  function fillFadeDurationMs(fillFadeRatio, intervalMs) {
    return clamp(intervalMs * clamp(fillFadeRatio, 0, 1), 0, intervalMs);
  }

  function formatSpeedLabel(speed, bpm, beatSync) {
    const interval = beatSync ? beatIntervalMs(speed, bpm) : freeTimingIntervalMs(speed);
    const subdiv = beatSync ? snapBeatSpeed(speed) : null;
    const beatPart = beatSync
      ? `${subdiv}× · 1 area/${subdiv === 0.25 ? '4 beats' : subdiv === 0.5 ? '2 beats' : subdiv === 1 ? 'beat' : subdiv === 2 ? '½ beat' : '¼ beat'}`
      : 'free timing';
    return `${speed}× · ${beatPart} · ${(interval / 1000).toFixed(2)} s`;
  }

  window.SWR_COLOR_TALES_SPEED = {
    snapBeatSpeed,
    freeTimingIntervalMs,
    beatIntervalMs,
    fillFadeDurationMs,
    formatSpeedLabel,
    clamp,
  };
})();
