// Verifier — flexible-smart-videomaker FX presets
// Tests that the 3 new uniforms (liquid / pearl / glitch) and 5 new personas
// (LIQUID GLASS / PEARL HAZE / CLUB STROBE / VHS VIBE / NEON WASH) are wired
// correctly. The new uniforms are in the WebGL fragment shader, so we also
// verify that applying a high-distortion persona produces a visible pixel
// change in the rendered output.
//
// Usage: node verify-fx-presets.mjs

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
const OUT = resolve(__dirname, 'verify-screenshots/fx-presets');
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
  protocolTimeout: 60000,
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    const m = e.message || String(e);
    if (m.includes('VERT') || m.includes('drawImage') || m.includes('InvalidStateError')) return;
    errors.push('pageerror: ' + m);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('VERT') || t.includes('drawImage') || t.includes('InvalidStateError')) return;
      if (t.includes('404')) return;
      errors.push('console.error: ' + t);
    }
  });

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  // ---- 1. New sliders exist in the FX panel ----
  const sliders = await page.evaluate(() => {
    const ids = ['liquid', 'pearl', 'glitch'];
    return ids.map(id => {
      const el = document.getElementById(id);
      return { id, exists: !!el, min: el?.min, max: el?.max };
    });
  });
  log('liquid slider exists', sliders[0].exists, JSON.stringify(sliders[0]));
  log('pearl slider exists', sliders[1].exists, JSON.stringify(sliders[1]));
  log('glitch slider exists', sliders[2].exists, JSON.stringify(sliders[2]));

  // ---- 2. New personas in the dropdown ----
  const personaOpts = await page.evaluate(() => {
    const sel = document.getElementById('persona');
    return sel ? Array.from(sel.options).map(o => o.value) : [];
  });
  const wantPersonas = ['liquidglass', 'pearlhaze', 'clubstrobe', 'vhsvibe', 'neonwash'];
  for (const p of wantPersonas) {
    log(`persona option "${p}" exists`, personaOpts.includes(p),
      personaOpts.includes(p) ? '' : `have: ${personaOpts.join(',')}`);
  }

  // ---- 3. FX.state has the new uniforms (set by fx-postprocess.js init) ----
  const fxState = await page.evaluate(() => {
    return window.FX?.state ? {
      hasLiquid: 'liquid' in window.FX.state,
      hasPearl:  'pearl'  in window.FX.state,
      hasGlitch: 'glitch' in window.FX.state,
      liquid: window.FX.state.liquid,
      pearl:  window.FX.state.pearl,
      glitch: window.FX.state.glitch,
    } : null;
  });
  log('FX.state has liquid',  fxState?.hasLiquid === true);
  log('FX.state has pearl',   fxState?.hasPearl === true);
  log('FX.state has glitch',  fxState?.hasGlitch === true);
  log('FX.state.liquid is 0 by default', fxState?.liquid === 0);
  log('FX.state.pearl is 0 by default',  fxState?.pearl === 0);
  log('FX.state.glitch is 0 by default', fxState?.glitch === 0);

  // ---- 4. Setter functions exist ----
  const setters = await page.evaluate(() => {
    const F = window.FX;
    return {
      setLiquid: typeof F?.setLiquid,
      setPearl:  typeof F?.setPearl,
      setGlitch: typeof F?.setGlitch,
    };
  });
  log('FX.setLiquid exists',  setters.setLiquid === 'function');
  log('FX.setPearl exists',   setters.setPearl === 'function');
  log('FX.setGlitch exists',  setters.setGlitch === 'function');

  // ---- 5. setPersona accepts the new keys ----
  const personaApplied = await page.evaluate(() => {
    window.FX.setPersona({ liquid: 0.55, pearl: 0.18, grain: 0.08, chroma: 0.14, glitch: 0.04 });
    return {
      liquid: window.FX.state.liquid,
      pearl:  window.FX.state.pearl,
      glitch: window.FX.state.glitch,
      grain:  window.FX.state.grain,
      chroma: window.FX.state.chroma,
    };
  });
  log('setPersona({liquid,pearl,glitch,...}) applies', personaApplied.liquid === 0.55 && personaApplied.pearl === 0.18 && personaApplied.glitch === 0.04,
    JSON.stringify(personaApplied));

  // ---- 6. Apply a high-distortion persona + verify the canvas changes ----
  // LIQUID GLASS: liquid=0.55, pearl=0.18, grain=0.08, chroma=0.14, glitch=0.04
  // This should noticeably warp the rendered output.
  await page.evaluate(() => {
    if (window.Personas) window.Personas.apply('liquidglass');
  });
  await new Promise(r => setTimeout(r, 1500));

  const fxAfter = await page.evaluate(() => ({
    liquid: window.FX.state.liquid,
    pearl:  window.FX.state.pearl,
    glitch: window.FX.state.glitch,
  }));
  log('persona LIQUID GLASS snaps FX state',
    Math.abs(fxAfter.liquid - 0.55) < 0.01 &&
    Math.abs(fxAfter.pearl - 0.18) < 0.01 &&
    Math.abs(fxAfter.glitch - 0.04) < 0.01,
    JSON.stringify(fxAfter));

  // Screenshot the stage with the LIQUID GLASS persona applied
  await page.screenshot({ path: `${OUT}/01-liquidglass.png`, clip: { x: 240, y: 56, width: 860, height: 720 } });

  // Apply the other 4 personas and screenshot each
  const personas = ['pearlhaze', 'clubstrobe', 'vhsvibe', 'neonwash'];
  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    await page.evaluate((key) => {
      if (window.Personas) window.Personas.apply(key);
    }, p);
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}/0${i + 2}-${p}.png`, clip: { x: 240, y: 56, width: 860, height: 720 } });
  }

  // ---- 7. Verify each of the 5 personas has the expected FX state ----
  const expected = {
    pearlhaze:  { liquid: 0.18, pearl: 0.70, glitch: 0 },
    clubstrobe: { liquid: 0.40, pearl: 0.30, glitch: 0.38 },
    vhsvibe:    { liquid: 0.22, pearl: 0.10, glitch: 0.28 },
    neonwash:   { liquid: 0.60, pearl: 0.22, glitch: 0.10 },
  };
  for (const [key, want] of Object.entries(expected)) {
    const got = await page.evaluate((k) => {
      window.Personas.apply(k);
      return {
        liquid: window.FX.state.liquid,
        pearl:  window.FX.state.pearl,
        glitch: window.FX.state.glitch,
      };
    }, key);
    const ok = Math.abs(got.liquid - want.liquid) < 0.01 &&
                Math.abs(got.pearl  - want.pearl)  < 0.01 &&
                Math.abs(got.glitch - want.glitch) < 0.01;
    log(`persona ${key} snaps FX state correctly`, ok,
      `want: ${JSON.stringify(want)}, got: ${JSON.stringify(got)}`);
  }

  // ---- 8. Verify the FX changes the visible output between off and LIQUID GLASS ----
  // The FX is applied to #fx-canvas but its buffer is cleared each frame
  // (preserveDrawingBuffer: false), so direct readback returns 0,0,0.
  // Instead we use page.screenshot() to capture the composited output.
  await page.evaluate(() => window.Personas && window.Personas.apply('off'));
  await new Promise(r => setTimeout(r, 1500));
  // Clip to the stage area (roughly x=240..1100, y=56..770)
  const offShot = await page.screenshot({
    type: 'png',
    clip: { x: 240, y: 56, width: 860, height: 720 },
  });
  await page.evaluate(() => window.Personas && window.Personas.apply('liquidglass'));
  await new Promise(r => setTimeout(r, 1500));
  const liquidShot = await page.screenshot({
    type: 'png',
    clip: { x: 240, y: 56, width: 860, height: 720 },
  });
  let byteDiffs = 0;
  const minLen = Math.min(offShot.length, liquidShot.length);
  for (let i = 0; i < minLen; i++) {
    if (offShot[i] !== liquidShot[i]) byteDiffs++;
  }
  log('LIQUID GLASS changes visible stage pixels (vs off)',
    byteDiffs > 100, `${byteDiffs} byte diffs of ${minLen}`);

  // ---- 9. Manual slider adjust works ----
  const sliderResult = await page.evaluate(() => {
    const s = document.getElementById('liquid');
    s.value = '0.42';
    s.dispatchEvent(new Event('input'));
    return {
      slider: parseFloat(s.value),
      fx: window.FX.state.liquid,
    };
  });
  log('manual liquid slider update reflects in FX.state',
    Math.abs(sliderResult.fx - 0.42) < 0.01,
    `slider=${sliderResult.slider} fx=${sliderResult.fx}`);

  log('No new console errors', errors.length === 0,
    errors.length ? errors.slice(0, 2).join('; ') : '');

  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed < total) {
    console.log('Failed:');
    checks.filter(c => !c.ok).forEach(c => console.log(`  - ${c.name}: ${c.info || ''}`));
    process.exit(1);
  }
} finally {
  await browser.close();
}
