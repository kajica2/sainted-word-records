// scripts/check-layer-groups-unit.mjs — unit coverage for the layer-group
// feature in lib/layers.client.js.
//
// Contract under test:
//   - shift+click marks a layer (multi-selection); plain click clears it
//     — both the state and the ring the panel shows
//   - groupSelected() needs 2+ marked layers, and binds them to one group
//   - a group renders exactly one header, above its first member
//   - a collapsed group renders the header but no member cards
//   - group visibility writes `hidden` on every member (the draw paths
//     skip hidden layers, so they stay group-agnostic)
//   - ungroup() dissolves the group and restores the members
//   - removing the last member of a group drops the group
//   - a group name is set as a property (never interpolated into markup)
//     and an empty name is rejected

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../lib/layers.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// ---- DOM stub ------------------------------------------------------------
// The layer panel is painted by Layers.render(): it builds a card per
// layer, appends group headers into the same fragment, and finally
// replaces #layer-list's content. The stub records that tree so the
// tests can count headers and member cards.
function makeDom() {
  const listNode = null;
  // A faithful classList: it reads and writes the node's className, so
  // a test can assert on the ring a node actually carries. The real DOM
  // behaves this way, and Layers.select() relies on it (it clears the
  // "selected"/"multi-selected" rings without re-rendering).
  const mkClassList = (node) => ({
    add(...names) {
      const cur = String(node.className || '').split(/\s+/).filter(Boolean);
      for (const n of names) if (cur.indexOf(n) < 0) cur.push(n);
      node.className = cur.join(' ');
    },
    remove(...names) {
      const cur = String(node.className || '').split(/\s+/).filter(Boolean);
      node.className = cur.filter((c) => names.indexOf(c) < 0).join(' ');
    },
    toggle(name, force) {
      const has = this.contains(name);
      const on = force === undefined ? !has : !!force;
      if (on) this.add(name); else this.remove(name);
      return on;
    },
    contains: (name) => String(node.className || '').split(/\s+/).indexOf(name) >= 0,
  });
  const makeNode = (tag) => {
    const n = {
      tagName: (tag || 'div').toUpperCase(),
      children: [],
      style: {},
      className: '',
      dataset: {},
      classList: null,
      value: '',
      checked: false,
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      setAttribute() {}, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() {},
      querySelectorAll() { return []; },
      insertBefore() {},
      set textContent(v) { this._txt = v; },
      get textContent() { return this._txt || ''; },
      // Setting innerHTML replaces the children (the real DOM does).
      set innerHTML(v) { this._html = v; this.children = []; },
      get innerHTML() { return this._html || ''; },
    };
    n.querySelector = () => makeNode('span');
    n.classList = mkClassList(n);
    return n;
  };
  const layerList = makeNode('div');
  layerList.id = 'layer-list';
  const dom = {
    createElement: (tag) => makeNode(tag),
    createDocumentFragment: () => makeNode('fragment'),
    getElementById: (id) => (id === 'layer-list' ? layerList : makeNode('div')),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
  void listNode;
  return { dom, layerList };
}

function makeAudio() {
  return { feat: { bass: 0.2, mid: 0.3, treble: 0.1, rms: 0.4, beat: 0, onset: false, centroid: 0.5, air: 0.1 } };
}

function runFresh() {
  const { dom, layerList } = makeDom();
  const sandbox = {
    window: {},
    document: dom,
    console: { warn() {}, log() {}, info() {}, error() {} },
    Audio: makeAudio,
    setStatus: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem: () => {} },
    performance: { now: () => 0 },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.window.__layerList = layerList;
  return sandbox.window;
}

// The rendered tree: #layer-list holds one fragment whose children are
// the group headers and the layer cards, in render order.
function rendered(w) {
  const ll = w.__layerList;
  const frag = ll.children[0];
  return frag ? frag.children : [];
}
function headersOf(w) {
  return rendered(w).filter((el) => String(el.className).indexOf('layer-group') === 0);
}
function cardsOf(w) {
  return rendered(w).filter((el) => String(el.className).indexOf('layer') === 0 && String(el.className).indexOf('layer-group') !== 0);
}
function cardFor(w, id) {
  return cardsOf(w).find((el) => el.dataset.id === id) || null;
}

function addLayers(w, n) {
  const L = w.Layers;
  for (let i = 0; i < n; i++) {
    L.add({ name: 'a' + i, type: 'image', url: 'data:url' });
  }
  return L.list;
}

// ---- checks --------------------------------------------------------------

check('shift+click marks a layer; a second shift+click marks another', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  if (L.selection.length !== 2) return 'selection size: ' + L.selection.length;
  if (L.selection.indexOf(L.list[0].id) < 0) return 'first layer not marked';
  if (L.selection.indexOf(L.list[1].id) < 0) return 'second layer not marked';
  return true;
});

