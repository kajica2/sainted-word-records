// scripts/check-quota-eviction.mjs - integration test for the IndexedDB
// quota-eviction policy in lib/media-store.client.js (P0.2 of the
// architecture audit, docs/PLANS/architecture-audit-2026-10.md).
//
// What it asserts, all against a REAL IndexedDB in a real headless
// Chrome served from a real http origin (IndexedDB needs a non-opaque
// origin, so neither about:blank nor a data: URL will do):
//
//   1. The store holds 100+ records ("past its budget" in the sense the
//      policy cares about: a library with more in it than one free slot).
//   2. When a write trips QuotaExceededError, the OLDEST record is
//      evicted and the SAME batch is written on a single retry, so the
//      caller's promise resolves instead of rejecting.
//   3. A record with favorite === true is never the victim, even when it
//      is the oldest record in the store.
//   4. Every drop bumps the persisted counter (localStorage
//      'quota-evictions-count' + 'quota-evictions-total'), which is what
//      backs a "Storage auto-cleaned N times today" status line.
//   5. When the retry ALSO fails (a genuinely full disk), the rejection
//      carries .code === 'QUOTA_EXCEEDED' and a populated .usage from
//      navigator.storage.estimate(), and it is the ORIGINAL error, not
//      the retry's.
//   6. When there is nothing safe to drop (every record is a favorite)
//      the error propagates and NO counter moves.
//
// How the quota is tripped without waiting for a real disk to fill:
//
// fake-indexeddb is not a dependency of this repo and a real origin
// budget is hundreds of MB, so the fault is injected at the one seam the
// browser will not let a test control: IDBTransaction#abort(). The page
// installs a one-shot wrapper on IDBObjectStore#put that aborts the
// write transaction and renames the resulting AbortError DOMException to
// QuotaExceededError. Everything downstream of that - the real
// transaction, the real abort, the real navigator.storage.estimate(), the
// real eviction transaction, the real retry - is the production code
// path, unmodified.
//
// Run:  node scripts/check-quota-eviction.mjs
// Exit: 0 = PASSED, 1 = any assertion failed.
//
// Env-skip (same marker convention as check-capture-smoke / the
// magenta-dsp bundle builder): puppeteer or its bundled Chrome missing
// prints "(env skip: ...)" and exits 0, because the resource lives
// outside this repo. A real assertion failure still exits 1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODULE_PATH = join(ROOT, 'lib/media-store.client.js');
const PORT = 5197;

const moduleSrc = readFileSync(MODULE_PATH, 'utf8');

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (!cond) failed++;
}

// ---- static source checks (cheap, and they survive an env skip) -------
// The behavioural half below needs a browser; these do not, so a typo in
// the policy is still caught on a machine with no Chrome.

check('evictOldestOne() is defined', /function evictOldestOne\(\) \{/.test(moduleSrc));
check(
  'evictOldestOne() opens a readwrite transaction over the media store',
  /function evictOldestOne\(\)[\s\S]*?transaction\(STORE, 'readwrite'\)/.test(moduleSrc)
);
check(
  'evictOldestOne() deletes the chosen record and returns it',
  /if \(victim\) store\.delete\(victim\.id\);[\s\S]*?resolve\(victim \|\| null\)/.test(moduleSrc)
);
check(
  'favorite records are excluded from eviction',
  /rec\.favorite === true\) continue;/.test(moduleSrc)
);
check(
  'the quota catch handler is async and retries once',
  /\.catch\(async function \(e\) \{/.test(moduleSrc) && /await putRecords\(mediaRecs\)/.test(moduleSrc)
);
check(
  'the counter keys are quota-evictions-count / -day / -total',
  /'quota-evictions-count'/.test(moduleSrc) &&
  /'quota-evictions-day'/.test(moduleSrc) &&
  /'quota-evictions-total'/.test(moduleSrc)
);

// ---- behavioural half: real IndexedDB in real Chrome ------------------

let puppeteer;
try {
  ({ default: puppeteer } = await import('puppeteer'));
} catch {
  console.log('(env skip: puppeteer is not installed)');
  process.exit(0);
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>quota-eviction</title></head>
<body><script src="/media-store.client.js"></script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/media-store.client.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(moduleSrc);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(PAGE);
});
server.on('error', (err) => {
  console.error('QUOTA-EVICTION: cannot bind port ' + PORT + ' - ' + ((err && err.code) || err));
  process.exit(1);
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

let browser;
try {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
} catch (err) {
  server.close();
  console.log('(env skip: puppeteer cannot launch a browser - ' + String(err && err.message).split('\n')[0] + ')');
  process.exit(0);
}

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));
// The auto-clean path logs console.warn on purpose; only page errors matter.
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.SWR_MEDIA, { timeout: 15000 });

