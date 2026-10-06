// scripts/check-invite-redemption-smoke.mjs — Puppeteer smoke for the
// full invite-unlock flow. Loads the three new modules in a minimal
// page (the engine has too much surface to be a fast gate), stubs
// fetch so the redeem endpoint behaves predictably, then asserts:
//   - the rec/export-style gate pops the modal when not unlocked
//   - "Record anyway" closes the modal without flipping the watermark
//   - "Unlock with code" hits /api/invite/redeem and flips both the
//     localStorage flag AND SWR_WATERMARK.setEnabled(false)
//   - a page reload keeps the unlock (flag hydrates the watermark off)
//   - revoke() re-enables the watermark and clears the flag
//
// The smoke does NOT need a real KV. fetch is stubbed to return the
// HTTP responses an operator-issued code would produce. The KV + redeem
// handler's real contract is exercised by the unit suite
// (check-invite-unlock-unit.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.SMOKE_PORT || 5460);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ✓', name, detail || '');
  else      { failures++; console.log('  ✗', name, detail || ''); }
}

// --- minimal host page: just the three new modules + a fake rec btn.
const HOST_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>invite smoke</title></head><body>
  <button id="rec">REC</button>
  <button id="export">EXPORT</button>
  <script src="/lib/watermark.client.js" defer></script>
  <script src="/lib/invite-unlock.client.js" defer></script>
  <script src="/lib/invite-modal.client.js" defer></script>
  <script>
    function withInviteGate(fn) {
      return function () {
        var u = window.SWR_INVITE_UNLOCK;
        if (u && typeof u.isUnlocked === 'function' && u.isUnlocked()) return fn();
        if (!window.SWR_INVITE_MODAL || typeof window.SWR_INVITE_MODAL.show !== 'function') return fn();
        window.SWR_INVITE_MODAL.show();
        if (!window.__swrInviteGateHandler) {
          window.__swrInviteGateHandler = function () {
            var armed = window.__swrInviteArmed;
            if (!armed) return;
            window.__swrInviteArmed = null;
            clearTimeout(armed.timeout);
            armed.resolve();
          };
          document.addEventListener('swr-invite-unlocked', window.__swrInviteGateHandler);
          document.addEventListener('swr-invite-skipped',   window.__swrInviteGateHandler);
        }
        if (window.__swrInviteArmed) window.__swrInviteArmed.resolve();
        window.__swrInviteArmed = null;
        return new Promise(function (resolve) {
          var armed = { resolve: resolve, timeout: setTimeout(resolve, 5 * 60 * 1000) };
          window.__swrInviteArmed = armed;
        }).then(fn);
      };
    }
    // Defer the binding until the unlock/modal modules have finished
    // (they are loaded with defer, so they run before DOMContentLoaded;
    // by the time this script executes at the end of body, both
    // SWR_INVITE_UNLOCK and SWR_INVITE_MODAL are defined).
    document.getElementById('rec').addEventListener('click', withInviteGate(function () {
      document.body.dataset.recFired = String(parseInt(document.body.dataset.recFired || '0') + 1);
    }));
    document.getElementById('export').addEventListener('click', withInviteGate(function () {
      document.body.dataset.exportFired = String(parseInt(document.body.dataset.exportFired || '0') + 1);
    }));
  </script>
