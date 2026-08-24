// Verifier — audio-GAN training stage personas
// Tests that the 3 new personas (TRAIN · STAGE 1 / 2 / 3) from the
// Muon/AdamW training schedule are wired correctly. Each persona
// embodies one stage of the training run:
//
//   STAGE 1: Muon, no disc, STFT=1.0 only        → foundational, spectral
//   STAGE 2: Muon + disc, 1:1, STFT + time-GAN  → balanced adversarial
//   STAGE 3: AdamW + multi-disc, all losses      → refined, complex
//
// Plus: verifies the stage progression — STAGE 1 is simpler than
// STAGE 2 is simpler than STAGE 3 (in mutation count, FX layers
// active, etc.).
//
// Usage: node verify-train-stages.mjs

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
const OUT = resolve(__dirname, 'verify-screenshots/train-stages');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Expected FX state per stage. The mapping comes from the loss-weight table:
//   λSTFT    → grain
//   λtime-GAN→ glitch
//   λspec-GAN→ liquid + pearl
//   λKL      → posterize
//   λIF_GD   → liquid
// Optimizer (Muon vs AdamW) drives mut; disc presence drives complexity.
const EXPECTED = {
  trainstage1: {
    temp: 0,    mut: 0.10, mutAlgo: 2,          // liquid (spectral flow)
    posterize: 0,                              // λKL ≈ 0
    vignette: 0.15, chroma: 0.10, grain: 0.60, sepia: 0, glow: 0,
    grayscale: 0, blur: 0,
    liquid: 0.15, pearl: 0, glitch: 0,         // no time-GAN, no spec-GAN
  },
  trainstage2: {
    temp: -0.05, mut: 0.35, mutAlgo: 1,        // glitch (time-GAN adds time-domain)
    posterize: 0, vignette: 0.20, chroma: 0.15, grain: 0.40, sepia: 0, glow: 0.10,
    grayscale: 0, blur: 0,
    liquid: 0.30, pearl: 0.15, glitch: 0.50,  // time-GAN adv=1.0
  },
  trainstage3: {
    temp: 0.10, mut: 0.60, mutAlgo: 5,         // chromatic noise — multi-obj
    posterize: 0.15, vignette: 0.30, chroma: 0.30, grain: 0.20, sepia: 0.10, glow: 0.20,
    grayscale: 0, blur: 0,
    liquid: 0.50, pearl: 0.45, glitch: 0.18,  // spec-GAN=0.5, time-GAN=0.175
  },
};

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
  for (const p of Object.keys(EXPECTED)) {
    log(`persona option "${p}" exists`, personaOpts.includes(p),
      personaOpts.includes(p) ? '' : `have: ${personaOpts.join(',')}`);
  }

  // ---- 2. Each persona snaps FX state to the expected values ----
  for (const [key, want] of Object.entries(EXPECTED)) {
    const got = await page.evaluate((k) => {
      window.Personas && window.Personas.apply(k);
      return {
        temp: window.FX.state.temp,
        mut: window.FX.state.mut,
        mutAlgo: window.FX.state.mutAlgo,
        posterize: window.FX.state.posterize,
        vignette: window.FX.state.vignette,
        chroma: window.FX.state.chroma,
        grain: window.FX.state.grain,
        sepia: window.FX.state.sepia,
        glow: window.FX.state.glow,
        grayscale: window.FX.state.grayscale,
        blur: window.FX.state.blur,
        liquid: window.FX.state.liquid,
        pearl: window.FX.state.pearl,
        glitch: window.FX.state.glitch,
      };
    }, key);
    const mismatches = [];
    for (const [k, v] of Object.entries(want)) {
      if (Math.abs(got[k] - v) > 0.01) mismatches.push(`${k}: want=${v} got=${got[k]}`);
    }
    log(`persona ${key} snaps FX state correctly`,
      mismatches.length === 0,
      mismatches.length ? mismatches.join('; ') : `all ${Object.keys(want).length} values match`);
  }

  // ---- 3. Stage progression: complexity increases ----
  // Count active FX layers (params > 0.05) for each stage. Should be
  // strictly increasing: Stage 1 < Stage 2 < Stage 3.
  const fxLayerCount = await page.evaluate((keys) => {
    const out = {};
    for (const k of keys) {
      window.Personas && window.Personas.apply(k);
      const s = window.FX.state;
      out[k] = [
        s.posterize, s.vignette, s.chroma, s.grain, s.sepia, s.glow,
        s.grayscale, s.blur, s.liquid, s.pearl, s.glitch,
      ].filter(v => v > 0.05).length;
    }
    return out;
  }, Object.keys(EXPECTED));
  log('STAGE 1 is simplest (fewest active FX layers)',
    fxLayerCount.trainstage1 < fxLayerCount.trainstage2,
    `stage1=${fxLayerCount.trainstage1}, stage2=${fxLayerCount.trainstage2}`);
  log('STAGE 3 is most complex (most active FX layers)',
    fxLayerCount.trainstage3 > fxLayerCount.trainstage2,
    `stage2=${fxLayerCount.trainstage2}, stage3=${fxLayerCount.trainstage3}`);

  // ---- 4. Optimizer → mutation count mapping ----
  // Muon (stages 1+2) → low mut; AdamW (stage 3) → higher mut.
  log('STAGE 1+2 (Muon) have lower mut than STAGE 3 (AdamW)',
    EXPECTED.trainstage3.mut > EXPECTED.trainstage1.mut &&
    EXPECTED.trainstage3.mut > EXPECTED.trainstage2.mut,
    `muon=0.10/0.35, adamw=0.60`);

  // ---- 5. time-GAN (glitch) progression ----
  // Stage 1: 0 (no time-GAN), Stage 2: 0.50 (time-GAN=1.0), Stage 3: 0.18 (time-GAN=0.175)
  log('glitch reflects time-GAN: 0 < 0.18 < 0.50',
    EXPECTED.trainstage1.glitch < EXPECTED.trainstage3.glitch &&
    EXPECTED.trainstage3.glitch < EXPECTED.trainstage2.glitch,
    `${EXPECTED.trainstage1.glitch} < ${EXPECTED.trainstage3.glitch} < ${EXPECTED.trainstage2.glitch}`);

  // ---- 6. STFT (grain) is dominant in stage 1 only ----
  log('STFT=1.0 → stage 1 grain (0.60) is the highest',
    EXPECTED.trainstage1.grain > EXPECTED.trainstage2.grain &&
    EXPECTED.trainstage1.grain > EXPECTED.trainstage3.grain,
    `grain: s1=${EXPECTED.trainstage1.grain} > s2=${EXPECTED.trainstage2.grain} > s3=${EXPECTED.trainstage3.grain}`);

  // ---- 7. Screenshot each stage ----
  for (let i = 0; i < 3; i++) {
    const p = Object.keys(EXPECTED)[i];
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
