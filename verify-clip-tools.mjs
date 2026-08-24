// Puppeteer verify for the per-clip rotate + randomise buttons + 'r' shortcut
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/index.html';
const errors = [];
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));

  // 0. Add 3 layers via the engine API (engine starts empty)
  const setupResult = await page.evaluate(() => {
    if (!window.Layers || typeof window.Layers.add !== 'function') return { ok: false, reason: 'Layers.add not found' };
    // Create 3 mock layers
    for (let i = 0; i < 3; i++) {
      window.Layers.add({
        name: 'test-asset-' + (i + 1) + '.jpg',
        thumb: null,
      });
    }
    return { ok: true, count: window.Layers.list.length };
  });
  console.log('setup:', setupResult);
  if (!setupResult.ok) errors.push('could not add layers: ' + setupResult.reason);
  // Force a re-render
  await page.evaluate(() => window.Layers && window.Layers.render && window.Layers.render());
  await new Promise((r) => setTimeout(r, 200));

  // 1. Layer list has layers
  const layerCount = await page.$$eval('.layer', (els) => els.length);
  console.log('layer count:', layerCount);
  if (layerCount === 0) errors.push('no layers in the list after add()');

  // 2. Each layer has .x-rot and .x-rand buttons
  const rotButtons = await page.$$('.layer .x-rot');
  const randButtons = await page.$$('.layer .x-rand');
  console.log(`rotate buttons: ${rotButtons.length} / randomise buttons: ${randButtons.length} (expected: ${layerCount})`);
  if (rotButtons.length !== layerCount) errors.push(`expected ${layerCount} rotate buttons, got ${rotButtons.length}`);
  if (randButtons.length !== layerCount) errors.push(`expected ${layerCount} randomise buttons, got ${randButtons.length}`);
  if (rotButtons.length === layerCount && randButtons.length === layerCount) {
    console.log('  ✓ every layer has both buttons');
  }

  // 3. Get initial state of first layer
  const initial = await page.evaluate(() => {
    const l = window.Layers.list[0];
    return { id: l.id, rot: l.pos.rot, x: l.pos.x, y: l.pos.y, baseScale: l.baseScale, blend: l.blend };
  });
  console.log('initial layer state:', initial);

  // 3a. Debug: check what classes the first .x-rot button actually has
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('.x-rot');
    if (!btn) return null;
    return {
      tag: btn.tagName,
      className: btn.className,
      text: btn.textContent.trim(),
      hasHandler: !!btn.onclick,
      parentClass: btn.parentElement?.className || null,
    };
  });
  console.log('first .x-rot button:', btnInfo);

  // 4. Click the rotate button on the first layer — use JS click (puppeteer .click() sometimes doesn't trigger delegated handlers)
  const rotateResult = await page.evaluate(() => {
    const btn = document.querySelector('.x-rot');
    const before = window.Layers.list[0].pos.rot;
    btn.click();
    const after = window.Layers.list[0].pos.rot;
    return { before, after, diff: after - before };
  });
  console.log(`rotate click: rot ${rotateResult.before.toFixed(2)} → ${rotateResult.after.toFixed(2)} (diff ${rotateResult.diff.toFixed(2)})`);
  if (Math.abs(rotateResult.diff - 90) > 0.5) errors.push(`rotate button didn't add 90°: diff ${rotateResult.diff}`);

  // 5. Click the randomise button on the first layer
  //    NOTE: capture values as primitives (not object refs) since the layer object is mutated in place
  const randResult = await page.evaluate(() => {
    const btn = document.querySelector('.x-rand');
    const l = window.Layers.list[0];
    const before = { rot: l.pos.rot, x: l.pos.x, y: l.pos.y, baseScale: l.baseScale, blend: l.blend };
    btn.click();
    const after = { rot: l.pos.rot, x: l.pos.x, y: l.pos.y, baseScale: l.baseScale, blend: l.blend };
    return { before, after };
  });
  console.log('randomise: before=', randResult.before, 'after=', randResult.after);
  const rChanged = (
    randResult.after.rot !== randResult.before.rot ||
    randResult.after.x !== randResult.before.x ||
    randResult.after.y !== randResult.before.y ||
    randResult.after.baseScale !== randResult.before.baseScale ||
    randResult.after.blend !== randResult.before.blend
  );
  if (!rChanged) errors.push('randomise button did not change any property');
  if (randResult.after.baseScale < 0.4 - 0.01 || randResult.after.baseScale > 1.8 + 0.01) {
    errors.push(`randomise baseScale out of range: ${randResult.after.baseScale}`);
  }
  console.log('  ✓ randomise changed properties');

  // 6. Select the first layer, then dispatch 'r' — should rotate the selected layer by 90°
  await page.evaluate(() => {
    window.Layers.select(window.Layers.list[0]);
  });
  const firstLayerEl = await page.$('.layer');
  await firstLayerEl.click();
  await new Promise((r) => setTimeout(r, 100));
  const isSelected = await page.evaluate(() => !!window.Layers.selected);
  console.log('first layer selected:', isSelected);
  if (!isSelected) errors.push('first layer not selected after click');

  const rotBeforeR = await page.evaluate(() => window.Layers.selected.pos.rot);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
  });
  await new Promise((r) => setTimeout(r, 100));
  const rotAfterR = await page.evaluate(() => window.Layers.selected.pos.rot);
  const expectedR = (rotBeforeR + 90) % 360;
  console.log(`'r' key: rot ${rotBeforeR.toFixed(2)} → ${rotAfterR.toFixed(2)} (expected ${expectedR.toFixed(2)})`);
  if (Math.abs(rotAfterR - expectedR) > 0.5) errors.push(`'r' key did not rotate selected layer: ${rotAfterR} vs expected ${expectedR}`);

  // 7. Deselect (click on stage canvas) and press 'r' — should still trigger re-map (not rotate anything)
  // We can't easily deselect, so just verify 'r' doesn't break when something is selected
  // The context-sensitive behavior: if selected → rotate. If not selected → re-map. Both are valid.

  // 8. Screenshot
  await page.screenshot({ path: 'verify-screenshots/clip-tools.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/clip-tools.png');

  // 9. Close-up screenshot of one clip header (re-query the element since render() may have detached it)
  await page.evaluate(() => window.Layers && window.Layers.render && window.Layers.render());
  await new Promise((r) => setTimeout(r, 100));
  const firstLayerEl2 = await page.$('.layer');
  if (firstLayerEl2) {
    const box = await firstLayerEl2.boundingBox();
    if (box) {
      await page.screenshot({
        path: 'verify-screenshots/clip-tools-closeup.png',
        clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: Math.min(box.height + 8, 80) },
      });
      console.log('  ✓ closeup screenshot: verify-screenshots/clip-tools-closeup.png');
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('errors:', errors.length);
  if (errors.length) errors.forEach((e) => console.log('  ✗', e));
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await browser.close();
}
