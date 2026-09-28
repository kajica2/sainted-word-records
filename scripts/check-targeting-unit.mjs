#!/usr/bin/env node
// scripts/check-targeting-unit.mjs — Targeted Engine unit tests.
//
// Loads client/targeting.client.js in a node:vm sandbox with a minimal DOM
// stub and drives the public API plus the _debug classifier. Covers:
//   1. the four signature rules from the PRD use cases (ar-loop-poster,
//      fx-surgeon, live-vj, bedroom-producer) and the tag-janitor precision
//      case (UC-007: a library-heavy low-preset session must never be pushed a
//      preset-heavy persona)
//   2. the untargeted fallback (below the score floor → personaId null)
//   3. "Not me" correction lowers the score and decays
//   4. voice lint accept/reject
//   5. the FR-10 CTA guard (a non-magic-link auth hint invalidates the banner)
//   6. dismissal suppression
//   7. variant ordering is a permutation and is applied to the <select>
//   8. transition pins mark only the persona's transitions
//   9. NFR-1: a classification over the full 200-signal window is < 50 ms
//
// Run: node scripts/check-targeting-unit.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'client/targeting.client.js');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'targeting/rules.json'), 'utf8'));

let failures = 0;
const assert = (cond, msg, detail) => {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
};

// ── minimal DOM ─────────────────────────────────────────────────────────────

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    value: '',
    textContent: '',
    hidden: false,
    className: '',
    type: '',
    href: '',
    children: [],
    attrs: {},
    listeners: {},
    parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    dispatch(ev) { (this.listeners[ev] || []).forEach((fn) => fn({ target: this })); },
    querySelectorAll(sel) {
      if (sel === 'option') return this.children.filter((c) => c.tagName === 'OPTION');
      return [];
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { this.children = []; },
  });
  return el;
}

function buildDom() {
  const bannerHost = makeEl('div');
  bannerHost.hidden = true;
  const txPick = makeEl('select');
  ['whip-blur', 'glitch-block', 'zoom-through', 'chroma-burst', 'vhs-tracking'].forEach((id) => {
    const o = makeEl('option');
    o.value = id;
    txPick.appendChild(o);
  });
  const variantSel = makeEl('select');
  const off = makeEl('option');
  off.value = 'off';
  variantSel.appendChild(off);
  RULES.variants.forEach((id) => {
    const o = makeEl('option');
    o.value = id;
    o.textContent = id;
    variantSel.appendChild(o);
  });

  return {
    bannerHost,
    txPick,
    variantSel,
    document: {
      getElementById(id) {
        if (id === 'swr-targeting-banner') return bannerHost;
        if (id === 'swr-tx-pick') return txPick;
        if (id === 'variant') return variantSel;
        return null; // no inline rules tag → rules set manually below
      },
      createElement: (t) => makeEl(t),
      addEventListener: () => {},
    },
  };
}

// ── sandbox ─────────────────────────────────────────────────────────────────

