// ============================================================================
// CONSOLE — FRAGMENT SHADER
// A precision oscilloscope aesthetic. Black canvas, single accent, geometric
// primitives, persistent data overlay.
//
// Drop into the engine as the "console" variant. Bind u_audio via WebAudio
// AnalyserNode frequency data (256 bins, mapped to bands).
// ============================================================================

precision highp float;

uniform vec2  u_resolution;
uniform float u_time;          // seconds since play
uniform float u_dt;            // delta time

// Audio — bind these from AnalyserNode
uniform float u_bpm;           // detected BPM
uniform float u_beatPulse;     // 0..1, decays after each beat
uniform float u_bands[32];     // normalized 0..1 spectrum

// Visual language — pull from CSS variables at boot
uniform vec3  u_signal;        // default #FF6B1A
uniform vec3  u_bg;            // default #0A0A0B
uniform float u_signalAlpha;   // line opacity, default 1.0

// Base source — live camera / photo deck, cover-fit under the overlays.
// u_baseAspect = source width/height; 0 means "no base" (pure black canvas).
uniform sampler2D u_base;
uniform float u_baseAspect;
uniform float u_gridDim;       // grid strength multiplier (1.0, or dimmed under a base)

// Footage taps — the base is the footage (camera / photo deck); the Console's
// own graphics stay outside them, per the rules' "grade graphics separately
// from footage". u_sharp's cap (0.15) is the rules' clarity ceiling (+15).
uniform float u_sharp;         // clarity — unsharp amount on the base, 0..0.15
uniform float u_denoise;       // 4-neighbour box mix on the base, 0..1
uniform float u_vignette;      // corner falloff over the composed frame, 0..1

out vec4 fragColor;

// -- helpers ----------------------------------------------------------------

float band(int i) {
  return u_bands[i];
}

float sumRange(int lo, int hi) {
  float s = 0.0;
  for (int i = lo; i <= hi; i++) s += u_bands[i];
  return s / float(hi - lo + 1);
}

float bass()    { return sumRange(0,  5);  }   // ~ 20–150 Hz
float lowMid()  { return sumRange(6,  12); }   // ~ 150–500 Hz
float highMid() { return sumRange(13, 22); }   // ~ 500–2 kHz
float treble()  { return sumRange(23, 31); }   // ~ 2–8 kHz

// grid line at every 32px
float gridLine(vec2 uv, float spacing) {
  vec2 g = abs(fract(uv * spacing - 0.5) - 0.5) / fwidth(uv * spacing);
  float line = min(g.x, g.y);
  return 1.0 - min(line, 1.0);
}

