// generate-persona-pages.js
// Reads personas_extracted.json, writes personas/<key>.html (one per persona)
// and a personas/index.html (grid of links).
//
// Pages are static — no WebGL, no engine dependency. They visualize the
// persona's FX uniforms as a gauge grid + a CSS-only approximation of the
// look (gradient + grain + chroma offset via box-shadow + mix-blend).
//
// Run from project root:  node scripts/generate-persona-pages.js

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const personas = JSON.parse(readFileSync(resolve(ROOT, 'personas_extracted.json'), 'utf8'));
const order = [
  'raw','poster','mask','fx','filter',
  'neon','filmfilm','grid','smoke','hallucination',
  'liquidglass','pearlhaze','clubstrobe','vhsvibe','neonwash',
  'morphaanchor','morphaflow','morphafracture','morphavoid','morphaecho',
  'trainstage1','trainstage2','trainstage3',
];

const FIELDS = [
  { k: 'temp',       label: 'Temperature',     min: -1, max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'mut',        label: 'Mutations',       min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'mutAlgo',    label: 'Mutation algo',   min: 0,  max: 5,  step: 1,    fmt: v => String(Math.round(v)) },
  { k: 'posterize',  label: 'Posterize',       min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'vignette',   label: 'Vignette',        min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'chroma',     label: 'Chroma split',    min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'grain',      label: 'Grain',           min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'sepia',      label: 'Sepia',           min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'glow',       label: 'Glow',            min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'grayscale',  label: 'Grayscale',       min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'blur',       label: 'Blur',            min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'liquid',     label: 'Liquid',          min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'pearl',      label: 'Pearl',           min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
  { k: 'glitch',     label: 'Glitch',          min: 0,  max: 1,  step: 0.01, fmt: v => v.toFixed(2) },
];

// --- helpers ---------------------------------------------------------------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(field, v) {
  // map [min..max] to 0..100
  const t = (v - field.min) / (field.max - field.min);
  return Math.max(0, Math.min(100, t * 100));
}

function gaugeBar(field, v) {
  const p = pct(field, v);
  // For temp, signed bar — show center line at 0
  if (field.k === 'temp') {
    const zeroPct = ((0 - field.min) / (field.max - field.min)) * 100;
    const fillLeft = v < 0 ? p : zeroPct;
    const fillWidth = Math.abs(p - zeroPct);
    const color = v < 0 ? 'var(--c-cool)' : 'var(--c-warm)';
    return `
      <div class="gauge-bar signed" aria-label="Temperature ${v.toFixed(2)}">
        <div class="gauge-track"></div>
        <div class="gauge-zero" style="left:${zeroPct}%"></div>
        <div class="gauge-fill" style="left:${fillLeft}%;width:${fillWidth}%;background:${color}"></div>
      </div>`;
  }
  return `
    <div class="gauge-bar" aria-label="${esc(field.label)} ${v.toFixed(2)}">
      <div class="gauge-track"></div>
      <div class="gauge-fill" style="width:${p}%"></div>
    </div>`;
}

function gaugeRow(field, v) {
  return `
    <div class="gauge-row">
      <div class="gauge-label">${esc(field.label)}</div>
      <div class="gauge-cell">${gaugeBar(field, v)}</div>
      <div class="gauge-value">${esc(field.fmt(v))}</div>
    </div>`;
}

function previewCss(p) {
  // CSS-only approximation of the look. The persona's uniforms drive
  // filter / blend / overlay choices.
  const lines = [];
  // Base gradient — warm if temp>0, cool if temp<0, neutral if 0
  const t = p.temp || 0;
  if (t > 0.1)      lines.push(`background: linear-gradient(135deg, #ff8a3a 0%, #e6306b 50%, #4a1a2a 100%);`);
  else if (t < -0.1) lines.push(`background: linear-gradient(135deg, #0a2a4a 0%, #1a4a8a 50%, #4a0a6a 100%);`);
  else if (p.grayscale > 0.5) lines.push(`background: linear-gradient(135deg, #2a2a2a 0%, #555 50%, #1a1a1a 100%);`);
  else lines.push(`background: linear-gradient(135deg, #1a1230 0%, #4a1a6a 50%, #1a2a4a 100%);`);

  // Sepia overlay
  if (p.sepia > 0.1) lines.push(`filter: sepia(${p.sepia.toFixed(2)});`);
  // Grayscale
  if (p.grayscale > 0.1) lines.push(`filter: grayscale(${p.grayscale.toFixed(2)})${p.sepia > 0.1 ? ' sepia(' + p.sepia.toFixed(2) + ')' : ''};`);
  // Blur
  if (p.blur > 0.1) lines.push(`filter: blur(${p.blur * 8}px)${p.grayscale > 0.1 ? ' grayscale(' + p.grayscale.toFixed(2) + ')' : ''}${p.sepia > 0.1 ? ' sepia(' + p.sepia.toFixed(2) + ')' : ''};`);
  return lines.join(' ');
}

