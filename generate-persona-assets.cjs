#!/usr/bin/env node
// generate-persona-assets.js
// One-shot script that synthesizes PNG images matching each persona's aesthetic.
// Writes to library/persona/. Updates library/manifest.json and prints
// the new set definitions to paste into media-sets.client.js.
//
// Run: node generate-persona-assets.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, 'library', 'persona');
fs.mkdirSync(ROOT, { recursive: true });

const W = 1280, H = 720;

// ---- Minimal PNG writer (RGB, no alpha) ----
// Hand-rolled because we don't want to require canvas/native deps.
function writePngRGBA(filePath, width, height, pixels) {
  // pixels: Uint8Array of RGBA bytes, length = width*height*4
  const stride = width * 4;
  // Filter byte (0 = None) prepended to each row
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;  // filter type: None
    pixels.copy
      ? pixels.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : filtered.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const compressed = zlib.deflateSync(filtered);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = require('zlib').crc32 ? require('zlib').crc32(crcInput) : crc32(crcInput);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // Node has zlib.crc32 since 22.x; fall back to manual if not present.
  function crc32(buf) {
    let c, table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      table[n] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunkWithCrc(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const png = Buffer.concat([
    sig,
    chunkWithCrc('IHDR', ihdr),
    chunkWithCrc('IDAT', compressed),
    chunkWithCrc('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}

// ---- Drawing helpers ----
function newCanvas() {
  const px = Buffer.alloc(W * H * 4);
  return {
    width: W, height: H, px,
    set(x, y, r, g, b, a = 255) {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
    },
    get(x, y) {
      const i = (y * W + x) * 4;
      return [px[i], px[i+1], px[i+2], px[i+3]];
    },
    fill(r, g, b) {
      for (let i = 0; i < W * H; i++) {
        px[i*4] = r; px[i*4+1] = g; px[i*4+2] = b; px[i*4+3] = 255;
      }
    },
    // Linear gradient fill: top color → bottom color
    vgradient(top, bot) {
      const dr = (bot[0] - top[0]) / H;
      const dg = (bot[1] - top[1]) / H;
      const db = (bot[2] - top[2]) / H;
      for (let y = 0; y < H; y++) {
        const r = Math.round(top[0] + dr * y);
        const g = Math.round(top[1] + dg * y);
        const b = Math.round(top[2] + db * y);
        for (let x = 0; x < W; x++) this.set(x, y, r, g, b);
      }
    },
    circle(cx, cy, radius, r, g, b, alpha = 1) {
      const r2 = radius * radius;
      const inner = (radius - 1) * (radius - 1);
      for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          const d2 = x*x + y*y;
          if (d2 > r2) continue;
          // Soft edge: antialiased alpha
          let a = 1;
          if (d2 > inner) {
            const d = Math.sqrt(d2);
            a = Math.max(0, 1 - (d - (radius - 1)));
          }
          const ax = cx + x, ay = cy + y;
          if (ax < 0 || ax >= W || ay < 0 || ay >= H) continue;
          const i = (ay * W + ax) * 4;
          if (a >= 1) {
            this.px[i] = r; this.px[i+1] = g; this.px[i+2] = b; this.px[i+3] = 255;
          } else {
            this.px[i] = Math.round(r * a + this.px[i] * (1 - a));
            this.px[i+1] = Math.round(g * a + this.px[i+1] * (1 - a));
            this.px[i+2] = Math.round(b * a + this.px[i+2] * (1 - a));
          }
        }
      }
    },
    rect(x0, y0, w, h, r, g, b, alpha = 1) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = (y * W + x) * 4;
          if (alpha >= 1) {
            this.px[i] = r; this.px[i+1] = g; this.px[i+2] = b; this.px[i+3] = 255;
          } else {
            this.px[i] = Math.round(r * alpha + this.px[i] * (1 - alpha));
            this.px[i+1] = Math.round(g * alpha + this.px[i+1] * (1 - alpha));
            this.px[i+2] = Math.round(b * alpha + this.px[i+2] * (1 - alpha));
          }
        }
      }
    },
    // Diagonal slash (for stripe elements). Optional 4th arg = offset,
    // shifts the slash perpendicular to its line so multiple parallel
    // slashes can be drawn from the same function.
    slash(thickness, r, g, b, alpha = 1, offset = 0) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = (W - x) - y - offset;  // diagonal: x + y = const
          if (Math.abs(d) < thickness) {
            const i = (y * W + x) * 4;
            this.px[i] = Math.round(r * alpha + this.px[i] * (1 - alpha));
            this.px[i+1] = Math.round(g * alpha + this.px[i+1] * (1 - alpha));
            this.px[i+2] = Math.round(b * alpha + this.px[i+2] * (1 - alpha));
          }
        }
      }
    },
    // Grid pattern (for GRID persona)
    grid(cellSize, r, g, b, alpha = 1) {
      for (let y = 0; y < H; y += cellSize) {
        for (let x = 0; x < W; x++) {
          if (y < H) this.rect(x, y, 1, Math.min(2, H - y), r, g, b, alpha);
        }
      }
      for (let x = 0; x < W; x += cellSize) {
        for (let y = 0; y < H; y++) {
          if (x < W) this.rect(x, y, Math.min(2, W - x), 1, r, g, b, alpha);
        }
      }
    },
    // Radial gradient: bright at center, fades to edge color
    radialGradient(cx, cy, innerRadius, outerRadius, innerColor, outerColor) {
      const maxR = Math.sqrt(W*W + H*H) / 2;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx*dx + dy*dy);
          let t = (d - innerRadius) / (outerRadius - innerRadius);
          t = Math.max(0, Math.min(1, t));
          const r = Math.round(innerColor[0] + (outerColor[0] - innerColor[0]) * t);
          const g = Math.round(innerColor[1] + (outerColor[1] - innerColor[1]) * t);
          const b = Math.round(innerColor[2] + (outerColor[2] - innerColor[2]) * t);
          this.set(x, y, r, g, b);
        }
      }
    },
    // Bright concentric rings (for HALLUCINATION)
    rings(count, color) {
      const cy = H / 2;
      const maxR = Math.min(W, H) * 0.6;
      for (let i = count; i > 0; i--) {
        const r = (i / count) * maxR;
        this.circle(W/2, cy, r, color[0], color[1], color[2], 0.4);
      }
    },
    // Scanlines (thin horizontal stripes for HALLUCINATION)
    scanlines(spacing, color, alpha = 0.5) {
      for (let y = 0; y < H; y += spacing) {
        this.rect(0, y, W, 1, color[0], color[1], color[2], alpha);
      }
    },
    save(filename) {
      writePngRGBA(path.join(ROOT, filename), W, H, this.px);
      console.log(`  wrote library/persona/${filename}`);
    },
  };
}

