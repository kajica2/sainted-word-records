// scripts/check-looks-menu-unit.mjs — unit coverage for the
// version-looks dropdown on engine + version pages.
//
// The module (client/looks-menu.client.js) exposes window.SWR_LOOKS
// with .list(), .apply(id), .current(), .groups(), .refresh(). On
// engine.html, the variant group populates from SWR_VARIANTS.list()
// and apply() activates the variant in-place. On a versions/*.html
// page, SWR_VARIANTS is undefined and the variant group falls back
// to a hardcoded nav list — apply() navigates to /versions/<id>.html.
//
// These tests stub window.SWR_VARIANTS, document, fetch, location,
// and the on-page controls to drive the IIFE through the engine and
// version-page code paths.
//
// Run: node scripts/check-looks-menu-unit.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/looks-menu.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function makeSandbox({ onEngine, pathname, variants, hasPresets, hasPresetSelect }) {
  // Variant list shape: [{ id, name, desc }]
  const variantList = variants || [];
  const presetTable = hasPresets ? {
    film: { label: 'Film', desc: '16mm grain' },
    neon: { label: 'Neon', desc: 'Scanlines' },
  } : null;

  const documentElements = {};
  if (onEngine) {
    documentElements['variant'] = {
      value: 'film',
      addEventListener: () => {},
      dispatchEvent: () => {},
    };
  }
  if (hasPresetSelect) {
    documentElements['preset'] = {
      value: 'pulse',
      addEventListener: () => {},
      dispatchEvent: () => {},
    };
  }

  // Append a child to a <span> with class .gctrl and a mount attribute.
  const appended = [];
  // The mount() function inserts into host.parentNode. Build a host
  // node with a parent that has insertBefore.
  const mountHost = {
    isConnected: true,
    appendChild: (c) => c,
    parentNode: { insertBefore: (c, _r) => c, appendChild: (c) => c },
  };
  const doc = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      className: '',
      innerHTML: '',
      appendChild: (c) => c,
      addEventListener: () => {},
      dispatchEvent: () => {},
      querySelector: (sel) => {
        if (sel === '[data-looks-mount]') return mountHost;
        if (sel === '#variant') return documentElements['variant'] || null;
        return null;
      },
      closest: (sel) => {
        if (sel === '.gctrl') return mountHost;
        return null;
      },
    }),
    getElementById: (id) => documentElements[id] || null,
    querySelector: (sel) => {
      if (sel === '[data-looks-mount]') return mountHost;
      return null;
    },
    addEventListener: () => {},
    body: { appendChild: (el) => { appended.push(el); } },
  };

  const win = {
    SWR_VARIANTS: onEngine ? {
      list: () => variantList,
      activate: (id) => { win._activated = id; return Promise.resolve(); },
    } : undefined,
    SWR_LOOKS: undefined,
    FX: onEngine ? {
      setPersona: (p) => { win._persona = p; return true; },
    } : undefined,
    __SWR_PRESETS: presetTable,
    location: {
      pathname,
      assign: (url) => { win._assigned = url; },
    },
  };

  // Capture the engine control elements so the test can read them.
  win._getVariant = () => documentElements['variant'];
  win._getPreset = () => documentElements['preset'];

  const sandbox = {
    console,
    window: win,
    document: doc,
  };
  sandbox.globalThis = sandbox;
  return { sandbox, win, doc, appended };
}

// ---- 1. Engine: SWR_VARIANTS available → "Variant looks" has items --
check('engine page: variant group populates from SWR_VARIANTS.list()', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: true,
    pathname: '/engine.html',
    variants: [
      { id: 'neon',          name: 'Neon',          desc: 'Scanlines' },
      { id: 'film',          name: 'Film',          desc: '16mm grain' },
      { id: 'aurora',        name: 'Aurora',        desc: 'Pastel' },
    ],
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const groups = win.SWR_LOOKS.groups();
  const variantGroup = groups.find((g) => g.id === 'variant');
  if (!variantGroup) return 'no variant group';
  if (variantGroup.items.length !== 3) return `expected 3 items, got ${variantGroup.items.length}`;
  if (variantGroup.items[0].id !== 'neon') return `first item is ${variantGroup.items[0].id}, expected neon`;
  return true;
});