// Deterministic PRNG seeded from the persona key. previewOverlays used
// Math.random() for glitch slices, so every regeneration churned all 23
// pages even when nothing actually changed.
function seedRand(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h |= 0; h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function previewOverlays(p) {
  // Returns markup for stacked overlays: grain (svg noise), chroma (rgb
  // shadows), glitch (horizontal slice), vignette, posterize, glow.
  const overlays = [];

  // Grain — inline SVG fractal noise
  if (p.grain > 0.05) {
    const op = p.grain * 0.6;
    overlays.push(`<div class="ov-grain" style="opacity:${op.toFixed(2)}"></div>`);
  }

  // Chroma — two colored layers offset
  if (p.chroma > 0.05) {
    const off = p.chroma * 18;
    overlays.push(`<div class="ov-chroma-r" style="transform:translate(${-off}px,0);opacity:${(p.chroma * 0.5).toFixed(2)}"></div>`);
    overlays.push(`<div class="ov-chroma-g" style="transform:translate(0,${off / 2}px);opacity:${(p.chroma * 0.4).toFixed(2)}"></div>`);
    overlays.push(`<div class="ov-chroma-b" style="transform:translate(${off}px,0);opacity:${(p.chroma * 0.5).toFixed(2)}"></div>`);
  }

  // Glitch — horizontal slice band
  if (p.glitch > 0.1) {
    const rnd = seedRand(p.key || p.label || 'glitch');
    const slices = Math.min(8, Math.max(2, Math.round(p.glitch * 8)));
    let s = '';
    for (let i = 0; i < slices; i++) {
      const top = (i / slices) * 100 + (rnd() * 4);
      const h = (100 / slices) * (0.4 + rnd() * 0.6);
      const dx = (rnd() - 0.5) * p.glitch * 60;
      s += `<div class="ov-glitch-slice" style="top:${top}%;height:${h}%;transform:translateX(${dx}px)"></div>`;
    }
    overlays.push(`<div class="ov-glitch">${s}</div>`);
  }

  // Vignette
  if (p.vignette > 0.05) {
    overlays.push(`<div class="ov-vignette" style="opacity:${(p.vignette * 0.95).toFixed(2)}"></div>`);
  }

  // Posterize (CSS approximation via contrast bump + saturation drop)
  if (p.posterize > 0.1) {
    const c = 1 + p.posterize * 1.5;
    const s = 1 - p.posterize * 0.5;
    overlays.push(`<div class="ov-posterize" style="filter:contrast(${c.toFixed(2)}) saturate(${s.toFixed(2)});opacity:${(p.posterize * 0.4).toFixed(2)}"></div>`);
  }

  // Glow
  if (p.glow > 0.1) {
    overlays.push(`<div class="ov-glow" style="opacity:${(p.glow * 0.6).toFixed(2)}"></div>`);
  }

  // Liquid — animated gradient shift
  if (p.liquid > 0.1) {
    overlays.push(`<div class="ov-liquid" style="opacity:${(p.liquid * 0.7).toFixed(2)}"></div>`);
  }

  // Pearl — voronoi-ish circles overlay
  if (p.pearl > 0.1) {
    overlays.push(`<div class="ov-pearl" style="opacity:${(p.pearl * 0.7).toFixed(2)}"></div>`);
  }

  return overlays.join('\n      ');
}

function pageHTML(p) {
  const fields = FIELDS.map(f => gaugeRow(f, p[f.k] ?? 0)).join('\n');
  const previewBaseCss = previewCss(p);
  const overlays = previewOverlays(p);
  const cluster = clusterOf(p);
  // Prefer persona-specific keyart when it exists; fall back to the generic
  // hero card so we never emit an og:image that 404s. A couple of personas
  // map to keyart named after their version rather than their own key.
  const KEYART_ALIAS = { filmfilm: 'film' };
  const artKey = KEYART_ALIAS[p.key] || p.key;
  const ogImage = existsSync(resolve(ROOT, 'keyart', `${artKey}.png`))
    ? `keyart/${artKey}.png`
    : 'press/hero.png';
  return `<!doctype html>
<html lang="en">
<head>
  <link rel="stylesheet" href="/lib/components.css">
  <link rel="stylesheet" href="/lib/design-tokens.css">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.label)} · SWR persona</title>
  <meta name="description" content="${esc(p.desc)}" />
  <link rel="canonical" href="https://sainted-word-records.vercel.app/personas/v/${p.key}" />
  <meta property="og:title" content="${esc(p.label)} · SWR persona">
  <meta property="og:image" content="https://sainted-word-records.vercel.app/${ogImage}" />
  <meta property="og:description" content="${esc(p.desc)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0a0612" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --panel-2: #221540;
      --ink: #f5e9ff; --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
      --c: #00f0ff; --m: #ff2d8a; --y: #fff04a; --g: #00ffa3;
      --c-cool: #00bfff; --c-warm: #ff6b3a;
      --accent: var(--m);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      -webkit-font-smoothing: antialiased; }
    a { color: var(--c); text-decoration: none; }
    a:hover { color: var(--m); }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid var(--accent); border-radius: 999px;
      color: var(--accent); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: pulse 1.6s infinite; }
    @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
    header.top .cluster { font-size: 9px; padding: 3px 8px; border-radius: 999px;
      border: 1px solid var(--line); color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; }
    header.top .cluster.${cluster} { color: var(--accent); border-color: var(--accent); }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }
    header.top a.back:hover { color: var(--accent); border-color: var(--accent); }

    h1 { font-size: 28px; font-weight: 700; margin: 16px 0 4px; letter-spacing: 0.04em; }
    .tagline { color: var(--ink-2); font-size: 14px; font-style: italic; max-width: 720px; }

    .layout { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; margin-top: 24px; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }

    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
      padding: 16px; }
    .panel h2 { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--muted); margin: 0 0 12px; font-weight: 500; }

    /* ---- Preview stage ---- */
    .stage { position: relative; aspect-ratio: 16/9; border-radius: 6px; overflow: hidden;
      ${previewBaseCss} }
    .stage > div { position: absolute; inset: 0; pointer-events: none; }
    .ov-grain { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
      background-size: 160px 160px; mix-blend-mode: overlay; }
    .ov-chroma-r, .ov-chroma-g, .ov-chroma-b { ${previewBaseCss} mix-blend-mode: screen; }
    .ov-glitch-slice { position: absolute; left: -10%; right: -10%;
      background: linear-gradient(90deg, rgba(255,0,128,0.4), rgba(0,255,255,0.4));
      mix-blend-mode: screen; }
    .ov-vignette { background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 100%); }
    .ov-posterize { background: inherit; mix-blend-mode: overlay; }
    .ov-glow { background: radial-gradient(circle at 30% 40%, rgba(255,80,180,0.5), transparent 60%),
                            radial-gradient(circle at 70% 60%, rgba(80,200,255,0.5), transparent 60%);
      mix-blend-mode: screen; }
    .ov-liquid { background: conic-gradient(from 0deg, #ff2d8a, #00f0ff, #fff04a, #ff2d8a);
      filter: blur(30px); mix-blend-mode: screen; animation: spin 12s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .ov-pearl { background-image: radial-gradient(circle at 20% 30%, rgba(255,255,255,0.6) 0%, transparent 8%),
                                       radial-gradient(circle at 70% 60%, rgba(255,200,255,0.5) 0%, transparent 10%),
                                       radial-gradient(circle at 40% 80%, rgba(200,255,255,0.5) 0%, transparent 9%),
                                       radial-gradient(circle at 80% 20%, rgba(255,255,200,0.5) 0%, transparent 7%);
      mix-blend-mode: screen; }

    .stage-caption { position: absolute; bottom: 8px; left: 12px; right: 12px;
      display: flex; justify-content: space-between; font-size: 9px;
      letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.7);
      text-shadow: 0 1px 2px rgba(0,0,0,0.6); z-index: 5; }

    /* ---- Gauges ---- */
    .gauges { display: flex; flex-direction: column; gap: 4px; }
    .gauge-row { display: grid; grid-template-columns: 110px 1fr 50px;
      align-items: center; gap: 8px; padding: 4px 0; }
    .gauge-label { font-size: 10px; color: var(--ink-2); letter-spacing: 0.06em;
      text-transform: uppercase; }
    .gauge-value { font-size: 11px; color: var(--accent); text-align: right;
      font-variant-numeric: tabular-nums; }
    .gauge-bar { position: relative; height: 8px; background: var(--panel-2);
      border-radius: 2px; overflow: hidden; }
    .gauge-bar.signed .gauge-zero { position: absolute; top: -2px; bottom: -2px;
      width: 1px; background: var(--muted); opacity: 0.5; }
    .gauge-track { position: absolute; inset: 0; }
    .gauge-fill { position: absolute; top: 0; bottom: 0; left: 0;
      background: var(--accent); border-radius: 2px; transition: width 0.4s; }

    /* ---- Actions ---- */
    .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 16px; border: 1px solid var(--line); border-radius: 4px;
      font: 11px/1 ui-monospace; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ink-2); cursor: pointer; }
    .btn:hover { color: var(--accent); border-color: var(--accent); }
    .btn.primary { background: var(--accent); color: #000; border-color: var(--accent);
      font-weight: 700; }
    .btn.primary:hover { background: var(--c); border-color: var(--c); }

    footer.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
      font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
  </style>
</head>
<body>
  <swr-nav></swr-nav>
  <main class="wrap">
    <header class="top">
      <span class="badge">PERSONA · ${esc(p.label)}</span>
      <span class="cluster ${cluster}">${esc(cluster.toUpperCase())}</span>
      <span class="spacer"></span>
      <a class="back" href="/personas">← ALL</a>
    </header>

    <h1>${esc(p.label)}</h1>
    <p class="tagline">${esc(p.desc)}</p>

    <div class="layout">
      <div class="panel">
        <h2>Visual preview (static)</h2>
        <div class="stage" aria-label="Persona preview">
          ${overlays}
          <div class="stage-caption">
            <span>preset · ${esc(p.label)}</span>
            <span>mut algo · ${Math.round(p.mutAlgo || 0)}</span>
          </div>
        </div>
        <div class="actions">
          <a class="btn primary" href="/engine">OPEN IN ENGINE →</a>
          <a class="btn" href="/personas">← ALL PERSONAS</a>
        </div>
      </div>

      <div class="panel">
        <h2>FX uniforms (${FIELDS.length})</h2>
        <div class="gauges">
          ${fields}
        </div>
      </div>
    </div>

    <swr-footer></swr-footer>
  </main>
  <script src="/lib/nav.client.js" defer></script>
  <script src="/lib/footer.client.js" defer></script>
</body>
</html>
`;
}

// Map a persona to a "cluster" tag (auditor / practitioner / broker / cross)
// based on which surfaces of the engine its uniforms emphasize.
function clusterOf(p) {
  // High chroma/glitch/grain = auditor (cyber, glitch, harsh)
  if (p.chroma > 0.5 || p.glitch > 0.3) return 'auditor';
  // High liquid/pearl = practitioner (continuous, smooth)
  if (p.liquid > 0.5 || p.pearl > 0.5) return 'practitioner';
  // High sepia/film/grain = broker (warm, deliverable)
  if (p.sepia > 0.4 || p.grain > 0.6) return 'broker';
  return 'cross';
}

// --- write pages -----------------------------------------------------------
const outDir = resolve(ROOT, 'personas', 'v');
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const key of order) {
  const p = personas[key];
  if (!p) { console.warn('missing', key); continue; }
  const html = pageHTML(p);
  writeFileSync(resolve(outDir, `${key}.html`), html);
  count++;
}

