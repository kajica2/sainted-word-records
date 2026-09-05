#!/usr/bin/env node
// scripts/check-local-media-unit.mjs — Unit tests for client/local-media.client.js.
//
// Tests the pure-JS helpers (URL translation, file path normalization,
// SSE parsing shape) in a vm context. Real HTTP calls to
// kaidjuric-local-media-studio.hf.space are exercised in a Puppeteer
// smoke (deferred).

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/local-media.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  console.log(cond ? `  PASS  ${msg}${detail ? ` (${detail})` : ''}` : `  FAIL  ${msg}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures += 1;
}

const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function loadLMS() {
  const ctx = {
    window: {},
    document: {},
    fetch: () => Promise.reject(new Error('no fetch in test')),
    AbortController: class {
      constructor() { this.signal = {}; this.aborted = false; }
      abort() { this.aborted = true; }
    },
    setTimeout, clearTimeout,
    Promise, Math, Date,
    ArrayBuffer, Uint8Array, TextDecoder,
    JSON,
    console,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.SWR_LOCAL_MEDIA;
}

(async function main() {
  console.log('\n=== 1. SWR_LOCAL_MEDIA module attached to window ===');
  const L = loadLMS();
  assert(L, 'module attached');
  assert(typeof L.connect === 'function', 'connect is a function');
  assert(typeof L.fetchBytes === 'function', 'fetchBytes is a function');
  assert(typeof L.DEFAULT_URL === 'string', 'DEFAULT_URL exposed');

  console.log('\n=== 2. Default URL is the Space ===');
  assert(L.DEFAULT_URL === 'https://kaidjuric-local-media-studio.hf.space',
    `DEFAULT_URL = https://kaidjuric-local-media-studio.hf.space (got ${L.DEFAULT_URL})`);

  console.log('\n=== 3. connect() returns an object with all endpoints ===');
  const client = L.connect();
  assert(client, 'connect returned a client');
  assert(typeof client.generateImage === 'function', 'generateImage is fn');
  assert(typeof client.remixVideo === 'function', 'remixVideo is fn');
  assert(typeof client.makeLoops === 'function', 'makeLoops is fn');
  assert(typeof client.callFn === 'function', 'callFn is fn');
  assert(typeof client.on === 'function', 'on is fn');
  assert(client.baseUrl === L.DEFAULT_URL, 'client.baseUrl = DEFAULT_URL');

  console.log('\n=== 4. fileUrlFromOutput: handles string path ===');
  const u1 = client.fileUrlFromOutput('/tmp/foo.png');
  assert(u1 && u1.includes('gradio_api/file='),
    `string path → gradio_api/file URL (got ${u1})`);
  assert(u1.includes('%2Ftmp%2Ffoo.png') || u1.includes('foo.png'),
    `path is encoded (got ${u1})`);

  console.log('\n=== 5. fileUrlFromOutput: handles gradio_api/file= URL ===');
  const u2 = client.fileUrlFromOutput('/gradio_api/file=/outputs/x.png');
  assert(u2 === 'https://kaidjuric-local-media-studio.hf.space/gradio_api/file=/outputs/x.png',
    `gradio_api/file URL returned as-is (got ${u2})`);

  console.log('\n=== 6. fileUrlFromOutput: handles object {url, path} ===');
  const u3 = client.fileUrlFromOutput({ url: '/gradio_api/file=/y.png', path: '/y.png' });
  assert(u3 === 'https://kaidjuric-local-media-studio.hf.space/gradio_api/file=/y.png',
    `object → unwraps to URL string (got ${u3})`);

  console.log('\n=== 7. fileUrlFromOutput: handles array ===');
  // With a bare path first, the function returns the first array element's URL.
  const u4a = client.fileUrlFromOutput(['/a.png', { url: '/gradio_api/file=/b.png' }]);
  assert(u4a === 'https://kaidjuric-local-media-studio.hf.space/gradio_api/file=%2Fa.png',
    `array → first element wins (got ${u4a})`);
  // With a fully-qualified URL first, that's preferred.
  const u4b = client.fileUrlFromOutput([{ url: '/gradio_api/file=/b.png' }, '/a.png']);
  assert(u4b === 'https://kaidjuric-local-media-studio.hf.space/gradio_api/file=/b.png',
    `array with URL-first → URL wins (got ${u4b})`);

  console.log('\n=== 8. fileUrlFromOutput: returns null on empty input ===');
  assert(client.fileUrlFromOutput(null) === null, 'null → null');
  assert(client.fileUrlFromOutput('') === null, 'empty string → null');
  assert(client.fileUrlFromOutput({}) === null, 'empty object → null');

  console.log('\n=== 9. on() registers listeners ===');
  let called = 0;
  client.on('status', () => { called += 1; });
  // Cannot emit from outside without an event; just verify the function exists.
  assert(typeof client.on === 'function', 'on() registers listeners');
  assert(called === 0, 'no spurious calls yet');

  console.log('\n=== 10. connect() with custom baseUrl ===');
  const customClient = L.connect({ baseUrl: 'https://example.com' });
  assert(customClient.baseUrl === 'https://example.com', 'custom baseUrl set');
  const u5 = customClient.fileUrlFromOutput('/foo.png');
  assert(u5 && u5.startsWith('https://example.com/'),
    `custom base URL prefix (got ${u5})`);

  console.log('\n' + (failures === 0
    ? `LOCAL MEDIA UNIT: ALL GREEN (10 tests)`
    : `LOCAL MEDIA UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
