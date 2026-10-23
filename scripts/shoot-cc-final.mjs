// Final Command Center screenshots, with a real track loaded so the
// spectrum, meters and FX stack show genuine data.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 54063;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/workspace/chain-shots';
fs.mkdirSync(OUT, { recursive: true });

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: 'dist', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const TRACK = '/workspace/repo-review/sainted-word-records/dist/audios/aurora.mp3';

async function shoot(variant, viewport, tag, withAudio) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('swr_app_version_seen', '2026.10.13.1');
      localStorage.setItem('swr.engine.mode', 'advanced');
    } catch (_) {}
  });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    return req.abort();
  });
  await page.goto(`${BASE}/versions/${variant}.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  if (withAudio) {
    const input = await page.$('#song-input');
    if (input) {
      await input.uploadFile(TRACK);
      await new Promise((r) => setTimeout(r, 2500));
      await page.evaluate(() => {
        if (window.Audio && window.Audio.play) window.Audio.play();
        const b = document.getElementById('play');
        if (b && window.Audio && !window.Audio.playing) b.click();
      });
      await new Promise((r) => setTimeout(r, 4500));
    }
  }

  await page.evaluate(() => { if (window.SWR_COMMAND_CENTER) window.SWR_COMMAND_CENTER.open(); });
  await new Promise((r) => setTimeout(r, 3500));

  await page.screenshot({ path: `${OUT}/${tag}.png` });
  const info = await page.evaluate(() => {
    const A = (window.SWR_COMMAND_CENTER && window.SWR_COMMAND_CENTER.api.audio) || {};
    const f = A.feat || {};
    return {
      rms: f.rms, bass: f.bass, mid: f.mid, treble: f.treble, beat: f.beat, bpm: f.bpm,
      playing: A.playing,
      peak: (document.querySelector('[data-cc-meter="peak"]') || {}).textContent,
      hud: (document.querySelector('[data-cc-hud="stats"]') || {}).textContent,
    };
  });
  console.log(tag, JSON.stringify(info));
  await page.close();
}

await shoot('neon', { width: 1600, height: 1000 }, 'cc-final-neon', true);
await shoot('grid', { width: 1600, height: 1000 }, 'cc-final-grid', true);
await shoot('neon', { width: 390, height: 844 }, 'cc-final-mobile', false);

await browser.close();
srv.kill();
console.log('done →', OUT);