check('shift+click on the same layer twice unmarks it', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[0].id);
  if (L.selection.length !== 0) return 'selection size: ' + L.selection.length;
  return true;
});

check('a plain select() clears the multi-selection', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  L.select(L.list[2]);
  if (L.selection.length !== 0) return 'selection not cleared: ' + L.selection.length;
  return true;
});

check('marked layers carry the multi-selected class in the panel', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const a = cardFor(w, L.list[0].id);
  const b = cardFor(w, L.list[1].id);
  if (!a || !b) return 'layer cards not rendered';
  if (String(a.className).indexOf('multi-selected') < 0) return 'first card not marked: ' + a.className;
  if (String(b.className).indexOf('multi-selected') < 0) return 'second card not marked: ' + b.className;
  return true;
});

check('a plain select() also clears the multi-select ring from the panel', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const marked = cardFor(w, L.list[0].id);
  if (!marked) return 'layer cards not rendered';
  if (String(marked.className).indexOf('multi-selected') < 0) return 'card not marked before the plain select';
  // select() does not re-render — the rings have to come off the DOM
  // in the same call, or the user keeps seeing the marks they cleared.
  L.select(L.list[2]);
  const after = cardFor(w, L.list[0].id);
  if (!after) return 'layer cards gone after select';
  if (String(after.className).indexOf('multi-selected') >= 0) return 'multi-selected ring survived: ' + after.className;
  const active = cardFor(w, L.list[2].id);
  if (!active) return 'active card not rendered';
  if (String(active.className).indexOf('selected') < 0) return 'active card not marked: ' + active.className;
  return true;
});

check('groupSelected() refuses to group fewer than two layers', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  const g = L.groupSelected();
  if (g !== null) return 'group created from one layer';
  if (L.groups.length !== 0) return 'group list not empty';
  return true;
});

check('groupSelected() binds the marked layers to one group', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  if (!g) return 'no group created';
  if (L.groups.length !== 1) return 'group count: ' + L.groups.length;
  if (L.list[0].groupId !== g.id) return 'first member not bound';
  if (L.list[1].groupId !== g.id) return 'second member not bound';
  if (L.list[2].groupId) return 'unmarked layer was bound';
  if (L.selection.length !== 0) return 'selection not cleared';
  return true;
});

check('the group renders exactly one header, above its first member', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  L.groupSelected();
  const hs = headersOf(w);
  if (hs.length !== 1) return 'header count: ' + hs.length;
  const order = rendered(w);
  const headerAt = order.indexOf(hs[0]);
  const firstMemberAt = order.indexOf(cardFor(w, L.list[0].id));
  if (headerAt < 0 || firstMemberAt < 0) return 'header or member missing from the tree';
  if (headerAt > firstMemberAt) return 'header is not above its first member';
  return true;
});

