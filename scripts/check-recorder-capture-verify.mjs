#!/usr/bin/env node
// scripts/check-recorder-capture-verify.mjs — a take must produce a FILE.
//
// THE BUG THIS GUARDS AGAINST
// ---------------------------
// Pressing ● REC on the NEON page recorded nothing. The take ended with
// "nothing captured - press REC while the song plays" and no file.
//
// The cause was the capture canvas. The recorder records a "mirror": a
// second canvas that the live stage is copied into, with the page's CSS
// grade baked in — because captureStream() and VideoFrame both read RAW
// canvas pixels and would otherwise miss a display-only filter. The mirror
// was made with document.createElement('canvas') and never appended.
//
// lib/watermark.client.js wraps HTMLCanvasElement.prototype.captureStream,
// so the recording is a compositor canvas that copies its source once per
// frame — but only while that source is connected to the document (its tick
// stops on `if (!source.isConnected)`). With the mirror detached, the
// compositor was never painted, the recorded canvas never changed,
// captureStream() emitted no frames at all, MediaRecorder produced no data,
// and the file came out empty.
//
// The fix puts the mirror in the document for the length of the take
// (versions/neon.html) and takes it out again when the take ends.
//
// WHAT THIS ASSERTS
// -----------------
// On every path a take can take — the WebM fallback and whatever ● REC
// picks with the format on "auto" — a real recording produces real bytes:
// the blob handed to the download is not empty, the recorder collected
// chunks, the capture canvas was in the document while the take ran and
// is gone again now, and the page says "saved" rather than "nothing
// captured".
//
// The source-level twin is scripts/check-recorder-capture-canvas-unit.mjs:
// that one states the invariant in a second on every machine, this one
// proves the outcome in a browser.
//
// Run: node scripts/check-recorder-capture-verify.mjs
//      node scripts/check-recorder-capture-verify.mjs --self-test

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

// How long a take runs. Long enough for the recorder to emit a few
// chunks, short enough to keep the gate quick.
const TAKE_MS = 2500;

// A stalled page used to hang the whole gate: the page thread never runs an
// in-page timer, so the deadline has to live in Node.
function boundStep(work, ms, label) {
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label + ' exceeded ' + ms + 'ms'));
    }, ms);
    Promise.resolve().then(work).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * The verdict on one take. Pure, so the self-test can exercise it
 * without a browser: the empty recording that used to ship must fail
 * here, and a real one must pass.
 */
