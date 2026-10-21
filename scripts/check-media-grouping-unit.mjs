// scripts/check-media-grouping-unit.mjs
//
// Covers client/media-grouping.client.js — the rule that decides which
// media belong together, shared by the media panel's group-by-name view
// and the automix layer pool.
//
// What we verify:
//   1. prefixOf() strips the extension, a trailing counter and a
//      trailing version marker, and normalises separators.
//   2. Videos with a shared prefix land in one group; different
//      prefixes land in different groups.
//   3. EVERY static graphic lands in ONE group, whatever its name.
//   4. Groups are ordered: video groups alphabetically, graphics last.
//   5. Items inside a group are sorted by name, numerically where it
//      matters (clip 2 before clip 10).
//   6. The toggle state (SWR_MEDIA_GROUPING_UI) flips, notifies its
//      subscribers and is idempotent.
//   7. The module is idempotent: loading it twice does not clobber the
//      first instance.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/media-grouping.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
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

function loadModule() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window;
}

check('module publishes SWR_MEDIA_GROUPING and SWR_MEDIA_GROUPING_UI', () => {
  const w = loadModule();
  const G = w.SWR_MEDIA_GROUPING;
  if (!G) return 'SWR_MEDIA_GROUPING missing';
  for (const fn of ['prefixOf', 'isStatic', 'groupItems', 'sortItems']) {
    if (typeof G[fn] !== 'function') return 'missing ' + fn;
  }
  const UI = w.SWR_MEDIA_GROUPING_UI;
  if (!UI) return 'SWR_MEDIA_GROUPING_UI missing';
  for (const fn of ['isOn', 'setOn', 'toggle', 'onChange']) {
    if (typeof UI[fn] !== 'function') return 'UI missing ' + fn;
  }
  return true;
});

check('prefixOf strips extension, counter and version marker', () => {
  const { prefixOf } = loadModule().SWR_MEDIA_GROUPING;
  const cases = [
    ['intro_clip_01.mp4', 'intro clip'],
    ['intro_clip_02.mp4', 'intro clip'],
    ['loop_v3.webm', 'loop'],
    ['Beach Day 2.mov', 'beach day'],
    ['b-roll.png', 'b roll'],
    ['trailer.mov', 'trailer'],
  ];
  for (const [input, want] of cases) {
    const got = prefixOf(input);
    if (got !== want) return `${input} -> "${got}", expected "${want}"`;
  }
  if (prefixOf('') !== 'untitled') return 'empty name -> ' + prefixOf('');
  return true;
});

check('videos with a shared prefix share one group', () => {
  const { groupItems } = loadModule().SWR_MEDIA_GROUPING;
  const items = [
    { id: 1, name: 'intro_clip_01.mp4', type: 'video' },
    { id: 2, name: 'intro_clip_02.mp4', type: 'video' },
    { id: 3, name: 'outro_clip_01.mp4', type: 'video' },
  ];
  const groups = groupItems(items);
  if (groups.length !== 2) return 'expected 2 groups, got ' + groups.length;
  const intro = groups.find((g) => g.items.some((i) => i.id === 1));
  if (!intro) return 'no group holds intro_clip_01';
  if (intro.items.length !== 2) return 'intro group holds ' + intro.items.length;
  if (!intro.items.some((i) => i.id === 2)) return 'intro_clip_02 not grouped with 01';
  return true;
});

check('every static graphic lands in ONE group', () => {
  const { groupItems } = loadModule().SWR_MEDIA_GROUPING;
  const items = [
    { id: 1, name: 'intro_clip_01.mp4', type: 'video' },
    { id: 2, name: 'logo.png', type: 'image' },
    { id: 3, name: 'title card.jpg', type: 'image' },
    { id: 4, name: 'noise.gif', type: 'image' },
  ];
  const groups = groupItems(items);
  const gfx = groups.filter((g) => g.kind === 'graphics');
  if (gfx.length !== 1) return 'expected exactly 1 graphics group, got ' + gfx.length;
  if (gfx[0].items.length !== 3) return 'graphics group holds ' + gfx[0].items.length;
  const video = groups.filter((g) => g.kind === 'video');
  if (video.length !== 1) return 'expected 1 video group, got ' + video.length;
  return true;
});

