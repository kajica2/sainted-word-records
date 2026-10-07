// glyph-forge.client.js — procedural ornament generator (window.SWR_GLYPH_FORGE).
//
// The glyph fill needs every cell to be a DIFFERENT character, and a catalog
// of 12 cannot fill an 84-cell sheet without repeating seven times over. So
// the characters are generated instead: a family of parametric stroke
// ornaments, each one driven by a seeded PRNG, gives a large enough space
// that no two cells collide.
//
// Determinism is the whole point. A sheet is a pure function of its master
// seed: the same seed renders the same ornaments on every load, on every
// machine, so the page is reproducible and a screenshot means something. A
// cell's glyph depends only on (masterSeed, index) — not on the grid size —
// so resizing the sheet from 12x7 to 8x7 keeps the first 56 ornaments
// identical instead of reshuffling the whole page.
//
// UNIQUE is enforced, not hoped for. Every generated path is hashed and
// checked against the ones already minted; a collision is re-rolled with an
// incremented salt until it is genuinely new. The unit test asserts all
// hashes differ, so the guarantee is checkable rather than probabilistic.
//
// GEOMETRY is normalised by one shared pass, not per family. The generators
// compose amplitudes (rotate a squashed ellipse and the corner reaches
// RAD*sqrt(2)), so any of them can emit ink outside the 64 box. buildGlyph()
// measures what came out, then scales it to a fixed extent and re-centres it
// on (32,32) — which both guarantees the box invariant and makes every
// character the same optical weight in its cell. Fixing this once is what
// lets the families stay simple; patching nine separate generators would be
// nine chances to miss one.
//
// Output matches the gallery catalog's contract so glyph-fill.client.js can
// consume either source: { id, name, family, d } with `d` authored as stroke
// commands in a 64x64 box centred on (32,32).
//
// Public surface: window.SWR_GLYPH_FORGE = {
//   FAMILIES,     // the generator catalog, for the UI
//   MAX_EXTENT,   // ink extent cap, in glyph units
//   MIN_EXTENT,   // ink floor, so nothing renders as a speck
//   mulberry32,   // (seed) -> rnd(), exposed for tests
//   hash32,       // (str) -> uint32
//   buildGlyph,   // (segments) -> path string, fitted to the box
//   forge,        // (count, masterSeed?) -> glyphs[], all distinct
// }

