#!/usr/bin/env node
// scripts/check-recorder-verify.mjs — the export has to follow the beat.
//
// WHAT THIS ASSERTS
// -----------------
// 1. The capture canvas is IN THE DOCUMENT while it is recorded.
//
//    Pressing ● REC on the NEON page recorded nothing: the take ended with
//    "nothing captured - press REC while the song plays" and no file. The
//    recorder records a "mirror" — a second canvas the live stage is copied
//    into, with the page's CSS grade baked in, because captureStream() and
//    VideoFrame both read RAW canvas pixels and would otherwise miss a
//    display-only filter. The mirror was made with
//    document.createElement('canvas') and never appended.
//    lib/watermark.client.js wraps HTMLCanvasElement.prototype.captureStream,
//    so the recording is a compositor canvas that copies its source once per
//    frame — but only while that source is connected to the document (its
//    tick stops on `if (!source.isConnected)`). With the mirror detached the
//    compositor was never painted, the recorded canvas never changed,
//    captureStream() emitted no frames at all, MediaRecorder produced no
//    data, and the file came out empty.
//
// 2. A take produces a FILE.
//
// 3. The file CARRIES THE MUSIC — an audio stream, and not silence.
//
//    Two of the three recording paths shipped a file with NO audio at all:
//    the WebCodecs/MP4 path's audio tap threw while being set up (an
//    AnalyserNode's fftSize must be a power of two, and the code set
//    sampleRate * 0.1 * 2 — 9600 at 48 kHz), and swr-app.html's recorded
//    stream never got an audio track. A silent music video cannot follow
//    the beat.
//
// 4. The music and the picture are on ONE timeline.
//
// 5. The WebCodecs path's audio pull is REAL TIME and hands over only NEW
//    samples.
//
//    getFloatTimeDomainData returns the LAST N samples of the analyser's
//    window, not the new ones, so taking the whole window every frame
//    handed out the same audio over and over, and the timeline — a counter
//    advancing 100 ms per frame while the song advanced ~16 ms — ran about
//    six times too fast. The video frames were stamped with the wall clock
//    and the audio with that counter, so the two tracks could not be
//    aligned even in principle.
//
//    This one is checked against the puller directly, with a known signal,
//    because the MP4 path needs an H.264 encoder to reach the encoder at
//    all — a browser without one (CI included) cannot exercise it through
//    a real take, but the puller is where the timing lives.
//
// The source-level twin is scripts/check-recorder-capture-canvas-unit.mjs:
// that one states the canvas invariant in a second on every machine, this
// one proves the outcome in a browser.
//
// Run: node scripts/check-recorder-verify.mjs
//      node scripts/check-recorder-verify.mjs --self-test

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

// How long a take runs. Long enough for the recorder to emit a few
// chunks, short enough to keep the gate quick.
const TAKE_MS = 2500;

// How long the puller is driven with the known signal.
const PULL_MS = 1500;

// The signal the puller is fed. Not a multiple of 10 Hz on purpose: a
// repeated 100ms window of a 440Hz sine is phase-aligned with itself and
// would look continuous. At 437Hz a repetition shows up as a broken
// waveform, which is what the frequency check below looks for.
const SIGNAL_HZ = 437;

// The two tracks of the file may not be more than this far apart. The
// head of the file carries the recorder's own padding — measured at 38ms,
// 41ms and 106ms on three real exports — so the bound is set above the
// worst of those, and well below anything a viewer would call a
// desynchronised music video.
const MAX_TRACK_SKEW_S = 0.15;

// An export that is this quiet is silence, not music.
const MIN_MEAN_VOLUME_DB = -45;

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
 * The verdicts, as pure functions so the self-test can exercise them
 * without a browser: the empty recording that used to ship, the silent
 * export, and the smeared pull all have to fail here.
 */
function verdict(sample) {
  const problems = [];
  if (!sample.connectedDuringTake) {
    problems.push('the capture canvas was not in the document while the take ran');
  }
  if (!sample.chunkCount) problems.push('the recorder collected no chunks');
  if (!sample.totalBytes) problems.push('the recorded chunks are empty');
  if (!sample.blobSize) problems.push('the file handed to the download is empty');
  if (/nothing captured/i.test(sample.status || '')) {
    problems.push('the page reported "nothing captured"');
  }
  if (sample.connectedAfterTake) {
    problems.push('the capture canvas was left in the document after the take');
  }
  return problems;
}