// Deterministic preview overlays for index cards (glitch uses Math.random
// in previewOverlays, so the gallery keeps only the stable layers).
function cardOverlays(p) {
  const out = [];
  if (p.grain > 0.05) out.push(`<div class="pv-grain" style="opacity:${(p.grain * 0.6).toFixed(2)}"></div>`);
  if (p.vignette > 0.05) out.push(`<div class="pv-vignette" style="opacity:${(p.vignette * 0.9).toFixed(2)}"></div>`);
  if (p.glow > 0.1) out.push(`<div class="pv-glow" style="opacity:${(p.glow * 0.5).toFixed(2)}"></div>`);
  return out.join('');
}

// index: gallery of all personas
const cards = order.map(k => {
  const p = personas[k];
  if (!p) return '';
  const c = clusterOf(p);
  return `
        <a class="tile persona persona--${c}" href="/personas/v/${k}">
          <div class="persona__pv" style="${previewCss(p)}" aria-hidden="true">${cardOverlays(p)}</div>
          <div class="persona__body">
            <h3 class="tile__title">${esc(p.label)}</h3>
            <p class="tile__desc">${esc(p.desc)}</p>
            <div class="tile__meta">
              <span class="pill persona__tag persona__tag--${c}">${esc(c)}</span>
              <span class="pill persona__key">${esc(p.key)}</span>
            </div>
          </div>
        </a>`;
}).join('\n');

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <link rel="stylesheet" href="/lib/components.css">
  <link rel="stylesheet" href="/lib/design-tokens.css">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Persona demos · SWR engine</title>
  <meta name="description" content="All ${count} SWR engine personas — one demo page per persona, with a visual preview and full FX uniform readout." />
  <link rel="canonical" href="https://sainted-word-records.vercel.app/personas/v" />
  <meta property="og:title" content="Persona demos · SWR engine">
  <meta property="og:image" content="https://sainted-word-records.vercel.app/press/hero.png" />
  <meta property="og:description" content="All ${count} SWR engine personas — one demo page per persona, with a visual preview and full FX uniform readout.">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0e0c0a" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    .wrap { padding: 0 32px 96px; }
    .hero { padding: 72px 0 44px; max-width: 720px; }
    .hero__lede { max-width: 620px; }
    .hero__lede code { font-family: var(--font-mono); font-size: 0.86em; background: var(--bg-2); padding: 1px 6px; border-radius: var(--radius-sm); }

    .gallery { padding: 0; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; }
    .legend .pill { background: var(--bg-2); }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(262px, 1fr)); gap: 16px; }

    .persona { padding: 0; gap: 0; overflow: hidden; }
    .persona__pv { position: relative; width: 100%; aspect-ratio: 16 / 10; overflow: hidden; }
    .persona__body { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 16px; flex: 1; }
    .persona .tile__desc { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .persona:hover { border-color: var(--line-2); transform: translateY(-2px); }

    .persona__tag { background: var(--bg-2); }
    .persona__tag--auditor { color: var(--cool); }
    .persona__tag--practitioner { color: var(--ok); }
    .persona__tag--broker { color: var(--accent-2); }
    .persona__tag--cross { color: var(--accent); }
    .persona__key { background: var(--bg-2); color: var(--muted); }

    .pv-grain, .pv-vignette, .pv-glow { position: absolute; inset: 0; pointer-events: none; }
    .pv-grain { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); background-size: 160px 160px; mix-blend-mode: overlay; }
    .pv-vignette { background: radial-gradient(ellipse at center, transparent 32%, rgba(0,0,0,0.82) 100%); }
    .pv-glow { background: radial-gradient(circle at 30% 40%, rgba(255,80,180,0.5), transparent 60%), radial-gradient(circle at 70% 60%, rgba(80,200,255,0.5), transparent 60%); mix-blend-mode: screen; }

    @media (prefers-reduced-motion: reduce) {
      .tile, .btn { transition: none !important; }
      .persona:hover { transform: none; }
    }
  </style>
