// lib/variant-picker.mjs — pure function: audio analysis -> best engine variant.
//
// Picks one of the `versions/*.html` pages based on the audio features
// returned by audio-analysis-v2.js (see scripts/analyze-mp3.mjs for the
// shape). The scoring table is hand-tuned to match each variant's stated
// visual identity in its <meta name="description"> tag (parsed from
// the HTML once at startup, then hardcoded here as the source of truth).
//
// API:
//   pick(analysis) -> { variant, score, rationale, allScores }
//   bucketize(analysis) -> { bpmBucket, energyBucket, scale, ... }
//
// The picker is pure — no DOM, no Node globals. Trivially testable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = path.resolve(__dirname, '..', 'versions');

// Per-variant feature weights. A variant's score is the sum of weights
// where the bucketed feature matches. `default` is a floor so any track
// always scores positively on every variant; the variant with the highest
// relative fit wins.
//
// Weight key shape: matches `bucketize()` output.
//
//   bpmBucket_lo|mid|hi   -- tracks the single bpmBucket value
//   energyBucket_lo|mid|hi-- tracks the single energyBucket value
//   scale_major|minor     -- tracks the single scale value
//   synthChroma           -- numeric; fires if value > 1.0  (synth-heavy chroma)
//   chromaVariance        -- numeric; fires if value > 0.04 (non-flat chroma)
//   beatStrength          -- numeric; fires if value > 0.05 (clear beat)
//
// Tuned against the variants' meta descriptions (verified by reading
// versions/*.html at build time):
//   music_video — drop a track, engine synthesizes a preset  (default)
//   spectrum    — pure audio-reactive visualizer              (default-ish)
//   film        — 16mm grain + sepia + warm temperature        (slow + minor)
//   neon        — magenta/cyan glow + chromatic aberration     (fast + synth)
//   grid        — monochrome hard cells, snap to beat           (beat-locked)
//   smoke       — cream warm heavy blur, slow drift            (ambient/slow)
//   aurora      — pastel mint/cyan, gentle bloom               (dreamy/major)
//   void        — pure black with single-pixel scanlines       (minimal/dark)
//   glitch      — datamosh slice displacement, beat-locked     (chaotic)
//   chrome      — liquid metal, hard specular                  (metallic/contrast)
//   fractal     — Mandelbrot-adjacent, heavy chroma + grain    (complex, low beat)
//   collage     — magazine-grid split-screen                   (rhythmic)
//   pulse       — bass-locked concentric rings                 (bass-heavy)
//   watercolor  — soft pastel pigment pools                    (gentle)
//   eclipse     — deep black + corona glow                     (dramatic)
const PROFILES = {
  music_video: { default: 1.0, bpmBucket_unknown: 0.8 /* when BPM detection fails, prefer the "synthesize a preset" engine */ },
  spectrum:    { default: 0.9, bpmBucket_unknown: 0.6 /* spectrum is also a good bpm-free fallback (pure audio-reactive visualizer) */ },
  film:        { bpmBucket_lo: 1.4, scale_minor: 1.2, energyBucket_lo: 0.6 /* was 1.1 — too greedy vs aurora */ },
  neon:        { bpmBucket_hi: 1.5, synthChroma: 1.3 },
  grid:        { bpmBucket_mid: 1.2, beatStrength: 1.4 },
  smoke:       { bpmBucket_lo: 1.3, energyBucket_lo: 1.2 },
  aurora:      { scale_major: 1.5 /* bumped */, energyBucket_lo: 1.1 },
  void:        { energyBucket_lo: 1.4, scale_minor: 1.1 },
  glitch:      { beatStrength: 1.2, energyBucket_hi: 1.1, chromaVariance: 0.5 },
  chrome:      { bpmBucket_mid: 1.2, scale_minor: 0.6 /* was 1.0 */, chromaVariance: 0.4 },
  fractal:     { chromaVariance: 1.3, beatStrength: -0.8 /* penalty: beat-driven is the opposite of fractal */ },
  collage:     { bpmBucket_mid: 1.1, beatStrength: 0.8 },
  pulse:       { energyBucket_hi: 1.8 /* bumped */, bpmBucket_lo: 1.0, beatStrength: 0.5 },
  watercolor:  { energyBucket_lo: 1.3, scale_major: 1.0 },
  eclipse:     { scale_minor: 1.2, energyBucket_mid: 1.0 },
};

// Thresholds for the numeric features. Below these, the weight does NOT
// fire — so a near-silent track doesn't accidentally trip fractal because
// its chromagram is technically non-zero.
const THRESHOLDS = {
  synthChroma: 1.0,
  chromaVariance: 0.04,
  beatStrength: 0.05,
};

// Default fallback when nothing else wins outright.
const FALLBACK = 'music_video';

const KEY_TO_IDX = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };

