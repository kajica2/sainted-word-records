// ar-gif.client.js — AR GIF page logic.
//
// Loads A-Frame + AR.js on demand (they're heavy, ~500KB combined), parses
// the user-uploaded GIF, and mounts a Three.js scene that renders the GIF
// as a texture on a camera-tracked plane.
//
// Flow:
//   1. User drops/picks a GIF
//   2. We preview it as a flat <img>
//   3. User clicks START AR → we inject A-Frame + AR.js scripts
//   4. Camera permission requested
//   5. Scene mounts with the GIF as a textured plane
//   6. Plane auto-rotates and is anchored to camera position

(function () {
  'use strict';

  const els = {
    emptyState: document.getElementById('empty-state'),
    previewState: document.getElementById('preview-state'),
    previewImg: document.getElementById('preview-img'),
    previewMeta: document.getElementById('preview-meta'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    btnPick: document.getElementById('btn-pick'),
    btnStart: document.getElementById('btn-start'),
    btnGrant: document.getElementById('btn-grant'),
    status: document.getElementById('status'),
    infoText: document.getElementById('info-text'),
    infoMeta: document.getElementById('info-meta'),
    arOverlay: document.getElementById('ar-overlay'),
    permPrompt: document.getElementById('perm-prompt'),
    stage: document.getElementById('stage'),
  };

  let gifBlob = null;
  let gifUrl = null;
  let gifMeta = { width: 0, height: 0, frames: 0 };

  // === GIF loading ===
  async function handleFile(file) {
    if (!file) return;
    if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
      setStatus('ERROR', 'Not a GIF');
      return;
    }

    setStatus('LOADING', 'Reading GIF');
    gifBlob = file;

    // Revoke previous URL
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    gifUrl = URL.createObjectURL(file);

    // Parse metadata using omggif
    try {
      const buf = await file.arrayBuffer();
      const gif = new window.omggif.GifReader(new Uint8Array(buf));
      gifMeta.width = gif.width;
      gifMeta.height = gif.height;
      gifMeta.frames = gif.numFrames();
    } catch (e) {
      console.warn('omggif parse failed, using fallback', e);
      const img = new Image();
      img.src = gifUrl;
      await img.decode().catch(() => {});
      gifMeta.width = img.naturalWidth;
      gifMeta.height = img.naturalHeight;
      gifMeta.frames = 1;
    }

    // Show preview
    els.previewImg.src = gifUrl;
    els.previewMeta.textContent =
      `${file.name} · ${gifMeta.width}×${gifMeta.height} · ${gifMeta.frames} frame${gifMeta.frames === 1 ? '' : 's'}`;
    els.emptyState.style.display = 'none';
    els.previewState.style.display = 'flex';

    els.btnStart.disabled = false;
    setStatus('READY', `GIF loaded · ${gifMeta.frames} frames`);
    els.infoText.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }

  // === AR.js loading (on demand) ===
  let scriptsLoaded = false;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async function loadARLibs() {
    if (scriptsLoaded) return;
    els.arOverlay.querySelector('.msg').innerHTML = 'Loading A-Frame…<small>~500KB</small>';
    await loadScript('https://aframe.io/releases/1.4.0/aframe.min.js');
    els.arOverlay.querySelector('.msg').innerHTML = 'Loading AR.js…<small>markerless tracking</small>';
    await loadScript('https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js');
    scriptsLoaded = true;
  }

  // === Scene setup ===
  async function startAR() {
    if (!gifUrl) return;
    setStatus('STARTING', 'Loading AR libs');
    els.arOverlay.classList.add('show');

    try {
      await loadARLibs();
    } catch (e) {
      setStatus('ERROR', 'AR load failed');
      els.arOverlay.classList.remove('show');
      alert('Failed to load AR libraries. Check your network connection.');
      return;
    }

    // Request camera permission
    els.arOverlay.querySelector('.msg').innerHTML = 'Granting camera…<small>AR.js needs webcam</small>';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach(t => t.stop()); // AR.js will re-open it
    } catch (e) {
      setStatus('ERROR', 'Camera denied');
      els.arOverlay.classList.remove('show');
      els.permPrompt.style.display = 'flex';
      return;
    }

    // Build scene
    els.previewState.style.display = 'none';
    els.stage.insertAdjacentHTML('beforeend', `
      <a-scene embedded arjs="sourceType: webcam; detectionMode: mono; debugUIEnabled: false;" vr-mode-ui="enabled: false">
        <a-assets>
          <img id="user-gif" src="${gifUrl}" crossorigin="anonymous">
        </a-assets>
        <a-plane
          material="src: #user-gif; transparent: true; side: double"
          position="0 0 -2"
          rotation="0 0 0"
          width="1.5" height="${(1.5 * gifMeta.height / gifMeta.width).toFixed(3)}"
          animation="property: rotation; to: 0 360 0; loop: true; dur: 6000; easing: linear">
        </a-plane>
        <a-entity camera></a-entity>
      </a-scene>
    `);

    // Wait for scene to initialize
    const scene = document.querySelector('a-scene');
    scene.addEventListener('loaded', () => {
      els.arOverlay.classList.remove('show');
      setStatus('LIVE', 'AR running');
      els.infoText.textContent = 'AR active · move camera to see the plane from different angles';
      els.infoMeta.innerHTML = `<span><b>${gifMeta.width}×${gifMeta.height}</b></span><span><b>${gifMeta.frames}</b> frames</span>`;
    });

    setStatus('LIVE', 'AR scene ready');
  }

  // === Helpers ===
  function setStatus(kind, text) {
    els.status.textContent = text;
    els.status.className = 'pill ' + (kind === 'LIVE' || kind === 'READY' ? 'live' : '');
  }

  // === Event wiring ===
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  els.dropZone.addEventListener('click', (e) => {
    // Don't trigger label twice if clicking the input
    if (e.target.tagName !== 'INPUT') els.fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(evt => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('drag');
    });
  });
  els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  els.btnPick.addEventListener('click', () => els.fileInput.click());
  els.btnStart.addEventListener('click', startAR);
  els.btnGrant.addEventListener('click', () => {
    els.permPrompt.style.display = 'none';
    startAR();
  });

  // === Init ===
  setStatus('IDLE', 'Drop a GIF');
})();
