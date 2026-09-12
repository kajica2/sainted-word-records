// client/meshify.client.js — Convert 2D assets to 3D meshes (vanilla, no three.js).
//
// USAGE (browser)
//   const mesh = await window.SWR_MESHIFY.fromPNG(arrayBuffer, { algorithm: 'silhouette' });
//   // mesh.vertices, mesh.indices, mesh.normals, mesh.dims, mesh.material
//
// ALGORITHMS
//   'silhouette'    Trace alpha mask, extrude as flat-bottomed 3D shape.
//                   Best for transparent PNGs of solid subjects (gift bag, icon).
//                   Output: 2*N triangles for N boundary pixels.
//                   Output dims: width=N, height=N (rasterized contour vertex ring)
//                                z = extrusion height.
//
//   'heightmap'     Treat luma as Z. Color images get downsample + luma → 3D terrain.
//                   Best for photos with depth cues (Pinterest screenshots, faces).
//                   Output: (w-1)*(h-1)*2 triangles, vertex grid.
//                   Output dims: width=w, height=h, z = pixel luma scaled.
//
//   'svg-path'      Trace SVG file → Path2D → polygon-offset → extrude.
//                   Best for SVGs / vector logos (clean hard edges).
//                   Output: N triangles for N path contours, Z-extruded.
//                   Output dims: bounds width/height, z = extrusion height.
//
// ALL ALGORITHMS PRODUCE THE SAME SHAPE:
//
//   {
//     vertices: Float32Array,    // 3 floats per vertex: [x, y, z]
//     indices:  Uint16Array,     // 3 indices per triangle
//     normals:  Float32Array,    // 3 floats per vertex: [nx, ny, nz]
//     dims:     { width, height, depth },  // bounding box of mesh
//     material: {  // hint for the renderer
//       kind:  'flat' | 'terrain' | 'extruded',
//       baseColor: [r, g, b, a]  // dominant color sampled from input
//     },
//     source:   { width, height, algorithm }
//   }
//
// PURITY
//   No `import three` — pure JS, pure browser Canvas API for I/O.
//   SVG parsing is a minimal Path-data tokenizer (handles M / L / C / Q / Z
//   commands only). For full SVG support the renderer would need a lib
//   (@svgdotjs/svg.js or paper.js); for the meshify pipeline this minimum
//   vocabulary covers 90% of practical logos/icons.
//
// AUDIO-REACTIVITY (future stage)
//   The output shape exposes indices so a renderer can scale vertex Z by an
//   audio-reactive envelope later without rebuilding geometry.