</body></html>
`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(HOST_HTML);
    return;
  }
  // Serve repo root files (the three new client.js modules).
  const f = path.join(ROOT, req.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  const ext = path.extname(f).slice(1);
  res.setHeader('Content-Type', ext === 'js' ? 'application/javascript' : (ext === 'html' ? 'text/html' : 'application/octet-stream'));
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('PAGE: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('/api/') || t.includes('/null')) return; // dev-server noise
      pageErrors.push('CON:  ' + t);
    }
  });

  // fetch stub: simulate 200 OK for valid code, 404 for invalid.
  await page.evaluateOnNewDocument(() => {
    window.__fetchLog = [];
    window.fetch = (url, init) => {
      window.__fetchLog.push({ url: String(url), method: (init && init.method) || 'GET' });
      if (typeof url === 'string' && url.includes('/api/invite/redeem')) {
        let body = null;
        try { body = JSON.parse(init && init.body); } catch (_) {}
        const code = body && body.code;
        if (typeof code === 'string' && /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/.test(code)) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'invalid_or_disabled_code' }) });
      }
      return Promise.reject(new Error('fetch stub: unhandled ' + url));
    };
  });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));

  console.log('invite-redemption smoke');

  // --- initial state ---
  const init = await page.evaluate(() => ({
    unlockApi: typeof window.SWR_INVITE_UNLOCK,
    modalApi: typeof window.SWR_INVITE_MODAL,
    watermarkApi: typeof window.SWR_WATERMARK,
    unlocked: window.SWR_INVITE_UNLOCK && window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK && window.SWR_WATERMARK.isEnabled(),
    lsFlag: localStorage.getItem('swr.inviteUnlocked'),
  }));
  check('all three modules loaded', init.unlockApi === 'object' && init.modalApi === 'object' && init.watermarkApi === 'object');
  check('initial: not unlocked', init.unlocked === false);
  check('initial: watermark is on', init.watermarkEnabled === true);
  check('initial: no localStorage flag', init.lsFlag === null);

  // --- click rec → modal appears, action does NOT fire yet ---
  await page.evaluate(() => document.getElementById('rec').click());
  await new Promise(r => setTimeout(r, 300));
  const afterClick = await page.evaluate(() => ({
    modalVisible: document.getElementById('swr-invite-modal-host') && document.getElementById('swr-invite-modal-host').style.display,
    recFired: document.body.dataset.recFired,
  }));
  check('gate opens the modal on rec click', afterClick.modalVisible === 'flex');
  check('rec action did not fire while modal is up', !afterClick.recFired);

  // --- click "Record anyway" → modal closes, action fires, no unlock ---
  await page.evaluate(() => {
    const host = document.getElementById('swr-invite-modal-host');
    for (const b of host.querySelectorAll('button')) if (b.textContent.trim() === 'Record anyway') b.click();
  });
  await new Promise(r => setTimeout(r, 300));
  const afterSkip = await page.evaluate(() => ({
    modalDisplay: (document.getElementById('swr-invite-modal-host') || {}).style?.display,
    recFired: document.body.dataset.recFired,
    unlocked: window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK.isEnabled(),
    fetchLog: window.__fetchLog,
  }));
  check('Record anyway closes the modal', afterSkip.modalDisplay === 'none');
  check('Record anyway fires the rec action', afterSkip.recFired === '1');
  check('Record anyway does NOT unlock', afterSkip.unlocked === false);
  check('Record anyway does NOT touch the watermark', afterSkip.watermarkEnabled === true);
  check('Record anyway does NOT call /api/invite/redeem', afterSkip.fetchLog.length === 0);

  // --- type an INVALID code → modal stays open + status text ---
  await page.evaluate(() => document.getElementById('rec').click());
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const host = document.getElementById('swr-invite-modal-host');
    host.querySelector('input').value = 'BAD-CODE-FORMAT';
    for (const b of host.querySelectorAll('button')) if (b.textContent.trim() === 'Unlock with code') b.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const afterBad = await page.evaluate(() => ({
    modalVisible: document.getElementById('swr-invite-modal-host') && document.getElementById('swr-invite-modal-host').style.display,
    unlocked: window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK.isEnabled(),
    statusText: document.querySelector('.swr-im-status') && document.querySelector('.swr-im-status').textContent,
  }));
  check('invalid code keeps the modal open', afterBad.modalVisible === 'flex');
  check('invalid code did NOT unlock', afterBad.unlocked === false);
  check('invalid code did NOT turn off the watermark', afterBad.watermarkEnabled === true);
  check('invalid code shows an error status', /not recognized/i.test(afterBad.statusText || ''));

  // --- type a VALID code → modal closes, unlocked, watermark off ---
  await page.evaluate(() => {
    const host = document.getElementById('swr-invite-modal-host');
    host.querySelector('input').value = 'TEST-CODE-1234';
    for (const b of host.querySelectorAll('button')) if (b.textContent.trim() === 'Unlock with code') b.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  const afterGood = await page.evaluate(() => ({
    modalDisplay: (document.getElementById('swr-invite-modal-host') || {}).style?.display,
    unlocked: window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK.isEnabled(),
    lsFlag: localStorage.getItem('swr.inviteUnlocked'),
    recFired: document.body.dataset.recFired,
    fetchLog: window.__fetchLog,
  }));
  check('valid code closes the modal', afterGood.modalDisplay === 'none');
  check('valid code marks unlocked', afterGood.unlocked === true);
  check('valid code turns off the watermark', afterGood.watermarkEnabled === false);
  check('valid code writes the localStorage flag', afterGood.lsFlag === '1');
  check('valid code POSTed to /api/invite/redeem', afterGood.fetchLog.some(f => f.url.includes('/api/invite/redeem') && f.method === 'POST'));
  // After unlock, a click on rec bypasses the modal entirely.
  await page.evaluate(() => document.getElementById('rec').click());
  await new Promise(r => setTimeout(r, 300));
  const afterUnlockedClick = await page.evaluate(() => ({
    modalDisplay: (document.getElementById('swr-invite-modal-host') || {}).style?.display,
    recFired: document.body.dataset.recFired,
  }));
  check('after unlock, rec click does NOT open the modal', afterUnlockedClick.modalDisplay === 'none');
  // After the valid unlock, the rec click must fire the action exactly
  // once. The single-listener gate (Promise + armed flag) guarantees no
  // double-fire. The expected count is 3: skip=1, valid-unlock=1,
  // post-unlock click=1.
  check('after unlock, rec click fires the action exactly once', afterUnlockedClick.recFired === '3', 'got recFired=' + afterUnlockedClick.recFired);

  // --- reload: unlock survives via localStorage ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  const afterReload = await page.evaluate(() => ({
    unlocked: window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK.isEnabled(),
  }));
  check('reload: still unlocked', afterReload.unlocked === true);
  check('reload: watermark still off (flag hydrates)', afterReload.watermarkEnabled === false);

  // --- revoke: flips both ---
  await page.evaluate(() => window.SWR_INVITE_UNLOCK.revoke());
  await new Promise(r => setTimeout(r, 200));
  const afterRevoke = await page.evaluate(() => ({
    unlocked: window.SWR_INVITE_UNLOCK.isUnlocked(),
    watermarkEnabled: window.SWR_WATERMARK.isEnabled(),
    lsFlag: localStorage.getItem('swr.inviteUnlocked'),
  }));
  check('revoke: clears the flag', afterRevoke.lsFlag === '0');
  check('revoke: locks again', afterRevoke.unlocked === false);
  check('revoke: re-enables the watermark', afterRevoke.watermarkEnabled === true);

  // --- export button has the same gate ---
  await page.evaluate(() => document.getElementById('export').click());
  await new Promise(r => setTimeout(r, 300));
  const afterExport = await page.evaluate(() => ({
    modalVisible: document.getElementById('swr-invite-modal-host') && document.getElementById('swr-invite-modal-host').style.display,
    exportFired: document.body.dataset.exportFired,
  }));
  check('export button also gated', afterExport.modalVisible === 'flex');
  check('export action did not fire while locked', !afterExport.exportFired);

  // --- page-error guard ---
  check('no real page errors', pageErrors.length === 0, pageErrors.length ? 'errors=' + JSON.stringify(pageErrors).slice(0, 200) : '');

  await browser.close();
  server.close();

  if (failures) {
    console.log('\nINVITE REDEMPTION SMOKE: FAILURES ABOVE');
    process.exit(1);
  }
  console.log('\nINVITE REDEMPTION SMOKE: ALL GREEN');
})().catch(e => {
  console.error('SMOKE FATAL', e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