</head>
<body>
  <swr-nav></swr-nav>
  <main class="wrap">
    <header class="hero">
      <p class="hero__eyebrow">Persona library</p>
      <h1 class="hero__title">${count} looks, one page each</h1>
      <p class="hero__lede">Every persona in <code>personas.js</code>, rendered as a static preview with its full FX uniform readout — no engine, no WebGL. Open one in the engine to hear what the uniforms do to a track.</p>
      <div class="hero__cta">
        <a class="btn btn--primary" href="/engine">Open the engine</a>
        <a class="btn btn--ghost" href="/personas">All personas</a>
      </div>
    </header>

    <section class="section gallery">
      <div class="legend">
        <span class="pill persona__tag--auditor">Auditor</span>
        <span class="pill persona__tag--practitioner">Practitioner</span>
        <span class="pill persona__tag--broker">Broker</span>
        <span class="pill persona__tag--cross">Cross</span>
      </div>
      <div class="grid">
        ${cards}
      </div>
    </section>
  </main>
  <swr-footer></swr-footer>
  <script src="/lib/nav.client.js" defer></script>
  <script src="/lib/footer.client.js" defer></script>
</body>
</html>
`;

writeFileSync(resolve(outDir, 'index.html'), indexHTML);
console.log(`wrote ${count} persona pages + index.html to personas/`);