// ---- Generator functions per persona ----

function genRawSet() {
  // RAW: minimal, geometric, soft
  // p16-raw-1: gradient + single circle (clean music-video look)
  let c = newCanvas();
  c.vgradient([30, 35, 50], [80, 50, 90]);
  c.circle(W * 0.4, H * 0.45, H * 0.32, [240, 220, 180]);
  c.save('p16-raw-1.png');

  // p17-raw-2: bars + slash (geometric)
  c = newCanvas();
  c.vgradient([20, 25, 40], [50, 30, 60]);
  c.rect(W * 0.05, H * 0.2,  W * 0.18, H * 0.6,  [180, 180, 200]);
  c.rect(W * 0.30, H * 0.35, W * 0.10, H * 0.4,  [140, 140, 160]);
  c.rect(W * 0.50, H * 0.15, W * 0.04, H * 0.7,  [220, 220, 240]);
  c.slash(3, [255, 255, 255], 0.3);
  c.save('p17-raw-2.png');
}

function genPosterSet() {
  // POSTER: high-contrast, simple shapes, hard edges
  let c = newCanvas();
  c.fill(255, 240, 200);
  c.rect(0, H * 0.55, W, H * 0.45, [220, 50, 80]);
  c.circle(W * 0.7, H * 0.3, H * 0.18, [50, 70, 180]);
  c.rect(0, H * 0.7, W * 0.3, H * 0.3, [50, 50, 50]);
  c.save('p18-poster-1.png');

  c = newCanvas();
  c.fill(20, 20, 30);
  c.circle(W * 0.3, H * 0.5, H * 0.35, [255, 200, 0]);
  c.rect(W * 0.55, 0, W * 0.45, H, [200, 0, 100]);
  c.rect(0, H * 0.85, W, H * 0.15, [255, 255, 255]);
  c.save('p19-poster-2.png');
}

