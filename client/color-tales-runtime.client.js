/* global window, document */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const C = window.SWR_COLOR_TALES_CONSTANTS;
  const SPEED = window.SWR_COLOR_TALES_SPEED;
  const COV = window.SWR_COLOR_TALES_COVERAGE;
  const SCHED = window.SWR_COLOR_TALES_SCHEDULER;
  const EXPORT = window.SWR_COLOR_TALES_EXPORT;
  const SAN = window.SWR_COLOR_TALES_SANITIZE;
  const STORAGE = window.SWR_COLOR_TALES_STORAGE;
  const TWO = window.SWR_COLOR_TALES_TWO_COLOR;
  const SEG = window.SWR_COLOR_TALES_SEGMENT;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let pages = [
    ['Welcome', 'Upload images → Choose colors → Add music → Record → Save video.', { placeholder: true }],
  ];
  let page = 0;
  let states = pages.map(() => []);
  let regionsByPage = pages.map(() => []);
  let visited = new Set();
  let customSvg = null;
  let color = '#87a985';
  let mode = 'soft';
  let drawing = false;
  let current = null;
  let paintTool = 'brush';
  let brushKind = 'crayon';
  let speed = 1;
  let fillFade = C.FILL_FADE_DEFAULT;
  let beatSync = false;
  let bpm = 105;
  let presetName = 'groove';
  let worker = null;
  let offlineReady = false;

  const svg = $('#ct-canvas');
  const statusEl = $('#ct-status');

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function defaultScene() {
    const art = C.PLACEHOLDER_ART;
    return `<rect width="900" height="550" fill="#fffdf5"/>` +
      `<image href="${art}" x="0" y="0" width="900" height="550" preserveAspectRatio="xMidYMid meet"/>`;
  }

  function render() {
    if (!svg) return;
    svg.innerHTML =
      `<defs><filter id="ct-blur"><feGaussianBlur stdDeviation="9"/></filter>` +
      `<filter id="ct-colorize"><feColorMatrix type="saturate" values="1.9"/></filter>` +
      `<mask id="ct-paint-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="550">` +
      `<rect width="900" height="550" fill="black"/></mask></defs>` +
      `<g id="ct-art">${customSvg || defaultScene()}</g>` +
      `<g id="ct-paint" style="mix-blend-mode:multiply" mask="url(#ct-paint-mask)" filter="url(#ct-colorize)"></g>`;
    states[page].forEach(addStroke);
    $('#ct-title').textContent = pages[page][0];
    $('#ct-text').textContent = pages[page][1];
    $('#ct-page-count').textContent = String(page + 1).padStart(2, '0');
    $('#ct-prev').disabled = page === 0;
    updateCoverageUi();
    refreshDots();
  }

  function pathNode(s, mask) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', s.d);
    p.setAttribute('fill', mask ? (s.mode === 'erase' ? 'black' : 'white') : 'none');
    p.setAttribute('stroke', mask ? 'none' : s.color);
    if (!mask) {
      p.setAttribute('stroke-width', s.size);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      if (s.mode === 'soft') p.setAttribute('filter', 'url(#ct-blur)');
    }
    return p;
  }

  function addStroke(s) {
    if (s.filled) {
      for (const [sel, fill] of [['#ct-paint-mask', 'white'], ['#ct-paint', s.color]]) {
        const node = document.createElementNS(NS, 'path');
        node.setAttribute('d', s.d);
        node.setAttribute('fill', fill);
        $(sel).append(node);
      }
      return;
    }
    $('#ct-paint-mask').append(pathNode(s, true));
    if (s.mode !== 'erase') $('#ct-paint').append(pathNode(s, false));
  }

  function point(e) {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function pageCoveragePct() {
    return COV.coveragePercent(states[page], 900 * 550);
  }

  function updateCoverageUi() {
    const pct = pageCoveragePct();
    const threshold = Math.round(C.AUTO_ADVANCE_COVERAGE * 100);
    const complete = pct >= threshold;
    $('#ct-coverage').value = pct;
    $('#ct-coverage-text').textContent = complete
      ? `${pct}% · Next sheet ready`
      : `Paint ${threshold}% to unlock the next sheet · ${pct}%`;
    $('#ct-next').disabled = page >= pages.length - 1 || !complete;
  }

  function turn(n) {
    if (n < 0 || n >= pages.length) return;
    if (n > page) {
      const threshold = Math.round(C.AUTO_ADVANCE_COVERAGE * 100);
      for (let i = 0; i < n; i++) {
        if (COV.coveragePercent(states[i], 900 * 550) < threshold) return;
      }
    }
    drawing = false;
    current = null;
    page = n;
    visited = new Set();
    render();
  }

  function refreshDots() {
    const dots = $('#ct-dots');
    if (!dots) return;
    const threshold = Math.round(C.AUTO_ADVANCE_COVERAGE * 100);
    dots.innerHTML = pages.map((_, i) => {
      const locked = i > page && pages.slice(0, i).some((__, j) =>
        COV.coveragePercent(states[j], 900 * 550) < threshold);
      return `<button type="button" class="ct-dot ${i === page ? 'active' : ''}" data-page="${i}" ` +
        `${locked ? 'disabled' : ''} aria-label="Sheet ${i + 1}"></button>`;
    }).join('');
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('/color-tales/color-tales-worker.js');
    return worker;
  }

  async function fileToImageData(file, maxDim) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return ctx.getImageData(0, 0, w, h);
  }

  function workerOp(op, imageData, opts) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const w = ensureWorker();
      const onMsg = (e) => {
        if (e.data?.id !== id) return;
        if (e.data.type === 'done') {
          w.removeEventListener('message', onMsg);
          resolve(e.data.result);
        } else if (e.data.type === 'error') {
          w.removeEventListener('message', onMsg);
          reject(new Error(e.data.message));
        } else if (e.data.type === 'progress' && $('#ct-progress')) {
          $('#ct-progress').value = e.data.pct;
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ id, op, imageData, opts }, []);
    });
  }

  async function refineAndLoadPng(file) {
    setStatus('Refining to 2-color SVG…');
    const imageData = await fileToImageData(file, 450);
    const threshold = Number($('#ct-threshold')?.value || 160);
    const local = TWO.refineTwoColor(imageData, { threshold });
    let refined = local;
    try {
      refined = await workerOp('refine-two-color', imageData, { threshold });
      refined = { ...local, ...refined };
    } catch {
      /* keep local */
    }
    const safe = SAN.sanitizeSvgText(refined.svg || local.svg);
    customSvg = safe;
    const segLocal = SEG.segmentRegions(imageData, { tolerance: 40, minArea: 32 });
    regionsByPage[page] = segLocal.regions;
    pages[page][1] = `Refined · ${segLocal.regions.length} regions detected`;
    states[page] = [];
    render();
    setStatus(`Ready · ${segLocal.regions.length} paintable regions`);
  }

  async function onBatchPng(files) {
    const list = [...files].slice(0, 24);
    if (!list.length) return;
    setStatus(`Processing ${list.length} image(s)…`);
    const nextPages = [];
    for (let i = 0; i < list.length; i++) {
      const imageData = await fileToImageData(list[i], 450);
      const refined = TWO.refineTwoColor(imageData, { threshold: 160 });
      const name = list[i].name.replace(/\.[^.]+$/, '') || `Page ${i + 1}`;
      nextPages.push([name, 'Paint to the music or by hand.', { svg: refined.svg }]);
    }
    pages = nextPages;
    states = pages.map(() => []);
    regionsByPage = pages.map(() => []);
    page = 0;
    customSvg = pages[0][2]?.svg ? SAN.sanitizeSvgText(pages[0][2].svg) : null;
    render();
    setStatus(`${pages.length} coloring pages ready`);
  }

  function bindPainting() {
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (paintTool === 'fill') return;
      drawing = true;
      svg.setPointerCapture(e.pointerId);
      const p = point(e);
      current = { d: `M${p.x} ${p.y}l.1 .1`, color, mode, size: Number($('#ct-size')?.value || 55) };
      states[page].push(current);
      addStroke(current);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drawing || !current) return;
      const p = point(e);
      current.d += ` L${p.x} ${p.y}`;
      $('#ct-paint-mask').lastChild?.setAttribute('d', current.d);
      if (mode !== 'erase') $('#ct-paint').lastChild?.setAttribute('d', current.d);
      updateCoverageUi();
    });
    const end = () => { drawing = false; current = null; updateCoverageUi(); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  function applyPreset(name) {
    const p = C.PRESETS[name];
    if (!p) return;
    presetName = name;
    speed = p.speed;
    fillFade = p.fillFade;
    $('#ct-speed').value = speed;
    $('#ct-fill-fade').value = Math.round(fillFade * 100);
    refreshSpeedLabel();
  }

  function refreshSpeedLabel() {
    const el = $('#ct-speed-label');
    if (el) el.textContent = SPEED.formatSpeedLabel(speed, bpm, beatSync);
  }

  function bindControls() {
    $('#ct-prev')?.addEventListener('click', () => turn(page - 1));
    $('#ct-next')?.addEventListener('click', () => turn(page + 1));
    $('#ct-dots')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (btn) turn(Number(btn.dataset.page));
    });
    $('#ct-png-batch')?.addEventListener('change', (e) => onBatchPng(e.target.files || []));
    $('#ct-png-single')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (f) await refineAndLoadPng(f);
      e.target.value = '';
    });
    $('#ct-speed')?.addEventListener('input', (e) => {
      speed = Number(e.target.value);
      refreshSpeedLabel();
    });
    $('#ct-fill-fade')?.addEventListener('input', (e) => {
      fillFade = Number(e.target.value) / 100;
      $('#ct-fill-fade-val').textContent = `${e.target.value}%`;
    });
    $('#ct-preset')?.addEventListener('change', (e) => applyPreset(e.target.value));
    $('#ct-beat-sync')?.addEventListener('change', (e) => {
      beatSync = e.target.checked;
      refreshSpeedLabel();
    });
    $('#ct-save-project')?.addEventListener('click', async () => {
      const id = 'proj-' + Date.now();
      await STORAGE.saveProject({ id, pages: pages.length, page, states, speed, fillFade, presetName });
      setStatus('Project saved locally');
    });
    $('#ct-record')?.addEventListener('click', () => window.SWR_COLOR_TALES_RECORD?.toggle());
    $('#ct-sound-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const audio = $('#ct-soundtrack');
      if (!file || !audio) return;
      if (audio.src?.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.src = URL.createObjectURL(file);
      audio.hidden = false;
      setStatus(`${file.name} loaded — press play when ready`);
      e.target.value = '';
    });
    applyPreset('groove');
  }

  async function registerScopedSw() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/color-tales/sw-color-tales.js', { scope: '/color-tales/' });
      await reg.update();
      offlineReady = true;
      $('#ct-offline').textContent = 'Ready offline';
      $('#ct-offline').dataset.state = 'ready';
    } catch {
      $('#ct-offline').textContent = 'Offline prep unavailable';
    }
  }

  function mount() {
    bindPainting();
    bindControls();
    render();
    registerScopedSw();
  }

  window.SWR_COLOR_TALES = {
    mount,
    turn,
    render,
    refineAndLoadPng,
    onBatchPng,
    pageCoveragePct,
    get speed() { return speed; },
    get fillFade() { return fillFade; },
    get pages() { return pages; },
    get page() { return page; },
    states,
    regionsByPage,
    EXPORT,
    SCHED,
    SPEED,
    COV,
    C,
    offlineReady: () => offlineReady,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
