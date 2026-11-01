// scripts/check-engine-keys-shortcuts-unit.mjs — keyboard shortcut cleanup
// contracts: defaultPrevented bail-out, scene/filter digit split, automix Shift+*.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEYS_SRC = readFileSync(new URL('../engine-keys.client.js', import.meta.url), 'utf8');
const AUTOMIX_SRC = readFileSync(new URL('../client/automix-runtime.client.js', import.meta.url), 'utf8');
const SCENES_KB_SRC = readFileSync(new URL('../client/scenes-keyboard.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else detail = 'unexpected: ' + JSON.stringify(r);
  } catch (e) {
    detail = (e && e.message) ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

check('engine-keys handle() bails when defaultPrevented', () => {
  if (!/if \(ev\.defaultPrevented\) return/.test(KEYS_SRC)) {
    return 'missing defaultPrevented guard in handle()';
  }
  return true;
});

check('engine-keys documents scene vs filter digit split', () => {
  if (!/scenesActive/.test(KEYS_SRC) || !/\^\[5-9\]\$/.test(KEYS_SRC)) {
    return 'missing scenesActive / 5..9 filter regex';
  }
  return true;
});

check('automix _onKey requires Shift (no plain A/F/B/K/D)', () => {
  const fn = AUTOMIX_SRC.match(/function _onKey\(ev\)[\s\S]*?\n  \}/);
  if (!fn) return '_onKey not found';
  const body = fn[0];
  if (!/!ev\.shiftKey/.test(body)) return '_onKey must reject unshifted keys';
  if (/else if \(lower === 'f' && !ev\.metaKey/.test(body)) {
    return 'still handles plain F without shift';
  }
  return true;
});

check('scenes-keyboard uses capture-phase 1..4', () => {
  if (!/addEventListener\('keydown', onKeyDown, true\)/.test(SCENES_KB_SRC)) {
    return 'keydown listener should use capture true';
  }
  if (!/\^\[1-4\]\$/.test(SCENES_KB_SRC)) return 'missing 1..4 digit match';
  return true;
});

check('SWR_SCENES snapshot reads sensitivity + beat-gate (engine.html)', () => {
  const eng = readFileSync(new URL('../engine.html', import.meta.url), 'utf8');
  if (!/_sliderVal\('sensitivity', 'sens'\)/.test(eng)) return 'engine missing sensitivity snapshot';
  if (!/set\('beat-gate', gate\)/.test(eng)) return 'engine missing beat-gate apply';
  return true;
});

// ---- engine-keys simulate: defaultPrevented + scenes filter split ----

function makeNode(tag) {
  const cls = { add() {}, remove() {}, toggle() {}, contains: () => false };
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, classList: cls, dataset: {}, appendChild() {},
    addEventListener() {}, removeEventListener() {},
    value: '', isContentEditable: false,
  };
}

const events = [];
const handlers = {};
const sandbox = {
  window: {},
  console: { warn() {}, log() {}, info() {}, error() {} },
  document: {
    getElementById: () => null,
    addEventListener() {},
    body: makeNode('body'),
    createElement: () => makeNode('div'),
  },
  setStatus: () => {},
  CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
  dispatchEvent(ev) {
    events.push(['event', ev.type, ev.detail && ev.detail.action]);
    return true;
  },
  performance: { now: () => 1000 },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window = sandbox;
sandbox.window.performance = sandbox.performance;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.SWR_LOOK_FILTER_CYCLER = { apply: () => true };
sandbox.window.SWR_SCENES = { recall() {} };
sandbox.window.addEventListener = (n, fn) => { handlers[n] = fn; };
sandbox.window.removeEventListener = () => {};
sandbox.window.setTimeout = () => 0;
sandbox.window.clearTimeout = () => {};

vm.createContext(sandbox);
vm.runInContext(KEYS_SRC, sandbox);

function fire(opts) {
  events.length = 0;
  handlers.keydown(Object.assign({
    target: sandbox.document.body,
    preventDefault() {},
    stopPropagation() {},
  }, opts));
  return events.slice();
}

function actionFrom(evList) {
  const e = evList.find((ev) => ev[0] === 'event' && ev[1] === 'swr-keys-press');
  return e && e[2];
}

check('simulate: defaultPrevented → no swr-keys-press', () => {
  const ev = fire({ key: 'f', code: 'KeyF', defaultPrevented: true });
  if (ev.some((e) => e[0] === 'event')) return 'handler ran despite defaultPrevented';
  return true;
});

check('simulate: bare 1 does not filter when SWR_SCENES present', () => {
  const ev = fire({ key: '1', code: 'Digit1' });
  if (actionFrom(ev) === 'filter-1') return '1 still mapped to filter-1 with scenes';
  return true;
});

check('simulate: bare 5 still filter-5 when SWR_SCENES present', () => {
  const ev = fire({ key: '5', code: 'Digit5' });
  if (actionFrom(ev) !== 'filter-5') return 'expected filter-5, got ' + actionFrom(ev);
  return true;
});

check('simulate: bare 1 filter-1 when SWR_SCENES absent', () => {
  const sb = {
    window: {},
    console: sandbox.console,
    document: { ...sandbox.document, getElementById: () => null },
    setStatus: () => {},
    CustomEvent: sandbox.CustomEvent,
    dispatchEvent(ev) { events.length = 0; events.push(['event', ev.type, ev.detail && ev.detail.action]); return true; },
    performance: { now: () => 1000 },
    localStorage: sandbox.localStorage,
  };
  sb.window = sb;
  sb.window.SWR_LOOK_FILTER_CYCLER = { apply: () => true };
  const h = {};
  sb.window.addEventListener = (n, fn) => { h[n] = fn; };
  sb.window.removeEventListener = () => {};
  sb.window.setTimeout = () => 0;
  sb.window.clearTimeout = () => {};
  vm.createContext(sb);
  vm.runInContext(KEYS_SRC, sb);
  events.length = 0;
  h.keydown({
    key: '1', code: 'Digit1', target: makeNode('body'),
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() {}, stopPropagation() {},
  });
  if (actionFrom(events) !== 'filter-1') return 'without scenes expected filter-1, got ' + actionFrom(events);
  return true;
});

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
