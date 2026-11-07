/* global window */
(function () {
  function colorDist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  function segmentRegions(imageData, opts) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const tolerance = opts?.tolerance ?? 48;
    const minArea = opts?.minArea ?? 64;
    const alphaMin = opts?.alphaMin ?? 16;

    const seen = new Int32Array(w * h);
    const regions = [];
    let nextId = 1;

    function sample(ix) {
      const o = ix * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    }

    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const start = sy * w + sx;
        if (seen[start]) continue;
        const seed = sample(start);
        if (seed[3] < alphaMin) { seen[start] = -1; continue; }

        const queue = [start];
        seen[start] = nextId;
        let head = 0;
        let area = 0;
        let sumX = 0;
        let sumY = 0;

        while (head < queue.length) {
          const at = queue[head++];
          const px = at % w;
          const py = (at / w) | 0;
          area++;
          sumX += px;
          sumY += py;
          const neighbors = [
            px > 0 ? at - 1 : -1,
            px < w - 1 ? at + 1 : -1,
            py > 0 ? at - w : -1,
            py < h - 1 ? at + w : -1,
          ];
          for (const n of neighbors) {
            if (n < 0 || seen[n]) continue;
            const pxel = sample(n);
            if (pxel[3] < alphaMin) continue;
            if (colorDist(seed, pxel) <= tolerance) {
              seen[n] = nextId;
              queue.push(n);
            }
          }
        }

        if (area >= minArea) {
          regions.push({
            id: `r${nextId}`,
            color: `rgb(${seed[0]},${seed[1]},${seed[2]})`,
            area,
            cx: sumX / area,
            cy: sumY / area,
          });
        } else {
          for (const ix of queue) seen[ix] = -1;
        }
        nextId++;
      }
    }

    return { regions, labelMap: seen, width: w, height: h };
  }

  function regionPathFromMask(mask, width, height, regionId) {
    const runs = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x] !== regionId) continue;
        const start = x;
        while (x + 1 < width && mask[y * width + x + 1] === regionId) x++;
        runs.push(`M${start} ${y}H${x + 1}v1H${start}Z`);
      }
    }
    return runs.join(' ');
  }

  window.SWR_COLOR_TALES_SEGMENT = { segmentRegions, regionPathFromMask, colorDist };
})();
