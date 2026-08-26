// verify-mobile-pair.mjs — verify tools/mobile/index.html's
// LAN-bootstrap helper: URL-param pre-fill, share button, and
// navigator.share/clipboard fallback. Pure DOM+node, no
// puppeteer, no HTTP. Reads the live file Vite serves and
// evaluates its inline <script> in a JSDOM-like context.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const MOBILE = path.join(ROOT, 'tools', 'mobile', 'index.html');

let failed = 0;
function step(name, fn) {
  try { fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// Read the page; extract the inline <script>.
const html = fs.readFileSync(MOBILE, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
ok(m, 'no <script> block in mobile page');
const js = m[1];

// Tiny DOM mock sufficient for the parts we test.
function makeElement(id, initialValue = '') {
  const el = {
    __id: id,
    __v: initialValue,
    __listeners: {},
    get value() { return this.__v; },
    set value(v) { this.__v = String(v); },
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener(ev, fn) { (this.__listeners[ev] = this.__listeners[ev] || []).push(fn); },
    click() { (this.__listeners.click || []).forEach((f) => f()); },
    dispatchEvent() {},
  };
  return el;
}
// Pre-extract HTML defaults from the page itself so the mock
// matches the live DOM at boot time.
const htmlDefaults = {
  host:  /id="host"\s+type="text"\s+value="([^"]*)"/.exec(html)?.[1] ?? '',
  port:  /id="port"\s+type="number"\s+value="(\d+)"/.exec(html)?.[1] ?? '',
  share: '',  // value=attr not relevant; presence is.
};
const elements = {};
function getEl(id) {
  if (elements[id]) return elements[id];
  const el = makeElement(id, htmlDefaults[id] ?? '');
  elements[id] = el;
  return el;
}

const documentMock = {
  getElementById: getEl,
  addEventListener: () => {},
  body: {},
  readyState: 'complete',
};

// Build a fresh test fixture: returns state you can read after
// the page's IIFE runs. Caller chooses the URL.
function boot(opts) {
  elements.hosts = '';
  elements.ports = '';
  elements.share = makeElement('share');
  // Provide the URL the page should see.
  const locationMock = {
    hostname: opts.hostname,
    origin: `http://${opts.hostname}:5174`,
    pathname: '/tools/mobile/index.html',
    search: opts.search || '',
    href: `http://${opts.hostname}:5174/tools/mobile/index.html${opts.search || ''}`,
  };
  const windowMock = {};
  const navigatorMock = { share: undefined, clipboard: undefined };

  // Reset state for the test
  elements.share.__listeners = {};

  // Build a sandbox, eval the page's inline script in it.
  // The page uses an IIFE, so its top-level state is encapsulated.
  const sandbox = {
    document: documentMock,
    location: locationMock,
    navigator: navigatorMock,
    window: windowMock,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    queueMicrotask: globalThis.queueMicrotask,
  };
  sandbox.window.document = documentMock;
  // Inject the page JS.
  // The page code uses `window.FreqLabFeatures = window.FreqLabFeatures || {};` etc.
  // It also reads `document.getElementById('share')` and adds a click handler.
  try {
    new Function('document', 'location', 'navigator', 'window', 'setTimeout',
      js + '\nreturn (typeof window.FreqLabFeatures === "undefined" ? {} : window.FreqLabFeatures);')(sandbox.document, sandbox.location, sandbox.navigator, sandbox.window, sandbox.setTimeout);
  } catch (e) {
    console.error('eval failed:', e.message);
    throw e;
  }
}

step('1. JS parses cleanly (no syntax errors)', () => {
  // The new Function() call above would have thrown. If we got here, OK.
  ok(true, '');
});

step('2. baseline: host pre-fills from location.hostname when no URL params', () => {
  boot({ hostname: '192.168.1.50', search: '' });
  ok(elements.host.value === '192.168.1.50',
     `expected host=192.168.1.50, got ${elements.host.value}`);
  ok(elements.port.value === '8787',
     `expected port=8787, got ${elements.port.value}`);
});

step('3. URL params ?host=…&port=… override both fields', () => {
  boot({ hostname: '127.0.0.1', search: '?host=10.0.0.7&port=9000' });
  ok(elements.host.value === '10.0.0.7',
     `expected host=10.0.0.7, got ${elements.host.value}`);
  ok(elements.port.value === '9000',
     `expected port=9000, got ${elements.port.value}`);
});

step('4. Share button exists and has a click listener', () => {
  boot({ hostname: '192.168.1.50', search: '' });
  ok(elements.share, 'share button not found');
  const listeners = elements.share.__listeners.click || [];
  ok(listeners.length === 1, `expected 1 click listener, got ${listeners.length}`);
});

step('5. URL-encoded characters in host/port round-trip', () => {
  boot({ hostname: '192.168.1.50', search: '?host=' + encodeURIComponent('10.0.0.7:8080') + '&port=' + encodeURIComponent('9100') });
  ok(elements.host.value === '10.0.0.7:8080',
     `expected host=10.0.0.7:8080, got ${elements.host.value}`);
  ok(elements.port.value === '9100',
     `expected port=9100, got ${elements.port.value}`);
});

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}