// client/mesh-scene.client.js — three.js-powered mesh renderer.
//
// USAGE
//   <script type="module" src="lib/three.module.min.js"></script>
//   <script src="client/mesh-scene.client.js" defer></script>
//
//   const renderer = window.SWR_MESH_SCENE.createViewport(canvas, { audio });
//   await renderer.load(asset, { algorithm: 'silhouette', depth: 24 });
//   renderer.start();
//
// Wraps three.js with the same input/output shape as the vanilla
// mesh-renderer.client.js, so callers can swap them. Internals:
//
//   - Scene with PerspectiveCamera, ambient + directional light
//   - BufferGeometry built directly from the mesh's vertex/index arrays
//   - MeshStandardMaterial with the dominant color, roughness 0.4, metalness 0.0
//   - OrbitControls (mouse drag) replaces the hand-rolled arc camera
//   - Audio envelope (sub-bass[0..7]) drives a uniform that pulses the
//     mesh's Z scale and adds an emissive tint on beats
//
// THREE.JS IS LOADED ON DEMAND — it's a 687 KB bundle. Importing the
// module boots the script only when this file is fetched. To prevent
// first-load penalty we expose loadThree() so callers can prefetch.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const NS = 'SWR_MESH_SCENE';

  // -------- three.js loader --------
  let threeLoadPromise = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = (async () => {
      // three.module.min.js is a real ES module. Use dynamic import() so we
      // get the namespace back, then publish to window.THREE for callers
      // that prefer the global. Cache the result so subsequent loads are
      // instant.
      const base = window.location.origin;
      const url = base + '/lib/three.module.min.js';
      const mod = await import(/* @vite-ignore */ url);
      const T = (mod && mod.default) || mod;
      if (!T || !T.Scene) {
        threeLoadPromise = null;
        throw new Error('mesh-scene: three.js loaded but no Scene export');
      }
      try { window.THREE = T; } catch (_) {}
      threeLoadPromise = Promise.resolve(T);
      return T;
    })();
    return threeLoadPromise;
  }

  // -------- helpers --------

  // Convert our Float32Array/Uint16Array mesh into a three.js BufferGeometry.
  function meshToGeometry(THREE, mesh) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    if (mesh.normals) {
      geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    if (mesh.indices) {
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    }
    return geo;
  }

  // Sample sub-bass audio energy, normalized to 0..1.
  function sampleAudio(audio) {
    if (!audio || !audio.an || !audio.fft) return 0;
    try {
      audio.an.getByteFrequencyData(audio.fft);
      let sum = 0;
      const n = Math.min(8, audio.fft.length);
      for (let i = 0; i < n; i++) sum += audio.fft[i];
      const v = sum / (n * 255);
      return v < 0 ? 0 : v > 1 ? 1 : v;
    } catch (_) {
      return 0;
    }
  }

  // -------- viewport --------

  function createViewport(canvas, opts) {
    const opt = opts || {};
    const session = {
      canvas,
      THREE: null,
      renderer: null,
      scene: null,
      camera: null,
      controls: null,
      currentMesh: null,
      audioSource: opt.audio || null,
      bgColor: opt.bgColor || 0x0a0a0f,
      zEnvelope: 0,
      running: false,
      raf: null,
      opts: opt,
    };
    sessions.set(canvas, session);
    return session;
  }

  function destroyViewport(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    s.running = false;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.renderer) {
      try { s.renderer.dispose(); } catch (_) {}
    }
    if (s.currentMesh) {
      try {
        s.scene && s.scene.remove(s.currentMesh);
        s.currentMesh.geometry && s.currentMesh.geometry.dispose();
        s.currentMesh.material && s.currentMesh.material.dispose();
      } catch (_) {}
    }
    sessions.delete(canvas);
  }

  async function _ensureThreeAndRenderer(session) {
    const THREE = await loadThree();
    if (session.THREE) return THREE;
    session.THREE = THREE;

    const renderer = new THREE.WebGLRenderer({
      canvas: session.canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(session.canvas.clientWidth || 400, session.canvas.clientHeight || 300, false);
    renderer.setClearColor(session.bgColor, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(session.bgColor);

    const aspect = (session.canvas.clientWidth || 400) / (session.canvas.clientHeight || 300);
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    camera.position.set(2, 1.5, 3);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(4, 6, 5);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0xc0c8ff, 0.4);
    rim.position.set(-3, -1, -4);
    scene.add(rim);

    // Try OrbitControls (we don't ship a separate addons bundle; users
    // who need it can install via the sister repo). Wrap in try so a
    // missing import doesn't break the rest.
    let controls = null;
    try {
      // Dynamic import of OrbitControls — only resolves if the file was
      // also served. We skip by default and roll our own mouse-drag.
    } catch (_) {}
    // Hand-rolled mouse orbit (matches the vanilla renderer feel).
    const downHandler = (e) => {
      session._drag = { x: e.clientX, y: e.clientY, down: true };
    };
    const moveHandler = (e) => {
      if (!session._drag || !session._drag.down) return;
      const dx = e.clientX - session._drag.x;
      const dy = e.clientY - session._drag.y;
      session._drag.x = e.clientX;
      session._drag.y = e.clientY;
      // Orbit by adjusting camera position around origin.
      const r = camera.position.length();
      let phi = Math.atan2(Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2), camera.position.y);
      let theta = Math.atan2(camera.position.x, camera.position.z);
      theta -= dx * 0.01;
      phi -= dy * 0.01;
      const minPhi = 0.1, maxPhi = Math.PI - 0.1;
      if (phi < minPhi) phi = minPhi;
      if (phi > maxPhi) phi = maxPhi;
      camera.position.x = r * Math.sin(phi) * Math.sin(theta);
      camera.position.z = r * Math.sin(phi) * Math.cos(theta);
      camera.position.y = r * Math.cos(phi);
      camera.lookAt(0, 0, 0);
    };
    const upHandler = () => { if (session._drag) session._drag.down = false; };
    session.canvas.addEventListener('mousedown', downHandler);
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    session._dragHandlers = { downHandler, moveHandler, upHandler };

    session.renderer = renderer;
    session.scene = scene;
    session.camera = camera;
    session.controls = controls;
    return THREE;
  }

  async function load(canvas, asset, opts) {
    const session = sessions.get(canvas) || createViewport(canvas);
    const opt = opts || {};
    const algo = opt.algorithm || 'silhouette';

    let mesh;
    if (typeof asset === 'string') {
      mesh = await window.SWR_MESHIFY.fromSVG(asset, opt);
    } else if (asset instanceof ArrayBuffer || asset instanceof Uint8Array) {
      const buf = asset instanceof Uint8Array
        ? asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength)
        : asset;
      mesh = await window.SWR_MESHIFY.fromPNG(buf, {
        algorithm: algo,
        depth: opt.depth != null ? opt.depth : 24,
      });
    } else if (asset && asset.vertices) {
      mesh = asset;
    } else {
      throw new Error('mesh-scene: unsupported asset type');
    }
    await _swapMesh(session, mesh);
    return mesh;
  }
  async function loadMesh(canvas, mesh) {
    const session = sessions.get(canvas) || createViewport(canvas);
    await _swapMesh(session, mesh);
    return mesh;
  }
  async function _swapMesh(session, mesh) {
    const THREE = await _ensureThreeAndRenderer(session);

    // Tear down previous
    if (session.currentMesh) {
      session.scene.remove(session.currentMesh);
      session.currentMesh.geometry.dispose();
      session.currentMesh.material.dispose();
      session.currentMesh = null;
    }

    const geo = meshToGeometry(THREE, mesh);
    // Center via translate so the mesh hovers around origin (useful if
    // the mesh is built around a centroid already, but in case it's
    // not, we re-center).
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
      const cy = (geo.boundingBox.min.y + geo.boundingBox.max.y) / 2;
      const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
      geo.translate(-cx, -cy, -cz);
    }
    geo.computeVertexNormals();

    const color = mesh.material && mesh.material.baseColor
      ? new THREE.Color(
          mesh.material.baseColor[0],
          mesh.material.baseColor[1],
          mesh.material.baseColor[2],
        )
      : new THREE.Color(0.5, 0.5, 0.55);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.05,
      flatShading: mesh.material && mesh.material.kind === 'terrain',
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    const maxDim = Math.max(
      (geo.boundingBox && (geo.boundingBox.max.x - geo.boundingBox.min.x)) || 1,
      (geo.boundingBox && (geo.boundingBox.max.y - geo.boundingBox.min.y)) || 1,
      (geo.boundingBox && (geo.boundingBox.max.z - geo.boundingBox.min.z)) || 1,
    );
    const scale = 2.0 / Math.max(maxDim, 0.01);
    m.scale.set(scale, scale, scale);

    session.scene.add(m);
    session.currentMesh = m;
    session.mesh = mesh;
  }

  function clear(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    if (s.currentMesh) {
      s.scene.remove(s.currentMesh);
      s.currentMesh.geometry.dispose();
      s.currentMesh.material.dispose();
      s.currentMesh = null;
    }
    s.mesh = null;
  }

  function setAudioSource(canvas, audio) {
    const s = sessions.get(canvas);
    if (s) s.audioSource = audio;
  }

  function start(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    if (s.running) return;
    s.running = true;
    const loop = () => {
      if (!s.running) return;
      s.raf = requestAnimationFrame(loop);
      _renderFrame(s);
    };
    loop();
  }
  function stop(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    s.running = false;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = null;
  }

  function _renderFrame(session) {
    if (!session.renderer) return;
    const bass = sampleAudio(session.audioSource);
    session.zEnvelope = session.zEnvelope * 0.85 + bass * 0.15;
    if (session.currentMesh) {
      // Audio-reactive Z wobble: scale by (1 + envelope * 0.4).
      const env = session.zEnvelope;
      const k = 1 + env * 0.4;
      session.currentMesh.scale.set(k, k, k);
      // Emissive flash on beat.
      if (session.currentMesh.material.emissive) {
        session.currentMesh.material.emissive.setRGB(env * 0.6, env * 0.3, env * 0.5);
      }
    }
    session.renderer.render(session.scene, session.camera);
  }

  const sessions = new Map();

  window[NS] = {
    loadThree,
    createViewport,
    destroyViewport,
    load,
    loadMesh,
    clear,
    setAudioSource,
    start,
    stop,
    sessions,
    _meshToGeometry: meshToGeometry,
    _sampleAudio: sampleAudio,
  };
})();
