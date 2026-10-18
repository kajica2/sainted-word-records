// tools/generate-sigil-kai.mjs — generate Kai's character sigil.
//
// The sigil is a procedural SVG, not a hand-drawn asset, so it can be
// re-emitted, animated, and re-themed. It is composed of the same
// ornamental primitives the engine uses elsewhere (rosettes, arcs,
// nodes) but assembled into a single, named character.
//
// What the sigil says (read it from the inside out):
//
//   1.  CENTRAL NODE (the inventor). A 9-pointed star. 9 is
//       "almost-complete" — a single point short of the 10-fold
//       rosette — so the center is whole but not closed, which is
//       the AI-reflection phrase: "an abundance problem", not a
//       closed book. 9 also fits a 3×3 grid, the universal
//       composable block (think: 9 audio bands, 9 reactors, 9
//       archetypes of reactor).
//
//   2.  INNER RING (the immediate sphere). 6 cardinal nodes at
//       the points of a hexagon. The hexagon is the simplest
//       shape that tiles the plane and is the shape of a benzene
//       ring — chemistry, the first cross-domain language. 6
//       corresponds to the engine's six primary audio features
//       (bass, mid, treble, air, sub, rms) before the derived
//       ones (beat, onset, centroid). The ring is stroked, not
//       filled — connection, not enclosure.
//
//   3.  MIDDLE RING (the disciplines). 7 nodes around a heptagon.
//       7 is the number of major disciplines Kai works across
//       (music, image, code, AI, design, business, experiment),
//       per the AI reflection document. The heptagon is
//       irregular — its points are placed at angles that
//       approximate the seven fields but with one node
//       deliberately larger (music, the first instrument).
//
//   4.  OUTER RING (the disciplines' projects). 12 nodes around
//       a dodecagon. 12 is the chromatic scale (the tonal
//       signature the engine now drives), and the
//       twelve-pointed rosette is the most "complete" form
//       the engine can produce without overlap. The 12 nodes
//       are sized by the audio feature they represent (sub,
//       bass, mid, treble, air × the 5 bands each at 2
//       positions), so the ring is itself a small FFT — the
//       sigil contains the engine's audio analysis in
//       geometric form.
//
//   5.  CORNERS (the cardinal sigil points). 4 outer marks at
//       the corners of an enclosing square. The square is the
//       device frame, the page, the screen — the place where
//       the sigil lives. The corners are where the sigil
//       "exits" its frame, where the inside becomes the
//       outside. Each corner has a small triangle pointing
//       outward, like the four corners of a stage.
//
//   6.  ENCLOSING CIRCLE. A single thin circle that ties the
//       whole composition together. The circle is the universe,
//       the unbroken loop, the audio waveform. The sigil sits
//       inside it but is not bounded by it — there is always
//       one ring's worth of negative space between the inner
//       work and the outer edge.
//
// The whole sigil is procedural. The generator is seeded by
// `KAI` (a stable string seed), so re-runs produce the same
// image. A different seed — say `JAZZ` or `FUTURE` — produces
// a different but equally valid sigil. The shape is meant to
// be regenerated at any boundary, not redrawn by hand.
//
// Usage:
//   node tools/generate-sigil-kai.mjs
//   node tools/generate-sigil-kai.mjs --seed=FUTURE
//   node tools/generate-sigil-kai.mjs --out=/tmp/sigil.svg
//
// Output defaults to press/sigil-kai.svg.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const seedArg = args.find((a) => a.startsWith('--seed='));
const outArg  = args.find((a) => a.startsWith('--out='));
const SEED = (seedArg ? seedArg.slice('--seed='.length) : 'KAI').toUpperCase();
const OUT  = outArg ? outArg.slice('--out='.length) : 'press/sigil-kai.svg';

// ---- Hash a string into a 32-bit unsigned int. Same FNV-1a used by
//      the engine's glyph-forge so the sigil lives in the same PRNG family.
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(hash32(SEED));
const TAU = Math.PI * 2;

