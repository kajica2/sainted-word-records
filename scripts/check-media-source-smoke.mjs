#!/usr/bin/env node
// scripts/check-media-source-smoke.mjs
//
// Puppeteer smoke for the Media Source panel and the single-clock playback
// engine, against the built engine.
//
// Assertions:
//   1. the engine boots with no page errors
//   2. the Media Source panel is mounted with its four rows
//   3. the source node is created only once the media is ready
//      (loadedmetadata / canplay), not before
//   4. the panel shows the loaded media
//   5. the sync and the offset are disabled while the video carries its own
//      audio (one element = one clock), and enabled for an external file
//   6. the clock is the media element, and it advances with playback
//   7. the bar counter is paced by the media clock: a frozen media freezes
//      the counter (an independent wall clock would keep it running)
//   8. "None" silences the analyser while the picture keeps running
//   9. an external audio file becomes the clock and is what the analyser
//      hears — which is what the export records
//  10. a positive offset delays the audio: the picture runs ahead
//  11. the panel's controls drive the engine
//
// Run: node scripts/check-media-source-smoke.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDist, serveDist } from './with-dist.mjs';
import puppeteer from 'puppeteer';

ensureDist();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SONG_VIDEO = '/swr-intro-10s-voice.mp4';   // tracked, 10 s, h264 + aac
const EXTERNAL_AUDIO = '/audios/test-clip.mp3';    // tracked, 60 s

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
         '--enable-unsafe-swiftshader',
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
  // Record every createMediaElementSource() call with the element's
  // readyState at that moment. The engine must not build the graph before
  // the media is ready (loadedmetadata / canplay).
  try {
    window.__swrSourceCalls = [];
    const orig = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (el) {
      try {
        window.__swrSourceCalls.push({
          readyState: el && el.readyState,
          tag: el && el.tagName,
        });
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

// 2. The panel is mounted with its four rows.
const panel = await page.evaluate(() => {
  const host = document.getElementById('media-source');
  if (!host) return { mounted: false };
  const sel = document.getElementById('msrc-source');
  const sync = document.getElementById('msrc-sync');
  const offset = document.getElementById('msrc-offset');
  const file = document.getElementById('msrc-audio-file');
  return {
    mounted: true,
    // The audio-file row only appears once an external file is loaded, so
    // the panel shows four rows. (The library panel itself is collapsed
    // until it is opened, so the test cannot use layout visibility.)
    rows: Array.from(host.querySelectorAll('.msrc-row'))
      .filter((r) => r.style.display !== 'none').length,
    options: sel ? Array.from(sel.options).map((o) => o.value) : [],
    hasSync: !!sync,
    hasOffset: !!offset,
    hasFile: !!file,
    api: !!window.SWR_MEDIA_SOURCE,
  };
});
if (panel.mounted && panel.rows === 4) ok('the Media Source panel is mounted with its four rows');
else bad('the Media Source panel is mounted with its four rows', panel);
if (panel.options && panel.options.join(',') === 'video,external,none') {
  ok('the audio source select offers video / external / none');
} else {
  bad('the audio source select offers video / external / none', panel.options);
}
if (panel.hasSync && panel.hasOffset && panel.hasFile && panel.api) {
  ok('the panel has the sync toggle, the offset and the file picker');
} else {
  bad('the panel has the sync toggle, the offset and the file picker', panel);
}

// The default library seeds its own song and layers at boot. Wait for it
// to settle, otherwise it can replace the song this smoke loads.
await page.waitForFunction(
  () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')),
  { timeout: 30000, polling: 200 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));

// Load the video as the song.
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
  () => window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.readyState >= 1,
  { timeout: 20000, polling: 100 }).catch(() => {});

// 3. The source node is created only once the media is ready.
const sourceCalls = await page.evaluate(() => (window.__swrSourceCalls || []).slice());
if (sourceCalls.length >= 1 && sourceCalls.every((c) => c.readyState >= 1)) {
  ok('the source node is created only after the media is ready',
    JSON.stringify(sourceCalls));
} else {
  bad('the source node is created only after the media is ready', sourceCalls);
}

// 4. The panel shows the loaded media.
const panelName = await page.evaluate(() => {
  const n = document.querySelector('#media-source .msrc-name');
  return n ? n.textContent : null;
});
if (panelName === 'swr-intro-10s-voice.mp4') ok('the panel shows the loaded media');
else bad('the panel shows the loaded media', panelName);

// 5. The sync and the offset are disabled while the video carries its own
//    audio — one element is one clock, so there is nothing to trim.
const videoMode = await page.evaluate(() => {
  const sync = document.getElementById('msrc-sync');
  const offset = document.getElementById('msrc-offset');
  return {
    source: window.SWR.Audio.audioSource,
    syncDisabled: sync.disabled,
    offsetDisabled: offset.disabled,
    syncTitle: sync.title,
  };
});
if (videoMode.source === 'video' && videoMode.syncDisabled && videoMode.offsetDisabled) {
  ok('with the video\'s own audio the sync and the offset are disabled');
} else {
  bad('with the video\'s own audio the sync and the offset are disabled', videoMode);
}
if (videoMode.syncTitle && /always in sync/i.test(videoMode.syncTitle)) {
  ok('and the controls explain why they are disabled');
} else {
  bad('and the controls explain why they are disabled', videoMode.syncTitle);
}

// 6. The clock is the media element and advances with playback.
await page.evaluate(() => { try { window.SWR.Audio.play(); } catch (_) {} });
await new Promise((r) => setTimeout(r, 1500));
const running = await page.evaluate(() => {
  const A = window.SWR.Audio;
  const el = A.audioEl;
  return {
    clock: A.clock,
    elementTime: el ? el.currentTime : null,
    sameClock: A.clockElement() === el,
    playing: A.playing,
    bar: A.bar,
  };
});
if (running.sameClock && running.elementTime > 0.2 &&
    Math.abs(running.clock - running.elementTime) < 0.05) {
  ok('the clock is the media element and advances with playback');
} else {
  bad('the clock is the media element and advances with playback', running);
}

// 7. The bar counter is paced by the media clock. Freezing the element
//    (without touching Audio.playing) must freeze the counter: a wall
//    clock would keep it running.
// BPM detection can lag on slow CI runners; _tickBar() is a no-op until
// feat.bpm is known, which made this assertion look like a wall-clock bug.
await page.waitForFunction(
  () => {
    const A = window.SWR.Audio;
    return !!(A && A.feat && A.feat.bpm > 0);
  },
  { timeout: 20000, polling: 100 }
).catch(() => {});
await page.evaluate(() => { try { window.SWR.Audio.play(); } catch (_) {} });
await new Promise((r) => setTimeout(r, 1200));
const frozen = await page.evaluate(async () => {
  const A = window.SWR.Audio;
  const el = A.audioEl;
  A.resetBarCounter();
  const before = A.bar;
  el.pause();                       // the media stops, the engine does not
  await new Promise((r) => setTimeout(r, 1500));
  const after = A.bar;
  el.play();
  await new Promise((r) => setTimeout(r, 600));
  const resumed = A.bar;
  return { before, after, resumed, playing: A.playing, time: el.currentTime };
});
if (frozen.after === frozen.before && frozen.resumed > frozen.after) {
  ok('the bar counter is paced by the media clock, not by a wall clock', frozen);
} else {
  bad('the bar counter is paced by the media clock, not by a wall clock', frozen);
}

// 8. "None" silences the analyser while the picture keeps running.
const silent = await page.evaluate(async () => {
  const A = window.SWR.Audio;
  // The loudest frame of the video's own track — the baseline that "None"
  // has to fall away from.
  let baseline = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 40));
    baseline = Math.max(baseline, A.feat.rms);
  }
  A.setAudioSource('none');
  await new Promise((r) => setTimeout(r, 1500));
  // The raw analyser buffer is the ground truth: silence is 128 everywhere.
  const time = new Uint8Array(A.analyser.fftSize);
  A.analyser.getByteTimeDomainData(time);
  let dev = 0;
  for (const v of time) dev = Math.max(dev, Math.abs(v - 128));
  return {
    source: A.audioSource,
    baseline,
    rms: A.feat.rms,
    rawDeviation: dev,
    connected: !!A.source,
    time: A.audioEl ? A.audioEl.currentTime : null,
  };
});
if (silent.source === 'none' && !silent.connected && silent.time > 0 &&
    silent.rawDeviation <= 2 && silent.rms < silent.baseline * 0.15) {
  ok('"None" silences the analyser while the picture keeps running', silent);
} else {
  bad('"None" silences the analyser while the picture keeps running', silent);
}