(function () {
  'use strict';
  if (window.SWR_GLYPH_FORGE) return; // idempotent

  // ---- primitives ---------------------------------------------------------

  // mulberry32: 32-bit state, passes gjrand, and — the reason it is chosen —
  // one integer seed gives a full generator, so a cell's randomness is one
  // number rather than a stateful object threaded through nine families.
  function mulberry32(a) {
    let s = a | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a. Used both to turn a seed string into an integer and to fingerprint
  // a generated path for the uniqueness check.
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  const CX = 32;    // box centre
  const RAD = 26;   // base radius the families design around

  // Ink extent every glyph is normalised to. The box is 64 wide and the
  // ornament stroke is 3.5, so 52 leaves ~5 units of clear margin each side.
  const MAX_EXTENT = 52;
  // A floor as well as a ceiling: a rosette with a tiny amplitude would
  // otherwise render as a dot among 51 substantial neighbours.
  const MIN_EXTENT = 30;

  function q(v) {
    // 2dp is well below a pixel at any realistic cell size and keeps the
    // path strings short enough to hash and store cheaply.
    return Math.round(v * 100) / 100;
  }

  function rotate(x, y, a) {
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  }

  // Every family returns segments in CENTRED coordinates (origin at the box
  // centre) so buildGlyph() can measure and normalise them.
  function ringPoints(radius, n, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (rot || 0);
      pts.push([radius * Math.cos(t), radius * Math.sin(t)]);
    }
    return pts;
  }

  // One shared normalisation pass: measure the ink, scale it to a fixed
  // extent, centre it, and serialize. This is the only place a glyph's
  // geometry is committed, which is why the box invariant needs no per-family
  // reasoning.
  function buildGlyph(segments) {
    const segs = (segments || []).filter((s) => s && s.pts && s.pts.length >= 2);
    if (!segs.length) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of segs) {
      for (const p of s.pts) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const extent = Math.max(w, h);
    if (!Number.isFinite(extent) || extent <= 0) return null;

    const target = Math.min(MAX_EXTENT, Math.max(MIN_EXTENT, extent));
    const k = target / extent;
    const ox = CX - ((minX + maxX) / 2) * k;
    const oy = CX - ((minY + maxY) / 2) * k;

    let d = '';
    for (const s of segs) {
      d += 'M' + q(s.pts[0][0] * k + ox) + ' ' + q(s.pts[0][1] * k + oy);
      for (let i = 1; i < s.pts.length; i++) {
        d += 'L' + q(s.pts[i][0] * k + ox) + ' ' + q(s.pts[i][1] * k + oy);
      }
      if (s.close) d += 'Z';
    }
    return d;
  }

  // ---- generator families -------------------------------------------------
  // Each takes the seeded rnd and returns segments in centred coordinates.
  // Nine families with continuous parameters each is a large enough space
  // that 84 draws land apart without help; the uniqueness check in forge()
  // is the backstop.
  const FAMILIES = [
    {
      id: 'rosette',
      label: 'Rosette',
      // r(t) = R(1 + a1 cos k1 t + a2 cos k2 t + ph) — flowers, star flowers.
      make(rnd) {
        const k1 = 3 + Math.floor(rnd() * 7);
        const a1 = 0.18 + rnd() * 0.26;
        const k2 = 2 + Math.floor(rnd() * 5);
        const a2 = rnd() * 0.13;
        const ph = rnd() * Math.PI * 2;
        const squash = 0.72 + rnd() * 0.5;
        const rot = rnd() * Math.PI * 2;
        const pts = [];
        for (let i = 0; i < 120; i++) {
          const t = (i / 120) * Math.PI * 2;
          const rad = RAD * (1 + a1 * Math.cos(k1 * t) + a2 * Math.cos(k2 * t + ph));
          pts.push([rad * Math.cos(t + rot), rad * Math.sin(t + rot) * squash]);
        }
        return [{ pts, close: true }];
      },
    },
    {
      id: 'star',
      label: 'Star',
      // Alternating outer/inner radii: the classic n-point star.
      make(rnd) {
        const n = 4 + Math.floor(rnd() * 7);
        const inner = 0.3 + rnd() * 0.42;
        const rot = rnd() * Math.PI * 2;
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
          const rad = i % 2 ? RAD * inner : RAD;
          const t = rot + (i / (n * 2)) * Math.PI * 2;
          pts.push([rad * Math.cos(t), rad * Math.sin(t)]);
        }
        return [{ pts, close: true }];
      },
    },
    {
      id: 'squircle',
      label: 'Squircle',
      // |x/a|^n + |y/b|^n = 1: ellipses, squircles, near-rectangles, astroid.
      make(rnd) {
        const n = 0.6 + rnd() * 7;
        const ratio = 0.45 + rnd() * 0.55;
        const rot = rnd() * Math.PI * 2;
        const e = 2 / n;
        const pts = [];
        for (let i = 0; i < 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          const ct = Math.cos(t);
          const st = Math.sin(t);
          const x = RAD * Math.sign(ct) * Math.pow(Math.abs(ct), e);
          const y = RAD * ratio * Math.sign(st) * Math.pow(Math.abs(st), e);
          pts.push(rotate(x, y, rot));
        }
        return [{ pts, close: true }];
      },
    },
    {
      id: 'knot',
      label: 'Knot',
      // Lissajous. Integer a/b over two turns always returns to its start, so
      // the curve is closed and reads as a woven knot rather than a stray arc.
      make(rnd) {
        const a = 2 + Math.floor(rnd() * 6);
        const b = 2 + Math.floor(rnd() * 6);
        const delta = rnd() * Math.PI * 2;
        const rot = rnd() * Math.PI * 2;
        const sx = 0.55 + rnd() * 0.45;
        const sy = 0.55 + rnd() * 0.45;
        const pts = [];
        for (let i = 0; i < 160; i++) {
          const t = (i / 160) * Math.PI * 2 * 2;
          pts.push(rotate(RAD * sx * Math.sin(a * t + delta), RAD * sy * Math.sin(b * t), rot));
        }
        return [{ pts, close: true }];
      },
    },
    {
      id: 'cog',
      label: 'Cog',
      // Four points per tooth — two on the outer radius, two on the inner —
      // which gives flat tooth flanks instead of a spiky sunburst.
      make(rnd) {
        const teeth = 6 + Math.floor(rnd() * 12);
        const depth = 0.5 + rnd() * 0.34;
        const rot = rnd() * Math.PI * 2;
        const pts = [];
        for (let i = 0; i < teeth * 4; i++) {
          const phase = i % 4;
          const rad = phase < 2 ? RAD : RAD * (1 - depth);
          const t = rot + (i / (teeth * 4)) * Math.PI * 2;
          pts.push([rad * Math.cos(t), rad * Math.sin(t)]);
        }
        return [{ pts, close: true }];
      },
    },
    {
      id: 'chevron',
      label: 'Chevron',
      // One to three stacked zigzag bands, sheared so they read as a frieze.
      make(rnd) {
        const bands = 1 + Math.floor(rnd() * 3);
        const teeth = 3 + Math.floor(rnd() * 6);
        const amp = RAD * (0.3 + rnd() * 0.34);
        const shear = 0.25 + rnd() * 0.7;
        const rot = (rnd() - 0.5) * 0.7;
        const segs = [];
        for (let b = 0; b < bands; b++) {
          const off = (b - (bands - 1) / 2) * (RAD * 0.55);
          const pts = [];
          for (let i = 0; i <= teeth; i++) {
            const x = -RAD + (2 * RAD * i) / teeth;
            const y = (i % 2 ? -amp : amp) + off;
            pts.push(rotate(x + y * shear, y, rot));
          }
          segs.push({ pts, close: false });
        }
        return segs;
      },
    },
    {
      id: 'spokes',
      label: 'Spokes',
      // Concentric rings plus radial ticks — a compass rose or a wheel.
      make(rnd) {
        const rings = 1 + Math.floor(rnd() * 3);
        const spokes = 3 + Math.floor(rnd() * 12);
        const inner = 0.2 + rnd() * 0.34;
        const rot = rnd() * Math.PI * 2;
        const segs = [];
        for (let i = 0; i < rings; i++) {
          segs.push({ pts: ringPoints(RAD * (1 - i * 0.34), 64, 0), close: true });
        }
        for (let j = 0; j < spokes; j++) {
          const t = rot + (j / spokes) * Math.PI * 2;
          segs.push({
            pts: [
              [RAD * inner * Math.cos(t), RAD * inner * Math.sin(t)],
              [RAD * 0.94 * Math.cos(t), RAD * 0.94 * Math.sin(t)],
            ],
            close: false,
          });
        }
        return segs;
      },
    },
    {
      id: 'arcs',
      label: 'Arcs',
      // Dashed concentric arcs — a sunburst or a broken ring.
      make(rnd) {
        const segsN = 3 + Math.floor(rnd() * 9);
        const duty = 0.3 + rnd() * 0.45;
        const rings = 1 + Math.floor(rnd() * 3);
        const rot = rnd() * Math.PI * 2;
        const segs = [];
        for (let r = 0; r < rings; r++) {
          const rad = RAD * (1 - r * (0.34 + rnd() * 0.12));
          for (let s = 0; s < segsN; s++) {
            const a0 = rot + (s / segsN) * Math.PI * 2;
            const a1 = a0 + (1 / segsN) * Math.PI * 2 * duty;
            const pts = [];
            for (let i = 0; i <= 10; i++) {
              const t = a0 + ((a1 - a0) * i) / 10;
              pts.push([rad * Math.cos(t), rad * Math.sin(t)]);
            }
            segs.push({ pts, close: false });
          }
        }
        return segs;
      },
    },
    {
      id: 'interlace',
      label: 'Interlace',
      // Two overlaid lobes at different phases — a pregnant lozenge or knot.
      make(rnd) {
        const lobes = 3 + Math.floor(rnd() * 5);
        const twist = rnd() * Math.PI * 2;
        const squash = 0.5 + rnd() * 0.4;
        const segs = [];
        for (let k = 0; k < 2; k++) {
          const ph = twist + (k * Math.PI) / lobes;
          const pts = [];
          for (let i = 0; i < 120; i++) {
            const t = (i / 120) * Math.PI * 2;
            const rad = RAD * 0.95 * (0.62 + 0.38 * Math.abs(Math.cos((lobes * t) / 2 + ph)));
            pts.push([rad * Math.cos(t), rad * Math.sin(t) * squash]);
          }
          segs.push({ pts, close: true });
        }
        return segs;
      },
    },
  ];

  // ---- forge --------------------------------------------------------------

  // (count, masterSeed) -> count glyphs, every one distinct.
  // Deterministic: the same arguments always produce the same sheet, and a
  // cell's glyph depends only on its own index, so a grid resize preserves
  // the ornaments already on screen.
  function forge(count, masterSeed) {
    const n = Math.max(0, Math.floor(Number(count)) || 0);
    const seed = masterSeed == null ? 1 : masterSeed;
    const out = [];
    const seen = Object.create(null);

    for (let i = 0; i < n; i++) {
      let salt = 0;
      let glyph = null;
      let key = '';
      // Re-roll with an incremented salt until the path is genuinely new.
      // The space is far larger than any sheet we build, so this is one pass
      // in practice; the loop is what makes "all different" a guarantee.
      for (;;) {
        const rnd = mulberry32(hash32(String(seed) + ':' + i + ':' + salt));
        const fam = FAMILIES[Math.floor(rnd() * FAMILIES.length) % FAMILIES.length];
        let d = null;
        try {
          d = buildGlyph(fam.make(rnd));
        } catch {
          d = null;
        }
        salt++;
        if (!d || d.length < 16) continue;
        key = String(hash32(d));
        if (seen[key]) continue;
        glyph = { id: 'f' + i, name: fam.label, family: fam.id, d, seed: String(seed), index: i };
        break;
      }
      seen[key] = true;
      out.push(glyph);
    }
    return out;
  }

  window.SWR_GLYPH_FORGE = {
    FAMILIES,
    MAX_EXTENT,
    MIN_EXTENT,
    mulberry32,
    hash32,
    buildGlyph,
    forge,
  };
})();