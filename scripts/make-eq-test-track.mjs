#!/usr/bin/env node
// scripts/make-eq-test-track.mjs
//
// Generates the SWR equaliser test track: a minute of audio that fills
// one of the engine's frequency bands at a time, so you can see that a
// layer reacts to its own band and nothing else.
//
//   node scripts/make-eq-test-track.mjs
//
// Writes audios/swr-eq-test.wav and, if ffmpeg is on PATH, the
// shippable audios/swr-eq-test.mp3. The plan lives in eq-test-plan.mjs so
// the verification harness (check-eq-isolation.mjs) and the track can
// never drift apart.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_RATE, AMPLITUDE, FADE_MS, SEGMENTS, TRACK_SECONDS, TRACK_NAME,
  MARKER_COUNT, MARKER_SHARE, binsFor, tonesFor,
} from './eq-test-plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = join(ROOT, 'audios');
// The WAV is an intermediate for the encoder, not a shipped artefact:
// the isolation result is identical either side of the codec (measured),
// so there is no reason to put 5 MB of PCM in the repository. Pass
// --wav to keep it alongside the MP3.
const KEEP_WAV = process.argv.includes('--wav');
const WAV = join(OUT_DIR, TRACK_NAME + '.wav');
const WAV_TMP = join(tmpdir(), TRACK_NAME + '-' + process.pid + '.wav');
const MP3 = join(OUT_DIR, TRACK_NAME + '.mp3');

// Deterministic PRNG, so the track is byte-reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Raised-cosine fade, so the edges carry no broadband click.
function fadeGain(t, t0, t1) {
  const fade = FADE_MS / 1000;
  if (t < t0 + fade) return 0.5 - 0.5 * Math.cos((Math.PI * (t - t0)) / fade);
  if (t > t1 - fade) return 0.5 - 0.5 * Math.cos((Math.PI * (t1 - t)) / fade);
  return 1;
}

// One sinusoid per FFT bin of the band, at the bin's centre frequency,
// with a random phase. N sinusoids of amplitude a have an RMS of
// a*sqrt(N/2), so a = AMP*sqrt(2/N) gives the band a constant total
// energy regardless of how wide it is — which is what a real track has,
// and what the engine's band means then read correctly.
function buildSamples() {
  const n = Math.round(SAMPLE_RATE * TRACK_SECONDS);
  const out = new Float64Array(n);
  const rnd = mulberry32(0x5EED);

  for (const seg of SEGMENTS) {
    const bins = binsFor(seg.band);
    if (!bins.length) continue;
    const tones = tonesFor(seg.band);
    const noiseAmp = AMPLITUDE * Math.sqrt(1 - MARKER_SHARE);
    const markerAmp = AMPLITUDE * Math.sqrt(MARKER_SHARE / MARKER_COUNT);
    const perTone = noiseAmp * Math.sqrt(2 / tones.length);

    // Marker tones: spread across the band, at a higher level so the
    // segment is recognisable by ear.
    const markers = [];
    if (bins.length > 1) {
      for (let i = 0; i < MARKER_COUNT; i++) {
        const k = bins[Math.round((i + 0.5) * (bins.length - 1) / MARKER_COUNT)];
        markers.push({ f: (k + 0.5) * (SAMPLE_RATE / 2048), phase: rnd() * Math.PI * 2, amp: markerAmp });
      }
    }

    const phases = tones.map(() => rnd() * Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      if (t < seg.t0 || t >= seg.t1) continue;
      const g = fadeGain(t, seg.t0, seg.t1);
      let v = 0;
      for (let j = 0; j < tones.length; j++) {
        v += perTone * Math.sin(2 * Math.PI * tones[j] * t + phases[j]);
      }
      for (const m of markers) {
        v += m.amp * Math.sin(2 * Math.PI * m.f * t + m.phase);
      }
      out[i] += v * g;
    }
  }
  return out;
}

function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);            // fmt chunk size
  buf.writeUInt16LE(1, 20);             // PCM
  buf.writeUInt16LE(1, 22);             // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);             // block align
  buf.writeUInt16LE(16, 34);            // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
const samples = buildSamples();
writeFileSync(WAV_TMP, toWav(samples));

try {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', WAV_TMP,
    '-codec:a', 'libmp3lame', '-b:a', '192k', '-ac', '1', '-ar', String(SAMPLE_RATE),
    MP3,
  ], { stdio: 'inherit' });
  console.log('wrote ' + MP3);
} catch (err) {
  console.warn('ffmpeg unavailable or failed — keeping the WAV instead.');
  writeFileSync(WAV, readFileSync(WAV_TMP));
  console.log('wrote ' + WAV);
} finally {
  try { rmSync(WAV_TMP, { force: true }); } catch { /* ignore */ }
}
if (KEEP_WAV && !existsSync(WAV)) {
  // regenerate the WAV only when it was asked for
  writeFileSync(WAV, toWav(samples));
  console.log('wrote ' + WAV);
}

console.log('\nsegments:');
for (const s of SEGMENTS) {
  const bins = binsFor(s.band);
  console.log('  ' + String(s.t0).padStart(5) + '–' + String(s.t1).padStart(5) + 's  ' +
    s.label.padEnd(20) + (bins.length ? bins.length + ' bins filled' : '—'));
}