// ---- Geometry constants. The sigil is drawn in a 1000x1000 viewBox
//      centered on (500, 500). 1000 is a good resolution for both
//      a 1024px social card and a 200px favicon-derivative.
const CX = 500, CY = 500;
const R9_INNER    =  60;   // 9-pointed central star
const R_HEX        = 130;   // 6-pointed hexagon ring
const R_HEPT        = 210;   // 7-pointed heptagon ring (disciplines)
const R_DODEC       = 310;   // 12-pointed dodecagon (audio bands)
const R_OUTER       = 380;   // enclosing universe circle
const R_CORNER       = 440;   // corners (slightly outside the universe)

// ---- Helper: n-sided polygon points.
function polyPoints(n, r, cx = CX, cy = CY, rotation = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * TAU;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
function pointsToPath(pts) {
  return 'M' + pts.map((p) => p.map((c) => c.toFixed(2)).join(',')).join(' L') + ' Z';
}

// ---- Helper: place a small node at (x, y) with a given radius and
//      rotation; returns a path of the node's stroke (no fill).
function nodeAt(x, y, r, rotation = 0) {
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" />`
       + `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r * 0.45).toFixed(2)}" />`
       + `<line x1="${(x - r * 0.85).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x + r * 0.85).toFixed(2)}" y2="${y.toFixed(2)}" transform="rotate(${rotation.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})" />`;
}

// ---- 1.  CENTRAL NODE — a 9-pointed star.  The amplitude is
//      randomized slightly so the points have a subtle hand-drawn
//      variation; the seed makes it reproducible.
function centralStar() {
  const k = 9;
  const inner = R9_INNER * (0.42 + rnd() * 0.08);
  const outer = R9_INNER * (0.94 + rnd() * 0.08);
  const pts = [];
  for (let i = 0; i < k * 2; i++) {
    const a = -Math.PI / 2 + (i / (k * 2)) * TAU;
    const r = i % 2 === 0 ? outer : inner;
    pts.push([CX + Math.cos(a) * r, CY + Math.sin(a) * r]);
  }
  return pointsToPath(pts);
}

// ---- 2.  HEXAGONAL INNER RING — 6 cardinal nodes connected by a thin
//      stroke.  The hexagon itself is the underlying geometry; the
//      6 nodes are placed at the points.
function hexRing() {
  const hex = polyPoints(6, R_HEX, CX, CY, -Math.PI / 2);
  // 6 nodes at the hexagon points, sized at 6 each
  return {
    stroke: pointsToPath(hex),
    nodes: hex.map(([x, y]) => nodeAt(x, y, 6, 0)),
  };
}

// ---- 3.  HEPTAGON MIDDLE RING — 7 disciplines.  The heptagon is
//      intentionally irregular: one node is enlarged (music, the
//      first instrument) and the other six are smaller.  The
//      angles are 360/7 each starting at the top.
function heptRing() {
  const n = 7;
  const ring = [];
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const r = R_HEPT;
    const x = CX + Math.cos(a) * r;
    const y = CY + Math.sin(a) * r;
    ring.push([x, y]);
    // Music (i=0) is the largest, others smaller — first instrument.
    const size = i === 0 ? 12 : 7;
    nodes.push(nodeAt(x, y, size, a * 180 / Math.PI + 90));
  }
  return {
    stroke: pointsToPath(ring),
    nodes,
  };
}

// ---- 4.  DODECAGON OUTER RING — 12 nodes, sized by the audio band
//      each represents.  The 12 are mapped in pairs to the engine's
//      6 audio features (sub, bass, mid, treble, air, + 6 RMS-like
//      duplicates of the 5 bands at offset angles), so the ring is
//      itself a small FFT.
function dodecRing() {
  const n = 12;
  const ring = [];
  const nodes = [];
  // Each pair of 12 maps to one of 5 bands + 1 spare (sized smaller).
  const bandSizes = [11, 9, 8, 8, 6, 4, 9, 7, 6, 5, 4, 3];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const r = R_DODEC;
    const x = CX + Math.cos(a) * r;
    const y = CY + Math.sin(a) * r;
    ring.push([x, y]);
    nodes.push(nodeAt(x, y, bandSizes[i], a * 180 / Math.PI + 90));
  }
  return {
    stroke: pointsToPath(ring),
    nodes,
  };
}

