// scripts/eq-test-plan.mjs
//
// The segment plan for the SWR equaliser test track.
//
// The track isolates one of the engine's frequency bands at a time, so a
// layer that only reacts to `bass` can be shown to move during the bass
// segment and stay still through every other one.
//
// The band edges are the engine's own (versions/*.html, `sample()`):
//
//   sub    bins 1..2      21.5 – 43.1 Hz
//   bass   bins 2..11     43.1 – 236.8 Hz
//   mid    bins 11..93   236.8 – 2002 Hz
//   treble bins 93..279  2002 – 6007 Hz
//   air    bins 279..1023 6007 – 22022 Hz
//
// (bin width = sampleRate / fftSize = 44100 / 2048 = 21.53 Hz)
//
// Each segment is filled with band-limited noise — one sinusoid per FFT
// bin of the band, at the bin's centre frequency — rather than a single
// pure tone.
//
// The reason is the engine's own arithmetic: a band feature is the MEAN
// of that band's bins, so a single narrow tone only lights up ~5 of them.
// A 100 Hz tone in the 10-bin bass band reads ~0.5, but the same tone
// amplitude in the 83-bin mid band reads ~0.06 — the feature is diluted
// by the band's width, not by the signal. Filling the whole band with
// noise gives every band a realistic level, and stays just as isolated:
// each segment's energy is inside one band and nowhere else.
//
// Three louder marker tones are mixed in per band so the segment is
// identifiable by ear.
//
// Every segment is separated by 500 ms of silence and fades in and out
// over 100 ms, which keeps the segment edges from producing clicks — a
// click is broadband and would light up every band at once.
//
// `sub` is included for completeness, but note that no reactor preset
// binds to it: the shipped presets react to bass, beat, mid, rms, treble,
// air, onset and centroid.

export const SAMPLE_RATE = 44100;
export const AMPLITUDE = 0.2;
export const FADE_MS = 100;
export const GAP_MS = 500;
export const FFT_SIZE = 2048;
export const BIN_HZ = SAMPLE_RATE / FFT_SIZE;   // 21.53 Hz

// The noise floor of each band, as a fraction of the band width.
export const NOISE_FILL = 1.0;
// Marker tones are mixed louder than the noise bed so each segment has a
// recognisable pitch.
export const MARKER_COUNT = 3;
export const MARKER_SHARE = 0.35;

// The band each segment fills, in FFT bins (inclusive), taken from the
// engine's own edge table.
export const BAND_BINS = {
  sub: [1, 2],
  bass: [2, 11],
  mid: [11, 93],
  treble: [93, 279],
  air: [279, 700],
};

export const SEGMENTS = [
  { id: 'bass', label: 'bass 43–237 Hz', band: 'bass', t0: 0.0, t1: 8.0 },
  { id: 'mid', label: 'mid 237–2000 Hz', band: 'mid', t0: 8.5, t1: 16.0 },
  { id: 'treble', label: 'treble 2–6 kHz', band: 'treble', t0: 16.5, t1: 24.0 },
  { id: 'air', label: 'air 6–15 kHz', band: 'air', t0: 24.5, t1: 32.0 },
  { id: 'silence', label: 'silence (control)', band: null, t0: 32.5, t1: 40.0 },
  { id: 'sub', label: 'sub 21–43 Hz', band: 'sub', t0: 40.5, t1: 48.0 },
  { id: 'all', label: 'all four bands', band: 'all', t0: 48.5, t1: 60.0 },
];

export const TRACK_SECONDS = 60;
export const TRACK_NAME = 'swr-eq-test';

// The engine's own band edges, for reporting.
export const BANDS = {
  sub: [21.5, 43.1],
  bass: [43.1, 236.8],
  mid: [236.8, 2002],
  treble: [2002, 6007],
  air: [6007, 22022],
};

// The spectral features the engine derives, and which of them a segment
// is expected to excite.
export const SPECTRAL = ['sub', 'bass', 'mid', 'treble', 'air'];

// The bins a segment fills.
export function binsFor(band) {
  if (band === 'all') {
    return ['bass', 'mid', 'treble', 'air'].flatMap((b) => {
      const [a, z] = BAND_BINS[b];
      const out = [];
      for (let k = a; k <= z; k++) out.push(k);
      return out;
    });
  }
  if (!band) return [];
  const [a, z] = BAND_BINS[band];
  const out = [];
  for (let k = a; k <= z; k++) out.push(k);
  return out;
}

// The frequencies a segment fills: one per bin, at the bin centre.
export function tonesFor(band) {
  return binsFor(band).map((k) => (k + 0.5) * BIN_HZ);
}

export function segmentAt(t) {
  for (const s of SEGMENTS) {
    if (t >= s.t0 && t < s.t1) return s;
  }
  return null;
}
