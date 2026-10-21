// scripts/check-store-unit.mjs — unit coverage for the store
// (lib/store.client.js) and the two store scripts.
//
// Contract under test:
//   - the catalogue comes from site-map.json's `store` block, read from the
//     inlined #swr-footer-data slice when the page has one and from
//     /site-map.json when it does not (the dev server)
//   - a payment link is live only when it is a real https URL: the old
//     placeholders (REPLACE_…, SWR_SINGLE_25) are treated as unset
//   - apply() turns [data-stripe-product] elements into working buy
//     buttons when the product has a link, and into an honest disabled
//     state when it does not — never a dead checkout URL
//   - body[data-store-state] tells the page whether payments are live
//   - renderStore() paints the download catalogue: name, blurb, price and
//     a CTA that is "Buy on Gumroad" / "Download" / "Coming soon"
//   - the publish script writes the download URL back into the manifest
//     without reformatting the rest of the file
//   - the build script refuses a source path outside the repo
//
// The store is what makes the marketplace list itself: every product in
// site-map.json shows up without a line of HTML, so the catalogue is
// worth pinning down.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { writeDownloadUrl } from './publish-store-downloads.mjs';
import { resolveSource } from './build-store-downloads.mjs';

const SRC = readFileSync(new URL('../lib/store.client.js', import.meta.url), 'utf8');

const results = [];
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
function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    attrs: {},
    className: '',
    href: '',
    target: '',
    rel: '',
    _text: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text; },
    set(v) { node._text = String(v); if (v === '') node.children.length = 0; },
    enumerable: true,
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return node._html || ''; },
    set(v) { node._html = String(v); node.children.length = 0; },
    enumerable: true,
  });
  return node;
}

