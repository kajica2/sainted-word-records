// client/chapter-states.client.js
//
// Static visual-identity lookup for the 6 canonical song sections. Each
// entry pins a small set of GLSL preset anchors (real names from
// window.SWR_ANCHOR_MAP) plus per-channel fx values that describe how
// the scheduler should blend the visuals as the song moves through its
// emotional arc: intro (calm) → verse (mid energy) → prechorus
// (building) → chorus (peak) → breakdown (collapsed) → outro (resolving).
//
// Why static data only: the scheduler (client/section-scheduler.client.js)
// reads these on each section change and interpolates toward them. Keeping
// the values declarative lets the audio-reactive engine reason about
// pacing without runtime branches.
//
// Shape:
//   { anchors: string[3..4], chroma: 0..1, grain: 0..1, glow: 0..1,
//     motion: 0..1, rotation: -3..3, bloom: 0..1 }
//
// Public API on window.SWR_CHAPTERS:
//   .list()                       → string[] of section names
//   .get(section)                 → entry | null
//   .STATES                       → raw { section → entry } map

(function () {
  'use strict';
  if (window.SWR_CHAPTERS) return;

  // Calm, ambient: smoke + watercolor + aurora. Low chroma, low motion,
  // a touch of glow so the first bars breathe without flatness.
  var intro = {
    anchors: ['smoke', 'watercolor', 'aurora'],
    chroma: 0.10,
    grain: 0.15,
    glow: 0.45,
    motion: 0.12,
    rotation: 0,
    bloom: 0.20,
  };

  // Mid energy, narrative settles in: tape + film + kraft. Slightly warmer,
  // more grain than intro, motion stays modest so the lyrics carry weight.
  var verse = {
    anchors: ['tape', 'film', 'kraft'],
    chroma: 0.30,
    grain: 0.40,
    glow: 0.30,
    motion: 0.32,
    rotation: 0,
    bloom: 0.30,
  };

  // Building tension toward chorus: aurora + mosaic + phosphor. Glow
  // climbs, chroma wakes up, motion accelerates but bloom is still in check.
  var prechorus = {
    anchors: ['aurora', 'mosaic', 'phosphor'],
    chroma: 0.55,
    grain: 0.30,
    glow: 0.65,
    motion: 0.55,
    rotation: 1,
    bloom: 0.45,
  };

  // Peak: hallucination + neon + glitch. Maximum chroma, motion, bloom;
  // rotation kicks the camera, grain is heavy but glow stays high so the
  // image doesn't turn to mud.
  var chorus = {
    anchors: ['hallucination', 'neon', 'glitch'],
    chroma: 0.95,
    grain: 0.60,
    glow: 0.75,
    motion: 0.90,
    rotation: 2,
    bloom: 0.85,
  };

  // Collapsed: void + eclipse + gallery. Strip color, suppress motion,
  // pivot the rotation slightly negative so the visual feels like it's
  // exhaling.
  var breakdown = {
    anchors: ['void', 'eclipse', 'gallery'],
    chroma: 0.05,
    grain: 0.55,
    glow: 0.20,
    motion: 0.08,
    rotation: -1,
    bloom: 0.10,
  };

  // Resolving: baroque + chrome + grid. Warm sepia returns, motion eases
  // back to a steady glide, bloom dims to match the fade-out.
  var outro = {
    anchors: ['baroque', 'chrome', 'grid'],
    chroma: 0.20,
    grain: 0.25,
    glow: 0.35,
    motion: 0.22,
    rotation: -2,
    bloom: 0.25,
  };

  var STATES = {
    intro: intro,
    verse: verse,
    prechorus: prechorus,
    chorus: chorus,
    breakdown: breakdown,
    outro: outro,
  };

  window.SWR_CHAPTERS = {
    STATES: STATES,
    list: function () { return Object.keys(STATES); },
    get: function (section) { return STATES[section] || null; },
  };
})();
