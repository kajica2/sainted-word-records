// gif-to-svg.client.js — pure-browser GIF (or any image) → traced SVG.
//
// Strategy:
//   1. User drops / picks a file via the drop zone
//   2. We decode the file into frames. Two paths:
//      a. Animated GIFs: use the browser-native ImageDecoder API (Chrome 94+,
//         Safari 16.4+, Firefox in progress). We iterate frames and capture
//         each as an ImageBitmap.
//      b. Static images (PNG/JPG/WebP): single frame via createImageBitmap.
//   3. For each frame: draw onto an offscreen canvas at a sane working size
//      (max 512px wide), read the RGBA buffer, then hand it to imagetracerjs
//      which returns an SVG string.
//   4. Assemble the result. Three outputs:
//      - "animated SVG": <svg> with an <image> that swaps its `href` via
//        SMIL <set> on a per-frame timer (works everywhere that runs SMIL:
//        Chrome/Safari/Firefox).
//      - "first-frame SVG": a single static <svg> with the first frame.
//      - "frame SVGs zip": all frames concatenated into a downloadable
//        single text file `<stem>-frames.txt` (plain, no actual zip — keeps
//        the page Wasm-free; each frame SVG is delimited by a comment
//        header so it's easy to split downstream).
//   5. Downloads via Blob + URL.createObjectURL + <a download>.
//
// Edge cases:
//   - ImageDecoder missing → fall back to single-frame (treats GIF as static).
//   - File > 8 MB → reject with friendly error.
//   - All tracing runs in chunks of 1 frame per requestAnimationFrame to keep
//     the UI responsive.
//
// No deps beyond the vendored imagetracer.js.

