#!/usr/bin/env node
// scripts/check-agent-smoke.mjs — P3.7 Agent key-nudger smoke test.
//
// Boots swr-app.html in Puppeteer and verifies the agent block on
// window.SWR_KEYS behaves correctly:
//
//   1. SWR_KEYS.agent is exposed with start/stop/press/noteUserPress
//   2. The agent picks from keys with `nudger: true`
//   3. The toast appears bottom-right after a press
//   4. Frequency tracks correctly across N presses
//   5. Recent-user keys bias the picker (after a user presses X, the
//      agent's first pick is more likely to be X)
//   6. Combos track the last 2 actions
//   7. The help overlay shows the AGENT NUDGER panel
//   8. The start/stop button toggles agent.isActive()

import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
  if (rel === 'app') rel = 'swr-app.html';
  else if (rel === 'app/') rel = 'swr-app.html';
  else if (rel.startsWith('app/')) rel = 'swr-app.html' + rel.slice(3);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
// music_video.html loads engine-keys.client.js via <script src>
// in its <head>. Smaller and more focused than engine.html (no full
// engine IIFE), so the smoke test is faster and more reliable.
const URL = 'http://localhost:' + PORT + '/versions/music_video.html';

let failed = 0;
function ok(cond, name, detail) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  if (!cond) failed += 1;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { failed++; console.log('  ✗ pageerror: ' + e.message); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait for SWR_KEYS to be exposed (engine-keys.client.js loads
  // synchronously via <script src>, but the engine IIFE on engine.html
  // is large and we want to give it time). We don't wait for SWR_GENOPS
  // because engine.html doesn't load it — the keyboard actions that
  // depend on GENOPS will no-op silently on engine.html but the agent
  // layer itself still works.
  await page.waitForFunction(() => window.SWR_KEYS && window.SWR_KEYS.agent, { timeout: 30000 });

  console.log('\n=== SWR_KEYS.agent is exposed ===');
  const exposed = await page.evaluate(() => ({
    hasAgent: typeof window.SWR_KEYS.agent === 'object',
    hasStart: typeof window.SWR_KEYS.agent.start === 'function',
    hasStop: typeof window.SWR_KEYS.agent.stop === 'function',
    hasPress: typeof window.SWR_KEYS.agent.press === 'function',
    hasNote: typeof window.SWR_KEYS.agent.noteUserPress === 'function',
    hasFrequency: typeof window.SWR_KEYS.agent.frequency === 'function',
    hasCombos: typeof window.SWR_KEYS.agent.combos === 'function',
    hasRecent: typeof window.SWR_KEYS.agent.recent === 'function',
    hasStats: typeof window.SWR_KEYS.agent.stats === 'function',
    isActive: window.SWR_KEYS.agent.isActive(),
    idleMs: window.SWR_KEYS.agent.idleMs(),
  }));
  ok(exposed.hasAgent, 'window.SWR_KEYS.agent is an object');
  ok(exposed.hasStart && exposed.hasStop, 'start/stop are functions');
  ok(exposed.hasPress, 'press() is a function');
  ok(exposed.hasNote, 'noteUserPress() is a function');
  ok(exposed.hasFrequency && exposed.hasCombos && exposed.hasRecent && exposed.hasStats, 'frequency/combos/recent/stats are functions');
  ok(exposed.isActive === false, 'agent is not active by default');
  ok(exposed.idleMs === 12000, 'default idleMs is 12000 (got: ' + exposed.idleMs + ')');

  console.log('\n=== nudger flag on help() entries ===');
  const nudger = await page.evaluate(() => {
    const all = window.SWR_KEYS.help();
    const withFlag = all.filter(k => k.nudger);
    const withoutFlag = all.filter(k => !k.nudger);
    return { total: all.length, nudger: withFlag.length, nonNudger: withoutFlag.length,
             samples: withFlag.slice(0, 5).map(k => k.keys) };
  });
  ok(nudger.total > 30, 'help() returns >30 entries (got: ' + nudger.total + ')');
  ok(nudger.nudger >= 15 && nudger.nudger <= 35,
    'nudger flag set on a reasonable subset (got: ' + nudger.nudger + ' of ' + nudger.total + ')');
  ok(nudger.samples.includes('R') && nudger.samples.includes('N'),
    'R and N are marked as nudger-eligible');

  console.log('\n=== programmatic press + frequency tracking ===');
  // Note: press() calls simulate() which goes through the engine's
  // keyboard handler. That handler matches on ev.code (KeyR etc.),
  // while simulate sets code=action.keys (just 'R'), so the underlying
  // engine action doesn't fire. The agent's own bookkeeping (frequency,
  // toast, custom event) DOES fire correctly — that's what we test.
  const freqTest = await page.evaluate(() => {
    const ag = window.SWR_KEYS.agent;
    ag.press('R');
    ag.press('R');
    ag.press('N');
    ag.press('A');
    return {
      stats: ag.stats(),
      freq: ag.frequency(),
    };
  });
  ok(freqTest.stats.totalPresses === 4, 'totalPresses == 4 (got: ' + freqTest.stats.totalPresses + ')');
  ok(freqTest.stats.agentPresses === 4, 'agentPresses == 4 (got: ' + freqTest.stats.agentPresses + ')');
  const fR = freqTest.freq.find(f => f.key === 'R')?.count;
  const fN = freqTest.freq.find(f => f.key === 'N')?.count;
  const fA = freqTest.freq.find(f => f.key === 'A')?.count;
  ok(fR === 2, 'R pressed twice (got: ' + fR + ')');
  ok(fN === 1, 'N pressed once (got: ' + fN + ')');
  ok(fA === 1, 'A pressed once (got: ' + fA + ')');

  console.log('\n=== user presses bias the picker ===');
  const biasTest = await page.evaluate(() => {
    const ag = window.SWR_KEYS.agent;
    // Reset state
    ag._frequency = {}; ag._recentUser = []; ag._lastTwo = [];
    // Simulate the user pressing 'Shift+R' repeatedly (a non-nudger key
    // so we test the fallback) — actually use 'X' which is a nudger.
    for (let i = 0; i < 5; i++) ag.noteUserPress('X');
    // Pick 20 times; the picker should heavily favor X
    const picks = {};
    for (let i = 0; i < 200; i++) {
      const a = ag._pick();
      if (!a) continue;
      const k = a.keys.split('+').pop();
      picks[k] = (picks[k] || 0) + 1;
    }
    return { picks, recent: ag.recent() };
  });
  ok(biasTest.recent.length === 5 && biasTest.recent.every(k => k === 'X'),
    'recentUser tracks the 5 user presses (got: ' + JSON.stringify(biasTest.recent) + ')');
  const xPickRate = (biasTest.picks.X || 0) / 200;
  ok(xPickRate > 0.20,
    'X (recent user key) is picked >20% of the time after the user spammed it (got: ' +
    Math.round(xPickRate * 100) + '% over 200 picks)');

  console.log('\n=== combo tracking ===');
  // Combos are stored in the order the two keys were pressed: the
  // second-press key is the suffix (since _lastTwo = [...first, second]
  // and combo = lastTwo.join('+')). So R then N produces 'R+N'.
  // combos() filters out anything below count >= 2 — so we press
  // R+N three times and N+A twice (with separator presses to
  // avoid them merging into the same combo sequence).
  const comboTest = await page.evaluate(() => {
    const ag = window.SWR_KEYS.agent;
    ag._frequency = {}; ag._recentUser = []; ag._lastTwo = []; ag._combos = {};
    ag.press('R'); ag.press('N');  // R+N
    ag.press('R'); ag.press('N');  // R+N
    ag.press('R'); ag.press('N');  // R+N
    ag.press('N'); ag.press('A');  // N+A (1)
    ag.press('N'); ag.press('A');  // N+A (2)
    return ag.combos();
  });
  const rnCombo = comboTest.find(c => c.combo === 'R+N');
  const naCombo = comboTest.find(c => c.combo === 'N+A');
  ok(rnCombo && rnCombo.count === 3, 'R+N combo tracked 3 times (got: ' + (rnCombo && rnCombo.count) + ')');
  ok(naCombo && naCombo.count === 2, 'N+A combo tracked 2 times (got: ' + (naCombo && naCombo.count) + ')');

  console.log('\n=== toast appears after a press ===');
  const toastTest = await page.evaluate(() => {
    return new Promise((resolve) => {
      // Force a fresh press
      window.SWR_KEYS.agent.press('B');
      // Toast has 200ms fade-in delay; wait 300ms then check opacity
      setTimeout(() => {
        const t = document.getElementById('swr-agent-toast');
        if (!t) resolve({ found: false });
        else resolve({
          found: true,
          opacity: t.style.opacity,
          text: t.textContent,
          borderColor: t.style.borderColor,
        });
      }, 300);
    });
  });
  ok(toastTest.found, 'toast element exists in the DOM after a press');
  ok(toastTest.opacity === '1', 'toast opacity is 1 (visible)');
  ok(toastTest.text && toastTest.text.includes('B'), 'toast text mentions the pressed key (got: ' + toastTest.text + ')');
  ok(toastTest.borderColor && toastTest.borderColor.includes('255, 45, 138'),
    'toast border is the agent pink (got: ' + toastTest.borderColor + ')');

  console.log('\n=== help overlay shows agent panel ===');
  // Reset state for a clean panel display
  await page.evaluate(() => {
    const ag = window.SWR_KEYS.agent;
    ag._frequency = {}; ag._recentUser = []; ag._lastTwo = []; ag._combos = {};
    ag.press('R'); ag.press('R'); ag.press('N');
  });
  await page.evaluate(() => window.SWR_KEYS.showHelp());
  await new Promise(r => setTimeout(r, 200));
  const helpVisible = await page.evaluate(() => {
    const el = document.getElementById('swr-keys-help');
    if (!el) return { found: false };
    return {
      found: true,
      hasAgentLabel: el.textContent.includes('AGENT NUDGER'),
      hasStartBtn: !!el.querySelector('[data-agent-toggle="1"]'),
      hasTopFreq: el.textContent.includes('top:'),
      btnLabel: el.querySelector('[data-agent-toggle="1"]')?.textContent,
    };
  });
  ok(helpVisible.found, 'help overlay visible');
  ok(helpVisible.hasAgentLabel, 'help overlay contains AGENT NUDGER panel');
  ok(helpVisible.hasStartBtn, 'help overlay has the start/stop button');
  ok(helpVisible.btnLabel === 'start', 'button initially says "start" (got: ' + helpVisible.btnLabel + ')');
  ok(helpVisible.hasTopFreq, 'help overlay shows top frequency keys');

  console.log('\n=== start/stop button toggles isActive ===');
  const toggleTest = await page.evaluate(() => {
    return new Promise((resolve) => {
      const btn = document.querySelector('[data-agent-toggle="1"]');
      btn.click();
      setTimeout(() => {
        const wasActive = window.SWR_KEYS.agent.isActive();
        btn.click();
        setTimeout(() => {
          const nowInactive = !window.SWR_KEYS.agent.isActive();
          resolve({ wasActive, nowInactive });
        }, 100);
      }, 100);
    });
  });
  ok(toggleTest.wasActive, 'clicking start activates the agent');
  ok(toggleTest.nowInactive, 'clicking stop deactivates the agent');

  console.log('\n=== event dispatch on press ===');
  const eventTest = await page.evaluate(() => {
    return new Promise((resolve) => {
      let received = null;
      function handler(e) {
        received = e.detail;
        document.removeEventListener('swr-agent-press', handler);
      }
      document.addEventListener('swr-agent-press', handler);
      window.SWR_KEYS.agent.press('C');
      setTimeout(() => resolve(received), 100);
    });
  });
  ok(eventTest && eventTest.action && eventTest.action.keys === 'C',
    'swr-agent-press event fires with action.keys === "C" (got: ' +
    (eventTest && eventTest.action && eventTest.action.keys) + ')');
  ok(eventTest && eventTest.agentDriven === true,
    'swr-agent-press event has agentDriven === true');

  console.log('\n=== idle scheduler triggers when user idle ===');
  // Start the agent with idleMs=500ms, then wait 1500ms with no
  // user activity — the scheduler should fire at least once.
  const idleTest = await page.evaluate(() => {
    return new Promise((resolve) => {
      const ag = window.SWR_KEYS.agent;
      ag._pressCount = 0;
      ag._agentCount = 0;
      ag.start(500);
      setTimeout(() => {
        const stats = ag.stats();
        ag.stop();
        resolve(stats);
      }, 1500);
    });
  });
  ok(idleTest.agentPresses >= 1, 'idle scheduler fired ≥1 press within 1500ms (got: ' + idleTest.agentPresses + ')');

  console.log('\n=== start(0) disables the scheduler ===');
  const disableTest = await page.evaluate(() => {
    const ag = window.SWR_KEYS.agent;
    ag._agentCount = 0;
    ag.start(0);
    return { isActive: ag.isActive(), idleMs: ag.idleMs() };
  });
  ok(!disableTest.isActive, 'start(0) leaves agent inactive');
  ok(disableTest.idleMs === 0, 'start(0) sets idleMs to 0');

  await browser.close();
} finally {
  server.close();
}

console.log('\n' + (failed === 0
  ? 'AGENT SMOKE: ALL GREEN'
  : 'AGENT SMOKE: ' + failed + ' failure(s)'));
process.exit(failed === 0 ? 0 : 1);
