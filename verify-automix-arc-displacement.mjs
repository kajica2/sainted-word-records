#!/usr/bin/env node
// verify-automix-arc-displacement.mjs — the regression contract for
// "changes over time are visible" (evolution plan; see
// docs/AUTOMIX-ARCHITECTURE.md).
//
//   node verify-automix-arc-displacement.mjs
//
// Boots engine.html (which autoloads /audios/endless-tomorrow.mp3,
// 117.6s, via client/default-library.client.js), waits for the L3 song
// arc, starts playback, then samples viewer-visible FX state every 5s.
//
// The contract: for every act of the song arc that was fully observed
// (≥3 samples with el.currentTime inside [act.t0, act.t1]), at least one
// of the 14 FX fields must move by ≥ 0.3 absolute (max - min over the
// act's samples). FX.state is the canonical unscaled state — FX.intensity
// never mutates it, so the master slider position cannot skew this.
//
// Also asserts the phase-3 pill format on the same page:
//   `auto · act N/M · <section> · <anchor>`  (arc path)
//
// Runtime budget: ~80-180s (sampling window), so it is deliberately NOT
// part of check:full / CI — it is the sprint gate for this contract,
// run standalone pre-merge like the other verify:* scripts.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8094;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'engine.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// The 14 scaled pipeline fields (fixed list — fx-postprocess.js state).
const FIELDS = [
  'temp', 'mut', 'posterize', 'vignette', 'chroma', 'grain', 'sepia',
  'glow', 'grayscale', 'blur', 'liquid', 'pearl', 'glitch', 'effect',
];
const DISPLACEMENT_MIN = 0.3;          // absolute, per act, at least one field
const TRANSPORT_WAIT_MS = 60000;       // engine boot under static serve is slow (~25s)
const SONG_WAIT_MS = 30000;            // default-library seed → audioEl.src
const ARC_WAIT_MS = 90000;             // analyzeFull on the 117s demo lands after boot
const PLAY_WAIT_MS = 10000;            // playback must start within 10s
const SAMPLE_INTERVAL_MS = 5000;       // 5s sampling cadence
const MIN_WINDOW_MS = 80000;           // sample for at least 80s
const MAX_WINDOW_MS = 180000;          // hard cap
const DEMO_SONG = '/audios/endless-tomorrow.mp3'; // default-library's autoload target (117.6s)
const PILL_RE = /^auto · act \d+\/\d+ · [a-z]+ · .+/;

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`http://127.0.0.1:${PORT}/engine.html?automix=1`,
      { waitUntil: 'networkidle2', timeout: 30000 });

    // The runtime writes #synth-pill every tick when the element exists
    // (music_video ships it inline; engine pages don't). Inject one so the
    // real formatting path below is observable.
    await page.evaluate(() => {
      if (!document.getElementById('synth-pill')) {
        const s = document.createElement('span');
        s.id = 'synth-pill';
        document.body.appendChild(s);
      }
    });

    // 1. Wait for the transport (window.Audio, attached by lib/audio.client.js
    //    late in the engine boot), then for a song. default-library seeds
    //    /audios/endless-tomorrow.mp3 — but only when no saved song exists and
    //    its poll windows line up; drive loadFile ourselves if it hasn't landed.
    try {
      await page.waitForFunction(() =>
        !!(window.Audio && typeof window.Audio.loadFile === 'function'),
        { timeout: TRANSPORT_WAIT_MS, polling: 500 });
      ok('engine transport up (window.Audio.loadFile)');
    } catch (_) {
      fail('engine transport', `window.Audio.loadFile absent after ${TRANSPORT_WAIT_MS / 1000}s (boot stalled)`);
      await browser.close();
      server.close();
      return;
    }
    try {
      await page.waitForFunction(() => {
        const A = window.Audio;
        return !!(A.audioEl && A.audioEl.getAttribute('src'));
      }, { timeout: SONG_WAIT_MS, polling: 500 });
      ok('default song loaded into transport');
    } catch (_) {
      // Contingency (plan-of-record): load the demo explicitly through the
      // page's own song-load affordance.
      const loaded = await page.evaluate(async (demo) => {
        try {
          const r = await fetch(demo);
          if (!r.ok) return 'HTTP ' + r.status;
          const f = new File([await r.blob()], 'endless-tomorrow.mp3', { type: 'audio/mpeg' });
          window.Audio.loadFile(f);
          return true;
        } catch (e) { return String(e); }
      }, DEMO_SONG);
      if (loaded !== true) {
        fail('default song loaded', `loadFile fallback failed: ${loaded}`);
        await browser.close();
        server.close();
        return;
      }
      try {
        await page.waitForFunction(() => {
          const A = window.Audio;
          return !!(A.audioEl && A.audioEl.getAttribute('src'));
        }, { timeout: 15000, polling: 500 });
        ok('demo song loaded via explicit loadFile fallback');
      } catch (_) {
        fail('default song loaded', 'audioEl.src still absent after explicit loadFile');
        await browser.close();
        server.close();
        return;
      }
    }

    // 2. Wait for the L3 arc (analyzeFull decodes the whole demo). No arc →
    //    nothing to test.
    try {
      await page.waitForFunction(
        () => !!(window.automix && window.automix.arc && window.automix.arc.acts &&
                 window.automix.arc.acts.length >= 3),
        { timeout: ARC_WAIT_MS, polling: 1000 }
      );
      ok('song arc built (\u22653 acts)');
    } catch (_) {
      const diag = await page.evaluate(() => {
        const A = window.SWR && window.SWR.Audio;
        const el = A && (A.el || A._el || A.audioEl);
        return {
          src: (el && el.src) || null,
          hasAnalyzeFull: !!(A && typeof A.analyzeFull === 'function'),
          hasArcModule: !!window.SWR_AUTOMIX_ARC,
          tickCount: window.automix ? window.automix.tickCount : -1,
          arcState: window.automix ? (window.automix.arc ? window.automix.arc.acts.length + ' acts' : 'null') : 'no automix',
          pageErrors: 'see pageerror hook output',
        };
      });
      fail('song arc built', `no arc after ${ARC_WAIT_MS / 1000}s — ${JSON.stringify(diag)} — console errors: ${errors.join('; ') || 'none'}`);
      await browser.close();
      server.close();
      return;
    }

    // 3. Start playback (default-library loads but does not play).
    try {
      await page.waitForFunction(() => {
        const A = window.Audio;
        const el = A && (A.el || A._el || A.audioEl);
        if (!el || !el.src) return false;
        if (el.paused) { try { A.play(); } catch (_) {} }
        return !el.paused && el.currentTime > 0;
      }, { timeout: PLAY_WAIT_MS, polling: 500 });
      ok('playback started');
    } catch (_) {
      fail('playback started', `audio element did not start within ${PLAY_WAIT_MS / 1000}s`);
      await browser.close();
      server.close();
      return;
    }

    // 3. Pill format (phase 3 proof). Ticks run every ~1.5s; the pill only
    //    carries act context on the arc path, which is now guaranteed.
    try {
      await page.waitForFunction(
        (reSrc) => {
          const el = document.getElementById('synth-pill');
          return el && new RegExp(reSrc).test(el.textContent || '');
        },
        { timeout: 30000, polling: 1000 }, PILL_RE.source
      );
      const pill = await page.evaluate(() => document.getElementById('synth-pill').textContent);
      ok(`pill act context: "${pill}"`);
    } catch (_) {
      const pill = await page.evaluate(() => {
        const el = document.getElementById('synth-pill');
        return el ? el.textContent : '(missing)';
      });
      fail('pill act context', `expected /${PILL_RE.source}/, got "${pill}"`);
    }

    // 4. Sample every 5s until a fully-observed act exists (min 80s, cap 180s).
    const acts = await page.evaluate(() =>
      window.automix.arc.acts.map((a) => ({ t0: a.t0, t1: a.t1, anchorId: a.anchorId })));
    const samples = [];
    const started = Date.now();
    let coveredCount = 0;
    while (true) {
      const sample = await page.evaluate((fields) => {
        const A = (window.SWR && window.SWR.Audio) || window.Audio;
        const el = A && (A.el || A._el || A.audioEl);
        const st = (window.FX && window.FX.state) || {};
        const out = {};
        for (const f of fields) {
          const v = st[f];
          out[f] = (typeof v === 'number' && isFinite(v)) ? v : null;
        }
        return { t: (el && el.currentTime) || 0, fields: out };
      }, FIELDS);
      samples.push(sample);
      const elapsed = Date.now() - started;
      coveredCount = acts.filter((act) =>
        samples.filter((s) => s.t >= act.t0 && s.t <= act.t1).length >= 3).length;
      const minWindowDone = elapsed >= MIN_WINDOW_MS;
      if ((minWindowDone && coveredCount >= 1) || elapsed >= MAX_WINDOW_MS) break;
      await sleep(SAMPLE_INTERVAL_MS);
    }

    if (coveredCount === 0) {
      const actTable = acts
        .map((a) => `    [${a.t0.toFixed(1)}s \u2192 ${a.t1.toFixed(1)}s] ${a.anchorId}`)
        .join('\n');
      fail('fully-observed act',
        `no fully-covered act after ${MAX_WINDOW_MS / 1000}s (${samples.length} samples) — ` +
        `song too short / autoplay stalled. Acts:\n${actTable}`);
      await browser.close();
      server.close();
      return;
    }
    ok(`${coveredCount}/${acts.length} acts fully observed (${samples.length} samples over ` +
       `${((Date.now() - started) / 1000).toFixed(0)}s)`);

    // 5. Displacement contract per fully-observed act.
    const report = [];
    for (let ai = 0; ai < acts.length; ai++) {
      const act = acts[ai];
      const inAct = samples.filter((s) => s.t >= act.t0 && s.t <= act.t1);
      if (inAct.length < 3) continue;
      const deltas = {};
      for (const f of FIELDS) {
        const vals = inAct.map((s) => s.fields[f]).filter((v) => v !== null);
        deltas[f] = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
      }
      const winner = Object.entries(deltas).sort((a, b) => b[1] - a[1])[0];
      report.push({ act: ai, t0: act.t0, t1: act.t1, anchorId: act.anchorId,
                    samples: inAct.length, winner, deltas });
    }

    console.log('\n  per-act displacement (max - min over act samples):');
    let contractHeld = true;
    for (const row of report) {
      const held = row.winner[1] >= DISPLACEMENT_MIN;
      if (!held) contractHeld = false;
      console.log(`    act ${row.act + 1} [${row.t0.toFixed(1)}\u2192${row.t1.toFixed(1)}s] ` +
        `${row.anchorId}  (${row.samples} samples)  ` +
        `winner ${row.winner[0]} \u0394=${row.winner[1].toFixed(3)} ` +
        (held ? '\u2713' : `\u2717 below ${DISPLACEMENT_MIN}`));
      if (!held) {
        const all = FIELDS.map((f) => `${f}=${row.deltas[f].toFixed(3)}`).join(' ');
        console.log(`      all fields: ${all}`);
      }
    }

    if (contractHeld && report.length > 0) {
      ok(`displacement contract held: \u2265${DISPLACEMENT_MIN} movement in every fully-observed act`);
    } else if (report.length === 0) {
      fail('displacement contract', 'no act had \u22653 samples despite coverage pass (sampling race)');
    } else {
      fail('displacement contract',
        'an act moved less than ' + DISPLACEMENT_MIN + ' on every field — see per-act table above');
    }

    // 6. Page errors anywhere in the run are failures.
    if (errors.length === 0) ok('no pageerror during the run');
    else fail('pageerror', errors.join('; '));

    await browser.close();
  } finally {
    server.close();
  }
}

run().catch((err) => { console.error('FATAL', err); process.exit(1); });
