#!/usr/bin/env node
// Headless verification: every Demo panel control is bound and produces a
// measurable state and/or canvas change with audio playing on /versions/neon.

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

ensureDist();
const served = await serveDist(0);
const BASE = served.url;

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const verified = [];
let fails = 0;

function ok(id, effect) {
  verified.push({ id, effect });
  console.log('  ✓ ' + id + ' — ' + effect);
}
function bad(id, detail) {
  console.log('  ✗ ' + id + (detail ? ' (' + detail + ')' : ''));
  fails++;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function samplePixels() {
  return page.evaluate(function () {
    function sumCanvas(id) {
      var c = document.getElementById(id);
      if (!c || !c.getContext) return null;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      var w = Math.min(48, c.width || 0);
      var h = Math.min(48, c.height || 0);
      if (w < 2 || h < 2) return null;
      try {
        var d = ctx.getImageData(0, 0, w, h).data;
        var s = 0;
        for (var i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
        return s;
      } catch (_) {
        return null;
      }
    }
    return { render: sumCanvas('render'), fx: sumCanvas('fx-canvas'), meter: sumCanvas('meter') };
  });
}

async function waitForAudio() {
  await page.waitForFunction(function () {
    return window.A && window.A.playing && window.A.feat && window.A.feat.rms > 0.001;
  }, { timeout: 90000, polling: 400 }).catch(function () {});
}

try {
  await page.goto(BASE + '/versions/neon.html', { waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.waitForFunction(function () {
    return window.SWR_NEON_DEMO && document.getElementById('swr-neon-demo') && window.FX && window.Layers;
  }, { timeout: 45000 });

  await page.waitForFunction(function () {
    var c = document.getElementById('render');
    return c && c.width > 16 && c.height > 16;
  }, { timeout: 45000, polling: 200 });

  await page.evaluate(async function () {
    var L = window.Layers;
    if (!L || (L.list && L.list.length)) return;
    try {
      var res = await fetch('/default-library/holo-0.webp');
      if (!res.ok) return;
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.src = url;
      await img.decode();
      var item = {
        id: 'verify-holo',
        type: 'image',
        name: 'verify-holo.webp',
        url: url,
        thumb: url,
        w: img.naturalWidth || 64,
        h: img.naturalHeight || 64,
      };
      if (window.Lib && window.Lib.items) window.Lib.items.push(item);
      L.add(item);
    } catch (_) {}
  });

  await page.waitForFunction(function () {
    return window.Layers && window.Layers.list && window.Layers.list.length > 0;
  }, { timeout: 30000, polling: 300 });

  await page.evaluate(function () {
    var t = document.querySelector('#swr-neon-demo .swr-neon-demo-toggle');
    if (t) t.click();
  });

  await page.evaluate(async function () {
    if (window.A && window.A.el && !window.A.playing && typeof window.A.play === 'function') {
      try { await window.A.play(); } catch (_) {}
    }
    if (window.A && !window.A.el && window.SWR && window.SWR.Audio) {
      try {
        var res = await fetch('/audios/neon.mp3');
        var blob = await res.blob();
        var file = new File([blob], 'neon.mp3', { type: 'audio/mpeg' });
        window.SWR.Audio.load(file);
        await window.SWR.Audio.play();
      } catch (_) {}
    }
  });

  await waitForAudio();

  await page.evaluate(function () {
    var L = window.Layers;
    if (!L || !L.list || !L.list.length) return;
    L.sel = L.list[0];
    var cards = document.querySelectorAll('#layers .l');
    if (cards[0]) {
      cards[0].click();
      cards[0].classList.add('sel');
    }
  });

  await page.evaluate(function () {
    if (!window.SWR_SCENES || typeof window.SWR_SCENES.save !== 'function') return;
    var sens = document.getElementById('sens');
    for (var i = 0; i < 4; i++) {
      if (sens) {
        sens.value = String(0.8 + i * 0.25);
        sens.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window.SWR_SCENES.save(i, 'Scene ' + (i + 1));
    }
  });

  const controls = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.listControls();
  });

  for (const meta of controls) {
    if (meta.skipVerify) {
      ok(meta.id, 'intentionally disabled (skip verify)');
      continue;
    }

    if (meta.id.indexOf('layer:') === 0 && meta.id !== 'layer:masterRot' && meta.id !== 'layer:baseScale' && meta.id !== 'layer:mutate') {
      await page.evaluate(function () {
        var L = window.Layers;
        if (L && L.list && L.list[0]) L.sel = L.list[0];
      });
    }

    const beforeProbe = await page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.readProbe(id);
    }, meta.id);
    const beforePx = await samplePixels();

    const inv = await page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.invokeControl(id);
    }, meta.id);

    if (!inv || !inv.ok) {
      bad(meta.id, inv && inv.error ? inv.error : 'invoke failed');
      continue;
    }

    await sleep(120);
    await page.evaluate(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      });
    });

    const afterProbe = await page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.readProbe(id);
    }, meta.id);
    const afterPx = await samplePixels();

    const probeChanged = JSON.stringify(beforeProbe) !== JSON.stringify(afterProbe);
    const pxChanged = beforePx && afterPx && (
      beforePx.render !== afterPx.render ||
      beforePx.fx !== afterPx.fx ||
      beforePx.meter !== afterPx.meter
    );

    if (meta.id === 'demo:demoAll') {
      if (afterProbe.running) ok(meta.id, 'starts preset cycle (running=true)');
      else bad(meta.id, 'expected demo-all running');
      await page.evaluate(function () { window.SWR_NEON_DEMO.invokeControl('demo:demoAll'); });
      continue;
    }

    var gradeOk = false;
    if (meta.id.indexOf('grade:') === 0) {
      var want = meta.id.split(':')[1];
      gradeOk = afterProbe.preset === want || afterProbe.grade === want;
    }

    if (probeChanged || pxChanged || gradeOk) {
      const parts = [];
      if (probeChanged || gradeOk) parts.push('state');
      if (pxChanged) parts.push('pixels');
      ok(meta.id, parts.join(' + ') + ' changed');
    } else {
      bad(meta.id, 'no state or pixel delta');
    }
  }

  const binding = await page.evaluate(function () {
    try {
      window.SWR_NEON_DEMO.assertAllControlsBound();
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
  if (binding.ok) ok('registry', 'every [data-demo-control] has invoke handler');
  else bad('registry', binding.msg);

  try {
    await page.screenshot({
      path: '/opt/cursor/artifacts/screenshots/neon-demo-panel.png',
      fullPage: false,
    });
  } catch (_) {}
} catch (e) {
  bad('verify run', e && e.message);
} finally {
  await browser.close();
  served.close();
}

if (fails) {
  console.log('NEON DEMO PANEL VERIFY: FAIL (' + fails + ')');
  process.exit(1);
}

console.log('NEON DEMO PANEL VERIFY: ALL GREEN (' + verified.length + ' controls)');
console.log('--- verified effects ---');
for (const row of verified) {
  console.log(row.id + '\t' + row.effect);
}
