/* eslint-disable no-restricted-globals */
/**
 * Color Tales worker — heavy refine + segmentation off the main thread.
 * Posts: { type: 'progress', pct } | { type: 'done', result } | { type: 'error', message }
 */
self.onmessage = async (e) => {
  const { id, op, imageData, opts } = e.data || {};
  try {
    if (op === 'refine-two-color') {
      self.postMessage({ id, type: 'progress', pct: 10 });
      const result = refineTwoColor(imageData, opts);
      self.postMessage({ id, type: 'progress', pct: 90 });
      self.postMessage({ id, type: 'done', result: { svg: result.svg, pathCount: result.pathCount } });
      return;
    }
    if (op === 'segment') {
      self.postMessage({ id, type: 'progress', pct: 15 });
      const seg = segmentRegions(imageData, opts);
      self.postMessage({ id, type: 'done', result: { regions: seg.regions, width: seg.width, height: seg.height } });
      return;
    }
    throw new Error('Unknown worker op: ' + op);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message || String(err) });
  }
};

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function refineTwoColor(imageData, opts) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const threshold = opts?.threshold ?? 160;
  const paper = opts?.paper ?? '#fffdf5';
  const ink = opts?.ink ?? '#2a3d36';
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = luminance(data[i], data[i + 1], data[i + 2]);
    mask[p] = data[i + 3] > 16 && lum < threshold ? 1 : 0;
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
  const vb = `0 0 ${width * stride} ${height * stride}`;
  const pathD = paths.join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">` +
    `<rect width="100%" height="100%" fill="${paper}"/>` +
    (pathD ? `<path d="${pathD}" fill="${ink}"/>` : '') + '</svg>';
  return { svg, pathCount: paths.length };
}

function colorDist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function segmentRegions(imageData, opts) {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const tolerance = opts?.tolerance ?? 48;
  const minArea = opts?.minArea ?? 64;
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
      if (seed[3] < 16) { seen[start] = -1; continue; }
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
        for (const n of [at - 1, at + 1, at - w, at + w]) {
          const pxn = n % w;
          if (n < 0 || n >= w * h || Math.abs(pxn - px) > 1) continue;
          if (seen[n]) continue;
          const pxel = sample(n);
          if (pxel[3] < 16) continue;
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
      }
      nextId++;
    }
  }
  return { regions, width: w, height: h };
}
