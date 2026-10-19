#!/usr/bin/env node
// verify-neon-media-panel.mjs — E2E for the unified NEON Media panel.
//
//   node verify-neon-media-panel.mjs
//
// If Chrome cannot be launched by this process (sandboxes that block
// Chrome's ProcessSingleton socket dir, or a machine where a browser is
// already running), point SWR_CDP_URL at an existing DevTools endpoint
// and the script attaches to it instead:
//
//   SWR_CDP_URL=http://127.0.0.1:9222 node verify-neon-media-panel.mjs
//
// The NEON sidebar used to carry TWO lists of the same assets: a
// "Library" grid (#lib, rendered by Lib.render) and a "My Media" grid
// (#swr-user-media-grid, rendered by the shared user-media mount).
// Both were fed by the same IndexedDB store, so every asset the user
// had uploaded appeared twice. The panel is now ONE list with two
// states — "library" (available) and "used" (assigned to a layer).
//
// Asserts:
//   1. The legacy "My Media" markup + mount are gone from neon.html
//   2. An uploaded asset appears EXACTLY ONCE in the panel
//   3. Library / Used tabs + counters
//   4. Clicking a card adds a layer; the "Used in N layers" badge updates
//   5. The "used" tab lists only assigned assets
//   6. Search filters by name
//   7. Grid / list toggle
//   8. Assign replaces the target layer's media in place (no new layer)
//   9. A layer row shows thumbnail + name + a "change media" button;
//      Change focuses the asset in the panel and pre-targets that layer
//  10. Removing an asset deletes it from IndexedDB — it must NOT come
//      back after a reload (this is the bug the old × button had)
//  11. Clear on the "used" tab unassigns but keeps the media; Clear on
//      the "library" tab removes the media AND the IndexedDB records

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8220;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'versions/neon.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf:' + rel); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

let passed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, msg) { console.log(`  ✗ ${label}: ${msg}`); process.exitCode = 1; }
function check(cond, label, msg) { if (cond) ok(label); else fail(label, msg || 'expected true'); }

// Injected into the page: build a small PNG File with a label on it.
const MAKE_FILE = `
  window.__mkFile = async (name, rgb, label) => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 200;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 200, 200);
    g.addColorStop(0, rgb); g.addColorStop(1, '#101018');
    x.fillStyle = g; x.fillRect(0, 0, 200, 200);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = 'bold 15px sans-serif';
    x.fillText(label, 12, 105);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  };
`;

