/**
 * jpg-engine.client.js — image-only SWR surface (JPEG/PNG/WebP stills).
 * Loaded as type="module" from jpg.html.
 */

export const JPG_BLOCKED_CSS_FX = new Set([
  'zoom-pulse',
  'kenburns',
  'pan-scan',
  'camera-shake',
]);

export const JPG_SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const HEIC_HINT = /heic|heif/i;

/** @param {ImageBitmap} bitmap */
export function classifyStill(bitmap) {
  const w = 16;
  const h = 16;
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }
  const r = rSum / n / 255;
  const g = gSum / n / 255;
  const b = bSum / n / 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 1e-6) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return {
    hue,
    luma,
    motion: 0,
    rgb: { r: rSum / n, g: gSum / n, b: bSum / n },
  };
}

/** Persona fields that imply zoom / rotate motion on stills — zeroed for JPG. */
export function personaForJpg(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    mut: 0,
    mutAlgo: 0,
    liquid: 0,
    pearl: 0,
    glitch: 0,
  };
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, cls) {
  const el = $('jpg-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.state = cls || '';
}

function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch (_) { /* keep trying */ }
  }
  return 'video/webm';
}

function fitCanvas(canvas, host) {
  const rect = host.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

function drawLayerStack(ctx, layers, tSec) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#050308';
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  for (const layer of layers) {
    if (!layer.bitmap || layer.hidden) continue;
    const bmp = layer.bitmap;
    const ar = bmp.width / bmp.height;
    const car = width / height;
    let dw;
    let dh;
    if (ar > car) {
      dh = height * layer.baseScale;
      dw = dh * ar;
    } else {
      dw = width * layer.baseScale;
      dh = dw / ar;
    }
    const pulse = layer.playing ? 0.04 * Math.sin(tSec * 2.1 + layer.hue * 0.01) : 0;
    const opacity = Math.max(0, Math.min(1, layer.opacity + pulse));
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.filter = `hue-rotate(${layer.hueShift || 0}deg) brightness(${layer.brightness || 1}) contrast(${layer.contrast || 1})`;
    ctx.drawImage(bmp, cx - dw / 2 + (layer.pos?.x || 0), cy - dh / 2 + (layer.pos?.y || 0), dw, dh);
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function waitForGlobal(name, ms = 8000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (window[name]) return resolve(window[name]);
      if (Date.now() - t0 > ms) return reject(new Error(`${name} not ready`));
      requestAnimationFrame(poll);
    })();
  });
}

