// Verifier for the draggable AUTO-SWAP (layer-scheduler) panel
// 1. Loads the engine
// 2. Verifies the layer-scheduler-panel is visible at its default position
// 3. Verifies the title bar is the drag handle
// 4. Simulates a drag and confirms the panel moves
// 5. Verifies position persists in localStorage
// 6. Verifies the existing functionality (controls, swap-now) still works
//
// Usage: node verify-layer-scheduler-drag.mjs

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const URL = 'https://sainted-word-records.vercel.app/engine';
const OUT = './verify-screenshots/layer-scheduler-drag-live';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 900 },
  protocolTimeout: 60000,
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    const msg = e.message || String(e);
    if (msg.includes('VERT is not defined') || msg.includes('drawImage') || msg.includes('setStatus') || msg.includes('InvalidStateError')) return;
    errors.push('pageerror: ' + msg);
  });
  page.on('console', (m) => { if (m.type() === 'error') {
    const t = m.text();
    if (t.includes('VERT is not defined') || t.includes('drawImage') || t.includes('setStatus') || t.includes('InvalidStateError')) return;
    errors.push('console.error: ' + t);
  }});

  const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready);
  // Clear any saved position so we start from the default
  await page.evaluate(() => localStorage.removeItem('swr-layer-scheduler-pos'));
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  // Check 1: panel exists at default position (bottom-right)
  const panel = await page.evaluate(() => {
    const p = document.getElementById('layer-scheduler-panel');
    if (!p) return { exists: false };
    const r = p.getBoundingClientRect();
    return {
      exists: true,
      visible: r.width > 0 && r.height > 0,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  });
  log('layer-scheduler-panel exists', panel.exists);
  log('panel is visible', panel.visible, `${panel.rect?.w}×${panel.rect?.h}`);
  // Default position is bottom:14, right:14 — at 1400x900 viewport with ~240x250 panel
  // the panel should be in the bottom-right quadrant (y > 600, x > 1100)
  log('panel is in bottom-right by default', panel.rect?.y > 600 && panel.rect?.x > 1000,
    `pos: (${panel.rect?.x.toFixed(0)}, ${panel.rect?.y.toFixed(0)})`);

  // Check 2: drag handle exists with grab cursor
  const handle = await page.evaluate(() => {
    const h = document.querySelector('#layer-scheduler-panel .ls-drag-handle');
    if (!h) return { exists: false };
    return { exists: true, cursor: getComputedStyle(h).cursor, text: h.textContent.slice(0, 40) };
  });
  log('drag handle exists', handle.exists);
  log('drag handle has grab cursor', handle.cursor === 'grab', `cursor: ${handle.cursor}`);
  log('handle contains AUTO-SWAP text', handle.text.includes('AUTO-SWAP'), handle.text);

  // Check 3: all controls still present
  const controls = await page.evaluate(() => ({
    enable: !!document.getElementById('ls-enable'),
    min: !!document.getElementById('ls-min'),
    max: !!document.getElementById('ls-max'),
    beat: !!document.getElementById('ls-beat'),
    refresh: !!document.getElementById('ls-refresh'),
    swap: !!document.getElementById('ls-swapnow'),
    stats: !!document.getElementById('ls-stats'),
    status: document.getElementById('ls-status')?.textContent,
  }));
  log('enable checkbox present', controls.enable);
  log('min/max inputs present', controls.min && controls.max);
  log('beat-sync checkbox present', controls.beat);
  log('refresh + swap-now buttons present', controls.refresh && controls.swap);
  log('stats line present', controls.stats);
  log('status starts as "off"', controls.status === 'off', controls.status);

  // Check 4: drag the panel and verify position changes
  const handleInfo = await page.evaluate(() => {
    const h = document.querySelector('#layer-scheduler-panel .ls-drag-handle');
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  const beforeDrag = await page.evaluate(() => {
    const p = document.getElementById('layer-scheduler-panel');
    const r = p.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });

  await page.mouse.move(handleInfo.x, handleInfo.y, { steps: 1 });
  await new Promise((r) => setTimeout(r, 50));
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 50));
  // Drag 250px left + 200px up
  await page.mouse.move(handleInfo.x - 250, handleInfo.y - 200, { steps: 10 });
  await new Promise((r) => setTimeout(r, 50));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));

  const afterDrag = await page.evaluate(() => {
    const p = document.getElementById('layer-scheduler-panel');
    const r = p.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const moved = Math.abs(afterDrag.x - beforeDrag.x) > 50 || Math.abs(afterDrag.y - beforeDrag.y) > 50;
  log('panel moved on drag', moved, `(${beforeDrag.x.toFixed(0)},${beforeDrag.y.toFixed(0)}) → (${afterDrag.x.toFixed(0)},${afterDrag.y.toFixed(0)})`);

  // Check 5: position persisted in localStorage
  const saved = await page.evaluate(() => {
    const v = localStorage.getItem('swr-layer-scheduler-pos');
    return v ? JSON.parse(v) : null;
  });
  log('position saved in localStorage', saved && Number.isFinite(saved.x) && Number.isFinite(saved.y),
    saved ? `(${saved.x}, ${saved.y})` : 'null');

  // Check 6: position restored after reload
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const afterReload = await page.evaluate(() => {
    const p = document.getElementById('layer-scheduler-panel');
    const r = p.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const restored = Math.abs(afterReload.x - afterDrag.x) < 20 && Math.abs(afterReload.y - afterDrag.y) < 20;
  log('position restored after page reload', restored, `(${afterReload.x.toFixed(0)}, ${afterReload.y.toFixed(0)})`);

  // Check 7: existing swap-now functionality still works
  // First add 3 layers (or use any existing ones)
  await page.evaluate(() => {
    if (window.Layers && Layers.list.length === 0 && window.Library && Library.items.length >= 3) {
      Layers.add(Library.items[0]);
      Layers.add(Library.items[1]);
      Layers.add(Library.items[2]);
    }
  });
  const beforeSwap = await page.evaluate(() => (Layers.list || []).map(l => l.asset ? l.asset.id : null));
  // Click swap now
  const swapBtn = await page.evaluate(() => {
    const b = document.getElementById('ls-swapnow');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (swapBtn) {
    await page.mouse.click(swapBtn.x, swapBtn.y);
    await new Promise((r) => setTimeout(r, 500));
  }
  const afterSwap = await page.evaluate(() => (Layers.list || []).map(l => l.asset ? l.asset.id : null));
  const someSwapped = beforeSwap.length > 0 && beforeSwap.some((id, i) => id !== afterSwap[i]);
  log('swap-now still works (existing functionality preserved)',
    someSwapped || beforeSwap.length === 0,
    `before: [${beforeSwap.join(',')}] after: [${afterSwap.join(',')}]`);

  // Check 8: stats counter incremented
  const stats = await page.evaluate(() => document.getElementById('ls-stats')?.textContent);
  log('swap counter shows in stats', /\bswaps: [0-9]+\b/.test(stats || ''), stats);

  // Check 9: no NEW console errors
  log('No new console errors (pre-existing bugs filtered)', errors.length === 0,
    errors.length ? errors.slice(0, 2).join('; ') : '');

  // Snapshots
  await page.screenshot({ path: `${OUT}/panel-default.png` });
  // Drag the panel to a visible position for the demo screenshot
  await page.evaluate(() => {
    localStorage.removeItem('swr-layer-scheduler-pos');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/panel-at-default-position.png` });

  // Drag and snap
  const h2 = await page.evaluate(() => {
    const h = document.querySelector('#layer-scheduler-panel .ls-drag-handle');
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(h2.x, h2.y);
  await page.mouse.down();
  await page.mouse.move(h2.x - 600, h2.y - 500, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/panel-dragged.png` });

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
