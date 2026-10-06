// lib/gpu-grade.client.js — the set pages' colour grade, on the GPU.
//
// Why this exists: every set renderer (versions/*.html) graded its main layer
// with a per-frame CSS filter on the 2D context —
//   ctx.filter = 'hue-rotate(…) saturate(…) brightness(…) contrast(…)'
// That is a full-frame software pass on a canvas Chromium keeps in a
// CPU-readable backing store (the pages create #render with
// { willReadFrequently: true }). Measured on versions/film.html, M4 Pro:
// 97.4 ms/frame with the 2D chain vs 43.9 ms with the same chain on the GPU,
// and ~20 ms of a ~39 ms frame when only the setter was neutered.
//
// A dedicated pass rather than the engine's fx-postprocess.js shader: that
// shader is the persona composite and carries its own baseline look, so
// borrowing it would change the pages beyond the grade. This module does one
// thing — the CSS filter chain, as one fragment pass — and nothing else.
//
// Usage (no wiring needed past the script tag):
//   window.SWR_GRADE.set(sepia, hueDeg, brightness, contrast, saturate)  // per frame
//   window.SWR_GRADE.off()
// The overlay canvas (SWR_GRADE.outputCanvas) mirrors #render with the grade
// applied and is what recorders should capture.
(function () {
  if (window.SWR_GRADE) return;
  const stage = document.getElementById('render');
  if (!stage) return;

  const out = document.createElement('canvas');
  out.id = 'grade-canvas';
  out.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  stage.parentElement.appendChild(out);

  // preserveDrawingBuffer: the compositor in lib/watermark.client.js mirrors this
  // canvas with drawImage, and its first tick runs synchronously (outside this
  // module's rAF) — without preservation that read returns an empty buffer, so the
  // recording's frame 0 was the watermark on black (YAVG 18.2, identical across
  // runs with different content) instead of the frame. Costs one retained GPU
  // buffer; measured frame times are unchanged.
  const gl = out.getContext('webgl', { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) { out.remove(); return; } // no WebGL: the page keeps its own look

  const VERT = `attribute vec2 p; varying vec2 v_uv;
    void main() { v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  // The CSS filter primitives in the order the pages compose them:
  // sepia → hue-rotate → saturate → brightness → contrast. Matrices are the
  // CSS/SVG filter matrices, each step clamped, so the result matches the
  // ctx.filter output this replaces.
  const FRAG = `precision highp float; varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_sepia, u_hue, u_bright, u_contrast, u_sat;

    vec3 grade(vec3 c) {
      vec3 sep = vec3(
        dot(c, vec3(0.393, 0.769, 0.189)),
        dot(c, vec3(0.349, 0.686, 0.168)),
        dot(c, vec3(0.272, 0.534, 0.131))
      );
      c = clamp(mix(c, sep, u_sepia), 0.0, 1.0);

      float a = radians(u_hue);
      float cs = cos(a), sn = sin(a);
      vec3 h = vec3(
        dot(c, vec3(0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928)),
        dot(c, vec3(0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283)),
        dot(c, vec3(0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072))
      );
      c = clamp(h, 0.0, 1.0);

      float l = dot(c, vec3(0.213, 0.715, 0.072));
      c = clamp(mix(vec3(l), c, u_sat), 0.0, 1.0);

      c = clamp(c * u_bright, 0.0, 1.0);
      return clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
    }

    void main() { gl_FragColor = vec4(grade(texture2D(u_tex, v_uv).rgb), 1.0); }`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[gpu-grade] shader compile failed:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { out.remove(); return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { out.remove(); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const ap = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(ap);
  gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

  const u = {
    sepia: gl.getUniformLocation(prog, 'u_sepia'),
    hue: gl.getUniformLocation(prog, 'u_hue'),
    bright: gl.getUniformLocation(prog, 'u_bright'),
    contrast: gl.getUniformLocation(prog, 'u_contrast'),
    sat: gl.getUniformLocation(prog, 'u_sat'),
  };
  const state = { sepia: 0, hue: 0, bright: 1, contrast: 1, sat: 1, enabled: true };

  function frame() {
    if (state.enabled && stage.width && stage.height) {
      if (out.width !== stage.width || out.height !== stage.height) {
        out.width = stage.width;
        out.height = stage.height;
        gl.viewport(0, 0, out.width, out.height);
      }
      gl.uniform1f(u.sepia, state.sepia);
      gl.uniform1f(u.hue, state.hue);
      gl.uniform1f(u.bright, state.bright);
      gl.uniform1f(u.contrast, state.contrast);
      gl.uniform1f(u.sat, state.sat);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.SWR_GRADE = {
    state,
    outputCanvas: out,
    FRAG_SOURCE: FRAG, // for tests/previews that must stay in sync with this shader
    // Per frame, with the live (audio-reactive) values the page's chain used.
    // null/undefined for a filter the chain does not use.
    set(sepia, hue, bright, contrast, sat) {
      state.sepia = (sepia === null || sepia === undefined) ? 0 : Math.max(0, Math.min(1, sepia));
      state.hue = isFinite(hue) ? hue : 0;
      state.bright = isFinite(bright) ? Math.max(0, bright) : 1;
      state.contrast = isFinite(contrast) ? Math.max(0, contrast) : 1;
      state.sat = isFinite(sat) ? Math.max(0, sat) : 1;
      state.enabled = true;
      out.style.display = '';
    },
    // Hide the overlay entirely (the page shows its own 2D draw again).
    off() { state.enabled = false; out.style.display = 'none'; },
  };
})();
