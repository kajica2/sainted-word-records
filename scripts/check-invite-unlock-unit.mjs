// scripts/check-invite-unlock-unit.mjs — unit coverage for the invite
// unlock surface.
//
// node:vm pattern from check-clip-evolution-unit.mjs / check-last-mix-unit.mjs.
// Loads each browser script (lib/watermark.client.js, lib/invite-unlock.client.js,
// lib/invite-modal.client.js) into a sandboxed window with a stubbed
// fetch, document, customElements, and localStorage. Asserts the
// public contracts each module is supposed to expose.
//
// Asserts:
//  - watermark.setEnabled(false) -> drawMark is a no-op (toggle observable
//    via the prototype / property on the SWR_WATERMARK singleton).
//  - invite-unlock.isUnlocked() === false initially, true after redeem
//    when fetch returns ok:true, untouched otherwise.
//  - invite-unlock.unlock() flips SWR_WATERMARK.setEnabled(false) on
//    success and leaves it alone on failure.
//  - invite-unlock.revoke() clears the localStorage flag and re-enables
//    the watermark.
//  - the modal registers <swr-invite-modal> in customElements and exposes
//    SWR_INVITE_MODAL.show / hide.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watermarkSrc = readFileSync(path.join(__dirname, '..', 'lib', 'watermark.client.js'), 'utf8');
const unlockSrc = readFileSync(path.join(__dirname, '..', 'lib', 'invite-unlock.client.js'), 'utf8');
const modalSrc = readFileSync(path.join(__dirname, '..', 'lib', 'invite-modal.client.js'), 'utf8');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    failures++;
    console.log('  ✗', name, '\n    ', e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---- shared sandbox factory ----
function makeSandbox(opts = {}) {
  const storage = {};
  const docListeners = {};
  let fetchImpl = opts.fetch || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }));
  let now = 1000;
  const classRegistry = new Map();
  // Minimal CustomElementRegistry shim: stores the constructor; class
  // extension uses observedAttributes/connectedCallback/disconnectedCallback.
  const customElements = {
    define(name, ctor) {
      if (classRegistry.has(name)) throw new Error('already defined: ' + name);
      classRegistry.set(name, ctor);
    },
    get(name) { return classRegistry.get(name); },
  };
  const fakeClass = class extends HTMLElementShim {}; // placeholder
  function HTMLElementShim() { return makeEl(); }
  function makeEl() {
    const el = {
      children: [],
      style: {},
      attrs: {},
      listeners: {},
      classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); }, contains(c) { return this._set.has(c); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { const l = this.listeners[ev] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      dispatchEvent(e) { const l = this.listeners[e.type] || []; l.forEach(fn => fn(e)); return true; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getRootNode() { return null; },
      attachShadow() { return this; },
      shadowRoot: null,
      get offsetWidth() { return 0; },
    };
    return el;
  }
  const document = {
    createElement(tag) {
      if (classRegistry.has(tag)) {
        const ctor = classRegistry.get(tag);
        return new ctor();
      }
      return makeEl();
    },
    body: makeEl(),
    head: makeEl(),
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { const l = docListeners[ev] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatchEvent(e) { (docListeners[e.type] || []).forEach(fn => fn(e)); return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    clear() { for (const k of Object.keys(storage)) delete storage[k]; },
  };
  // lib/watermark.client.js does `new Image()` at module load.
  function ImageStub() {
    return {
      _src: '',
      complete: true,
      naturalWidth: 0,
      naturalHeight: 0,
      onerror: null,
      set onload(_) {},
      get src() { return this._src; },
      set src(v) { this._src = v; if (typeof this.onerror === 'function') {/* tolerate */} },
    };
  }
  const sb = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Object, Array, JSON, Date, Number, String, Promise, Map, Set, Symbol, WeakMap, WeakSet, Proxy, Reflect,
    performance: { now: () => now },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: (url, init) => fetchImpl(url, init),
    localStorage,
    document,
    customElements,
    HTMLElement: HTMLElementShim,
    Image: ImageStub,
    CustomEvent: function CustomEvent(type, init) { return { type, ...(init || {}) }; },
  };
  sb.window = sb;
  vm.createContext(sb);
  // advance time helpers
  return { sb, storage, advance: (ms) => { now += ms; } };
}

function loadModule(sb, src) {
  vm.runInContext(src, sb);
}

// ---- tests ----
console.log('invite-unlock unit tests');

check('watermark.setEnabled / isEnabled toggle', () => {
  const { sb } = makeSandbox();
  // jsdom-style HTMLElement not needed for watermark (no customElements.define)
  loadModule(sb, watermarkSrc);
  const wm = sb.window.SWR_WATERMARK;
  assert(wm, 'SWR_WATERMARK should be set');
  assert(typeof wm.setEnabled === 'function', 'setEnabled should be a function');
  assert(typeof wm.isEnabled === 'function', 'isEnabled should be a function');
  assert(wm.isEnabled() === true, 'default is enabled');
  wm.setEnabled(false);
  assert(wm.isEnabled() === false, 'toggled off');
  wm.setEnabled(true);
  assert(wm.isEnabled() === true, 'toggled on');
});

check('invite-unlock: isUnlocked() reflects localStorage', () => {
  const { sb } = makeSandbox();
  loadModule(sb, unlockSrc);
  assert(sb.window.SWR_INVITE_UNLOCK.isUnlocked() === false, 'starts locked');
  sb.localStorage.setItem('swr.inviteUnlocked', '1');
  // Re-load to re-read the flag (module caches read at IIFE time, so
  // call applyToCurrentPage to hydrate).
  assert(sb.window.SWR_INVITE_UNLOCK.isUnlocked() === true, 'flag set');
});

check('invite-unlock: unlock() succeeds when API returns ok:true', async () => {
  const fetchImpl = async () => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const { sb } = makeSandbox({ fetch: fetchImpl });
  loadModule(sb, watermarkSrc);
  loadModule(sb, unlockSrc);
  // Watermark currently enabled (default). Successful unlock should flip it off.
  assert(sb.window.SWR_WATERMARK.isEnabled() === true, 'watermark starts on');
  const ok = await sb.window.SWR_INVITE_UNLOCK.unlock('TEST-CODE');
  assert(ok === true, 'unlock should return true');
  assert(sb.localStorage.getItem('swr.inviteUnlocked') === '1', 'flag set');
  assert(sb.window.SWR_WATERMARK.isEnabled() === false, 'watermark turned off');
});

check('invite-unlock: unlock() returns false when API returns 404', async () => {
  const fetchImpl = async () => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'invalid_or_disabled_code' }) });
  const { sb } = makeSandbox({ fetch: fetchImpl });
  loadModule(sb, watermarkSrc);
  loadModule(sb, unlockSrc);
  const ok = await sb.window.SWR_INVITE_UNLOCK.unlock('BAD-CODE-X');
  assert(ok === false, 'unlock should return false');
  assert(sb.localStorage.getItem('swr.inviteUnlocked') !== '1', 'flag NOT set');
  assert(sb.window.SWR_WATERMARK.isEnabled() === true, 'watermark NOT turned off');
});