function verdict(sample) {
  const problems = [];
  if (!sample.connectedDuringTake) {
    problems.push('the capture canvas was not in the document while the take ran');
  }
  if (!sample.chunkCount) {
    problems.push('the recorder collected no chunks');
  }
  if (!sample.totalBytes) {
    problems.push('the recorded chunks are empty');
  }
  if (!sample.blobSize) {
    problems.push('the file handed to the download is empty');
  }
  if (/nothing captured/i.test(sample.status || '')) {
    problems.push('the page reported "nothing captured"');
  }
  if (sample.connectedAfterTake) {
    problems.push('the capture canvas was left in the document after the take');
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const good = {
    connectedDuringTake: true,
    connectedAfterTake: false,
    chunkCount: 11,
    totalBytes: 2836497,
    blobSize: 2836497,
    status: 'saved · WEBM · 2771 KB',
  };
  const empty = {
    connectedDuringTake: true,
    connectedAfterTake: false,
    chunkCount: 0,
    totalBytes: 0,
    blobSize: 0,
    status: 'nothing captured - press REC while the song plays',
  };
  const failures = [];
  if (verdict(good).length) failures.push('a real take was rejected');
  const caught = verdict(empty);
  if (!caught.some((p) => /file handed to the download is empty/.test(p))) failures.push('the empty take was not caught');
  if (!caught.some((p) => /nothing captured/.test(p))) failures.push('the error status was not caught');
  const detached = verdict(Object.assign({}, good, { connectedDuringTake: false }));
  if (!detached.length) failures.push('a detached capture canvas was not caught');
  const leaked = verdict(Object.assign({}, good, { connectedAfterTake: true }));
  if (!leaked.length) failures.push('a leaked capture canvas was not caught');
  if (failures.length) {
    console.log('RECORDER CAPTURE VERIFY: FAIL (self-test: ' + failures.join('; ') + ')');
    process.exit(1);
  }
  console.log('RECORDER CAPTURE VERIFY: self-test ok');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ensureDist();
const served = await serveDist(0);
const BASE = served.url;

const browser = await puppeteer.launch({
  protocolTimeout: 180000,
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

function ok(label, detail) {
  verified.push(label);
  console.log('  ✓ ' + label + ' — ' + detail);
}
function bad(label, detail) {
  console.log('  ✗ ' + label + (detail ? ' (' + detail + ')' : ''));
  fails++;
}

/** One take, from ● REC to the blob that gets downloaded. */
async function take(format) {
  // The blob _save() hands to the download is the file the user gets.
  await page.evaluate(function () {
    window.__swrCaptured = null;
    if (!window.__swrPatched) {
      var orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (b) {
        if (b instanceof Blob && b.size > (window.__swrCaptured ? window.__swrCaptured.size : 0)) {
          window.__swrCaptured = b;
        }
        return orig(b);
      };
      window.__swrPatched = true;
    }
  });

  await boundStep(
    () => page.evaluate(function (fmt) { return window.SWR.Recorder.start(fmt); }, format),
    120000,
    'start ' + format,
  ).catch((err) => { throw err; });

  await sleep(TAKE_MS);

  const during = await boundStep(() => page.evaluate(function () {
    var src = window.SWR.Recorder._captureSource;
    var el = document.getElementById('status');
    return {
      connected: !!(src && src.isConnected),
      status: el ? el.textContent : '',
    };
  }), 20000, 'probe during take');

  await boundStep(() => page.evaluate(function () { window.SWR.Recorder.stop(); }), 20000, 'stop ' + format);

  // The MP4 path finalizes asynchronously (the encoder posts 'done'), so
  // the blob can land a moment after stop().
  await page.waitForFunction(function () {
    return window.__swrCaptured && window.__swrCaptured.size > 0;
  }, { timeout: 45000, polling: 200 }).catch(function () {});

  const after = await boundStep(() => page.evaluate(function () {
    var rec = window.SWR.Recorder;
    var chunks = rec.chunks || [];
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].size || 0;
    var src = rec._captureSource;
    var el = document.getElementById('status');
    return {
      chunkCount: chunks.length,
      totalBytes: total,
      blobSize: window.__swrCaptured ? window.__swrCaptured.size : 0,
      blobType: window.__swrCaptured ? window.__swrCaptured.type : '',
      mime: rec.mime,
      status: el ? el.textContent : '',
      connected: !!(src && src.isConnected),
    };
  }), 20000, 'probe after take');

  return {
    sample: {
      connectedDuringTake: during.connected,
      connectedAfterTake: after.connected,
      chunkCount: after.chunkCount,
      totalBytes: after.totalBytes,
      blobSize: after.blobSize,
      status: after.status,
    },
    blobType: after.blobType,
    mime: after.mime,
  };
}

try {
  await page.goto(BASE + '/versions/neon.html', { waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.waitForFunction(function () {
    return window.SWR && window.SWR.Recorder && typeof window.SWR.Recorder.start === 'function';
  }, { timeout: 60000 });

  await page.waitForFunction(function () {
    var s = window.SWR.stage;
    return s && s.width > 16 && s.height > 16;
  }, { timeout: 60000, polling: 200 });

  // A take needs a song: Recorder.start() refuses with "load a song first"
  // when there is none, so the gate loads one the way the page does.
  await page.evaluate(async function () {
    if (window.SWR && window.SWR.Audio && window.SWR.Audio.el) return;
    if (typeof window.SWR_LOAD_DEFAULT_SONG === 'function') {
      try { await window.SWR_LOAD_DEFAULT_SONG(); } catch (_) {}
    }
    var core = window.SWR && window.SWR.Audio;
    if (core && !core.el) {
      try {
        var res = await fetch('/audios/neon.mp3');
        if (res.ok) {
          var blob = await res.blob();
          var file = new File([blob], 'neon.mp3', { type: 'audio/mpeg' });
          if (typeof core.loadFile === 'function') core.loadFile(file);
          else if (typeof core.load === 'function') core.load(file);
        }
      } catch (_) {}
    }
    try { await core.play(); } catch (_) {}
  });

  await page.waitForFunction(function () {
    var a = window.SWR && window.SWR.Audio;
    return !!(a && a.el);
  }, { timeout: 45000, polling: 300 }).catch(function () {});

  const webCodecs = await page.evaluate(function () {
    try {
      return !!(window.SWR_RECORDER && window.SWR_RECORDER.canUseWebCodecs && window.SWR_RECORDER.canUseWebCodecs());
    } catch (_) { return false; }
  });
  console.log('  · WebCodecs (H.264) available in this browser: ' + webCodecs);

  // The WebM path is the one that shipped broken: a browser that cannot
  // encode H.264 falls back to it, and the fallback had never worked.
  const webm = await take('webm');
  const webmProblems = verdict(webm.sample);
  if (webmProblems.length) bad('webm take', webmProblems.join('; '));
  else ok('webm take', webm.sample.chunkCount + ' chunks, ' + Math.round(webm.sample.blobSize / 1024) + ' KB, ' + webm.blobType);

  // And the path ● REC takes with the format on "auto".
  const auto = await take('auto');
  const autoProblems = verdict(auto.sample);
  if (autoProblems.length) bad('auto take', autoProblems.join('; '));
  else ok('auto take', auto.sample.chunkCount + ' chunks, ' + Math.round(auto.sample.blobSize / 1024) + ' KB, ' + auto.blobType);
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  bad('verify run', msg);
} finally {
  try { await browser.close(); } catch (_) {}
  try { served.close(); } catch (_) {}
}

if (fails) {
  console.log('RECORDER CAPTURE VERIFY: FAIL (' + fails + ')');
  process.exit(1);
}

console.log('RECORDER CAPTURE VERIFY: ALL GREEN (' + verified.length + ' takes)');