// One full pass of the assertions against a loaded page.
async function runSteps(page, url) {
    passed = 0;
    // The last attempt decides the verdict: a retried attempt that
    // passes must not inherit the previous attempt's failure code.
    process.exitCode = 0;
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    // The panel's Clear buttons are confirm()-guarded.
    //
    // lib/app-version-bust.js hard-reloads the page when the version
    // stored in localStorage differs from the served one. A test
    // browser whose stored version is stale therefore reloads itself
    // mid-assertion, which detaches the frame and aborts the run. Seed
    // the key with the version this server actually serves so the page
    // loads straight through.
    const versionText = await fetch(`http://localhost:${PORT}/lib/app-version.js`)
      .then(r => r.text()).catch(() => '');
    const versionMatch = versionText.match(/window\.SWR_APP_VERSION\s*=\s*["']([^"']+)["']/);
    const appVersion = versionMatch ? versionMatch[1] : null;
    await page.evaluateOnNewDocument((v) => {
      try { if (v) localStorage.setItem('swr_app_version_seen', v); } catch (_) {}
      window.confirm = () => true;
    }, appVersion);
    // The synthetic-image factory has to survive the reload below.
    await page.evaluateOnNewDocument(MAKE_FILE);

    // pwa-bootstrap.js reloads the page when the service worker claims
    // it (the controllerchange handler). On a fresh profile that reload
    // lands in the middle of the run and detaches the frame. Block the
    // worker script so the page settles immediately — the media panel
    // has nothing to do with service workers.
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/\/sw\.js(\?|$)/.test(req.url())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });

    await page.goto(url, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));
    // ---- 1. The duplicate list is gone -----------------------------------
    const legacy = await page.evaluate(() => ({
      grid: document.querySelectorAll('#swr-user-media-grid').length,
      wrap: document.querySelectorAll('#swr-user-media').length,
      mountScript: [...document.querySelectorAll('script[src]')]
        .filter(s => s.src.includes('user-media-mount')).length,
    }));
    check(legacy.grid === 0 && legacy.wrap === 0,
      'legacy "My Media" markup removed', JSON.stringify(legacy));
    check(legacy.mountScript === 0,
      'user-media-mount script no longer loaded on neon', `found ${legacy.mountScript}`);

    const panel = await page.evaluate(() => ({
      title: (document.querySelector('aside.lib .head h2') || {}).textContent,
      tabs: [...document.querySelectorAll('.media-tab')].map(b => b.getAttribute('data-media-tab')),
      hasSearch: !!document.getElementById('media-search'),
      hasViews: document.querySelectorAll('.media-view').length,
      hasClear: !!document.getElementById('media-clear'),
      hasAssign: !!document.getElementById('media-assign-target'),
    }));
    check(panel.title === 'Media', 'sidebar is titled "Media"', panel.title);
    check(panel.tabs.join(',') === 'library,used', 'tabs are library + used', panel.tabs.join(','));
    check(panel.hasSearch, 'search box present');
    check(panel.hasViews === 2, 'grid + list view toggles present');
    check(panel.hasClear, 'Clear lives in the Media panel');
    check(panel.hasAssign, 'assign-to-layer control present');

    // ---- 2. One asset, ONE card ------------------------------------------
    await page.evaluate(async () => {
      await window.SWR_MEDIA.deleteAll();
      window.SWR_LIB.items.length = 0;
      window.SWR_LIB.nextId = 1;
      // Layer state is persisted per-browser, so a previous session's
      // layers would otherwise skew the "used" counts.
      window.SWR.Layers.list.length = 0;
      window.SWR.Layers.sel = null;
      window.SWR.Layers.render();
      const f = await window.__mkFile('clip-alpha.mp4', '#ff2d8a', 'A');
      await window.SWR_LIB.addFiles([f]);
    });
    await new Promise(r => setTimeout(r, 900));
    const one = await page.evaluate(() => ({
      cards: document.querySelectorAll('#lib .li').length,
      libCount: document.getElementById('media-count-library').textContent,
      usedCount: document.getElementById('media-count-used').textContent,
    }));
    check(one.cards === 1, 'asset renders exactly ONE card (no duplicate list)', `cards=${one.cards}`);
    check(one.libCount === '1', 'library counter = 1', one.libCount);
    check(one.usedCount === '0', 'used counter = 0 before assignment', one.usedCount);

    // ---- 3. Add a second asset, click one -> layer + badge ----------------
    const afterClick = await page.evaluate(async () => {
      const f = await window.__mkFile('clip-beta.mp4', '#22d3ee', 'B');
      await window.SWR_LIB.addFiles([f]);
      await new Promise(r => setTimeout(r, 400));
      const cards = [...document.querySelectorAll('#lib .li')];
      const alpha = cards.find(c => c.querySelector('.nm').textContent.includes('alpha'));
      alpha.click();
      await new Promise(r => setTimeout(r, 300));
      // The panel re-renders on the layer change, so the card node from
      // before the click is detached — re-query the live DOM.
      const live = [...document.querySelectorAll('#lib .li')]
        .find(c => c.querySelector('.nm').textContent.includes('alpha'));
      return {
        cards: document.querySelectorAll('#lib .li').length,
        layers: window.SWR.Layers.list.length,
        badge: (live.querySelector('.badge') || {}).textContent || null,
        mediaId: window.SWR.Layers.list[0].mediaId,
        assetId: window.SWR_LIB.items.find(i => i.name.includes('alpha')).id,
      };
    });
    check(afterClick.cards === 2, 'two assets -> two cards', `cards=${afterClick.cards}`);
    check(afterClick.layers === 1, 'clicking a card adds a layer', `layers=${afterClick.layers}`);
    check(afterClick.badge === 'Used in 1 layer', 'badge reads "Used in 1 layer"', afterClick.badge);
    check(afterClick.mediaId === afterClick.assetId,
      'layer carries mediaId matching the asset', `${afterClick.mediaId} vs ${afterClick.assetId}`);

    // ---- 4. The "used" tab lists only assigned assets ---------------------
    const usedTab = await page.evaluate(async () => {
      document.querySelector('[data-media-tab="used"]').click();
      await new Promise(r => setTimeout(r, 200));
      return {
        cards: document.querySelectorAll('#lib .li').length,
        names: [...document.querySelectorAll('#lib .li .nm')].map(n => n.textContent),
        usedCount: document.getElementById('media-count-used').textContent,
        libCount: document.getElementById('media-count-library').textContent,
      };
    });
    check(usedTab.cards === 1, 'used tab shows only the assigned asset', `cards=${usedTab.cards}`);
    check(usedTab.names.join() === 'clip-alpha.mp4', 'used tab lists alpha', usedTab.names.join());
    check(usedTab.usedCount === '1' && usedTab.libCount === '2',
      'counters stay independent (used=1, library=2)', JSON.stringify(usedTab));

    // ---- 5. Search + view toggle -----------------------------------------
    const search = await page.evaluate(async () => {
      document.querySelector('[data-media-tab="library"]').click();
      await new Promise(r => setTimeout(r, 150));
      const s = document.getElementById('media-search');
      s.value = 'beta'; s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const names = [...document.querySelectorAll('#lib .li .nm')].map(n => n.textContent);
      s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const all = document.querySelectorAll('#lib .li').length;
      document.querySelector('[data-media-view="list"]').click();
      await new Promise(r => setTimeout(r, 200));
      const isList = document.getElementById('lib').classList.contains('list');
      document.querySelector('[data-media-view="grid"]').click();
      await new Promise(r => setTimeout(r, 200));
      const isGrid = !document.getElementById('lib').classList.contains('list');
      return { names, all, isList, isGrid };
    });
    check(search.names.join() === 'clip-beta.mp4', 'search filters by name', search.names.join());
    check(search.all === 2, 'clearing the search restores both cards', `cards=${search.all}`);
    check(search.isList && search.isGrid, 'grid/list toggle switches the panel layout');

    // ---- 6. Assign replaces a layer's media in place -----------------------
    const assign = await page.evaluate(async () => {
      const before = window.SWR.Layers.list.length;
      const sel = document.getElementById('media-assign-target');
      // Option values are the layer's POSITION in the list, not its id.
      sel.value = '0';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const beta = [...document.querySelectorAll('#lib .li')]
        .find(c => c.querySelector('.nm').textContent.includes('beta'));
      beta.querySelector('.asg').click();
      await new Promise(r => setTimeout(r, 300));
      const l1 = window.SWR.Layers.list[0];
      return {
        before,
        after: window.SWR.Layers.list.length,
        l1Name: l1 ? l1.asset.name : null,
        l1MediaId: l1 ? l1.mediaId : null,
        betaId: window.SWR_LIB.items.find(i => i.name.includes('beta')).id,
        usedCount: document.getElementById('media-count-used').textContent,
      };
    });
    check(assign.after === assign.before,
      'assign REPLACES the layer media, no new layer', `${assign.before} -> ${assign.after}`);
    check(assign.l1Name === 'clip-beta.mp4', 'layer 1 now points at beta', assign.l1Name);
    check(assign.l1MediaId === assign.betaId, 'layer 1 mediaId follows the asset');

    // ---- 7. Layer row: thumbnail + name + Change --------------------------
    const row = await page.evaluate(() => {
      const r = document.querySelector('#layers .l');
      return {
        hasThumb: !!r.querySelector('.lh .th img'),
        name: r.querySelector('.lh .nm').textContent,
        hasChange: !!r.querySelector('.lh .chg'),
        hasRemove: !!r.querySelector('.lh .x'),
      };
    });
    check(row.hasThumb, 'layer row shows a thumbnail');
    check(row.name === 'clip-beta.mp4', 'layer row shows the asset name', row.name);
    check(row.hasChange, 'layer row has a "change media" button');
    check(row.hasRemove, 'layer row still has the remove button');

    // Change focuses the asset in the panel and pre-targets that layer.
    const change = await page.evaluate(async () => {
      document.querySelector('#layers .l .lh .chg').click();
      await new Promise(r => setTimeout(r, 250));
      return {
        target: document.getElementById('media-assign-target').value,
        focused: (document.querySelector('#lib .li.is-focus .nm') || {}).textContent || null,
        tab: (document.querySelector('.media-tab.is-on') || {}).getAttribute('data-media-tab'),
      };
    });
    check(change.target === '0', 'Change pre-targets that layer', change.target);
    check(change.focused === 'clip-beta.mp4', 'Change focuses the asset in the panel', change.focused);
    check(change.tab === 'library', 'Change switches the panel to the library', change.tab);

    // ---- 8. Remove deletes the IndexedDB record (survives a reload) -------
    const removed = await page.evaluate(async () => {
      const card = document.querySelector('#lib .li[data-id="1"]') ||
                   [...document.querySelectorAll('#lib .li')].find(c => c.querySelector('.nm').textContent.includes('alpha'));
      const rm = card.querySelector('.rm');
      rm.click();                                   // arm
      await new Promise(r => setTimeout(r, 120));
      rm.click();                                   // confirm
      await new Promise(r => setTimeout(r, 700));
      return {
        cards: document.querySelectorAll('#lib .li').length,
        idb: (await window.SWR_MEDIA.getUserMedia()).map(r => r.name).sort(),
      };
    });
    check(removed.cards === 1, 'removed asset leaves the panel', `cards=${removed.cards}`);
    check(removed.idb.length === 1 && removed.idb[0] === 'clip-beta.mp4',
      'removed asset is deleted from IndexedDB', removed.idb.join());

    // A fresh navigation rather than page.reload(): the page carries a
    // version-watcher that can reload itself, which detaches the frame
    // mid-reload and aborts the wait.
    await page.goto(url, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1800));
    const afterReload = await page.evaluate(() => ({
      names: window.SWR_LIB.items.map(i => i.name),
      cards: document.querySelectorAll('#lib .li').length,
    }));
    check(afterReload.names.length === 1 && afterReload.names[0] === 'clip-beta.mp4',
      'removed asset does NOT come back after a reload', afterReload.names.join());
    check(afterReload.cards === 1, 'panel shows one card after reload', `cards=${afterReload.cards}`);

    // ---- 10. Clear on the "used" tab keeps the media -----------------------
    const clearUsed = await page.evaluate(async () => {
      document.querySelectorAll('#lib .li')[0].click();   // assign beta to a layer
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('[data-media-tab="used"]').click();
      await new Promise(r => setTimeout(r, 200));
      const usedBefore = document.querySelectorAll('#lib .li').length;
      document.getElementById('media-clear').click();
      await new Promise(r => setTimeout(r, 400));
      return {
        usedBefore,
        usedAfter: document.querySelectorAll('#lib .li').length,
        libCount: document.getElementById('media-count-library').textContent,
        idb: (await window.SWR_MEDIA.getUserMedia()).map(r => r.name).sort(),
        layersKept: document.querySelectorAll('#layers .l').length,
      };
    });
    check(clearUsed.usedBefore === 1, 'used tab has the assigned asset');
    check(clearUsed.usedAfter === 0, 'Clear on "used" unassigns every layer', `cards=${clearUsed.usedAfter}`);
    check(clearUsed.libCount === '1', 'Clear on "used" KEEPS the media in the library', clearUsed.libCount);
    check(clearUsed.idb.length === 1, 'Clear on "used" KEEPS the IndexedDB record', clearUsed.idb.join());

    // ---- 10. Clear on the "library" tab removes media + IndexedDB ---------
    const clearLib = await page.evaluate(async () => {
      document.querySelector('[data-media-tab="library"]').click();
      await new Promise(r => setTimeout(r, 200));
      const before = document.querySelectorAll('#lib .li').length;
      document.getElementById('media-clear').click();
      await new Promise(r => setTimeout(r, 600));
      return {
        before,
        after: document.querySelectorAll('#lib .li').length,
        items: window.SWR_LIB.items.length,
        idb: (await window.SWR_MEDIA.getUserMedia()).map(r => r.name).sort(),
      };
    });
    check(clearLib.before === 1, 'library tab lists the asset before clear');
    check(clearLib.after === 0 && clearLib.items === 0,
      'Clear on "library" empties the panel', `cards=${clearLib.after} items=${clearLib.items}`);
    check(clearLib.idb.length === 0,
      'Clear on "library" deletes the IndexedDB records', clearLib.idb.join());

    // ---- 11. Layer ids can collide; the assign target must not -----------
    // A layer's id is 'L' + its position AT CREATION, so with three
    // layers, removing the middle one and adding a new one produces two
    // layers with the SAME id. The assign target is keyed by position,
    // so the right layer is still the one that gets replaced.
    const collision = await page.evaluate(async () => {
      const fa = await window.__mkFile('coll-a.mp4', '#f59e0b', 'A');
      const fb = await window.__mkFile('coll-b.mp4', '#10b981', 'B');
      await window.SWR_LIB.addFiles([fa, fb]);
      await new Promise(r => setTimeout(r, 500));
      window.SWR.Layers.list.length = 0;
      window.SWR.Layers.sel = null;
      window.SWR.Layers.render();
      const pick = (frag) => [...document.querySelectorAll('#lib .li')]
        .find(c => c.querySelector('.nm').textContent.includes(frag));
      pick('coll-a').click(); await new Promise(r => setTimeout(r, 250));   // layer 0
      pick('coll-b').click(); await new Promise(r => setTimeout(r, 250));   // layer 1
      pick('coll-a').click(); await new Promise(r => setTimeout(r, 250));   // layer 2
      const idsBefore = window.SWR.Layers.list.map(l => l.id);
      window.SWR.Layers.rm(window.SWR.Layers.list[1].id);                // drop the middle one
      await new Promise(r => setTimeout(r, 250));
      pick('coll-a').click(); await new Promise(r => setTimeout(r, 250));   // new layer -> id collides
      const idsAfter = window.SWR.Layers.list.map(l => l.id);
      const sel = document.getElementById('media-assign-target');
      const values = [...sel.options].map(o => o.value);
      const uniqueValues = new Set(values).size === values.length;
      // Target the FIRST layer by position and assign the other asset.
      sel.value = '0';
      pick('coll-b').querySelector('.asg').click();
      await new Promise(r => setTimeout(r, 300));
      return {
        idsBefore, idsAfter, uniqueValues,
        firstLayerAsset: window.SWR.Layers.list[0].asset.name,
        layerCount: window.SWR.Layers.list.length,
      };
    });
    check(collision.idsBefore.length === 3, 'three layers to start', JSON.stringify(collision.idsBefore));
    check(collision.uniqueValues, 'assign target options have unique values', JSON.stringify(collision.idsAfter));
    check(new Set(collision.idsAfter).size < collision.idsAfter.length,
      'the id collision is real', JSON.stringify(collision.idsAfter));
    check(collision.firstLayerAsset === 'coll-b.mp4',
      'assign targeted the FIRST layer, not the colliding one', collision.firstLayerAsset);
    check(collision.layerCount === 3, 'assign did not append a layer', `layers=${collision.layerCount}`);

    // ---- 12. No console errors -------------------------------------------
    // Two pre-existing conditions are filtered out, both reproduced on
    // the pre-change page: the local dev-API socket on :8787 (nothing
    // is listening in a bare checkout), and the start overlay's autoplay
    // attempt, which the browser rejects when there was no user gesture.
    const realErrors = errors.filter(e =>
      !/WebSocket connection to 'ws:\/\/localhost:8787/.test(e) &&
      !/play\(\) failed because the user didn't interact/.test(e));
    check(realErrors.length === 0, 'no console errors', realErrors.join(' | '));

    console.log(`\n${passed} checks passed`);
}

