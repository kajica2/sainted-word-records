// engine-3d.client.js — vanilla WebGL primitive renderer.
//
// INTEGRATION (read me before touching engine-core / render loop)
// =================================================================
// engine-3d.client.js registers window.SWR_3D with four built-in primitives
// (sphere, cube, torus, icosahedron) and a createLayer(primitiveId) factory
// that returns a self-contained WebGL asset suitable for the engine's
// drawImage path.
//
// The engine's render loop MUST do the following each frame, BEFORE drawing
// layers to the 2D canvas:
//
//   1. Compute `t` (seconds since engine start) and `A` (audio features,
//      A.feat = { bass, mid, treble, rms, beat, onset, ... }).
//   2. Call window.SWR_3D.tickAll(t, A) — this iterates every layer in
//      window.Layers.list() whose type === '3d', clears its WebGL context,
//      recomputes the MVP matrix, and renders one frame into the layer's
//      hidden 1080x1080 canvas.
//   3. Then run the normal drawLayer() pass — the 3D layer's canvas is a
//      regular <canvas> and the engine treats it like any other 2D asset
//      via ctx.drawImage(layer._el, ...).
//
// Minimal render-loop integration (drop into engine-core.client.js /
// engine-render.client.js):
//
//   function renderFrame(t, A) {
//     // (other engine prep: reactor update, layer visibility, etc.)
//     if (window.SWR_3D && window.SWR_3D.tickAll) window.SWR_3D.tickAll(t, A);
//     // ...existing drawLayer loop draws each layer.canvas (3d or otherwise)
//     // ...present frame
//   }
//
// CREATING A LAYER (from a UI button or preset loader):
//
//   const layer = window.SWR_3D.createLayer('icosahedron');
//   // layer.pos = [0, 0, 0]     // model-space offset
//   // layer.phase = 0           // radians, added to per-frame rotation
//   // layer.color = 200         // 0..360 hue
//   // layer._el  → <canvas> 1080x1080 ready for drawImage
//   // layer._gl, layer._program, layer._buffers, layer._uniforms internal
//   window.Layers.add(layer);   // becomes one of Layers.list()
//
// PUBLIC SURFACE (window.SWR_3D)
//   PRIMITIVES       — Array<{ id, name, vertices, indices, normals }>
//   PRIMITIVE_BY_ID  — Object map id → primitive
//   createLayer(id)  — build a new 3D layer wrapping a primitive
//   tickAll(t, A?)   — render one frame into every 3d layer
//   _mat4Multiply / _mat4RotateX / _mat4RotateY / _mat4RotateZ
//   _mat4Translate / _mat4Scale / _perspective / _lookAt
//                     — hand-rolled column-major mat4 helpers
//
// NO THREE.JS, NO TYPED ARRAYS beyond Float32Array / Uint16Array.
// GPU-bound; tested via syntax-check + manual browser verification only.

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // ---------------- matrix math (column-major, 4x4) ----------------
  // All matrices are Float32Array(16) laid out the way WebGL expects:
  //   [ m0  m4  m8  m12 ]
  //   [ m1  m5  m9  m13 ]
  //   [ m2  m6  m10 m14 ]
  //   [ m3  m7  m11 m15 ]
  // (i.e. translation lives in indices 12/13/14, like gl-matrix.)
  function _mat4Multiply(out, a, b) {
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

  function _mat4Identity(out) {
    out[0] = 1; out[1] = 0; out[2] = 0;  out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0;  out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  }

  function _mat4Translate(out, x, y, z) {
    _mat4Identity(out);
    out[12] = x;
    out[13] = y;
    out[14] = z;
    return out;
  }

  function _mat4Scale(out, s) {
    _mat4Identity(out);
    out[0] = s;
    out[5] = s;
    out[10] = s;
    return out;
  }

  function _mat4RotateX(out, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    _mat4Identity(out);
    out[5] = c;  out[6] = s;
    out[9] = -s; out[10] = c;
    return out;
  }

  function _mat4RotateY(out, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    _mat4Identity(out);
    out[0] = c;   out[2] = -s;
    out[8] = s;   out[10] = c;
    return out;
  }

  function _mat4RotateZ(out, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    _mat4Identity(out);
    out[0] = c;  out[1] = s;
    out[4] = -s; out[5] = c;
    return out;
  }

  function _perspective(out, fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0;                    out[3] = 0;
    out[4] = 0;          out[5] = f; out[6] = 0;                    out[7] = 0;
    out[8] = 0;          out[9] = 0; out[10] = (far + near) * nf;   out[11] = -1;
    out[12] = 0;         out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }

  function _lookAt(out, eye, center, up) {
    let fx = center[0] - eye[0];
    let fy = center[1] - eye[1];
    let fz = center[2] - eye[2];
    let len = Math.hypot(fx, fy, fz);
    if (len < 1e-8) { fx = 0; fy = 0; fz = -1; } else {
      fx /= len; fy /= len; fz /= len;
    }
    // s = forward × up
    let sx = fy * up[2] - fz * up[1];
    let sy = fz * up[0] - fx * up[2];
    let sz = fx * up[1] - fy * up[0];
    len = Math.hypot(sx, sy, sz);
    if (len < 1e-8) { sx = 1; sy = 0; sz = 0; } else {
      sx /= len; sy /= len; sz /= len;
    }
    // u = s × forward
    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;

    out[0] = sx;  out[1] = ux;  out[2] = -fx; out[3] = 0;
    out[4] = sy;  out[5] = uy;  out[6] = -fy; out[7] = 0;
    out[8] = sz;  out[9] = uz;  out[10] = -fz; out[11] = 0;
    out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
    out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    out[14] =  (fx * eye[0] + fy * eye[1] + fz * eye[2]);
    out[15] = 1;
    return out;
  }

  // ---------------- HSL → RGB ----------------
  // Standard HSL→RGB. Hue in degrees 0..360, s/l in 0..1. Returns [r,g,b] 0..1.
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  // ---------------- primitive generators ----------------
  // Sphere: lat/long subdivision. segLat = vertical slices (rows), segLong = horizontal.
  // We aim for ~16x16 = 256 verts, matching the brief.
  function makeSphere() {
    const segLat = 16;
    const segLong = 16;
    const verts = [];
    const idx = [];
    const norms = [];
    for (let y = 0; y <= segLat; y++) {
      const v = y / segLat;
      const phi = v * Math.PI; // 0..π
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let x = 0; x <= segLong; x++) {
        const u = x / segLong;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const nx = sinPhi * cosTheta;
        const ny = cosPhi;
        const nz = sinPhi * sinTheta;
        verts.push(nx, ny, nz);
        norms.push(nx, ny, nz);
      }
    }
    const rowStride = segLong + 1;
    for (let y = 0; y < segLat; y++) {
      for (let x = 0; x < segLong; x++) {
        const a = y * rowStride + x;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return packPrimitive('sphere', 'Sphere', verts, norms, idx);
  }

  // Cube: 6 faces × 4 unique verts per face = 24 verts, 12 triangles = 36 indices.
  function makeCube() {
    const s = 0.5;
    // Each face: position + normal. Order: +X, -X, +Y, -Y, +Z, -Z.
    const faces = [
      { n: [ 1, 0, 0], v: [[ s,-s,-s],[ s, s,-s],[ s, s, s],[ s,-s, s]] },
      { n: [-1, 0, 0], v: [[-s,-s, s],[-s, s, s],[-s, s,-s],[-s,-s,-s]] },
      { n: [ 0, 1, 0], v: [[-s, s,-s],[-s, s, s],[ s, s, s],[ s, s,-s]] },
      { n: [ 0,-1, 0], v: [[-s,-s, s],[-s,-s,-s],[ s,-s,-s],[ s,-s, s]] },
      { n: [ 0, 0, 1], v: [[-s,-s, s],[ s,-s, s],[ s, s, s],[-s, s, s]] },
      { n: [ 0, 0,-1], v: [[ s,-s,-s],[-s,-s,-s],[-s, s,-s],[ s, s,-s]] },
    ];
    const verts = [];
    const norms = [];
    const idx = [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      const base = f * 4;
      for (let i = 0; i < 4; i++) {
        verts.push(face.v[i][0], face.v[i][1], face.v[i][2]);
        norms.push(face.n[0], face.n[1], face.n[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return packPrimitive('cube', 'Cube', verts, norms, idx);
  }

  // Torus: major radius = 0.7, minor radius = 0.3. 16×16 rings.
  function makeTorus() {
    const major = 0.7;
    const minor = 0.3;
    const segMajor = 16;
    const segMinor = 16;
    const verts = [];
    const norms = [];
    const idx = [];
    for (let i = 0; i <= segMajor; i++) {
      const u = i / segMajor * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      for (let j = 0; j <= segMinor; j++) {
        const v = j / segMinor * Math.PI * 2;
        const cv = Math.cos(v);
        const sv = Math.sin(v);
        const x = (major + minor * cv) * cu;
        const y = (major + minor * cv) * su;
        const z = minor * sv;
        verts.push(x, y, z);
        // Normal points from the torus tube center outward.
        const nx = cv * cu;
        const ny = cv * su;
        const nz = sv;
        norms.push(nx, ny, nz);
      }
    }
    const rowStride = segMinor + 1;
    for (let i = 0; i < segMajor; i++) {
      for (let j = 0; j < segMinor; j++) {
        const a = i * rowStride + j;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return packPrimitive('torus', 'Torus', verts, norms, idx);
  }

  // Icosahedron: 12 vertices, 20 triangles.
  // Golden ratio φ = (1 + √5) / 2. Standard icosahedron construction.
  function makeIcosahedron() {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
      [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
      [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ];
    // Normalize onto unit sphere and scale to ~r=0.8 so it sits well next to the cube.
    const verts = [];
    const norms = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const len = Math.hypot(p[0], p[1], p[2]);
      const x = p[0] / len * 0.8;
      const y = p[1] / len * 0.8;
      const z = p[2] / len * 0.8;
      verts.push(x, y, z);
      norms.push(p[0] / len, p[1] / len, p[2] / len);
    }
    // 20 triangular faces, CCW winding viewed from outside.
    const tri = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
      [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
      [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];
    const idx = [];
    for (let i = 0; i < tri.length; i++) {
      idx.push(tri[i][0], tri[i][1], tri[i][2]);
    }
    return packPrimitive('icosahedron', 'Icosa', verts, norms, idx);
  }

  function packPrimitive(id, name, verts, norms, idx) {
    return {
      id,
      name,
      vertices: new Float32Array(verts),
      normals: new Float32Array(norms),
      indices: new Uint16Array(idx),
      _indexCount: idx.length,
    };
  }

  const PRIMITIVES = [
    makeSphere(),
    makeCube(),
    makeTorus(),
    makeIcosahedron(),
  ];
  const PRIMITIVE_BY_ID = {};
  for (let i = 0; i < PRIMITIVES.length; i++) {
    PRIMITIVE_BY_ID[PRIMITIVES[i].id] = PRIMITIVES[i];
  }

  // ---------------- shader sources ----------------
  // Standard MVP vertex shader with a flat-colored fragment.
  // Audio amplitude pulses vertex Z via u_bass (visualised as scale, computed CPU-side).
  const VS = [
    'attribute vec3 a_pos;',
    'attribute vec3 a_normal;',
    'uniform mat4 u_mvp;',
    'varying vec3 v_normal;',
    'void main() {',
    '  v_normal = a_normal;',
    '  gl_Position = u_mvp * vec4(a_pos, 1.0);',
    '}',
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying vec3 v_normal;',
    'uniform vec3 u_color;',
    'void main() {',
    '  vec3 n = normalize(v_normal);',
    // Lambertian + ambient + simple rim. Constant light direction.
    '  float lambert = max(dot(n, normalize(vec3(0.4, 0.7, 0.55))), 0.0);',
    '  vec3 ambient = u_color * 0.35;',
    '  vec3 diffuse = u_color * lambert;',
    '  float rim = pow(1.0 - max(n.z, 0.0), 2.5);',
    '  vec3 rim_col = vec3(0.85, 0.92, 1.0) * rim * 0.35;',
    '  gl_FragColor = vec4(ambient + diffuse + rim_col, 1.0);',
    '}',
  ].join('\n');

  // ---------------- shader compile / link ----------------
  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'unknown shader error';
      gl.deleteShader(sh);
      throw new Error('engine-3d shader compile failed: ' + log);
    }
    return sh;
  }
  function linkProgram(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'unknown program error';
      gl.deleteProgram(prog);
      throw new Error('engine-3d program link failed: ' + log);
    }
    return prog;
  }

  // ---------------- per-layer WebGL bootstrap ----------------
  // Each 3D layer owns its own 1080x1080 off-DOM canvas. tickAll() renders
  // into that canvas, then the engine's normal drawLayer pass draws it
  // into the visible 2D context.
  function buildProgram(gl) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
    const prog = linkProgram(gl, vs, fs);
    // Shaders can be deleted after linking; the program retains them.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const attrs = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      normal: gl.getAttribLocation(prog, 'a_normal'),
    };
    const uniforms = {
      mvp: gl.getUniformLocation(prog, 'u_mvp'),
      color: gl.getUniformLocation(prog, 'u_color'),
    };
    return { prog, attrs, uniforms };
  }

  function uploadBuffers(gl, primitive) {
    const vBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bufferData(gl.ARRAY_BUFFER, primitive.vertices, gl.STATIC_DRAW);
    const nBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
    gl.bufferData(gl.ARRAY_BUFFER, primitive.normals, gl.STATIC_DRAW);
    const iBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, primitive.indices, gl.STATIC_DRAW);
    return { v: vBuf, n: nBuf, i: iBuf, count: primitive._indexCount };
  }

  function createLayer(primitiveId) {
    const primitive = PRIMITIVE_BY_ID[primitiveId];
    if (!primitive) {
      throw new Error('engine-3d: unknown primitive id "' + primitiveId + '"');
    }
    const w = 1080;
    const h = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    // Hide by default — engine may append to DOM if it wants pixel access,
    // but tickAll() reads via drawImage so the canvas can stay detached.
    canvas.style.position = 'absolute';
    canvas.style.left = '-9999px';
    canvas.style.top = '-9999px';
    canvas.style.pointerEvents = 'none';

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true,
    });
    if (!gl) {
      throw new Error('engine-3d: WebGL not supported in this browser');
    }

    const { prog, attrs, uniforms } = buildProgram(gl);
    const buffers = uploadBuffers(gl, primitive);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    const layer = {
      type: '3d',
      id: '3d-' + primitive.id + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: '3D ' + primitive.name,
      primitiveId: primitive.id,
      w,
      h,
      // Public knobs (read by tickAll).
      pos: [0, 0, 0],
      phase: 0,
      color: 200, // hue 0..360
      // Internal WebGL handles.
      _gl: gl,
      _program: prog,
      _buffers: buffers,
      _uniforms: uniforms,
      _attrs: attrs,
      _primitive: primitive,
      // Asset-shape: anything the engine draws must be drawable via drawImage.
      // Exposing _el as a getter so the engine can pass layer._el directly.
      get _el() {
        return canvas;
      },
      // Free the WebGL resources. Engine can call this when the layer is
      // removed from Layers.list() to release GPU memory.
      dispose: function () {
        if (this._disposed) return;
        this._disposed = true;
        try {
          const g = this._gl;
          if (this._buffers) {
            g.deleteBuffer(this._buffers.v);
            g.deleteBuffer(this._buffers.n);
            g.deleteBuffer(this._buffers.i);
          }
          if (this._program) g.deleteProgram(this._program);
        } catch (_) { /* ignore */ }
      },
    };
    // Pin canvas on the layer so it doesn't get GC'd while the GL handles
    // still reference it.
    layer._canvas = canvas;
    return layer;
  }

  // ---------------- per-frame render ----------------
  // Reusable scratch matrices so we don't allocate per-frame.
  const _mvp = new Float32Array(16);
  const _model = new Float32Array(16);
  const _view = new Float32Array(16);
  const _proj = new Float32Array(16);
  const _t = new Float32Array(16);
  const _rx = new Float32Array(16);
  const _ry = new Float32Array(16);
  const _rz = new Float32Array(16);
  const _sc = new Float32Array(16);

  function renderLayer(layer, t, A) {
    const gl = layer._gl;
    const prog = layer._program;
    const buffers = layer._buffers;
    const uniforms = layer._uniforms;
    const attrs = layer._attrs;

    gl.viewport(0, 0, layer.w, layer.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(prog);

    // Audio amplitude. Defensive: missing A.feat or missing layer.pos.
    const bass = (A && A.feat && typeof A.feat.bass === 'number') ? A.feat.bass : 0;
    const amp = 1 + bass * 0.3;
    const pos = (layer.pos && layer.pos.length === 3) ? layer.pos : [0, 0, 0];
    const phase = typeof layer.phase === 'number' ? layer.phase : 0;

    // model = translate(pos) * rotateX(t*0.3 + phase) * rotateY(t*0.5) * scale(amp)
    _mat4Translate(_t, pos[0], pos[1], pos[2]);
    _mat4RotateX(_rx, t * 0.3 + phase);
    _mat4RotateY(_ry, t * 0.5);
    _mat4Scale(_sc, amp);
    _mat4Multiply(_rz, _rx, _ry);   // _rz = rx * ry
    _mat4Multiply(_rz, _rz, _sc);  // _rz = rx*ry*sc
    _mat4Multiply(_model, _t, _rz); // model = t * rx*ry*sc

    // Fixed orbiting camera at (0,0,3) looking at origin.
    _lookAt(_view, [0, 0, 3], [0, 0, 0], [0, 1, 0]);
    // 45° vertical FOV, square aspect (canvas is 1080×1080).
    _perspective(_proj, (45 * Math.PI) / 180, 1, 0.1, 100);

    // mvp = projection * view * model
    _mat4Multiply(_mvp, _view, _model);
    _mat4Multiply(_mvp, _proj, _mvp);

    gl.uniformMatrix4fv(uniforms.mvp, false, _mvp);

    // Hue → RGB. Saturation/lightness constant so layers stay punchy.
    const hue = typeof layer.color === 'number' ? layer.color : 200;
    const rgb = hslToRgb(hue, 0.85, 0.55);
    gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2]);

    // Bind attribute pointers.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.v);
    gl.enableVertexAttribArray(attrs.pos);
    gl.vertexAttribPointer(attrs.pos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.n);
    if (attrs.normal >= 0) {
      gl.enableVertexAttribArray(attrs.normal);
      gl.vertexAttribPointer(attrs.normal, 3, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.i);
    gl.drawElements(gl.TRIANGLES, buffers.count, gl.UNSIGNED_SHORT, 0);

    // Disable for cleanliness — next layer's program may have different layout.
    gl.disableVertexAttribArray(attrs.pos);
    if (attrs.normal >= 0) gl.disableVertexAttribArray(attrs.normal);
  }

  // tickAll iterates window.Layers.list() (if present) and renders any
  // layer of type === '3d'. The brief passes t and (optionally) A; we
  // also fall back to window.SWR && window.SWR.Audio && window.SWR.Audio.feat
  // so callers don't have to forward A explicitly.
  function tickAll(t, A) {
    let layers;
    try {
      layers = (window.Layers && typeof window.Layers.list === 'function')
        ? window.Layers.list()
        : [];
    } catch (_) {
      layers = [];
    }
    if (!layers || !layers.length) return;

    // Resolve A.feat from arg or window.
    const featSource = (A && A.feat)
      ? A
      : ((window.SWR && window.SWR.Audio && window.SWR.Audio.feat)
          ? window.SWR.Audio
          : { feat: { bass: 0, mid: 0, treble: 0, rms: 0 } });

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer || layer.type !== '3d') continue;
      if (!layer._gl || !layer._program || !layer._buffers) continue;
      try {
        renderLayer(layer, t, featSource);
      } catch (err) {
        // Don't let one broken layer kill the whole engine. Log once.
        if (!layer._errored) {
          layer._errored = true;
          // eslint-disable-next-line no-console
          console.warn('[engine-3d] layer render failed; suppressing further errors', err);
        }
      }
    }
  }

  // ---------------- public export ----------------
  window.SWR_3D = {
    PRIMITIVES: PRIMITIVES,
    PRIMITIVE_BY_ID: PRIMITIVE_BY_ID,
    createLayer: createLayer,
    tickAll: tickAll,
    // Exposed for tests / power users.
    _mat4Multiply: _mat4Multiply,
    _mat4RotateX: _mat4RotateX,
    _mat4RotateY: _mat4RotateY,
    _mat4RotateZ: _mat4RotateZ,
    _mat4Translate: _mat4Translate,
    _mat4Scale: _mat4Scale,
    _perspective: _perspective,
    _lookAt: _lookAt,
    _hslToRgb: hslToRgb,
    _VS: VS,
    _FS: FS,
  };
})();