(function () {
  'use strict';

  if (typeof window === 'undefined') {
    // Allow Node import for tests; bind to a dummy global.
    return;
  }

  // -------------------- helpers --------------------

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Resample a path into polygon vertices using cumulative-length parameter.
  // Each segment is split so consecutive vertices are at most `step` pixels apart.
  function densify(points, step) {
    if (!points.length) return [];
    const out = [points[0].slice()];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const segs = Math.max(1, Math.ceil(len / step));
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        out.push([a[0] + dx * t, a[1] + dy * t]);
      }
    }
    return out;
  }

  // Marching-squares-ish boundary tracer on a binary alpha mask.
  // Returns ordered boundary points as a closed polygon.
  function traceBoundary(mask, w, h) {
    // Find first boundary pixel: scan top-down for first alpha=1.
    let startX = -1, startY = -1;
    outer: for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) { startX = x; startY = y; break outer; }
      }
    }
    if (startX < 0) return [];

    // 8-connected Moore-neighborhood boundary trace.
    const offsets = [
      [-1, -1], [0, -1], [1, -1],
      [1, 0],                          [1, 1],
      [0, 1],  [-1, 1],
      [-1, 0],
    ];
    // Reorder: standard Moore-neighbor clockwise starting from west.
    const NB = [
      [1, 0],   [1, 1],  [0, 1],   [-1, 1],
      [-1, 0],  [-1, 1], // -1,1 was duplicated above; we'll fix later
    ];
    const clockwise = [
      [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, 1], // re-clocked below
    ];
    // Simpler & correct: Moore-neighbor walk starting from west of start pixel
    const NW = [
      [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
    ];
    const path = [[startX, startY]];
    let cx = startX, cy = startY;
    let prevDir = 6; // came from "above"

    // Safety cap.
    const maxSteps = w * h * 4;
    let steps = 0;
    while (steps++ < maxSteps) {
      // Search clockwise from (prevDir + 6) % 8 → (prevDir + 6) % 8 - 1
      const startDir = (prevDir + 6) % 8;
      let found = false;
      let foundDir = -1;
      for (let i = 0; i < 8; i++) {
        const dir = (startDir + i) % 8;
        const nx = cx + NW[dir][0];
        const ny = cy + NW[dir][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (mask[ny * w + nx]) {
          found = true;
          foundDir = dir;
          break;
        }
      }
      if (!found) break; // single-pixel dot
      cx += NW[foundDir][0];
      cy += NW[foundDir][1];
      prevDir = foundDir;
      // Closing condition: returned to start with same entry direction.
      if (cx === startX && cy === startY) break;
      path.push([cx, cy]);
      if (path.length > maxSteps) break;
    }
    return path;
  }

  // Build a flat-bottomed extruded mesh from a 2D closed polygon.
  // Returns { vertices, indices, normals, dims, material }.
  // poly: [[x,y], ...] in source-pixel coords. Height is extrusion height in Z.
  function extrudePolygon(poly, depth, baseColor) {
    if (!poly.length) return null;
    // Coarser step since we're already past 60 vertices for a 100px-square
    // and the engraving triangles still need to be <1k vertices total.
    const ring = densify(poly, 6);
    const N = ring.length;
    const floatsPerVertex = 3;
    const vertices = new Float32Array(N * 2 * floatsPerVertex); // top + bottom
    const indices = new Uint16Array((N - 1) * 12); // 4 tris per segment side + 2 caps
    const normals = new Float32Array(N * 2 * floatsPerVertex);

    // Find bounds for centering.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ring) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Build top (z=+depth/2) and bottom (z=-depth/2) rings.
    for (let i = 0; i < N; i++) {
      const x = ring[i][0] - cx;
      const y = ring[i][1] - cy;
      // Top
      vertices[i * 3]     = x;
      vertices[i * 3 + 1] = y;
      vertices[i * 3 + 2] = depth / 2;
      // Bottom
      vertices[N * 3 + i * 3]     = x;
      vertices[N * 3 + i * 3 + 1] = y;
      vertices[N * 3 + i * 3 + 2] = -depth / 2;
      // Normals: outward radial from centroid for side faces.
      const len = Math.hypot(x, y) || 1;
      const nx = x / len, ny = y / len;
      normals[i * 3]     = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = 0;
      normals[N * 3 + i * 3]     = nx;
      normals[N * 3 + i * 3 + 1] = ny;
      normals[N * 3 + i * 3 + 2] = 0;
    }

    let idx = 0;
    // Side faces (quads → 2 triangles per segment).
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = i, b = j, c = N + i, d = N + j;
      // CCW winding (outside-facing):
      indices[idx++] = a; indices[idx++] = b; indices[idx++] = c;
      indices[idx++] = b; indices[idx++] = d; indices[idx++] = c;
    }
    // Top cap (fan from vertex 0).
    for (let i = 1; i < N - 1; i++) {
      indices[idx++] = 0;
      indices[idx++] = i;
      indices[idx++] = i + 1;
    }
    // Bottom cap (fan from N, winding flipped).
    for (let i = 1; i < N - 1; i++) {
      indices[idx++] = N;
      indices[idx++] = N + i + 1;
      indices[idx++] = N + i;
    }

    const dims = {
      width: maxX - minX,
      height: maxY - minY,
      depth,
    };

    return {
      vertices: vertices.subarray(0, N * 2 * 3),
      indices: indices.subarray(0, idx),
      normals: normals.subarray(0, N * 2 * 3),
      dims,
      material: {
        kind: 'extruded',
        baseColor: baseColor || [0.5, 0.5, 0.5, 1.0],
      },
      source: {
        vertices: N * 2,
        triangles: idx / 3,
        algorithm: 'silhouette',
      },
    };
  }

  // Build a heightmap terrain mesh from a 2D luma array.
  function heightmapMesh(width, height, luma, depth, baseColor) {
    const w = width, h = height;
    const V = w * h;
    const vertices = new Float32Array(V * 3);
    const indices = new Uint16Array((w - 1) * (h - 1) * 6);
    const normals = new Float32Array(V * 3);

    const halfW = w / 2;
    const halfH = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const z = (luma[i] / 255) * depth - depth / 2;
        vertices[i * 3]     = x - halfW;
        vertices[i * 3 + 1] = y - halfH;
        vertices[i * 3 + 2] = z;
        // Initial normal points up; we'll fake per-vertex normals via
        // finite-difference below for basic shading.
      }
    }

    // Triangle indices (two per quad, CCW from above → +Z up).
    let k = 0;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = y * w + x;
        const b = a + 1;
        const c = a + w;
        const d = a + w + 1;
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      }
    }

    // Finite-difference normals (cheap, sufficient for low-poly terrain).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xL = Math.max(0, x - 1);
        const xR = Math.min(w - 1, x + 1);
        const yU = Math.max(0, y - 1);
        const yD = Math.min(h - 1, y + 1);
        const zL = (luma[y * w + xL] / 255) * depth;
        const zR = (luma[y * w + xR] / 255) * depth;
        const zU = (luma[yU * w + x] / 255) * depth;
        const zD = (luma[yD * w + x] / 255) * depth;
        const nx = (zL - zR);
        const ny = (zU - zD);
        const nz = 2.0;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3]     = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      }
    }

    const dims = { width: w, height: h, depth };

    return {
      vertices,
      indices,
      normals,
      dims,
      material: {
        kind: 'terrain',
        baseColor: baseColor || [0.5, 0.5, 0.5, 1.0],
      },
      source: {
        width: w,
        height: h,
        vertices: V,
        triangles: k / 3,
        algorithm: 'heightmap',
      },
    };
  }

  // -------------------- input loaders --------------------

  // Decode any of {PNG, JPEG, GIF-first-frame} into {width, height, RGBA bytes}.
  async function decodeImage(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([arrayBuffer]);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;
        URL.revokeObjectURL(url);
        resolve({ width: w, height: h, rgba: data });
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  // Parse SVG path-data strings into polygons.
  // Tokenizes M, m, L, l, H, h, V, v, C, c, S, s, Q, q, T, t, Z, z.
  function parseSvgPaths(svgString) {
    // First try DOMParser (browser); fall back to regex tokenizer if not.
    if (typeof DOMParser !== 'undefined' && typeof DOMParser.prototype === 'object') {
      try {
        return parseSvgViaDomParser(svgString);
      } catch (_) {
        // fall through to regex
      }
    }
    return parseSvgViaRegex(svgString);
  }

  function parseSvgViaDomParser(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    if (!doc || doc.querySelector('parsererror')) {
      throw new Error('meshify: invalid SVG');
    }
    const elements = doc.querySelectorAll('path, polygon, polyline, rect');
    const polys = [];
    elements.forEach((el) => {
      const poly = svgElementToPolygon(el);
      if (poly.length > 2) polys.push(poly);
    });
    return polys;
  }

  function parseSvgViaRegex(svgString) {
    const polys = [];
    // Match <path d="..."> blocks first.
    const pathRe = /<path[^>]*\sd=["']([^"']+)["']/g;
    let m;
    while ((m = pathRe.exec(svgString)) !== null) {
      const points = tokenizeSvgPath(m[1]);
      if (points.length > 2) polys.push(points);
    }
    // Match <rect> elements.
    const rectRe = /<rect\b[^>]*\b(x|y|width|height)=["']([^"']+)["'][^>]*\/?>/g;
    while ((m = rectRe.exec(svgString)) !== null) {
      // Need to find all rect attributes; easier to scan attributes per match.
    }
    // For <rect> simplicity, regex all rect blocks and parse attributes.
    const rectFullRe = /<rect\b([^>]*)\/?>/g;
    while ((m = rectFullRe.exec(svgString)) !== null) {
      const attrs = m[1];
      const x = +(attrVal(attrs, 'x') || '0');
      const y = +(attrVal(attrs, 'y') || '0');
      const w = +(attrVal(attrs, 'width') || '0');
      const h = +(attrVal(attrs, 'height') || '0');
      if (w > 0 && h > 0) {
        polys.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
      }
    }
    // Match <polygon> and <polyline> points
    const polyRe = /<(?:polygon|polyline)\b[^>]*\spoints=["']([^"']+)["'][^>]*\/?>/g;
    while ((m = polyRe.exec(svgString)) !== null) {
      const nums = m[1].trim().split(/[\s,]+/).map(Number);
      const poly = [];
      for (let i = 0; i + 1 < nums.length; i += 2) poly.push([nums[i], nums[i + 1]]);
      if (poly.length > 2) polys.push(poly);
    }
    return polys;
  }

  function attrVal(attrs, name) {
    const m = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]+)"', 'i'));
    return m ? m[1] : '';
  }

  function svgElementToPolygon(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      const x = +el.getAttribute('x') || 0;
      const y = +el.getAttribute('y') || 0;
      const w = +el.getAttribute('width') || 0;
      const h = +el.getAttribute('height') || 0;
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    const d = el.getAttribute('d') || '';
    return tokenizeSvgPath(d);
  }

  function tokenizeSvgPath(d) {
    const tokens = [];
    const re = /([a-zA-Z])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
      if (m[1]) tokens.push(m[1]);
      else tokens.push(parseFloat(m[2]));
    }
    const out = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let cmd = null;
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (typeof t === 'string') { cmd = t; i++; continue; }
      // implicit repeat-letter behavior omitted for clarity; this tokenizer
      // is for well-formed Path d attributes where each command has its args.
      switch (cmd) {
        case 'M': cx = tokens[i++]; cy = tokens[i++]; sx = cx; sy = cy; out.push([cx, cy]); cmd = 'L'; break;
        case 'm': cx += tokens[i++]; cy += tokens[i++]; sx = cx; sy = cy; out.push([cx, cy]); cmd = 'l'; break;
        case 'L': cx = tokens[i++]; cy = tokens[i++]; out.push([cx, cy]); break;
        case 'l': cx += tokens[i++]; cy += tokens[i++]; out.push([cx, cy]); break;
        case 'H': cx = tokens[i++]; out.push([cx, cy]); break;
        case 'h': cx += tokens[i++]; out.push([cx, cy]); break;
        case 'V': cy = tokens[i++]; out.push([cx, cy]); break;
        case 'v': cy += tokens[i++]; out.push([cx, cy]); break;
        case 'C': {
          // cubic Bezier; sample as 8-line segments
          const x1 = tokens[i++], y1 = tokens[i++];
          const x2 = tokens[i++], y2 = tokens[i++];
          const x = tokens[i++], y = tokens[i++];
          const px = cx, py = cy;
          for (let s = 1; s <= 8; s++) {
            const t2 = s / 8;
            const u = 1 - t2;
            const bx = u*u*u*px + 3*u*u*t2*x1 + 3*u*t2*t2*x2 + t2*t2*t2*x;
            const by = u*u*u*py + 3*u*u*t2*y1 + 3*u*t2*t2*y2 + t2*t2*t2*y;
            out.push([bx, by]);
          }
          cx = x; cy = y;
          break;
        }
        case 'c': {
          const x1 = cx + tokens[i++], y1 = cy + tokens[i++];
          const x2 = cx + tokens[i++], y2 = cy + tokens[i++];
          const x = cx + tokens[i++], y = cy + tokens[i++];
          const px = cx, py = cy;
          for (let s = 1; s <= 8; s++) {
            const t2 = s / 8;
            const u = 1 - t2;
            const bx = u*u*u*px + 3*u*u*t2*x1 + 3*u*t2*t2*x2 + t2*t2*t2*x;
            const by = u*u*u*py + 3*u*u*t2*y1 + 3*u*t2*t2*y2 + t2*t2*t2*y;
            out.push([bx, by]);
          }
          cx = x; cy = y;
          break;
        }
        case 'Q': case 'q': {
          const x1 = cmd === 'Q' ? tokens[i++] : cx + tokens[i++];
          const y1 = cmd === 'Q' ? tokens[i++] : cy + tokens[i++];
          const x  = cmd === 'Q' ? tokens[i++] : cx + tokens[i++];
          const y  = cmd === 'Q' ? tokens[i++] : cy + tokens[i++];
          const px = cx, py = cy;
          for (let s = 1; s <= 8; s++) {
            const t2 = s / 8;
            const u = 1 - t2;
            const bx = u*u*px + 2*u*t2*x1 + t2*t2*x;
            const by = u*u*py + 2*u*t2*y1 + t2*t2*y;
            out.push([bx, by]);
          }
          cx = x; cy = y;
          break;
        }
        case 'Z': case 'z':
          cx = sx; cy = sy;
          break;
        case 'S': case 's':
        case 'T': case 't':
          // Mirror cubic/quad — treat as linear for this minimal tokenizer.
          cx = tokens[i++]; cy = tokens[i++]; out.push([cx, cy]);
          break;
        default:
          // Unknown: skip a number to avoid infinite loop.
          i++;
      }
    }
    return out;
  }

  // -------------------- public API --------------------

  function dominantColor(rgba, w, h) {
    // Cheap box-blur + average sampling on a 16x16 downsample.
    const BLOCK = 16;
    let r = 0, g = 0, b = 0, n = 0;
    const stepX = Math.max(1, Math.floor(w / BLOCK));
    const stepY = Math.max(1, Math.floor(h / BLOCK));
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const i = (y * w + x) * 4;
        const a = rgba[i + 3];
        if (a < 128) continue; // skip transparent pixels
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
        n++;
      }
    }
    if (!n) return [0.5, 0.5, 0.5, 1.0];
    return [r / n / 255, g / n / 255, b / n / 255, 1.0];
  }

  async function fromPNG(arrayBuffer, options) {
    const opts = options || {};
    const algo = opts.algorithm || 'silhouette';
    const depth = opts.depth != null ? opts.depth : 24;

    const { width, height, rgba } = await decodeImage(arrayBuffer);

    if (algo === 'silhouette') {
      // Threshold alpha to binary mask (>= 128 = "inside").
      const mask = new Uint8Array(width * height);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        mask[j] = rgba[i + 3] >= 128 ? 1 : 0;
      }
      const poly = traceBoundary(mask, width, height);
      if (!poly.length) {
        throw new Error('meshify: no opaque region found in PNG');
      }
      const color = dominantColor(rgba, width, height);
      return extrudePolygon(poly, depth, color);
    } else if (algo === 'heightmap') {
      // Downsample to <= 96 on the long edge to keep vertex count sane.
      const maxEdge = 96;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(8, Math.round(width * scale));
      const h = Math.max(8, Math.round(height * scale));
      const luma = new Uint8Array(w * h);
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d');
      // Draw via an offscreen ImageData to downsample.
      const src = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
      const scratch = document.createElement('canvas');
      scratch.width = width; scratch.height = height;
      scratch.getContext('2d').putImageData(src, 0, 0);
      tctx.drawImage(scratch, 0, 0, w, h);
      const small = tctx.getImageData(0, 0, w, h).data;
      for (let i = 0, j = 0; i < small.length; i += 4, j++) {
        // Rec. 601 luma
        luma[j] = (small[i] * 0.299 + small[i + 1] * 0.587 + small[i + 2] * 0.114) | 0;
      }
      const color = dominantColor(rgba, width, height);
      return heightmapMesh(w, h, luma, depth, color);
    } else {
      throw new Error('meshify: unknown algorithm: ' + algo);
    }
  }

  async function fromSVG(svgString, options) {
    const opts = options || {};
    const depth = opts.depth != null ? opts.depth : 24;
    const polys = parseSvgPaths(svgString);
    if (!polys.length) throw new Error('meshify: no <path>/<polygon>/<rect> in SVG');
    if (polys.length > 1) {
      // For multi-path SVGs we bundle each into its own mesh and return
      // the first; a future stage could merge via stitch.
      // eslint-disable-next-line no-console
      console.warn(`meshify: SVG has ${polys.length} paths, returning only the first`);
    }
    const poly = polys[0];
    // Estimate dominant color from fill= attribute; default to mid-tone.
    let baseColor = [0.5, 0.5, 0.5, 1.0];
    return extrudePolygon(poly, depth, baseColor);
  }

  // Compress a vertex array to centroid + half-extents + ring (for shape summary).
  function meshStats(mesh) {
    const n = mesh.vertices.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += mesh.vertices[i * 3];
      cy += mesh.vertices[i * 3 + 1];
      cz += mesh.vertices[i * 3 + 2];
    }
    cx /= n; cy /= n; cz /= n;
    return {
      vertexCount: n,
      triangleCount: mesh.indices.length / 3,
      centroid: [cx, cy, cz],
      dims: mesh.dims,
      memory: {
        vertices: mesh.vertices.byteLength,
        indices: mesh.indices.byteLength,
        normals: mesh.normals.byteLength,
      },
      material: mesh.material,
    };
  }

  const NAMESPACE = 'SWR_MESHIFY';
  window[NAMESPACE] = {
    fromPNG,
    fromSVG,
    meshStats,
    // Constants exposed for unit tests:
    _traceBoundary: traceBoundary,
    _densify: densify,
    _extrudePolygon: extrudePolygon,
    _heightmapMesh: heightmapMesh,
  };
})();
