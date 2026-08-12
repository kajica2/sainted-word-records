// fx-postprocess.js — WebGL post-process pass for temperature + mutations
// Reads the 2D-composited stage canvas as a texture, applies a fragment shader,
// renders to #fx-canvas. CSS overlays #fx-canvas on top of #render so the user
// sees the post-processed output.
//
// Usage: include this script after the main IIFE. It auto-initializes on load.
// Exposes window.FX with uniforms state and setTemp/setMut/setAlgo API.

(function () {
  if (window.FX) return;  // idempotent

  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;       // 0..1
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Fragment shader: temperature (warm/cool hue shift), mutations (algorithmic
  // displacement of UV before sampling), beat-driven brightness pulse.
  // All driven by uniforms the main app writes each frame.
  const FRAG = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_time;
    uniform float u_bass;     // 0..1
    uniform float u_mid;      // 0..1
    uniform float u_treble;   // 0..1
    uniform float u_beat;     // 0..1 envelope
    uniform float u_temp;     // -1..1 (cold..warm)
    uniform float u_mut;      // 0..1 mutation amount
    uniform float u_mutAlgo;  // 0..5 (selects mutation algorithm)

    // 2D hash for procedural noise
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.02;
        a *= 0.5;
      }
      return v;
    }

    // Mutation algorithms — each returns a UV offset
    vec2 mutate(vec2 uv, float t, float amt, float algo) {
      if (amt < 0.001) return uv;
      vec2 off = vec2(0.0);
      float a = floor(algo + 0.5);
      if (a < 0.5) {
        // 0: vortex — swirl around center, scaled by time + bass
        vec2 c = uv - 0.5;
        float r = length(c);
        float ang = (1.0 - r) * 3.0 * amt + t * 0.6;
        float ca = cos(ang), sa = sin(ang);
        off = (mat2(ca, -sa, sa, ca) * c) - c;
      } else if (a < 1.5) {
        // 1: glitch — blocky UV displacement on bass kicks
        float blockX = floor(uv.x * 40.0) / 40.0;
        float blockY = floor(uv.y * 30.0) / 30.0;
        float n = hash(vec2(blockX, blockY) + floor(t * 8.0));
        off = vec2((n - 0.5) * 0.15, (hash(vec2(blockY, blockX) + floor(t * 11.0)) - 0.5) * 0.15) * amt;
      } else if (a < 2.5) {
        // 2: liquid — fbm UV warp, time-animated
        vec2 p = uv * 6.0 + t * 0.3;
        off = vec2(fbm(p), fbm(p + 5.2)) * 0.12 * amt;
      } else if (a < 3.5) {
        // 3: kaleidoscope — mirror-and-rotate sampling around center
        vec2 c = uv - 0.5;
        float r = length(c), ang = atan(c.y, c.x);
        float seg = 6.0;
        ang = mod(ang, 6.2831853 / seg);
        ang = abs(ang - 3.1415926 / seg);
        vec2 d = vec2(cos(ang), sin(ang)) * r;
        off = (d + 0.5) - uv;       // mutated UV returns to original sample space
        off *= amt * 0.5;
      } else if (a < 4.5) {
        // 4: ripple — concentric waves from center, beat-modulated
        vec2 c = uv - 0.5;
        float r = length(c);
        float wave = sin(r * 30.0 - t * 4.0) * 0.04 * (0.5 + u_bass);
        off = normalize(c + 1e-5) * wave * amt;
      } else {
        // 5: chromatic noise — fbm noise as displacement
        vec2 p = uv * 8.0 + t * 0.5;
        off = vec2(fbm(p + 1.7), fbm(p + 3.1)) - 0.5;
        off *= 0.18 * amt;
      }
      return uv + off;
    }

    // Temperature: warm shifts toward red/yellow, cool toward blue/cyan
    vec3 temperature(vec3 c, float t) {
      if (abs(t) < 0.01) return c;
      vec3 warm = vec3(1.0, 0.85, 0.65);
      vec3 cool = vec3(0.78, 0.92, 1.1);
      vec3 tint = (t > 0.0) ? warm : cool;
      float amt = abs(t) * 0.35;
      return mix(c, c * tint, amt);
    }

    void main() {
      vec2 uv = mutate(v_uv, u_time, u_mut, u_mutAlgo);

      // Subtle chromatic split that grows with mutations amount
      float split = 0.003 * u_mut;
      vec3 col;
      col.r = texture2D(u_tex, uv + vec2( split, 0.0)).r;
      col.g = texture2D(u_tex, uv).g;
      col.b = texture2D(u_tex, uv + vec2(-split, 0.0)).b;

      // Temperature tint
      col = temperature(col, u_temp);

      // Beat-driven brightness pulse (multiplicative, soft)
      col *= 1.0 + u_beat * 0.12;

      // Soft vignette tied to mid energy
      vec2 v = v_uv - 0.5;
      float vig = 1.0 - dot(v, v) * (0.4 + u_mid * 0.4);
      col *= vig;

      // Film grain tied to treble (very subtle)
      float g = (hash(v_uv * 1024.0 + u_time) - 0.5) * u_treble * 0.06;
      col += g;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  // ---- State ----
  const state = {
    temp: 0,           // -1..1
    mut: 0,            // 0..1
    mutAlgo: 0,        // 0..5
    enabled: true,
    bass: 0, mid: 0, treble: 0, beat: 0,
    time: 0,
  };

  // ---- Init ----
  function init() {
    const stageCanvas = document.getElementById('render');
    if (!stageCanvas) {
      console.warn('[fx-postprocess] #render canvas not found');
      return;
    }

    // Create overlay canvas if not present
    let out = document.getElementById('fx-canvas');
    if (!out) {
      out = document.createElement('canvas');
      out.id = 'fx-canvas';
      // Match #render's CSS layout — absolutely positioned overlay
      out.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
      stageCanvas.parentElement.appendChild(out);
    }

    // Wait for the render canvas to have dimensions
    function sizeFx() {
      const w = stageCanvas.clientWidth || stageCanvas.width;
      const h = stageCanvas.clientHeight || stageCanvas.height;
      // Backing store at native pixel ratio (cap to 1920 for perf)
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.min(Math.round(w * dpr), 1920);
      const H = Math.min(Math.round(h * dpr), 1080);
      if (out.width !== W || out.height !== H) {
        out.width = W;
        out.height = H;
        return true;  // size changed; need to update viewport
      }
      return false;
    }

    // WebGL setup
    const gl = out.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false })
           || out.getContext('experimental-webgl');
    if (!gl) {
      console.warn('[fx-postprocess] WebGL not available; post-process disabled');
      return;
    }

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        console.error('[fx-postprocess] shader compile error:', log);
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[fx-postprocess] program link error:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const u = {
      tex:     gl.getUniformLocation(prog, 'u_tex'),
      time:    gl.getUniformLocation(prog, 'u_time'),
      bass:    gl.getUniformLocation(prog, 'u_bass'),
      mid:     gl.getUniformLocation(prog, 'u_mid'),
      treble:  gl.getUniformLocation(prog, 'u_treble'),
      beat:    gl.getUniformLocation(prog, 'u_beat'),
      temp:    gl.getUniformLocation(prog, 'u_temp'),
      mut:     gl.getUniformLocation(prog, 'u_mut'),
      mutAlgo: gl.getUniformLocation(prog, 'u_mutAlgo'),
    };

    // Texture from #render
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(u.tex, 0);

    let t0 = performance.now();
    let lastResize = 0;
    function render() {
      if (!state.enabled) {
        requestAnimationFrame(render);
        return;
      }
      const now = performance.now();
      state.time = (now - t0) / 1000;

      // Resize check (throttled)
      if (now - lastResize > 200) {
        lastResize = now;
        sizeFx();
      }
      gl.viewport(0, 0, out.width, out.height);

      // Pull latest audio features from SWR if available
      const Audio = (window.SWR && window.SWR.Audio) || null;
      if (Audio && Audio.feat) {
        state.bass = Audio.feat.bass || 0;
        state.mid = Audio.feat.mid || 0;
        state.treble = Audio.feat.treble || 0;
        state.beat = Audio.feat.beat || 0;
      }

      // Copy current #render pixels into the texture
      // Note: this is a GPU upload each frame. Fine up to 1920x1080.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
      } catch (e) {
        // Texture size mismatch (canvas not ready yet). Skip this frame.
        requestAnimationFrame(render);
        return;
      }

      // Update uniforms
      gl.uniform1f(u.time,   state.time);
      gl.uniform1f(u.bass,   state.bass);
      gl.uniform1f(u.mid,    state.mid);
      gl.uniform1f(u.treble, state.treble);
      gl.uniform1f(u.beat,   state.beat);
      gl.uniform1f(u.temp,   state.temp);
      gl.uniform1f(u.mut,    state.mut);
      gl.uniform1f(u.mutAlgo, state.mutAlgo);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);

    // Resize observer to keep output canvas in sync with #render
    const ro = new ResizeObserver(() => sizeFx());
    ro.observe(stageCanvas);

    // Expose for the wizard
    window.FX = {
      state,
      setTemp(v) { state.temp = Math.max(-1, Math.min(1, v)); },
      setMut(v)  { state.mut  = Math.max(0, Math.min(1, v)); },
      setAlgo(a) { state.mutAlgo = Math.max(0, Math.min(5, Math.floor(a))); },
      setEnabled(on) { state.enabled = !!on; },
      outputCanvas: out,    // for recorder to captureStream()
    };

    sizeFx();  // initial sizing
  }

  // Wait for DOM ready + main IIFE to have populated SWR
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);  // small delay so SWR has been exposed
  }
})();