// 9. An external audio file becomes the clock and is what the analyser
//    hears — which is what the export records.
const ext = await page.evaluate(async (src) => {
  const A = window.SWR.Audio;
  try {
    const r = await fetch(src);
    const b = await r.blob();
    await A.loadExternalAudio(new File([b], 'test-clip.mp3', { type: b.type || 'audio/mpeg' }));
  } catch (e) { return { error: String(e) }; }
  A.play();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    source: A.audioSource,
    externalName: A.externalName,
    clockIsExternal: A.clockElement() === A.externalEl,
    clock: A.clock,
    externalTime: A.externalEl ? A.externalEl.currentTime : null,
    rms: A.feat.rms,
    mediaTime: A.audioEl ? A.audioEl.currentTime : null,
    select: document.getElementById('msrc-source').value,
    syncDisabled: document.getElementById('msrc-sync').disabled,
    offsetDisabled: document.getElementById('msrc-offset').disabled,
  };
}, EXTERNAL_AUDIO);
if (ext.source === 'external' && ext.clockIsExternal && ext.externalName === 'test-clip.mp3') {
  ok('an external audio file becomes the clock');
} else {
  bad('an external audio file becomes the clock', ext);
}
if (ext.rms > 0.02) {
  ok('the analyser hears the external file (the export records the same)');
} else {
  bad('the analyser hears the external file (the export records the same)', ext);
}
if (ext.select === 'external' && !ext.syncDisabled && !ext.offsetDisabled) {
  ok('the panel switches to the external file and enables the sync and the offset');
} else {
  bad('the panel switches to the external file and enables the sync and the offset', ext);
}