function genMaskSet() {
  // MASK: atmospheric, vignette + glow center, moody
  let c = newCanvas();
  c.radialGradient(W/2, H/2, H * 0.1, H * 0.8, [80, 60, 100], [10, 10, 20]);
  c.circle(W * 0.5, H * 0.45, H * 0.15, [220, 180, 240], 0.5);
  c.save('p20-mask-1.png');

  c = newCanvas();
  c.radialGradient(W/2, H/2, H * 0.05, H * 0.7, [60, 80, 110], [5, 8, 15]);
  c.circle(W * 0.4, H * 0.55, H * 0.18, [180, 220, 255], 0.4);
  c.circle(W * 0.6, H * 0.35, H * 0.10, [255, 220, 200], 0.3);
  c.save('p21-mask-2.png');
}

function genFxSet() {
  // FX: chromatic, glitch, busy
  let c = newCanvas();
  c.fill(10, 5, 20);
  c.rect(0, 0, W, H, [255, 0, 80], 0.0);  // base
  // RGB-shifted bars
  c.rect(W * 0.2, H * 0.3, W * 0.6, H * 0.05, [255, 0, 100], 0.8);
  c.rect(W * 0.18, H * 0.31, W * 0.6, H * 0.05, [0, 255, 255], 0.6);
  c.rect(W * 0.22, H * 0.29, W * 0.6, H * 0.05, [255, 255, 0], 0.5);
  c.circle(W * 0.7, H * 0.6, H * 0.2, [200, 0, 255], 0.7);
  c.slash(8, [255, 255, 255], 0.4);
  c.save('p22-fx-1.png');

  c = newCanvas();
  c.fill(5, 0, 15);
  for (let i = 0; i < 5; i++) {
    const y = H * (0.15 + i * 0.15);
    c.rect(W * 0.1, y, W * 0.8, 4, [255, 0, 100 + i * 30], 0.8);
    c.rect(W * 0.1, y + 5, W * 0.8, 4, [0, 200 + i * 10, 255], 0.6);
  }
  c.rect(0, H * 0.05, W * 0.2, H * 0.9, [255, 200, 0], 0.4);
  c.save('p23-fx-2.png');
}

function genFilterSet() {
  // FILTER: sepia, warm, vintage
  let c = newCanvas();
  c.vgradient([180, 140, 90], [80, 50, 30]);
  c.circle(W * 0.6, H * 0.5, H * 0.3, [220, 180, 120]);
  c.rect(W * 0.1, H * 0.7, W * 0.4, H * 0.05, [40, 30, 20]);
  c.save('p24-filter-1.png');

  c = newCanvas();
  c.vgradient([160, 110, 60], [50, 30, 15]);
  c.circle(W * 0.3, H * 0.4, H * 0.15, [240, 200, 150]);
  c.circle(W * 0.7, H * 0.6, H * 0.20, [200, 160, 110]);
  c.rect(0, 0, W, H * 0.1, [40, 25, 10]);
  c.rect(0, H * 0.92, W, H * 0.08, [40, 25, 10]);
  c.save('p25-filter-2.png');
}