// -- main -------------------------------------------------------------------

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // 1. background — pure black, or the live base source (camera / photo deck)
  // cover-fit: fill the canvas and crop the overflow, never letterbox
  vec3 col = u_bg;
  if (u_baseAspect > 0.0) {
    vec2 baseUV = uv;
    float canvasAspect = u_resolution.x / u_resolution.y;
    if (u_baseAspect > canvasAspect) baseUV.x = 0.5 + (uv.x - 0.5) * (canvasAspect / u_baseAspect);
    else                             baseUV.y = 0.5 + (uv.y - 0.5) * (u_baseAspect / canvasAspect);
    vec3 base = texture(u_base, baseUV).rgb;
    if (u_denoise > 0.0 || u_sharp > 0.0) {
      vec2 texel = 1.0 / vec2(textureSize(u_base, 0));
      vec3 blur = (texture(u_base, baseUV + vec2(texel.x, 0.0)).rgb
                 + texture(u_base, baseUV - vec2(texel.x, 0.0)).rgb
                 + texture(u_base, baseUV + vec2(0.0, texel.y)).rgb
                 + texture(u_base, baseUV - vec2(0.0, texel.y)).rgb) * 0.25;
      base = mix(base, blur, u_denoise);                       // Denoise
      base = clamp(base + (base - blur) * u_sharp, 0.0, 1.0);  // Clarity (halo-guarded by the 0.15 cap)
    }
    col = base;
  }

  // 2. faint grid — only on canvas, never on UI (dimmer under a base source)
  float g = gridLine(uv, 32.0);
  col = mix(col, u_signal, g * 0.04 * u_gridDim);

  // 3. BEAT PULSE — the flash itself is painted on the overlay canvas by the
  // engine (single hard frame-wide flash per kick); u_beatPulse only widens
  // the hero waveform below, so no rings here.

  // 4. HERO WAVEFORM — sine sum across the center, modulated by bands
  float waveAmp = 0.18 + u_beatPulse * 0.08;
  float y =
      sin(uv.x * 6.0  * 3.14159 + u_time * 4.0)  * waveAmp * (bass() + 0.2)
    + sin(uv.x * 14.0 * 3.14159 + u_time * 7.0)  * waveAmp * 0.4 * highMid()
    + sin(uv.x * 32.0 * 3.14159 + u_time * 11.0) * waveAmp * 0.2 * treble();
  float wave = smoothstep(0.004, 0.0, abs(uv.y - 0.5 - y));
  col = mix(col, u_signal, wave * u_signalAlpha);

  // 5. SPECTRUM BARS — bottom 15% of canvas
  float specTop = 0.85;
  if (uv.y > specTop) {
    float n = 32.0;
    float idx = floor(uv.x * n);
    float bandVal = u_bands[int(clamp(idx, 0.0, n - 1.0))];
    float localX = fract(uv.x * n);
    float barX = step(0.08, localX) * step(localX, 0.92);
    float barH = bandVal * 0.15;
    float inBar = step(0.0, specTop + barH - uv.y) * barX;
    col = mix(col, u_signal, inBar * (0.5 + bandVal * 0.5));
  }

  // 6. TICK MARKS — top edge, every quarter
  float tickY = step(0.985, uv.y) * step(0.005, mod(uv.x, 0.25));
  col = mix(col, u_signal, tickY * 0.6);

  // 7. CORNER CROSSHAIRS — registration marks, like printer's marks
  vec2 corner = abs(uv - vec2(0.04, 0.96));
  float cross = (1.0 - smoothstep(0.0, 0.003, min(
      abs(corner.x - corner.y),
      min(abs(corner.x), abs(corner.y))
  ))) * step(corner.x, 0.025) * step(corner.y, 0.025);
  col = mix(col, u_signal, cross * 0.5);

  // 8. VIGNETTE — corner falloff over the composed frame (base + graphics)
  if (u_vignette > 0.0) {
    float vig = smoothstep(0.9, 0.3, distance(uv, vec2(0.5)) * 1.4142);
    col *= mix(1.0, vig, u_vignette);
  }

  fragColor = vec4(col, 1.0);
}

// ============================================================================
// HOW TO WIRE IN
// ============================================================================
//
// 1. Boot: pull signal + bg from CSS variables
//      const cs = getComputedStyle(document.documentElement);
//      u_signal = hexToVec3(cs.getPropertyValue('--signal'));
//      u_bg     = hexToVec3(cs.getPropertyValue('--bg'));
//      u_gridDim = 1.0;      // uniforms default to 0 — the grid would vanish
//      u_baseAspect = 0.0;   // 0 = no live base, pure-black background
//
// 1b. Optional live base (camera / photo deck). Upload the element into u_base
//      with UNPACK_FLIP_Y_WEBGL, and set u_baseAspect = width/height so this
//      shader can cover-fit it; it is sampled only while > 0. Set u_gridDim to
//      0.35 while a base is composited so the overlays stay readable.
//
// 2. WebAudio: create AnalyserNode(fftSize=64) → getFrequencyData()
//      Map 32 bins → u_bands normalized 0..1.
//
// 3. BPM detection: existing engine code (autocorrelation on onset envelope).
//      On beat: u_beatPulse = 1.0. Each frame: u_beatPulse *= 0.92.
//
// 4. Composition rule: 1 hero + 1 waveform + 1 number overlay. Resist
//    stacking more layers — the language IS the restraint.
//
// ============================================================================
