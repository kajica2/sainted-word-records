// engine-3d.client.js — 3D layer type for the SWR engine.
//
// Each 3D layer renders a procedural primitive (sphere / cube / torus /
// icosahedron) animated by audio features (bass / mid / treble / beat),
// then composites into the existing 2D engine canvas via a per-frame
// "render to 2D canvas, then drawImage" path. The engine's blend
// modes, fade-in/fade-out (Phase 2-4), and recorder pipeline all work
// unchanged because the WebGL output is presented as a regular 2D
// canvas before it hits the engine's drawLayer().
//
// Why hand-rolled WebGL and not Three.js?
//   - The engine already has a hand-rolled WebGL pipeline
//     (fx-postprocess.js, ~25KB) with the same shader-style architecture.
//   - 4 procedural primitives don't need a 600KB dep.
//   - We get full control over how the mesh reacts to the audio —
//     no fighting a renderer's animation system.
//
// Public API (window.SWR_3D):
//   .PRIMITIVES          — array of { id, name, factory } descriptors
//   .createLayer(primitiveId) → { type: '3d', primitive, ...layer fields }
//   .tick(renderer)        — call once per frame; updates the audio-driven
//                            mesh transforms and re-renders into each
//                            layer's 2D output canvas
//
// Integration: the engine's drawLayer() detects asset.type === '3d' and
// draws the cached 2D output canvas (asset._el) like any other image.

