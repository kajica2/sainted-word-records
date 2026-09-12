// scripts/build-shotlist.js
// Reads shotlist/_candidates_web/*.png, groups by camera move (parsed
// from filename), and writes shotlist/index.html — a director's shot list:
// 5 slots, drag candidates in, persists in localStorage, exports a
// copy-paste text block + JSON.
//
// Run from project root:  node scripts/build-shotlist.js

import { readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'shotlist/_candidates_web');
const OUT = resolve(ROOT, 'shotlist');

const files = readdirSync(SRC).filter(f => f.endsWith('.png'));

// Group by camera-move session. Strip the prompt prefix
// "random_glittch_vintage_texture_" or "random_glittch_texture_hologram_wireframe_"
// and the trailing uuid + _N.
function sessionOf(name) {
  const m = /^(.*)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(\d+)\.png$/.exec(name);
  if (!m) return { key: name, idx: 0 };
  let prefix = m[1];
  // Identify the prompt style
  let style = 'vintage_texture';
  if (prefix.startsWith('random_glittch_texture_hologram_wireframe_')) {
    style = 'hologram_wireframe';
    prefix = prefix.replace('random_glittch_texture_hologram_wireframe_', '');
  } else if (prefix.startsWith('random_glittch_vintage_texture_')) {
    prefix = prefix.replace('random_glittch_vintage_texture_', '');
  }
  return { key: prefix, idx: parseInt(m[2], 10), style };
}

