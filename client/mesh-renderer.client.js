// client/mesh-renderer.client.js — Render 3D meshes from meshify.client.js
// using vanilla WebGL.
//
// USAGE (browser)
//   const ctx = window.SWR_MESH_RENDER.createViewport(canvas, { width, height });
//   await window.SWR_MESH_RENDER.load(asset, options);     // auto-detects PNG or SVG
//   await window.SWR_MESH_RENDER.loadMesh(mesh);            // or pass a prebuilt mesh
//   window.SWR_MESH_RENDER.start();
//   window.SWR_MESH_RENDER.stop();
//
// The renderer:
//   - Uses a single program: ambient + lambertian diffuse + simple rim
//   - Camera is a fixed orbiting arc-camera (mouse drag adjusts azimuth/elevation)
//   - Audio (window.SWR.Audio) is sampled each frame for sub-bass energy,
//     which scales vertex Z by an envelope factor
//   - Three algorithms render with subtle visual differences:
//       silhouette: flat color, slight rim
//       heightmap: vertex-color lit (each vert uses its Z-derived intensity)
//       svg-path: flat color, sharp rim
//
// The renderer does NOT touch any existing 2D engine. It mounts on a
// user-provided canvas (typically a child of the music_video stage).

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  const NS = 'SWR_MESH_RENDER';

  // ---------------- shader sources ----------------
  const VS = `
    attribute vec3 a_pos;
    attribute vec3 a_normal;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform mat4 u_model;
    uniform float u_zEnvelope;     // 0..1 audio-driven
    varying vec3 v_normal;
    varying float v_zLocal;
    varying float v_envelope;
    void main() {
      v_normal = mat3(u_model) * a_normal;
      v_zLocal = a_pos.z;
      v_envelope = u_zEnvelope;
      vec3 pos = a_pos;
      pos.z *= 1.0 + u_zEnvelope * 0.6;   // reactive wobble
      gl_Position = u_proj * u_view * u_model * vec4(pos, 1.0);
    }
  `;
  const FS = `
    precision mediump float;
    varying vec3 v_normal;
    varying float v_zLocal;
    varying float v_envelope;
    uniform vec4 u_baseColor;
    uniform vec3 u_lightDir;
    uniform float u_zMax;

    void main() {
      vec3 n = normalize(v_normal);
      float lambert = max(dot(n, normalize(u_lightDir)), 0.0);
      vec3 ambient = u_baseColor.rgb * 0.35;
      vec3 diffuse = u_baseColor.rgb * lambert;
      // Rim light via fresnel-ish term — strongest at glancing angles.
      float rim = pow(1.0 - max(n.z, 0.0), 2.5);
      vec3 rim_col = vec3(0.85, 0.92, 1.0) * rim * 0.4;
      // For terrain (z > 0), brighten high points to read as height.
      float height = clamp(v_zLocal / (u_zMax * 0.5 + 0.001), 0.0, 1.0);
      vec3 heightTint = vec3(1.0, 0.9, 0.7) * height * 0.15;
      vec3 col = ambient + diffuse + rim_col + heightTint;
      // Audio envelope brightens on the beat.
      col += vec3(0.3, 0.2, 0.4) * v_envelope * 0.25;
      gl_FragColor = vec4(col, u_baseColor.a);
    }
  `;

  // ---------------- helpers ----------------
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('mesh-renderer shader compile failed: ' + log);
    }
    return sh;
  }
  function link(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('mesh-renderer program link failed: ' + log);
    }
    return prog;
  }
  function ortho(out, left, right, bottom, top, near, far) {
    out[0] = 2 / (right - left); out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 2 / (top - bottom); out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = -2 / (far - near); out[11] = 0;
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);
    out[15] = 1;
    return out;
  }
  // 4x4 matrix multiply (column-major)
  function mul(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    let b0, b1, b2, b3;
    b0 = b[0];  b1 = b[1];  b2 = b[2];  b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4];  b1 = b[5];  b2 = b[6];  b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8];  b1 = b[9];  b2 = b[10]; b3 = b[11];
    out[8]  = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9]  = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  }
  // Look-at matrix
  function lookAt(out, eyeX, eyeY, eyeZ, cx, cy, cz, upX, upY, upZ) {
    let fx = cx - eyeX, fy = cy - eyeY, fz = cz - eyeZ;
    let len = Math.hypot(fx, fy, fz); if (!len) len = 1; fx /= len; fy /= len; fz /= len;
    let sx = fy * upZ - fz * upY;
    let sy = fz * upX - fx * upZ;
    let sz = fx * upY - fy * upX;
    len = Math.hypot(sx, sy, sz); if (!len) len = 1; sx /= len; sy /= len; sz /= len;
    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;
    out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
    out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
    out[14] = (fx * eyeX + fy * eyeY + fz * eyeZ);
    out[15] = 1;
    return out;
  }
  // Scale matrix (uniform)
  function scale(out, s) {
    out[0] = s; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = s; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = s; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  // ---------------- state ----------------
  const sessions = new Map();

  function createViewport(canvas, opts) {
    const ctx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!ctx) throw new Error('mesh-renderer: WebGL not supported on this canvas');
    const opt = opts || {};
    const session = {
      gl: ctx,
      canvas,
      prog: link(ctx, compile(ctx, ctx.VERTEX_SHADER, VS), compile(ctx, ctx.FRAGMENT_SHADER, FS)),
      buffers: null,
      mesh: null,
      azimuth: -Math.PI / 4,
      elevation: Math.PI / 8,
      distance: 2.0,
      running: false,
      raf: null,
      cursor: { down: false, x: 0, y: 0 },
      zEnvelope: 0,
      audioSource: opt.audio || null,
      bgColor: opt.bgColor || [0.05, 0.05, 0.07, 1.0],
      dragEvent: null,
    };
    session.attrs = {
      pos: ctx.getAttribLocation(session.prog, 'a_pos'),
      normal: ctx.getAttribLocation(session.prog, 'a_normal'),
    };
    session.uniforms = {
      proj: ctx.getUniformLocation(session.prog, 'u_proj'),
      view: ctx.getUniformLocation(session.prog, 'u_view'),
      model: ctx.getUniformLocation(session.prog, 'u_model'),
      zEnvelope: ctx.getUniformLocation(session.prog, 'u_zEnvelope'),
      baseColor: ctx.getUniformLocation(session.prog, 'u_baseColor'),
      lightDir: ctx.getUniformLocation(session.prog, 'u_lightDir'),
      zMax: ctx.getUniformLocation(session.prog, 'u_zMax'),
    };
    ctx.enable(ctx.DEPTH_TEST);
    ctx.enable(ctx.CULL_FACE);
    ctx.cullFace(ctx.BACK);

    // Mouse drag to orbit camera.
    const downHandler = (e) => {
      session.cursor.down = true;
      session.cursor.x = e.clientX;
      session.cursor.y = e.clientY;
    };
    const moveHandler = (e) => {
      if (!session.cursor.down) return;
      const dx = e.clientX - session.cursor.x;
      const dy = e.clientY - session.cursor.y;
      session.cursor.x = e.clientX;
      session.cursor.y = e.clientY;
      session.azimuth += dx * 0.01;
      session.elevation += dy * 0.01;
      if (session.elevation > Math.PI / 2 - 0.05) session.elevation = Math.PI / 2 - 0.05;
      if (session.elevation < -Math.PI / 2 + 0.05) session.elevation = -Math.PI / 2 + 0.05;
    };
    const upHandler = () => { session.cursor.down = false; };
    canvas.addEventListener('mousedown', downHandler);
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    session.dragEvent = { downHandler, moveHandler, upHandler };

    sessions.set(canvas, session);
    return session;
  }

  function destroyViewport(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    s.running = false;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.dragEvent) {
      s.canvas.removeEventListener('mousedown', s.dragEvent.downHandler);
      window.removeEventListener('mousemove', s.dragEvent.moveHandler);
      window.removeEventListener('mouseup', s.dragEvent.upHandler);
    }
    if (s.buffers) {
      s.gl.deleteBuffer(s.buffers.v);
      s.gl.deleteBuffer(s.buffers.n);
      s.gl.deleteBuffer(s.buffers.i);
    }
    s.gl.deleteProgram(s.prog);
    sessions.delete(canvas);
  }

  function uploadMesh(session, mesh) {
    const { gl } = session;
    if (session.buffers) {
      gl.deleteBuffer(session.buffers.v);
      gl.deleteBuffer(session.buffers.n);
      gl.deleteBuffer(session.buffers.i);
    }
    const vBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const nBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    const iBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    session.buffers = { v: vBuf, n: nBuf, i: iBuf };
    session.mesh = mesh;
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
      drawFrame(s);
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

  function sampleAudio(session) {
    const a = session.audioSource;
    if (!a) return 0;
    try {
      const fft = a.fft;
      if (!fft || !a.an) return 0;
      a.an.getByteFrequencyData(fft);
      // Sub-bass: average of first 8 bins (0..200Hz at 44.1k).
      let sum = 0;
      const n = Math.min(8, fft.length);
      for (let i = 0; i < n; i++) sum += fft[i];
      // Normalize 0..1.
      return clamp(sum / (n * 255), 0, 1);
    } catch (_) {
      return 0;
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function drawFrame(session) {
    const { gl } = session;
    const mesh = session.mesh;
    if (!mesh) {
      // Clear-only frame.
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(session.bgColor[0], session.bgColor[1], session.bgColor[2], session.bgColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }
    // Audio envelope: low-pass on raw bass band.
    const bass = sampleAudio(session);
    session.zEnvelope = session.zEnvelope * 0.85 + bass * 0.15;

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(session.bgColor[0], session.bgColor[1], session.bgColor[2], session.bgColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Fit mesh to viewport: scale to ~70% of min(width,height).
    const target = Math.min(gl.drawingBufferWidth, gl.drawingBufferHeight) * 0.7;
    const meshSize = Math.max(mesh.dims.width || 1, mesh.dims.height || 1, mesh.dims.depth || 1);
    const k = target / meshSize;

    // Projection: ortho would also work; perspective gives the depth feel.
    // Cheap perspective via Frustum-like look-at math is overkill here;
    // we use orthographic and rely on Z envelope to imply depth.
    const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
    const halfH = 100;
    const halfW = halfH * aspect;
    const proj = new Float32Array(16);
    ortho(proj, -halfW, halfW, -halfH, halfH, -200, 200);

    const eyeX = session.distance * Math.cos(session.elevation) * Math.sin(session.azimuth);
    const eyeY = session.distance * Math.sin(session.elevation);
    const eyeZ = session.distance * Math.cos(session.elevation) * Math.cos(session.azimuth);
    const view = new Float32Array(16);
    lookAt(view, eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
    const model = new Float32Array(16);
    scale(model, k);

    gl.useProgram(session.prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, session.buffers.v);
    gl.enableVertexAttribArray(session.attrs.pos);
    gl.vertexAttribPointer(session.attrs.pos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, session.buffers.n);
    gl.enableVertexAttribArray(session.attrs.normal);
    gl.vertexAttribPointer(session.attrs.normal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, session.buffers.i);

    gl.uniformMatrix4fv(session.uniforms.proj, false, proj);
    gl.uniformMatrix4fv(session.uniforms.view, false, view);
    gl.uniformMatrix4fv(session.uniforms.model, false, model);
    gl.uniform1f(session.uniforms.zEnvelope, session.zEnvelope);
    gl.uniform1f(session.uniforms.zMax, mesh.dims.depth || 24);
    gl.uniform3f(session.uniforms.lightDir, 0.4, 0.7, 0.55);
    gl.uniform4fv(session.uniforms.baseColor, mesh.material.baseColor);

    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  }

  // ---------------- public: high-level loaders ----------------
  async function load(canvas, asset, options) {
    const session = sessions.get(canvas) || createViewport(canvas);
    const opt = options || {};
    const algo = opt.algorithm || 'silhouette';

    let mesh;
    if (typeof asset === 'string') {
      // SVG text.
      mesh = await window.SWR_MESHIFY.fromSVG(asset, opt);
    } else if (asset instanceof ArrayBuffer || asset instanceof Uint8Array) {
      // PNG / JPEG bytes.
      const buf = asset instanceof Uint8Array
        ? asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength)
        : asset;
      mesh = await window.SWR_MESHIFY.fromPNG(buf, { algorithm: algo, depth: opt.depth != null ? opt.depth : 24 });
    } else if (asset && asset.vertices) {
      // Pre-built mesh object.
      mesh = asset;
    } else {
      throw new Error('mesh-renderer: unsupported asset type');
    }
    uploadMesh(session, mesh);
    return mesh;
  }
  async function loadMesh(canvas, mesh) {
    const session = sessions.get(canvas) || createViewport(canvas);
    uploadMesh(session, mesh);
    return mesh;
  }

  function clear(canvas) {
    const s = sessions.get(canvas);
    if (!s) return;
    s.mesh = null;
    if (s.buffers) {
      s.gl.deleteBuffer(s.buffers.v);
      s.gl.deleteBuffer(s.buffers.n);
      s.gl.deleteBuffer(s.buffers.i);
      s.buffers = null;
    }
  }

  window[NS] = {
    createViewport,
    destroyViewport,
    uploadMesh,
    load,
    loadMesh,
    clear,
    setAudioSource,
    start,
    stop,
    sessions,
    // Exposed for tests:
    _ortho: ortho,
    _lookAt: lookAt,
    _scale: scale,
    _mul: mul,
    _clamp: clamp,
    _sampleAudio: sampleAudio,
  };
})();