// ---- 2. Engine: all three groups visible when FX + presets loaded --
check('engine page: all three groups (variant, grade, motion) shown', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: true,
    pathname: '/engine.html',
    variants: [{ id: 'neon', name: 'Neon' }, { id: 'film', name: 'Film' }],
    hasPresets: true,
    hasPresetSelect: true,
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const groups = win.SWR_LOOKS.groups();
  const ids = groups.map((g) => g.id);
  if (!ids.includes('variant')) return `no variant group (got ${ids.join(',')})`;
  if (!ids.includes('grade')) return `no grade group (got ${ids.join(',')})`;
  if (!ids.includes('motion')) return `no motion group (got ${ids.join(',')})`;
  return true;
});

// ---- 3. Engine: apply("variant:neon") activates in-place, no nav --
check('engine page: apply("variant:neon") → SWR_VARIANTS.activate() called, no navigation', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: true,
    pathname: '/engine.html',
    variants: [{ id: 'neon', name: 'Neon' }, { id: 'film', name: 'Film' }],
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const ok = win.SWR_LOOKS.apply('variant:neon');
  if (!ok) return 'apply returned false';
  if (win._activated !== 'neon') return `expected activated=neon, got ${win._activated}`;
  if (win._assigned) return `unexpected navigation to ${win._assigned}`;
  return true;
});

// ---- 4. Version page: SWR_VARIANTS undefined → falls back to nav list --
check('version page: variant group uses hardcoded nav fallback when SWR_VARIANTS is undefined', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: false,
    pathname: '/versions/film.html',
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const groups = win.SWR_LOOKS.groups();
  const variantGroup = groups.find((g) => g.id === 'variant');
  if (!variantGroup) return 'no variant group on version page';
  if (variantGroup.items.length < 5) return `expected ≥5 nav items, got ${variantGroup.items.length}`;
  // Should NOT include Grade or Motion (no FX, no #preset).
  if (groups.find((g) => g.id === 'grade')) return 'grade group should not show on version page';
  if (groups.find((g) => g.id === 'motion')) return 'motion group should not show on version page';
  return true;
});

// ---- 5. Version page: apply("variant:aurora") navigates ----------
check('version page: apply("variant:aurora") → location.assign("/versions/aurora.html")', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: false,
    pathname: '/versions/film.html',
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const ok = win.SWR_LOOKS.apply('variant:aurora');
  if (!ok) return 'apply returned false';
  if (win._assigned !== '/versions/aurora.html') return `expected assign=/versions/aurora.html, got ${win._assigned}`;
  return true;
});

// ---- 6. Version page: apply of CURRENT page → no redundant nav --
check('version page: apply of current page → no navigation', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: false,
    pathname: '/versions/film.html',
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const ok = win.SWR_LOOKS.apply('variant:film');
  if (!ok) return 'apply returned false';
  if (win._assigned) return `unexpected navigation to ${win._assigned}`;
  return true;
});

// ---- 7. Version page: apply("variant:music_video_mtv") (underscore ID) navigates --
check('version page: apply with underscore ID navigates to /versions/<id>.html', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: false,
    pathname: '/versions/film.html',
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const ok = win.SWR_LOOKS.apply('variant:music_video_mtv');
  if (!ok) return 'apply returned false';
  if (win._assigned !== '/versions/music_video_mtv.html') return `expected /versions/music_video_mtv.html, got ${win._assigned}`;
  return true;
});

// ---- 8. list() returns flat list across groups ------------------
check('list() returns flat list with group/id/name for every entry', () => {
  const { sandbox, win } = makeSandbox({
    onEngine: true,
    pathname: '/engine.html',
    variants: [{ id: 'neon', name: 'Neon' }, { id: 'film', name: 'Film' }],
    hasPresets: true,
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const list = win.SWR_LOOKS.list();
  if (!Array.isArray(list)) return 'list is not an array';
  for (const it of list) {
    if (!it.group) return `item missing group: ${JSON.stringify(it)}`;
    if (!it.id) return `item missing id: ${JSON.stringify(it)}`;
    if (!it.name) return `item missing name: ${JSON.stringify(it)}`;
  }
  return true;
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0
  ? `LOOKS-MENU UNIT: ALL GREEN (${results.length} checks)`
  : `LOOKS-MENU UNIT: ${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
