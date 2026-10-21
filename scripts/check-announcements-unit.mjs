// scripts/check-announcements-unit.mjs — unit coverage for the auto-post
// feed (lib/announcements.client.js).
//
// Contract under test:
//   - the posts come from site-map.json's `announcements` array, read from
//     the inlined #swr-footer-data slice when the page has one and from
//     /site-map.json when it does not (the dev server)
//   - the array order IS the published order: the first entry is the newest
//   - an entry without a title is dropped; everything else is optional
//   - list(limit) and latest() honour the limit
//   - render() paints date / title / body / link into a container
//   - an external link gets target=_blank and rel=noopener, an internal one
//     does not
//   - every [data-announcements] container is painted automatically
//   - the module is idempotent: re-running the source does not redefine the
//     global

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../lib/announcements.client.js', import.meta.url), 'utf8');

const results = [];
// A check may be sync or async — the fallback load() is a promise, and a
// check that returns one is awaited rather than counted as a failure.
async function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// ---- DOM stub ------------------------------------------------------------
// The feed paints into a container: it clears the container, then appends
// one <article> per post. The stub records the tree so the tests can read
// what was painted.
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    attrs: {},
    className: '',
    textContent: '',
    href: '',
    target: '',
    rel: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
  };
  // textContent = '' clears the children, like the real DOM.
  Object.defineProperty(node, 'textContent', {
    get() { return node._text || ''; },
    set(v) { node._text = String(v); if (v === '') node.children.length = 0; },
    enumerable: true,
  });
  return node;
}

function makeEnv({ slice = null, containers = [], fetchImpl = null } = {}) {
  // One node per id: getElementById must return the same node every call,
  // the way the real DOM does.
  const sliceNode = slice ? makeNode('script') : null;
  if (sliceNode) sliceNode.textContent = JSON.stringify(slice);
  const doc = {
    readyState: 'complete',
    created: [],
    getElementById(id) {
      if (id === 'swr-footer-data') return sliceNode;
      return null;
    },
    createElement(tag) {
      const n = makeNode(tag);
      doc.created.push(n);
      return n;
    },
    querySelector(sel) {
      if (sel.startsWith('#')) return null;
      return containers[0] || null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-announcements]') return containers;
      return [];
    },
    addEventListener() {},
  };
  const win = { document: doc };
  const ctx = {
    window: win,
    document: doc,
    console,
    fetch: fetchImpl || (async () => { throw new Error('fetch not stubbed'); }),
    setTimeout,
    clearTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, win, doc };
}

function run(src) {
  vm.runInContext(src, this.ctx, { filename: 'announcements.client.js' });
  return this.win.SWR_ANNOUNCEMENTS;
}

const POSTS = [
  {
    date: '2026-10-21',
    title: 'The Gumroad store is open',
    body: 'Presets, packs and stills, with checkout and delivery handled by Gumroad.',
    href: 'https://kaidjuric.gumroad.com',
    label: 'Open the store',
  },
  {
    date: '2026-10-20',
    title: 'Mood Frames, on the digital twin',
    body: 'Eight stills in the house sound-tones.',
    href: 'https://digitaltwin-ebon.vercel.app/pages/marketplace.html',
    label: 'Open the marketplace',
  },
];

