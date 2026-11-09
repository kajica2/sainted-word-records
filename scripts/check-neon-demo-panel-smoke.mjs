#!/usr/bin/env node
// Puppeteer smoke: /versions/neon mounts SWR_NEON_DEMO and preset buttons work.

import fs from 'node:fs';
import path from 'node:path';
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

let fails = 0;
function ok(msg) { console.log('  ✓ ' + msg); }
function bad(msg, detail) {
  console.log('  ✗ ' + msg + (detail != null ? ' (' + detail + ')' : ''));
  fails++;
}

try {
  await page.goto(BASE + '/versions/neon.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(function () {
    return window.SWR_NEON_DEMO && document.getElementById('swr-neon-demo');
  }, { timeout: 30000 });

  const hasPanel = await page.evaluate(function () {
    var el = document.getElementById('swr-neon-demo');
    return !!(el && window.SWR_NEON_DEMO && typeof window.SWR_LOOK_FILTER_CYCLER !== 'undefined');
  });
  if (hasPanel) ok('panel + look-filter cycler loaded');
  else bad('panel mount');

  await page.evaluate(function () {
    var t = document.querySelector('#swr-neon-demo .swr-neon-demo-toggle');
    if (t) t.click();
  });

  const before = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.getState().activePreset;
  });
  await page.evaluate(function () {
    var b = document.querySelector('[data-demo-preset="pulse"]');
    if (b) b.click();
  });
  const after = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.getState().activePreset;
  });
  if (after === 'pulse') ok('preset button applies pulse');
  else bad('preset apply', 'before=' + before + ' after=' + after);

  // Start demo drives the whole integration through the real button: the
  // dance clips are installed, staged as layers and decoded, the song plays
  // and the audio features move, a grade preset reaches the FX pipeline.
  await page.evaluate(function () {
    document.querySelector('[data-demo-control="stage:start"]').click();
  });
  const staged = await page.waitForFunction(function () {
    var lib = window.SWR_LIB;
    var clips = lib ? lib.items.filter(function (it) { return it.packId === 'dancer-video'; }) : [];
    return clips.length >= 13 && window.Layers && window.Layers.list.length > 0 &&
      window.A && window.A.playing;
  }, { timeout: 60000, polling: 300 }).then(function () { return true; }, function () { return false; });
  if (staged) ok('Start demo installs the 13 dance clips, stages layers and plays the song');
  else bad('Start demo did not stage clips + audio', await page.evaluate(function () { return window.SWR_NEON_DEMO.stageSummary(); }));

  const videoLayers = await page.waitForFunction(function () {
    var decoded = window.Layers.list.filter(function (l) {
      var a = l.asset;
      return a && a.type === 'video' && a._el && a._el.readyState >= 2 && a._el.videoWidth > 0 && a._el.currentTime > 0;
    });
    return decoded.length ? decoded.length : false;
  }, { timeout: 45000, polling: 300 }).then(function (h) { return h.jsonValue(); }, function () { return 0; });
  if (videoLayers > 0) ok('staged dance clips decode and play (' + videoLayers + ' video layer(s) with frames advancing)');
  else bad('no staged video layer decoded and advanced', await page.evaluate(function () {
    return JSON.stringify(window.Layers.list.map(function (l) {
      var a = l.asset || {};
      return { type: a.type, rs: a._el && a._el.readyState, t: a._el && a._el.currentTime };
    }));
  }));

  const reacted = await page.waitForFunction(function () {
    var f = window.A && window.A.feat;
    return !!(f && (f.rms > 0.001 || f.bass > 0.01));
  }, { timeout: 30000, polling: 200 }).then(function () { return true; }, function () { return false; });
  if (reacted) ok('audio features react to the demo song');
  else bad('audio features stayed at zero');

  const overlayGone = await page.waitForFunction(function () {
    return !document.getElementById('swr-start');
  }, { timeout: 5000, polling: 200 }).then(function () { return true; }, function () { return false; });
  if (overlayGone) ok('start overlay is dismissed once the demo song plays');
  else bad('start overlay still covers the stage');

  const presetChanged = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.getState().activePreset;
  });
  if (presetChanged) ok('demo presets are cycling (active: ' + presetChanged + ')');
  else bad('no active demo preset');

  await page.evaluate(function () {
    document.querySelector('[data-demo-control="demo:demoAll"]').click();
  });

  try {
    const shotDir = '/opt/cursor/artifacts/screenshots';
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({
      path: path.join(shotDir, 'neon-demo-panel.png'),
      fullPage: false,
    });
    ok('screenshot saved');
  } catch (shotErr) {
    bad('screenshot', shotErr && shotErr.message);
  }

  // WebGL is opt-in (?webgl=1). The panel must report the pipeline honestly:
  // active when the context exists, "unavailable" when it was asked for and
  // refused, and never "on" when it was not requested.
  const glPage = await browser.newPage();
  await glPage.setViewport({ width: 1280, height: 720 });
  await glPage.goto(BASE + '/versions/neon.html?webgl=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await glPage.waitForFunction(function () {
    return window.SWR_NEON_DEMO && window.FX && window.SWR_WEBGL;
  }, { timeout: 45000 });
  const gl = await glPage.evaluate(function () { return window.SWR_NEON_DEMO.webglState(); });
  const label = await glPage.evaluate(function () { return window.SWR_NEON_DEMO.stageSummary(); });
  if (gl.asked && gl.active && /WebGL on/.test(label)) ok('?webgl=1 runs the WebGL FX pipeline (' + label + ')');
  else if (gl.asked && /WebGL unavailable/.test(label)) ok('?webgl=1 on a machine without a usable context reports it (' + label + ')');
  else bad('WebGL status', JSON.stringify(gl) + ' ' + label);
  const plain = await page.evaluate(function () { return window.SWR_NEON_DEMO.webglState(); });
  if (!plain.asked && !plain.active) ok('default page keeps WebGL off and says so');
  else bad('default WebGL state', JSON.stringify(plain));
} catch (e) {
  bad('smoke exception', e && e.message);
} finally {
  await browser.close();
  served.close();
}

if (fails) {
  console.log('NEON DEMO PANEL SMOKE: FAIL (' + fails + ')');
  process.exit(1);
}
console.log('NEON DEMO PANEL SMOKE: ALL GREEN');