/**
 * Bucketize the raw analysis into the features the picker weights.
 * Mirrors the bucketing in scripts/analyze-mp3.mjs so either entry
 * point produces the same shape.
 *
 * Critical: when the analysis has no signal (no bpm, no onsets, no
 * duration), every bucket must read as 'unknown' / null so the picker
 * doesn't accidentally fire feature keys for nonexistent features.
 */
export function bucketize(analysis) {
  const a = analysis || {};
  const bpm = a.bpm || 0;
  const dur = a.duration || 0;
  const onsetCount = a.onsetCount || ((a.onsets && a.onsets.length) || 0);
  const onsetRate = dur > 0 ? onsetCount / dur : 0;
  const chroma = a.chromagram || [];
  let mean = 0;
  for (const v of chroma) mean += v;
  mean /= Math.max(1, chroma.length);
  let variance = 0;
  for (const v of chroma) variance += (v - mean) ** 2;
  variance /= Math.max(1, chroma.length);
  const synthChroma =
    (chroma[KEY_TO_IDX.A] || 0) +
    (chroma[KEY_TO_IDX.E] || 0) +
    (chroma[KEY_TO_IDX.D] || 0);
  // When the analysis has no signal at all, leave energyBucket null so
  // no `energyBucket_lo` weight can fire. Likewise for scale — keep
  // 'major' as the schema default but expose a null marker via the
  // confidence field (low confidence = "don't trust this").
  const hasSignal = bpm > 0 && dur > 0 && onsetCount > 0;
  return {
    bpmBucket: bpm === 0 ? 'unknown' : (bpm < 90 ? 'lo' : bpm <= 140 ? 'mid' : 'hi'),
    scale: a.scale || (hasSignal ? 'major' : null),
    energyBucket: hasSignal ? (onsetRate < 0.5 ? 'lo' : onsetRate <= 2 ? 'mid' : 'hi') : null,
    onsetRate,
    chromaVariance: hasSignal ? variance : 0,
    synthChroma: hasSignal ? synthChroma : 0,
    beatStrength: hasSignal ? (a.confidence || 0) * Math.min(onsetRate / 2, 1) : 0,
  };
}

/**
 * Pick the best variant. Returns { variant, score, rationale, allScores }.
 * Ties broken by PROFILES insertion order, with FALLBACK last.
 */
export function pick(analysis) {
  const f = bucketize(analysis);
  const allScores = {};
  let bestScore = -Infinity;
  let bestVariant = FALLBACK;
  let bestHits = [];

  for (const [variant, weights] of Object.entries(PROFILES)) {
    let score = 0;
    const hits = [];
    for (const [k, w] of Object.entries(weights)) {
      if (k === 'default') { score += w; continue; }

      // Bucket-match keys: split "<feature>_<value>" and compare against
      // the single field on `f`. e.g. "bpmBucket_lo" matches when
      // f.bpmBucket === 'lo'.
      const split = k.lastIndexOf('_');
      if (split > 0) {
        const feature = k.slice(0, split);
        const value   = k.slice(split + 1);
        const fv = f[feature];
        if (fv === value) { score += w; hits.push(`${k}`); }
        continue;
      }

      // Numeric features — gate by threshold so a near-zero value doesn't fire.
      const fv = f[k];
      const threshold = THRESHOLDS[k];
      if (typeof fv === 'number' && threshold != null) {
        if (w >= 0) {
          if (fv > threshold) { score += w; hits.push(`${k}=${fv.toFixed(2)}`); }
        } else {
          // Negative weights (penalties): apply when the feature IS present.
          if (fv > threshold) { score += w; hits.push(`${k}\u2192${w}`); }
        }
      }
    }
    allScores[variant] = { score: +score.toFixed(2), hits };
    if (score > bestScore) {
      bestScore = score;
      bestVariant = variant;
      bestHits = hits;
    }
  }

  const rationale = bestHits.length
    ? `${bestVariant} wins (score ${bestScore.toFixed(2)}) via: ${bestHits.join(', ')}`
    : `${bestVariant} wins (score ${bestScore.toFixed(2)}) via default floor only`;

  return { variant: bestVariant, score: +bestScore.toFixed(2), rationale, allScores, features: f };
}

/**
 * Sanity-check: load every variant's <meta name="description"> and confirm
 * the picker still references them. Called by the test script — returns
 * an array of { variant, title, description }.
 */
export function listKnownVariants() {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(VERSIONS_DIR)) {
    if (!f.endsWith('.html')) continue;
    if (f.startsWith('_')) continue;
    const html = fs.readFileSync(path.join(VERSIONS_DIR, f), 'utf8');
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
    const name = f.replace(/\.html$/, '');
    if (PROFILES[name]) out.push({ name, title: title.trim(), description: desc.trim() });
  }
  return out;
}