check('a collapsed group renders its header but no member cards', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  L.toggleGroupCollapsed(g.id);
  if (headersOf(w).length !== 1) return 'header count: ' + headersOf(w).length;
  if (cardFor(w, L.list[0].id)) return 'member card still rendered while collapsed';
  if (cardFor(w, L.list[1].id)) return 'member card still rendered while collapsed';
  if (!cardFor(w, L.list[2].id)) return 'ungrouped layer card disappeared';
  return true;
});

check('group visibility writes hidden on every member', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  L.setGroupVisible(g.id, false);
  if (!L.list[0].hidden || !L.list[1].hidden) return 'members not hidden';
  if (L.list[2].hidden) return 'ungrouped layer hidden';
  if (L.visibleList().length !== 1) return 'visible count: ' + L.visibleList().length;
  L.setGroupVisible(g.id, true);
  if (L.list[0].hidden || L.list[1].hidden) return 'members not restored';
  if (L.visibleList().length !== 3) return 'visible count after restore: ' + L.visibleList().length;
  return true;
});

check('a hidden group member is dimmed in the panel', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  L.setGroupVisible(g.id, false);
  const card = cardFor(w, L.list[0].id);
  if (!card) return 'member card not rendered';
  if (String(card.className).indexOf('hidden-layer') < 0) return 'card not dimmed: ' + card.className;
  return true;
});

check('ungroup() dissolves the group and restores the members', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  L.ungroup(g.id);
  if (L.groups.length !== 0) return 'group list not empty';
  if (L.list[0].groupId || L.list[1].groupId) return 'members still bound';
  if (L.list[0].hidden || L.list[1].hidden) return 'members still hidden';
  if (headersOf(w).length !== 0) return 'header still rendered';
  return true;
});

check('removing the last member of a group drops the group', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  const ids = L.list.map((l) => l.id);
  L.remove(ids[0]);
  if (L.groups.length !== 1) return 'group dropped too early: ' + L.groups.length;
  L.remove(ids[1]);
  if (L.groups.length !== 0) return 'group survived its last member';
  return true;
});

check('renaming a group updates the record', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  if (L.renameGroup(g.id, '  Intro  ') !== true) return 'rename rejected';
  if (L.groups[0].name !== 'Intro') return 'name not applied: ' + L.groups[0].name;
  return true;
});

check('an empty group name is rejected and the old one is kept', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  L.renameGroup(g.id, 'Intro');
  if (L.renameGroup(g.id, '   ') !== false) return 'empty name accepted';
  if (L.groups[0].name !== 'Intro') return 'name changed anyway: ' + L.groups[0].name;
  return true;
});

check('a group name with a quote is set as a property, not interpolated', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 2);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  const g = L.groupSelected();
  const tricky = 'A "quoted" name';
  L.renameGroup(g.id, tricky);
  L.render();
  const header = headersOf(w)[0];
  if (!header) return 'header not rendered';
  // The name must not have leaked into the markup: the header's HTML
  // carries no name at all (it is set as a property on the input).
  if (String(header.innerHTML).indexOf('quoted') >= 0) {
    return 'name interpolated into the markup: ' + header.innerHTML;
  }
  if (L.groups[0].name !== tricky) return 'name not stored: ' + L.groups[0].name;
  return true;
});

check('groupsOf() maps a layer to its group, null when ungrouped', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  L.groupSelected();
  if (!L.groupsOf(L.list[0])) return 'member has no group';
  if (L.groupsOf(L.list[2])) return 'ungrouped layer reported a group';
  return true;
});

check('a group survives a re-render of the panel', () => {
  const w = runFresh();
  const L = w.Layers;
  addLayers(w, 3);
  L.toggleSelect(L.list[0].id);
  L.toggleSelect(L.list[1].id);
  L.groupSelected();
  L.render();
  if (headersOf(w).length !== 1) return 'header count after re-render: ' + headersOf(w).length;
  if (cardsOf(w).length !== 3) return 'card count after re-render: ' + cardsOf(w).length;
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
