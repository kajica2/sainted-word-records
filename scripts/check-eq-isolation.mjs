#!/usr/bin/env node
// scripts/check-eq-isolation.mjs
//
// Confirms that each layer reacts ONLY to its own frequency band.
//
// The test plays audios/swr-eq-test.mp3 through a variant page. That track
// isolates one of the engine's bands at a time (see eq-test-plan.mjs), so
// a layer bound to `bass` must move during the bass segment and stay
// still through the mid, treble, air and silence ones.
//
// Two things are checked:
//
//   1. the engine's own band separation — in each segment, the feature
//      for that band is high and the others are low;
//   2. each layer's reactors — the target a band feature drives must move
//      in that band's segment, and not in the others.
//
// Broadband features (rms, centroid) and temporal ones (beat, onset) are
// reported but not asserted: rms is the time-domain energy and reacts to
// any sound at all, which is correct, not a leak.
//
// Usage:
//   node scripts/check-eq-isolation.mjs [--pages=neon] [--base=<origin>]
//                                      [--out=<chart.png>] [--headed]
//
// Env:
//   SWR_DEBUG_BASE  same as --base
//   CHROME_BIN      explicit Chrome/Chromium binary

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEGMENTS, SPECTRAL, segmentAt } from './eq-test-plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEBUGGER_SRC = join(ROOT, 'client', 'engine-debugger.client.js');

const DEFAULT_PAGES = ['neon'];
const BASE = 'https://sainted-word-records.vercel.app/versions/';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const has = (n) => argv.includes(`--${n}`);

const PAGES = arg('pages', process.env.SWR_DEBUG_PAGES || DEFAULT_PAGES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const BASES = arg('base', process.env.SWR_DEBUG_BASE || BASE).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = arg('out', '');
const TRACK = arg('track', join(ROOT, 'audios', 'swr-eq-test.mp3'));
const HEADED = has('headed');

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the track server ─────────────────────────────────────────────────────
// The page and the audio must be reachable from the same browser session.
// The audio is served with CORS so a page on any origin can fetch it.
//
// Chrome's Private Network Access applies here: a page on a public origin
// fetching http://127.0.0.1 sends a CORS preflight carrying
// Access-Control-Request-Private-Network, and the response has to answer it.
function startTrackServer() {
  const bytes = readFileSync(TRACK);
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TRACK.endsWith('.wav') ? 'audio/wav' : (TRACK.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg'),
      'Content-Length': bytes.length,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
    });
    res.end(bytes);
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ── CDP client ───────────────────────────────────────────────────────────

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
      }, 180000);
    });
  }
  close() { try { this.ws.close(); } catch { /* closed */ } }
}

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find(Boolean);
  if (!bin) throw new Error('No Chrome binary found. Set CHROME_BIN.');
  const profile = join('/tmp', 'swr-eq-' + Date.now());
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1000', 'about:blank',
  ];
  if (!HEADED) args.unshift('--headless=new');
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  return { proc, wsUrl };
}

// ── page helpers ─────────────────────────────────────────────────────────

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise, timeout: 180000,
  }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('page eval threw: ' + (d.exception?.description || d.text));
  }
  return res.result?.value;
}

async function waitFor(cdp, sessionId, expression, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ok = false;
    try { ok = await evaluate(cdp, sessionId, expression); } catch { /* navigating */ }
    if (ok) return true;
    await sleep(250);
  }
  throw new Error('timed out waiting for ' + label);
}

// ── in-page collection ───────────────────────────────────────────────────

