// generate-persona-pages.js
// Reads personas_extracted.json, writes personas/<key>.html (one per persona)
// and a personas/index.html (grid of links).
//
// Pages are static — no WebGL, no engine dependency. They visualize the
// persona's FX uniforms as a gauge grid + a CSS-only approximation of the
// look (gradient + grain + chroma offset via box-shadow + mix-blend).
//
// Run from project root:  node scripts/generate-persona-pages.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
    const slices = Math.min(8, Math.max(2, Math.round(p.glitch * 8)));
    let s = '';
    for (let i = 0; i < slices; i++) {
      const top = (i / slices) * 100 + (Math.random() * 4);
      const h = (100 / slices) * (0.4 + Math.random() * 0.6);
      const dx = (Math.random() - 0.5) * p.glitch * 60;
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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.label)} · SWR persona</title>
  <meta name="description" content="${esc(p.desc)}" />
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
  <div class="wrap">
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
        <h2>FX uniforms (15)</h2>
        <div class="gauges">
          ${fields}
        </div>
      </div>
    </div>

    <footer class="foot">
      Persona · ${esc(p.label)} · key: <code>${esc(p.key)}</code> · values 0..1 except temp (-1..1) and mutAlgo (0..5)
    </footer>
  </div>
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

// index: grid of all 23
const cards = order.map(k => {
  const p = personas[k];
  if (!p) return '';
  const c = clusterOf(p);
  return `
    <a class="card cluster-${c}" href="/personas/v/${k}">
      <div class="card-eyebrow">${esc(c.toUpperCase())}</div>
      <div class="card-title">${esc(p.label)}</div>
      <div class="card-desc">${esc(p.desc)}</div>
      <div class="card-foot">view demo →</div>
    </a>`;
}).join('\n');

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Persona demos · SWR engine</title>
  <meta name="description" content="All 23 SWR engine personas — one demo page per persona, with a static visual preview and full FX uniform readout." />
  <meta name="theme-color" content="#0a0612" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --panel-2: #221540;
      --ink: #f5e9ff; --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
      --c: #00f0ff; --m: #ff2d8a; --y: #fff04a; --g: #00ffa3;
      --c-warm: #ff6b3a; --c-cool: #00bfff;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid var(--m); border-radius: 999px;
      color: var(--m); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }
    h1 { font-size: 30px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.04em; }
    .lede { color: var(--ink-2); font-size: 13px; font-style: italic; max-width: 720px;
      margin: 0 0 28px; }
    .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; font-size: 10px;
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
    .legend .sw { display: inline-flex; align-items: center; gap: 6px; }
    .legend .dot { width: 8px; height: 8px; border-radius: 50%; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px; }
    .card { display: block; background: var(--panel); border: 1px solid var(--line);
      border-radius: 8px; padding: 16px; transition: border-color 0.2s, transform 0.2s; }
    .card:hover { border-color: var(--m); transform: translateY(-2px); }
    .card-eyebrow { font-size: 9px; letter-spacing: 0.18em; color: var(--muted);
      text-transform: uppercase; margin-bottom: 4px; }
    .card-title { font-size: 15px; font-weight: 700; color: var(--ink);
      letter-spacing: 0.04em; margin-bottom: 6px; }
    .card-desc { font-size: 11px; color: var(--ink-2); line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden; margin-bottom: 10px; }
    .card-foot { font-size: 10px; color: var(--c); letter-spacing: 0.14em;
      text-transform: uppercase; }
    .card.cluster-auditor .card-eyebrow { color: var(--c); }
    .card.cluster-practitioner .card-eyebrow { color: var(--g); }
    .card.cluster-broker .card-eyebrow { color: var(--y); }
    .card.cluster-cross .card-eyebrow { color: var(--m); }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <span class="badge">PERSONA · LIBRARY</span>
      <span class="spacer"></span>
      <a class="back" href="/personas">← ALL</a>
    </header>

    <h1>${count} personas · one page each</h1>
    <p class="lede">A static, forkable demo for every persona in <code>personas.js</code>. Each page shows the persona's full FX uniform readout and a CSS-only approximation of the look — no engine dependency, no WebGL. Open it in the engine to hear what the uniforms do to a real track.</p>

    <div class="legend">
      <span class="sw"><span class="dot" style="background:var(--c)"></span> Auditor</span>
      <span class="sw"><span class="dot" style="background:var(--g)"></span> Practitioner</span>
      <span class="sw"><span class="dot" style="background:var(--y)"></span> Broker</span>
      <span class="sw"><span class="dot" style="background:var(--m)"></span> Cross</span>
    </div>

    <div class="grid">
      ${cards}
    </div>
  </div>
</body>
</html>
`;

writeFileSync(resolve(outDir, 'index.html'), indexHTML);
console.log(`wrote ${count} persona pages + index.html to personas/`);
