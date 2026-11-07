/* global window */
(function () {
  function firstPoint(pathD) {
    const m = /M\s*([-\d.]+)[,\s]+([-\d.]+)/i.exec(pathD || '');
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }

  /** True when the path has no real segment (tap / straight hairline would be invisible). */
  function needsStrokeCap(pathD) {
    if (!pathD) return true;
    return !/\s[LCQTAHVS]/i.test(pathD);
  }

  function capRadius(strokeSize) {
    return Math.max(2, (strokeSize || 40) / 2);
  }

  window.SWR_COLOR_TALES_PAINT = { firstPoint, needsStrokeCap, capRadius };
})();
