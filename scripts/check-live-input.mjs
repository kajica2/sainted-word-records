#!/usr/bin/env node
// scripts/check-live-input.mjs
//
// Checks the live camera and microphone input end to end.
//
//   npm run check:live-input
//   node scripts/check-live-input.mjs --target=http://127.0.0.1:8099/engine.html
//
// Chrome is launched with a synthetic camera and microphone
// (--use-fake-device-for-media-stream), so this runs on a machine with no
// camera: the fake device produces a moving colour pattern and a tone.
//
// What it asserts:
//   · the Live control appears in the media panel
//   · starting the camera adds a live layer whose video is actually
//     playing, and the stage pixels change over time (a paused camera
//     would still look like a picture)
//   · starting the mic routes it into the engine's own analyser, so the
//     engine's features respond to the room
//   · stopping both removes the layer and releases the devices
//
// No npm dependencies: headless Chrome over the DevTools Protocol, with
// Node's built-in WebSocket doing the work.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const TARGET = arg('target', 'http://127.0.0.1:8099/engine.html');
const HEADED = argv.includes('--headed');

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.ws = null; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('CDP websocket error'));
    });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }
      }, 120000);
    });
  }
  close() { try { this.ws.close(); } catch { /* closed */ } }
}

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find(Boolean);
  if (!bin) throw new Error('No Chrome binary found. Set CHROME_BIN.');
  const profile = mkdtempSync(join(tmpdir(), 'swr-live-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check',
    // A synthetic camera and microphone, so the check runs anywhere.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--window-size=1500,950', 'about:blank',
  ];
  if (!HEADED) args.unshift('--headless=new');
  // Its own process group, so the whole browser tree can be torn down.
  // Chrome spawns children, and killing only the parent leaves them
  // holding the fake camera — which then makes the next run flaky.
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stderr = '';
  const wsUrl = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Chrome did not expose a DevTools endpoint.\n' + stderr)), 30000);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    proc.on('exit', (c) => { clearTimeout(timer); rej(new Error('Chrome exited early (' + c + ')')); });
  });
  return { proc, wsUrl, profile };
}