// 10. A positive offset delays the audio: the picture runs ahead.
const offset = await page.evaluate(async () => {
  const A = window.SWR.Audio;
  const input = document.getElementById('msrc-offset');
  input.value = '500';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  const ext2 = A.externalEl, media = A.audioEl;
  return {
    offsetMs: A.offsetMs,
    stored: localStorage.getItem('swr.media.offsetMs'),
    mediaTime: media ? media.currentTime : null,
    audioTime: ext2 ? ext2.currentTime : null,
    drift: (media && ext2) ? media.currentTime - ext2.currentTime : null,
  };
});
if (offset.offsetMs === 500 && offset.stored === '500') {
  ok('the offset control drives the engine and is remembered');
} else {
  bad('the offset control drives the engine and is remembered', offset);
}
if (offset.drift !== null && Math.abs(offset.drift - 0.5) < 0.2) {
  ok('a positive offset delays the audio: the picture runs ahead by it', offset);
} else {
  bad('a positive offset delays the audio: the picture runs ahead by it', offset);
}

// 11. The panel's controls drive the engine.
const wired = await page.evaluate(async () => {
  const A = window.SWR.Audio;
  const sel = document.getElementById('msrc-source');
  sel.value = 'none';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const afterNone = A.audioSource;
  const sync = document.getElementById('msrc-sync');
  sync.checked = false;
  sync.dispatchEvent(new Event('change', { bubbles: true }));
  const afterSync = A.sync;
  return { afterNone, afterSync, selectValue: sel.value };
});
if (wired.afterNone === 'none' && wired.afterSync === false) {
  ok('the panel\'s controls drive the engine');
} else {
  bad('the panel\'s controls drive the engine', wired);
}

const lateErrors = pageErrors.filter((e) => !/WebSocket.*ws:\/\/localhost:8787/.test(e));
if (lateErrors.length === 0) ok('no page errors during the run');
else bad('no page errors during the run', lateErrors);

console.log(results.join('\n'));
console.log('\nMEDIA SOURCE SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');

await browser.close();
await served.close();
