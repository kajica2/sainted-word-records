// scripts/check-engine-keys-shortcuts-p2-unit.mjs — keyboard shortcuts part 2:
// blackout, sensitivity/beat-gate brackets, image-lane keys, autoMap routing.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEYS_SRC = readFileSync(new URL('../engine-keys.client.js', import.meta.url), 'utf8');
const LANE_SRC = readFileSync(new URL('../lib/image-lane.client.js', import.meta.url), 'utf8');
const LAYERS_SRC = readFileSync(new URL('../lib/layers.client.js', import.meta.url), 'utf8');
const DEFLIB_SRC = readFileSync(new URL('../client/default-library.client.js', import.meta.url), 'utf8');
const JPG_SRC = readFileSync(new URL('../jpg-engine.client.js', import.meta.url), 'utf8');

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

check('image-lane exports stepStill + toggleStackOrder', () => {
  if (!/stepStill\s*\(delta\)/.test(LANE_SRC)) return 'missing stepStill';
  if (!/toggleStackOrder\s*\(/.test(LANE_SRC)) return 'missing toggleStackOrder';
  return true;
});

check('layers.autoMap routes isImageAsset to SWR_IMAGE_LANE.add', () => {
  if (!/isImageAsset\(a\.asset\)/.test(LAYERS_SRC)) return 'missing isImageAsset check in autoMap';
  if (!/lane\.add\(a\.asset\)/.test(LAYERS_SRC)) return 'missing lane.add in autoMap';
  return true;
});

check('default-library runs migrateFromVideoStack after autoMap', () => {
  if (!/L\.autoMap\(\)/.test(DEFLIB_SRC)) return 'no autoMap call';
  if (!/migrateFromVideoStack/.test(DEFLIB_SRC)) return 'no migrateFromVideoStack after autoMap';
  return true;
});

check('engine-keys binds Q / I / sensitivity / beat-gate', () => {
  if (!/case 'KeyQ'/.test(KEYS_SRC)) return 'missing KeyQ';
  if (!/case 'KeyI'/.test(KEYS_SRC)) return 'missing KeyI';
  if (!/nudgeSensitivityDown/.test(KEYS_SRC) || !/nudgeBeatGateDown/.test(KEYS_SRC)) {
    return 'missing sensitivity/beat-gate actions';
  }
  if (!/stillStepPreferred/.test(KEYS_SRC)) return 'missing stillStepPreferred routing';
  if (!/laneHasStills/.test(KEYS_SRC)) return 'missing laneHasStills helper';
  if (!/ArrowLeft[\s\S]*imageLanePrevStill/.test(KEYS_SRC)) return 'missing ArrowLeft still step';
  if (!/ArrowRight[\s\S]*imageLaneNextStill/.test(KEYS_SRC)) return 'missing ArrowRight still step';
  if (!/reapplyBlackoutIfActive/.test(KEYS_SRC)) return 'missing blackout reapply';
  return true;
});

check('jpg-engine exposes SWR_JPG.stepStill', () => {
  if (!/stepStill/.test(JPG_SRC) || !/window\.SWR_JPG/.test(JPG_SRC)) return 'missing stepStill on SWR_JPG';
  return true;
});

function makeNode(tag) {
  const cls = { add() {}, remove() {}, toggle() {}, contains: () => false };
  return {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, classList: cls, dataset: {}, appendChild() {},
    addEventListener() {}, removeEventListener() {},
    value: '1', min: '0.2', max: '3', step: '0.05',
    isContentEditable: false,
  };
}

function bootKeys(extra) {
  const events = [];
  const handlers = {};
  const sensEl = makeNode('input');
  sensEl.id = 'sensitivity';
  sensEl.value = '1';
  const gateEl = makeNode('input');
  gateEl.id = 'beat-gate';
  gateEl.value = '1.4';
  gateEl.min = '1.05';
  gateEl.max = '2.5';
  gateEl.step = '0.05';
  const sandbox = {
    window: {},
    console: { warn() {}, log() {}, info() {}, error() {} },
    document: {
      getElementById(id) {
        if (id === 'sensitivity') return sensEl;
        if (id === 'beat-gate') return gateEl;
        if (id === 'stage') return { classList: { add() {}, remove() {}, toggle() {} } };
        return null;
      },
      addEventListener() {},
      body: makeNode('body'),
      createElement: () => makeNode('div'),
      head: { appendChild() {} },
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
  Object.assign(sandbox.window, extra || {});
  sandbox.window.performance = sandbox.performance;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.Layers = {
    list: [{ id: 'L1', hidden: false, opacity: 1 }],
    selected: null,
    render() {},
  };
  sandbox.window.addEventListener = (n, fn) => { handlers[n] = fn; };
  sandbox.window.removeEventListener = () => {};
  sandbox.window.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
  sandbox.window.clearTimeout = () => {};
  vm.createContext(sandbox);
  vm.runInContext(KEYS_SRC, sandbox);
  return { sandbox, handlers, events, sensEl, gateEl };
}

check('simulate: [ nudges #sensitivity', () => {
  const { handlers, sensEl } = bootKeys({});
  handlers.keydown({
    key: '[', code: 'BracketLeft', target: makeNode('body'),
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false, preventDefault() {}, stopPropagation() {},
  });
  const v = parseFloat(sensEl.value);
  if (v >= 1) return 'expected sensitivity to decrease, got ' + v;
  return true;
});

check('simulate: Q toggles blackout and restores', () => {
  const { handlers, sandbox } = bootKeys({});
  const layer = sandbox.window.Layers.list[0];
  handlers.keydown({
    key: 'q', code: 'KeyQ', target: makeNode('body'),
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false, preventDefault() {}, stopPropagation() {},
  });
  if (!sandbox.window.SWR_KEYS.isBlackoutActive()) return 'blackout not active after Q';
  if (!layer.hidden) return 'layer not hidden';
  handlers.keydown({
    key: 'q', code: 'KeyQ', target: makeNode('body'),
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false, preventDefault() {}, stopPropagation() {},
  });
  if (sandbox.window.SWR_KEYS.isBlackoutActive()) return 'blackout still active after second Q';
  if (layer.hidden) return 'layer hidden not restored';
  return true;
});

check('simulate: comma steps still when lane populated and no video selection', () => {
  let stepped = 0;
  const { handlers } = bootKeys({
    SWR_IMAGE_LANE: {
      list: [{ id: 'I1' }, { id: 'I2' }],
      stepStill(d) { stepped = d; return true; },
    },
  });
  handlers.keydown({
    key: ',', code: 'Comma', target: makeNode('body'),
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false, preventDefault() {}, stopPropagation() {},
  });
  if (stepped !== -1) return 'expected stepStill(-1), got ' + stepped;
  return true;
});

console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed (${results.length} checks)`);
if (results.some((r) => !r.ok)) process.exit(1);
