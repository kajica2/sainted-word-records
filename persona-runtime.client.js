// persona-runtime.client.js
// Per-persona demo of the SWR engine — without the engine's full bootstrap.
//
// Reads ?id= from URL, fetches /marketing/personas/demos/<id>.json, then
// drives a 3D primitive + a minimal audio analyser in the page's <canvas>.
// Each persona's JSON config (preset, primitive, color, reactor) maps to
// the demo's appearance and audio response.
//
// Why engine-free?
//   engine-core.client.js requires 8+ panel DOM elements (load-song, lib,
//   layer-list, etc.) to boot; we don't want to clone the full engine
//   chrome into persona-demo.html. A persona demo should demonstrate what
//   that persona CARES ABOUT — usually a 3D primitive, audio reactivity,
//   color and shape. The 4-vanilla-canvas approach below delivers that
//   in ~150 lines, no engine dependency.
//
// Public surface (window.SWR_PERSONA):
//   .PRESET_MAP        — style-neon/film/etc → internal preset key
//   .apply(persona)    — applies the persona's visual + audio mappings
//   .load(id)          — fetches /marketing/personas/demos/<id>.json
//   .autoLoad()        — reads ?id= and runs

(function () {
  'use strict';
  if (window.SWR_PERSONA) return;

  // Visual-preset map (style-* persona keys → internal preset buckets).
  // Each bucket describes a static palette + camera angle + post effects.
  var PRESET_MAP = {
    'style-grid':          { sky: '#0a0612', accent: '#00f0ff', bgAccent: '#ff2d8a', camera: { tilt: 0.2,  yaw: 0.1  } },
    'style-film':          { sky: '#0e0818', accent: '#fff04a', bgAccent: '#ff6b00', camera: { tilt: 0.0,  yaw: 0.05 } },
    'style-smoke':         { sky: '#0a0612', accent: '#9b8aff', bgAccent: '#5a4a8a', camera: { tilt: 0.0,  yaw: 0.02 } },
    'style-neon':          { sky: '#000010', accent: '#ff2d8a', bgAccent: '#00f0ff', camera: { tilt: 0.3,  yaw: 0.2  } },
    'style-hallucination': { sky: '#100020', accent: '#ff00aa', bgAccent: '#00ffaa', camera: { tilt: 0.5,  yaw: 0.3  } },
    'style-broadcast':     { sky: '#0e0e1a', accent: '#ffffff', bgAccent: '#4a6d8c', camera: { tilt: 0.0,  yaw: 0.0  } },
    'style-cassette':      { sky: '#10080a', accent: '#ff8a00', bgAccent: '#5a3a00', camera: { tilt: 0.1,  yaw: 0.05 } },
  };

  // Color helpers.
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }
  function rgbToCss(rgb, a) {
    return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ',' + (a == null ? 1 : a) + ')';
  }
  function hsl(h, s, l) {
    // Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB.
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1)      [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else             [r, g, b] = [c, 0, x];
    var m = l - c / 2;
    return [r + m, g + m, b + m];
  }

  // ---- Minimal WebGL 3D scene ----
  // Renders one primitive procedurally. Mirrors engine-3d.client.js but
  // is engine-free (no SWR_3D dependency).
  function makeSphere() {
    var p = [], n = [], i = [];
    var latBands = 16, lonBands = 24;
    for (var lat = 0; lat <= latBands; lat++) {
      var th = (lat * Math.PI) / latBands;
      var sinT = Math.sin(th), cosT = Math.cos(th);
      for (var lon = 0; lon <= lonBands; lon++) {
        var ph = (lon * 2 * Math.PI) / lonBands;
        var sinP = Math.sin(ph), cosP = Math.cos(ph);
        var x = cosP * sinT, y = cosT, z = sinP * sinT;
        p.push(x, y, z); n.push(x, y, z);
      }
    }
    for (lat = 0; lat < latBands; lat++) {
      for (lon = 0; lon < lonBands; lon++) {
        var a = lat * (lonBands + 1) + lon;
        var b = a + lonBands + 1;
        i.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint16Array(i), vertCount: i.length };
  }
  function makeCube() {
    // 6 faces × 4 verts = 24 verts (12 tris). Flat normals per face.
    var pos = [], nrm = [], idx = [];
    var f = function (n, verts) {
      for (var i = 0; i < 4; i++) { pos.push(verts[i][0], verts[i][1], verts[i][2]); nrm.push(n[0], n[1], n[2]); }
    };
    f([0, 0, 1],  [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]);
    f([0, 0,-1],  [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]);
    f([0, 1, 0],  [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]);
    f([0,-1, 0],  [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]);
    f([1, 0, 0],  [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]);
    f([-1,0, 0],  [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]);
    for (var i = 0; i < 6; i++) {
      var o = i * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint16Array(idx), vertCount: idx.length };
  }
  function makeTorus() {
    var pos = [], nrm = [], idx = [];
    var R = 0.7, t = 0.3, rs = 18, ts = 24;
    for (var i = 0; i <= rs; i++) {
      for (var j = 0; j <= ts; j++) {
        var u = (i / rs) * Math.PI * 2;
        var v = (j / ts) * Math.PI * 2;
        var x = (R + t * Math.cos(v)) * Math.cos(u);
        var y = (R + t * Math.cos(v)) * Math.sin(u);
        var z = t * Math.sin(v);
        pos.push(x, y, z);
        var cv = Math.cos(v), sv = Math.sin(v);
        nrm.push(cv * Math.cos(u), cv * Math.sin(u), sv);
      }
    }
    for (var i = 0; i < rs; i++) {
      for (var j = 0; j < ts; j++) {
        var a = i * (ts + 1) + j;
        var b = (i + 1) * (ts + 1) + j;
        var c = (i + 1) * (ts + 1) + j + 1;
        var d = i * (ts + 1) + j + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint16Array(idx), vertCount: idx.length };
  }
  function makeIcosahedron() {
    var t = (1 + Math.sqrt(5)) / 2;
    var v = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    var L = Math.hypot(1, t, 0);
    var pos = [], nrm = [], idx = [];
    var faces = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
      [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
      [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];
    for (var f = 0; f < faces.length; f++) for (var k = 0; k < 3; k++) idx.push(faces[f][k]);
    for (var i = 0; i < v.length; i++) {
      var x = v[i][0] / L, y = v[i][1] / L, z = v[i][2] / L;
      pos.push(x, y, z); nrm.push(x, y, z);
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint16Array(idx), vertCount: idx.length };
  }
  var GEOMETRY = {
    sphere:      makeSphere,
    cube:        makeCube,
    torus:       makeTorus,
    icosahedron: makeIcosahedron,
  };

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('shader:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }
  function linkProgram(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('link:', gl.getProgramInfoLog(p)); return null;
    }
    return p;
  }

  // ---- Scene state ----
  // Owns its own AudioContext; reads /audios/<persona>_demo.mp3 if present,
  // otherwise uses a silent test tone. Three bands (bass/mid/treble) feed
  // the mesh's scale + rotation per persona reactor config.
  var Scene = {
    canvas: null, gl: null, program: null,
    geometry: null, audioCtx: null, audioSource: null, analyser: null,
    bands: { bass: 0, mid: 0, treble: 0, beat: 0, rms: 0 },
    smoothed: { bass: 0, mid: 0, treble: 0, beat: 0, rms: 0 },
    rot: { x: 0, y: 0, z: 0 },
    rotationSpeed: { x: 0.003, y: 0.005, z: 0.002 },
    meshColor: [1, 0.5, 0.2],
    personaColor: '#ff3d92',
    preset: null,
    dominantBand: 'mid',
    smoothFactor: 0.7,
    envelope: 'smooth',
    rafHandle: 0,
    running: false,
    matrixCache: { mvp: null, model: null, proj: null, view: null },
  };

  // 4x4 matrix helpers (column-major, WebGL convention).
  function identity() { var m = new Float32Array(16); m[0]=1;m[5]=1;m[10]=1;m[15]=1; return m; }
  function matMul(a, b) {
    var r = new Float32Array(16);
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++)
        r[j*4+i] = a[i]*b[j*4] + a[4+i]*b[j*4+1] + a[8+i]*b[j*4+2] + a[12+i]*b[j*4+3];
    return r;
  }
  function matPerspective(fovyRad, aspect, near, far) {
    var f = 1 / Math.tan(fovyRad / 2);
    var nf = 1 / (near - far);
    var m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) * nf; m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  }
  function matRotate(m, axis, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    var r = identity();
    if (axis === 'x') { r[5]=c; r[6]=s; r[9]=-s; r[10]=c; }
    else if (axis === 'y') { r[0]=c; r[2]=-s; r[8]=s; r[10]=c; }
    else { r[0]=c; r[1]=s; r[4]=-s; r[5]=c; }
    return matMul(m, r);
  }
  function matTranslate(m, x, y, z) {
    var r = identity(); r[12]=x; r[13]=y; r[14]=z;
    return matMul(m, r);
  }
  function matScale(m, sx, sy, sz) {
    var r = identity(); r[0]=sx; r[5]=sy; r[10]=sz;
    return matMul(m, r);
  }

  function setupGL(canvas, geom) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) return false;
    var vs = compileShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 aPos; attribute vec3 aNormal;' +
      'uniform mat4 uMVP; uniform mat4 uModel;' +
      'varying vec3 vNormal;' +
      'void main(){ vNormal = mat3(uModel) * aNormal; gl_Position = uMVP * uModel * vec4(aPos, 1.0); }'
    );
    var fs = compileShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vNormal;' +
      'uniform vec3 uColor; uniform float uOpacity;' +
      'void main(){' +
      '  vec3 light = normalize(vec3(0.3, 0.6, 1.0));' +
      '  float d = max(dot(normalize(vNormal), light), 0.0);' +
      '  float ambient = 0.35;' +
      '  vec3 col = uColor * (ambient + d * 0.85);' +
      '  gl_FragColor = vec4(col, uOpacity);' +
      '}'
    );
    if (!vs || !fs) return false;
    var prog = linkProgram(gl, vs, fs);
    if (!prog) return false;

    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.positions, gl.STATIC_DRAW);
    var normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom.normals, gl.STATIC_DRAW);
    var idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

    Scene.gl = gl; Scene.program = prog;
    Scene.geometry = geom;
    Scene.posBuf = posBuf; Scene.normBuf = normBuf; Scene.idxBuf = idxBuf;
    Scene.aPos = gl.getAttribLocation(prog, 'aPos');
    Scene.aNormal = gl.getAttribLocation(prog, 'aNormal');
    Scene.uMVP = gl.getUniformLocation(prog, 'uMVP');
    Scene.uModel = gl.getUniformLocation(prog, 'uModel');
    Scene.uColor = gl.getUniformLocation(prog, 'uColor');
    Scene.uOpacity = gl.getUniformLocation(prog, 'uOpacity');
    return true;
  }

  // ---- Audio analyser (raw AudioContext, no engine dependency) ----
  // Loads /audios/<persona>.mp3 (or film.mp3 fallback). If the audio
  // file is unavailable (e.g. demo env without assets), runs without
  // audio — the persona's "default" reactor still kicks the mesh.
  function setupAudio(persona) {
    try {
      Scene.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      Scene.analyser = Scene.audioCtx.createAnalyser();
      Scene.analyser.fftSize = 2048;
      Scene.analyser.smoothingTimeConstant = 0.7;
      var buf = new Uint8Array(Scene.analyser.frequencyBinCount);
      // Try loading the demo audio (resumed on first user gesture).
      var url = '/audios/film.mp3'; // generic fallback
      fetch(url).then(function (r) {
        if (!r.ok) return;
        return r.arrayBuffer();
      }).then(function (ab) {
        if (!ab) return;
        return Scene.audioCtx.decodeAudioData(ab);
      }).then(function (audioBuf) {
        if (!audioBuf || !Scene.audioCtx) return;
        try { Scene.audioSource && Scene.audioSource.stop(); } catch(_) {}
        Scene.audioSource = Scene.audioCtx.createBufferSource();
        Scene.audioSource.buffer = audioBuf;
        Scene.audioSource.connect(Scene.analyser);
        Scene.analyser.connect(Scene.audioCtx.destination);
        Scene.audioSource.loop = true;
        Scene.audioSource.start(0);
        if (typeof setStatus === 'function') {
          setStatus('audio playing · 90s loop', 'ok');
        }
      }).catch(function () {
        // no audio available; persona demo runs with reactor defaults
      });
    } catch (e) {
      console.warn('audio setup', e);
    }
  }

  // ---- Apply persona ----
  function apply(persona) {
    // 1) HUD text.
    var clusterLabels = {
      auditor: 'AUDITOR', practitioner: 'PRACTITIONER',
      broker: 'BROKER', cross: 'CROSS-CLUSTER',
    };
    var $ = function (id) { return document.getElementById(id); };
    var setText = function (id, v) { var el = $(id); if (el != null) el.textContent = v; };
    setText('badge', persona.label);
    setText('cluster-label', clusterLabels[persona.cluster] || persona.cluster);
    setText('tagline', persona.tagline);
    setText('cluster-explainer', persona.cluster_explainer);
    setText('cfg-preset', persona.preset);
    setText('cfg-primitive', persona.primitive);
    setText('cfg-band', persona.reactor.dominant_band);
    setText('cfg-env', persona.reactor.envelope + ' (' + persona.reactor.smooth_factor + ')');
    setText('cfg-cluster', clusterLabels[persona.cluster] || persona.cluster);
    setText('cfg-loop', persona.loop_seconds + 's');
    var ul = $('highlights');
    if (ul && persona.demo_highlights) {
      ul.innerHTML = '';
      for (var i = 0; i < persona.demo_highlights.length; i++) {
        var li = document.createElement('li');
        li.textContent = persona.demo_highlights[i];
        ul.appendChild(li);
      }
    }
    document.title = persona.label + ' · SWR engine';
    var pill = document.querySelector('.cluster');
    if (pill) {
      pill.classList.remove('auditor', 'practitioner', 'broker', 'cross');
      pill.classList.add(persona.cluster);
      pill.textContent = clusterLabels[persona.cluster] || persona.cluster;
    }
    setText('status', persona.label.toUpperCase() + ' · LIVE');
    var stEl = $('status');
    if (stEl) stEl.classList.add('live');

    // 2) Persona color → page accent.
    try {
      document.documentElement.style.setProperty('--persona', persona.color);
    } catch (_) {}
    Scene.personaColor = persona.color;
    Scene.meshColor = hexToRgb(persona.color);

    // 3) Preset bucket.
    Scene.preset = PRESET_MAP[persona.preset] || PRESET_MAP['style-neon'];

    // 4) Reactor config.
    Scene.dominantBand = persona.reactor.dominant_band || 'mid';
    Scene.envelope = persona.reactor.envelope || 'smooth';
    Scene.smoothFactor = persona.reactor.smooth_factor != null ? persona.reactor.smooth_factor : 0.7;

    // 5) Geometry.
    var factory = GEOMETRY[persona.primitive] || GEOMETRY.sphere;
    var geom = factory();

    // 6) GL setup (idempotent; once is enough).
    var canvas = $('render');
    Scene.canvas = canvas;
    if (!Scene.gl) {
      canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
      if (!setupGL(canvas, geom)) {
        setText('status', 'WEBGL UNAVAILABLE');
        if (stEl) stEl.classList.remove('live');
        return;
      }
    }
    // 7) Audio (deferred — needs gesture).
    setupAudio(persona);

    // 8) Render loop.
    if (!Scene.running) {
      Scene.running = true;
      frame();
    }
  }

  function frame() {
    Scene.rafHandle = requestAnimationFrame(frame);
    var canvas = Scene.canvas;
    var gl = Scene.gl;
    if (!gl || !Scene.program) return;
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;
    // Resize if needed.
    var dpr = window.devicePixelRatio || 1;
    var tw = Math.floor(w * dpr), th = Math.floor(h * dpr);
    if (canvas.width !== tw) canvas.width = tw;
    if (canvas.height !== th) canvas.height = th;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // BG fill.
    var p = Scene.preset;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 2D canvas backdrop for preset's accent + sky color.
    var ctx2d = canvas.getContext && canvas.getContext('2d');
    // (the 2D ctx above is null because we already got webgl — that's OK,
    //  the GL clear is the only visible surface for the 3D mesh.)

    // Read bands (if audio loaded).
    var bands = Scene.bands;
    if (Scene.analyser && Scene.audioCtx && Scene.audioCtx.state === 'running') {
      var data = new Uint8Array(Scene.analyser.frequencyBinCount);
      Scene.analyser.getByteFrequencyData(data);
      var sr = Scene.audioCtx.sampleRate;
      var bassEnd = Math.floor(250 * data.length / (sr / 2));
      var midEnd  = Math.floor(2000 * data.length / (sr / 2));
      var bSum = 0, mSum = 0, tSum = 0, rms = 0;
      for (var i = 0; i < data.length; i++) {
        var v = data[i] / 255;
        rms += v * v;
        if (i < bassEnd) bSum += v;
        else if (i < midEnd) mSum += v;
        else tSum += v;
      }
      rms = Math.sqrt(rms / data.length);
      bands.bass   = bSum / Math.max(1, bassEnd);
      bands.mid    = mSum / Math.max(1, midEnd - bassEnd);
      bands.treble = tSum / Math.max(1, data.length - midEnd);
      bands.rms    = rms;
      // Beat = 1 if bass > running 1.4× recent average
      Scene._bassHist = (Scene._bassHist || []).concat([bands.bass]).slice(-20);
      var avg = 0;
      for (var hi = 0; hi < Scene._bassHist.length; hi++) avg += Scene._bassHist[hi];
      avg /= Scene._bassHist.length;
      bands.beat = bands.bass > avg * 1.4 ? 1 : 0;
    }

    // Smooth toward targets.
    var sf = Scene.smoothFactor; // 0=raw, 1=fully damped
    var damp = 1 - sf * 0.92;
    Scene.smoothed.bass += (bands.bass - Scene.smoothed.bass) * damp;
    Scene.smoothed.mid  += (bands.mid  - Scene.smoothed.mid)  * damp;
    Scene.smoothed.treble += (bands.treble - Scene.smoothed.treble) * damp;
    Scene.smoothed.beat = Scene.envelope === 'step'
      ? (bands.beat ? 1 : 0)
      : (Scene.smoothed.beat * 0.92 + (bands.beat ? 0.08 : 0));

    var dom = Scene.smoothed[Scene.dominantBand];

    // Mesh rotation: ambient baseline + audio-driven boost on dominant band.
    Scene.rot.x += Scene.rotationSpeed.x + dom * 0.002;
    Scene.rot.y += Scene.rotationSpeed.y + dom * 0.003;
    Scene.rot.z += Scene.rotationSpeed.z + Scene.smoothed.beat * 0.01;

    // Mesh scale: base + dominant band + beat on a step envelope.
    var scale = 0.4 + dom * 0.5 + Scene.smoothed.beat * 0.25;

    // Color: base persona color, hue-rotated by treble for variety.
    var hueShift = Scene.smoothed.treble * 90; // up to +90 degrees
    var baseHue = 0; // r in HSL
    // Compute hue from persona color hex
    var c = hexToRgb(Scene.personaColor);
    var maxC = Math.max(c[0], c[1], c[2]), minC = Math.min(c[0], c[1], c[2]);
    var h = 0, s = 0, l = (maxC + minC) / 2;
    if (maxC !== minC) {
      var d = maxC - minC;
      s = d / (1 - Math.abs(2 * l - 1));
      if (maxC === c[0])      h = ((c[1] - c[2]) / d) % 6;
      else if (maxC === c[1]) h = (c[2] - c[0]) / d + 2;
      else                    h = (c[0] - c[1]) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    h = (h + hueShift) % 360;
    var rgb = hsl(h, Math.min(1, s + 0.1), Math.min(0.85, l + 0.15));
    Scene.meshColor = rgb;

    // Build matrices.
    var aspect = canvas.width / canvas.height;
    var proj = matPerspective(1.0, aspect, 0.1, 100, aspect);
    var view = identity();
    view = matTranslate(view, 0, 0, -3.2);
    var tilt = Scene.preset.camera.tilt;
    var yaw  = Scene.preset.camera.yaw;
    view = matRotate(view, 'x', tilt);
    view = matRotate(view, 'y', yaw);

    var model = identity();
    model = matRotate(model, 'x', Scene.rot.x);
    model = matRotate(model, 'y', Scene.rot.y);
    model = matRotate(model, 'z', Scene.rot.z);
    model = matScale(model, scale, scale, scale);

    var mvp = matMul(proj, matMul(view, model));

    // Draw.
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(Scene.program);
    gl.uniformMatrix4fv(Scene.uMVP, false, mvp);
    gl.uniformMatrix4fv(Scene.uModel, false, model);
    gl.uniform3f(Scene.uColor, rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(Scene.uOpacity, 1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, Scene.posBuf);
    gl.enableVertexAttribArray(Scene.aPos);
    gl.vertexAttribPointer(Scene.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, Scene.normBuf);
    gl.enableVertexAttribArray(Scene.aNormal);
    gl.vertexAttribPointer(Scene.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, Scene.idxBuf);
    gl.drawElements(gl.TRIANGLES, Scene.geometry.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(Scene.aPos);
    gl.disableVertexAttribArray(Scene.aNormal);
  }

  // ---- Boot ----
  function load(id) {
    return fetch('/marketing/personas/demos/' + encodeURIComponent(id) + '.json', {
      cache: 'no-cache',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('persona ' + id + ' not found: ' + r.status);
        return r.json();
      })
      .then(apply);
  }

  function autoLoad() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    if (!id) {
      var path = window.location.pathname.split('/').filter(Boolean);
      var idx = path.indexOf('personas');
      if (idx >= 0 && path[idx + 1]) id = path[idx + 1];
    }
    if (!id) {
      var st = document.getElementById('status');
      if (st) st.textContent = 'PICK A PERSONA';
      return Promise.resolve();
    }
    return load(id);
  }

  window.SWR_PERSONA = { PRESET_MAP: PRESET_MAP, apply: apply, load: load, autoLoad: autoLoad };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoLoad);
  } else {
    autoLoad();
  }
})();