(function () {
  'use strict';

  // ---- DOM --------------------------------------------------------------
  const dropEl       = document.getElementById('drop');
  const fileInput    = document.getElementById('file-input');
  const srcPreview   = document.getElementById('src-preview');
  const srcStats     = document.getElementById('src-stats');
  const srcNameEl    = document.getElementById('src-name');
  const srcSizeEl    = document.getElementById('src-size');
  const srcFramesEl  = document.getElementById('src-frames');
  const outPreview   = document.getElementById('out-preview');
  const statusEl     = document.getElementById('status');
  const srcText      = document.getElementById('src-text');
  const traceBtn     = document.getElementById('trace');
  const dlAnim       = document.getElementById('download-anim');
  const dlStatic     = document.getElementById('download-static');
  const dlZip        = document.getElementById('download-zip');
  const colorsIn     = document.getElementById('colors');
  const threshIn     = document.getElementById('thresh');
  const smoothIn     = document.getElementById('smooth');
  const colorsV      = document.getElementById('colors-v');
  const threshV      = document.getElementById('thresh-v');
  const smoothV      = document.getElementById('smooth-v');

  // ---- state -----------------------------------------------------------
  let sourceFrames = [];   // [{ bitmap, delayMs }]
  let frameSvgs    = [];   // [svg-string] parallel to sourceFrames
  let outStem      = 'gift';
  let outWidth     = 0;
  let outHeight    = 0;

  // ---- helpers ---------------------------------------------------------
  function setStatus(msg, kind) {
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    statusEl.textContent = msg;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function canvasToImageData(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function traceWithOptions(imageData) {
    // imagetracer option docs: https://github.com/jankovicsandras/imagetracerjs
    const opts = {
      numberofcolors: parseInt(colorsIn.value, 10),
      pathomit:       8,
      ltres:          1,
      qtres:          1,
      strokewidth:    1,
      viewbox:        true,
      roundcoords:    1,
      pal:            null,
      // threshold: 0 means imagetracer auto-thresholds each band
      blurradius:     parseFloat(smoothIn.value),
      blurdelta:      20,
    };
    const thresh = parseInt(threshIn.value, 10);
    if (thresh > 0) {
      opts.threshold = thresh;
    }
    // imagetracerjs attaches `ImageTracer` to the global scope when loaded
    // via the UMD-style vendored file.
    if (typeof ImageTracer === 'undefined') {
      throw new Error('imagetracerjs not loaded');
    }
    return ImageTracer.imagedataToSVG(imageData, opts);
  }

  function pickWorkingSize(srcW, srcH) {
    const MAX = 512;
    if (srcW <= MAX && srcH <= MAX) return { w: srcW, h: srcH };
    if (srcW >= srcH) return { w: MAX, h: Math.round(srcH * (MAX / srcW)) };
    return { w: Math.round(srcW * (MAX / srcH)), h: MAX };
  }

  async function decodeFrames(file) {
    // Try ImageDecoder first (handles GIF natively, with per-frame timing).
    if ('ImageDecoder' in window && file.type === 'image/gif') {
      try {
        const buf = await file.arrayBuffer();
        const decoder = new ImageDecoder({ data: buf, type: 'image/gif' });
        const frames = [];
        for (let i = 0; i < decoder.tracks[0].frameCount; i++) {
          const r = await decoder.decode({ frameIndex: i });
          frames.push({ bitmap: r.image, delayMs: r.duration ?? 100 });
        }
        if (frames.length) return frames;
      } catch (e) {
        // fall through to single-frame fallback
        console.warn('[gif-to-svg] ImageDecoder failed, using static fallback:', e);
      }
    }
    // Fallback: load via <img> + createImageBitmap. Single frame, no timing.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const bitmap = await createImageBitmap(img);
      return [{ bitmap, delayMs: 100 }];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---- core: trace ------------------------------------------------------
  async function runTrace() {
    if (!sourceFrames.length) return;
    traceBtn.disabled = true;
    dlAnim.disabled = true;
    dlStatic.disabled = true;
    dlZip.disabled = true;
    srcText.value = '';
    outPreview.innerHTML = '<span class="placeholder">tracing…</span>';
    frameSvgs = [];

    const first = sourceFrames[0].bitmap;
    const ws = pickWorkingSize(first.width, first.height);
    outWidth = ws.w; outHeight = ws.h;

    setStatus(`<span class="spinner"></span>Tracing ${sourceFrames.length} frame(s) at ${ws.w}×${ws.h}…`, 'busy');

    const canvas = document.createElement('canvas');
    canvas.width = ws.w; canvas.height = ws.h;
    const ctx = canvas.getContext('2d');

    // Trace one frame per rAF so the UI can repaint between frames
    for (let i = 0; i < sourceFrames.length; i++) {
      const f = sourceFrames[i];
      ctx.clearRect(0, 0, ws.w, ws.h);
      ctx.drawImage(f.bitmap, 0, 0, ws.w, ws.h);
      const imageData = canvasToImageData(canvas);
      const svg = traceWithOptions(imageData);
      frameSvgs.push(svg);
      // Live update the preview on the first frame
      if (i === 0) {
        outPreview.innerHTML = svg;
      }
      setStatus(
        `<span class="spinner"></span>Tracing frame ${i + 1}/${sourceFrames.length}…`,
        'busy',
      );
      // Yield to the event loop
      await new Promise(r => requestAnimationFrame(() => r()));
    }

    setStatus(`Done · ${frameSvgs.length} frame(s) traced · ${frameSvgs.reduce((s, s_) => s + s_.length, 0).toLocaleString()} chars total`, 'ok');
    srcText.value = frameSvgs.length > 1
      ? buildAnimatedSvg(frameSvgs, sourceFrames.map(f => f.delayMs))
      : frameSvgs[0];
    dlAnim.disabled = false;
    dlStatic.disabled = false;
    dlZip.disabled = false;
    traceBtn.disabled = false;
  }

  // ---- animated SVG assembly -------------------------------------------
  // Strategy: wrap each per-frame SVG as a base64 data URL inside an <image>
  // element, then use SMIL <set> to swap visibility on a per-frame timer.
  function buildAnimatedSvg(svgs, delaysMs) {
    // Strategy: stack one <image> per frame. Frame 0 starts visible; each
    // subsequent frame's <image> starts hidden. SMIL <set> flips opacity
    // at the right timestamp — 0→1 to enter, 1→0 to leave — so only one
    // frame is visible at any moment. Total cycle = sum of delays.
    const w = outWidth, h = outHeight;
    const startsAt = [];
    let acc = 0;
    for (let i = 0; i < delaysMs.length; i++) {
      startsAt.push(acc);
      acc += delaysMs[i];
    }
    const total = acc;

    function toDataUrl(svg) {
      const utf8 = unescape(encodeURIComponent(svg));
      return 'data:image/svg+xml;base64,' + btoa(utf8);
    }
    function fmtS(ms) { return (ms / 1000).toFixed(3) + 's'; }

    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
    // Frame 0: visible from t=0, hidden after its own delay
    out += `<image href="${toDataUrl(svgs[0])}" x="0" y="0" width="${w}" height="${h}" opacity="1">`
         + `<set attributeName="opacity" to="0" begin="${fmtS(delaysMs[0])}" fill="freeze"/>`
         + `</image>`;
    // Frames 1..N: hidden from t=0, shown at their start time, hidden after their duration
    for (let i = 1; i < svgs.length; i++) {
      out += `<image href="${toDataUrl(svgs[i])}" x="0" y="0" width="${w}" height="${h}" opacity="0">`
           + `<set attributeName="opacity" to="1" begin="${fmtS(startsAt[i])}" fill="freeze"/>`
           + `<set attributeName="opacity" to="0" begin="${fmtS(startsAt[i] + delaysMs[i])}" fill="freeze"/>`
           + `</image>`;
    }
    // Loop trigger — when the last frame's hide fires, restart from 0.
    // We do this with a final <set> on the first image at total time.
    out += `<set attributeName="opacity" to="1" begin="${fmtS(total)}" />`;
    // The whole animation needs an indefinite loop — we approximate by
    // repeating the final restart via <animate>. For SMIL repeatCount we
    // attach a sibling <animate> on the root <svg> that flips frame 0
    // back to visible at t=total.
    out += `<animate attributeName="visibility" from="visible" to="visible" dur="${fmtS(total)}" repeatCount="indefinite"/>`;
    out += `</svg>`;
    return out;
  }

  // ---- file ingest -----------------------------------------------------
  async function ingestFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setStatus('File too large (max 8 MB).', 'err');
      return;
    }
    setStatus(`Loading ${file.name} (${fmtBytes(file.size)})…`, 'busy');
    outStem = (file.name.replace(/\.[^.]+$/, '') || 'gift').replace(/[^a-z0-9_\-]/gi, '_');

    try {
      sourceFrames = await decodeFrames(file);
    } catch (e) {
      setStatus(`Could not decode: ${e.message || e}`, 'err');
      return;
    }

    // Show source preview
    const first = sourceFrames[0].bitmap;
    srcPreview.innerHTML = '';
    const srcImg = document.createElement('img');
    srcImg.src = URL.createObjectURL(file);
    srcImg.style.maxWidth = '100%';
    srcImg.style.maxHeight = '100%';
    srcPreview.appendChild(srcImg);

    srcStats.style.display = 'flex';
    srcNameEl.textContent = file.name;
    srcSizeEl.textContent = fmtBytes(file.size);
    srcFramesEl.textContent = sourceFrames.length;

    traceBtn.disabled = false;
    setStatus(`Loaded ${sourceFrames.length} frame(s) — click "Trace →".`, 'ok');
  }

  // ---- downloads -------------------------------------------------------
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadStatic() {
    if (!frameSvgs.length) return;
    downloadBlob(outStem + '.svg', new Blob([frameSvgs[0]], { type: 'image/svg+xml' }));
  }

  function downloadAnim() {
    if (!frameSvgs.length) return;
    const content = srcText.value;
    if (!content) return;
    downloadBlob(outStem + '-anim.svg', new Blob([content], { type: 'image/svg+xml' }));
  }

  function downloadZip() {
    // Plain concatenated text — one frame per section, split by a sentinel.
    if (!frameSvgs.length) return;
    let bundle = '';
    frameSvgs.forEach((svg, i) => {
      bundle += `\n<!-- ===== FRAME ${String(i + 1).padStart(3, '0')} ===== -->\n`;
      bundle += svg;
      bundle += `\n<!-- ===== END FRAME ${String(i + 1).padStart(3, '0')} ===== -->\n`;
    });
    downloadBlob(outStem + '-frames.txt', new Blob([bundle], { type: 'text/plain' }));
  }

  // ---- drag-drop wiring -----------------------------------------------
  ;['dragenter', 'dragover'].forEach(ev =>
    dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('dragover'); })
  );
  ;['dragleave', 'drop'].forEach(ev =>
    dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('dragover'); })
  );
  dropEl.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) ingestFile(f);
  });
  fileInput.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) ingestFile(f);
  });

  traceBtn.addEventListener('click', runTrace);
  dlAnim.addEventListener('click', downloadAnim);
  dlStatic.addEventListener('click', downloadStatic);
  dlZip.addEventListener('click', downloadZip);

  // Live-update slider value labels
  colorsIn.addEventListener('input', () => { colorsV.textContent = colorsIn.value; });
  threshIn.addEventListener('input', () => {
    threshV.textContent = threshIn.value === '0' ? 'auto' : threshIn.value;
  });
  smoothIn.addEventListener('input', () => { smoothV.textContent = parseFloat(smoothIn.value).toFixed(1); });

  // expose for tests
  window.GifToSvg = { ingestFile, runTrace, buildAnimatedSvg };
})();