async function boot() {
  const stage = $('stage');
  const renderCanvas = $('render');
  const layerList = $('layer-list');
  const fileInput = $('jpg-input');
  if (!stage || !renderCanvas || !layerList || !fileInput) {
    throw new Error('jpg.html missing required DOM (#stage, #render, #layer-list, #jpg-input)');
  }

  window.SWR_DISABLE_ROTATION = true;
  window.SWR_DISABLE_ZOOM = true;
  window.SWR_KEYS_HOST_ROTATE = () => {};

  const layers = [];
  let selectedId = null;
  let playing = false;
  let rafId = 0;
  let t0 = performance.now();
  let personaIndex = 0;
  let recording = false;

  const personaKeys = () => {
    const P = window.Personas && window.Personas.PERSONAS;
    return P ? Object.keys(P) : [];
  };

  function renderPanel() {
    layerList.textContent = '';
    if (!layers.length) {
      const empty = document.createElement('p');
      empty.className = 'jpg-empty';
      empty.textContent = 'Upload stills to add layers.';
      layerList.appendChild(empty);
      return;
    }
    for (const layer of layers) {
      const card = document.createElement('div');
      card.className = 'layer-card' + (layer.id === selectedId ? ' selected' : '');
      card.dataset.id = layer.id;
      card.innerHTML = `<span class="layer-name">${layer.name}</span>
        <span class="layer-meta">hue ${Math.round(layer.meta?.hue || 0)}° · luma ${(layer.meta?.luma ?? 0).toFixed(2)}</span>
        <button type="button" class="tbtn ghost layer-remove" data-id="${layer.id}">×</button>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.layer-remove')) return;
        selectedId = layer.id;
        renderPanel();
      });
      card.querySelector('.layer-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeLayer(layer.id);
      });
      layerList.appendChild(card);
    }
  }

  function removeLayer(id) {
    const idx = layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const [layer] = layers.splice(idx, 1);
    try { layer.bitmap?.close?.(); } catch (_) {}
    if (selectedId === id) selectedId = layers[0]?.id || null;
    renderPanel();
    setStatus(`removed ${layer.name}`, 'ok');
  }

  function homeAll() {
    for (const layer of layers) {
      layer.pos = { x: 0, y: 0, rot: 0 };
      layer.rotOffset = 0;
      layer.hueShift = 0;
      layer.baseScale = 1;
      layer.opacity = 1;
    }
    setStatus('home — layers reset', 'ok');
  }

  window.Layers = {
    list: layers,
    selected: null,
    homeAll,
    render: renderPanel,
    remove: removeLayer,
    visibleList() {
      return layers.filter((l) => !l.hidden);
    },
  };

  const feat = { bass: 0, mid: 0, treble: 0, beat: 0, rms: 0.08, centroid: 0.5 };
  window.SWR = {
    Audio: {
      playing,
      feat,
      play() { playing = true; },
      pause() { playing = false; },
    },
  };

  const cssFxActive = new Set();
  const cssCatalog = [
    { name: 'film-grain', label: 'Film Grain' },
    { name: 'vhs', label: 'VHS' },
    { name: 'hue-shift', label: 'Hue Shift' },
    { name: 'light-leak', label: 'Light Leak' },
    { name: 'dreamy', label: 'Dreamy' },
    { name: 'retro', label: 'Retro' },
  ].filter((f) => !JPG_BLOCKED_CSS_FX.has(f.name));

  function syncCssFx() {
    for (const name of JPG_BLOCKED_CSS_FX) stage.classList.remove(name);
    for (const name of cssFxActive) stage.classList.add(name);
  }

  function applyPersonaByKey(key) {
    const P = window.Personas;
    if (!P || typeof P.apply !== 'function') return;
    if (key === 'off' || !key) {
      P.apply('off');
      stage.dataset.persona = 'off';
      return;
    }
    const raw = P.PERSONAS[key];
    if (!raw) return;
    const profile = personaForJpg(raw);
    if (window.FX && typeof window.FX.setPersona === 'function') {
      window.FX.setPersona(profile);
    }
    P.state.currentKey = key;
    stage.dataset.persona = key;
    setStatus(`persona: ${raw.label}`, 'ok');
  }

  function cyclePersona() {
    const keys = personaKeys();
    if (!keys.length) return;
    personaIndex = (personaIndex + 1) % keys.length;
    applyPersonaByKey(keys[personaIndex]);
  }

  function frame(now) {
    const tSec = (now - t0) / 1000;
    if (playing) {
      feat.beat = 0.35 + 0.25 * Math.sin(tSec * 3.2);
      feat.rms = 0.12 + 0.06 * Math.sin(tSec * 1.7);
      feat.bass = feat.rms * 0.8;
      feat.mid = feat.rms * 0.5;
      feat.treble = feat.rms * 0.3;
    } else {
      feat.beat = 0;
      feat.rms = 0.06;
      feat.bass = feat.mid = feat.treble = 0.04;
    }
    for (const layer of layers) layer.playing = playing;

    fitCanvas(renderCanvas, stage);
    const ctx = renderCanvas.getContext('2d');
    drawLayerStack(ctx, layers, tSec);
    rafId = requestAnimationFrame(frame);
  }

  async function addFiles(fileList) {
    const rejected = [];
    const accepted = [];
    for (const file of fileList) {
      if (!file) continue;
      const type = (file.type || '').toLowerCase();
      const name = file.name || '';
      if (HEIC_HINT.test(type) || HEIC_HINT.test(name)) {
        rejected.push(`${name || 'HEIC file'} (HEIC/HEIF not supported — export as JPEG or PNG)`);
        continue;
      }
      if (!JPG_SUPPORTED_IMAGE_TYPES.has(type)) {
        rejected.push(`${name || type || 'file'} (unsupported — use JPEG, PNG, or WebP)`);
        continue;
      }
      accepted.push(file);
    }
    if (rejected.length) setStatus(rejected.join('; '), 'warn');

    const media = window.SWR_MEDIA;
    if (!media || typeof media.addMedia !== 'function') {
      setStatus('media store not loaded', 'err');
      return;
    }

    for (const file of accepted) {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch (e) {
        rejected.push(`${file.name}: decode failed`);
        continue;
      }
      const meta = classifyStill(bitmap);
      let assetId = null;
      try {
        const rows = await media.addMedia([file]);
        assetId = rows[0]?.id || null;
      } catch (_) { /* local layer still works without IDB */ }

      const layer = {
        id: 'L' + (layers.length + 1),
        name: file.name || 'still',
        bitmap,
        assetId,
        meta,
        rotationEnabled: false,
        hidden: false,
        blend: 'source-over',
        opacity: 1,
        baseScale: 1,
        brightness: 1,
        contrast: 1,
        hueShift: 0,
        pos: { x: 0, y: 0, rot: 0 },
        rotOffset: 0,
        playing: false,
      };
      layers.push(layer);
      selectedId = layer.id;
    }
    renderPanel();
    const empty = $('stage-empty');
    if (empty) empty.classList.toggle('hidden', layers.length > 0);
    if (accepted.length) setStatus(`added ${accepted.length} still layer(s)`, 'ok');
  }

  async function recordSeconds(sec) {
    const duration = Math.max(1, Math.min(120, Number(sec) || 10));
    const captureCanvas = (window.FX && window.FX.outputCanvas) || renderCanvas;
    if (recording) return;
    recording = true;
    const recBtn = $('rec');
    if (recBtn) recBtn.disabled = true;
    setStatus(`recording ${duration}s…`, 'live');

    const wasPlaying = playing;
    playing = true;
    window.SWR.Audio.playing = true;

    const mime = pickMime();
    const stream = captureCanvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
      rec.onerror = () => reject(rec.error || new Error('MediaRecorder error'));
    });

    rec.start(250);
    await new Promise((r) => setTimeout(r, duration * 1000));
    try { rec.stop(); } catch (_) {}
    let blob;
    try {
      blob = await done;
    } catch (e) {
      setStatus(String(e.message || e), 'err');
      recording = false;
      playing = wasPlaying;
      window.SWR.Audio.playing = wasPlaying;
      if (recBtn) recBtn.disabled = false;
      return;
    }

    playing = wasPlaying;
    window.SWR.Audio.playing = wasPlaying;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sainted-word-jpg-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    recording = false;
    if (recBtn) recBtn.disabled = false;
    setStatus('recording saved (.webm)', 'ok');
  }

  fileInput.addEventListener('change', (e) => {
    const files = e.target.files ? [...e.target.files] : [];
    addFiles(files);
    e.target.value = '';
  });

  $('remap')?.addEventListener('click', () => cyclePersona());
  $('play')?.addEventListener('click', () => {
    playing = !playing;
    window.SWR.Audio.playing = playing;
    $('play').textContent = playing ? '■ STOP' : '▶ PLAY';
    setStatus(playing ? 'playing' : 'stopped', playing ? 'live' : 'ok');
  });
  $('rec')?.addEventListener('click', () => {
    const sec = $('duration')?.value;
    recordSeconds(sec);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
    if (ev.altKey && ev.code.startsWith('Digit')) {
      const n = Number(ev.code.replace('Digit', ''));
      const keys = personaKeys();
      if (n >= 1 && n <= 9 && keys[n - 1]) {
        ev.preventDefault();
        applyPersonaByKey(keys[n - 1]);
      }
    }
  });

  const fxGrid = $('css-fx-grid');
  if (fxGrid) {
    for (const fx of cssCatalog) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'css-fx-chip';
      btn.textContent = fx.label;
      btn.addEventListener('click', () => {
        if (cssFxActive.has(fx.name)) cssFxActive.delete(fx.name);
        else cssFxActive.add(fx.name);
        btn.classList.toggle('on', cssFxActive.has(fx.name));
        syncCssFx();
      });
      fxGrid.appendChild(btn);
    }
  }

  await waitForGlobal('SWR_MEDIA').catch(() => null);
  await waitForGlobal('FX').catch(() => null);
  await waitForGlobal('Personas').catch(() => null);

  if (personaKeys().length) applyPersonaByKey(personaKeys()[0]);

  rafId = requestAnimationFrame(frame);

  window.SWR_JPG = {
    layers,
    classifyStill,
    personaForJpg,
    cyclePersona,
    homeAll,
    JPG_BLOCKED_CSS_FX,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot().catch((e) => setStatus(e.message, 'err')); });
  } else {
    boot().catch((e) => setStatus(e.message, 'err'));
  }
}