function fileVerdict(probe) {
  const problems = [];
  if (!probe.hasAudio) problems.push('the file has no audio track — it is a silent music video');
  if (probe.hasAudio && probe.meanVolumeDb <= MIN_MEAN_VOLUME_DB) {
    problems.push('the audio track is silence (' + probe.meanVolumeDb + ' dB)');
  }
  if (probe.hasAudio && Math.abs(probe.trackSkewS) > MAX_TRACK_SKEW_S) {
    problems.push('the music and the picture are ' + Math.round(probe.trackSkewS * 1000) + ' ms apart');
  }
  return problems;
}

function pullVerdict(m) {
  const problems = [];
  if (m.chunks < 3) problems.push('the puller produced ' + m.chunks + ' chunks in ' + m.elapsedMs + 'ms');
  // The audio timeline has to track the wall clock: the old code produced
  // about six times as much audio as the time it took.
  if (m.audioSeconds > m.elapsedMs / 1000 * 1.25) {
    problems.push('the pull produced ' + m.audioSeconds.toFixed(2) + 's of audio in ' +
      (m.elapsedMs / 1000).toFixed(2) + 's of real time');
  }
  if (m.audioSeconds < m.elapsedMs / 1000 * 0.75) {
    problems.push('the pull produced only ' + m.audioSeconds.toFixed(2) + 's of audio in ' +
      (m.elapsedMs / 1000).toFixed(2) + 's of real time');
  }
  // Every chunk is stamped 100ms after the one before it.
  for (let i = 1; i < m.chunkSteps.length; i++) {
    const delta = m.chunkSteps[i] - m.chunkSteps[i - 1];
    if (Math.abs(delta - 100) > 1) {
      problems.push('the chunk timestamps do not advance by 100ms');
      break;
    }
  }
  // The signal has to come through INTACT: a sine that repeats its window
  // every frame comes out at the wrong frequency.
  const expected = 2 * SIGNAL_HZ;   // a sine crosses zero twice per period
  if (Math.abs(m.zeroCrossHz - expected) > expected * 0.03) {
    problems.push('the audio came out at ' + m.zeroCrossHz + ' Hz instead of ' + expected + ' Hz — the samples repeat');
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const failures = [];
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
  if (verdict(good).length) failures.push('a real take was rejected');
  const caught = verdict(empty);
  if (!caught.some((p) => /file handed to the download is empty/.test(p))) failures.push('the empty take was not caught');
  if (!caught.some((p) => /nothing captured/.test(p))) failures.push('the error status was not caught');
  const detached = verdict(Object.assign({}, good, { connectedDuringTake: false }));
  if (!detached.length) failures.push('a detached capture canvas was not caught');
  const leaked = verdict(Object.assign({}, good, { connectedAfterTake: true }));
  if (!leaked.length) failures.push('a leaked capture canvas was not caught');

  if (!fileVerdict({ hasAudio: false }).length) failures.push('a file with no audio was not caught');
  if (!fileVerdict({ hasAudio: true, meanVolumeDb: -80, trackSkewS: 0 }).some((p) => /silence/.test(p))) {
    failures.push('a silent audio track was not caught');
  }
  if (!fileVerdict({ hasAudio: true, meanVolumeDb: -12, trackSkewS: 0.4 }).some((p) => /apart/.test(p))) {
    failures.push('tracks 400ms apart were not caught');
  }
  if (fileVerdict({ hasAudio: true, meanVolumeDb: -12, trackSkewS: 0.01 }).length) {
    failures.push('a good file was rejected');
  }

  const goodPull = {
    chunks: 15, elapsedMs: 1500, audioSeconds: 1.5,
    chunkSteps: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400],
    zeroCrossHz: 874,
  };
  if (pullVerdict(goodPull).length) failures.push('a real pull was rejected');
  const smeared = Object.assign({}, goodPull, { audioSeconds: 9.1 });
  if (!pullVerdict(smeared).some((p) => /real time/.test(p))) failures.push('the smeared pull was not caught');
  const repeated = Object.assign({}, goodPull, { zeroCrossHz: 706 });
  if (!pullVerdict(repeated).some((p) => /repeat/.test(p))) failures.push('the repeated samples were not caught');
  const uneven = Object.assign({}, goodPull, { chunkSteps: [0, 100, 260, 300] });
  if (!pullVerdict(uneven).some((p) => /100ms/.test(p))) failures.push('the uneven timestamps were not caught');

  if (failures.length) {
    console.log('RECORDER VERIFY: FAIL (self-test: ' + failures.join('; ') + ')');
    process.exit(1);
  }
  console.log('RECORDER VERIFY: self-test ok');
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

/** ffprobe the recorded file: the tracks, and how loud the music is. */
function probeFile(file) {
  let streams = [];
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
    streams = JSON.parse(out).streams || [];
  } catch (_) {
    return { hasAudio: false, meanVolumeDb: -Infinity, trackSkewS: 0, note: 'ffprobe could not read the file' };
  }
  const audio = streams.find((s) => s.codec_type === 'audio');
  const video = streams.find((s) => s.codec_type === 'video');
  let meanVolumeDb = -Infinity;
  if (audio) {
    // ffmpeg writes volumedetect's report to STDERR, so the streams have to
    // be captured separately — execFileSync only hands back stdout.
    const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], {
      encoding: 'utf8',
    });
    const text = (vol.stderr || '') + (vol.stdout || '');
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(text);
    if (m) meanVolumeDb = parseFloat(m[1]);
  }
  const aStart = audio && audio.start_time !== undefined ? parseFloat(audio.start_time) : 0;
  const vStart = video && video.start_time !== undefined ? parseFloat(video.start_time) : 0;
  return {
    hasAudio: !!audio,
    audioCodec: audio ? audio.codec_name : null,
    videoCodec: video ? video.codec_name : null,
    meanVolumeDb,
    trackSkewS: aStart - vStart,
  };
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
  );

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

  // ---- 5. the puller: real time, and only NEW samples -------------------
  const pull = await boundStep(() => page.evaluate(async function (hz, ms) {
    if (!window.SWR_RECORDER || !window.SWR_RECORDER.createPuller) {
      return { error: 'lib/recorder.client.js did not expose createPuller' };
    }
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    var sr = ctx.sampleRate;
    var osc = ctx.createOscillator();
    osc.frequency.value = hz;
    var gain = ctx.createGain();
    gain.gain.value = 0.5;
    osc.connect(gain);
    var puller = window.SWR_RECORDER.createPuller(ctx, gain);
    osc.start();
    var chunks = [];
    var steps = [];
    var t0 = performance.now();
    await new Promise(function (res) {
      var tick = function () {
        var c = puller.pull();
        if (c) {
          chunks.push(Float32Array.from(c.samples));
          steps.push(Math.round(c.timestampUs / 1000));
        }
        if (performance.now() - t0 > ms) return res();
        requestAnimationFrame(tick);
      };
      tick();
    });
    puller.close();
    osc.stop();
    await ctx.close();
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var flat = new Float32Array(total);
    var at = 0;
    for (var j = 0; j < chunks.length; j++) { flat.set(chunks[j], at); at += chunks[j].length; }
    // A sine crosses zero twice per period, so the zero-crossing rate is
    // twice the frequency.
    var z = 0;
    for (var k = 1; k < flat.length; k++) {
      if ((flat[k - 1] < 0 && flat[k] >= 0) || (flat[k - 1] >= 0 && flat[k] < 0)) z++;
    }
    return {
      chunks: chunks.length,
      elapsedMs: Math.round(performance.now() - t0),
      audioSeconds: +(total / sr).toFixed(3),
      chunkSteps: steps,
      zeroCrossHz: Math.round(z / (flat.length / sr)),
    };
  }, SIGNAL_HZ, PULL_MS), 60000, 'puller timing');

  if (pull.error) {
    bad('the audio pull', pull.error);
  } else {
    const pullProblems = pullVerdict(pull);
    if (pullProblems.length) bad('the audio pull', pullProblems.join('; '));
    else {
      ok('the audio pull', pull.chunks + ' chunks, ' + pull.audioSeconds + 's of audio in ' +
        (pull.elapsedMs / 1000).toFixed(2) + 's, signal intact at ' + pull.zeroCrossHz + ' Hz');
    }
  }

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

  // ---- 3 + 4. the file carries the music, on one timeline ---------------
  const b64 = await page.evaluate(async function () {
    if (!window.__swrCaptured) return null;
    var buf = await window.__swrCaptured.arrayBuffer();
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  });
  if (!b64) {
    bad('the recorded file', 'no blob to inspect');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-recorder-'));
    const file = path.join(dir, 'take.webm');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const probe = probeFile(file);
    const fileProblems = fileVerdict(probe);
    if (fileProblems.length) bad('the recorded file', fileProblems.join('; '));
    else {
      ok('the recorded file', probe.videoCodec + ' + ' + probe.audioCodec + ', music at ' +
        probe.meanVolumeDb.toFixed(1) + ' dB, tracks ' + Math.round(probe.trackSkewS * 1000) + ' ms apart');
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  bad('verify run', msg);
} finally {
  try { await browser.close(); } catch (_) {}
  try { served.close(); } catch (_) {}
}

if (fails) {
  console.log('RECORDER VERIFY: FAIL (' + fails + ')');
  process.exit(1);
}

console.log('RECORDER VERIFY: ALL GREEN (' + verified.length + ' checks)');
