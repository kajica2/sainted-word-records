// Verifier — morpha-protocol symbol family personas
// Tests that the 5 new personas (ANCHOR / FLOW / FRACTURE / VOID / ECHO) are
// wired correctly. Each persona's expected FX state reflects the MORPHA
// spec's behavior: glitch=0 across all (no instantaneous transitions),
// pearl+liquid for continuity, vignette/glow for grounding, etc.
//
// Usage: node verify-morpha.mjs

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
const OUT = resolve(__dirname, 'verify-screenshots/morpha');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

// Expected FX state per persona — derived from the morpha-protocol spec's
// symbol family behaviors. glitch=0 across all (no-instantaneous-transitions
// is a mandatory grammar rule).
const EXPECTED = {
  morphaanchor:  { temp:  0.15, mut: 0.10, mutAlgo: 0, glitch: 0,    liquid: 0.30, pearl: 0.10, sepia: 0.20, vignette: 0.65 },
  morphaflow:    { temp:  0.05, mut: 0.45, mutAlgo: 2, glitch: 0,    liquid: 0.65, pearl: 0.25, sepia: 0,    vignette: 0.10 },
  morphafracture:{ temp: -0.25, mut: 0.75, mutAlgo: 1, glitch: 0.45, liquid: 0.10, pearl: 0,    sepia: 0,    vignette: 0.40, posterize: 0.50, chroma: 0.80 },
  morphavoid:    { temp: -0.40, mut: 0,    mutAlgo: 0, glitch: 0,    liquid: 0,    pearl: 0.30, sepia: 0.45, vignette: 0.85, grayscale: 0.60, blur: 0.50 },
  morphaecho:    { temp:  0.30, mut: 0.20, mutAlgo: 4, glitch: 0,    liquid: 0.10, pearl: 0.40, sepia: 0.55, vignette: 0.50, grain: 0.55, blur: 0.40 },
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
      if (t.includes('VERT') || t.includes('drawImage') || m.includes('InvalidStateError')) return;
      if (t.includes('404')) return;
      errors.push('console.error: ' + t);
    }
  });

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  // ---- 1. Personas exist in the dropdown ----
  const personaOpts = await page.evaluate(() => {
    const sel = document.getElementById('persona');
    return sel ? Array.from(sel.options).map(o => o.value) : [];
  });
  const wantPersonas = Object.keys(EXPECTED);
  for (const p of wantPersonas) {
    log(`persona option "${p}" exists`, personaOpts.includes(p),
      personaOpts.includes(p) ? '' : `have: ${personaOpts.join(',')}`);
  }

  // ---- 2. Each persona snaps FX state to the expected values ----
  for (const [key, want] of Object.entries(EXPECTED)) {
    const got = await page.evaluate((k) => {
      window.Personas && window.Personas.apply(k);
      return {
        temp:      window.FX.state.temp,
        mut:       window.FX.state.mut,
        mutAlgo:   window.FX.state.mutAlgo,
        posterize: window.FX.state.posterize,
        vignette:  window.FX.state.vignette,
        chroma:    window.FX.state.chroma,
        grain:     window.FX.state.grain,
        sepia:     window.FX.state.sepia,
        glow:      window.FX.state.glow,
        grayscale: window.FX.state.grayscale,
        blur:      window.FX.state.blur,
        liquid:    window.FX.state.liquid,
        pearl:     window.FX.state.pearl,
        glitch:    window.FX.state.glitch,
      };
    }, key);
    const mismatches = [];
    for (const [k, v] of Object.entries(want)) {
      if (Math.abs(got[k] - v) > 0.01) mismatches.push(`${k}: want=${v} got=${got[k]}`);
    }
    log(`persona ${key} snaps FX state correctly`, mismatches.length === 0,
      mismatches.length ? mismatches.join('; ') : `all ${Object.keys(want).length} values match`);
  }

  // ---- 3. All 5 personas obey MORPHA's "no instantaneous transitions" rule ----
  // We verify this by checking that glitch=0 (or ≤ 0.01) for the four
  // continuous families (ANCHOR, FLOW, VOID, ECHO). FRACTURE is the
  // exception — it embodies rupture, so glitch is allowed to be high there.
  for (const p of ['morphaanchor', 'morphaflow', 'morphavoid', 'morphaecho']) {
    const glitch = await page.evaluate((k) => {
      window.Personas && window.Personas.apply(k);
      return window.FX.state.glitch;
    }, p);
    log(`persona ${p} respects "no instantaneous transitions" (glitch=0)`,
      glitch <= 0.01, `glitch=${glitch}`);
  }

  // FRACTURE is the explicit exception (rupture, decision, conflict)
  const fractureGlitch = await page.evaluate(() => {
    window.Personas && window.Personas.apply('morphafracture');
    return window.FX.state.glitch;
  });
  log('persona morphafracture: glitch IS allowed (rupture, not continuity)',
    fractureGlitch > 0.1, `glitch=${fractureGlitch} (the rupture)`);

  // ---- 4. VOID honors "silence is a first-class signal" ----
  // VOID should be the most desaturated persona (lowest grayscale except
  // for the deliberately unstyled "off" state).
  const voidGrayscale = await page.evaluate(() => {
    window.Personas && window.Personas.apply('morphavoid');
    return window.FX.state.grayscale;
  });
  log('persona morphavoid: desaturated (silence as signal)',
    voidGrayscale >= 0.5, `grayscale=${voidGrayscale} (silence reduces color)`);

  // ---- 5. Screenshot each persona (visual proof) ----
  for (let i = 0; i < wantPersonas.length; i++) {
    const p = wantPersonas[i];
    await page.evaluate((k) => window.Personas && window.Personas.apply(k), p);
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({
      path: `${OUT}/0${i + 1}-${p}.png`,
      clip: { x: 240, y: 56, width: 860, height: 720 },
    });
  }

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
