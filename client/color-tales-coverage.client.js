/* global window */
(function () {
  const C = () => window.SWR_COLOR_TALES_CONSTANTS;

  /**
   * Estimate painted coverage 0–1 from stroke list (filled regions count fully).
   */
  function coverageFromStrokes(strokes, eligibleAreaPx) {
    if (!strokes?.length) return 0;
    let painted = 0;
    for (const s of strokes) {
      if (s.filled) painted += s.areaPx || 4000;
      else painted += (s.size || 40) * (s.pathLength || 80);
    }
    const area = Math.max(1, eligibleAreaPx || 900 * 550);
    return Math.min(1, painted / area);
  }

  function coveragePercent(strokes, eligibleAreaPx) {
    return Math.floor(coverageFromStrokes(strokes, eligibleAreaPx) * 100);
  }

  function shouldAutoAdvance(strokes, eligibleAreaPx) {
    return coverageFromStrokes(strokes, eligibleAreaPx) >= C().AUTO_ADVANCE_COVERAGE;
  }

  window.SWR_COLOR_TALES_COVERAGE = {
    coverageFromStrokes,
    coveragePercent,
    shouldAutoAdvance,
  };
})();