function titleFor(prefix) {
  // Convert snake_case prompt into "Title case"
  return prefix.split('_').map(w => w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

function styleFor(style) {
  return style === 'hologram_wireframe' ? 'Hologram Wireframe' : 'Vintage Glitch Texture';
}

const groups = new Map();
for (const f of files) {
  const { key, idx, style } = sessionOf(f);
  const k = `${style}::${key}`;
  if (!groups.has(k)) groups.set(k, { key, style, files: [] });
  groups.get(k).files.push({ name: f, idx });
}
// Sort files within each group by idx
for (const g of groups.values()) g.files.sort((a, b) => a.idx - b.idx);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ordered = [...groups.values()].sort((a, b) => {
  if (a.style !== b.style) return a.style < b.style ? -1 : 1;
  return a.key.localeCompare(b.key);
});

const sessionBlocks = ordered.map(g => {
  const styleLabel = styleFor(g.style);
  const title = titleFor(g.key);
  const tiles = g.files.map(({ name, idx }) => `
        <figure class="tile" data-file="${esc(name)}" data-style="${esc(g.style)}" data-key="${esc(g.key)}" data-idx="${idx}" draggable="true">
          <img loading="lazy" src="_candidates_web/${esc(name)}" alt="${esc(title)} candidate ${idx + 1}" />
          <figcaption class="tile-meta">
            <span class="tile-num">${idx + 1}</span>
            <span class="tile-style" title="${esc(styleLabel)}">${esc(g.style === 'hologram_wireframe' ? 'HOLO' : 'VINT')}</span>
          </figcaption>
        </figure>`).join('');
  return `
      <section class="session" data-style="${esc(g.style)}" data-key="${esc(g.key)}">
        <h2>${esc(title)} <span class="session-style">${esc(styleLabel)}</span></h2>
        <div class="grid">${tiles}
        </div>
      </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shot list · SWR</title>
  <meta name="description" content="Director's shot list — drag camera-move reference frames into 5 slots, export as text or JSON for the engine." />
  <meta name="theme-color" content="#0a0612" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --panel-2: #221540;
      --ink: #f5e9ff; --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
      --c: #00f0ff; --m: #ff2d8a; --y: #fff04a; --g: #00ffa3;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color: var(--c); text-decoration: none; }
    .wrap { max-width: 1400px; margin: 0 auto; padding: 24px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid var(--c); border-radius: 999px;
      color: var(--c); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }
    h1 { font-size: 26px; font-weight: 700; margin: 0 0 4px; letter-spacing: 0.04em; }
    .lede { color: var(--ink-2); font-size: 13px; max-width: 880px; margin: 0 0 20px; line-height: 1.55; }
    .lede code { color: var(--c); padding: 1px 5px; background: var(--panel-2); border-radius: 3px; }

    /* ---- The 5-slot timeline at the top ---- */
    .timeline { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
      margin-bottom: 24px; }
    @media (max-width: 900px) { .timeline { grid-template-columns: repeat(2, 1fr); } }
    .slot { background: var(--panel); border: 2px dashed var(--line); border-radius: 8px;
      padding: 10px; min-height: 220px; display: flex; flex-direction: column; gap: 8px;
      transition: border-color 0.18s, background 0.18s; }
    .slot.drag-over { border-color: var(--c); background: rgba(0,240,255,0.06); }
    .slot-head { display: flex; align-items: center; gap: 8px; }
    .slot-num { font-size: 10px; color: var(--c); letter-spacing: 0.16em; }
    .slot-beat { font-size: 11px; color: var(--ink); font-weight: 700; letter-spacing: 0.04em; }
    .slot-beat input { background: transparent; border: none; color: var(--ink);
      font: 700 11px/1 ui-monospace; width: 100%; padding: 0; }
    .slot-beat input:focus { outline: none; }
    .slot-beat input::placeholder { color: var(--muted); font-weight: 400; font-style: italic; }
    .slot-img { flex: 1; background: #000; border-radius: 4px; overflow: hidden;
      display: flex; align-items: center; justify-content: center; min-height: 110px;
      position: relative; cursor: pointer; }
    .slot-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .slot-img.empty { border: 1px dashed var(--line); }
    .slot-img.empty::before { content: 'drop frame here'; color: var(--muted);
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
    .slot-meta { display: flex; justify-content: space-between; font-size: 9px;
      color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
    .slot-meta .shot-fx { color: var(--c); cursor: text; }
    .slot-remove { background: transparent; border: 1px solid var(--line); color: var(--muted);
      padding: 2px 6px; border-radius: 3px; font: 9px/1 ui-monospace; cursor: pointer; }
    .slot-remove:hover { color: var(--m); border-color: var(--m); }

    /* ---- Action bar ---- */
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 28px; }
    .btn { display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 14px; border: 1px solid var(--line); border-radius: 4px;
      font: 10px/1 ui-monospace; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ink-2); cursor: pointer; background: transparent; }
    .btn:hover { color: var(--c); border-color: var(--c); }
    .btn.primary { background: var(--c); color: #000; border-color: var(--c); font-weight: 700; }
    .btn.primary:hover { background: var(--g); border-color: var(--g); }
    .btn.warn { color: var(--m); border-color: var(--m); }

    /* ---- Output ---- */
    .output { background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
      padding: 14px; margin-bottom: 28px; }
    .output h3 { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--muted); margin: 0 0 8px; }
    .output textarea { width: 100%; min-height: 110px; background: var(--bg-2);
      color: var(--ink); border: 1px solid var(--line); border-radius: 4px;
      padding: 10px; font: 11px/1.5 ui-monospace; resize: vertical; }
    .output pre { background: var(--bg-2); color: var(--ink); border: 1px solid var(--line);
      border-radius: 4px; padding: 10px; font: 10px/1.4 ui-monospace;
      white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow: auto; }

    /* ---- Candidate sections ---- */
    .session { margin-bottom: 32px; }
    .session h2 { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ink); margin: 0 0 10px; display: flex; align-items: baseline; gap: 10px;
      border-left: 3px solid var(--c); padding-left: 10px; }
    .session-style { font-size: 9px; color: var(--muted); letter-spacing: 0.16em; }
    .session[data-style="hologram_wireframe"] h2 { border-color: var(--m); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px; }
    .tile { margin: 0; background: var(--panel); border: 1px solid var(--line);
      border-radius: 6px; overflow: hidden; transition: border-color 0.18s, transform 0.18s, opacity 0.18s;
      cursor: grab; }
    .tile:hover { border-color: var(--c); transform: translateY(-1px); }
    .tile.dragging { opacity: 0.4; cursor: grabbing; }
    .tile img { display: block; width: 100%; height: auto; background: #000; }
    .tile-meta { display: flex; align-items: center; justify-content: space-between;
      padding: 5px 8px; border-top: 1px solid var(--line); font-size: 9px;
      color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
    .tile-num { color: var(--ink-2); }
    .tile-style { padding: 1px 4px; border-radius: 2px; background: var(--bg-2);
      color: var(--c); }
    [data-style="hologram_wireframe"] .tile-style { color: var(--m); }

    footer.foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line);
      font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <span class="badge">SHOT LIST · ${files.length} FRAMES</span>
      <span class="spacer"></span>
      <a class="back" href="/artists">← ARTISTS</a>
    </header>
    <h1>Director's shot list</h1>
    <p class="lede">
      Drag a reference frame into any of the 5 slots above. The slot label is
      the beat of the song (verse / build / drop / breakdown / outro — type
      your own). The FX note per slot is whatever you want the engine to do
      during that shot (e.g. <code>chroma=0.6, grain=0.4</code>). Your list
      auto-saves to <code>localStorage</code>. Export as text or JSON below.
      Frame binaries live in <code>shotlist/_candidates_web/</code> (gitignored;
      reviewed locally, not deployed).
    </p>

    <div class="timeline" id="timeline">
      <!-- 5 slots rendered by JS, but pre-populated by server-rendered defaults
           so the page is usable on first load without JS. -->
      <div class="slot" data-slot="0">
        <div class="slot-head">
          <span class="slot-num">SHOT 1</span>
          <span class="slot-beat"><input class="beat-input" placeholder="beat (e.g. intro)" /></span>
          <span style="flex:1"></span>
          <button class="slot-remove" type="button" aria-label="Clear slot">×</button>
        </div>
        <div class="slot-img empty" data-img-slot="0"></div>
        <div class="slot-meta">
          <span class="shot-fx" contenteditable="true" data-fx-slot="0">fx: ...</span>
        </div>
      </div>
      <div class="slot" data-slot="1">
        <div class="slot-head">
          <span class="slot-num">SHOT 2</span>
          <span class="slot-beat"><input class="beat-input" placeholder="beat (e.g. verse)" /></span>
          <span style="flex:1"></span>
          <button class="slot-remove" type="button" aria-label="Clear slot">×</button>
        </div>
        <div class="slot-img empty" data-img-slot="1"></div>
        <div class="slot-meta">
          <span class="shot-fx" contenteditable="true" data-fx-slot="1">fx: ...</span>
        </div>
      </div>
      <div class="slot" data-slot="2">
        <div class="slot-head">
          <span class="slot-num">SHOT 3</span>
          <span class="slot-beat"><input class="beat-input" placeholder="beat (e.g. build)" /></span>
          <span style="flex:1"></span>
          <button class="slot-remove" type="button" aria-label="Clear slot">×</button>
        </div>
        <div class="slot-img empty" data-img-slot="2"></div>
        <div class="slot-meta">
          <span class="shot-fx" contenteditable="true" data-fx-slot="2">fx: ...</span>
        </div>
      </div>
      <div class="slot" data-slot="3">
        <div class="slot-head">
          <span class="slot-num">SHOT 4</span>
          <span class="slot-beat"><input class="beat-input" placeholder="beat (e.g. drop)" /></span>
          <span style="flex:1"></span>
          <button class="slot-remove" type="button" aria-label="Clear slot">×</button>
        </div>
        <div class="slot-img empty" data-img-slot="3"></div>
        <div class="slot-meta">
          <span class="shot-fx" contenteditable="true" data-fx-slot="3">fx: ...</span>
        </div>
      </div>
      <div class="slot" data-slot="4">
        <div class="slot-head">
          <span class="slot-num">SHOT 5</span>
          <span class="slot-beat"><input class="beat-input" placeholder="beat (e.g. outro)" /></span>
          <span style="flex:1"></span>
          <button class="slot-remove" type="button" aria-label="Clear slot">×</button>
        </div>
        <div class="slot-img empty" data-img-slot="4"></div>
        <div class="slot-meta">
          <span class="shot-fx" contenteditable="true" data-fx-slot="4">fx: ...</span>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" id="exportText" type="button">copy text</button>
      <button class="btn" id="exportJson" type="button">download json</button>
      <button class="btn warn" id="clearAll" type="button">clear all</button>
    </div>

    <div class="output">
      <h3>Shot list (text)</h3>
      <textarea id="textOut" readonly placeholder="empty — drag a frame into a slot"></textarea>
    </div>
    <div class="output">
      <h3>Shot list (json)</h3>
      <pre id="jsonOut">{}</pre>
    </div>

    <h2 style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted);margin:24px 0 14px;border-left:3px solid var(--y);padding-left:10px">
      ${ordered.length} camera-move sessions · ${files.length} frames
    </h2>

    ${sessionBlocks}

    <footer class="foot">
      ${files.length} candidates across ${ordered.length} sessions · 5-slot timeline · localStorage auto-save
    </footer>
  </div>

  <script>
    (function () {
      var STORAGE = 'swrc.shotlist';
      var SLOTS = 5;
      var state = { slots: [] };
      for (var i = 0; i < SLOTS; i++) {
        state.slots.push({ file: null, style: null, key: null, idx: null, beat: '', fx: '' });
      }
      function save() {
        try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (_) {}
        render();
      }
      function load() {
        try {
          var raw = localStorage.getItem(STORAGE);
          if (!raw) return;
          var s = JSON.parse(raw);
          if (s && Array.isArray(s.slots) && s.slots.length === SLOTS) {
            for (var i = 0; i < SLOTS; i++) {
              var inSlot = s.slots[i] || {};
              state.slots[i] = {
                file: inSlot.file || null, style: inSlot.style || null,
                key: inSlot.key || null, idx: inSlot.idx == null ? null : inSlot.idx,
                beat: inSlot.beat || '', fx: inSlot.fx || '',
              };
            }
          }
        } catch (_) {}
      }
      function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      function titleFor(key) {
        if (!key) return '';
        return key.split('_').map(function (w) {
          return w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w;
        }).join(' ');
      }
      function render() {
        for (var i = 0; i < SLOTS; i++) {
          var s = state.slots[i];
          var img = document.querySelector('[data-img-slot="' + i + '"]');
          if (s.file) {
            img.classList.remove('empty');
            img.innerHTML = '<img src="_candidates_web/' + escapeHtml(s.file) + '" alt="shot ' + (i+1) + '" />';
          } else {
            img.classList.add('empty');
            img.innerHTML = '';
          }
          var beatIn = document.querySelectorAll('.beat-input')[i];
          if (document.activeElement !== beatIn) beatIn.value = s.beat || '';
          var fx = document.querySelector('[data-fx-slot="' + i + '"]');
          if (document.activeElement !== fx) fx.textContent = s.fx || ('fx: ...');
        }
        renderText();
        renderJson();
      }
      function renderText() {
        var lines = ['# Shot list', ''];
        for (var i = 0; i < SLOTS; i++) {
          var s = state.slots[i];
          if (!s.file) { lines.push('SHOT ' + (i+1) + ': (empty)'); continue; }
          var cam = titleFor(s.key);
          var style = s.style === 'hologram_wireframe' ? 'HOLO' : 'VINT';
          lines.push('SHOT ' + (i+1) + ' · ' + (s.beat || '?') + ' · ' + style + ' · ' + cam + ' (' + (s.idx + 1) + ' of 4) · ' + (s.fx || 'fx: ...'));
        }
        document.getElementById('textOut').value = lines.join('\\n');
      }
      function renderJson() {
        document.getElementById('jsonOut').textContent = JSON.stringify({
          generated: new Date().toISOString(),
          slots: state.slots.map(function (s, i) {
            return {
              shot: i + 1, beat: s.beat || null, fx: s.fx || null,
              frame: s.file ? {
                file: s.file, style: s.style, camera: s.key, candidate: (s.idx + 1)
              } : null
            };
          })
        }, null, 2);
      }
      // ---- Drag & drop ----
      function makeDragSource(tile) {
        tile.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('application/x-shot', JSON.stringify({
            file: tile.dataset.file, style: tile.dataset.style,
            key: tile.dataset.key, idx: parseInt(tile.dataset.idx, 10)
          }));
          tile.classList.add('dragging');
        });
        tile.addEventListener('dragend', function () { tile.classList.remove('dragging'); });
        // Click on tile = add to first empty slot
        tile.addEventListener('click', function () {
          for (var i = 0; i < SLOTS; i++) {
            if (!state.slots[i].file) {
              state.slots[i].file = tile.dataset.file;
              state.slots[i].style = tile.dataset.style;
              state.slots[i].key = tile.dataset.key;
              state.slots[i].idx = parseInt(tile.dataset.idx, 10);
              save();
              return;
            }
          }
          // If all slots full, replace the last one
          state.slots[SLOTS - 1].file = tile.dataset.file;
          state.slots[SLOTS - 1].style = tile.dataset.style;
          state.slots[SLOTS - 1].key = tile.dataset.key;
          state.slots[SLOTS - 1].idx = parseInt(tile.dataset.idx, 10);
          save();
        });
      }
      document.querySelectorAll('.tile').forEach(makeDragSource);
      // ---- Drop targets ----
      function makeDropTarget(slotEl) {
        slotEl.addEventListener('dragover', function (e) {
          e.preventDefault();
          slotEl.classList.add('drag-over');
        });
        slotEl.addEventListener('dragleave', function () { slotEl.classList.remove('drag-over'); });
        slotEl.addEventListener('drop', function (e) {
          e.preventDefault();
          slotEl.classList.remove('drag-over');
          var raw = e.dataTransfer.getData('application/x-shot');
          if (!raw) return;
          var d = JSON.parse(raw);
          var idx = parseInt(slotEl.dataset.slot, 10);
          state.slots[idx] = {
            file: d.file, style: d.style, key: d.key, idx: d.idx,
            beat: state.slots[idx].beat, fx: state.slots[idx].fx
          };
          save();
        });
      }
      document.querySelectorAll('.slot').forEach(makeDropTarget);
      // ---- Slot inputs ----
      document.querySelectorAll('.beat-input').forEach(function (inp, i) {
        inp.addEventListener('input', function () { state.slots[i].beat = inp.value; save(); });
      });
      document.querySelectorAll('[data-fx-slot]').forEach(function (el) {
        el.addEventListener('input', function () {
          var i = parseInt(el.dataset.fxSlot, 10);
          state.slots[i].fx = el.textContent.trim();
          save();
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });
      });
      // ---- Slot image click = open full size in new tab ----
      document.querySelectorAll('.slot-img').forEach(function (el) {
        el.addEventListener('click', function () {
          var i = parseInt(el.dataset.imgSlot, 10);
          var s = state.slots[i];
          if (s.file) window.open('_candidates_web/' + s.file, '_blank');
        });
      });
      // ---- Remove buttons ----
      document.querySelectorAll('.slot-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var slotEl = btn.closest('.slot');
          var i = parseInt(slotEl.dataset.slot, 10);
          state.slots[i] = { file: null, style: null, key: null, idx: null,
                             beat: state.slots[i].beat, fx: state.slots[i].fx };
          save();
        });
      });
      // ---- Action buttons ----
      document.getElementById('exportText').addEventListener('click', function () {
        var ta = document.getElementById('textOut');
        ta.select();
        navigator.clipboard.writeText(ta.value).then(function () {
          var b = document.getElementById('exportText');
          var orig = b.textContent;
          b.textContent = 'copied';
          setTimeout(function () { b.textContent = orig; }, 1200);
        });
      });
      document.getElementById('exportJson').addEventListener('click', function () {
        var blob = new Blob([JSON.stringify({
          generated: new Date().toISOString(),
          slots: state.slots
        }, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'shotlist-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
      });
      document.getElementById('clearAll').addEventListener('click', function () {
        if (!confirm('Clear all 5 slots?')) return;
        for (var i = 0; i < SLOTS; i++) state.slots[i] = { file: null, style: null, key: null, idx: null, beat: '', fx: '' };
        save();
      });
      // ---- Boot ----
      load();
      render();
    })();
  </script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'index.html'), html);
console.log(`wrote ${OUT}/index.html — ${ordered.length} sessions, ${files.length} candidates`);