function makeEnv({ slice = null, containers = [], buyButtons = [], fetchImpl = null } = {}) {
  const sliceNode = slice ? makeNode('script') : null;
  if (sliceNode) sliceNode.textContent = JSON.stringify(slice);
  const body = makeNode('body');
  const doc = {
    readyState: 'complete',
    body,
    getElementById(id) {
      if (id === 'swr-footer-data') return sliceNode;
      return null;
    },
    createElement(tag) { return makeNode(tag); },
    querySelectorAll(sel) {
      if (sel === '[data-store]') return containers;
      if (sel === '[data-stripe-product]') return buyButtons;
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
  vm.runInContext(src, this.ctx, { filename: 'store.client.js' });
  return this.win.SWR_STORE;
}

const STORE = {
  gumroad: {
    url: 'https://kaidjuric.gumroad.com',
    label: 'Gumroad',
    description: 'Presets, packs and stills.',
  },
  downloads: [
    {
      id: 'preset-pack',
      name: 'SWR Preset Pack',
      blurb: 'Every curated template in one download.',
      price: 19,
      currency: 'EUR',
      source: ['marketplace/curated'],
      gumroadUrl: 'https://kaidjuric.gumroad.com/l/preset-pack',
      downloadUrl: '',
      bytes: 0,
    },
    {
      id: 'generation-archive',
      name: 'Generation Archive',
      blurb: 'The full render history.',
      price: 9,
      currency: 'EUR',
      source: ['generations'],
      gumroadUrl: '',
      downloadUrl: 'https://blob.example/store/generation-archive.zip',
      bytes: 0,
    },
    {
      id: 'pending-pack',
      name: 'Pending Pack',
      blurb: 'Not on sale yet.',
      price: 5,
      currency: 'EUR',
      source: [],
      gumroadUrl: '',
      downloadUrl: '',
      bytes: 0,
    },
  ],
  products: [
    { id: 'logo-tee', name: 'Logo Tee', price: 25, currency: 'EUR', surface: 'shop', stripeUrl: '' },
    { id: 'mug', name: 'Mug', price: 15, currency: 'EUR', surface: 'shop', stripeUrl: 'https://buy.stripe.com/REPLACE_MUG_15' },
    { id: 'swr-single', name: 'SWR Single', price: 25, currency: 'EUR', surface: 'campaign', stripeUrl: 'https://buy.stripe.com/live_single' },
  ],
};

function makeBuyButton(id) {
  const el = makeNode('a');
  el.setAttribute('data-stripe-product', id);
  el.setAttribute('href', '#');
  return el;
}

async function main() {
  // ---- the data ------------------------------------------------------------

  await check('reads the store from the inlined slice, no fetch', () => {
    const env = makeEnv({ slice: { store: STORE } });
    let fetched = false;
    env.ctx.fetch = async () => { fetched = true; return { json: async () => ({}) }; };
    const api = run.call(env, SRC);
    if (fetched) return 'fetched even though the slice carried the store';
    if (api.downloads().length !== 3) return 'expected 3 downloads, got ' + api.downloads().length;
    return true;
  });

  await check('falls back to /site-map.json when there is no slice', async () => {
    let asked = '';
    const env = makeEnv({
      slice: null,
      fetchImpl: async (url) => { asked = url; return { ok: true, json: async () => ({ store: STORE }) }; },
    });
    const api = run.call(env, SRC);
    if (asked !== '/site-map.json') return 'did not fetch /site-map.json';
    // The fetch resolves on the microtask queue.
    await new Promise(r => setTimeout(r, 0));
    if (api.downloads().length !== 3) return 'store empty after the fallback fetch';
    return true;
  });

  await check('gumroad() returns the store, null when there is none', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (!api.gumroad() || api.gumroad().url !== 'https://kaidjuric.gumroad.com') return 'gumroad() is wrong';
    const empty = makeEnv({ slice: {} });
    const api2 = run.call(empty, SRC);
    if (api2.gumroad() !== null) return 'expected null without a store block';
    return true;
  });

  await check('download(id) finds one product and rejects an unknown id', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (!api.download('preset-pack')) return 'preset-pack not found';
    if (api.download('nope') !== null) return 'expected null for an unknown id';
    return true;
  });

  await check('price() formats the currency', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (api.price({ price: 19, currency: 'EUR' }) !== '€19') return 'EUR is wrong';
    if (api.price({ price: 19, currency: 'USD' }) !== '$19') return 'USD is wrong';
    if (api.price({ price: 19, currency: 'GBP' }) !== 'GBP 19') return 'GBP is wrong';
    if (api.price({}) !== '') return 'expected an empty price';
    return true;
  });

  // ---- links ---------------------------------------------------------------

  await check('isLiveLink rejects placeholders and non-https URLs', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (!api.isLiveLink('https://buy.stripe.com/live_single')) return 'a real link was rejected';
    if (api.isLiveLink('https://buy.stripe.com/REPLACE_MUG_15')) return 'REPLACE_ was accepted';
    if (api.isLiveLink('https://buy.stripe.com/SWR_SINGLE_25')) return 'SWR_SINGLE_25 was accepted';
    if (api.isLiveLink('http://buy.stripe.com/live')) return 'http was accepted';
    if (api.isLiveLink('https://xxx')) return 'a placeholder host was accepted';
    if (api.isLiveLink('')) return 'an empty link was accepted';
    if (api.isLiveLink(undefined)) return 'undefined was accepted';
    if (!api.isLiveLink('https://kaidjuric.gumroad.com/l/xxx-preset')) return 'a real URL with xxx in the path was rejected';
    return true;
  });

  await check('link(id) is empty for a product without a live link', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (api.link('swr-single') !== 'https://buy.stripe.com/live_single') return 'the live link was not returned';
    if (api.link('mug') !== '') return 'a placeholder link was returned';
    if (api.link('logo-tee') !== '') return 'an empty link was returned';
    if (api.link('nope') !== '') return 'expected an empty link for an unknown id';
    return true;
  });

  await check('paymentsLive() follows the links', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    if (!api.paymentsLive()) return 'expected live payments (swr-single has a link)';
    const none = makeEnv({ slice: { store: { ...STORE, products: [STORE.products[0], STORE.products[1]] } } });
    const api2 = run.call(none, SRC);
    if (api2.paymentsLive()) return 'expected pending payments';
    return true;
  });

  // ---- apply() -------------------------------------------------------------

  await check('apply() wires a live buy button', () => {
    const btn = makeBuyButton('swr-single');
    const env = makeEnv({ slice: { store: STORE }, buyButtons: [btn] });
    const api = run.call(env, SRC);
    if (btn.getAttribute('href') !== 'https://buy.stripe.com/live_single') return 'href was not set';
    if (btn.getAttribute('data-stripe-state') !== 'live') return 'state is not live';
    if (btn.getAttribute('aria-disabled')) return 'aria-disabled was not removed';
    if (api.apply() !== 1) return 'apply() did not report one button';
    return true;
  });

  await check('apply() disables a button without a link — never a dead URL', () => {
    const btn = makeBuyButton('mug');
    const env = makeEnv({ slice: { store: STORE }, buyButtons: [btn] });
    run.call(env, SRC);
    if (btn.getAttribute('href') !== '#') return 'href is not #';
    if (btn.getAttribute('data-stripe-state') !== 'pending') return 'state is not pending';
    if (btn.getAttribute('aria-disabled') !== 'true') return 'aria-disabled is missing';
    return true;
  });

  await check('apply() keeps a self-owned href when asked to', () => {
    const btn = makeBuyButton('mug');
    btn.setAttribute('data-stripe-keep-href', '');
    btn.setAttribute('href', '/shop.html');
    const env = makeEnv({ slice: { store: STORE }, buyButtons: [btn] });
    run.call(env, SRC);
    if (btn.getAttribute('href') !== '/shop.html') return 'the href was replaced';
    return true;
  });

  await check('apply() sets body[data-store-state]', () => {
    const env = makeEnv({ slice: { store: STORE } });
    run.call(env, SRC);
    if (env.doc.body.getAttribute('data-store-state') !== 'live') return 'expected live';
    const none = makeEnv({ slice: { store: { ...STORE, products: [] } } });
    run.call(none, SRC);
    if (none.doc.body.getAttribute('data-store-state') !== 'pending') return 'expected pending';
    return true;
  });

  // ---- renderStore() -------------------------------------------------------

  await check('renderStore() paints one card per download', () => {
    const container = makeNode('div');
    container.setAttribute('data-store', 'downloads');
    const env = makeEnv({ slice: { store: STORE }, containers: [container] });
    const api = run.call(env, SRC);
    if (api.renderStore(container) !== 3) return 'expected 3 products';
    const grid = container.children.find(c => c.className === 'store__grid');
    if (!grid) return 'no grid was painted';
    if (grid.children.length !== 3) return 'expected 3 cards, got ' + grid.children.length;
    const names = grid.children.map(c => c.children[0].textContent);
    if (names[0] !== 'SWR Preset Pack') return 'the first card is ' + names[0];
    return true;
  });

  await check('renderStore() links to Gumroad when the product is on sale', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    api.renderStore(container);
    const grid = container.children.find(c => c.className === 'store__grid');
    const card = grid.children[0];
    const cta = card.children.find(c => c.className === 'store__cta');
    if (cta.href !== 'https://kaidjuric.gumroad.com/l/preset-pack') return 'href is ' + cta.href;
    if (cta.textContent !== 'Buy on Gumroad →') return 'label is ' + cta.textContent;
    if (cta.target !== '_blank' || cta.rel !== 'noopener') return 'external link attributes are missing';
    return true;
  });

  await check('renderStore() falls back to the download URL', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    api.renderStore(container);
    const grid = container.children.find(c => c.className === 'store__grid');
    const cta = grid.children[1].children.find(c => c.className === 'store__cta');
    if (cta.href !== 'https://blob.example/store/generation-archive.zip') return 'href is ' + cta.href;
    if (cta.textContent !== 'Download →') return 'label is ' + cta.textContent;
    return true;
  });

  await check('renderStore() shows a product without a link as coming soon', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    api.renderStore(container);
    const grid = container.children.find(c => c.className === 'store__grid');
    const cta = grid.children[2].children.find(c => c.className === 'store__cta');
    if (cta.textContent !== 'Coming soon') return 'label is ' + cta.textContent;
    if (cta.getAttribute('aria-disabled') !== 'true') return 'aria-disabled is missing';
    if (cta.href) return 'a pending product must not carry a URL';
    return true;
  });

  await check('renderStore() paints the store link', () => {
    const container = makeNode('div');
    const env = makeEnv({ slice: { store: STORE } });
    const api = run.call(env, SRC);
    api.renderStore(container);
    const link = container.children.find(c => c.className === 'store__store-link');
    if (!link) return 'no store link was painted';
    if (link.href !== 'https://kaidjuric.gumroad.com') return 'href is ' + link.href;
    return true;
  });

  await check('mountAll() paints every [data-store] container', () => {
    const a = makeNode('div');
    const b = makeNode('div');
    a.setAttribute('data-store', 'downloads');
    b.setAttribute('data-store', 'downloads');
    const env = makeEnv({ slice: { store: STORE }, containers: [a, b] });
    const api = run.call(env, SRC);
    if (api.mountAll() !== 6) return 'expected 6 products across two containers';
    return true;
  });

  await check('the module is idempotent', () => {
    const env = makeEnv({ slice: { store: STORE } });
    const first = run.call(env, SRC);
    const second = run.call(env, SRC);
    if (first !== second) return 'the global was redefined';
    return true;
  });

  // ---- the publish script --------------------------------------------------

  await check('writeDownloadUrl edits the right product and nothing else', () => {
    const text = readFileSync(new URL('../site-map.json', import.meta.url), 'utf8');
    const before = JSON.parse(text);
    const updated = writeDownloadUrl(text, 'preset-pack', 'https://blob.example/store/preset-pack.zip', 67291);
    const after = JSON.parse(updated);
    const d = after.store.downloads.find(x => x.id === 'preset-pack');
    if (!d) return 'the product is gone';
    if (d.downloadUrl !== 'https://blob.example/store/preset-pack.zip') return 'downloadUrl is ' + d.downloadUrl;
    if (d.bytes !== 67291) return 'bytes is ' + d.bytes;
    if (after.store.downloads.length !== before.store.downloads.length) return 'the product count changed';
    if (after.store.gumroad.url !== before.store.gumroad.url) return 'the gumroad block changed';
    if (after.store.products.length !== before.store.products.length) return 'the stripe products changed';
    // The rest of the file must be byte-identical.
    if (updated.length === text.length && updated === text) return 'nothing changed';
    const changedLines = updated.split('\n').filter((l, i) => l !== text.split('\n')[i]);
    if (changedLines.length > 2) return 'more than the two expected lines changed: ' + changedLines.length;
    return true;
  });

  await check('writeDownloadUrl leaves an unknown id alone', () => {
    const text = readFileSync(new URL('../site-map.json', import.meta.url), 'utf8');
    if (writeDownloadUrl(text, 'nope', 'https://example.com/x.zip', 1) !== text) return 'the file changed';
    return true;
  });

  // ---- the build script ----------------------------------------------------

  await check('resolveSource refuses a path outside the repo', () => {
    let threw = false;
    try {
      resolveSource('../..');
    } catch (e) {
      threw = true;
    }
    if (!threw) return 'a path outside the repo was accepted';
    return true;
  });

  await check('resolveSource accepts a repo directory', () => {
    const abs = resolveSource('marketplace/curated');
    if (!abs.endsWith('marketplace/curated')) return 'resolved to ' + abs;
    return true;
  });
}

// ---- the report ----------------------------------------------------------

await main();

const failed = results.filter(r => !r.ok);
console.log('');
if (failed.length) {
  console.log(`STORE UNIT: ${failed.length} of ${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`STORE UNIT: all ${results.length} checks passed`);
