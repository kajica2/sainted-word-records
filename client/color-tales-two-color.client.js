/* global window */
(function () {
  /**
   * Refine raster image data to ink + paper (2-color) with simplified contour paths.
   * Runs synchronously on downsampled pixels; worker calls the same logic.
   */
  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function refineTwoColor(imageData, opts) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const threshold = opts?.threshold ?? 160;
    const smoothPasses = opts?.smoothPasses ?? 1;
    const paper = opts?.paper ?? '#fffdf5';
    const ink = opts?.ink ?? '#2a3d36';

    const mask = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const lum = luminance(data[i], data[i + 1], data[i + 2]);
      const a = data[i + 3];
      mask[p] = a > 16 && lum < threshold ? 1 : 0;
    }

    for (let pass = 0; pass < smoothPasses; pass++) {
      const next = new Uint8Array(mask.length);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += mask[i + dy * width + dx];
            }
          }
          next[i] = sum >= 5 ? 1 : 0;
        }
      }
      for (let i = 0; i < mask.length; i++) mask[i] = next[i] || mask[i];
    }

    const paths = [];
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 120));
    for (let y = 0; y < height; y += stride) {
      let open = false;
      let start = 0;
      for (let x = 0; x < width; x++) {
        const on = mask[y * width + x] === 1;
        if (on && !open) { open = true; start = x; }
        if ((!on || x === width - 1) && open) {
          const end = on ? x : x - 1;
          if (end > start) paths.push(`M${start * stride} ${y * stride}H${(end + 1) * stride}v${stride}H${start * stride}Z`);
          open = false;
        }
      }
    }

    const pathD = paths.join(' ');
    const vb = `0 0 ${width * stride} ${height * stride}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${width * stride}" height="${height * stride}">` +
      `<rect width="100%" height="100%" fill="${paper}"/>` +
      (pathD ? `<path d="${pathD}" fill="${ink}" fill-rule="evenodd"/>` : '') +
      '</svg>';

    return { svg, pathCount: paths.length, mask, width: width * stride, height: height * stride };
  }

  window.SWR_COLOR_TALES_TWO_COLOR = { refineTwoColor, luminance };
})();
