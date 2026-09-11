// scripts/generate-artist-pages.js
// Reads artists.json, writes artists/<id>.html (one per artist) and
// artists/index.html (grid of all artists).
//
// Each artist page:
//   - A persistent, looping audio track (<audio loop autoplay>)
//   - A muted-by-default play button (browsers block autoplay with sound;
//     the play gate is the first user gesture on the page)
//   - Bio + tagline + external links
//   - A list of works; works with `href` link to a project; works without
//     are listed as forthcoming / unreleased
//
// Run from project root:  node scripts/generate-artist-pages.js

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const artists = JSON.parse(readFileSync(resolve(ROOT, 'artists.json'), 'utf8'));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 404-safe check: does this asset actually exist on disk? Used to render
// the play button as enabled only when an audio file is present.
function exists(p) {
  try { statSync(resolve(ROOT, p.replace(/^\//, ''))); return true; }
  catch (_) { return false; }
}

function audioTag(track, color) {
  const safe = exists(track);
  return `
    <audio id="track" loop preload="auto" crossorigin="anonymous"${safe ? '' : ' data-missing="1"'}>
      <source src="${esc(track)}" type="audio/mpeg" />
    </audio>
    <button id="playGate" class="play-gate" type="button" aria-label="Play loop">
      <span class="play-icon" aria-hidden="true">▶</span>
      <span class="play-label">PLAY LOOP</span>
    </button>
    <div class="now-playing" hidden>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="track-label">${esc(artists.find(a => a.track === track)?.track_label || 'now playing')}</span>
    </div>
    <style>
      /* tiny equaliser animation when audio is running */
      .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
      .eq i { width: 3px; background: var(--accent); display: block; animation: eq 0.9s infinite ease-in-out; }
      .eq i:nth-child(1) { animation-delay: -0.3s; }
      .eq i:nth-child(2) { animation-delay: -0.1s; }
      .eq i:nth-child(3) { animation-delay: -0.5s; }
      @keyframes eq { 0%, 100% { height: 3px; } 50% { height: 12px; } }
      .now-playing.playing .eq i { animation-play-state: running; }
      .now-playing.paused .eq i { animation-play-state: paused; }
    </style>`;
}

function worksList(works) {
  if (!works || !works.length) {
    return `<p class="works-empty">No published works yet.</p>`;
  }
  return works.map((w, i) => {
    const isLink = !!w.href;
    const isVideo = w.kind === 'video';
    const badge = isVideo ? 'VIDEO' : 'AUDIO';
    const inner = `
      <div class="work-meta">
        <span class="work-kind">${badge}</span>
        ${w.year ? `<span class="work-year">${esc(w.year)}</span>` : ''}
      </div>
      <div class="work-title">${esc(w.title)}</div>
      ${w.note ? `<div class="work-note">${esc(w.note)}</div>` : ''}
      <div class="work-foot">${isLink ? 'open →' : 'forthcoming'}</div>`;
    if (isLink) {
      return `<a class="work" href="${esc(w.href)}">${inner}</a>`;
    }
    return `<div class="work disabled" aria-disabled="true">${inner}</div>`;
  }).join('\n        ');
}

function linksList(links) {
  if (!links || !links.length) return '';
  return `
    <div class="links">
      ${links.map(l => `<a class="link" href="${esc(l.href)}" rel="noopener noreferrer" target="_blank">${esc(l.label)} ↗</a>`).join('')}
    </div>`;
}

function artistPage(a) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(a.name)} · SWR artist showcase</title>
  <meta name="description" content="${esc(a.tagline)} — ${esc(a.bio).slice(0, 140)}" />
  <meta property="og:title" content="${esc(a.name)} · SWR" />
  <meta property="og:description" content="${esc(a.bio).slice(0, 200)}" />
  <meta name="theme-color" content="${esc(a.color)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --panel-2: #221540;
      --ink: #f5e9ff; --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
      --accent: ${esc(a.color)};
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      -webkit-font-smoothing: antialiased; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { opacity: 0.8; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 24px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid var(--accent); border-radius: 999px;
      color: var(--accent); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 8px var(--accent); }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }

    h1 { font-size: 36px; font-weight: 700; margin: 0 0 4px; letter-spacing: 0.04em; }
    .loc { font-size: 11px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px; }
    .tagline { font-size: 14px; color: var(--accent); letter-spacing: 0.04em; margin-bottom: 18px; font-style: italic; }
    .bio { font-size: 14px; color: var(--ink-2); line-height: 1.65; max-width: 720px; }

    /* ---- player ---- */
    .player { margin: 24px 0 32px; padding: 16px;
      background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .play-gate { display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 18px; border: 1px solid var(--accent); border-radius: 4px;
      background: transparent; color: var(--accent); cursor: pointer;
      font: 11px/1 ui-monospace; letter-spacing: 0.16em; text-transform: uppercase; }
    .play-gate:hover { background: var(--accent); color: #000; }
    .play-gate.playing { background: var(--accent); color: #000; }
    .play-gate .play-icon { font-size: 14px; }
    .play-gate.playing .play-icon::before { content: '⏸'; }
    .play-gate.playing .play-icon { font-size: 0; }
    .play-gate.playing .play-icon::before { font-size: 14px; }
    .play-gate .play-icon::before { content: '▶'; }
    .now-playing { display: inline-flex; align-items: center; gap: 10px;
      font-size: 11px; color: var(--ink-2); letter-spacing: 0.08em; }
    .track-label { color: var(--ink); }
    .player[data-missing="1"] .play-gate { opacity: 0.4; pointer-events: none; }
    .player[data-missing="1"]::after { content: 'audio asset missing — track will play once added to /audios/';
      flex-basis: 100%; color: var(--muted); font-size: 10px; letter-spacing: 0.08em; }

    /* ---- works ---- */
    .section h2 { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--muted); margin: 0 0 14px; font-weight: 500; }
    .works { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .work { display: block; background: var(--panel); border: 1px solid var(--line);
      border-radius: 6px; padding: 14px; transition: border-color 0.18s, transform 0.18s; }
    .work:hover { border-color: var(--accent); transform: translateY(-1px); }
    .work.disabled { opacity: 0.55; cursor: not-allowed; }
    .work.disabled:hover { transform: none; }
    .work-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .work-kind { font-size: 9px; letter-spacing: 0.18em; padding: 2px 6px;
      border-radius: 2px; background: var(--accent); color: #000; font-weight: 700; }
    .work-year { font-size: 10px; color: var(--muted); letter-spacing: 0.1em; }
    .work-title { font-size: 14px; color: var(--ink); font-weight: 700; margin-bottom: 4px; }
    .work-note { font-size: 11px; color: var(--ink-2); line-height: 1.4; min-height: 28px; }
    .work-foot { font-size: 10px; color: var(--accent); letter-spacing: 0.14em;
      text-transform: uppercase; margin-top: 10px; }
    .works-empty { font-size: 12px; color: var(--muted); font-style: italic; }

    .links { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
    .link { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
      padding: 7px 12px; border: 1px solid var(--line); border-radius: 3px;
      color: var(--ink-2); }
    .link:hover { color: var(--accent); border-color: var(--accent); }

    footer.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
      font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
  </style>
</head>
<body>
  ${audioTag(a.track, a.color)}
  <div class="wrap">
    <header class="top">
      <span class="badge">ARTIST · ${esc(a.name.toUpperCase())}</span>
      <span class="spacer"></span>
      <a class="back" href="/artists">← ALL ARTISTS</a>
    </header>

    <h1>${esc(a.name)}</h1>
    <div class="loc">${esc(a.location || '')}</div>
    <div class="tagline">${esc(a.tagline)}</div>
    <p class="bio">${esc(a.bio)}</p>

    <div class="player">
      <button id="playGate" class="play-gate" type="button" aria-label="Play loop">
        <span class="play-icon" aria-hidden="true">▶</span>
        <span class="play-label">PLAY LOOP</span>
      </button>
      <div class="now-playing" id="nowPlaying" hidden>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="track-label">${esc(a.track_label || 'now playing')}</span>
      </div>
    </div>

    <section class="section">
      <h2>Works</h2>
      <div class="works">
        ${worksList(a.works)}
      </div>
    </section>

    ${linksList(a.links)}

    <footer class="foot">
      ${esc(a.id)} · <a href="/artists">see all artists →</a>
    </footer>
  </div>

  <script>
    // Play-gate logic: most browsers block autoplay-with-sound. The first
    // user click on the play button resumes the audio context, then we
    // toggle play/pause. The button text and equaliser animate to reflect
    // state.
    (function () {
      const audio = document.getElementById('track');
      const btn = document.getElementById('playGate');
      const np = document.getElementById('nowPlaying');
      if (!audio || !btn) return;
      if (audio.dataset.missing === '1') {
        btn.disabled = true;
        btn.querySelector('.play-label').textContent = 'AUDIO MISSING';
        return;
      }
      audio.volume = 0.7;
      let playing = false;
      function render() {
        btn.classList.toggle('playing', playing);
        btn.querySelector('.play-label').textContent = playing ? 'PAUSE' : 'PLAY LOOP';
        if (np) {
          np.hidden = !playing;
          np.classList.toggle('playing', playing);
          np.classList.toggle('paused', !playing);
        }
      }
      btn.addEventListener('click', function () {
        if (playing) { audio.pause(); playing = false; }
        else {
          audio.play().then(function () { playing = true; render(); })
            .catch(function (e) { console.warn('audio play failed', e); });
          return;
        }
        render();
      });
      audio.addEventListener('ended', function () { playing = false; render(); });
      audio.addEventListener('pause', function () { playing = false; render(); });
      audio.addEventListener('play',  function () { playing = true;  render(); });
    })();
  </script>
</body>
</html>
`;
}

function indexPage() {
  const cards = artists.map(a => `
    <a class="card" href="/artists/${esc(a.id)}" style="--accent:${esc(a.color)}">
      <div class="card-bg" aria-hidden="true"></div>
      <div class="card-inner">
        <div class="card-loc">${esc(a.location || '')}</div>
        <div class="card-name">${esc(a.name)}</div>
        <div class="card-tag">${esc(a.tagline)}</div>
        <div class="card-meta">${a.works ? a.works.length : 0} works</div>
      </div>
    </a>`).join('\n    ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Artists · SWR</title>
  <meta name="description" content="Artists using the SWR engine. Each page is a one-track loop + a list of their works. Pick a sound, hear the room." />
  <meta name="theme-color" content="#0a0612" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --ink: #f5e9ff;
      --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid #ff2d8a; border-radius: 999px;
      color: #ff2d8a; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }
    h1 { font-size: 32px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.04em; }
    .lede { color: var(--ink-2); font-size: 13px; font-style: italic; max-width: 720px;
      margin: 0 0 32px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .card { position: relative; display: block; aspect-ratio: 4/5; border-radius: 8px;
      overflow: hidden; border: 1px solid var(--line); transition: transform 0.2s, border-color 0.2s; }
    .card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .card-bg { position: absolute; inset: 0;
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 35%, #0a0612), #150b22); }
    .card-bg::after { content: ''; position: absolute; inset: 0;
      background:
        radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent) 45%, transparent), transparent 60%),
        radial-gradient(circle at 70% 80%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 60%);
      mix-blend-mode: screen; opacity: 0.7; }
    .card-inner { position: relative; height: 100%; padding: 18px;
      display: flex; flex-direction: column; justify-content: space-between;
      background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.55) 100%); }
    .card-loc { font-size: 9px; color: rgba(255,255,255,0.7); letter-spacing: 0.18em;
      text-transform: uppercase; }
    .card-name { font-size: 22px; font-weight: 700; color: #fff; letter-spacing: 0.02em;
      margin-top: 8px; }
    .card-tag { font-size: 11px; color: rgba(255,255,255,0.75); font-style: italic;
      letter-spacing: 0.06em; margin-top: 4px; }
    .card-meta { font-size: 10px; color: var(--accent); letter-spacing: 0.16em;
      text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <span class="badge">ARTIST · SHOWCASE</span>
      <span class="spacer"></span>
      <a class="back" href="/portfolio">← SWR PORTFOLIO</a>
    </header>
    <h1>${artists.length} artists · one loop each</h1>
    <p class="lede">Each artist page holds a single track on infinite loop. Click into one and the room fills. Their works — videos, audio, projects saved through the engine — live underneath. New artists land here by submitting through the engine's "Save project" flow.</p>

    <div class="grid">
      ${cards}
    </div>
  </div>
</body>
</html>
`;
}

const outDir = resolve(ROOT, 'artists');
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const a of artists) {
  writeFileSync(resolve(outDir, `${a.id}.html`), artistPage(a));
  count++;
}
writeFileSync(resolve(outDir, 'index.html'), indexPage());
console.log(`wrote ${count} artist pages + index.html to artists/`);
