#!/usr/bin/env node
// scripts/check-song-video-layer-smoke.mjs
// Puppeteer smoke against the built engine. A video loaded as the song must
// become a layer that shares the song's own <video> element, so the picture
// on the stage and the sound are one clock — which is what a music video
// export needs.
//
// Assertions:
//   1. the engine boots with no page errors
//   2. a video song adds a layer marked songBound
//   3. that layer's element IS the song's element (the sync guarantee)
//   4. the song element is a <video>
//   5. the song element is drawn to the stage (drawImage hook)
//   6. playing advances the shared element — the picture moves with the sound
//   7. a seek moves the shared element — the picture follows the sound
//   8. the renderer never called load() on the song element (the renderer must
//      not re-drive it: SWR_VIDEO_SYNC's stalled-element recovery would
//      restart the song from zero)
//   9. the layer can be removed while the audio keeps playing
//  10. an audio song removes the song-video layer
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-song-video-layer-smoke.mjs
//
// Pass criteria: every assertion green, exit 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDist, serveDist } from './with-dist.mjs';
import puppeteer from 'puppeteer';

ensureDist();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SONG_VIDEO = '/swr-intro-10s-voice.mp4';   // tracked, 10s, h264 + aac

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + (got !== undefined ? ' — got: ' + JSON.stringify(got) : ''));
  process.exitCode = 1;
}

const served = await serveDist(0);
const BASE = served.url;

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
         '--autoplay-policy=no-user-gesture-required',
         // The service worker registers on load, claims the page on its
         // first activation, and pwa-bootstrap.js reloads on
         // 'controllerchange' — which destroys the execution context an
         // assertion is running in. The feature flag stops the worker
         // existing; the register() stub below stops it being created.
         // Same fix as verify-rotation-enabled.mjs, verify-autoplay.mjs and
         // scripts/check-capture-smoke.mjs.
         '--disable-features=ServiceWorker,ServiceWorkerOnUI'],
});

const page = await browser.newPage();

// The build's app version, so lib/app-version-bust.js does not hard-reload
// the page on a cold profile.
const APP_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'dist/lib/app-version.js'), 'utf8');
    const m = src.match(/SWR_APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : '';
  } catch (_) { return ''; }
})();

await page.evaluateOnNewDocument((version) => {
  try { if (version) localStorage.setItem('swr_app_version_seen', version); } catch (_) {}
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register = () => new Promise(() => {});
    }
  } catch (_) {}
  // Count media-element load() calls, per element. The engine must never
  // call load() on the song's element: SWR_VIDEO_SYNC's stalled-element
  // recovery does exactly that, and it would restart the song from zero.
  try {
    window.__swrLoadedEls = [];
    const orig = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      try { window.__swrLoadedEls.push(this); } catch (_) {}
      return orig.apply(this, arguments);
    };
  } catch (_) {}
  // Record every media element handed to drawImage, and the canvas it went
  // to, so the smoke can prove the song's video reaches the stage canvas
  // (id "render") and not just some offscreen buffer.
  try {
    window.__swrDrawn = [];
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (src) {
      try {
        if (src && src.tagName) {
          window.__swrDrawn.push({ src, canvas: (this.canvas && this.canvas.id) || '' });
        }
      } catch (_) {}
      return orig.apply(this, arguments);
    };
  } catch (_) {}
}, APP_VERSION);

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
await page.waitForFunction(
  () => !!(window.SWR && window.SWR.Audio && window.SWR.Layers &&
          typeof window.SWR.Audio.loadFile === 'function'),
  { timeout: 30000, polling: 200 });

// 1. No page errors at boot.
const fatal = pageErrors.filter((e) => !/WebSocket.*ws:\/\/localhost:8787/.test(e));
if (fatal.length === 0) ok('no page errors at boot');
else bad('no page errors at boot', fatal);

// 2. Load the video as the song.
//
// The default library seeds its own song (audios/test-clip.mp3) and its
// starter layers at boot. Whichever lands last wins, so wait for the
// default library to settle first — otherwise it can replace the video
// song a moment later and the rest of the smoke would measure the wrong
// element.
await page.waitForFunction(
  () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')),
  { timeout: 30000, polling: 200 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1000));

const loaded = await page.evaluate(async (src) => {
  try {
    const r = await fetch(src);
    if (!r.ok) return 'HTTP ' + r.status;
    const b = await r.blob();
    const f = new File([b], 'swr-intro-10s-voice.mp4', { type: b.type || 'video/mp4' });
    window.SWR.Audio.loadFile(f);
    return true;
  } catch (e) { return String(e); }
}, SONG_VIDEO);
if (loaded === true) ok('the video song loaded');
else bad('the video song loaded', loaded);

await page.waitForFunction(
  () => window.SWR.Layers.list.some((l) => l.asset && l.asset.songBound),
  { timeout: 20000, polling: 100 }).catch(() => {});

