#!/usr/bin/env node
// NEON audio top layer (wave-lines) — public presets, Off, sens scaling,
// multi-band mix, onset envelope, and mount/stack contracts.

import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('client/wave-lines.client.js', 'utf8');

function link(parent) {
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].previousSibling = i > 0 ? kids[i - 1] : null;
    kids[i].nextSibling = i + 1 < kids.length ? kids[i + 1] : null;
  }
}

function makeEl(tag) {
  const el = {
    tagName: tag,
    id: '',
    textContent: '',
    style: {},
    children: [],
    parentNode: null,
    clientWidth: 640,
    clientHeight: 360,
    attrs: {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] != null ? el.attrs[k] : null; },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      link(el);
      return child;
    },
    insertBefore(child, ref) {
      child.parentNode = el;
      const i = el.children.indexOf(ref);
      if (i < 0) el.children.push(child);
      else el.children.splice(i, 0, child);
      link(el);
      return child;
    },
    querySelector(sel) {
      if (sel === '#render') return el.children.find((c) => c.id === 'render') || null;
      return null;
    },
    createElementNS(_ns, name) {
      return makeEl(name);
    },
  };
  el.ownerDocument = { createElementNS: el.createElementNS };
  return el;
}

const stage = makeEl('section');
const canvas = makeEl('canvas');
canvas.id = 'render';
const flash = makeEl('div');
flash.id = 'flash';
stage.appendChild(canvas);
stage.appendChild(flash);

const head = makeEl('head');
const document = {
  readyState: 'complete',
  hidden: false,
  head,
  body: makeEl('body'),
  getElementById(id) {
    if (id === 'swr-wave-lines-css') return head.children.find((c) => c.id === id) || null;
    if (id === 'swr-wave-lines') return stage.children.find((c) => c.id === id) || null;
    return null;
  },
  createElement(tag) { return makeEl(tag); },
  querySelector(sel) {
    if (sel === 'section.stage') return stage;
    return null;
  },
  addEventListener() {},
};

const context = { window: {}, document, console };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const api = context.window.SWR_WAVE_LINES;
const alias = context.window.SWR_AUDIO_TOP;
const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

assert(api && alias && api === alias, 'SWR_AUDIO_TOP aliases SWR_WAVE_LINES');

const ids = api.PRESETS.map((p) => p.id);
assert(ids.includes('off'), 'off preset exists');
assert(ids.length === 8, 'eight presets (7 looks + off), got ' + ids.length);
assert(new Set(ids).size === 8, 'preset ids are unique');
for (const id of ['tide', 'ripple', 'pulse', 'scan', 'ribbon', 'stack', 'spike', 'off']) {
  assert(ids.includes(id), 'preset ' + id);
}

const publicIds = api.PRESETS_PUBLIC.map((p) => p.id);
assert(publicIds.join(',') === 'pulse,spike,scan,ribbon,off', 'public preset order, got ' + publicIds.join(','));

const tide = api.presetById('tide');
const a = api.buildPaths(tide, 0, {}, 640, 360);
const b = api.buildPaths(tide, 0.35, {}, 640, 360);
assert(a.length === 3, 'tide draws three lines');
assert(a[0].d !== b[0].d, 'tide path moves with phase');
assert(a[0].d.indexOf('M') === 0, 'path is a polyline');

function lineSpan(preset, phase, feat, h, line) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 48; i++) {
    const y = api.yAt(preset, line, i / 48, phase, feat, h);
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return max - min;
}

const pulse = api.presetById('pulse');
const quiet = lineSpan(pulse, 0, { bass: 0, beat: 0 }, 360, 0);
const loud = lineSpan(pulse, 0, { bass: 1, beat: 1 }, 360, 0);
assert(loud > quiet * 2, 'pulse amplitude follows bass/beat mix (' + quiet.toFixed(1) + ' → ' + loud.toFixed(1) + ')');

