// versions-presets.js — per-page GLSL presets for sainted-word-records/versions/*.html
//
// Each versions/*.html is a self-contained engine variant. This module
// adds a shared WebGL post-process pass (mirroring fx-postprocess.js's
// pattern) plus a per-page preset dictionary. Each page identifies itself
// via [data-page="film"] etc. on <body>; the module reads that, picks
// the matching preset, and applies FX uniforms + a page-specific GLSL
// effect via a `u_effect` uniform (0..1).
//
// The GLSL is a single shader with a switch on u_page; the JS side
// sets both the persona-style FX uniforms and the u_effect value.
//
// 19 presets in total (indices 0..18).
    // u_page index mapping (must match Object.keys(PRESETS) order):
    //   0 = film
    //   1 = grid
    //   2 = neon
    //   3 = smoke
    //   4 = hallucination
    //   5 = eclipse
    //   6 = aurora
    //   7 = chrome
    //   8 = fractal
    //   9 = glitch
    //   10 = pulse
    //   11 = void
    //   12 = watercolor
    //   13 = baroque
    //   14 = gallery
    //   15 = kraft
    //   16 = mosaic
    //   17 = phosphor
    //   18 = tape

(function () {
  if (window.VersionsPresets) return;  // idempotent

  // ---- Per-page presets ----
  // FX uniforms use the same shape as fx-postprocess.js state.
  // `effect` is a 0..1 amount for the page-specific GLSL effect.
  // `tint` adds an additional color tint not covered by temp.
  const PRESETS = {
    film: {
      label: 'FILM',
      desc:  '16mm grain + sepia + warm temperature',
      temp:      0.3,
      mut:       0.2,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.55,
      chroma:    0,
      grain:     0.85,
      sepia:     0.7,
      glow:      0.15,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [1.0, 0.86, 0.67],
    },
    grid: {
      label: 'GRID',
      desc:  'Monochrome hard cells, heavy posterize, snap to the beat',
      temp:      0,
      mut:       0.85,
      mutAlgo:   1,
      posterize: 0.95,
      vignette:  0.2,
      chroma:    0,
      grain:     0.1,
      sepia:     0,
      glow:      0,
      grayscale: 1.0,
      blur:      0,
      effect:    1.0,
      tint:      [1.0, 1.0, 1.0],
    },
    neon: {
      label: 'NEON',
      desc:  'Electric magenta/cyan, heavy chromatic aberration, glow',
      temp:      -0.3,
      mut:       0.55,
      mutAlgo:   1,
      posterize: 0.1,
      vignette:  0.1,
      chroma:    0.85,
      grain:     0.4,
      sepia:     0,
      glow:      0.4,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [1.0, 0.31, 0.78],
    },
    smoke: {
      label: 'SMOKE',
      desc:  'Cream warm heavy blur, slow drift',
      temp:      0.2,
      mut:       0.15,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.35,
      chroma:    0,
      grain:     0.15,
      sepia:     0.35,
      glow:      0.4,
      grayscale: 0,
      blur:      0.75,
      effect:    1.0,
      tint:      [0.94, 0.78, 0.59],
    },
    hallucination: {
      label: 'HALLUCINATION',
      desc:  'RGB shift, scanline body, maxed everything',
      temp:      -0.5,
      mut:       0.95,
      mutAlgo:   5,
      posterize: 0,
      vignette:  0.1,
      chroma:    1.0,
      grain:     0.9,
      sepia:     0,
      glow:      0.5,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [1.0, 0.0, 0.78],
    },
    eclipse: {
      label: 'ECLIPSE',
      desc:  'Deep black + bright corona glow, heavy vignette',
      temp:      -0.15,
      mut:       0.1,
      mutAlgo:   0,
      posterize: 0.15,
      vignette:  0.9,
      chroma:    0.2,
      grain:     0.2,
      sepia:     0,
      glow:      0.85,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [1.0, 0.78, 0.39],
    },
    aurora: {
      label: 'AURORA',
      desc:  'Pastel-mint/cyan/cyan-violet drift, low chroma, gentle bloom',
      temp:      -0.2,
      mut:       0.25,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.18,
      chroma:    0.2,
      grain:     0.05,
      sepia:     0,
      glow:      0.55,
      grayscale: 0,
      blur:      0.15,
      effect:    1.0,
      tint:      [1.0, 0.7, 1.0],
    },
    chrome: {
      label: 'CHROME',
      desc:  'Polished liquid metal, hard specular highlights, desaturated mid-tones',
      temp:      -0.05,
      mut:       0.05,
      mutAlgo:   0,
      posterize: 0.2,
      vignette:  0.3,
      chroma:    0.3,
      grain:     0.05,
      sepia:     0,
      glow:      0.45,
      grayscale: 0.25,
      blur:      0,
      effect:    1.0,
      tint:      [0.85, 0.92, 1.0],
    },
    fractal: {
      label: 'FRACTAL',
      desc:  'Mandelbrot-adjacent colour wash, heavy chroma + grain',
      temp:      0.0,
      mut:       0.4,
      mutAlgo:   4,
      posterize: 0.3,
      vignette:  0.35,
      chroma:    0.6,
      grain:     0.35,
      sepia:     0,
      glow:      0.3,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [0.78, 0.45, 1.0],
    },
    glitch: {
      label: 'GLITCH',
      desc:  'Datamosh: horizontal slice displacement, RGB split, beat-locked',
      temp:      0.0,
      mut:       0.9,
      mutAlgo:   2,
      posterize: 0.35,
      vignette:  0.1,
      chroma:    0.7,
      grain:     0.5,
      sepia:     0,
      glow:      0.1,
      grayscale: 0,
      blur:      0,
      effect:    1.0,
      tint:      [0.3, 1.0, 0.8],
    },
    pulse: {
      label: 'PULSE',
      desc:  'Bass-locked concentric pulse rings on a deep navy field',
      temp:      -0.2,
      mut:       0.1,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.45,
      chroma:    0.15,
      grain:     0.15,
      sepia:     0,
      glow:      0.4,
      grayscale: 0,
      blur:      0.1,
      effect:    1.0,
      tint:      [0.4, 0.85, 1.0],
    },
    void: {
      label: 'VOID',
      desc:  'Pure black canvas with a faint scan of single-pixel highlights',
      temp:      -0.45,
      mut:       0.05,
      mutAlgo:   0,
      posterize: 0.6,
      vignette:  0.95,
      chroma:    0.05,
      grain:     0.55,
      sepia:     0,
      glow:      0.1,
      grayscale: 0.4,
      blur:      0,
      effect:    1.0,
      tint:      [0.78, 0.92, 1.0],
    },
    watercolor: {
      label: 'WATERCOLOR',
      desc:  'Soft pastel pigment pools, edge bleed, very low contrast',
      temp:      0.15,
      mut:       0.05,
      mutAlgo:   0,
      posterize: 0.1,
      vignette:  0.2,
      chroma:    0.05,
      grain:     0.2,
      sepia:     0.1,
      glow:      0.3,
      grayscale: 0,
      blur:      0.45,
      effect:    1.0,
      tint:      [1.0, 0.8, 0.85],
    },
    baroque: {
      label: 'BAROQUE',
      desc:  'Stub preset — gilded ornament tone (page-target only)',
      temp:      0.2,
      mut:       0.0,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.4,
      chroma:    0.0,
      grain:     0.1,
      sepia:     0.3,
      glow:      0.2,
      grayscale: 0,
      blur:      0,
      effect:    0.0,
      tint:      [1.0, 0.78, 0.39],
    },
    gallery: {
      label: 'GALLERY',
      desc:  'Stub preset — clean gallery-white tone (page-target only)',
      temp:      0.0,
      mut:       0.0,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0.1,
      chroma:    0.0,
      grain:     0.0,
      sepia:     0,
      glow:      0.0,
      grayscale: 0,
      blur:      0,
      effect:    0.0,
      tint:      [1.0, 1.0, 1.0],
    },
    kraft: {
      label: 'KRAFT',
      desc:  'Stub preset — brown-paper texture tone (page-target only)',
      temp:      0.1,
      mut:       0.0,
      mutAlgo:   0,
      posterize: 0.1,
      vignette:  0.3,
      chroma:    0.0,
      grain:     0.35,
      sepia:     0.5,
      glow:      0.0,
      grayscale: 0,
      blur:      0,
      effect:    0.0,
      tint:      [0.82, 0.65, 0.45],
    },
    mosaic: {
      label: 'MOSAIC',
      desc:  'Stub preset — stained-glass tile tone (page-target only)',
      temp:      -0.1,
      mut:       0.0,
      mutAlgo:   0,
      posterize: 0.4,
      vignette:  0.2,
      chroma:    0.2,
      grain:     0.1,
      sepia:     0,
      glow:      0.2,
      grayscale: 0,
      blur:      0,
      effect:    0.0,
      tint:      [0.4, 0.78, 1.0],
    },
    phosphor: {
      label: 'PHOSPHOR',
      desc:  'Stub preset — green CRT tone (page-target only)',
      temp:      -0.3,
      mut:       0.0,
      mutAlgo:   0,
      posterize: 0.2,
      vignette:  0.5,
      chroma:    0.0,
      grain:     0.1,
      sepia:     0,
      glow:      0.5,
      grayscale: 0.3,
      blur:      0,
      effect:    0.0,
      tint:      [0.3, 1.0, 0.4],
    },
    tape: {
      label: 'TAPE',
      desc:  'Stub preset — VHS tape-tone (page-target only)',
      temp:      0.05,
      mut:       0.1,
      mutAlgo:   0,
      posterize: 0.1,
      vignette:  0.3,
      chroma:    0.2,
      grain:     0.3,
      sepia:     0.1,
      glow:      0.1,
      grayscale: 0,
      blur:      0,
      effect:    0.0,
      tint:      [0.9, 0.78, 0.7],
    },
  };

  // ---- Fragment shader: same base as fx-postprocess + per-page effect ----
  // We bake the per-page effects inline (single shader, u_effect switches).
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_time;
    uniform float u_bass, u_mid, u_treble, u_beat;
    uniform float u_temp, u_mut, u_mutAlgo;
    uniform float u_posterize, u_vignette, u_chroma, u_grain, u_sepia, u_glow;
    uniform float u_grayscale, u_blur;
    uniform float u_effect;        // 0..1 master mix
    uniform int   u_page;          // film, grid, neon, smoke, hallucination, eclipse, aurora, chrome, fractal, glitch, pulse, void, watercolor, baroque, gallery, kraft, mosaic, phosphor, tape
    uniform vec3  u_tint;

    // -- shared helpers (inlined, mirrors fx-postprocess.js) --
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    vec3 temperature(vec3 c, float t) {
      if (abs(t) < 0.01) return c;
      vec3 warm = vec3(1.0, 0.85, 0.65);
      vec3 cool = vec3(0.78, 0.92, 1.1);
      vec3 tint = (t > 0.0) ? warm : cool;
      float amt = abs(t) * 0.35;
      return mix(c, c * tint, amt);
    }
    vec3 sepiaTint(vec3 c, float amt) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 s = vec3(l * 1.07, l * 0.94, l * 0.74);
      return mix(c, s, amt);
    }
    vec3 toGray(vec3 c, float amt) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(c, vec3(l), amt);
    }
    // Simple 3x3 box blur
    vec3 blur3x3(sampler2D t, vec2 uv, vec2 px) {
      vec3 a = vec3(0.0);
      a += texture2D(t, uv + vec2(-px.x, -px.y)).rgb * 0.5;
      a += texture2D(t, uv + vec2( 0.0, -px.y)).rgb * 1.0;
      a += texture2D(t, uv + vec2( px.x, -px.y)).rgb * 0.5;
      a += texture2D(t, uv + vec2(-px.x,  0.0)).rgb * 1.0;
      a += texture2D(t, uv).rgb * 1.0;
      a += texture2D(t, uv + vec2( px.x,  0.0)).rgb * 1.0;
      a += texture2D(t, uv + vec2(-px.x,  px.y)).rgb * 0.5;
      a += texture2D(t, uv + vec2( 0.0,  px.y)).rgb * 1.0;
      a += texture2D(t, uv + vec2( px.x,  px.y)).rgb * 0.5;
      return a / 6.0;
    }

    // -- per-page effect functions --
    // Each returns a vec3 with the effect applied. Caller mixes with
    // original by u_effect amount.

    // FILM: scanlines + film-dust speckles
    vec3 filmEffect(vec3 c, vec2 uv, float t) {
      float scan = 1.0 - 0.35 * step(0.5, fract(uv.y * 240.0));
      float dust = hash(floor(uv * vec2(640.0, 360.0)) + floor(t * 12.0));
      float speckle = (dust > 0.997) ? 0.4 : (dust < 0.003 ? -0.3 : 0.0);
      return c * scan + speckle;
    }


    // GRID: 16x16 cell grid overlay
    vec3 gridEffect(vec3 c, vec2 uv) {
      vec2 cell = floor(uv * vec2(16.0, 9.0));
      vec2 frac = fract(uv * vec2(16.0, 9.0));
      float line = step(0.94, max(frac.x, frac.y));
      return c * (1.0 - line * 0.6);
    }


    // NEON: bright-color glow halos around the brightest pixels
    vec3 neonEffect(vec3 c, vec2 uv) {
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 hot = max(c - 0.5, 0.0) * u_tint;
      return c + hot * 0.6;
    }


    // SMOKE: gentle horizontal wisps (low-freq sine on x)
    vec3 smokeEffect(vec3 c, vec2 uv) {
      float wisp = sin(uv.y * 6.0 + u_time * 0.3) * 0.06 +
                  sin(uv.x * 4.0 - u_time * 0.2) * 0.04;
      return c * (1.0 + wisp);
    }


    // HALLUCINATION: scanlines + RGB-drift stripes
    vec3 hallucinationEffect(vec3 c, vec2 uv) {
      float scan = 1.0 - 0.4 * step(0.5, fract(uv.y * 200.0));
      vec3 drift = u_tint * 0.15;
      return c * scan + drift;
    }


    // ECLIPSE: radial corona ring at d ~ 0.3
    vec3 eclipseEffect(vec3 c, vec2 uv) {
      vec2 v = uv - 0.5;
      float d = length(v);
      float corona = exp(-pow((d - 0.3) * 12.0, 2.0));
      return c + vec3(1.0, 0.78, 0.4) * corona * 0.4;
    }


    // AURORA: vertical pastel ribbons driven by audio bands
    vec3 auroraEffect(vec3 c, vec2 uv, float t) {
      // 4 stacked sine bands at different speeds; tinted to the preset palette
      vec2 p = uv;
      float r = 0.0;
      r += sin(p.y * 3.0  + t * 0.30 + u_bass  * 1.4) * 0.06;
      r += sin(p.y * 5.0  - t * 0.18 + u_mid   * 1.2) * 0.04;
      r += sin(p.x * 2.0  + t * 0.10 + u_treble * 1.0) * 0.03;
      float mask = smoothstep(0.18, 0.82, p.y + r);
      vec3 ribbon = mix(vec3(0.0), u_tint, mask);
      return c + ribbon * 0.10;
    }


    // CHROME: specular highlight band that slides with bass
    vec3 chromeEffect(vec3 c, vec2 uv, float t) {
      // Diagonal highlight: perpendicular distance to a moving line.
      float angle = 0.6 + u_bass * 0.4;
      vec2 dir = vec2(cos(angle), sin(angle));
      float d = dot(uv - 0.5, dir);
      float band = smoothstep(0.012, 0.0, abs(d - sin(t * 0.5) * 0.2));
      // Boost mid-tones, push specular white
      vec3 hi = mix(c, vec3(1.0), band * 0.85);
      vec3 shadow = c * (1.0 - band * 0.6);
      return mix(shadow, hi, 0.85);
    }


    // FRACTAL: layered warp based on a noise field
    vec3 fractalEffect(vec3 c, vec2 uv, float t) {
      vec2 q = uv - 0.5;
      // Iterated warp (3 passes) — approximate domain distortion without
      // pulling in a real Mandelbrot loop (the visuals on the canvas already
      // carry the geometry; this just adds a colour wash + ridges).
      vec2 w = q;
      for (int i = 0; i < 3; i++) {
        float a = atan(w.y, w.x);
        float r = length(w);
        w = q + 0.10 * vec2(cos(a * 3.0 + t * 0.3 + u_mid * 2.0),
                             sin(a * 3.0 + t * 0.3 + u_mid * 2.0)) * r;
      }
      float ridge = 0.5 + 0.5 * sin(w.x * 12.0 + w.y * 9.0 + t);
      vec3 wash = u_tint * ridge;
      return mix(c, c + wash * 0.4, 0.55);
    }


    // GLITCH: horizontal slice displacement (datamosh)
    vec3 glitchEffect(vec3 c, vec2 uv, float t) {
      // Quantize Y into ~24 slices; each slice shifts X by a noisy offset.
      float slice = floor(uv.y * 24.0);
      float n = hash(vec2(slice, floor(t * 8.0))) - 0.5;
      float jitter = n * 0.05 * (0.4 + u_beat);
      vec2 suv = vec2(fract(uv.x + jitter), uv.y);
      vec3 src = texture2D(u_tex, suv).rgb;
      // RGB-split on the same slice: red and blue pulled apart by jitter
      float split = abs(jitter) * 4.0;
      src.r = mix(src.r, texture2D(u_tex, vec2(fract(uv.x + split), uv.y)).r, 0.8);
      src.b = mix(src.b, texture2D(u_tex, vec2(fract(uv.x - split), uv.y)).b, 0.8);
      return mix(c, src, 0.85);
    }


    // PULSE: concentric rings emanating from center, bass-locked
    vec3 pulseEffect(vec3 c, vec2 uv, float t) {
      vec2 v = uv - 0.5;
      float d = length(v);
      // Ring phase advances with bass; ring width tightens on beat.
      float phase = t * 0.6 + u_bass * 2.0;
      float rings = sin(d * 30.0 - phase * 6.2832);
      float ring = smoothstep(0.65, 1.0, rings);
      return c + u_tint * ring * 0.25;
    }


    // VOID: nearly-black with sparse single-pixel highlights (stars)
    vec3 voidEffect(vec3 c, vec2 uv, float t) {
      // Sparse dot field; cells light up on beat for a twinkle.
      vec2 cell = floor(uv * vec2(180.0, 100.0));
      float n = hash(cell + floor(t * 2.0));
      float star = step(0.997, n) * (0.5 + u_beat * 0.5);
      return c + vec3(star) * u_tint * 0.7;
    }


    // WATERCOLOR: pigment-edge detection — amplify local luma gradient then
    // desaturate. Approximates the dark rim around a wet pigment pool.
    vec3 watercolorEffect(vec3 c, vec2 uv, float t) {
      vec2 px = vec2(1.0 / 1280.0, 1.0 / 720.0);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float lx = dot(texture2D(u_tex, uv + vec2(px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float ly = dot(texture2D(u_tex, uv + vec2(0.0, px.y)).rgb, vec3(0.299, 0.587, 0.114));
      float edge = clamp(1.0 - smoothstep(0.0, 0.06, length(vec2(lx - l, ly - l))), 0.0, 1.0);
      vec3 rim = u_tint * edge * 0.55;
      return mix(c, c + rim, 0.85);
    }


    // BAROQUE: passthrough — page has no canvas pipeline yet
    vec3 baroqueEffect(vec3 c, vec2 uv, float t) {
      return c;
    }


    // GALLERY: passthrough — page has no canvas pipeline yet
    vec3 galleryEffect(vec3 c, vec2 uv, float t) {
      return c;
    }


    // KRAFT: passthrough — page has no canvas pipeline yet
    vec3 kraftEffect(vec3 c, vec2 uv, float t) {
      return c;
    }


    // MOSAIC: passthrough — page has no canvas pipeline yet
    vec3 mosaicEffect(vec3 c, vec2 uv, float t) {
      return c;
    }


    // PHOSPHOR: passthrough — page has no canvas pipeline yet
    vec3 phosphorEffect(vec3 c, vec2 uv, float t) {
      return c;
    }


    // TAPE: passthrough — page has no canvas pipeline yet
    vec3 tapeEffect(vec3 c, vec2 uv, float t) {
      return c;
    }

    vec3 applyPageEffect(vec3 c, vec2 uv, float t) {
      if (u_effect < 0.01) return c;
      vec3 e;
      if      (u_page == 0)  e = filmEffect(c, uv, t);
      else if (u_page == 1) e = gridEffect(c, uv);
      else if (u_page == 2) e = neonEffect(c, uv);
      else if (u_page == 3) e = smokeEffect(c, uv);
      else if (u_page == 4) e = hallucinationEffect(c, uv);
      else if (u_page == 5) e = eclipseEffect(c, uv);
      else if (u_page == 6) e = auroraEffect(c, uv, t);
      else if (u_page == 7) e = chromeEffect(c, uv, t);
      else if (u_page == 8) e = fractalEffect(c, uv, t);
      else if (u_page == 9) e = glitchEffect(c, uv, t);
      else if (u_page == 10) e = pulseEffect(c, uv, t);
      else if (u_page == 11) e = voidEffect(c, uv, t);
      else if (u_page == 12) e = watercolorEffect(c, uv, t);
      else if (u_page == 13) e = baroqueEffect(c, uv, t);
      else if (u_page == 14) e = galleryEffect(c, uv, t);
      else if (u_page == 15) e = kraftEffect(c, uv, t);
      else if (u_page == 16) e = mosaicEffect(c, uv, t);
      else if (u_page == 17) e = phosphorEffect(c, uv, t);
      else if (u_page == 18) e = tapeEffect(c, uv, t);
      return mix(c, e, u_effect);
    }

    void main() {
      vec2 uv = v_uv;

      // Blur pre-pass
      vec3 col;
      vec2 px = vec2(1.0 / 1280.0, 1.0 / 720.0);
      if (u_blur > 0.001) {
        col = blur3x3(u_tex, uv, px);
      } else {
        col = texture2D(u_tex, uv).rgb;
      }

      // Chromatic aberration (split sample)
      float split = 0.003 * u_mut + 0.018 * u_chroma;
      if (u_chroma > 0.001) {
        col.r = mix(col.r, texture2D(u_tex, uv + vec2( split, 0.0)).r, u_chroma);
        col.b = mix(col.b, texture2D(u_tex, uv + vec2(-split, 0.0)).b, u_chroma);
      }

      // Temperature
      col = temperature(col, u_temp);

      // Grayscale
      if (u_grayscale > 0.001) col = toGray(col, u_grayscale);

      // Sepia
      if (u_sepia > 0.001) col = sepiaTint(col, u_sepia);

      // Posterize
      if (u_posterize > 0.001) {
        float levels = mix(256.0, 3.0, u_posterize);
        col = floor(col * levels) / levels;
      }

      // Beat pulse
      col *= 1.0 + u_beat * 0.12;

      // Glow (bloom-ish: 4-neighbor avg)
      if (u_glow > 0.001) {
        vec3 bloom = vec3(0.0);
        bloom += texture2D(u_tex, uv + vec2( px.x * 6.0, 0.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(-px.x * 6.0, 0.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(0.0,  px.y * 6.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(0.0, -px.y * 6.0)).rgb;
        bloom *= 0.25;
        col += bloom * u_glow * 0.35;
      }

      // Vignette
      vec2 v = v_uv - 0.5;
      float vig = 1.0 - dot(v, v) * (0.4 + u_vignette * 1.6);
      col *= max(vig, 0.0);

      // Per-page effect (after vignette, so it dominates)
      col = applyPageEffect(col, uv, u_time);

      // Grain last (on top of everything)
      if (u_grain > 0.001) {
        float g = (hash(v_uv * 1024.0 + u_time) - 0.5) * u_grain * 0.18;
        col += g;
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  // ---- WebGL pipeline (mirrors fx-postprocess.js) ----
  function init() {
    const stageCanvas = document.getElementById('render');
    if (!stageCanvas) {
      console.warn('[versions-presets] #render canvas not found');
      return;
    }

    // Find the page key
    const body = document.body || document.documentElement;
    const pageKey = (body.dataset && body.dataset.page) || detectPageFromTitle();
    if (!pageKey || !PRESETS[pageKey]) {
      console.warn('[versions-presets] no data-page attribute; skipping');
      return;
    }
    const preset = PRESETS[pageKey];

    // Create overlay canvas
    let out = document.getElementById('fx-canvas');
    if (!out) {
      out = document.createElement('canvas');
      out.id = 'fx-canvas';
      out.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
      stageCanvas.parentElement.appendChild(out);
    }

    function sizeFx() {
      const r = stageCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.min(Math.round(r.width * dpr), 1920);
      const H = Math.min(Math.round(r.height * dpr), 1080);
      if (out.width !== W || out.height !== H) {
        out.width = W;
        out.height = H;
        return true;
      }
      return false;
    }

    const gl = out.getContext('webgl', { premultipliedAlpha: false }) ||
               out.getContext('experimental-webgl');
    if (!gl) {
      console.warn('[versions-presets] WebGL not available; post-process disabled');
      return;
    }

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        console.error('[versions-presets] shader compile error:', log);
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
      console.error('[versions-presets] link error:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1, 1,  -1, 1,  1, -1,  1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const u = {
      tex:       gl.getUniformLocation(prog, 'u_tex'),
      time:      gl.getUniformLocation(prog, 'u_time'),
      bass:      gl.getUniformLocation(prog, 'u_bass'),
      mid:       gl.getUniformLocation(prog, 'u_mid'),
      treble:    gl.getUniformLocation(prog, 'u_treble'),
      beat:      gl.getUniformLocation(prog, 'u_beat'),
      temp:      gl.getUniformLocation(prog, 'u_temp'),
      mut:       gl.getUniformLocation(prog, 'u_mut'),
      mutAlgo:   gl.getUniformLocation(prog, 'u_mutAlgo'),
      posterize: gl.getUniformLocation(prog, 'u_posterize'),
      vignette:  gl.getUniformLocation(prog, 'u_vignette'),
      chroma:    gl.getUniformLocation(prog, 'u_chroma'),
      grain:     gl.getUniformLocation(prog, 'u_grain'),
      sepia:     gl.getUniformLocation(prog, 'u_sepia'),
      glow:      gl.getUniformLocation(prog, 'u_glow'),
      grayscale: gl.getUniformLocation(prog, 'u_grayscale'),
      blur:      gl.getUniformLocation(prog, 'u_blur'),
      effect:    gl.getUniformLocation(prog, 'u_effect'),
      page:      gl.getUniformLocation(prog, 'u_page'),
      tint:      gl.getUniformLocation(prog, 'u_tint'),
    };

    // Texture from #render
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(u.tex, 0);

    // Page index
    const pageKeys = Object.keys(PRESETS);
    const pageIdx = pageKeys.indexOf(pageKey);

    sizeFx();

    let t0 = performance.now();
    function render() {
      const now = performance.now();
      const t = (now - t0) / 1000;
      gl.viewport(0, 0, out.width, out.height);

      // Audio features (read from window.Audio if present, else static)
      const Audio = window.Audio || {};
      const feat = Audio.feat || {};
      const bass = feat.bass || 0;
      const mid = feat.mid || 0;
      const treble = feat.treble || 0;
      const beat = feat.beat || 0;

      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
      } catch (e) {
        requestAnimationFrame(render);
        return;
      }

      gl.uniform1f(u.time,      t);
      gl.uniform1f(u.bass,      bass);
      gl.uniform1f(u.mid,       mid);
      gl.uniform1f(u.treble,    treble);
      gl.uniform1f(u.beat,      beat);
      gl.uniform1f(u.temp,      preset.temp);
      gl.uniform1f(u.mut,       preset.mut);
      gl.uniform1f(u.mutAlgo,   preset.mutAlgo);
      gl.uniform1f(u.posterize, preset.posterize);
      gl.uniform1f(u.vignette,  preset.vignette);
      gl.uniform1f(u.chroma,    preset.chroma);
      gl.uniform1f(u.grain,     preset.grain);
      gl.uniform1f(u.sepia,     preset.sepia);
      gl.uniform1f(u.glow,      preset.glow);
      gl.uniform1f(u.grayscale, preset.grayscale);
      gl.uniform1f(u.blur,      preset.blur);
      gl.uniform1f(u.effect,    preset.effect);
      gl.uniform1i(u.page,      pageIdx);
      gl.uniform3f(u.tint,      preset.tint[0], preset.tint[1], preset.tint[2]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    // Resize handling
    let resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sizeFx, 100);
    }
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(onResize).observe(stageCanvas);
    }
  }

  function detectPageFromTitle() {
    const t = (document.title || '').toLowerCase();
    const keys = Object.keys(PRESETS);
    for (const k of keys) {
      if (t.indexOf(k) !== -1) return k;
    }
    return null;
  }

  // Defer to next tick so inline <script> can set body[data-page] first.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.VersionsPresets = { PRESETS, init };
})();