// Everything below runs in the page: the fault injector, the fixture and
// the assertions all share one async evaluate so the IDB state cannot be
// pulled out from under itself between steps.
let result;
try {
  result = await page.evaluate(async () => {
  const out = { steps: [], assertions: [] };
  const step = (s) => { out.steps.push(s); };
  try {
  const assert = (name, cond, detail) => out.assertions.push({ name, cond: !!cond, detail: detail || '' });
  const M = window.SWR_MEDIA;

  // ---- fault injector -------------------------------------------------
  // One-shot QuotaExceededError, produced by aborting a real media
  // write transaction and standing in for the DOMException the browser
  // would attach to the failed request. Everything downstream - the
  // transaction, the abort, tx.onerror, navigator.storage.estimate(),
  // the eviction transaction, the retry - is the production code path,
  // unmodified.
  //
  // The transaction error event is patched rather than the abort event
  // because that is the one a real quota failure arrives on: a genuine
  // QuotaExceededError is a request error that bubbles to the
  // transaction and aborts it, so tx.error is that same DOMException.
  // (Chrome reports tx.error as null during the error event of an
  // explicit abort(), so the value is shadowed on the instance.)
  let armed = 0;
  let fired = 0;
  const origPut = IDBObjectStore.prototype.put;
  const patchHandler = (prop) => {
    const desc = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, prop);
    Object.defineProperty(IDBTransaction.prototype, prop, {
      configurable: true,
      get: desc.get,
      set(fn) {
        desc.set.call(this, function (ev) {
          if (this.__quotaFault) {
            this.__quotaFault = false;
            const fake = new DOMException('simulated quota exhaustion', 'QuotaExceededError');
            try { Object.defineProperty(this, 'error', { value: fake, configurable: true }); } catch (_) {}
          }
          return fn.call(this, ev);
        });
      },
    });
  };
  patchHandler('onerror');
  patchHandler('onabort');
  IDBObjectStore.prototype.put = function (value) {
    if (armed > 0 && this.name === 'media' && value && value.name !== 'evict-me') {
      armed--;
      fired++;
      const tx = this.transaction;
      tx.__quotaFault = true;
      setTimeout(() => { try { tx.abort(); } catch (_) {} }, 0);
    }
    return origPut.apply(this, arguments);
  };

  const png = (name) => new File([new Uint8Array(2048)], name, { type: 'image/png' });

  // Direct IDB access so the test can set up state the UI owns but the
  // public API does not expose (favorite, hand-written timestamps).
  const withStore = (mode, fn) => M.db().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('media', mode);
    let value;
    tx.oncomplete = () => resolve(value);
    // Chrome hands the transaction's error event a null tx.error in some
    // builds, so the label carries the context a bare null cannot.
    tx.onerror = () => reject(new Error('withStore ' + mode + ' error: ' + ((tx.error && tx.error.name) || 'null')));
    tx.onabort = () => reject(new Error('withStore ' + mode + ' abort: ' + ((tx.error && tx.error.name) || 'null')));
    fn(tx.objectStore('media'), (v) => { value = v; });
  }));

  await M.deleteAll();
  step('cleared');

  // ---- 1. fill the library: 120 records, distinct timestamps ----------
  let seeded = 0;
  for (let i = 0; i < 120; i++) {
    const [rec] = await M.addMedia([png('clip-' + String(i).padStart(3, '0') + '.png')]);
    await withStore('readwrite', (s) => { s.put(Object.assign({}, rec, { createdAt: 1000 + i })); });
    seeded++;
  }
  const afterSeed = await M.getUserMedia();
  step('seeded ' + seeded);
  assert('store holds 100+ records', afterSeed.length >= 100, afterSeed.length + ' records');

  // ---- 2. the oldest record is a favorite: it must survive ------------
  const oldest = afterSeed.slice().sort((a, b) => a.createdAt - b.createdAt)[0];
  step('oldest=' + (oldest && oldest.name));
  await withStore('readwrite', (s) => { s.put(Object.assign({}, oldest, { favorite: true, createdAt: 1 })); });
  step('favorite marked');
  // Re-read after the favorite is set: the expected victim must be
  // computed from state the store is actually in, not the pre-mark
  // snapshot (which would still list the favorite as evictable).
  const beforeWrite = await M.getUserMedia();

  // ---- 3. quota error -> evict one, retry once, resolve ---------------
  armed = 1;
  const evicted = [];
  const off = M.onChange((e) => { if (e.type === 'evicted') evicted.push(e); });
  const written = await M.addMedia([png('trigger.png')]);
  off();
  step('write recovered');

  const afterWrite = await M.getUserMedia();
  const byName = (n) => afterWrite.find((r) => r.name === n);
  const victim = beforeWrite
    .filter((r) => r.favorite !== true)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))[0];
  assert('the fixture has a non-favorite victim older than the rest', !!victim, victim && victim.name);

  assert('the injected fault fired', fired === 1, 'fired=' + fired);
  assert('the write resolved after one retry', written.length === 1, written.length + ' record(s)');
  assert('the new item is in the store', !!byName('trigger.png'));
  assert(
    'the oldest non-favorite record was evicted',
    !afterWrite.some((r) => r.id === victim.id),
    victim.name
  );
  assert(
    'exactly one record was evicted',
    afterWrite.length === afterSeed.length,
    afterSeed.length + ' -> ' + afterWrite.length
  );
  assert(
    'the favorite record survived',
    !!afterWrite.some((r) => r.id === oldest.id),
    oldest.name
  );
  assert(
    'an evicted event named the dropped record',
    evicted.length === 1 && evicted[0].id === victim.id && evicted[0].count === 1,
    JSON.stringify(evicted)
  );

  // ---- 4. the counter moved ------------------------------------------
  const stats = M.getEvictionStats();
  const rawCount = localStorage.getItem('quota-evictions-count');
  assert('localStorage quota-evictions-count === "1"', rawCount === '1', 'got ' + rawCount);
  assert('getEvictionStats().count === 1', stats.count === 1, JSON.stringify(stats));
  assert('getEvictionStats().total === 1', stats.total === 1, 'total=' + stats.total);

  // ---- 5. retry fails too: rich error, original error propagated ------
  localStorage.setItem('quota-evictions-count', '7');
  armed = 2; // both the first write and the retry fault
  let thrown = null;
  try {
    await M.addMedia([png('too-big.png')]);
  } catch (err) {
    thrown = {
      name: err && err.name,
      code: err && err.code,
      hint: err && err.hint,
      usage: err && err.usage,
      message: err && err.message,
    };
  }
  assert('a full disk still rejects', !!thrown, thrown ? '' : 'no error thrown');
  step('full-disk path returned');
  assert('err.code === QUOTA_EXCEEDED', thrown && thrown.code === 'QUOTA_EXCEEDED', thrown && thrown.code);
  assert(
    'err.usage is populated BEFORE the caller sees it',
    !!(thrown && thrown.usage && typeof thrown.usage.usage === 'number' && typeof thrown.usage.quota === 'number'),
    thrown && thrown.usage ? JSON.stringify(thrown.usage) : 'null'
  );
  assert('err.hint is still attached', !!(thrown && thrown.hint));
  const statsAfter = M.getEvictionStats();
  assert(
    'the counter recorded exactly one more drop',
    statsAfter.count === 8 && statsAfter.total === 2,
    JSON.stringify(statsAfter)
  );
  const afterFail = await M.getUserMedia();
  assert(
    'the failed retry wrote nothing',
    !afterFail.some((r) => r.name === 'too-big.png')
  );

  // ---- 6. nothing safe to drop: propagate, do not touch a favorite ---
  const ids = afterFail.map((r) => r.id);
  await withStore('readwrite', (s) => { s.clear(); });
  for (const r of afterFail) await withStore('readwrite', (s) => { s.put(Object.assign({}, r, { favorite: true })); });
  armed = 1;
  let favoriteErr = null;
  try {
    await M.addMedia([png('nospace.png')]);
  } catch (err) {
    favoriteErr = { name: err && err.name, code: err && err.code };
  }
  const finalItems = await M.getUserMedia();
  step('all-favorite path returned');
  check_after_favorites();
  function check_after_favorites() {
    assert('all-favorite store rejects with QUOTA_EXCEEDED', !!favoriteErr && favoriteErr.code === 'QUOTA_EXCEEDED', JSON.stringify(favoriteErr));
    assert('no favorite was evicted', finalItems.length === ids.length, finalItems.length + ' of ' + ids.length);
    const statsFinal = M.getEvictionStats();
    assert('the counter did not move', statsFinal.total === 2, 'total=' + statsFinal.total);
  }

  IDBObjectStore.prototype.put = origPut;
  await M.deleteAll();
  step('done');
  } catch (err) {
    out.fatal = (err && (err.stack || err.message)) || String(err);
    try { IDBObjectStore.prototype.put = origPut; } catch (_) {}
  }
  return out;
  });
} catch (err) {
  console.error('QUOTA-EVICTION: page evaluation threw - ' + ((err && err.stack) || err));
  await browser.close();
  server.close();
  process.exit(1);
}

if (result.fatal) console.error('  PAGE FATAL: ' + result.fatal.split('\n').slice(0, 4).join('\n  '));
if (result.steps && result.steps.length) console.log('  steps: ' + result.steps.join(' / '));
for (const a of result.assertions) check(a.name, a.cond, a.detail);

await browser.close();
server.close();

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

console.log('');
if (failed) {
  console.log('FAIL - ' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('PASS - quota eviction drops the oldest non-favorite record, retries once, and never loses a favorite');
process.exit(0);