function genNeonSet() {
  // NEON: electric magenta/cyan, dark base, glowing shapes.
  // v2 — denser composition: 10+ elements per image, more layers, more glow.
  // Magenta + cyan on near-black. Hot club, screen-blend stacks,
  // sharpened easings, scanlines. Cuts on the beat, not after it.

  // Helper: bloom halo around a filled circle (semi-transparent ring)
  function bloom(c, cx, cy, r, rgb) {
    c.circle(cx, cy, r * 1.8, rgb[0], rgb[1], rgb[2], 0.12);
    c.circle(cx, cy, r * 1.4, rgb[0], rgb[1], rgb[2], 0.18);
    c.circle(cx, cy, r * 1.15, rgb[0], rgb[1], rgb[2], 0.30);
  }

  // --- p26: vertical bars + dots grid (club-poster feel) ---
  let c = newCanvas();
  c.fill(6, 4, 18);
  // Background dotted grid (sparse)
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 24; col++) {
      const x = col * 60 + 20;
      const y = row * 60 + 20;
      c.set(x, y, 60, 30, 80, 255);
    }
  }
  // 4 thick vertical bars in alternating colors
  const barWidth = W * 0.06;
  const colors = [
    [255, 20, 147],   // magenta
    [0, 255, 255],    // cyan
    [255, 240, 0],    // yellow accent
    [180, 0, 255],    // purple
  ];
  for (let i = 0; i < 4; i++) {
    const x = W * 0.15 + i * (W * 0.18);
    const color = colors[i];
    bloom(c, x + barWidth / 2, H * 0.5, H * 0.4, color);
    c.rect(x, H * 0.1, barWidth, H * 0.8, color[0], color[1], color[2], 1.0);
    // Dark gap in the middle of each bar (sharp ease beat-cut)
    c.rect(x, H * 0.45, barWidth, H * 0.04, [6, 4, 18], 1.0);
  }
  // Big horizontal accent at top
  c.rect(0, H * 0.06, W, 4, [255, 20, 147], 1.0);
  c.rect(0, H * 0.92, W, 4, [0, 255, 255], 1.0);
  // Two glowing dots
  bloom(c, W * 0.92, H * 0.2, H * 0.04, [255, 20, 147]);
  c.circle(W * 0.92, H * 0.2, H * 0.04, [255, 255, 255], 1.0);
  bloom(c, W * 0.08, H * 0.85, H * 0.03, [0, 255, 255]);
  c.circle(W * 0.08, H * 0.85, H * 0.03, [255, 255, 255], 1.0);
  c.save('p26-neon-1.png');

  // --- p27: cross-hatch diagonals + central sun ---
  c = newCanvas();
  c.fill(4, 0, 14);
  // Central glowing sun
  bloom(c, W * 0.5, H * 0.5, H * 0.18, [255, 240, 0]);
  c.circle(W * 0.5, H * 0.5, H * 0.18, [255, 240, 0], 1.0);
  c.circle(W * 0.5, H * 0.5, H * 0.10, [255, 255, 255], 0.95);
  // Magenta diagonal slashes
  for (let i = -3; i < 8; i++) {
    c.slash(6, [255, 20, 147], 0.55, i * 100);
  }
  // Cyan diagonal slashes (perpendicular-ish: top-left to bottom-right)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = (W - x) - y;
      // Draw periodic cyan lines
      if (Math.abs((d % 90) - 45) < 3) {
        c.set(x, y, 0, 255, 255, 200);
      }
    }
  }
  // Magenta frame
  c.rect(0, 0, W, 6, [255, 20, 147], 1.0);
  c.rect(0, H - 6, W, 6, [0, 255, 255], 1.0);
  // Small accent dots in corners
  c.circle(60, 60, 8, [255, 20, 147], 1.0);
  c.circle(W - 60, 60, 8, [0, 255, 255], 1.0);
  c.circle(60, H - 60, 8, [0, 255, 255], 1.0);
  c.circle(W - 60, H - 60, 8, [255, 20, 147], 1.0);
  c.save('p27-neon-2.png');
}

