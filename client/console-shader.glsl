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
  vec2 p  = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  // p in approx [-0.5, 0.5] aspect-corrected

  // 1. background — pure black
  vec3 col = u_bg;

  // 2. faint grid — only on canvas, never on UI
  float g = gridLine(uv, 32.0);
  col = mix(col, u_signal, g * 0.04);

  // 3. BEAT PULSE — three concentric rings, hard 50ms in / 150ms out
  if (u_beatPulse > 0.05) {
    for (int i = 0; i < 3; i++) {
      float r = (1.0 - u_beatPulse) * 0.9 + float(i) * 0.06;
      float ring = smoothstep(0.005, 0.0, abs(length(p) - r));
      col = mix(col, u_signal, ring * u_beatPulse * (1.0 - float(i) * 0.3) * 0.55);
    }
  }

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