async function run() {
  const server = await localServe();
  let browser;
  let attached = false;
  try {
    const cdpUrl = process.env.SWR_CDP_URL;
    if (cdpUrl) {
      // Attach to an already-running browser; we must NOT close it.
      browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
      attached = true;
    } else {
      // An explicit profile dir: Puppeteer's shared default profile is
      // locked when another Chrome (a devtools session, a second verify
      // run) is already using it, and the launch then fails outright.
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-neon-media-'));
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox'],
        userDataDir,
      });
    }
    const url = `http://localhost:${PORT}/versions/neon.html`;
    // A browser that is shared with another tool (a devtools session)
    // can detach the frame mid-run. Re-running the whole sequence is
    // safe: the first step wipes IndexedDB, the layer list and the
    // library, so a fresh attempt starts from a known state.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const page = await browser.newPage();
      try {
        await runSteps(page, url);
        return;
      } catch (err) {
        const msg = String((err && err.message) || err);
        const transient = /detached|destroyed|Target closed|Execution context/i.test(msg);
        if (!transient || attempt === 3) throw err;
        console.log(`  … transient browser detachment (${msg.split('\n')[0]}) — retrying (attempt ${attempt + 1})`);
      } finally {
        try { await page.close(); } catch (_) { /* already gone */ }
      }
    }
  } finally {
    if (browser) {
      if (attached) await browser.disconnect();
      else await browser.close();
    }
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});