api.setSens(2);
const louder = lineSpan(pulse, 0, { bass: 1, beat: 1 }, 360, 0);
assert(louder > loud, 'setSens amplifies the sheet (' + loud.toFixed(1) + ' → ' + louder.toFixed(1) + ')');
api.setSens(1);

const scan = api.presetById('scan');
const y0 = api.yAt(scan, 0, 0.5, 0, {}, 360);
const y1 = api.yAt(scan, 0, 0.5, 0.4, {}, 360);
assert(Math.abs(y1 - y0) > 20, 'scan line travels (' + y0.toFixed(1) + ' → ' + y1.toFixed(1) + ')');

const spike = api.presetById('spike');
// Prime onset envelope the way frame() does.
api._state.onsetEnv = 0;
api._state.lastOnset = 0;
api.frame(0.016, { onset: 0 }, 640, 360);
api.setPreset('spike');
const flat = api.rangeOf(spike, 0.1, { onset: 0 }, 360);
api._state.onsetEnv = 1;
const hit = api.rangeOf(spike, 0.1, { onset: 1 }, 360);
assert(hit.span > flat.span, 'spike grows on onset envelope (' + flat.span.toFixed(1) + ' → ' + hit.span.toFixed(1) + ')');

assert(api.setPreset('no-such') === false, 'unknown preset is refused');
assert(api.getPreset().id === 'spike', 'refused preset leaves the current one');
assert(api.setPreset('ribbon') === true, 'ribbon is accepted');
assert(api.getPreset().id === 'ribbon', 'ribbon becomes current');
assert(api.getEnabled() === true, 'ribbon is enabled');

assert(api.setPreset('off') === true, 'off is accepted');
assert(api.getEnabled() === false, 'off disables the sheet');
assert(api.buildPaths(api.presetById('off'), 0, {}, 640, 360).length === 0, 'off builds no paths');

const svg = api.mount(stage);
assert(svg && svg.id === 'swr-wave-lines', 'mount inserts the sheet');
assert(svg.getAttribute('preserveAspectRatio') === 'none', 'the sheet stretches to the stage instead of letterboxing');
assert(head.children.some((n) => n.textContent && n.textContent.indexOf('z-index:3') >= 0), 'the sheet stacks above the FX canvas');
assert(canvas.nextSibling === svg || stage.children[1] === svg, 'sheet sits immediately above the canvas');

api.setPreset('ribbon');
const before = api._state.phase;
assert(api.frame(0.016, { bass: 0.4, mid: 0.5, rms: 0.4 }, 640, 360) === true, 'frame paints');
assert(api._state.phase > before, 'frame advances the phase');
assert(svg.style.display !== 'none', 'ribbon is visible');
const d = api._state.paths[0] && api._state.paths[0].getAttribute('d');
assert(typeof d === 'string' && d.indexOf('M') === 0, 'frame writes a path');
const shown = api._state.paths.filter((p) => p.style.display !== 'none');
assert(shown.length === 2, 'ribbon shows two paths, got ' + shown.length);

api.setPreset('off');
api.frame(0.016, { bass: 1 }, 640, 360);
assert(svg.style.display === 'none', 'off hides the sheet');
assert(api.getEnabled() === false, 'getEnabled false while off');

api.setEnabled(true);
assert(api.getPreset().id === 'pulse', 'setEnabled(true) restores pulse from off');
api.setPreset('spike');
api.frame(0.016, { onset: 1 }, 800, 450);
assert(svg.getAttribute('viewBox') === '0 0 800 450', 'viewBox follows the stage');
assert(svg.getAttribute('data-audio-top') === 'spike', 'data-audio-top tracks preset');

// Multi-band: pulse mix uses beat as well as bass.
const bassOnly = api.mixAudio(pulse, { bass: 1, beat: 0 });
const withBeat = api.mixAudio(pulse, { bass: 1, beat: 1 });
assert(withBeat > bassOnly, 'pulse mix includes beat (' + bassOnly + ' → ' + withBeat + ')');

if (failures.length) {
  console.log('WAVE LINES: FAIL');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('WAVE LINES: PASS (audio top public presets, off, sens, mix, onset, mount)');