const layer = await page.evaluate(() => {
  const l = window.SWR.Layers.list.find((x) => x.asset && x.asset.songBound);
  const el = window.SWR.Audio.audioEl;
  return {
    hasLayer: !!l,
    songBound: !!(l && l.asset.songBound),
    sameElement: !!(l && el && l.asset._el === el),
    tag: el ? el.tagName : null,
    layers: window.SWR.Layers.list.length,
  };
});
if (layer.hasLayer) ok('a video song adds a layer');
else bad('a video song adds a layer', layer);
if (layer.songBound) ok('the layer is marked songBound');
else bad('the layer is marked songBound', layer);
if (layer.sameElement) ok('the layer shares the song\'s own element (one clock)');
else bad('the layer shares the song\'s own element (one clock)', layer);
if (layer.tag === 'VIDEO') ok('the song element is a <video>');
else bad('the song element is a <video>', layer.tag);

// 5. The song element reaches the stage.
await page.evaluate(() => { try { window.SWR.Audio.play(); } catch (_) {} });
await new Promise((r) => setTimeout(r, 1500));
const drawn = await page.evaluate(() => {
  const el = window.SWR.Audio.audioEl;
  const onStage = (window.__swrDrawn || []).filter((d) => d.src === el);
  return {
    drawn: onStage.length > 0,
    onStageCanvas: Array.from(new Set(onStage.map((d) => d.canvas))),
    playing: !!(el && !el.paused),
    currentTime: el ? el.currentTime : null,
    readyState: el ? el.readyState : null,
  };
});
if (drawn.drawn && drawn.onStageCanvas.indexOf('render') >= 0) {
  ok('the song element is drawn to the stage canvas');
} else {
  bad('the song element is drawn to the stage canvas', drawn);
}

// 6. Playing advances the shared element.
if (drawn.playing && drawn.currentTime > 0.1 && drawn.readyState >= 2) {
  ok('playing advances the shared element');
} else {
  bad('playing advances the shared element', drawn);
}

// 7. A seek moves the shared element — the picture follows the sound.
const seeked = await page.evaluate(async () => {
  const el = window.SWR.Audio.audioEl;
  const dur = el.duration;
  window.SWR.Audio.seek(0.5);
  await new Promise((r) => setTimeout(r, 400));
  const l = window.SWR.Layers.list.find((x) => x.asset && x.asset.songBound);
  return {
    duration: dur,
    currentTime: el.currentTime,
    layerTime: l && l.asset._el ? l.asset._el.currentTime : null,
    expected: dur * 0.5,
  };
});
if (seeked.duration > 0 &&
    Math.abs(seeked.currentTime - seeked.expected) < 1.0 &&
    seeked.layerTime === seeked.currentTime) {
  ok('a seek moves the shared element — the picture follows the sound');
} else {
  bad('a seek moves the shared element — the picture follows the sound', seeked);
}

// 8. The renderer never called load() on the song element.
const loadState = await page.evaluate(() => {
  const el = window.SWR.Audio.audioEl;
  return {
    songLoaded: (window.__swrLoadedEls || []).indexOf(el) >= 0,
    loadedCount: (window.__swrLoadedEls || []).length,
  };
});
if (!loadState.songLoaded) ok('the renderer never re-loads the song element');
else bad('the renderer never re-loads the song element', loadState);

// 9. The layer can be removed while the audio keeps playing.
const removed = await page.evaluate(async () => {
  const api = window.SWR_SONG_VIDEO_LAYER;
  const el = window.SWR.Audio.audioEl;
  const before = el.currentTime;
  const did = api ? api.remove() : false;
  await new Promise((r) => setTimeout(r, 500));
  return {
    did,
    songLayers: window.SWR.Layers.list.filter((l) => l.asset && l.asset.songBound).length,
    stillPlaying: !el.paused,
    advanced: el.currentTime > before,
  };
});
if (removed.did && removed.songLayers === 0 && removed.stillPlaying && removed.advanced) {
  ok('the layer can be removed while the audio keeps playing');
} else {
  bad('the layer can be removed while the audio keeps playing', removed);
}

// 10. An audio song removes the song-video layer.
const swapped = await page.evaluate(async () => {
  try {
    const r = await fetch('/audios/test-clip.mp3');
    const b = await r.blob();
    window.SWR.Audio.loadFile(new File([b], 'test-clip.mp3', { type: 'audio/mpeg' }));
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 400));
  return {
    songLayers: window.SWR.Layers.list.filter((l) => l.asset && l.asset.songBound).length,
    songTag: window.SWR.Audio.audioEl ? window.SWR.Audio.audioEl.tagName : null,
  };
});
if (swapped.songLayers === 0 && swapped.songTag === 'AUDIO') {
  ok('an audio song removes the song-video layer');
} else {
  bad('an audio song removes the song-video layer', swapped);
}

const lateErrors = pageErrors.filter((e) => !/WebSocket.*ws:\/\/localhost:8787/.test(e));
if (lateErrors.length === 0) ok('no page errors during the run');
else bad('no page errors during the run', lateErrors);

console.log(results.join('\n'));
console.log('\nSONG VIDEO LAYER SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');

await browser.close();
await served.close();
