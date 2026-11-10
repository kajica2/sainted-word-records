#!/usr/bin/env node
// Headless verification: every Demo panel control is bound and produces a
// measurable state and/or canvas change with audio playing on /versions/neon.

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

// A stalled control used to sit inside page.evaluate until Puppeteer's
// protocol timeout (180s) and the failure was reported as "verify run",
// with no control id. The deadline runs in Node, so a frozen page thread
// — which never runs an in-page timer — still names the step. An in-page
// timer still covers the case where the thread is alive but animation
// frames are not delivered.
function boundStep(work, ms, label, timers) {
  const schedule = timers && timers.set ? timers.set : setTimeout;
  const cancel = timers && timers.clear ? timers.clear : clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = schedule(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label + ' exceeded ' + ms + 'ms'));
    }, ms);
    Promise.resolve().then(work).then((value) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      resolve(value);
    }, (err) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      reject(err);
    });
  });
}

async function assertBoundStep() {
  const quiet = { set() { return 1; }, clear() {} };
  const failures = [];
  const done = boundStep(() => 'ok', 10, 'fast', quiet);
  const hung = boundStep(() => new Promise(() => {}), 10, 'layer:blend frames', {
    set(fn) { fn(); return 1; },
    clear() {},
  });
  const rejected = boundStep(() => Promise.reject(new Error('probe')), 10, 'probe', quiet);
  let lateTimer = null;
  const late = boundStep(() => 'done', 10, 'late', {
    set(fn) { lateTimer = fn; return 1; },
    clear() {},
  });
  await Promise.all([
    done.then((v) => { if (v !== 'ok') failures.push('success'); }),
    hung.then(() => failures.push('hung resolved'), (err) => {
      if (!err || err.message !== 'layer:blend frames exceeded 10ms') failures.push('hung: ' + (err && err.message));
    }),
    rejected.then(() => failures.push('reject resolved'), (err) => {
      if (!err || err.message !== 'probe') failures.push('reject: ' + (err && err.message));
    }),
    late.then((v) => {
      if (v !== 'done') failures.push('late');
      if (lateTimer) lateTimer();
    }),
  ]);
  if (failures.length) {
    console.log('NEON DEMO PANEL VERIFY: FAIL (bound step: ' + failures.join('; ') + ')');
    process.exit(1);
  }
}

await assertBoundStep();
if (process.argv.includes('--self-test')) {
  console.log('NEON DEMO PANEL VERIFY: bound-step self-test ok');
  process.exit(0);
}

ensureDist();
const served = await serveDist(0);
const BASE = served.url;

const browser = await puppeteer.launch({
  // Backstop for one CDP call. The per-step deadline below is what fails a
  // stalled control; this only matters if the browser cannot be dropped.
  protocolTimeout: 90000,
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

let phase = 'boot';

function dropBrowser() {
  try { browser.disconnect(); } catch (_) {}
  try {
    const proc = typeof browser.process === 'function' ? browser.process() : null;
    if (proc && typeof proc.kill === 'function') proc.kill('SIGKILL');
  } catch (_) {}
}

async function runStep(label, work, ms = 8000) {
  phase = label;
  try {
    return await boundStep(work, ms, label);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.indexOf(' exceeded ') !== -1) {
      dropBrowser();
    }
    throw err;
  }
}

async function waitForFrames(controlId) {
  return runStep(controlId + ' frames', () => page.evaluate(function (id) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('two animation frames timed out after 5000ms for ' + id));
      }, 5000);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        });
      });
    });
  }, controlId), 8000);
}

try {
  phase = 'open neon';
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
      await runStep(meta.id + ' select', () => page.evaluate(function () {
        var L = window.Layers;
        if (!L || !L.list || !L.list[0]) return;
        L.sel = L.list[0];
        // A prior layer:lock leave-behind would block later mutations
        // (nextReactors / opacity / …). Clear it before each layer control.
        if (L.list[0].locked) {
          if (typeof L.toggleLock === 'function') L.toggleLock(L.list[0]);
          else L.list[0].locked = false;
          if (typeof L.render === 'function') L.render();
        }
        // Re-enable demo inputs that syncLayerControls disabled while locked.
        if (window.SWR_NEON_DEMO && typeof window.SWR_NEON_DEMO.invokeControl === 'function') {
          // Prefer a no-op sync via a public hook if present; else clear disabled.
          var host = document.querySelector('[data-demo-layer-fields]');
          if (host) {
            host.querySelectorAll('input, select, button').forEach(function (el) {
              if (el.id === 'demo-layer-lock') return;
              if (el.hasAttribute('data-demo-disabled')) return;
              el.disabled = false;
            });
          }
        }
      }));
    }

    const beforeProbe = await runStep(meta.id + ' probe:before', () => page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.readProbe(id);
    }, meta.id));
    const beforePx = await runStep(meta.id + ' pixels:before', () => samplePixels());

    // image:* may install the dance pack + remap before acting (verify
    // walks controls alphabetically, so these run before stage:clips).
    const invBudget = (meta.id.indexOf('stage:') === 0 || meta.id.indexOf('image:') === 0)
      ? 45000
      : 8000;
    const inv = await runStep(meta.id + ' invoke', () => page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.invokeControl(id);
    }, meta.id), invBudget);

    if (!inv || !inv.ok) {
      bad(meta.id, inv && inv.error ? inv.error : 'invoke failed');
      continue;
    }

    await sleep(120);
    try {
      await waitForFrames(meta.id);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.indexOf('two animation frames timed out') === 0) {
        bad(meta.id, msg);
        continue;
      }
      throw err;
    }

    const afterProbe = await runStep(meta.id + ' probe:after', () => page.evaluate(function (id) {
      return window.SWR_NEON_DEMO.readProbe(id);
    }, meta.id));
    const afterPx = await runStep(meta.id + ' pixels:after', () => samplePixels());

    const probeChanged = JSON.stringify(beforeProbe) !== JSON.stringify(afterProbe);
    const pxChanged = beforePx && afterPx && (
      beforePx.render !== afterPx.render ||
      beforePx.fx !== afterPx.fx ||
      beforePx.meter !== afterPx.meter
    );

    if (meta.id === 'demo:demoAll') {
      if (afterProbe.running) ok(meta.id, 'starts preset cycle (running=true)');
      else bad(meta.id, 'expected demo-all running');
      await runStep('demo:demoAll stop', () => page.evaluate(function () {
        window.SWR_NEON_DEMO.invokeControl('demo:demoAll');
      }));
      continue;
    }

    if (meta.id === 'stage:start') {
      if (afterProbe.cycling && afterProbe.clips > 0 && afterProbe.layers > 0 && afterProbe.playing) {
        ok(meta.id, 'dance clips staged, song playing, presets cycling');
      } else {
        bad(meta.id, 'expected clips + layers + audio + cycling, got ' + JSON.stringify(afterProbe));
      }
      await runStep('stage:start stop', () => page.evaluate(function () {
        window.SWR_NEON_DEMO.invokeControl('demo:demoAll');
      }));
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
  const msg = e && e.message ? e.message : String(e);
  bad('verify run', phase + ' — ' + msg);
} finally {
  try { await browser.close(); } catch (_) {}
  try { served.close(); } catch (_) {}
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
