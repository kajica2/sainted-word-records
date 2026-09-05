#!/usr/bin/env node
// scripts/check-mesh-toggle-unit.mjs — Unit tests for client/mesh-toggle.client.js.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/mesh-toggle.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  console.log(cond ? `  PASS  ${msg}${detail ? ` (${detail})` : ''}` : `  FAIL  ${msg}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures += 1;
}

const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function makeCtx(extraWindowProps) {
  const ctx = {
    window: Object.assign({}, extraWindowProps || {}),
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({
        style: {}, hidden: false,
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        addEventListener: () => {},
        appendChild: () => {},
        insertBefore: () => {},
        parentNode: { insertBefore: () => {}, appendChild: () => {} },
      }),
      querySelector: () => null,
      body: { contains: () => false },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console, Promise, Math, Date,
    ArrayBuffer, Uint8Array, Uint16Array, Float32Array,
  };
  ctx.window.window = ctx.window;
  ctx.window.document = ctx.document;
  ctx.window.localStorage = ctx.localStorage;
  ctx.window.location = { origin: 'http://localhost' };
  return ctx;
}

function loadToggleIn(ctx) {
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.SWR_MESH_TOGGLE;
}

(async function main() {
  console.log('\n=== 1. Module attaches SWR_MESH_TOGGLE ===');
  const T = loadToggleIn(makeCtx());
  assert(T, 'SWR_MESH_TOGGLE attached to window');
  assert(typeof T.pickFirstReasonableAsset === 'function', 'pickFirstReasonableAsset is fn');
  assert(typeof T.loadAssetBytes === 'function', 'loadAssetBytes is fn');
  assert(typeof T.enable3D === 'function', 'enable3D is fn');
  assert(typeof T.disable3D === 'function', 'disable3D is fn');
  assert(typeof T.meshToggleState === 'function', 'meshToggleState is fn');

  console.log('\n=== 2. pickFirstReasonableAsset prefers gift-bags / transparent-pngs ===');
  const fakeItems = [
    { name: 'cam-shot.png' },
    { name: 'gift_bag.png', folder: 'gift-bags' },
    { name: 'clean-icon.png', folder: 'transparent-pngs' },
  ];
  const ctx2 = makeCtx();
  ctx2.window.SWR = { Library: { items: fakeItems } };
  const T2 = loadToggleIn(ctx2);
  const picked = T2.pickFirstReasonableAsset();
  assert(picked && picked.folder === 'gift-bags',
    `picked gift-bags first (got ${picked && picked.folder})`);

  console.log('\n=== 3. pickFirstReasonableAsset: empty library → null ===');
  const ctx3 = makeCtx();
  ctx3.window.SWR = { Library: { items: [] } };
  const T3 = loadToggleIn(ctx3);
  assert(T3.pickFirstReasonableAsset() === null, 'empty library → null');

  console.log('\n=== 4. Default meshToggleState is OFF ===');
  assert(T.meshToggleState() === false, 'toggle starts off');

  console.log('\n' + (failures === 0
    ? `MESH TOGGLE UNIT: ALL GREEN (4 tests)`
    : `MESH TOGGLE UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
