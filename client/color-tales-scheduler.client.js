/* global window */
(function () {
  const SIZE_LARGE = 8000;
  const SIZE_MED = 1500;

  function tier(area) {
    if (area >= SIZE_LARGE) return 0;
    if (area >= SIZE_MED) return 1;
    return 2;
  }

  function bandHue(band) {
    return [20, 155, 255][band] ?? 120;
  }

  /**
   * Pick next paintable region: large → medium → detail, frequency band biases hue.
   */
  function pickNextRegion(regions, visited, audioFeatures, order) {
    const mode = order || 'size';
    const eligible = regions.filter((r) => !visited.has(r.id));
    if (!eligible.length) return null;

    if (mode === 'left-right') {
      eligible.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
      return eligible[0];
    }
    if (mode === 'center-out') {
      const cx = regions.reduce((s, r) => s + r.cx, 0) / regions.length;
      const cy = regions.reduce((s, r) => s + r.cy, 0) / regions.length;
      eligible.sort((a, b) => {
        const da = (a.cx - cx) ** 2 + (a.cy - cy) ** 2;
        const db = (b.cx - cx) ** 2 + (b.cy - cy) ** 2;
        return da - db;
      });
      return eligible[0];
    }
    if (mode === 'random') {
      return eligible[Math.floor(Math.random() * eligible.length)];
    }

    const band = audioFeatures?.band ?? 1;
    const preferredTier = band === 0 ? 0 : band === 1 ? 1 : 2;
    const byTier = [[], [], []];
    for (const r of eligible) byTier[tier(r.area)].push(r);
    for (let t = preferredTier; t < 3; t++) {
      if (byTier[t].length) {
        byTier[t].sort((a, b) => {
          const da = (a.cx - a.cx) ** 2;
          const db = (b.cx - b.cx) ** 2;
          return db - da || b.area - a.area;
        });
        return byTier[t][0];
      }
    }
    for (let t = 0; t < 3; t++) {
      if (byTier[t].length) return byTier[t][0];
    }
    return eligible[0];
  }

  function colorForRegion(region, audioFeatures) {
    const band = audioFeatures?.band ?? 1;
    const intensity = audioFeatures?.intensity ?? 0.5;
    const hue = bandHue(band) + (region.id.charCodeAt(1) % 35);
    const sat = 48 + Math.round(intensity * 44);
    const lit = 77 - Math.round(intensity * 24);
    return `hsl(${hue} ${sat}% ${lit}%)`;
  }

  window.SWR_COLOR_TALES_SCHEDULER = { pickNextRegion, colorForRegion, tier };
})();