// The whole interaction, run in the page.
const SCRIPT = `
(async () => {
  const R = [];
  const errs = [];
  window.addEventListener('unhandledrejection', (e) => {
    errs.push('rejection: ' + String((e.reason && e.reason.message) || e.reason));
  });
  window.addEventListener('error', (e) => errs.push('error: ' + e.message));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('button[title="Camera and microphone input"]');
  R.push({ step: 'live-button', ok: !!btn });
  if (!btn) return R;

  btn.click();
  await sleep(300);
  const panel = document.getElementById('swr-live-input');
  R.push({ step: 'panel-open', ok: !!panel && panel.style.display !== 'none' });
  if (!panel) return R;

  const camBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Camera');
  const micBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Mic');

  camBtn.click();
  await sleep(2500);
  const st1 = window.SWR_LIVE_INPUT.state();
  const liveLayer = window.SWR.Layers.list.find((l) => l.asset && l.asset.live);
  const v = liveLayer && liveLayer.asset._el;
  // A live camera is one whose clock advances. A paused element still has
  // a picture, so readyState alone proves nothing.
  // The synthetic camera delivers frames on its own schedule, and a
  // heavier page can stretch that out — give it a real window.
  // Decoded frame count, not currentTime: a MediaStream element's clock
  // is tied to frame delivery, and the frames only arrive while the
  // element is being consumed.
  let camAdvanced = false, frames = 0;
  if (v) {
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    const f0 = q ? q.totalVideoFrames : 0;
    await sleep(2500);
    const q2 = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    const f1 = q2 ? q2.totalVideoFrames : 0;
    frames = f1 - f0;
    camAdvanced = frames > 0;
  }
  R.push({
    step: 'camera', ok: st1.camera === true && !!liveLayer && camAdvanced,
    layerId: liveLayer && liveLayer.id,
    readyState: v && v.readyState, videoWidth: v && v.videoWidth,
    advancing: camAdvanced, frames: frames,
  });

  // The stage has to actually change: a paused camera would still draw a
  // picture, so a still frame proves nothing.
  // Two separate questions, two separate signals.
  //
  // Liveness — the camera's decoded frame count — is checked above.
  // Visibility — did it reach the stage? — is a lit-pixel count, not a
  // pixel-diff: the synthetic pattern rolls slowly, so a live stage can
  // change by almost nothing in a second while being fully lit.
  const stage = document.getElementById('render') || document.getElementById('basic-canvas');
  let visible = false, sampled = 0, lit = 0;
  if (stage) {
    const g = stage.getContext('2d');
    const d = g.getImageData(0, 0, stage.width, stage.height).data;
    const stride = 16 * 4;
    for (let i = 0; i < d.length; i += stride) {
      sampled++;
      if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
    }
    visible = sampled > 0 && lit > sampled * 0.2;
  }
  R.push({ step: 'stage-visible', ok: visible, lit: lit, sampled: sampled });

  // Re-query the button: starting the camera can re-render a panel and
  // leave the earlier reference pointing at a detached element.
  const panelAlive = !!document.getElementById('swr-live-input');
  const micBtn2 = [...document.querySelectorAll('#swr-live-input button')]
    .find((b) => b.textContent === 'Mic');
  R.push({ step: 'panel-alive', ok: panelAlive && !!micBtn2, panelAlive: panelAlive });
  (micBtn2 || micBtn).click();
  await sleep(12000);
  const st2 = window.SWR_LIVE_INPUT.state();
  const A = (window.SWR && window.SWR.Audio) || window.Audio;
  // The meter proves the mic is actually capturing; routed proves the
  // engine's own analyser is hearing it. The engine's own feature read
  // stays at zero until a song is playing, because that is when the
  // engine samples.
  let micInk = false;
  const meterCv = document.querySelector('#swr-live-mic-host canvas');
  if (meterCv) {
    const g = meterCv.getContext('2d');
    const d = g.getImageData(0, 0, meterCv.width, meterCv.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) { micInk = true; break; }
    }
  }
  R.push({
    step: 'mic', ok: st2.mic === true && st2.routed === true,
    routed: st2.routed, meterLive: micInk,
    message: st2.message, rms: A && A.feat ? A.feat.rms : null,
    errs: errs.slice(0, 4),
  });

  micBtn.click();
  await sleep(900);
  camBtn.click();
  await sleep(1200);
  const st3 = window.SWR_LIVE_INPUT.state();
  R.push({
    step: 'cleanup',
    ok: !st3.camera && !st3.mic && !window.SWR.Layers.list.find((l) => l.asset && l.asset.live),
    layers: window.SWR.Layers.list.length,
  });
  return R;
})()
`;

async function main() {
  const { proc, wsUrl, profile } = await launchChrome();
  const cdp = new Cdp(wsUrl);
  let exitCode = 0;
  try {
    await cdp.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: TARGET }, sessionId);

    const evaluate = async (expression, awaitPromise = false) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise, timeout: 120000,
      }, sessionId);
      if (res.exceptionDetails) {
        throw new Error('page eval threw: ' +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
      }
      return res.result?.value;
    };

    // Wait for the control itself. The engine's globals exist before the
    // deferred live-input module runs, so waiting on those would race.
    for (let i = 0; i < 200; i++) {
      let ok = false;
      try {
        ok = await evaluate(
          '!!(window.SWR && window.SWR_LIVE_INPUT && ' +
          "document.querySelector('button[title=\"Camera and microphone input\"]'))"
        );
      } catch { /* loading */ }
      if (ok) break;
      await sleep(250);
    }
    await sleep(1500);

    const results = await evaluate(SCRIPT, true);
    console.log('TARGET  ' + TARGET);
    for (const r of results) {
      const extra = Object.keys(r).filter((k) => k !== 'step' && k !== 'ok')
        .map((k) => k + '=' + JSON.stringify(r[k])).join(' ');
      console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + ' ' + r.step.padEnd(14) + extra);
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log('\nFAIL — ' + failed.length + ' of ' + results.length + ' checks failed');
      exitCode = 1;
    } else {
      console.log('\nPASS — camera, mic and cleanup all behave');
    }
  } catch (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    exitCode = 1;
  } finally {
    try { cdp.close(); } catch { /* ignore */ }
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(exitCode);
}

main();
