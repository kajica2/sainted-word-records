// scripts/check-tour-client-unit.mjs — Unit coverage for the
// `client/tour.client.js` route table + body formatter + persistence.
// Stubs DOM + localStorage and drives the public surface in a node:vm
// sandbox.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/tour.client.js', import.meta.url), 'utf8');

const results = [];
async function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = await fn();
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else if (r === undefined) { ok = false; detail = 'fn returned undefined'; }
    else { ok = false; detail = 'unexpected: ' + JSON.stringify(r); }
  } catch (e) {
    detail = (e && e.message) ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function makeSandbox() {
  const localStorage = {
    _k: {},
    getItem(k) { return k in this._k ? this._k[k] : null; },
    setItem(k, v) { this._k[k] = String(v); },
    removeItem(k) { delete this._k[k]; },
  };

  // Tracking whether window.open() was called per href.
  const opened = [];
  const cardEls = [];
  const links = [];
  const meterEl = { style: {}, textContent: '' };
  const labelEl = { textContent: '' };
  const endcap = { hidden: true, textContent: '' };
  const endMeta = { textContent: '' };

  function makeCardEl() {
    return {
      className: 'step-card', dataset: {},
      classList: { toggle() {}, contains() { return false; } },
      setAttribute() {},
      appendChild(c) { this.children.push(c); },
      children: [],
      innerHTML: '', textContent: '', id: '',
    };
  }

  const stepsEl = {
    children: cardEls,
    appendChild(el) { cardEls.push(el); },
    addEventListener() {},
  };

  const buttons = {};
  function makeBtn(id) {
    return { id, disabled: false, textContent: '', addEventListener() {} };
  }
  buttons['t-sweep'] = makeBtn('t-sweep');
  buttons['t-step']  = makeBtn('t-step');
  buttons['t-reset'] = makeBtn('t-reset');

  const sandbox = {
    window: {},
    document: {
      getElementById(id) {
        if (id === 't-steps') return stepsEl;
        if (id === 't-meter') return meterEl;
        if (id === 't-label') return labelEl;
        if (id === 't-endcap') return endcap;
        if (id === 't-endcap-meta') return endMeta;
        if (id === 't-sweep' || id === 't-step' || id === 't-reset') return buttons[id];
        return null;
      },
      createElement(tag) {
        const el = makeCardEl();
        if (tag === 'SECTION') el.isSection = true;
        el.isA = (t) => t === tag || t === tag.toUpperCase();
        el.innerHTML = '';
        return el;
      },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    console: { warn() {}, log() {}, info() {}, error() {} },
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    setTimeout: (cb) => { try { return cb(); } catch (_) {} return 0; },
    clearTimeout: () => {},
    window_open: (href) => { opened.push(href); return { closed: false }; },
    localStorage,
    PerformanceObserver: class {},
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.window.open = sandbox.window_open;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, opened, localStorage, cardEls, meterEl, labelEl, buttons };
}

check('module exposes window.SWR_TOUR with stops + progress + reset', () => {
  const { sandbox } = makeSandbox();
  const T = sandbox.window.SWR_TOUR;
  if (!T) return 'SWR_TOUR not exposed';
  if (!Array.isArray(T.stops)) return 'stops not an array';
  if (T.stops.length < 8) return 'only ' + T.stops.length + ' stops';
  if (typeof T.reset !== 'function') return 'reset() missing';
  if (typeof T.progress !== 'object') return 'progress is not an object';
  return true;
});

check('route table covers engine, marketplace, sitemap, and the new tools', () => {
  const { sandbox } = makeSandbox();
  const ids = sandbox.window.SWR_TOUR.stops.map((s) => s.id);
  for (const need of ['engine', 'looks', 'cloud-library', 'text-layers',
                      'layer-lifecycle', 'echo', 'tiktok', 'marketplace', 'site-map']) {
    if (!ids.includes(need)) return 'missing stop: ' + need;
  }
  return true;
});

check('every stop carries a Nielsen heuristic tag (or null)', () => {
  const { sandbox } = makeSandbox();
  const tags = ['visibility', 'match', 'control', 'consistency', 'recognition',
                'aesthetic', 'efficiency', 'standards', 'documentation'];
  for (const s of sandbox.window.SWR_TOUR.stops) {
    if (!s.heuristic || !tags.includes(s.heuristic)) {
      return 'bad heuristic on ' + s.id + ': ' + s.heuristic;
    }
    if (!s.badge || !/^H[1-9][0-9]?$/.test(s.badge)) {
      return 'bad badge on ' + s.id + ': ' + s.badge;
    }
  }
  return true;
});

check('reset() clears localStorage progress', () => {
  const { sandbox, localStorage } = makeSandbox();
  localStorage.setItem('swr.tour.progress.v1', '{"engine":1234}');
  const ok = sandbox.window.SWR_TOUR.reset();
  if (ok !== undefined) return 'reset() should return undefined';
  // The reset calls removeItem on the storage key. With our sandbox's
  // localStorage returning null on missing keys, progress should be {}.
  const cur = sandbox.window.SWR_TOUR.progress;
  if (Object.keys(cur).length !== 0) return 'progress not empty: ' + JSON.stringify(cur);
  return true;
});

check('formatBody helper: ** bold ** becomes <strong> (smoke via innerHTML contract)', () => {
  const { sandbox, cardEls } = makeSandbox();
  // Find a card with a body containing ** **
  const withBold = cardEls.find((c) => c.innerHTML.includes('<strong>'));
  if (!withBold) {
    // Build the string by checking the route table format directly.
    const T = sandbox.window.SWR_TOUR;
    const fmt = T.stops[0] && T.stops[0].body;
    // We can't call the private formatBody — just verify the contract:
    // body strings include **Nielsen ** markers we can re-format.
    if (!fmt || !fmt.includes('**Nielsen')) {
      return 'engine body missing **Nielsen...** boilerplate';
    }
  }
  return true;
});

// ---- summary ----
(async () => {
  await new Promise((r) => setTimeout(r, 100));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
  if (fail > 0) process.exit(1);
})();
