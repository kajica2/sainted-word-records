#!/usr/bin/env node
// scripts/check-media-kind-unit.mjs
//
// A movie whose File.type is empty (the Linux / .mov / .mkv case) used to
// be skipped by Library.addFiles and by SWR_MEDIA.addMedia, so it never
// reached the mix. The classifier must accept it, and the library import
// must record it as a video. A text file stays out.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KIND = readFileSync(join(ROOT, 'lib/media-kind.client.js'), 'utf8');
const LIB = readFileSync(join(ROOT, 'lib/library.client.js'), 'utf8');

function file(name, type) {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (!ok) failed += 1;
}

const kindBox = { window: {}, console };
kindBox.window = kindBox;
createContext(kindBox);
runInContext(KIND, kindBox);
const K = kindBox.SWR_MEDIA_KIND;

check('empty-type .mov is a movie', K.kind(file('beach day.mov', '')) === 'video', K.mimeFor(file('beach day.mov', '')));
check('octet-stream .mkv is a movie', K.kind(file('clip.mkv', 'application/octet-stream')) === 'video');
check('octet-stream .avi is a movie', K.mimeFor(file('reel.AVI', 'application/octet-stream')) === 'video/x-msvideo');
check('real video mime wins', K.mimeFor(file('clip.mov', 'video/mp4')) === 'video/mp4');
check('png stays an image', K.kind(file('still.png', 'image/png')) === 'image');
check('empty-type .webp is an image', K.kind(file('frame.webp', '')) === 'image');
check('text file is not media', K.kind(file('notes.txt', '')) === '');
check('pdf is not media', K.kind(file('notes.pdf', 'application/pdf')) === '');

function node(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    dataset: {},
    style: {},
    innerHTML: '',
    children: [],
    width: 0,
    height: 0,
    hidden: false,
    readyState: 0,
    classList: { remove() {}, add() {}, contains() { return false; } },
    textContent: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {},
    // Classify waits 8s for a real decoder. Fail the load immediately so
    // the import assertion is not stuck behind that timer.
    addEventListener(type, fn) { if (type === 'error' && typeof fn === 'function') fn(); },
    removeAttribute() {},
    getContext() {
      return {
        save() {}, restore() {}, clearRect() {}, drawImage() {},
        translate() {}, rotate() {},
        getImageData() { return { data: new Uint8ClampedArray(16) }; },
      };
    },
  };
}

const sandbox = {
  console: { warn() {}, error() {}, log() {}, info() {} },
  setTimeout,
  clearTimeout,
  URL,
  File,
  Blob,
  document: {
    getElementById() { return node('div'); },
    createElement(tag) { return node(tag); },
    createDocumentFragment() { return node('fragment'); },
    createTextNode() { return {}; },
  },
  indexedDB: { open() { throw new Error('no db in this test'); } },
  Image: function Image() { return node('img'); },
  TextDecoder,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
createContext(sandbox);
runInContext(KIND, sandbox);
runInContext(LIB, sandbox);

const state = await sandbox.Library.addFiles([
  file('beach.mov', ''),
  file('tape.mkv', 'application/octet-stream'),
  file('notes.txt', ''),
  file('still.png', 'image/png'),
]);
const types = sandbox.Library.items.map((it) => it.name + ':' + it.type);

check('library keeps the .mov', types.includes('beach.mov:video'), types.join(', '));
check('library keeps the .mkv', types.includes('tape.mkv:video'));
check('library keeps the png', types.includes('still.png:image'));
check('library drops the text file', !types.some((t) => t.startsWith('notes.txt')));
check('import count is the three media files', state.imported === 3, 'imported=' + state.imported);

await new Promise((r) => setTimeout(r, 30));
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('media-kind unit ok');