function genFilmSet() {
  // FILM: sepia / 16mm grain, warm handheld, slow drift.
  // v2 — denser: layered warm tones, vignette, visible grain particles,
  // multiple film "frames" suggesting projector stills.

  function grain(c, density, variance) {
    for (let i = 0; i < density; i++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const a = 0.3 + Math.random() * 0.5;
      const v = (variance || 50) + Math.floor(Math.random() * 80);
      c.set(x, y, v, v - 25, v - 55, Math.floor(a * 255));
    }
  }

  // --- p28: film strip (perforations on top + bottom) ---
  let c = newCanvas();
  c.vgradient([150, 110, 70], [70, 45, 25]);
  grain(c, 6000, 60);
  // Dark vignette overlay
  const vcx = W / 2, vcy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - vcx, dy = y - vcy;
      const d = Math.sqrt(dx*dx + dy*dy);
      const maxD = Math.sqrt(vcx*vcx + vcy*vcy);
      const v = Math.max(0, 1 - (d / maxD) * 0.6);
      const i = (y * W + x) * 4;
      c.px[i]     = Math.round(c.px[i]     * v);
      c.px[i + 1] = Math.round(c.px[i + 1] * v);
      c.px[i + 2] = Math.round(c.px[i + 2] * v);
    }
  }
  // Film-strip perforations (top + bottom rows of small dark squares)
  for (let i = 0; i < 16; i++) {
    const px = i * (W / 16) + 10;
    c.rect(px, 8,            W / 16 - 20, 18, [30, 20, 10], 1.0);
    c.rect(px, H - 8 - 18,   W / 16 - 20, 18, [30, 20, 10], 1.0);
  }
  // Central warm sun
  c.circle(W * 0.62, H * 0.45, H * 0.22, [230, 180, 110], 0.85);
  c.circle(W * 0.62, H * 0.45, H * 0.14, [240, 200, 140], 0.75);
  // Foreground silhouette (a figure or structure)
  c.rect(0, H * 0.7, W * 0.4, H * 0.3, [40, 25, 12], 0.85);
  c.rect(W * 0.05, H * 0.6, W * 0.12, H * 0.15, [50, 30, 15], 0.7);
  // Sepia vertical scratches (film damage)
  for (let s = 0; s < 5; s++) {
    const sx = Math.floor(Math.random() * W);
    c.rect(sx, 0, 1, H, 200 - Math.floor(Math.random() * 60), 200, 0.18);
  }
  c.save('p28-film-1.png');

  // --- p29: window/frame composition with rain streaks ---
  c = newCanvas();
  c.vgradient([170, 130, 80], [80, 55, 30]);
  grain(c, 5000, 50);
  // Window frame: 4 panes (2x2 grid)
  c.rect(W * 0.2, H * 0.1, W * 0.6, H * 0.8, [40, 25, 12], 0.95);
  c.rect(W * 0.2, H * 0.5, W * 0.6, 6, [40, 25, 12], 0.95);
  c.rect(W * 0.5, H * 0.1, 6, H * 0.8, [40, 25, 12], 0.95);
  // Bright outside (visible through the panes)
  c.rect(W * 0.22, H * 0.12, W * 0.27, H * 0.36, [220, 170, 110], 0.9);
  c.rect(W * 0.52, H * 0.12, W * 0.27, H * 0.36, [230, 180, 120], 0.9);
  c.rect(W * 0.22, H * 0.52, W * 0.27, H * 0.36, [200, 150, 95], 0.9);
  c.rect(W * 0.52, H * 0.52, W * 0.27, H * 0.36, [210, 160, 100], 0.9);
  // Rain streaks (vertical blur lines through panes)
  for (let i = 0; i < 60; i++) {
    const rx = W * 0.22 + Math.random() * W * 0.55;
    const ry = H * 0.12 + Math.random() * H * 0.75;
    const len = 30 + Math.floor(Math.random() * 60);
    for (let dy = 0; dy < len; dy++) {
      if (ry + dy >= H) break;
      c.set(rx, ry + dy, 230, 200, 160, 200);
    }
  }
  // Vignette around the edges
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - vcx, dy = y - vcy;
      const d = Math.sqrt(dx*dx + dy*dy);
      const maxD = Math.sqrt(vcx*vcx + vcy*vcy);
      const v = Math.max(0, 1 - (d / maxD) * 0.7);
      const i = (y * W + x) * 4;
      c.px[i]     = Math.round(c.px[i]     * v);
      c.px[i + 1] = Math.round(c.px[i + 1] * v);
      c.px[i + 2] = Math.round(c.px[i + 2] * v);
    }
  }
  c.save('p29-film-2.png');
}