const dom = buildDom();
const ctx = {
  window: {},
  document: dom.document,
  location: { pathname: '/engine.html' },
  console: { warn: () => {}, error: () => {}, log: () => {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Math, Date, Object, JSON, String, Array, Number, Error,
};
ctx.window.window = ctx.window;
ctx.window.document = ctx.document;
ctx.window.location = ctx.location;
ctx.window.console = ctx.console;
ctx.window.indexedDB = undefined;          // no IDB in the sandbox → graceful
ctx.window.addEventListener = () => {};
ctx.window.removeEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

const T = ctx.window.SWR_TARGETING;
if (!T) { console.error('SWR_TARGETING not exposed'); process.exit(2); }
T._debug.setRules(Object.assign({}, RULES, { personaToNote: RULES.personaToNote }));

const visit = (surface, n = 1) => Array.from({ length: n }, () => ({ kind: 'visit', payload: { surface }, ts: Date.now() }));
const preset = (n) => Array.from({ length: n }, () => ({ kind: 'preset', payload: { id: 'pulse' }, ts: Date.now() }));
const tx = (n) => Array.from({ length: n }, () => ({ kind: 'transition', payload: { name: 'whip-blur' }, ts: Date.now() }));
const C = (sigs, corr) => T._debug.CLASSIFY(sigs, RULES, corr || {});

console.log('\n=== 1. signature rules (UC-001 … UC-007) ===');
assert(C([...visit('AR', 2), ...preset(1)]).personaId === 'ar-loop-poster',
  'AR×2 + preset → ar-loop-poster');
assert(C([...visit('FX', 3), ...preset(2)]).personaId === 'fx-surgeon',
  'FX×3 + presets×2 → fx-surgeon');
assert(C([...visit('TX', 3), ...tx(5)]).personaId === 'live-vj',
  'TX×3 + transitions×5 → live-vj');
assert(C([...visit('PST', 4), ...visit('LIB', 2), ...preset(4)]).personaId === 'bedroom-producer',
  'PST×4 + LIB×2 → bedroom-producer');
assert(C([...visit('LIB', 3), ...visit('AUD', 2)]).personaId === 'tag-janitor',
  'LIB×3, no presets → tag-janitor (UC-007 precision)');
const tjHeavy = C([...visit('LIB', 3), ...visit('AUD', 2), ...preset(6), ...visit('PST', 6)]);
assert(tjHeavy.personaId !== 'tag-janitor',
  'UC-007 negative: tag-janitor is NOT forced on a preset-heavy session', tjHeavy.personaId);

console.log('\n=== 2. untargeted fallback ===');
assert(C([]).personaId === null, 'empty session → null persona');
assert(C([...visit('ENG', 1)]).personaId === null, 'single weak visit → null persona');

console.log('\n=== 3. "Not me" correction (FR-11/12/13) ===');
const base = C([...visit('AR', 2), ...preset(1)]);
const corrected = C([...visit('AR', 2), ...preset(1)], { 'ar-loop-poster': { personaId: 'ar-loop-poster', weight: 1, ts: Date.now() } });
const scoreOf = (r, id) => (r.alternatives.find((a) => a.id === id) || {}).score;
assert(scoreOf(corrected, 'ar-loop-poster') < scoreOf(base, 'ar-loop-poster'),
  'correction lowers the persona score',
  `${scoreOf(base, 'ar-loop-poster')} → ${scoreOf(corrected, 'ar-loop-poster')}`);
const oldCorr = { 'ar-loop-poster': { personaId: 'ar-loop-poster', weight: 1, ts: Date.now() - 28 * 86400000 } };
const decayed = C([...visit('AR', 2), ...preset(1)], oldCorr);
assert(scoreOf(decayed, 'ar-loop-poster') > scoreOf(corrected, 'ar-loop-poster'),
  'correction decays over time (28 days → half the penalty gone)',
  `${scoreOf(corrected, 'ar-loop-poster')} → ${scoreOf(decayed, 'ar-loop-poster')}`);
assert(T._debug.decodeFactor(Date.now() - 14 * 86400000) < 0.51,
  '14-day half-life: factor ≈ 0.5', T._debug.decodeFactor(Date.now() - 14 * 86400000).toFixed(3));

console.log('\n=== 4. voice lint (README banned list) ===');
assert(T.voice.lint('revolutionize your workflow').ok === false, 'banned word rejected');
assert(T.voice.lint('AI-powered visuals').ok === false, 'ai-powered rejected');
assert(T.voice.lint('Free. In your browser, no signup.').ok === true, 'clean copy accepted');

console.log('\n=== 5. FR-10 CTA guard ===');
const before = dom.bannerHost.children.length;
const oauth = T.showBanner({ surface: 'test', copy: 'Save your work.', cta: { kind: 'oauth', href: '/x' } });
assert(oauth.shown === false && oauth.reason === 'cta-not-allowed',
  'oauth CTA invalidates the banner', JSON.stringify(oauth));
assert(dom.bannerHost.children.length === before && dom.bannerHost.hidden === true,
  'no DOM mutation on rejection');
const magic = T.showBanner({ surface: 'test', copy: 'Save your work? Free, no signup.', cta: { kind: 'magic-link', href: '/auth/login.html' } });
assert(magic.shown === true, 'magic-link CTA shows the banner', JSON.stringify(magic));
assert(dom.bannerHost.hidden === false && dom.bannerHost.children.length === 3,
  'banner host populated (text + cta + close)');

console.log('\n=== 6. dismissal suppression ===');
assert(T.dismissBanner('test') === true, 'dismissBanner() accepted');
assert(dom.bannerHost.hidden === true, 'banner hidden after dismissal');
const again = T.showBanner({ surface: 'test', copy: 'Save your work? Free, no signup.' });
assert(again.shown === false && again.reason === 'dismissed', 'dismissed surface stays suppressed');

console.log('\n=== 7. variant ordering ===');
const arOrder = RULES.personaToVariants['ar-loop-poster'];
assert(arOrder[0] === 'smoke', 'ar-loop-poster prefers smoke first', arOrder.join(','));
assert(JSON.stringify([...arOrder].sort()) === JSON.stringify([...RULES.variants].sort()),
  'ordering is a permutation of the canonical variant list');
assert(T.maybeReorderVariants(dom.variantSel, RULES.variants) !== undefined, 'maybeReorderVariants() callable');
T._debug.setSignals([...visit('AR', 2), ...preset(1)]);
T._debug.setCorrections({});
T.classify();
T.applyVariantOrder(dom.variantSel, RULES.personaToVariants['ar-loop-poster']);
const opts = dom.variantSel.children.map((o) => o.value);
assert(opts[0] === 'off' && opts[1] === 'smoke',
  'select reordered with "off" preserved first', opts.join(','));

console.log('\n=== 8. transition pins ===');
T.applyTransitionPins(RULES.personaToTransitions['live-vj']);
const pinned = dom.txPick.children.filter((o) => o.getAttribute('data-swr-pin') === '1').map((o) => o.value);
const wanted = RULES.personaToTransitions['live-vj'].filter((t) => dom.txPick.children.some((o) => o.value === t));
assert(pinned.length === wanted.length && pinned.length > 0,
  'only the persona transitions are pinned', pinned.join(','));

console.log('\n=== 9. NFR-1 timing (≤ 50 ms over 200 signals) ===');
const heavy = [...visit('AR', 40), ...visit('FX', 40), ...visit('TX', 40), ...visit('PST', 40), ...preset(40)];
const t0 = performance.now();
for (let i = 0; i < 50; i++) C(heavy);
const per = (performance.now() - t0) / 50;
assert(per < 50, `classify() averages ${per.toFixed(2)} ms over 200 signals`, `${per.toFixed(2)} ms`);

console.log('\n' + (failures === 0 ? 'TARGETING UNIT: ALL GREEN' : `TARGETING UNIT: ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