// ---- 5.  CORNERS — 4 small triangles at the corners of an enclosing
//      square, each pointing outward.  The square is the device
//      frame; the corners are where the sigil exits it.
function cornerMarks() {
  const c = R_CORNER;
  const half = c * 0.707;  // diagonal
  const corners = [
    [CX - c, CY - c], [CX + c, CY - c],
    [CX - c, CY + c], [CX + c, CY + c],
  ];
  return corners.map(([x, y], i) => {
    // Triangle pointing away from the centre.
    const dx = Math.sign(x - CX) * 14;
    const dy = Math.sign(y - CY) * 14;
    return `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${(-dx * 0.5).toFixed(1)} ${(-dy * 0.5).toFixed(1)} l ${(dx * 0.5).toFixed(1)} ${(-dy * 0.5).toFixed(1)} Z" />`;
  }).join('\n      ');
}

// ---- 6.  ENCLOSING CIRCLE — the universe boundary, one ring's worth
//      of negative space away from the dodecagon.
function enclosingCircle() {
  return `<circle cx="${CX}" cy="${CY}" r="${R_OUTER}" />`;
}

// ---- Build the SVG. The ink is rendered as a single stroke colour
//      with no fill — sigil aesthetic, not logo aesthetic.  The
//      colour is left as currentColor so the embedding page can
//      set the ink (light on dark, gold on black, etc.) via CSS.
const central = centralStar();
const hex      = hexRing();
const hept     = heptRing();
const dodec    = dodecRing();
const corners  = cornerMarks();
const outer    = enclosingCircle();

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Kai character sigil — generated by tools/generate-sigil-kai.mjs.
  Seed: ${SEED}

  What you are looking at (read inside-out):
    1. Central node: a 9-pointed star. 9 is "almost-complete" — one point
       short of the 10-fold rosette. The center is whole but not closed,
       which is the AI reflection's phrase: "an abundance problem", not
       a closed book.
    2. Hexagonal inner ring: 6 cardinal nodes — the engine's 6 primary
       audio features (bass, mid, treble, air, sub, rms) before any
       derived ones. Connection, not enclosure: the ring is stroked.
    3. Heptagonal middle ring: 7 nodes — the 7 disciplines (music, image,
       code, AI, design, business, experiment). The first node is
       enlarged (music, the first instrument).
    4. Dodecagonal outer ring: 12 nodes — the chromatic scale (the
       engine's tonal signature) and the 12-fold rosette. The 12 are
       sized as a small FFT, so the ring is itself the engine's audio
       analysis in geometric form.
    5. Corner triangles: 4 marks at the corners of an enclosing
       square. The square is the device frame; the corners are where
       the sigil exits it.
    6. Enclosing circle: the unbroken loop, the audio waveform, the
       universe. One ring's worth of negative space between inner work
       and outer edge.

  All elements are stroked, not filled — sigil aesthetic, not logo
  aesthetic. The ink is currentColor so the embedding page sets the
  colour via CSS.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000"
     role="img" aria-label="Kai character sigil — interdisciplinary creative inventor">
  <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
    <!-- 6. enclosing circle -->
    ${outer}
    <!-- 4. dodecagon (12 audio bands) -->
    <path d="${dodec.stroke}" />
    ${dodec.nodes.map((n) => `    ${n}`).join('\n    ')}
    <!-- 3. heptagon (7 disciplines) -->
    <path d="${hept.stroke}" />
    ${hept.nodes.map((n) => `    ${n}`).join('\n    ')}
    <!-- 2. hexagon (6 audio features) -->
    <path d="${hex.stroke}" />
    ${hex.nodes.map((n) => `    ${n}`).join('\n    ')}
    <!-- 1. central 9-pointed star (the inventor) -->
    <path d="${central}" stroke-width="2.2" />
    <!-- 5. corner marks (the device frame exits) -->
    ${corners.split('\n').map((l) => l.trim()).filter(Boolean).join('\n    ')}
  </g>
</svg>
`;

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT} (seed=${SEED})`);
