#!/usr/bin/env node
// scripts/check-meshify-unit.mjs — Unit tests for client/meshify.client.js.
//
// Tests the three algorithms (silhouette, heightmap, svg-path) for
// plausibility: triangle count, normal finiteness, mesh shape, no NaNs.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/meshify.client.js');

let failures = 0;
function assert(cond, msg) {
  console.log(cond ? `  PASS  ${msg}` : `  FAIL  ${msg}`);
  if (!cond) failures += 1;
}

const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function loadMeshify() {
  // Strip the `if (typeof window === 'undefined') return;` guard so the IIFE
  // attaches SWR_MESHIFY even under Node, then bind the functions to a
  // sandbox ctx so we can poke at them.
  let patched = SRC.replace(
    /if \(typeof window === 'undefined'\) \{[\s\S]*?\n\s*\}\n/,
    ''
  );
  // The IIFE may have been replaced; if the SWR_MESHIFY namespace is still
  // not on a global, fall back to providing our own. We need to inject a
  // window/document shim — but since this is pure geometry (no DOM calls),
  // an empty context is enough.

  const ctx = {
    window: {},
    document: {},
    Uint8ClampedArray,
    ArrayBuffer,
    Uint8Array,
    Float32Array,
    Uint16Array,
    Image: function () {},
    ImageData: function () {},
    Blob: class Blob {
      constructor(parts) { this._parts = parts; }
    },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    DOMParser: class {},
    Promise,
    Math,
    console,
  };
  ctx.window.window = ctx.window;
  // eslint-disable-next-line no-undef
  vm.createContext(ctx);
  // eslint-disable-next-line no-undef
  vm.runInContext(patched, ctx);
  return ctx.window.SWR_MESHIFY;
}

function expectFinite(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

function expectBoxBounded(arr, dim) {
  // Heuristic: every coordinate must be within [-dim, dim].
  for (let i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i]) > dim * 2) return false;
  }
  return true;
}

(async function main() {
  console.log('\n=== 1. SVG path → extrudePolygon ===');
  const M = loadMeshify();

  // Build a simple square SVG and parse it directly.
  const squareSVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/>' +
    '</svg>';
  const squareMesh = await M.fromSVG(squareSVG, { depth: 24 });

  assert(squareMesh, 'square svg mesh built');
  assert(squareMesh.source.triangles > 0, `square has triangles (got ${squareMesh.source.triangles})`);
  assert(squareMesh.vertices.length % 3 === 0, `vertex count multiple of 3 (got ${squareMesh.vertices.length})`);
  assert(squareMesh.indices.length % 3 === 0, `index count multiple of 3 (got ${squareMesh.indices.length})`);
  assert(expectFinite(squareMesh.vertices), 'square vertices all finite');
  assert(expectFinite(squareMesh.normals), 'square normals all finite');
  assert(expectBoxBounded(squareMesh.vertices, 200), 'square vertices within ±200 of center');
  assert(squareMesh.dims.depth === 24, `depth=24 (got ${squareMesh.dims.depth})`);
  assert(squareMesh.material.kind === 'extruded', `material.kind=extruded (got ${squareMesh.material.kind})`);

  console.log('\n=== 2. Triangle (no Z extrude) ===');
  const triSVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<path d="M 50 10 L 90 90 L 10 90 Z"/>' +
    '</svg>';
  const triMesh = await M.fromSVG(triSVG, { depth: 12 });
  assert(triMesh, 'triangle mesh built');
  assert(triMesh.source.triangles > 0, 'triangle has triangles');

  console.log('\n=== 3. Rectangle (rect element) ===');
  const rectSVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect x="20" y="20" width="60" height="60"/>' +
    '</svg>';
  const rectMesh = await M.fromSVG(rectSVG, { depth: 8 });
  assert(rectMesh, 'rect svg mesh built');
  assert(rectMesh.source.triangles > 4, `rect has >4 triangles (got ${rectMesh.source.triangles})`);

  console.log('\n=== 4. _extrudePolygon: pentagon with custom color ===');
  const pentagon = [
    [40, 0], [80, 30], [65, 75], [15, 75], [0, 30],
  ];
  const pentMesh = M._extrudePolygon(pentagon, 16, [0.8, 0.2, 0.4, 1.0]);
  assert(pentMesh, 'pentagon mesh built');
  assert(pentMesh.vertices.length === pentMesh.normals.length,
    `vertices and normals match (got ${pentMesh.vertices.length} vs ${pentMesh.normals.length})`);
  assert(pentMesh.indices.length % 3 === 0, 'indices multiple of 3');
  assert(expectFinite(pentMesh.vertices), 'pentagon vertices all finite');
  assert(expectFinite(pentMesh.normals), 'pentagon normals all finite');
  assert(pentMesh.material.baseColor[0] === 0.8, 'pentagon carries color hint');

  console.log('\n=== 5. _heightmapMesh: 4x4 all-white → flat plane ===');
  const w5 = 4, h5 = 4;
  const flat5 = new Uint8Array(w5 * h5).fill(255);
  const flatMesh = M._heightmapMesh(w5, h5, flat5, 20, [0.4, 0.4, 0.4, 1.0]);
  assert(flatMesh, 'flat heightmap mesh built');
  // 4x4 grid: 16 vertices, (4-1)*(4-1)*6 = 54 indices
  assert(flatMesh.vertices.length === 16 * 3,
    `4x4 vertex count = ${flatMesh.vertices.length / 3} (expected 16)`);
  assert(flatMesh.indices.length === 54, `flat mesh has 54 indices (got ${flatMesh.indices.length})`);
  assert(expectFinite(flatMesh.normals), 'flat normals all finite');

  console.log('\n=== 6. _heightmapMesh: 8x8 ramp → varied Z ===');
  const w6 = 8, h6 = 8;
  const ramp = new Uint8Array(w6 * h6);
  for (let y = 0; y < h6; y++) {
    for (let x = 0; x < w6; x++) {
      ramp[y * w6 + x] = (x / (w6 - 1)) * 255;
    }
  }
  const rampMesh = M._heightmapMesh(w6, h6, ramp, 30, [0.5, 0.5, 0.5, 1.0]);
  // Find min/max Z
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 2; i < rampMesh.vertices.length; i += 3) {
    if (rampMesh.vertices[i] < minZ) minZ = rampMesh.vertices[i];
    if (rampMesh.vertices[i] > maxZ) maxZ = rampMesh.vertices[i];
  }
  assert(maxZ > minZ + 5, `ramp has Z variance (minZ=${minZ.toFixed(2)}, maxZ=${maxZ.toFixed(2)})`);

  console.log('\n=== 7. meshStats summary shape ===');
  const stats = M.meshStats(rectMesh);
  assert(stats.vertexCount > 0, 'stats has vertexCount');
  assert(stats.triangleCount > 0, 'stats has triangleCount');
  assert(stats.memory.vertices > 0, 'stats reports vertex bytes');
  assert(stats.dims.depth === 8, 'stats carries dims.depth');
  assert(stats.material.kind === 'extruded', 'stats carries material.kind');

  console.log('\n=== 8. Empty polygon returns null ===');
  const emptyMesh = M._extrudePolygon([], 10);
  assert(emptyMesh === null, 'empty polygon → null');

  console.log('\n' + (failures === 0
    ? `MESHIFY UNIT: ALL GREEN (8 tests)`
    : `MESHIFY UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