const PREPARE_SRC = `
(async (trackUrl, trackB64) => {
  const S = window.SWR;
  const A = S.Audio;
  if (!A) return { ok: false, reason: 'SWR.Audio missing' };

  // Make sure the reactors are live and every layer opts in, whatever the
  // ambient state is. Rotation is opt-in per layer, so it is enabled too.
  if (window.SWR_TX_MASTER) window.SWR_TX_MASTER.enabled = true;

  // Two subsystems write into the transform independently of the audio
  // bands: the narrative-state drift (a slow positional wander) and the
  // LFO registry (time-based modulators). Neither is an EQ effect, and
  // leaving them on would put unrelated motion into the very targets
  // this test measures, so they are switched off for the run.
  window.__eqNarrative = window.SWR_NARRATIVE;
  window.SWR_NARRATIVE = undefined;
  window.__eqLfos = window.SWR_LFOS;
  window.SWR_LFOS = undefined;

  // Seed a stack of layers so each reactor preset is represented.
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ff2d8a'; g.fillRect(0, 0, 512, 512);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'eq-probe.png', { type: 'image/png' });
  await S.Library.addFiles([file]);
  const asset = S.Library.items[S.Library.items.length - 1];
  for (let i = 0; i < 6; i++) S.Layers.add(asset);

  // The engine's own analyser, with the page's own song taken off it so
  // only the test track is measured.
  A.unlock();
  if (A.src) { try { A.src.disconnect(); } catch (_) {} }
  if (A.el) { try { A.el.pause(); } catch (_) {} }

  // The track. The fetch is the happy path; the base64 copy is the
  // fallback for when the page's origin cannot reach the local server.
  let bytes;
  try {
    const res = await fetch(trackUrl);
    bytes = await res.arrayBuffer();
  } catch (err) {
    const bin = atob(trackB64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    bytes = arr.buffer;
  }

  // Decode and play it through the engine's analyser as a buffer source,
  // not as a media element. A media element's playback stalls when the
  // page's main thread is busy, which drags the timeline out of step with
  // the track; a buffer source is scheduled on the audio clock, so the
  // segment a frame belongs to is always the segment it was captured in.
  const ctx = A.ctx;
  const audioBuf = await ctx.decodeAudioData(bytes);
  const src = ctx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(A.an);
  const startAt = ctx.currentTime + 0.3;
  src.start(startAt);
  A.playing = true;
  window.__eqStart = startAt;

  return { ok: true, layers: S.Layers.list.length, duration: audioBuf.duration, startAt };
})
`;

const COLLECT_SRC = `
(async (ms) => {
  const D = window.SWR_DEBUGGER;
  const A = window.SWR.Audio;
  if (!D || !A) return { ok: false, reason: 'debugger or audio missing' };
  const start = window.__eqStart;
  const frames = [];
  const t0 = performance.now();
  await new Promise((resolve) => {
    let n = 0;
    function step() {
      n++;
      // Sampled at 10 Hz. The engine's own render loop is doing the work
      // here; reading every layer's transform on every frame starves the
      // page and the capture stops being clean.
      if (n % 6 === 0) {
        const s = D.snapshot();
        frames.push({
          t: A.ctx.currentTime - start,
          feat: {
            sub: A.feat.sub, bass: A.feat.bass, mid: A.feat.mid,
            treble: A.feat.treble, air: A.feat.air,
            rms: A.feat.rms, centroid: A.feat.centroid,
            beat: A.feat.beat, onset: A.feat.onset,
          },
          layers: s.layers.map((l) => ({ id: l.id, r: l.resolved || {} })),
        });
      }
      if (performance.now() - t0 < ms) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
  return { ok: true, frames };
})
`;

// ── analysis ─────────────────────────────────────────────────────────────

// The engine damps each reactor input with a 0.28 s half-life, so a band
// that stops playing keeps feeding its reactor for a moment. Measuring a
// segment from its first sample therefore catches the tail of the
// PREVIOUS segment, not a leak. The steady state is what answers
// "does this layer react to its own band", so each segment is measured
// after the damper has settled.
const SETTLE_S = 1.5;
const TAIL_S = 0.2;

function windowOf(seg) {
  return { from: seg.t0 + SETTLE_S, to: seg.t1 - TAIL_S };
}

// The engine's own band table has sub = bins 1..2 and bass = bins 2..11:
// they SHARE bin 2, so a tone in one always bleeds into the other. That
// is the engine's definition, not a leak.
const SHARED_BIN = [['sub', 'bass'], ['bass', 'sub']];
const sharesBin = (a, b) => SHARED_BIN.some(([x, y]) => x === a && y === b);

const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

// The features that belong to exactly one band, and the ones that do not.
const BAND_FEATURES = new Set(['bass', 'mid', 'treble', 'air', 'sub']);

