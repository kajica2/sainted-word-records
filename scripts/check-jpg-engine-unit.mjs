#!/usr/bin/env node
// scripts/check-jpg-engine-unit.mjs — JPG still engine contract (unit + ship checks).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function syncCheck(name, fn) {
  try {
    const r = fn();
    record(name, r === true, typeof r === 'string' ? r : '');
  } catch (e) {
    record(name, false, e.message);
  }
}

syncCheck('jpg.html ships with module jpg-engine.client.js', () => {
  const html = fs.readFileSync(path.join(root, 'jpg.html'), 'utf8');
  if (!html.includes('jpg-engine.client.js')) return 'missing script';
  if (!html.includes('type="module"')) return 'module type required';
  if (!html.includes('id="render"')) return 'missing #render';
  if (!html.includes('id="fx-canvas"')) return 'missing WebGL canvas (#fx-canvas / gl-canvas)';
  if (!html.includes('id="layer-list"')) return 'missing layers host';
  return true;
});

syncCheck('site-map.json lists jpg.html', () => {
  const sm = JSON.parse(fs.readFileSync(path.join(root, 'site-map.json'), 'utf8'));
  const discovered = sm.discovered || [];
  if (!discovered.includes('jpg.html')) return 'jpg.html not in discovered[]';
  return true;
});

const mod = await import(pathToFileURL(path.join(root, 'jpg-engine.client.js')).href);

syncCheck('personaForJpg strips motion fields', () => {
  const p = mod.personaForJpg({ temp: 0.1, mut: 0.9, mutAlgo: 3, liquid: 0.5, glitch: 0.2, label: 'x' });
  if (p.mut !== 0 || p.mutAlgo !== 0 || p.liquid !== 0 || p.glitch !== 0) return JSON.stringify(p);
  if (p.temp !== 0.1) return 'non-motion fields must be preserved';
  return true;
});

syncCheck('blocked CSS fx includes zoom-pulse', () => {
  if (!mod.JPG_BLOCKED_CSS_FX.has('zoom-pulse')) return 'zoom-pulse must be blocked';
  return true;
});

if (typeof createImageBitmap !== 'function') {
  record('classifyStill: hue is degrees 0–360', true, '(env skip: no createImageBitmap)');
  record('classifyStill: luma in 0–1', true, '(env skip: no createImageBitmap)');
} else {
  {
    const oc = new OffscreenCanvas(4, 4);
    const ctx = oc.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 4, 4);
    const bmp = await createImageBitmap(oc);
    const m = mod.classifyStill(bmp);
    bmp.close();
    let ok = true;
    let detail = '';
    if (!(m.hue >= 0 && m.hue < 360)) {
      ok = false;
      detail = `hue out of range: ${m.hue}`;
    } else if (m.hue > 30 && m.hue < 330) {
      ok = false;
      detail = `red sample hue expected near 0/360, got ${m.hue}`;
    }
    record('classifyStill: hue is degrees 0–360', ok, detail);
  }
  {
    const oc = new OffscreenCanvas(2, 2);
    const ctx = oc.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 2, 2);
    const bmp = await createImageBitmap(oc);
    const m = mod.classifyStill(bmp);
    bmp.close();
    let ok = true;
    let detail = '';
    if (!(m.luma >= 0 && m.luma <= 1)) {
      ok = false;
      detail = `luma out of range: ${m.luma}`;
    } else if (m.luma < 0.4 || m.luma > 0.6) {
      ok = false;
      detail = `mid grey luma expected ~0.5, got ${m.luma}`;
    }
    record('classifyStill: luma in 0–1', ok, detail);
  }
}

const failCount = results.filter((r) => !r.ok && !String(r.detail).startsWith('(env skip')).length;
if (failCount) {
  console.error(`\ncheck-jpg-engine-unit: ${failCount} failed`);
  process.exit(1);
}
console.log('\ncheck-jpg-engine-unit: all passed');