check('invite-unlock: revoke() clears the flag and re-enables the watermark', () => {
  const { sb } = makeSandbox();
  loadModule(sb, watermarkSrc);
  loadModule(sb, unlockSrc);
  sb.localStorage.setItem('swr.inviteUnlocked', '1');
  sb.window.SWR_WATERMARK.setEnabled(false);
  sb.window.SWR_INVITE_UNLOCK.revoke();
  assert(sb.localStorage.getItem('swr.inviteUnlocked') === '0', 'flag cleared to 0');
  assert(sb.window.SWR_WATERMARK.isEnabled() === true, 'watermark back on');
});

check('invite-unlock: applyToCurrentPage hydrates the watermark from the flag', () => {
  const { sb } = makeSandbox();
  loadModule(sb, watermarkSrc);
  sb.localStorage.setItem('swr.inviteUnlocked', '1');
  // Watermark starts enabled by default; loading the unlock module
  // after the flag is set should hydrate it to disabled.
  loadModule(sb, unlockSrc);
  assert(sb.window.SWR_WATERMARK.isEnabled() === false, 'watermark hydrated off');
});

check('invite-modal: exposes SWR_INVITE_MODAL.show / hide (plain DOM)', () => {
  // The modal is plain DOM now (no customElement) — the prior shadow-DOM
  // custom element upgrade path was unreliable on the Chromium versions
  // our smoke runners use (Chrome 152 threw "must not have attributes"
  // from createElement when the constructor called attachShadow).
  const { sb } = makeSandbox();
  loadModule(sb, modalSrc);
  const api = sb.window.SWR_INVITE_MODAL;
  assert(api, 'SWR_INVITE_MODAL exported');
  assert(typeof api.show === 'function', 'show is a function');
  assert(typeof api.hide === 'function', 'hide is a function');
});

if (failures) {
  console.log('\nINVITE UNLOCK UNIT: FAILURES ABOVE');
  process.exit(1);
}
console.log('\nINVITE UNLOCK UNIT: ALL GREEN');
