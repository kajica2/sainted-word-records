#!/usr/bin/env python3
"""
_gen_presets.py — emit full versions-presets.js with ALL 19 engine presets
(13 missing + 6 existing) + matching GLSL effect functions in the FRAG shader
and an extended u_page switch.

Run from project root:
    python3 _gen_presets.py

This rewrites versions-presets.js wholesale so the JS stays in sync with the
design system below. All engine variants get a distinct:
  - preset dict (FX uniforms)
  - GLSL effect function (visual motif)
  - tint (color story)
  - description

Engines marked STUB (baroque/gallery/kraft/mosaic/phosphor/tape) are still
shipped because the codemods treat them as page-targets but they have no
canvas pipeline. They get a passthrough preset + a placeholder shader effect so
the page doesn't show a "no data-page" warning if anyone wires it up later.
"""

from pathlib import Path

OUT = Path("versions-presets.js")

# Per-engine design language.
# Each entry: (preset_dict, glsl_function_body, glsl_signature)
# u_tint values are 0..1 RGB.
# Page index is set by Object.keys(PRESETS).indexOf(pageKey).

PRESETS = [
    # ---------------- 0..5 EXISTING (kept) ----------------
    {
        "key": "film",
        "label": "FILM",
        "desc": "16mm grain + sepia + warm temperature",
        "page_idx": 0,
        "temp": 0.30, "mut": 0.20, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.55, "chroma": 0, "grain": 0.85, "sepia": 0.70,
        "glow": 0.15, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [1.0, 0.86, 0.67],
        "effect_fn": """
    // FILM: scanlines + film-dust speckles
    vec3 filmEffect(vec3 c, vec2 uv, float t) {
      float scan = 1.0 - 0.35 * step(0.5, fract(uv.y * 240.0));
      float dust = hash(floor(uv * vec2(640.0, 360.0)) + floor(t * 12.0));
      float speckle = (dust > 0.997) ? 0.4 : (dust < 0.003 ? -0.3 : 0.0);
      return c * scan + speckle;
    }""",
    },
    {
        "key": "grid",
        "label": "GRID",
        "desc": "Monochrome hard cells, heavy posterize, snap to the beat",
        "page_idx": 1,
        "temp": 0, "mut": 0.85, "mutAlgo": 1, "posterize": 0.95,
        "vignette": 0.20, "chroma": 0, "grain": 0.10, "sepia": 0,
        "glow": 0, "grayscale": 1.0, "blur": 0,
        "effect": 1.0, "tint": [1.0, 1.0, 1.0],
        "effect_fn": """
    // GRID: 16x16 cell grid overlay
    vec3 gridEffect(vec3 c, vec2 uv) {
      vec2 cell = floor(uv * vec2(16.0, 9.0));
      vec2 frac = fract(uv * vec2(16.0, 9.0));
      float line = step(0.94, max(frac.x, frac.y));
      return c * (1.0 - line * 0.6);
    }""",
    },
    {
        "key": "neon",
        "label": "NEON",
        "desc": "Electric magenta/cyan, heavy chromatic aberration, glow",
        "page_idx": 2,
        "temp": -0.30, "mut": 0.55, "mutAlgo": 1, "posterize": 0.10,
        "vignette": 0.10, "chroma": 0.85, "grain": 0.40, "sepia": 0,
        "glow": 0.40, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [1.0, 0.31, 0.78],
        "effect_fn": """
    // NEON: bright-color glow halos around the brightest pixels
    vec3 neonEffect(vec3 c, vec2 uv) {
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 hot = max(c - 0.5, 0.0) * u_tint;
      return c + hot * 0.6;
    }""",
    },
    {
        "key": "smoke",
        "label": "SMOKE",
        "desc": "Cream warm heavy blur, slow drift",
        "page_idx": 3,
        "temp": 0.20, "mut": 0.15, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.35, "chroma": 0, "grain": 0.15, "sepia": 0.35,
        "glow": 0.40, "grayscale": 0, "blur": 0.75,
        "effect": 1.0, "tint": [0.94, 0.78, 0.59],
        "effect_fn": """
    // SMOKE: gentle horizontal wisps (low-freq sine on x)
    vec3 smokeEffect(vec3 c, vec2 uv) {
      float wisp = sin(uv.y * 6.0 + u_time * 0.3) * 0.06 +
                  sin(uv.x * 4.0 - u_time * 0.2) * 0.04;
      return c * (1.0 + wisp);
    }""",
    },
    {
        "key": "hallucination",
        "label": "HALLUCINATION",
        "desc": "RGB shift, scanline body, maxed everything",
        "page_idx": 4,
        "temp": -0.50, "mut": 0.95, "mutAlgo": 5, "posterize": 0,
        "vignette": 0.10, "chroma": 1.00, "grain": 0.90, "sepia": 0,
        "glow": 0.50, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [1.0, 0.0, 0.78],
        "effect_fn": """
    // HALLUCINATION: scanlines + RGB-drift stripes
    vec3 hallucinationEffect(vec3 c, vec2 uv) {
      float scan = 1.0 - 0.4 * step(0.5, fract(uv.y * 200.0));
      vec3 drift = u_tint * 0.15;
      return c * scan + drift;
    }""",
    },
    {
        "key": "eclipse",
        "label": "ECLIPSE",
        "desc": "Deep black + bright corona glow, heavy vignette",
        "page_idx": 5,
        "temp": -0.15, "mut": 0.10, "mutAlgo": 0, "posterize": 0.15,
        "vignette": 0.90, "chroma": 0.20, "grain": 0.20, "sepia": 0,
        "glow": 0.85, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [1.0, 0.78, 0.39],
        "effect_fn": """
    // ECLIPSE: radial corona ring at d ~ 0.3
    vec3 eclipseEffect(vec3 c, vec2 uv) {
      vec2 v = uv - 0.5;
      float d = length(v);
      float corona = exp(-pow((d - 0.3) * 12.0, 2.0));
      return c + vec3(1.0, 0.78, 0.4) * corona * 0.4;
    }""",
    },
    # ---------------- 6..12 NEW FULL PRESETS ----------------
    {
        "key": "aurora",
        "label": "AURORA",
        "desc": "Pastel-mint/cyan/cyan-violet drift, low chroma, gentle bloom",
        "page_idx": 6,
        "temp": -0.20, "mut": 0.25, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.18, "chroma": 0.20, "grain": 0.05, "sepia": 0,
        "glow": 0.55, "grayscale": 0, "blur": 0.15,
        "effect": 1.0, "tint": [1.0, 0.70, 1.0],
        "effect_fn": """
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
    }""",
    },
    {
        "key": "chrome",
        "label": "CHROME",
        "desc": "Polished liquid metal, hard specular highlights, desaturated mid-tones",
        "page_idx": 7,
        "temp": -0.05, "mut": 0.05, "mutAlgo": 0, "posterize": 0.20,
        "vignette": 0.30, "chroma": 0.30, "grain": 0.05, "sepia": 0,
        "glow": 0.45, "grayscale": 0.25, "blur": 0,
        "effect": 1.0, "tint": [0.85, 0.92, 1.0],
        "effect_fn": """
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
    }""",
    },
    {
        "key": "fractal",
        "label": "FRACTAL",
        "desc": "Mandelbrot-adjacent colour wash, heavy chroma + grain",
        "page_idx": 8,
        "temp": 0.0, "mut": 0.40, "mutAlgo": 4, "posterize": 0.30,
        "vignette": 0.35, "chroma": 0.60, "grain": 0.35, "sepia": 0,
        "glow": 0.30, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [0.78, 0.45, 1.0],
        "effect_fn": """
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
    }""",
    },
    {
        "key": "glitch",
        "label": "GLITCH",
        "desc": "Datamosh: horizontal slice displacement, RGB split, beat-locked",
        "page_idx": 9,
        "temp": 0.0, "mut": 0.90, "mutAlgo": 2, "posterize": 0.35,
        "vignette": 0.10, "chroma": 0.70, "grain": 0.50, "sepia": 0,
        "glow": 0.10, "grayscale": 0, "blur": 0,
        "effect": 1.0, "tint": [0.30, 1.0, 0.80],
        "effect_fn": """
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
    }""",
    },
    {
        "key": "pulse",
        "label": "PULSE",
        "desc": "Bass-locked concentric pulse rings on a deep navy field",
        "page_idx": 10,
        "temp": -0.20, "mut": 0.10, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.45, "chroma": 0.15, "grain": 0.15, "sepia": 0,
        "glow": 0.40, "grayscale": 0, "blur": 0.10,
        "effect": 1.0, "tint": [0.40, 0.85, 1.0],
        "effect_fn": """
    // PULSE: concentric rings emanating from center, bass-locked
    vec3 pulseEffect(vec3 c, vec2 uv, float t) {
      vec2 v = uv - 0.5;
      float d = length(v);
      // Ring phase advances with bass; ring width tightens on beat.
      float phase = t * 0.6 + u_bass * 2.0;
      float rings = sin(d * 30.0 - phase * 6.2832);
      float ring = smoothstep(0.65, 1.0, rings);
      return c + u_tint * ring * 0.25;
    }""",
    },
    {
        "key": "void",
        "label": "VOID",
        "desc": "Pure black canvas with a faint scan of single-pixel highlights",
        "page_idx": 11,
        "temp": -0.45, "mut": 0.05, "mutAlgo": 0, "posterize": 0.60,
        "vignette": 0.95, "chroma": 0.05, "grain": 0.55, "sepia": 0,
        "glow": 0.10, "grayscale": 0.40, "blur": 0,
        "effect": 1.0, "tint": [0.78, 0.92, 1.0],
        "effect_fn": """
    // VOID: nearly-black with sparse single-pixel highlights (stars)
    vec3 voidEffect(vec3 c, vec2 uv, float t) {
      // Sparse dot field; cells light up on beat for a twinkle.
      vec2 cell = floor(uv * vec2(180.0, 100.0));
      float n = hash(cell + floor(t * 2.0));
      float star = step(0.997, n) * (0.5 + u_beat * 0.5);
      return c + vec3(star) * u_tint * 0.7;
    }""",
    },
    {
        "key": "watercolor",
        "label": "WATERCOLOR",
        "desc": "Soft pastel pigment pools, edge bleed, very low contrast",
        "page_idx": 12,
        "temp": 0.15, "mut": 0.05, "mutAlgo": 0, "posterize": 0.10,
        "vignette": 0.20, "chroma": 0.05, "grain": 0.20, "sepia": 0.10,
        "glow": 0.30, "grayscale": 0, "blur": 0.45,
        "effect": 1.0, "tint": [1.0, 0.80, 0.85],
        "effect_fn": """
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
    }""",
    },
    # ---------------- 13..18 STUB PRESETS (page-targets only) ----------------
    {
        "key": "baroque",
        "label": "BAROQUE",
        "desc": "Stub preset — gilded ornament tone (page-target only)",
        "page_idx": 13,
        "temp": 0.20, "mut": 0.0, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.40, "chroma": 0.0, "grain": 0.10, "sepia": 0.30,
        "glow": 0.20, "grayscale": 0, "blur": 0,
        "effect": 0.0, "tint": [1.0, 0.78, 0.39],
        "effect_fn": """
    // BAROQUE: passthrough — page has no canvas pipeline yet
    vec3 baroqueEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
    {
        "key": "gallery",
        "label": "GALLERY",
        "desc": "Stub preset — clean gallery-white tone (page-target only)",
        "page_idx": 14,
        "temp": 0.0, "mut": 0.0, "mutAlgo": 0, "posterize": 0,
        "vignette": 0.10, "chroma": 0.0, "grain": 0.0, "sepia": 0,
        "glow": 0.0, "grayscale": 0, "blur": 0,
        "effect": 0.0, "tint": [1.0, 1.0, 1.0],
        "effect_fn": """
    // GALLERY: passthrough — page has no canvas pipeline yet
    vec3 galleryEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
    {
        "key": "kraft",
        "label": "KRAFT",
        "desc": "Stub preset — brown-paper texture tone (page-target only)",
        "page_idx": 15,
        "temp": 0.10, "mut": 0.0, "mutAlgo": 0, "posterize": 0.10,
        "vignette": 0.30, "chroma": 0.0, "grain": 0.35, "sepia": 0.50,
        "glow": 0.0, "grayscale": 0, "blur": 0,
        "effect": 0.0, "tint": [0.82, 0.65, 0.45],
        "effect_fn": """
    // KRAFT: passthrough — page has no canvas pipeline yet
    vec3 kraftEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
    {
        "key": "mosaic",
        "label": "MOSAIC",
        "desc": "Stub preset — stained-glass tile tone (page-target only)",
        "page_idx": 16,
        "temp": -0.10, "mut": 0.0, "mutAlgo": 0, "posterize": 0.40,
        "vignette": 0.20, "chroma": 0.20, "grain": 0.10, "sepia": 0,
        "glow": 0.20, "grayscale": 0, "blur": 0,
        "effect": 0.0, "tint": [0.40, 0.78, 1.0],
        "effect_fn": """
    // MOSAIC: passthrough — page has no canvas pipeline yet
    vec3 mosaicEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
    {
        "key": "phosphor",
        "label": "PHOSPHOR",
        "desc": "Stub preset — green CRT tone (page-target only)",
        "page_idx": 17,
        "temp": -0.30, "mut": 0.0, "mutAlgo": 0, "posterize": 0.20,
        "vignette": 0.50, "chroma": 0.0, "grain": 0.10, "sepia": 0,
        "glow": 0.50, "grayscale": 0.30, "blur": 0,
        "effect": 0.0, "tint": [0.30, 1.0, 0.40],
        "effect_fn": """
    // PHOSPHOR: passthrough — page has no canvas pipeline yet
    vec3 phosphorEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
    {
        "key": "tape",
        "label": "TAPE",
        "desc": "Stub preset — VHS tape-tone (page-target only)",
        "page_idx": 18,
        "temp": 0.05, "mut": 0.10, "mutAlgo": 0, "posterize": 0.10,
        "vignette": 0.30, "chroma": 0.20, "grain": 0.30, "sepia": 0.10,
        "glow": 0.10, "grayscale": 0, "blur": 0,
        "effect": 0.0, "tint": [0.90, 0.78, 0.70],
        "effect_fn": """
    // TAPE: passthrough — page has no canvas pipeline yet
    vec3 tapeEffect(vec3 c, vec2 uv, float t) {
      return c;
    }""",
    },
]


def main():
    # ---- Build PRESETS dict (JS) ----
    preset_lines = []
    for p in PRESETS:
        t = p["tint"]
        preset_lines.append(f"""    {p['key']}: {{
      label: '{p['label']}',
      desc:  '{p['desc']}',
      temp:      {p['temp']},
      mut:       {p['mut']},
      mutAlgo:   {p['mutAlgo']},
      posterize: {p['posterize']},
      vignette:  {p['vignette']},
      chroma:    {p['chroma']},
      grain:     {p['grain']},
      sepia:     {p['sepia']},
      glow:      {p['glow']},
      grayscale: {p['grayscale']},
      blur:      {p['blur']},
      effect:    {p['effect']},
      tint:      [{t[0]}, {t[1]}, {t[2]}],
    }},""")
    PRESETS_JS = "{\n" + "\n".join(preset_lines) + "\n  }"

    # ---- Build per-effect function bodies ----
    effects_js = "\n\n".join(p["effect_fn"].rstrip() for p in PRESETS)

    # ---- Build applyPageEffect switch ----
    # The argument list depends on the effect function signature. Parse
    # the params from the function declaration in each effect_fn so we
    # match gridEffect(vec3 c, vec2 uv) (2 args) vs auroraEffect(..., float t) (3 args).
    import re
    switch_lines = ["      if      (u_page == 0)  e = filmEffect(c, uv, t);"]
    for p in PRESETS[1:]:
        sig_match = re.search(
            rf"vec3 {p['key']}Effect\(([^)]*)\)",
            p["effect_fn"],
        )
        if not sig_match:
            raise SystemExit(f"could not find signature for {p['key']}")
        params = sig_match.group(1)
        # Strip types + names — keep position-only ordering: c, uv[, t]
        # Caller always passes (c, uv, t); we only need to drop trailing params.
        arg_names = [a.strip().split()[-1] for a in params.split(",")]
        # Build a list of arg names matching the order the caller has them: c, uv, t
        caller_args = ["c", "uv", "t"]
        call_args = [a for a in caller_args if a in arg_names]
        call = ", ".join(call_args)
        switch_lines.append(
            f"      else if (u_page == {p['page_idx']}) e = {p['key']}Effect({call});"
        )
    SWITCH_JS = "\n".join(switch_lines)

    # u_page comment
    page_keys = [p["key"] for p in PRESETS]
    page_comment = (
        "    // u_page index mapping (must match Object.keys(PRESETS) order):\n"
        + "".join(f"    //   {p['page_idx']} = {p['key']}\n" for p in PRESETS)
    )

    # ---- The full file ----
    file_src = f"""// versions-presets.js — per-page GLSL presets for sainted-word-records/versions/*.html
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
// {len(PRESETS)} presets in total (indices 0..{len(PRESETS)-1}).
{page_comment}
(function () {{
  if (window.VersionsPresets) return;  // idempotent

  // ---- Per-page presets ----
  // FX uniforms use the same shape as fx-postprocess.js state.
  // `effect` is a 0..1 amount for the page-specific GLSL effect.
  // `tint` adds an additional color tint not covered by temp.
  const PRESETS = {PRESETS_JS};

  // ---- Fragment shader: same base as fx-postprocess + per-page effect ----
  // We bake the per-page effects inline (single shader, u_effect switches).
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {{
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }}
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
    uniform int   u_page;          // {', '.join(page_keys)}
    uniform vec3  u_tint;

    // -- shared helpers (inlined, mirrors fx-postprocess.js) --
    float hash(vec2 p) {{
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }}
    vec3 temperature(vec3 c, float t) {{
      if (abs(t) < 0.01) return c;
      vec3 warm = vec3(1.0, 0.85, 0.65);
      vec3 cool = vec3(0.78, 0.92, 1.1);
      vec3 tint = (t > 0.0) ? warm : cool;
      float amt = abs(t) * 0.35;
      return mix(c, c * tint, amt);
    }}
    vec3 sepiaTint(vec3 c, float amt) {{
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 s = vec3(l * 1.07, l * 0.94, l * 0.74);
      return mix(c, s, amt);
    }}
    vec3 toGray(vec3 c, float amt) {{
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(c, vec3(l), amt);
    }}
    // Simple 3x3 box blur
    vec3 blur3x3(sampler2D t, vec2 uv, vec2 px) {{
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
    }}

    // -- per-page effect functions --
    // Each returns a vec3 with the effect applied. Caller mixes with
    // original by u_effect amount.
{effects_js}

    vec3 applyPageEffect(vec3 c, vec2 uv, float t) {{
      if (u_effect < 0.01) return c;
      vec3 e;
{SWITCH_JS}
      return mix(c, e, u_effect);
    }}

    void main() {{
      vec2 uv = v_uv;

      // Blur pre-pass
      vec3 col;
      vec2 px = vec2(1.0 / 1280.0, 1.0 / 720.0);
      if (u_blur > 0.001) {{
        col = blur3x3(u_tex, uv, px);
      }} else {{
        col = texture2D(u_tex, uv).rgb;
      }}

      // Chromatic aberration (split sample)
      float split = 0.003 * u_mut + 0.018 * u_chroma;
      if (u_chroma > 0.001) {{
        col.r = mix(col.r, texture2D(u_tex, uv + vec2( split, 0.0)).r, u_chroma);
        col.b = mix(col.b, texture2D(u_tex, uv + vec2(-split, 0.0)).b, u_chroma);
      }}

      // Temperature
      col = temperature(col, u_temp);

      // Grayscale
      if (u_grayscale > 0.001) col = toGray(col, u_grayscale);

      // Sepia
      if (u_sepia > 0.001) col = sepiaTint(col, u_sepia);

      // Posterize
      if (u_posterize > 0.001) {{
        float levels = mix(256.0, 3.0, u_posterize);
        col = floor(col * levels) / levels;
      }}

      // Beat pulse
      col *= 1.0 + u_beat * 0.12;

      // Glow (bloom-ish: 4-neighbor avg)
      if (u_glow > 0.001) {{
        vec3 bloom = vec3(0.0);
        bloom += texture2D(u_tex, uv + vec2( px.x * 6.0, 0.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(-px.x * 6.0, 0.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(0.0,  px.y * 6.0)).rgb;
        bloom += texture2D(u_tex, uv + vec2(0.0, -px.y * 6.0)).rgb;
        bloom *= 0.25;
        col += bloom * u_glow * 0.35;
      }}

      // Vignette
      vec2 v = v_uv - 0.5;
      float vig = 1.0 - dot(v, v) * (0.4 + u_vignette * 1.6);
      col *= max(vig, 0.0);

      // Per-page effect (after vignette, so it dominates)
      col = applyPageEffect(col, uv, u_time);

      // Grain last (on top of everything)
      if (u_grain > 0.001) {{
        float g = (hash(v_uv * 1024.0 + u_time) - 0.5) * u_grain * 0.18;
        col += g;
      }}

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }}
  `;
"""  # the rest (init / render loop) preserved by hand-edit below

    # The init/render portion is preserved verbatim — we only swap the
    # preset dict + shader body. Hand-build the closing portion.
    tail = """
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
"""

    full = file_src + tail
    OUT.write_text(full, encoding="utf-8")
    print(f"wrote {OUT} ({len(full):,} bytes, {len(PRESETS)} presets)")


if __name__ == "__main__":
    main()
