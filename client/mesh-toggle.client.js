// client/mesh-toggle.client.js — Wire the three.js mesh scene into music_video.html.
//
// USAGE (just include via <script src=... defer></script>)
//   <canvas id="render"></canvas>          ← existing 2D canvas (untouched)
//   <canvas id="render-3d" hidden></canvas> ← injected by this module
//   <button id="mesh-toggle"></button>      ← injected by this module
//
// Toggle behavior:
//   * "2D" (default) — render canvas visible, engine drives it; render-3d hidden
//   * "3D"            — render canvas hidden, render-3d visible, mesh scene running
//   * Click to flip. Click again to flip back. State persists across reloads.
//
// Mesh selection:
//   * On first 3D enable, picks the first item in the Library that looks like
//     a transparent PNG / gift bag / reasonable silhouette source.
//   * "Rotate mesh" button cycles through Lib.items each click.
//   * If nothing is loaded, the toggle shows a friendly "drop a PNG first"
//     message — no console errors, no broken scene.
//
// Audio:
//   * The mesh scene's audio source is window.SWR && window.SWR.Audio
//   * Falls back to silent envelope (envelope=0) if audio isn't ready.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const NS = 'SWR_MESH_TOGGLE';
  const STATE_KEY = 'swr.meshToggle.state';

  function pickFirstReasonableAsset() {
    const Lib = window.SWR && window.SWR.Library;
    if (!Lib || !Lib.items) return null;
    const items = Lib.items;
    // Prefer: (1) transparent PNGs, (2) PNGs, (3) any image.
    const transparent = items.find((it) =>
      it && (it.folder === 'transparent-pngs' ||
             it.folder === 'gift-bags' ||
             it.folder === 'gifts' ||
             (it.packId === 'gifts')));
    if (transparent) return transparent;
    const png = items.find((it) => it && /\.png$/i.test(it.name || it.url || ''));
    if (png) return png;
    const img = items.find((it) => it && (it.kind === 'image' || /\.jpe?g$/i.test(it.name || it.url || '')));
    return img || items[0] || null;
  }

  async function loadAssetBytes(item) {
    if (!item) return null;
    if (item.file && item.file instanceof Blob) {
      const buf = await item.file.arrayBuffer();
      return { bytes: new Uint8Array(buf), name: item.name || 'lib' };
    }
    if (item.url) {
      const r = await fetch(item.url, { cache: 'force-cache' });
      if (!r.ok) throw new Error('asset fetch: HTTP ' + r.status);
      const buf = await r.arrayBuffer();
      return { bytes: new Uint8Array(buf), name: item.name || (item.url.split('/').pop()) };
    }
    return null;
  }

  function ensureUI() {
    // Inject canvas + button if they don't exist.
    let canvas2d = document.getElementById('render');
    if (!canvas2d) return null;

    let canvas3d = document.getElementById('render-3d');
    if (!canvas3d) {
      canvas3d = document.createElement('canvas');
      canvas3d.id = 'render-3d';
      canvas3d.style.position = 'absolute';
      canvas3d.style.inset = '0';
      canvas3d.style.width = '100%';
      canvas3d.style.height = '100%';
      canvas3d.style.pointerEvents = 'auto';
      canvas3d.hidden = true;
      // Insert after the 2D canvas.
      canvas2d.parentNode.insertBefore(canvas3d, canvas2d.nextSibling);
    }

    let btn = document.getElementById('mesh-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'mesh-toggle';
      btn.className = 'tbtn';
      btn.type = 'button';
      btn.title = 'Toggle 3D mesh scene (three.js)';
      btn.textContent = '3D: off';
      btn.style.padding = '3px 6px';
      btn.style.fontSize = '9px';
      // Find a good place — append to the header.
      const header = document.querySelector('header') || document.body;
      header.appendChild(btn);
    }
    return { canvas2d, canvas3d, btn };
  }

  let session3d = null;
  let meshToggleState = false;

  // Local-media → 3D generation
  let lmsClient = null;
  let generateBtn = null;
  let lastPrompt = '';

  function getLMS() {
    if (!lmsClient && window.SWR_LOCAL_MEDIA) {
      try { lmsClient = window.SWR_LOCAL_MEDIA.connect(); } catch (_) {}
    }
    return lmsClient;
  }

  async function generateAndShow(ui, btn) {
    const lms = getLMS();
    if (!lms) {
      btn.title = 'SWR_LOCAL_MEDIA not available';
      btn.textContent = '✦ missing';
      return;
    }
    let prompt = (lastPrompt || '').trim();
    if (!prompt) {
      const entered = window.prompt('Describe the gift to generate a 3D mesh from:', 'a gift bag with a red ribbon');
      if (!entered) return;
      prompt = entered;
    }
    lastPrompt = prompt;

    btn.disabled = true;
    btn.textContent = '✦ generating…';
    btn.title = 'Asking local-media-studio to draw this. Space may take 30-60s to wake on first use.';
    try {
      // Subscribe to progress for a friendlier UI.
      lms.on('progress', () => {
        if (btn.textContent.indexOf('…') === -1) btn.textContent = '✦ generating…';
      });
      const result = await lms.generateImage({
        prompt,
        negative_prompt: 'blurry, watermark, distorted, ugly',
        width: 512,
        height: 512,
        steps: 30,
        cfg_scale: 7.5,
        seed: -1,
      });
      if (!result.bytes || !result.bytes.length) {
        throw new Error('Space returned no PNG bytes');
      }
      // Auto-enable 3D if not already on.
      if (!meshToggleState) {
        await enable3D(ui, btn);
      }
      // Load the new mesh.
      await window.SWR_MESH_SCENE.load(ui.canvas3d, result.bytes, {
        algorithm: 'silhouette',
        depth: 32,
      });
      btn.textContent = '✦ done';
      btn.title = `Last generated from: "${prompt.slice(0, 60)}"`;
      setTimeout(() => { btn.textContent = '✦ generate'; btn.disabled = false; }, 1400);
    } catch (e) {
      console.warn('generateAndShow failed:', e);
      btn.textContent = '✦ failed';
      btn.title = 'Generation failed: ' + (e.message || e);
      btn.disabled = false;
    }
  }

  async function enable3D(ui, btn) {
    if (session3d) return;
    btn.textContent = '3D: starting…';
    btn.disabled = true;
    try {
      // Load three.js (lazily) via the mesh-scene module.
      await window.SWR_MESH_SCENE.loadThree();

      // Create the viewport on #render-3d.
      session3d = window.SWR_MESH_SCENE.createViewport(ui.canvas3d, {
        audio: (window.SWR && window.SWR.Audio) || null,
        bgColor: 0x0a0a0f,
      });

      // Pick the first reasonable asset.
      const item = pickFirstReasonableAsset();
      let asset = null;
      if (item && item.blob && item.blob instanceof Blob) {
        // Library item with an in-memory blob — use it directly.
        const buf = await item.blob.arrayBuffer();
        asset = { bytes: new Uint8Array(buf), name: item.name || 'lib' };
      } else {
        try {
          asset = await loadAssetBytes(item);
        } catch (e) {
          console.warn('mesh-toggle: asset fetch failed, falling back to demo mesh:', e);
        }
      }
      if (asset && asset.bytes) {
        await window.SWR_MESH_SCENE.load(
          ui.canvas3d,
          asset.bytes,
          { algorithm: 'silhouette', depth: 32 }
        );
        btn.title = `Mesh from: ${asset.name} (click to flip)`;
      } else {
        // No usable library asset — synthesize a placeholder mesh from
        // a unit square so the 3D viewport isn't empty. The user can
        // load a real asset via the cycle button or the generate button.
        const placeholder = window.SWR_MESHIFY._extrudePolygon(
          [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]],
          24,
          [0.6, 0.4, 0.7, 1.0],
        );
        await window.SWR_MESH_SCENE.loadMesh(ui.canvas3d, placeholder);
        btn.title = 'No library asset available — showing a placeholder mesh. Drop a PNG into the library and click ↻ to use it.';
      }

      // Show the 3D canvas, hide the 2D.
      ui.canvas2d.hidden = true;
      ui.canvas3d.hidden = false;

      // Start the render loop.
      window.SWR_MESH_SCENE.start(ui.canvas3d);
      btn.textContent = '3D: on';
      btn.disabled = false;
      meshToggleState = true;
      try { localStorage.setItem(STATE_KEY, '1'); } catch (_) {}
    } catch (err) {
      console.error('3D toggle failed:', err);
      btn.textContent = '3D: failed';
      btn.title = err.message || String(err);
      // Clean up so the user can retry.
      if (session3d) {
        try { window.SWR_MESH_SCENE.destroyViewport(ui.canvas3d); } catch (_) {}
        session3d = null;
      }
      meshToggleState = false;
      btn.disabled = false;
    }
  }

  function disable3D(ui, btn) {
    if (!session3d) {
      // Just flip visibility.
      ui.canvas2d.hidden = false;
      ui.canvas3d.hidden = true;
      meshToggleState = false;
      btn.textContent = '3D: off';
      return;
    }
    window.SWR_MESH_SCENE.stop(ui.canvas3d);
    try { window.SWR_MESH_SCENE.destroyViewport(ui.canvas3d); } catch (_) {}
    session3d = null;
    ui.canvas2d.hidden = false;
    ui.canvas3d.hidden = true;
    meshToggleState = false;
    btn.textContent = '3D: off';
    try { localStorage.removeItem(STATE_KEY); } catch (_) {}
  }

  function toggleMesh(ui, btn) {
    if (meshToggleState) disable3D(ui, btn);
    else enable3D(ui, btn);
  }

  async function rotateMesh(ui, btn, cycleBtn) {
    if (!session3d) return;
    // Pick the next item in Lib.items cyclically.
    const Lib = window.SWR && window.SWR.Library;
    if (!Lib || !Lib.items || !Lib.items.length) {
      cycleBtn.title = 'Library empty — drop a PNG to test';
      return;
    }
    // Track current index in the module closure.
    if (typeof rotateMesh.idx !== 'number') rotateMesh.idx = -1;
    rotateMesh.idx = (rotateMesh.idx + 1) % Lib.items.length;
    const item = Lib.items[rotateMesh.idx];
    const asset = await loadAssetBytes(item);
    if (!asset) {
      rotateMesh(ui, btn, cycleBtn);
      return;
    }
    btn.textContent = '3D: rotating…';
    try {
      await window.SWR_MESH_SCENE.loadMesh(ui.canvas3d, null); // clear first
      await window.SWR_MESH_SCENE.load(ui.canvas3d, asset.bytes, {
        algorithm: 'silhouette',
        depth: 32,
      });
      btn.title = `Mesh from: ${asset.name} (next: cycle)`;
    } finally {
      btn.textContent = '3D: on';
    }
  }

  function mount() {
    const ui = ensureUI();
    if (!ui) return;
    const { btn } = ui;
    btn.addEventListener('click', () => toggleMesh(ui, btn));

    // Add a small "rotate / next" sub-button next to it.
    let cycleBtn = document.getElementById('mesh-cycle');
    if (!cycleBtn) {
      cycleBtn = document.createElement('button');
      cycleBtn.id = 'mesh-cycle';
      cycleBtn.className = 'tbtn';
      cycleBtn.type = 'button';
      cycleBtn.title = 'Cycle to next library asset in the 3D scene';
      cycleBtn.textContent = '↻';
      cycleBtn.style.padding = '3px 6px';
      cycleBtn.style.fontSize = '9px';
      cycleBtn.hidden = true;  // Only visible when 3D is on
      btn.parentNode.insertBefore(cycleBtn, btn.nextSibling);
    }
    cycleBtn.addEventListener('click', () => rotateMesh(ui, btn, cycleBtn));

    // Generate button: text → 2D PNG (via local-media-studio) → 3D mesh.
    let genBtn = document.getElementById('mesh-generate');
    if (!genBtn) {
      genBtn = document.createElement('button');
      genBtn.id = 'mesh-generate';
      genBtn.className = 'tbtn';
      genBtn.type = 'button';
      genBtn.title = 'Generate a 3D mesh from a text prompt (uses Hugging Face local-media-studio)';
      genBtn.textContent = '✦ generate';
      genBtn.style.padding = '3px 6px';
      genBtn.style.fontSize = '9px';
      genBtn.hidden = true;
      cycleBtn.parentNode.insertBefore(genBtn, cycleBtn.nextSibling);
      generateBtn = genBtn;
    }
    genBtn.addEventListener('click', () => generateAndShow(ui, btn));

    // Reflect 3D-on state in the cycle button too.
    const origEnable = enable3D;
    const origDisable = disable3D;
    const enable3DWrapped = async function (ui2, btn2) {
      await origEnable(ui2, btn2);
      cycleBtn.hidden = false;
      const gb = document.getElementById('mesh-generate');
      if (gb) gb.hidden = false;
    };
    const disable3DWrapped = function (ui2, btn2) {
      origDisable(ui2, btn2);
      cycleBtn.hidden = true;
      const gb = document.getElementById('mesh-generate');
      if (gb) gb.hidden = true;
    };
    // Replace the original toggleMesh handlers to use the wrapped versions.
    btn.removeEventListener('click', () => toggleMesh(ui, btn));
    btn.addEventListener('click', () => {
      if (meshToggleState) disable3DWrapped(ui, btn);
      else enable3DWrapped(ui, btn);
    });

    // Restore previous state if we were 3D-on at last visit.
    let prev = null;
    try { prev = localStorage.getItem(STATE_KEY); } catch (_) {}
    if (prev === '1') {
      // Defer until the library has loaded anything.
      const tryLater = () => {
        if (!document.body.contains(ui.canvas3d)) return;
        const Lib = window.SWR && window.SWR.Library;
        if (Lib && Lib.items && Lib.items.length) {
          enable3DWrapped(ui, btn);
        } else {
          setTimeout(tryLater, 500);
        }
      };
      setTimeout(tryLater, 1000);
    }
  }

  // Exposed for tests.
  window[NS] = {
    pickFirstReasonableAsset,
    loadAssetBytes,
    enable3D,
    disable3D,
    meshToggleState: () => meshToggleState,
    getSession3D: () => session3d,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