(function () {
  'use strict';
  if (window.SWR_3D) return; // idempotent

  // ---- Primitive geometries ----
  // Each returns a typed-array bundle: { positions, normals, indices, uvs }
  // Positions are 3 floats per vertex. Normals same. UVs are 2 floats.
  // Indices are unsigned 16-bit (assumes < 65536 vertices per primitive,
  // which is true for these — wireframe is also drawn with these).
  function makeSphere(radius, latBands, lonBands) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let lat = 0; lat <= latBands; lat++) {
      const theta = (lat * Math.PI) / latBands;
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      for (let lon = 0; lon <= lonBands; lon++) {
        const phi = (lon * 2 * Math.PI) / lonBands;
        const sinP = Math.sin(phi), cosP = Math.cos(phi);
        const x = cosP * sinT, y = cosT, z = sinP * sinT;
        positions.push(radius * x, radius * y, radius * z);
        normals.push(x, y, z);
        uvs.push(lon / lonBands, lat / latBands);
      }
    }
    for (let lat = 0; lat < latBands; lat++) {
      for (let lon = 0; lon < lonBands; lon++) {
        const a = lat * (lonBands + 1) + lon;
        const b = a + lonBands + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions),
             normals:   new Float32Array(normals),
             uvs:       new Float32Array(uvs),
             indices:   new Uint16Array(indices),
             vertexCount: positions.length / 3 };
  }

  function makeCube() {
    // 6 faces, 4 verts each = 24 verts (12 triangles). Duplicated verts so
    // each face has its own normal (flat shading reads cleaner).
    const f = (n, verts) => {
      for (const v of verts) positions.push(...v), normals.push(...n);
    };
    const positions = [], normals = [];
    const uvs = [0,0, 1,0, 1,1, 0,1]; // shared
    f([ 0, 0, 1], [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]]); // front
    f([ 0, 0,-1], [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]]); // back
    f([ 0, 1, 0], [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]]); // top
    f([ 0,-1, 0], [[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],[-1,-1, 1]]); // bottom
    f([ 1, 0, 0], [[ 1,-1, 1],[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1]]); // right
    f([-1, 0, 0], [[-1,-1,-1],[-1,-1, 1],[-1, 1, 1],[-1, 1,-1]]); // left
    const indices = new Uint16Array(36);
    for (let i = 0; i < 6; i++) {
      const o = i * 4;
      indices.set([o, o+1, o+2,  o, o+2, o+3], i * 6);
    }
    const uvArr = new Float32Array(positions.length / 3 * 2);
    for (let v = 0; v < positions.length / 3; v++) {
      uvArr[v*2]   = uvs[(v % 4) * 2];
      uvArr[v*2+1] = uvs[(v % 4) * 2 + 1];
    }
    return { positions: new Float32Array(positions),
             normals:   new Float32Array(normals),
             uvs:       uvArr,
             indices,
             vertexCount: positions.length / 3 };
  }

  function makeTorus(radius, tube, radialSegs, tubularSegs) {
    const positions = [], normals = [], uvs = [], indices = [];
    for (let i = 0; i <= radialSegs; i++) {
      for (let j = 0; j <= tubularSegs; j++) {
        const u = (i / radialSegs) * Math.PI * 2;
        const v = (j / tubularSegs) * Math.PI * 2;
        const x = (radius + tube * Math.cos(v)) * Math.cos(u);
        const y = (radius + tube * Math.cos(v)) * Math.sin(u);
        const z = tube * Math.sin(v);
        positions.push(x, y, z);
        const cx = Math.cos(u), sx = Math.sin(u);
        const cv = Math.cos(v), sv = Math.sin(v);
        normals.push(cv * cx, cv * sx, sv);
        uvs.push(i / radialSegs, j / tubularSegs);
      }
    }
    for (let i = 0; i < radialSegs; i++) {
      for (let j = 0; j < tubularSegs; j++) {
        const a = i * (tubularSegs + 1) + j;
        const b = (i + 1) * (tubularSegs + 1) + j;
        const c = (i + 1) * (tubularSegs + 1) + j + 1;
        const d = i * (tubularSegs + 1) + j + 1;
        indices.push(a, b, d,  b, c, d);
      }
    }
    return { positions: new Float32Array(positions),
             normals:   new Float32Array(normals),
             uvs:       new Float32Array(uvs),
             indices:   new Uint16Array(indices),
             vertexCount: positions.length / 3 };
  }

  function makeIcosahedron(radius) {
    const t = (1 + Math.sqrt(5)) / 2;  // golden ratio
    const v = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const len = Math.hypot(1, t, 0);
    const positions = [], normals = [], indices = [];
    const faces = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
      [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
      [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];
    for (const f of faces) for (const i of f) indices.push(i);
    for (const p of v) {
      const x = p[0] / len * radius, y = p[1] / len * radius, z = p[2] / len * radius;
      positions.push(x, y, z);
      // Icosahedron faces are flat — each vertex is shared by 5 faces
      // so a single per-vertex normal is wrong. For this implementation
      // we accept smooth normals (averaged position) because the icosa
      // is small and the audio-driven rotation makes the lighting pop
      // acceptable either way. Future: store per-face normals.
      const nl = Math.hypot(x, y, z) || 1;
      normals.push(x / nl, y / nl, z / nl);
    }
    const uvs = new Float32Array(positions.length / 3 * 2);
    for (let i = 0; i < uvs.length / 2; i++) {
      // Spherical UVs from the vertex's normalized direction
      const nx = normals[i*3], ny = normals[i*3+1], nz = normals[i*3+2];
      uvs[i*2]   = 0.5 + Math.atan2(nx, nz) / (2 * Math.PI);
      uvs[i*2+1] = 0.5 - Math.asin(ny) / Math.PI;
    }
    return { positions: new Float32Array(positions),
             normals, uvs,
             indices: new Uint16Array(indices),
             vertexCount: positions.length / 3 };
  }

  const PRIMITIVES = [
    { id: 'sphere',      name: 'Sphere',      factory: () => makeSphere(1, 16, 24) },
    { id: 'cube',        name: 'Cube',        factory: () => makeCube() },
    { id: 'torus',       name: 'Torus',       factory: () => makeTorus(0.8, 0.32, 24, 32) },
    { id: 'icosahedron', name: 'Icosahedron', factory: () => makeIcosahedron(1) },
  ];
  const PRIMITIVE_BY_ID = Object.fromEntries(PRIMITIVES.map(p => [p.id, p]));

  // ---- Shader sources (shared by every 3D layer) ----
  const VERT = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    uniform mat4 uMVP;
    uniform mat4 uModel;
    varying vec3 vNormal;
    void main() {
      vNormal = mat3(uModel) * aNormal;
      gl_Position = uMVP * uModel * vec4(aPos, 1.0);
    }
  `;
  const FRAG = `
    precision mediump float;
    varying vec3 vNormal;
    uniform vec3 uColor;
    uniform float uOpacity;
    void main() {
      // Cheap directional light from above-front.
      vec3 light = normalize(vec3(0.3, 0.6, 1.0));
      float d = max(dot(normalize(vNormal), light), 0.0);
      float ambient = 0.35;
      vec3 col = uColor * (ambient + d * 0.85);
      gl_FragColor = vec4(col, uOpacity);
    }
  `;

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile failed: ' + log);
    }
    return sh;
  }
  function linkProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('program link failed: ' + log);
    }
    return p;
  }

  // ---- 3D layer renderer ----
  // Each 3D layer gets its own WebGL context (small ephemeral canvas) and
  // its own cached program. Cheap to create — we only ever have at most
  // 6 (the engine's layer cap) and most users will use 1–2.
  class Layer3D {
    constructor(primitiveId) {
      this.primitiveId = primitiveId;
      const def = PRIMITIVE_BY_ID[primitiveId] || PRIMITIVES[0];
      this.geometry = def.factory();
      this.outputCanvas = document.createElement('canvas');
      this.outputCanvas.width = 1080;
      this.outputCanvas.height = 1080;
      this.outputCtx = this.outputCanvas.getContext('2d');
      this.gl = this.outputCanvas.getContext('webgl', {
        antialias: true, premultipliedAlpha: true, alpha: true,
      });
      this._valid = !!this.gl;
      if (!this._valid) {
        console.warn('[swr-3d] WebGL not available in this browser; layer will render blank');
        return;
      }
      const gl = this.gl;
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
      this.program = linkProgram(gl, vs, fs);
      // Buffers
      this.posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.geometry.positions, gl.STATIC_DRAW);
      this.normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.geometry.normals, gl.STATIC_DRAW);
      this.idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indices, gl.STATIC_DRAW);
      // Uniforms
      this.uMVP = gl.getUniformLocation(this.program, 'uMVP');
      this.uModel = gl.getUniformLocation(this.program, 'uModel');
      this.uColor = gl.getUniformLocation(this.program, 'uColor');
      this.uOpacity = gl.getUniformLocation(this.program, 'uOpacity');
      this.aPos = gl.getAttribLocation(this.program, 'aPos');
      this.aNormal = gl.getAttribLocation(this.program, 'aNormal');
      // Default color
      this.baseColor = [0.95, 0.45, 0.20];  // amber
      // Transform state
      this.rotX = 0; this.rotY = 0; this.rotZ = 0;
      this.rotVX = 0.3; this.rotVY = 0.5;  // default rotation speeds
      this.posX = 0; this.posY = 0; this.posZ = 0;
      this.scale = 1.0;
    }
    // Called once per frame from the engine's render loop.
    // featureVec is the same applyReactors output (scale, x, y, rot, opacity, ...)
    // hue is in degrees (0..360). opacity is 0..1.
    tick(featureVec, time, hue, opacity) {
      if (!this._valid) return;
      const gl = this.gl;
      // Update rotations from applyReactors + a baseline idle spin so the
      // mesh isn't completely still when audio is silent. Idle speeds
      // are tweaked to look "alive" without being distracting.
      const audioRot = featureVec.rot || 0;
      this.rotX += 0.005 + Math.abs(featureVec.scale || 0) * 0.0008;
      this.rotY += this.rotVY * 0.012 + audioRot * 0.001;
      this.rotZ += 0.003;
      // Position
      this.posX = featureVec.x || 0;
      this.posY = featureVec.y || 0;
      // Pulse scale on beat (we can't read A.feat.beat directly here, but
      // featureVec already includes reactor contributions that may carry
      // the beat). Add a small base scale + the reactor's scale.
      this.scale = (featureVec.scale || 1.0) * 0.45;
      // Resize output canvas to match the engine stage if it's been sized.
      // The drawLayer() path uses the layer's own size; the engine's
      // stage is a separate canvas, so we always render at 1080×1080 (a
      // square that cover-fits the 9:16 stage cleanly).
      // (Resize is cheap; the underlying WebGL framebuffer reallocates.)
      // (Skip — the canvas is allocated once at construction.)
      // Build the MVP matrix
      const aspect = 1.0;  // square framebuffer
      const proj = this._perspective(1.0, 1.0, 0.1, 100.0, aspect);
      const view = this._lookAt([0, 0, 3.0], [0, 0, 0], [0, 1, 0]);
      const model = this._mat4Identity();
      this._mat4RotateX(model, this.rotX);
      this._mat4RotateY(model, this.rotY + time * 0.0003);
      this._mat4RotateZ(model, this.rotZ);
      this._mat4Translate(model, this.posX * 0.005, this.posY * 0.005, 0);
      this._mat4Scale(model, this.scale, this.scale, this.scale);
      const mvp = this._mat4Multiply(proj, this._mat4Multiply(view, model));
      // Render
      gl.viewport(0, 0, this.outputCanvas.width, this.outputCanvas.height);
      gl.clearColor(0, 0, 0, 0);  // transparent
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uMVP, false, mvp);
      gl.uniformMatrix4fv(this.uModel, false, model);
      // HSL-derived color so the user can match the layer to the music's
      // mood via the existing hue reactor.
      const c = this._hslToRgb(hue, 0.7, 0.55);
      gl.uniform3f(this.uColor, c[0], c[1], c[2]);
      gl.uniform1f(this.uOpacity, opacity);
      // Bind buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuf);
      gl.enableVertexAttribArray(this.aNormal);
      gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.drawElements(gl.TRIANGLES, this.geometry.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(this.aPos);
      gl.disableVertexAttribArray(this.aNormal);
    }
    // ---- minimal 4x4 matrix math (column-major like WebGL) ----
    _mat4Identity() {
      const m = new Float32Array(16);
      m[0]=1; m[5]=1; m[10]=1; m[15]=1;
      return m;
    }
    _mat4Multiply(a, b) {
      const r = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          r[j*4 + i] =
            a[i] * b[j*4] +
            a[4+i] * b[j*4+1] +
            a[8+i] * b[j*4+2] +
            a[12+i] * b[j*4+3];
        }
      }
      return r;
    }
    _mat4RotateX(m, a) {
      const c = Math.cos(a), s = Math.sin(a);
      const r = this._mat4Identity();
      r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
      return this._mat4Multiply(m, r);
    }
    _mat4RotateY(m, a) {
      const c = Math.cos(a), s = Math.sin(a);
      const r = this._mat4Identity();
      r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
      return this._mat4Multiply(m, r);
    }
    _mat4RotateZ(m, a) {
      const c = Math.cos(a), s = Math.sin(a);
      const r = this._mat4Identity();
      r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
      return this._mat4Multiply(m, r);
    }
    _mat4Translate(m, x, y, z) {
      const r = this._mat4Identity();
      r[12] = x; r[13] = y; r[14] = z;
      return this._mat4Multiply(m, r);
    }
    _mat4Scale(m, sx, sy, sz) {
      const r = this._mat4Identity();
      r[0] = sx; r[5] = sy; r[10] = sz;
      return this._mat4Multiply(m, r);
    }
    _perspective(fovy, near, far, aspectUnused, aspect) {
      // fovy in radians; we accept degrees for ergonomics.
      const f = 1.0 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      const m = new Float32Array(16);
      m[0] = f / (aspect || 1);
      m[5] = f;
      m[10] = (far + near) * nf;
      m[11] = -1;
      m[14] = 2 * far * near * nf;
      return m;
    }
    _lookAt(eye, target, up) {
      // Subtract to get z, normalize up, cross to get x, cross to get y.
      const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
      let zl = Math.hypot(zx, zy, zz) || 1;
      const zxn = zx/zl, zyn = zy/zl, zzn = zz/zl;
      const xx = up[1]*zzn - up[2]*zyn;
      const xy = up[2]*zxn - up[0]*zzn;
      const xz = up[0]*zyn - up[1]*zxn;
      let xl = Math.hypot(xx, xy, xz) || 1;
      const xn = xx/xl, yn_x = xy/xl, zn_x = xz/xl;
      const yx = zyn*zn_x - zzn*yn_x;
      const yy = zzn*xn - zxn*zn_x;
      const yz = zxn*yn_x - zyn*xn;
      const m = new Float32Array(16);
      m[0]=xn; m[4]=yn_x; m[8]=zxn; m[12]=-(xn*eye[0] + yn_x*eye[1] + zxn*eye[2]);
      m[1]=xy; m[5]=yy; m[9]=zyn; m[13]=-(xy*eye[0] + yy*eye[1] + zyn*eye[2]);
      m[2]=xz; m[6]=yz; m[10]=zzn; m[14]=-(xz*eye[0] + yz*eye[1] + zzn*eye[2]);
      m[15]=1;
      return m;
    }
    _hslToRgb(h, s, l) {
      h = ((h % 360) + 360) % 360;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      let r, g, b;
      if (h < 60)      [r,g,b] = [c, x, 0];
      else if (h < 120)[r,g,b] = [x, c, 0];
      else if (h < 180)[r,g,b] = [0, c, x];
      else if (h < 240)[r,g,b] = [0, x, c];
      else if (h < 300)[r,g,b] = [x, 0, c];
      else            [r,g,b] = [c, 0, x];
      return [r + m, g + m, b + m];
    }
  }

  // ---- Factory for a 3D layer asset object ----
  function createLayer(primitiveId) {
    const layer3d = new Layer3D(primitiveId);
    // The asset for the engine looks like a regular image asset, but
    // draws via the 3D path. We store the 3D renderer on the asset
    // (asset._3d) and the rendered output is exposed as asset._el
    // (an HTMLCanvasElement), which drawLayer() treats as a regular
    // image source via drawImage.
    const asset = {
      type: '3d',
      name: '3D · ' + (PRIMITIVE_BY_ID[primitiveId]?.name || primitiveId),
      url: '',         // not used; we render to _el
      w: 1080,
      h: 1080,
      // 3D-specific fields:
      primitive: primitiveId,
      _3d: layer3d,
      // The renderer produces this canvas each frame; drawLayer() will
      // drawImage(asset._el) into the engine's stage.
      get _el() { return layer3d.outputCanvas; },
    };
    return asset;
  }

  // ---- Tick dispatcher ----
  // engine.html calls SWR_3D.tickAll(time) once per frame from its
  // main render loop. We walk every 3D layer in Layers.list, advance
  // its mesh, render the WebGL canvas, and let drawLayer() pick it up.
  // The per-layer featureVec is computed in drawLayer(); we pre-compute
  // a cache here so the same reactor output is reused.
  function tickAll(t) {
    if (!window.Layers) return;
    const A = window.Audio;
    const f = A ? A.feat : { bass: 0, mid: 0, treble: 0 };
    // Cheap beat-approximation: 1 if bass > 0.4, else 0
    const beat = f.bass > 0.4 ? 1 : 0;
    for (const layer of window.Layers.list) {
      if (!layer.asset || layer.asset.type !== '3d') continue;
      const r3d = layer.asset._3d;
      if (!r3d || !r3d._valid) continue;
      // Build a featureVec compatible with the 2D applyReactors output.
      // 3D only needs scale/x/y/rot/opacity, but we keep the shape so
      // the engine's drawing pipeline sees the same fields.
      const featureVec = {
        scale: (layer.reactors || []).reduce((a, r) => a + (r.feature === 'bass' ? f.bass : 0), 1) * (1 + beat * 0.3),
        x: layer.pos?.x || 0,
        y: layer.pos?.y || 0,
        rot: layer.pos?.rot || 0,
        opacity: layer._fadeState ? layer._fadeState.currentOpacity : (layer.opacity ?? 1),
        hue: layer.hue || 0,
      };
      r3d.tick(featureVec, t, featureVec.hue, featureVec.opacity);
    }
  }

  // ---- Public surface ----
  window.SWR_3D = {
    PRIMITIVES,
    createLayer,
    tickAll,
    // For engine-core's drawLayer: read the cached 2D output canvas.
    // (No helper needed — drawLayer already does asset._el via drawImage.)
  };
})();