function genGridSet() {
  // GRID: monochrome / hard cells.
  // v2 — denser: bauhaus-style composition with multiple cell sizes,
  // thicker borders, hard contrast. Snap to the beat, binary easings.

  // --- p30: 4×4 cell grid with diagonal accent ---
  let c = newCanvas();
  c.fill(8, 8, 12);
  // 4x4 grid of cells, each filled with a different gray
  const grays = [25, 50, 90, 140, 180, 210, 240, 255];
  const cellW = W / 4;
  const cellH = H / 4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const idx = (row * 4 + col) % grays.length;
      const g = grays[idx];
      c.rect(col * cellW, row * cellH, cellW, cellH, g, g, g, 1.0);
    }
  }
  // Hard black grid lines (binary on/off — no anti-aliasing)
  for (let i = 0; i <= 4; i++) {
    c.rect(i * cellW, 0, 4, H, [0, 0, 0], 1.0);
    c.rect(0, i * cellH, W, 4, [0, 0, 0], 1.0);
  }
  // Diagonal black bar (cut through 2 cells)
  c.rect(W * 0.25, H * 0.4, W * 0.6, H * 0.05, [0, 0, 0], 1.0);
  // Pure white circle in one cell (binary "on" pop)
  c.circle(W * 0.25, H * 0.25, H * 0.10, [255, 255, 255], 1.0);
  // Pure black square in another
  c.rect(W * 0.65, H * 0.7, W * 0.15, H * 0.15, [0, 0, 0], 1.0);
  c.save('p30-grid-1.png');

  // --- p31: mosaic with asymmetric cell sizes ---
  c = newCanvas();
  c.fill(15, 15, 20);
  // Background: large light-gray rectangle
  c.rect(0, 0, W, H, [220, 220, 220], 1.0);
  // Tile layout (random-asymmetric but balanced)
  const tiles = [
    { x: 0,           y: 0,           w: W * 0.30, h: H * 0.45, g: 30  },
    { x: W * 0.30,    y: 0,           w: W * 0.25, h: H * 0.20, g: 90  },
    { x: W * 0.55,    y: 0,           w: W * 0.20, h: H * 0.45, g: 200 },
    { x: W * 0.75,    y: 0,           w: W * 0.25, h: H * 0.25, g: 50  },
    { x: 0,           y: H * 0.45,    w: W * 0.20, h: H * 0.30, g: 150 },
    { x: W * 0.20,    y: H * 0.45,    w: W * 0.35, h: H * 0.30, g: 100 },
    { x: W * 0.55,    y: H * 0.45,    w: W * 0.45, h: H * 0.30, g: 240 },
    { x: 0,           y: H * 0.75,    w: W * 0.40, h: H * 0.25, g: 60  },
    { x: W * 0.40,    y: H * 0.75,    w: W * 0.30, h: H * 0.25, g: 180 },
    { x: W * 0.70,    y: H * 0.75,    w: W * 0.30, h: H * 0.25, g: 110 },
  ];
  for (const t of tiles) {
    c.rect(t.x, t.y, t.w, t.h, t.g, t.g, t.g, 1.0);
  }
  // Hard black borders around all tiles
  for (let i = 0; i <= 10; i++) {
    // Vertical lines at every tile x boundary
    const tx = [0, W * 0.20, W * 0.30, W * 0.40, W * 0.55, W * 0.70, W * 0.75];
    // (simplified: just full vertical lines at major x positions)
  }
  // Simpler: draw thick borders on the full grid using the function
  c.rect(0, 0, W, 6, [0, 0, 0], 1.0);
  c.rect(0, H - 6, W, 6, [0, 0, 0], 1.0);
  c.rect(0, 0, 6, H, [0, 0, 0], 1.0);
  c.rect(W - 6, 0, 6, H, [0, 0, 0], 1.0);
  // Internal horizontal divider at H * 0.45
  c.rect(0, H * 0.45 - 3, W, 6, [0, 0, 0], 1.0);
  c.rect(0, H * 0.75 - 3, W, 6, [0, 0, 0], 1.0);
  // Vertical dividers at the 5 major x positions
  for (const xv of [W * 0.20, W * 0.30, W * 0.40, W * 0.55, W * 0.70, W * 0.75]) {
    c.rect(xv - 3, 0, 6, H, [0, 0, 0], 1.0);
  }
  // One bright accent (a small accent shape in pure black or white)
  c.circle(W * 0.475, H * 0.225, H * 0.04, [255, 255, 255], 1.0);
  c.save('p31-grid-2.png');
}