check('isStatic recognises images by type, mime and extension', () => {
  const { isStatic } = loadModule().SWR_MEDIA_GROUPING;
  if (!isStatic({ type: 'image' })) return 'type image not static';
  if (isStatic({ type: 'video' })) return 'type video is static';
  if (!isStatic({ mime: 'image/png' })) return 'mime image/png not static';
  if (!isStatic({ name: 'shot.PNG' })) return 'extension not static';
  if (isStatic({ name: 'clip.mp4' })) return 'mp4 is static';
  return true;
});

check('groups are ordered: video groups alphabetically, graphics last', () => {
  const { groupItems } = loadModule().SWR_MEDIA_GROUPING;
  const groups = groupItems([
    { id: 1, name: 'zebra.mp4', type: 'video' },
    { id: 2, name: 'alpha.mp4', type: 'video' },
    { id: 3, name: 'logo.png', type: 'image' },
  ]);
  const labels = groups.map((g) => g.label);
  if (labels[0] !== 'alpha') return 'first group is ' + labels[0];
  if (labels[1] !== 'zebra') return 'second group is ' + labels[1];
  if (labels[labels.length - 1] !== 'graphics') return 'graphics group is not last: ' + labels.join(',');
  return true;
});

check('items inside a group sort numerically (clip 2 before clip 10)', () => {
  const { groupItems } = loadModule().SWR_MEDIA_GROUPING;
  const groups = groupItems([
    { id: 1, name: 'clip_10.mp4', type: 'video' },
    { id: 2, name: 'clip_2.mp4', type: 'video' },
  ]);
  const names = groups[0].items.map((i) => i.name);
  if (names[0] !== 'clip_2.mp4') return 'order is ' + names.join(',');
  return true;
});

check('sortItems returns the flat list in group order', () => {
  const { sortItems } = loadModule().SWR_MEDIA_GROUPING;
  const out = sortItems([
    { id: 1, name: 'b.mp4', type: 'video' },
    { id: 2, name: 'a.mp4', type: 'video' },
    { id: 3, name: 'g.png', type: 'image' },
  ]);
  const names = out.map((i) => i.name);
  if (names.join(',') !== 'a.mp4,b.mp4,g.png') return 'flat order is ' + names.join(',');
  return true;
});

check('the toggle flips, notifies subscribers and is idempotent', () => {
  const w = loadModule();
  const UI = w.SWR_MEDIA_GROUPING_UI;
  const seen = [];
  UI.onChange((on) => seen.push(on));
  if (UI.isOn() !== false) return 'starts off';
  if (UI.toggle() !== true) return 'toggle did not turn it on';
  if (UI.isOn() !== true) return 'not on after toggle';
  if (seen.length !== 1 || seen[0] !== true) return 'subscriber saw ' + JSON.stringify(seen);
  UI.setOn(true);
  if (seen.length !== 1) return 'idempotent setOn notified again';
  if (UI.toggle() !== false) return 'second toggle did not turn it off';
  if (seen.length !== 2 || seen[1] !== false) return 'subscriber saw ' + JSON.stringify(seen);
  return true;
});

check('loading the module twice does not clobber the first instance', () => {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const first = sandbox.window.SWR_MEDIA_GROUPING;
  first.marker = 'keep';
  vm.runInContext(SRC, sandbox);
  if (sandbox.window.SWR_MEDIA_GROUPING !== first) return 'module re-initialised';
  if (sandbox.window.SWR_MEDIA_GROUPING.marker !== 'keep') return 'state clobbered';
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