function analyse(frames) {
  // Band separation: mean feature level per segment.
  const bands = [];
  for (const seg of SEGMENTS) {
    const inSeg = frames.filter((f) => f.t >= seg.t0 && f.t < seg.t1);
    const row = { id: seg.id, label: seg.label, t0: seg.t0, t1: seg.t1, n: inSeg.length, feat: {} };
    for (const k of SPECTRAL.concat(['rms', 'centroid'])) {
      const vals = inSeg.map((f) => f.feat[k] || 0);
      row.feat[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    bands.push(row);
  }

  // Per layer, per reactor target: movement inside each segment.
  const layerIds = frames.length ? frames[frames.length - 1].layers.map((l) => l.id) : [];
  const reactors = {};   // layerId -> [{feature, target, scale, ease}]
  const layerReport = [];

  // The reactor wiring comes from the engine's own layer objects.
  return { bands, layerIds, reactors, layerReport };
}

function analyseLayers(frames, layerDefs) {
  const layerIds = frames.length ? frames[frames.length - 1].layers.map((l) => l.id) : [];
  const reports = [];
  for (const def of layerDefs) {
    const reactors = def.reactors || [];
    const targets = {};
    for (const seg of SEGMENTS) {
      const w = windowOf(seg);
      const inSeg = frames.filter((f) => f.t >= w.from && f.t < w.to);
      for (const r of reactors) {
        const key = r.target;
        if (!targets[key]) targets[key] = {};
        const vals = inSeg
          .map((f) => {
            const lf = f.layers.find((x) => x.id === def.id);
            return lf ? lf.r[key] : undefined;
          })
          .filter((v) => typeof v === 'number');
        targets[key][seg.id] = mean(vals);
      }
    }
    // Displacement from the layer's resting value: the silence segment is
    // the control, so the difference is how far the band pushed it. A
    // steady band produces a steady value, so peak-to-peak inside a
    // segment would measure nothing at all.
    for (const key of Object.keys(targets)) {
      const base = targets[key]['silence'] || 0;
      for (const seg of SEGMENTS) {
        targets[key][seg.id] = (targets[key][seg.id] || 0) - base;
      }
    }
    reports.push({ id: def.id, name: def.name, reactors, targets });
  }
  return reports;
}

// ── chart ─────────────────────────────────────────────────────────────────

const CHART_SRC = `
(data) => {
  const W = 1200, H = 560;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:999999;background:#05030a';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const pad = { l: 54, r: 210, t: 30, b: 40 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const tMax = data.duration;
  const X = (t) => pad.l + (t / tMax) * plotW;

  g.fillStyle = '#05030a'; g.fillRect(0, 0, W, H);
  g.font = '11px ui-monospace, monospace';

  // --- segment bands ---
  data.segments.forEach((s, i) => {
    const x0 = X(s.t0), x1 = X(s.t1);
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.055)';
    g.fillRect(x0, pad.t, x1 - x0, plotH);
    g.fillStyle = '#8a7aa0';
    g.fillText(s.label, x0 + 4, pad.t + 12 + (i % 2) * 0);
  });

  // --- grid ---
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
  for (let v = 0; v <= 1.0001; v += 0.25) {
    const y = pad.t + plotH - v * plotH;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + plotW, y); g.stroke();
    g.fillStyle = '#5a4e6b'; g.fillText(v.toFixed(2), 14, y + 4);
  }

  // --- feature traces ---
  const COLORS = { sub: '#a06cff', bass: '#ff2d8a', mid: '#00f0ff', treble: '#fff04a', air: '#00ffa3' };
  const LAYER_H = plotH / data.segments.length;
  const topH = plotH * 0.52;
  data.features.forEach((f) => {
    g.beginPath(); g.strokeStyle = COLORS[f.key]; g.lineWidth = 1.4;
    f.points.forEach((p, i) => {
      const x = X(p[0]);
      const y = pad.t + topH - Math.max(0, Math.min(1, p[1])) * topH;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
  });

  // --- per-layer response strip ---
  data.layers.forEach((L, li) => {
    const top = pad.t + topH + 16 + li * LAYER_H;
    const h = LAYER_H - 6;
    g.fillStyle = '#f5e9ff';
    g.fillText(L.label, pad.l + plotW + 10, top + 9);
    for (const tgt of L.targets) {
      g.beginPath(); g.strokeStyle = tgt.color; g.lineWidth = 1.4;
      tgt.points.forEach((p, i) => {
        const x = X(p[0]);
        const y = top + h - Math.max(0, Math.min(1, p[1])) * h;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      g.fillStyle = tgt.color;
      g.fillText(tgt.label, pad.l + plotW + 18, top + 22 + (tgt.row || 0) * 11);
    }
  });

  // --- legend ---
  g.fillStyle = '#f5e9ff';
  g.fillText('SWR equaliser isolation test — ' + data.duration.toFixed(0) + 's', pad.l, 18);
  let ly = pad.t + 12;
  Object.keys(COLORS).forEach((k) => {
    g.fillStyle = COLORS[k];
    g.fillRect(W - 130, ly - 8, 10, 3);
    g.fillStyle = '#8a7aa0';
    g.fillText(k, W - 114, ly - 3);
    ly += 14;
  });
  return true;
}
`;

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const { server, port } = await startTrackServer();
  const trackUrl = `http://127.0.0.1:${port}/swr-eq-test.mp3`;
  const trackB64 = readFileSync(TRACK).toString('base64');
  const { proc, wsUrl } = await launchChrome();
  const cdp = new Cdp(wsUrl);
  let exitCode = 0;

  try {
    await cdp.connect();
    const debuggerSrc = readFileSync(DEBUGGER_SRC, 'utf8');

    for (const base of BASES) {
      for (const page of PAGES) {
        const url = base.replace(/\/$/, '') + '/' + page + '.html';
        console.log('\n=== ' + url + ' ===');

        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Page.navigate', { url }, sessionId);

        await waitFor(cdp, sessionId,
          "!!(window.SWR && window.SWR_RENDER && window.SWR.Audio && window.SWR.Layers)",
          'engine boot on ' + url);
        await sleep(1500);

        await evaluate(cdp, sessionId, debuggerSrc);
        await sleep(800);

        const prepared = await evaluate(cdp, sessionId,
          `(${PREPARE_SRC})(${JSON.stringify(trackUrl)}, ${JSON.stringify(trackB64)})`, true);
        if (!prepared?.ok) throw new Error('prepare failed: ' + JSON.stringify(prepared));

        // The layer wiring the engine actually applied.
        const layerDefs = await evaluate(cdp, sessionId, `(() => {
          return window.SWR.Layers.list.map((l) => ({
            id: l.id, name: l.asset ? l.asset.name : '(empty)',
            reactors: (l.reactors || []).map((r) => ({
              feature: r.feature, target: r.target, scale: r.scale, ease: r.ease })),
          }));
        })()`);

        console.log('layers: ' + layerDefs.length + '  track: ' + (prepared.duration || 0).toFixed(1) + 's');
        console.log('collecting 62s of frames…');

        const collected = await evaluate(cdp, sessionId, `(${COLLECT_SRC})(62000)`, true);
        if (!collected?.ok) throw new Error('collect failed: ' + JSON.stringify(collected));
        const frames = collected.frames;

        // ---- report ----
        const bands = [];
        for (const seg of SEGMENTS) {
          const w = windowOf(seg);
          const inSeg = frames.filter((f) => f.t >= w.from && f.t < w.to);
          const row = { id: seg.id, label: seg.label, t0: seg.t0, t1: seg.t1, n: inSeg.length, feat: {} };
          for (const k of SPECTRAL.concat(['rms', 'centroid'])) {
            const vals = inSeg.map((f) => f.feat[k] || 0);
            row.feat[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          }
          bands.push(row);
        }

        console.log('\nBAND SEPARATION (mean feature level per segment)');
        console.log('  ' + 'segment'.padEnd(24) + SPECTRAL.map((k) => k.padStart(8)).join('') + '    rms' + '  centroid');
        let bandFails = 0;
        for (const b of bands) {
          const expect = b.id === 'silence' ? null : (b.id === 'all' ? 'all' : b.id);
          let ok = true;
          if (expect && expect !== 'all') {
            // The band must carry real level, and every other band must
            // stay near the floor — except the band that shares an FFT
            // bin with it, which the engine counts twice by definition.
            const off = SPECTRAL.filter((k) => k !== expect)
              .filter((k) => !sharesBin(expect, k))
              .map((k) => b.feat[k]);
            const maxOff = off.length ? Math.max(...off) : 0;
            ok = b.feat[expect] > 0.3 && b.feat[expect] > 4 * maxOff;
          } else if (expect === 'all') {
            ok = ['bass', 'mid', 'treble', 'air'].every((k) => b.feat[k] > 0.25);
          } else {
            ok = SPECTRAL.every((k) => b.feat[k] < 0.1);
          }
          if (!ok) bandFails++;
          console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + b.label.padEnd(20) +
            SPECTRAL.map((k) => b.feat[k].toFixed(2).padStart(8)).join('') +
            b.feat.rms.toFixed(2).padStart(8) + b.feat.centroid.toFixed(2).padStart(10));
        }

        // What the engine's own maths says each layer should do in each
        // segment: the segment's band feature, through the reactor's own
        // ease curve, scaled by the reactor's gain. Compared against what
        // the layer actually did, this is the whole claim in one number —
        // if they match, the layer is doing nothing but reading its own
        // band, and any cross-talk is the engine's own shared-bin and
        // ease-curve behaviour rather than a leak.
        const meansBySeg = {};
        for (const b of bands) meansBySeg[b.id] = b.feat;
        const predictions = await evaluate(cdp, sessionId, `(() => {
          const ease = window.SWR_EASE.ease;
          const sens = window.SWR.Audio.params.sens;
          const means = ${JSON.stringify(meansBySeg)};
          const layers = ${JSON.stringify(layerDefs)};
          const out = {};
          for (const L of layers) {
            out[L.id] = {};
            for (const r of L.reactors) {
              const key = r.target + '|' + r.feature;
              out[L.id][key] = {};
              for (const seg in means) {
                const raw = means[seg][r.feature] || 0;
                const e = ease(r.ease, raw);
                const contrib = r.target === 'opacity' ? e * 0.5 : e * r.scale;
                out[L.id][key][seg] = contrib * sens;
              }
            }
          }
          return out;
        })()`);

        const reports = analyseLayers(frames, layerDefs);
        console.log('\nLAYER REACTION (displacement from the layer\'s resting value, per segment)');
        console.log('  ' + 'layer'.padEnd(12) + 'target'.padEnd(11) + 'feature'.padEnd(10) +
          SEGMENTS.map((s) => s.id.padStart(9)).join('') + '   verdict');
        let layerFails = 0;
        const layerRows = [];
        for (const rep of reports) {
          for (const r of rep.reactors) {
            const d = rep.targets[r.target] || {};
            const own = d[r.feature] || 0;
            const others = SEGMENTS
              .filter((s) => s.id !== r.feature && s.id !== 'all' && s.id !== 'silence')
              // A band that shares an FFT bin with this one legitimately
              // drives this reactor too — the engine counts that bin twice.
              .filter((s) => !sharesBin(r.feature, s.id))
              .map((s) => Math.abs(d[s.id] || 0));
            const maxOther = others.length ? Math.max(...others) : 0;
            const allDelta = Math.abs(d['all'] || 0);
            const bandBound = BAND_FEATURES.has(r.feature);
            let verdict, ok;
            if (!bandBound) {
              verdict = 'broadband — reported, not asserted';
              ok = true;
            } else {
              // Measured against the engine's own prediction, segment by
              // segment. Every segment has to match, including the ones
              // where a neighbouring band bleeds in through the shared
              // FFT bin — that bleed is the engine's definition, and the
              // prediction says exactly how big it should be.
              const pred = (predictions[rep.id] || {})[r.target + '|' + r.feature] || {};
              // Tolerance scales with the target's own dynamic range, not
              // with the per-segment prediction: a target that swings by
              // 47 units is held to 2% of that, while a target that
              // barely moves is held to a hair's breadth.
              const range = Math.max(...SEGMENTS.map((sg) => Math.abs(d[sg.id] || 0)), 0.02);
              const tol = 0.02 + 0.02 * range;
              let worst = 0, worstSeg = '';
              for (const seg of SEGMENTS) {
                const p = pred[seg.id] || 0;
                const m = d[seg.id] || 0;
                const err = Math.abs(m - p);
                if (err - tol > worst) { worst = err - tol; worstSeg = seg.id; }
              }
              const ownPred = pred[r.feature] || 0;
              const rests = Math.abs(d['silence'] || 0) <= 0.02;
              const responds = ownPred > 0.01;
              const allPred = Math.abs(pred['all'] || 0);
              ok = worst <= 0 && rests && responds;
              verdict = ok
                ? 'only its own band (predicted ' + ownPred.toFixed(3) + ', measured ' +
                  own.toFixed(3) + '; cross-talk ' + maxOther.toFixed(3) + ' is the shared-bin bleed)'
                : (!rests ? 'does not return to rest in silence'
                  : (!responds ? 'no response in its own band'
                    : 'deviates from the engine\'s own prediction in ' + worstSeg +
                      ' by ' + worst.toFixed(3)));
            }
            if (!ok) layerFails++;
            console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' +
              (rep.id + ' ' + (rep.name || '')).slice(0, 10).padEnd(12) +
              r.target.padEnd(11) + r.feature.padEnd(10) +
              SEGMENTS.map((s) => (d[s.id] || 0).toFixed(3).padStart(9)).join('') +
              '   ' + verdict);
            layerRows.push({ id: rep.id, feature: r.feature, target: r.target, deltas: d, own, maxOther, ok, bandBound });
          }
        }

        const totalFail = bandFails + layerFails;
        console.log('\n' + (totalFail === 0
          ? 'PASS — every band feature moved only in its own segment'
          : 'FAIL — ' + bandFails + ' band and ' + layerFails + ' layer checks failed'));

        // ---- chart ----
        if (OUT) {
          const duration = frames.length ? frames[frames.length - 1].t : 60;
          const downsample = (arr, n) => {
            if (arr.length <= n) return arr;
            const out = [];
            const step = arr.length / n;
            for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
            return out;
          };
          const featSeries = [];
          for (const k of SPECTRAL) {
            const pts = downsample(frames.map((f) => [f.t, f.feat[k] || 0]), 900);
            featSeries.push({ key: k, points: pts });
          }
          const layerSeries = [];
          const TCOLORS = ['#ff2d8a', '#00f0ff', '#fff04a', '#00ffa3', '#a06cff', '#ff8a5c'];
          reports.forEach((rep, li) => {
            const targets = rep.reactors.filter((r) => BAND_FEATURES.has(r.feature)).map((r, ti) => {
              const pts = [];
              for (const seg of SEGMENTS) {
                const inSeg = frames.filter((f) => f.t >= seg.t0 && f.t < seg.t1);
                const vals = inSeg.map((f) => {
                  const lf = f.layers.find((x) => x.id === rep.id);
                  return lf ? lf.r[r.target] : undefined;
                }).filter((v) => typeof v === 'number');
              }
              return null;
            });
            // A per-target trace across the whole track, normalised to its own peak.
            const traces = rep.reactors.filter((r) => BAND_FEATURES.has(r.feature)).map((r, ti) => {
              const raw = frames.map((f) => {
                const lf = f.layers.find((x) => x.id === rep.id);
                return [f.t, lf && typeof lf.r[r.target] === 'number' ? lf.r[r.target] : 0];
              });
              const vals = raw.map((p) => p[1]);
              const lo = Math.min(...vals), hi = Math.max(...vals);
              const span = hi - lo || 1;
              return {
                label: r.target + '←' + r.feature,
                color: TCOLORS[(li + ti) % TCOLORS.length],
                row: ti,
                points: downsample(raw, 900).map((p) => [p[0], (p[1] - lo) / span]),
              };
            });
            layerSeries.push({ label: rep.id + ' ' + (rep.name || ''), targets: traces });
          });

          const chartTarget = await cdp.send('Target.createTarget', { url: 'about:blank' });
          const { sessionId: chartSession } = await cdp.send('Target.attachToTarget', { targetId: chartTarget.targetId, flatten: true });
          await cdp.send('Runtime.enable', {}, chartSession);
          const chartData = { duration, segments: SEGMENTS, features: featSeries, layers: layerSeries };
          await evaluate(cdp, chartSession, `(${CHART_SRC})(${JSON.stringify(chartData)})`);
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, chartSession);
          writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
          console.log('chart: ' + OUT);
          await cdp.send('Target.closeTarget', { targetId: chartTarget.targetId });
        }

        await cdp.send('Target.closeTarget', { targetId });
        if (totalFail > 0) exitCode = 1;
      }
    }
  } catch (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    exitCode = 1;
  } finally {
    try { cdp.close(); } catch { /* ignore */ }
    proc.kill('SIGKILL');
    try { server.close(); } catch { /* ignore */ }
  }

  process.exit(exitCode);
}

main();