async function main() {
  // ---- the data ------------------------------------------------------------

  await check('reads the posts from the inlined slice, no fetch', () => {
    const container = makeNode('div');
    container.setAttribute('data-announcements', '5');
    const env = makeEnv({ slice: { announcements: POSTS }, containers: [container] });
    let fetched = false;
    env.ctx.fetch = async () => { fetched = true; return { json: async () => ({}) }; };
    const api = run.call(env, SRC);
    if (fetched) return 'fetched even though the slice carried the posts';
    if (api.list().length !== 2) return 'expected 2 posts, got ' + api.list().length;
    if (api.latest().title !== POSTS[0].title) return 'latest() is not the first entry';
    return true;
  });

  await check('falls back to /site-map.json when the slice is absent', async () => {
    const container = makeNode('div');
    container.setAttribute('data-announcements', '5');
    let asked = '';
    const env = makeEnv({
      containers: [container],
      fetchImpl: async (url) => { asked = url; return { json: async () => ({ announcements: POSTS }) }; },
    });
    const api = run.call(env, SRC);
    await api.load();
    if (asked !== '/site-map.json') return 'asked for ' + asked;
    if (api.list().length !== 2) return 'expected 2 posts after the fallback load';
    return true;
  });

  await check('the array order is the published order (first = newest)', () => {
    const env = makeEnv({ slice: { announcements: POSTS } });
    const api = run.call(env, SRC);
    const titles = api.list().map(p => p.title);
    if (titles[0] !== POSTS[0].title) return 'order was changed: ' + titles.join(' | ');
    if (titles[1] !== POSTS[1].title) return 'order was changed: ' + titles.join(' | ');
    return true;
  });

  await check('an entry without a title is dropped', () => {
    const env = makeEnv({
      slice: { announcements: [{ title: 'kept' }, { body: 'no title' }, null, 'string', { title: '   ' }] },
    });
    const api = run.call(env, SRC);
    const list = api.list();
    if (list.length !== 1) return 'expected 1 post, got ' + list.length;
    if (list[0].title !== 'kept') return 'wrong post survived';
    return true;
  });

  await check('list(limit) limits, latest() is the first', () => {
    const env = makeEnv({ slice: { announcements: POSTS } });
    const api = run.call(env, SRC);
    if (api.list(1).length !== 1) return 'list(1) returned ' + api.list(1).length;
    if (api.list(0).length !== 2) return 'list(0) should mean "all", got ' + api.list(0).length;
    if (!api.latest() || api.latest().title !== POSTS[0].title) return 'latest() is wrong';
    return true;
  });

  await check('a missing announcements key means no posts, not a crash', () => {
    const env = makeEnv({ slice: { tools: [] } });
    const api = run.call(env, SRC);
    if (api.list().length !== 0) return 'expected 0 posts';
    if (api.latest() !== null) return 'latest() should be null';
    return true;
  });

  // ---- the rendering -------------------------------------------------------

  await check('render() paints date, title, body and the link', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { announcements: POSTS } });
    const api = run.call(env, SRC);
    const n = api.render(container);
    if (n !== 2) return 'expected 2 painted posts, got ' + n;
    if (container.children.length !== 2) return 'expected 2 children, got ' + container.children.length;
    const first = container.children[0];
    const classes = first.children.map(c => c.className);
    const texts = first.children.map(c => c.textContent);
    if (!classes.includes('announcement__date')) return 'no date node: ' + classes.join(',');
    if (!classes.includes('announcement__title')) return 'no title node: ' + classes.join(',');
    if (!classes.includes('announcement__body')) return 'no body node: ' + classes.join(',');
    if (!classes.includes('announcement__link')) return 'no link node: ' + classes.join(',');
    if (texts[1] !== POSTS[0].title) return 'wrong title painted: ' + texts[1];
    const link = first.children.find(c => c.className === 'announcement__link');
    if (link.href !== POSTS[0].href) return 'wrong href: ' + link.href;
    if (link.textContent !== POSTS[0].label) return 'wrong label: ' + link.textContent;
    return true;
  });

  await check('an external link opens in a new tab, an internal one does not', () => {
    const container = makeNode('div');
    const env = makeEnv({
      slice: { announcements: [
        { title: 'external', href: 'https://kaidjuric.gumroad.com' },
        { title: 'internal', href: '/changelog' },
      ] },
    });
    const api = run.call(env, SRC);
    api.render(container);
    const links = container.children.map(card => card.children.find(c => c.className === 'announcement__link'));
    if (links[0].target !== '_blank') return 'external link has no target';
    if (links[0].rel !== 'noopener') return 'external link has no rel';
    if (links[1].target) return 'internal link should not open in a new tab: ' + links[1].target;
    return true;
  });

  await check('render() clears the container before painting again', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { announcements: POSTS } });
    const api = run.call(env, SRC);
    api.render(container);
    api.render(container, { limit: 1 });
    if (container.children.length !== 1) return 'expected 1 child after a limited repaint, got ' + container.children.length;
    return true;
  });

  await check('the empty text is shown when there is nothing to post', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { announcements: [] } });
    const api = run.call(env, SRC);
    const n = api.render(container, { empty: 'No posts yet.' });
    if (n !== 0) return 'expected 0 painted';
    if (container.children.length !== 1) return 'expected the empty node, got ' + container.children.length;
    if (container.children[0].textContent !== 'No posts yet.') return 'wrong empty text';
    return true;
  });

  await check('[data-announcements] containers are painted automatically', () => {
    const container = makeNode('div');
    container.setAttribute('data-announcements', '1');
    const env = makeEnv({ slice: { announcements: POSTS }, containers: [container] });
    run.call(env, SRC);
    if (container.children.length !== 1) return 'expected 1 painted post, got ' + container.children.length;
    return true;
  });

  await check('the module is idempotent', () => {
    const env = makeEnv({ slice: { announcements: POSTS } });
    const api = run.call(env, SRC);
    const again = run.call(env, SRC);
    if (again !== api) return 'the global was replaced on the second run';
    return true;
  });


}

// ---- the report ----------------------------------------------------------

await main();

const failed = results.filter(r => !r.ok);
console.log('');
if (failed.length) {
  console.log(`ANNOUNCEMENTS UNIT: ${failed.length} of ${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`ANNOUNCEMENTS UNIT: all ${results.length} checks passed`);
