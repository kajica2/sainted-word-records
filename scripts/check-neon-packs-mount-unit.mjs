#!/usr/bin/env node
// scripts/check-neon-packs-mount-unit.mjs
//
// Neon loads client/library-packs.client.js but used to ship without a
// #packs mount. init() then returned immediately, so Dance Clips and the
// other curated packs never appeared in the Media panel and the page
// looked like it "wasn't loading videos". This gate pins the mount + CSS
// on both neon surfaces (versions/ and the synced root copy).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES = ['versions/neon.html', 'neon.html'];

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed += 1;
}

for (const rel of PAGES) {
  const html = readFileSync(join(ROOT, rel), 'utf8');
  check(`${rel} loads library-packs`, /library-packs\.client\.js/.test(html));
  check(`${rel} mounts #packs`, /id=["']packs["']/.test(html));
  check(`${rel} styles .pack-btn`, /\.pack-btn\s*\{/.test(html));
  check(`${rel} styles .packs-empty`, /\.packs-empty\s*\{/.test(html));
  // Phone layout: packs must be allowed to shrink/scroll so .body stays
  // reachable inside the clipped 30vh Media panel.
  check(
    `${rel} packs can shrink`,
    /aside\.lib\s*>\s*\.packs\s*\{[^}]*flex:\s*0\s+1\s+auto/s.test(html)
      && /aside\.lib\s*>\s*\.packs\s*\{[^}]*overflow-y:\s*auto/s.test(html),
  );
  check(
    `${rel} media body keeps a floor`,
    /aside\.lib\s*>\s*\.body\s*\{[^}]*min-height:\s*4\.5rem/s.test(html),
  );
}

// Contract: with a #packs host present, init paints a Dance Clips button.
const SRC = readFileSync(join(ROOT, 'client/library-packs.client.js'), 'utf8');
const children = [];
const packsEl = {
  id: 'packs',
  innerHTML: '',
  appendChild(el) { children.push(el); this.innerHTML += el.outerHTML || ''; return el; },
};
const libEl = {
  id: 'lib',
  children: [],
  prepend(el) { this.children.unshift(el); },
};
function el(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    style: {},
    disabled: false,
    title: '',
    type: '',
    innerHTML: '',
    children: [],
    textContent: '',
    appendChild(c) { this.children.push(c); this.innerHTML += c.outerHTML || c.textContent || ''; return c; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
  };
  const tokens = new Set();
  node.classList = {
    add(...xs) { for (const x of xs) { tokens.add(x); node.className = [...tokens].join(' '); } },
    remove(...xs) { for (const x of xs) tokens.delete(x); node.className = [...tokens].join(' '); },
    contains(x) { return tokens.has(x); },
    toggle(x, force) {
      if (force === true || (force !== false && !tokens.has(x))) this.add(x);
      else this.remove(x);
      return tokens.has(x);
    },
  };
  Object.defineProperty(node, 'outerHTML', {
    get() {
      return `<${tag} class="${this.className}">${this.innerHTML}</${tag}>`;
    },
  });
  return node;
}
const doc = {
  readyState: 'complete',
  getElementById(id) {
    if (id === 'packs') return packsEl;
    if (id === 'lib') return libEl;
    if (id === 'packs-empty') return libEl.children.find((c) => c.id === 'packs-empty') || null;
    return null;
  },
  createElement: el,
  addEventListener() {},
};
const box = {
  window: null,
  document: doc,
  console,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  setTimeout,
  clearTimeout,
  Map,
  Number,
  String,
  Array,
  Object,
  Error,
  Promise,
  URL,
  File: class File {},
  Blob: class Blob {},
};
box.window = box;
createContext(box);
runInContext(SRC, box);

const api = box.SWR_LIBRARY_PACKS;
check('SWR_LIBRARY_PACKS published', !!(api && typeof api.init === 'function'));
check('toolbar painted into #packs', /packs-grid|pack-btn/.test(packsEl.innerHTML) || children.length > 0, packsEl.innerHTML.slice(0, 120));
const dancer = (api.PACKS || []).some((p) => p.id === 'dancer-video');
check('Dance Clips pack is listed', dancer);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nok');
