// Verifier for the SWR forced watermark in the engine
// 1. Verifies thanks.html is live and renders correctly
// 2. Loads the engine and verifies #rec-wm offers the three marks and no
//    "none" — the mark is forced for everyone, there is no opt-out
// 3. For each mark (a, b, c), drives the compositor the recorder captures
//    from (SWR_WATERMARK.frameSource — what canvas.captureStream is wrapped to
//    hand back) and verifies the mark's pixels are on the captured surface
//
// Usage: node verify-watermark.mjs
//        ENGINE_URL=http://127.0.0.1:5203/engine.html node verify-watermark.mjs

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ROOT = process.env.SITE_ROOT || 'https://sainted-word-records.vercel.app';
const ENGINE = process.env.ENGINE_URL || `${ROOT}/engine`;
const THANKS = process.env.THANKS_URL || `${ROOT}/thanks.html`;
const OUT = './verify-screenshots/watermark-live';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 900 },
});

try {
  // --- Part 1: Verify thanks.html ---
  const thanksPage = await browser.newPage();
  const thanksResp = await thanksPage.goto(THANKS, { waitUntil: 'networkidle0' });
  log('thanks.html HTTP 200', thanksResp.status() === 200, `(${thanksResp.status()})`);
  const thanksContent = await thanksPage.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim(),
    badgeText: document.querySelector('.badge')?.textContent?.trim(),
    stepCount: document.querySelectorAll('.step').length,
  }));
  log('thanks.html has h1', !!thanksContent.h1, thanksContent.h1);
  log('thanks.html has 4 steps', thanksContent.stepCount === 4, `(${thanksContent.stepCount})`);
  log('thanks.html has order-received badge', thanksContent.badgeText === 'Order received', thanksContent.badgeText);
  await thanksPage.screenshot({ path: `${OUT}/thanks.png`, fullPage: true });
  await thanksPage.close();

  // --- Part 2: Verify the forced watermark in the engine ---
  const page = await browser.newPage();
  const errors = [];
  const responses404 = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('response', (r) => { if (r.status() === 404) responses404.push(r.url()); });

  const resp = await page.goto(ENGINE, { waitUntil: 'networkidle0', timeout: 30000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));

  // Check 1: #rec-wm offers a/b/c and no "none"
  const wmSelector = await page.evaluate(() => {
    const sel = document.querySelector('#rec-wm');
    if (!sel) return { exists: false };
    return { exists: true, options: Array.from(sel.options).map((o) => o.value) };
  });
  log('rec-wm selector exists', wmSelector.exists);
  log('rec-wm has 3 options', wmSelector.options?.length === 3, wmSelector.options?.join(','));
  log('rec-wm has no "none" option (mark is forced)', !wmSelector.options?.includes('none'));
  log('rec-wm includes "a", "b", "c"', ['a', 'b', 'c'].every((k) => wmSelector.options?.includes(k)));

  // Check 2: each mark asset is reachable
  for (const wm of ['a', 'b', 'c']) {
    const status = await page.evaluate(async (key) => {
      try {
        const r = await fetch(`./swr-watermark-${key}.svg`, { method: 'HEAD' });
        return r.status;
      } catch (e) { return 0; }
    }, wm);
    log(`watermark ${wm} SVG reachable`, status === 200, `(${status})`);
  }

  // Check 3: the forcing layer is installed (captureStream is wrapped)
  const forcing = await page.evaluate(() => ({
    present: typeof window.SWR_WATERMARK?.frameSource === 'function',
    wrapped: window.HTMLCanvasElement.prototype.captureStream.__swrForced === true,
  }));
  log('SWR_WATERMARK.frameSource present', forcing.present);
  log('captureStream wrapped (every capture goes through the compositor)', forcing.wrapped);

  // Check 4: for each mark, the captured surface carries the mark's pixels.
  // Synthetic black source canvas → the compositor the recorder captures from
  // → sample the mark box the same way drawMark places it (18% width, 3.3% margin).
  for (const wm of ['a', 'b', 'c']) {
    await page.evaluate((key) => {
      const sel = document.querySelector('#rec-wm');
      if (sel) { sel.value = key; sel.dispatchEvent(new Event('change')); }
    }, wm);

    const result = await page.evaluate(async () => {
      const src = document.createElement('canvas');
      src.width = 1280;
      src.height = 720;
      src.style.cssText = 'position:fixed;left:-2000px;top:0';
      const sctx = src.getContext('2d');
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, src.width, src.height);
      document.body.appendChild(src);

      const comp = window.SWR_WATERMARK.frameSource(src);
      if (!comp) { src.remove(); return { ok: false, reason: 'no compositor' }; }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const w = comp.width, h = comp.height;
      const targetW = Math.round(w * 0.18);
      const targetH = Math.round(targetW * (comp.height / comp.width)); // any aspect: sample the band
      const margin = Math.round(Math.min(w, h) * 0.033);
      const box = { x: w - targetW - margin, y: h - Math.min(targetH, 240) - margin, w: targetW, h: Math.min(targetH, 240) };
      const data = comp.getContext('2d').getImageData(box.x, Math.max(0, box.y), box.w, box.h).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 90) bright++;
      const snap = comp.toDataURL('image/png');
      src.remove();
      return { ok: true, bright, box, snap };
    });

    const ok = result.ok && result.bright > 50;
    log(`mark ${wm} lands on the captured surface`, ok, result.ok ? `${result.bright} px bright in ${result.box.w}×${result.box.h}` : result.reason);
    if (result.snap) {
      writeFileSync(`${OUT}/captured-${wm}.png`, Buffer.from(result.snap.split(',')[1], 'base64'));
    }
  }

  // Check 5: no NEW console errors. Resource-load messages carry no URL, so
  // 404s are counted from the response stream instead — filtering the routes
  // only the deployed site answers (the static preview cannot).
  const knownStaticRoute = (u) => /\/api\//.test(u) || /\/null$/.test(u);
  const new404s = responses404.filter((u) => !knownStaticRoute(u));
  const newErrors = errors.filter((e) =>
    !e.includes('VERT is not defined') &&
    !e.includes('drawImage') &&
    !e.includes('setStatus') &&
    !e.includes('InvalidStateError') &&
    !/Failed to load resource/.test(e)
  );
  const errTotal = newErrors.length + new404s.length;
  log('No new console errors', errTotal === 0, errTotal ? [...newErrors, ...new404s].slice(0, 3).join('; ') : `(${errors.length} console msgs, ${responses404.length} static-route 404s ignored)`);

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed < total) {
    console.log('Failed:');
    checks.filter((c) => !c.ok).forEach((c) => console.log(`  - ${c.name}: ${c.info || ''}`));
    process.exit(1);
  }
} finally {
  await browser.close();
}