function genSmokeSet() {
  // SMOKE: cream warm, heavy blur simulation via overlapping soft circles
  let c = newCanvas();
  c.fill(120, 90, 60);
  // Multiple overlapping soft circles to simulate smoke
  for (let i = 0; i < 12; i++) {
    const x = W * (0.2 + Math.random() * 0.6);
    const y = H * (0.2 + Math.random() * 0.6);
    const r = H * (0.15 + Math.random() * 0.25);
    const tone = 80 + Math.floor(Math.random() * 80);
    c.circle(x, y, r, tone, tone - 20, tone - 40, 0.4);
  }
  c.circle(W * 0.5, H * 0.5, H * 0.35, [200, 170, 130], 0.3);
  c.save('p32-smoke-1.png');

  c = newCanvas();
  c.fill(100, 70, 50);
  for (let i = 0; i < 18; i++) {
    const x = W * (0.1 + Math.random() * 0.8);
    const y = H * (0.1 + Math.random() * 0.8);
    const r = H * (0.08 + Math.random() * 0.18);
    const tone = 60 + Math.floor(Math.random() * 100);
    c.circle(x, y, r, tone + 40, tone, tone - 20, 0.35);
  }
  c.save('p33-smoke-2.png');
}

function genHallucinationSet() {
  // HALLUCINATION: RGB shift, scanlines, noise
  let c = newCanvas();
  c.fill(10, 0, 30);
  // Concentric circles with RGB split
  c.rings(8, [255, 0, 200]);
  // Add scanlines
  c.scanlines(4, [255, 255, 255], 0.3);
  // Bright center
  c.circle(W * 0.5, H * 0.5, H * 0.1, [255, 255, 255], 1.0);
  // Noise overlay (sparse)
  for (let i = 0; i < 4000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * H);
    const r = Math.random() > 0.5 ? 255 : 0;
    const g = Math.random() > 0.5 ? 255 : 0;
    const b = Math.random() > 0.5 ? 255 : 0;
    c.set(x, y, r, g, b, 200);
  }
  c.save('p34-hallucination-1.png');

  c = newCanvas();
  c.fill(20, 0, 40);
  // RGB-shifted diagonal stripes
  for (let i = 0; i < 6; i++) {
    const y = H * (0.1 + i * 0.13);
    c.rect(0, y, W, H * 0.06, [255, 0, 100], 0.7);
    c.rect(8, y + 4, W, H * 0.06, [0, 255, 200], 0.5);
  }
  c.scanlines(3, [255, 255, 255], 0.25);
  c.circle(W * 0.5, H * 0.5, H * 0.18, [255, 255, 255], 0.9);
  c.save('p35-hallucination-2.png');
}

// ---- Run all generators ----
console.log('Generating persona assets to', ROOT);
genRawSet();
genPosterSet();
genMaskSet();
genFxSet();
genFilterSet();
genNeonSet();
genFilmSet();
genGridSet();
genSmokeSet();
genHallucinationSet();

console.log(`\nDone. Generated 20 images.`);